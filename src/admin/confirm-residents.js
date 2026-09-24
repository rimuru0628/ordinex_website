/**
 * Confirm Residents — admin section for approving or rejecting
 * resident account registrations.
 *
 * Firestore structure assumed:
 *   users/{uid}  →  { displayName, fullName, email, barangay, address,
 *                     phoneNumber, role: 'resident',
 *                     status: 'pending' | 'approved' | 'rejected',
 *                     createdAt, idImageUrl? }
 *
 * Admin actions:
 *   Approve → sets status: 'approved'
 *   Reject  → sets status: 'rejected'
 *
 * Lazy-loaded by admin/app.js via init(container, uid).
 */

import { db } from '../shared/firebase.js';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  addDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { showToast } from '../shared/ui-helpers.js';

// Helper: write an admin notification document
async function notifyAdmin(type, title, body, meta = {}) {
  try {
    await addDoc(collection(db, 'admin_notifications'), {
      type, title, body, meta,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[confirm-residents] notify error:', err);
  }
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let unsubscribe   = null;
let allResidents  = [];
let currentFilter = 'pending'; // 'pending' | 'approved' | 'rejected' | 'all'
let currentSearch    = '';
let currentBarangay  = '';     // '' = all barangays
let currentDateFrom  = '';     // ISO date string YYYY-MM-DD or ''
let currentDateTo    = '';     // ISO date string YYYY-MM-DD or ''

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

const SECTION_HTML = /* html */ `
<div class="confirm-residents-section">
  <div class="confirm-residents-header">
    <h1 class="section-title">Confirm Residents</h1>
    <p class="confirm-residents-subtitle">Review and approve or reject resident account registrations.</p>
  </div>

  <!-- Filter tabs -->
  <div class="resident-filter-tabs" role="tablist" aria-label="Filter residents by status">
    <button class="resident-filter-tab is-active" data-filter="pending"  role="tab" aria-selected="true">
      Pending <span class="resident-filter-tab__count" id="count-pending">0</span>
    </button>
    <button class="resident-filter-tab" data-filter="approved" role="tab" aria-selected="false">
      Approved <span class="resident-filter-tab__count" id="count-approved">0</span>
    </button>
    <button class="resident-filter-tab" data-filter="rejected"  role="tab" aria-selected="false">
      Rejected <span class="resident-filter-tab__count" id="count-rejected">0</span>
    </button>
    <button class="resident-filter-tab" data-filter="all"       role="tab" aria-selected="false">
      All
    </button>
  </div>

  <!-- Search + filters bar -->
  <div class="residents-filters-bar">
    <!-- Search -->
    <div class="residents-search-wrap">
      <span class="residents-search-icon" aria-hidden="true">🔍</span>
      <input
        type="search"
        id="residents-search"
        class="residents-search"
        placeholder="Search by name, email or phone…"
        autocomplete="off"
        aria-label="Search residents"
      />
    </div>

    <!-- Barangay filter -->
    <select id="residents-barangay" class="residents-filter-select" aria-label="Filter by barangay">
      <option value="">All Barangays</option>
      <option>Agtipal</option>
      <option>Arosip</option>
      <option>Bacnotan (Poblacion)</option>
      <option>Bagar</option>
      <option>Baguinay</option>
      <option>Ballogo</option>
      <option>Bubusan</option>
      <option>Burayoc</option>
      <option>Caaoacan</option>
      <option>Catbangen</option>
      <option>Dili</option>
      <option>Dinanum</option>
      <option>Dirdirig</option>
      <option>Duguiftong</option>
      <option>Duyos</option>
      <option>Elizondo</option>
      <option>Emilio</option>
      <option>Gongogong</option>
      <option>Guerrero</option>
      <option>Lataben</option>
      <option>Liciep</option>
      <option>Lubigan</option>
      <option>Lucbo</option>
      <option>Luna</option>
      <option>Mabini</option>
      <option>Mameltac</option>
      <option>Masupe</option>
      <option>Nagsican</option>
      <option>Naguilian</option>
      <option>Pagdalagan Norte</option>
      <option>Pagdalagan Sur</option>
      <option>Palina Este</option>
      <option>Palina Oeste</option>
      <option>Pantay Laud</option>
      <option>Pantay Matua</option>
      <option>Pantay Saroa</option>
      <option>Patpata Norte</option>
      <option>Patpata Sur</option>
      <option>Payocpoc Norte Laud</option>
      <option>Payocpoc Norte East</option>
      <option>Payocpoc Sur</option>
      <option>Raois</option>
      <option>Reyna</option>
      <option>Residencia</option>
      <option>Salcedo</option>
      <option>San Agustin</option>
      <option>San Cornelio</option>
      <option>San Eugenio</option>
      <option>San Fernando</option>
      <option>San Francisco</option>
      <option>San Joaquin</option>
      <option>San Lorenzo</option>
      <option>San Marcos</option>
      <option>San Roque</option>
      <option>Ubbog</option>
    </select>

    <!-- Date from -->
    <div class="residents-date-wrap">
      <label for="residents-date-from" class="residents-date-label">From</label>
      <input type="date" id="residents-date-from" class="residents-filter-select" aria-label="Registered from date" />
    </div>

    <!-- Date to -->
    <div class="residents-date-wrap">
      <label for="residents-date-to" class="residents-date-label">To</label>
      <input type="date" id="residents-date-to" class="residents-filter-select" aria-label="Registered to date" />
    </div>

    <!-- Clear filters -->
    <button id="residents-clear-filters" class="btn residents-clear-btn" aria-label="Clear all filters">
      ✕ Clear
    </button>
  </div>

  <!-- Active filter summary -->
  <p id="residents-filter-summary" class="residents-filter-summary" hidden></p>

  <!-- Empty state -->
  <div id="residents-empty" class="residents-empty" hidden>
    <div class="residents-empty__icon" aria-hidden="true">👥</div>
    <p class="residents-empty__text" id="residents-empty-text">No pending registrations.</p>
  </div>

  <!-- Cards grid -->
  <div class="residents-grid" id="residents-grid"></div>

  <!-- Loading skeleton (shown while first snapshot loads) -->
  <div class="residents-skeleton" id="residents-skeleton" aria-hidden="true">
    ${Array(4).fill('<div class="resident-skeleton-card"></div>').join('')}
  </div>
</div>
`;

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** Apply all active filters to allResidents and return the filtered array. */
function applyFilters() {
  const needle = currentSearch.trim().toLowerCase();

  return allResidents.filter(r => {
    // Status tab
    if (currentFilter !== 'all' && (r.status ?? 'pending') !== currentFilter) return false;

    // Barangay
    if (currentBarangay) {
      const rBarangay = (r.barangay ?? r.address ?? '').toLowerCase();
      if (!rBarangay.includes(currentBarangay.toLowerCase())) return false;
    }

    // Date range — compare against createdAt
    if (currentDateFrom || currentDateTo) {
      const ts = r.createdAt;
      if (!ts) return false;
      const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
      const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
      if (currentDateFrom && day < currentDateFrom) return false;
      if (currentDateTo   && day > currentDateTo)   return false;
    }

    // Search — name, email, phone
    if (needle) {
      const name  = (r.displayName ?? r.fullName ?? '').toLowerCase();
      const email = (r.email ?? '').toLowerCase();
      const phone = (r.phoneNumber ?? '').toLowerCase();
      if (!name.includes(needle) && !email.includes(needle) && !phone.includes(needle)) {
        return false;
      }
    }

    return true;
  });
}

/** Build a human-readable summary of active filters. */
function buildFilterSummary() {
  const parts = [];
  if (currentBarangay) parts.push(`Barangay: ${currentBarangay}`);
  if (currentDateFrom) parts.push(`From: ${currentDateFrom}`);
  if (currentDateTo)   parts.push(`To: ${currentDateTo}`);
  if (currentSearch)   parts.push(`Search: "${currentSearch}"`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/** Build a single resident card element. */
function buildCard(resident) {
  const card = document.createElement('div');
  card.className = 'resident-card';
  card.dataset.uid = resident.id;

  const status      = resident.status ?? 'pending';
  const displayName = resident.displayName ?? resident.fullName ?? '—';
  const safeName    = escapeHtml(displayName);
  const uid         = resident.id;

  const idThumb = resident.idImageUrl
    ? `<a class="resident-card__id-link" href="${escapeHtml(resident.idImageUrl)}" target="_blank" rel="noopener noreferrer" aria-label="View valid ID for ${safeName}">
         <img class="resident-card__id-thumb" src="${escapeHtml(resident.idImageUrl)}" alt="Valid ID" loading="lazy" />
         <span class="resident-card__id-overlay">Click to view full size</span>
       </a>`
    : `<div class="resident-card__id-missing">
         <span class="resident-card__id-missing-icon" aria-hidden="true">🪪</span>
         <span>No ID uploaded yet</span>
       </div>`;

  card.innerHTML = /* html */ `
    <div class="resident-card__header">
      <div class="resident-card__avatar" aria-hidden="true">
        ${getInitials(displayName)}
      </div>
      <div class="resident-card__header-info">
        <p class="resident-card__name">${safeName}</p>
        <p class="resident-card__meta resident-card__email">
          <span class="resident-card__meta-icon" aria-hidden="true">✉</span>
          ${escapeHtml(resident.email ?? '—')}
        </p>
      </div>
      <div class="resident-card__status">
        ${statusBadge(status)}
      </div>
    </div>

    <div class="resident-card__body">
      <div class="resident-card__details">
        <p class="resident-card__meta resident-card__phone">
          <span class="resident-card__meta-icon" aria-hidden="true">📞</span>
          ${escapeHtml(resident.phoneNumber ?? '—')}
        </p>
        <p class="resident-card__meta resident-card__barangay-row">
          <span class="resident-card__meta-icon" aria-hidden="true">🏘</span>
          Brgy. ${escapeHtml(resident.barangay ?? '—')}
        </p>
        <p class="resident-card__meta resident-card__address">
          <span class="resident-card__meta-icon" aria-hidden="true">📍</span>
          ${escapeHtml(resident.address ?? '—')}
        </p>
        <p class="resident-card__date">
          <span class="resident-card__meta-icon" aria-hidden="true">🗓</span>
          Registered: ${formatDate(resident.createdAt)}
        </p>
      </div>

      <div class="resident-card__id-section">
        <p class="resident-card__id-label">
          <span aria-hidden="true">🪪</span> Valid ID
        </p>
        ${idThumb}
      </div>
    </div>

    <div class="resident-card__actions">
      ${
        status === 'pending'
          ? `<button class="btn btn--approve" data-action="approve" data-uid="${uid}" aria-label="Approve ${safeName}">
               ✓ Confirm
             </button>
             <button class="btn btn--reject" data-action="reject" data-uid="${uid}" aria-label="Reject ${safeName}">
               ✕ Reject
             </button>`
          : status === 'approved'
          ? `<button class="btn btn--reject" data-action="reject" data-uid="${uid}" aria-label="Revoke approval for ${safeName}">
               Revoke
             </button>`
          : `<button class="btn btn--approve" data-action="approve" data-uid="${uid}" aria-label="Re-approve ${safeName}">
               Re-approve
             </button>`
      }
    </div>
  `;

  return card;
}

/** Re-render the grid based on current filter + search + barangay + date. */
function render() {
  const grid     = document.getElementById('residents-grid');
  const empty    = document.getElementById('residents-empty');
  const emptyTxt = document.getElementById('residents-empty-text');
  const skeleton = document.getElementById('residents-skeleton');
  const summary  = document.getElementById('residents-filter-summary');

  if (!grid) return;

  if (skeleton) skeleton.hidden = true;

  updateCounts();

  const filtered = applyFilters();

  // Filter summary
  const summaryText = buildFilterSummary();
  if (summary) {
    if (summaryText) {
      summary.textContent = `Showing ${filtered.length} result${filtered.length !== 1 ? 's' : ''} · ${summaryText}`;
      summary.hidden = false;
    } else {
      summary.hidden = true;
    }
  }

  grid.innerHTML = '';

  if (filtered.length === 0) {
    grid.hidden = true;
    if (empty) {
      empty.hidden = false;
      if (emptyTxt) {
        emptyTxt.textContent = summaryText
          ? 'No residents match the current filters.'
          : currentFilter === 'all'
            ? 'No resident registrations found.'
            : `No ${currentFilter} registrations.`;
      }
    }
    return;
  }

  grid.hidden = false;
  if (empty) empty.hidden = true;

  filtered.forEach(resident => {
    grid.appendChild(buildCard(resident));
  });
}

/** Update the count badges on each filter tab (based on status only, not search/date). */
function updateCounts() {
  const counts = { pending: 0, approved: 0, rejected: 0 };
  allResidents.forEach(r => {
    const s = r.status ?? 'pending';
    if (counts[s] !== undefined) counts[s]++;
  });
  Object.entries(counts).forEach(([status, count]) => {
    const el = document.getElementById(`count-${status}`);
    if (el) el.textContent = count;
  });
}

// ---------------------------------------------------------------------------
// Action handler
// ---------------------------------------------------------------------------

async function handleAction(uid, action, adminUid) {
  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  const resident = allResidents.find(r => r.id === uid);
  if (resident) resident.status = newStatus;
  render();

  try {
    await updateDoc(doc(db, 'users', uid), {
      status: newStatus,
      reviewedBy: adminUid,
      reviewedAt: serverTimestamp(),
    });

    const residentName = resident?.displayName ?? resident?.fullName ?? 'A resident';
    const barangay     = resident?.barangay ?? '';

    // Admin notification — logged for the admin feed
    await notifyAdmin(
      'new_signup',
      action === 'approve'
        ? `Resident Approved: ${residentName}`
        : `Resident Rejected: ${residentName}`,
      action === 'approve'
        ? `${residentName}${barangay ? ' (' + barangay + ')' : ''} has been approved and can now log in.`
        : `${residentName}'s registration was rejected.`,
      { userId: uid, residentName }
    );

    // Resident notification — they see this in their alerts tab
    await addDoc(collection(db, 'users', uid, 'notifications'), {
      type: action === 'approve' ? 'account_approved' : 'account_rejected',
      title: action === 'approve' ? '✅ Account Approved' : '❌ Registration Rejected',
      body: action === 'approve'
        ? 'Your BEE-Alert account has been approved. You can now log in and submit reports.'
        : 'Your BEE-Alert registration was not approved. Please contact the municipal office.',
      read: false,
      createdAt: serverTimestamp(),
    });

    showToast(
      action === 'approve'
        ? 'Resident approved successfully.'
        : 'Resident registration rejected.',
      action === 'approve' ? 'success' : 'error'
    );
  } catch (err) {
    console.error('[confirm-residents] updateDoc error:', err);
    if (resident) resident.status = action === 'approve' ? 'pending' : 'pending';
    render();
    showToast('Failed to update resident status. Please try again.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function getInitials(name) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(ts) {
  if (!ts) return '—';
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusBadge(status) {
  const map = {
    pending:  { cls: 'badge--pending',   label: 'Pending'  },
    approved: { cls: 'badge--completed', label: 'Approved' },
    rejected: { cls: 'badge--rejected',  label: 'Rejected' },
  };
  const { cls, label } = map[status] ?? { cls: 'badge--pending', label: status };
  return `<span class="badge ${cls}">${label}</span>`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------------------
// Public init
// ---------------------------------------------------------------------------

export function init(container, uid) {
  // Reset state
  allResidents     = [];
  currentFilter    = 'pending';
  currentSearch    = '';
  currentBarangay  = '';
  currentDateFrom  = '';
  currentDateTo    = '';
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  container.innerHTML = SECTION_HTML;

  const skeleton = document.getElementById('residents-skeleton');
  if (skeleton) skeleton.hidden = false;

  // ── Status tab clicks ────────────────────────────────────────────────────
  container.querySelectorAll('.resident-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentFilter = tab.dataset.filter;
      container.querySelectorAll('.resident-filter-tab').forEach(t => {
        const active = t.dataset.filter === currentFilter;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      render();
    });
  });

  // ── Search ───────────────────────────────────────────────────────────────
  const searchInput = document.getElementById('residents-search');
  searchInput?.addEventListener('input', debounce(e => {
    currentSearch = e.target.value;
    render();
  }, 250));

  // ── Barangay filter ──────────────────────────────────────────────────────
  const barangaySelect = document.getElementById('residents-barangay');
  barangaySelect?.addEventListener('change', e => {
    currentBarangay = e.target.value;
    render();
  });

  // ── Date filters ─────────────────────────────────────────────────────────
  document.getElementById('residents-date-from')?.addEventListener('change', e => {
    currentDateFrom = e.target.value;
    render();
  });
  document.getElementById('residents-date-to')?.addEventListener('change', e => {
    currentDateTo = e.target.value;
    render();
  });

  // ── Clear filters ────────────────────────────────────────────────────────
  document.getElementById('residents-clear-filters')?.addEventListener('click', () => {
    currentSearch   = '';
    currentBarangay = '';
    currentDateFrom = '';
    currentDateTo   = '';

    if (searchInput)   searchInput.value   = '';
    if (barangaySelect) barangaySelect.value = '';
    const dateFrom = document.getElementById('residents-date-from');
    const dateTo   = document.getElementById('residents-date-to');
    if (dateFrom) dateFrom.value = '';
    if (dateTo)   dateTo.value   = '';

    render();
  });

  // ── Action button clicks (event delegation) ──────────────────────────────
  const grid = document.getElementById('residents-grid');
  grid?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action      = btn.dataset.action;
    const residentUid = btn.dataset.uid;
    if (action && residentUid) handleAction(residentUid, action, uid);
  });

  // ── Firestore real-time listener ─────────────────────────────────────────
  const residentsQuery = query(
    collection(db, 'users'),
    where('role', '==', 'resident'),
    orderBy('createdAt', 'desc')
  );

  unsubscribe = onSnapshot(
    residentsQuery,
    (snapshot) => {
      // Detect genuinely new documents (not initial load)
      const isInitialLoad = allResidents.length === 0;
      const previousIds = new Set(allResidents.map(r => r.id));

      allResidents = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      if (!isInitialLoad) {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added' && !previousIds.has(change.doc.id)) {
            const data = change.doc.data();
            const name = data.displayName ?? data.fullName ?? 'A new resident';
            const barangay = data.barangay ?? '';
            notifyAdmin(
              'new_signup',
              `New Sign-Up: ${name}`,
              `${name}${barangay ? ' from ' + barangay : ''} has registered and is waiting for approval.`,
              { userId: change.doc.id, residentName: name }
            );
          }
        });
      }

      render();
    },
    (err) => {
      console.error('[confirm-residents] Firestore error:', err);
      if (skeleton) skeleton.hidden = true;
      showToast('Failed to load residents. Please refresh.', 'error');
    }
  );
}
