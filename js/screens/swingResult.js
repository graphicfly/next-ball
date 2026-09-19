import * as db from '../db.js';
import * as swingMedia from '../swingMedia.js';
import { qs, qsa, escapeHtml, toast, cap } from '../ui.js';
import { MEASUREMENT_GROUPS, MEASUREMENT_LABELS, formatMeasurement, topObservation } from '../swingMeasure.js';
import { buildSwingAnalysisContext } from '../swingContext.js';

// Swing Analysis result, and the runner that produces it.
//
// One dominant idea, then progressive disclosure — the analysis screen is
// not a dashboard (swing-lab-spec.md §10). The video and one observation
// carry the screen; checkpoints, measurements, tempo and quality are all
// behind a tap.
//
// The engine is imported lazily, so opening a stored result never loads it.

const VIEW_LABEL = { face_on: 'Face On', down_the_line: 'Down the Line', unknown: 'Swing' };
const CHECKPOINTS = ['address', 'takeaway', 'top', 'impact', 'finish'];
const PHASE_LABEL = { address: 'Address', takeaway: 'Takeaway', top: 'Top', impact: 'Impact', finish: 'Finish' };

const STAGE_COPY = {
  preparing_video: 'Preparing video',
  finding_swings: 'Finding swings',
  analyzing_movement: 'Analyzing movement',
  building_results: 'Building results',
};

const FAIL_COPY = {
  no_record: "That swing couldn't be found.",
  media_missing: 'This video is no longer stored on this device.',
  engine_load_failed: "The analysis engine couldn't load. Check your connection and try again.",
  cancelled: 'Analysis cancelled.',
  busy: 'Another swing is being analyzed. Wait for it to finish, then try again.',
  analysis_failed: "That swing couldn't be analyzed.",
};

// ---------- runner ----------

export function renderSwingAnalyze(root, swingVideoId) {
  const video = db.getSwingVideo(swingVideoId);
  if (!video) { location.hash = '#/swing-lab'; return; }

  const controller = new AbortController();
  const myHash = location.hash;
  let finished = false;
  const onHash = () => {
    if (location.hash !== myHash && !finished) controller.abort();
    if (location.hash !== myHash) window.removeEventListener('hashchange', onHash);
  };
  window.addEventListener('hashchange', onHash);

  root.innerHTML = `
    <div class="screen">
      <div class="topbar"><span class="side-space"></span><span class="screen-title">Analyzing</span><span class="side-space"></span></div>
      <div class="scroll analyze-wait">
        <div class="analyze-spinner" aria-hidden="true"></div>
        <div class="analyze-stage" id="stage" role="status" aria-live="polite">Preparing video</div>
        <div class="analyze-progress"><i id="bar"></i></div>
        <p class="tiny muted" id="hint">This runs on your phone. It can take a little while.</p>
        <button class="btn btn-outline" id="cancelBtn">Cancel</button>
      </div>
    </div>
  `;
  qs('#cancelBtn', root).addEventListener('click', () => { controller.abort(); location.hash = `#/swing/preview/${swingVideoId}`; });

  (async () => {
    // Lazy: the engine is fetched here, never at startup.
    const engine = await import('../swingAnalysis.js');
    const res = await engine.analyzeSwing(swingVideoId, {
      signal: controller.signal,
      onStage: (stage, progress) => {
        if (location.hash !== myHash) return;
        const el = qs('#stage', root);
        if (el && STAGE_COPY[stage]) el.textContent = STAGE_COPY[stage];
        // A real fraction during the passes, and nothing invented outside
        // them — a fake linear percentage is worse than none (§20).
        const bar = qs('#bar', root);
        if (bar && progress?.fraction != null) bar.style.width = `${Math.round(progress.fraction * 100)}%`;
      },
    });
    finished = true;
    if (location.hash !== myHash) return;

    if (!res.ok) {
      if (res.reason === 'cancelled') { location.hash = `#/swing/preview/${swingVideoId}`; return; }
      renderFailure(root, swingVideoId, res.reason);
      return;
    }
    location.hash = `#/swing/result/${swingVideoId}`;
  })();
}

