// Range ↔ Course intelligence — the one place range practice history and
// course results are compared.
//
// WHAT EACH SIDE ACTUALLY KNOWS
//
// Range data is shot-level and rich: club, strike, direction, height,
// distance, drill, training aid. Contact quality is genuinely measured
// there, so range vocabulary ("reliable", "solid") is legitimate.
//
// Course data is hole-level and deliberately sparse (§6): score, par,
// clubs_used[] as an unordered set with no counts, short_game_strokes,
// putts. It does NOT record which shot was good or bad, the direction of
// any course shot, or which club hit which stroke.
//
// Therefore every sentence produced here describes a RELATIONSHIP between
// two independently recorded facts. It never characterises a course shot,
// and it never asserts that a club caused a score (§7.4, §9.7):
//
//   Never: "Your 9i missed left on the course."     (no direction captured)
//   Never: "Your PW was 80% solid on course."       (no course strike data)
//   Never: "You gained 2 strokes with your wedge."  (no shot attribution)
//   OK:    "PW has been one of your most reliable range clubs and appeared
//           on 3 of your 4 best-scoring holes."
//
// Note that the richer correlation — the kind that could say what a club
// actually did on the course — is deferred until shot-level course data
// exists (§12), not approximated here.

import { clubBreakdown } from './stats.js';
import { roundTotals, clubAssociations } from './roundAnalysis.js';

// ---------- Analysis window ----------
//
// Recent practice, not a career average: how someone practised eight months
// ago says little about the round they played today. The window is capped
// both by session count and by age, and when too few sessions fall inside
// it the range side simply stays silent rather than reaching further back.
//
// 60 days rather than 30 because range practice is often fortnightly or
// less; a 30-day window would silence this for most golfers most of the
// time. Tunable here and nowhere else.
export const RANGE_WINDOW = {
  maxSessions: 5,
  maxAgeDays: 60,
  minSessions: 3,
};

// Every threshold in one place, so the evidence bar can be raised or
// lowered without hunting through the rules.
export const INSIGHT_THRESHOLDS = {
  // Range side: a club must have been practised enough, recently enough,
  // for its reliability to mean anything.
  minRangeShotsPerClub: 20,
  reliableSolidPct: 60,

  // Course side: a club on one or two holes is a coincidence, not a
  // pattern. Matches the bar any narrative claim carries (§9.5).
  minCourseHoles: 3,

  // How many of the round's best-scoring holes a club must appear on
  // before the overlap is worth stating.
  minBestHoleOverlap: 3,

  // ...and the round must actually have better and worse holes. In a round
  // where every hole scored the same relative to par, the "best-scoring
  // holes" are only an artifact of sorting ties, so saying a club appeared
  // on them would read as a finding while resting on nothing.
  minBestHoleSpread: 0.5,

  // How much worse (in strokes per hole) the holes carrying a club must
  // average before it is flagged as worth attention.
  attentionMargin: 1,

  // A club counts as "not practised recently" only if it is genuinely
  // near-absent from the window, not merely less used.
  unpracticedMaxShots: 5,

  // A bridge, not a dashboard.
  maxInsights: 2,
};

// Best/worst scoring holes are the top ~40% of the round, never fewer than
// three, so "best-scoring holes" always describes a real group rather than
// a single lucky hole.
function splitScoringHoles(holes) {
  const scored = holes.filter((h) => h.par != null);
  if (scored.length < INSIGHT_THRESHOLDS.minBestHoleOverlap) return { best: [], worst: [] };
  const groupSize = Math.max(3, Math.round(scored.length * 0.4));
  const byToPar = [...scored].sort((a, b) => (a.strokes - a.par) - (b.strokes - b.par));
  const best = byToPar.slice(0, groupSize);
  const rest = byToPar.slice(groupSize);

  // A round with no spread has no best holes to speak of — only ties that
  // sorting happened to order. Report none rather than a sort artifact.
  const mean = (list) => list.reduce((s, h) => s + (h.strokes - h.par), 0) / list.length;
  const spread = rest.length ? mean(rest) - mean(best) : 0;
  if (spread < INSIGHT_THRESHOLDS.minBestHoleSpread) return { best: [], worst: [], spread };

  return { best, worst: byToPar.slice(-groupSize), spread };
}

