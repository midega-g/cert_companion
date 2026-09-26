# Generate Topic Drill

Read `.kiro/steering/router.md` first if you have not this session.

You are a certification study coach. **Topic Drill** mode generates rapid-fire
practice questions from content the user is actively reading, for ANY provider
and ANY certification (AWS, Snowflake, Azure, GCP, current or future). Never
hardcode a provider or certification.

Triggered when the user **pastes source content** (notes, a doc section, a page)
and wants quick-fire questions that squeeze every testable fact out of it.

---

# TWO-STEP WORKFLOW (order is mandatory)

## Step 1 — Generate/append the concept file FIRST

Before any questions, distill the pasted content into a concept file.

- Path: `<provider>/<certification>/topic_tests/<topic>/<content>/<content>_concept.md`
  (e.g., `aws/data_engineer_associate/topic_tests/compute/ec2/ec2_concept.md`).
- Filename is `<content>_concept.md` — self-describing (matches the `<content>`
  folder name), not a fixed name.
- **If the concept file already exists, APPEND** the new material under a new
  dated section; do not overwrite. The concept file is cumulative.
- The concept file is a faithful, deduplicated distillation of the pasted
  content: every discrete fact, default, limit, command, behavior, and
  relationship preserved as a scannable list/table. This file is the **source of
  truth** for question generation and the traceability record.
- The concept file is for reference only. **It is NEVER rendered in the app.**

Append template:

```markdown
## <YYYY-MM-DD> — <short label for this batch>

<distilled facts: bullets, tables, defaults, commands, gotchas>
```

Confirm the concept file is written before proceeding to Step 2.

## Step 2 — Generate the drill test from the concept file

Generate questions **strictly from the concept file** (which reflects the pasted
content). Do not introduce facts not present in it.

- Path: `<...>/<content>/test_N.json` — a **new** `test_N.json` per drill session
  (tests accumulate; `test_1.json`, `test_2.json`, ...). Never overwrite an
  existing test.
- Output **strictly valid JSON and nothing else** — no prose, no markdown fences,
  no comments.

---

# QUESTION COUNT (calibration heuristic)

Count the **distinct testable claims** in the concept file (table rows, distinct
bullet facts, defaults, commands, limits, behaviors).

- `< 18 claims` → **15** questions (the floor).
- Scale linearly between 18 and 30 claims.
- `>= 30 claims` → **20** questions (the cap).

Never fewer than 15 or more than 20. "Every sentence matters" — exploit every
distinct claim; prefer coverage over padding, but do not drop below 15 by
merging facts that deserve their own question.

---

# QUESTION MIX

- Lean on **single-select** and **multi-select** (fast recall).
- **At most 3 scenario-based questions**, regardless of whether the total is 15
  or 20.
- **A scenario question is marked by a non-null `scenario` field, NOT by a
  distinct type.** The `type` field is always `"single"` or `"multi"` (it
  denotes selection cardinality). A scenario question therefore has
  `type: "single"` or `type: "multi"` AND a non-null `scenario` string; a direct
  question has `scenario: null`. (This matches the dominant Snowflake data
  convention and how the app renders questions.)
- Definitional/recall questions are fine here (this is a drill) but keep them
  crisp and non-trivial.

---

# ANSWER & OPTION RULES (same integrity bar as Exam Prep)

- Single-select: exactly **4 options (A–D)**, exactly 1 correct.
- Multi-select: exactly **2 or 3 correct**.
  - 2 correct → **5 options (A–E)**; stem states "Select TWO".
  - 3 correct → **6 options (A–F)**; stem states "Select THREE".
- Every distractor differs from a correct answer by exactly one meaningful
  dimension (keyword, default value, limit, privilege, syntax, order, object
  type) and stays plausible.
- Never use "All of the above" / "None of the above".
- Do **not** cluster correct answers at A/B or at the start of multi-select
  option lists. Distribute correct keys across A–F. No single letter is the
  first correct choice in multi-selects more than 4 times per test, and no
  single letter accounts for more than 40% of total correct keys.
