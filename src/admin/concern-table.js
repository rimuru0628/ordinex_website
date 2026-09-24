/**
 * src/admin/concern-table.js
 *
 * Community Concern Management section for the admin SPA.
 * Lazy-loaded by admin/app.js via `init(container, uid)`.
 *
 * Exported pure functions (also used by unit/property tests):
 *  - applyFilters(reports, { status, category, search })
 *  - paginateReports(reports, page, pageSize)
 */

import { db } from '../shared/firebase.js';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  addDoc,
  getDocs,
  doc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { statusBadge, formatDate, showToast } from '../shared/ui-helpers.js';

// ── Notification helper ───────────────────────────────────────────────────────

async function notifyAdmin(type, title, body, meta = {}) {
  try {
    await addDoc(collection(db, 'admin_notifications'), {
      type, title, body, meta,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[concern-table] notifyAdmin error:', err);
  }
}

async function notifyResident(userId, type, title, body, meta = {}) {
  if (!userId) return;
  try {
    await addDoc(collection(db, 'users', userId, 'notifications'), {
      type, title, body, meta,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[concern-table] notifyResident error:', err);
  }
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Pure exported functions
// ---------------------------------------------------------------------------

/**
 * Filter a reports array according to status, category and search criteria.
 *
 * @param {Object[]} reports         - Source array (not mutated).
 * @param {Object}   filters
 * @param {string}   [filters.status='All']    - Exact status match or 'All'.
 * @param {string}   [filters.category='All']  - Exact category match or 'All'.
 * @param {string}   [filters.search='']       - Case-insensitive substring match
 *                                               against description OR residentName.
 * @returns {Object[]} New filtered array.
 */
export function applyFilters(reports, { status = 'All', category = 'All', search = '' } = {}) {
  const needle = search.trim().toLowerCase();

  return reports.filter((report) => {
    if (status !== 'All' && report.status !== status) return false;
    if (category !== 'All' && report.category !== category) return false;
    if (needle) {
      const inDescription  = (report.description  ?? '').toLowerCase().includes(needle);
      const inResident     = (report.userName ?? report.residentName ?? '').toLowerCase().includes(needle);
      const inReference    = (report.reportReference ?? '').toLowerCase().includes(needle);
      if (!inDescription && !inResident && !inReference) return false;
    }
    return true;
  });
}

/**
 * Return a single page of reports.
 *
 * @param {Object[]} reports   - Filtered source array.
 * @param {number}   page      - 1-indexed page number.
 * @param {number}   [pageSize=20]
 * @returns {Object[]} Slice of the array for the requested page.
 */
export function paginateReports(reports, page, pageSize = PAGE_SIZE) {
  const start = (page - 1) * pageSize;
  return reports.slice(start, start + pageSize);
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

const SECTION_HTML = `
<div class="concern-section">
  <h1 class="section-title">Community Concern Management</h1>
  <div class="filters-bar">
    <select id="filter-status">
      <option value="All">All Statuses</option>
      <option value="Pending">Pending</option>

      <option value="Under Review">Under Review</option>
      <option value="Ongoing">Ongoing</option>
      <option value="Completed">Completed</option>
    </select>
    <select id="filter-category">
      <option value="All">All Categories</option>
      <option>Improper Garbage Disposal</option>
      <option>Illegal Parking</option>
      <option>Noise Disturbances</option>
      <option>Public Disturbance</option>
      <option>Others</option>
    </select>
    <input type="text" id="filter-search" placeholder="Search by resident or description..." />
  </div>
  <div class="table-wrapper">
    <table class="concern-table" id="concern-table">
      <thead>
        <tr>
          <th>#</th>

          <th>Resident</th>
          <th>Category</th>
          <th>Description</th>
          <th>Date</th>
          <th>Evidence</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      <tbody id="concern-tbody"></tbody>
    </table>
  </div>
  <div class="concern-cards" id="concern-cards"></div>
  <button class="btn btn--primary" id="load-more-btn" style="display:none">Load More</button>
</div>
<div id="concern-detail-modal" class="modal-overlay" role="dialog" aria-modal="true" hidden>
  <div class="modal modal--wide">
    <button class="modal__close" id="close-concern-modal" aria-label="Close">&times;</button>
    <h2 class="modal__title" id="concern-modal-title">Report Details</h2>
    <div id="concern-modal-body"></div>
  </div>
</div>
`;

// ---------------------------------------------------------------------------
// Module-level state (reset on every init call)
// ---------------------------------------------------------------------------

let allReports      = [];
let currentFilters  = { status: 'All', category: 'All', search: '' };
let currentPage     = 1;
let unsubscribe     = null;   // Firestore listener cleanup
let currentUid      = null;   // Admin UID for status-history writes
let activeDropdown  = null;   // Currently open actions dropdown element

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/**
 * Build a single <tr> for the concern table.
 *
 * @param {Object} report  - Firestore doc data + { id }.
 * @param {number} rowNum  - 1-based display number.
 * @returns {HTMLTableRowElement}
 */
function buildRow(report, rowNum) {
  const tr = document.createElement('tr');
  tr.dataset.id = report.id;

  // # column
  const tdNum = document.createElement('td');
  tdNum.textContent = rowNum;
  tr.appendChild(tdNum);

  // Resident cell — clicking the row opens detail modal
  const tdResident = document.createElement('td');
  tdResident.className = 'resident-cell';
  const residentName = report.userName ?? report.residentName ?? '—';
  const safeRef = report.reportReference ? `<br><span class="resident-barangay">${escapeHtml(report.reportReference)}</span>` : '';
  tdResident.innerHTML = `<span class="resident-name">${escapeHtml(residentName)}</span>${safeRef}`;
  tr.appendChild(tdResident);

  // Category cell — click directly to change
  const tdCategory = document.createElement('td');
  tdCategory.className = 'category-cell category-cell--clickable';
  tdCategory.title = 'Click to change category';
  tdCategory.innerHTML = "<span class='cell-text'>" + escapeHtml(report.category ?? '—') + "</span> <span class='cell-arrow' aria-hidden='true'>&#9660;</span>";
  tdCategory.addEventListener('click', (e) => {
    e.stopPropagation();
    showInlineCategorySelect(report, tdCategory);
  });
  tr.appendChild(tdCategory);

  // Description (first 80 chars)
  const tdDesc = document.createElement('td');
  const desc = report.description ?? '';
  tdDesc.textContent = desc.length > 80 ? desc.slice(0, 80) + '...' : desc;
  tr.appendChild(tdDesc);

  // Date
  const tdDate = document.createElement('td');
  tdDate.textContent = report.submittedAt ? formatDate(report.submittedAt) : '—';
  tr.appendChild(tdDate);

  // Evidence thumbnail
  // Evidence cell — icons only (photo/video/none)
  const tdImage = document.createElement('td');
  const ph = document.createElement('span');
  ph.className = 'thumb-placeholder';
  if (report.imageUrl) {
    ph.title = 'Photo evidence — click row to view full details';
    ph.textContent = String.fromCodePoint(0x1F4F7);  // 📷
  } else if (report.videoUrl) {
    ph.title = 'Video evidence — click row to view full details';
    ph.textContent = String.fromCodePoint(0x1F3A5);  // 🎥
  } else {
    ph.className = 'thumb-placeholder thumb-placeholder--none';
    ph.title = 'No evidence submitted';
    ph.textContent = String.fromCodePoint(0x1F5BC) + String.fromCharCode(0xFE0F);  // 🖼️
  }
  tdImage.appendChild(ph);
  tr.appendChild(tdImage);







  // Status cell — click to change
  const tdStatus = document.createElement('td');
  tdStatus.className = 'status-cell status-cell--clickable';
  tdStatus.title = 'Click to change status';
  setStatusCell(tdStatus, report.status ?? 'Pending');
  tdStatus.addEventListener('click', (e) => {
    e.stopPropagation();
    showInlineStatusSelect(report, tdStatus);
  });
  tr.appendChild(tdStatus);
  const tdActions = document.createElement('td');
  tdActions.className = 'actions-cell';
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn--delete-row';
  delBtn.title = 'Delete report';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    confirmDeleteReport(report);
  });
  tdActions.appendChild(delBtn);
  tr.appendChild(tdActions);







  tr.style.cursor = 'pointer';
  tr.addEventListener('click', () => openDetailModal(report));
  return tr;
}


/**
 * Build an actions button + dropdown for a report row.
 *
 * @param {Object}      report   - Report data with `.id`.
 * @param {HTMLElement} statusCell - The <td> holding the status badge (for optimistic UI).
 * @returns {HTMLElement} Wrapper containing the button (dropdown appended on click).
 */
function buildActionsButton(report, statusCell, categoryCell) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';

  const btn = document.createElement('button');
  btn.className = 'actions-btn';
  btn.type = 'button';
  btn.textContent = 'Actions â–¾';
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown(report, statusCell, categoryCell, wrapper, btn);
  });

  wrapper.appendChild(btn);
  return wrapper;
}

/**
 * Open or close the actions dropdown for the given report.
 */
function toggleDropdown(report, statusCell, categoryCell, wrapper, triggerBtn) {
  // Close any existing open dropdown
  if (activeDropdown && activeDropdown !== wrapper.querySelector('.actions-dropdown')) {
    closeActiveDropdown();
  }

  const existing = wrapper.querySelector('.actions-dropdown');
  if (existing) {
    existing.remove();
    triggerBtn.setAttribute('aria-expanded', 'false');
    activeDropdown = null;
    return;
  }

  const dropdown = document.createElement('div');
  dropdown.className = 'actions-dropdown';

  // â”€â”€ View Full Details â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const viewBtn = document.createElement('button');
  viewBtn.type = 'button';
  viewBtn.textContent = 'View Full Details';
  viewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeActiveDropdown();
    openDetailModal(report);
  });

  // â”€â”€ Change Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const changeStatusBtn = document.createElement('button');
  changeStatusBtn.type = 'button';
  changeStatusBtn.textContent = 'Change Status';
  changeStatusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeActiveDropdown();
    showInlineStatusSelect(report, statusCell);
  });

  // â”€â”€ Change Category â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const changeCategoryBtn = document.createElement('button');
  changeCategoryBtn.type = 'button';
  changeCategoryBtn.textContent = 'Change Category';
  changeCategoryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeActiveDropdown();
    showInlineCategorySelect(report, categoryCell);
  });

  // â”€â”€ Delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'ðŸ—‘ Delete Report';
  deleteBtn.className = 'actions-dropdown__delete';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeActiveDropdown();
    confirmDeleteReport(report);
  });

  dropdown.appendChild(viewBtn);
  dropdown.appendChild(changeStatusBtn);
  dropdown.appendChild(changeCategoryBtn);
  dropdown.appendChild(deleteBtn);
  wrapper.appendChild(dropdown);
  triggerBtn.setAttribute('aria-expanded', 'true');
  activeDropdown = dropdown;
}

