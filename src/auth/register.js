/**
 * Barangay Official registration.
 * - Role hardcoded as 'official'
 * - Status 'pending'  requires admin confirmation before login
 * - Valid ID uploaded to Cloudinary, URL saved to Firestore
 */

import { createUserWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../shared/firebase.js';

//  DOM refs 

const form          = document.getElementById('register-form');
const nameInput     = document.getElementById('name-input');
const emailInput    = document.getElementById('email-input');
const phoneInput    = document.getElementById('phone-input');
const barangayInput = document.getElementById('barangay-input');
const passwordInput = document.getElementById('password-input');
const confirmInput  = document.getElementById('confirm-input');
const idUploadZone  = document.getElementById('id-upload-zone');
const idFileInput   = document.getElementById('id-upload');
const idPreview     = document.getElementById('id-upload-preview');
const idError       = document.getElementById('id-error');
const registerBtn   = document.getElementById('register-btn');
const authError     = document.getElementById('auth-error');
const authSuccess   = document.getElementById('auth-success');
const nameError     = document.getElementById('name-error');
const emailError    = document.getElementById('email-error');
const phoneError    = document.getElementById('phone-error');
const barangayError = document.getElementById('barangay-error');
const passwordError = document.getElementById('password-error');
const confirmError  = document.getElementById('confirm-error');
const togglePwdBtn  = document.getElementById('toggle-password');
const eyeShow       = document.getElementById('eye-show');
const eyeHide       = document.getElementById('eye-hide');

//  Helpers 

function showErr(el, msg) { if (!el) return; el.textContent = msg; el.hidden = false; }
function clearErr(el)     { if (!el) return; el.textContent = ''; el.hidden = true; }
function showAuthError(msg)   { if (authError)   { authError.textContent = msg;   authError.hidden = false; } }
function clearAuthError()     { if (authError)   { authError.textContent = '';    authError.hidden = true; } }
function showAuthSuccess(msg) { if (authSuccess) { authSuccess.textContent = msg; authSuccess.hidden = false; } }

function setLoading(on) {
  if (!registerBtn) return;
  registerBtn.disabled = on;
  registerBtn.textContent = on ? 'Creating account\u2026' : 'Create Account';
}

//  Password toggle 

togglePwdBtn?.addEventListener('click', () => {
  const visible = passwordInput.type === 'text';
  passwordInput.type = visible ? 'password' : 'text';
  eyeShow.style.display = visible ? '' : 'none';
  eyeHide.style.display = visible ? 'none' : '';
  togglePwdBtn.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
});

//  ID upload 

let idFile = null;

const PLACEHOLDER_HTML = `
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
  <p class="id-upload-text">Click or drag to upload your Valid ID</p>
  <p class="id-upload-hint">JPG, PNG &mdash; required</p>
`;

function setIdFile(f) {
  idFile = f;
  if (!idPreview) return;
  idPreview.innerHTML = '';
  const img = document.createElement('img');
  img.src = URL.createObjectURL(f);
  img.style.cssText = 'width:100%;max-height:160px;object-fit:cover;border-radius:8px;';
  idPreview.appendChild(img);
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.textContent = '\u2715 Remove';
  rm.style.cssText = 'margin-top:8px;font-size:12px;background:none;border:none;color:#6B7280;cursor:pointer;';
  rm.addEventListener('click', (e) => { e.stopPropagation(); clearIdFile(); });
  idPreview.appendChild(rm);
  if (idError) { idError.textContent = ''; idError.hidden = true; }
}

function clearIdFile() {
  idFile = null;
  if (idFileInput) idFileInput.value = '';
  if (idPreview) idPreview.innerHTML = PLACEHOLDER_HTML;
}

idUploadZone?.addEventListener('click', () => idFileInput?.click());
idUploadZone?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') idFileInput?.click(); });
idUploadZone?.addEventListener('dragover', (e) => { e.preventDefault(); idUploadZone.classList.add('id-upload-zone--drag'); });
idUploadZone?.addEventListener('dragleave', () => idUploadZone?.classList.remove('id-upload-zone--drag'));
idUploadZone?.addEventListener('drop', (e) => {
  e.preventDefault();
  idUploadZone.classList.remove('id-upload-zone--drag');
  if (e.dataTransfer.files[0]) setIdFile(e.dataTransfer.files[0]);
});
idFileInput?.addEventListener('change', () => { if (idFileInput.files[0]) setIdFile(idFileInput.files[0]); });

//  Cloudinary upload 

async function uploadIdToCloudinary(file) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', 'beealert_uploads');
  fd.append('folder', 'user_ids');
  const res = await fetch('https://api.cloudinary.com/v1_1/zq9gopfc/upload', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Upload failed: ' + res.statusText);
  return (await res.json()).secure_url;
}

//  Validation 

function validate() {
  let valid = true;

  const name = nameInput?.value.trim() ?? '';
  if (!name) { showErr(nameError, 'Full name is required.'); valid = false; }
  else clearErr(nameError);

  const email = emailInput?.value.trim() ?? '';
  if (!email) { showErr(emailError, 'Email address is required.'); valid = false; }
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr(emailError, 'Enter a valid email address.'); valid = false; }
  else clearErr(emailError);

  const phone = phoneInput?.value.trim() ?? '';
  const digits = phone.replace(/\D/g, '');
  if (!phone) { showErr(phoneError, 'Mobile number is required.'); valid = false; }
  else if (!((digits.length === 11 && digits.startsWith('09')) || (digits.length === 10 && digits.startsWith('9')))) {
    showErr(phoneError, 'Enter a valid PH number (09XXXXXXXXX).'); valid = false;
  } else clearErr(phoneError);

  const barangay = barangayInput?.value ?? '';
  if (!barangay) { showErr(barangayError, 'Please select your barangay.'); valid = false; }
  else clearErr(barangayError);

  const password = passwordInput?.value ?? '';
  if (!password) { showErr(passwordError, 'Password is required.'); valid = false; }
  else if (password.length < 6) { showErr(passwordError, 'Password must be at least 6 characters.'); valid = false; }
  else clearErr(passwordError);

  const confirm = confirmInput?.value ?? '';
  if (!confirm) { showErr(confirmError, 'Please confirm your password.'); valid = false; }
  else if (confirm !== password) { showErr(confirmError, 'Passwords do not match.'); valid = false; }
  else clearErr(confirmError);

  if (!idFile) { showErr(idError, 'Please upload a valid ID photo.'); valid = false; }

  return valid;
}

