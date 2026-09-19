import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';

// SwingVideo <-> Shot association (V4.3).
//
// The product principle these tests exist to hold:
//
//   The Shot is the primary object. A SwingVideo enriches a shot when both
//   describe the same swing. Either may exist without the other, and
//   deleting one never deletes the other.
//
// The subtle rule is WHICH shot a recording attaches to. A swing recorded
// now is the swing you are about to hit, so it belongs to the NEXT shot
// logged — never the previous one, which was a different swing.

const SESSION = {
  date: '2026-09-19', start_time: '10:00', target_ball_count: 30,
  default_club: '9i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
};
const SHOT = { club: '9i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 125 };

function video(db, sessionId, n = 1) {
  return db.createSwingVideo({
    media_ref: `swing/v${n}/original`, range_session_id: sessionId,
    camera_view: 'down_the_line', club: '9i',
  });
}

describe('A recording attaches to the NEXT shot, never the previous one', () => {
  test('a shot logged before recording is untouched', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    const first = db.addShot(s.session_id, SHOT);

    const v = video(db, s.session_id);
    db.setPendingSwingVideo(v.swing_video_id);

    // The earlier shot was a different swing.
    assert.equal(db.getShotsForSession(s.session_id)[0].swing_video_id, undefined);
    assert.equal(db.getSwingVideoForShot(first.shot_id), null);
  });

  test('the next shot logged picks it up automatically', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    db.addShot(s.session_id, SHOT);
    const v = video(db, s.session_id);
    db.setPendingSwingVideo(v.swing_video_id);

    const second = db.addShot(s.session_id, SHOT);

    const linked = db.getSwingVideo(v.swing_video_id);
    assert.equal(linked.association_state, 'linked');
    assert.equal(linked.shot_id, second.shot_id);
    assert.equal(db.getShotsForSession(s.session_id)[1].swing_video_id, v.swing_video_id);
  });

  test('no question is asked — linking happens inside addShot', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    const v = video(db, s.session_id);
    db.setPendingSwingVideo(v.swing_video_id);
    // No UI call, no confirmation: just a shot.
    const shot = db.addShot(s.session_id, SHOT);
    assert.equal(db.getSwingVideoForShot(shot.shot_id).swing_video_id, v.swing_video_id);
  });

  test('a shot logged with nothing pending is completely ordinary', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    const shot = db.addShot(s.session_id, SHOT);
    assert.equal(shot.swing_video_id, undefined);
    assert.equal(db.getSwingVideoForShot(shot.shot_id), null);
    assert.equal(db.listSwingVideos().length, 0);
  });

  test('only the pending video links — an already-linked one is left alone', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    const v1 = video(db, s.session_id, 1);
    db.setPendingSwingVideo(v1.swing_video_id);
    const shot1 = db.addShot(s.session_id, SHOT);
    const shot2 = db.addShot(s.session_id, SHOT);

    assert.equal(db.getSwingVideo(v1.swing_video_id).shot_id, shot1.shot_id);
    assert.equal(db.getSwingVideoForShot(shot2.shot_id), null);
  });
});

describe('Recording twice before logging a shot', () => {
  test('the older swing is kept as unpaired, the newer one becomes pending', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    const v1 = video(db, s.session_id, 1);
    db.setPendingSwingVideo(v1.swing_video_id);
    const v2 = video(db, s.session_id, 2);
    const res = db.setPendingSwingVideo(v2.swing_video_id);

    // Nothing is deleted and nothing blocks (§18).
    assert.equal(res.demoted.swing_video_id, v1.swing_video_id);
    assert.equal(db.getSwingVideo(v1.swing_video_id).association_state, 'unpaired');
    assert.equal(db.getSwingVideo(v2.swing_video_id).association_state, 'pending');
    assert.equal(db.listSwingVideos().length, 2);
  });

  test('at most one video is ever pending in a session', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    for (let i = 1; i <= 4; i++) db.setPendingSwingVideo(video(db, s.session_id, i).swing_video_id);
    const pendingCount = db.listSwingVideosForSession(s.session_id)
      .filter((v) => v.association_state === 'pending').length;
    assert.equal(pendingCount, 1);
  });

  test('the next shot links only the newest, leaving the rest unpaired', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    const v1 = video(db, s.session_id, 1);
    db.setPendingSwingVideo(v1.swing_video_id);
    const v2 = video(db, s.session_id, 2);
    db.setPendingSwingVideo(v2.swing_video_id);
    const shot = db.addShot(s.session_id, SHOT);

    assert.equal(db.getSwingVideo(v2.swing_video_id).shot_id, shot.shot_id);
    assert.equal(db.getSwingVideo(v1.swing_video_id).shot_id, null);
  });
});

