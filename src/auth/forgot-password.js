/**
 * Forgot Password  Firebase sendPasswordResetEmail.
 * Firebase sends the reset link email automatically.
 */

import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../shared/firebase.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const resetForm           = document.getElementById('reset-form');
const resetFormWrapper    = document.getElementById('reset-form-wrapper');
const resetSuccessWrapper = document.getElementById('reset-success-wrapper');
const resetSuccessMsg     = document.getElementById('reset-success-msg');
const emailInput          = document.getElementById('email-input');
const emailError          = document.getElementById('email-error');
const resetError          = document.getElementById('reset-error');
const resetBtn            = document.getElementById('reset-btn');
const resendBtn           = document.getElementById('resend-btn');

let lastEmail = '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showFieldError(el, msg) { if (!el) return; el.textContent = msg; el.hidden = false; }
function clearFieldError(el)     { if (!el) return; el.textContent = ''; el.hidden = true; }
function showResetError(msg)     { if (!resetError) return; resetError.textContent = msg; resetError.hidden = false; }
function clearResetError()       { if (!resetError) return; resetError.textContent = ''; resetError.hidden = true; }

function setLoading(btn, loading, label) {
  btn.disabled = loading;
  btn.textContent = loading ? 'Sending' : label;
}

// ---------------------------------------------------------------------------
// Send reset email
// ---------------------------------------------------------------------------

async function sendReset(email) {
  await sendPasswordResetEmail(auth, email, {
    url: window.location.origin + '/index.html',
  });
}

// ---------------------------------------------------------------------------
// Submit handler
// ---------------------------------------------------------------------------

async function handleReset(e) {
  e.preventDefault();
  clearResetError();
  clearFieldError(emailError);

  const email = emailInput?.value?.trim() ?? '';

  if (!email) {
    showFieldError(emailError, 'Please enter your email address.');
    emailInput?.focus();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFieldError(emailError, 'Please enter a valid email address.');
    emailInput?.focus();
    return;
  }

  setLoading(resetBtn, true, 'Send Reset Link');

  try {
    await sendReset(email);
    lastEmail = email;
    resetFormWrapper.hidden = true;
    resetSuccessWrapper.hidden = false;
    if (resetSuccessMsg) {
      resetSuccessMsg.textContent =
        `A password reset link has been sent to ${email}. Check your inbox and click the link to set a new password.`;
    }
  } catch (err) {
    console.error('[forgot-password] error:', err);
    showResetError(errorMessage(err.code));
    setLoading(resetBtn, false, 'Send Reset Link');
  }
}

// ---------------------------------------------------------------------------
// Resend handler
// ---------------------------------------------------------------------------

async function handleResend() {
  if (!lastEmail) return;
  setLoading(resendBtn, true, 'Resend Email');
  try {
    await sendReset(lastEmail);
    resendBtn.textContent = 'Sent!';
    setTimeout(() => { resendBtn.disabled = false; resendBtn.textContent = 'Resend Email'; }, 3000);
  } catch (err) {
    console.error('[forgot-password] resend error:', err);
    resendBtn.disabled = false;
    resendBtn.textContent = 'Resend Email';
    resetSuccessWrapper.hidden = true;
    resetFormWrapper.hidden = false;
    showResetError(errorMessage(err.code));
  }
}

// ---------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------

function errorMessage(code) {
  const map = {
    'auth/invalid-email':          'Invalid email address format.',
    'auth/user-not-found':         'No account found with that email.',
    'auth/too-many-requests':      'Too many requests. Please wait before trying again.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code] ?? 'Failed to send reset email. Please try again.';
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

resetForm?.addEventListener('submit', handleReset);
resendBtn?.addEventListener('click', handleResend);
emailInput?.addEventListener('input', () => { clearFieldError(emailError); clearResetError(); });
