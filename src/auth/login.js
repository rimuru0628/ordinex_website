/**
 * Admin login — Firebase Email + Password Auth.
 */

import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../shared/firebase.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const loginForm     = document.getElementById('login-form');
const emailInput    = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const loginBtn      = document.getElementById('login-btn');
const authError     = document.getElementById('auth-error');
const emailError    = document.getElementById('email-error');
const passwordError = document.getElementById('password-error');
const togglePwdBtn  = document.getElementById('toggle-password');
const eyeShow       = document.getElementById('eye-show');
const eyeHide       = document.getElementById('eye-hide');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showError(el, msg) { if (!el) return; el.textContent = msg; el.hidden = false; }
function clearError(el)     { if (!el) return; el.textContent = ''; el.hidden = true; }

function showAuthError(msg) { if (!authError) return; authError.textContent = msg; authError.hidden = false; }
function clearAuthError()   { if (!authError) return; authError.textContent = ''; authError.hidden = true; }

function setLoading(loading) {
  if (!loginBtn) return;
  loginBtn.disabled = loading;
  loginBtn.textContent = loading ? 'Signing in…' : 'Sign In';
}

// ---------------------------------------------------------------------------
// Show / hide password toggle
// ---------------------------------------------------------------------------

togglePwdBtn?.addEventListener('click', () => {
  const isPassword = passwordInput.type === 'password';
  // Toggle: if currently password → show it (text); if text → hide it (password)
  passwordInput.type = isPassword ? 'text' : 'password';
  togglePwdBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
  // When password is visible: hide the eye-open icon, show the eye-closed icon
  eyeShow.style.display = isPassword ? 'none' : '';
  eyeHide.style.display = isPassword ? '' : 'none';
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate() {
  let valid = true;

  const email = emailInput?.value?.trim() ?? '';
  if (!email) {
    showError(emailError, 'Please enter your email address.');
    emailInput?.focus();
    valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError(emailError, 'Please enter a valid email address.');
    emailInput?.focus();
    valid = false;
  } else {
    clearError(emailError);
  }

  const password = passwordInput?.value ?? '';
  if (!password) {
    showError(passwordError, 'Please enter your password.');
    if (valid) passwordInput?.focus();
    valid = false;
  } else {
    clearError(passwordError);
  }

  return valid;
}

// ---------------------------------------------------------------------------
// Role check — only 'admin' or 'official' roles can access the admin panel
// ---------------------------------------------------------------------------

const ALLOWED_ROLES = ['admin', 'official'];

async function isAdminUser(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return false;
    const role = snap.data()?.role ?? '';
    return ALLOWED_ROLES.includes(role);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

async function handleLogin(e) {
  e.preventDefault();
  clearAuthError();

  if (!validate()) return;

  setLoading(true);

  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      emailInput.value.trim(),
      passwordInput.value,
    );

    // Check role before allowing access
    const allowed = await isAdminUser(credential.user.uid);
    if (!allowed) {
      // Sign them back out immediately and show an error
      await signOut(auth);
      showAuthError('Access denied. This portal is for authorized officials only.');
      setLoading(false);
      return;
    }

    // Role is valid — onAuthStateChanged will redirect
  } catch (err) {
    console.error('[login] error code:', err.code);
    console.error('[login] error message:', err.message);
    showAuthError(errorMessage(err.code) + ' (code: ' + err.code + ')');
    setLoading(false);
  }
}

// ---------------------------------------------------------------------------
// Auth state — redirect to admin if already signed in
// ---------------------------------------------------------------------------

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const allowed = await isAdminUser(user.uid);
    if (allowed) {
      window.location.href = '/admin.html';
    } else {
      // Resident somehow on this page — sign out silently
      await signOut(auth);
    }
  }
});

// ---------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------

function errorMessage(code) {
  const map = {
    'auth/invalid-email':          'Invalid email address format.',
    'auth/user-not-found':         'No account found with this email.',
    'auth/wrong-password':         'Incorrect password. Please try again.',
    'auth/invalid-credential':     'Incorrect email or password. Please try again.',
    'auth/too-many-requests':      'Too many failed attempts. Please wait and try again.',
    'auth/user-disabled':          'This account has been disabled.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code] ?? 'Sign in failed. Please check your credentials.';
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

loginForm?.addEventListener('submit', handleLogin);
emailInput?.addEventListener('input',   () => { clearError(emailError);   clearAuthError(); });
passwordInput?.addEventListener('input', () => { clearError(passwordError); clearAuthError(); });
