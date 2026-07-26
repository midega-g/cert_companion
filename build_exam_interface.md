Triggered when the user says: "build the interface"

Generate four files: `index.html`, `style.css`, `app.js`, `firebase-init.js`.

---

# REQUIREMENTS

* Four files: `index.html`, `style.css`, `app.js`, `firebase-init.js`
* Firebase Auth (email/password) required before accessing content
* Firebase Firestore for cross-device session persistence and performance history
* Loads `manifest.json` at startup via `fetch()`
* Loads individual test JSON files via `fetch()` when a test is selected
* All exam logic runs entirely in browser-side JavaScript in `app.js`
* Firebase SDK loaded via CDN `<script type="module">` in `firebase-init.js`
* All styling lives in `style.css`
* `index.html` contains markup and wires `style.css`, `app.js`, and `firebase-init.js`
* Works with any valid JSON produced by the question generation tool
* Never hardcodes question content or provider/topic structure
* Uses `html2pdf.js` (loaded from CDN) for PDF export

---

# FIREBASE INTEGRATION

## SDK Setup

Firebase SDK is loaded via CDN script tags (no npm/bundler needed). The `firebase-init.js` file:
* Imports firebase-app, firebase-auth, firebase-firestore from CDN
* Initializes the Firebase app with project config
* Exposes auth and Firestore functions to `window` for use by `app.js`
* Sets up an `onAuthStateChanged` listener that calls `window.onFirebaseAuthStateChanged(user)`

## Authentication Flow

* App boots to the auth view (sign-in form)
* Firebase auth state listener controls access — redirects to home only after authentication
* Sign out redirects back to auth view
* Auth form supports: sign in, create account, forgot password, show/hide password
* Error messages are user-friendly (mapped from Firebase error codes)

## Firestore Data Model

Collections:
* `users/{uid}/sessions/{sessionKey}` — in-progress exam state (answers, current index, feedback state, timestamp)
* `users/{uid}/history/{auto-id}` — completed test results (score, domain breakdown, per-question results, timestamp)

## Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## localStorage Fallback

* Session saves always write to both localStorage and Firestore
* Session loads try Firestore first, fall back to localStorage
* On first sign-in, existing localStorage data migrates to Firestore (one-time)
* Performance history saved to both localStorage (capped at 100) and Firestore

---

# REPOSITORY STRUCTURE

Tests are organized in a nested folder structure following this pattern:

```
<provider>/<certification>/<domain_N>/<task_N>/test_N.json
```

Each directory level has a `_meta.json` for display metadata (label, description, and optionally weight for domains).

**Root files:** `index.html`, `style.css`, `app.js`, `firebase-init.js`, `manifest.json` (auto-generated)

The manifest generator (`.github/scripts/generate_manifest.py`) walks this tree automatically on every push to `main`.

## Naming Conventions

* Provider folder: lowercase, no spaces (e.g., `snowflake`, `aws`, `azure`, `gcp`)
* Certification folder: lowercase, underscores (e.g., `snowpro_core`, `gen_ai_foundation`)
* Domain/task folders: `domain_N`, `task_N` (sequential)
* Test files: `test_1.json`, `test_2.json`, ... (sequential)

## manifest.json Schema

Auto-generated. Do not edit manually.

```json
{
  "providers": [
    {
      "id": "snowflake",
      "label": "Snowflake",
      "topics": [
        {
          "id": "micro_partition_and_clustering",
          "label": "Micro Partition And Clustering",
          "tests": [
            {
              "id": "test_1",
              "label": "Micro-Partitions Fundamentals — Part A",
              "path": "snowflake/micro_partition_and_clustering/test_1.json"
            },
            {
              "id": "test_2",
              "label": "Test 2",
              "path": "snowflake/micro_partition_and_clustering/test_2.json"
            }
          ]
        }
      ]
    }
  ]
}
```

The `label` for each test comes from the `label` field inside the JSON file if present. If absent, the manifest script falls back to `Test N`.

---

# GITHUB ACTIONS — MANIFEST GENERATION

## Workflow File

Path: `.github/workflows/generate-manifest.yml`

```yaml
name: Generate Manifest

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build-manifest:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - name: Generate manifest.json
        run: python3 .github/scripts/generate_manifest.py

      - name: Commit manifest
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add manifest.json
          git diff --staged --quiet || git commit -m "chore: update manifest.json"
          git push
```

## Generator Script

Path: `.github/scripts/generate_manifest.py`

The script must:

* Walk the repository directory tree
* Skip hidden directories (`.git`, `.github`), `index.html`, `style.css`, `app.js`, and `manifest.json`
* Treat each top-level folder as a provider
* Treat each second-level folder as a topic
* Collect all `test_N.json` files within each topic folder
* Sort tests numerically by their index N
* For each test file, open it and read the `label` field if present; otherwise fall back to `Test N`
* Derive provider and topic labels by title-casing folder names (hyphens/underscores → spaces)
* Output a valid `manifest.json` at the repository root

---

# VIEWS

The app has seven views. Only one is visible at a time.

```
Auth → Home → Topic → Test List → Exam → Report
                ↓
             History
```

Breadcrumb navigation is always visible except on Home and Auth views.

---

## AUTH VIEW

Display:

* Title: "Sign In"
* Subtitle: "Sign in to sync your progress across devices"
* Email input field
* Password input field with show/hide toggle
* "Sign In" button (primary)
* "Create Account" button (secondary) — toggles form between sign-in and sign-up mode
* "Forgot password?" link — sends reset email using the entered email address
* Inline error/success messages

