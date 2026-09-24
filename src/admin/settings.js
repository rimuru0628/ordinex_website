/**
 * Admin Settings — lazy-loaded by admin/app.js.
 * Handles general settings + municipal contacts editor.
 * Contacts are stored in Firestore at `settings/contacts` and read
 * by the mobile app to display live phone numbers to residents.
 */

import { db } from '../shared/firebase.js';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { showToast } from '../shared/ui-helpers.js';

// ── Default contacts ──────────────────────────────────────────────────────────

const DEFAULT_CONTACTS = [
  { id: 'mayor',  name: "Municipal Mayor's Office", phone: '(072) 607-1234', email: 'mayor@bacnotan.gov.ph' },
  { id: 'police', name: 'Bacnotan Police Station',  phone: '(072) 607-6079', email: 'police@bacnotan.gov.ph' },
  { id: 'health', name: 'Rural Health Unit',        phone: '(072) 607-9012', email: 'health@bacnotan.gov.ph' },
];

// ── HTML template ─────────────────────────────────────────────────────────────

const SETTINGS_HTML = /* html */ `
<div class="settings-section">
  <h1 class="section-title">Settings</h1>

  <!-- General Settings -->
  <div class="settings-card">
    <h2 class="settings-card__title">General Settings</h2>
    <div class="settings-row">
      <label class="form-label" for="display-name">Display Name</label>
      <input class="form-input" type="text" id="display-name" />
    </div>
    <div class="settings-row">
      <label class="form-label" for="contact-email">Contact Email</label>
      <input class="form-input" type="email" id="contact-email" />
    </div>
    <button class="btn btn--primary" id="save-general-btn">Save Changes</button>
  </div>

  <!-- Municipal Contacts Editor -->
  <div class="settings-card">
    <h2 class="settings-card__title">Municipal Contacts</h2>
    <p class="settings-card__desc">
      These phone numbers and emails are displayed to residents on the mobile app.
      Changes take effect immediately after saving.
    </p>
    <div id="contacts-list" class="contacts-list"></div>
    <div class="contacts-actions">
      <button class="btn btn--secondary" id="add-contact-btn">+ Add Contact</button>
      <button class="btn btn--primary"   id="save-contacts-btn">Save Contacts</button>
    </div>
    <p class="settings-save-hint" id="contacts-save-hint" hidden>
      Unsaved changes — click "Save Contacts" to push to the mobile app.
    </p>
  </div>

  <!-- Notification Settings -->
  <div class="settings-card">
    <h2 class="settings-card__title">Notification Settings</h2>
    <div class="settings-toggle-row">
      <label class="settings-toggle-label" for="email-notifications">Email notifications for new reports</label>
      <input type="checkbox" id="email-notifications" role="switch" />
    </div>
  </div>

  <!-- Content Preferences -->
  <div class="settings-card">
    <h2 class="settings-card__title">Content Preferences</h2>
    <div class="settings-toggle-row">
      <label class="settings-toggle-label" for="show-resolved">Show resolved reports in dashboard</label>
      <input type="checkbox" id="show-resolved" role="switch" checked />
    </div>
  </div>

  <!-- Credits -->
  <div class='settings-card'>
    <h2 class='settings-card__title'>Credits</h2>
    <div class='credits-section'>
      <div class='credits-logo'>
        <img src='src/assets/logo.png' alt='BEE-Alert logo' width='64' height='64' style='border-radius:50%;object-fit:cover;' />
      </div>
      <h3 class='credits-app-name'>BEE-Alert</h3>
      <p class='credits-tagline'>Municipal Ordinance Reporting App</p>
      <p class='credits-municipality'>Municipality of Bacnotan, La Union</p>
      <div class='credits-divider'></div>
      <p class='credits-version'>Version 1.0.0</p>
      <p class='credits-built'>Developed for the local government of Bacnotan, La Union.</p>
      <div class='credits-divider'></div>
      <p class='credits-team-label'>DEVELOPMENT TEAM</p>
      <p class='credits-team'>Bacnotan LGU Digital Services</p>
    </div>
  </div>
</div>
`;

