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
    Timestamp,
} from 'firebase/firestore';
import { showToast } from '../shared/ui-helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(ts) {
    if (!ts) return '';
    const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

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

let unsubscribe     = null;
let allResidents    = [];
let currentFilter   = 'pending';
let currentSearch   = '';
let currentBarangay = '';
let currentDateFrom = '';
let currentDateTo   = '';

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

const SECTION_HTML = `
<div class="confirm-residents-section">
    <div class="confirm-residents-header">
        <h1 class="section-title">Confirm Residents</h1>
        <p class="confirm-residents-subtitle">Review and approve or reject resident account registrations.</p>
    </div>

    <div class="resident-filter-tabs" role="tablist" aria-label="Filter residents by status">
        <button class="resident-filter-tab is-active" data-filter="pending"  role="tab" aria-selected="true">
            Pending <span class="resident-filter-tab__count" id="count-pending">0</span>
        </button>
        <button class="resident-filter-tab" data-filter="approved" role="tab" aria-selected="false">
            Approved <span class="resident-filter-tab__count" id="count-approved">0</span>
        </button>
        <button class="resident-filter-tab" data-filter="rejected" role="tab" aria-selected="false">
            Rejected <span class="resident-filter-tab__count" id="count-rejected">0</span>
        </button>
        <button class="resident-filter-tab" data-filter="banned" role="tab" aria-selected="false">
            Banned <span class="resident-filter-tab__count" id="count-banned">0</span>
        </button>
        <button class="resident-filter-tab" data-filter="all" role="tab" aria-selected="false">All</button>
    </div>

    <div class="filters-bar" style="margin-bottom:var(--space-4);">
        <input type="search" id="residents-search" placeholder="Search by name, email or phone..." />
        <select id="residents-barangay">
            <option value="">All Barangays</option>
            <option>Agtipal</option><option>Arosip</option><option>Bacqui</option>
            <option>Bacsil</option><option>Bagutot</option><option>Ballogo</option>
            <option>Baroro</option><option>Bitalag</option><option>Bulala</option>
            <option>Burayoc</option><option>Bussaoit</option><option>Cabaroan</option>
            <option>Cabarsican</option><option>Cabugao</option><option>Calautit</option>
            <option>Carcarmay</option><option>Casiaman</option><option>Galongen</option>
            <option>Guinabang</option><option>Legleg</option><option>Lisqueb</option>
            <option>Mabanengbeng 1st</option><option>Mabanengbeng 2nd</option>
            <option>Maragayap</option><option>Nangalisan</option><option>Nagatiran</option>
            <option>Nagsaraboa</option><option>Nagsimsimbaanan</option><option>Narra</option>
            <option>Ortega</option><option>Paagan</option><option>Pandan</option>
            <option>Pang-pang</option><option>Poblacion</option><option>Quirino</option>
            <option>Raois</option><option>Salincob</option><option>San Martin</option>
            <option>Santa Cruz</option><option>Santa rita</option><option>Sapilang</option>
            <option>Sayoan</option><option>Sipulo</option><option>Tammocalao</option>
            <option>Ubbog</option><option>Oya-oy</option><option>Zaragoza</option>
        </select>
        <input type="date" id="residents-date-from" title="Registered from" />
        <input type="date" id="residents-date-to"   title="Registered to"   />
        <button id="residents-clear-filters" class="btn">Clear</button>
    </div>

    <p id="residents-filter-summary" class="residents-filter-summary" hidden></p>

    <div id="residents-empty" class="residents-empty" hidden>
        <div class="residents-empty__icon" aria-hidden="true">No records</div>
        <p class="residents-empty__text" id="residents-empty-text">No pending registrations.</p>
    </div>

    <div class="table-wrapper" id="residents-table-wrapper">
        <table class="concern-table" id="residents-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Barangay</th>
                    <th>Registered</th>
                    <th>Valid ID</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody id="residents-grid"></tbody>
        </table>
    </div>

    <div class="residents-skeleton" id="residents-skeleton" aria-hidden="true">
        <div class="resident-skeleton-card"></div>
        <div class="resident-skeleton-card"></div>
        <div class="resident-skeleton-card"></div>
        <div class="resident-skeleton-card"></div>
    </div>
</div>

<!-- Unban confirmation modal -->
<div id="unban-modal-overlay" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="unban-modal-title" hidden>
    <div class="modal">
        <button class="modal__close" id="unban-modal-close" aria-label="Close">&times;</button>

        <h2 class="modal__title" id="unban-modal-title">
            Unban Resident &rarr;
            <span class="status-update-form-wrap__badge" id="unban-modal-name-badge" style="background:#e0e7ff;color:#3730a3;border:1px solid #a5b4fc;"></span>
        </h2>
        <p style="font-size:var(--font-size-sm);color:var(--color-text-secondary);margin-bottom:var(--space-5);">
            This resident is currently banned. Review the ban details below before lifting it.
        </p>

        <div id="unban-modal-details" style="
            background:#fff7ed;
            border:1px solid #fed7aa;
            border-radius:var(--radius-md);
            padding:var(--space-4);
            display:flex;
            flex-direction:column;
            gap:var(--space-3);
            margin-bottom:var(--space-5);
        ">
            <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-size-sm);">
                <span style="font-size:1rem;">&#128683;</span>
                <span id="unban-modal-remaining" style="font-weight:600;color:#92400e;"></span>
            </div>
            <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-size-sm);color:var(--color-text-secondary);">
                <span style="font-size:1rem;">&#128197;</span>
                <span id="unban-modal-until"></span>
            </div>
        </div>

        <p style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-bottom:var(--space-5);">
            Lifting the ban will immediately allow this resident to submit reports again.
        </p>

        <div style="display:flex;gap:var(--space-3);justify-content:flex-end;">
            <button class="btn" id="unban-modal-cancel" style="min-width:90px;">Cancel</button>
            <button class="btn btn--primary" id="unban-modal-confirm" style="min-width:140px;background:#3730a3;">Lift Ban</button>
        </div>
    </div>
</div>
<div id="ban-modal-overlay" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ban-modal-title" hidden>
    <div class="modal">
        <button class="modal__close" id="ban-modal-close" aria-label="Close">&times;</button>

        <h2 class="modal__title" id="ban-modal-title">
            Ban Resident &rarr;
            <span class="status-update-form-wrap__badge" id="ban-modal-name-badge" style="background:#fef3c7;color:#92400e;border:1px solid #f59e0b;"></span>
        </h2>
        <p style="font-size:var(--font-size-sm);color:var(--color-text-secondary);margin-bottom:var(--space-4);">
            Enter the ban duration below. The resident will be blocked from submitting reports until the ban expires.
        </p>

        <label class="post-update-card__label" for="ban-hours">BAN DURATION <span style="color:red">*</span></label>
        <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-2);">
            <input class="post-update-card__input" type="number" id="ban-hours"
                   min="1" max="8760" placeholder="e.g. 24"
                   style="max-width:160px;margin-bottom:0;" />
            <span style="font-size:var(--font-size-sm);color:var(--color-text-secondary);">hours</span>
        </div>
        <p style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-bottom:var(--space-5);">
            Minimum 1 hour &mdash; Maximum 8760 hours (1 year).
        </p>
        <span class="form-error" id="ban-hours-error" role="alert" hidden style="display:block;margin-bottom:var(--space-3);"></span>

        <div style="display:flex;gap:var(--space-3);justify-content:flex-end;">
            <button class="btn" id="ban-modal-cancel" style="min-width:90px;">Cancel</button>
            <button class="btn btn--primary" id="ban-modal-confirm" style="min-width:160px;">Ban Resident</button>
        </div>
    </div>
</div>
`;

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function isBanned(r) {
    if (!r.bannedUntil) return false;
    const until = typeof r.bannedUntil.toDate === 'function'
        ? r.bannedUntil.toDate()
        : new Date(r.bannedUntil);
    return until > new Date();
}

