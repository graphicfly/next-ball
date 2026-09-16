import * as db from '../db.js';
import { qs, escapeHtml } from '../ui.js';
import { exploreSectionHtml, bindExploreAccordion, xsRowHtml, xsSubTitleHtml } from '../summarySections.js';
import {
  roundTotals, strokeBreakdown, strokeStory, holeStretches, shortGameHoles,
  puttingSummary, clubUsage, rangeCourseBridge, scoringComparison, puttingComparison,
  practiceFocus, formatToPar,
  MIN_HOLES_FOR_CLUB_SENTENCE, MIN_HOLES_FOR_STRETCH,
} from '../roundAnalysis.js';

// Explore Round — docs/course-mode-spec.md §9.
//
// Round Summary is the quick rewarding recap; this is the deeper analysis,
// exactly mirroring Session Summary → Your Groove. Nothing here moves onto
// the summary, and there is no Next Practice CTA — that action lives once,
// on Round Summary.
//
// It answers four questions and stops: where the strokes went, what worked,
// what should shape the next practice, and how this round compares with
// comparable previous ones. Everything it can say is bounded by §6's fields
// and the §9.7 wording rules — association is never causation, no claim is
// made below its sample threshold (§9.5), and a section with nothing valid
// to show is omitted rather than rendered empty.

export function renderRoundExplore(root, roundId) {
  const round = db.getRound(roundId);
  if (!round) { location.hash = '#/history'; return; }

  const holes = db.getHolesForRound(roundId);
  const totals = roundTotals(holes);
  const priors = priorRoundStats(round);
  const focus = practiceFocus(round, holes);

  const story = strokeStory(holes);
  const sections = [];

  const scoring = scoringSection(round, holes, totals, priors, focus);
  if (scoring) sections.push(scoring);
  const shortGame = shortGameSection(holes, totals, focus);
  if (shortGame) sections.push(shortGame);
  const putting = puttingSection(round, holes, priors, focus);
  if (putting) sections.push(putting);
  const clubs = clubUseSection(holes, focus);
  if (clubs) sections.push(clubs);
  const bridge = bridgeSection(holes);
  if (bridge) sections.push(bridge);

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; Round Summary</button>
        <span class="screen-title">Explore Round</span>
        <span class="side-space"></span>
      </div>

      <div class="scroll">
        <div class="round-identity">
          ${totals.strokes}
          ${totals.hasPar ? `<span class="sep">&middot;</span>${escapeHtml(formatToPar(totals.toPar))}` : ''}
          <span class="sep">&middot;</span>${totals.holesPlayed} hole${totals.holesPlayed === 1 ? '' : 's'}
          <span class="sep">&middot;</span>${escapeHtml(round.course_name)}
        </div>

        ${story ? `
          <div class="stroke-story">
            <div class="stroke-story-eyebrow">Where the strokes went</div>
            <div class="stroke-story-text">${escapeHtml(story.text)}</div>
          </div>` : ''}

        ${sections.map((s, i) => exploreSectionHtml({
          id: `xs-round-${i}`,
          index: i + 1,
          icon: s.icon,
          title: s.title,
          summary: s.summary,
          body: s.body,
        })).join('')}
      </div>
    </div>
  `;

  qs('#backBtn', root).addEventListener('click', () => { location.hash = `#/course/summary/${roundId}`; });

  // Scoring opens by default (§9.4) — a deliberate, screen-scoped deviation
  // from ux-spec.md §3.6, so the golfer who taps Explore Round sees analysis
  // rather than a list of closed drawers. Explore Session still opens with
  // everything collapsed; this passes the option the binder already accepts.
  bindExploreAccordion(root, { defaultOpenIndex: sections.length ? 0 : undefined });
}

// Prior finished rounds reduced to what comparisons need. Test rounds are
// excluded from every threshold and comparison (§9.5).
function priorRoundStats(round) {
  return db.listFinishedRounds()
    .filter((r) => r.round_id !== round.round_id && db.sessionDataSource(r) === 'real')
    .map((r) => {
      const t = roundTotals(db.getHolesForRound(r.round_id));
      return { course_id: r.course_id, holesPlayed: t.holesPlayed, toPar: t.toPar, putts: t.putts, hasPar: t.hasPar };
    })
    .filter((r) => r.hasPar && r.holesPlayed > 0);
}

