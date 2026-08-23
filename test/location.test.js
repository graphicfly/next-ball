import './setup.js';
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  delete globalThis.navigator.geolocation;
});

function mockGeolocation(coords) {
  // coords === null simulates permission denied / unavailable.
  globalThis.navigator.geolocation = {
    getCurrentPosition: (success, error) => {
      if (coords === null) { error(new Error('denied')); return; }
      success({ coords: { latitude: coords.lat, longitude: coords.lon } });
    },
  };
}

// A naive .split(',') breaks on a quoted field that itself contains a
// comma (e.g. export.js correctly quotes "Washington, VA" per CSV
// escaping) — this respects quotes, unlike a plain split.
function parseCSVRow(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function overpassEl(name, lat, lon, id) {
  return { type: 'way', id, lat, lon, tags: { name } };
}

// offline: true simulates every request failing outright (network down),
// distinct from overpassFails/geocodeFails which simulate a specific
// service returning a bad response while the network itself is fine.
function mockFetch({ overpassElements = [], overpassFails = false, geocode = null, geocodeFails = false, offline = false } = {}) {
  globalThis.fetch = async (url) => {
    if (offline) throw new Error('network unavailable');
    const u = String(url);
    if (u.includes('overpass')) {
      if (overpassFails) return { ok: false };
      return { ok: true, json: async () => ({ elements: overpassElements }) };
    }
    if (u.includes('bigdatacloud')) {
      if (geocodeFails) return { ok: false };
      return { ok: true, json: async () => (geocode || {}) };
    }
    if (u.includes('open-meteo')) {
      return { ok: true, json: async () => ({ current: {} }) }; // weather isn't under test here
    }
    return { ok: false };
  };
}

describe('resolveVenueConfidence — pure confidence logic', () => {
  test('no candidates -> none', async () => {
    const { resolveVenueConfidence } = await import('../js/places.js');
    assert.equal(resolveVenueConfidence([]).decision, 'none');
  });
  test('one candidate, however far (within search radius) -> auto', async () => {
    const { resolveVenueConfidence } = await import('../js/places.js');
    const r = resolveVenueConfidence([{ name: 'Solo Course', distance_m: 900 }]);
    assert.equal(r.decision, 'auto');
    assert.equal(r.venue.name, 'Solo Course');
  });
  test('closest is strongly dominant over a distant second -> auto', async () => {
    const { resolveVenueConfidence } = await import('../js/places.js');
    const r = resolveVenueConfidence([{ name: 'Near', distance_m: 100 }, { name: 'Far', distance_m: 900 }]);
    assert.equal(r.decision, 'auto');
    assert.equal(r.venue.name, 'Near');
  });
  test('two comparably-close candidates -> ambiguous', async () => {
    const { resolveVenueConfidence } = await import('../js/places.js');
    const r = resolveVenueConfidence([{ name: 'A', distance_m: 250 }, { name: 'B', distance_m: 280 }]);
    assert.equal(r.decision, 'ambiguous');
    assert.equal(r.candidates.length, 2);
  });
});

describe('Scenario A / test 27 — clear single venue match', () => {
  test('auto-selects the venue, keeps city/state, remembers it', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({ overpassElements: [overpassEl('Reston National Golf Course', 38.9001, -77.3001, 1)], geocode: { city: 'Reston', principalSubdivisionCode: 'US-VA' } });

    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await startLocationResolution(session.session_id);

    const resolved = db.getSession(session.session_id);
    assert.equal(resolved.location_name, 'Reston National Golf Course');
    assert.equal(resolved.location_city, 'Reston');
    assert.equal(resolved.location_state, 'VA');
    assert.equal(resolved.location_source, 'gps_place');
    assert.equal(resolved.location_place_id, 'way/1');
    assert.deepEqual(resolved.location_candidates, []);

    const remembered = db.getRememberedVenues();
    assert.equal(remembered.length, 1);
    assert.equal(remembered[0].location_name, 'Reston National Golf Course');
  });
});

