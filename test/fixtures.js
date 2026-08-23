// Hand-crafted fixture sessions where the expected analytics can be (and
// were) calculated by hand — these exist specifically because randomized
// simulation alone can hide a calculation bug that happens to cancel out
// across many random shots. Each fixture's expected values are documented
// inline so a future reader can re-verify the math without running anything.

const SESSION_ID = 'fixture-session';

function buildShots(patternFn, count) {
  const shots = [];
  for (let i = 0; i < count; i++) {
    const p = patternFn(i);
    shots.push({
      shot_id: `fixture-shot-${i + 1}`,
      session_id: SESSION_ID,
      shot_number: i + 1,
      shot_timestamp: new Date(2026, 0, 1, 10, 0, i * 25).toISOString(),
      club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full',
      drill: p.drill ?? 'Normal Swing',
      target_distance_yards: p.target_distance_yards ?? null,
      strike: p.strike,
      direction: p.strike === 'miss' ? null : (p.direction ?? 'straight'),
      height: p.strike === 'miss' ? null : (p.height ?? 'medium'),
      distance_yards: p.strike === 'miss' ? null : (p.distance_yards ?? null),
      shot_note: '', created_at: '', updated_at: '',
    });
  }
  return shots;
}

// 50 shots, all Solid / Straight / Medium / 100 yd.
// Expected: Solid=100%, Straight=100%, Median Solid=100yd, every streak = 50.
export const ALL_SOLID = buildShots(() => ({ strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 100 }), 50);

// 50 shots, all Topped.
// Expected: Solid=0%, Topped=100%, longest Solid streak=0, no-Top streak=0, clean-contact=0.
export const ALL_TOPPED = buildShots(() => ({ strike: 'topped', direction: 'left', height: 'low', distance_yards: 60 }), 50);

// 50 shots, all Thin / Fat / Shank / Miss variants (one each family, for divide-by-zero + single-category sweeps).
export const ALL_THIN = buildShots(() => ({ strike: 'thin', direction: 'right', height: 'low', distance_yards: 90 }), 50);
export const ALL_FAT = buildShots(() => ({ strike: 'fat', direction: 'left', height: 'low', distance_yards: 70 }), 50);
export const ALL_SHANK = buildShots(() => ({ strike: 'shank', direction: 'right', height: 'low', distance_yards: 50 }), 50);
export const ALL_MISS = buildShots(() => ({ strike: 'miss' }), 50);

// 50 shots, Solid/Topped/Solid/Topped... starting with Solid at ball 1.
// Expected: 25 solid (odd balls), 25 topped (even balls). Longest Solid
// streak=1, longest no-Top streak=1, longest clean-contact streak=1 (topped
// breaks it every other shot; no two same-type shots are ever adjacent).
export const ALTERNATING_SOLID_TOPPED = buildShots(
  (i) => (i % 2 === 0
    ? { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140 }
    : { strike: 'topped', direction: 'left', height: 'low', distance_yards: 60 }),
  50
);

// 50 shots where balls 18-27 (exactly) are the unique best 10-shot window:
// 100% solid/straight, flanked on both sides by non-solid shots, so every
// OTHER rolling window (including ones straddling the 11-20/21-30 block
// boundary) necessarily includes at least one non-solid shot.
// Expected best window: startBall=18, endBall=27, solidPct=100, toppedFatPct=0, straightPct=100.
export const KNOWN_BEST_10_AT_18_27 = buildShots((i) => {
  const ball = i + 1;
  if (ball >= 18 && ball <= 27) return { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 145 };
  return { strike: 'topped', direction: 'left', height: 'low', distance_yards: 55 };
}, 50);

// 10 shots at a 100-yard target, distances [90,95,100,105,110] repeated
// twice. Hand-calculated expectations:
//   signed errors:   -10,-5,0,5,10,-10,-5,0,5,10
//   abs errors:        10,5,0,5,10,10,5,0,5,10
//   medianActual = 100, medianSignedError = 0, medianAbsoluteError = 5
//   within5Pct = 60 (6 of 10 shots have |error| <= 5)
//   within10Pct = 100 (all 10 shots have |error| <= 10)
export const KNOWN_TARGET_SESSION_100YD = buildShots((i) => {
  const dists = [90, 95, 100, 105, 110, 90, 95, 100, 105, 110];
  return { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: dists[i], target_distance_yards: 100 };
}, 10);

// Multi-drill blocks exactly matching the prompt's example:
// balls 1-10 Low Point, 11-20 Normal Swing, 21-30 Connection, 31-50 Normal Swing.
export const MULTI_DRILL_BLOCKS = buildShots((i) => {
  const ball = i + 1;
  let drill;
  if (ball <= 10) drill = 'Low Point';
  else if (ball <= 20) drill = 'Normal Swing';
  else if (ball <= 30) drill = 'Connection';
  else drill = 'Normal Swing';
  return { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 130, drill };
}, 50);

export const FIXTURE_SESSION_ID = SESSION_ID;
