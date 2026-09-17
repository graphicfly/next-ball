// Frame access + swing kinematics — SPIKE ONLY.
//
// The question this answers is narrow and load-bearing: can we get at
// ENOUGH of the source frames to see a golf swing? swing-lab-spec.md §3.1
// says impact occupies one to two frames at 30 fps, so "enough" is not a
// matter of taste.

import { detect, GROUPS } from './pose.js';

// requestVideoFrameCallback reports `presentedFrames`, which is the honest
// measure: it counts frames the compositor actually presented, so a gap
// between it and the container's frame count is dropped frames, not a
// counting artefact.
export function walkFrames(video, { playbackRate = 1, onFrame, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof video.requestVideoFrameCallback !== 'function') {
      reject(new Error('requestVideoFrameCallback unsupported'));
      return;
    }
    const seen = [];
    let firstPresented = null, lastPresented = 0, callbacks = 0;
    const started = performance.now();

    // Resolution is driven by the 'ended' EVENT, not by checking
    // video.ended inside the callback. The final frame callback fires
    // before the flag flips, so the check-inside version re-arms rVFC once
    // more and then waits forever for a frame that will never come. This
    // hung the first run of the spike; it is the kind of thing only a real
    // run finds.
    let settled = false;
    const finish = () => { if (settled) return; settled = true; video.removeEventListener('ended', finish); resolve(summary()); };
    video.addEventListener('ended', finish);

    const step = async (now, meta) => {
      if (settled) return;
      if (signal?.aborted) { video.pause(); finish(); return; }
      callbacks += 1;
      if (firstPresented === null) firstPresented = meta.presentedFrames;
      lastPresented = meta.presentedFrames;
      seen.push({ mediaTime: meta.mediaTime, presentedFrames: meta.presentedFrames });
      try { if (onFrame) await onFrame(meta, video); } catch (e) { video.pause(); settled = true; reject(e); return; }
      if (!video.ended) video.requestVideoFrameCallback(step);
      else finish();
    };

    function summary() {
      return {
        callbacks,
        presentedSpan: firstPresented === null ? 0 : lastPresented - firstPresented + 1,
        wallMs: Math.round(performance.now() - started),
        playbackRate,
        // Mean interval between the media timestamps we actually saw. If
        // this is ~2x the source frame interval, we sampled every other
        // frame without meaning to.
        meanDeltaMs: seen.length > 1
          ? +(((seen[seen.length - 1].mediaTime - seen[0].mediaTime) * 1000) / (seen.length - 1)).toFixed(2)
          : null,
        frames: seen,
      };
    }

    video.playbackRate = playbackRate;
    video.muted = true;
    video.currentTime = 0;
    video.requestVideoFrameCallback(step);
    video.play().catch(reject);
  });
}

// Per-group visibility, which is what §8.1's reliability table is really
// about: a landmark the model cannot see is not a measurement.
export function groupVisibility(landmarks) {
  const out = {};
  for (const [name, idx] of Object.entries(GROUPS)) {
    const vals = idx.map((i) => landmarks[i]?.visibility ?? 0);
    out[name] = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3);
  }
  return out;
}

// Wrist-centre speed per frame, in normalised units per second. This is the
// spine of phase detection (§7 detects from hand kinematics, not absolute
// positions) and it is also the honest way to answer the impact question:
// count how many frames actually fall inside the fast part of the swing.
export function wristKinematics(series) {
  const pts = series
    .filter((f) => f.landmarks)
    .map((f) => {
      const l = f.landmarks[15], r = f.landmarks[16];
      return { t: f.mediaTime, x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
    });
  const speeds = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t;
    if (dt <= 0) continue;
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    speeds.push({ t: pts[i].t, v: Math.hypot(dx, dy) / dt });
  }
  if (!speeds.length) return null;

  const peak = speeds.reduce((a, b) => (b.v > a.v ? b : a));
  const vmax = peak.v;
  // Frames inside the high-speed window are the frames that carry impact.
  // Reporting the count is the difference between "impact detection works"
  // and "impact detection is a coin flip at this frame rate".
  const framesAbove = (frac) => speeds.filter((s) => s.v >= vmax * frac).length;
  const median = [...speeds].sort((a, b) => a.v - b.v)[Math.floor(speeds.length / 2)].v;

  return {
    sampleCount: speeds.length,
    peakSpeed: +vmax.toFixed(3),
    medianSpeed: +median.toFixed(3),
    peakAtMediaTime: +peak.t.toFixed(4),
    framesAbove90pct: framesAbove(0.9),
    framesAbove75pct: framesAbove(0.75),
    framesAbove50pct: framesAbove(0.5),
    // A crude motion window: everything above 20% of peak.
    motionWindowFrames: framesAbove(0.2),
  };
}

export { detect };

// Seek-driven stepping — the lossless alternative to walking during
// playback.
//
// Why it exists: requestVideoFrameCallback is bound to playback. If the work
// done per frame is slower than realtime, the video keeps playing and frames
// are simply missed — silently, with no error and no gap in the data to
// notice. The first pose run of this spike processed 2 frames out of 145 for
// exactly that reason and reported success.
//
// Seeking is slower per frame but deterministic: the clip advances only when
// the work for the previous frame has finished, so coverage does not depend
// on how fast the model is. For analysis that is the correct trade — nobody
// is watching this playback.
export function stepFrames(video, { fps, frameCount, onFrame, signal, maxFrames = Infinity } = {}) {
  return new Promise(async (resolve, reject) => {
    if (!fps || !frameCount) { reject(new Error('stepFrames needs fps and frameCount')); return; }
    const started = performance.now();
    const total = Math.min(frameCount, maxFrames);
    let done = 0, seekMs = 0, missed = 0;

    const seekTo = (t) => new Promise((res) => {
      let settled = false;
      const ok = () => { if (settled) return; settled = true; cleanup(); res(true); };
      const fail = () => { if (settled) return; settled = true; cleanup(); res(false); };
      const cleanup = () => {
        video.removeEventListener('seeked', ok);
        video.removeEventListener('error', fail);
        clearTimeout(timer);
      };
      const timer = setTimeout(fail, 2000); // a seek that never lands must not hang the run
      video.addEventListener('seeked', ok);
      video.addEventListener('error', fail);
      video.currentTime = t;
    });

    try {
      video.pause();
      for (let i = 0; i < total; i++) {
        if (signal?.aborted) break;
        // Half-frame offset lands inside the frame rather than on its edge,
        // where rounding can return the neighbour.
        const t = (i + 0.5) / fps;
        const s0 = performance.now();
        const landed = await seekTo(Math.min(t, (video.duration || Infinity) - 0.001));
        seekMs += performance.now() - s0;
        if (!landed) { missed += 1; continue; }
        await onFrame({ mediaTime: video.currentTime, index: i }, video);
        done += 1;
      }
      resolve({
        mode: 'seek',
        requested: total, processed: done, missedSeeks: missed,
        wallMs: Math.round(performance.now() - started),
        meanSeekMs: done ? +(seekMs / done).toFixed(1) : null,
      });
    } catch (err) { reject(err); }
  });
}