describe('Scenario B / test 28 — multiple plausible venues', () => {
  test('leaves an ambiguous candidate list for the user, city/state as working fallback', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({
      overpassElements: [overpassEl('Course A', 38.902, -77.301, 1), overpassEl('Course B', 38.9022, -77.3012, 2)],
      geocode: { city: 'Reston', principalSubdivisionCode: 'US-VA' },
    });

    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await startLocationResolution(session.session_id);

    const resolved = db.getSession(session.session_id);
    assert.equal(resolved.location_candidates.length, 2);
    assert.equal(resolved.location_name, 'Reston, VA', 'city/state fallback in the meantime, not silently picking one');

    // Selecting one (as locationSheet.js's apply() does) resolves it.
    db.setSessionLocation(session.session_id, { location_name: 'Course A', location_city: 'Reston', location_state: 'VA', location_source: 'manual', location_place_id: 'way/1' });
    const afterChoice = db.getSession(session.session_id);
    assert.equal(afterChoice.location_name, 'Course A');
    assert.deepEqual(afterChoice.location_candidates, []);
  });
});

describe('Scenario F / test 29 — remembered venue used automatically', () => {
  test('a second session near the same spot resolves via remembered, no venue lookup needed', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({ overpassElements: [overpassEl('Reston National Golf Course', 38.9001, -77.3001, 1)], geocode: { city: 'Reston', principalSubdivisionCode: 'US-VA' } });

    const s1 = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await startLocationResolution(s1.session_id);
    assert.equal(db.getSession(s1.session_id).location_source, 'gps_place');

    // Second visit, GPS a little different but well within remembering
    // radius — and Overpass now fails outright, proving the remembered
    // path never needed to call it.
    mockGeolocation({ lat: 38.9003, lon: -77.2998 });
    mockFetch({ overpassFails: true, geocodeFails: true });

    const s2 = db.createSession({ date: '2026-08-08', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await startLocationResolution(s2.session_id);

    const resolved = db.getSession(s2.session_id);
    assert.equal(resolved.location_name, 'Reston National Golf Course');
    assert.equal(resolved.location_source, 'remembered');
  });
});

describe('Scenario D / test 30 — manual correction, and it becomes the new remembered venue', () => {
  test('correcting Venue A to Venue B updates the session and future nearby sessions', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({ overpassElements: [overpassEl('Venue A', 38.9001, -77.3001, 1)], geocode: { city: 'Reston', principalSubdivisionCode: 'US-VA' } });

    const s1 = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await startLocationResolution(s1.session_id);
    assert.equal(db.getSession(s1.session_id).location_name, 'Venue A');

    // The golfer corrects it (as locationSheet.js's apply() does: set + remember).
    const withCoords = db.getSession(s1.session_id);
    db.setSessionLocation(s1.session_id, { location_name: 'Venue B', location_city: 'Reston', location_state: 'VA', location_source: 'manual' });
    db.rememberVenue({ latitude: 38.9, longitude: -77.3, location_name: 'Venue B', location_city: 'Reston', location_state: 'VA' });

    assert.equal(db.getSession(s1.session_id).location_name, 'Venue B');

    // A later nearby session should now remember Venue B, not Venue A.
    mockGeolocation({ lat: 38.9002, lon: -77.2999 });
    const s2 = db.createSession({ date: '2026-08-08', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await startLocationResolution(s2.session_id);
    assert.equal(db.getSession(s2.session_id).location_name, 'Venue B');
    assert.equal(db.getSession(s2.session_id).location_source, 'remembered');
  });
});

describe('Scenario G / test 31 — custom location is never overwritten by a later lookup', () => {
  test('setting a custom name, then re-running resolution, leaves it untouched', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: 'PW', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });

    db.setSessionLocation(session.session_id, { location_name: 'Backyard Practice Net', location_source: 'manual' });

    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({ overpassElements: [overpassEl('Some Golf Course', 38.9001, -77.3001, 1)], geocode: { city: 'Reston', principalSubdivisionCode: 'US-VA' } });
    await startLocationResolution(session.session_id);

    const resolved = db.getSession(session.session_id);
    assert.equal(resolved.location_name, 'Backyard Practice Net', 'venue lookup never overwrote the confirmed custom location');
    assert.equal(resolved.location_source, 'manual');
  });
});