describe('Unpaired swings are a normal outcome, not a failure', () => {
  test('ending the session settles a pending swing rather than losing it', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    const v = video(db, s.session_id);
    db.setPendingSwingVideo(v.swing_video_id);

    db.finishSession(s.session_id);

    const after = db.getSwingVideo(v.swing_video_id);
    assert.equal(after.association_state, 'unpaired');
    assert.equal(after.range_session_id, s.session_id, 'it keeps its session');
    assert.equal(after.camera_view, 'down_the_line', 'and its recording context');
  });

  test('a pending swing survives a reload and is still pending', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    const v = video(db, s.session_id);
    db.setPendingSwingVideo(v.swing_video_id);

    db.__resetForTests();
    const fresh = await import('../js/db.js');
    assert.equal(fresh.getPendingSwingVideo(s.session_id).swing_video_id, v.swing_video_id);
    // And still links to the next shot after the reload.
    const shot = fresh.addShot(s.session_id, SHOT);
    assert.equal(fresh.getSwingVideo(v.swing_video_id).shot_id, shot.shot_id);
  });

  test('videos from V4.3 Phase 1 normalize to a sensible state', async () => {
    const db = await resetDB();
    db.importFullDB({
      schemaVersion: 6, sessions: [], shots: [], settings: {},
      swing_videos: [
        { swing_video_id: 'a', media_ref: 'swing/a/original' },
        { swing_video_id: 'b', media_ref: 'swing/b/original', shot_id: 'shot-1' },
      ],
    });
    assert.equal(db.getSwingVideo('a').association_state, 'unpaired');
    assert.equal(db.getSwingVideo('b').association_state, 'linked');
  });
});

describe('Deleting one never deletes the other', () => {
  test('deleting the shot keeps the video, as unpaired', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    const v = video(db, s.session_id);
    db.setPendingSwingVideo(v.swing_video_id);
    const shot = db.addShot(s.session_id, SHOT);

    db.deleteShots(s.session_id, [shot.shot_id]);

    const after = db.getSwingVideo(v.swing_video_id);
    assert.ok(after, 'the video survives');
    assert.equal(after.association_state, 'unpaired');
    assert.equal(after.shot_id, null);
  });

  test('undoing the last shot unpairs rather than destroys', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    const v = video(db, s.session_id);
    db.setPendingSwingVideo(v.swing_video_id);
    db.addShot(s.session_id, SHOT);

    db.deleteLastShot(s.session_id);

    assert.equal(db.getSwingVideo(v.swing_video_id).association_state, 'unpaired');
    assert.equal(db.getShotsForSession(s.session_id).length, 0);
  });

  test('deleting the video leaves the shot and its outcome untouched', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    const v = video(db, s.session_id);
    db.setPendingSwingVideo(v.swing_video_id);
    const shot = db.addShot(s.session_id, SHOT);

    db.deleteSwingVideo(v.swing_video_id);

    const kept = db.getShotsForSession(s.session_id)[0];
    assert.equal(kept.shot_id, shot.shot_id);
    assert.equal(kept.strike, 'solid');
    assert.equal(kept.distance_yards, 125);
  });
});

describe('Editing a shot outcome keeps the association', () => {
  test('a corrected strike or distance does not re-run linking', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    const v = video(db, s.session_id);
    db.setPendingSwingVideo(v.swing_video_id);
    const shot = db.addShot(s.session_id, SHOT);

    db.updateShot(s.session_id, shot.shot_id, { strike: 'thin', distance_yards: 110 });

    const linked = db.getSwingVideoForShot(shot.shot_id);
    assert.equal(linked.swing_video_id, v.swing_video_id);
    assert.equal(linked.association_state, 'linked');
    // The outcome is read from the shot, which is now the corrected one.
    assert.equal(db.getShotsForSession(s.session_id)[0].strike, 'thin');
  });
});
