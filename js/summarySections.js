// Shared HTML builders for the analysis sections that appear on both the
// Session Summary (just-finished) and History Detail (revisited-later)
// screens, so the two stay visually and numerically consistent. Purely
// presentational — every number here is expected to already be computed by
// stats.js; this module never touches db.js or does its own math.

import { escapeHtml, metricRowHtml, deltaHtml, qs, qsa, cap, fmtSetup, fmtSurface, fmtSwing, fmtDuration, fmtDurationWords } from './ui.js';
import { clubSummaryLabel } from './stats.js';

const FATIGUE_LABELS = { 1: 'Very fresh', 2: 'Fresh', 3: 'Normal', 4: 'Tired', 5: 'Very tired' };
const DISCOMFORT_LABELS = { 0: 'None', 1: 'Very mild', 2: 'Mild', 3: 'Moderate', 4: 'Significant', 5: 'Severe' };

function kv(label, value) {
  return `<div class="kv-row"><span class="muted">${label}</span><b>${value}</b></div>`;
}

function yd(v) {
  return v === null || v === undefined ? '—' : `${v} yd`;
}

function pctOrDash(v) {
  return v === null || v === undefined ? '—' : `${v}%`;
}

// A percentage-point or yardage diff row: current value, label, and a
// signed delta chip (color + arrow, never color alone) against a prior
// session or window.
function compareRow(label, m, valueSuffix, diffSuffix) {
  const curText = m.current !== null && m.current !== undefined ? `${m.current}${valueSuffix}` : '—';
  return `
    <div class="compare-row">
      <span>${label}</span>
      <span class="compare-row-value">${curText} ${deltaHtml(m.diff, diffSuffix, m.betterWhen)}</span>
    </div>`;
}

// matchInfo: { session, score, comparable } from stats.findComparableSession, or null if there's no prior session at all.
export function comparisonSectionHtml(matchInfo, metricsCompare, fmtDateFn, fmtSetupFn, fmtSwingFn) {
  if (!matchInfo || !metricsCompare) return '';
  const cmp = matchInfo.session;
  const label = matchInfo.comparable
    ? `Compared with previous ${cmp.default_club} / ${fmtSwingFn(cmp.default_swing)} / ${fmtSetupFn(cmp.default_setup)} session &mdash; ${fmtDateFn(cmp.date)}`
    : `No closely comparable session found &mdash; compared with previous session (${fmtDateFn(cmp.date)})`;

  return `
    <div class="section-title">Compared with Previous Session</div>
    <div class="card" style="margin-bottom:var(--space-4);">
      <div class="tiny muted" style="margin-bottom:var(--space-3);">${label}</div>
      ${compareRow('Solid', metricsCompare.solid, '%', ' pts')}
      ${compareRow('Topped', metricsCompare.topped, '%', ' pts')}
      ${compareRow('Fat', metricsCompare.fat, '%', ' pts')}
      ${compareRow('Thin', metricsCompare.thin, '%', ' pts')}
      ${compareRow('Straight', metricsCompare.straight, '%', ' pts')}
      ${compareRow('Median solid distance', metricsCompare.medianSolidDistance, ' yd', ' yd')}
      ${compareRow('Solid distance variability', metricsCompare.solidDistanceCV, '%', ' pts')}
    </div>`;
}

export function bestWindowSectionHtml(window, targetedWindow) {
  if (!window) {
    return `<div class="section-title">Best 10-Shot Window</div><div class="empty-state">Not enough shots yet — need at least 10.</div>`;
  }
  const main = `
    <div class="section-title">Best 10-Shot Window</div>
    <div class="spotlight" style="margin-bottom:var(--space-3);">
      <div class="spotlight-eyebrow">Best Stretch</div>
      <div class="spotlight-range">Balls ${window.startBall}&ndash;${window.endBall}</div>
      ${metricRowHtml([
        { value: pctOrDash(window.solidPct), label: 'Solid' },
        { value: pctOrDash(window.straightPct), label: 'Straight' },
        { value: pctOrDash(window.toppedFatPct), label: 'Top / Fat' },
      ], 'lg')}
      ${window.medianSolidDistance != null || window.solidDistanceCV !== null ? `
        <div class="hairline"></div>
        ${kv('Median solid distance', yd(window.medianSolidDistance))}
        ${window.solidDistanceCV !== null ? kv('Solid distance variability', pctOrDash(window.solidDistanceCV)) : ''}
      ` : ''}
    </div>`;

  const targeted = targetedWindow ? `
    <div class="card" style="margin-bottom:var(--space-4);">
      <div style="font-weight:var(--weight-semibold); margin-bottom:2px; color:var(--color-accent);">Best 10 &mdash; Target Practice (${targetedWindow.target} yd)</div>
      <div class="tiny muted" style="margin-bottom:var(--space-3);">Balls ${targetedWindow.startBall}&ndash;${targetedWindow.endBall}</div>
      ${kv('Solid', pctOrDash(targetedWindow.solidPct))}
      ${kv('Topped/Fat', pctOrDash(targetedWindow.toppedFatPct))}
      ${kv('Median absolute target error', yd(targetedWindow.medianAbsoluteError))}
      ${kv('Straight', pctOrDash(targetedWindow.straightPct))}
    </div>` : '';

  return main + targeted;
}

