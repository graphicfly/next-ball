import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast, trapSheetFocus } from '../ui.js';
import { setPendingCourseId } from '../state.js';
import { nearbyCoursesFromDevice, searchCourses, manualCourse, LOOKUP_STATUS } from '../courseProvider.js';

// Select a Course — docs/course-mode-spec.md §4.2, Reference B.
//
// The screen itself stays deliberately sparse: four options in a fixed
// order, and exactly one recent course. Every list that could grow — nearby
// results, search results, the full recent list — opens in a bottom sheet
// (ux-spec.md §3.8) rather than expanding this screen into a course list,
// which §4.2 rules out explicitly.

function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICON_LOCATION = '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" />';
const ICON_SEARCH = '<circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" />';
const ICON_FLAG = '<path d="M7 20V4" /><path d="M7 4.5h10l-2.6 3.4L17 11.3H7" />';
const ICON_PLUS = '<path d="M12 5.5v13" /><path d="M5.5 12h13" />';
const ICON_CHEVRON = '<path d="M9 5.5 15.5 12 9 18.5" />';

function cityStateLine(course) {
  if (course.city && course.state) return `${course.city}, ${course.state}`;
  return course.city || course.state || '';
}

function optionRowHtml({ id, iconPaths, title, subtitle, badge = 'neutral', trailing = 'chevron' }) {
  const trailingHtml = trailing === 'chevron'
    ? `<svg class="course-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_CHEVRON}</svg>`
    : '';
  return `
    <button class="course-row" id="${id}">
      <span class="course-row-badge ${badge}">${icon(iconPaths)}</span>
      <span class="course-row-text">
        <span class="course-row-title">${escapeHtml(title)}</span>
        ${subtitle ? `<span class="course-row-sub">${escapeHtml(subtitle)}</span>` : ''}
      </span>
      ${trailingHtml}
    </button>`;
}

