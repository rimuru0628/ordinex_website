/**
 * My Reports tab module  `src/resident/my-reports.js`
 *
 * Responsibilities:
 *  1. Subscribe to the resident's own reports via a Firestore onSnapshot listener.
 *  2. Show a loading spinner if the first snapshot takes more than 3 seconds.
 *  3. Render a list of report cards or an empty-state message.
 *  4. Open a detail modal when a report card is clicked.
 *  5. Close the detail modal when the close button is clicked.
 *
 * Requirements: 5.1, 5.2
 */

import { db } from '../shared/firebase.js';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import {
  statusBadge,
  formatDate,
  showLoadingOverlay,
  hideLoadingOverlay,
} from '../shared/ui-helpers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Milliseconds before the loading spinner is shown while waiting for the first snapshot. */
const LOADING_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Pure utility exports
// ---------------------------------------------------------------------------

/**
 * Filters an array of report objects to only those belonging to a specific resident.
 *
 * This is a pure function with no side effects  suitable for unit and property-based testing.
 *
 * @param {Array<{residentId: string, [key: string]: any}>} reports - Array of report objects.
 * @param {string} residentId - The UID of the resident to filter by.
 * @returns {Array<{residentId: string, [key: string]: any}>} Reports whose `residentId` matches.
 */
export function filterByResident(reports, residentId) {
  return reports.filter((report) => report.residentId === residentId);
}

// ---------------------------------------------------------------------------
// Module initialisation
// ---------------------------------------------------------------------------

/**
 * Initialises the My Reports tab.
 *
 * Called by `app.js` when the "My Reports" tab is activated for the first time.
 *
 * @param {HTMLElement} container - The `#tab-my-reports` section element.
 * @param {string}      uid       - The Firebase Auth UID of the current resident.
 */
export function init(container, uid) {
  // Locate the inner mount point rendered by resident.html
  const mountEl = container.querySelector('#my-reports-container') ?? container;

  //  1. Start 3-second timeout for loading spinner 
  let firstSnapshotReceived = false;

  const loadingTimer = setTimeout(() => {
    if (!firstSnapshotReceived) {
      showLoadingOverlay();
    }
  }, LOADING_TIMEOUT_MS);

  //  2. Build the Firestore query 
  const reportsQuery = query(
    collection(db, 'reports'),
    where('residentId', '==', uid),
    orderBy('submittedAt', 'desc')
  );

  //  3. Subscribe with onSnapshot 
  const unsubscribe = onSnapshot(
    reportsQuery,
    (snapshot) => {
      // Cancel the loading timer and hide the overlay on first (and subsequent) snapshots
      if (!firstSnapshotReceived) {
        firstSnapshotReceived = true;
        clearTimeout(loadingTimer);
        hideLoadingOverlay();
      }

      const reports = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      renderList(mountEl, reports);
    },
    (error) => {
      // On error, still cancel the loading timer so the spinner disappears
      if (!firstSnapshotReceived) {
        firstSnapshotReceived = true;
        clearTimeout(loadingTimer);
        hideLoadingOverlay();
      }
      console.error('[my-reports] Firestore snapshot error:', error);
      mountEl.innerHTML = `
        <p class="form-error--block" role="alert">
          Failed to load reports. Please refresh and try again.
        </p>
      `;
    }
  );

  //  4. Wire up the detail modal close button 
  const closeBtn = document.getElementById('close-report-detail-modal');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeDetailModal);
  }

  // Close modal on overlay click (outside the inner .modal element)
  const modal = document.getElementById('report-detail-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeDetailModal();
      }
    });
  }

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const detailModal = document.getElementById('report-detail-modal');
      if (detailModal && !detailModal.hidden) {
        closeDetailModal();
      }
    }
  });

  // Return unsubscribe so the caller can clean up if needed (optional)
  return unsubscribe;
}

// ---------------------------------------------------------------------------
// List rendering
// ---------------------------------------------------------------------------

/**
 * Renders the report list (or empty state) into the mount element.
 *
 * @param {HTMLElement} mountEl - The element to render into.
 * @param {Array<Object>} reports - Snapshot-derived report objects.
 */
function renderList(mountEl, reports) {
  // Clear previous content
  mountEl.innerHTML = '';

  if (reports.length === 0) {
    //  Empty state 
    const emptyEl = document.createElement('div');
    emptyEl.className = 'empty-state';
    emptyEl.textContent = 'No reports yet. Submit your first report!';
    mountEl.appendChild(emptyEl);
    return;
  }

  //  Report list 
  const listEl = document.createElement('ul');
  listEl.className = 'report-list';
  listEl.setAttribute('role', 'list');

  reports.forEach((report) => {
    const card = buildReportCard(report);
    listEl.appendChild(card);
  });

  mountEl.appendChild(listEl);
}

/**
 * Builds a single `<li>` report card element.
 *
 * @param {Object} report - The report data object (includes Firestore `id`).
 * @returns {HTMLLIElement}
 */