// ── Exported pure helper ──────────────────────────────────────────────────────

export async function saveSettings(uid, settings) {
  await setDoc(
    doc(db, 'settings', uid),
    { ...settings, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// ── Contact row builder ───────────────────────────────────────────────────────

let contactIdCounter = 0;

function buildContactRow(contact, onDelete, onChanged) {
  const rowId = `contact-row-${++contactIdCounter}`;
  const row = document.createElement('div');
  row.className = 'contact-row';
  row.dataset.id = contact.id ?? rowId;

  row.innerHTML = `
    <div class="contact-row__fields">
      <div class="contact-row__field">
        <label class="contact-row__label">Office / Name</label>
        <input class="form-input contact-row__name" type="text"
               placeholder="e.g. Mayor's Office" value="${escHtml(contact.name ?? '')}" />
      </div>
      <div class="contact-row__field">
        <label class="contact-row__label">Phone Number</label>
        <input class="form-input contact-row__phone" type="tel"
               placeholder="e.g. (072) 607-1234" value="${escHtml(contact.phone ?? '')}" />
      </div>
      <div class="contact-row__field">
        <label class="contact-row__label">Email (optional)</label>
        <input class="form-input contact-row__email" type="email"
               placeholder="e.g. office@bacnotan.gov.ph" value="${escHtml(contact.email ?? '')}" />
      </div>
    </div>
    <button class="btn contact-row__delete" type="button" title="Remove contact" aria-label="Remove contact">✕</button>
  `;

  row.querySelector('.contact-row__delete').addEventListener('click', () => {
    row.remove();
    onDelete();
  });

  row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', onChanged));

  return row;
}

function readContactsFromDOM(container) {
  return Array.from(container.querySelectorAll('.contact-row')).map(row => ({
    id:    row.dataset.id,
    name:  row.querySelector('.contact-row__name')?.value.trim()  ?? '',
    phone: row.querySelector('.contact-row__phone')?.value.trim() ?? '',
    email: row.querySelector('.contact-row__email')?.value.trim() ?? '',
  })).filter(c => c.name || c.phone);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Module init ───────────────────────────────────────────────────────────────

export async function init(container, uid) {
  container.innerHTML = SETTINGS_HTML;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const displayNameInput   = container.querySelector('#display-name');
  const contactEmailInput  = container.querySelector('#contact-email');
  const saveGeneralBtn     = container.querySelector('#save-general-btn');
  const emailNotifToggle   = container.querySelector('#email-notifications');
  const showResolvedToggle = container.querySelector('#show-resolved');

  const contactsList      = container.querySelector('#contacts-list');
  const addContactBtn     = container.querySelector('#add-contact-btn');
  const saveContactsBtn   = container.querySelector('#save-contacts-btn');
  const contactsSaveHint  = container.querySelector('#contacts-save-hint');

  let contactsDirty = false;

  function markDirty()  { contactsDirty = true;  if (contactsSaveHint) contactsSaveHint.hidden = false; }
  function markClean()  { contactsDirty = false;  if (contactsSaveHint) contactsSaveHint.hidden = true; }

  function addRow(contact) {
    const row = buildContactRow(contact, markDirty, markDirty);
    contactsList.appendChild(row);
  }

  // ── Load general settings ─────────────────────────────────────────────────
  try {
    const snap = await getDoc(doc(db, 'settings', uid));
    if (snap.exists()) {
      const data = snap.data();
      if (data.displayName   !== undefined) displayNameInput.value  = data.displayName;
      if (data.contactEmail  !== undefined) contactEmailInput.value = data.contactEmail;
      if (data.emailNotificationsEnabled !== undefined)
        emailNotifToggle.checked = data.emailNotificationsEnabled;
      if (data.showResolvedInDashboard !== undefined)
        showResolvedToggle.checked = data.showResolvedInDashboard;
    }
  } catch (err) {
    console.error('[settings] Failed to load settings:', err);
    showToast('Could not load settings. Please refresh.', 'error');
  }

  // ── Load contacts ─────────────────────────────────────────────────────────
  try {
    const contactsSnap = await getDoc(doc(db, 'settings', 'contacts'));
    const stored = contactsSnap.exists()
      ? (contactsSnap.data().contacts ?? DEFAULT_CONTACTS)
      : DEFAULT_CONTACTS;
    stored.forEach(c => addRow(c));
  } catch (err) {
    console.error('[settings] Failed to load contacts:', err);
    DEFAULT_CONTACTS.forEach(c => addRow(c));
  }

  // ── Add contact row ───────────────────────────────────────────────────────
  addContactBtn.addEventListener('click', () => {
    addRow({ id: `new-${Date.now()}`, name: '', phone: '', email: '' });
    markDirty();
    // Scroll to new row
    contactsList.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ── Save contacts ─────────────────────────────────────────────────────────
  saveContactsBtn.addEventListener('click', async () => {
    const contacts = readContactsFromDOM(contactsList);

    if (contacts.length === 0) {
      showToast('Add at least one contact before saving.', 'error');
      return;
    }

    const missing = contacts.find(c => !c.phone);
    if (missing) {
      showToast(`"${missing.name || 'A contact'}" is missing a phone number.`, 'error');
      return;
    }

    saveContactsBtn.disabled = true;
    saveContactsBtn.textContent = 'Saving...';

    try {
      await setDoc(doc(db, 'settings', 'contacts'), {
        contacts,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      });
      showToast('Contacts saved. Mobile app will reflect changes immediately.', 'success');
      markClean();
    } catch (err) {
      console.error('[settings] Failed to save contacts:', err);
      showToast('Failed to save contacts. Please try again.', 'error');
    } finally {
      saveContactsBtn.disabled = false;
      saveContactsBtn.textContent = 'Save Contacts';
    }
  });

  // ── Save general settings ─────────────────────────────────────────────────
  saveGeneralBtn.addEventListener('click', async () => {
    const displayName  = displayNameInput.value.trim();
    const contactEmail = contactEmailInput.value.trim();
    saveGeneralBtn.disabled = true;
    try {
      await saveSettings(uid, { displayName, contactEmail });
      showToast('Settings saved.', 'success');
    } catch (err) {
      console.error('[settings] Failed to save general settings:', err);
      showToast('Failed to save. Please try again.', 'error');
      _appendRetryButton(saveGeneralBtn, () => saveGeneralBtn.click());
    } finally {
      saveGeneralBtn.disabled = false;
    }
  });

  // ── Toggles ───────────────────────────────────────────────────────────────
  emailNotifToggle.addEventListener('change', async () => {
    try { await saveSettings(uid, { emailNotificationsEnabled: emailNotifToggle.checked }); }
    catch (err) { console.error('[settings] toggle error:', err); showToast('Could not save setting.', 'error'); }
  });

  showResolvedToggle.addEventListener('change', async () => {
    try { await saveSettings(uid, { showResolvedInDashboard: showResolvedToggle.checked }); }
    catch (err) { console.error('[settings] toggle error:', err); showToast('Could not save setting.', 'error'); }
  });

  // ── Warn on unsaved changes ───────────────────────────────────────────────
  window.addEventListener('beforeunload', (e) => {
    if (contactsDirty) { e.preventDefault(); e.returnValue = ''; }
  }, { once: true });
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _appendRetryButton(referenceEl, onRetry) {
  const existing = referenceEl.parentElement?.querySelector('.btn--retry');
  if (existing) return;
  const retryBtn = document.createElement('button');
  retryBtn.className   = 'btn btn--retry';
  retryBtn.textContent = 'Retry';
  retryBtn.style.marginLeft = 'var(--space-3)';
  retryBtn.addEventListener('click', () => { retryBtn.remove(); onRetry(); });
  referenceEl.insertAdjacentElement('afterend', retryBtn);
}
