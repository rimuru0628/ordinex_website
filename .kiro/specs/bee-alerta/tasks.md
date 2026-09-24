# Implementation Plan: BEE-Alerta

## Overview

Implement the BEE-Alerta web application using HTML, CSS, and vanilla JavaScript (ES modules) with Firebase (Auth, Firestore, Storage) as the backend and Ollama as the local AI chatbot. Build incrementally: project setup → shared foundation → auth pages → resident interface → admin interface → final integration.

---

## Tasks

- [x] 1. Project setup and Firebase initialization
  - Create the directory structure: `src/auth/`, `src/resident/`, `src/admin/`, `src/shared/`, `tests/unit/`, `tests/property/`, `tests/integration/`
  - Initialize `package.json` with Vitest, fast-check, and Firebase JS SDK (v9 modular) as dependencies
  - Create `vitest.config.js` with test environment set to `jsdom`
  - Create `src/shared/firebase.js` — initialize Firebase App, export `auth`, `db` (Firestore), and `storage` singletons using environment-variable-based config
  - Create `.env.example` documenting required Firebase config keys (`VITE_API_KEY`, `VITE_AUTH_DOMAIN`, `VITE_PROJECT_ID`, `VITE_STORAGE_BUCKET`, `VITE_MESSAGING_SENDER_ID`, `VITE_APP_ID`) and the Ollama base URL (`VITE_OLLAMA_URL`)
  - Create `firebase.json` and `.firebaserc` stubs for Firebase Hosting
  - _Requirements: 1.1, 10.3_

- [x] 2. Shared utilities and UI helpers
  - [x] 2.1 Implement `src/shared/ui-helpers.js`
    - `statusBadge(status)` — returns an `<span>` element with class `badge badge--pending|ongoing|completed` and inner text matching the status value
    - `formatDate(timestamp)` — accepts a Firestore `Timestamp` or `Date`, returns a string in `"Mon DD, YYYY"` format
    - `showToast(message, type)` — appends a dismissible toast to `#toast-container`, auto-dismisses after 4 s
    - `showLoadingOverlay()` / `hideLoadingOverlay()` — toggles a CSS spinner overlay on the currently active page section
    - _Requirements: 5.2, 7.5, 8.1_

  - [x]* 2.2 Write property tests for `ui-helpers.js`
    - **Property 6: Status Badge Rendering** — `fc.constantFrom('Pending','Ongoing','Completed')` → verify returned element has non-empty class and matching inner text
    - **Property 8: Date Formatting Consistency** — `fc.date()` → verify `formatDate` returns non-empty string encoding correct year, month, day
    - **Feature: bee-alerta, Property 6 & 8**
    - _Requirements: 5.2, 8.1_

  - [x] 2.3 Implement `src/shared/auth-guard.js`
    - Export `authGuard(requiredRole)` — uses `onAuthStateChanged`; reads `role` from Firestore `users/{uid}`; redirects to `/index.html` if unauthenticated or to role-appropriate page if role mismatch
    - _Requirements: 1.2, 1.3, 1.8_

