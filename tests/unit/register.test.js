/**
 * Unit tests for src/auth/register.js
 *
 * Covers the exported pure functions:
 *   - validatePassword
 *   - validateRegistrationForm
 *   - getPasswordStrength
 *
 * Requirements: 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { describe, it, expect, vi } from 'vitest';

// Mock Firebase modules so tests can import register.js without real credentials
vi.mock('../../src/shared/firebase.js', () => ({
  auth: {},
  db: {},
  storage: {},
  default: {},
}));
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  addDoc: vi.fn(),
  collection: vi.fn(),
  serverTimestamp: vi.fn(),
}));

import {
  validatePassword,
  validateRegistrationForm,
  getPasswordStrength,
} from '../../src/auth/register.js';

// ---------------------------------------------------------------------------
// validatePassword
// ---------------------------------------------------------------------------

describe('validatePassword', () => {
  it('returns true for a password with exactly 8 characters', () => {
    expect(validatePassword('abcdefgh')).toBe(true);
  });

  it('returns true for a password longer than 8 characters', () => {
    expect(validatePassword('supersecretpassword')).toBe(true);
  });

  it('returns false for a password shorter than 8 characters', () => {
    expect(validatePassword('abc')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(validatePassword('')).toBe(false);
  });

  it('returns false for a 7-character password (boundary)', () => {
    expect(validatePassword('1234567')).toBe(false);
  });

  it('returns true for an 8-character password (boundary)', () => {
    expect(validatePassword('12345678')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fully valid registration data object. */