describe('Scenario H / test 32 — venue/geocode API failure', () => {
  test('Overpass fails but geocode succeeds: falls back to city/state, no crash', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({ overpassFails: true, geocode: { city: 'Reston', principalSubdivisionCode: 'US-VA' } });

    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await assert.doesNotReject(() => startLocationResolution(session.session_id));

    const resolved = db.getSession(session.session_id);
    assert.equal(resolved.location_name, 'Reston, VA');
    assert.equal(resolved.location_source, 'reverse_geocode');

    // Shot logging is completely unaffected by the venue-lookup failure.
    const shot = db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150 });
    assert.ok(shot.shot_id);
  });

  test('both Overpass and geocode fail: stays unknown, session still fully functional', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    // Distinct coordinates from other tests in this file — weather.js caches
    // geocode results per lat/lon for 10 minutes, and that cache has no
    // per-test reset seam (unlike db.js), so reusing a coordinate another
    // test already geocoded would silently serve stale cached data instead
    // of exercising this test's actual failure mock.
    mockGeolocation({ lat: 10.1, lon: 20.1 });
    mockFetch({ overpassFails: true, geocodeFails: true });

    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await assert.doesNotReject(() => startLocationResolution(session.session_id));

    const resolved = db.getSession(session.session_id);
    assert.equal(resolved.location_name, null);
    assert.equal(resolved.location_source, 'unknown');
    assert.doesNotThrow(() => db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150 }));
  });
});

describe('Scenario D (permission) / test 33 — geolocation permission denied', () => {
  test('app continues normally, location stays unavailable, manual location still possible', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    mockGeolocation(null);

    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await assert.doesNotReject(() => startLocationResolution(session.session_id));

    assert.equal(db.getSession(session.session_id).location_source, 'unknown');
    const shot = db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150 });
    assert.ok(shot.shot_id, 'shot logging works fine with no location permission at all');

    // Manual location remains fully possible even with no GPS ever available.
    db.setSessionLocation(session.session_id, { location_name: 'Indoor Simulator', location_source: 'manual' });
    assert.equal(db.getSession(session.session_id).location_name, 'Indoor Simulator');
  });
});

describe('Scenario E (offline) / test 34 — offline behavior', () => {
  test('offline with a remembered venue nearby: still resolves locally, no network needed', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    db.rememberVenue({ latitude: 38.9, longitude: -77.3, location_name: 'Reston National Golf Course', location_city: 'Reston', location_state: 'VA' });

    mockGeolocation({ lat: 38.9004, lon: -77.2997 });
    mockFetch({ offline: true });

    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await assert.doesNotReject(() => startLocationResolution(session.session_id));

    const resolved = db.getSession(session.session_id);
    assert.equal(resolved.location_name, 'Reston National Golf Course');
    assert.equal(resolved.location_source, 'remembered');
  });

  test('offline with nothing remembered nearby: location unavailable, session unaffected', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    // Distinct coordinates — see the note in the "both fail" test above re:
    // weather.js's un-resettable geocode cache.
    mockGeolocation({ lat: 30.2, lon: 40.2 });
    mockFetch({ offline: true });

    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await assert.doesNotReject(() => startLocationResolution(session.session_id));
    assert.equal(db.getSession(session.session_id).location_source, 'unknown');
  });
});

