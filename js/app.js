import { renderHome } from './screens/home.js';
import { renderStart } from './screens/start.js';
import { renderActive } from './screens/active.js';
import { renderShotEntry } from './screens/shotEntry.js';
import { renderCheckin } from './screens/checkin.js';
import { renderSummary } from './screens/summary.js';
import { renderHistory } from './screens/history.js';
import { renderHistoryDetail } from './screens/historyDetail.js';
import { renderYourGroove } from './screens/yourGroove.js';
import { renderCourseSelect } from './screens/courseSelect.js';
import { renderCourseSetup } from './screens/courseSetup.js';
import { renderCourseEdit } from './screens/courseEdit.js';
import { renderCourseRound } from './screens/courseRound.js';
import { renderHoleMap } from './screens/holeMap.js';
import { renderRoundSummary } from './screens/roundSummary.js';
import { renderRoundExplore } from './screens/roundExplore.js';
import { renderPracticePlan } from './screens/practicePlan.js';
import { renderLessonEntry } from './screens/lessonEntry.js';
import { renderLessonSummary } from './screens/lessonSummary.js';
import { renderDevMedia } from './screens/devMedia.js';
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
  { pattern: /^#\/summary\/([^/]+)\/explore$/, render: (m) => renderSummary(root, m[1], { showExplore: true }) },
  { pattern: /^#\/history$/, render: () => renderHistory(root) },
  { pattern: /^#\/history\/([^/]+)$/, render: (m) => renderHistoryDetail(root, m[1]) },
  { pattern: /^#\/groove\/([^/]+)$/, render: (m) => renderYourGroove(root, m[1]) },
  // Course Mode. Every one of these is a single-task screen, so none of them
  // is in ui.js's NAV_ROUTES and the bottom nav hides itself automatically —
  // global navigation stays exactly Home | History | Trends | Settings
  // (docs/course-mode-spec.md §2.8, §11.2).
  { pattern: /^#\/course\/select$/, render: () => renderCourseSelect(root) },
  { pattern: /^#\/course\/setup$/, render: () => renderCourseSetup(root) },
  { pattern: /^#\/course\/edit$/, render: () => renderCourseEdit(root) },
  { pattern: /^#\/course\/round$/, render: () => renderCourseRound(root) },
  { pattern: /^#\/course\/map\/(\d+)$/, render: (m) => renderHoleMap(root, m[1]) },
  { pattern: /^#\/course\/summary\/([^/]+)$/, render: (m) => renderRoundSummary(root, m[1]) },
  { pattern: /^#\/course\/explore\/([^/]+)$/, render: (m) => renderRoundExplore(root, m[1]) },
  { pattern: /^#\/course\/plan\/([^/]+)$/, render: (m) => renderPracticePlan(root, m[1]) },
  // Lessons (docs/lesson-spec.md §5A). History owns them, so none of these
  // is a nav route either — global navigation stays exactly
  // Home | History | Trends | Settings (§5A.3).
  { pattern: /^#\/lesson\/new$/, render: () => renderLessonEntry(root) },
  { pattern: /^#\/lesson\/edit\/([^/]+)$/, render: (m) => renderLessonEntry(root, m[1]) },
  { pattern: /^#\/lesson\/plan\/([^/]+)$/, render: (m) => renderPracticePlan(root, { source: 'lesson', id: m[1] }) },
  { pattern: /^#\/lesson\/([^/]+)$/, render: (m) => renderLessonSummary(root, m[1]) },
  // Swing Lab media test bench — DEVELOPMENT ONLY (V4.3 Phase 1). Not
  // linked from anywhere, not in the bottom nav, and removed with the
  // screen when the real Swing Lab lands.
  { pattern: /^#\/dev\/media$/, render: () => renderDevMedia(root) },
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
