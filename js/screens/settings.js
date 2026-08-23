import * as db from '../db.js';
import { qs, qsa, toast, applyTheme } from '../ui.js';
import { downloadAllCSV, downloadJSONBackup, importJSONBackupFile } from '../export.js';

const APP_VERSION = '1.0.0';
const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

export function renderSettings(root) {
  const allSessions = db.getDB().sessions;
  const allShots = db.getDB().shots;
  const testSessionCount = allSessions.filter((s) => db.sessionDataSource(s) === 'test').length;
  const settings = db.getSettings();
  const theme = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="homeBtn">&larr; Home</button>
        <span class="screen-title">Settings</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">

        <div class="section-title">App</div>
        <div class="field">
          <label>Theme</label>
          <div class="choice-grid" id="themeGrid">
            ${THEME_OPTIONS.map((o) => `<div class="choice-btn ${theme === o.value ? 'selected' : ''}" data-value="${o.value}">${o.label}</div>`).join('')}
          </div>
        </div>
        <div class="kv-row" style="margin-bottom:var(--space-5);"><span class="muted">Units</span><b>Yards</b></div>

        <div class="section-title">Practice Defaults</div>
        <div class="field">
          <label>Default Club</label>
          <div class="choice-grid wrap-4" id="clubGrid">
            ${db.CLUBS.map((c) => `<div class="choice-btn ${settings.lastClub === c ? 'selected' : ''}" data-group="lastClub" data-value="${c}">${c}</div>`).join('')}
          </div>
        </div>
        <div class="field">
          <label>Default Setup</label>
          <div class="choice-grid wrap-2" id="setupGrid">
            <div class="choice-btn ${settings.lastSetup === 'ground' ? 'selected' : ''}" data-group="lastSetup" data-value="ground">Ground</div>
            <div class="choice-btn ${settings.lastSetup === 'tee' ? 'selected' : ''}" data-group="lastSetup" data-value="tee">Tee</div>
          </div>
        </div>
        <div class="field">
          <label>Default Surface</label>
          <div class="choice-grid wrap-2" id="surfaceGrid">
            <div class="choice-btn ${settings.lastSurface === 'mat' ? 'selected' : ''}" data-group="lastSurface" data-value="mat">Mat</div>
            <div class="choice-btn ${settings.lastSurface === 'grass' ? 'selected' : ''}" data-group="lastSurface" data-value="grass">Grass</div>
          </div>
        </div>
        <div class="field">
          <label>Default Swing Length</label>
          <div class="choice-grid" id="swingGrid">
            <div class="choice-btn ${settings.lastSwing === 'half' ? 'selected' : ''}" data-group="lastSwing" data-value="half">Half</div>
            <div class="choice-btn ${settings.lastSwing === 'three-quarter' ? 'selected' : ''}" data-group="lastSwing" data-value="three-quarter">3/4</div>
            <div class="choice-btn ${settings.lastSwing === 'full' ? 'selected' : ''}" data-group="lastSwing" data-value="full">Full</div>
          </div>
        </div>
        <div class="field">
          <label>Default Ball Count</label>
          <div class="choice-grid wrap-4" id="ballCountGrid">
            ${db.BALL_COUNT_PRESETS.map((n) => `<div class="choice-btn ${settings.lastBallCount === n ? 'selected' : ''}" data-group="lastBallCount" data-value="${n}">${n}</div>`).join('')}
          </div>
        </div>

        <div class="section-title">Data</div>
        <div class="kv-row" style="margin-bottom:var(--space-4);"><span class="muted">Stored on this device</span><b>${allSessions.length} sessions &bull; ${allShots.length} shots</b></div>

        <div class="stack" style="margin-bottom:var(--space-5);">
          <button class="btn" id="exportCsvBtn">Export All Shots (CSV)</button>
          <button class="btn" id="exportJsonBtn">Full Backup (JSON)</button>
          <button class="btn" id="importBtn">Restore from JSON Backup</button>
          <input type="file" id="importFile" accept="application/json" style="display:none;" />
        </div>

        ${testSessionCount > 0 ? `
        <div class="stack" style="margin-bottom:var(--space-5);">
          <p class="tiny muted">Test data</p>
          <button class="btn btn-danger" id="clearTestBtn">Delete All Test Sessions (${testSessionCount})</button>
        </div>` : ''}

        <div class="stack">
          <button class="btn btn-danger" id="clearBtn">Erase All Next Ball Data</button>
        </div>

        <div class="section-title">About</div>
        <div class="about-block">
          <h1 class="brand-hero">NEXT BALL</h1>
          <div class="brand-tagline">Find your groove.</div>
          <div class="version">Version ${APP_VERSION}</div>
        </div>
        <p class="tiny center" style="margin-bottom:var(--space-4);">All data is stored only on this device. Next Ball works offline and does not use an account.</p>
      </div>
    </div>
  `;

  qs('#homeBtn', root).addEventListener('click', () => { location.hash = '#/home'; });

  qs('#themeGrid', root).addEventListener('click', (e) => {
    const btn = e.target.closest('.choice-btn');
    if (!btn) return;
    const value = btn.dataset.value;
    db.updateSettings({ theme: value });
    applyTheme(value);
    renderSettings(root);
  });

  qsa('.choice-btn[data-group]', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      const raw = btn.dataset.value;
      const value = group === 'lastBallCount' ? Number(raw) : raw;
      db.updateSettings({ [group]: value });
      renderSettings(root);
    });
  });

  qs('#exportCsvBtn', root).addEventListener('click', () => { downloadAllCSV(); toast('CSV exported'); });
  qs('#exportJsonBtn', root).addEventListener('click', () => { downloadJSONBackup(); toast('Backup exported'); });

  qs('#importBtn', root).addEventListener('click', () => { qs('#importFile', root).click(); });
  qs('#importFile', root).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ok = confirm('Restoring a backup will replace all data currently on this device. Continue?');
    if (!ok) { e.target.value = ''; return; }
    try {
      await importJSONBackupFile(file);
      toast('Backup restored');
      location.hash = '#/home';
    } catch (err) {
      toast('Could not read that backup file');
    }
    e.target.value = '';
  });

  qs('#clearTestBtn', root)?.addEventListener('click', () => {
    const ok = confirm(`This permanently deletes ${testSessionCount} test session${testSessionCount === 1 ? '' : 's'} and their shots. Real sessions are never affected. Continue?`);
    if (!ok) return;
    const result = db.deleteAllTestSessions();
    if (result.failed.length) toast(`Deleted ${result.deleted} of ${result.total} test sessions`);
    else toast(`Deleted ${result.deleted} test session${result.deleted === 1 ? '' : 's'}`);
    renderSettings(root);
  });

  qs('#clearBtn', root).addEventListener('click', () => {
    const ok = confirm('This permanently deletes every session and shot stored on this device. This cannot be undone. Continue?');
    if (!ok) return;
    db.importFullDB({ schemaVersion: 1, sessions: [], shots: [], settings: {} });
    toast('All data erased');
    location.hash = '#/home';
  });
}