/**
 * Remove whatever dropdown is currently open.
 */
function closeActiveDropdown() {
  if (activeDropdown) {
    activeDropdown.remove();
    activeDropdown = null;
    // Reset aria-expanded on any actions button inside the same wrapper
    document.querySelectorAll('.actions-btn[aria-expanded="true"]').forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');
    });
  }
}

// ---------------------------------------------------------------------------
// Cloudinary upload (for completion evidence)
// ---------------------------------------------------------------------------

const CLOUDINARY_CLOUD   = 'zq9gopfc';
const CLOUDINARY_PRESET  = 'beealert_uploads';

async function uploadToCloudinary(file) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_PRESET);
  fd.append('folder', 'reports/completion');
  fd.append('resource_type', file.type.startsWith('video') ? 'video' : 'image');

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/upload`,
    { method: 'POST', body: fd }
  );
  if (!res.ok) throw new Error(`Cloudinary upload failed: ${res.statusText}`);
  const json = await res.json();
  return json.secure_url;
}

// ---------------------------------------------------------------------------
// Completion evidence modal
// ---------------------------------------------------------------------------

/**
 * Show a modal asking the admin to upload evidence before marking Completed.
 * Resolves to { confirmed: true, url, type } or { confirmed: false }.
 */
function showCompletionEvidenceModal() {
  return new Promise((resolve) => {
    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-overlay';
    backdrop.style.display = 'flex';

    // Modal box
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '480px';
    modal.style.width = '100%';
    modal.innerHTML = /* html */ `
      <button class="modal__close" id="evidence-modal-close" aria-label="Close">&times;</button>
      <h2 class="modal__title">Upload Completion Evidence (Required)</h2>
      <p style="font-size:var(--font-size-sm);color:var(--color-text-secondary);margin-bottom:var(--space-4);">
        Evidence is required. Please attach a photo or video showing that the issue has been resolved
        before marking this report as <strong>Completed</strong>.
      </p>

      <div id="evidence-drop-zone" class="evidence-drop-zone" tabindex="0"
           role="button" aria-label="Click or drag to upload evidence">
        <div class="evidence-drop-zone__inner" id="evidence-drop-inner">
          <span class="evidence-drop-zone__icon" aria-hidden="true">ðŸ“Ž</span>
          <p class="evidence-drop-zone__text">Click to choose or drag &amp; drop</p>
          <p class="evidence-drop-zone__hint">Photo (JPG, PNG) or Video (MP4, MOV) â€” max 100 MB</p>
        </div>
        <input type="file" id="evidence-file-input" accept="image/*,video/*"
               style="display:none" aria-hidden="true" />
      </div>

      <div id="evidence-preview-wrap" style="display:none;margin-top:var(--space-3);">
        <div id="evidence-preview"></div>
        <button id="evidence-remove-btn" class="btn" style="margin-top:var(--space-2);font-size:var(--font-size-xs);color:var(--color-text-secondary);">
          âœ• Remove file
        </button>
      </div>

      <p id="evidence-upload-status" style="font-size:var(--font-size-sm);margin-top:var(--space-3);display:none;"></p>

      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-5);justify-content:flex-end;">



        <button id="evidence-confirm-btn" class="btn btn--approve" disabled>
          âœ“ Mark as Completed
        </button>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    let selectedFile = null;

    const fileInput   = modal.querySelector('#evidence-file-input');
    const dropZone    = modal.querySelector('#evidence-drop-zone');
    const dropInner   = modal.querySelector('#evidence-drop-inner');
    const previewWrap = modal.querySelector('#evidence-preview-wrap');
    const preview     = modal.querySelector('#evidence-preview');
    const removeBtn   = modal.querySelector('#evidence-remove-btn');

    const confirmBtn  = modal.querySelector('#evidence-confirm-btn');
    const statusEl    = modal.querySelector('#evidence-upload-status');
    const closeBtn    = modal.querySelector('#evidence-modal-close');

    function setFile(file) {
      selectedFile = file;
      previewWrap.style.display = 'block';
      preview.innerHTML = '';

      if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.style.cssText = 'width:100%;max-height:200px;object-fit:cover;border-radius:var(--radius-md);';
        preview.appendChild(img);
      } else {
        const vid = document.createElement('video');
        vid.src = URL.createObjectURL(file);
        vid.controls = true;
        vid.style.cssText = 'width:100%;max-height:200px;border-radius:var(--radius-md);';
        preview.appendChild(vid);
      }

      dropInner.querySelector('.evidence-drop-zone__text').textContent = file.name;
      confirmBtn.disabled = false;
    }

    function clearFile() {
      selectedFile = null;
      previewWrap.style.display = 'none';
      preview.innerHTML = '';
      fileInput.value = '';
      dropInner.querySelector('.evidence-drop-zone__text').textContent =
        'Click to choose or drag & drop';
      confirmBtn.disabled = true;
    }

    function cleanup() {
      backdrop.remove();
    }

    // Click to pick
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') fileInput.click();
    });

    // File selected via input
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) setFile(fileInput.files[0]);
    });

    // Drag & drop
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('evidence-drop-zone--drag');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('evidence-drop-zone--drag');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('evidence-drop-zone--drag');
      const file = e.dataTransfer.files[0];
      if (file) setFile(file);
    });

    // Remove file
    removeBtn.addEventListener('click', clearFile);

    // Close / cancel
    closeBtn.addEventListener('click', () => {
      cleanup();
      resolve({ confirmed: false });
    });







    // Confirm â€” upload then resolve
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;


      if (!selectedFile) return;   // file is required — button should not be enabled without one





      statusEl.style.display = 'block';
      statusEl.style.color   = 'var(--color-text-secondary)';
      statusEl.textContent   = 'â³ Uploading evidenceâ€¦';

      try {
        const url  = await uploadToCloudinary(selectedFile);
        const type = selectedFile.type.startsWith('video') ? 'video' : 'image';
        cleanup();
        resolve({ confirmed: true, url, type });
      } catch (err) {
        console.error('[evidence-upload]', err);
        statusEl.style.color = 'red';
        statusEl.textContent = 'âœ• Upload failed. Please try again.';
        confirmBtn.disabled = false;

      }
    });
  });
}


