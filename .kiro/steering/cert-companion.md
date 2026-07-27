# Cert Companion — Project Steering

Persistent instructions for working on this project. These apply in every session.

---

## Project Overview

A static certification exam practice app (GitHub Pages) with Firebase backend for auth and cross-device sync. Supports multiple providers (AWS, Snowflake) and certifications with nested domain/task hierarchies.

**Key files:**
- `app.js` — all application logic
- `firebase-init.js` — Firebase SDK initialization
- `index.html` — markup shell
- `style.css` — all styling
- `manifest.json` — auto-generated (never edit manually)
- `generate_exam_questions.md` — instructions for question generation
- `build_exam_interface.md` — instructions for interface generation
- `skills.md` — tool index and project overview

**Content pattern:**
```
<provider>/<certification>/<domain_N>/<task_N>/test_N.json
```

Each directory has `_meta.json` for display metadata (label, description, weight).

---

## Git Workflow

### ALWAYS pull before committing

CI auto-commits manifest changes after every push. If you don't pull first, push will be rejected.

```bash
# If unstaged changes exist:
git stash && git pull --rebase && git stash pop

# If clean:
git pull --rebase
```

### Commit sequence

1. Pull remote changes first
2. Stage specific files (not `git add .`)
3. Commit (pre-commit hooks run automatically — prettier, trailing whitespace, JSON check)
4. If hooks modify files: re-stage modified files, commit again
5. Push

### Pre-commit hook failures

Hooks may fix files (trailing newlines, formatting). When this happens:
- The commit is rejected
- Re-stage the modified files
- Commit again — hooks will pass on second attempt

### GitHub account

This project uses `midega-g`. Verify with `gh auth status` before pushing.

---

## Question Generation Workflow

### Source material

1. User provides Snowflake documentation links
2. Fetch pages using `web_fetch` (truncated mode for full pages)
3. Assess content depth, list testable concepts, determine number of tests

### Content assessment

Before generating:
1. Categorize each page as Low/Medium/High/Very High depth
2. List key testable concepts
3. Determine test count (thin=1, medium=2, dense=3)
4. Define what each test covers
5. After all tests: gap analysis — create supplementary test only if gaps yield 20+ questions

### Test naming

- Part A / Part B pairs for topics spanning multiple tests
- Supplementary tests: `"<Parent Topic> — Supplemental"`
- Supplementary tests only when uncovered content fills a full 20 questions

### Generation rules

- 20 questions per test
- Distribution: 3 direct single + 3 direct multi + 7 scenario single + 7 scenario multi
- Multi-select correct answers must NOT cluster at the start (not always [A,B] or [A,B,C])
- Correct answers distributed across all option keys A–F
- Reference `generate_exam_questions.md` for full rules

### Validation after generation

Always run after creating a test file:

```bash
python3 -c "
import json
data = json.load(open('path/to/test_N.json'))
print(f'Questions: {len(data[\"questions\"])}')
direct_single = sum(1 for q in data['questions'] if q['scenario'] is None and q['type'] == 'single')
direct_multi = sum(1 for q in data['questions'] if q['scenario'] is None and q['type'] == 'multi')
scenario_single = sum(1 for q in data['questions'] if q['scenario'] is not None and q['type'] == 'single')
scenario_multi = sum(1 for q in data['questions'] if q['scenario'] is not None and q['type'] == 'multi')
print(f'Distribution: {direct_single}/{direct_multi}/{scenario_single}/{scenario_multi}')
from collections import Counter
correct_keys = []
for q in data['questions']:
    correct_keys.extend(q['correct'])
print(f'Correct answer distribution: {dict(Counter(correct_keys))}')
# Check multi-select clustering
for q in data['questions']:
    if q['type'] == 'multi':
        print(f'  Q{q[\"id\"]}: correct={q[\"correct\"]}')
"
```

Fix distribution (must be 3/3/7/7) and answer clustering before committing.

### Manifest regeneration

After adding/moving test files:
```bash
python3 .github/scripts/generate_manifest.py
```

---

## Firebase

- **Auth:** Email/password, required before accessing content
- **Firestore collections:**
  - `users/{uid}/sessions/{sessionKey}` — in-progress exam state
  - `users/{uid}/history/{auto-id}` — completed test results
- **Security rules:** Users can only read/write their own `users/{uid}/` path
- **Config:** Lives in `firebase-init.js` (public, safe to commit)

---

## Documentation Maintenance

**Update docs when:**
- A new command or workflow is introduced that isn't in `docs/verification-commands.md`
- A new feature changes the interface spec (`build_exam_interface.md`)
- The question generation rules change (`generate_exam_questions.md`)
- A new setup step is needed (`docs/setup/firebase-setup.md`)
- The project structure pattern changes (`skills.md`)
- A deployment or git workflow changes (`docs/deployment.md`)

**Which doc to update:**
| Change | Update |
|--------|--------|
| New validation/debug command | `docs/verification-commands.md` |
| New UI feature or view | `build_exam_interface.md` |
| Question generation rule change | `generate_exam_questions.md` |
| Firebase/infra change | `docs/setup/firebase-setup.md` |
| Git/CI/deploy workflow change | `docs/deployment.md` |
| Project structure or tool change | `skills.md` |
| New feature implementation | `docs/implementation-plan-snowpro-firebase.md` (add task) |

**Rule:** If a change introduces something new that a future session wouldn't know about, document it. If a command was run for the first time and isn't in verification-commands.md, add it.

---

## Code Style

- No CSS frameworks — plain CSS
- No npm/bundler — static site with CDN scripts
- Firebase SDK via `<script type="module">` CDN imports
- `html2pdf.js` via CDN for PDF export
- Pre-commit hooks enforce: prettier (JS/HTML), trailing whitespace, end-of-file newline, valid JSON

---

## Discovering Current State

Don't maintain a static list of tests — it goes stale. Instead, discover the live state:

```bash
# See all test files
find snowflake aws -name "test_*.json" | sort

# See folder structure
find snowflake aws -name "_meta.json" | sort

# Count tests per domain
python3 .github/scripts/generate_manifest.py > /dev/null && python3 -c "
import json
with open('manifest.json') as f:
    m = json.load(f)
def count_tests(node):
    total = 0
    if 'tests' in node: total += len(node['tests'])
    if 'children' in node:
        for c in node['children']: total += count_tests(c)
    return total
for p in m['providers']:
    print(f'{p[\"label\"]}:')
    if 'children' in p:
        for cert in p['children']:
            if 'children' in cert:
                for domain in cert['children']:
                    print(f'  {domain[\"label\"]}: {count_tests(domain)} tests')
"
```
