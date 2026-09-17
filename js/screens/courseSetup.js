import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast, trapSheetFocus, presentSheet } from '../ui.js';
import { getPendingCourseId, clearPendingCourse } from '../state.js';
import { courseCoverage, COVERAGE, loadCourseGeometry, teeSetsFromGeometry, GEOMETRY_STATUS } from '../courseGeometry.js';

// Course Details — docs/course-mode-spec.md §14.2, Reference A.
//
// Replaces and expands Round Setup (§4.3). Everything a golfer needs to
// confirm before the first hole, in one glance: what course, how big, how
// long from the tee they are playing, and whether the map will be there.
//
// Three rules shape the whole screen:
//
//  - Cells and rows are OMITTED when their data is unknown, never blanked
//    or greyed. A scorecard-only course legitimately shows two stat cells
//    and no map row, and nothing announces what is missing (§14.7 C/D).
//  - No OSM or Overpass vocabulary reaches the golfer. The internal
//    coverage levels exist in courseCoverage(); the screen says "GPS map
//    available" or says nothing at all.
//  - The par editor lives behind Edit Course Info, because a returning
//    golfer with remembered pars should not scroll past one (§14.2).

// The View Course Map row is gated on real geometry AND on the map screen
// existing. §14.5's Hole Map is not built yet, and §14.7 C is explicit that
// this control must never be present-but-erroring — so until that screen
// lands the row stays out. Flipping this to true is the only change needed
// once it does; the gating below is already correct.
const COURSE_MAP_ENABLED = false;

function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICON_FLAG = '<path d="M7 20V4" /><path d="M7 4.5h10l-2.6 3.4L17 11.3H7" />';
const ICON_MAP = '<path d="M9 4.5 3.5 7v12.5L9 17l6 2.5 5.5-2.5V4.5L15 7 9 4.5Z" /><path d="M9 4.5V17" /><path d="M15 7v12.5" />';
const ICON_CHECK = '<circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.3l2.5 2.5 4.5-5" />';
const ICON_CHEVRON = '<path d="M9 5.5 15.5 12 9 18.5" />';
const ICON_HOLES = '<path d="M7 20V4" /><path d="M7 4.5h10l-2.6 3.4L17 11.3H7" />';
const ICON_PAR = '<path d="M8 20h8" /><path d="M12 20v-5" /><path d="M9 4.5h6l-1 5h-4Z" />';
const ICON_YARDS = '<ellipse cx="12" cy="17" rx="7" ry="3" /><path d="M12 14V5" /><path d="M12 5.5h5l-1.6 2 1.6 2H12" />';
const ICON_GPS = '<path d="M21 3 14 21l-2.2-7.8L4 11Z" />';

function cityStateLine(course) {
  if (course.city && course.state) return `${course.city}, ${course.state}`;
  return course.city || course.state || '';
}

// One stat cell. Callers pass null for a cell that has no value, and it is
// dropped entirely rather than rendered empty (§14.2).
function statCellHtml(cell) {
  if (!cell) return '';
  return `
    <div class="course-stat">
      <span class="course-stat-icon">${icon(cell.iconPaths)}</span>
      <span class="course-stat-value">${escapeHtml(cell.value)}</span>
      <span class="course-stat-label">${escapeHtml(cell.label)}</span>
    </div>`;
}

function detailRowHtml({ id, iconPaths, title, subtitle, value, badge = 'neutral' }) {
  return `
    <button class="course-row course-detail-row" id="${id}">
      <span class="course-row-badge ${badge}">${icon(iconPaths)}</span>
      <span class="course-row-text">
        <span class="course-row-title">${escapeHtml(title)}</span>
        ${subtitle ? `<span class="course-row-sub">${escapeHtml(subtitle)}</span>` : ''}
      </span>
      ${value ? `<span class="course-row-value">${escapeHtml(value)}</span>` : ''}
      <svg class="course-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_CHEVRON}</svg>
    </button>`;
}

// What the status row says beneath "Hole Details Loaded".
//
// The title answers "can I start a round?", which is what the golfer is
// about to do and is true as soon as pars resolve — the template floor
// guarantees that (§11.5). The subtitle answers "what is actually here?"
// honestly, in plain language: greens are counted, nothing is claimed that
// was not loaded, and no source is named.
function statusSubtitle(coverage) {
  if (coverage.greensMapped > 0) {
    return coverage.greensMapped === coverage.holeCount
      ? `All ${coverage.holeCount} greens mapped`
      : `${coverage.greensMapped} of ${coverage.holeCount} greens mapped`;
  }
  return coverage.hasYardages ? 'Pars and yardages ready' : `Pars ready for ${coverage.holeCount} holes`;
}

export function renderCourseDetails(root) {
  const courseId = getPendingCourseId();
  if (!courseId || !db.getCourse(courseId)) { location.hash = '#/course/select'; return; }

  // Kicked off once per course and never awaited. Start Round reads only
  // what is already cached, so a slow or dead Overpass costs the golfer
  // nothing but an unmapped course (§14.12.1).
  ensureGeometry(courseId, root);
  draw(root, courseId);
}

