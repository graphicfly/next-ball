import * as db from '../db.js';
import * as swingMedia from '../swingMedia.js';
import { qs, escapeHtml, toast, fmtDate } from '../ui.js';

// Pending Preview — the approved frame 6.
//
// Reached from "Swing captured" while a swing waits for its shot, and from
// Swing Lab for any stored swing. Analyze is available BEFORE the shot is
// logged: the movement is analysable on its own, and the outcome simply is
// not there yet.

export function renderSwingPreview(root, swingVideoId) {
  const video = db.getSwingVideo(swingVideoId);
  if (!video) { location.hash = '#/swing-lab'; return; }

  let objectUrl = null;
  const myHash = location.hash;
  const release = () => { swingMedia.releasePlayback(objectUrl); objectUrl = null; };
  const onHash = () => { if (location.hash !== myHash) { release(); window.removeEventListener('hashchange', onHash); } };
  window.addEventListener('hashchange', onHash);

  const session = video.range_session_id ? db.getSession(video.range_session_id) : null;
  const live = session && session.status !== 'finished';
  const analysis = db.getLatestSwingAnalysis(swingVideoId);
  const view = video.camera_view === 'face_on' ? 'Face On'
    : video.camera_view === 'down_the_line' ? 'Down the Line' : 'Swing';

  const status = video.association_state === 'pending' ? 'Waiting for shot result'
    : video.association_state === 'linked' ? 'Linked to a shot'
      : 'No shot result';

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="closeBtn" aria-label="Close">&larr; ${live ? 'Practice' : 'Swing Lab'}</button>
        <span class="swing-chip">${escapeHtml(view)}${video.club ? ` &middot; ${escapeHtml(video.club)}` : ''}</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">
        <video id="player" playsinline controls loop class="swing-video"></video>
        <div class="tiny muted center" id="mediaNote" style="margin-top:var(--space-2);">${escapeHtml(status)}</div>

        <div class="swing-actions">
          <button class="btn btn-primary" id="analyzeBtn">${analysis ? 'View analysis' : 'Analyze'}</button>
          ${analysis ? '<button class="btn btn-outline" id="reanalyzeBtn">Analyze again</button>' : ''}
          <button class="btn btn-danger" id="deleteBtn">Delete this swing</button>
        </div>
        <div class="tiny muted center" style="margin-bottom:var(--space-6);">
          ${escapeHtml(fmtDate(String(video.captured_at).slice(0, 10)))}
        </div>
      </div>
    </div>
  `;

  qs('#closeBtn', root).addEventListener('click', () => {
    release();
    // Returning to a live session must land back in practice, not Home.
    location.hash = live ? '#/active' : '#/swing-lab';
  });

  qs('#analyzeBtn', root).addEventListener('click', () => {
    release();
    // An existing analysis is reopened rather than recomputed.
    location.hash = analysis ? `#/swing/result/${swingVideoId}` : `#/swing/analyze/${swingVideoId}`;
  });
  qs('#reanalyzeBtn', root)?.addEventListener('click', () => {
    release();
    location.hash = `#/swing/analyze/${swingVideoId}`;
  });

  qs('#deleteBtn', root).addEventListener('click', async () => {
    release();
    const res = await swingMedia.deleteSwingVideo(swingVideoId);
    toast(res.ok ? 'Swing deleted' : "That swing couldn't be deleted");
    location.hash = live ? '#/active' : '#/swing-lab';
  });

  (async function load() {
    const res = await swingMedia.openForPlayback(swingVideoId);
    if (location.hash !== myHash) { swingMedia.releasePlayback(res.url); return; }
    if (!res.ok) {
      // Eviction is an ordinary outcome, stated as a fact about the device.
      qs('#mediaNote', root).textContent = 'This video is no longer stored on this device.';
      qs('#player', root).hidden = true;
      qs('#analyzeBtn', root).disabled = true;
      return;
    }
    objectUrl = res.url;
    qs('#player', root).src = objectUrl;
  })();
}
