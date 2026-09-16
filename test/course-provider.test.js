import './setup.js';
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';

// Course discovery — docs/course-mode-spec.md §4.2 (four interchangeable
// origins), §8 (empty and error states), §11.3 (course vs range), §11.4
// (search). Mirrors location.test.js's approach: mock fetch and
// geolocation, then drive the real pipeline.

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

// A real Overpass element, including the tags that distinguish a course
// from a driving range.
function overpassEl(name, lat, lon, id, tags = { leisure: 'golf_course' }) {
  return { type: 'way', id, lat, lon, tags: { name, ...tags } };
}

// Shaped like a REAL jsonv2 response, which carries `category` — not
// `class`, which only the older json format uses. The original fixture used
// `class`, which meant these tests passed against a mock that no live
// response ever looks like, and the filter matched nothing in production.
function nominatimResult(name, { osm_type = 'way', osm_id = 99, city = 'Vienna', state = 'Virginia', cls = 'leisure', type = 'golf_course' } = {}) {
  return {
    name,
    display_name: `${name}, ${city}, ${state}, USA`,
    lat: '38.9',
    lon: '-77.3',
    category: cls,
    type,
    osm_type,
    osm_id,
    address: { city, state },
  };
}

function mockFetch({ overpassElements = [], overpassFails = false, geocode = null, nominatim = null, nominatimFails = false, nominatimMalformed = false, offline = false } = {}) {
  globalThis.fetch = async (url) => {
    if (offline) throw new Error('network unavailable');
    const u = String(url);
    if (u.includes('overpass')) {
      if (overpassFails) return { ok: false };
      return { ok: true, json: async () => ({ elements: overpassElements }) };
    }
    if (u.includes('nominatim')) {
      if (nominatimFails) return { ok: false };
      if (nominatimMalformed) return { ok: true, json: async () => ({ unexpected: 'shape' }) };
      return { ok: true, json: async () => (nominatim || []) };
    }
    if (u.includes('bigdatacloud')) {
      return { ok: true, json: async () => (geocode || {}) };
    }
    return { ok: false };
  };
}