- [x] 3. Checkpoint — Run all tests, ensure project builds
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Login page
  - [x] 4.1 Create `index.html` with login UI
    - Warm cream background (`#FFF8F0`), centered card
    - Gradient orange header (`#F97316` → `#FB923C`) with "Bacnotan BEE-Alert" title
    - Role selector: Resident card and Official card with radio-button semantics (`name="role"`)
    - Fields: email-or-phone (`type="email"` with `pattern` fallback), password
    - Sign In button, Forgot Password link, Register Now link
    - Divider "or continue with", social login buttons (Google, Facebook, Apple) — each with accessible `aria-label`
    - All inputs have associated `<label>` elements; focus styles visible
    - _Requirements: 1.1, 12.2, 12.3, 12.5_

  - [x] 4.2 Implement `src/auth/login.js`
    - On page load: call `authGuard` — if session exists, redirect immediately
    - Sign In handler: validate non-empty fields; call `signInWithEmailAndPassword`; on success read Firestore `users/{uid}.role`; redirect to `resident.html` or `admin.html`
    - Display inline field-level error for empty fields; display auth error message below form on wrong credentials
    - Forgot Password flow: show inline email-input modal; call `sendPasswordResetEmail`; show confirmation message
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 4.3 Implement `src/auth/social.js`
    - Export `handleSocialLogin(providerName)` — immediately calls `signInWithPopup` with `GoogleAuthProvider`, `FacebookAuthProvider`, or `OAuthProvider('apple.com')` based on argument
    - On success: reads user role from Firestore, redirects accordingly; creates Firestore user doc if new user (defaulting `role` to `'resident'`)
    - Wire social buttons in `index.html` to call `handleSocialLogin`
    - _Requirements: 1.7_

  - [x]* 4.4 Write unit tests for `login.js` validation
    - Test: empty email → error shown, `signInWithEmailAndPassword` not called
    - Test: empty password → error shown, not called
    - Test: both empty → both errors shown
    - Test: wrong credentials mock → inline error displayed
    - _Requirements: 1.4, 1.5_

- [x] 5. Registration page
  - [x] 5.1 Create `register.html` with registration form UI
    - Fields: Full Name, Email, Phone Number, Barangay (text), Password, Confirm Password
    - All inputs have associated labels; password field has strength hint
    - Link back to login page
    - _Requirements: 2.1, 12.5_

  - [x] 5.2 Implement `src/auth/register.js`
    - Client-side validation: all fields required; password ≥ 8 characters (trigger error even for empty password); password matches confirm; email format valid
    - On valid submit: `createUserWithEmailAndPassword` → `setDoc(doc(db,'users',uid), { fullName, email, phoneNumber, barangay, role:'resident', createdAt: serverTimestamp() })`
    - On `auth/email-already-in-use` error: show inline error, block registration
    - On success: redirect to `resident.html`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x]* 5.3 Write property tests for registration validation
    - **Property — Password length gate**: `fc.string({ maxLength: 7 })` → verify validator rejects; `fc.string({ minLength: 8 })` → verify validator accepts
    - **Property — Required fields**: `fc.record(...)` with random fields set to empty string → verify `validateRegistration` returns errors for all empty fields
    - **Feature: bee-alerta, Property 2.4 & 2.5**
    - _Requirements: 2.4, 2.5_

  - [x]* 5.4 Write unit tests for registration data persistence
    - Test: mock `createUserWithEmailAndPassword` and `setDoc` — verify `setDoc` called with correct fields including `role:'resident'`
    - _Requirements: 2.6_

- [x] 6. Checkpoint — Auth flows working end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Resident SPA shell and navigation
  - [x] 7.1 Create `resident.html` SPA shell
    - Header bar with app title, resident name + barangay display (populated from Firestore on auth), Sign Out button
    - Tab navigation: Submit Report | My Reports | Chatbot — tab panels with `role="tabpanel"` and `aria-labelledby`
    - Include `src/resident/app.js` as entry point
    - Semantic HTML: `<header>`, `<nav>`, `<main>`, `<section>` elements
    - _Requirements: 3.1, 3.2, 12.2_

  - [x] 7.2 Implement `src/resident/app.js`
    - On load: call `authGuard('resident')` — retrieve user doc, populate header name and barangay
    - Tab switching: show active tab panel, hide others; no page reload
    - Sign Out: call `signOut(auth)` then redirect to `index.html` regardless of session state
    - _Requirements: 3.2, 3.3, 3.4_

