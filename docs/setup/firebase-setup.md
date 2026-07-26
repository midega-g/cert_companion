# Firebase Setup Guide

Step-by-step instructions for setting up the Firebase project that powers authentication and cross-device sync in this app.

---

## Project Details

| Field | Value |
|-------|-------|
| Project name | cert-companion |
| Plan | Spark (no-cost) |
| Firestore location | Multi-region eur3 (Europe) |
| Analytics location | Kenya |
| Auth method | Email/Password |

---

## Free Tier Limits (Spark Plan)

| Resource | Daily Limit |
|----------|-------------|
| Firestore document reads | 50K/day |
| Firestore document writes | 20K/day |
| Firestore document deletes | 20K/day |
| Firestore stored data | 1 GiB total |
| Authentication MAUs | 50K/month |

For a personal study tool, these limits are effectively unlimited. You'd need to take thousands of tests per day to approach them.

---

## Initial Setup (Already Done)

These steps were completed on 2026-07-26. Documented here for reference if the project needs to be recreated.

### 1. Create Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Create a project** (or **Add project**)
3. Project name: `cert-companion`
4. Enable Google Analytics, set location to Kenya
5. Click **Create project**

### 2. Register a Web App

1. On the project overview page, click the web icon (`</>`)
2. App nickname: `cert-companion-web`
3. Do NOT check "Also set up Firebase Hosting" (app is hosted on GitHub Pages)
4. Click **Register app**
5. Choose **Use `<script>` tag** option (no npm/bundler needed for static sites)
6. Copy the `firebaseConfig` object — this goes in `firebase-init.js`
7. Click **Continue to console**

### 3. Enable Email/Password Authentication

1. In the left sidebar: **Security** → **Authentication**
2. Click **Get started**
3. On the "Sign-in method" tab, click **Email/Password**
4. Toggle **Enable** (leave "Email link" disabled)
5. Click **Save**
6. Ignore the "Sign in with Google" recommendation — email/password is sufficient for a personal tool

### 4. Create Firestore Database

1. In the left sidebar: **Database & Storage** → **Firestore**
2. Click **Create database**
3. Select edition: **Standard**
4. Location: **Multi-region eur3 (Europe)**
   - This cannot be changed after creation
   - `africa-south1` (Johannesburg) would give ~50-80ms lower latency from Kenya but multi-region Europe provides higher availability
5. Start in **test mode** (replaced with production rules immediately after)
6. Click **Create**

### 5. Deploy Security Rules

1. In Firestore, click the **Rules** tab
2. Replace the default test-mode rules with:

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

3. Click **Publish**

This ensures:
- Only authenticated users can access data
- Each user can only read/write their own `users/{uid}/` path
- No expiry date (unlike test mode)

---

## Firebase Config

The config lives in `firebase-init.js` at the project root. These values are public (safe to commit) — they identify the project but don't grant access. Security is enforced by auth + Firestore rules.

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyAyRHwHI1R44PSeno-2GyVpUWMBYU9Pvqk",
  authDomain: "cert-companion.firebaseapp.com",
  projectId: "cert-companion",
  storageBucket: "cert-companion.firebasestorage.app",
  messagingSenderId: "730427525626",
  appId: "1:730427525626:web:74b303ef962a239990fc43",
  measurementId: "G-HHH3XR8VK1",
};
```

---

## How the App Uses Firebase

### Authentication

- SDK loaded via CDN (`firebase-auth` module)
- `onAuthStateChanged` listener controls app access — no auth = stuck on sign-in view
- Functions exposed to `window`: `firebaseSignIn`, `firebaseSignUp`, `firebaseSignOut`, `firebaseResetPassword`

### Firestore Data Model

```
users/
  {uid}/
    sessions/
      {sessionKey}/          ← in-progress exam state
        answers: [...]
        current: number
        feedbackOpen: [...]
        timestamp: number
    history/
      {auto-id}/             ← completed test results
        testPath: string
        testLabel: string
        topic: string
        provider: string
        score: number
        total: number
        percentage: number
        domainBreakdown: { domain: { correct, total } }
        perQuestionResults: [{ questionId, domain, correct, userAnswer, correctAnswer }]
        completedAt: number (epoch ms)
```

### Session Persistence

- `saveSession()` writes to both localStorage AND Firestore
- `loadSession()` tries Firestore first, falls back to localStorage
- `clearSession()` removes from both

### Performance History

- `saveHistory()` writes to localStorage (capped at 100) AND Firestore
- `loadHistory()` tries Firestore first (ordered by `completedAt` desc), falls back to localStorage

### Data Migration

On first sign-in, `migrateLocalData()` runs once:
1. Reads `cert_history` from localStorage → uploads each record to Firestore
2. Reads all `cert_session_*` keys → uploads to Firestore
3. Sets `cert_migrated_{uid}` flag so it doesn't repeat

---

## Troubleshooting

### "Permission denied" errors in console

- Security rules may not have been published correctly
- Go to Firestore → Rules → verify the rules match the ones in this doc
- Ensure the user is authenticated (check `state.user` is not null)

### Auth state not persisting on refresh

- Firebase auth uses IndexedDB by default for persistence — this should work automatically
- If testing in incognito/private mode, persistence may not work

### Data not syncing between devices

- Confirm both devices are signed in with the same email
- Check browser console for Firestore errors
- Verify internet connectivity (Firestore SDK handles offline gracefully but won't sync until online)

### Firestore quota exceeded

- Extremely unlikely for personal use (50K reads/20K writes per day)
- If it happens: wait until midnight (quotas reset daily) or upgrade to Blaze plan

---

## GitHub Account

This project uses the `midega-g` GitHub account:

```bash
# Check active account
gh auth status

# Switch if needed
gh auth switch --user midega-g
```