//  Title case 

function toTitleCase(str) {
  return str.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}

//  Register 

async function handleRegister(e) {
  e.preventDefault();
  clearAuthError();
  if (!validate()) return;

  setLoading(true);

  try {
    const name     = toTitleCase(nameInput.value.trim());
    const email    = emailInput.value.trim();
    const phone    = phoneInput.value.trim();
    const barangay = barangayInput.value;
    const password = passwordInput.value;

    // Upload ID photo first
    const idImageUrl = await uploadIdToCloudinary(idFile);

    // Create Firebase Auth account
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;

    // Save profile  role: 'official', status: 'pending'
    await setDoc(doc(db, 'users', uid), {
      uid,
      fullName:    name,
      displayName: name,
      email,
      phoneNumber: phone,
      barangay,
      role:        'official',
      status:      'pending',
      idImageUrl,
      createdAt:   serverTimestamp(),
    });

    // Admin notification
    await addDoc(collection(db, 'admin_notifications'), {
      type:  'new_signup',
      title: 'New Official Sign-Up: ' + name,
      body:  name + ' from Brgy. ' + barangay + ' has registered as a barangay official and is waiting for approval.',
      meta:  { userId: uid, residentName: name, barangay },
      read:  false,
      createdAt: serverTimestamp(),
    });

    // Sign out  must wait for admin approval
    await signOut(auth);

    form.reset();
    clearIdFile();
    showAuthSuccess('Account created! Your account is pending approval by the admin. You will be notified once approved.');
    setLoading(false);

    setTimeout(() => { window.location.href = '/index.html'; }, 4000);
  } catch (err) {
    console.error('[register]', err);
    showAuthError(errorMessage(err.code) ?? err.message ?? 'Registration failed. Please try again.');
    setLoading(false);
  }
}

