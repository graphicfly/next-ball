// Minimal MP4/QuickTime box reader — SPIKE ONLY.
//
// Exists because the web platform will not tell us the one thing
// swing-lab-spec.md §3.1 calls a hard requirement: the source frame rate.
// HTMLVideoElement exposes duration and dimensions and nothing about frame
// timing, and §3.1 is explicit that 30 must never be assumed.
//
// So we read it out of the container. `stts` holds the per-sample decode
// deltas for the video track, which gives an exact frame count and the real
// average frame rate — and, when the deltas are not all equal, tells us the
// clip is variable frame rate, which matters more than the average.
//
// Deliberately partial: enough boxes to answer the spike's questions, no
// demuxer, no bitstream parsing. A production version would use a real
// library or WebCodecs' own metadata.

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

// Reads only what is needed: the header, then grows if moov sits at the end
// (common for files written in one pass, including some phone exports).
export async function readMetadata(file) {
  const full = await file.arrayBuffer();
  const meta = parseMp4(full);
  meta.fileBytes = file.size;
  meta.fileType = file.type || '(none reported)';
  meta.fileName = file.name;
  return meta;
}