export function bestWindowComparisonSectionHtml(compare) {
  if (!compare) return '';
  return `
    <div class="section-title">Best 10 vs Previous Best 10</div>
    <div class="card" style="margin-bottom:var(--space-4);">
      ${compareRow('Solid', compare.solid, '%', ' pts')}
      ${compareRow('Topped/Fat', compare.toppedFat, '%', ' pts')}
      ${compareRow('Straight', compare.straight, '%', ' pts')}
      ${compareRow('Median solid distance', compare.medianSolidDistance, ' yd', ' yd')}
    </div>`;
}

export function targetAccuracySectionHtml(groups) {
  if (!groups || !groups.length) return '';
  return `
    <div class="section-title">Target Accuracy</div>
    ${groups.map((g) => `
      <div class="card" style="margin-bottom:var(--space-3);">
        <div style="font-weight:var(--weight-semibold); margin-bottom:var(--space-3);">Target: ${g.target} yd &bull; ${g.count} shot${g.count === 1 ? '' : 's'}</div>
        ${kv('Median actual', yd(g.medianActual))}
        ${kv('Median signed error', g.medianSignedError != null ? `${g.medianSignedError > 0 ? '+' : ''}${g.medianSignedError} yd` : '—')}
        ${kv('Median absolute error', yd(g.medianAbsoluteError))}
        ${kv('Within 5 yd', pctOrDash(g.within5Pct))}
        ${kv('Within 10 yd', pctOrDash(g.within10Pct))}
        ${g.improvementYards !== null && g.improvementYards !== undefined ? `
          <div class="hairline"></div>
          <div class="tiny" style="color:${g.improvementYards > 0 ? 'var(--color-accent)' : g.improvementYards < 0 ? 'var(--color-danger)' : 'var(--color-text-secondary)'};">
            Target accuracy: ${g.improvementYards > 0 ? `improved by ${g.improvementYards} yd` : g.improvementYards < 0 ? `declined by ${Math.abs(g.improvementYards)} yd` : 'unchanged'}
          </div>` : ''}
      </div>`).join('')}
  `;
}

// Secondary distance math (mean/stddev/min/max for both all-shots and
// solid-only) tucked behind its own toggle under the Distance hero metrics
// — the three headline numbers already cover median/spread/variability, so
// this is only for someone who wants the underlying arithmetic.
export function distanceDetailHtml(c) {
  return `
    <details class="section-details">
      <summary class="tiny muted" style="text-transform:none; letter-spacing:0;">More distance stats</summary>
      <div class="card" style="margin-top:var(--space-2);">
        ${kv('Median distance (all)', yd(c.distance.all.median))}
        ${kv('Min / max (all)', c.distance.all.min != null ? `${yd(c.distance.all.min)} &ndash; ${yd(c.distance.all.max)}` : '—')}
        <div class="hairline"></div>
        ${kv('Min / max (solid)', c.distance.solid.min != null ? `${yd(c.distance.solid.min)} &ndash; ${yd(c.distance.solid.max)}` : '—')}
        ${kv('Mean solid distance', c.distance.solid.enoughData ? yd(c.distance.solid.mean) : 'Not enough data')}
        ${kv('Solid distance std. dev.', c.distance.solid.enoughData ? yd(c.distance.solid.stddev) : 'Not enough data')}
      </div>
    </details>`;
}

// Only the top 3 streaks get headline treatment (short, glanceable labels
// per the product spec); anything else is one tap away, never all shown at
// once with verbose sentence-style labels.
const STREAK_SHORT_LABELS = { cleanContact: 'Clean Contact', solid: 'Solid In A Row', noTop: 'No Top', noFat: 'No Fat', straight: 'Straight In A Row' };
const STREAK_PRIORITY = ['cleanContact', 'solid', 'noTop', 'noFat', 'straight'];

