# Certification Practice — Tool Index

**Read `.kiro/steering/router.md` first.** It is the central entry point and
explains the two study modes (Exam Prep and Topic Drill) and which spec to use.

Three generation/build tools are available. Pass the appropriate one to the
agent depending on the task.

---

## `generate_exam_questions`

**File:** `.kiro/specs/generate_exam_questions.md`

**Mode:** Exam Prep (`exam`)

**Purpose:** Generate a 20-question, blueprint-aligned certification practice
test as valid JSON from source material (docs/links).

**Invoke when:** The user provides documentation and wants a structured,
exam-weighted practice test organized by domain/task.

---

## `generate_topic_drill`

**File:** `.kiro/specs/generate_topic_drill.md`

**Mode:** Topic Drill (`drill`)

**Purpose:** From pasted content, first generate/append a `<content>_concept.md`,
then generate a 15–20 question quick-fire drill (lean single/multi, max 3
scenario) as valid JSON.

**Invoke when:** The user pastes content they are actively reading and wants
rapid-fire questions squeezing every fact out of it.

---

## `build_exam_interface`

**File:** `.kiro/specs/build_exam_interface.md`

**Purpose:** Build the static web interface (`index.html`, `style.css`, `app.js`, `firebase-init.js`) that loads and runs the practice tests.

**Invoke when:** The user says "build the interface" or needs the front-end application regenerated.

---

## Repository Structure

**Root files:** `index.html`, `style.css`, `app.js`, `firebase-init.js`, `manifest.json` (auto-generated)

**Kiro config:** `.kiro/steering/router.md` (read first), `.kiro/specs/generate_exam_questions.md`, `.kiro/specs/generate_topic_drill.md`, `.kiro/specs/build_exam_interface.md`, `.kiro/steering/skills.md`, `.kiro/steering/cert-companion.md`

**Docs:** `docs/` — implementation plans, setup guides, verification commands, deployment guide. See `docs/README.md` for index.

**CI:** `.github/scripts/generate_manifest.py` + `.github/workflows/generate-manifest.yml`

**Content** follows a consistent nesting pattern, per mode:

```
# Exam Prep (mode: exam)
<provider>/<certification>/<domain_N>/<task_N>/test_N.json

# Topic Drill (mode: drill)
<provider>/<certification>/topic_tests/<topic>/<content>/<content>_concept.md
<provider>/<certification>/topic_tests/<topic>/<content>/test_N.json
```

Each directory level has a `_meta.json` for display metadata (label,
description, optional weight, optional `mode` override). The manifest generator
walks this tree automatically and stamps every node with a resolved `mode`
(`exam` | `drill`) — the `topic_tests` folder name signals `drill`. You never
edit `manifest.json` by hand.

To inspect the current structure, run:

```bash
find snowflake aws -type f -name "_meta.json" | sort
find snowflake aws -type f -name "test_*.json" | sort
```

## Firebase Integration

The app uses Firebase (Spark/free plan) for:

- **Authentication** — Email/password sign-in (required before accessing content)
- **Firestore** — Cross-device session persistence and performance history storage

Config lives in `firebase-init.js`. Firebase SDK is loaded via CDN `<script type="module">`.

Firestore collections:
- `users/{uid}/sessions/{sessionKey}` — in-progress exam state
- `users/{uid}/history/{auto-id}` — completed test results

Security rules restrict access to `users/{uid}/**` where `request.auth.uid == uid`.

## Adding a New Test

1. Generate questions using the `generate_exam_questions` tool.
2. Save the output as `test_N.json` in the appropriate `<provider>/<cert>/<domain_N>/<task_N>/` folder.
3. If the test covers a specific subtopic or is part of a series, add a `"label"` field to the JSON (e.g., `"label": "Micro-Partitions Fundamentals — Part A"`). If omitted, the manifest will display it as "Test N".
4. Push to `main`. GitHub Actions will automatically regenerate `manifest.json`.

## Adding a New Certification

1. Create the folder structure: `<provider>/<cert_name>/domain_N/task_N/`
2. Add `_meta.json` at each level (cert, domain, task) with `label`, `description`, and optionally `weight` for domains.
3. Generate test files and place them in the correct task folders.
4. Push to `main` — the manifest auto-updates.