Behavior:

* Shown on app boot — user cannot access content without authenticating
* Toggles between "Sign In" and "Create Account" modes
* Displays user-friendly error messages for auth failures
* On successful auth, Firebase auth state listener redirects to Home view

---

## HOME VIEW

Display:

* App title: "Certification Practice"
* Subtitle: "Select a certification to begin"
* Disclaimer below the subtitle:

  > These questions are based on official documentation that may change over time. Some answers may not reflect the latest documentation when you use them.

* "History" button — navigates to History view
* One card per provider loaded from `manifest.json`

Card displays:

* Provider label (e.g., "Snowflake", "AWS")
* Count of topics available

Auth header (top-right):

* Username (part before @ of email)
* "Sign Out" button

Behavior:

* Clicking a card navigates to Topic View for that provider
* Show a loading state while `manifest.json` is fetching
* Show a clear error message if `manifest.json` fails to load
* Only accessible after authentication

---

## TOPIC VIEW

Display:

* Breadcrumb: Home > [Provider]
* One card per topic under the selected provider

Card displays:

* Topic label
* Count of tests available

---

## TEST LIST VIEW

Display:

* Breadcrumb: Home > [Provider] > [Topic]
* One row per test using the label from the manifest (descriptive name if present, otherwise "Test N")

Row displays:

* Test label
* "Start" button

Behavior:

* Clicking Start fetches the test JSON, then navigates to Exam View
* Show inline loading state per row while fetching
* Show inline error if a test file fails to load

---

## EXAM VIEW

Display exactly one question at a time.

### Header

* Breadcrumb: Home > [Provider] > [Topic] > [Test Label]
* Question number and total (e.g., "Question 7 of 20")
* Domain badge

### Scenario Questions

If question type = `scenario`:

* Render scenario text above the stem in a visually distinct container (slightly muted background, slightly smaller text)

### Question Body

* Stem
* Answer choices

Single-select: radio buttons
Multi-select: checkboxes with explicit "Select TWO" or "Select THREE" instruction

### Selection Validation

Submit button disabled until:

* Single-select: exactly 1 option selected
* Multi-select: exactly the required count selected (2 or 3, parsed from stem)

### Submission Behavior

After clicking Submit:

* Question permanently locked
* Correct options highlight green
* Incorrect selected options highlight red
* Correct options not selected highlight green with "Missed Correct Answer" label
* Display feedback immediately:
  * Correct explanation
  * Explanation for every incorrect option
* Show "Next" button

### Navigation

"Previous" button always visible.

When navigating back to a submitted question:

* Locked, selections and highlighting preserved
* Feedback collapsed by default with "Show Feedback" / "Hide Feedback" toggle

### State Management

Maintain across navigation without loss:

* User answers per question
* Submitted status per question
* Score
* Feedback expanded/collapsed state per question

### Final Question

After submitting the last question, replace "Next" with "View Results".

---

## REPORT VIEW

### Overall Results

* Topic name (from JSON `topic` field)
* Score: X / N
* Percentage

### Domain Analysis

Every domain encountered in the test.

Format: `domain-name: X / Y`

Domains with missed questions highlighted in amber/muted red.

### Question Review

For every question:

* Question number
* Domain tag
* Scenario (if applicable)
* Full stem
* User answer(s)
* Correct answer(s)
* Correct explanation
* Explanation for every answer option
* Correctness indicator (green = fully correct, red = incorrect or partial)

### Actions

* "Retake Test" — resets exam, returns to Question 1 with state cleared
* "Download Report" — exports PDF

---

## HISTORY VIEW

Accessible via "History" button on Home page.

### Aggregate Stats

* Total tests taken
* Average score percentage

### Areas to Improve

* Top 5 weakest domains across all attempts (sorted ascending by score)
* Each shows: domain name + percentage

### All Attempts

Chronological list (most recent first). Each entry shows:

* Test label
* Date and time completed
* Score percentage (color-coded: green ≥80%, amber ≥60%, red <60%)
* Raw score (X/N)

Clicking an entry expands to show:

* Per-domain progress bars with color coding
* Domain name, visual bar, and score (e.g., "3/5")

### Data Source

* If authenticated: loads from Firestore (`users/{uid}/history/`)
* Fallback: loads from localStorage (`cert_history` key)

---

# PDF REPORT EXPORT

* Client-side using `jsPDF` from CDN
* No server, no API calls

PDF contains:

* Summary: topic, score, percentage
* Domain Analysis: all domains and scores
* Question Review: number, domain, scenario, stem, user answers, correct answers, correct explanation, per-option explanations, correctness status

PDF formatting:

* Professional study-guide appearance
* Automatic page breaks
* Multi-page support
* Proper text wrapping — no overflow or overlap
* Consistent spacing, clear headings, readable typography

---

# DESIGN REQUIREMENTS

* Clean and minimal
* No CSS frameworks
* System fonts only
* Neutral color palette
* Green exclusively for correct indicators
* Red exclusively for incorrect indicators
* Amber/muted red for missed domains in Report View
* Responsive layout for desktop and tablet
* No decorative or flashy effects

---

# OUTPUT

* `index.html` — markup shell, `<link>` to `style.css`, `<script>` for `app.js`, `firebase-init.js`, and html2pdf CDN
* `style.css` — all styling
* `app.js` — all application logic, view rendering, state management, auth UI, history view, PDF export
* `firebase-init.js` — Firebase SDK initialization, auth functions, Firestore functions exposed to window
