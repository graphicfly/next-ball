import { renderHome } from './screens/home.js';
import { renderStart } from './screens/start.js';
import { renderActive } from './screens/active.js';
import { renderShotEntry } from './screens/shotEntry.js';
import { renderCheckin } from './screens/checkin.js';
import { renderSummary } from './screens/summary.js';
import { renderHistory } from './screens/history.js';
import { renderHistoryDetail } from './screens/historyDetail.js';
import { renderTrends } from './screens/trends.js';
import { renderSettings } from './screens/settings.js';
import { getActiveSession, getSettings } from './db.js';
import { enableWakeLock } from './wakeLock.js';
import { startWeatherTracking } from './sessionWeather.js';
import { startLocationResolution } from './sessionLocation.js';
import { applyTheme, syncBottomNav } from './ui.js';

applyTheme(getSettings().theme);

const root = document.getElementById('app');

const routes = [
  { pattern: /^#\/home$/, render: () => renderHome(root) },
  { pattern: /^#\/start$/, render: () => renderStart(root) },
  { pattern: /^#\/active$/, render: () => renderActive(root) },
  { pattern: /^#\/log\/(strike|direction|height|distance)$/, render: (m) => renderShotEntry(root, m[1]) },
  { pattern: /^#\/checkin\/([^/]+)$/, render: (m) => renderCheckin(root, m[1]) },
  { pattern: /^#\/summary\/([^/]+)$/, render: (m) => renderSummary(root, m[1]) },
  { pattern: /^#\/history$/, render: () => renderHistory(root) },
  { pattern: /^#\/history\/([^/]+)$/, render: (m) => renderHistoryDetail(root, m[1]) },
  { pattern: /^#\/trends$/, render: () => renderTrends(root) },
  { pattern: /^#\/settings$/, render: () => renderSettings(root) },
];

function route() {
  const hash = location.hash || '#/home';
  for (const r of routes) {
    const m = hash.match(r.pattern);
    if (m) {
      window.scrollTo(0, 0);
      r.render(m);
      syncBottomNav(hash);
      return;
    }
  }
  location.hash = '#/home';
}

window.addEventListener('hashchange', route);

if (!location.hash) location.hash = '#/home';
route();

// Recover the wake lock and weather tracking if the app was reloaded (or
// relaunched) while a session was already active — e.g. the phone was
// closed and reopened. startWeatherTracking only re-fetches if the
// session's weather is missing or stale, so this doesn't spam the API on
// every reload.
const bootSession = getActiveSession();
if (bootSession && bootSession.status === 'active') {
  enableWakeLock();
  startWeatherTracking(bootSession.session_id);
  startLocationResolution(bootSession.session_id);
}
