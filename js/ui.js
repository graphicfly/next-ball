// Small shared DOM + formatting helpers used by every screen.

import { getActiveSession, TRAINING_AID_LABELS } from './db.js';

// ---------- Theme ----------

const THEME_QUERY = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
let systemThemeListenerBound = false;

function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return THEME_QUERY && THEME_QUERY.matches ? 'light' : 'dark';
}

function paintThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
  if (bg) meta.setAttribute('content', bg);
}

// pref: 'light' | 'dark' | 'system' (or null/undefined, treated as 'system').
// Safe to call repeatedly (e.g. every screen render) — only touches the DOM
// when the resolved theme actually changes.
export function applyTheme(pref) {
  const resolved = resolveTheme(pref);
  if (document.documentElement.getAttribute('data-theme') !== resolved) {
    document.documentElement.setAttribute('data-theme', resolved);
    paintThemeColor();
  }
  if (THEME_QUERY && !systemThemeListenerBound) {
    systemThemeListenerBound = true;
    THEME_QUERY.addEventListener('change', () => {
      // Only react live to system changes if the user hasn't pinned a theme.
      import('./db.js').then(({ getSettings }) => {
        const current = getSettings().theme;
        if (current !== 'light' && current !== 'dark') applyTheme(current);
      });
    });
  }
}

// ---------- Bottom navigation ----------
// Minimal, additive UI shell shown only on the four top-level sections.
// Purely presentational — it just sets location.hash, so it never touches
// the router or any screen's own logic.

const NAV_ITEMS = [
  { hash: '#/home', label: 'Home', icon: 'home' },
  { hash: '#/history', label: 'History', icon: 'history' },
  { hash: '#/trends', label: 'Trends', icon: 'trends' },
  { hash: '#/settings', label: 'Settings', icon: 'settings' },
];

const NAV_ICONS = {
  home: '<path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9h12v-9" />',
  history: '<circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2" /><path d="M9 3h6" />',
  trends: '<path d="M4 18V9" /><path d="M11 18V5" /><path d="M18 18v-7" />',
  settings: '<circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.3 3H9.7l-.3 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.3 2.6h4.6l.3-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.07-.4.1-.8.1-1.2Z" />',
};

function svgIcon(name) {
  return `<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${NAV_ICONS[name] || ''}</svg>`;
}

// ---------- Weather glyph ----------
// A single small condition icon so temperature readouts are scannable at a
// glance without competing visually with shot data — text always carries
// the same information, so this is a pure legibility assist, not the only
// signal.

const WEATHER_ICONS = {
  sun: '<circle cx="12" cy="12" r="4.2" /><path d="M12 3v2.4M12 16.6V19M5 12h2.4M14.6 12H19M6.3 6.3l1.7 1.7M14 14l1.7 1.7M6.3 17.7l1.7-1.7M14 10l1.7-1.7" />',
  cloud: '<path d="M7.5 17.5a4 4 0 0 1-.4-7.97 5 5 0 0 1 9.6-1.9 4.3 4.3 0 0 1-.2 9.87h-9Z" />',
  rain: '<path d="M7.5 14.5a4 4 0 0 1-.4-7.97 5 5 0 0 1 9.6-1.9 4.3 4.3 0 0 1-.2 9.87h-9Z" /><path d="M8.5 18v2M12 18v2M15.5 18v2" />',
  snow: '<path d="M7.5 13.5a4 4 0 0 1-.4-7.97 5 5 0 0 1 9.6-1.9 4.3 4.3 0 0 1-.2 9.87h-9Z" /><path d="M8.5 17.5v3M7 19h3M14 17.5v3M12.5 19h3" />',
};

function weatherIconKey(condition) {
  const c = (condition || '').toLowerCase();
  if (/rain|drizzle|shower|storm|thunder/.test(c)) return 'rain';
  if (/snow|sleet|flurr/.test(c)) return 'snow';
  if (/clear|sun/.test(c)) return 'sun';
  if (c) return 'cloud';
  return null;
}

export function weatherIconHtml(condition) {
  const key = weatherIconKey(condition);
  if (!key) return '';
  return `<svg class="weather-icon" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${WEATHER_ICONS[key]}</svg>`;
}

// Screens that show the bottom nav. Every other route hides it so
// single-task flows (starting/logging/reviewing a session) stay uncluttered.
const NAV_ROUTES = new Set(['#/home', '#/history', '#/trends', '#/settings']);

