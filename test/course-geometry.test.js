import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resetDB } from './setup.js';
import {
  haversineMeters, polygonCentroid, polygonMaxSpanMeters, distinctRing,
  isClosedWay, greenEdgeDistances, greenEdgeYards, metersToYards, nearestTo,
} from '../js/geo.js';
import {
  parseGolfElements, buildHoleMapping, buildCourseGeometry, chooseHoleFeature,
  orientHoleLine, associateHole, measureHole, teeSetsFromGeometry, buildQueries,
  TEE_ASSOCIATION_MAX_M,
} from '../js/courseGeometry.js';

// GPS course mapping — docs/course-mode-spec.md §14.
//
// The fixture is a real OpenStreetMap trace of Oakmont Golf Center, pulled
// live from Overpass on 2026-09-17 and recorded verbatim so these tests run
// offline and deterministically. © OpenStreetMap contributors, ODbL.
const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures-oakmont-osm.json', import.meta.url), 'utf8'));

// §14.14's authoritative values. Every one of these was computed from
// polygons — none is published on any scorecard.
const OAKMONT = {
  1: { par: 3, blue: 124, red: 101 },
  2: { par: 3, blue: 157, red: 144 },
  3: { par: 3, blue: 178, red: 136 },
  4: { par: 3, blue: 190, red: 160 },
  5: { par: 3, blue: 165, red: 125 },
  6: { par: 3, blue: 138, red: 118 },
  7: { par: 3, blue: 174, red: 136 },
  8: { par: 3, blue: 111, red: 84 },
  9: { par: 3, blue: 137, red: 101 },
};
const TOTAL_PAR = 27;
const TOTAL_BLUE = 1374;
const TOTAL_RED = 1105;

const geometry = buildCourseGeometry(FIXTURE.elements, { fetchedAt: '2026-09-17T00:00:00.000Z' });
const holeByNumber = (n) => geometry.holes.find((h) => h.hole_number === n);
const yardsFor = (n, tee) => holeByNumber(n)?.tees.find((t) => t.tee === tee)?.yards;

describe('Geometry primitives', () => {
  test('haversine agrees with a known separation', async () => {
    // Oakmont hole 2's green centroid to hole 9's, measured independently.
    const a = { lat: 38.8782468, lon: -77.3161370 };
    const b = { lat: 38.8772445, lon: -77.3176974 };
    assert.ok(Math.abs(haversineMeters(a, b) - 175.1) < 0.5);
  });

  test('a closed ring drops its repeated last vertex exactly once', async () => {
    const ring = [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }, { lat: 1, lon: 1 }];
    assert.equal(isClosedWay(ring), true);
    assert.equal(distinctRing(ring).length, 3);
    assert.equal(distinctRing(distinctRing(ring)).length, 3);
  });

  test('green centroid reproduces the value §14.14 publishes', async () => {
    // The 23-point green §14.14 describes, identified by its own vertex count.
    const green = geometry.greens.find((g) => g.polygon.length === 22 && g.span_m === 28.3);
    assert.ok(green, 'the 23-point (22 distinct) green from §14.14 is present');
    const published = { lat: 38.8782468, lon: -77.3161370 };
    const off = haversineMeters(green.centroid, published);
    assert.ok(off < 2, `centroid is ${off.toFixed(2)} m from the published value`);
  });

  test('green span matches §14.14 — 28.3 m', async () => {
    const green = geometry.greens.find((g) => g.span_m === 28.3);
    assert.ok(green, 'a green measuring 28.3 m across exists');
    assert.ok(polygonMaxSpanMeters(green.polygon) > 28 && polygonMaxSpanMeters(green.polygon) < 28.6);
  });

  // The bug this guards against threw a centroid 46 m outside a green only
  // 24 m across: a shoelace computed on raw lat/lon degrees loses every
  // significant digit to cancellation. Any centroid must land inside its
  // own polygon's bounding box.
  test('every green centroid lands inside its own bounding box', async () => {
    for (const g of geometry.greens) {
      const lats = g.polygon.map((p) => p.lat);
      const lons = g.polygon.map((p) => p.lon);
      assert.ok(g.centroid.lat >= Math.min(...lats) && g.centroid.lat <= Math.max(...lats), g.osm_id);
      assert.ok(g.centroid.lon >= Math.min(...lons) && g.centroid.lon <= Math.max(...lons), g.osm_id);
    }
  });

  test('centroid of a single point is that point; of nothing, null', async () => {
    assert.deepEqual(polygonCentroid([{ lat: 5, lon: 6 }]), { lat: 5, lon: 6 });
    assert.equal(polygonCentroid([]), null);
    assert.equal(polygonCentroid(null), null);
  });

  test('nearestTo returns null for an empty list rather than measuring nothing', async () => {
    assert.equal(nearestTo({ lat: 1, lon: 1 }, []), null);
  });
});

