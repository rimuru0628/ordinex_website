/**
 * Admin Notifications  real-time feed of system events.
 *
 * Firestore collection: `admin_notifications`
 * Document fields:
 *   type         'new_signup' | 'new_report'
 *   title        Short heading
 *   body         Detail text
 *   read         boolean (default false)
 *   createdAt    serverTimestamp
 *   meta         { userId?, reportId?, reportRef?, residentName? }
 */

import { db } from '../shared/firebase.js';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
  writeBatch,
  where,
} from 'firebase/firestore';
import { formatDate, showToast } from '../shared/ui-helpers.js';

//  Module state 

let unsubscribe    = null;
let allNotifs      = [];
let currentFilter  = 'all'; // 'all' | 'unread' | 'new_signup' | 'new_report'

//  HTML template 

const SECTION_HTML = /* html */ `
<div class="notif-section">
  <div class="notif-header">
    <h1 class="section-title">Notifications</h1>
    <button class="btn notif-mark-all-btn" id="notif-mark-all" type="button">
      Mark all as read
    </button>
  </div>

  <div class="notif-filter-tabs" role="tablist">
    <button class="notif-tab is-active" data-filter="all"        role="tab" aria-selected="true">All</button>
    <button class="notif-tab"           data-filter="unread"     role="tab" aria-selected="false">Unread</button>
    <button class="notif-tab"           data-filter="new_signup" role="tab" aria-selected="false">Sign-ups</button>
    <button class="notif-tab"           data-filter="new_report" role="tab" aria-selected="false">Reports</button>
  </div>

  <div id="notif-list" class="notif-list"></div>
  <div id="notif-empty" class="notif-empty" hidden>
    <span aria-hidden="true"></span>
    <p>No notifications yet.</p>
  </div>
  <div id="notif-skeleton" class="notif-skeleton" aria-hidden="true">
    ${Array(5).fill('<div class="notif-skeleton-item"></div>').join('')}
  </div>
</div>
`;

//  Helpers 

function iconFor(type) {
  return type === 'new_signup' ? '' : '';
}

function applyFilter(notifs) {
  if (currentFilter === 'unread')     return notifs.filter(n => !n.read);
  if (currentFilter === 'new_signup') return notifs.filter(n => n.type === 'new_signup');
  if (currentFilter === 'new_report') return notifs.filter(n => n.type === 'new_report');
  return notifs;
}

//  Render 

function render() {
  const list    = document.getElementById('notif-list');
  const empty   = document.getElementById('notif-empty');
  const skeleton = document.getElementById('notif-skeleton');
  if (!list) return;

  if (skeleton) skeleton.hidden = true;

  const filtered = applyFilter(allNotifs);

  list.innerHTML = '';

  if (filtered.length === 0) {
    list.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }

  list.hidden = false;
  if (empty) empty.hidden = true;

  filtered.forEach(n => {
    const item = document.createElement('div');
    item.className = 'notif-item' + (n.read ? '' : ' notif-item--unread');
    item.dataset.id = n.id;

    const ts = n.createdAt;
    const dateStr = ts ? formatDate(ts) : '';

    item.innerHTML = `
      <div class="notif-item__icon" aria-hidden="true">${iconFor(n.type)}</div>
      <div class="notif-item__body">
        <p class="notif-item__title">${escHtml(n.title ?? '')}</p>
        <p class="notif-item__text">${escHtml(n.body ?? '')}</p>
        <p class="notif-item__date">${dateStr}</p>
      </div>
      ${!n.read ? '<div class="notif-item__dot" aria-label="Unread"></div>' : ''}
    `;

    if (!n.read) {
      item.addEventListener('click', () => markRead(n));
    }

    list.appendChild(item);
  });

  // Update sidebar badge
  updateBadge();
}

function updateBadge() {
  const unread = allNotifs.filter(n => !n.read).length;
  const badge = document.getElementById('nav-notif-badge');
  if (!badge) return;
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

async function markRead(notif) {
  if (notif.read) return;
  try {
    await updateDoc(doc(db, 'admin_notifications', notif.id), { read: true });
    notif.read = true;
    render();
  } catch (err) {
    console.error('[notifications] markRead error:', err);
  }
}

async function markAllRead() {
  const unread = allNotifs.filter(n => !n.read);
  if (unread.length === 0) return;
  try {
    const batch = writeBatch(db);
    unread.forEach(n => batch.update(doc(db, 'admin_notifications', n.id), { read: true }));
    await batch.commit();
    unread.forEach(n => { n.read = true; });
    render();
    showToast('All notifications marked as read.', 'success');
  } catch (err) {
    console.error('[notifications] markAllRead error:', err);
    showToast('Failed to mark all as read.', 'error');
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

//  Public init 

export function init(container, uid, barangay) {
  allNotifs     = [];
  currentFilter = 'all';
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  container.innerHTML = SECTION_HTML;

  const skeleton = document.getElementById('notif-skeleton');
  if (skeleton) skeleton.hidden = false;

  // Filter tabs
  container.querySelectorAll('.notif-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.notif-tab').forEach(t => {
        const active = t.dataset.filter === tab.dataset.filter;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      currentFilter = tab.dataset.filter;
      render();
    });
  });

  // Mark all read
  document.getElementById('notif-mark-all')?.addEventListener('click', markAllRead);

  // Firestore real-time listener (filter by barangay for officials)
  const q = barangay
    ? query(collection(db, 'admin_notifications'), where('meta.barangay', '==', barangay), orderBy('createdAt', 'desc'))
    : query(collection(db, 'admin_notifications'), orderBy('createdAt', 'desc'));


  unsubscribe = onSnapshot(q, (snap) => {
    allNotifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    console.error('[notifications] Firestore error:', err);
    if (skeleton) skeleton.hidden = true;
    showToast('Failed to load notifications.', 'error');
  });
}

//  Exported helper (used by other admin modules) 

export async function writeAdminNotif(type, title, body, meta = {}) {
  try {
    const { addDoc, serverTimestamp: sts } = await import('firebase/firestore');
    await addDoc(collection(db, 'admin_notifications'), {
      type, title, body, meta,
      read: false,
      createdAt: sts(),
    });
  } catch (err) {
    console.error('[notifications] write error:', err);
  }
}
