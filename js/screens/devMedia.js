import * as db from '../db.js';
import * as media from '../media.js';
import * as swingMedia from '../swingMedia.js';
import { qs, qsa, escapeHtml } from '../ui.js';

// iPhone media validation bench — DEVELOPMENT ONLY.
//
// Reached at #/dev/media, deliberately unlinked, and not Swing Lab. It
// exists to answer one question on real hardware: is the Phase 1 media tier
// sound enough to design a user-facing feature on top of?
//
// It drives the PRODUCTION code paths — swingMedia.importSwingVideo,
// openForPlayback, deleteSwingVideo — and reports what they return. It does
// not reimplement any of them, because a bench that tests its own code
// proves nothing.
//
// Delete this file and its route when the real Swing Lab screens land.

// Results have to survive the app being force-quit, since reload
// persistence is one of the things being measured. Kept in its own
// localStorage key rather than the app index, so a dev tool can never
// pollute a golfer's data.
const STATE_KEY = 'nextball_dev_media_validation';

const blank = () => ({
  videoId: null, importedAt: null, verifiedBytes: null, estimateAtVerify: null,
  hevcImport: null, playback: null, reloadPersistence: null,
  thumbnail: null, thumbnailReason: null,
  largeImport: null, deleteResult: null,
  timings: null, fileSizeBytes: null, uiMaxGapMs: null,
  deleteChecks: null, postDeleteReload: null,
});

function loadState() {
  try { return { ...blank(), ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}') }; }
  catch { return blank(); }
}
function saveState(s) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* best effort */ }
}