describe('Green front / centre / back — dynamic, never stored', () => {
  const green = geometry.greens.find((g) => g.span_m === 28.3);

  // A position on the line of play, ~150 m short of the green.
  const approach = { lat: green.centroid.lat - 0.0013, lon: green.centroid.lon - 0.0002 };

  test('front <= centre <= back by construction', async () => {
    const d = greenEdgeDistances(approach, green.polygon, green.centroid);
    assert.ok(d, 'a polygon yields three distances');
    assert.ok(d.front_m <= d.center_m, `${d.front_m} <= ${d.center_m}`);
    assert.ok(d.center_m <= d.back_m, `${d.center_m} <= ${d.back_m}`);
  });

  test('depth between front and back never exceeds the green span', async () => {
    const d = greenEdgeDistances(approach, green.polygon, green.centroid);
    const depth = d.back_m - d.front_m;
    assert.ok(depth > 0);
    assert.ok(depth <= green.span_m + 0.01, `depth ${depth} <= span ${green.span_m}`);
  });

  // §14.7 level A: they change as the golfer walks. If they did not, they
  // would have been stored rather than computed.
  test('the three values change with position', async () => {
    const near = { lat: green.centroid.lat - 0.0004, lon: green.centroid.lon };
    const far = { lat: green.centroid.lat - 0.0030, lon: green.centroid.lon };
    const a = greenEdgeYards(near, green.polygon, green.centroid);
    const b = greenEdgeYards(far, green.polygon, green.centroid);
    assert.notEqual(a.center, b.center);
    assert.ok(b.center > a.center);
  });

  // ...and with the approach angle, at a constant distance from the centre.
  test('they change with approach angle at the same distance', async () => {
    const r = 0.0012;
    const south = { lat: green.centroid.lat - r, lon: green.centroid.lon };
    const east = { lat: green.centroid.lat, lon: green.centroid.lon + r / Math.cos(green.centroid.lat * Math.PI / 180) };
    const a = greenEdgeDistances(south, green.polygon, green.centroid);
    const b = greenEdgeDistances(east, green.polygon, green.centroid);
    assert.ok(Math.abs(a.center_m - b.center_m) < 2, 'same distance to centre');
    // Depth is measured across the green on the line of play, so a
    // different bearing crosses a different chord. Compared unrounded: a
    // near-circular green can give two bearings the same whole metre.
    const depthA = a.back_m - a.front_m;
    const depthB = b.back_m - b.front_m;
    assert.notEqual(depthA, depthB, 'depth depends on the bearing');
    for (const d of [depthA, depthB]) assert.ok(d > 0 && d <= green.span_m + 0.01);
  });

  // §14.7 level B and §14.13.3: a captured green is one point. Front and
  // back must be absent, never estimated from green size or hole length.
  test('a single captured point yields no front or back', async () => {
    assert.equal(greenEdgeDistances(approach, [green.centroid], green.centroid), null);
    assert.equal(greenEdgeYards(approach, null, green.centroid), null);
    assert.equal(greenEdgeYards(approach, [], green.centroid), null);
  });

  test('standing exactly on the centre has no line of play, so no edges', async () => {
    assert.equal(greenEdgeDistances(green.centroid, green.polygon, green.centroid), null);
  });

  test('yards are whole numbers — §14.6 forbids decimals', async () => {
    const y = greenEdgeYards(approach, green.polygon, green.centroid);
    for (const v of [y.front, y.center, y.back]) assert.equal(v, Math.round(v));
  });
});