// The one allowed sentence explaining the suggested focus (§9.6): once, at
// the end of the section that produced it. Never the rationale, the goal,
// the steps, or the start action.
function focusNote(focus, signal) {
  if (!focus || focus.signal !== signal) return '';
  const label = {
    putting: 'Putting',
    short_game: 'Your short game',
    full_swing: 'Ball striking',
    club: `The ${focus.club}`,
  }[signal];
  if (!label) return '';
  return `<div class="xs-note">${escapeHtml(label)} is your suggested focus for next time.</div>`;
}

// A comparison pill (ux-spec.md §3.5): improved reads accent, flat or worse
// reads neutral. Never red — a worse round is not an error.
function comparisonPill(comparison) {
  if (!comparison) return '';
  return `<div class="compare-pill ${comparison.improved ? 'improved' : ''}">${escapeHtml(comparison.label)}</div>`;
}

function scoringSection(round, holes, totals, priors, focus) {
  if (!holes.length) return null;

  const stretches = holeStretches(holes);
  const comparison = scoringComparison(round, holes, priors);

  const summaryParts = [];
  if (totals.hasPar) summaryParts.push(formatToPar(totals.toPar));
  if (stretches?.best) summaryParts.push(`best stretch ${stretches.best.from}–${stretches.best.to}`);

  const body = `
    ${totals.hasPar ? xsRowHtml('Score to par', formatToPar(totals.toPar)) : ''}
    ${xsRowHtml('Strokes', String(totals.strokes))}
    ${xsRowHtml('Holes played', String(totals.holesPlayed))}
    ${comparisonPill(comparison)}

    ${xsSubTitleHtml('Hole by hole')}
    <div class="score-strip">${holes.map((h) => scoreCellHtml(h)).join('')}</div>

    ${stretches ? `
      ${xsSubTitleHtml('Stretches')}
      ${stretches.best ? xsRowHtml(`Best 3 holes (${stretches.best.from}–${stretches.best.to})`, formatToPar(stretches.best.toPar)) : ''}
      ${stretches.worst ? xsRowHtml(`Toughest 3 holes (${stretches.worst.from}–${stretches.worst.to})`, formatToPar(stretches.worst.toPar)) : ''}
    ` : ''}
    ${focusNote(focus, 'full_swing')}
  `;

  return { icon: 'performance', title: 'Scoring', summary: summaryParts.join(' · ') || `${totals.strokes} strokes`, body };
}

function shortGameSection(holes, totals, focus) {
  // Zero greenside strokes is not a finding (§9.3).
  if (totals.shortGame === 0) return null;

  const ranked = shortGameHoles(holes);
  const perHole = Math.round((totals.shortGame / totals.holesPlayed) * 10) / 10;

  const body = `
    ${xsRowHtml('Greenside strokes', String(totals.shortGame))}
    ${xsRowHtml('Holes involved', `${ranked.length} of ${totals.holesPlayed}`)}
    ${xsRowHtml('Average per hole', String(perHole))}

    ${xsSubTitleHtml('Where they landed')}
    ${ranked.slice(0, 5).map((h) => xsRowHtml(
      `Hole ${h.hole_number}${h.par != null ? ` (par ${h.par})` : ''}`,
      `${h.short_game_strokes} stroke${h.short_game_strokes === 1 ? '' : 's'}`,
    )).join('')}
    ${focusNote(focus, 'short_game')}
  `;

  return {
    icon: 'practice',
    title: 'Short Game',
    summary: `${totals.shortGame} stroke${totals.shortGame === 1 ? '' : 's'} on ${ranked.length} hole${ranked.length === 1 ? '' : 's'}`,
    body,
  };
}