export function streaksSectionHtml(streaks) {
  const withData = STREAK_PRIORITY.filter((k) => streaks[k].length > 0);
  if (!withData.length) return `<div class="section-title">Streaks</div><div class="tiny muted">No streaks yet.</div>`;
  const top = withData.slice(0, 3);
  const rest = withData.slice(3);
  return `
    <div class="section-title">Streaks</div>
    ${metricRowHtml(top.map((k) => ({ value: String(streaks[k].length), label: STREAK_SHORT_LABELS[k] })), 'md')}
    ${rest.length ? `
      <details class="section-details" style="margin-top:var(--space-3);">
        <summary class="tiny muted" style="text-transform:none; letter-spacing:0;">See all streaks</summary>
        <div class="card" style="margin-top:var(--space-2);">
          ${rest.map((k) => kv(STREAK_SHORT_LABELS[k], `${streaks[k].length} shots`)).join('')}
        </div>
      </details>` : ''}
  `;
}

// Replaces the old 7-column spreadsheet-style 10-ball table with a compact
// bar per block — the point is to SEE the session's shape, not read a table.
export function blocksFlowHtml(blocks) {
  if (!blocks.length) return '';
  return `
    <div class="flow-blocks">
      ${blocks.map((b) => `
        <div class="flow-block">
          <div class="flow-block-label">${b.label}</div>
          <div class="flow-block-bar-bg"><div class="flow-block-bar-fill" style="width:${b.strike.solid.pct}%;"></div></div>
          <div class="flow-block-value">${b.strike.solid.pct}%</div>
        </div>`).join('')}
    </div>`;
}

// Gated at 20 shots — below that, First 10 / Last 10 overlap and the
// comparison is misleading rather than just less interesting, so it's
// hidden (with a subtle explanation) instead of rendered anyway.
export function firstLastCompactHtml(firstLast, fStrike, lStrike) {
  if (firstLast.overlapping || !firstLast.first10.length) {
    return `<div class="section-title">First 10 vs Last 10</div><div class="tiny muted">Available after 20 shots.</div>`;
  }
  const diff = lStrike.solid.pct - fStrike.solid.pct;
  return `
    <div class="section-title">First 10 vs Last 10</div>
    <div class="compare-cols">
      <div>
        <div class="head">First 10</div>
        ${metricRowHtml([{ value: fStrike.solid.pct + '%', label: 'Solid' }, { value: round1(fStrike.topped.pct + fStrike.fat.pct) + '%', label: 'Top/Fat' }], 'md')}
      </div>
      <div>
        <div class="head">Last 10</div>
        ${metricRowHtml([{ value: lStrike.solid.pct + '%', label: 'Solid' }, { value: round1(lStrike.topped.pct + lStrike.fat.pct) + '%', label: 'Top/Fat' }], 'md')}
      </div>
    </div>
    ${diff !== 0 ? `<div class="tiny" style="text-align:center; margin-top:var(--space-3); color:${diff > 0 ? 'var(--color-accent)' : 'var(--color-danger)'};">${diff > 0 ? '+' : ''}${round1(diff)} pts Solid</div>` : ''}
  `;
}

