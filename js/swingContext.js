import * as db from './db.js';

// The analysis context contract (swing-lab-spec.md §6; brief §24).
//
// ONE builder, so every entry point hands the analysis engine the same
// shape: analysing a pending swing mid-session, analysing straight after a
// shot is logged, or opening an old swing from Swing Lab weeks later. Three
// screens assembling three payloads by hand is how they drift, and the
// drift would show up as analyses that quietly disagree.
//
// Two kinds of context, and the difference matters:
//
//   RECORDING CONTEXT  a COPY, frozen when the swing was filmed. What the
//                      golfer was working on at the time. Never re-derived,
//                      because session defaults change during a session and
//                      history must not move with them (§10, §20).
//
//   SHOT OUTCOME       read LIVE from the shot, if there is one. A corrected
//                      strike or distance should be reflected, because it is
//                      a correction to what actually happened (§20).

// Everything true about the practice at the moment of recording. Called once,
// at capture, and stored on the SwingVideo.
export function buildRecordingContext(session) {
  if (!session) return null;
  return {
    club: session.current_club ?? session.default_club ?? null,
    swing_length: session.current_swing ?? session.default_swing ?? null,
    setup: session.current_setup ?? session.default_setup ?? null,
    surface: session.current_surface ?? session.default_surface ?? null,
    drill: session.current_drill ?? null,
    training_aid: session.current_training_aid ?? null,
    target_distance_yards: session.current_target_distance ?? null,
    practice_focus: Array.isArray(session.practice_focus) ? [...session.practice_focus] : [],
    captured_at: new Date().toISOString(),
  };
}

// The outcome half. Null when the swing has no shot — which is an ordinary
// state, not a gap to fill.
//
// Outcome values are NEVER invented. A swing analysed before its shot is
// logged simply has none, and the analysis says what it can from the
// movement alone (§12).
function shotOutcome(video) {
  if (!video?.shot_id || !video.range_session_id) return null;
  const shot = db.getShotsForSession(video.range_session_id)
    .find((s) => s.shot_id === video.shot_id);
  if (!shot) return null;
  return {
    shot_id: shot.shot_id,
    shot_number: shot.shot_number,
    strike: shot.strike,
    direction: shot.direction,
    height: shot.height,
    distance_yards: shot.distance_yards,
    // Read live, so a later correction is picked up without re-associating
    // or re-running anything deterministic.
    updated_at: shot.updated_at,
  };
}

// The normalized context the analysis engine receives, whatever the entry
// point. `has_outcome` is stated explicitly so a consumer never has to infer
// it from a missing field — the difference between "no shot" and "a shot
// with nothing entered" is real.
export function buildSwingAnalysisContext(swingVideoId) {
  const video = db.getSwingVideo(swingVideoId);
  if (!video) return null;

  const outcome = shotOutcome(video);
  const session = video.range_session_id ? db.getSession(video.range_session_id) : null;
  const lesson = video.active_focus_snapshot?.lesson_id
    ? db.getLesson(video.active_focus_snapshot.lesson_id)
    : null;

  return {
    swing_video_id: video.swing_video_id,
    shot_id: video.shot_id ?? null,
    range_session_id: video.range_session_id ?? null,
    association_state: video.association_state,

    club: video.club ?? video.practice_context?.club ?? null,
    camera_view: video.camera_view,

    // What the file actually is. Capability (§3.1a) is decided from this,
    // and every field may be null, meaning unknown rather than a default.
    media: {
      fps: video.fps ?? null,
      variable_frame_rate: video.variable_frame_rate ?? null,
      duration_ms: video.duration_ms ?? null,
      display_width: video.display_width ?? null,
      display_height: video.display_height ?? null,
      rotation_deg: video.rotation_deg ?? null,
      media_state: video.media_state,
    },

    recording_context: video.practice_context ?? null,

    has_outcome: !!outcome,
    shot_outcome: outcome,

    // A COPY taken at recording time (lesson-spec.md §5.2). The lesson is
    // resolved alongside it for its drills and supporting cues, but the cue
    // text shown must come from the snapshot, not the live lesson.
    active_focus_snapshot: video.active_focus_snapshot ?? null,
    lesson: lesson ? { lesson_id: lesson.lesson_id, date: lesson.date, instructor_name: lesson.instructor_name, drills: lesson.drills } : null,

    practice_plan: session ? db.getPlanForSession(session.session_id) : null,

    built_at: new Date().toISOString(),
  };
}