function puttingSection(round, holes, priors, focus) {
  if (!holes.length) return null;
  const p = puttingSummary(holes);
  const comparison = puttingComparison(round, holes, priors);

  const summary = p.hasThreePutts
    ? `${p.total} putts · ${p.threePutts.length} three-putt${p.threePutts.length === 1 ? '' : 's'}`
    : `${p.total} putts · ${p.perHole} per hole`;

  const body = `
    ${xsRowHtml('Total putts', String(p.total))}
    ${xsRowHtml('Putts per hole', String(p.perHole))}
    ${comparisonPill(comparison)}

    ${p.hasThreePutts ? `
      ${xsSubTitleHtml('Three-putt holes')}
      ${p.threePutts.map((h) => xsRowHtml(`Hole ${h.hole_number}`, `${h.putts} putts`)).join('')}
    ` : ''}
    ${focusNote(focus, 'putting')}
  `;

  return { icon: 'performance', title: 'Putting', summary, body };
}

function clubUseSection(holes, focus) {
  const usage = clubUsage(holes);
  if (!usage.length) return null;

  // A row is a recorded fact and needs 2 holes; a sentence is a claim and
  // needs 3 (§9.5). Below 2 the club is not shown at all.
  const rows = usage.filter((c) => c.holeCount >= 2);
  if (!rows.length) return null;

  // Wording per §9.7: "appeared on", with the sample stated, and never a
  // ranking by quality — the data supports association, not causation.
  const claimable = rows.filter((c) => c.holeCount >= MIN_HOLES_FOR_CLUB_SENTENCE && c.avgToPar != null);
  const headline = claimable.length
    ? (() => {
      const top = [...claimable].sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0))[0];
      return `<div class="xs-note">${escapeHtml(top.club)} appeared on ${top.holeCount} holes, which averaged ${escapeHtml(formatToPar(Math.round(top.avgToPar * 10) / 10))}.</div>`;
    })()
    : '';

  const body = `
    ${xsSubTitleHtml('Clubs recorded')}
    ${rows.map((c) => xsRowHtml(
      c.club,
      c.avgToPar != null
        ? `${c.holeCount} holes · avg ${formatToPar(Math.round(c.avgToPar * 10) / 10)}`
        : `${c.holeCount} holes`,
    )).join('')}
    ${headline}
    ${focusNote(focus, 'club')}
  `;

  const top = rows[0];
  return {
    icon: 'practice',
    title: 'Club Use',
    summary: `${usage.length} club${usage.length === 1 ? '' : 's'} · ${top.club} on ${top.holeCount} holes`,
    body,
  };
}

// The one section that reaches outside the round. It states two independent
// facts side by side — range reliability and course appearance — joined by
// "and", never by "so" or "because" (§9.7). When no club clears both
// thresholds the whole section is omitted, which is the common case and is
// correct.
function bridgeSection(holes) {
  const realSessions = db.listFinishedSessions().filter((s) => db.sessionDataSource(s) === 'real');
  const pairs = rangeCourseBridge(holes, realSessions, (id) => db.getShotsForSession(id));
  if (!pairs.length) return null;

  const body = pairs.map((p) => `
    <div class="xs-note">${escapeHtml(p.club)} has been one of your more reliable range clubs
    (${p.solidPct}% solid over ${p.rangeShots} shots) and appeared on ${p.holeCount}
    hole${p.holeCount === 1 ? '' : 's'} this round${p.avgToPar != null ? `, which averaged ${escapeHtml(formatToPar(Math.round(p.avgToPar * 10) / 10))}` : ''}.</div>
  `).join('');

  return {
    icon: 'flow',
    title: 'Range → Course',
    summary: pairs.map((p) => p.club).join(', '),
    body,
  };
}

// Same encoding as the Round Summary strip, so the same shape means the same
// thing on both screens (§9.3).
function scoreCellHtml(hole) {
  const overPar = hole.par != null && hole.strokes > hole.par;
  const tone = hole.par == null ? 'neutral' : overPar ? 'over' : 'under';
  const relative = hole.par == null
    ? ''
    : hole.strokes === hole.par
      ? ', level par'
      : `, ${Math.abs(hole.strokes - hole.par)} ${overPar ? 'over' : 'under'} par`;
  return `
    <div class="score-cell" aria-label="Hole ${hole.hole_number}, ${hole.strokes} strokes${relative}">
      <span class="score-cell-num">${hole.hole_number}</span>
      <span class="score-cell-ring ${tone}">${hole.strokes}</span>
    </div>`;
}