//  Error messages 

function errorMessage(code) {
  const map = {
    'auth/email-already-in-use':   'An account with this email already exists.',
    'auth/invalid-email':          'Invalid email address format.',
    'auth/weak-password':          'Password is too weak. Use at least 6 characters.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code];
}

//  Redirect if already approved admin 

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const { getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'users', user.uid));
      const data = snap.data() ?? {};
      if (['admin', 'official'].includes(data.role) && data.status === 'approved') {
        window.location.href = '/admin.html';
      }
    } catch (_) {}
  }
});

//  Event listeners 

form?.addEventListener('submit', handleRegister);
nameInput?.addEventListener('input',      () => clearErr(nameError));
emailInput?.addEventListener('input',     () => clearErr(emailError));
phoneInput?.addEventListener('input',     () => clearErr(phoneError));
barangayInput?.addEventListener('change', () => clearErr(barangayError));
passwordInput?.addEventListener('input',  () => clearErr(passwordError));
confirmInput?.addEventListener('input',   () => clearErr(confirmError));

// ---------------------------------------------------------------------------
// Exported pure helpers (used by unit tests)
// ---------------------------------------------------------------------------

/**
 * Returns true if the password is at least 8 characters long.
 *
 * @param {string} password
 * @returns {boolean}
 */
export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

/**
 * Validate all registration fields and return an errors object.
 * Field names match what the unit tests pass:
 *   fullName, email, phoneNumber, barangay, password, confirmPassword
 *
 * @param {{ fullName?: string, email?: string, phoneNumber?: string, barangay?: string, password?: string, confirmPassword?: string }} data
 * @returns {{ valid: boolean, errors: Record<string, string> }}
 */
export function validateRegistrationForm(data) {
  const errors = {};

  // fullName
  if (!data.fullName || !data.fullName.trim()) {
    errors.fullName = 'Full name is required.';
  }

  // email
  const email = data.email ?? '';
  if (!email.trim()) {
    errors.email = 'Email address is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address.';
  }

  // phoneNumber (PH format: 09XXXXXXXXX or 9XXXXXXXXX)
  const phone  = data.phoneNumber ?? '';
  const digits = phone.replace(/\D/g, '');
  if (!phone.trim()) {
    errors.phoneNumber = 'Mobile number is required.';
  } else if (!((digits.length === 11 && digits.startsWith('09')) || (digits.length === 10 && digits.startsWith('9')))) {
    errors.phoneNumber = 'Enter a valid PH number (09XXXXXXXXX).';
  }

  // barangay
  if (!data.barangay || !data.barangay.trim()) {
    errors.barangay = 'Please select your barangay.';
  }

  // password — must be valid before checking confirmPassword
  const pw = data.password ?? '';
  if (!pw) {
    errors.password = 'Password is required.';
  } else if (!validatePassword(pw)) {
    errors.password = 'Password must be at least 8 characters.';
  } else {
    // Only validate confirmPassword when password itself is valid
    if (!data.confirmPassword) {
      errors.confirmPassword = 'Please confirm your password.';
    } else if (data.confirmPassword !== pw) {
      errors.confirmPassword = 'Passwords do not match.';
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Returns a password strength label based on length and character variety.
 * Returns '' for passwords shorter than 8 characters.
 *
 * @param {string} password
 * @returns {'' | 'weak' | 'medium' | 'strong'}
 */
export function getPasswordStrength(password) {
  if (!password || password.length < 8) return '';
  const hasUpper   = /[A-Z]/.test(password);
  const hasLower   = /[a-z]/.test(password);
  const hasDigit   = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const variety    = [hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean).length;
  // 'strong' requires special char + at least 3 other varieties, length >= 10
  if (password.length >= 10 && hasSpecial && variety >= 3) return 'strong';
  // 'medium' requires at least 2 varieties, length >= 8
  if (variety >= 2) return 'medium';
  return 'weak';
}