describe('Section 35 — GPS drift never changes an already-resolved session location', () => {
  test('re-running resolution after auto-select is a no-op even with different mocked results available', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({ overpassElements: [overpassEl('Reston National Golf Course', 38.9001, -77.3001, 1)], geocode: { city: 'Reston', principalSubdivisionCode: 'US-VA' } });

    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await startLocationResolution(session.session_id);
    assert.equal(db.getSession(session.session_id).location_name, 'Reston National Golf Course');

    // GPS "drifts" — a slightly different reading that would resolve to a
    // DIFFERENT venue if this ran again.
    mockGeolocation({ lat: 38.95, lon: -77.35 });
    mockFetch({ overpassElements: [overpassEl('A Totally Different Course', 38.9501, -77.3501, 2)], geocode: { city: 'Herndon', principalSubdivisionCode: 'US-VA' } });
    await startLocationResolution(session.session_id);

    assert.equal(db.getSession(session.session_id).location_name, 'Reston National Golf Course', 'confirmed venue never changes on its own');
    assert.equal(db.getSession(session.session_id).location_source, 'gps_place');
  });
});

describe('Section 36 — historical sessions without the new location fields', () => {
  test('sessionLocationDisplay/sessionLocationSource/CSV export all handle a legacy session with no location_* fields', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const exp = await import('../js/export.js');
    const session = db.createSession({ date: '2020-01-01', start_time: '09:00', target_ball_count: 1, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    const raw = db.getSession(session.session_id);
    // Simulates a session saved before this feature existed.
    delete raw.location_city;
    delete raw.location_state;
    delete raw.location_source;
    delete raw.location_place_id;
    delete raw.location_candidates;
    raw.location_name = 'Washington, VA'; // the old plain-string behavior

    db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150 });

    assert.doesNotThrow(() => db.sessionLocationDisplay(raw));
    const display = db.sessionLocationDisplay(raw);
    assert.equal(display.primary, 'Washington, VA');
    assert.equal(display.secondary, null);
    assert.equal(db.sessionLocationSource(raw), 'unknown');

    assert.doesNotThrow(() => exp.sessionCSV(session.session_id));
    const csv = exp.sessionCSV(session.session_id);
    const header = csv.split('\n')[0].split(',');
    const row = parseCSVRow(csv.split('\n')[1]);
    assert.equal(row[header.indexOf('location')], 'Washington, VA');
    assert.equal(row[header.indexOf('location_source')], 'unknown');
  });
});