function buildReportCard(report) {
  const li = document.createElement('li');
  li.className = 'report-card';
  li.setAttribute('role', 'button');
  li.setAttribute('tabindex', '0');
  li.setAttribute('aria-label', `View details for ${report.category ?? 'report'} report`);

  //  Meta row: category name (small) + date 
  const metaRow = document.createElement('div');
  metaRow.className = 'report-card__meta';

  const categoryEl = document.createElement('small');
  categoryEl.className = 'report-card__category';
  categoryEl.textContent = report.category ?? '';

  const dateEl = document.createElement('span');
  dateEl.className = 'report-card__date';
  dateEl.textContent = report.submittedAt ? formatDate(report.submittedAt) : '';

  metaRow.appendChild(categoryEl);
  metaRow.appendChild(dateEl);

  //  Description preview (first 100 chars) 
  const descEl = document.createElement('p');
  descEl.className = 'report-card__desc';
  const fullDesc = report.description ?? '';
  descEl.textContent =
    fullDesc.length > 100 ? `${fullDesc.slice(0, 100)}` : fullDesc;

  //  Status badge 
  const badgeWrapper = document.createElement('div');
  badgeWrapper.className = 'report-card__badge';
  badgeWrapper.appendChild(statusBadge(report.status));

  li.appendChild(metaRow);
  li.appendChild(descEl);
  li.appendChild(badgeWrapper);

  //  Click / keyboard handler to open detail modal 
  const openDetail = () => openDetailModal(report);
  li.addEventListener('click', openDetail);
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDetail();
    }
  });

  return li;
}

// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------

/**
 * Populates and opens the `#report-detail-modal`.
 *
 * @param {Object} report - The full report data object.
 */
function openDetailModal(report) {
  const modal = document.getElementById('report-detail-modal');
  const content = document.getElementById('report-detail-content');

  if (!modal || !content) return;

  //  Build the detail content 
  content.innerHTML = '';

  const frag = document.createDocumentFragment();

  // Category
  frag.appendChild(createDetailRow('Category', report.category ?? ''));

  // Full description
  frag.appendChild(createDetailRow('Description', report.description ?? ''));

  // Date submitted
  frag.appendChild(
    createDetailRow(
      'Date Submitted',
      report.submittedAt ? formatDate(report.submittedAt) : ''
    )
  );

  // GPS coordinates or "Not captured"
  const hasGps =
    report.latitude != null && report.longitude != null;
  const gpsText = hasGps
    ? `${report.latitude.toFixed(6)}, ${report.longitude.toFixed(6)}`
    : 'Not captured';
  frag.appendChild(createDetailRow('GPS Coordinates', gpsText));

  // Image (if imageUrl present)
  if (report.imageUrl) {
    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'report-detail__row';

    const imgLabel = document.createElement('dt');
    imgLabel.className = 'report-detail__label';
    imgLabel.textContent = 'Image';

    const imgValue = document.createElement('dd');
    imgValue.className = 'report-detail__value';

    const img = document.createElement('img');
    img.src = report.imageUrl;
    img.alt = `Report image for ${report.category ?? 'report'}`;
    img.className = 'report-detail__image';

    imgValue.appendChild(img);
    imgWrapper.appendChild(imgLabel);
    imgWrapper.appendChild(imgValue);
    frag.appendChild(imgWrapper);
  }

  // Status badge
  const statusRow = document.createElement('div');
  statusRow.className = 'report-detail__row';

  const statusLabel = document.createElement('dt');
  statusLabel.className = 'report-detail__label';
  statusLabel.textContent = 'Status';

  const statusValue = document.createElement('dd');
  statusValue.className = 'report-detail__value';
  statusValue.appendChild(statusBadge(report.status));

  statusRow.appendChild(statusLabel);
  statusRow.appendChild(statusValue);
  frag.appendChild(statusRow);

  content.appendChild(frag);

  //  Show the modal 
  modal.removeAttribute('hidden');

  // Move focus to the close button for accessibility
  const closeBtn = document.getElementById('close-report-detail-modal');
  if (closeBtn) {
    closeBtn.focus();
  }
}

/**
 * Hides the `#report-detail-modal`.
 */
function closeDetailModal() {
  const modal = document.getElementById('report-detail-modal');
  if (modal) {
    modal.setAttribute('hidden', '');
  }
}

/**
 * Creates a `<div>` containing a `<dt>` label and `<dd>` value pair.
 *
 * @param {string} label - The field label.
 * @param {string} value - The field value text.
 * @returns {HTMLDivElement}
 */
function createDetailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'report-detail__row';

  const dt = document.createElement('dt');
  dt.className = 'report-detail__label';
  dt.textContent = label;

  const dd = document.createElement('dd');
  dd.className = 'report-detail__value';
  dd.textContent = value;

  row.appendChild(dt);
  row.appendChild(dd);

  return row;
}
