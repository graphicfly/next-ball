// Your Groove — docs/ux-spec.md §4.7, Reference C. Session-level only ("why/
// how did THIS session unfold?"), reached only from Explore Session; never a
// nav tab (Trends owns "across many sessions"), never repeats Session
// Summary's Next Goal card. Composes the Groove Score dial with builders
// that already exist elsewhere, plus the one genuinely new metric
// (contactTrendHtml) — see summarySections.js for why each piece is shared
// rather than duplicated.
import * as db from '../db.js';
import { qs, directionBarHtml } from '../ui.js';
import { sessionSummary, grooveScore } from '../stats.js';
import {
  grooveDialHtml, grooveBuildingStateHtml, comparisonPillHtml, grooveFactorRowHtml,
  contactTrendHtml, blocksFlowHtml, xsSubTitleHtml, xsGroupBreakdownHtml,
  exploreSectionHtml, bindExploreAccordion,
  contactTrendSummaryLine, directionFanSummaryLine, practiceBlocksSummaryLine, clubAidCompareSummaryLine,
} from '../summarySections.js';
import { getGrooveReturn } from '../state.js';

// Groove Score's own comparison is against the previous session
// chronologically, not a club-matched "comparable" session — the spec
// calls it plainly "the previous session" (§4.7), a simpler relationship
// than Session Summary's club/setup/swing-matched comparison. Omitted
// entirely (§1.4) when there's no prior finished session, or the prior one
// also has no numeric score.
function previousGrooveDiff(session, currentScore) {
  if (currentScore == null) return null;
  const prior = db.listFinishedSessions().find((s) => s.session_id !== session.session_id && (s.created_at || '') < (session.created_at || ''));
  if (!prior) return null;
  const priorScore = grooveScore(db.getShotsForSession(prior.session_id)).score;
  if (priorScore == null) return null;
  return currentScore - priorScore;
}

export function renderYourGroove(root, sessionId) {
  const session = db.getSession(sessionId);
  if (!session) { location.hash = '#/history'; return; }
  const shots = db.getShotsForSession(sessionId);
  const s = sessionSummary(shots);
  const groove = grooveScore(shots);
  const diff = previousGrooveDiff(session, groove.score);

  const activeAids = s.trainingAids.filter((a) => a.training_aid !== 'none');

  // The hero states plainly what feeds the number (§ "keep the hero
  // uncluttered") — never a second interpretive line here. A "What stood
  // out" blurb is deliberately not implemented: docs/ux-spec.md §6.3 defers
  // it to a later release with its own constraints (descriptive only, never
  // causal, never a CTA), and this pass doesn't introduce new copy tiers.
  const heroHtml = groove.score == null
    ? grooveBuildingStateHtml(groove.shotsUntilAvailable)
    : `
      ${grooveDialHtml(groove.score)}
      <div class="groove-score-qualifier tiny muted" style="text-align:center;">This session.</div>
      ${comparisonPillHtml(diff)}
    `;

  const factorsHtml = groove.components.length ? `
    <div class="section-title">Contributing Factors</div>
    <div class="card" style="margin-bottom:var(--space-5);">
      ${groove.components.map(grooveFactorRowHtml).join('')}
    </div>` : '';

  // Four accordion sections, same shell/behavior as Explore Session
  // (exploreSectionHtml/bindExploreAccordion) — Solid Contact Trend opens
  // by default (bindExploreAccordion's defaultOpenIndex below); the other
  // three start collapsed, and only one stays open at a time.
  const sections = [
    {
      id: 'ygContact', index: 1, icon: 'performance', title: 'Solid Contact Trend',
      summary: contactTrendSummaryLine(s), body: contactTrendHtml(shots),
    },
    {
      id: 'ygDirection', index: 2, icon: 'direction', title: 'Direction Fan',
      summary: directionFanSummaryLine(s), body: directionBarHtml(s.direction),
    },
    {
      id: 'ygBlocks', index: 3, icon: 'practice', title: 'Practice Blocks',
      summary: practiceBlocksSummaryLine(s.blocks), body: s.blocks.length > 1 ? blocksFlowHtml(s.blocks) : '',
    },
    {
      id: 'ygCompare', index: 4, icon: 'compare', title: 'Club + Training Aid Compare',
      summary: clubAidCompareSummaryLine(s.clubs, activeAids),
      // Purely factual rows (count + solid%), never a causal claim about
      // the club or aid — same non-causal wording rule as Explore Session's
      // own Practice section. Only rendered when there's an actual
      // comparison to make (2+ clubs, or a training aid was used at all).
      body: (s.clubs.length > 1 || activeAids.length) ? `
        ${s.clubs.length > 1 ? `${xsSubTitleHtml('Clubs')}${xsGroupBreakdownHtml(s.clubs.map((c) => ({ name: c.club, count: c.count, solidPct: c.solidPct })))}` : ''}
        ${activeAids.length ? `${xsSubTitleHtml('Training Aid')}${xsGroupBreakdownHtml(s.trainingAids.map((a) => ({ name: db.TRAINING_AID_LABELS[a.training_aid], count: a.count, solidPct: a.solidPct })))}` : ''}
      ` : '',
    },
  ].filter((sec) => sec.body.trim());

  const sectionsHtml = sections.map(exploreSectionHtml).join('');

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; Explore Session</button>
        <span class="screen-title">Your Groove</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">
        <div class="session-complete-eyebrow" style="text-align:center;">Your Groove</div>
        ${heroHtml}
        <div class="tiny muted" style="text-align:center; margin:0 0 var(--space-5);">Built from contact, direction, and consistency.</div>

        ${factorsHtml}

        ${sectionsHtml}

        <button class="tertiary-link" id="backToSummaryBtn" style="display:block; margin:var(--space-5) auto 0;">Back to Session Summary</button>
      </div>
    </div>
  `;

  bindExploreAccordion(root, { defaultOpenIndex: 0 });

  qs('#backBtn', root).addEventListener('click', () => { location.hash = getGrooveReturn(); });
  qs('#backToSummaryBtn', root).addEventListener('click', () => { location.hash = `#/summary/${sessionId}`; });
}
