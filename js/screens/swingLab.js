import * as db from '../db.js';
import * as swingMedia from '../swingMedia.js';
import { qs, qsa, escapeHtml, fmtDate, cap } from '../ui.js';

// Progress → Swing Lab.
//
// Every recorded swing, grouped by what can be done with it next rather
// than by what it lacks. An unpaired swing is listed exactly as a linked
// one is — it simply has no outcome line, which is a fact and not a
// failure (§17, §21).

const VIEW_LABEL = { face_on: 'Face On', down_the_line: 'Down the Line', unknown: 'Swing' };

function outcomeLine(video) {
  if (video.association_state !== 'linked' || !video.shot_id || !video.range_session_id) {
    return 'No shot result';
  }
  const shot = db.getShotsForSession(video.range_session_id).find((s) => s.shot_id === video.shot_id);
  if (!shot) return 'No shot result';
  const parts = [cap(shot.strike)];
  if (shot.direction) parts.push(shot.direction);
  if (shot.distance_yards != null) parts.push(`${shot.distance_yards} yd`);
  return parts.join(' · ');
}

function rowHtml(video, analysis) {
  const view = VIEW_LABEL[video.camera_view] || 'Swing';
  const date = fmtDate(String(video.captured_at).slice(0, 10));
  const missing = video.media_state === 'missing';
  return `
    <button class="swing-row" data-id="${video.swing_video_id}">
      <span class="swing-row-thumb" data-thumb="${video.swing_video_id}"></span>
      <span class="swing-row-text">
        <span class="swing-row-title">${escapeHtml(video.club || 'Swing')} &middot; ${escapeHtml(view)}</span>
        <span class="swing-row-sub">${escapeHtml(date)} &middot; ${escapeHtml(missing ? 'No longer on this device' : outcomeLine(video))}</span>
      </span>
      ${analysis ? '<span class="swing-row-tag">Analyzed</span>' : ''}
      <svg class="swing-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
    </button>`;
}

export function renderSwingLab(root) {
  const videos = db.listSwingVideos();
  const analysed = [];
  const ready = [];
  for (const v of videos) {
    (db.getLatestSwingAnalysis(v.swing_video_id) ? analysed : ready).push(v);
  }

  const section = (title, list) => list.length ? `
    <div class="section-eyebrow">${title}</div>
    ${list.map((v) => rowHtml(v, db.getLatestSwingAnalysis(v.swing_video_id))).join('')}` : '';

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; Progress</button>
        <span class="screen-title">Swing Lab</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">
        ${videos.length ? `
          <div class="swing-lab-count">${videos.length} swing${videos.length === 1 ? '' : 's'}</div>
          ${section('Ready to analyze', ready)}
          ${section('Analyzed', analysed)}
          <p class="tiny muted" style="margin-top:var(--space-5);">
            A swing with no logged shot still analyses — it just has no outcome to compare against.
          </p>`
        : `<p class="tiny muted" style="text-align:center;padding:var(--space-6) 0;">
             No swings yet. Record one from a range session.
           </p>`}
      </div>
    </div>
  `;

  qs('#backBtn', root).addEventListener('click', () => { location.hash = '#/progress'; });
  qsa('.swing-row', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      // Straight to the result when one exists; otherwise the preview,
      // which is where Analyze lives.
      location.hash = db.getLatestSwingAnalysis(id) ? `#/swing/result/${id}` : `#/swing/preview/${id}`;
    });
  });

  // Thumbnails load after the list paints, so a long list never waits on
  // media reads. Each is revoked when the screen is replaced.
  const urls = [];
  const cleanup = () => { urls.forEach((u) => swingMedia.releasePlayback(u)); window.removeEventListener('hashchange', cleanup); };
  window.addEventListener('hashchange', cleanup);
  (async () => {
    for (const v of videos) {
      const url = await swingMedia.getThumbnailUrl(v.swing_video_id);
      if (!url) continue;
      urls.push(url);
      const slot = root.querySelector(`[data-thumb="${v.swing_video_id}"]`);
      if (slot) slot.style.backgroundImage = `url(${url})`;
    }
  })();
}
