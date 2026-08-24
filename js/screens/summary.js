import * as db from '../db.js';
import {
  qs, fmtDate, fmtDateTime, fmtSetup, fmtSurface, fmtSwing, escapeHtml,
  directionBarHtml, heightDistributionHtml, contactDistributionHtml, weatherIconHtml,
} from '../ui.js';
import { sessionSummary, strikeBreakdown } from '../stats.js';
import { getComparisonContext, getPersonalBests } from '../sessionAnalysis.js';
import { buildRecapInsight, getNextGoal } from '../sessionStory.js';
import {
  comparisonSectionHtml, bestWindowSectionHtml, bestWindowComparisonSectionHtml,
  targetAccuracySectionHtml, streaksSectionHtml, distanceDetailHtml,
  recapMetaHtml, recapArcHtml, recapSecondaryMetricsHtml, insightCardHtml, recapBestStretchHtml,
  exploreSessionRowHtml, nextGoalCardHtml,
  shotTimelineHtml, timelineLegendHtml, bindShotTimeline, blocksFlowHtml, firstLastCompactHtml,
  conditionsGroupHtml,
  exploreSectionHtml, xsRowHtml, xsSubTitleHtml, xsGroupBreakdownHtml, bindExploreAccordion,
  performanceSummaryLine, sessionFlowSummaryLine, practiceSummaryLine, conditionsSummaryLine,
} from '../summarySections.js';
import { downloadSessionCSV } from '../export.js';
import { openLocationSheet } from './locationSheet.js';

