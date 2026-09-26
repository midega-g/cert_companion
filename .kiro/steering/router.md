# Cert Companion — Router (read this first)

This is the entry point for any session on this project. Read this file first,
then follow the pointers below to the correct spec/steering for the task at hand.

The app supports **two study modes** per certification. Everything else in this
project hangs off which mode a piece of content belongs to.

---

## The two modes

| Mode | User-facing name | Purpose | Content root |
|------|------------------|---------|--------------|
| `exam` | **Exam Prep** | Structured, blueprint-aligned practice organized by domain/task. The original mode. | `<provider>/<certification>/<domain_N>/<task_N>/` |
| `drill` | **Topic Drill** | Rapid-fire quick questions squeezing every fact out of the specific content you are reading right now. | `<provider>/<certification>/topic_tests/<topic>/<content>/` |

Both modes:

- Are **provider- and certification-agnostic** — they work for AWS, Snowflake,
  Azure, GCP, and any future provider/cert. Never hardcode a provider or cert.
- Produce the **same question JSON schema** and the **same in-app rendering**.
  Only `test_N.json` files are ever rendered in the browser.
- Are discovered by the same recursive manifest generator. No generator change
  is needed to add content — only to add new *metadata* (already handled).

---

## Which spec to use

| If the task is... | Read / follow |
|-------------------|---------------|
| Generate an **Exam Prep** test from source docs (20-question blueprint format) | `.kiro/specs/generate_exam_questions.md` |
| Generate a **Topic Drill** from pasted content (15–20 quick-fire questions) | `.kiro/specs/generate_topic_drill.md` |
| Build or change the **web interface** (views, mode selector, etc.) | `.kiro/specs/build_exam_interface.md` |
| Anything else (git workflow, Firebase, docs upkeep, discovering state) | `.kiro/steering/cert-companion.md` |
| Tool index / high-level overview | `.kiro/steering/skills.md` |

---

## Choosing a mode when the intent is ambiguous

- The user **pastes raw content** (notes, a doc section, a page) and wants
  quick questions on *what they are reading* → **Topic Drill**
  (`generate_topic_drill.md`).
- The user provides **documentation links / a topic to cover for the exam** and
  wants structured, exam-weighted practice → **Exam Prep**
  (`generate_exam_questions.md`).
- When still unclear, ask: "Exam Prep (structured, blueprint) or Topic Drill
  (quick-fire on this content)?"

---

## Folder layout (both modes, generic)

```
<provider>/
  <certification>/
    _meta.json                         # cert display metadata
    <domain_N>/<task_N>/test_N.json    # EXAM PREP content
    topic_tests/                       # TOPIC DRILL content (this folder name is the drill signal)
      _meta.json
      <topic>/                         # e.g. compute, storage, networking
        _meta.json
        <content>/                     # e.g. ec2, ecs, eks
          _meta.json
          <content>_concept.md         # generated first; NEVER rendered
          test_N.json                  # generated from concept; ONLY file rendered
          walkthroughs.md              # optional, on request
          *.pdf                        # optional
```

### Mode detection rule (used by manifest + app)

1. If a node's folder is `topic_tests` **or any ancestor folder is** `topic_tests`
   → `mode = "drill"`.
2. Otherwise → `mode = "exam"`.
3. An explicit `"mode"` field in a directory's `_meta.json` **overrides** the
   folder-name rule (escape hatch; rarely needed).

The manifest generator stamps every node with its resolved `mode`. The app uses
it to route the user after they pick a certification.
