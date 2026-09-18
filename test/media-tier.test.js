import './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';
import * as media from '../js/media.js';

// V4.3 Phase 1 — the local media tier.
//
// Node has no IndexedDB, so media.js exposes a backend seam and these tests
// drive an in-memory double. That is deliberate: what matters here is the
// CONTRACT between records and bytes — the ordering rules that keep them
// consistent when a phone is interrupted — not IndexedDB's own behaviour,
// which the V4.3 spike already measured in a real browser.

function fakeBlob(bytes, type = 'video/mp4') {
  return { size: bytes, type, __fake: true };
}

// A backend that can be told to fail, so quota and write failures are
// tested rather than assumed.
function memoryBackend() {
  const map = new Map();
  const state = { failNext: null };
  return {
    state,
    map,
    async put(key, blob) {
      if (state.failNext) { const r = state.failNext; state.failNext = null; return r; }
      map.set(key, blob);
      return { ok: true };
    },
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async del(key) { return map.delete(key); },
    async keys() { return [...map.keys()]; },
    async clear() { map.clear(); return true; },
  };
}

let backend;
beforeEach(() => { backend = memoryBackend(); media.__setMediaBackendForTests(backend); });

describe('SwingVideo records — metadata only', () => {
  test('a record requires media_ref; a video that names no media is not a video', async () => {
    const db = await resetDB();
    assert.equal(db.createSwingVideo({}), null);
    assert.equal(db.createSwingVideo({ club: '7i' }), null);
    assert.ok(db.createSwingVideo({ media_ref: 'swing/a/original' }));
  });

  test('unknown metadata stays null and is never defaulted', async () => {
    const db = await resetDB();
    const v = db.createSwingVideo({ media_ref: 'swing/a/original' });
    // §3.1 forbids assuming 30 fps. The same applies to every field here:
    // a null means unknown, and a caller must treat it that way.
    assert.equal(v.fps, null);
    assert.equal(v.frame_count, null);
    assert.equal(v.variable_frame_rate, null);
    assert.equal(v.rotation_deg, null);
    assert.equal(v.duration_ms, null);
    assert.equal(v.camera_view, 'unknown');
    assert.equal(v.media_state, 'present');
  });

  test('container and presentation dimensions are both kept, because they disagree', async () => {
    const db = await resetDB();
    // Real iPhone footage: stored landscape with a rotation, decoded portrait.
    const v = db.createSwingVideo({
      media_ref: 'swing/a/original',
      width: 1920, height: 1080, rotation_deg: 90,
      display_width: 1080, display_height: 1920,
    });
    assert.equal(v.width, 1920);
    assert.equal(v.display_width, 1080);
    assert.equal(v.rotation_deg, 90);
  });

  test('30 fps is valid media — import never applies the analysis frame-rate rule', async () => {
    const db = await resetDB();
    const v = db.createSwingVideo({ media_ref: 'swing/a/original', fps: 29.998, variable_frame_rate: true });
    assert.equal(v.fps, 29.998);
    // Variable frame rate is recorded as a fact, because an average fps
    // over a variable clip is a number that lies.
    assert.equal(v.variable_frame_rate, true);
  });

  test('camera_view is constrained; anything unrecognised becomes unknown', async () => {
    const db = await resetDB();
    assert.equal(db.createSwingVideo({ media_ref: 'a', camera_view: 'face_on' }).camera_view, 'face_on');
    assert.equal(db.createSwingVideo({ media_ref: 'b', camera_view: 'down_the_line' }).camera_view, 'down_the_line');
    assert.equal(db.createSwingVideo({ media_ref: 'c', camera_view: 'sideways' }).camera_view, 'unknown');
  });

  test('records survive a reload and list newest-filmed first', async () => {
    const db = await resetDB();
    db.createSwingVideo({ media_ref: 'a', captured_at: '2026-09-01T10:00:00.000Z' });
    db.createSwingVideo({ media_ref: 'b', captured_at: '2026-09-17T10:00:00.000Z' });
    db.__resetForTests();
    const fresh = await import('../js/db.js');
    assert.deepEqual(fresh.listSwingVideos().map((v) => v.media_ref), ['b', 'a']);
  });

  test('associations are held, and are references rather than copies of anything', async () => {
    const db = await resetDB();
    const v = db.createSwingVideo({
      media_ref: 'a', lesson_id: 'lesson-1', range_session_id: 'session-1',
      active_focus_snapshot: { cue_text: 'Stay over it', lesson_id: 'lesson-1' },
    });
    assert.equal(v.lesson_id, 'lesson-1');
    assert.equal(v.range_session_id, 'session-1');
    // A COPY of the focus (lesson-spec.md §5.2): editing the lesson later
    // must not rewrite what this swing was filmed under.
    assert.equal(v.active_focus_snapshot.cue_text, 'Stay over it');
  });
});

