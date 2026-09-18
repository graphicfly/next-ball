// Minimal MP4/QuickTime box reader.
//
// Exists because the web platform will not tell us the one thing
// swing-lab-spec.md §3.1 needs in order to choose a capability level: the
// source frame rate.
// HTMLVideoElement exposes duration and dimensions and nothing about frame
// timing, and §3.1 is explicit that 30 must never be assumed.
//
// So we read it out of the container. `stts` holds the per-sample decode
// deltas for the video track, which gives an exact frame count and the real
// average frame rate — and, when the deltas are not all equal, tells us the
// clip is variable frame rate, which matters more than the average.
//
// Deliberately partial: container boxes only, no demuxer and no bitstream
// parsing. Verified against ffprobe on three clips — an H.264 mp4, a
// 23.976 fps mp4 and iPhone HEVC QuickTime — matching codec, dimensions,
// duration, frame count and rate exactly, including detecting the iPhone's
// variable frame rate.
//
// Everything it cannot determine is reported as null. A null here means
// "unknown", and callers must treat it as unknown rather than substituting
// a default — §3.1 is explicit that 30 fps must never be assumed.

const FOURCC = (dv, off) => String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));

// Walks the boxes at one level, calling visit(type, payloadStart, payloadEnd).
function walk(dv, start, end, visit) {
  let off = start;
  while (off + 8 <= end) {
    let size = dv.getUint32(off);
    const type = FOURCC(dv, off + 4);
    let header = 8;
    if (size === 1) { // 64-bit size
      const hi = dv.getUint32(off + 8), lo = dv.getUint32(off + 12);
      size = hi * 2 ** 32 + lo;
      header = 16;
    } else if (size === 0) {
      size = end - off; // extends to end of file
    }
    if (size < header || off + size > end) break; // malformed — stop rather than guess
    visit(type, off + header, off + size);
    off += size;
  }
}

function findPath(dv, start, end, path) {
  let found = null;
  walk(dv, start, end, (type, s, e) => {
    if (found) return;
    if (type === path[0]) {
      if (path.length === 1) found = { start: s, end: e };
      else found = findPath(dv, s, e, path.slice(1));
    }
  });
  return found;
}

// Rotation from the track header's 3x3 transform matrix. iPhone video is
// almost always recorded in one physical orientation and rotated by this
// matrix — ignoring it renders the golfer sideways.
function rotationFromMatrix(dv, tkhdStart) {
  const version = dv.getUint8(tkhdStart);
  // Payload starts at version/flags (4 bytes). v0 then has creation,
  // modification, track_id, reserved, duration (5 x 4 = 20); v1 widens
  // creation/modification/duration to 64-bit (32). Then 16 bytes of
  // reserved/layer/alternate_group/volume/reserved before the matrix.
  const base = tkhdStart + 4 + (version === 1 ? 32 : 20) + 16;
  const a = dv.getInt32(base) / 65536;
  const b = dv.getInt32(base + 4) / 65536;
  const deg = Math.round(Math.atan2(b, a) * 180 / Math.PI);
  return ((deg % 360) + 360) % 360;
}

export function parseMp4(buffer) {
  const dv = new DataView(buffer);
  const out = {
    container: null, brands: [], codec: null,
    width: null, height: null, rotation: 0,
    durationMs: null, frameCount: null, fps: null,
    variableFrameRate: null, fpsMin: null, fpsMax: null,
    parsed: false, notes: [],
  };

  try {
    walk(dv, 0, buffer.byteLength, (type, s, e) => {
      if (type === 'ftyp') {
        out.container = FOURCC(dv, s);
        for (let o = s + 8; o + 4 <= e; o += 4) out.brands.push(FOURCC(dv, o));
      }
    });

    const moov = findPath(dv, 0, buffer.byteLength, ['moov']);
    if (!moov) { out.notes.push('no moov box found'); return out; }

    // Pick the VIDEO track: the one whose handler is 'vide'. A clip with
    // audio has several traks and the first is not reliably the video.
    let video = null;
    walk(dv, moov.start, moov.end, (type, s, e) => {
      if (type !== 'trak' || video) return;
      const hdlr = findPath(dv, s, e, ['mdia', 'hdlr']);
      if (hdlr && FOURCC(dv, hdlr.start + 8) === 'vide') video = { start: s, end: e };
    });
    if (!video) { out.notes.push('no video track'); return out; }

    const tkhd = findPath(dv, video.start, video.end, ['tkhd']);
    if (tkhd) {
      out.rotation = rotationFromMatrix(dv, tkhd.start);
      const v = dv.getUint8(tkhd.start);
      const dimsAt = tkhd.end - 8;
      out.width = Math.round(dv.getUint32(dimsAt) / 65536);
      out.height = Math.round(dv.getUint32(dimsAt + 4) / 65536);
      void v;
    }

    const mdhd = findPath(dv, video.start, video.end, ['mdia', 'mdhd']);
    let timescale = null, trackDuration = null;
    if (mdhd) {
      const v = dv.getUint8(mdhd.start);
      if (v === 1) {
        timescale = dv.getUint32(mdhd.start + 20);
        trackDuration = dv.getUint32(mdhd.start + 24) * 2 ** 32 + dv.getUint32(mdhd.start + 28);
      } else {
        timescale = dv.getUint32(mdhd.start + 12);
        trackDuration = dv.getUint32(mdhd.start + 16);
      }
      out.durationMs = Math.round((trackDuration / timescale) * 1000);
    }

    const stsd = findPath(dv, video.start, video.end, ['mdia', 'minf', 'stbl', 'stsd']);
    if (stsd) out.codec = FOURCC(dv, stsd.start + 12); // avc1 / hvc1 / hev1 ...

    // stts: the real frame timing. Entries are (count, delta) run-lengths.
    const stts = findPath(dv, video.start, video.end, ['mdia', 'minf', 'stbl', 'stts']);
    if (stts && timescale) {
      const entries = dv.getUint32(stts.start + 4);
      let frames = 0, totalDelta = 0;
      let minDelta = Infinity, maxDelta = 0;
      for (let i = 0; i < entries; i++) {
        const off = stts.start + 8 + i * 8;
        if (off + 8 > stts.end) break;
        const count = dv.getUint32(off);
        const delta = dv.getUint32(off + 4);
        frames += count;
        totalDelta += count * delta;
        if (delta > 0) { minDelta = Math.min(minDelta, delta); maxDelta = Math.max(maxDelta, delta); }
      }
      out.frameCount = frames;
      if (totalDelta > 0) out.fps = +(frames / (totalDelta / timescale)).toFixed(3);
      // Equal deltas mean constant frame rate. iPhone clips are usually
      // CFR, but anything screen-recorded or re-encoded may not be, and an
      // average fps over a variable clip is a number that lies.
      out.variableFrameRate = minDelta !== maxDelta;
      if (minDelta !== Infinity) {
        out.fpsMax = +(timescale / minDelta).toFixed(2);
        out.fpsMin = +(timescale / maxDelta).toFixed(2);
      }
    }
    out.parsed = true;
  } catch (err) {
    out.notes.push('parse error: ' + err.message);
  }
  return out;
}

