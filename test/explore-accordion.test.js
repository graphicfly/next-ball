import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as stats from '../js/stats.js';
import {
  exploreSectionHtml, performanceSummaryLine, sessionFlowSummaryLine,
  practiceSummaryLine, conditionsSummaryLine, xsGroupBreakdownHtml,
  conditionsGroupHtml,
} from '../js/summarySections.js';

const TRAINING_AID_LABELS = {
  none: 'None', connection_ball: 'Connection Ball', alignment_stick: 'Alignment Stick',
  divot_board: 'Divot Board', other: 'Other',
};

function shot(ball, strike, over = {}) {
  return {
    shot_id: `s-${ball}`, shot_number: ball, strike,
    direction: strike === 'miss' ? null : 'straight',
    height: strike === 'miss' ? null : 'medium',
    distance_yards: strike === 'miss' ? null : 140,
    club: '7i', drill: 'Normal Swing', training_aid: 'none',
    setup: 'ground', surface: 'mat', swing_length: 'full',
    target_distance_yards: null,
    ...over,
  };
}
const fill = (n, strike = 'solid', over = {}) => Array.from({ length: n }, (_, i) => shot(i + 1, strike, over));

describe('Section 3 — every section starts collapsed', () => {
  test('a rendered section is closed, with matching aria state', () => {
    const html = exploreSectionHtml({ id: 'x', index: 1, icon: 'performance', title: 'Performance', summary: 'a · b', body: '<p>x</p>' });
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /<div class="xs-body" id="x" hidden>/);
  });

  test('the header exposes the panel it controls, for assistive tech', () => {
    const html = exploreSectionHtml({ id: 'xsFlow', index: 2, icon: 'flow', title: 'Session Flow', summary: 's', body: 'b' });
    assert.match(html, /aria-controls="xsFlow"/);
    assert.match(html, /id="xsFlow"/);
  });
});

describe('Section 5 — Performance collapsed summary', () => {
  test('shows solid / straight / median, rounded to whole percent', () => {
    const shots = [...fill(23), ...fill(7, 'thin').map((s, i) => shot(24 + i, 'thin'))];
    const s = stats.sessionSummary(shots);
    const line = performanceSummaryLine(s);
    assert.match(line, /^\d+% Solid · \d+% Straight · \d+ yd Median$/, `got: ${line}`);
    assert.doesNotMatch(line, /\.\d/, 'no decimals — they overflowed the one-line summary');
  });

  test('median is dropped rather than shown as a dash when there is no solid distance', () => {
    const s = stats.sessionSummary(fill(5, 'miss'));
    const line = performanceSummaryLine(s);
    assert.doesNotMatch(line, /Median/);
    assert.doesNotMatch(line, /—/);
  });
});

describe('Section 8 — Session Flow summary reports a real pattern, never a fabricated one', () => {
  test('a 30-shot session that improved reports the finish', () => {
    const shots = [
      ...Array.from({ length: 10 }, (_, i) => shot(i + 1, i < 5 ? 'solid' : 'thin')),
      ...Array.from({ length: 10 }, (_, i) => shot(i + 11, 'solid')),
      ...Array.from({ length: 10 }, (_, i) => shot(i + 21, 'solid')),
    ];
    const s = stats.sessionSummary(shots);
    const f = stats.strikeBreakdown(s.firstLast.first10);
    const l = stats.strikeBreakdown(s.firstLast.last10);
    assert.match(sessionFlowSummaryLine(s, f, l), /Finished stronger · \d+% Solid in last 10/);
  });

  test('with no standout pattern it states a plain fact instead of inventing one', () => {
    const shots = [shot(1, 'solid'), shot(2, 'thin')];
    const s = stats.sessionSummary(shots);
    const f = stats.strikeBreakdown(s.firstLast.first10);
    const l = stats.strikeBreakdown(s.firstLast.last10);
    const line = sessionFlowSummaryLine(s, f, l);
    assert.equal(line, '1 of 2 solid');
    assert.doesNotMatch(line, /stronger|Best stretch/);
  });
});