// Kept as the old name too: the router and any existing link still call
// renderCourseSetup, and this screen is the same destination.
export const renderCourseSetup = renderCourseDetails;

function draw(root, courseId) {
  const course = db.getCourse(courseId);
  if (!course) { location.hash = '#/course/select'; return; }

  const holeCount = course.hole_count === 18 ? 18 : 9;
  const coverage = courseCoverage(course);
  const selectedTee = db.getSelectedTee(courseId);
  const holeDefs = db.resolveHoleDefs(courseId, { holeCount, teeId: selectedTee?.tee_id ?? null });
  const par = holeDefs.reduce((t, d) => t + (d.par || 0), 0);
  const totalYards = db.totalYardsForTee(courseId, { holeCount, teeId: selectedTee?.tee_id ?? null });
  const cityState = cityStateLine(course);

  const cells = [
    { iconPaths: ICON_HOLES, value: String(holeCount), label: 'Holes' },
    { iconPaths: ICON_PAR, value: `Par ${par}`, label: 'Par' },
    // Omitted rather than shown as "— yd" when no tee or hole yardage is
    // known, which is the common case for a manual course.
    totalYards != null ? { iconPaths: ICON_YARDS, value: `${totalYards} yd`, label: 'Total Yards' } : null,
    coverage.hasMap ? { iconPaths: ICON_GPS, value: 'GPS map', label: 'available' } : null,
  ];

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
          <h1 class="course-hero-title">Course Details</h1>
          <div class="course-hero-sub">Review the course and start your round.</div>
        </div>
      </div>

      <div class="scroll">
        <div class="card course-identity-card">
          <div class="course-identity">
            <span class="course-row-badge accent-flag">${icon(ICON_FLAG)}</span>
            <span class="course-identity-text">
              <span class="course-identity-name">${escapeHtml(course.name)}</span>
              ${cityState ? `<span class="course-identity-place">${escapeHtml(cityState)}</span>` : ''}
            </span>
          </div>
          <div class="course-stat-row">${cells.map(statCellHtml).join('')}</div>
        </div>

        ${coverage.teeSets.length ? detailRowHtml({
          id: 'teeBoxBtn',
          iconPaths: ICON_FLAG,
          title: 'Tee Box',
          subtitle: 'Change tee selection',
          value: selectedTee ? selectedTee.name : '',
        }) : ''}

        ${COURSE_MAP_ENABLED && coverage.hasMap ? detailRowHtml({
          id: 'courseMapBtn',
          iconPaths: ICON_MAP,
          title: 'View Course Map',
        }) : ''}

        ${detailRowHtml({
          id: 'holeDataBtn',
          iconPaths: ICON_CHECK,
          title: 'Hole Details Loaded',
          subtitle: statusSubtitle(coverage),
          badge: 'accent',
        })}
      </div>

      <div class="course-details-actions">
        <button class="btn btn-primary btn-hero" id="startRoundBtn">Start Round &rsaquo;</button>
        <button class="btn btn-outline" id="editCourseBtn">Edit Course Info</button>
      </div>
    </div>
  `;

  qs('#backBtn', root).addEventListener('click', () => {
    clearPendingCourse();
    location.hash = '#/course/select';
  });

  qs('#teeBoxBtn', root)?.addEventListener('click', () => openTeeSheet(root, courseId));
  qs('#holeDataBtn', root).addEventListener('click', () => openCoverageSheet(root, courseId));
  qs('#editCourseBtn', root).addEventListener('click', () => { location.hash = '#/course/edit'; });

  qs('#startRoundBtn', root).addEventListener('click', () => startRound(courseId, holeCount, holeDefs, selectedTee));
}

// ----- Geometry lookup -----

// Fetched at most once per course, in the background, and never awaited by
// anything the golfer is waiting on. A failure is indistinguishable from an
// unmapped course as far as this screen is concerned: no cell, no map row,
// no message. Raw Overpass errors never reach the golfer (§8).
function ensureGeometry(courseId, root) {
  const course = db.getCourse(courseId);
  if (!course || db.courseGeometryChecked(courseId)) return;
  // Nothing to look up without a location — a hand-typed course stays
  // manual and is fully first-class (§14.7 D).
  if (!Number.isFinite(course.latitude) && !course.place_id) return;

  loadCourseGeometry({
    latitude: course.latitude,
    longitude: course.longitude,
    place_id: course.place_id,
  }).then(({ status, geometry }) => {
    // An unreachable service is NOT recorded as "checked": the course may
    // well be mapped, and marking it checked would mean never looking
    // again. A genuine "no features" answer is recorded, so an unmapped
    // course is not re-queried on every visit (§14.12.1).
    if (status === GEOMETRY_STATUS.UNREACHABLE) return;
    const tees = geometry ? teeSetsFromGeometry(geometry, db.getCourse(courseId)?.hole_count) : [];
    db.setCourseGeometry(courseId, geometry, tees);
    // Only repaint if the golfer is still here. Navigating away mid-fetch
    // must not yank a screen out from under them.
    if (location.hash === '#/course/setup' && getPendingCourseId() === courseId) draw(root, courseId);
  }).catch(() => {
    // loadCourseGeometry does not throw, but a caller that assumes so is
    // one refactor away from an unhandled rejection killing the screen.
  });
}

// ----- Tee selection (§14.3) -----

function openTeeSheet(root, courseId) {
  const tees = db.getCourseTees(courseId);
  if (!tees.length) return;
  const selected = db.getSelectedTee(courseId);

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="teeSheetTitle">
      <h2 id="teeSheetTitle">Tee Box</h2>
      <p class="tiny muted" style="margin-bottom:var(--space-3);">Published yardages change with the tee you play. Green positions do not.</p>
      <div class="stack">
        ${tees.map((t) => `
          <button class="btn tee-option ${selected?.tee_id === t.tee_id ? 'selected' : ''}" data-tee="${escapeHtml(t.tee_id)}" aria-pressed="${selected?.tee_id === t.tee_id}">
            <span>${escapeHtml(t.name)}</span>
            <span class="tee-option-yards">${t.total_yards} yd</span>
          </button>`).join('')}
        <button class="btn btn-outline" id="teeCancelBtn">Cancel</button>
      </div>
    </div>
  `;
  if (!presentSheet(backdrop)) return;
  const untrap = trapSheetFocus(backdrop, close);
  qs('#teeCancelBtn', backdrop).focus();

  function close() { untrap(); backdrop.remove(); }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#teeCancelBtn', backdrop).addEventListener('click', close);
  qsa('.tee-option', backdrop).forEach((btn) => {
    // One tap selects and closes (§14.3).
    btn.addEventListener('click', () => {
      db.setSelectedTee(courseId, btn.dataset.tee);
      close();
      draw(root, courseId);
    });
  });
}