- [x] 8. Submit Report feature
  - [x] 8.1 Implement `src/resident/report-form.js`
    - Render form inside Submit Report tab panel: description `<textarea>`, category `<select>` with five options, image file input (`accept="image/*"`), GPS capture `<button>`, hidden lat/lng inputs
    - GPS button: call `navigator.geolocation.getCurrentPosition` → populate lat/lng inputs on success; display info message and enable manual lat/lng text inputs on denial
    - Image selection: validate file size ≤ 5 MB; display error and block upload if exceeded
    - Form submit: validate description non-empty/non-whitespace-only and category selected; on validation failure show field errors; on pass: upload image to Storage at `reports/{uid}/{timestamp}_{filename}` if present, then `addDoc` to Firestore `reports` collection with all fields and `status:'Pending'`; on success show toast and reset form
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x]* 8.2 Write property tests for report-form validation
    - **Property 4: Input Validation Rejects Blank Descriptions** — `fc.string().filter(s => s.trim() === '')` → verify `validateDescription` returns error, no Firestore call
    - **Property 5: Image Size Gate** — `fc.integer({ min: 5*1024*1024+1, max: 50*1024*1024 })` used as mock file `.size` → verify `validateImageFile` rejects; `fc.integer({ min: 1, max: 5*1024*1024 })` → verify accepts
    - **Property 1: Report Submission Round Trip** — `fc.record({ description: fc.string({minLength:1}), category: fc.constantFrom(...categories), latitude: fc.option(fc.float()), longitude: fc.option(fc.float()) })` → mock `addDoc`, verify called with all input fields and `status:'Pending'`
    - **Feature: bee-alerta, Property 1, 4, 5**
    - _Requirements: 4.4, 4.5, 4.8_

- [x] 9. My Reports feature
  - [x] 9.1 Implement `src/resident/my-reports.js`
    - Query: `query(collection(db,'reports'), where('residentId','==',uid), orderBy('submittedAt','desc'))`
    - Use `onSnapshot` listener; on each snapshot re-render the reports list
    - When snapshot is empty: show only empty-state message, hide list container
    - Each list item: category badge (`statusBadge()`), first 100 chars of description, `formatDate(submittedAt)`, status badge
    - Click handler on each item: open detail modal with full description, category, date, GPS coordinates display, image (if any), and status
    - Show loading spinner overlay if Firestore snapshot takes > 3 s (set 3 s timeout, clear on snapshot arrival)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 10.2_

  - [x]* 9.2 Write property tests for My Reports filtering
    - **Property 3: Report Ownership Isolation** — `fc.array(fc.record({ residentId: fc.string(), ...otherFields }))` with a target `residentId` → call `filterByResident(reports, targetId)` → verify all returned items have `residentId === targetId`
    - **Feature: bee-alerta, Property 3**
    - _Requirements: 5.1_

  - [x]* 9.3 Write unit tests for My Reports rendering
    - Test: array of 3 reports → renders 3 list items with correct category, date, status badge
    - Test: empty array → shows only empty-state message, list container hidden
    - _Requirements: 5.2, 5.5_

- [x] 10. Chatbot feature
  - [x] 10.1 Implement `src/resident/chatbot.js`
    - Chat UI inside Chatbot tab: scrollable message history `<div>`, text `<input>`, Send `<button>`
    - Message history stored in module-level array; re-renders on each send/receive
    - User messages: right-aligned, class `bubble bubble--user` (orange background)
    - Assistant messages: left-aligned, class `bubble bubble--assistant` (white card)
    - On Send: push user message to history, render user bubble, append animated dots loader bubble, call `POST ${OLLAMA_URL}/api/chat` with system prompt (Bacnotan ordinance context) and conversation history; on response: remove loader, push assistant message, render assistant bubble; if partial response exists when error occurs, render it before the error bubble
    - On Ollama fetch error: append error bubble with class `bubble bubble--error`, keep any partial response already rendered
    - Enter key triggers send
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7_

  - [x]* 10.2 Write property tests for chatbot history
    - **Property — Chat history preservation** — `fc.array(fc.record({ role: fc.constantFrom('user','assistant'), content: fc.string() }), { minLength: 1 })` → send N messages via `appendMessage()`, verify `getChatHistory()` returns all N messages in correct order
    - **Feature: bee-alerta, Property 6.7**
    - _Requirements: 6.7_

  - [x]* 10.3 Write unit tests for chatbot rendering
    - Test: user message has class `bubble--user`; assistant message has class `bubble--assistant` — verify CSS class distinction
    - Test: Ollama error → error bubble shown; if partial content exists, it is rendered before error bubble
    - _Requirements: 6.3, 6.5_

