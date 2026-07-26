# Verification Commands

Commands used to validate changes after implementation. Run these from the project root.

---

## Regenerate the Manifest

```bash
python3 .github/scripts/generate_manifest.py
```

**Purpose:** Rebuilds `manifest.json` from the current directory structure. This is what GitHub Actions runs on push, but running it locally lets you verify the structure before committing.

**What it does:**
- Walks all top-level directories (skips `.git`, `.github`, `node_modules`, `.vscode`, `.ruff_cache`, `sources`)
- Treats each top-level folder as a provider (`aws`, `snowflake`)
- Recursively builds a tree of nodes from subdirectories
- Reads `_meta.json` in each directory for label/description overrides
- Reads `label` and `order` fields from each `test_N.json` file
- Outputs `manifest.json` at the repo root and prints the full JSON to stdout

**When to run:** After adding, moving, or renaming any folder or test file.

**What to check in output:**
- New folders appear in the tree with correct labels and descriptions
- Test files appear under the right parent node
- No orphaned or misplaced entries

---

## Validate All JSON Files

```bash
find . -name "*.json" -not -path "./.ruff_cache/*" -not -path "./.git/*" -exec python3 -c "import json,sys; json.load(open(sys.argv[1])); print(f'OK: {sys.argv[1]}')" {} \;
```

**Purpose:** Confirms every JSON file in the project is syntactically valid. Catches trailing commas, missing brackets, encoding issues.

**What it does:**
- Finds all `.json` files (excluding cache/git directories)
- Attempts to parse each with Python's `json.load()`
- Prints `OK: <path>` for valid files
- Throws a `json.decoder.JSONDecodeError` with line/column for invalid files

**When to run:** After generating new test files or manually editing JSON.

---

## Validate a Single JSON File

```bash
python3 -c "import json; json.load(open('path/to/test_1.json'))"
```

**Purpose:** Quick check on one specific file. Useful right after creating a new test.

**What it does:** Same as above, scoped to one file. No output means success; an exception means invalid JSON.

---

## Check app.js Syntax

```bash
node --check app.js
```

**Purpose:** Verifies the JavaScript file has no syntax errors without executing it.

**What it does:**
- Node.js parses the file into an AST
- Reports syntax errors (missing brackets, invalid tokens, etc.)
- Does NOT execute the code or check runtime behavior

**When to run:** After modifying `app.js`.

---

## Run the App Locally

```bash
python3 -m http.server 8000
```

**Purpose:** Starts a local web server for manual testing. Required because the app uses `fetch()` to load JSON, which doesn't work with `file://` URLs due to CORS.

**What it does:**
- Serves the current directory on `http://localhost:8000`
- Any browser can hit it to test navigation, test loading, and exam flow

**Alternative (Node.js):**
```bash
npx serve .
```

**When to run:** For manual smoke testing — click through the navigation to verify new content appears correctly.

---

## Verify Snowflake Structure Specifically

```bash
find snowflake -type f | sort
```

**Purpose:** Lists every file under the `snowflake/` directory in sorted order. Quick visual check that the folder hierarchy matches the expected domain/task layout.

**What to check:**
- Each domain has a `_meta.json`
- Each task within a domain has a `_meta.json`
- Test files are in the correct task folders
- No stray files in unexpected locations

---

## Inspect the Manifest (Snowflake Section Only)

```bash
python3 -c "
import json
with open('manifest.json') as f:
    m = json.load(f)
sf = next(p for p in m['providers'] if p['id'] == 'snowflake')
print(json.dumps(sf, indent=2))
"
```

**Purpose:** Extracts and pretty-prints just the Snowflake provider from the manifest. Easier to read than the full file when you only changed Snowflake content.

**What to check:**
- `snowpro_core` appears as a child with correct label/description
- Domains appear with weights in description
- Tasks appear with correct labels
- Tests are listed with correct paths and labels

---

## Inspect the Manifest (AWS Section Only)

```bash
python3 -c "
import json
with open('manifest.json') as f:
    m = json.load(f)
aws = next(p for p in m['providers'] if p['id'] == 'aws')
print(json.dumps(aws, indent=2))
"
```

**Purpose:** Same as above but for the AWS provider.

---

## Count Tests Per Domain

```bash
python3 -c "
import json
with open('manifest.json') as f:
    m = json.load(f)

def count_tests(node):
    total = 0
    if 'tests' in node:
        total += len(node['tests'])
    if 'children' in node:
        for child in node['children']:
            total += count_tests(child)
    return total

for provider in m['providers']:
    print(f\"\n{provider['label']}:\")
    if 'children' in provider:
        for child in provider['children']:
            if 'children' in child:
                for domain in child['children']:
                    desc = domain.get('description', '')
                    tests = count_tests(domain)
                    print(f\"  {domain['label']}: {tests} tests — {desc}\")
"
```

**Purpose:** Shows how many tests exist per domain across all providers. Helps identify domains that still need content.

**When to run:** To check coverage gaps — domains with 0 tests need question generation.

---

## Pre-push Checklist (All in One)

```bash
python3 .github/scripts/generate_manifest.py > /dev/null && \
find . -name "*.json" -not -path "./.ruff_cache/*" -not -path "./.git/*" -exec python3 -c "import json,sys; json.load(open(sys.argv[1]))" {} \; && \
node --check app.js && \
echo "All checks passed ✓"
```

**Purpose:** Runs all validation steps in sequence. If any step fails, the chain stops and reports the error. If all pass, prints the success message.

**When to run:** Before every `git push`.