export function syncBottomNav(hash) {
  const appEl = document.getElementById('app');
  const show = NAV_ROUTES.has(hash);
  appEl?.classList.toggle('has-nav', show);

  let nav = document.getElementById('bottomNav');
  if (!show) {
    nav?.remove();
    return;
  }
  if (!nav) {
    nav = document.createElement('nav');
    nav.id = 'bottomNav';
    nav.className = 'nav-bottom';
    nav.innerHTML = `<div class="nav-bottom-inner">${NAV_ITEMS.map((item) => `
      <button class="nav-item" data-hash="${item.hash}" aria-label="${item.label}">
        <span class="nav-icon-wrap">${svgIcon(item.icon)}<span class="nav-dot" hidden></span></span>
        <span>${item.label}</span>
      </button>`).join('')}</div>`;
    document.body.appendChild(nav);
    qsa('.nav-item', nav).forEach((btn) => {
      btn.addEventListener('click', () => { navigate(btn.dataset.hash); });
    });
  }
  qsa('.nav-item', nav).forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.hash === hash);
  });

  // A paused/active session waiting to be resumed is easy to lose track of
  // once you've navigated away from Home — a small dot on the Home tab
  // keeps it discoverable from anywhere in the app.
  const homeDot = nav.querySelector('.nav-item[data-hash="#/home"] .nav-dot');
  if (homeDot) homeDot.hidden = !getActiveSession();
}

// Traps Tab/Shift+Tab within `container` and calls `onClose` on Escape,
// while `container` is open. Returns a cleanup function to call when the
// dialog closes by any other means (so the listener doesn't leak). Used by
// the newer, more deliberately accessible confirmation dialogs — not
// retrofitted onto every existing sheet in the app.
export function trapSheetFocus(container, onClose) {
  const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusables = () => qsa(selector, container).filter((el) => !el.disabled && el.offsetParent !== null);
  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKeydown);
  return () => document.removeEventListener('keydown', onKeydown);
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function qsa(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer = null;
export function toast(message, ms = 900) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), ms);
}

export function navigate(hash) {
  if (location.hash === hash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}

export function cap(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtSwing(s) {
  return { half: 'Half', 'three-quarter': '3/4', full: 'Full' }[s] || cap(s);
}

export function fmtSetup(s) {
  return { ground: 'Ground', tee: 'Tee' }[s] || cap(s);
}

export function fmtSurface(s) {
  return { mat: 'Mat', grass: 'Grass' }[s] || cap(s);
}

export function fmtStrike(s) {
  return cap(s);
}

export function fmtDirection(s) {
  return cap(s);
}

export function fmtHeight(s) {
  return cap(s);
}

export function fmtDistance(label) {
  return label;
}

export function fmtDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y) return dateStr;
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Compact "Aug 12" form (no year) — used for chart axis ticks, where space
// is tight and the year is implied by context.
export function fmtDateShort(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y) return dateStr;
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h)) return timeStr;
  const dt = new Date();
  dt.setHours(h, m || 0, 0, 0);
  return dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Formats a full ISO datetime (e.g. a weather_timestamp) as a local clock