describe('Oakmont regression fixture — §14.14', () => {
  test('the trace parses into 9 greens, 18 tees and 11 hole features', async () => {
    const parsed = parseGolfElements(FIXTURE.elements);
    assert.equal(parsed.greens.length, 9);
    assert.equal(parsed.tees.length, 18);
    // 11 golf=hole features in the source; one carries no ref and is dropped
    // rather than guessed at.
    assert.equal(parsed.holes.length, 10);
    assert.equal(geometry.counts.holes_mapped, 9);
  });

  test('all nine holes are par 3, totalling 27', async () => {
    let par = 0;
    for (const n of Object.keys(OAKMONT).map(Number)) {
      assert.equal(holeByNumber(n).par, OAKMONT[n].par, `hole ${n}`);
      par += holeByNumber(n).par;
    }
    assert.equal(par, TOTAL_PAR);
  });

  for (const n of Object.keys(OAKMONT).map(Number)) {
    test(`hole ${n} measures Blue ${OAKMONT[n].blue} / Red ${OAKMONT[n].red}`, async () => {
      assert.equal(yardsFor(n, 'blue'), OAKMONT[n].blue);
      assert.equal(yardsFor(n, 'red'), OAKMONT[n].red);
    });
  }

  test('course totals are Blue 1374 / Red 1105', async () => {
    const sum = (tee) => geometry.holes.reduce((t, h) => t + (h.tees.find((x) => x.tee === tee)?.yards || 0), 0);
    assert.equal(sum('blue'), TOTAL_BLUE);
    assert.equal(sum('red'), TOTAL_RED);
  });

  // The two invariants the brief calls out. Each catches a specific wrong
  // implementation, and each would have caught it on every hole at once.
  test('INVARIANT: Blue differs from Red on every hole', async () => {
    // A yardage taken from the golf=hole line's length gives one number per
    // hole, so Blue would equal Red everywhere.
    for (const n of Object.keys(OAKMONT).map(Number)) {
      assert.notEqual(yardsFor(n, 'blue'), yardsFor(n, 'red'), `hole ${n} must distinguish tees`);
    }
  });

  test('INVARIANT: Blue is longer than Red on every hole', async () => {
    // Associating tees by nearest-to-green instead of via the line start
    // returned hole 8 as blue 59 / red 111 — blue shorter than red was the
    // tell (§14.7).
    for (const n of Object.keys(OAKMONT).map(Number)) {
      assert.ok(yardsFor(n, 'blue') > yardsFor(n, 'red'),
        `hole ${n}: blue ${yardsFor(n, 'blue')} must exceed red ${yardsFor(n, 'red')}`);
    }
  });

  test('every hole resolved a green', async () => {
    assert.equal(geometry.counts.holes_with_green, 9);
    for (const h of geometry.holes) {
      assert.ok(h.green.polygon.length >= 3, `hole ${h.hole_number} keeps its full ring`);
      assert.equal(h.green.source, 'osm');
    }
  });
});

describe('Duplicate ref values are normal data, not an error', () => {
  test('hole 1 has two ref=1 features and the line wins over the 2010 area', async () => {
    const parsed = parseGolfElements(FIXTURE.elements);
    const ones = parsed.holes.filter((h) => h.hole_number === 1);
    assert.equal(ones.length, 2, 'the fixture really does carry two');
    assert.equal(ones.filter((h) => h.closed).length, 1, 'one of them is a closed area');

    const picked = chooseHoleFeature(ones, parsed);
    assert.equal(picked.closed, false, 'a line beats an area — a perimeter is not a distance');
    assert.equal(picked.osm_id, 'way/1559899010');
    assert.equal(holeByNumber(1).hole_osm_id, 'way/1559899010');
  });

  test('and it still produces the authoritative 124 / 101', async () => {
    assert.equal(yardsFor(1, 'blue'), 124);
    assert.equal(yardsFor(1, 'red'), 101);
  });

  test('tiebreak falls through to the most recent edit when shape and fit tie', async () => {
    const mk = (id, ts) => ({
      osm_id: id, hole_number: 5, par: 3, closed: false, timestamp: ts,
      points: [{ lat: 38.878, lon: -77.316 }, { lat: 38.879, lon: -77.317 }],
      centroid: { lat: 38.8785, lon: -77.3165 },
    });
    const picked = chooseHoleFeature([mk('way/1', '2010-01-01T00:00:00Z'), mk('way/2', '2026-01-01T00:00:00Z')], {});
    assert.equal(picked.osm_id, 'way/2');
  });

  test('a lone candidate is returned untouched, and no candidates yields null', async () => {
    const parsed = parseGolfElements(FIXTURE.elements);
    const two = parsed.holes.find((h) => h.hole_number === 2);
    assert.equal(chooseHoleFeature([two], parsed), two);
    assert.equal(chooseHoleFeature([], parsed), null);
    assert.equal(chooseHoleFeature(null, parsed), null);
  });
});