// Regression coverage for the Reston National bug: a manual venue
// correction wasn't being remembered because session.latitude/longitude
// used to be populated ONLY as a side effect of a successful weather fetch
// (sessionWeather.js -> db.addWeatherObservation's mirroring) — completely
// unrelated to, and with no timing guarantee relative to, confirming a
// venue. If weather hadn't resolved yet (or failed), locationSheet.js's
// rememberVenue() call silently no-op'd on missing coordinates. Fixed by
// making sessionLocation.js's ensureSessionPosition() the one place
// anything gets a session's coordinates from — session-stamped as a
// first-class fact the moment GPS succeeds, never dependent on weather.
describe('Section 37 — coordinates are a first-class fact, not a weather side effect', () => {
  test('startLocationResolution stamps latitude/longitude even though weather.js is never touched', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    mockGeolocation({ lat: 38.9421, lon: -77.3426 });
    mockFetch({ overpassElements: [overpassEl('Reston National Golf Course', 38.9421, -77.3426, 1)], geocode: { city: 'Reston', principalSubdivisionCode: 'US-VA' } });

    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    assert.equal(db.getSession(session.session_id).latitude, null, 'no coordinates before resolution, same as before this fix');

    await startLocationResolution(session.session_id);

    const resolved = db.getSession(session.session_id);
    assert.equal(resolved.latitude, 38.9421);
    assert.equal(resolved.longitude, -77.3426);
    assert.equal(resolved.weather_timestamp, null, 'weather was never fetched — coordinates came from location resolution alone');
  });

  test('ensureSessionPosition returns the session\'s own coordinates without a fresh GPS fetch when already known', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { ensureSessionPosition } = await import('../js/sessionLocation.js');
    let geoCalls = 0;
    globalThis.navigator.geolocation = { getCurrentPosition: () => { geoCalls++; } };

    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.updateSession(session.session_id, { latitude: 38.9421, longitude: -77.3426 });

    const pos = await ensureSessionPosition(db.getSession(session.session_id));
    assert.deepEqual(pos, { latitude: 38.9421, longitude: -77.3426 });
    assert.equal(geoCalls, 0, 'must not re-fetch GPS when the session already has coordinates');
  });

  test('ensureSessionPosition fetches and persists fresh coordinates when the session has none yet', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { ensureSessionPosition } = await import('../js/sessionLocation.js');
    mockGeolocation({ lat: 38.9421, lon: -77.3426 });

    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    const pos = await ensureSessionPosition(db.getSession(session.session_id));
    assert.deepEqual(pos, { latitude: 38.9421, longitude: -77.3426 });
    assert.equal(db.getSession(session.session_id).latitude, 38.9421, 'must persist the fetched position onto the session');
  });

  test('THE ACTUAL BUG: a manual venue correction made before weather ever resolves is still remembered for next time', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { ensureSessionPosition } = await import('../js/sessionLocation.js');
    // Simulates locationSheet.js's apply(): the golfer types a name before
    // GPS/weather have ever been asked for anything on this session.
    mockGeolocation({ lat: 38.9421, lon: -77.3426 });

    const s1 = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    assert.equal(db.getSession(s1.session_id).weather_timestamp, null);
    assert.equal(db.getSession(s1.session_id).latitude, null);

    db.setSessionLocation(s1.session_id, { location_name: 'Reston National Golf Course', location_source: 'manual' });
    const pos = await ensureSessionPosition(db.getSession(s1.session_id));
    assert.ok(pos, 'a position must be obtainable even though weather never ran');
    db.rememberVenue({ latitude: pos.latitude, longitude: pos.longitude, location_name: 'Reston National Golf Course' });

    assert.equal(db.getRememberedVenues().length, 1, 'the correction must actually be remembered — this is what silently failed before the fix');

    // A later, nearby session should now resolve automatically — no typing required.
    const { startLocationResolution } = await import('../js/sessionLocation.js');
    mockGeolocation({ lat: 38.9425, lon: -77.3430 }); // a few meters off, same visit
    mockFetch({ overpassFails: true, geocodeFails: true }); // proves the remembered path never needed the network
    const s2 = db.createSession({ date: '2026-08-08', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    await startLocationResolution(s2.session_id);

    const resolved = db.getSession(s2.session_id);
    assert.equal(resolved.location_name, 'Reston National Golf Course');
    assert.equal(resolved.location_source, 'remembered');
  });
});

describe('Section 38 — large-course confidence thresholds (tuned against real Reston National OSM data)', () => {
  test('a single real venue whose reported center is far from the golfer (large-polygon centroid) is still auto-selected up to 500m', async () => {
    const { resolveVenueConfidence } = await import('../js/places.js');
    const r = resolveVenueConfidence([{ name: 'Reston National Golf Course', distance_m: 480 }]);
    assert.equal(r.decision, 'auto');
  });

  test('a genuinely distant second course (well beyond the property) does not create false ambiguity', async () => {
    const { resolveVenueConfidence } = await import('../js/places.js');
    // Reflects the real Reston National vs. Hidden Creek Country Club
    // situation found during investigation: a second course's polygon can
    // graze the same search radius from a driving range positioned near
    // the property edge, without actually being a plausible mix-up.
    const r = resolveVenueConfidence([
      { name: 'Reston National Golf Course', distance_m: 450 },
      { name: 'Hidden Creek Country Club', distance_m: 1450 },
    ]);
    assert.equal(r.decision, 'auto');
    assert.equal(r.venue.name, 'Reston National Golf Course');
  });

  test('two candidates genuinely close together (real ambiguity) still resolve as ambiguous', async () => {
    const { resolveVenueConfidence } = await import('../js/places.js');
    const r = resolveVenueConfidence([{ name: 'Course A', distance_m: 400 }, { name: 'Course B', distance_m: 470 }]);
    assert.equal(r.decision, 'ambiguous');
  });
});
