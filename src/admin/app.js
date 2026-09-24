import { signOut } from 'firebase/auth';
import { auth } from '../shared/firebase.js';
import { authGuard } from '../shared/auth-guard.js';

// ── Section routing ──────────────────────────────────────────────────────────

const SECTION_MODULES = {
  'dashboard':           () => import('../admin/dashboard.js'),
  'concern-management':  () => import('../admin/concern-table.js'),
  'notifications':       () => import('../admin/notifications.js'),
  'confirm-residents':   () => import('../admin/confirm-residents.js'),
  'settings':            () => import('../admin/settings.js'),
};

const initialisedSections = new Set();

async function activateSection(sectionName, user) {
  document.querySelectorAll('.admin-nav__link').forEach((link) => {
    if (link.dataset.section === sectionName) {
      link.classList.add('is-active');
      link.setAttribute('aria-current', 'page');
    } else {
      link.classList.remove('is-active');
      link.removeAttribute('aria-current');
    }
  });

  document.querySelectorAll('[id^="section-"]').forEach((panel) => {
    panel.classList.remove('is-active');
  });

  const container = document.getElementById(`section-${sectionName}`);
  if (container) container.classList.add('is-active');

  if (!initialisedSections.has(sectionName) && SECTION_MODULES[sectionName]) {
    initialisedSections.add(sectionName);
    try {
      const module = await SECTION_MODULES[sectionName]();
      if (typeof module?.init === 'function') {
        module.init(container, user?.uid);
      }
    } catch (err) {
      console.error(`[admin/app] Failed to load section "${sectionName}":`, err);
      // Remove from initialised set so the next click retries
      initialisedSections.delete(sectionName);
    }
  } else if (initialisedSections.has(sectionName) && SECTION_MODULES[sectionName]) {
    // Re-run init on every visit for live-data sections so the
    // Firestore listener is always fresh (handles auth-state changes too)
    if (sectionName === 'confirm-residents' || sectionName === 'notifications') {
      try {
        const module = await SECTION_MODULES[sectionName]();
        if (typeof module?.init === 'function') {
          module.init(container, user?.uid);
        }
      } catch (err) {
        console.error(`[admin/app] Failed to reload section "${sectionName}":`, err);
      }
    }
  }
}

// ── Sidebar helpers ──────────────────────────────────────────────────────────

function closeSidebar() {
  document.getElementById('admin-sidebar')?.classList.remove('is-open');
  document.getElementById('sidebar-overlay')?.classList.remove('is-visible');
  document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'false');
}

function openSidebar() {
  document.getElementById('admin-sidebar')?.classList.add('is-open');
  document.getElementById('sidebar-overlay')?.classList.add('is-visible');
  document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'true');
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Wait for Firebase to confirm the user is signed in
  const user = await authGuard();

  document.querySelectorAll('.admin-nav__link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      if (section) {
        activateSection(section, user);
        // Sync bottom nav active state
        document.querySelectorAll('.admin-bottom-nav__btn').forEach(b =>
          b.classList.toggle('is-active', b.dataset.section === section)
        );
      }
      closeSidebar();
    });
  });

  // ── Bottom nav (mobile) ──────────────────────────────────────────────────
  document.querySelectorAll('.admin-bottom-nav__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      if (section) {
        activateSection(section, user);
        // Sync active state on bottom nav
        document.querySelectorAll('.admin-bottom-nav__btn').forEach(b =>
          b.classList.toggle('is-active', b.dataset.section === section)
        );
      }
    });
  });

  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    const sidebar = document.getElementById('admin-sidebar');
    sidebar?.classList.contains('is-open') ? closeSidebar() : openSidebar();
  });

  document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);

  document.getElementById('sign-out-btn')?.addEventListener('click', () => {
    signOut(auth).finally(() => {
      window.location.href = '/index.html';
    });
  });

  activateSection('dashboard', user);
}

init();
