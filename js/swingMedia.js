// Swing Lab media orchestration — the one place that knows both halves.
//
// db.js owns records and is synchronous localStorage. media.js owns bytes
// and is asynchronous IndexedDB. Neither should know about the other, so
// the ordering rules that keep them consistent live here.
//
// Two rules, and both exist because a phone can be interrupted at any point:
//
//   IMPORT  bytes first, then the record. A crash between them leaves
//           orphaned bytes — invisible, swept later. The other order would
//           leave a record pointing at nothing, which the golfer can see.
//   DELETE  record first, then the bytes. Same reasoning, same direction.
//
// Phase 1 scope (import, store, reload, play, delete). No analysis, no
// thumbnails beyond one still, no pairing.

import * as db from './db.js';
import * as media from './media.js';
import { readVideoMetadata } from './mediaMeta.js';

// Wide enough for a slow-motion swing and a little runway either side, and
// narrow enough that a golfer cannot accidentally import an hour of footage
// and fill their phone. Not an analysis limit — §7.2's windowing handles
// long clips — purely a storage guard for Phase 1.
export const MAX_IMPORT_BYTES = 500 * 1024 * 1024;

const THUMB_MAX_EDGE = 320;
// Far enough in to miss a black first frame, early enough to be the address
// position in a typical swing clip.
const THUMB_SEEK_RATIO = 0.1;

const mediaKey = (id) => `swing/${id}/original`;
const thumbKey = (id) => `swing/${id}/thumb`;

// One still for list and detail views, so neither has to decode a 60 MB
// file to show a picture. Derived and disposable: if it cannot be made,
// import still succeeds and the caller shows a placeholder.
export function generateThumbnail(file, { maxEdge = THUMB_MAX_EDGE } = {}) {
  return new Promise((resolve) => {
    let url = null;
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let settled = false;
    const finish = (blob) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      try { video.load(); } catch { /* best effort */ }
      if (url) URL.revokeObjectURL(url);
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), 10000);

    const draw = () => {
      try {
        // videoWidth/Height are PRESENTATION dimensions, so rotation is
        // already applied and the thumbnail comes out the right way up
        // without reading the container's matrix.
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) { finish(null); return; }
        const scale = Math.min(1, maxEdge / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob), 'image/jpeg', 0.7);
      } catch { finish(null); }
    };

    video.onloadedmetadata = () => {
      const target = (video.duration && Number.isFinite(video.duration))
        ? video.duration * THUMB_SEEK_RATIO
        : 0;
      video.onseeked = draw;
      try { video.currentTime = target; } catch { draw(); }
    };
    video.onerror = () => finish(null);

    try { url = URL.createObjectURL(file); video.src = url; }
    catch { finish(null); }
  });
}

// Import result shapes, so callers never parse an error string:
//   { ok: true, video }
//   { ok: false, reason: 'no_file' | 'too_large' | 'undecodable' | 'quota'
//                       | 'write_failed' | 'record_failed', detail? }
export async function importSwingVideo(file, fields = {}) {
  if (!file) return { ok: false, reason: 'no_file' };
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, reason: 'too_large', detail: { sizeBytes: file.size, maxBytes: MAX_IMPORT_BYTES } };
  }

  // Ask the browser what it can actually decode. NOT canPlayType — real
  // iPhone HEVC reports "" there and plays perfectly.
  const meta = await readVideoMetadata(file);
  if (!meta.ok) return { ok: false, reason: 'undecodable', detail: { cause: meta.reason } };

  // Advisory: refuse before writing rather than fail halfway through.
  const room = await media.hasRoomFor(file.size);
  if (room.known && !room.fits) {
    return { ok: false, reason: 'quota', detail: room };
  }

  // The id has to exist before the bytes, because the media key is built
  // from it — and the record is written last, so a failed write never
  // leaves a half-made record behind.
  const swingId = db.newSwingVideoId();
  const key = mediaKey(swingId);

  const write = await media.putMedia(key, file);
  if (!write.ok) return { ok: false, reason: write.reason || 'write_failed', detail: write };

  // Persistence is requested at the FIRST save, never at launch — a storage
  // prompt before anything is stored is how apps get deleted. Failure here
  // is not an import failure; the video is already written.
  try { await media.requestPersistence(); } catch { /* advisory */ }

  // Derived and optional. A thumbnail that will not render must not cost
  // the golfer their import.
  let thumbRef = null;
  const thumb = await generateThumbnail(file);
  if (thumb) {
    const tk = thumbKey(swingId);
    const tw = await media.putMedia(tk, thumb);
    if (tw.ok) thumbRef = tk;
  }

  const record = db.createSwingVideo({
    ...fields,
    swing_video_id: swingId,
    original_filename: meta.filename,
    duration_ms: meta.durationMs,
    width: meta.containerWidth,
    height: meta.containerHeight,
    display_width: meta.displayWidth,
    display_height: meta.displayHeight,
    rotation_deg: meta.rotationDeg,
    fps: meta.fps,
    variable_frame_rate: meta.variableFrameRate,
    frame_count: meta.frameCount,
    size_bytes: meta.sizeBytes,
    container: meta.container,
    codec: meta.codec,
    mime: meta.reportedType,
    media_ref: key,
    thumb_ref: thumbRef,
  });

  if (!record) {
    // The record is the thing that makes bytes findable. Without it they
    // are garbage, so they go immediately rather than waiting for a sweep.
    await media.deleteMedia(key);
    if (thumbRef) await media.deleteMedia(thumbRef);
    return { ok: false, reason: 'record_failed' };
  }
  return { ok: true, video: record };
}

