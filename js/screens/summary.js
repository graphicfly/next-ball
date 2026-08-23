import * as db from '../db.js';
import {
  qs, fmtDate, fmtDateTime, fmtSetup, fmtSwing, metricRowHtml, escapeHtml,
  directionBarHtml, heightDistributionHtml, contactDistributionHtml, weatherIconHtml,
  drillSectionHtml,
} from '../ui.js';
import { sessionSummary, strikeBreakdown } from '../stats.js';
import { getComparisonContext, getPersonalBests } from '../sessionAnalysis.js';
import { buildRecapInsight } from '../sessionStory.js';
import {
  comparisonSectionHtml, bestWindowSectionHtml, bestWindowComparisonSectionHtml,
  targetAccuracySectionHtml, streaksSectionHtml, distanceDetailHtml,
  recapMetaHtml, recapArcHtml, recapSecondaryMetricsHtml, insightCardHtml, recapBestStretchHtml,
  exploreSessionRowHtml,
  shotTimelineHtml, timelineLegendHtml, bindShotTimeline, blocksFlowHtml, firstLastCompactHtml,
  conditionsGroupHtml, groupTitleHtml,
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

    ${exploreSessionRowHtml()}
  `;

  const fullHtml = `
    <button class="back-to-recap" id="backToRecapBtn">&larr; Back to Recap</button>

    <div class="btn-row" style="margin-bottom:var(--space-5);">
      <button class="btn" id="viewShotsBtn">View All Shots</button>
      <button class="btn" id="exportBtn">Export CSV</button>
    </div>

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

    ${groupTitleHtml('Conditions')}
    ${conditionsGroupHtml(session, s.timing, weatherInnerHtml)}
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
  qs('#viewDetailsBtn', root)?.addEventListener('click', () => {
    recapEl.hidden = true;
    fullEl.hidden = false;
    scrollEl.scrollTop = 0;
  });
  qs('#backToRecapBtn', root)?.addEventListener('click', () => {
    fullEl.hidden = true;
    recapEl.hidden = false;
    scrollEl.scrollTop = 0;
  });
}