// ---------------------------------------------------------------------------
// Custom dropdown helper (replaces native <select> which closes on mouseup)
// ---------------------------------------------------------------------------

let activeCustomDropdown = null;
let activeAnchorCell = null;    // which cell currently has dropdown open

function closeActiveCustomDropdown() {
  if (activeCustomDropdown) {
    activeCustomDropdown.remove();
    activeCustomDropdown = null;
  }
  if (activeAnchorCell) {
    activeAnchorCell.classList.remove('dropdown-open');
    activeAnchorCell = null;
  }
}

document.addEventListener('click', () => closeActiveCustomDropdown());

/**
 * Show a persistent custom dropdown anchored to a cell.
 * Clicking the same cell again closes it (toggle).
 */
function showCustomDropdown(anchorCell, options, current, onSelect) {
  // Toggle — if already open for this cell, close it
  if (activeAnchorCell === anchorCell) {
    closeActiveCustomDropdown();
    return;
  }

  closeActiveCustomDropdown();

  const rect = anchorCell.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.className = 'custom-dropdown-menu';
  menu.style.cssText = `
    position: fixed;
    z-index: 9999;
    top: ${rect.bottom + 4}px;
    left: ${rect.left}px;
    min-width: ${Math.max(rect.width, 160)}px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    padding: 4px 0;
    overflow: hidden;
  `;

  options.forEach((opt) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'custom-dropdown-item' + (opt === current ? ' custom-dropdown-item--active' : '');
    item.textContent = opt;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeActiveCustomDropdown();
      if (opt !== current) onSelect(opt);
    });
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  activeCustomDropdown = menu;
  activeAnchorCell = anchorCell;
  anchorCell.classList.add('dropdown-open');
}

