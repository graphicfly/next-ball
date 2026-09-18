import * as db from '../db.js';
import * as swingMedia from '../swingMedia.js';
import { qs, qsa, escapeHtml, toast, fmtDate } from '../ui.js';

// Swing Lab media test bench — DEVELOPMENT ONLY.
//
// Reached at #/dev/media and deliberately not linked from anywhere. It is
// not Swing Lab and it is not product UX; it exists to exercise Phase 1's
// only promise — import, store, reload, play, delete — on a real device.
//
// Delete this file and its route when the real Swing Lab screens land.

function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function fmtDuration(ms) {
  if (ms == null) return '—';
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(2)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

// Every failure the import path can return, in words a person can act on.
// Internal browser errors are never shown (§5).
const IMPORT_MESSAGES = {
  no_file: 'No video was selected.',
  too_large: 'That video is too large to import.',
  undecodable: "That video can't be opened on this device.",
  quota: 'Not enough storage space for that video.',
  write_failed: "That video couldn't be saved. Please try again.",
  record_failed: "That video couldn't be saved. Please try again.",
};

export function renderDevMedia(root) {
  let objectUrl = null;

  function release() {
    swingMedia.releasePlayback(objectUrl);
    objectUrl = null;
  }

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="homeBtn">&larr; Home</button>
        <span class="screen-title">Media Test Bench</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">
        <p class="tiny muted">Development only — not Swing Lab. Import a swing, reload the app, play it again, delete it.</p>

        <div class="field">
          <button class="btn btn-primary" id="pickBtn">Import video</button>
          <input type="file" id="pickInput" accept="video/*" hidden />
          <div class="tiny muted" id="importStatus" style="margin-top:var(--space-2);"></div>
        </div>

        <div class="section-eyebrow">Storage</div>
        <div class="tiny muted" id="storageLine">…</div>

        <div class="section-eyebrow">Videos</div>
        <div id="videoList"></div>

        <video id="devPlayer" playsinline controls hidden style="width:100%;border-radius:12px;background:#000;margin-top:var(--space-3);"></video>
        <table id="metaTable" style="width:100%;font-size:var(--text-label);margin-top:var(--space-3);"></table>
      </div>
    </div>
  `;

  qs('#homeBtn', root).addEventListener('click', () => { release(); location.hash = '#/home'; });
  qs('#pickBtn', root).addEventListener('click', () => qs('#pickInput', root).click());

  qs('#pickInput', root).addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    // Cancelling the picker is an ordinary outcome, not an error.
    if (!file) { setStatus('Selection cancelled.'); return; }

    setStatus(`Reading ${escapeHtml(file.name)}…`);
    const res = await swingMedia.importSwingVideo(file, { camera_view: 'unknown' });
    if (!res.ok) {
      setStatus(IMPORT_MESSAGES[res.reason] || "That video couldn't be imported.");
      // The internal reason goes to the console for us, never to the screen.
      console.warn('[dev-media] import failed:', res.reason, res.detail);
      e.target.value = '';
      return;
    }
    setStatus(`Imported ${escapeHtml(res.video.original_filename || 'video')}.`);
    e.target.value = '';
    await refresh();
  });

  function setStatus(msg) { qs('#importStatus', root).innerHTML = msg; }

  async function refresh() {
    const status = await swingMedia.storageStatus();
    qs('#storageLine', root).textContent = status.supported
      ? `${fmtBytes(status.usageBytes)} used of ~${fmtBytes(status.quotaBytes)} (${status.percentUsed}%) · persisted: ${status.persisted} · ${status.swingVideoCount} video(s)`
      : `storage estimate unavailable · ${status.swingVideoCount} video(s)`;

    const videos = db.listSwingVideos();
    qs('#videoList', root).innerHTML = videos.length
      ? videos.map((v) => `
        <div class="session-card" data-id="${v.swing_video_id}">
          <div class="row1">
            <div class="date">${escapeHtml(v.original_filename || 'video')}</div>
            <div class="row1-right"><div class="balls">${fmtBytes(v.size_bytes)}</div></div>
          </div>
          <div class="foot-line">
            <span>${v.media_state === 'missing' ? 'No longer on this device' : `${v.display_width}×${v.display_height} · ${v.fps ? v.fps.toFixed(2) + ' fps' : 'fps unknown'}`}</span>
            <span>${escapeHtml(fmtDate(v.captured_at.slice(0, 10)))}</span>
          </div>
          <div class="row" style="display:flex;gap:var(--space-2);margin-top:var(--space-3);">
            <button class="btn btn-outline btn-sm play-btn" data-id="${v.swing_video_id}">Play</button>
            <button class="btn btn-danger btn-sm del-btn" data-id="${v.swing_video_id}">Delete</button>
          </div>
        </div>`).join('')
      : '<p class="tiny muted">No videos yet.</p>';

    qsa('.play-btn', root).forEach((b) => b.addEventListener('click', () => play(b.dataset.id)));
    qsa('.del-btn', root).forEach((b) => b.addEventListener('click', () => remove(b.dataset.id)));
  }

  async function play(id) {
    release();
    const res = await swingMedia.openForPlayback(id);
    const player = qs('#devPlayer', root);
    if (!res.ok) {
      player.hidden = true;
      setStatus(res.reason === 'media_missing'
        ? 'That video is no longer stored on this device.'
        : "That video couldn't be opened.");
      await refresh();
      return;
    }
    objectUrl = res.url;
    player.hidden = false;
    player.src = objectUrl;
    showMeta(res.video);
  }

  function showMeta(v) {
    const rows = [
      ['file', v.original_filename], ['container', v.container], ['codec', v.codec],
      ['reported mime', v.mime || '(none)'],
      ['container size', v.width && v.height ? `${v.width}×${v.height}` : '—'],
      ['presentation size', v.display_width && v.display_height ? `${v.display_width}×${v.display_height}` : '—'],
      ['rotation', v.rotation_deg == null ? '—' : `${v.rotation_deg}°`],
      ['duration', fmtDuration(v.duration_ms)],
      ['frames', v.frame_count ?? '—'],
      ['fps', v.fps == null ? 'unknown' : v.fps.toFixed(3)],
      ['variable frame rate', v.variable_frame_rate == null ? 'unknown' : String(v.variable_frame_rate)],
      ['file size', fmtBytes(v.size_bytes)],
      ['media ref', v.media_ref], ['media state', v.media_state],
    ];
    qs('#metaTable', root).innerHTML = rows.map(([k, val]) =>
      `<tr><td style="color:var(--color-text-tertiary);padding:3px 8px 3px 0;">${k}</td><td style="font-family:ui-monospace,monospace;word-break:break-all;">${escapeHtml(String(val ?? '—'))}</td></tr>`).join('');
  }

  async function remove(id) {
    release();
    qs('#devPlayer', root).hidden = true;
    const res = await swingMedia.deleteSwingVideo(id);
    setStatus(res.ok ? 'Deleted.' : "That video couldn't be deleted.");
    qs('#metaTable', root).innerHTML = '';
    await refresh();
  }

  refresh();
}
