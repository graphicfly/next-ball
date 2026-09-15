import * as db from '../db.js';
import {
  qs, qsa, fmtDate, fmtDateTime, fmtSetup, fmtSurface, fmtSwing, cap, focusList, escapeHtml, timingLineHtml,
  metricRowHtml, directionBarHtml, heightDistributionHtml, contactDistributionHtml, weatherIconHtml, drillSectionHtml,
  trainingAidSectionHtml, toast,
} from '../ui.js';
import { sessionSummary, strikeBreakdown, clubSummaryLabel } from '../stats.js';
import { getComparisonContext } from '../sessionAnalysis.js';
import {
  comparisonSectionHtml, bestWindowSectionHtml, bestWindowComparisonSectionHtml,
  targetAccuracySectionHtml, streaksSectionHtml, distanceDetailHtml,
  shotTimelineHtml, timelineLegendHtml, bindShotTimeline, blocksFlowHtml, firstLastCompactHtml,
  conditionsGroupHtml, groupTitleHtml, yourGrooveRowHtml,
} from '../summarySections.js';
import { downloadSessionCSV } from '../export.js';
import { startEditShotDraft, setFlowReturn, setGrooveReturn } from '../state.js';
import { openDeleteConfirmSheet } from './history.js';
import { openLocationSheet } from './locationSheet.js';

