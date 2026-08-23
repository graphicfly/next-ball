import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as stats from '../js/stats.js';
import { exploreSessionRowHtml, recapBestStretchHtml, shotTimelineHtml } from '../js/summarySections.js';

// Regression coverage for "Explore Session must always be reachable from the
// recap": the recap screen (js/screens/summary.js) isn't unit-testable
// directly (this project has no DOM shim / jsdom by design — zero-build,
// zero-dependency), so this mirrors its exact composition of the pure HTML
// helpers it calls, the same way it actually builds recapHtml, and asserts
// the explore row survives that composition at every shot count. A source
// check backs this up to guard against a future conditional being added
// around the call in summary.js itself.
function shot(ball, strike, direction = 'straight', distance_yards = 140) {
  return {
    shot_id: `shot-${ball}`,
    shot_number: ball,
    strike,
    direction: strike === 'miss' ? null : direction,
    height: strike === 'miss' ? null : 'medium',
    distance_yards: strike === 'miss' ? null : distance_yards,
  };
}

function fill(n, strike = 'solid') {
  return Array.from({ length: n }, (_, i) => shot(i + 1, strike));
}

// Mirrors summary.js's recapHtml composition exactly: shot-map only when
// shots.length, Best Stretch only when a bestWindow exists, Explore Session
// always last, unconditionally.
function recapBodyHtml(shots) {
  const bestWindow = stats.bestWindow(shots);
  return [
    shots.length ? shotTimelineHtml(shots, bestWindow) : '',
    recapBestStretchHtml(bestWindow),
    exploreSessionRowHtml(),
  ].join('');
}

describe('Explore Session row — always rendered, regardless of session data', () => {
  for (const n of [1, 3, 9, 10, 11, 20, 50, 60]) {
    test(`${n} shot${n === 1 ? '' : 's'}: Explore Session control is present`, () => {
      const html = recapBodyHtml(fill(n));
      assert.match(html, /id="viewDetailsBtn"/);
      assert.match(html, /Explore Session/);
    });
  }

  test('9 shots (Best Stretch unavailable, <10): Explore Session still renders', () => {
    const html = recapBodyHtml(fill(9));
    assert.equal(recapBestStretchHtml(stats.bestWindow(fill(9))), ''); // confirms Best Stretch really is absent here
    assert.match(html, /id="viewDetailsBtn"/);
  });

  test('0 shots: Explore Session still renders (only the shot-map/legend section is conditional)', () => {
    const html = recapBodyHtml([]);
    assert.match(html, /id="viewDetailsBtn"/);
  });

  test('Explore Session comes after Best Stretch when Best Stretch is present', () => {
    const html = recapBodyHtml(fill(10));
    const bestIdx = html.indexOf('Best Stretch');
    const exploreIdx = html.indexOf('id="viewDetailsBtn"');
    assert.ok(bestIdx >= 0 && exploreIdx > bestIdx);
  });
});

describe('Explore Session row — content and accessibility', () => {
  test('renders a semantic button with an explicit accessible label', () => {
    const html = exploreSessionRowHtml();
    assert.match(html, /<button class="explore-row" id="viewDetailsBtn" aria-label="Explore session details">/);
  });

  test('shows the primary label and supporting text', () => {
    const html = exploreSessionRowHtml();
    assert.match(html, /explore-row-title">Explore Session</);
    assert.match(html, /explore-row-sub">See detailed insights and shot data</);
  });

  test('chevron is decorative (aria-hidden) since the button already has its own label', () => {
    const html = exploreSessionRowHtml();
    assert.match(html, /explore-row-chevron" aria-hidden="true"/);
  });

  test('the whole row is one button element, not separate tappable icon/text/chevron controls', () => {
    const html = exploreSessionRowHtml();
    assert.equal((html.match(/<button/g) || []).length, 1);
  });
});

describe('summary.js source — guards against Explore Session becoming conditional again', () => {
  const src = readFileSync(new URL('../js/screens/summary.js', import.meta.url), 'utf8');

  test('exploreSessionRowHtml() is called unconditionally inside recapHtml, not gated behind a ternary', () => {
    const line = src.split('\n').find((l) => l.includes('exploreSessionRowHtml()'));
    assert.ok(line, 'exploreSessionRowHtml() must be called in summary.js');
    assert.doesNotMatch(line, /\?|&&/, 'must not be wrapped in a conditional/ternary');
  });

  test('Explore Session appears after Best Stretch and before the closing of recapHtml (i.e. before fullHtml)', () => {
    const bestIdx = src.indexOf('recapBestStretchHtml');
    const exploreIdx = src.indexOf('exploreSessionRowHtml()');
    const fullHtmlIdx = src.indexOf('const fullHtml');
    assert.ok(bestIdx > 0 && exploreIdx > bestIdx && exploreIdx < fullHtmlIdx);
  });

  test('Done stays outside the toggled recap/full views — always rendered, not gated by which view is active', () => {
    const scrollIdx = src.indexOf('class="scroll"');
    const doneIdx = src.indexOf('id="doneBtn"');
    // .scroll's closing </div> comes before the Done button in the template,
    // i.e. Done is a sibling after .scroll, not nested inside recapView/fullView.
    const scrollCloseIdx = src.indexOf('</div>\n\n      <button class="btn btn-primary" id="doneBtn"');
    assert.ok(scrollIdx > 0 && doneIdx > scrollIdx);
    assert.ok(scrollCloseIdx > 0, 'doneBtn must be a sibling immediately after .scroll closes, not nested inside it');
  });

  test('Back-to-recap returns to the recap in place (toggles visibility) rather than navigating to Home/History', () => {
    const backHandlerStart = src.indexOf("qs('#backToRecapBtn'");
    const backHandlerBlock = src.slice(backHandlerStart, backHandlerStart + 200);
    assert.match(backHandlerBlock, /recapEl\.hidden = false/);
    assert.doesNotMatch(backHandlerBlock, /location\.hash/);
  });

  test('renderSummary resolves the session strictly from the passed sessionId (db.getSession), never from active-session state', () => {
    assert.match(src, /db\.getSession\(sessionId\)/);
    assert.doesNotMatch(src, /getActiveSession/);
  });
});
