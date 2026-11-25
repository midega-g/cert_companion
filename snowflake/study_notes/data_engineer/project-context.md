# SnowPro Advanced: Data Engineer (DEA-C02): working context

Read this file when context is lost. It records what is being built, where the source material is, the section plan with status, and the user's working instructions. It is deliberately kept out of the steering files. Study notes are never rendered in the app and never appear in `manifest.json`.

Last updated: 2026-11-25.

## 1. What is being built

For each exam section of the DEA-C02 blueprint:

1. A study note in `snowflake/study_notes/data_engineer/domain_N/`.
2. Practice questions in `snowflake/data_engineer/domain_N/task_M/test_K.json`, where `domain_N/task_M` equals exam section N.M. The app reports scores by domain, so this mapping must hold.

Domains 2, 3 and 4 stay as separate folders. Each folder has a `_meta.json` (label, description, and for domains a weight). Run `python3 .github/scripts/generate_manifest.py` after any structure or test change. Never edit `manifest.json` by hand.

## 2. Source material

- Official study guide PDF: `/home/home/Downloads/SnowProDataEngineerStudyGuide.pdf`.
  - Text copy: `/tmp/guide.txt`. It is temporary, so recreate it with `pdftotext -layout <pdf> /tmp/guide.txt` if it is missing.
  - Blueprint (section titles and bullets) is on pages 5 to 10. Each domain page ends with a "Study Resources" list, which is the reading list for that domain.
  - Sample questions are near lines 439 to 568 of the text copy. They are the model for question style.
  - Domain weights: 1 Data Movement 28%, 2 Performance Optimization 19%, 3 Storage and Data Protection 14%, 4 Data Governance 14%, 5 Data Transformation 25%.
- Snowflake reference pages: fetch from the Snowflake site by appending `.md` to the page path, for example `curl -sL https://docs.snowflake.com/en/user-guide/query-insights.md -o /tmp/qi.md`. Read with `grep` and `sed`. Prefer these over memory. Pages the user pastes into chat are also source material.
- Facts not verified against a Snowflake page, SQL not run in Snowflake, and my own explanations must be listed in the note's "open items and flags" section and must not be asserted as fact in questions.

## 3. Section plan and status

| Section | Title (from the study guide) | Note | Test |
|---|---|---|---|
| 1.1 | Load data | `domain_1/d1-load-data-concept.md` | `domain_1/task_1` |
| 1.2 | Ingest data of various formats | `domain_1/d1-ingest-data-formats-concept.md` | `domain_1/task_2` |
| 1.3 | Troubleshoot data ingestion | `domain_1/d1-troubleshoot-ingestion-concept.md` | `domain_1/task_3` |
| 1.4 | Continuous data pipelines | `domain_1/d1-streams-and-tasks-concept.md`, `domain_1/d1-continuous-pipelines-concept.md` | `domain_1/task_4` (2 tests) |
| 1.5 | Connectors | `domain_1/d1-connectors-concept.md` | `domain_1/task_5` |
| 1.6 | Data sharing and consumption | `domain_1/d1-data-sharing-concept.md` | `domain_1/task_6` |
| 1.7 | Tables and data operations | `domain_1/d1-tables-and-data-operations-concept.md` | `domain_1/task_7` |
| 2.1 | Troubleshoot underperforming queries | `domain_2/d2-query-troubleshooting-concept.md` | `domain_2/task_1/test_1.json` (14 questions: 9 single, 5 multi) |
| 2.2 | Configure a solution for optimal performance | to do | to do |
| 2.3 | Monitor continuous data pipelines | mostly covered by Domain 1 notes. Add a small note or section for the gaps | to do |
| 3.1 | Data recovery features (Time Travel, Fail-safe, replication) | partly covered by Domain 1 notes. Add the gaps | to do |
| 3.2 | System functions to analyze micro-partitions (clustering depth, cluster keys) | `domain_3/d3-clustering-analysis-concept.md` (draft, uncommitted) | `domain_3/task_2/test_1.json` (6 single, 3 multi, uncommitted) |
| 3.3 | Time Travel and cloning for development environments | partly covered. Add the gaps | to do |
| 4.1 | Monitor data (tags, classification, lineage, data quality) | to do | to do |
| 4.2 | Establish and maintain data protection (masking, row access, clean rooms) | partly covered. Cover the gaps | to do |
| 5.1, 5.4, 5.5 | UDFs, semi-structured, unstructured | `domain_5/` notes exist | `domain_5/task_1`, `task_4`, `task_5` |
| 5.2, 5.3, 5.6 | External functions, stored procedures, development workflows | not in the current plan. Confirm with the user before starting | none |