export function renderHistoryDetail(root, sessionId) {
  const session = db.getSession(sessionId);
  if (!session) { location.hash = '#/history'; return; }
  const shots = db.getShotsForSession(sessionId);
  // Recalculated fresh every time the session is opened, straight from the
  // stored raw shots — never cached/stored as authoritative, so an edit,
  // undo, or restore anywhere in the session is reflected immediately.
  const s = sessionSummary(shots);
  const comparison = getComparisonContext(session, shots, s.bestWindow);

  const shotsHtml = shots.length ? shots.map((shot) => `
    <div class="shot-row" data-shot-id="${shot.shot_id}">
      <span class="shot-row-check" aria-hidden="true">
        <svg viewBox="0 0 20 20">
          <circle class="check-ring" cx="10" cy="10" r="8"></circle>
          <circle class="check-fill" cx="10" cy="10" r="8"></circle>
          <path class="check-mark" d="M6 10.2l2.6 2.6L14 7"></path>
        </svg>
      </span>
      <div class="n">#${shot.shot_number}</div>
      <div class="tags">
        <span class="tag">${cap(shot.strike)}</span>
        <span class="tag">${shot.direction ? cap(shot.direction) : '&mdash;'}</span>
        <span class="tag">${shot.height ? cap(shot.height) : '&mdash;'}</span>
        <span class="tag">${shot.strike === 'miss' ? 'No flight' : db.yardsToDistanceLabel(shot.distance_yards)}</span>
        <span class="tag tag-setup" data-edit-setup="${shot.shot_id}">${shot.club} &bull; ${fmtSetup(shot.setup)} &bull; ${fmtSurface(shot.surface)} &bull; ${fmtSwing(shot.swing_length)}</span>
        ${shot.target_distance_yards != null ? `<span class="tag tag-target" data-edit-target="${shot.shot_id}">Target ${shot.target_distance_yards} yd</span>` : ''}
        <span class="tag tag-drill" data-edit-drill="${shot.shot_id}">${shot.drill ? escapeHtml(shot.drill) : 'Set drill'}</span>
        <span class="tag tag-aid" data-edit-aid="${shot.shot_id}">${db.shotTrainingAid(shot) !== 'none' ? escapeHtml(db.TRAINING_AID_LABELS[db.shotTrainingAid(shot)]) : 'No aid'}</span>
      </div>
    </div>`).join('') : '<div class="empty-state">No shots recorded.</div>';

  const { primary: locationPrimary, secondary: locationSecondary } = db.sessionLocationDisplay(session);
  const locationLabel = locationPrimary || (session.location_candidates?.length ? `${session.location_candidates.length} nearby options` : 'Not set');
  const weatherInnerHtml = `
      <div class="kv-row"><span class="muted">Location</span><b>${escapeHtml(locationLabel)}${locationSecondary ? ` <span class="tiny muted">(${escapeHtml(locationSecondary)})</span>` : ''}</b></div>
      <button class="btn btn-outline btn-sm" id="changeLocationBtn" style="margin-top:var(--space-2); margin-bottom:var(--space-2);">Change Location</button>
      ${session.weather_timestamp ? `
        ${session.temperature_f != null ? `<div class="kv-row"><span class="muted">Temperature</span><b>${weatherIconHtml(session.weather_condition)}${session.temperature_f}&deg;F${session.feels_like_f != null ? ' (feels ' + session.feels_like_f + '&deg;F)' : ''}</b></div>` : ''}
        ${session.weather_condition ? `<div class="kv-row"><span class="muted">Condition</span><b>${session.weather_condition}</b></div>` : ''}
        ${session.wind_speed_mph != null ? `<div class="kv-row"><span class="muted">Wind</span><b>${session.wind_speed_mph} mph${session.wind_direction_cardinal ? ' ' + session.wind_direction_cardinal : ''}${session.wind_gust_mph != null ? ' (gust ' + session.wind_gust_mph + ')' : ''}</b></div>` : ''}
        <div class="kv-row"><span class="muted">As of</span><b>${fmtDateTime(session.weather_timestamp)}</b></div>
      ` : `<div class="tiny muted">Weather unavailable for this session.</div>`}
    `;

  const first10 = s.firstLast.first10;
  const last10 = s.firstLast.last10;
  const fStrike = strikeBreakdown(first10);
  const lStrike = strikeBreakdown(last10);

  const distanceRange = s.consistency.distance.solid.range;
  const distanceCV = s.consistency.distance.solid.enoughData ? s.consistency.distance.solid.cv : null;

  const showDrills = s.drills.length > 1 || (s.drills.length === 1 && s.drills[0].drill !== db.DEFAULT_DRILL);
  const showTrainingAid = s.trainingAids.length > 1;

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; History</button>
        <span class="screen-title" id="detailScreenTitle">Session Detail</span>
        ${shots.length ? '<button class="back" id="enterSelectBtn">Edit</button>' : '<span class="side-space"></span>'}
      </div>
      <div class="scroll">
        <div class="tiny muted" id="editShotsIntro" style="margin-bottom:var(--space-2);" hidden>Select shots to correct their club, setup, drill, or other context together — strike, direction, height, and distance still edit one at a time.</div>
        <div class="tiny muted" id="sessionMetaLine" style="margin-bottom:var(--space-1);">${fmtDate(session.date)} &bull; ${s.total} balls &bull; ${escapeHtml(clubSummaryLabel(shots, session.default_club))} &bull; ${fmtSetup(session.default_setup)} &bull; ${fmtSurface(session.default_surface)} &bull; ${fmtSwing(session.default_swing)}${session.temperature_f != null ? ' &bull; ' + session.temperature_f + '&deg;F' : ''}</div>
        ${focusList(session.practice_focus).length ? `<div class="tiny muted">Focus: ${focusList(session.practice_focus).join(', ')}</div>` : ''}
        ${session.session_notes ? `<div class="tiny" style="margin-top:var(--space-2);">${session.session_notes}</div>` : ''}
        ${timingLineHtml(s.timing)}

        <div style="margin-top:var(--space-6);"></div>
        ${metricRowHtml([
          { value: Math.round(s.strike.solid.pct) + '%', label: 'Solid' },
          { value: Math.round(s.direction.straight.pct) + '%', label: 'Straight' },
          { value: s.distance.medianSolid != null ? s.distance.medianSolid + ' yd' : '—', label: 'Median Solid' },
        ])}

        ${shots.length ? `
          <div class="section-title">Session Timeline</div>
          ${timelineLegendHtml(shots)}
          ${shotTimelineHtml(shots, s.bestWindow)}
        ` : ''}

        ${groupTitleHtml('Performance')}
        <div class="section-title">Contact</div>
        ${contactDistributionHtml(s.strike)}

        <div class="section-title">Direction</div>
        ${directionBarHtml(s.direction)}

        <div class="section-title">Trajectory</div>
        ${heightDistributionHtml(s.height)}

        <div class="section-title">Distance</div>
        ${metricRowHtml([
          { value: s.distance.medianSolid != null ? s.distance.medianSolid + ' yd' : '—', label: 'Median Solid' },
          { value: distanceRange != null ? distanceRange + ' yd' : '—', label: 'Solid Range' },
          { value: distanceCV != null ? distanceCV + '%' : '—', label: 'Variability' },
        ], 'lg')}
        ${distanceDetailHtml(s.consistency)}
        ${targetAccuracySectionHtml(s.targetAccuracy)}

        ${groupTitleHtml('Session Flow')}
        ${bestWindowSectionHtml(s.bestWindow, s.bestTargetedWindow)}
        ${comparison ? bestWindowComparisonSectionHtml(comparison.bestWindowCompare) : ''}
        ${firstLastCompactHtml(s.firstLast, fStrike, lStrike)}
        ${s.blocks.length > 1 ? `<div class="section-title">Balls By 10s</div>${blocksFlowHtml(s.blocks)}` : ''}

        ${groupTitleHtml('Practice Insights')}
        ${comparison ? comparisonSectionHtml(comparison.match, comparison.metricsCompare, fmtDate, fmtSetup, fmtSwing) : ''}
        ${streaksSectionHtml(s.streaks)}
        ${showDrills ? drillSectionHtml(s.drills) : ''}
        ${showTrainingAid ? trainingAidSectionHtml(s.trainingAids) : ''}

        ${groupTitleHtml('Conditions')}
        ${conditionsGroupHtml(session, s.timing, weatherInnerHtml)}

        <details class="section-details" style="margin-top:var(--space-6);">
          <summary class="section-title">All Shots</summary>
          <div class="tiny muted" style="margin-bottom:var(--space-2);">Tap a shot to edit it &middot; tap any tag (club, target, drill, aid) to correct it &middot; long-press to select multiple.</div>
          <div class="batch-select-controls" id="batchSelectControls" hidden>
            <button class="batch-filter-tab active" id="filterAllBtn" data-filter="all">All</button>
            <button class="batch-filter-tab" id="filterSelectedBtn" data-filter="selected">Selected (<span id="selectedCountLabel">0</span>)</button>
            <button class="batch-delete-link" id="batchDeleteLink">Delete</button>
          </div>
          <div class="card shots-list" id="shotsListCard">${shotsHtml}</div>
        </details>

        <div style="margin-top:var(--space-5);">${yourGrooveRowHtml()}</div>
      </div>

      <button class="btn" id="exportBtn" style="margin-top:var(--space-3);">Export CSV</button>
      <div class="hairline" style="margin-top:var(--space-4);"></div>
      <button class="btn btn-danger btn-sm" id="deleteSessionBtn" style="margin-top:var(--space-1);" aria-label="Delete this session permanently">Delete Session</button>
    </div>
  `;

  bindShotTimeline(root, shots);

  qs('#exportBtn', root).addEventListener('click', () => { downloadSessionCSV(sessionId); });
  qs('#changeLocationBtn', root).addEventListener('click', () => {
    openLocationSheet(session, () => renderHistoryDetail(root, sessionId));
  });
  qs('#viewYourGrooveBtn', root)?.addEventListener('click', () => {
    setGrooveReturn(`#/history/${sessionId}`);
    location.hash = `#/groove/${sessionId}`;
  });
  qs('#deleteSessionBtn', root).addEventListener('click', () => {
    // Reuses History's own confirmation sheet (same dialog either way) —
    // after a successful delete this screen is dead (its session no longer
    // exists), so unlike History's own delete flow this always routes back
    // rather than staying put.
    openDeleteConfirmSheet(session, root, () => { location.hash = '#/history'; });
  });

  // ---------- Batch edit / Edit Shots (docs/ux-spec.md §3.10/§4.8, Reference A) ----------
  // A mode of this same shot list, not a new route or a parallel editor —
  // context fields batch-edit through the exact sheets defined below
  // (openBatchFieldSheet -> a per-field value sheet -> a confirm sheet with
  // an exact count), while a plain tap/tag-tap still edits one shot the
  // normal way outside selection mode. Strike/Direction/Height/Distance
  // stay individually-editable only — see §3.10's table — so they never
  // appear in the batch field list at all.
  let selecting = false;
  let filterMode = 'all'; // 'all' | 'selected' — the All/Selected(n) view toggle
  const selected = new Set();
  let anchorShotId = null;
  const listCard = qs('#shotsListCard', root);
  const scrollEl = qs('.scroll', root);

  function applyFilter() {
    qsa('.shot-row', listCard).forEach((row) => {
      row.hidden = filterMode === 'selected' && !selected.has(row.dataset.shotId);
    });
  }

  function updateSelectionChrome() {
    const count = selected.size;
    qs('#selectedCountLabel', root).textContent = String(count);
    qs('#batchFooterCount', root).textContent = `${count} shot${count === 1 ? '' : 's'} selected`;
    const editBtn = qs('#batchEditFieldBtn', root);
    editBtn.disabled = count === 0;
    editBtn.textContent = count ? `Edit ${count} Shot${count === 1 ? '' : 's'}` : 'Edit Shots';
    if (filterMode === 'selected') applyFilter();
  }

  function setRowSelected(shotId, isSelected) {
    if (isSelected) selected.add(shotId); else selected.delete(shotId);
    listCard.querySelector(`.shot-row[data-shot-id="${shotId}"]`)?.classList.toggle('selected', isSelected);
  }

  function selectRange(fromId, toId) {
    const i1 = shots.findIndex((s) => s.shot_id === fromId);
    const i2 = shots.findIndex((s) => s.shot_id === toId);
    if (i1 === -1 || i2 === -1) return;
    const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1];
    for (let i = lo; i <= hi; i++) setRowSelected(shots[i].shot_id, true);
    updateSelectionChrome();
  }

  function setFilterMode(mode) {
    filterMode = mode;
    qs('#filterAllBtn', root).classList.toggle('active', mode === 'all');
    qs('#filterSelectedBtn', root).classList.toggle('active', mode === 'selected');
    applyFilter();
  }

  function enterSelecting(firstShotId) {
    selecting = true;
    selected.clear();
    anchorShotId = firstShotId ?? null;
    listCard.classList.add('selecting');
    qs('#backBtn', root).textContent = 'Cancel';
    qs('#detailScreenTitle', root).textContent = 'Edit Shots';
    qs('#editShotsIntro', root).hidden = false;
    qs('#enterSelectBtn', root) && (qs('#enterSelectBtn', root).hidden = true);
    qs('#batchSelectControls', root).hidden = false;
    const detailsEl = listCard.closest('details');
    if (detailsEl) detailsEl.open = true;
    setFilterMode('all');
    if (!qs('#batchActionBar', root)) {
      qs('.screen', root).appendChild(buildBatchActionBar());
      wireBatchActionBar();
    }
    scrollEl.classList.add('has-batch-footer');
    if (firstShotId) setRowSelected(firstShotId, true);
    updateSelectionChrome();
  }

  function exitSelecting() {
    selecting = false;
    selected.clear();
    anchorShotId = null;
    filterMode = 'all';
    listCard.classList.remove('selecting');
    qsa('.shot-row', listCard).forEach((r) => { r.classList.remove('selected'); r.hidden = false; });
    qs('#backBtn', root).textContent = '← History';
    qs('#detailScreenTitle', root).textContent = 'Session Detail';
    qs('#editShotsIntro', root).hidden = true;
    qs('#enterSelectBtn', root) && (qs('#enterSelectBtn', root).hidden = false);
    qs('#batchSelectControls', root).hidden = true;
    qs('#batchActionBar', root)?.remove();
    scrollEl.classList.remove('has-batch-footer');
  }

  function buildBatchActionBar() {
    const bar = document.createElement('div');
    bar.className = 'batch-action-bar';
    bar.id = 'batchActionBar';
    bar.innerHTML = `
      <div>
        <div class="batch-footer-count" id="batchFooterCount">0 shots selected</div>
        <div class="batch-footer-note">Only the field you choose will be updated — everything else stays as logged.</div>
      </div>
      <div class="batch-footer-buttons">
        <button class="btn btn-outline" id="batchCancelBtn">Cancel</button>
        <button class="btn btn-primary" id="batchEditFieldBtn" disabled>Edit Shots</button>
      </div>
    `;
    return bar;
  }

  function wireBatchActionBar() {
    qs('#batchCancelBtn', root).addEventListener('click', exitSelecting);
    qs('#batchEditFieldBtn', root).addEventListener('click', () => {
      if (!selected.size) return;
      const chosen = shots.filter((s) => selected.has(s.shot_id));
      openBatchFieldSheet(chosen, sessionId, () => renderHistoryDetail(root, sessionId));
    });
  }

  qs('#backBtn', root).addEventListener('click', () => {
    if (selecting) { exitSelecting(); return; }
    location.hash = '#/history';
  });

  qs('#enterSelectBtn', root)?.addEventListener('click', () => enterSelecting());

  qs('#filterAllBtn', root).addEventListener('click', () => setFilterMode('all'));
  qs('#filterSelectedBtn', root).addEventListener('click', () => setFilterMode('selected'));
  qs('#batchDeleteLink', root).addEventListener('click', () => {
    if (!selected.size) { toast('Select at least one shot'); return; }
    openBatchDeleteSheet(Array.from(selected), sessionId, () => renderHistoryDetail(root, sessionId));
  });

  qsa('.shot-row', listCard).forEach((row) => {
    const shotId = row.dataset.shotId;
    let pressTimer = null;
    let longPressFired = false;

    row.addEventListener('pointerdown', () => {
      longPressFired = false;
      pressTimer = setTimeout(() => {
        longPressFired = true;
        if (!selecting) { enterSelecting(shotId); return; }
        if (anchorShotId && anchorShotId !== shotId) { selectRange(anchorShotId, shotId); return; }
        setRowSelected(shotId, !selected.has(shotId));
        anchorShotId = shotId;
        updateSelectionChrome();
      }, 500);
    });
    const clearPressTimer = () => clearTimeout(pressTimer);
    row.addEventListener('pointerup', clearPressTimer);
    row.addEventListener('pointerleave', clearPressTimer);
    row.addEventListener('pointercancel', clearPressTimer);

    row.addEventListener('click', (e) => {
      if (longPressFired) { longPressFired = false; return; } // long-press already acted on this tap
      if (selecting) {
        if (e.shiftKey && anchorShotId) { selectRange(anchorShotId, shotId); return; }
        setRowSelected(shotId, !selected.has(shotId));
        anchorShotId = shotId;
        updateSelectionChrome();
        return;
      }
      if (e.target.closest('.tag-drill,.tag-aid,.tag-setup,.tag-target')) return; // handled separately below
      const shot = shots.find((s) => s.shot_id === shotId);
      if (!shot) return;
      startEditShotDraft(shot);
      setFlowReturn(`#/history/${sessionId}`);
      location.hash = '#/log/strike';
    });
  });

  qsa('.tag-drill', root).forEach((tag) => {
    tag.addEventListener('click', (e) => {
      if (selecting) return; // let the tap bubble to the row's own selection handling
      e.stopPropagation();
      const shotId = tag.dataset.editDrill;
      const shot = shots.find((s) => s.shot_id === shotId);
      if (!shot) return;
      openShotDrillSheet(shot, () => renderHistoryDetail(root, sessionId));
    });
  });

  qsa('.tag-aid', root).forEach((tag) => {
    tag.addEventListener('click', (e) => {
      if (selecting) return;
      e.stopPropagation();
      const shotId = tag.dataset.editAid;
      const shot = shots.find((s) => s.shot_id === shotId);
      if (!shot) return;
      openShotTrainingAidSheet(shot, () => renderHistoryDetail(root, sessionId));
    });
  });

  qsa('.tag-setup', root).forEach((tag) => {
    tag.addEventListener('click', (e) => {
      if (selecting) return;
      e.stopPropagation();
      const shotId = tag.dataset.editSetup;
      const shot = shots.find((s) => s.shot_id === shotId);
      if (!shot) return;
      openShotSetupSheet(shot, () => renderHistoryDetail(root, sessionId));
    });
  });

  qsa('.tag-target', root).forEach((tag) => {
    tag.addEventListener('click', (e) => {
      if (selecting) return;
      e.stopPropagation();
      const shotId = tag.dataset.editTarget;
      const shot = shots.find((s) => s.shot_id === shotId);
      if (!shot) return;
      openShotTargetSheet(shot, () => renderHistoryDetail(root, sessionId));
    });
  });
}