// ----- Per-hole coverage (§14.2's tappable status row) -----

function openCoverageSheet(root, courseId) {
  const course = db.getCourse(courseId);
  const coverage = courseCoverage(course);
  const holeCount = course.hole_count === 18 ? 18 : 9;
  const selectedTee = db.getSelectedTee(courseId);
  const defs = db.resolveHoleDefs(courseId, { holeCount, teeId: selectedTee?.tee_id ?? null });
  const geometryHoles = course.geometry?.holes || [];

  const rows = defs.map((d) => {
    const mapped = geometryHoles.find((h) => h.hole_number === d.hole_number)?.green;
    return `
      <div class="coverage-row">
        <span class="coverage-hole">${d.hole_number}</span>
        <span class="coverage-par">Par ${d.par}</span>
        <span class="coverage-yards">${d.yardage != null ? `${d.yardage} yd` : ''}</span>
        <span class="coverage-green ${mapped ? 'on' : ''}">${mapped ? 'Green mapped' : ''}</span>
      </div>`;
  }).join('');

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="coverageTitle">
      <h2 id="coverageTitle">Hole Details</h2>
      <p class="tiny muted" style="margin-bottom:var(--space-3);">${escapeHtml(statusSubtitle(coverage))}${selectedTee ? ` &middot; ${escapeHtml(selectedTee.name)} tees` : ''}</p>
      <div class="coverage-list">${rows}</div>
      <button class="btn btn-outline" id="coverageCloseBtn" style="margin-top:var(--space-3);">Done</button>
    </div>
  `;
  if (!presentSheet(backdrop)) return;
  const untrap = trapSheetFocus(backdrop, close);
  qs('#coverageCloseBtn', backdrop).focus();

  function close() { untrap(); backdrop.remove(); }
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#coverageCloseBtn', backdrop).addEventListener('click', close);
}

// ----- Start Round -----

function startRound(courseId, holeCount, holeDefs, selectedTee) {
  // One round at a time. Re-read live storage rather than trusting a value
  // captured at render, so a second tap resumes rather than orphaning.
  const inProgress = db.getActiveRound();
  if (inProgress) { location.hash = '#/course/round'; return; }

  const course = db.getCourse(courseId);
  if (!course) { location.hash = '#/course/select'; return; }

  // hole_defs are resolved from what is already cached — no lookup happens
  // here, and none is awaited. The round snapshots them so it stays
  // readable even if the course is later re-fetched, renamed or retee'd
  // (§6, §14.3's "already-played holes keep the yardage they were played
  // under").
  const round = db.createRound({
    course_id: course.course_id,
    course_name: course.name,
    course_city: course.city,
    course_state: course.state,
    course_place_id: course.place_id,
    course_source: course.source,
    latitude: course.latitude,
    longitude: course.longitude,
    hole_count: holeCount,
    hole_defs: holeDefs,
    // Which tee these yardages came from, so Explore Round and History can
    // say what the round was played off without re-deriving it.
    tee_id: selectedTee?.tee_id ?? null,
    tee_name: selectedTee?.name ?? null,
  });
  if (!round) { toast('Could not start the round'); return; }

  db.recordCoursePlayed(course.course_id, { hole_count: holeCount, hole_defs: holeDefs });
  clearPendingCourse();
  location.hash = '#/course/round';
}