// Weather, session duration, and fatigue/discomfort folded into ONE quiet
// card — Conditions is supporting context, never a headline, so it never
// gets its own stack of separate accordions the way Performance does.
// `heading` defaults to true so History Detail's existing layout is
// unchanged; Explore Session passes false because its accordion header
// already says "Conditions" directly above this.
export function conditionsGroupHtml(session, timing, weatherInnerHtml, { heading = true } = {}) {
  const fatigueRows = [
    session.fatigue_rating != null ? kv('Fatigue', `${session.fatigue_rating}/5 &mdash; ${FATIGUE_LABELS[session.fatigue_rating]}`) : '',
    session.hand_discomfort_rating != null ? kv('Hand discomfort', `${session.hand_discomfort_rating}/5 &mdash; ${DISCOMFORT_LABELS[session.hand_discomfort_rating]}`) : '',
    session.elbow_discomfort_rating != null ? kv('Elbow discomfort', `${session.elbow_discomfort_rating}/5 &mdash; ${DISCOMFORT_LABELS[session.elbow_discomfort_rating]}`) : '',
  ].join('');
  const durationRow = timing.totalDurationSeconds != null ? kv('Duration', fmtDuration(timing.totalDurationSeconds)) : '';
  return `
    ${heading ? '<div class="section-title">Conditions</div>' : ''}
    <div class="card conditions-card">
      ${weatherInnerHtml}
      ${durationRow}
      ${fatigueRows}
    </div>`;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// A larger divider header for the four Full Analysis groups (Performance /
// Session Flow / Practice Insights / Conditions) — distinct from the
// smaller .section-title used for subsections within each group.
export function groupTitleHtml(text) {
  return `<div class="group-title">${text}</div>`;
}

// ---------- Session Recap (Layer 1) ----------
// The recap is a REWARD, not a report — one hero metric, two secondary
// numbers, one factual insight, the shot map, and (if there's enough data)
// the best stretch. Everything else lives behind Explore Session.

// A real, user-confirmed venue/custom location earns one compact line in
// the recap (per the product spec's "50 balls • 7i / Reston National Golf
// Course / Aug 22 • 58 min" example) — a bare city/state fallback never
// did and still doesn't, so this doesn't reintroduce the kind of low-value
// noise ("Washington, VA") the whole location feature exists to move away
// from. Checked as a plain field rather than importing db.js's
// LOCATION_SOURCES, per this module's own "never touches db.js" rule above.
const VENUE_LOCATION_SOURCES = ['gps_place', 'remembered', 'manual'];

export function recapMetaHtml(session, s, fmtDateFn, shots) {
  const durationStr = fmtDurationWords(s.timing.totalDurationSeconds);
  const showVenue = session.location_name && VENUE_LOCATION_SOURCES.includes(session.location_source);
  const club = clubSummaryLabel(shots, session.default_club);
  return `
    <div class="session-complete-eyebrow">Session Complete</div>
    <div class="session-complete-meta">${s.total} ball${s.total === 1 ? '' : 's'} &bull; ${escapeHtml(club)}</div>
    ${showVenue ? `<div class="session-complete-sub">${escapeHtml(session.location_name)}</div>` : ''}
    <div class="session-complete-sub">${fmtDateFn(session.date)}${durationStr ? ' &bull; ' + durationStr : ''}</div>`;
}

// A semicircle gauge for Solid Contact — the dominant number on the recap.
// Both the glow and crisp strokes share one path with pathLength="100" set,
// which normalizes the path to 100 units regardless of true arc geometry:
// stroke-dasharray="pct, 100-pct" then directly encodes the percentage as a
// dash length, no circumference math needed.
export function recapArcHtml(solidPctRaw) {
  const pctVal = Math.max(0, Math.min(100, Math.round(solidPctRaw)));
  const gap = 100 - pctVal;
  const arcPath = 'M20,150 A140,140 0 0 1 300,150';
  return `
    <div class="recap-arc-wrap">
      <svg class="recap-arc" viewBox="0 0 320 168" role="img" aria-label="${pctVal} percent solid contact">
        <defs>
          <filter id="recapArcGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6"></feGaussianBlur>
          </filter>
        </defs>
        <path class="recap-arc-track" d="${arcPath}" pathLength="100"></path>
        <path class="recap-arc-fill-glow" d="${arcPath}" pathLength="100" stroke-dasharray="${pctVal} ${gap}" filter="url(#recapArcGlow)"></path>
        <path class="recap-arc-fill" d="${arcPath}" pathLength="100" stroke-dasharray="${pctVal} ${gap}"></path>
      </svg>
      <div class="recap-arc-label">
        <div class="recap-arc-value">${pctVal}<span>%</span></div>
        <div class="recap-arc-caption">Solid Contact</div>
      </div>
    </div>`;
}

export function recapSecondaryMetricsHtml(straightPct, medianSolid) {
  return `
    <div class="recap-secondary">
      <div class="recap-secondary-metric">
        <div class="recap-secondary-value">${straightPct}%</div>
        <div class="recap-secondary-label">Straight</div>
      </div>
      <div class="recap-secondary-divider"></div>
      <div class="recap-secondary-metric">
        <div class="recap-secondary-value">${medianSolid != null ? medianSolid + ' yd' : '—'}</div>
        <div class="recap-secondary-label">Median Solid</div>
      </div>
    </div>`;
}

const INSIGHT_ICON_PATHS = {
  trend: { fill: 'none', d: '<path d="M4 16l6-6 4 4 7-8"/><path d="M14 6h7v7"/>' },
  star: { fill: 'currentColor', d: '<path d="M12 4.2l2.5 5 5.6.8-4.1 4 1 5.5-5-2.6-5 2.6 1-5.5-4.1-4 5.6-.8Z"/>' },
  analytics: { fill: 'none', d: '<path d="M4 20V11"/><path d="M11 20V4"/><path d="M18 20v-6"/>' },
  target: { fill: 'none', d: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/>' },
};

function insightIconHtml(kind) {
  const icon = INSIGHT_ICON_PATHS[kind] || INSIGHT_ICON_PATHS.trend;
  return `<svg viewBox="0 0 24 24" fill="${icon.fill}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon.d}</svg>`;
}

// Shared compact card for both the top insight and Best Stretch — same
// icon + headline + supporting-line shape, per the mockup showing both as
// visually identical treatments rather than two different components.
export function insightCardHtml({ icon = 'trend', headline, sub }) {
  return `
    <div class="insight-card">
      <span class="insight-icon">${insightIconHtml(icon)}</span>
      <div>
        <div class="insight-headline">${escapeHtml(headline)}</div>
        <div class="insight-sub">${escapeHtml(sub)}</div>
      </div>
    </div>`;
}

// Always the real rolling Best 10 window (never swapped for a different
// highlight type) — omitted entirely below 10 shots, per spec, rather than
// showing a placeholder "not enough data" message on the reward screen.
export function recapBestStretchHtml(window) {
  if (!window) return '';
  return insightCardHtml({
    icon: 'star',
    headline: 'Best Stretch',
    sub: `Balls ${window.startBall}–${window.endBall} • ${window.solidPct}% Solid`,
  });
}

// One deterministic, forward-looking challenge for next time — see
// sessionStory.js's getNextGoal for the selection logic. Deliberately a
// compact secondary card (reuses insight-card's dark surface), never
// another giant gauge — this is a nudge, not a second hero metric.
export function nextGoalCardHtml(goal) {
  if (!goal) return '';
  return `
    <div class="insight-card next-goal-card">
      <span class="insight-icon">${insightIconHtml('target')}</span>
      <div class="next-goal-text">
        <div class="next-goal-eyebrow">Next Goal</div>
        <div class="next-goal-title">${escapeHtml(goal.title)}</div>
        <div class="next-goal-detail">${escapeHtml(goal.detail)}</div>
      </div>
    </div>`;
}

// The recap's one path into the full detailed analytics for this session —
// deliberately unconditional (no gating on shot count, Best 10, comparison
// data, etc.) so it's always present regardless of how little the session
// contains. Reuses the same icon-circle treatment as insightCardHtml for
// visual consistency, but stays a secondary surface (plain white title, not
// accent-colored) so it never competes with Done as the primary action.
export function exploreSessionRowHtml() {
  return `
    <button class="explore-row" id="viewDetailsBtn" aria-label="Explore session details">
      <span class="insight-icon">${insightIconHtml('analytics')}</span>
      <span class="explore-row-text">
        <span class="explore-row-title">Explore Session</span>
        <span class="explore-row-sub">See detailed insights and shot data</span>
      </span>
      <span class="explore-row-chevron" aria-hidden="true">&rsaquo;</span>
    </button>`;
}

export { FATIGUE_LABELS, DISCOMFORT_LABELS };

// ---------- Shot timeline ----------
// One marker per shot, encoded with shape + fill + color (never color
// alone) so contact quality reads at a glance without a legend, plus which
// shots fall inside the session's Best 10-shot window. Deliberately no
// per-marker text label — the grid itself is the signature visual, not a
// data table in disguise.

const TIMELINE_MARKER_CLASS = {
  solid: 'tm-solid', thin: 'tm-thin', topped: 'tm-topped',
  fat: 'tm-fat', shank: 'tm-shank', miss: 'tm-miss',
};

const TIMELINE_LEGEND_ORDER = ['solid', 'thin', 'topped', 'fat', 'shank', 'miss'];

// Shown once above the shot map — each marker shape only needs to be
// learned a single time, not repeated as a text label on every shot. Only
// categories that actually occurred in this session are listed, so a
// session with just Solid/Thin/Fat never clutters the legend with unused
// Topped/Shank/Miss entries.
export function timelineLegendHtml(shots) {
  const used = new Set((shots || []).map((s) => s.strike));
  const order = TIMELINE_LEGEND_ORDER.filter((k) => used.has(k));
  if (!order.length) return '';
  return `<div class="timeline-legend">${order.map((k) => `
    <span class="timeline-legend-item"><span class="tm-marker ${TIMELINE_MARKER_CLASS[k]}"></span>${cap(k)}</span>
  `).join('')}</div>`;
}

function shotAriaLabel(shot) {
  const parts = [`Ball ${shot.shot_number}`, cap(shot.strike)];
  if (shot.strike !== 'miss') {
    if (shot.direction) parts.push(cap(shot.direction));
    if (shot.height) parts.push(cap(shot.height));
    if (shot.distance_yards != null) parts.push(`${shot.distance_yards} yards`);
  }
  return parts.join(', ');
}

// Adapts to session length rather than forcing one fixed layout:
//   1-5 shots  ('lg')   — one centered row of large markers, ball number
//                         printed underneath each one (there's no legend
//                         repetition to lean on when there are this few).
//   6-10 shots ('mdlg') — one centered row of medium-large markers that
//                         wraps to 2 rows via CSS auto-fit if the phone is
//                         too narrow to fit them all on one line.
//   11-20 shots ('md')  — compact grid, fixed 10-wide rows.
//   21+ shots ('sm')    — compact grid, fixed 10-wide rows (unchanged from
//                         the original design — this is the 50-shot view).
// Longer sessions get a "start–end" range label per row (e.g. "21–30") so
// shot order stays orientable at a glance. The last row of an odd-sized
// session (e.g. 43 shots) is simply shorter — no placeholder markers for
// balls that were never hit. Every row shares the same `columns` track
// count so a partial final row still lines up under the rows above it
// instead of stretching to fill the space differently.
export function shotTimelineHtml(shots, bestWindow) {
  if (!shots.length) return '';
  const sorted = [...shots].sort((a, b) => a.shot_number - b.shot_number);
  const total = sorted.length;
  const inBest = (n) => bestWindow && n >= bestWindow.startBall && n <= bestWindow.endBall;

  const sizeClass = total <= 5 ? 'lg' : total <= 10 ? 'mdlg' : total <= 20 ? 'md' : 'sm';
  const singleRow = sizeClass === 'lg' || sizeClass === 'mdlg';
  const columns = singleRow ? total : Math.min(10, total);
  const showRowLabels = total > columns;
  // lg/mdlg rows are centered and capped at a target per-marker size via
  // max-width, so they shrink gracefully instead of overflowing the
  // viewport — a bare fixed pixel column width would overflow at 8-10
  // shots. mdlg's actual column count comes from a CSS auto-fit rule (see
  // style.css) so it can wrap to 2 rows on a narrow phone; only its overall
  // cap width is set here. The md/sm rows always have a fixed 10-column
  // template and stretch to fill the space next to their row label, so 1fr
  // with no cap is correct there.
  const gridStyle = sizeClass === 'lg'
    ? `grid-template-columns:repeat(${columns}, minmax(0, 1fr)); width:100%; max-width:${total * 64 + (total - 1) * 8}px;`
    : sizeClass === 'mdlg'
    ? `width:100%; max-width:${total * 56 + (total - 1) * 5}px;`
    : `grid-template-columns:repeat(${columns}, minmax(0, 1fr));`;

  const rows = [];
  for (let i = 0; i < total; i += columns) rows.push(sorted.slice(i, i + columns));

  const cellHtml = (shot) => `
    <button class="tm-cell${sizeClass === 'lg' ? ' lg' : ''}${inBest(shot.shot_number) ? ' best' : ''}" data-shot-id="${shot.shot_id}" aria-label="${shotAriaLabel(shot)}">
      <span class="tm-marker ${TIMELINE_MARKER_CLASS[shot.strike] || 'tm-solid'}"></span>
      ${sizeClass === 'lg' ? `<span class="tm-cell-number" aria-hidden="true">${shot.shot_number}</span>` : ''}
    </button>`;

  return `
    <div class="shot-map">
      ${rows.map((row, i) => `
        <div class="shot-map-row ${sizeClass}">
          <div class="shot-map-grid ${sizeClass}" style="${gridStyle}">
            ${row.map(cellHtml).join('')}
          </div>
          ${showRowLabels ? `<div class="shot-map-row-label">${i * columns + 1}&ndash;${i * columns + row.length}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function fmtShotDistance(shot) {
  if (shot.strike === 'miss') return 'No flight';
  if (shot.distance_yards === null || shot.distance_yards === undefined) return 'Unknown';
  return `${shot.distance_yards} yd`;
}

// Read-only bottom sheet for a single shot — used by both Session Summary
// (tap a timeline marker) and History Detail, so inspecting a shot never
// requires navigating away from the recap.
export function openShotDetailSheet(shot) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <div class="shot-sheet-head">
        <span class="shot-sheet-ball">Ball ${shot.shot_number}</span>
        <span class="tm-marker ${TIMELINE_MARKER_CLASS[shot.strike] || 'tm-solid'} lg"></span>
      </div>
      ${metricRowHtml([
        { value: cap(shot.strike), label: 'Contact' },
        { value: shot.direction ? cap(shot.direction) : '—', label: 'Direction' },
        { value: shot.height ? cap(shot.height) : '—', label: 'Height' },
      ], 'md')}
      <div class="metric-row" style="margin-top:var(--space-2);">
        ${metricRowHtml([{ value: fmtShotDistance(shot), label: 'Distance' }], 'md')}
      </div>
      <div class="hairline"></div>
      <div class="kv-row"><span class="muted">Club</span><b>${escapeHtml(shot.club)}</b></div>
      <div class="kv-row"><span class="muted">Setup</span><b>${fmtSetup(shot.setup)} &bull; ${fmtSurface(shot.surface)}</b></div>
      <div class="kv-row"><span class="muted">Swing</span><b>${fmtSwing(shot.swing_length)}</b></div>
      ${shot.drill ? `<div class="kv-row"><span class="muted">Drill</span><b>${escapeHtml(shot.drill)}</b></div>` : ''}
      ${shot.target_distance_yards != null ? `<div class="kv-row"><span class="muted">Target</span><b>${shot.target_distance_yards} yd</b></div>` : ''}
      <button class="btn" id="closeShotSheetBtn" style="margin-top:var(--space-4);">Close</button>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeShotSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());
}

// Wires every marker in a rendered shot-timeline to open its detail sheet —
// call once after the timeline HTML has been inserted into the DOM.
export function bindShotTimeline(root, shots) {
  const byId = new Map(shots.map((s) => [s.shot_id, s]));
  qsa('.tm-cell', root).forEach((cell) => {
    cell.addEventListener('click', () => {
      const shot = byId.get(cell.dataset.shotId);
      if (shot) openShotDetailSheet(shot);
    });
  });
}

// ---------- Explore Session (Layer 2) ----------
// Four collapsible sections — Performance / Session Flow / Practice /
// Conditions — replacing the old single long scroll. Everything here is
// composition and selection only: every number still comes from the same
// stats.js calculators the previous layout used, and the section bodies
// reuse the same builders History Detail renders, so the two screens can't
// drift apart numerically.
//
// Availability is decided by the CALLER (see summary.js) rather than inside
// the shared builders, so a section that has nothing to say is simply
// omitted instead of rendering a "not enough shots yet" placeholder — and
// History Detail's use of those same builders is left untouched.

const EXPLORE_ICONS = {
  performance: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.4"/><path d="M12 1.8v3.2M12 19v3.2M1.8 12h3.2M19 12h3.2"/>',
  flow: '<path d="M4 16l6-6 4 4 7-8"/><path d="M14 6h7v7"/>',
  practice: '<path d="M6 21V4"/><path d="M6 4.5h11l-2.5 3.5L17 11.5H6"/>',
  conditions: '<path d="M7.5 17.5a4 4 0 0 1-.4-7.97 5 5 0 0 1 9.6-1.9 4.3 4.3 0 0 1-.2 9.87h-9Z"/>',
};

function exploreIcon(key) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${EXPLORE_ICONS[key] || EXPLORE_ICONS.performance}</svg>`;
}

// One accordion section. `body` is pre-rendered HTML; a section whose body
// is empty is never emitted at all by the caller, so there's no "expands to
// nothing" state to guard against here.
export function exploreSectionHtml({ id, index, icon, title, summary, body }) {
  return `
    <section class="xs-section" data-xs-section>
      <button class="xs-head" type="button" aria-expanded="false" aria-controls="${id}">
        <span class="xs-icon">${exploreIcon(icon)}</span>
        <span class="xs-head-text">
          <span class="xs-title">${index ? `${index}. ` : ''}${escapeHtml(title)}</span>
          <span class="xs-summary">${escapeHtml(summary)}</span>
        </span>
        <span class="xs-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </span>
      </button>
      <div class="xs-body" id="${id}" hidden>
        <div class="xs-body-inner">${body}</div>
      </div>
    </section>`;
}

// A compact label/value line — the Explore equivalent of a card, used for
// everything that would otherwise become its own bordered box.
export function xsRowHtml(label, value) {
  return `<div class="xs-row"><span>${escapeHtml(label)}</span><b>${value}</b></div>`;
}

export function xsSubTitleHtml(text) {
  return `<div class="xs-subtitle">${escapeHtml(text)}</div>`;
}

// Group breakdown (club / drill / training aid) rendered as compact lines
// rather than one card per group. Purely factual — a count and the same
// solid% used everywhere else, never a causal claim about the grouping.
export function xsGroupBreakdownHtml(rows) {
  if (!rows || !rows.length) return '';
  return `<div class="xs-groups">${rows.map((r) => `
    <div class="xs-group">
      <span class="xs-group-name">${escapeHtml(r.name)}</span>
      <span class="xs-group-count">${r.count} shot${r.count === 1 ? '' : 's'}</span>
      <span class="xs-group-value">${r.solidPct}% solid</span>
    </div>`).join('')}</div>`;
}

// ---------- Collapsed summary lines ----------
// Each returns the one short orientation line shown while a section is
// closed. Values are already computed; these only choose which of them to
// show and drop the parts that don't apply to this session.

function joinDots(parts) {
  return parts.filter(Boolean).join(' · ');
}

// Rounded to whole percent for the one-line summary — the same rounding the
// recap hero uses, and it keeps the three values on one line at phone width
// (76.7%/83.3% overflowed and truncated). The precise values are still shown
// in full inside the expanded Contact/Direction breakdowns.
export function performanceSummaryLine(s) {
  return joinDots([
    `${Math.round(s.strike.solid.pct)}% Solid`,
    `${Math.round(s.direction.straight.pct)}% Straight`,
    s.distance.medianSolid != null ? `${s.distance.medianSolid} yd Median` : null,
  ]);
}

// Picks the single most notable real pattern, in priority order, and falls
// back to a plain factual count rather than inventing a story when the
// session genuinely doesn't have one.
export function sessionFlowSummaryLine(s, fStrike, lStrike) {
  if (!s.firstLast.overlapping && s.firstLast.first10.length && s.firstLast.last10.length) {
    const diff = lStrike.solid.pct - fStrike.solid.pct;
    if (diff >= 10) return `Finished stronger · ${Math.round(lStrike.solid.pct)}% Solid in last 10`;
    if (diff <= -10) return `Faded late · ${Math.round(lStrike.solid.pct)}% Solid in last 10`;
  }
  if (s.bestWindow) return `Best stretch · Balls ${s.bestWindow.startBall}–${s.bestWindow.endBall}`;
  if (s.streaks.cleanContact.length >= 3) return `${s.streaks.cleanContact.length}-shot clean-contact streak`;
  if (s.streaks.solid.length >= 2) return `${s.streaks.solid.length}-shot solid streak`;
  return `${s.strike.solid.count} of ${s.total} solid`;
}

// Club / drill / training aid — each omitted when it has nothing to add, so
// an inactive Target or a session with no aid never prints "Off"/"None".
export function practiceSummaryLine(s, shots, session, trainingAidLabels) {
  const clubs = clubSummaryLabel(shots, session.default_club);
  const drills = s.drills.map((d) => d.drill);
  const drillLabel = drills.length === 1 ? drills[0] : drills.length > 1 ? 'Mixed drills' : null;
  const aids = s.trainingAids.filter((a) => a.training_aid !== 'none');
  const aidLabel = aids.length === 1 ? trainingAidLabels[aids[0].training_aid] : aids.length > 1 ? 'Multiple aids' : null;
  return joinDots([clubs, drillLabel, aidLabel]) || `${s.total} shot${s.total === 1 ? '' : 's'}`;
}

export function conditionsSummaryLine(session, locationPrimary) {
  return joinDots([
    locationPrimary,
    session.temperature_f != null ? `${session.temperature_f}°F` : null,
    session.fatigue_rating != null ? `Fatigue ${session.fatigue_rating}/5` : null,
  ]) || 'No conditions recorded';
}

// Wires the accordion: one section open at a time, all closed initially.
// Height is measured rather than guessed so the transition lands exactly on
// the content's real size; under prefers-reduced-motion the panels just
// toggle with no animation at all.
export function bindExploreAccordion(root) {
  const reduced = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  const sections = qsa('[data-xs-section]', root);

  // Runs `after` once the height transition finishes, with a timer fallback:
  // if the transition never actually starts (a zero-height change, or the
  // element having no previous computed height to animate from),
  // transitionend never fires and the panel would otherwise be left pinned
  // at a fixed inline height — which then clips it if its content grows
  // later, e.g. when the nested "More distance stats" toggle is opened.
  const TRANSITION_MS = 240;
  const onSettled = (body, after) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      body.removeEventListener('transitionend', onEnd);
      after();
    };
    const onEnd = (e) => { if (e.target === body && e.propertyName === 'height') finish(); };
    body.addEventListener('transitionend', onEnd);
    setTimeout(finish, TRANSITION_MS + 60);
  };

  const close = (section, animate) => {
    const head = qs('.xs-head', section);
    const body = qs('.xs-body', section);
    if (head.getAttribute('aria-expanded') !== 'true') return;
    head.setAttribute('aria-expanded', 'false');
    section.classList.remove('open');
    if (!animate) { body.hidden = true; body.style.height = ''; return; }
    body.style.height = `${body.scrollHeight}px`;
    void body.offsetHeight; // flush the starting height so the transition has something to animate from
    body.style.height = '0px';
    onSettled(body, () => { body.hidden = true; body.style.height = ''; });
  };

  const open = (section, animate) => {
    const head = qs('.xs-head', section);
    const body = qs('.xs-body', section);
    head.setAttribute('aria-expanded', 'true');
    section.classList.add('open');
    body.hidden = false;
    if (!animate) { body.style.height = ''; return; }
    body.style.height = '0px';
    void body.offsetHeight;
    body.style.height = `${body.scrollHeight}px`;
    // Cleared once settled so the panel goes back to auto height and can
    // grow with its own content afterwards.
    onSettled(body, () => { body.style.height = ''; });
  };

  sections.forEach((section) => {
    qs('.xs-head', section).addEventListener('click', () => {
      const isOpen = qs('.xs-head', section).getAttribute('aria-expanded') === 'true';
      sections.forEach((other) => { if (other !== section) close(other, !reduced); });
      if (isOpen) close(section, !reduced);
      else open(section, !reduced);
    });
  });
}
