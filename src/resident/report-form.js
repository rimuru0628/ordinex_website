/**
 * Report submission form module — `src/resident/report-form.js`
 *
 * Lazy-loaded by `resident/app.js` when the "Submit Report" tab is activated.
 * Renders the form into the given container and wires up all interactivity.
 *
 * Exports:
 *   init(container, uid)         main entry point called by app.js
 *   validateReportForm(data)     pure validation function (also used by tests)
 *   validateImageFile(file)      pure file size validation (also used by tests)
 */

import { db, storage } from '../shared/firebase.js';
import {
  addDoc,
  collection,
  serverTimestamp,
  getDoc,
  doc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { showToast } from '../shared/ui-helpers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/** The five predefined report categories — must match admin concern-table categories. */
const CATEGORIES = [
  'Health',
  'Transportation',
  'Environment',
  'Consumer Issue',
  'Others',
];

// ---------------------------------------------------------------------------
// Pure exported helpers
// ---------------------------------------------------------------------------

/**
 * Validates report form data before submission.
 *
 * @param {{ description?: string, category?: string }} data
 * @returns {{ valid: boolean, errors: { description?: string, category?: string } }}
 */
export function validateReportForm(data) {
  const errors = {};

  if (!data.description || !data.description.trim()) {
    errors.description = 'Description is required.';
  }

  if (!data.category || !data.category.trim()) {
    errors.category = 'Please select a category.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Validates an image file for upload — rejects files larger than 5 MB.
 *
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateImageFile(file) {
  if (file.size > MAX_IMAGE_BYTES) {
    return { valid: false, error: 'Image must be 5 MB or smaller.' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// User profile cache
// ---------------------------------------------------------------------------

/** @type {{ residentName: string, barangay: string } | null} */
let cachedUserProfile = null;

async function getUserProfile(uid) {
  if (cachedUserProfile) return cachedUserProfile;

  const snap = await getDoc(doc(db, 'users', uid));
  const data = snap.data() ?? {};

  cachedUserProfile = {
    residentName: data.fullName ?? data.displayName ?? '',
    barangay:     data.barangay ?? '',
  };

  return cachedUserProfile;
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function buildFormHTML() {
  const categoryOptions = CATEGORIES.map(
    (cat) => `<option value="${cat}">${cat}</option>`
  ).join('\n          ');

  return `
    <form id="report-form" novalidate>
      <h2 class="section-title">Submit a Report</h2>

      <!-- Description -->
      <div class="form-group">
        <label for="report-description">Description <span aria-hidden="true">*</span></label>
        <textarea
          id="report-description"
          name="description"
          rows="4"
          placeholder="Describe the issue in detail"
          aria-describedby="desc-error"
          aria-required="true"
        ></textarea>
        <span id="desc-error" class="field-error" aria-live="polite"></span>
      </div>

      <!-- Category -->
      <div class="form-group">
        <label for="report-category">Category <span aria-hidden="true">*</span></label>
        <select
          id="report-category"
          name="category"
          aria-describedby="cat-error"
          aria-required="true"
        >
          <option value="">-- Select a category --</option>
          ${categoryOptions}
        </select>
        <span id="cat-error" class="field-error" aria-live="polite"></span>
      </div>

      <!-- Image upload -->
      <div class="form-group">
        <label for="report-image">Attach Image (optional)</label>
        <input
          type="file"
          id="report-image"
          name="image"
          accept="image/*"
          aria-describedby="image-error"
        />
        <span id="image-error" class="field-error" aria-live="polite"></span>
      </div>

      <!-- GPS capture -->
      <div class="form-group">
        <label>Location (optional)</label>
        <button type="button" id="gps-btn" class="btn btn--secondary">
          &#x1F4CD; Capture GPS Location
        </button>
        <span id="gps-display" class="gps-display">Location not captured</span>

        <input type="hidden" id="report-lat" name="lat" />
        <input type="hidden" id="report-lng" name="lng" />
      </div>

      <!-- Submit -->
      <div class="form-actions">
        <button type="submit" id="submit-report-btn" class="btn btn--primary">
          Submit Report
        </button>
      </div>
    </form>
  `;
}

// ---------------------------------------------------------------------------
// GPS logic
// ---------------------------------------------------------------------------

function setupGPS() {
  const gpsBtn    = document.getElementById('gps-btn');
  const gpsDisplay = document.getElementById('gps-display');
  const latInput  = document.getElementById('report-lat');
  const lngInput  = document.getElementById('report-lng');

  if (!gpsBtn) return;

  gpsBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      gpsDisplay.textContent = 'Geolocation is not supported by your browser. Please enter manually.';
      showManualEntryInputs(latInput, lngInput);
      return;
    }

    gpsDisplay.textContent = 'Capturing location\u2026';
    gpsBtn.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lng = position.coords.longitude.toFixed(6);
        latInput.value = lat;
        lngInput.value = lng;
        gpsDisplay.textContent = `Lat: ${lat}, Lng: ${lng}`;
        gpsBtn.disabled = false;
      },
      (_err) => {
        gpsDisplay.textContent = 'Unable to retrieve location. You may enter it manually below.';
        showManualEntryInputs(latInput, lngInput);
        gpsBtn.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

function showManualEntryInputs(latInput, lngInput) {
  [
    { el: latInput, placeholder: 'Latitude (e.g. 16.1234)' },
    { el: lngInput, placeholder: 'Longitude (e.g. 120.5678)' },
  ].forEach(({ el, placeholder }) => {
    if (el && el.type === 'hidden') {
      el.type = 'text';
      el.placeholder = placeholder;
      el.className = 'manual-gps-input';
      el.style.display = 'block';
    }
  });
}

// ---------------------------------------------------------------------------
// Image validation
// ---------------------------------------------------------------------------

function setupImageValidation() {
  const imageInput = document.getElementById('report-image');
  const imageError = document.getElementById('image-error');

  if (!imageInput) return;

  imageInput.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    if (!file) { imageError.textContent = ''; return; }
    const result = validateImageFile(file);
    if (!result.valid) {
      imageError.textContent = result.error;
      imageInput.value = '';
    } else {
      imageError.textContent = '';
    }
  });
}

// ---------------------------------------------------------------------------
// Form submission
// ---------------------------------------------------------------------------

async function handleSubmit(event, uid) {
  event.preventDefault();

  const descInput = document.getElementById('report-description');
  const catSelect = document.getElementById('report-category');
  const imageInput = document.getElementById('report-image');
  const submitBtn  = document.getElementById('submit-report-btn');
  const descError  = document.getElementById('desc-error');
  const catError   = document.getElementById('cat-error');
  const latInput   = document.getElementById('report-lat');
  const lngInput   = document.getElementById('report-lng');
  const gpsDisplay = document.getElementById('gps-display');

  const description = descInput?.value ?? '';
  const category    = catSelect?.value ?? '';

  const { valid, errors } = validateReportForm({ description, category });

  descError.textContent = errors.description ?? '';
  catError.textContent  = errors.category    ?? '';

  if (!valid) return;

  submitBtn.disabled    = true;
  submitBtn.textContent = 'Submitting\u2026';

  try {
    // Optional image upload to Firebase Storage
    let imageUrl = null;
    const file = imageInput?.files?.[0];

    if (file) {
      const timestamp  = Date.now();
      const storageRef = ref(storage, `reports/${uid}/${timestamp}_${file.name}`);
      const snapshot   = await uploadBytes(storageRef, file);
      imageUrl         = await getDownloadURL(snapshot.ref);
    }

    // Fetch resident profile
    const { residentName, barangay } = await getUserProfile(uid);

    // GPS coordinates
    const lat = latInput?.value ? parseFloat(latInput.value) : null;
    const lng = lngInput?.value ? parseFloat(lngInput.value) : null;

    // Generate a human-readable reference number
    const reportReference = 'RPT-' + Date.now().toString(36).toUpperCase();

    await addDoc(collection(db, 'reports'), {
      residentId:      uid,
      userId:          uid,
      userName:        residentName,
      residentName,
      barangay,
      category,
      description:     description.trim(),
      imageUrl:        imageUrl ?? null,
      latitude:        lat,
      longitude:       lng,
      location:        (lat != null && lng != null) ? `${lat}, ${lng}` : '',
      reportReference,
      status:          'Pending',
      submittedAt:     serverTimestamp(),
      updatedAt:       serverTimestamp(),
    });

    // Notify admin of new report
    try {
      await addDoc(collection(db, 'admin_notifications'), {
        type:  'new_report',
        title: `New Report: ${category}`,
        body:  `${residentName} submitted a new ${category} report. Ref: ${reportReference}`,
        meta:  { reportRef: reportReference, residentName, barangay },
        read:  false,
        createdAt: serverTimestamp(),
      });
    } catch { /* non-critical */ }

    showToast('Report submitted successfully!', 'success');
    resetForm(gpsDisplay, latInput, lngInput);
    descInput.value = '';
    catSelect.value = '';
    if (imageInput) imageInput.value = '';
  } catch (err) {
    console.error('[report-form] Submission error:', err);
    showToast('Failed to submit report. Please try again.', 'error');
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Submit Report';
  }
}

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------

function resetForm(gpsDisplay, latInput, lngInput) {
  if (gpsDisplay) gpsDisplay.textContent = 'Location not captured';

  [latInput, lngInput].forEach((el) => {
    if (!el) return;
    el.value = '';
    if (el.type === 'text') {
      el.type = 'hidden';
      el.placeholder = '';
      el.className = '';
      el.style.display = '';
    }
  });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function init(container, uid) {
  if (!container) return;

  // Reset profile cache on each fresh init
  cachedUserProfile = null;

  container.innerHTML = buildFormHTML();

  setupGPS();
  setupImageValidation();

  const form = document.getElementById('report-form');
  if (form) {
    form.addEventListener('submit', (e) => handleSubmit(e, uid));
  }
}
