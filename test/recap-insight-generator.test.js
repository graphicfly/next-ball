import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecapInsight } from '../js/sessionStory.js';

// Coverage for the recap insight generator's new priority chain: personal
// best > comparison improvement (10+ shots only) > fewer tops/fats >
// strong finish > consistency > target accuracy > streak > drill/aid
// contrast > short-session factual composition > nothing. No Best Stretch
// tier — recapBestStretchHtml() already renders that window unconditionally
// elsewhere on the recap, so an insight-card copy would always duplicate it.

function strikeShape(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const out = {};
  for (const k of ['solid', 'thin', 'topped', 'fat', 'shank', 'miss']) {
    const count = counts[k] || 0;
    out[k] = { count, pct: pct(count) };
  }
  return out;
}

function baseSummary(overrides) {
  return {
    total: 10,
    strike: strikeShape({ solid: 10 }),
    bestWindow: null,
    firstLast: { overlapping: true, first10: [], last10: [] },
    streaks: { cleanContact: { length: 0 }, solid: { length: 0 } },
    trainingAids: [],
    drills: [],
    ...overrides,
  };
}

function shotList(strikes, drillOf = () => null, aidOf = () => 'none') {
  return strikes.map((strike, i) => ({
    shot_id: `s${i + 1}`,
    shot_number: i + 1,
    strike,
    drill: drillOf(i),
    training_aid: aidOf(i),
  }));
}

describe('Personal Best — highest priority', () => {
  test('a legitimate PB wins over every other tier', () => {
    const s = baseSummary({ bestWindow: { solidPct: 95, startBall: 1, endBall: 10 } });
    const comparison = { metricsCompare: { solid: { diff: 50 }, topped: { diff: -50 }, fat: { diff: 0 }, solidDistanceCV: { diff: 0 } }, match: { session: { default_club: '7i' } }, targetAccuracyCompare: [] };
    const bests = [{ type: 'solidPct', label: 'Best Solid %', value: 95 }];
    const insight = buildRecapInsight(s, comparison, bests, { default_club: '7i' });
    assert.equal(insight.headline, 'Personal Best');
  });
});

describe('Contact improvement (comparison-based)', () => {
  test('an 8+ pt solid improvement on a 10+ shot session is reported', () => {
    const s = baseSummary();
    const comparison = { metricsCompare: { solid: { diff: 12 }, topped: { diff: 0 }, fat: { diff: 0 }, solidDistanceCV: { diff: 0 } }, match: { session: { default_club: '7i' } }, targetAccuracyCompare: [] };
    const insight = buildRecapInsight(s, comparison, [], {});
    assert.equal(insight.headline, 'Contact Improved');
    assert.equal(insight.sub, '+12 pts vs your previous 7i session');
  });

  test('an insignificant 1 pt change reports no insight (CASE C)', () => {
    const s = baseSummary();
    const comparison = { metricsCompare: { solid: { diff: -1 }, topped: { diff: 0 }, fat: { diff: 0 }, solidDistanceCV: { diff: 0 } }, match: { session: { default_club: '7i' } }, targetAccuracyCompare: [] };
    const insight = buildRecapInsight(s, comparison, [], {});
    assert.equal(insight, null);
  });
});

describe('Fewer tops/fats (poor-contact reduction)', () => {
  test('an 8+ pt drop in topped rate is reported (CASE D shape)', () => {
    const s = baseSummary();
    const comparison = { metricsCompare: { solid: { diff: 0 }, topped: { diff: -18 }, fat: { diff: 0 }, solidDistanceCV: { diff: 0 } }, match: { session: { default_club: '7i' } }, targetAccuracyCompare: [] };
    const insight = buildRecapInsight(s, comparison, [], {});
    assert.equal(insight.headline, 'Fewer Tops');
    assert.equal(insight.sub, '-18 pts vs your previous 7i session');
  });

  test('a comparable fat-rate drop is reported as Fewer Fat Shots', () => {
    const s = baseSummary();
    const comparison = { metricsCompare: { solid: { diff: 0 }, topped: { diff: 0 }, fat: { diff: -20 }, solidDistanceCV: { diff: 0 } }, match: { session: { default_club: '7i' } }, targetAccuracyCompare: [] };
    const insight = buildRecapInsight(s, comparison, [], {});
    assert.equal(insight.headline, 'Fewer Fat Shots');
  });
});

