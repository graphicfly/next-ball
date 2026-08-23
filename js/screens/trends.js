import * as db from '../db.js';
import { qs, qsa, fmtDate, fmtDateShort, emptyStateHtml } from '../ui.js';
import { sessionTrendPoint } from '../stats.js';

const METRICS = [
  { key: 'solidPct', title: 'Solid', suffix: '%', diffSuffix: ' pts' },
  { key: 'toppedPct', title: 'Topped', suffix: '%', diffSuffix: ' pts' },
  { key: 'fatPct', title: 'Fat', suffix: '%', diffSuffix: ' pts' },
  { key: 'thinPct', title: 'Thin', suffix: '%', diffSuffix: ' pts' },
  { key: 'straightPct', title: 'Straight', suffix: '%', diffSuffix: ' pts' },
  { key: 'medianSolidDistance', title: 'Distance', suffix: ' yd', diffSuffix: ' yd' },
];

function lineChartSVG(points, metric) {
  const data = points
    .map((p) => ({ date: p.date, value: p[metric.key] }))
    .filter((d) => d.value !== null && d.value !== undefined);

  if (data.length < 1) return { svg: `<div class="empty-state">No ${metric.title.toLowerCase()} data recorded yet for these sessions.</div>`, hasData: false };

  const width = 320, height = 128, padX = 10, padTop = 14, padBottom = 34;
  const plotHeight = height - padTop - padBottom;
  const values = data.map((d) => d.value);
  let minV = Math.min(...values), maxV = Math.max(...values);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const stepX = data.length > 1 ? (width - 2 * padX) / (data.length - 1) : 0;
  const scaleY = (v) => padTop + plotHeight - ((v - minV) / (maxV - minV)) * plotHeight;
  const baseline = padTop + plotHeight;

  const pts = data.map((d, i) => ({ x: padX + i * stepX, y: scaleY(d.value), value: d.value, date: d.date }));
  const path = pts.map((pt, i) => (i === 0 ? 'M' : 'L') + pt.x.toFixed(1) + ',' + pt.y.toFixed(1)).join(' ');
  const areaPath = pts.length > 1
    ? `${path} L${pts[pts.length - 1].x.toFixed(1)},${baseline} L${pts[0].x.toFixed(1)},${baseline} Z`
    : '';

  const dots = pts.map((pt, i) => `
    <circle class="trend-hit" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="12" fill="transparent" data-date="${pt.date}" data-value="${pt.value}"></circle>
    <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${i === pts.length - 1 ? 5 : 3.5}" fill="var(--color-accent)" stroke="var(--color-bg)" stroke-width="2" pointer-events="none"></circle>
  `).join('');

  // Sparse date ticks — first, middle, last — rather than one per point, so
  // the axis stays legible even with many sessions plotted.
  const tickIndices = [...new Set([0, Math.floor((pts.length - 1) / 2), pts.length - 1])];
  const ticks = pts.length > 1 ? tickIndices.map((i) => {
    const anchor = i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle';
    return `<text class="chart-axis-label" x="${pts[i].x.toFixed(1)}" y="${height - 8}" text-anchor="${anchor}">${fmtDateShort(pts[i].date)}</text>`;
  }).join('') : '';

  const svg = `
    <svg class="chart" viewBox="0 0 ${width} ${height}" data-metric="${metric.key}">
      ${areaPath ? `<path d="${areaPath}" fill="var(--color-accent-soft)" stroke="none" pointer-events="none"></path>` : ''}
      ${pts.length > 1 ? `<path d="${path}" fill="none" stroke="var(--color-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"></path>` : ''}
      <line x1="${padX}" y1="${baseline}" x2="${width - padX}" y2="${baseline}" class="chart-axis-line" />
      ${dots}
      ${ticks}
    </svg>
    <div class="chart-tooltip"></div>
    <div style="display:flex; justify-content:space-between;" class="tiny muted">
      <span>${Math.round(minV)}${metric.suffix}</span>
      <span>${Math.round(maxV)}${metric.suffix}</span>
    </div>`;
  return { svg, hasData: true };
}