// The range sessions this round is compared against: real, finished, newest
// first, within the age cap, capped in count. Test sessions are excluded
// exactly as they are from personalization.
export function selectRangeWindow(sessions, { now = Date.now(), window = RANGE_WINDOW } = {}) {
  const cutoff = now - window.maxAgeDays * 24 * 60 * 60 * 1000;
  return [...sessions]
    .filter((s) => {
      const t = new Date(s.created_at || s.date || 0).getTime();
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, window.maxSessions);
}

// Per-club range profile over the window. Reliability here is real measured
// contact quality — this is the one side of the bridge where quality
// vocabulary is earned.
export function clubRangeProfiles(windowSessions, shotsBySession) {
  const byClub = new Map();
  for (const session of windowSessions) {
    const shots = shotsBySession(session.session_id) || [];
    const seen = new Set();
    for (const s of shots) {
      if (!s.club) continue;
      if (!byClub.has(s.club)) byClub.set(s.club, { club: s.club, shots: [], sessions: 0 });
      byClub.get(s.club).shots.push(s);
      seen.add(s.club);
    }
    for (const club of seen) byClub.get(club).sessions += 1;
  }

  return [...byClub.values()].map((entry) => {
    const [breakdown] = clubBreakdown(entry.shots);
    return {
      club: entry.club,
      shots: entry.shots.length,
      sessions: entry.sessions,
      solidPct: breakdown?.solidPct ?? 0,
      // Reliability is only claimed with enough recent shots behind it.
      reliable: entry.shots.length >= INSIGHT_THRESHOLDS.minRangeShotsPerClub
        && (breakdown?.solidPct ?? 0) >= INSIGHT_THRESHOLDS.reliableSolidPct,
      wellPractised: entry.shots.length >= INSIGHT_THRESHOLDS.minRangeShotsPerClub,
    };
  }).sort((a, b) => b.shots - a.shots);
}

// ---------- Structured insights ----------
//
// Returns objects rather than strings so the evidence behind every sentence
// stays inspectable, and so a reviewer can check a claim against the fields
// that produced it without re-reading the copy.
//
// Kinds:
//   reliable_club     range → course   a reliable club coincided with good holes
//   club_attention    course → range   a club coincided with worse holes
//   club_unpractised  course → range   a club used on course is near-absent from practice
export function buildRangeCourseInsights(round, holes, { rangeSessions = [], shotsBySession = () => [], now = Date.now() } = {}) {
  const totals = roundTotals(holes);
  if (!totals.hasPar || !holes.length) return [];

  const windowSessions = selectRangeWindow(rangeSessions, { now });
  const hasRangeEvidence = windowSessions.length >= RANGE_WINDOW.minSessions;
  const profiles = hasRangeEvidence
    ? new Map(clubRangeProfiles(windowSessions, shotsBySession).map((p) => [p.club, p]))
    : new Map();

  const { best } = splitScoringHoles(holes);
  const bestSet = new Set(best.map((h) => h.hole_number));
  const associations = new Map(clubAssociations(holes).map((a) => [a.club, a]));

  // How many holes each club appeared on, and how many of those were among
  // the round's best-scoring holes.
  const courseUse = new Map();
  for (const h of holes) {
    for (const club of h.clubs_used || []) {
      if (!courseUse.has(club)) courseUse.set(club, { club, holes: 0, bestHoles: 0 });
      const entry = courseUse.get(club);
      entry.holes += 1;
      if (bestSet.has(h.hole_number)) entry.bestHoles += 1;
    }
  }

  const insights = [];
  for (const use of courseUse.values()) {
    // Below this, the club appeared too rarely this round for any claim.
    if (use.holes < INSIGHT_THRESHOLDS.minCourseHoles) continue;

    const profile = profiles.get(use.club);
    const association = associations.get(use.club);

    // 1. A reliable range club that coincided with the better holes.
    if (profile?.reliable && use.bestHoles >= INSIGHT_THRESHOLDS.minBestHoleOverlap) {
      insights.push({
        id: `reliable_club:${use.club}`,
        kind: 'reliable_club',
        direction: 'range_to_course',
        club: use.club,
        // Two independently recorded facts, joined by "and" — never by
        // "so", "because", or "which is why".
        text: `${use.club} has been one of your most reliable range clubs and appeared on ${use.bestHoles} of your ${best.length} best-scoring holes.`,
        evidence: {
          rangeShots: profile.shots,
          rangeSessions: profile.sessions,
          solidPct: profile.solidPct,
          courseHoles: use.holes,
          bestHoleOverlap: use.bestHoles,
          bestHoleGroup: best.length,
        },
      });
      continue;
    }

    // 2. A club that coincided with higher-scoring holes. Phrased as an
    //    invitation to practise, never as blame — the data cannot say the
    //    club was responsible for anything.
    if (association && association.margin >= INSIGHT_THRESHOLDS.attentionMargin) {
      insights.push({
        id: `club_attention:${use.club}`,
        kind: 'club_attention',
        direction: 'course_to_range',
        club: use.club,
        text: `${use.club} appeared on ${use.holes} of your higher-scoring holes. It may be worth giving the ${use.club} extra attention at your next range session.`,
        evidence: {
          courseHoles: use.holes,
          avgToPar: Math.round(association.avgToPar * 10) / 10,
          margin: Math.round(association.margin * 10) / 10,
          rangeShots: profile?.shots ?? 0,
        },
      });
      continue;
    }

    // 3. A club the golfer plays but barely practises. Only stated when
    //    there is a real window to be absent from.
    if (hasRangeEvidence && (profile?.shots ?? 0) <= INSIGHT_THRESHOLDS.unpracticedMaxShots) {
      insights.push({
        id: `club_unpractised:${use.club}`,
        kind: 'club_unpractised',
        direction: 'course_to_range',
        club: use.club,
        text: `${use.club} appeared on ${use.holes} holes this round but has barely come up in your recent range sessions.`,
        evidence: {
          courseHoles: use.holes,
          rangeShots: profile?.shots ?? 0,
          windowSessions: windowSessions.length,
        },
      });
    }
  }

  // Strongest evidence first: a match backed by real range reliability
  // outranks a club flagged for attention, which outranks an absence.
  const rank = { reliable_club: 0, club_attention: 1, club_unpractised: 2 };
  return insights
    .sort((a, b) => rank[a.kind] - rank[b.kind] || (b.evidence.courseHoles ?? 0) - (a.evidence.courseHoles ?? 0))
    .slice(0, INSIGHT_THRESHOLDS.maxInsights);
}