export function openShotDrillSheet(shot, onDone) {
  const current = shot.drill || '';
  const isCustomCurrent = current && !db.DRILLS.includes(current);

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Correct Drill &mdash; Shot #${shot.shot_number}</h2>
      <div class="choice-grid wrap-2">
        ${db.DRILLS.map((d) => `<div class="choice-btn ${current === d ? 'selected' : ''}" data-value="${d}">${d}</div>`).join('')}
        <div class="choice-btn ${isCustomCurrent ? 'selected' : ''}" data-value="__custom__">Custom${isCustomCurrent ? ': ' + escapeHtml(current) : ''}</div>
      </div>
      <div id="customDrillWrap" style="display:${isCustomCurrent ? 'block' : 'none'}; margin-top:12px;">
        <input type="text" id="customDrillInput" placeholder="Drill name" maxlength="30" value="${isCustomCurrent ? escapeHtml(current) : ''}" />
        <button class="btn btn-primary" id="setCustomDrillBtn" style="margin-top:8px;">Set Drill</button>
      </div>
      <button class="btn btn-outline" id="closeDrillSheetBtn" style="margin-top:8px;">Close</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const applyDrill = (name) => {
    db.updateShot(shot.session_id, shot.shot_id, { drill: name });
    backdrop.remove();
    onDone();
  };

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeDrillSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qsa('.choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.value === '__custom__') {
        qs('#customDrillWrap', backdrop).style.display = 'block';
        qs('#customDrillInput', backdrop).focus();
        return;
      }
      applyDrill(btn.dataset.value);
    });
  });

  qs('#setCustomDrillBtn', backdrop).addEventListener('click', () => {
    const name = qs('#customDrillInput', backdrop).value.trim();
    if (!name) return;
    applyDrill(name);
  });
}