describe('Association uses the line; measurement never does', () => {
  const parsed = parseGolfElements(FIXTURE.elements);

  // Three of Oakmont's nine lines are drawn green-to-tee. Reading the
  // endpoints in file order would swap both roles and quietly corrupt every
  // number on those holes.
  test('every oriented line starts at the tee end and finishes at the green', async () => {
    // Only real lines have an orientation; hole 1's 2010 closed area begins
    // and ends on the same node and is excluded by the tiebreak anyway.
    for (const h of parsed.holes.filter((x) => !x.closed)) {
      const { start, end } = orientHoleLine(h, parsed.tees);
      assert.ok(nearestTo(start, parsed.tees).distance_m <= nearestTo(end, parsed.tees).distance_m,
        `${h.osm_id} should start at the tee end`);
      assert.ok(nearestTo(end, parsed.greens).distance_m <= nearestTo(start, parsed.greens).distance_m,
        `${h.osm_id} should finish at the green end`);
    }
  });

  // Oakmont is uniformly traced tee-to-green, so the fixture alone cannot
  // exercise the swap. OSM guarantees no such thing, and a reversed line
  // would silently invert both associations — so it is tested directly, by
  // reversing a real hole and checking the yardages are unchanged.
  test('a line drawn green-to-tee yields identical yardages', async () => {
    const eight = parsed.holes.find((h) => h.hole_number === 8 && !h.closed);
    const flipped = { ...eight, points: [...eight.points].reverse() };

    const o = orientHoleLine(flipped, parsed.tees);
    assert.notEqual(o.start, flipped.points[0], 'the swap actually happened');

    const measured = measureHole(associateHole(flipped, parsed));
    assert.equal(measured.find((t) => t.tee === 'blue').yards, 111);
    assert.equal(measured.find((t) => t.tee === 'red').yards, 84);
  });

  test('a line with no tees anywhere is left in its given order', async () => {
    const eight = parsed.holes.find((h) => h.hole_number === 8 && !h.closed);
    const o = orientHoleLine(eight, []);
    assert.equal(o.start, eight.points[0]);
  });

  test('measured yardage is independent of the line length', async () => {
    // Hole 3's line measures ~184 yd; its true blue yardage is 178. §14.7
    // uses exactly this hole to show that line length varies with where the
    // mapper stopped drawing.
    const three = parsed.holes.find((h) => h.hole_number === 3 && !h.closed);
    const lineYards = Math.round(metersToYards(haversineMeters(three.points[0], three.points[three.points.length - 1])));
    assert.ok(Math.abs(lineYards - 178) >= 3, `line is ${lineYards} yd, measured blue is 178`);
    assert.equal(yardsFor(3, 'blue'), 178);
  });

  test('a tee farther than the association cap is not claimed by the hole', async () => {
    const hole = parsed.holes.find((h) => h.hole_number === 8 && !h.closed);
    const assoc = associateHole(hole, parsed);
    for (const [, { distance_m }] of assoc.tees) {
      assert.ok(distance_m <= TEE_ASSOCIATION_MAX_M);
    }
  });

  test('measuring with no green yields no yardages rather than a guess', async () => {
    assert.deepEqual(measureHole({ green: null, tees: new Map() }), []);
  });
});