function applyFilters() {
    const needle = currentSearch.trim().toLowerCase();
    return allResidents.filter(r => {
        // banned is a virtual filter — check bannedUntil regardless of status
        if (currentFilter === 'banned') {
            if (!isBanned(r)) return false;
        } else if (currentFilter !== 'all') {
            if ((r.status ?? 'pending') !== currentFilter) return false;
        }
        if (currentBarangay) {
            const rb = (r.barangay ?? '').toLowerCase();
            if (!rb.includes(currentBarangay.toLowerCase())) return false;
        }
        if (currentDateFrom || currentDateTo) {
            const ts = r.createdAt;
            if (!ts) return false;
            const d   = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
            const day = d.toISOString().slice(0, 10);
            if (currentDateFrom && day < currentDateFrom) return false;
            if (currentDateTo   && day > currentDateTo)   return false;
        }
        if (needle) {
            const name  = (r.displayName ?? r.fullName ?? '').toLowerCase();
            const email = (r.email ?? '').toLowerCase();
            const phone = (r.phoneNumber ?? '').toLowerCase();
            if (!name.includes(needle) && !email.includes(needle) && !phone.includes(needle)) return false;
        }
        return true;
    });
}

function buildFilterSummary() {
    const parts = [];
    if (currentBarangay) parts.push('Barangay: ' + currentBarangay);
    if (currentDateFrom) parts.push('From: '     + currentDateFrom);
    if (currentDateTo)   parts.push('To: '       + currentDateTo);
    if (currentSearch)   parts.push('Search: "' + currentSearch + '"');
    return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// Build table row
// ---------------------------------------------------------------------------

function buildRow(resident, rowNum) {
    const tr = document.createElement('tr');
    tr.dataset.uid = resident.id;

    const status      = resident.status ?? 'pending';
    const displayName = resident.displayName ?? resident.fullName ?? '';
    const uid         = resident.id;

    // #
    const tdNum = document.createElement('td');
    tdNum.textContent = rowNum;
    tr.appendChild(tdNum);

    // Name
    const tdName = document.createElement('td');
    tdName.className = 'resident-cell';
    tdName.innerHTML = '<span class="resident-name">' + escapeHtml(displayName) + '</span>';
    tr.appendChild(tdName);

    // Role badge
    const tdRole     = document.createElement('td');
    const isOfficial = resident.role === 'official';
    tdRole.innerHTML = '<span class="resident-card__role-badge resident-card__role-badge--' +
        (isOfficial ? 'official' : 'resident') + '">' +
        (isOfficial ? 'B. Official' : 'Resident') + '</span>';
    tr.appendChild(tdRole);

    // Email
    const tdEmail = document.createElement('td');
    tdEmail.textContent = resident.email ?? '';
    tdEmail.style.wordBreak = 'break-all';
    tr.appendChild(tdEmail);

    // Phone
    const tdPhone = document.createElement('td');
    tdPhone.textContent = resident.phoneNumber ?? '';
    tr.appendChild(tdPhone);

    // Barangay
    const tdBrgy = document.createElement('td');
    tdBrgy.textContent = resident.barangay ?? '';
    tr.appendChild(tdBrgy);

    // Registered date
    const tdDate = document.createElement('td');
    tdDate.textContent = formatDate(resident.createdAt);
    tr.appendChild(tdDate);

    // Valid ID thumbnail
    const tdId = document.createElement('td');
    if (resident.idImageUrl) {
        const a   = document.createElement('a');
        a.href    = resident.idImageUrl;
        a.target  = '_blank';
        a.rel     = 'noopener noreferrer';
        const img = document.createElement('img');
        img.className = 'thumb';
        img.src       = resident.idImageUrl;
        img.alt       = 'Valid ID';
        img.loading   = 'lazy';
        img.title     = 'Click to view full size';
        a.appendChild(img);
        tdId.appendChild(a);
    } else {
        const ph     = document.createElement('span');
        ph.className = 'thumb-placeholder thumb-placeholder--none';
        ph.title     = 'No ID uploaded';
        ph.textContent = 'No ID';
        tdId.appendChild(ph);
    }
    tr.appendChild(tdId);

    // Status badge
    const tdStatus = document.createElement('td');
    tdStatus.className = 'status-cell';
    tdStatus.appendChild(createStatusBadge(status, resident));
    tr.appendChild(tdStatus);

    // Actions dropdown
    const tdActions = document.createElement('td');
    tdActions.className = 'actions-cell';
    tdActions.appendChild(buildActionsDropdown(resident, uid, status, displayName));
    tr.appendChild(tdActions);

    return tr;
}

// ---------------------------------------------------------------------------
// Actions dropdown
// ---------------------------------------------------------------------------

let activeResidentDropdown = null;
let activeResidentBtn      = null; // tracks which button opened the dropdown

function closeActiveResidentDropdown() {
    if (activeResidentDropdown) {
        activeResidentDropdown.remove();
        activeResidentDropdown = null;
    }
    if (activeResidentBtn) {
        activeResidentBtn.setAttribute('aria-expanded', 'false');
        activeResidentBtn = null;
    }
}

// Close dropdown on outside click
document.addEventListener('click', () => closeActiveResidentDropdown());

function buildActionsDropdown(resident, uid, status, displayName) {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';

    const btn = document.createElement('button');
    btn.className = 'actions-btn';
    btn.type      = 'button';
    btn.textContent = 'Actions \u25BE'; // ▾
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');

    btn.addEventListener('click', e => {
        e.stopPropagation();

        // If this button's dropdown is already open, close it (toggle off)
        if (activeResidentBtn === btn) {
            closeActiveResidentDropdown();
            return;
        }

        // Close whatever other dropdown is open
        closeActiveResidentDropdown();

        const dropdown = document.createElement('div');
        dropdown.className = 'actions-dropdown';
        // Use fixed positioning so the dropdown escapes overflow:hidden/auto parents
        dropdown.style.position = 'fixed';
        dropdown.style.zIndex   = '9999';
        activeResidentDropdown = dropdown;
        activeResidentBtn      = btn;
        btn.setAttribute('aria-expanded', 'true');

        // Position below the button, flush to its right edge
        const btnRect = btn.getBoundingClientRect();
        dropdown.style.top  = (btnRect.bottom + 4) + 'px';
        // Start right-aligned; we'll flip if needed after paint
        dropdown.style.left = btnRect.right + 'px';
        dropdown.style.transform = 'translateX(-100%)';

        // ── Approve ──
        if (status === 'pending' || status === 'rejected') {
            const approveItem = document.createElement('button');
            approveItem.type        = 'button';
            approveItem.textContent = status === 'pending' ? 'Confirm' : 'Re-approve';
            approveItem.className   = 'actions-dropdown__approve';
            approveItem.addEventListener('click', e => {
                e.stopPropagation();
                closeActiveResidentDropdown();
                // Dispatch through the existing event delegation path
                const fake = { dataset: { action: 'approve', uid } };
                _dispatchAction(fake.dataset.action, fake.dataset.uid);
            });
            dropdown.appendChild(approveItem);
        }

        // ── Reject / Revoke ──
        if (status === 'pending' || status === 'approved') {
            const rejectItem = document.createElement('button');
            rejectItem.type        = 'button';
            rejectItem.textContent = status === 'approved' ? 'Revoke' : 'Reject';
            rejectItem.className   = 'actions-dropdown__delete';
            rejectItem.addEventListener('click', e => {
                e.stopPropagation();
                closeActiveResidentDropdown();
                _dispatchAction('reject', uid);
            });
            dropdown.appendChild(rejectItem);
        }

        // ── Ban / Unban (available for all statuses) ──
        const separator = document.createElement('div');
        separator.style.cssText = 'height:1px;background:var(--color-border);margin:4px 0;';
        dropdown.appendChild(separator);

        if (isBanned(resident)) {
            const unbanItem = document.createElement('button');
            unbanItem.type        = 'button';
            unbanItem.textContent = 'Unban';
            unbanItem.className   = 'actions-dropdown__unban';
            unbanItem.addEventListener('click', e => {
                e.stopPropagation();
                closeActiveResidentDropdown();
                openUnbanModal(uid, displayName, resident.bannedUntil);
            });
            dropdown.appendChild(unbanItem);
        } else {
            const banItem = document.createElement('button');
            banItem.type        = 'button';
            banItem.textContent = 'Ban';
            banItem.className   = 'actions-dropdown__ban';
            banItem.addEventListener('click', e => {
                e.stopPropagation();
                closeActiveResidentDropdown();
                openBanModal(uid, displayName);
            });
            dropdown.appendChild(banItem);
        }

        document.body.appendChild(dropdown);

        // After paint: check if the dropdown overflows the right viewport edge
        requestAnimationFrame(() => {
            const rect = dropdown.getBoundingClientRect();
            if (rect.right > window.innerWidth - 8) {
                dropdown.style.left      = btnRect.left + 'px';
                dropdown.style.transform = '';
            }
        });
    });

    wrapper.appendChild(btn);
    return wrapper;
}

// Internal dispatcher so dropdown items can trigger the same action handler
// as the old data-action delegation
let _adminUidRef = null; // set during init

function _dispatchAction(action, targetUid) {
    if (action === 'ban')   { return; } // handled inline via openBanModal
    if (action === 'unban') { handleUnban(targetUid, _adminUidRef); return; }
    handleAction(targetUid, action, _adminUidRef);
}

// ---------------------------------------------------------------------------
// Build status badge
// ---------------------------------------------------------------------------

function createStatusBadge(status, resident) {
    const map = {
        pending:  { cls: 'badge--pending',   label: 'Pending'  },
        approved: { cls: 'badge--completed', label: 'Approved' },
        rejected: { cls: 'badge--rejected',  label: 'Rejected' },
    };

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '4px';

    // Main status badge
    const { cls, label } = map[status] ?? { cls: 'badge--pending', label: status };
    const el = document.createElement('span');
    el.className   = 'badge ' + cls;
    el.textContent = label;
    wrap.appendChild(el);

    // Ban badge (shown when actively banned)
    if (isBanned(resident)) {
        const until = typeof resident.bannedUntil.toDate === 'function'
            ? resident.bannedUntil.toDate()
            : new Date(resident.bannedUntil);
        const banEl = document.createElement('span');
        banEl.className = 'badge badge--banned';
        banEl.title     = 'Banned until ' + until.toLocaleString('en-PH');
        banEl.textContent = 'Banned';
        wrap.appendChild(banEl);
    }

    return wrap;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
    const tbody     = document.getElementById('residents-grid');
    const empty     = document.getElementById('residents-empty');
    const emptyTxt  = document.getElementById('residents-empty-text');
    const skeleton  = document.getElementById('residents-skeleton');
    const summary   = document.getElementById('residents-filter-summary');
    const tableWrap = document.getElementById('residents-table-wrapper');

    if (!tbody) return;
    if (skeleton) skeleton.hidden = true;

    updateCounts();

    const filtered    = applyFilters();
    const summaryText = buildFilterSummary();

    if (summary) {
        summary.textContent = summaryText
            ? 'Showing ' + filtered.length + ' result' + (filtered.length !== 1 ? 's' : '') + ' | ' + summaryText
            : '';
        summary.hidden = !summaryText;
    }

    tbody.innerHTML = '';

    if (filtered.length === 0) {
        if (tableWrap) tableWrap.style.display = 'none';
        if (empty) {
            empty.hidden = false;
            if (emptyTxt) {
                emptyTxt.textContent = summaryText
                    ? 'No residents match the current filters.'
                    : currentFilter === 'all'
                        ? 'No resident registrations found.'
                        : 'No ' + currentFilter + ' registrations.';
            }
        }
        return;
    }

    if (tableWrap) tableWrap.style.display = '';
    if (empty) empty.hidden = true;

    filtered.forEach((resident, idx) => {
        tbody.appendChild(buildRow(resident, idx + 1));
    });
}

function updateCounts() {
    const counts = { pending: 0, approved: 0, rejected: 0, banned: 0 };
    allResidents.forEach(r => {
        const s = r.status ?? 'pending';
        if (counts[s] !== undefined) counts[s]++;
        if (isBanned(r)) counts.banned++;
    });
    Object.entries(counts).forEach(([status, count]) => {
        const el = document.getElementById('count-' + status);
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
            status:     newStatus,
            reviewedBy: adminUid,
            reviewedAt: serverTimestamp(),
        });

        const residentName = resident?.displayName ?? resident?.fullName ?? 'A resident';
        const barangay     = resident?.barangay ?? '';

        await notifyAdmin(
            'new_signup',
            action === 'approve'
                ? 'Resident Approved: ' + residentName
                : 'Resident Rejected: ' + residentName,
            action === 'approve'
                ? residentName + (barangay ? ' (' + barangay + ')' : '') + ' has been approved and can now log in.'
                : residentName + ' registration was rejected.',
            { userId: uid, residentName }
        );

        await addDoc(collection(db, 'users', uid, 'notifications'), {
            type:  action === 'approve' ? 'account_approved' : 'account_rejected',
            title: action === 'approve' ? 'Account Approved'  : 'Registration Rejected',
            body:  action === 'approve'
                ? 'Your BEE-Alert account has been approved. You can now log in and submit reports.'
                : 'Your BEE-Alert registration was not approved. Please contact the barangay for more information.',
            read:      false,
            createdAt: serverTimestamp(),
        });

        showToast(action === 'approve' ? 'Resident approved.' : 'Resident rejected.', 'success');
    } catch (err) {
        console.error('[confirm-residents] handleAction error:', err);
        if (resident) resident.status = action === 'approve' ? 'rejected' : 'approved';
        render();
        showToast('Action failed. Please try again.', 'error');
    }
}