export function renderTrends(root) {
  const allClubs = [...new Set(db.getAllShots().map((s) => s.club))].sort();
  const hasAnyFinished = db.listFinishedSessions().length > 0;
  const filter = { club: null, setup: null, surface: null, swing: null };
  let showTable = false;
  let activeMetricKey = METRICS[0].key;

  function computePoints() {
    // Sort by full creation timestamp (not just the date string) so multiple
    // sessions on the same calendar day still plot in true chronological order.
    const sessions = db.listFinishedSessions().sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    return sessions
      .map((session) => sessionTrendPoint(session, db.getShotsForSession(session.session_id), filter))
      .filter(Boolean);
  }

  function renderBody() {
    const points = computePoints();
    const metric = METRICS.find((m) => m.key === activeMetricKey);

    const filtersHtml = `
      <div class="pill-select">
        <div class="pill ${!filter.club ? 'active' : ''}" data-f="club" data-v="">All Clubs</div>
        ${allClubs.map((c) => `<div class="pill ${filter.club === c ? 'active' : ''}" data-f="club" data-v="${c}">${c}</div>`).join('')}
      </div>
      <div class="pill-select">
        <div class="pill ${!filter.setup ? 'active' : ''}" data-f="setup" data-v="">All Setups</div>
        <div class="pill ${filter.setup === 'ground' ? 'active' : ''}" data-f="setup" data-v="ground">Ground</div>
        <div class="pill ${filter.setup === 'tee' ? 'active' : ''}" data-f="setup" data-v="tee">Tee</div>
      </div>
      <div class="pill-select">
        <div class="pill ${!filter.surface ? 'active' : ''}" data-f="surface" data-v="">All Surfaces</div>
        <div class="pill ${filter.surface === 'mat' ? 'active' : ''}" data-f="surface" data-v="mat">Mat</div>
        <div class="pill ${filter.surface === 'grass' ? 'active' : ''}" data-f="surface" data-v="grass">Grass</div>
      </div>
      <div class="pill-select">
        <div class="pill ${!filter.swing ? 'active' : ''}" data-f="swing" data-v="">All Swings</div>
        <div class="pill ${filter.swing === 'half' ? 'active' : ''}" data-f="swing" data-v="half">Half</div>
        <div class="pill ${filter.swing === 'three-quarter' ? 'active' : ''}" data-f="swing" data-v="three-quarter">3/4</div>
        <div class="pill ${filter.swing === 'full' ? 'active' : ''}" data-f="swing" data-v="full">Full</div>
      </div>
      <div class="hairline"></div>
      <div class="pill-select">
        ${METRICS.map((m) => `<div class="pill ${m.key === activeMetricKey ? 'active' : ''}" data-metric="${m.key}">${m.title}</div>`).join('')}
      </div>
      <button class="btn btn-sm btn-ghost" id="toggleTableBtn" style="margin-bottom:var(--space-4);">${showTable ? 'Show chart' : 'Show as table'}</button>
    `;

    let bodyHtml;
    if (!points.length) {
      bodyHtml = !hasAnyFinished
        ? emptyStateHtml({
            icon: 'trends',
            title: 'Not enough data yet',
            body: 'Finish a range session and your trends will start building here.',
            actionLabel: 'Start Range Session',
            actionId: 'emptyStartBtn',
          })
        : emptyStateHtml({
            icon: 'trends',
            title: 'No sessions match these filters',
            body: 'Try a different club, setup, surface, or swing length.',
            actionLabel: 'Clear Filters',
            actionId: 'emptyClearFiltersBtn',
          });
    } else if (showTable) {
      bodyHtml = `
        <div style="overflow-x:auto;">
          <table class="block-table">
            <thead><tr><th>Date</th>${METRICS.map((m) => `<th>${m.title}</th>`).join('')}</tr></thead>
            <tbody>
              ${points.map((p) => `<tr><td>${fmtDate(p.date)}</td>${METRICS.map((m) => `<td>${p[m.key] !== null && p[m.key] !== undefined ? p[m.key] + m.suffix : '—'}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } else {
      const values = points.map((p) => p[metric.key]).filter((v) => v !== null && v !== undefined);
      const latest = values.length ? values[values.length - 1] : null;
      const first = values.length ? values[0] : null;
      const diff = latest != null && first != null && values.length > 1 ? Math.round((latest - first) * 10) / 10 : null;
      const diffDir = diff == null || diff === 0 ? 'flat' : diff > 0 ? 'up' : 'down';
      const { svg } = lineChartSVG(points, metric);
      bodyHtml = `
        <div class="trend-headline">
          <div class="metric-label">${metric.title}</div>
          <div class="metric-value">${latest != null ? latest + metric.suffix : '—'}</div>
          ${diff != null ? `<div class="trend-delta"><b class="${diffDir}">${diff > 0 ? '+' : ''}${diff}${metric.diffSuffix}</b> over ${values.length} session${values.length === 1 ? '' : 's'}</div>` : ''}
        </div>
        <div class="card">${svg}</div>`;
    }

    qs('#trendsBody', root).innerHTML = filtersHtml + bodyHtml;

    qsa('.pill[data-f]', root).forEach((pill) => {
      pill.addEventListener('click', () => {
        filter[pill.dataset.f] = pill.dataset.v || null;
        renderBody();
      });
    });

    qsa('.pill[data-metric]', root).forEach((pill) => {
      pill.addEventListener('click', () => {
        activeMetricKey = pill.dataset.metric;
        renderBody();
      });
    });

    qs('#toggleTableBtn', root)?.addEventListener('click', () => {
      showTable = !showTable;
      renderBody();
    });

    qs('#emptyStartBtn', root)?.addEventListener('click', () => { location.hash = '#/start'; });
    qs('#emptyClearFiltersBtn', root)?.addEventListener('click', () => {
      filter.club = null; filter.setup = null; filter.surface = null; filter.swing = null;
      renderBody();
    });

    qsa('.trend-hit', root).forEach((hit) => {
      hit.addEventListener('click', (e) => {
        const svg = hit.closest('svg');
        const tooltip = svg.parentElement.querySelector('.chart-tooltip');
        if (!tooltip) return;
        tooltip.textContent = `${fmtDate(hit.dataset.date)}: ${hit.dataset.value}`;
      });
    });
  }

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="homeBtn">&larr; Home</button>
        <span class="screen-title">Trends</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll" id="trendsBody"></div>
    </div>
  `;

  qs('#homeBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
  renderBody();
}