describe('Degradation — courses without full tracing', () => {
  const parsed = parseGolfElements(FIXTURE.elements);

  // §14.7: "a course traced with greens and tees but no hole lines can give
  // green distances but not per-tee yardages. Degrade to centre-only
  // yardage rather than guessing."
  test('greens and tees but NO hole lines gives greens and zero tee yardages', async () => {
    const withoutLines = FIXTURE.elements.filter((e) => e.tags.golf !== 'hole');
    const g = buildCourseGeometry(withoutLines);
    assert.equal(g.counts.greens, 9, 'greens survive — live yardage still works');
    assert.equal(g.counts.tees, 18);
    assert.equal(g.holes.length, 0, 'no hole is claimed without a line to claim it');
    assert.equal(teeSetsFromGeometry(g, 9).length, 0, 'and no tee set is invented');
  });

  test('greens only — no tees at all — still yields green centres', async () => {
    const greensOnly = FIXTURE.elements.filter((e) => e.tags.golf === 'green');
    const g = buildCourseGeometry(greensOnly);
    assert.equal(g.counts.greens, 9);
    assert.equal(g.counts.holes_with_tee_yardage, 0);
  });

  test('an unmapped course produces an empty, harmless record', async () => {
    const g = buildCourseGeometry([]);
    assert.deepEqual(g.holes, []);
    assert.deepEqual(g.greens, []);
    assert.equal(g.counts.greens, 0);
    assert.deepEqual(teeSetsFromGeometry(g, 18), []);
  });

  test('junk and partial elements are skipped, never thrown on', async () => {
    const junk = [
      null,
      { type: 'way', id: 1 },
      { type: 'way', id: 2, tags: { golf: 'green' }, geometry: [] },
      { type: 'way', id: 3, tags: { golf: 'hole', ref: 'not-a-number' }, geometry: [{ lat: 1, lon: 1 }] },
      { type: 'way', id: 4, tags: { golf: 'bunker' }, geometry: [{ lat: 1, lon: 1 }] },
      { type: 'node', id: 5, tags: { golf: 'green' }, lat: 38.87, lon: -77.31 },
    ];
    const g = buildCourseGeometry(junk);
    assert.equal(g.counts.greens, 1, 'only the valid node green survives');
    assert.equal(g.counts.hole_lines, 0, 'a non-numeric ref is dropped, not coerced');
  });
});

describe('Tee sets derived from measurement (§14.12.3)', () => {
  test('two tee sets, longest first, with per-hole yardages', async () => {
    const tees = teeSetsFromGeometry(geometry, 9);
    assert.equal(tees.length, 2);
    assert.equal(tees[0].tee_id, 'blue');
    assert.equal(tees[1].tee_id, 'red');
    assert.equal(tees[0].total_yards, TOTAL_BLUE);
    assert.equal(tees[1].total_yards, TOTAL_RED);
    assert.equal(tees[0].hole_yardages.length, 9);
    assert.deepEqual(tees[0].hole_yardages, [124, 157, 178, 190, 165, 138, 174, 111, 137]);
    assert.deepEqual(tees[1].hole_yardages, [101, 144, 136, 160, 125, 118, 136, 84, 101]);
  });

  test('every tee set is flagged measured, never presented as a scorecard yardage', async () => {
    for (const t of teeSetsFromGeometry(geometry, 9)) assert.equal(t.measured, true);
  });

  test('a hole with no measurement leaves a null, not a zero or an estimate', async () => {
    const partial = {
      holes: [{ hole_number: 1, tees: [{ tee: 'blue', yards: 120 }] },
        { hole_number: 2, tees: [] }],
    };
    const [blue] = teeSetsFromGeometry(partial, 3);
    assert.deepEqual(blue.hole_yardages, [120, null, null]);
    assert.equal(blue.total_yards, 120);
  });
});

describe('Overpass query construction', () => {
  test('a way-backed course is scoped to its own area first, then a radius', async () => {
    const qs = buildQueries({ latitude: 38.878, longitude: -77.316, place_id: 'way/123' });
    assert.equal(qs.length, 2);
    assert.match(qs[0], /way\(123\);map_to_area/);
    assert.match(qs[0], /out geom tags meta;/);
    assert.match(qs[1], /around:\d+,38\.878,-77\.316/);
  });

  test('a relation-backed course uses rel()', async () => {
    assert.match(buildQueries({ place_id: 'relation/9' })[0], /rel\(9\);map_to_area/);
  });

  test('a node-backed or manual course falls back to a radius only', async () => {
    const qs = buildQueries({ latitude: 1, longitude: 2, place_id: 'node/5' });
    assert.equal(qs.length, 1);
    assert.match(qs[0], /around:/);
  });

  test('a course with no location at all produces no query', async () => {
    assert.deepEqual(buildQueries({}), []);
    assert.deepEqual(buildQueries(), []);
  });

  test('every query asks for geometry — ids alone would be useless here', async () => {
    for (const q of buildQueries({ latitude: 1, longitude: 2, place_id: 'way/7' })) {
      assert.match(q, /out geom/);
    }
  });
});