// ---------------------------------------------------------------------------
// Unban confirmation modal
// ---------------------------------------------------------------------------

let unbanModalUid  = null;
let unbanModalName = null;

function openUnbanModal(uid, name, bannedUntilTs) {
    unbanModalUid  = uid;
    unbanModalName = name;

    const overlay   = document.getElementById('unban-modal-overlay');
    const badgeEl   = document.getElementById('unban-modal-name-badge');
    const remaining = document.getElementById('unban-modal-remaining');
    const untilEl   = document.getElementById('unban-modal-until');
    if (!overlay) return;

    if (badgeEl) badgeEl.textContent = name || 'Resident';

    // Calculate time remaining
    const until = typeof bannedUntilTs?.toDate === 'function'
        ? bannedUntilTs.toDate()
        : new Date(bannedUntilTs);

    const msLeft  = until - Date.now();
    const hLeft   = Math.floor(msLeft / 3600000);
    const mLeft   = Math.floor((msLeft % 3600000) / 60000);

    let timeLeft;
    if (hLeft > 0) {
        timeLeft = hLeft + ' hour' + (hLeft !== 1 ? 's' : '') +
            (mLeft > 0 ? ' and ' + mLeft + ' minute' + (mLeft !== 1 ? 's' : '') : '');
    } else {
        timeLeft = mLeft + ' minute' + (mLeft !== 1 ? 's' : '');
    }

    if (remaining) remaining.textContent = 'Ban lifts in: ' + timeLeft;
    if (untilEl)   untilEl.textContent   = 'Until: ' + until.toLocaleString('en-PH', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });

    overlay.hidden = false;
}

