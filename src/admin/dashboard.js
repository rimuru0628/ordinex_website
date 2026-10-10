/**
 * Admin Dashboard  stat cards, Chart.js charts, recent reports.
 * Lazy-loaded by admin/app.js via `init(container, uid)`.
 *
 * Exports:
 *   computeStats(reports)      { total, pending, ongoing, completed }
 *   getRecentReports(reports)  last 10 sorted by submittedAt desc
 *   init(container, uid)       subscribes to Firestore and renders UI
 */

import { db } from '../shared/firebase.js';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import {
  statusBadge,
  formatDate,
  showLoadingOverlay,
  hideLoadingOverlay,
} from '../shared/ui-helpers.js';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

//  Constants 

const CATEGORIES = [
  'Health',
  'Transportation',
  'Environment',
  'Consumer Issue',
  'Others',
];

const BAR_COLORS = ['#F97316', '#FB923C', '#F59E0B', '#10B981', '#3B82F6'];

const LOADING_TIMEOUT_MS  = 3000;
const RECENT_REPORTS_LIMIT = 10;

//  Pure functions 

export function computeStats(reports) {
  let pending = 0, ongoing = 0, completed = 0;
  for (const r of reports) {
    if (r.status === 'Pending')        pending++;
    else if (r.status === 'Ongoing')   ongoing++;
    else if (r.status === 'Completed') completed++;
  }
  return { total: reports.length, pending, ongoing, completed };
}

export function getRecentReports(reports) {
  const toMs = (ts) => {
    if (!ts) return 0;
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (ts instanceof Date) return ts.getTime();
    return new Date(ts).getTime();
  };
  return [...reports]
    .sort((a, b) => toMs(b.submittedAt) - toMs(a.submittedAt))
    .slice(0, RECENT_REPORTS_LIMIT);
}

/** Most-reported category in a set of reports. Returns '' when empty. */
function topCategory(reports) {
  if (!reports.length) return '';
  const counts = {};
  for (const r of reports) {
    const c = r.category || 'Unknown';
    counts[c] = (counts[c] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

//  Date helpers 

function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

/** ISO YYYY-MM-DD string for a Date. */
function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

/** Filter reports to those whose submittedAt falls in [fromDate, toDate].
 *  Pass null for either bound to leave it open. */
function filterByDateRange(reports, fromDate, toDateBound) {
  return reports.filter((r) => {
    const d = tsToDate(r.submittedAt);
    if (!d) return false;
    if (fromDate && d < fromDate) return false;
    if (toDateBound && d > toDateBound) return false;
    return true;
  });
}

//  Dashboard HTML 

const DASHBOARD_HTML = `
<div class="dashboard">
  <h1 class="section-title">Dashboard</h1>

  <!-- Date range filter bar -->
  <div class="dash-filter-bar">
    <div class="dash-filter-presets">
      <button class="dash-preset-btn is-active" data-preset="all">All Time</button>
      <button class="dash-preset-btn" data-preset="today">Today</button>
      <button class="dash-preset-btn" data-preset="week">This Week</button>
      <button class="dash-preset-btn" data-preset="month">This Month</button>
      <button class="dash-preset-btn" data-preset="custom">Custom Range</button>
    </div>
    <div class="dash-filter-custom" id="dash-custom-range" style="display:none">
      <div class="dash-date-wrap">
        <label class="dash-date-label">From</label>
        <input type="date" id="dash-date-from" class="dash-date-input" />
      </div>
      <div class="dash-date-wrap">
        <label class="dash-date-label">To</label>
        <input type="date" id="dash-date-to" class="dash-date-input" />
      </div>
      <button class="btn dash-apply-btn" id="dash-apply-range">Apply</button>
    </div>
    <p class="dash-range-label" id="dash-range-label"></p>
  </div>

  <!-- Stat cards -->
  <div class="stat-cards">
    <div class="stat-card">
      <div class="stat-card__value" id="stat-total">0</div>
      <div class="stat-card__label">Total Reports</div>
    </div>
    <div class="stat-card stat-card--pending">
      <div class="stat-card__value" id="stat-pending">0</div>
      <div class="stat-card__label">Pending</div>
    </div>
    <div class="stat-card stat-card--ongoing">
      <div class="stat-card__value" id="stat-ongoing">0</div>
      <div class="stat-card__label">Ongoing</div>
    </div>
    <div class="stat-card stat-card--completed">
      <div class="stat-card__value" id="stat-completed">0</div>
      <div class="stat-card__label">Completed</div>
    </div>
    <div class="stat-card stat-card--top">
      <div class="stat-card__value stat-card__value--sm" id="stat-top-category"></div>
      <div class="stat-card__label">Top Category</div>
    </div>
  </div>

  <!-- Charts -->
  <div class="charts-row">
    <div class="chart-card"><h2>Reports Over Time</h2><canvas id="chart-line"></canvas></div>
    <div class="chart-card"><h2>By Category</h2><canvas id="chart-bar"></canvas></div>
    <div class="chart-card">
      <h2>Category Breakdown</h2>
      <canvas id="chart-pie" style="display:none"></canvas>
      <p id="chart-pie-empty">No data available</p>
    </div>
  </div>

  <!-- Recent reports -->
  <div class="recent-reports">
    <h2>Recent Reports</h2>
    <div id="recent-reports-list"></div>
  </div>
</div>
`;

//  Chart helpers 

function buildLastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  return days;
}

function dayLabel(date) {
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function buildLineData(reports, fromDate, toDateBound) {
  // Determine window: if custom range, use that; otherwise last 14 days
  let days;
  if (fromDate && toDateBound) {
    days = [];
    const cur = new Date(fromDate);
    cur.setHours(0, 0, 0, 0);
    const end = new Date(toDateBound);
    end.setHours(23, 59, 59, 999);
    while (cur <= end) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    // Cap at 60 days for readability
    if (days.length > 60) days = days.slice(-60);
  } else {
    days = buildLastNDays(14);
  }

  const counts = days.map((day) => {
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    return reports.filter((r) => {
      const d = tsToDate(r.submittedAt);
      return d && d >= day && d < next;
    }).length;
  });
  return { labels: days.map(dayLabel), data: counts };
}

function buildBarData(reports) {
  // Use actual categories found in data + known list
  const allCats = [...new Set([...CATEGORIES, ...reports.map(r => r.category).filter(Boolean)])];
  const data = allCats.map(cat => reports.filter(r => r.category === cat).length);
  return { labels: allCats, data };
}

function destroyChart(chartRef) {
  if (chartRef.current) {
    chartRef.current.destroy();
    chartRef.current = null;
  }
}

//  Chart state 

const lineChartRef = { current: null };
const barChartRef  = { current: null };
const pieChartRef  = { current: null };

//  Render functions 

function updateStats(reports) {
  const stats = computeStats(reports);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('stat-total',        stats.total);
  set('stat-pending',      stats.pending);
  set('stat-ongoing',      stats.ongoing);
  set('stat-completed',    stats.completed);
  set('stat-top-category', topCategory(reports));
}

function renderLineChart(reports, fromDate, toDate) {
  const canvas = document.getElementById('chart-line');
  if (!canvas) return;
  destroyChart(lineChartRef);
  const { labels, data } = buildLineData(reports, fromDate, toDate);
  lineChartRef.current = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Submissions',
        data,
        borderColor: '#F97316',
        backgroundColor: 'rgba(249,115,22,0.15)',
        tension: 0.3,
        fill: true,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    },
  });
}