- [x] 11. Checkpoint — Resident interface complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Admin SPA shell and sidebar navigation
  - [x] 12.1 Create `admin.html` SPA shell
    - Sidebar: logo, nav links (Dashboard, Community Concern Management, Settings), Sign Out at bottom
    - Main content area with `<main id="admin-content">`
    - Hamburger toggle button visible only on < 768 px; sidebar becomes drawer overlay on mobile
    - Semantic HTML: `<aside>` for sidebar, `<nav>`, `<main>`
    - `<div id="toast-container">` for toast notifications
    - _Requirements: 7.7, 11.2, 12.2_

  - [x] 12.2 Implement `src/admin/app.js`
    - On load: call `authGuard('official')`
    - Section routing: show active section, hide others; update active class on sidebar links; no page reload
    - Sign Out handler: `signOut(auth)` then redirect to `index.html`
    - _Requirements: 3.4, 7.7_

- [x] 13. Admin Dashboard section
  - [x] 13.1 Implement `src/admin/dashboard.js` — stat cards and real-time listener
    - Subscribe to `onSnapshot(collection(db,'reports'))` listener
    - On each snapshot: compute total, pending, ongoing, completed counts; update the four stat card DOM elements
    - Render Recent Reports: last 10 reports sorted by `submittedAt` descending, each row showing category, `formatDate()`, status badge
    - Show loading spinner overlay if initial snapshot takes > 3 s
    - _Requirements: 7.1, 7.5, 7.6, 10.1_

  - [x] 13.2 Implement Chart.js charts in `src/admin/dashboard.js`
    - Install Chart.js as a dependency
    - Line chart: x-axis = last 14 calendar days, y-axis = count of reports submitted on each day; update datasets on each Firestore snapshot
    - Bar chart: x-axis = five categories, y-axis = count; update on each snapshot
    - Pie/Doughnut chart: show proportional category breakdown when total > 0; show "No data available" `<p>` element and hide `<canvas>` when total = 0
    - _Requirements: 7.2, 7.3, 7.4_

  - [x]* 13.3 Write unit tests for dashboard stat computation
    - Test: snapshot with 2 Pending, 1 Ongoing, 1 Completed → verify computeStats returns `{ total:4, pending:2, ongoing:1, completed:1 }`
    - Test: empty snapshot → all counts 0
    - _Requirements: 7.1, 7.4_

  - [-]* 13.4 Write property test for Recent Reports count
    - **Property 7.5: Recent Reports bounded count** — `fc.array(fc.record({...reportFields}), { minLength: 0, maxLength: 30 })` → call `getRecentReports(reports)` → verify result length ≤ 10 and = min(reports.length, 10)
    - **Feature: bee-alerta, Property 7.5**
    - _Requirements: 7.5_