function closeUnbanModal() {
    unbanModalUid  = null;
    unbanModalName = null;
    const overlay = document.getElementById('unban-modal-overlay');
    if (overlay) overlay.hidden = true;
}

// ---------------------------------------------------------------------------
// Ban modal
// ---------------------------------------------------------------------------

let banModalUid  = null;
let banModalName = null;

function openBanModal(uid, name) {
    banModalUid  = uid;
    banModalName = name;
    const overlay   = document.getElementById('ban-modal-overlay');
    const badgeEl   = document.getElementById('ban-modal-name-badge');
    const hoursEl   = document.getElementById('ban-hours');
    const errorEl   = document.getElementById('ban-hours-error');
    if (!overlay) return;
    if (badgeEl)  badgeEl.textContent = name || 'Resident';
    if (hoursEl)  hoursEl.value = '';
    if (errorEl)  { errorEl.textContent = ''; errorEl.hidden = true; }
    overlay.hidden = false;
    hoursEl?.focus();
}

function closeBanModal() {
    banModalUid  = null;
    banModalName = null;
    const overlay = document.getElementById('ban-modal-overlay');
    if (overlay) overlay.hidden = true;
}

async function confirmBan(adminUid) {
    const hoursEl = document.getElementById('ban-hours');
    const errorEl = document.getElementById('ban-hours-error');
    const hours   = parseInt(hoursEl?.value ?? '', 10);

    if (!hours || hours < 1) {
        if (errorEl) { errorEl.textContent = 'Enter a valid number of hours (minimum 1).'; errorEl.hidden = false; }
        hoursEl?.focus();
        return;
    }
    if (hours > 8760) {
        if (errorEl) { errorEl.textContent = 'Maximum ban duration is 8760 hours (1 year).'; errorEl.hidden = false; }
        hoursEl?.focus();
        return;
    }

    const uid  = banModalUid;
    const name = banModalName;
    closeBanModal();

    const bannedUntil = Timestamp.fromDate(new Date(Date.now() + hours * 60 * 60 * 1000));

    // Optimistic update
    const resident = allResidents.find(r => r.id === uid);
    if (resident) resident.bannedUntil = bannedUntil;
    render();

    try {
        await updateDoc(doc(db, 'users', uid), {
            bannedUntil,
            bannedBy:  adminUid,
            bannedAt:  serverTimestamp(),
        });

        // Notify the resident via their notifications subcollection
        await addDoc(collection(db, 'users', uid, 'notifications'), {
            type:      'account_banned',
            title:     'Account Temporarily Banned',
            body:      'Your account has been temporarily banned for ' + hours + ' hour' + (hours !== 1 ? 's' : '') + '. You will not be able to submit reports during this period.',
            read:      false,
            createdAt: serverTimestamp(),
        });

        showToast(name + ' has been banned for ' + hours + ' hour' + (hours !== 1 ? 's' : '') + '.', 'success');
    } catch (err) {
        console.error('[confirm-residents] ban error:', err);
        if (resident) resident.bannedUntil = null;
        render();
        showToast('Failed to ban resident. Please try again.', 'error');
    }
}