describe('Strong finish', () => {
  test('a clear last-10-vs-first-10 solid improvement on a non-overlapping (20+) session is reported (CASE E)', () => {
    const s = baseSummary({
      total: 50,
      firstLast: {
        overlapping: false,
        first10: shotList(['topped', 'topped', 'solid', 'topped', 'topped', 'topped', 'topped', 'topped', 'solid', 'topped']), // 2 solid
        last10: shotList(['solid', 'solid', 'solid', 'solid', 'solid', 'solid', 'solid', 'topped', 'topped', 'topped']), // 7 solid
      },
    });
    const insight = buildRecapInsight(s, null, [], {});
    assert.equal(insight.headline, 'Strong Finish');
    assert.equal(insight.sub, '7 of your last 10 shots were solid');
  });

  test('overlapping first/last windows (under 20 shots) never trigger Strong Finish', () => {
    const s = baseSummary({
      total: 15,
      firstLast: { overlapping: true, first10: shotList(Array(10).fill('topped')), last10: shotList(Array(10).fill('solid')) },
    });
    const insight = buildRecapInsight(s, null, [], {});
    assert.notEqual(insight?.headline, 'Strong Finish');
  });
});

describe('Consistency improvement', () => {
  test('a meaningful CV decrease vs a comparable session is reported', () => {
    const s = baseSummary();
    const comparison = { metricsCompare: { solid: { diff: 0 }, topped: { diff: 0 }, fat: { diff: 0 }, solidDistanceCV: { diff: -5 } }, match: { session: { default_club: '7i' } }, targetAccuracyCompare: [] };
    const insight = buildRecapInsight(s, comparison, [], {});
    assert.equal(insight.headline, 'Consistency Improved');
  });
});

describe('Target accuracy', () => {
  test('a meaningful median-error improvement at a used target is reported', () => {
    const s = baseSummary();
    const comparison = { metricsCompare: { solid: { diff: 0 }, topped: { diff: 0 }, fat: { diff: 0 }, solidDistanceCV: { diff: 0 } }, match: { session: { default_club: '7i' } }, targetAccuracyCompare: [{ improvementYards: 8, target: 150 }] };
    const insight = buildRecapInsight(s, comparison, [], {});
    assert.equal(insight.headline, 'Target Accuracy Improved');
    assert.equal(insight.sub, '8 yd closer at 150 yd');
  });

  test('no target data at all (target mode not used) never triggers a target insight', () => {
    const s = baseSummary();
    const comparison = { metricsCompare: { solid: { diff: 0 }, topped: { diff: 0 }, fat: { diff: 0 }, solidDistanceCV: { diff: 0 } }, match: { session: { default_club: '7i' } }, targetAccuracyCompare: [] };
    const insight = buildRecapInsight(s, comparison, [], {});
    assert.equal(insight, null);
  });
});

describe('Streaks', () => {
  test('a clean-contact streak of 6+ is reported', () => {
    const s = baseSummary({ streaks: { cleanContact: { length: 7 }, solid: { length: 0 } } });
    const insight = buildRecapInsight(s, null, [], {});
    assert.equal(insight.headline, 'Clean Contact Streak');
  });

  test('a solid streak of 4+ is reported when clean-contact does not qualify', () => {
    const s = baseSummary({ streaks: { cleanContact: { length: 2 }, solid: { length: 5 } } });
    const insight = buildRecapInsight(s, null, [], {});
    assert.equal(insight.headline, 'Solid Streak');
  });
});

