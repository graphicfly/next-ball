import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseMp4 } from '../js/mediaMeta.js';

// Container parsing, against byte-level fixtures built to match the two
// shapes real footage arrives in. The parser itself was verified against
// ffprobe on three real clips during the V4.3 spike; these lock in the
// behaviours that matter and would otherwise regress silently.

// Builds a minimal but REAL box tree: ftyp + moov/trak/{tkhd,mdia/{mdhd,
// hdlr,minf/stbl/{stsd,stts}}}. Small enough to read, real enough that the
// parser cannot tell it from a phone's output.
function buildMp4({ brand = 'isom', codec = 'avc1', width = 1920, height = 1080,
                    rotation = 0, timescale = 600, sttsEntries = [[145, 25]] } = {}) {
  const enc = new TextEncoder();
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
  const i32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n); return b; };
  const cat = (...parts) => { const total = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const box = (type, ...payload) => { const body = cat(...payload); return cat(u32(body.length + 8), enc.encode(type), body); };

  const ftyp = box('ftyp', enc.encode(brand), u32(512), enc.encode('isom'), enc.encode('avc1'));

  // tkhd v0: version/flags, 5 x u32, 16 bytes reserved block, 9 matrix
  // entries, then fixed-point width/height.
  const rad = (rotation * Math.PI) / 180;
  const a = Math.round(Math.cos(rad) * 65536), b = Math.round(Math.sin(rad) * 65536);
  const tkhd = box('tkhd',
    new Uint8Array([0, 0, 0, 7]), u32(0), u32(0), u32(1), u32(0), u32(1000),
    new Uint8Array(16),
    i32(a), i32(b), u32(0), i32(-b), i32(a), u32(0), u32(0), u32(0), u32(0x40000000),
    u32(width * 65536), u32(height * 65536));

  const totalDelta = sttsEntries.reduce((s, [c, d]) => s + c * d, 0);
  const mdhd = box('mdhd', new Uint8Array([0, 0, 0, 0]), u32(0), u32(0), u32(timescale), u32(totalDelta));
  const hdlr = box('hdlr', new Uint8Array([0, 0, 0, 0]), u32(0), enc.encode('vide'), new Uint8Array(12));
  const stsd = box('stsd', new Uint8Array([0, 0, 0, 0]), u32(1), cat(u32(8), enc.encode(codec)));
  const stts = box('stts', new Uint8Array([0, 0, 0, 0]), u32(sttsEntries.length),
    ...sttsEntries.flatMap(([c, d]) => [u32(c), u32(d)]));
  const moov = box('moov', box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', box('stbl', stsd, stts)))));
  const all = cat(ftyp, moov);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

describe('Container parsing — what the web platform will not tell us', () => {
  test('frame rate is computed from real frame timing, never assumed', () => {
    // 145 samples of 25 ticks at timescale 600 = 24 fps exactly.
    const m = parseMp4(buildMp4({ sttsEntries: [[145, 25]] }));
    assert.equal(m.parsed, true);
    assert.equal(m.frameCount, 145);
    assert.equal(m.fps, 24);
    assert.equal(m.variableFrameRate, false);
  });

  test('a 30 fps clip parses as 30 fps and is not judged', () => {
    const m = parseMp4(buildMp4({ timescale: 600, sttsEntries: [[150, 20]] }));
    assert.equal(m.fps, 30);
    assert.equal(m.frameCount, 150);
  });

  test('variable frame rate is detected rather than averaged away', () => {
    // iPhone footage is VFR. An average over a variable clip is a number
    // that lies, so the fact is recorded alongside it.
    const m = parseMp4(buildMp4({ timescale: 600, sttsEntries: [[100, 20], [50, 21]] }));
    assert.equal(m.variableFrameRate, true);
    assert.ok(m.fpsMin < m.fpsMax, 'the real range is reported');
    assert.ok(m.fps > 28 && m.fps < 30);
  });

  test('HEVC in a QuickTime container parses — the format iPhones actually produce', () => {
    const m = parseMp4(buildMp4({ brand: 'qt  ', codec: 'hvc1' }));
    assert.equal(m.container, 'qt  ');
    assert.equal(m.codec, 'hvc1');
    assert.equal(m.width, 1920);
  });

  test('rotation is read from the track matrix', () => {
    assert.equal(parseMp4(buildMp4({ rotation: 0 })).rotation, 0);
    assert.equal(parseMp4(buildMp4({ rotation: 90 })).rotation, 90);
    assert.equal(parseMp4(buildMp4({ rotation: 180 })).rotation, 180);
  });

  test('a file that is not a container fails safely instead of throwing', () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer;
    const m = parseMp4(junk);
    assert.equal(m.parsed, false);
    assert.equal(m.fps, null);
    assert.ok(Array.isArray(m.notes));
  });

  test('a truncated file stops rather than reading past the end', () => {
    const full = new Uint8Array(buildMp4({}));
    const m = parseMp4(full.slice(0, 40).buffer);
    assert.equal(m.parsed, false);
  });

  test('a container with no video track is not treated as video', () => {
    const enc = new TextEncoder();
    const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
    const cat = (...p) => { const t = p.reduce((s, x) => s + x.length, 0); const o = new Uint8Array(t); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
    const box = (type, ...payload) => { const body = cat(...payload); return cat(u32(body.length + 8), enc.encode(type), body); };
    const hdlr = box('hdlr', new Uint8Array([0, 0, 0, 0]), u32(0), enc.encode('soun'), new Uint8Array(12));
    const moov = box('moov', box('trak', box('mdia', hdlr)));
    const ftyp = box('ftyp', enc.encode('isom'), u32(512));
    const buf = cat(ftyp, moov);
    const m = parseMp4(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    assert.equal(m.parsed, false);
    assert.ok(m.notes.join(' ').includes('no video track'));
  });
});

describe('The import gate is decodability, not a codec string', () => {
  test('readVideoMetadata and probeDecodable are the exported gate', async () => {
    const mod = await import('../js/mediaMeta.js');
    assert.equal(typeof mod.probeDecodable, 'function');
    assert.equal(typeof mod.readVideoMetadata, 'function');
  });

  test('nothing in the media path consults canPlayType', async () => {
    const fs = await import('node:fs');
    // The V4.3 spike found real iPhone HEVC returning an EMPTY STRING from
    // canPlayType — the value meaning "unsupported" — and then decoding
    // perfectly. Gating on it would reject the footage Swing Lab is for.
    for (const f of ['../js/mediaMeta.js', '../js/swingMedia.js', '../js/media.js']) {
      const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
      const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      assert.ok(!code.includes('canPlayType'), `${f} must not gate on canPlayType`);
    }
  });
});