// An object URL for playback, or null when the bytes are gone.
//
// Discovering eviction is a side effect of trying to read: there is no
// event for it. A miss marks the record so every later screen can say "no
// longer on this device" instead of showing a broken player.
//
// The caller MUST revoke the returned url — see releasePlayback.
export async function openForPlayback(swingVideoId) {
  const record = db.getSwingVideo(swingVideoId);
  if (!record) return { ok: false, reason: 'no_record' };
  const blob = await media.getMedia(record.media_ref);
  if (!blob) {
    db.markSwingVideoMissing(swingVideoId);
    return { ok: false, reason: 'media_missing', video: db.getSwingVideo(swingVideoId) };
  }
  // A Blob URL, never an HTTP URL. It never reaches the service worker, so
  // user media cannot enter the app-shell cache, and it seeks natively —
  // which HTTP without Range support does not.
  return { ok: true, url: URL.createObjectURL(blob), blob, video: record };
}

export function releasePlayback(url) {
  if (url) { try { URL.revokeObjectURL(url); } catch { /* already gone */ } }
}

export async function getThumbnailUrl(swingVideoId) {
  const record = db.getSwingVideo(swingVideoId);
  if (!record?.thumb_ref) return null;
  const blob = await media.getMedia(record.thumb_ref);
  return blob ? URL.createObjectURL(blob) : null;
}

// Removes the record, then the bytes. Returns what was removed so a caller
// can offer Undo later; Phase 1 does not.
export async function deleteSwingVideo(swingVideoId) {
  let removed;
  try { removed = db.deleteSwingVideo(swingVideoId); }
  catch (err) { return { ok: false, reason: 'record_delete_failed', detail: err?.code }; }
  if (!removed) return { ok: false, reason: 'no_record' };

  let bytesDeleted = 0;
  for (const ref of removed.mediaRefs) {
    if (await media.deleteMedia(ref)) bytesDeleted += 1;
  }
  // A failed byte delete is not a failed delete. The record is gone, so the
  // bytes are unreachable, and the next sweep collects them.
  return { ok: true, record: removed.record, bytesDeleted, refs: removed.mediaRefs };
}

// Reconciles the two halves. Run once at startup.
//
// Bytes nothing points at are deleted. Records whose bytes have gone are
// marked missing rather than removed, because the record still carries
// everything the golfer knows about that swing.
export async function reconcileMedia() {
  const refs = db.allSwingMediaRefs();
  const orphansRemoved = await media.sweepOrphans(refs);

  let markedMissing = 0;
  for (const v of db.listSwingVideos()) {
    if (v.media_state === 'missing') continue;
    if (!(await media.getMedia(v.media_ref))) {
      db.markSwingVideoMissing(v.swing_video_id);
      markedMissing += 1;
    }
  }
  return { orphansRemoved, markedMissing };
}

export async function storageStatus() {
  const report = await media.storageReport();
  const videos = db.listSwingVideos();
  const knownBytes = videos.reduce((sum, v) => sum + (v.size_bytes || 0), 0);
  return { ...report, swingVideoCount: videos.length, swingVideoBytes: knownBytes };
}