export function renderCourseSelect(root) {
  // §4.2: exactly one recent course, and when none has ever been played the
  // whole section — eyebrow and View All alike — is omitted rather than
  // rendered empty (ux-spec.md §1.4).
  const recent = db.getRecentCourse();
  const allCourses = db.listCourses().filter((c) => !!c.last_played_at);

  const recentHtml = recent ? `
    <div class="course-section-head">
      <span class="course-section-eyebrow">Recent Course</span>
      ${allCourses.length > 1 ? '<button class="course-view-all" id="viewAllBtn">View All <span>&rsaquo;</span></button>' : ''}
    </div>
    ${optionRowHtml({
      id: 'recentCourseBtn',
      iconPaths: ICON_FLAG,
      title: recent.name,
      subtitle: cityStateLine(recent),
      badge: 'accent-flag',
    })}
  ` : '';

  root.innerHTML = `
    <div class="screen">
      <div class="course-hero">
        <img class="course-hero-img" src="graphics/home/range_hero.webp" alt="" />
        <div class="course-hero-scrim"></div>
        <div class="topbar course-hero-topbar">
          <button class="back" id="backBtn">&larr; Back</button>
          <span class="side-space"></span>
        </div>
        <div class="course-hero-content">
          <h1 class="course-hero-title">Select a Course</h1>
          <div class="course-hero-sub">Find a course and start your round.</div>
        </div>
      </div>

      <div class="scroll">
        ${optionRowHtml({
          id: 'useLocationBtn',
          iconPaths: ICON_LOCATION,
          title: 'Use My Location',
          subtitle: 'Find nearby courses with GPS',
          badge: 'accent',
        })}
        ${optionRowHtml({
          id: 'searchBtn',
          iconPaths: ICON_SEARCH,
          title: 'Search for a Course',
          subtitle: 'Enter a course name or city',
        })}

        ${recentHtml}

        <div style="margin-top:var(--space-5);"></div>
        ${optionRowHtml({
          id: 'manualBtn',
          iconPaths: ICON_PLUS,
          title: 'Enter a Course Manually',
        })}
      </div>
    </div>
  `;

  qs('#backBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
  qs('#useLocationBtn', root).addEventListener('click', () => openNearbySheet(root));
  qs('#searchBtn', root).addEventListener('click', () => openSearchSheet(root));
  qs('#manualBtn', root).addEventListener('click', () => openManualSheet(root));
  qs('#viewAllBtn', root)?.addEventListener('click', () => openAllCoursesSheet(root, allCourses));
  qs('#recentCourseBtn', root)?.addEventListener('click', () => {
    // A remembered course is its own origin (§4.2) — re-selecting it never
    // needs the network.
    selectStoredCourse(recent.course_id);
  });
}

// ---------- Selection ----------

// Every origin funnels through here, so all four produce the same stored
// course record and the same next step. Persisting on selection is what
// makes a course "remembered" for next time, including one found by GPS or
// search while online and replayed later offline.
function selectProviderCourse(course) {
  const stored = db.upsertCourse({
    name: course.name,
    city: course.city,
    state: course.state,
    latitude: course.latitude,
    longitude: course.longitude,
    place_id: course.place_id,
    source: course.source,
    provider: course.provider,
  });
  if (!stored) { toast('That course needs a name'); return; }
  selectStoredCourse(stored.course_id);
}

function selectStoredCourse(courseId) {
  setPendingCourseId(courseId);
  location.hash = '#/course/setup';
}

// ---------- Sheets ----------

function openSheet(innerHtml, { onClose } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${innerHtml}</div>`;
  document.body.appendChild(backdrop);
  const untrap = trapSheetFocus(backdrop, close);

  function close() {
    untrap();
    backdrop.remove();
    onClose?.();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  return { backdrop, close };
}

function courseResultsHtml(courses) {
  return `<div class="course-result-list">${courses.map((c, i) => `
    <button class="course-row course-result" data-index="${i}">
      <span class="course-row-badge accent-flag">${icon(ICON_FLAG)}</span>
      <span class="course-row-text">
        <span class="course-row-title">${escapeHtml(c.name)}</span>
        ${cityStateLine(c) ? `<span class="course-row-sub">${escapeHtml(cityStateLine(c))}</span>` : ''}
      </span>
      ${c.distance_m != null ? `<span class="course-row-distance">${formatDistance(c.distance_m)}</span>` : ''}
    </button>`).join('')}</div>`;
}

function formatDistance(meters) {
  const miles = meters / 1609.34;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

// Every failure path keeps Search and Manual entry one tap away inside the
// same sheet — §8: never a blocking dialog, never a dead end.
function fallbackActionsHtml() {
  return `
    <div class="stack" style="margin-top:var(--space-4);">
      <button class="btn btn-outline" id="sheetSearchBtn">Search for a Course</button>
      <button class="btn btn-outline" id="sheetManualBtn">Enter a Course Manually</button>
    </div>`;
}

function wireFallbackActions(root, backdrop, close) {
  qs('#sheetSearchBtn', backdrop)?.addEventListener('click', () => { close(); openSearchSheet(root); });
  qs('#sheetManualBtn', backdrop)?.addEventListener('click', () => { close(); openManualSheet(root); });
}

function wireResults(root, backdrop, close, courses) {
  qsa('.course-result', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      close();
      selectProviderCourse(courses[Number(btn.dataset.index)]);
    });
  });
}

function openNearbySheet(root) {
  const { backdrop, close } = openSheet(`
    <h2>Nearby Courses</h2>
    <div id="nearbyBody" class="tiny muted" aria-live="polite">Finding courses near you&hellip;</div>
    <button class="btn btn-outline" id="closeNearbyBtn" style="margin-top:var(--space-4);">Cancel</button>
  `);
  qs('#closeNearbyBtn', backdrop).addEventListener('click', close);

  nearbyCoursesFromDevice().then(({ status, courses }) => {
    const body = qs('#nearbyBody', backdrop);
    if (!body) return; // sheet already dismissed

    if (status === LOOKUP_STATUS.OK) {
      body.classList.remove('tiny', 'muted');
      body.innerHTML = courseResultsHtml(courses);
      wireResults(root, backdrop, close, courses);
      return;
    }

    // Each failure says what actually happened — "location is off" must
    // never read as "there are no courses near you" (§8).
    const message = {
      [LOOKUP_STATUS.NO_PERMISSION]: 'Location is off, so nearby courses can&rsquo;t be found. You can search for a course or enter one manually.',
      [LOOKUP_STATUS.NO_RESULTS]: 'No courses found nearby.',
      [LOOKUP_STATUS.UNAVAILABLE]: 'Course lookup isn&rsquo;t available right now. Recent courses and manual entry still work.',
    }[status];
    body.innerHTML = `${message}${fallbackActionsHtml()}`;
    wireFallbackActions(root, backdrop, close);
  });
}

function openSearchSheet(root) {
  const { backdrop, close } = openSheet(`
    <h2>Search for a Course</h2>
    <div class="field">
      <input type="search" id="courseSearchInput" placeholder="Course name or city" autocomplete="off" enterkeyhint="search" />
    </div>
    <button class="btn btn-primary" id="runSearchBtn">Search</button>
    <div id="searchBody" class="tiny muted" style="margin-top:var(--space-3);" aria-live="polite"></div>
    <button class="btn btn-outline" id="closeSearchBtn" style="margin-top:var(--space-3);">Cancel</button>
  `);

  const input = qs('#courseSearchInput', backdrop);
  const body = qs('#searchBody', backdrop);
  const searchBtn = qs('#runSearchBtn', backdrop);
  input.focus();

  qs('#closeSearchBtn', backdrop).addEventListener('click', close);

  // Submit-driven and guarded against overlapping requests, never
  // search-as-you-type — Nominatim's usage policy asks for roughly one
  // request per second (§11.4).
  let searching = false;
  const run = async () => {
    const query = input.value.trim();
    if (!query || searching) return;
    searching = true;
    searchBtn.disabled = true;
    body.className = 'tiny muted';
    body.textContent = 'Searching…';

    const { status, courses } = await searchCourses(query);
    searching = false;
    if (!qs('#searchBody', backdrop)) return; // dismissed mid-flight
    searchBtn.disabled = false;

    if (status === LOOKUP_STATUS.OK) {
      body.className = '';
      body.innerHTML = courseResultsHtml(courses);
      wireResults(root, backdrop, close, courses);
      return;
    }
    body.className = 'tiny muted';
    const message = status === LOOKUP_STATUS.UNAVAILABLE
      ? 'Search isn&rsquo;t available right now. You can still enter a course manually.'
      : `No matches for &ldquo;${escapeHtml(query)}&rdquo;.`;
    body.innerHTML = `${message}
      <div class="stack" style="margin-top:var(--space-4);">
        <button class="btn btn-outline" id="sheetManualBtn">Enter a Course Manually</button>
      </div>`;
    wireFallbackActions(root, backdrop, close);
  };

  searchBtn.addEventListener('click', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
}

// The full remembered list behind View All (§4.2) — a plain list, kept off
// the main screen so that screen never becomes a course list.
function openAllCoursesSheet(root, courses) {
  const { backdrop, close } = openSheet(`
    <h2>Recent Courses</h2>
    <div class="course-result-list">${courses.map((c) => `
      <button class="course-row course-stored" data-course-id="${c.course_id}">
        <span class="course-row-badge accent-flag">${icon(ICON_FLAG)}</span>
        <span class="course-row-text">
          <span class="course-row-title">${escapeHtml(c.name)}</span>
          ${cityStateLine(c) ? `<span class="course-row-sub">${escapeHtml(cityStateLine(c))}</span>` : ''}
        </span>
      </button>`).join('')}</div>
    <button class="btn btn-outline" id="closeAllBtn" style="margin-top:var(--space-4);">Cancel</button>
  `);

  qs('#closeAllBtn', backdrop).addEventListener('click', close);
  qsa('.course-stored', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      close();
      selectStoredCourse(btn.dataset.courseId);
    });
  });
}

// Name required, city/state optional, 9 or 18 — and nothing else (§4.2).
function openManualSheet(root) {
  const { backdrop, close } = openSheet(`
    <h2>Enter a Course</h2>
    <div class="field">
      <label for="manualNameInput">Course name</label>
      <input type="text" id="manualNameInput" placeholder="Course name" maxlength="60" autocomplete="off" />
    </div>
    <div class="field">
      <label for="manualCityInput">City / State <span class="muted">(optional)</span></label>
      <div class="manual-city-row">
        <input type="text" id="manualCityInput" placeholder="City" maxlength="40" autocomplete="off" />
        <input type="text" id="manualStateInput" placeholder="ST" maxlength="2" autocomplete="off" />
      </div>
    </div>
    <div class="field">
      <label>Holes</label>
      <div class="choice-grid wrap-2" id="manualHolesGrid">
        <div class="choice-btn selected" data-holes="9">9</div>
        <div class="choice-btn" data-holes="18">18</div>
      </div>
    </div>
    <button class="btn btn-primary" id="saveManualBtn">Continue</button>
    <button class="btn btn-outline" id="closeManualBtn" style="margin-top:8px;">Cancel</button>
  `);

  const nameInput = qs('#manualNameInput', backdrop);
  nameInput.focus();
  let holeCount = 9;

  qsa('#manualHolesGrid .choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      holeCount = Number(btn.dataset.holes);
      qsa('#manualHolesGrid .choice-btn', backdrop).forEach((b) => b.classList.toggle('selected', b === btn));
    });
  });

  qs('#closeManualBtn', backdrop).addEventListener('click', close);
  qs('#saveManualBtn', backdrop).addEventListener('click', () => {
    const course = manualCourse({
      name: nameInput.value,
      city: qs('#manualCityInput', backdrop).value,
      state: qs('#manualStateInput', backdrop).value,
    });
    if (!course) { toast('Enter a course name'); nameInput.focus(); return; }

    const stored = db.upsertCourse({ ...course, hole_count: holeCount });
    close();
    selectStoredCourse(stored.course_id);
  });
}