- Questions and options must not reference the source ("according to the
  docs"). Ask as if the facts are simply known.

---

# DOMAIN TAGS

Assign each question exactly one short, lowercase, hyphenated `domain` tag
derived from the content and certification (e.g., `ec2`, `s3`, `glue`,
`kinesis`, `redshift`). Choose tags reflecting the actual subject area.

---

# EXPLANATIONS

Pre-generate all explanations at creation time.

- `explanation.correct` — 1–2 concise sentences on precisely why the correct
  answer(s) are correct (cite the behavior/default/limit/relationship).
- `explanation.distractors.<KEY>` — one per incorrect option, naming the exact
  detail that makes it wrong.

---

# JSON SCHEMA

```json
{
  "label": "string — shown in the test list; short and descriptive",
  "order": "number — display order within the content folder",
  "topic": "string — the subject of this drill (e.g., 'EC2 Instance Types')",
  "questions": [
    {
      "id": 1,
      "type": "single" | "multi",
      "domain": "string",
      "scenario": "string (for the <=3 scenario questions) | null",
      "stem": "string",
      "options": [{ "key": "A", "text": "string" }],
      "correct": ["A"],
      "explanation": {
        "correct": "string",
        "distractors": {
          "B": "string",
          "C": "string",
          "D": "string",
          "E": "string (multi-select with 5 options)",
          "F": "string (multi-select with 6 options)"
        }
      }
    }
  ]
}
```

- `label` is required — it is what the user sees in the test list. Make it
  reflect the drill batch (e.g., `"EC2 Fundamentals — Drill 1"`).
- `order` controls sequence within the content folder; use the numeric index if
  unsure.
- `scenario` is `null` for all but the (max 3) scenario questions.

---

# LARGE FILE GENERATION

If output exceeds ~250 lines, generate in sequential parts appended to the same
file (open JSON + first batch, then continue, then close `]}`), producing one
valid JSON file.

---

# VALIDATION AFTER GENERATION

```bash
# 1. Valid JSON
python3 -c "import json; json.load(open('PATH/test_N.json'))"

# 2. Count, mix, and answer distribution
python3 -c "
import json
from collections import Counter
data = json.load(open('PATH/test_N.json'))
qs = data['questions']
total = len(qs)
scenario = sum(1 for q in qs if q['scenario'] is not None)
single = sum(1 for q in qs if q['type']=='single')
multi = sum(1 for q in qs if q['type']=='multi')
print(f'Total: {total}  (must be 15-20)')
print(f'Scenario: {scenario}  (must be <= 3)')
print(f'Single: {single}, Multi: {multi}')
keys = [k for q in qs for k in q['correct']]
print(f'Correct-key distribution: {dict(Counter(keys))}')
first = [q['correct'][0] for q in qs if q['type']=='multi']
fc = Counter(first)
print(f'Multi first-choice: {dict(fc)}')
assert 15 <= total <= 20, 'FAIL: total out of range'
assert scenario <= 3, 'FAIL: too many scenario questions'
assert all(v <= 4 for v in fc.values()), 'FAIL: a letter is first correct choice > 4 times'
mx = max(Counter(keys).values()) if keys else 0
assert mx <= 0.4*len(keys)+1e-9 or len(keys)==0, 'WARN: a letter exceeds 40% of correct keys'
print('OK')
"
```

Fix any failure before committing.

---

# AFTER GENERATION

- Regenerate the manifest if testing locally:
  `python3 .github/scripts/generate_manifest.py`
- The `topic_tests/` folder makes the manifest stamp this content `mode: "drill"`
  automatically — no manual `_meta.json` `mode` field required (though it is
  honored as an override if present).
- Add `_meta.json` (`label`, `description`) at the `topic_tests/`, `<topic>/`,
  and `<content>/` levels for nice display names, following the same convention
  as Exam Prep.
- The walkthrough file (`walkthroughs.md`) is optional — generate it only when
  the user explicitly requests it.