// ---------------------------------------------------------------------------
// Inline status select
// ---------------------------------------------------------------------------

/** Replace status cell content with badge + arrow (prevents accumulation). */
function setStatusCell(cell, status) {
  cell.innerHTML = '';
  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;';
  wrap.appendChild(statusBadge(status));
  const arr = document.createElement('span');
  arr.className = 'cell-arrow';
  arr.setAttribute('aria-hidden','true');
  arr.textContent = String.fromCharCode(9660);
  wrap.appendChild(arr);
  cell.appendChild(wrap);
}

function showInlineStatusSelect(report, statusCell, anchorEl) {

  showCustomDropdown(
    anchorEl ?? statusCell,
    ['Pending', 'Under Review', 'Ongoing', 'Completed'],
    report.status ?? 'Pending',
    (selectedStatus) => {
      // Close modal if open, then open the detail modal with the update form
      closeDetailModal();
      openDetailModalWithForm(report, statusCell, selectedStatus);
    }
  );
}

/**
 * Open the report detail modal and scroll to / show the update form
 * pre-filled with the selected status. Status only changes on form submit.
 */
async function openDetailModalWithForm(report, statusCell, pendingStatus) {
  const rid         = report.id;
  const isCompleted = pendingStatus === 'Completed';

  // ── Build a separate modal overlay ──────────────────────────────────────
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-overlay';
  backdrop.style.cssText = 'display:flex;z-index:10001;';   // above detail modal

  const panel = document.createElement('div');
  panel.className = 'modal modal--update-status';
  panel.style.cssText = 'max-width:480px;width:100%;max-height:90vh;overflow-y:auto;';

  panel.innerHTML = `
    <button class="modal__close" id="suf-close-${rid}" aria-label="Close">&times;</button>
    <h2 class="modal__title">
      Update Status &rarr;
      <span class="status-update-form-wrap__badge">${escapeHtml(pendingStatus)}</span>
    </h2>
    <p style="font-size:var(--font-size-sm);color:var(--color-text-secondary);margin-bottom:var(--space-4);">
      Fill in the details below. The status will only change when you click Submit.
    </p>

    <label class="post-update-card__label">UPDATE TITLE <span style="color:var(--color-text-muted)">(optional)</span></label>
    <input type="text" id="suf-title-${rid}" class="post-update-card__input"
           placeholder="e.g., Site Inspection Completed" style="margin-bottom:var(--space-4);" />

    <label class="post-update-card__label">UPDATE MESSAGE <span style="color:red">*</span></label>
    <textarea id="suf-msg-${rid}" rows="4" class="post-update-card__textarea"
              placeholder="Describe what was done or what is happening..."
              style="margin-bottom:var(--space-4);"></textarea>

    ${isCompleted ? `
    <label class="post-update-card__label">COMPLETION EVIDENCE <span style="color:red">*</span></label>
    <div id="suf-zone-${rid}" class="post-update-card__upload-zone" tabindex="0"
         role="button" aria-label="Upload completion evidence"
         style="margin-bottom:var(--space-4);">
      <input type="file" id="suf-file-${rid}" accept="image/*,video/*"
             style="display:none" aria-hidden="true" />
      <div id="suf-preview-${rid}" class="post-update-card__upload-inner">
        <svg class="post-update-card__upload-icon" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
        </svg>
        <span class="post-update-card__upload-title">Upload Evidence Photo / Video</span>
        <span class="post-update-card__upload-hint">Required &mdash; JPG, PNG, MP4 up to 100MB</span>
      </div>
    </div>` : ''}

    <div style="display:flex;gap:var(--space-3);">
      <button type="button" id="suf-cancel-${rid}"
              class="post-update-card__status-btn" style="flex:1">
        Cancel
      </button>
      <button type="button" id="suf-submit-${rid}"
              class="post-update-card__submit-btn"
              style="flex:2" ${isCompleted ? 'disabled' : ''}>
        Submit &amp; Change Status
      </button>
    </div>
  `;

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  function closePanel() { backdrop.remove(); }

  // Close on backdrop click
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closePanel(); });
  panel.querySelector('#suf-close-' + rid)?.addEventListener('click', closePanel);
  panel.querySelector('#suf-cancel-' + rid)?.addEventListener('click', closePanel);

  // Evidence upload (Completed only)
  let evidenceFile = null;
  if (isCompleted) {
    const zone    = panel.querySelector('#suf-zone-' + rid);
    const fileIn  = panel.querySelector('#suf-file-' + rid);
    const preview = panel.querySelector('#suf-preview-' + rid);
    const submitBtn = panel.querySelector('#suf-submit-' + rid);

    function setEvFile(f) {
      evidenceFile = f;
      submitBtn.disabled = !f;
      preview.innerHTML = '';
      if (f.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        img.style.cssText = 'width:100%;max-height:120px;object-fit:cover;border-radius:8px;';
        preview.appendChild(img);
      } else {
        const lbl = document.createElement('span');
        lbl.className = 'post-update-card__upload-title';
        lbl.textContent = f.name;
        preview.appendChild(lbl);
      }
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'post-update-card__upload-remove'; rm.textContent = 'Remove';
      rm.addEventListener('click', (e) => {
        e.stopPropagation(); evidenceFile = null; fileIn.value = '';
        submitBtn.disabled = true;
        preview.innerHTML = '<span class="post-update-card__upload-title">Upload Evidence Photo / Video</span>';
      });
      preview.appendChild(rm);
    }

    zone?.addEventListener('click', () => fileIn?.click());
    zone?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileIn?.click(); });
    zone?.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('post-update-card__upload-zone--drag'); });
    zone?.addEventListener('dragleave', () => zone.classList.remove('post-update-card__upload-zone--drag'));
    zone?.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('post-update-card__upload-zone--drag'); if (e.dataTransfer.files[0]) setEvFile(e.dataTransfer.files[0]); });
    fileIn?.addEventListener('change', () => { if (fileIn.files[0]) setEvFile(fileIn.files[0]); });
  }

  // Submit — only NOW the status changes
  panel.querySelector('#suf-submit-' + rid)?.addEventListener('click', async () => {
    const titleVal  = panel.querySelector('#suf-title-' + rid)?.value.trim() ?? '';
    const msgVal    = panel.querySelector('#suf-msg-'   + rid)?.value.trim() ?? '';
    const submitBtn = panel.querySelector('#suf-submit-' + rid);

    if (!msgVal)                        { showToast('Please provide an update message.', 'error'); return; }
    if (isCompleted && !evidenceFile)   { showToast('Please upload completion evidence.', 'error'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
      let evUrl = null, evType = null;
      if (evidenceFile) {
        evUrl  = await uploadToCloudinary(evidenceFile);
        evType = evidenceFile.type.startsWith('video') ? 'video' : 'image';
      }

      const updateData = { status: pendingStatus, updatedAt: serverTimestamp() };
      if (msgVal) updateData.lastUpdate = msgVal;
      if (evUrl)  updateData[evType === 'video' ? 'completionVideoUrl' : 'completionImageUrl'] = evUrl;

      await updateDoc(doc(db, 'reports', report.id), updateData);
      await addDoc(collection(db, 'reports', report.id, 'statusHistory'), {
        status: pendingStatus,
        updatedAt: serverTimestamp(),
        updatedBy: currentUid,
        updateTitle: titleVal || null,
        updateMessage: msgVal,
        ...(evUrl ? { evidenceUrl: evUrl, evidenceType: evType } : {}),
      });

      notifyResident(report.userId, 'report_update',
        titleVal || ('Report Status: ' + pendingStatus),
        msgVal,
        { reportId: report.id, reportRef: report.reportReference }
      );

      // Update table badge live
      report.status = pendingStatus;
      const tr = document.querySelector('tr[data-id="' + report.id + '"]');
      if (tr) {
        const td = tr.querySelector('.status-cell');
        if (td) setStatusCell(td, pendingStatus);
      }

      closePanel();
      showToast('Status changed to "' + pendingStatus + '" successfully.', 'success');
    } catch (err) {
      console.error('[status-form]', err);
      showToast('Failed to update. Please try again.', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit & Change Status';
    }
  });
}
// ---------------------------------------------------------------------------
// Inline category select
// ---------------------------------------------------------------------------

function showInlineCategorySelect(report, categoryCell) {
  const originalCategory = report.category ?? '';

  showCustomDropdown(
    categoryCell,
    ['Health', 'Transportation', 'Environment', 'Consumer Issue', 'Others'],
    originalCategory,
    async (newCategory) => {
      categoryCell.innerHTML = "<span class='cell-text'>" + escapeHtml(newCategory) + "</span> <span class='cell-arrow' aria-hidden='true'>&#9660;</span>";
      report.category = newCategory;

      try {
        await updateDoc(doc(db, 'reports', report.id), {
          category: newCategory,
          updatedAt: serverTimestamp(),
        });
        notifyResident(report.userId, 'report_update', 'Report Category Updated', 'Your report category was changed to "' + newCategory + '" by the municipal office.', { reportId: report.id, reportRef: report.reportReference });
        showToast('Category updated to "' + newCategory + '"', 'success');
      } catch (err) {
        console.error('[concern-table] Category update failed:', err);
        showToast('Failed to update category. Please try again.', 'error');
        categoryCell.innerHTML = "<span class='cell-text'>" + escapeHtml(originalCategory) + "</span> <span class='cell-arrow' aria-hidden='true'>&#9660;</span>";
        report.category = originalCategory;
      }
    }
  );
}


// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------

/**
 * Populate and open the detail modal for a given report.
 *
 * @param {Object} report - Full report data including `.id`.
 */
async function openDetailModal(report) {
  const modal = document.getElementById('concern-detail-modal');
  const body  = document.getElementById('concern-modal-body');
  if (!modal || !body) return;

  body.innerHTML = '';

  // â”€â”€ Detail grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const dl = document.createElement('dl');
  dl.className = 'detail-grid';

  const fields = [
    ['Resident',       report.userName ?? report.residentName ?? 'â€”'],
    ['Barangay / Address', report.barangay ?? 'â€”'],
    ['Report Ref',     report.reportReference ?? 'â€”'],
    ['Category',       report.category ?? 'â€”'],
    ['Location',       report.location ?? 'â€”'],
    ['Date Submitted', report.submittedAt ? formatDate(report.submittedAt) : 'â€”'],
    ['Status',         report.status ?? 'â€”'],
    ['GPS Coordinates',
      report.latitude != null && report.longitude != null
        ? `${report.latitude}, ${report.longitude}`
        : 'Not captured'],
  ];

  fields.forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  });

  body.appendChild(dl);

  // â”€â”€ Full description â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const descHeading = document.createElement('h3');
  descHeading.textContent = 'Description';
  descHeading.style.fontSize = 'var(--font-size-xs)';
  descHeading.style.fontWeight = '600';
  descHeading.style.color = 'var(--color-text-secondary)';
  descHeading.style.textTransform = 'uppercase';
  descHeading.style.marginBottom = 'var(--space-2)';

  const descPara = document.createElement('p');
  descPara.style.fontSize = 'var(--font-size-sm)';
  descPara.style.marginBottom = 'var(--space-4)';
  descPara.textContent = report.description ?? 'â€”';

  body.appendChild(descHeading);
  body.appendChild(descPara);

  // â”€â”€ Evidence (photo + video) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (report.imageUrl || report.videoUrl) {
    const evidenceHeading = document.createElement('h3');
    evidenceHeading.textContent = 'Evidence';
    evidenceHeading.className = 'modal-section-heading';
    body.appendChild(evidenceHeading);

    const evidenceWrap = document.createElement('div');
    evidenceWrap.className = 'evidence-wrap';

    // Photo
    if (report.imageUrl) {
      const photoWrap = document.createElement('div');
      photoWrap.className = 'evidence-item';

      const photoLabel = document.createElement('p');
      photoLabel.className = 'evidence-label';
      photoLabel.textContent = 'ðŸ“· Photo Evidence';
      photoWrap.appendChild(photoLabel);

      const img = document.createElement('img');
      img.className = 'detail-image';
      img.src = report.imageUrl;
      img.alt = 'Photo evidence';
      img.loading = 'lazy';

      // Click to open full size
      img.style.cursor = 'pointer';
      img.title = 'Click to open full size';
      img.addEventListener('click', () => window.open(report.imageUrl, '_blank'));

      photoWrap.appendChild(img);
      evidenceWrap.appendChild(photoWrap);
    }

    // Video
    if (report.videoUrl) {
      const videoWrap = document.createElement('div');
      videoWrap.className = 'evidence-item';

      const videoLabel = document.createElement('p');
      videoLabel.className = 'evidence-label';
      videoLabel.textContent = 'ðŸŽ¥ Video Evidence';
      videoWrap.appendChild(videoLabel);

      const video = document.createElement('video');
      video.className = 'detail-video';
      video.src = report.videoUrl;
      video.controls = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', 'Video evidence');

      videoWrap.appendChild(video);

      // Open in new tab link
      const videoLink = document.createElement('a');
      videoLink.href = report.videoUrl;
      videoLink.target = '_blank';
      videoLink.rel = 'noopener noreferrer';
      videoLink.textContent = 'Open video in new tab';
      videoLink.className = 'evidence-external-link';
      videoWrap.appendChild(videoLink);

      evidenceWrap.appendChild(videoWrap);
    }

    body.appendChild(evidenceWrap);
  } else {
    const noEvidence = document.createElement('p');
    noEvidence.className = 'no-evidence';
    noEvidence.textContent = 'No photo or video evidence submitted.';
    body.appendChild(noEvidence);
  }

  // â”€â”€ Status history timeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const histHeading = document.createElement('h3');
  histHeading.textContent = 'Status History';
  histHeading.style.fontSize = 'var(--font-size-xs)';
  histHeading.style.fontWeight = '600';
  histHeading.style.color = 'var(--color-text-secondary)';
  histHeading.style.textTransform = 'uppercase';
  histHeading.style.marginBottom = 'var(--space-2)';
  body.appendChild(histHeading);

  const histList = document.createElement('ul');
  histList.className = 'status-history-list';

  try {
    const histSnap = await getDocs(collection(db, 'reports', report.id, 'statusHistory'));
    if (histSnap.empty) {
      const li = document.createElement('li');
      li.textContent = 'No history available.';
      histList.appendChild(li);
    } else {
      histSnap.docs
        .sort((a, b) => {
          const aTime = a.data().updatedAt?.toMillis?.() ?? 0;
          const bTime = b.data().updatedAt?.toMillis?.() ?? 0;
          return bTime - aTime; // most-recent first
        })
        .forEach((histDoc) => {
          const data = histDoc.data();
          const li = document.createElement('li');
          const dateStr = data.updatedAt ? formatDate(data.updatedAt) : 'â€”';
          li.textContent = `${data.status} â€” ${dateStr} (by ${data.updatedBy ?? 'unknown'})`;
          histList.appendChild(li);
        });
    }
  } catch (err) {
    console.error('[concern-table] Failed to fetch status history:', err);
    const li = document.createElement('li');
    li.textContent = 'Could not load status history.';
    histList.appendChild(li);
  }

  body.appendChild(histList);



  // Show modal
  modal.hidden = false;
  document.getElementById('close-concern-modal')?.focus();
}