// time — "1:23 PM" — since the date is almost always "today" in context.
export function fmtDateTime(isoString) {
  if (!isoString) return '';
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Rounded, plain-word duration for the Session Recap header ("16 min" /
// "16 sec") — deliberately coarser than fmtDuration's h/m/s breakdown, which
// stays in use for Conditions where more precision is appropriate.
export function fmtDurationWords(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) return null;
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} sec`;
  return `${Math.round(s / 60)} min`;
}

export function fmtDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) return '—';
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function todayLocalDate() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

export function nowLocalTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Normalizes practice_focus for display/export — handles both the current
// array shape and the single-string shape from sessions saved before
// multi-select focus was added.
export function focusList(practiceFocus) {
  if (!practiceFocus) return [];
  return Array.isArray(practiceFocus) ? practiceFocus : [practiceFocus];
}

// Contact outcomes mapped to a status tone — used so the Contact bar chart
// encodes "good / caution / bad" visually without relying on color alone
// (the label + percentage text always carries the same meaning too).
export const STRIKE_TONE = { solid: '', thin: 'warning', topped: 'warning', fat: 'warning', shank: 'danger', miss: 'danger' };

export function barLine(label, count, pctValue, tone = '') {
  const toneClass = tone ? ` ${tone}` : '';
  return `
    <div class="stat-line">
      <div class="top"><span class="label">${label}</span><span class="value">${count} &middot; ${pctValue}%</span></div>
      <div class="bar-bg"><div class="bar-fill${toneClass}" style="width:${pctValue}%"></div></div>
    </div>`;
}

// ---------- Metric / comparison building blocks ----------
// Shared across Home, Active, Summary, History and Trends so every big
// number in the app renders with the same display typography.

export function metricHtml(value, label, size = '') {
  const sizeClass = size ? ` size-${size}` : '';
  return `<div class="metric"><div class="metric-value${sizeClass}">${value}</div><div class="metric-label">${label}</div></div>`;
}

export function metricRowHtml(metrics, size = '') {
  return `<div class="metric-row">${metrics.map((m) => metricHtml(m.value, m.label, size)).join('')}</div>`;
}

// A signed delta chip ("+8 pts" / "-3 pts"). The arrow always matches the
// literal sign of the number (so it never contradicts the "+"/"-" printed
// next to it); color is the only thing that reflects whether that change is
// an improvement, a regression, or neutral for this metric — per
// `betterWhen`, the shape already used by stats.js comparisons: 'higher' |
// 'lower' | null.
export function deltaHtml(diff, suffix, betterWhen) {
  if (diff === null || diff === undefined) return '';
  const improved = betterWhen === 'higher' ? diff > 0 : betterWhen === 'lower' ? diff < 0 : null;
  const worsened = betterWhen === 'higher' ? diff < 0 : betterWhen === 'lower' ? diff > 0 : null;
  const tone = improved ? 'up' : worsened ? 'down' : 'flat';
  const sign = diff > 0 ? '+' : '';
  const arrow = diff > 0 ? '&#8599;' : diff < 0 ? '&#8600;' : '';
  return `<span class="metric-delta ${tone}">${arrow} ${sign}${diff}${suffix}</span>`;
}

export function statusBadgeHtml(text, tone = 'neutral') {
  return `<span class="status-badge ${tone}">${text}</span>`;
}

// A slightly warmer empty state than a bare line of muted text — an icon
// (reusing the nav glyph set for visual consistency, never a mascot/
// illustration), a short title, a supporting line, and an optional action
// so the screen gives the golfer somewhere to go rather than a dead end.
export function emptyStateHtml({ icon, title, body, actionLabel, actionId }) {
  return `
    <div class="empty-state rich">
      ${icon ? `<div class="empty-state-icon">${svgIcon(icon)}</div>` : ''}
      <div class="empty-state-title">${title}</div>
      ${body ? `<div class="empty-state-body">${body}</div>` : ''}
      ${actionLabel ? `<button class="btn btn-primary" id="${actionId}" style="max-width:260px; margin:var(--space-4) auto 0;">${actionLabel}</button>` : ''}
    </div>`;
}

// A single proportional bar for any N-way breakdown (Contact, Direction,
// Trajectory) — reads faster as one bar than as N separate stat-lines, and
// scales down gracefully for the categories that happen to be 0% instead of
// each still claiming a full row's worth of vertical space.
// segments: [{ key, label, count, pct, tone }], tone: 'positive'|'neutral'|'warning'|'danger'.
export function segmentedBarHtml(segments) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) {
    return `<div class="seg-bar"><div class="seg neutral" style="width:100%;"></div></div>`;
  }
  return `<div class="seg-bar">${segments.filter((s) => s.pct > 0).map((s) => `<div class="seg ${s.tone}" style="width:${s.pct}%;"></div>`).join('')}</div>`;
}

// An equal-weight legend row — every segment shown the same way, for
// breakdowns where no single category dominates the story (Direction,
// Trajectory).
export function segmentedLegendHtml(segments) {
  return `<div class="seg-legend">${segments.map((s) => `<div class="seg-legend-item"><span class="dot ${s.tone}"></span>${cap(s.label)} <b>${s.pct}%</b></div>`).join('')}</div>`;
}

// A compact one-line legend ("14% Top • 12% Fat • ...") — for breakdowns
// where the categories are secondary detail, not each worth their own row.
export function segmentedLegendCompactHtml(segments) {
  return `<div class="seg-legend-compact">${segments.map((s) => `${s.pct}% ${cap(s.label)}`).join(' &bull; ')}</div>`;
}

const DIRECTION_KEYS = ['left', 'straight', 'right'];

export function directionBarHtml(dir) {
  const segments = DIRECTION_KEYS.map((k) => ({ key: k, label: k, count: dir[k].count, pct: dir[k].pct, tone: k === 'straight' ? 'positive' : 'neutral' }));
  return segmentedBarHtml(segments) + segmentedLegendHtml(segments);
}

const HEIGHT_KEYS = ['low', 'medium', 'high'];

export function heightDistributionHtml(height) {
  const segments = HEIGHT_KEYS.map((k) => ({ key: k, label: k, count: height[k].count, pct: height[k].pct, tone: 'neutral' }));
  return `<div class="dist-block">${segmentedBarHtml(segments)}${segmentedLegendCompactHtml(segments)}</div>`;
}

// Contact gets its own composition: the primary (Solid) category called out
// large, then the bar, then everything else condensed into one compact
// line — per the product spec, zero-value categories still appear but never
// claim a full row of their own.
const CONTACT_REST_KEYS = ['topped', 'fat', 'thin', 'shank', 'miss'];

export function contactDistributionHtml(strike) {
  const allSegments = ['solid', ...CONTACT_REST_KEYS].map((k) => ({
    key: k, label: k, count: strike[k].count, pct: strike[k].pct,
    tone: STRIKE_TONE[k] === '' ? 'positive' : STRIKE_TONE[k],
  }));
  const rest = allSegments.filter((s) => s.key !== 'solid');
  return `
    <div class="dist-block">
      <div class="contact-dist-primary"><b>${strike.solid.pct}%</b> Solid</div>
      ${segmentedBarHtml(allSegments)}
      ${segmentedLegendCompactHtml(rest)}
    </div>`;
}

// "Performance by Drill" — shared by the Session Summary and History Detail
// screens so both present drill comparisons identically. Collapsed behind
// an outer <details> (progressive disclosure); each drill shows three
// headline numbers up front, with the rest tucked behind its own toggle.
export function drillSectionHtml(drills) {
  if (!drills.length) return '';
  const row = (label, value) => `<div class="kv-row tiny"><span class="muted">${label}</span><b>${value}</b></div>`;
  return `
    <details class="section-details">
      <summary class="section-title">Performance by Drill</summary>
      ${drills.map((d) => `
        <div class="card" style="margin-bottom:var(--space-3);">
          <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:var(--space-3);">
            <span style="font-weight:var(--weight-semibold);">${escapeHtml(d.drill)}</span>
            <span class="tiny muted">${d.count} shot${d.count === 1 ? '' : 's'}</span>
          </div>
          ${metricRowHtml([
            { value: d.solidPct + '%', label: 'Solid' },
            { value: d.straightPct + '%', label: 'Straight' },
            { value: d.toppedPct + '%', label: 'Topped' },
          ], 'md')}
          <details class="section-details" style="margin-top:var(--space-3);">
            <summary class="tiny muted" style="text-transform:none; letter-spacing:0;">More stats</summary>
            <div style="margin-top:var(--space-2);">
              ${row('Fat', d.fatPct + '%')}
              ${row('Thin', d.thinPct + '%')}
              ${row('Median distance', d.medianDistance != null ? d.medianDistance + ' yd' : '—')}
              ${row('Median (Solid)', d.medianSolidDistance != null ? d.medianSolidDistance + ' yd' : '—')}
            </div>
          </details>
        </div>
      `).join('')}
    </details>
  `;
}

// "Training Aid" comparison — same card layout/progressive-disclosure as
// drillSectionHtml above, but the caller only renders this when there's
// actual variation worth comparing (see historyDetail.js's showTrainingAid
// gate); a session that used one aid (or none) the whole time has nothing
// to compare, so this never appears there. "No Training Aid" is used here
// specifically for the 'none' group's header — friendlier as a comparison
// label than the bare "None" used in the selection sheet.
export function trainingAidSectionHtml(groups) {
  if (groups.length < 2) return '';
  const row = (label, value) => `<div class="kv-row tiny"><span class="muted">${label}</span><b>${value}</b></div>`;
  return `
    <details class="section-details">
      <summary class="section-title">Training Aid</summary>
      ${groups.map((g) => `
        <div class="card" style="margin-bottom:var(--space-3);">
          <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:var(--space-3);">
            <span style="font-weight:var(--weight-semibold);">${g.training_aid === 'none' ? 'No Training Aid' : escapeHtml(TRAINING_AID_LABELS[g.training_aid] || cap(g.training_aid))}</span>
            <span class="tiny muted">${g.count} shot${g.count === 1 ? '' : 's'}</span>
          </div>
          ${metricRowHtml([
            { value: g.solidPct + '%', label: 'Solid' },
            { value: g.straightPct + '%', label: 'Straight' },
            { value: g.toppedPct + '%', label: 'Topped' },
          ], 'md')}
          <details class="section-details" style="margin-top:var(--space-3);">
            <summary class="tiny muted" style="text-transform:none; letter-spacing:0;">More stats</summary>
            <div style="margin-top:var(--space-2);">
              ${row('Fat', g.fatPct + '%')}
              ${row('Topped + Fat', g.toppedFatPct + '%')}
              ${row('Median (Solid)', g.medianSolidDistance != null ? g.medianSolidDistance + ' yd' : '—')}
            </div>
          </details>
        </div>
      `).join('')}
    </details>
  `;
}

// Small, muted timing note — deliberately not a headline stat, per the
// requirement that timing data stay out of the active logging screen and
// stay secondary everywhere else too.
export function timingLineHtml(timing) {
  if (timing.totalDurationSeconds == null) return '';
  const breaksNote = timing.longBreaks.length ? ` &bull; ${timing.longBreaks.length} long break${timing.longBreaks.length === 1 ? '' : 's'}` : '';
  return `<div class="tiny muted" style="margin-top:var(--space-2);">Session duration ${fmtDuration(timing.totalDurationSeconds)} &bull; ${fmtDuration(timing.avgGapSeconds)}/shot avg${breaksNote}</div>`;
}