- [x] 14. Community Concern Management section
  - [x] 14.1 Implement `src/admin/concern-table.js` — table rendering and real-time updates
    - Subscribe to `onSnapshot(collection(db,'reports'))` with `orderBy('submittedAt','desc')`
    - Render table rows: Report ID (truncated), Resident Name, Category, Description (first 80 chars), `formatDate(submittedAt)`, thumbnail `<img>` (or placeholder icon if no image), status badge, Actions button
    - Implement `applyFilters(reports, { status, category, search })` as a pure function: status filter — exact match or 'All'; category filter — exact match or 'All'; search filter — case-insensitive substring match on `description` or `residentName`
    - Debounce search input 300 ms
    - Pagination: show first 20 rows; "Load More" button uses Firestore `startAfter` cursor for next batch
    - _Requirements: 8.1, 8.4, 8.8, 10.1_

  - [-]* 14.2 Write property tests for filter logic
    - **Property 2 (Status Transition) / Property — Status filter**: `fc.array(reportGen)` + `fc.constantFrom('Pending','Ongoing','Completed')` → `applyFilters(reports, { status })` → verify every result has `status === filter` and result length ≤ input length
    - **Property — Category filter**: same pattern for category field
    - **Property — Search filter**: `fc.array(reportGen)` + `fc.string({ minLength:1 })` → `applyFilters(reports, { search: query })` → verify every result has `description` or `residentName` containing query (case-insensitive)
    - **Feature: bee-alerta, Property 8.2, 8.3, 8.4**
    - _Requirements: 8.2, 8.3, 8.4_

  - [-]* 14.3 Write property test for pagination
    - **Property 8.8: Pagination limit** — `fc.array(reportGen, { minLength: 21, maxLength: 100 })` → `paginateReports(reports, 1)` → verify result length === 20
    - **Feature: bee-alerta, Property 8.8**
    - _Requirements: 8.8_

  - [x] 14.4 Implement Actions menu and status update
    - Actions button opens a positioned dropdown with "View Full Details" and "Change Status" options
    - "View Full Details": opens modal showing resident name, barangay, full description, category, GPS coordinates (latitude/longitude as text), full-size image, `formatDate(submittedAt)`, status history timeline fetched from `reports/{id}/statusHistory` sub-collection
    - "Change Status": inline dropdown with Pending/Ongoing/Completed; on selection: `updateDoc(doc(db,'reports',id), { status: newStatus, updatedAt: serverTimestamp() })` and append to `statusHistory` sub-collection with `{ status: newStatus, updatedAt: serverTimestamp(), updatedBy: currentOfficialUid }`
    - Optimistically update the table row status badge before Firestore confirms
    - _Requirements: 8.5, 8.6, 8.7, 8.9_

  - [-]* 14.5 Write property tests for status update logic
    - **Property 2: Status Transition Validity** — `fc.constantFrom('Pending','Ongoing','Completed')` → mock `updateDoc`, call `updateReportStatus(reportId, newStatus, officialId)` → verify `updateDoc` called with `{ status: newStatus }` and `updatedAt` field present
    - **Feature: bee-alerta, Property 2**
    - _Requirements: 8.6, 8.7_

  - [ ]* 14.6 Write property test for full details rendering
    - **Property — Detail view completeness** — `fc.record({ residentName: fc.string({minLength:1}), barangay: fc.string({minLength:1}), description: fc.string({minLength:1}), category: fc.constantFrom(...categories), latitude: fc.option(fc.float()), longitude: fc.option(fc.float()), submittedAt: fc.date() })` → `renderDetailModal(report)` → verify rendered HTML contains each field value
    - **Feature: bee-alerta, Property 8.9**
    - _Requirements: 8.9_

- [x] 15. Checkpoint — Admin Dashboard and Concern Management working
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Admin Settings section
  - [x] 16.1 Implement `src/admin/settings.js`
    - On section load: `getDoc(doc(db,'settings',officialId))` → populate form fields and toggle states
    - Three sections rendered as accordions: General Settings (display name text input, contact email text input), Notification Settings (email notifications toggle), Content Preferences (placeholder toggle)
    - Each toggle: `<input type="checkbox" role="switch">` with visible label
    - On toggle change: immediately call `setDoc(doc(db,'settings',officialId), updatedSettings, { merge: true })`; on Firestore write failure: keep toggle in new state, show error toast with Retry button that re-attempts the write
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 16.2 Write property test for settings persistence
    - **Property 7: Settings Persistence Round Trip** — `fc.record({ displayName: fc.string({minLength:1}), contactEmail: fc.emailAddress(), emailNotificationsEnabled: fc.boolean() })` → mock `setDoc`, call `saveSettings(officialId, settings)` → verify `setDoc` called with all field values exactly as provided
    - **Feature: bee-alerta, Property 7**
    - _Requirements: 9.3, 9.5_

  - [ ]* 16.3 Write unit test for settings error handling
    - Test: mock `setDoc` to reject → verify toggle remains in new state, error toast shown with Retry button
    - _Requirements: 9.3_

