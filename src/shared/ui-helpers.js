/**
 * Shared UI helper utilities for BEE-Alert.
 *
 * Pure DOM/utility functions with no Firebase or framework dependencies.
 * Import individual helpers wherever they are needed across the app.
 */

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

/**
 * Creates a <span> badge element styled according to the report status.
 *
 * @param {'Pending'|'Ongoing'|'Completed'} status
 * @returns {HTMLSpanElement}
 */
export function statusBadge(status) {
  const span = document.createElement('span');
  const modifier = typeof status === 'string' ? status.toLowerCase().replace(/\s+/g, '-') : '';
  span.className = `badge badge--${modifier}`;
  span.textContent = status;
  return span;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/**
 * Formats a Firestore Timestamp or a plain JS Date into a human-readable string.
 *
 * @param {import('firebase/firestore').Timestamp | Date} timestamp
 * @returns {string} Date formatted as "Mon DD, YYYY" (e.g. "Jan 15, 2025").
 */
export function formatDate(timestamp) {
  const date =
    timestamp && typeof timestamp.toDate === 'function'
      ? timestamp.toDate()
      : timestamp instanceof Date
      ? timestamp
      : new Date(timestamp);

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------

const TOAST_AUTO_DISMISS_MS = 4000;

/**
 * Appends a dismissible toast notification to `#toast-container`.
 * Auto-dismisses after 4 seconds.
 *
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} [type='success']
 */
export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');

  const text = document.createElement('span');
  text.className = 'toast__message';
  text.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast__close';
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.textContent = '\u00D7'; // × — FIX: was empty string in Downloads version

  const dismiss = () => {
    toast.classList.add('toast--dismissing');
    setTimeout(() => toast.remove(), 300);
  };

  closeBtn.addEventListener('click', dismiss);

  toast.appendChild(text);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  const autoTimer = setTimeout(dismiss, TOAST_AUTO_DISMISS_MS);
  closeBtn.addEventListener('click', () => clearTimeout(autoTimer), { once: true });
}

// ---------------------------------------------------------------------------
// Loading overlay
// ---------------------------------------------------------------------------

const OVERLAY_ID = 'loading-overlay';

/**
 * Shows a CSS spinner overlay on the currently active section.
 */
export function showLoadingOverlay() {
  let overlay = document.getElementById(OVERLAY_ID);

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'loading-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-label', 'Loading');

    const spinner = document.createElement('div');
    spinner.className = 'loading-overlay__spinner';
    overlay.appendChild(spinner);
  }

  const activeSection =
    document.querySelector('section.active') ||
    document.querySelector('main') ||
    document.body;

  if (!activeSection.contains(overlay)) {
    activeSection.appendChild(overlay);
  }

  overlay.hidden = false;
  overlay.classList.remove('loading-overlay--hidden');
}

/**
 * Hides the loading spinner overlay.
 */
export function hideLoadingOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;
  overlay.hidden = true;
  overlay.classList.add('loading-overlay--hidden');
}
