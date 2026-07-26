# Implementation Plan — SnowPro Core Exam Restructuring + Firebase Progress Tracking

**Status:** Approved
**Date:** 2026-07-26

---

## Problem Statement

Reorganize existing Snowflake exam content from a flat topic-based structure into the official SnowPro Core certification domain/task hierarchy, add Firebase-backed cross-device progress tracking with email/password auth, add a performance history dashboard, and update the question generation instructions.

---

## SnowPro Core Certification Structure

| Domain | Weight |
|--------|--------|
| 1.0 Snowflake AI Data Cloud Features and Architecture | 31% |
| 2.0 Account Management and Data Governance | 20% |
| 3.0 Data Loading, Unloading, and Connectivity | 18% |
| 4.0 Performance Optimization, Querying, and Transformation | 21% |
| 5.0 Data Collaboration | 10% |

### Domain 1 Tasks
- 1.1 Describe and Use the Snowflake Architecture
- 1.2 Use Snowflake Interfaces and Tools
- 1.3 Differentiate Snowflake Object Hierarchy and Types
- 1.4 Configure Virtual Warehouses
- 1.5 Explain Snowflake Storage Concepts
- 1.6 Explain AI/ML and Application Development Features

### Domain 2 Tasks
- 2.1 Explain Snowflake Security Model and Principles
- 2.2 Define Data Governance Features and How They Are Used
- 2.3 Explain Monitoring and Cost Management

### Domain 3 Tasks
- 3.1 Perform Data Loading and Unloading
- 3.2 Perform Automated Data Ingestion
- 3.3 Identify the Different Snowflake Connectors and Integrations

### Domain 4 Tasks
- 4.1 Evaluate Query Performance
- 4.2 Optimize Query Performance
- 4.3 Use Snowflake Caching
- 4.4 Perform Data Transformation Techniques

### Domain 5 Tasks
- 5.1 Explain Data Collaboration and Protection
- 5.2 Explain Snowflake's Data Sharing Capabilities
- 5.3 Share Data Using the Snowflake Marketplace and Listings

---

## Existing File Mapping

| Current Location | New Location | Rationale |
|-----------------|--------------|-----------|
| `snowflake/virtual_warehouses/test_1.json`, `test_2.json` | `snowflake/snowpro_core/domain_1/task_4/` | Task 1.4: Configure Virtual Warehouses |
| `snowflake/micro_partition_and_clustering/test_1.json` – `test_6.json` | `snowflake/snowpro_core/domain_1/task_5/` | Task 1.5: Explain Snowflake Storage Concepts |
| `snowflake/editions/test_1.json` | `snowflake/snowpro_core/domain_1/task_1/` | Task 1.1: Describe and Use the Snowflake Architecture |
| `snowflake/cloning/test_1.json` | `snowflake/snowpro_core/domain_1/task_5/` | Task 1.5: Explain Snowflake Storage Concepts |

---

## Tasks

### Task 1: Create the SnowPro Core folder structure with metadata

**Objective:** Create the `snowflake/snowpro_core/` directory tree with all 5 domains and 19 tasks, each with `_meta.json`.

**Implementation guidance:**
- Create `snowflake/snowpro_core/_meta.json` with label "SnowPro Core" and description
- Create `domain_1/` through `domain_5/` each with `_meta.json` containing label, description, and weight (e.g., `"weight": "31%"`)
- Create task folders (`task_1/` through `task_N/`) within each domain with `_meta.json` containing label and description matching the exam guide

**Test:** Run `generate_manifest.py` and verify the manifest includes the full nested hierarchy with correct labels and descriptions.

**Demo:** Opening the app shows Snowflake → SnowPro Core → 5 domain cards with weights visible → task cards within each domain.

---

### Task 2: Move existing test files to their domain/task locations

**Objective:** Relocate existing Snowflake test JSON files into the new hierarchy.

**Implementation guidance:**
- `snowflake/virtual_warehouses/test_1.json`, `test_2.json` → `snowflake/snowpro_core/domain_1/task_4/`
- `snowflake/micro_partition_and_clustering/test_1.json` through `test_6.json` → `snowflake/snowpro_core/domain_1/task_5/`
- `snowflake/editions/test_1.json` → `snowflake/snowpro_core/domain_1/task_1/`
- `snowflake/cloning/test_1.json` → `snowflake/snowpro_core/domain_1/task_5/`
- Remove old empty directories
- Verify `order` fields exist in all moved files (they already do)