describe('Course geometry persistence', () => {
  test('geometry and tees round-trip on the course record', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'Oakmont Golf Center', source: 'manual', hole_count: 9 });
    assert.equal(db.getCourseGeometry(course.course_id), null);
    assert.equal(db.courseGeometryChecked(course.course_id), false);

    db.setCourseGeometry(course.course_id, geometry, teeSetsFromGeometry(geometry, 9));

    const back = db.getCourseGeometry(course.course_id);
    assert.equal(back.counts.holes_mapped, 9);
    assert.equal(back.holes[0].green.polygon.length >= 3, true);
    assert.equal(db.courseGeometryChecked(course.course_id), true);
    assert.equal(db.getCourseTees(course.course_id).length, 2);
  });

  test('geometry survives a reload — it is fetched once, not per round', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'Oakmont Golf Center', source: 'manual', hole_count: 9 });
    db.setCourseGeometry(course.course_id, geometry, teeSetsFromGeometry(geometry, 9));

    db.__resetForTests();
    const after = db.getCourseGeometry(course.course_id);
    assert.equal(after.counts.holes_mapped, 9);
    assert.equal(after.holes.find((h) => h.hole_number === 8).tees.find((t) => t.tee === 'blue').yards, 111);
  });

  test('a course that was checked and found unmapped is remembered as checked', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'Unmapped Muni', source: 'manual', hole_count: 9 });
    db.setCourseGeometry(course.course_id, null);
    assert.equal(db.getCourseGeometry(course.course_id), null);
    assert.equal(db.courseGeometryChecked(course.course_id), true, 'so it is not re-queried forever');
  });

  test('the shortest measured tee is preselected, and the choice is remembered (§14.3)', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'Oakmont Golf Center', source: 'manual', hole_count: 9 });
    db.setCourseGeometry(course.course_id, geometry, teeSetsFromGeometry(geometry, 9));
    assert.equal(db.getSelectedTee(course.course_id).tee_id, 'red', 'shortest by default');

    db.setSelectedTee(course.course_id, 'blue');
    db.__resetForTests();
    assert.equal(db.getSelectedTee(course.course_id).tee_id, 'blue', 'remembered across a reload');
  });

  test('an unknown tee id is refused rather than stored dangling', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'Oakmont Golf Center', source: 'manual', hole_count: 9 });
    db.setCourseGeometry(course.course_id, geometry, teeSetsFromGeometry(geometry, 9));
    db.setSelectedTee(course.course_id, 'gold');
    assert.notEqual(db.getSelectedTee(course.course_id).tee_id, 'gold');
  });

  test('a green is reachable per hole, and absent holes yield null', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'Oakmont Golf Center', source: 'manual', hole_count: 9 });
    db.setCourseGeometry(course.course_id, geometry, teeSetsFromGeometry(geometry, 9));
    assert.ok(db.getGreenForHole(course.course_id, 2).centroid);
    assert.equal(db.getGreenForHole(course.course_id, 14), null);
    assert.equal(db.getGreenForHole('nope', 1), null);
  });

  test('courses written before §14 gain the new fields on read, not by migration', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'Legacy Course', source: 'manual', hole_count: 9 });
    delete course.geometry; delete course.tees; delete course.selected_tee_id;
    assert.deepEqual(db.getCourseTees(course.course_id), []);
    assert.equal(db.getCourseGeometry(course.course_id), null);
    assert.equal(db.getSelectedTee(course.course_id), null);
  });

  test('cached geometry survives a full export/import round trip', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'Oakmont Golf Center', source: 'manual', hole_count: 9 });
    db.setCourseGeometry(course.course_id, geometry, teeSetsFromGeometry(geometry, 9));
    const dump = JSON.parse(JSON.stringify(db.getDB()));

    const fresh = await resetDB();
    fresh.importFullDB(dump);
    const back = fresh.getCourseGeometry(course.course_id);
    assert.equal(back.counts.holes_mapped, 9);
    assert.equal(fresh.getCourseTees(course.course_id).length, 2);
  });
});