// How long to wait for the browser to report metadata before calling a file
// undecodable. Generous: a large file on a cold cache on a phone is slow,
// and a false "unsupported" on a golfer's own video is the worst outcome.
const DECODE_PROBE_TIMEOUT_MS = 15000;

// Asks the BROWSER what it can actually do with the file, rather than
// asking what it claims it can do.
//
// This is the spike's most consequential import finding. Real iPhone HEVC
// files returned an EMPTY STRING from
// canPlayType('video/mp4; codecs="hvc1"') — the value that means "not
// supported" — and then decoded perfectly. Gating import on a codec string
// would have rejected exactly the footage Swing Lab exists for.
//
// The only meaningful test is whether metadata loads and the frame has real
// dimensions, so that is the test.
export function probeDecodable(file, { timeoutMs = DECODE_PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let url = null;
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      try { video.load(); } catch { /* best effort */ }
      if (url) URL.revokeObjectURL(url);
      resolve(result);
    };

    const timer = setTimeout(() => finish({ decodable: false, reason: 'timeout' }), timeoutMs);

    video.onloadedmetadata = () => {
      // Dimensions are the real proof. A file can fire loadedmetadata and
      // still have no video track — an audio file, for instance.
      if (!video.videoWidth || !video.videoHeight) {
        finish({ decodable: false, reason: 'no_video_track' });
        return;
      }
      finish({
        decodable: true,
        // PRESENTATION dimensions — what the decoder hands back with any
        // rotation already applied. On both spike clips these disagreed
        // with the container (1080x1920 decoded vs 1920x1080 stored), so
        // both are kept and neither is treated as the truth.
        displayWidth: video.videoWidth,
        displayHeight: video.videoHeight,
        durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null,
      });
    };
    video.onerror = () => finish({ decodable: false, reason: 'decode_error' });

    try {
      url = URL.createObjectURL(file);
      video.src = url;
    } catch {
      finish({ decodable: false, reason: 'unreadable' });
    }
  });
}

// Everything known about a file, from the container and from the decoder.
//
// Never throws: an unreadable or corrupt file is an expected outcome of
// letting someone pick any file on their phone, not an exception.
export async function readVideoMetadata(file, opts = {}) {
  const meta = {
    ok: false, reason: null,
    filename: file?.name ?? null,
    reportedType: file?.type || null,      // often empty for .MOV — not a signal
    sizeBytes: file?.size ?? null,
    container: null, brands: [], codec: null,
    containerWidth: null, containerHeight: null,
    displayWidth: null, displayHeight: null,
    rotationDeg: null,
    durationMs: null,
    frameCount: null, fps: null, variableFrameRate: null, fpsMin: null, fpsMax: null,
    parsedContainer: false,
  };
  if (!file) { meta.reason = 'no_file'; return meta; }

  // The decode probe runs first and decides the outcome. Container parsing
  // is enrichment: a file the browser can play is importable even if these
  // bytes are not a shape this parser understands.
  const probe = await probeDecodable(file, opts);
  if (!probe.decodable) { meta.reason = probe.reason; return meta; }
  meta.ok = true;
  meta.displayWidth = probe.displayWidth;
  meta.displayHeight = probe.displayHeight;
  meta.durationMs = probe.durationMs;

  try {
    const parsed = parseMp4(await file.arrayBuffer());
    if (parsed.parsed) {
      meta.parsedContainer = true;
      meta.container = parsed.container;
      meta.brands = parsed.brands || [];
      meta.codec = parsed.codec;
      meta.containerWidth = parsed.width;
      meta.containerHeight = parsed.height;
      meta.rotationDeg = parsed.rotation ?? null;
      meta.frameCount = parsed.frameCount;
      meta.fps = parsed.fps;
      meta.variableFrameRate = parsed.variableFrameRate;
      meta.fpsMin = parsed.fpsMin;
      meta.fpsMax = parsed.fpsMax;
      // The container's own duration is more precise than the decoder's
      // rounded seconds, so it wins where both exist.
      if (parsed.durationMs) meta.durationMs = parsed.durationMs;
    }
  } catch {
    // A playable file whose container we cannot parse is still importable.
    // Frame rate simply stays unknown, and §3.1a decides capability later.
  }
  return meta;
}