**Test:** Run `generate_manifest.py`, verify paths resolve correctly. Open app locally and navigate to the tests.

**Demo:** Navigate Snowflake → SnowPro Core → Domain 1 → Task 1.4 (Virtual Warehouses) → see the two existing tests available to start.

---

### Task 3: Update `generate_exam_questions.md` with new rules

**Objective:** Update the question generation instructions with the new distribution, "correct answer" clarification, and multi-step generation guidance.

**Implementation guidance:**
- Change distribution from 10 direct + 10 scenario to 6 direct (3 single, 3 multi) + 14 scenario (7 single, 7 multi)
- Add instruction in the JSON schema section: "The example shows `"correct": ["A"]` for illustration only. The correct answer(s) must be distributed naturally across all option keys (A–F). Do not default to A."
- Add a new section "LARGE FILE GENERATION": "If the output exceeds 250 lines, generate the file in sequential parts (e.g., questions 1–10 first, then 11–20) rather than attempting the entire file in a single pass. This prevents generation failures and context-window loops."
- Total remains 20 questions (6 + 14 = 20)

**Test:** Review the markdown for consistency and clarity. Verify the math adds up.

**Demo:** The updated instruction file is ready to use for generating new SnowPro Core questions.

---

### Task 4: Add Firebase project configuration and auth module

**Objective:** Integrate Firebase SDK, add email/password authentication with a login/signup UI.

**Implementation guidance:**
- Add Firebase SDK via CDN (firebase-app, firebase-auth, firebase-firestore) to `index.html`
- Create a Firebase config object (user will provide their project credentials)
- Add a login/signup view with email + password fields
- Add a persistent auth state listener — show user email + logout button in a header bar when logged in
- The app remains fully functional without login (localStorage fallback)
- When logged in, sessions sync to Firestore instead of (or in addition to) localStorage

**Test:** Sign up with an email, verify auth state persists on refresh. Log out, verify app still works with localStorage. Log in on a second device, verify data appears.

**Demo:** User sees a "Sign In" button on the home page. After signing in, their email appears in the header. The app works identically but data now syncs.

---

### Task 5: Add Firestore session persistence (replace localStorage when authenticated)

**Objective:** When a user is logged in, persist exam session state to Firestore so it's available cross-device.

**Implementation guidance:**
- Firestore collection: `users/{uid}/sessions/{sessionKey}` — same structure as current localStorage data (answers, current question index, feedbackOpen, timestamp)
- On `saveSession()`: if authenticated, write to Firestore; always write to localStorage as fallback
- On `loadSession()`: if authenticated, read from Firestore; otherwise localStorage
- On `clearSession()`: clear both
- Handle offline gracefully (Firestore SDK has offline persistence built-in)

**Test:** Start a test on device A, answer 5 questions, open device B, verify "Resume" prompt appears with correct progress.

**Demo:** Start a test on desktop, answer a few questions, open phone browser, sign in, see the same progress.

---

### Task 6: Add performance history storage

**Objective:** When a test is completed, store the detailed results in Firestore (and locally) for the performance history view.

**Implementation guidance:**
- Firestore collection: `users/{uid}/history/{auto-id}` with fields: testPath, testLabel, score, total, percentage, domainBreakdown (object), perQuestionResults (array of {questionId, domain, correct: bool, userAnswer, correctAnswer}), completedAt (timestamp)
- On report render (when `clearSession()` is called), also write the result to history
- For non-authenticated users, store history in localStorage under a `cert_history` key (array of results, capped at 100 entries)
- Do NOT clear history on retake — each attempt is a separate record

**Test:** Complete a test, verify a history document is written. Complete the same test again, verify both attempts appear.

**Demo:** After completing a test and viewing the report, the result is persisted. Retaking and completing again creates a second record.

---

### Task 7: Add performance history view (UI)

**Objective:** Add a "History" view accessible from the home page that shows past test performance.

**Implementation guidance:**
- Add a "History" button/link on the home page (visible only when logged in, or always visible with localStorage data)
- History view shows: list of completed tests sorted by date (most recent first)
- Each entry shows: test label, score (X/N), percentage, date, domain breakdown mini-chart or bars
- Clicking an entry expands to show per-question results (which questions were wrong, which domains)
- Add filtering: by provider, by domain, by date range
- Show aggregate stats at the top: total tests taken, average score, weakest domains