describe('The media store', () => {
  test('bytes round-trip and are addressed by key', async () => {
    const blob = fakeBlob(1024);
    assert.deepEqual(await media.putMedia('k1', blob), { ok: true });
    assert.equal(await media.getMedia('k1'), blob);
    assert.deepEqual(await media.listMediaKeys(), ['k1']);
  });

  test('a missing key reads as null rather than throwing', async () => {
    assert.equal(await media.getMedia('nope'), null);
  });

  test('a quota failure is reported, not raised', async () => {
    backend.state.failNext = { ok: false, reason: 'quota', error: 'QuotaExceededError' };
    const res = await media.putMedia('k1', fakeBlob(99));
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'quota');
    assert.equal(await media.getMedia('k1'), null);
  });

  test('orphan sweeping deletes exactly the bytes nothing points at', async () => {
    await media.putMedia('keep', fakeBlob(1));
    await media.putMedia('orphan-1', fakeBlob(1));
    await media.putMedia('orphan-2', fakeBlob(1));
    assert.equal(await media.sweepOrphans(['keep']), 2);
    assert.deepEqual(await media.listMediaKeys(), ['keep']);
  });
});

describe('Import, playback and delete — the Phase 1 loop', () => {
  // The orchestration layer builds Blob URLs and decodes video, neither of
  // which exists in Node, so these exercise the record/byte contract that
  // db.js and media.js implement between them.

  async function importedVideo(db, { id = 'sv-1', bytes = 5_000_000 } = {}) {
    const key = `swing/${id}/original`;
    const thumb = `swing/${id}/thumb`;
    await media.putMedia(key, fakeBlob(bytes));
    await media.putMedia(thumb, fakeBlob(9000, 'image/jpeg'));
    return db.createSwingVideo({
      swing_video_id: id, media_ref: key, thumb_ref: thumb,
      size_bytes: bytes, fps: 29.998, duration_ms: 5000,
    });
  }

  test('a stored video is retrievable after a reload — record and bytes both', async () => {
    const db = await resetDB();
    await importedVideo(db);
    db.__resetForTests();
    const fresh = await import('../js/db.js');
    const v = fresh.listSwingVideos()[0];
    assert.equal(v.media_ref, 'swing/sv-1/original');
    assert.ok(await media.getMedia(v.media_ref), 'bytes survive the reload');
  });

  test('deleting removes the record and every byte it owned', async () => {
    const db = await resetDB();
    await importedVideo(db);
    const removed = db.deleteSwingVideo('sv-1');
    assert.equal(removed.mediaRefs.length, 2);
    for (const ref of removed.mediaRefs) await media.deleteMedia(ref);
    assert.equal(db.getSwingVideo('sv-1'), null);
    assert.deepEqual(await media.listMediaKeys(), [], 'no orphaned blobs');
  });

  test('an interrupted delete leaves orphaned bytes, never a dangling record', async () => {
    const db = await resetDB();
    await importedVideo(db);
    // Record deleted, then the process dies before the bytes are removed.
    db.deleteSwingVideo('sv-1');
    assert.equal(db.getSwingVideo('sv-1'), null);
    assert.equal((await media.listMediaKeys()).length, 2, 'bytes are orphaned');
    // Which the next sweep collects.
    assert.equal(await media.sweepOrphans(db.allSwingMediaRefs()), 2);
  });

  test('evicted media marks the record missing instead of losing it', async () => {
    const db = await resetDB();
    await importedVideo(db);
    // The browser reclaims space. There is no event for this; it is found
    // by trying to read.
    await media.deleteMedia('swing/sv-1/original');

    const v = db.getSwingVideo('sv-1');
    assert.equal(await media.getMedia(v.media_ref), null);
    db.markSwingVideoMissing('sv-1');

    const after = db.getSwingVideo('sv-1');
    assert.equal(after.media_state, 'missing');
    // Everything the golfer knows about the swing is still there.
    assert.equal(after.fps, 29.998);
    assert.equal(after.duration_ms, 5000);
  });

  test('allSwingMediaRefs covers thumbnails as well as originals', async () => {
    const db = await resetDB();
    await importedVideo(db, { id: 'a' });
    await importedVideo(db, { id: 'b' });
    const refs = db.allSwingMediaRefs();
    assert.equal(refs.length, 4);
    assert.ok(refs.includes('swing/a/thumb'));
  });
});

