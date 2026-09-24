/**
 * Firebase Auth guard for protected pages.
 * Redirects to /index.html if the user is not signed in or not an admin/official.
 */

import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';

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

/**
 * Protects the admin page — redirects to login if not signed in or not an admin.
 * Returns a promise that resolves with the Firebase user when authenticated.
 */
export function authGuard() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = '/index.html';
        return;
      }
      const allowed = await isAdminUser(user.uid);
      if (!allowed) {
        // Resident trying to access admin panel — boot them back to login
        await signOut(auth);
        window.location.href = '/index.html';
        return;
      }
      resolve(user);
    });
  });
}

/**
 * For the login page — redirects to admin dashboard if already signed in as admin.
 */
export function authGuardLogin() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const allowed = await isAdminUser(user.uid);
      if (allowed) {
        window.location.href = '/admin.html';
      } else {
        await signOut(auth);
      }
    }
  });
}

/**
 * Sign out helper.
 */
export function clearSession() {
  return auth.signOut();
}