function renderFailure(root, swingVideoId, reason) {
  const video = db.getSwingVideo(swingVideoId);
  const live = video?.range_session_id && db.getSession(video.range_session_id)?.status !== 'finished';
  root.innerHTML = `
    <div class="screen">
      <div class="topbar"><span class="side-space"></span><span class="screen-title">Analysis</span><span class="side-space"></span></div>
      <div class="scroll analyze-wait">
        <div class="analyze-fail">Couldn't analyze</div>
        <p class="tiny muted">${escapeHtml(FAIL_COPY[reason] || FAIL_COPY.analysis_failed)}</p>
        <p class="tiny muted">Your swing video and your shot are both safe.</p>
        <div class="swing-actions">
          ${reason !== 'media_missing' ? '<button class="btn btn-primary" id="retryBtn">Try again</button>' : ''}
          <button class="btn btn-outline" id="backBtn">${live ? 'Back to practice' : 'Back to Swing Lab'}</button>
        </div>
      </div>
    </div>
  `;
  qs('#retryBtn', root)?.addEventListener('click', () => renderSwingAnalyze(root, swingVideoId));
  qs('#backBtn', root).addEventListener('click', () => { location.hash = live ? '#/active' : '#/swing-lab'; });
}

// ---------- result ----------

export function renderSwingResult(root, swingVideoId) {
  const video = db.getSwingVideo(swingVideoId);
  const analysis = db.getLatestSwingAnalysis(swingVideoId);
  if (!video) { location.hash = '#/swing-lab'; return; }
  if (!analysis) { location.hash = `#/swing/preview/${swingVideoId}`; return; }

  const ctx = buildSwingAnalysisContext(swingVideoId);
  const live = video.range_session_id && db.getSession(video.range_session_id)?.status !== 'finished';
  let objectUrl = null;
  let poseOn = false;
  const myHash = location.hash;
  const release = () => { swingMedia.releasePlayback(objectUrl); objectUrl = null; };
  const onHash = () => { if (location.hash !== myHash) { release(); window.removeEventListener('hashchange', onHash); } };
  window.addEventListener('hashchange', onHash);

  const view = VIEW_LABEL[analysis.camera_view] || 'Swing';
  const quality = analysis.video_quality || {};
  const standard = analysis.capability !== 'full';
  const top = topObservation(analysis.measurements, analysis.detected_phases, quality);
  const phases = Object.fromEntries((analysis.detected_phases || []).map((p) => [p.phase, p]));

  const shotLine = ctx?.shot_outcome
    ? [cap(ctx.shot_outcome.strike), ctx.shot_outcome.direction, ctx.shot_outcome.distance_yards != null ? `${ctx.shot_outcome.distance_yards} yd` : null].filter(Boolean).join(' · ')
    : null;
  const focus = ctx?.active_focus_snapshot?.cue_text || null;

  const tempo = ['backswing_ms', 'downswing_ms', 'tempo_ratio']
    .map((k) => (analysis.measurements || []).find((m) => m.key === k))
    .filter((m) => m && !m.withheld);

  const groups = MEASUREMENT_GROUPS
    .map((g) => ({
      title: g.title,
      items: g.keys
        .map((k) => (analysis.measurements || []).find((m) => m.key === k))
        // Unsupported measurements are hidden, never shown as empty cards.
        .filter((m) => m && !m.withheld && m.value != null),
    }))
    .filter((g) => g.items.length);

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; ${live ? 'Practice' : 'Swing Lab'}</button>
        <span class="screen-title">Swing Analysis</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">
        <div class="swing-result-head">
          <div class="swing-result-title">${escapeHtml(video.club || 'Swing')} &middot; ${escapeHtml(view)}</div>
          ${shotLine ? `<div class="swing-result-shot">${escapeHtml(shotLine)}</div>` : ''}
          ${focus ? `<div class="swing-result-focus"><span>Current focus</span>${escapeHtml(focus)}</div>` : ''}
        </div>

        <div class="swing-stage">
          <video id="player" playsinline controls loop class="swing-video"></video>
          <canvas id="overlay" class="swing-overlay" hidden aria-hidden="true"></canvas>
        </div>
        <div class="swing-toolbar">
          <button class="swing-toggle" id="poseBtn" aria-pressed="false">Pose off</button>
          <span class="tiny muted" id="frameNote"></span>
        </div>

        ${top ? `
          <div class="section-eyebrow">Stood out</div>
          <p class="swing-standout">${escapeHtml(top.text)}</p>` : ''}

        ${Object.keys(phases).length ? `
          <div class="section-eyebrow">Checkpoints</div>
          <div class="swing-checkpoints">
            ${CHECKPOINTS.map((name) => {
              const p = phases[name];
              const available = p && p.frame_index != null && p.time_ms != null;
              return `<button class="swing-checkpoint${available ? '' : ' unavailable'}"
                        data-time="${available ? p.time_ms : ''}" ${available ? '' : 'disabled'}>
                <span>${PHASE_LABEL[name]}</span>
                <span class="swing-checkpoint-note">${available
                  ? (p.exactness === 'approximate' ? 'approximate' : '')
                  : 'not found'}</span>
              </button>`;
            }).join('')}
          </div>` : ''}

        ${tempo.length ? `
          <details class="swing-details"><summary>Tempo</summary>
            ${tempo.map((m) => `<div class="swing-metric"><span>${escapeHtml(MEASUREMENT_LABELS[m.key] || m.key)}</span><b>${escapeHtml(formatMeasurement(m))}</b></div>`).join('')}
          </details>`
        : `<details class="swing-details"><summary>Tempo</summary>
            <p class="tiny muted">Tempo needs 60 fps or higher. At ${Math.round(quality.effectiveFps || 30)} fps too few frames span the fastest part of the swing to time it honestly.</p>
          </details>`}

        ${groups.length ? `
          <details class="swing-details"><summary>Movement</summary>
            ${groups.map((g) => `
              <div class="swing-metric-group">${escapeHtml(g.title)}</div>
              ${g.items.map((m) => `<div class="swing-metric">
                <span>${escapeHtml(MEASUREMENT_LABELS[m.key] || m.key)}</span>
                <b>${escapeHtml(formatMeasurement(m))}</b>
                ${m.confidence === 'low' ? '<em class="swing-metric-conf">low confidence</em>' : ''}
              </div>`).join('')}`).join('')}
            <p class="tiny muted">Distances are relative to your shoulder width — 2D video carries no real-world scale.</p>
          </details>` : ''}

        <details class="swing-details"><summary>Analysis quality</summary>
          <div class="swing-metric"><span>Level</span><b>${standard ? 'Standard analysis' : 'Fuller analysis'}</b></div>
          <div class="swing-metric"><span>Frame rate</span><b>${quality.effectiveFps ? `${Math.round(quality.effectiveFps)} fps` : 'unknown'}</b></div>
          <div class="swing-metric"><span>Frames analyzed</span><b>${quality.framesWithPose ?? '—'}</b></div>
          <div class="swing-metric"><span>Hands visible</span><b>${quality.visibility?.wrists != null ? `${Math.round(quality.visibility.wrists * 100)}%` : '—'}</b></div>
          <div class="swing-metric"><span>Lower body visible</span><b>${quality.visibility?.hips != null ? `${Math.round(quality.visibility.hips * 100)}%` : '—'}</b></div>
          ${quality.tracking_drift != null ? `<div class="swing-metric"><span>Body tracking</span><b>${quality.tracking_steady === false ? 'unsteady' : 'steady'} &middot; ${quality.tracking_drift}&times;</b>
            ${quality.tracking_steady === false ? '<em class="swing-metric-conf">no positions measured</em>' : ''}</div>` : ''}
          ${standard ? '<p class="tiny muted">Impact timing and fast hand movement are limited at this frame rate. Record in slow motion for a fuller reading.</p>' : ''}
          <div class="swing-metric"><span>Engine</span><b>v${analysis.analysis_version} &middot; ${escapeHtml(analysis.pose_model_version || '')}</b></div>
          ${analysis.timing ? `<div class="swing-metric"><span>Analysis time</span><b>${(analysis.timing.totalMs / 1000).toFixed(1)}s</b></div>
          <div class="swing-metric"><span>Coarse / dense</span><b>${analysis.timing.coarseMs}ms / ${analysis.timing.denseMs}ms</b></div>
          <div class="swing-metric"><span>Model load</span><b>${analysis.timing.modelMs}ms</b></div>` : ''}
        </details>

        <div class="swing-actions">
          <button class="btn btn-primary" id="practiceBtn">${live ? 'Back to practice' : 'Back to Swing Lab'}</button>
          <button class="btn btn-outline" id="reanalyzeBtn">Analyze again</button>
        </div>
        <div style="height:var(--space-6)"></div>
      </div>
    </div>
  `;

  const back = () => { release(); location.hash = live ? '#/active' : '#/swing-lab'; };
  qs('#backBtn', root).addEventListener('click', back);
  qs('#practiceBtn', root).addEventListener('click', back);
  qs('#reanalyzeBtn', root).addEventListener('click', () => { release(); location.hash = `#/swing/analyze/${swingVideoId}`; });

  const player = qs('#player', root);
  qsa('.swing-checkpoint', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = Number(btn.dataset.time);
      if (!Number.isFinite(t)) return;
      player.pause();
      try { player.currentTime = t / 1000; } catch { /* not seekable yet */ }
      qsa('.swing-checkpoint', root).forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  // Pose overlay: the stored landmark series is not kept (it is large and
  // recomputable), so the overlay draws the detected checkpoints' skeleton
  // only where the engine recorded them. Raw video stays dominant.
  const poseBtn = qs('#poseBtn', root);
  poseBtn.addEventListener('click', () => {
    poseOn = !poseOn;
    poseBtn.textContent = poseOn ? 'Pose on' : 'Pose off';
    poseBtn.setAttribute('aria-pressed', String(poseOn));
    qs('#overlay', root).hidden = !poseOn;
    if (poseOn) drawOverlay();
  });

  function drawOverlay() {
    const canvas = qs('#overlay', root);
    if (!canvas || canvas.hidden) return;
    const w = player.clientWidth, h = player.clientHeight;
    if (!w || !h) return;
    canvas.width = w; canvas.height = h;
    const ctx2 = canvas.getContext('2d');
    ctx2.clearRect(0, 0, w, h);
    const frame = (analysis.pose_frames || []).reduce((best, f) =>
      (best == null || Math.abs(f.t - player.currentTime * 1000) < Math.abs(best.t - player.currentTime * 1000) ? f : best), null);
    if (!frame) {
      ctx2.fillStyle = 'rgba(245,247,248,0.8)';
      ctx2.font = '13px -apple-system, system-ui, sans-serif';
      ctx2.fillText('Pose points are kept for checkpoints only', 12, 22);
      return;
    }
    ctx2.fillStyle = '#23d67f';
    for (const p of frame.points || []) {
      ctx2.beginPath(); ctx2.arc(p.x * w, p.y * h, 4, 0, 7); ctx2.fill();
    }
  }
  player.addEventListener('timeupdate', () => { if (poseOn) drawOverlay(); });

  (async function load() {
    const res = await swingMedia.openForPlayback(swingVideoId);
    if (location.hash !== myHash) { swingMedia.releasePlayback(res.url); return; }
    if (!res.ok) {
      qs('#frameNote', root).textContent = 'Video no longer on this device';
      player.hidden = true;
      return;
    }
    objectUrl = res.url;
    player.src = objectUrl;
  })();
}