describe('Training aid / drill contrast', () => {
  test('a meaningful solid% gap between an aid group and none is reported factually, without implying causation', () => {
    const shots = shotList(
      [...Array(6).fill('solid'), ...Array(2).fill('topped'), ...Array(2).fill('solid'), ...Array(6).fill('topped')],
      () => null,
      (i) => (i < 8 ? 'connection_ball' : 'none'),
    );
    const s = baseSummary({
      total: 16,
      trainingAids: [
        { training_aid: 'connection_ball', count: 8, solidPct: 75 },
        { training_aid: 'none', count: 8, solidPct: 25 },
      ],
    });
    const insight = buildRecapInsight(s, null, [], {}, shots);
    assert.equal(insight.headline, 'Connection Ball');
    assert.equal(insight.sub, 'Solid contact was 75% with the Connection Ball vs 25% without it.');
    assert.doesNotMatch(insight.sub, /improved your|caused|because of/i);
  });

  test('too small a sample on either side does not surface a training-aid insight', () => {
    const shots = shotList([...Array(2).fill('solid'), ...Array(8).fill('topped')], () => null, (i) => (i < 2 ? 'connection_ball' : 'none'));
    const s = baseSummary({
      total: 10,
      trainingAids: [
        { training_aid: 'connection_ball', count: 2, solidPct: 100 },
        { training_aid: 'none', count: 8, solidPct: 0 },
      ],
    });
    const insight = buildRecapInsight(s, null, [], {}, shots);
    assert.notEqual(insight?.headline, 'Connection Ball');
  });

  test('a meaningful drill vs rest-of-session solid% gap is reported', () => {
    const shots = shotList(
      [...Array(6).fill('solid'), ...Array(2).fill('topped'), ...Array(2).fill('solid'), ...Array(6).fill('topped')],
      (i) => (i < 8 ? 'Low Point' : 'Normal Swing'),
    );
    const s = baseSummary({
      total: 16,
      drills: [
        { drill: 'Low Point', count: 8, solidPct: 75 },
        { drill: 'Normal Swing', count: 8, solidPct: 25 },
      ],
    });
    const insight = buildRecapInsight(s, null, [], {}, shots);
    assert.equal(insight.headline, 'Low Point');
    assert.match(insight.sub, /75%.*Low Point.*25%/);
  });

  test('a single drill for the whole session has no rest-of-session baseline to contrast against', () => {
    const shots = shotList(Array(10).fill('solid'), () => 'Low Point');
    const s = baseSummary({ total: 10, drills: [{ drill: 'Low Point', count: 10, solidPct: 100 }] });
    const insight = buildRecapInsight(s, null, [], {}, shots);
    assert.notEqual(insight?.headline, 'Low Point');
  });
});

describe('Short-session factual composition (CASE A)', () => {
  test('2 of 3 solid, 1 thin: additive counts, not a repeat of the hero %', () => {
    const shots = shotList(['solid', 'solid', 'thin']);
    const s = baseSummary({ total: 3, strike: strikeShape({ solid: 2, thin: 1 }) });
    const insight = buildRecapInsight(s, null, [], {}, shots);
    assert.equal(insight.headline, '2 of 3 Solid');
    assert.equal(insight.sub, 'One Thin strike.');
    assert.doesNotMatch(insight.headline + insight.sub, /67%|66\.7%/);
  });

  test('old redundant fallback wording never appears (regression guard)', () => {
    const shots = shotList(['solid', 'solid', 'thin']);
    const s = baseSummary({ total: 3, strike: strikeShape({ solid: 2, thin: 1 }) });
    const insight = buildRecapInsight(s, null, [], {}, shots);
    const text = insight ? `${insight.headline} ${insight.sub}` : '';
    assert.doesNotMatch(text, /solid session/i);
    assert.doesNotMatch(text, /solid contact this session/i);
  });
});

describe('No comparable prior session', () => {
  test('comparison === null skips every comparison-based tier without throwing', () => {
    const s = baseSummary({ total: 20 });
    assert.doesNotThrow(() => buildRecapInsight(s, null, [], {}));
  });
});

describe('No meaningful insight anywhere (CASE G)', () => {
  test('a long session with nothing notable renders no card', () => {
    const s = baseSummary({ total: 30, strike: strikeShape({ solid: 15, topped: 15 }) });
    const insight = buildRecapInsight(s, null, [], {});
    assert.equal(insight, null);
  });
});

describe('Duplicate hero-metric prevention', () => {
  test('the fallback headline/sub never restates just the raw Solid %, Straight %, or Median Solid distance already on the hero', () => {
    for (const total of [3, 5, 9]) {
      const s = baseSummary({ total, strike: strikeShape({ solid: total - 1, thin: 1 }) });
      const shots = shotList([...Array(total - 1).fill('solid'), 'thin']);
      const insight = buildRecapInsight(s, null, [], {}, shots);
      if (insight) {
        assert.doesNotMatch(insight.headline, /%/);
        assert.doesNotMatch(insight.sub, /solid contact this session/i);
      }
    }
  });
});

describe('Duplicate Best Stretch prevention', () => {
  test('bestWindow existing (any strength) never by itself produces an insight card — the dedicated Best Stretch section already covers it', () => {
    for (const solidPct of [70, 80, 90, 100]) {
      const s = baseSummary({ bestWindow: { solidPct, startBall: 1, endBall: 10 } });
      const insight = buildRecapInsight(s, null, [], {});
      assert.equal(insight, null, `solidPct=${solidPct} should not produce a Best-Stretch-shaped insight`);
    }
  });
});