// Editing Training Aid never goes through the strike/direction/height/
// distance re-entry flow (see shotEntry.js) — this quick-correct sheet,
// same pattern as openShotDrillSheet above, is the only way to change it on
// a past shot. Only patches training_aid — shot_number and shot_timestamp
// are untouched, same guarantee updateShot already gives every other field.
export function openShotTrainingAidSheet(shot, onDone) {
  const current = db.shotTrainingAid(shot);

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Training Aid &mdash; Shot #${shot.shot_number}</h2>
      <div class="choice-grid wrap-2">
        ${db.TRAINING_AIDS.map((aid) => `<div class="choice-btn ${current === aid ? 'selected' : ''}" data-value="${aid}">${db.TRAINING_AID_LABELS[aid]}</div>`).join('')}
      </div>
      <button class="btn btn-outline" id="closeAidSheetBtn" style="margin-top:8px;">Close</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeAidSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qsa('.choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      db.updateShot(shot.session_id, shot.shot_id, { training_aid: btn.dataset.value });
      backdrop.remove();
      onDone();
    });
  });
}

// Corrects Club, Setup, Surface, or Swing Length on a single already-logged
// shot — same quick-correct pattern as openShotDrillSheet/
// openShotTrainingAidSheet above, and the same one-field-per-tap UX as
// Active Session's own Session Settings sheet (see active.js's
// openSettingsSheet). Only ever patches the one field tapped; shot_number
// and shot_timestamp are untouched, same as every other correction here.
export function openShotSetupSheet(shot, onDone) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Shot Setup &mdash; Shot #${shot.shot_number}</h2>
      <div class="field">
        <label>Club</label>
        <div class="choice-grid wrap-4">
          ${db.CLUBS.map((c) => `<div class="choice-btn ${shot.club === c ? 'selected' : ''}" data-field="club" data-value="${c}">${c}</div>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>Setup</label>
        <div class="choice-grid wrap-2">
          <div class="choice-btn ${shot.setup === 'ground' ? 'selected' : ''}" data-field="setup" data-value="ground">Ground</div>
          <div class="choice-btn ${shot.setup === 'tee' ? 'selected' : ''}" data-field="setup" data-value="tee">Tee</div>
        </div>
      </div>
      <div class="field">
        <label>Surface</label>
        <div class="choice-grid wrap-2">
          <div class="choice-btn ${shot.surface === 'mat' ? 'selected' : ''}" data-field="surface" data-value="mat">Mat</div>
          <div class="choice-btn ${shot.surface === 'grass' ? 'selected' : ''}" data-field="surface" data-value="grass">Grass</div>
        </div>
      </div>
      <div class="field">
        <label>Swing Length</label>
        <div class="choice-grid">
          <div class="choice-btn ${shot.swing_length === 'half' ? 'selected' : ''}" data-field="swing_length" data-value="half">Half</div>
          <div class="choice-btn ${shot.swing_length === 'three-quarter' ? 'selected' : ''}" data-field="swing_length" data-value="three-quarter">3/4</div>
          <div class="choice-btn ${shot.swing_length === 'full' ? 'selected' : ''}" data-field="swing_length" data-value="full">Full</div>
        </div>
      </div>
      <button class="btn btn-outline" id="closeSetupSheetBtn" style="margin-top:8px;">Close</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeSetupSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qsa('.choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      db.updateShot(shot.session_id, shot.shot_id, { [btn.dataset.field]: btn.dataset.value });
      backdrop.remove();
      onDone();
    });
  });
}

// Corrects (or clears) the target distance on a single already-logged shot.
export function openShotTargetSheet(shot, onDone) {
  const current = shot.target_distance_yards;

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Target &mdash; Shot #${shot.shot_number}</h2>
      <div class="choice-grid wrap-4">
        <div class="choice-btn ${current == null ? 'selected' : ''}" data-value="__off__">Off</div>
        ${db.TARGET_DISTANCE_PRESETS.map((d) => `<div class="choice-btn ${current === d ? 'selected' : ''}" data-value="${d}">${d}</div>`).join('')}
        <div class="choice-btn ${current != null && !db.TARGET_DISTANCE_PRESETS.includes(current) ? 'selected' : ''}" data-value="__custom__">Custom</div>
      </div>
      <div id="customTargetWrap" style="display:${current != null && !db.TARGET_DISTANCE_PRESETS.includes(current) ? 'block' : 'none'}; margin-top:12px;">
        <input type="number" id="customTargetInput" placeholder="Yards" min="1" max="500" value="${current != null && !db.TARGET_DISTANCE_PRESETS.includes(current) ? current : ''}" />
        <button class="btn btn-primary" id="setCustomTargetBtn" style="margin-top:8px;">Set Target</button>
      </div>
      <button class="btn btn-outline" id="closeTargetSheetBtn" style="margin-top:8px;">Close</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const applyTarget = (value) => {
    db.updateShot(shot.session_id, shot.shot_id, { target_distance_yards: value });
    backdrop.remove();
    onDone();
  };

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeTargetSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qsa('.choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.value === '__custom__') {
        qs('#customTargetWrap', backdrop).style.display = 'block';
        qs('#customTargetInput', backdrop).focus();
        return;
      }
      if (btn.dataset.value === '__off__') { applyTarget(null); return; }
      applyTarget(Number(btn.dataset.value));
    });
  });

  qs('#setCustomTargetBtn', backdrop).addEventListener('click', () => {
    const value = Number(qs('#customTargetInput', backdrop).value);
    if (!value || value < 1) { return; }
    applyTarget(value);
  });
}

// ---------- Batch edit sheets (docs/ux-spec.md §3.10) ----------
// Only the seven CONTEXT fields ever appear here — Strike/Direction/Height/
// Distance are the record of what the ball actually did, and bulk-rewriting
// them would falsify the log (and corrupt Groove Score, which reads strike
// directly). Non-batchable fields simply never appear in this list, rather
// than showing as disabled rows.
const BATCH_FIELDS = [
  { key: 'club', label: 'Club' },
  { key: 'swing_length', label: 'Swing Length' },
  { key: 'setup', label: 'Setup' },
  { key: 'surface', label: 'Surface' },
  { key: 'drill', label: 'Drill' },
  { key: 'training_aid', label: 'Training Aid' },
  { key: 'target_distance_yards', label: 'Target' },
];

export function openBatchFieldSheet(shots, sessionId, onDone) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Edit Field &mdash; ${shots.length} shot${shots.length === 1 ? '' : 's'}</h2>
      <div class="choice-grid wrap-2">
        ${BATCH_FIELDS.map((f) => `<div class="choice-btn" data-field="${f.key}">${f.label}</div>`).join('')}
      </div>
      <button class="btn btn-outline" id="closeBatchFieldBtn" style="margin-top:8px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeBatchFieldBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qsa('.choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      backdrop.remove();
      openBatchValueSheet(btn.dataset.field, shots, sessionId, onDone);
    });
  });
}

// One-field-per-operation confirm — always states the exact count being
// changed ("Change Club to GW for 4 shots?"), never a silent bulk write.
function openBatchConfirmSheet(fieldLabel, valueLabel, patch, shots, sessionId, onDone) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Change ${escapeHtml(fieldLabel)} to ${escapeHtml(String(valueLabel))} for ${shots.length} shot${shots.length === 1 ? '' : 's'}?</h2>
      <div class="stack">
        <button class="btn btn-outline" id="cancelBatchConfirmBtn">Cancel</button>
        <button class="btn btn-primary" id="confirmBatchEditBtn">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#cancelBatchConfirmBtn', backdrop).addEventListener('click', () => backdrop.remove());
  qs('#confirmBatchEditBtn', backdrop).addEventListener('click', () => {
    db.updateShots(sessionId, shots.map((s) => s.shot_id), patch);
    backdrop.remove();
    onDone();
  });
}

function openBatchChoiceValueSheet(fieldKey, fieldLabel, options, shots, sessionId, onDone, gridClass = '') {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>${escapeHtml(fieldLabel)} &mdash; ${shots.length} shot${shots.length === 1 ? '' : 's'}</h2>
      <div class="choice-grid ${gridClass}">
        ${options.map((o) => `<div class="choice-btn" data-value="${o.value}">${escapeHtml(o.label)}</div>`).join('')}
      </div>
      <button class="btn btn-outline" id="closeBatchValueBtn" style="margin-top:8px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeBatchValueBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qsa('.choice-btn', backdrop).forEach((btn) => {
    const chosen = options.find((o) => String(o.value) === btn.dataset.value);
    btn.addEventListener('click', () => {
      backdrop.remove();
      openBatchConfirmSheet(fieldLabel, chosen.label, { [fieldKey]: chosen.value }, shots, sessionId, onDone);
    });
  });
}

function openBatchDrillValueSheet(shots, sessionId, onDone) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Drill &mdash; ${shots.length} shot${shots.length === 1 ? '' : 's'}</h2>
      <div class="choice-grid wrap-2">
        ${db.DRILLS.map((d) => `<div class="choice-btn" data-value="${d}">${d}</div>`).join('')}
        <div class="choice-btn" data-value="__custom__">Custom</div>
      </div>
      <div id="customBatchDrillWrap" style="display:none; margin-top:12px;">
        <input type="text" id="customBatchDrillInput" placeholder="Drill name" maxlength="30" />
        <button class="btn btn-primary" id="setCustomBatchDrillBtn" style="margin-top:8px;">Set Drill</button>
      </div>
      <button class="btn btn-outline" id="closeBatchDrillBtn" style="margin-top:8px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeBatchDrillBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qsa('.choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.value === '__custom__') {
        qs('#customBatchDrillWrap', backdrop).style.display = 'block';
        qs('#customBatchDrillInput', backdrop).focus();
        return;
      }
      backdrop.remove();
      openBatchConfirmSheet('Drill', btn.dataset.value, { drill: btn.dataset.value }, shots, sessionId, onDone);
    });
  });

  qs('#setCustomBatchDrillBtn', backdrop).addEventListener('click', () => {
    const name = qs('#customBatchDrillInput', backdrop).value.trim();
    if (!name) return;
    backdrop.remove();
    openBatchConfirmSheet('Drill', name, { drill: name }, shots, sessionId, onDone);
  });
}

function openBatchTargetValueSheet(shots, sessionId, onDone) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Target &mdash; ${shots.length} shot${shots.length === 1 ? '' : 's'}</h2>
      <div class="choice-grid wrap-4">
        <div class="choice-btn" data-value="__off__">Off</div>
        ${db.TARGET_DISTANCE_PRESETS.map((d) => `<div class="choice-btn" data-value="${d}">${d}</div>`).join('')}
        <div class="choice-btn" data-value="__custom__">Custom</div>
      </div>
      <div id="customBatchTargetWrap" style="display:none; margin-top:12px;">
        <input type="number" id="customBatchTargetInput" placeholder="Yards" min="1" max="500" />
        <button class="btn btn-primary" id="setCustomBatchTargetBtn" style="margin-top:8px;">Set Target</button>
      </div>
      <button class="btn btn-outline" id="closeBatchTargetBtn" style="margin-top:8px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeBatchTargetBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qsa('.choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.value === '__custom__') {
        qs('#customBatchTargetWrap', backdrop).style.display = 'block';
        qs('#customBatchTargetInput', backdrop).focus();
        return;
      }
      backdrop.remove();
      if (btn.dataset.value === '__off__') {
        openBatchConfirmSheet('Target', 'Off', { target_distance_yards: null }, shots, sessionId, onDone);
        return;
      }
      const value = Number(btn.dataset.value);
      openBatchConfirmSheet('Target', `${value} yd`, { target_distance_yards: value }, shots, sessionId, onDone);
    });
  });

  qs('#setCustomBatchTargetBtn', backdrop).addEventListener('click', () => {
    const value = Number(qs('#customBatchTargetInput', backdrop).value);
    if (!value || value < 1) return;
    backdrop.remove();
    openBatchConfirmSheet('Target', `${value} yd`, { target_distance_yards: value }, shots, sessionId, onDone);
  });
}

function openBatchValueSheet(fieldKey, shots, sessionId, onDone) {
  if (fieldKey === 'club') {
    return openBatchChoiceValueSheet(fieldKey, 'Club', db.CLUBS.map((c) => ({ value: c, label: c })), shots, sessionId, onDone, 'wrap-4');
  }
  if (fieldKey === 'swing_length') {
    return openBatchChoiceValueSheet(fieldKey, 'Swing Length', [
      { value: 'half', label: 'Half' }, { value: 'three-quarter', label: '3/4' }, { value: 'full', label: 'Full' },
    ], shots, sessionId, onDone);
  }
  if (fieldKey === 'setup') {
    return openBatchChoiceValueSheet(fieldKey, 'Setup', [
      { value: 'ground', label: 'Ground' }, { value: 'tee', label: 'Tee' },
    ], shots, sessionId, onDone, 'wrap-2');
  }
  if (fieldKey === 'surface') {
    return openBatchChoiceValueSheet(fieldKey, 'Surface', [
      { value: 'mat', label: 'Mat' }, { value: 'grass', label: 'Grass' },
    ], shots, sessionId, onDone, 'wrap-2');
  }
  if (fieldKey === 'training_aid') {
    return openBatchChoiceValueSheet(fieldKey, 'Training Aid', db.TRAINING_AIDS.map((a) => ({ value: a, label: db.TRAINING_AID_LABELS[a] })), shots, sessionId, onDone, 'wrap-2');
  }
  if (fieldKey === 'drill') return openBatchDrillValueSheet(shots, sessionId, onDone);
  if (fieldKey === 'target_distance_yards') return openBatchTargetValueSheet(shots, sessionId, onDone);
}

// Destructive — the one place red fills a whole sheet surface (§3.10),
// distinct from the plain confirm sheet openBatchConfirmSheet uses for
// non-destructive field edits.
export function openBatchDeleteSheet(shotIds, sessionId, onDone) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet sheet-danger">
      <h2>Delete ${shotIds.length} shot${shotIds.length === 1 ? '' : 's'}?</h2>
      <p class="tiny muted" style="margin-bottom:var(--space-4);">This can&rsquo;t be undone.</p>
      <div class="stack">
        <button class="btn btn-outline" id="cancelBatchDeleteBtn">Cancel</button>
        <button class="btn btn-danger" id="confirmBatchDeleteBtn">Delete ${shotIds.length} Shot${shotIds.length === 1 ? '' : 's'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#cancelBatchDeleteBtn', backdrop).addEventListener('click', () => backdrop.remove());
  qs('#confirmBatchDeleteBtn', backdrop).addEventListener('click', () => {
    db.deleteShots(sessionId, shotIds);
    backdrop.remove();
    onDone();
  });
}
