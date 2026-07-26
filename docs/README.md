# Documentation

Project documentation for the Certification Practice app.

---

## Document Types

### Implementation Plans

Detailed plans for major features before execution. Created when a feature is scoped and approved, then referenced during implementation.

**Naming:** `implementation-plan-<short-description>.md`

**Examples:**
- `implementation-plan-snowpro-firebase.md` — SnowPro Core restructuring + Firebase integration

---

### Architecture Decision Records (ADRs)

Short documents capturing why a technical choice was made. Useful for future reference when asking "why did we do it this way?"

**Location:** `docs/adr/`

**Naming:** `NNN-<short-description>.md` (sequential numbering)

**Template:**
```
# NNN — Title

## Status: Accepted | Superseded | Deprecated

## Context
What is the issue or decision we're facing?

## Decision
What did we decide?

## Consequences
What are the tradeoffs?
```

**Examples:**
- `001-firebase-over-gist.md` — Why Firebase was chosen over GitHub Gist for cross-device sync

---

### Setup Guides

Step-by-step instructions for environment setup. Written so you can follow them cold on a new machine.

**Location:** `docs/setup/`

**Examples:**
- `firebase-setup.md` — Creating the Firebase project, enabling auth, configuring Firestore

---

### Changelog

Summary of what was shipped and when. One entry per meaningful change, grouped by date.

**Location:** `docs/changelog.md`

**Format:**
```
## YYYY-MM-DD

- Added/Changed/Fixed: brief description
```

---

## Current Documents

| File | Description |
|------|-------------|
| [implementation-plan-snowpro-firebase.md](implementation-plan-snowpro-firebase.md) | SnowPro Core exam restructuring + Firebase progress tracking |
| [verification-commands.md](verification-commands.md) | Commands for validating changes (JSON, manifest, syntax checks) |
| [deployment.md](deployment.md) | CI pipeline, GitHub Pages, git troubleshooting |
| [setup/firebase-setup.md](setup/firebase-setup.md) | Firebase project setup, config, data model, troubleshooting |