describe('Section 12 — Practice summary omits inactive Target and Training Aid', () => {
  const session = { default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' };

  test('no training aid used: the aid is not mentioned at all', () => {
    const shots = fill(10);
    const s = stats.sessionSummary(shots);
    const line = practiceSummaryLine(s, shots, session, TRAINING_AID_LABELS);
    assert.equal(line, '7i · Normal Swing');
    assert.doesNotMatch(line, /None|Off/);
  });

  test('an aid actually used is named', () => {
    const shots = [...fill(5), ...Array.from({ length: 5 }, (_, i) => shot(i + 6, 'solid', { training_aid: 'connection_ball' }))];
    const s = stats.sessionSummary(shots);
    assert.match(practiceSummaryLine(s, shots, session, TRAINING_AID_LABELS), /Connection Ball/);
  });

  test('a mid-session club change surfaces both clubs, not just the last one', () => {
    const shots = [...fill(10), ...Array.from({ length: 5 }, (_, i) => shot(i + 11, 'solid', { club: 'PW' }))];
    const s = stats.sessionSummary(shots);
    assert.match(practiceSummaryLine(s, shots, session, TRAINING_AID_LABELS), /7i \+ PW/);
  });
});

describe('Section 14 — Practice uses shot-level values, never the session\'s final state', () => {
  test('clubBreakdown reports each club with its own real shot count', () => {
    const shots = [...fill(10), ...Array.from({ length: 5 }, (_, i) => shot(i + 11, 'solid', { club: 'PW' }))];
    const rows = stats.clubBreakdown(shots);
    assert.deepEqual(rows.map((r) => [r.club, r.count]), [['7i', 10], ['PW', 5]]);
  });

  test('breakdown rows render as counts and solid%, with no causal wording', () => {
    const html = xsGroupBreakdownHtml([{ name: 'Connection Ball', count: 8, solidPct: 75 }]);
    assert.match(html, /Connection Ball/);
    assert.match(html, /8 shots/);
    assert.match(html, /75% solid/);
    assert.doesNotMatch(html, /improve|better|because|helped/i);
  });

  test('a single shot is described in the singular', () => {
    assert.match(xsGroupBreakdownHtml([{ name: '7i', count: 1, solidPct: 100 }]), /1 shot</);
  });
});

describe('Section 16 — Conditions summary degrades gracefully', () => {
  test('everything present', () => {
    const line = conditionsSummaryLine({ temperature_f: 72, fatigue_rating: 2 }, 'Reston National');
    assert.equal(line, 'Reston National · 72°F · Fatigue 2/5');
  });

  test('no weather: venue and fatigue only', () => {
    assert.equal(conditionsSummaryLine({ fatigue_rating: 2 }, 'Reston National'), 'Reston National · Fatigue 2/5');
  });

  test('no location: fatigue only', () => {
    assert.equal(conditionsSummaryLine({ fatigue_rating: 2 }, null), 'Fatigue 2/5');
  });

  test('nothing recorded: a quiet factual line, not a "weather unavailable" warning', () => {
    const line = conditionsSummaryLine({}, null);
    assert.equal(line, 'No conditions recorded');
    assert.doesNotMatch(line, /unavailable/i);
  });
});

describe('Conditions body heading is suppressed inside the accordion only', () => {
  const session = { fatigue_rating: 2 };
  const timing = { totalDurationSeconds: null };

  test('History Detail keeps its own heading (default unchanged)', () => {
    assert.match(conditionsGroupHtml(session, timing, ''), /class="section-title">Conditions</);
  });

  test('Explore Session omits it, since the accordion header already says Conditions', () => {
    assert.doesNotMatch(conditionsGroupHtml(session, timing, '', { heading: false }), /class="section-title">Conditions</);
  });
});

describe('Section 10/11 — unavailable analytics are omitted, not shown as placeholders', () => {
  const src = readFileSync(new URL('../js/screens/summary.js', import.meta.url), 'utf8');

  test('Best 10 is gated on a real window existing', () => {
    assert.match(src, /s\.bestWindow \? bestWindowSectionHtml/);
  });

  test('First 10 vs Last 10 is gated on a non-overlapping window', () => {
    assert.match(src, /hasFirstLast \? firstLastCompactHtml/);
    assert.match(src, /const hasFirstLast = !s\.firstLast\.overlapping/);
  });

  test('Streaks are gated on at least one real streak', () => {
    assert.match(src, /hasStreaks \? streaksSectionHtml/);
  });

  test('a 7-shot session produces no Best 10 and no First-vs-Last placeholder text', () => {
    const shots = fill(7);
    const s = stats.sessionSummary(shots);
    assert.equal(s.bestWindow, null, 'under 10 shots there is no window at all');
    assert.equal(s.firstLast.overlapping, true, 'under 20 shots first/last overlap');
  });
});

describe('Section 4 — accordion keeps one section open at a time', () => {
  const src = readFileSync(new URL('../js/summarySections.js', import.meta.url), 'utf8');

  test('opening a section closes every other one', () => {
    const block = src.slice(src.indexOf('sections.forEach((section) => {'));
    assert.match(block, /sections\.forEach\(\(other\) => \{ if \(other !== section\) close\(other/);
  });

  test('animation is skipped entirely under prefers-reduced-motion', () => {
    assert.match(src, /prefers-reduced-motion: reduce/);
    assert.match(src, /close\(other, !reduced\)/);
  });

  test('an opened panel returns to auto height so later content growth is not clipped', () => {
    assert.match(src, /onSettled\(body, \(\) => \{ body\.style\.height = ''; \}\)/);
    const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
    assert.match(css, /\.xs-section\.open \.xs-body \{ height: auto; \}/);
  });
});