async function handleUnban(uid, adminUid) {
    const resident = allResidents.find(r => r.id === uid);
    if (resident) resident.bannedUntil = null;
    render();

    try {
        await updateDoc(doc(db, 'users', uid), {
            bannedUntil: null,
            unbannedBy:  adminUid,
            unbannedAt:  serverTimestamp(),
        });

        const name = resident?.displayName ?? resident?.fullName ?? 'Resident';
        await addDoc(collection(db, 'users', uid, 'notifications'), {
            type:      'account_unbanned',
            title:     'Account Ban Lifted',
            body:      'Your account ban has been lifted. You can now submit reports again.',
            read:      false,
            createdAt: serverTimestamp(),
        });

        showToast(name + ' has been unbanned.', 'success');
    } catch (err) {
        console.error('[confirm-residents] unban error:', err);
        if (resident) resident.bannedUntil = 'restore'; // re-render will re-check
        render();
        showToast('Failed to unban resident. Please try again.', 'error');
    }
}

// ---------------------------------------------------------------------------
// Init / Destroy
// ---------------------------------------------------------------------------

export function init(container, uid, barangay, adminRole) {
    if (typeof container === 'string') {
        container = document.getElementById(container) ?? document.querySelector(container);
    }
    if (!container) return;

    // Store admin UID for dropdown action callbacks
    _adminUidRef = uid;

    container.innerHTML = SECTION_HTML;

    // Filter tabs
    container.querySelectorAll('.resident-filter-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.resident-filter-tab').forEach(b => {
                b.classList.remove('is-active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('is-active');
            btn.setAttribute('aria-selected', 'true');
            currentFilter = btn.dataset.filter;
            render();
        });
    });

    // Search
    const searchEl = document.getElementById('residents-search');
    if (searchEl) {
        searchEl.addEventListener('input', () => {
            currentSearch = searchEl.value;
            render();
        });
    }

    // Barangay filter
    const barangayEl = document.getElementById('residents-barangay');
    if (barangayEl) {
        if (adminRole !== 'admin' && barangay) {
            currentBarangay = barangay;
            barangayEl.value = barangay;
            barangayEl.disabled = true;
        }
        barangayEl.addEventListener('change', () => {
            currentBarangay = barangayEl.value;
            render();
        });
    }

    // Date filters
    const dateFromEl = document.getElementById('residents-date-from');
    const dateToEl   = document.getElementById('residents-date-to');
    if (dateFromEl) dateFromEl.addEventListener('change', () => { currentDateFrom = dateFromEl.value; render(); });
    if (dateToEl)   dateToEl.addEventListener('change',   () => { currentDateTo   = dateToEl.value;   render(); });

    // Clear filters
    const clearBtn = document.getElementById('residents-clear-filters');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            currentSearch   = '';
            currentDateFrom = '';
            currentDateTo   = '';
            if (searchEl)   searchEl.value   = '';
            if (dateFromEl) dateFromEl.value = '';
            if (dateToEl)   dateToEl.value   = '';
            if (adminRole === 'admin') {
                currentBarangay = '';
                if (barangayEl) barangayEl.value = '';
            }
            render();
        });
    }

    // Ban modal wiring
    document.getElementById('ban-modal-close')?.addEventListener('click', closeBanModal);
    document.getElementById('ban-modal-cancel')?.addEventListener('click', closeBanModal);
    document.getElementById('ban-modal-confirm')?.addEventListener('click', () => confirmBan(uid));
    document.getElementById('ban-modal-overlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('ban-modal-overlay')) closeBanModal();
    });
    document.getElementById('ban-hours')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') confirmBan(uid);
    });

    // Unban modal wiring
    document.getElementById('unban-modal-close')?.addEventListener('click', closeUnbanModal);
    document.getElementById('unban-modal-cancel')?.addEventListener('click', closeUnbanModal);
    document.getElementById('unban-modal-confirm')?.addEventListener('click', () => {
        const targetUid = unbanModalUid;
        closeUnbanModal();
        handleUnban(targetUid, uid);
    });
    document.getElementById('unban-modal-overlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('unban-modal-overlay')) closeUnbanModal();
    });

    // Firestore listener
    if (unsubscribe) unsubscribe();

    let q;
    if (adminRole !== 'admin' && barangay) {
        q = query(
            collection(db, 'users'),
            where('barangay', '==', barangay),
            orderBy('createdAt', 'desc')
        );
    } else {
        q = query(
            collection(db, 'users'),
            orderBy('createdAt', 'desc')
        );
    }

    unsubscribe = onSnapshot(q, snapshot => {
        allResidents = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        render();
    }, err => {
        console.error('[confirm-residents] snapshot error:', err);
        showToast('Failed to load residents. Check your connection.', 'error');
    });
}

export function destroy() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    allResidents    = [];
    currentFilter   = 'pending';
    currentSearch   = '';
    currentBarangay = '';
    currentDateFrom = '';
    currentDateTo   = '';
}
