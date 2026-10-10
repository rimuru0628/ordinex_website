/**
 * Resident SPA entry point  `src/resident/app.js`
 *
 * Responsibilities:
 *  1. Auth guard  redirect unauthenticated or wrong-role users immediately.
 *  2. Header hydration  populate resident name and barangay from Firestore.
 *  3. Tab switching  show the active panel, hide others; lazy-load tab modules
 *     on first activation.
 *  4. Sign Out  call Firebase signOut then redirect to /index.html regardless
 *     of whether the call succeeds or fails.
 *
 * Requirements: 3.2, 3.3, 3.4
 */

import { signOut } from 'firebase/auth';
import { getDoc, doc } from 'firebase/firestore';
import { auth, db } from '../shared/firebase.js';
import { authGuard } from '../shared/auth-guard.js';

// ---------------------------------------------------------------------------
// Tab  module mapping for lazy loading
// ---------------------------------------------------------------------------

/**
 * Maps each tab value (from data-tab or derived from aria-controls) to its
 * lazy-import factory. Each module must export `init(container, uid)`.
 *
 * @type {Record<string, () => Promise<{ init: (container: HTMLElement, uid: string) => void }>>}
 */
const TAB_MODULES = {
  'submit-report': () => import('./report-form.js'),
  'my-reports':    () => import('./my-reports.js'),
  'chatbot':       () => import('./chatbot.js'),
};

/** Tracks which tab modules have already been initialised to avoid double-init. */
const initialisedTabs = new Set();

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

async function init() {
  // 1. Auth guard  resolves with Firebase User or redirects away.
  let user;
  try {
    user = await authGuard('resident');
  } catch (err) {
    // authGuard handles redirects internally; this path is an unexpected error.
    console.error('[resident/app] authGuard error:', err);
    return;
  }

  // 2. Fetch the Firestore user document to populate the header.
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const { fullName, barangay } = snap.data() ?? {};

    // The HTML uses id="resident-name" and id="resident-barangay"
    const nameEl     = document.getElementById('resident-name');
    const barangayEl = document.getElementById('resident-barangay');

    if (nameEl)     nameEl.textContent     = fullName  ?? '';
    if (barangayEl) barangayEl.textContent = barangay  ?? '';
  } catch (err) {
    console.error('[resident/app] Failed to load user profile:', err);
  }

  // 3. Wire up tab navigation.
  setupTabs(user);

  // 4. Wire up the Sign Out button.
  setupSignOut();

  // 5. Activate the first tab by default (submit-report).
  const firstBtn = /** @type {HTMLButtonElement|null} */ (
    document.querySelector('.tab-btn')
  );
  if (firstBtn) firstBtn.click();
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

/**
 * Resolves the tab name from a tab button.
 * Prefers `data-tab`; falls back to stripping the "tab-btn-" prefix from the
 * element's id, or to the `aria-controls` value with the leading "tab-" removed.
 *
 * @param {HTMLButtonElement} btn
 * @returns {string}
 */
function resolveTabName(btn) {
  if (btn.dataset.tab) return btn.dataset.tab;
  if (btn.id && btn.id.startsWith('tab-btn-')) return btn.id.slice('tab-btn-'.length);
  const controls = btn.getAttribute('aria-controls');
  if (controls && controls.startsWith('tab-')) return controls.slice('tab-'.length);
  return '';
}

/**
 * Queries all `.tab-btn` buttons and wires up click handlers for accessible
 * tab switching with lazy module loading.
 *
 * @param {import('firebase/auth').User} user
 */
function setupTabs(user) {
  const tabBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.tab-btn')
  );

  if (!tabBtns.length) return;

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn, tabBtns, user));
  });
}

/**
 * Activates a tab:
 *  - Sets `aria-selected="true"` on the clicked button, `"false"` on all others.
 *  - Updates `tabindex` for roving tabindex pattern (0 on active, -1 on rest).
 *  - Adds `is-active` class to the matching panel, removes it from others.
 *  - Removes `hidden` from the active panel, adds it to others.
 *  - Lazily imports and initialises the corresponding module on first activation,
 *    calling `module.init(container, uid)` with the panel element and user UID.
 *
 * @param {HTMLButtonElement}             activeBtn
 * @param {NodeListOf<HTMLButtonElement>} allBtns
 * @param {import('firebase/auth').User}  user
 */
async function activateTab(activeBtn, allBtns, user) {
  const tabName = resolveTabName(activeBtn);

  //  Update button aria states & roving tabindex 
  allBtns.forEach((btn) => {
    const isActive = btn === activeBtn;
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  //  Show / hide panels 
  const allPanels = /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('.tab-panel')
  );
  allPanels.forEach((panel) => {
    const isTarget = panel.id === `tab-${tabName}`;
    panel.classList.toggle('is-active', isTarget);
    if (isTarget) {
      panel.removeAttribute('hidden');
    } else {
      panel.setAttribute('hidden', '');
    }
  });

  //  Lazy-load and initialise the tab module on first activation 
  if (tabName && !initialisedTabs.has(tabName)) {
    const moduleLoader = TAB_MODULES[tabName];

    if (moduleLoader) {
      initialisedTabs.add(tabName); // Mark before loading to prevent double-init

      // Locate the tab panel to pass as the container.
      const container = /** @type {HTMLElement|null} */ (
        document.getElementById(`tab-${tabName}`)
      );

      try {
        const module = await moduleLoader();

        // Convention: each tab module exports `init(container, uid)`.
        if (typeof module?.init === 'function') {
          module.init(container, user.uid);
        }
      } catch (err) {
        initialisedTabs.delete(tabName); // Allow retry on next activation
        console.error(`[resident/app] Failed to load module for tab "${tabName}":`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sign Out
// ---------------------------------------------------------------------------

/**
 * Wires up the Sign Out button. Always redirects to `/index.html` via
 * `.finally()` so navigation happens regardless of whether Firebase sign-out
 * succeeds (e.g. already signed out, offline).
 */
function setupSignOut() {
  const btn = document.getElementById('sign-out-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    signOut(auth)
      .catch(() => {
        // Silently ignore  redirect is unconditional via .finally()
      })
      .finally(() => {
        window.location.href = '/index.html';
      });
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

// Run after the DOM is ready.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