**Test:** Complete 3 different tests, open History view, verify all 3 appear with correct data. Filter by domain, verify filtering works.

**Demo:** User clicks "History" from home page, sees a timeline of their attempts with scores, can drill into any attempt to see which questions they missed and which domains need work.

---

### Task 8: Update `build_exam_interface.md` and `skills.md`

**Objective:** Update documentation to reflect the new Firebase integration, history view, and folder structure.

**Implementation guidance:**
- `build_exam_interface.md`: Add Firebase requirements section (SDK, config, auth flow), new History view spec, update the "no backend/no API calls" constraint to "optional Firebase backend for sync", add the auth UI spec
- `skills.md`: Update the repository structure to show the nested `snowflake/snowpro_core/domain_N/task_N/` pattern, document the Firebase setup, mention the History view
- `DEPLOYMENT.md`: Add Firebase project setup instructions (create project, enable email/password auth, create Firestore database, add config to app)

**Test:** Read through all documentation for consistency and accuracy.

**Demo:** A new contributor can read the docs and understand how to set up the Firebase project, add new exam content, and use the history feature.

---

## Implementation Order

Tasks 1–3 are independent and can be done immediately. Tasks 4–7 form a dependency chain (auth → persistence → history storage → history UI). Task 8 is done last to document the final state.

```
[Task 1] ──┐
[Task 2] ──┼── can run in parallel ──→ [Task 4] → [Task 5] → [Task 6] → [Task 7] → [Task 8]
[Task 3] ──┘
```

---

## Additional Tasks (Added During Implementation)

### Task 9: Password show/hide toggle

**Objective:** Allow users to toggle password visibility on the auth form.

**Implementation:** Added a "Show"/"Hide" button inside the password input field that toggles between `type="password"` and `type="text"`.

**Status:** ✅ Complete

---

### Task 10: Required authentication

**Objective:** Enforce sign-in before accessing any app content to prevent data loss and confusion.

**Implementation:**
- App boots to auth view (sign-in form) instead of home
- Firebase auth state listener controls access — redirects to home only after authentication confirmed
- Sign out redirects back to auth view
- Removed "Continue without signing in" option

**Status:** ✅ Complete

---

### Task 11: localStorage-to-Firestore migration

**Objective:** Migrate any existing localStorage data (sessions + history) to Firestore on first sign-in so no progress is lost.

**Implementation:**
- On first sign-in, checks for existing `cert_session_*` keys and `cert_history` in localStorage
- Uploads all found data to Firestore under the user's UID
- Sets a `cert_migrated_{uid}` flag so migration only runs once per user

**Status:** ✅ Complete

---

### Task 12: Forgot password

**Objective:** Allow users to reset their password via email.

**Implementation:**
- "Forgot password?" link on auth form
- Uses Firebase `sendPasswordResetEmail` with the email in the form field
- Shows success (green) or error (red) message inline

**Status:** ✅ Complete

---

### Task 13: Firestore security rules

**Objective:** Replace test-mode rules (expiring Aug 25, 2026) with production rules that restrict access to authenticated users' own data.

**Implementation:** Deploy rules that allow read/write only to `users/{uid}/**` where `request.auth.uid == uid`.

**Status:** ✅ Complete

---

### Task 14: Firebase setup documentation

**Objective:** Write `docs/setup/firebase-setup.md` covering project creation, auth config, Firestore setup, security rules deployment, and config values.

**Status:** ✅ Complete

---

## Task Completion Summary

| Task | Description | Status |
|------|-------------|--------|
| 1 | Create SnowPro Core folder structure | ✅ Complete |
| 2 | Move existing test files | ✅ Complete |
| 3 | Update question generation rules | ✅ Complete |
| 4 | Firebase auth integration | ✅ Complete |
| 5 | Firestore session persistence | ✅ Complete |
| 6 | Performance history storage | ✅ Complete |
| 7 | Performance history view | ✅ Complete |
| 8 | Update skills.md + build_exam_interface.md | ✅ Complete |
| 9 | Password show/hide toggle | ✅ Complete |
| 10 | Required authentication | ✅ Complete |
| 11 | localStorage-to-Firestore migration | ✅ Complete |
| 12 | Forgot password | ✅ Complete |
| 13 | Firestore security rules | ✅ Complete |
| 14 | Firebase setup documentation | ✅ Complete |