const mb = (b) => (b == null ? '—' : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const gb = (b) => (b == null ? '—' : `${(b / 1073741824).toFixed(2)} GB`);
const ms = (v) => (v == null ? '—' : `${v} ms`);
const verdict = (v) => (v === true ? 'PASS' : v === false ? 'FAIL' : '—');
const cls = (v) => (v === true ? 'ok' : v === false ? 'bad' : '');

// Measures the longest gap between animation frames while work runs. This
// is the honest answer to "did the UI stay responsive" — a number, not an
// impression.
function jankProbe() {
  let last = performance.now(), max = 0, stopped = false;
  const tick = (t) => { const gap = t - last; last = t; if (gap > max) max = gap; if (!stopped) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return () => { stopped = true; return Math.round(max); };
}

export function renderDevMedia(root) {
  let state = loadState();
  let objectUrl = null;
  const release = () => { swingMedia.releasePlayback(objectUrl); objectUrl = null; };

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="homeBtn">&larr; Home</button>
        <span class="screen-title">iPhone Media Validation</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">
        <p class="tiny muted">Development tool. Not Swing Lab, not linked from anywhere. Results survive a force-quit so reload persistence can be measured.</p>

        <div class="section-eyebrow">1 · Import</div>
        <button class="btn btn-primary" id="pickBtn">Select video from Photos</button>
        <input type="file" id="pickInput" accept="video/*" hidden />
        <div class="tiny muted" id="status" style="margin-top:var(--space-2);">Ready.</div>
        <div class="bar" id="busy" hidden style="height:4px;background:var(--color-surface-2);border-radius:2px;margin-top:var(--space-2);overflow:hidden;"><i style="display:block;height:100%;width:40%;background:var(--color-accent);animation:devpulse 1s ease-in-out infinite alternate;"></i></div>
        <table class="dev-table" id="metaTable"></table>

        <div class="section-eyebrow">2 · Playback</div>
        <div class="row" style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" id="playBtn">Play stored video</button>
          <button class="btn btn-outline btn-sm" id="thumbBtn">Show thumbnail</button>
        </div>
        <button class="btn btn-outline" id="verifyBtn" style="margin-top:var(--space-2);width:100%;">Verify stored bytes</button>
        <table class="dev-table" id="verifyTable"></table>
        <video id="player" playsinline controls hidden style="width:100%;border-radius:12px;background:#000;margin-top:var(--space-3);"></video>
        <img id="thumbImg" hidden alt="" style="width:120px;border-radius:8px;margin-top:var(--space-3);" />

        <div class="section-eyebrow">3 · Storage</div>
        <table class="dev-table" id="storageTable"></table>
        <button class="btn btn-outline" id="persistBtn" style="margin-top:var(--space-2);width:100%;">Request persistent storage</button>
        <div class="tiny" id="persistResult" style="margin-top:var(--space-2);"></div>

        <div class="section-eyebrow">4 · Delete</div>
        <button class="btn btn-danger btn-sm" id="deleteBtn">Delete stored video</button>
        <table class="dev-table" id="deleteTable"></table>

        <div class="section-eyebrow">Result</div>
        <pre id="scorecard" style="background:#080a0c;border:1px solid var(--color-divider);border-radius:8px;padding:12px;font-size:12px;overflow:auto;white-space:pre-wrap;"></pre>
        <div class="row" style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-6);">
          <button class="btn btn-outline btn-sm" id="copyBtn">Copy result</button>
          <button class="btn btn-outline btn-sm" id="resetBtn">Reset test state</button>
        </div>
      </div>
    </div>
    <style>@keyframes devpulse{from{transform:translateX(-60%)}to{transform:translateX(260%)}}
    .dev-table{width:100%;font-size:12px;margin-top:var(--space-2);}
    .dev-table td{padding:3px 0;border-bottom:1px solid var(--color-divider);vertical-align:top;}
    .dev-table td:first-child{color:var(--color-text-tertiary);width:46%;padding-right:8px;}
    .dev-table td.v{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;}
    .dev-table td.ok{color:var(--color-accent);} .dev-table td.bad{color:var(--color-danger);}</style>
  `;

  const setStatus = (t) => { qs('#status', root).textContent = t; };
  const busy = (on) => { qs('#busy', root).hidden = !on; };
  const rows = (el, pairs) => {
    el.innerHTML = pairs.map(([k, v, c]) => `<td>${escapeHtml(k)}</td><td class="v ${c || ''}">${escapeHtml(String(v ?? '—'))}</td>`)
      .map((r) => `<tr>${r}</tr>`).join('');
  };

  qs('#homeBtn', root).addEventListener('click', () => { release(); location.hash = '#/home'; });
  qs('#pickBtn', root).addEventListener('click', () => qs('#pickInput', root).click());

  // ---------- 1. Import ----------
  qs('#pickInput', root).addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) { setStatus('Selection cancelled — no file returned.'); return; }

    setStatus(`Importing ${file.name} (${mb(file.size)})…`);
    busy(true);
    const stopJank = jankProbe();
    const res = await swingMedia.importSwingVideo(file, { camera_view: 'unknown' });
    const uiMaxGap = stopJank();
    busy(false);
    e.target.value = '';

    state.fileSizeBytes = file.size;
    state.timings = res.timings || null;
    state.uiMaxGapMs = uiMaxGap;

    if (!res.ok) {
      state.hevcImport = false;
      // The STAGE is the useful part of a failure on a phone.
      setStatus(`Import FAILED at stage "${res.stage || 'unknown'}" — ${res.reason}`);
      rows(qs('#metaTable', root), [
        ['result', 'FAIL', 'bad'], ['stage', res.stage || 'unknown', 'bad'], ['reason', res.reason, 'bad'],
        ['detail', res.detail ? JSON.stringify(res.detail) : '—'],
        ['file size', mb(file.size)], ['total time', ms(res.timings?.totalMs)],
      ]);
      if (file.size >= 100 * 1048576) state.largeImport = false;
      persist();
      return;
    }

    const v = res.video;
    state.videoId = v.swing_video_id;
    state.importedAt = new Date().toISOString();
    state.hevcImport = true;
    state.thumbnail = !!res.thumbnail?.ok;
    state.thumbnailReason = res.thumbnail?.ok ? null : (res.thumbnail?.reason || 'unknown');
    // "100 MB+" is only claimed when a file that large was actually used.
    if (file.size >= 100 * 1048576) state.largeImport = true;
    state.reloadPersistence = null;   // only a real reload can answer this
    state.deleteResult = null;
    state.postDeleteReload = null;

    setStatus(`Imported in ${res.timings.totalMs} ms.`);
    showMeta(v, res);
    await refreshStorage();
    persist();
  });

  function showMeta(v, res) {
    rows(qs('#metaTable', root), [
      ['result', 'PASS', 'ok'],
      ['SwingVideo ID', v.swing_video_id],
      ['filename', v.original_filename],
      ['reported MIME', v.mime || '(empty — normal for .MOV)'],
      ['container / codec', `${v.container || '?'} / ${v.codec || '?'}`],
      ['container size', v.width && v.height ? `${v.width}×${v.height}` : 'unknown'],
      ['presentation size', v.display_width && v.display_height ? `${v.display_width}×${v.display_height}` : 'unknown'],
      ['rotation', v.rotation_deg == null ? 'unknown' : `${v.rotation_deg}°`],
      ['duration', v.duration_ms == null ? 'unknown' : `${(v.duration_ms / 1000).toFixed(2)} s`],
      ['frames', v.frame_count ?? 'unknown'],
      ['frame rate', v.fps == null ? 'unknown' : `${v.fps.toFixed(3)} fps`],
      ['variable frame rate', v.variable_frame_rate == null ? 'unknown' : String(v.variable_frame_rate)],
      ['file size', mb(v.size_bytes)],
      ['thumbnail', res ? (res.thumbnail?.ok ? 'PASS' : `FAIL — ${res.thumbnail?.reason}`) : (v.thumb_ref ? 'stored' : 'none'),
        res ? (res.thumbnail?.ok ? 'ok' : 'bad') : ''],
      ['— metadata load', ms(res?.timings?.metadataMs)],
      ['— storage write', ms(res?.timings?.writeMs)],
      ['— persistence call', ms(res?.timings?.persistMs)],
      ['— thumbnail', ms(res?.timings?.thumbnailMs)],
      ['— record write', ms(res?.timings?.recordMs)],
      ['TOTAL import', ms(res?.timings?.totalMs), 'ok'],
      ['UI longest stall', res ? `${state.uiMaxGapMs} ms` : '—'],
    ]);
  }

  // ---------- 2. Playback ----------
  qs('#playBtn', root).addEventListener('click', async () => {
    if (!state.videoId) { setStatus('Nothing imported yet.'); return; }
    release();
    const res = await swingMedia.openForPlayback(state.videoId);
    const player = qs('#player', root);
    if (!res.ok) {
      state.playback = false;
      player.hidden = true;
      setStatus(`Playback FAILED — ${res.reason}`);
      persist();
      return;
    }
    objectUrl = res.url;
    player.hidden = false;
    player.src = objectUrl;
    player.onloadedmetadata = () => {
      // Dimensions prove a real decode, not merely a URL that resolved.
      state.playback = !!(player.videoWidth && player.videoHeight);
      setStatus(state.playback
        ? `Playing ${player.videoWidth}×${player.videoHeight}. Scrub and seek to confirm.`
        : 'Playback FAILED — no dimensions.');
      persist();
    };
    player.onerror = () => { state.playback = false; setStatus('Playback FAILED — decode error.'); persist(); };
  });

  qs('#thumbBtn', root).addEventListener('click', async () => {
    if (!state.videoId) { setStatus('Nothing imported yet.'); return; }
    const url = await swingMedia.getThumbnailUrl(state.videoId);
    const img = qs('#thumbImg', root);
    if (!url) {
      img.hidden = true;
      // Never substitute a placeholder — a missing thumbnail must look missing.
      setStatus('THUMBNAIL: FAIL — no thumbnail stored for this video.');
      state.thumbnail = false;
      state.thumbnailReason = state.thumbnailReason || 'not_stored';
      persist();
      return;
    }
    img.hidden = false;
    img.src = url;
    setStatus('THUMBNAIL: PASS');
  });

  // Reads the blob back out of IndexedDB and weighs it.
  //
  // This exists because navigator.storage.estimate() reported 1.4 MB on iOS
  // for a stored 101.4 MB video. Only one of those two numbers describes
  // whether the golfer's video is actually on the device, and it is not the
  // estimate — so the bytes are counted directly rather than inferred from
  // a figure the platform computes at its own convenience.
  qs('#verifyBtn', root).addEventListener('click', async () => {
    if (!state.videoId) { setStatus('Nothing imported yet.'); return; }
    const record = db.getSwingVideo(state.videoId);
    if (!record) { setStatus('No record for that id.'); return; }

    const t0 = performance.now();
    const blob = await media.getMedia(record.media_ref);
    const readMs = Math.round(performance.now() - t0);
    const thumb = record.thumb_ref ? await media.getMedia(record.thumb_ref) : null;
    const est = await navigator.storage.estimate();

    const actual = blob?.size ?? 0;
    const expected = record.size_bytes ?? 0;
    const match = actual === expected && actual > 0;
    state.verifiedBytes = actual;
    state.estimateAtVerify = est.usage ?? null;

    rows(qs('#verifyTable', root), [
      ['bytes read back', actual ? `${actual.toLocaleString()} (${mb(actual)})` : 'NOTHING', match ? 'ok' : 'bad'],
      ['bytes recorded at import', expected ? `${expected.toLocaleString()} (${mb(expected)})` : '—'],
      ['byte-for-byte match', verdict(match), cls(match)],
      ['read time', ms(readMs)],
      ['thumbnail bytes', thumb ? mb(thumb.size) : 'none', thumb ? 'ok' : 'bad'],
      ['estimate().usage right now', `${(est.usage ?? 0).toLocaleString()} (${mb(est.usage)})`],
      ['estimate vs actual', actual && est.usage != null
        ? (est.usage >= actual ? 'estimate includes the video' : 'ESTIMATE UNDER-REPORTS')
        : '—',
        actual && est.usage != null && est.usage < actual ? 'bad' : 'ok'],
    ]);
    setStatus(match
      ? `Verified: ${mb(actual)} read back from storage.`
      : 'Verification FAILED — see table.');
    persist();
  });

  // ---------- 3. Storage ----------
  async function refreshStorage() {
    const s = await swingMedia.storageStatus();
    rows(qs('#storageTable', root), [
      ['storage API', s.supported ? 'supported' : 'unsupported', s.supported ? 'ok' : 'bad'],
      ['persisted()', String(s.persisted), s.persisted === true ? 'ok' : ''],
      ['usage (raw bytes)', s.usageBytes ?? '—'],
      ['usage', mb(s.usageBytes)],
      ['quota (raw bytes)', s.quotaBytes ?? '—'],
      ['quota', gb(s.quotaBytes)],
      ['used', s.percentUsed == null ? '—' : `${s.percentUsed}%`],
      ['videos stored', s.swingVideoCount],
    ]);
    // Only offer the request when it would do something.
    qs('#persistBtn', root).hidden = s.persisted === true;
    // The scorecard reads these, so they are refreshed here rather than
    // captured once at load — otherwise it reports the usage from before
    // the import it is meant to be describing.
    state.persistLabel = !s.supported ? 'UNSUPPORTED' : s.persisted === true ? 'GRANTED' : 'NOT GRANTED';
    state.usageBytes = s.usageBytes;
    state.quotaBytes = s.quotaBytes;
    return s;
  }

  // The outcome is shown NEXT TO the button. It used to go to the status
  // line at the top of the page, so tapping it looked like nothing had
  // happened — the answer was there, just nowhere near the question.
  qs('#persistBtn', root).addEventListener('click', async () => {
    const out = qs('#persistResult', root);
    out.innerHTML = '<span class="muted">requesting…</span>';
    const r = await media.requestPersistence();
    const after = await refreshStorage();

    let line;
    if (!r.supported) line = '<b class="bad">UNSUPPORTED</b> — persist() does not exist in this browser.';
    else if (r.granted || after.persisted === true) line = '<b class="ok">GRANTED</b> — this origin is now protected from eviction.';
    else if (r.error) line = `<b class="bad">ERROR</b> — ${escapeHtml(r.error)}`;
    else line = '<b class="bad">REFUSED</b> — the browser declined. Storage still works; it is evictable under pressure.';

    out.innerHTML = `${line}<br/><span class="muted">persist() returned ${escapeHtml(JSON.stringify(r))} · persisted() now ${String(after.persisted)}</span>`;
    setStatus(`persist() → ${JSON.stringify(r)}`);
    render();
  });

  // ---------- 4. Delete ----------
  qs('#deleteBtn', root).addEventListener('click', async () => {
    if (!state.videoId) { setStatus('Nothing imported yet.'); return; }
    release();
    qs('#player', root).hidden = true;
    qs('#thumbImg', root).hidden = true;

    const before = db.getSwingVideo(state.videoId);
    const refs = before ? [before.media_ref, before.thumb_ref].filter(Boolean) : [];
    const res = await swingMedia.deleteSwingVideo(state.videoId);

    // Verified independently of what delete CLAIMS it did.
    const recordGone = db.getSwingVideo(state.videoId) === null;
    let mediaGone = true, thumbGone = true;
    for (const ref of refs) {
      const still = await media.getMedia(ref);
      if (still) { if (ref.endsWith('/thumb')) thumbGone = false; else mediaGone = false; }
    }
    const remaining = await media.listMediaKeys();
    const orphans = remaining.filter((k) => refs.includes(k));

    state.deleteResult = res.ok && recordGone && mediaGone && thumbGone && orphans.length === 0;
    state.deleteChecks = { recordGone, mediaGone, thumbGone, orphanKeys: orphans.length, refsRemoved: res.bytesDeleted ?? 0 };
    state.postDeleteReload = null;
    setStatus(state.deleteResult ? 'Deleted. Now force-quit and reopen to confirm it stays gone.' : 'Delete INCOMPLETE — see table.');

    rows(qs('#deleteTable', root), [
      ['delete call', res.ok ? 'ok' : `failed — ${res.reason}`, res.ok ? 'ok' : 'bad'],
      ['metadata removed', verdict(recordGone), cls(recordGone)],
      ['binary media removed', verdict(mediaGone), cls(mediaGone)],
      ['thumbnail removed', verdict(thumbGone), cls(thumbGone)],
      ['storage refs removed', `${state.deleteChecks.refsRemoved} of ${refs.length}`],
      ['orphaned keys', orphans.length, orphans.length === 0 ? 'ok' : 'bad'],
    ]);
    persist();
    await refreshStorage();
    render();
  });

  // ---------- reload verification ----------
  // Runs on every load. This is the only check that cannot be performed in
  // a single session, which is the whole reason state is persisted.
  async function verifyReload() {
    if (!state.videoId) return;
    const record = db.getSwingVideo(state.videoId);

    if (state.deleteResult === true) {
      // After a delete, the correct outcome is that it is still gone.
      const stillGone = !record && !(await media.getMedia(`swing/${state.videoId}/original`));
      state.postDeleteReload = stillGone;
      persist();
      return;
    }
    if (!record) { state.reloadPersistence = false; persist(); return; }
    const blob = await media.getMedia(record.media_ref);
    state.reloadPersistence = !!blob;
    if (blob) showMeta(record, null);
    persist();
  }

  // ---------- scorecard ----------
  function render() {
    const t = state.timings || {};
    const lines = [
      'IPHONE MEDIA VALIDATION',
      '',
      `HEVC import:         ${verdict(state.hevcImport)}`,
      `Playback:            ${verdict(state.playback)}`,
      `Reload persistence:  ${verdict(state.reloadPersistence)}`,
      `Thumbnail:           ${state.thumbnail === true ? 'PASS' : state.thumbnail === false ? `FAIL — ${state.thumbnailReason || 'unknown'}` : '—'}`,
      `Persistent storage:  ${state.persistLabel || '—'}`,
      `100 MB+ import:      ${state.largeImport === null ? '— (no 100 MB+ file tested)' : verdict(state.largeImport)}`,
      `Delete:              ${verdict(state.deleteResult)}${state.postDeleteReload === true ? ' (still gone after reload)' : state.postDeleteReload === false ? ' (REAPPEARED after reload)' : ''}`,
      '',
      `File size:           ${mb(state.fileSizeBytes)}`,
      `Total import time:   ${ms(t.totalMs)}`,
      `  metadata load:     ${ms(t.metadataMs)}`,
      `  storage write:     ${ms(t.writeMs)}`,
      `  thumbnail:         ${ms(t.thumbnailMs)}`,
      `  record write:      ${ms(t.recordMs)}`,
      `UI longest stall:    ${state.uiMaxGapMs == null ? '—' : state.uiMaxGapMs + ' ms'}`,
      `Bytes read back:     ${state.verifiedBytes == null ? '—' : mb(state.verifiedBytes)}`,
      `Storage usage:       ${mb(state.usageBytes)}`,
      `Storage quota:       ${gb(state.quotaBytes)}`,
      '',
      `SwingVideo ID:       ${state.videoId || '—'}`,
      `Build:               ${state.build || '—'}`,
      `UA:                  ${navigator.userAgent}`,
    ];
    qs('#scorecard', root).textContent = lines.join('\n');
  }

  function persist() { saveState(state); render(); }

  qs('#copyBtn', root).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(qs('#scorecard', root).textContent); setStatus('Result copied.'); }
    catch { setStatus('Clipboard blocked — select the text above instead.'); }
  });

  qs('#resetBtn', root).addEventListener('click', async () => {
    release();
    if (state.videoId && db.getSwingVideo(state.videoId)) await swingMedia.deleteSwingVideo(state.videoId);
    state = blank();
    saveState(state);
    qs('#metaTable', root).innerHTML = '';
    qs('#deleteTable', root).innerHTML = '';
    qs('#player', root).hidden = true;
    qs('#thumbImg', root).hidden = true;
    setStatus('Test state reset.');
    await refreshStorage();
    render();
  });

  (async function init() {
    await refreshStorage();
    try { state.build = (await import('../version.js')).BUILD_VERSION; } catch { /* optional */ }
    await verifyReload();
    persist();
    if (state.videoId && state.reloadPersistence === true) {
      setStatus('Previous import survived the reload. Play it to confirm, then delete.');
    }
  })();
}