function renderBarChart(reports) {
  const canvas = document.getElementById('chart-bar');
  if (!canvas) return;
  destroyChart(barChartRef);
  const { labels, data } = buildBarData(reports);
  barChartRef.current = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Reports',
        data,
        backgroundColor: BAR_COLORS,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    },
  });
}

function renderPieChart(reports) {
  const canvas   = document.getElementById('chart-pie');
  const emptyMsg = document.getElementById('chart-pie-empty');
  if (!canvas || !emptyMsg) return;
  destroyChart(pieChartRef);
  const { labels, data } = buildBarData(reports);
  const total = data.reduce((s, v) => s + v, 0);
  if (total === 0) {
    canvas.style.display = 'none';
    emptyMsg.style.display = '';
    return;
  }
  canvas.style.display = '';
  emptyMsg.style.display = 'none';
  pieChartRef.current = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: BAR_COLORS, borderWidth: 2 }],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } },
    },
  });
}

function renderRecentReports(reports) {
  const container = document.getElementById('recent-reports-list');
  if (!container) return;
  const recent = getRecentReports(reports);

  if (recent.length === 0) {
    container.innerHTML = '<p style="color:var(--color-text-muted);font-size:var(--font-size-sm);">No reports in this range.</p>';
    return;
  }

  // Build a table matching the Community Concerns layout
  const table = document.createElement('table');
  table.className = 'concern-table recent-reports-table';

  // Header
  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>Resident</th>
        <th>Category</th>
        <th>Description</th>
        <th>Date</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody id="recent-reports-tbody"></tbody>
  `;

  container.innerHTML = '';
  container.appendChild(table);
  const tbody = table.querySelector('#recent-reports-tbody');

  recent.forEach((report, idx) => {
    const tr = document.createElement('tr');

    // #
    const tdNum = document.createElement('td');
    tdNum.textContent = idx + 1;
    tr.appendChild(tdNum);

    // Resident + report ref
    const tdResident = document.createElement('td');
    tdResident.className = 'resident-cell';
    const name = escapeHtmlDash(report.userName ?? report.residentName ?? '');
    const ref  = report.reportReference ? `<br><span class="resident-barangay">${escapeHtmlDash(report.reportReference)}</span>` : '';
    tdResident.innerHTML = `<span class="resident-name">${name}</span>${ref}`;
    tr.appendChild(tdResident);

    // Category
    const tdCat = document.createElement('td');
    tdCat.textContent = report.category ?? '';
    tr.appendChild(tdCat);

    // Description (first 60 chars)
    const tdDesc = document.createElement('td');
    const desc = report.description ?? '';
    tdDesc.textContent = desc.length > 60 ? desc.slice(0, 60) + '' : desc;
    tr.appendChild(tdDesc);

    // Date
    const tdDate = document.createElement('td');
    tdDate.textContent = report.submittedAt ? formatDate(report.submittedAt) : '';
    tr.appendChild(tdDate);

    // Status
    const tdStatus = document.createElement('td');
    tdStatus.className = 'status-cell';
    tdStatus.appendChild(statusBadge(report.status ?? 'Pending'));
    tr.appendChild(tdStatus);

    tbody.appendChild(tr);
  });
}

function escapeHtmlDash(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Re-render everything using the filtered report set. */
function renderAll(filtered, allReports, fromDate, toDate) {
  updateStats(filtered);
  renderLineChart(filtered, fromDate, toDate);
  renderBarChart(filtered);
  renderPieChart(filtered);
  renderRecentReports(filtered);
  updateRangeLabel(fromDate, toDate, filtered.length, allReports.length);
}

function updateRangeLabel(fromDate, toDate, filtered, total) {
  const el = document.getElementById('dash-range-label');
  if (!el) return;
  if (!fromDate && !toDate) {
    el.textContent = `Showing all ${total} report${total !== 1 ? 's' : ''}`;
  } else {
    const fmt = (d) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    const fromStr = fromDate ? fmt(fromDate) : '';
    const toStr   = toDate   ? fmt(toDate)   : '';
    el.textContent = `${fromStr}  ${toStr}    ${filtered} report${filtered !== 1 ? 's' : ''}`;
  }
}

//  Preset ranges 

function presetRange(preset) {
  const now = new Date();
  let from = null, to = null;
  if (preset === 'today') {
    from = new Date(now); from.setHours(0, 0, 0, 0);
    to   = new Date(now); to.setHours(23, 59, 59, 999);
  } else if (preset === 'week') {
    from = new Date(now); from.setDate(now.getDate() - now.getDay()); from.setHours(0, 0, 0, 0);
    to   = new Date(now); to.setHours(23, 59, 59, 999);
  } else if (preset === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to   = new Date(now); to.setHours(23, 59, 59, 999);
  }
  // 'all' and 'custom' return null bounds
  return { from, to };
}

//  Main init 

export function init(container, uid, barangay) {
  container.innerHTML = DASHBOARD_HTML;

  // State
  let allReports  = [];
  let activeFrom  = null;   // Date or null
  let activeTo    = null;   // Date or null
  let activePreset = 'all';

  // Loading timeout
  let firstSnapshotReceived = false;
  const loadingTimer = setTimeout(() => {
    if (!firstSnapshotReceived) showLoadingOverlay();
  }, LOADING_TIMEOUT_MS);

  //  Preset buttons 
  container.querySelectorAll('.dash-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.dash-preset-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      activePreset = btn.dataset.preset;

      const customWrap = document.getElementById('dash-custom-range');
      if (activePreset === 'custom') {
        if (customWrap) customWrap.style.display = 'flex';
        return; // wait for Apply click
      }
      if (customWrap) customWrap.style.display = 'none';

      const { from, to } = presetRange(activePreset);
      activeFrom = from;
      activeTo   = to;

      const filtered = (from || to)
        ? filterByDateRange(allReports, from, to)
        : allReports;
      renderAll(filtered, allReports, from, to);
    });
  });

  //  Custom range Apply 
  document.getElementById('dash-apply-range')?.addEventListener('click', () => {
    const fromVal = document.getElementById('dash-date-from')?.value;
    const toVal   = document.getElementById('dash-date-to')?.value;

    if (!fromVal && !toVal) {
      activeFrom = null; activeTo = null;
      renderAll(allReports, allReports, null, null);
      return;
    }

    const from = fromVal ? new Date(fromVal + 'T00:00:00') : null;
    let   to   = toVal   ? new Date(toVal   + 'T23:59:59') : null;

    // Swap if from > to
    if (from && to && from > to) { activeFrom = to; activeTo = from; }
    else { activeFrom = from; activeTo = to; }

    const filtered = filterByDateRange(allReports, activeFrom, activeTo);
    renderAll(filtered, allReports, activeFrom, activeTo);
  });

  // Firestore listener (filtered by barangay for officials)
  const reportsCol = barangay
    ? query(collection(db, 'reports'), where('barangay', '==', barangay), orderBy('submittedAt', 'desc'))
    : collection(db, 'reports');
  const unsubscribe = onSnapshot(
    reportsCol,
    (snapshot) => {
      if (!firstSnapshotReceived) {
        firstSnapshotReceived = true;
        clearTimeout(loadingTimer);
      }

      allReports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const filtered = (activeFrom || activeTo)
        ? filterByDateRange(allReports, activeFrom, activeTo)
        : allReports;
      renderAll(filtered, allReports, activeFrom, activeTo);
    },
    (error) => {
      console.error('[admin/dashboard] Firestore error:', error);
      if (!firstSnapshotReceived) {
        firstSnapshotReceived = true;
        clearTimeout(loadingTimer);
        hideLoadingOverlay();
      }
    },
  );

  if (typeof container.addEventListener === 'function') {
    container.addEventListener('section:destroy', () => unsubscribe(), { once: true });
  }
}