/**
 * Show a confirmation dialog then delete the report from Firestore.
 */
async function confirmDeleteReport(report) {
  const residentName = report.userName ?? report.residentName ?? 'this resident';
  const confirmed = window.confirm(
    'Delete report "' + (report.reportReference ?? '') + '" by ' + residentName + '?\n\nThis cannot be undone.'
  );
  if (!confirmed) return;

  const idx = allReports.findIndex(r => r.id === report.id);
  if (idx !== -1) allReports.splice(idx, 1);
  render(false);

  try {
    await deleteDoc(doc(db, 'reports', report.id));
    notifyResident(
      report.userId,
      'report_deleted',
      'Report Removed',
      'Your report "' + (report.reportReference ?? '') + '" (' + (report.category ?? '') + ') has been removed by the municipal office.',
      { reportRef: report.reportReference }
    );
    showToast('Report deleted successfully.', 'success');
  } catch (err) {
    console.error('[concern-table] Delete failed:', err);
    if (idx !== -1) allReports.splice(idx, 0, report);
    render(false);
    showToast('Failed to delete report. Please try again.', 'error');
  }
}

/**
 * Close the detail modal.
 */
function closeDetailModal() {
  const modal = document.getElementById('concern-detail-modal');
  if (modal) modal.hidden = true;
}