export function renderSummary(root, sessionId) {
  const session = db.getSession(sessionId);
  if (!session) { location.hash = '#/history'; return; }
  const shots = db.getShotsForSession(sessionId);
  const s = sessionSummary(shots);
  const comparison = getComparisonContext(session, shots, s.bestWindow);
  const personalBests = getPersonalBests(session, shots, s);
  const insight = buildRecapInsight(s, comparison, personalBests, session, shots);
  const nextGoal = getNextGoal(s, shots, session);

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

  const recapHtml = `
    <div class="recap-hero">
      <img class="recap-hero-bg" src="graphics/active/range_backdrop.webp" alt="" />
      <div class="recap-hero-scrim"></div>
      <div class="recap-hero-content">
        ${recapMetaHtml(session, s, fmtDate, shots)}
        ${recapArcHtml(s.strike.solid.pct)}
      </div>
    </div>

    ${recapSecondaryMetricsHtml(s.direction.straight.pct, s.distance.medianSolid)}

    ${insight ? insightCardHtml(insight) : ''}

    ${shots.length ? `
      <div class="section-title">Your Session</div>
      ${timelineLegendHtml(shots)}
      ${shotTimelineHtml(shots, s.bestWindow)}
    ` : ''}

    ${recapBestStretchHtml(s.bestWindow)}

    ${nextGoal ? nextGoalCardHtml(nextGoal) : ''}

    ${exploreSessionRowHtml()}
  `;

  // ---------- Explore Session (four collapsible sections) ----------
  // Availability is decided here, at the call site, rather than inside the
  // shared builders: a section that has nothing valid to show is simply
  // omitted, instead of rendering "Not enough shots yet" / "Available after
  // 20 shots" placeholders. The builders themselves are untouched so
  // History Detail keeps its existing behavior.
  const hasFirstLast = !s.firstLast.overlapping && s.firstLast.first10.length > 0;
  const hasStreaks = Object.values(s.streaks).some((st) => st.length > 0);
  const activeAids = s.trainingAids.filter((a) => a.training_aid !== 'none');
  const hasTarget = s.targetAccuracy.length > 0;

  const performanceBody = `
    ${xsSubTitleHtml('Contact')}
    ${contactDistributionHtml(s.strike)}
    ${xsSubTitleHtml('Direction')}
    ${directionBarHtml(s.direction)}
    ${xsSubTitleHtml('Trajectory')}
    ${heightDistributionHtml(s.height)}
    ${xsSubTitleHtml('Distance')}
    ${xsRowHtml('Median solid', s.distance.medianSolid != null ? `${s.distance.medianSolid} yd` : '—')}
    ${xsRowHtml('Solid range', distanceRange != null ? `${distanceRange} yd` : '—')}
    ${xsRowHtml('Variability', distanceCV != null ? `${distanceCV}%` : '—')}
    ${distanceDetailHtml(s.consistency)}
    ${hasTarget ? targetAccuracySectionHtml(s.targetAccuracy) : ''}
    ${comparison ? comparisonSectionHtml(comparison.match, comparison.metricsCompare, fmtDate, fmtSetup, fmtSwing) : ''}
  `;

  const sessionFlowBody = `
    ${s.bestWindow ? bestWindowSectionHtml(s.bestWindow, s.bestTargetedWindow) : ''}
    ${s.bestWindow && comparison ? bestWindowComparisonSectionHtml(comparison.bestWindowCompare) : ''}
    ${hasFirstLast ? firstLastCompactHtml(s.firstLast, fStrike, lStrike) : ''}
    ${hasStreaks ? streaksSectionHtml(s.streaks) : ''}
    ${s.blocks.length > 1 ? `${xsSubTitleHtml('Balls By 10s')}${blocksFlowHtml(s.blocks)}` : ''}
  `;

  // Club/drill/aid all come from the per-shot breakdowns, never from the
  // session's final state — a session that switched clubs or aids mid-way
  // reports every one it actually used.
  const practiceBody = `
    ${s.clubs.length ? `${xsSubTitleHtml(s.clubs.length > 1 ? 'Clubs' : 'Club')}${xsGroupBreakdownHtml(s.clubs.map((c) => ({ name: c.club, count: c.count, solidPct: c.solidPct })))}` : ''}
    ${s.drills.length ? `${xsSubTitleHtml(s.drills.length > 1 ? 'Drills' : 'Drill')}${xsGroupBreakdownHtml(s.drills.map((d) => ({ name: d.drill, count: d.count, solidPct: d.solidPct })))}` : ''}
    ${activeAids.length ? `${xsSubTitleHtml('Training Aid')}${xsGroupBreakdownHtml(s.trainingAids.map((a) => ({ name: db.TRAINING_AID_LABELS[a.training_aid], count: a.count, solidPct: a.solidPct })))}` : ''}
    ${xsSubTitleHtml('Setup')}
    ${xsRowHtml('Lie', fmtSetup(session.default_setup))}
    ${xsRowHtml('Surface', fmtSurface(session.default_surface))}
    ${xsRowHtml('Swing length', fmtSwing(session.default_swing))}
  `;

  const conditionsBody = conditionsGroupHtml(session, s.timing, weatherInnerHtml, { heading: false });

  const exploreHtml = [
    { id: 'xsPerformance', index: 1, icon: 'performance', title: 'Performance', summary: performanceSummaryLine(s), body: performanceBody },
    { id: 'xsFlow', index: 2, icon: 'flow', title: 'Session Flow', summary: sessionFlowSummaryLine(s, fStrike, lStrike), body: sessionFlowBody },
    { id: 'xsPractice', index: 3, icon: 'practice', title: 'Practice', summary: practiceSummaryLine(s, shots, session, db.TRAINING_AID_LABELS), body: practiceBody },
    { id: 'xsConditions', index: 4, icon: 'conditions', title: 'Conditions', summary: conditionsSummaryLine(session, locationPrimary), body: conditionsBody },
  ].filter((sec) => sec.body.trim()).map(exploreSectionHtml).join('');

  const fullHtml = `
    <button class="back-to-recap" id="backToRecapBtn">&larr; Session Recap</button>

    ${exploreHtml}

    <div class="btn-row" style="margin-top:var(--space-5);">
      <button class="btn" id="viewShotsBtn">View All Shots</button>
      <button class="btn" id="exportBtn">Export CSV</button>
    </div>
  `;

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="homeBtn">&larr; Home</button>
        <span class="screen-title">Session Summary</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">
        <div id="recapView">${recapHtml}</div>
        <div id="fullView" hidden>${fullHtml}</div>
      </div>

      <button class="btn btn-primary" id="doneBtn" style="margin-top:var(--space-3);">Done</button>
    </div>
  `;

  bindShotTimeline(root, shots);
  bindExploreAccordion(root);

  qs('#homeBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
  qs('#doneBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
  qs('#viewShotsBtn', root).addEventListener('click', () => { location.hash = `#/history/${sessionId}`; });
  qs('#exportBtn', root).addEventListener('click', () => { downloadSessionCSV(sessionId); });
  qs('#changeLocationBtn', root).addEventListener('click', () => {
    openLocationSheet(session, () => renderSummary(root, sessionId));
  });

  const recapEl = qs('#recapView', root);
  const fullEl = qs('#fullView', root);
  const scrollEl = qs('.scroll', root);
  // The topbar title tracks which layer is showing, so the detail view
  // announces itself as Explore Session rather than repeating the recap's
  // title while showing entirely different content.
  const titleEl = qs('.screen-title', root);
  qs('#viewDetailsBtn', root)?.addEventListener('click', () => {
    recapEl.hidden = true;
    fullEl.hidden = false;
    titleEl.textContent = 'Explore Session';
    scrollEl.scrollTop = 0;
  });
  qs('#backToRecapBtn', root)?.addEventListener('click', () => {
    fullEl.hidden = true;
    recapEl.hidden = false;
    titleEl.textContent = 'Session Summary';
    scrollEl.scrollTop = 0;
  });
}