function validData(overrides = {}) {
  return {
    fullName: 'Juan dela Cruz',
    email: 'juan@example.com',
    phoneNumber: '09171234567',
    barangay: 'Poblacion',
    password: 'securePass1',
    confirmPassword: 'securePass1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateRegistrationForm — valid data
// ---------------------------------------------------------------------------

describe('validateRegistrationForm — valid input', () => {
  it('returns valid:true and no errors for fully correct data', () => {
    const result = validateRegistrationForm(validData());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// validateRegistrationForm — individual field errors (Requirement 2.5)
// ---------------------------------------------------------------------------

describe('validateRegistrationForm — required fields', () => {
  it('reports an error for empty fullName', () => {
    const { errors, valid } = validateRegistrationForm(validData({ fullName: '' }));
    expect(valid).toBe(false);
    expect(errors.fullName).toBeTruthy();
  });

  it('reports an error for whitespace-only fullName', () => {
    const { errors, valid } = validateRegistrationForm(validData({ fullName: '   ' }));
    expect(valid).toBe(false);
    expect(errors.fullName).toBeTruthy();
  });

  it('reports an error for empty phoneNumber', () => {
    const { errors, valid } = validateRegistrationForm(validData({ phoneNumber: '' }));
    expect(valid).toBe(false);
    expect(errors.phoneNumber).toBeTruthy();
  });

  it('reports an error for empty barangay', () => {
    const { errors, valid } = validateRegistrationForm(validData({ barangay: '' }));
    expect(valid).toBe(false);
    expect(errors.barangay).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// validateRegistrationForm — email validation (Requirement 2.2)
// ---------------------------------------------------------------------------

describe('validateRegistrationForm — email field', () => {
  it('reports an error for empty email', () => {
    const { errors, valid } = validateRegistrationForm(validData({ email: '' }));
    expect(valid).toBe(false);
    expect(errors.email).toBeTruthy();
  });

  it('reports an error for an email without @', () => {
    const { errors, valid } = validateRegistrationForm(validData({ email: 'notanemail' }));
    expect(valid).toBe(false);
    expect(errors.email).toBeTruthy();
  });

  it('reports an error for an email without a domain', () => {
    const { errors, valid } = validateRegistrationForm(validData({ email: 'user@' }));
    expect(valid).toBe(false);
    expect(errors.email).toBeTruthy();
  });

  it('accepts a valid email with subdomain', () => {
    const { errors, valid } = validateRegistrationForm(
      validData({ email: 'user@mail.example.com' })
    );
    expect(valid).toBe(true);
    expect(errors.email).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateRegistrationForm — password validation (Requirements 2.4)
// ---------------------------------------------------------------------------

describe('validateRegistrationForm — password length', () => {
  it('reports an error for empty password', () => {
    const { errors, valid } = validateRegistrationForm(
      validData({ password: '', confirmPassword: '' })
    );
    expect(valid).toBe(false);
    expect(errors.password).toBeTruthy();
  });

  it('reports an error for a 7-character password', () => {
    const { errors, valid } = validateRegistrationForm(
      validData({ password: '1234567', confirmPassword: '1234567' })
    );
    expect(valid).toBe(false);
    expect(errors.password).toBeTruthy();
  });

  it('accepts an 8-character password (boundary)', () => {
    const { errors, valid } = validateRegistrationForm(
      validData({ password: '12345678', confirmPassword: '12345678' })
    );
    expect(valid).toBe(true);
    expect(errors.password).toBeUndefined();
  });

  it('accepts a password longer than 8 characters', () => {
    const { errors, valid } = validateRegistrationForm(
      validData({ password: 'strongP@ssword99', confirmPassword: 'strongP@ssword99' })
    );
    expect(valid).toBe(true);
    expect(errors.password).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateRegistrationForm — confirmPassword matching
// ---------------------------------------------------------------------------

describe('validateRegistrationForm — password confirmation', () => {
  it('reports an error when confirmPassword does not match password', () => {
    const { errors, valid } = validateRegistrationForm(
      validData({ password: 'validPass1', confirmPassword: 'different1' })
    );
    expect(valid).toBe(false);
    expect(errors.confirmPassword).toBeTruthy();
  });

  it('reports an error when confirmPassword is empty and password is valid', () => {
    const { errors, valid } = validateRegistrationForm(
      validData({ password: 'validPass1', confirmPassword: '' })
    );
    expect(valid).toBe(false);
    expect(errors.confirmPassword).toBeTruthy();
  });

  it('does not report a confirmPassword error when passwords match', () => {
    const { errors } = validateRegistrationForm(
      validData({ password: 'validPass1', confirmPassword: 'validPass1' })
    );
    expect(errors.confirmPassword).toBeUndefined();
  });

  it('does not report a confirmPassword error when password itself is invalid', () => {
    // confirmPassword mismatch is not relevant when password is already invalid
    const { errors } = validateRegistrationForm(
      validData({ password: 'short', confirmPassword: 'nomatch' })
    );
    // password error is present; confirmPassword error should NOT be set to avoid double-report
    expect(errors.password).toBeTruthy();
    expect(errors.confirmPassword).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateRegistrationForm — multiple errors at once (Requirement 2.5)
// ---------------------------------------------------------------------------

describe('validateRegistrationForm — multiple simultaneous errors', () => {
  it('reports errors for all empty fields', () => {
    const { valid, errors } = validateRegistrationForm({
      fullName: '',
      email: '',
      phoneNumber: '',
      barangay: '',
      password: '',
      confirmPassword: '',
    });
    expect(valid).toBe(false);
    expect(errors.fullName).toBeTruthy();
    expect(errors.email).toBeTruthy();
    expect(errors.phoneNumber).toBeTruthy();
    expect(errors.barangay).toBeTruthy();
    expect(errors.password).toBeTruthy();
  });

  it('returns only relevant errors — valid fields are not included', () => {
    const { errors } = validateRegistrationForm(validData({ barangay: '' }));
    expect(errors.barangay).toBeTruthy();
    expect(errors.fullName).toBeUndefined();
    expect(errors.email).toBeUndefined();
    expect(errors.password).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getPasswordStrength
// ---------------------------------------------------------------------------

describe('getPasswordStrength', () => {
  it('returns "" for empty string', () => {
    expect(getPasswordStrength('')).toBe('');
  });

  it('returns "" for password shorter than 8 characters', () => {
    expect(getPasswordStrength('Abc1!')).toBe('');
  });

  it('returns "" for exactly 7 characters even with mixed chars', () => {
    expect(getPasswordStrength('Abc1!xy')).toBe('');
  });

  it('returns "weak" for 8-char lowercase-only password', () => {
    expect(getPasswordStrength('abcdefgh')).toBe('weak');
  });

  it('returns "weak" for 11-char password with no uppercase/digit/special mix', () => {
    expect(getPasswordStrength('abcdefghijk')).toBe('weak');
  });

  it('returns "medium" for 8-char password with uppercase and digit', () => {
    expect(getPasswordStrength('Abcdef1g')).toBe('medium');
  });

  it('returns "medium" for 8-char password with uppercase and special char', () => {
    expect(getPasswordStrength('Abcdef!g')).toBe('medium');
  });

  it('returns "medium" for 11-char password with uppercase and digit', () => {
    expect(getPasswordStrength('Abcdefghi1j')).toBe('medium');
  });

  it('returns "strong" for 12-char password with uppercase, digit, and special char', () => {
    expect(getPasswordStrength('Abcdefghij1!')).toBe('strong');
  });

  it('returns "strong" for long password with all required character types', () => {
    expect(getPasswordStrength('SuperSecure99!!')).toBe('strong');
  });

  it('returns "medium" (not strong) for 12-char with uppercase + digit but no special', () => {
    expect(getPasswordStrength('Abcdefghij12')).toBe('medium');
  });
});