// ---------------------------------------------------------------------------
// Table / card rendering
// ---------------------------------------------------------------------------

/**
 * Re-render the tbody (and mobile cards) based on current state.
 * Appends to existing rows when currentPage > 1 (Load More).
 *
 * @param {boolean} [append=false] - When true, append rows instead of replacing.
 */
function render(append = false) {
  const tbody    = document.getElementById('concern-tbody');
  const loadMore = document.getElementById('load-more-btn');
  const cards    = document.getElementById('concern-cards');

  if (!tbody) return;

  const filtered = applyFilters(allReports, currentFilters);
  const pageData  = paginateReports(filtered, currentPage, PAGE_SIZE);

  // Calculate the starting row number for this batch
  const startRowNum = (currentPage - 1) * PAGE_SIZE + 1;

  if (!append) {
    tbody.innerHTML = '';
    if (cards) cards.innerHTML = '';
  }

  pageData.forEach((report, idx) => {
    const rowNum = startRowNum + idx;
    tbody.appendChild(buildRow(report, rowNum));

    // Mobile card (simple version)
    if (cards) {
      cards.appendChild(buildCard(report, rowNum));
    }
  });

  // Show/hide Load More
  if (loadMore) {
    const hasMore = filtered.length > currentPage * PAGE_SIZE;
    loadMore.style.display = hasMore ? '' : 'none';
  }
}