describe('GPS states', () => {
  test('permission granted: nearby courses are returned with city/state', async () => {
    await resetDB();
    const { nearbyCoursesFromDevice, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({
      overpassElements: [overpassEl('Reston National Golf Course', 38.9001, -77.3001, 1)],
      geocode: { city: 'Reston', principalSubdivisionCode: 'US-VA' },
    });

    const { status, courses } = await nearbyCoursesFromDevice();
    assert.equal(status, LOOKUP_STATUS.OK);
    assert.equal(courses.length, 1);
    assert.equal(courses[0].name, 'Reston National Golf Course');
    assert.equal(courses[0].city, 'Reston');
    assert.equal(courses[0].state, 'VA');
    assert.equal(courses[0].source, 'gps_place');
    assert.equal(courses[0].place_id, 'way/1');
    assert.equal(courses[0].provider, 'osm');
  });

  test('permission denied: reported distinctly, never as "no courses nearby"', async () => {
    await resetDB();
    const { nearbyCoursesFromDevice, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    mockGeolocation(null);
    mockFetch({ overpassElements: [overpassEl('Somewhere', 38.9, -77.3, 1)] });

    const { status, courses } = await nearbyCoursesFromDevice();
    // §8 — "location is off" and "nothing found" are different messages.
    assert.equal(status, LOOKUP_STATUS.NO_PERMISSION);
    assert.deepEqual(courses, []);
  });

  test('geolocation entirely unavailable is treated as no permission', async () => {
    await resetDB();
    const { nearbyCoursesFromDevice, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    delete globalThis.navigator.geolocation;
    mockFetch({});

    const { status } = await nearbyCoursesFromDevice();
    assert.equal(status, LOOKUP_STATUS.NO_PERMISSION);
  });

  test('GPS works but no courses are nearby', async () => {
    await resetDB();
    const { nearbyCoursesFromDevice, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({ overpassElements: [], geocode: { city: 'Reston' } });

    const { status, courses } = await nearbyCoursesFromDevice();
    assert.equal(status, LOOKUP_STATUS.NO_RESULTS);
    assert.deepEqual(courses, []);
  });

  test('a lookup failure is reported as unavailable, not as an empty area', async () => {
    await resetDB();
    const { nearbyCoursesFromDevice, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({ overpassFails: true });

    // §8 keeps these separate on purpose: telling a golfer standing on a
    // course that there are no courses nearby would be wrong, and would
    // hide that recents and manual entry still work.
    const { status, courses } = await nearbyCoursesFromDevice();
    assert.equal(status, LOOKUP_STATUS.UNAVAILABLE);
    assert.deepEqual(courses, []);
  });

  test('fully offline reports unavailable and never throws', async () => {
    await resetDB();
    const { nearbyCoursesFromDevice, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({ offline: true });

    const { status, courses } = await nearbyCoursesFromDevice();
    assert.equal(status, LOOKUP_STATUS.UNAVAILABLE);
    assert.deepEqual(courses, []);
  });

  test('an empty but reachable area still reads as "no courses nearby"', async () => {
    await resetDB();
    const { nearbyCoursesFromDevice, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({ overpassElements: [], geocode: { city: 'Reston' } });

    const { status } = await nearbyCoursesFromDevice();
    assert.equal(status, LOOKUP_STATUS.NO_RESULTS);
  });

  test('missing coordinates are reported as unavailable rather than looked up', async () => {
    await resetDB();
    const { nearbyCourses, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    const { status } = await nearbyCourses(null, null);
    assert.equal(status, LOOKUP_STATUS.UNAVAILABLE);
  });
});

describe('Course vs range filtering (§11.3)', () => {
  test('driving ranges are excluded from Course Mode results', async () => {
    await resetDB();
    const { nearbyCoursesFromDevice } = await import('../js/courseProvider.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({
      overpassElements: [
        overpassEl('Practice Range Only', 38.9001, -77.3001, 1, { golf: 'driving_range' }),
        overpassEl('Reston National Golf Course', 38.9002, -77.3002, 2, { leisure: 'golf_course' }),
      ],
      geocode: { city: 'Reston' },
    });

    const { courses } = await nearbyCoursesFromDevice();
    assert.deepEqual(courses.map((c) => c.name), ['Reston National Golf Course']);
  });

  test('a facility tagged as BOTH a course and a range survives as a course', async () => {
    await resetDB();
    const { fetchNearbyGolfVenues } = await import('../js/places.js');
    mockFetch({
      overpassElements: [
        // The nearer element is the range tag — first-wins deduping would
        // have classified this whole venue as a range and hidden it from
        // Course Mode. Reference B's own example is a "Golf Center".
        overpassEl('Oakmont Golf Center', 38.9000, -77.3000, 1, { golf: 'driving_range' }),
        overpassEl('Oakmont Golf Center', 38.9005, -77.3005, 2, { leisure: 'golf_course' }),
      ],
    });

    const venues = await fetchNearbyGolfVenues(38.9, -77.3);
    assert.equal(venues.length, 1);
    assert.equal(venues[0].venue_type, 'course');
  });

  test('Range Mode still sees every venue type, unfiltered', async () => {
    await resetDB();
    const { fetchNearbyGolfVenues } = await import('../js/places.js');
    mockFetch({
      overpassElements: [
        overpassEl('A Range', 38.9001, -77.3001, 1, { golf: 'driving_range' }),
        overpassEl('A Course', 38.9002, -77.3002, 2, { leisure: 'golf_course' }),
      ],
    });

    // §11.3 — filtering happens at the call site, never in shared code.
    const venues = await fetchNearbyGolfVenues(38.9, -77.3);
    assert.equal(venues.length, 2);
    assert.deepEqual(venues.map((v) => v.venue_type).sort(), ['course', 'range']);
  });

  test('an untagged element is classified unknown, not silently a course', async () => {
    await resetDB();
    const { fetchNearbyGolfVenues } = await import('../js/places.js');
    mockFetch({ overpassElements: [{ type: 'way', id: 1, lat: 38.9, lon: -77.3, tags: { name: 'Mystery' } }] });

    const venues = await fetchNearbyGolfVenues(38.9, -77.3);
    assert.equal(venues[0].venue_type, 'unknown');
  });
});

describe('Search states', () => {
  test('a search returns matching courses with place ids', async () => {
    await resetDB();
    const { searchCourses, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    mockFetch({ nominatim: [nominatimResult('Oakmont Golf Center', { osm_type: 'way', osm_id: 42 })] });

    const { status, courses } = await searchCourses('oakmont');
    assert.equal(status, LOOKUP_STATUS.OK);
    assert.equal(courses.length, 1);
    assert.equal(courses[0].name, 'Oakmont Golf Center');
    assert.equal(courses[0].city, 'Vienna');
    assert.equal(courses[0].state, 'Virginia');
    assert.equal(courses[0].source, 'search');
    // Same "type/id" convention Overpass uses, so the same course found two
    // ways is one record.
    assert.equal(courses[0].place_id, 'way/42');
  });

  test('non-course results are filtered out', async () => {
    await resetDB();
    const { searchCourses, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    mockFetch({
      nominatim: [
        nominatimResult('Oakmont', { cls: 'place', type: 'town' }),
        nominatimResult('Oakmont Country Club', { osm_id: 7 }),
      ],
    });

    const { status, courses } = await searchCourses('oakmont');
    assert.equal(status, LOOKUP_STATUS.OK);
    assert.deepEqual(courses.map((c) => c.name), ['Oakmont Country Club']);
  });

  test('no matches is distinct from a failed search', async () => {
    await resetDB();
    const { searchCourses, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    mockFetch({ nominatim: [] });

    const { status, courses } = await searchCourses('zzzz');
    assert.equal(status, LOOKUP_STATUS.NO_RESULTS);
    assert.deepEqual(courses, []);
  });

  test('a bare place name that finds no golf retries for the feature itself', async () => {
    await resetDB();
    const { searchCourses, LOOKUP_STATUS } = await import('../js/courseProvider.js');

    // What Nominatim really does with "oakmont": ten settlements, no golf.
    // The course only surfaces once the query names the feature type.
    const queries = [];
    globalThis.fetch = async (url) => {
      const q = decodeURIComponent(String(url).match(/[?&]q=([^&]*)/)[1]);
      queries.push(q);
      const hits = /golf course in/i.test(q)
        ? [nominatimResult('Oakmont Golf Club', { osm_id: 7 })]
        : [{ name: 'Oakmont', display_name: 'Oakmont, PA', lat: '40.5', lon: '-79.8', category: 'place', type: 'hamlet', osm_type: 'node', osm_id: 1 }];
      return { ok: true, json: async () => hits };
    };

    const { status, courses } = await searchCourses('oakmont');
    assert.equal(status, LOOKUP_STATUS.OK);
    assert.deepEqual(courses.map((c) => c.name), ['Oakmont Golf Club']);
    assert.deepEqual(queries, ['oakmont', 'golf course in oakmont']);
  });

  test('a query that already says golf is not retried', async () => {
    await resetDB();
    const { searchCourses } = await import('../js/courseProvider.js');
    let calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: true, json: async () => [] }; };

    await searchCourses('oakmont golf club');
    assert.equal(calls, 1);
  });

  test('a successful first search is never retried', async () => {
    await resetDB();
    const { searchCourses } = await import('../js/courseProvider.js');
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, json: async () => [nominatimResult('Reston National', { osm_id: 3 })] };
    };

    await searchCourses('reston');
    assert.equal(calls, 1);
  });

  test('the live jsonv2 field name is what the filter reads', async () => {
    await resetDB();
    const { searchCourses, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    // jsonv2 carries `category`; the older json format carries `class`.
    // Both must pass the filter.
    mockFetch({ nominatim: [
      { name: 'Category Course', display_name: 'Category Course, VA', lat: '38.9', lon: '-77.3', category: 'leisure', type: 'golf_course', osm_type: 'way', osm_id: 1 },
      { name: 'Class Course', display_name: 'Class Course, VA', lat: '38.9', lon: '-77.3', class: 'leisure', type: 'golf_course', osm_type: 'way', osm_id: 2 },
    ] });

    const { status, courses } = await searchCourses('course');
    assert.equal(status, LOOKUP_STATUS.OK);
    assert.deepEqual(courses.map((c) => c.name), ['Category Course', 'Class Course']);
  });

  test('a failing search service reports unavailable, never throws', async () => {
    await resetDB();
    const { searchCourses, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    mockFetch({ nominatimFails: true });

    const { status, courses } = await searchCourses('oakmont');
    assert.equal(status, LOOKUP_STATUS.UNAVAILABLE);
    assert.deepEqual(courses, []);
  });

  test('a malformed response is unavailable, not a crash', async () => {
    await resetDB();
    const { searchCourses, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    mockFetch({ nominatimMalformed: true });

    const { status } = await searchCourses('oakmont');
    assert.equal(status, LOOKUP_STATUS.UNAVAILABLE);
  });

  test('offline search never throws', async () => {
    await resetDB();
    const { searchCourses, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    mockFetch({ offline: true });

    const { status } = await searchCourses('oakmont');
    assert.equal(status, LOOKUP_STATUS.UNAVAILABLE);
  });

  test('an empty query never reaches the network', async () => {
    await resetDB();
    const { searchCourses, LOOKUP_STATUS } = await import('../js/courseProvider.js');
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: false }; };

    const { status } = await searchCourses('   ');
    assert.equal(status, LOOKUP_STATUS.NO_RESULTS);
    assert.equal(called, false);
  });
});

describe('Manual course', () => {
  test('produces the same shape as a provider course, minus provider identity', async () => {
    await resetDB();
    const { manualCourse } = await import('../js/courseProvider.js');

    const course = manualCourse({ name: '  Pine Ridge Muni  ', city: ' Vienna ', state: 'VA' });
    assert.equal(course.name, 'Pine Ridge Muni');
    assert.equal(course.city, 'Vienna');
    assert.equal(course.state, 'VA');
    assert.equal(course.source, 'manual');
    assert.equal(course.place_id, null);
    assert.equal(course.provider, null);
  });

  test('city and state are genuinely optional', async () => {
    await resetDB();
    const { manualCourse } = await import('../js/courseProvider.js');

    const course = manualCourse({ name: 'Back Nine' });
    assert.equal(course.city, null);
    assert.equal(course.state, null);
  });

  test('a nameless course is rejected rather than stored blank', async () => {
    await resetDB();
    const { manualCourse } = await import('../js/courseProvider.js');
    assert.equal(manualCourse({ name: '   ' }), null);
    assert.equal(manualCourse({}), null);
  });

  test('manual entry works with no network at all', async () => {
    const db = await resetDB();
    const { manualCourse } = await import('../js/courseProvider.js');
    mockFetch({ offline: true });
    mockGeolocation(null);

    // §4.2 — manual entry is never a lesser option and never requires a
    // provider, a permission, or a connection.
    const course = manualCourse({ name: 'Pine Ridge Muni' });
    const stored = db.upsertCourse({ ...course, hole_count: 9 });
    assert.ok(stored.course_id);
    assert.equal(stored.source, 'manual');
    assert.equal(db.listCourses().length, 1);
  });
});

describe('Recent courses', () => {
  test('selecting a provider course stores it so it is available offline next time', async () => {
    const db = await resetDB();
    const { nearbyCoursesFromDevice } = await import('../js/courseProvider.js');
    mockGeolocation({ lat: 38.9, lon: -77.3 });
    mockFetch({
      overpassElements: [overpassEl('Reston National Golf Course', 38.9001, -77.3001, 1)],
      geocode: { city: 'Reston', principalSubdivisionCode: 'US-VA' },
    });

    const { courses } = await nearbyCoursesFromDevice();
    const stored = db.upsertCourse({ ...courses[0], hole_count: 18 });
    db.recordCoursePlayed(stored.course_id, { hole_count: 18, hole_defs: stored.hole_defs });

    assert.equal(db.getRecentCourse().name, 'Reston National Golf Course');
    // Found by GPS once, remembered by place_id forever after.
    assert.equal(db.findCourseByPlaceId('way/1').course_id, stored.course_id);
  });

  test('only the single most recently played course is the recent one', async () => {
    const db = await resetDB();
    const older = db.upsertCourse({ name: 'Older Course', source: 'manual' });
    const newer = db.upsertCourse({ name: 'Newer Course', source: 'manual' });
    db.recordCoursePlayed(older.course_id, {});
    await new Promise((r) => setTimeout(r, 2));
    db.recordCoursePlayed(newer.course_id, {});

    // §4.2 — exactly one recent course on the selector.
    assert.equal(db.getRecentCourse().name, 'Newer Course');
  });

  test('View All lists every played course, most recent first', async () => {
    const db = await resetDB();
    const a = db.upsertCourse({ name: 'Course A', source: 'manual' });
    const b = db.upsertCourse({ name: 'Course B', source: 'manual' });
    const c = db.upsertCourse({ name: 'Course C', source: 'manual' });
    db.recordCoursePlayed(a.course_id, {});
    await new Promise((r) => setTimeout(r, 2));
    db.recordCoursePlayed(b.course_id, {});
    await new Promise((r) => setTimeout(r, 2));
    db.recordCoursePlayed(c.course_id, {});

    const played = db.listCourses().filter((x) => !!x.last_played_at);
    assert.deepEqual(played.map((x) => x.name), ['Course C', 'Course B', 'Course A']);
  });

  test('with no course ever played there is no recent course to show', async () => {
    const db = await resetDB();
    db.upsertCourse({ name: 'Added But Never Played', source: 'manual' });

    // §4.2 — the RECENT COURSE section and View All are omitted entirely
    // rather than rendered empty.
    assert.equal(db.getRecentCourse(), null);
    assert.equal(db.listCourses().filter((c) => !!c.last_played_at).length, 0);
  });

  test('replaying a remembered course does not duplicate it', async () => {
    const db = await resetDB();
    const first = db.upsertCourse({ name: 'Reston National', source: 'gps_place', place_id: 'way/1' });
    db.recordCoursePlayed(first.course_id, {});
    const second = db.upsertCourse({ name: 'Reston National', source: 'search', place_id: 'way/1' });
    db.recordCoursePlayed(second.course_id, {});

    assert.equal(second.course_id, first.course_id);
    assert.equal(db.listCourses().length, 1);
    assert.equal(db.getCourse(first.course_id).play_count, 2);
  });
});
