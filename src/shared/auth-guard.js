/**
 * Firebase Auth guard for protected pages.
 * Supports both legacy  { role: 'admin' }  and new  { roles: ['admin', 'official'] }  schemas.
 *
 * authGuard()            — protects the admin page
 * authGuard('resident')  — protects the resident page
 * authGuardLogin()       — redirects to admin.html if already signed in as admin
 */

import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';

const ADMIN_ROLES = ['admin', 'official'];

async function getUserDoc(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    return snap.data() ?? {};
  } catch {
    return null;
  }
}

/**
 * Returns the effective roles array regardless of whether the doc stores
 * a legacy string `role` field or the new array `roles` field.
 *
 * @param {object} data  Firestore user document data
 * @returns {string[]}
 */
export function getRoles(data) {
  if (Array.isArray(data.roles) && data.roles.length > 0) {
    console.log('[auth-guard] getRoles → using roles array:', data.roles);
    return data.roles;
  }
  if (typeof data.role === 'string' && data.role) {
    console.log('[auth-guard] getRoles → using legacy role string:', data.role);
    return [data.role];
  }
  console.log('[auth-guard] getRoles → no role found, data keys:', Object.keys(data));
  return [];
}

/**
 * Returns true if the user has the given role (works with both schemas).
 */
export function hasRole(data, role) {
  return getRoles(data).includes(role);
}

/**
 * Returns true if the user has any admin-level role.
 */
export function isAdminOrOfficial(data) {
  return getRoles(data).some(r => ADMIN_ROLES.includes(r));
}

function isBannedNow(data) {
  if (!data.bannedUntil) return false;
  const until = typeof data.bannedUntil.toDate === 'function'
    ? data.bannedUntil.toDate()
    : new Date(data.bannedUntil);
  return until > new Date();
}

/**
 * Protects the admin page — redirects to /index.html if:
 *   - Not signed in
 *   - Has no admin|official role
 *   - Status is 'pending' or 'rejected'
 *
 * When called as authGuard('resident') it instead protects the resident page.
 * Returns a promise that resolves with the Firebase user when authenticated.
 */
export function authGuard(pageRole = 'admin') {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = '/index.html';
        return;
      }

      const data = await getUserDoc(user.uid);
      if (!data) {
        await signOut(auth);
        window.location.href = '/index.html';
        return;
      }

      const status = data.status ?? 'approved';

      if (pageRole === 'resident') {
        // Resident guard: must have role 'resident', not admin
        if (!hasRole(data, 'resident')) {
          // Admin/official accidentally on resident page — send to admin portal
          if (isAdminOrOfficial(data) && status !== 'pending' && status !== 'rejected') {
            window.location.href = '/admin.html';
          } else {
            await signOut(auth);
            window.location.href = '/index.html';
          }
          return;
        }
        if (status === 'pending' || status === 'rejected') {
          await signOut(auth);
          window.location.href = '/index.html';
          return;
        }
        if (isBannedNow(data)) {
          await signOut(auth);
          window.location.href = '/index.html';
          return;
        }
        resolve(user);
      } else {
        // Admin guard: must have at least one admin-level role
        if (!isAdminOrOfficial(data)) {
          await signOut(auth);
          window.location.href = '/index.html';
          return;
        }
        if (status === 'pending' || status === 'rejected') {
          await signOut(auth);
          window.location.href = '/index.html';
          return;
        }
        resolve(user);
      }
    });
  });
}

/**
 * For the login page — redirects to admin dashboard if already signed in.
 */
export function authGuardLogin() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    const data = await getUserDoc(user.uid);
    if (!data) { await signOut(auth); return; }
    const status = data.status ?? 'approved';
    if (isAdminOrOfficial(data) && status !== 'pending' && status !== 'rejected') {
      window.location.href = '/admin.html';
    } else {
      await signOut(auth);
    }
  });
}

/**
 * Sign out helper.
 */
export function clearSession() {
  return auth.signOut();
}