/**
 * Build a minimal mobile card for a report.
 *
 * @param {Object} report
 * @param {number} rowNum
 * @returns {HTMLDivElement}
 */
function buildCard(report, rowNum) {
  const card = document.createElement('div');
  card.className = 'concern-card';
  card.dataset.id = report.id;

  card.innerHTML = `
    <div class="concern-card__header">
      <span class="concern-card__num">#${rowNum}</span>
      <span class="concern-card__category">${report.category ?? 'â€”'}</span>
    </div>
    <p class="concern-card__resident">${report.userName ?? report.residentName ?? 'â€”'}</p>
    <p class="concern-card__desc">${(report.description ?? '').slice(0, 80)}${(report.description ?? '').length > 80 ? 'â€¦' : ''}</p>
    <div class="concern-card__footer">
      <span class="concern-card__date">${report.submittedAt ? formatDate(report.submittedAt) : 'â€”'}</span>
    </div>
  `;

  // Append status badge
  const footer = card.querySelector('.concern-card__footer');
  footer?.appendChild(statusBadge(report.status ?? 'Pending'));

  // Card click â†’ open detail modal
  card.addEventListener('click', () => openDetailModal(report));

  return card;
}

// ---------------------------------------------------------------------------
// Debounce utility
// ---------------------------------------------------------------------------