Order agreed so far: 2.2, 3.2, 4.1, the 4.2 gaps, then the small additions for 2.3, 3.1 and 3.3. Work one section at a time and ask before moving on.

Uncommitted at the time of writing: the 2.1 note, the Domain 2 test and `_meta.json` files, the regenerated manifest, and the wording rules added to `.kiro/steering/cert-companion.md`. Check `git status --short` for the current state.

## 4. Study note conventions

- File name: `d<N>-<topic-slug>-concept.md` (hyphenated, lowercase, no task numbers). Optional companion: `d<N>-<topic-slug>-walkthrough.md`. Cross-links must use these names.
- A new note links back to the Domain 1 sections it overlaps instead of repeating them.
- Structure used in the 2.1 note: numbered sections (2.1.1, 2.1.2 and so on), a contents list with "Back to contents" links, tables for reference facts, and an "open items and flags" section at the end.
- Under every table, explain the terms it uses in plain sentences (what a hash, a node, a partition or a spill is, and so on). Do not leave a table unexplained.
- No hard column wrapping in notes.
- Domain 1 notes: leave their "open items" sections alone and do not add examples unless the user asks.
- After writing a note, check that internal anchors and file links are not broken.

## 5. Question conventions

The general rules are in `.kiro/steering/cert-companion.md` and `.kiro/specs/generate_exam_questions.md`. The user's additional instructions for this work:

- Count and mix are set by the user for each request, and override the default 20-question blueprint. The 2.1 test has 14 questions because of that.
- Quality over coverage. No repeated topics inside one test.
- Model the study guide's sample questions: a short realistic scenario with a Data Engineer as the actor, concrete commands, parameters or values in the options, and qualifiers such as "MOST cost effectively" where they matter. Each distractor is a real feature applied to the wrong problem.
- Option length must not give the answer away. After writing, compare option lengths per question and trim or extend. If the correct option is the longest, rebalance unless the identifier itself forces it.
- Spread correct keys across the options. Each letter should appear at least once. Multi-select must not use `[A,B]` or `[A,B,C]`.
- Every wrong option has its own explanation. Distractor keys are alphabetical and equal the option keys minus the correct keys.
- Use only facts from the note or a fetched Snowflake page. Avoid anything flagged in the note's open items.
- Never use the words "docs" or "documentation" in notes, questions, options or explanations. Say "Snowflake" or name the feature or page.
- Never reveal answer keys in chat. When questions are written to a file, report only the path, the question count and the validation result. When showing questions for review, show the stem and options without keys, and report balance only as aggregate counts per letter.
- When the user says "don't write to the console", write the file and do not print the questions.
- Test JSON format (see `snowflake/data_engineer/domain_5/task_1/test_1.json`): top-level `label`, `order`, `topic`, `questions`. Each question has `id`, `type` ("single" or "multi"), `domain` (topic tag), `scenario`, `stem`, `options` (list of `{key, text}`), `correct` (list of keys) and `explanation` (`correct` string plus `distractors` map).
- Validate after writing: question count, type mix, correct-key counts, distractor keys against options, multi-select clustering, banned words, option-length spread.

## 6. Chat style

- Plain and concise. No filler, no preamble, no closing summary.
- Report what was done and what is still open. Do not repeat the content of files.

## 7. Git rules

- Commit and push only when asked. Ask before pushing.
- Split into logical commits (for example note, test with its `_meta.json` and manifest, steering change).
- Pull before committing. Run `gh auth status` and confirm the `midega-g` account.
- Stage specific paths only, never `git add .`. Do not stash. Do not use destructive commands (`git checkout --`, `reset --hard`, force push) without asking. Use `git mv` for moves.
- Pre-commit hooks may modify files (trailing whitespace, JSON, prettier). Re-stage and commit again.
- CI commits `manifest.json` after pushes, so the remote is often ahead.

## 8. Resuming after a context loss

1. Read this file, then `.kiro/steering/router.md` and `.kiro/steering/cert-companion.md`.
2. Run `git status --short` and `git log --oneline -5` to see what is uncommitted.
3. Find the next "to do" row in section 3 and confirm it with the user.
4. Re-create `/tmp/guide.txt` if needed and fetch the Snowflake pages for that section.