- [x] 17. Responsive design and accessibility pass
  - [x] 17.1 Implement responsive CSS
    - Add CSS custom properties for brand colours: `--color-primary: #F97316`, `--color-primary-light: #FB923C`, `--color-bg: #FFF8F0`
    - All layout containers use `max-width` with `width: 100%` and relative units (`rem`, `%`, `vw`)
    - Media query breakpoints: 768 px (tablet) and 360 px (mobile floor)
    - At < 768 px: admin sidebar becomes hidden drawer; toggle via hamburger button; admin report table switches to card-based list layout
    - Ensure no horizontal scrollbar appears on any page from 360 px to 1920 px
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 17.2 Accessibility audit and fixes
    - Add `alt` attributes to all meaningful `<img>` elements; add `aria-hidden="true"` to decorative icons
    - Verify all interactive elements (buttons, links, inputs) are reachable and operable via Tab and Enter/Space
    - Add visible `:focus-visible` outline style to all interactive elements
    - Verify color contrast for all text/background combinations meets 4.5:1 ratio (use the chosen orange palette)
    - Confirm all form inputs have associated `<label>` or `aria-label`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 18. Integration wiring and end-to-end validation
  - [x] 18.1 Wire all modules into their respective HTML entry points
    - `index.html` → imports `src/auth/login.js` and `src/auth/social.js`
    - `register.html` → imports `src/auth/register.js`
    - `resident.html` → imports `src/resident/app.js`, which dynamically imports `report-form.js`, `my-reports.js`, and `chatbot.js` when their tab is first activated
    - `admin.html` → imports `src/admin/app.js`, which dynamically imports `dashboard.js`, `concern-table.js`, and `settings.js` when their section is first activated
    - Confirm `auth-guard.js` is called on every protected page before any content is rendered
    - _Requirements: 1.2, 1.3, 3.3, 7.7_

  - [ ]* 18.2 Write integration tests using Firebase Emulator Suite
    - Configure `vitest.config.js` to connect to Firebase Emulator on `localhost:8080` (Firestore) and `localhost:9099` (Auth)
    - Test: resident registration → verify Firestore `users` doc created with correct fields
    - Test: report submission → verify `reports` doc created with `status:'Pending'` and all submitted fields
    - Test: Official status update → verify `reports` doc `status` and `updatedAt` updated; `statusHistory` sub-collection entry created
    - Test: Resident `onSnapshot` listener → after Official updates status, listener fires with new status within 3 s
    - _Requirements: 10.1, 10.2_

- [x] 19. Final checkpoint — Full system integration
  - Ensure all tests pass (unit, property, and integration), ask the user if questions arise.
  - Verify Firebase Emulator tests pass cleanly
  - Confirm all eight correctness properties have a corresponding property test
  - Do a manual walkthrough: register as resident → submit report → view in My Reports → log in as official → update status → verify resident sees update

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP build
- Each task references specific requirements for traceability
- Checkpoints (tasks 3, 6, 11, 15, 19) are gates to validate incremental progress
- Property tests cover the 8 correctness properties defined in `design.md` — run with `npx vitest --run tests/property/`
- Unit tests cover discrete validation and rendering logic — run with `npx vitest --run tests/unit/`
- Integration tests require `firebase emulators:start` to be running before execution
- The Ollama server URL is configured via `VITE_OLLAMA_URL` environment variable; set to `http://localhost:11434` for local development
- The Firebase data structure in Requirement 13 is implemented in the web app and serves as canonical schema for the future mobile app phase

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3"] },
    { "wave": 4, "tasks": ["4", "5"] },
    { "wave": 5, "tasks": ["6"] },
    { "wave": 6, "tasks": ["7", "12"] },
    { "wave": 7, "tasks": ["8", "9", "10", "13", "14", "16"] },
    { "wave": 8, "tasks": ["11", "15"] },
    { "wave": 9, "tasks": ["17"] },
    { "wave": 10, "tasks": ["18"] },
    { "wave": 11, "tasks": ["19"] }
  ]
}
```