/**
 * @param {Function} fn
 * @param {number}   delay - milliseconds
 * @returns {Function}
 */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ---------------------------------------------------------------------------
// Public init
// ---------------------------------------------------------------------------

/**
 * Initialise the Community Concern Management section.
 * Called once by admin/app.js when the section is first activated.
 *
 * @param {HTMLElement} container - The section container element.
 * @param {string}      uid       - Firebase Auth UID of the logged-in official.
 */
export function init(container, uid) {
  // Reset module state
  allReports     = [];
  currentFilters = { status: 'All', category: 'All', search: '' };
  currentPage    = 1;
  currentUid     = uid;
  activeDropdown = null;

  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  // Render static HTML
  container.innerHTML = SECTION_HTML;

  // â”€â”€ Firestore real-time subscription â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const reportsQuery = query(
    collection(db, 'reports'),
    orderBy('submittedAt', 'desc')
  );

  unsubscribe = onSnapshot(
    reportsQuery,
    (snapshot) => {
      const isInitialLoad = allReports.length === 0;
      const previousIds   = new Set(allReports.map(r => r.id));

      allReports  = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      currentPage = 1;
      render(false);

      // Notify admin of genuinely new reports (skip initial load)
      if (!isInitialLoad) {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added' && !previousIds.has(change.doc.id)) {
            const d   = change.doc.data();
            const who = d.userName ?? d.residentName ?? 'A resident';
            notifyAdmin(
              'new_report',
              `New Report: ${d.category ?? 'Concern'}`,
              `${who} submitted a new ${d.category ?? 'concern'} report. Ref: ${d.reportReference ?? change.doc.id}`,
              { reportId: change.doc.id, reportRef: d.reportReference, userId: d.userId, residentName: who }
            );
          }
        });
      }
    },
    (err) => {
      console.error('[concern-table] Firestore snapshot error:', err);
      showToast('Failed to load reports. Please refresh.', 'error');
    }
  );

  // â”€â”€ Filter event listeners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  container.querySelector('#filter-status')?.addEventListener('change', (e) => {
    currentFilters = { ...currentFilters, status: e.target.value };
    currentPage = 1;
    render(false);
  });

  container.querySelector('#filter-category')?.addEventListener('change', (e) => {
    currentFilters = { ...currentFilters, category: e.target.value };
    currentPage = 1;
    render(false);
  });

  const handleSearch = debounce((value) => {
    currentFilters = { ...currentFilters, search: value };
    currentPage = 1;
    render(false);
  }, 300);

  container.querySelector('#filter-search')?.addEventListener('input', (e) => {
    handleSearch(e.target.value);
  });

  // â”€â”€ Load More â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  container.querySelector('#load-more-btn')?.addEventListener('click', () => {
    currentPage++;
    render(true); // append new rows
  });

  // â”€â”€ Modal close â€” button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  container.addEventListener('click', (e) => {
    if (e.target.id === 'close-concern-modal') {
      closeDetailModal();
    }
  });

  // â”€â”€ Modal close â€” Escape key â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('concern-detail-modal');
      if (modal && !modal.hidden) closeDetailModal();
      closeActiveDropdown();
    }
  });

  // â”€â”€ Close dropdown on outside click â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  document.addEventListener('click', () => {
    closeActiveDropdown();
  });
}
