// Shared Location editor — opened from Active's Settings sheet and from
// Session Details, so a session's location (current or historical) can
// always be corrected the same way. Deliberately NOT part of the
// Contact/Direction/Height/Distance shot-entry sequence.
import * as db from '../db.js';
import { qs, qsa, toast, escapeHtml } from '../ui.js';
import { getCurrentPosition, fetchLocationDetails } from '../weather.js';
import { fetchNearbyGolfVenues, resolveVenueConfidence } from '../places.js';
import { ensureSessionPosition } from '../sessionLocation.js';

function milesLabel(distanceM) {
  const mi = distanceM / 1609.34;
  return mi < 0.1 ? '< 0.1 mi' : `${mi.toFixed(1)} mi`;
}

function candidateRowHtml(c, i) {
  return `
    <button class="location-candidate-btn" data-idx="${i}">
      <span class="loc-name">${escapeHtml(c.name)}</span>
      <span class="loc-dist">${milesLabel(c.distance_m)}</span>
    </button>`;
}

// session: the session to edit (active or historical — both supported, the
// caller just needs to pass whatever db.updateSession-compatible id/object
// it has). onDone: called after a successful save so the caller can
// re-render itself.
export function openLocationSheet(session, onDone) {
  let candidates = Array.isArray(session.location_candidates) ? session.location_candidates : [];
  const cityState = session.location_city && session.location_state
    ? `${session.location_city}, ${session.location_state}`
    : session.location_city || session.location_state || null;

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>${candidates.length ? 'Where are you practicing?' : 'Change Location'}</h2>
      <div id="locationCandidatesWrap">${candidates.map(candidateRowHtml).join('')}</div>
      <button class="btn btn-outline" id="searchNearbyBtn" style="margin-top:8px;">Search Nearby Venues</button>
      <div class="field" style="margin-top:var(--space-4);">
        <label>Custom Location</label>
        <input type="text" id="customLocationInput" placeholder="e.g. Backyard Practice Net" maxlength="60" />
        <button class="btn btn-primary" id="saveCustomLocationBtn" style="margin-top:8px;">Save</button>
      </div>
      ${cityState ? `<button class="btn" id="useCityStateBtn" style="margin-top:8px;">Use ${escapeHtml(cityState)}</button>` : ''}
      <button class="btn btn-outline" id="closeLocationSheetBtn" style="margin-top:8px;">Close</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#closeLocationSheetBtn', backdrop).addEventListener('click', close);

  // Every confirmed choice — a candidate pick, custom text, or explicit
  // city/state fallback — is a manual confirmation: it's remembered
  // (geo-matched) for future sessions AND never overwritten automatically
  // afterward (see sessionLocation.js's shouldResolve gate).
  //
  // Coordinates come from ensureSessionPosition rather than reading
  // session.latitude/longitude directly — those may not exist yet (they
  // used to be populated only as a side effect of a successful weather
  // fetch, which has nothing to do with confirming a venue), and this is
  // the one path a golfer relies on to make "remember this place" actually
  // stick. Falls back to a fresh GPS fetch so a manual correction typed
  // moments after Start Session — before anything else had asked for a
  // position — still gets remembered instead of silently not.
  const apply = async (fields) => {
    db.setSessionLocation(session.session_id, { ...fields, location_source: 'manual' });
    if (fields.location_name) {
      const pos = await ensureSessionPosition(session);
      if (pos) {
        db.rememberVenue({
          latitude: pos.latitude, longitude: pos.longitude,
          location_name: fields.location_name, location_city: fields.location_city, location_state: fields.location_state,
          location_place_id: fields.location_place_id,
        });
      }
    }
    close();
    onDone();
  };

  qsa('.location-candidate-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = candidates[Number(btn.dataset.idx)];
      if (!c) return;
      apply({ location_name: c.name, location_city: session.location_city, location_state: session.location_state, location_place_id: c.place_id });
    });
  });

  qs('#saveCustomLocationBtn', backdrop).addEventListener('click', () => {
    const name = qs('#customLocationInput', backdrop).value.trim();
    if (!name) { toast('Enter a location name'); return; }
    apply({ location_name: name, location_city: session.location_city, location_state: session.location_state, location_place_id: null });
  });

  qs('#useCityStateBtn', backdrop)?.addEventListener('click', () => {
    apply({ location_name: cityState, location_city: session.location_city, location_state: session.location_state, location_place_id: null });
  });

  // Explicit, user-initiated re-lookup — independent of sessionLocation.js's
  // once-per-session automatic gate, since this is a deliberate request,
  // not background polling (see spec section 20).
  qs('#searchNearbyBtn', backdrop).addEventListener('click', async () => {
    const btn = qs('#searchNearbyBtn', backdrop);
    btn.disabled = true;
    btn.textContent = 'Searching…';
    try {
      const pos = session.latitude != null && session.longitude != null
        ? { latitude: session.latitude, longitude: session.longitude }
        : await getCurrentPosition();
      if (!pos) { toast('Location unavailable'); return; }
      const [venues, geocode] = await Promise.all([
        fetchNearbyGolfVenues(pos.latitude, pos.longitude),
        fetchLocationDetails(pos.latitude, pos.longitude),
      ]);
      const result = resolveVenueConfidence(venues);
      candidates = result.decision === 'none' ? [] : (result.decision === 'auto' ? [result.venue] : result.candidates);
      if (geocode.city || geocode.state) {
        session.location_city = geocode.city;
        session.location_state = geocode.state;
      }
      qs('#locationCandidatesWrap', backdrop).innerHTML = candidates.length
        ? candidates.map(candidateRowHtml).join('')
        : '<p class="tiny muted">No golf venues found nearby.</p>';
      qsa('.location-candidate-btn', backdrop).forEach((el) => {
        el.addEventListener('click', () => {
          const c = candidates[Number(el.dataset.idx)];
          if (!c) return;
          apply({ location_name: c.name, location_city: session.location_city, location_state: session.location_state, location_place_id: c.place_id });
        });
      });
    } finally {
      btn.disabled = false;
      btn.textContent = 'Search Nearby Venues';
    }
  });
}