describe('Swing Lab media cannot corrupt the rest of Next Ball', () => {
  test('video bytes never enter localStorage', async () => {
    const db = await resetDB();
    await media.putMedia('swing/x/original', fakeBlob(40_000_000));
    db.createSwingVideo({ media_ref: 'swing/x/original', size_bytes: 40_000_000 });
    const raw = localStorage.getItem('rangelog_index_v1');
    // The index holds a KEY, not bytes — so the whole app's storage budget
    // is not consumed by one video.
    assert.ok(raw.includes('swing/x/original'));
    assert.ok(raw.length < 100_000, `index stayed small (${raw.length} bytes)`);
  });

  test('a failed video import leaves sessions, rounds and lessons untouched', async () => {
    const db = await resetDB();
    const s = db.createSession({
      date: '2026-09-17', start_time: '10:00', target_ball_count: 50,
      default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
    });
    const l = db.createLesson({ date: '2026-09-17', cues: ['Stay over it'] });

    backend.state.failNext = { ok: false, reason: 'quota' };
    const res = await media.putMedia('swing/y/original', fakeBlob(99));
    assert.equal(res.ok, false);

    assert.equal(db.listSessions().length, 1);
    assert.equal(db.getSession(s.session_id).session_id, s.session_id);
    assert.equal(db.listLessons().length, 1);
    assert.equal(db.getLesson(l.lesson_id).cues[0].text, 'Stay over it');
    assert.equal(db.listSwingVideos().length, 0);
  });

  test('backups carry video METADATA and never bytes', async () => {
    const db = await resetDB();
    await importedVideo_(db);
    const dump = db.getDB();
    assert.equal(dump.swing_videos.length, 1);
    assert.equal(dump.swing_videos[0].media_ref, 'swing/b1/original');
    assert.ok(!JSON.stringify(dump).includes('__fake'), 'no blob content in the backup');
  });

  async function importedVideo_(db) {
    await media.putMedia('swing/b1/original', fakeBlob(1000));
    return db.createSwingVideo({ swing_video_id: 'b1', media_ref: 'swing/b1/original', size_bytes: 1000 });
  }

  test('a pre-V4.3 backup restores cleanly and gains the collection', async () => {
    const db = await resetDB();
    db.importFullDB({ schemaVersion: 5, sessions: [], shots: [], settings: {} });
    assert.deepEqual(db.listSwingVideos(), []);
  });

  test('a restored backup describes media that is not on this device', async () => {
    const db = await resetDB();
    db.importFullDB({
      schemaVersion: 6, sessions: [], shots: [], settings: {},
      swing_videos: [{ swing_video_id: 'r1', media_ref: 'swing/r1/original', captured_at: '2026-09-01T00:00:00.000Z' }],
    });
    const v = db.getSwingVideo('r1');
    // Normalised on load, and the bytes genuinely are not here.
    assert.equal(v.media_state, 'present');
    assert.equal(v.camera_view, 'unknown');
    assert.equal(await media.getMedia(v.media_ref), null);
    db.markSwingVideoMissing('r1');
    assert.equal(db.getSwingVideo('r1').media_state, 'missing');
  });
});
