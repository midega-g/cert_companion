# Deployment & Troubleshooting Guide

## Local Development

### Running the app locally

The app is purely static. You need a local server to avoid CORS errors when fetching JSON files.

```bash
# Python (no install needed)
python3 -m http.server 8000
# Open http://localhost:8000

# Node.js (via npx, no global install)
npx serve .
# Open http://localhost:3000
```

### Regenerating the manifest locally

After adding or moving test files, regenerate the manifest to verify the structure before pushing:

```bash
python3 .github/scripts/generate_manifest.py
```

This writes `manifest.json` to the repo root and prints the output for inspection.

### Validating JSON files

```bash
# Check a single file
python3 -c "import json; json.load(open('path/to/test_1.json'))"

# Check all test files
find . -name "test_*.json" -exec python3 -c "import json,sys; json.load(open(sys.argv[1])); print(f'OK: {sys.argv[1]}')" {} \;
```

### Validating app.js syntax

```bash
node --check app.js
```

---

## Deployment Pipeline

### How it works

1. You push to `main` (directly or via PR merge).
2. GitHub Actions runs `.github/workflows/generate-manifest.yml`.
3. The workflow regenerates `manifest.json` from the current directory structure.
4. If `manifest.json` changed, it auto-commits and pushes the update.
5. GitHub Pages deploys the updated site.

### The CI auto-commit problem

Because CI commits back to `main` after your push, your local `main` becomes behind the remote. This is the most common error you'll hit:

```
! [rejected] main -> main (fetch first)
error: failed to push some refs
hint: Updates were rejected because the remote contains work that you do not have locally.
```

**Why it happens:** You pushed commit A. CI then pushed commit B (manifest update) on top of A. When you try to push commit C, git rejects it because your local branch doesn't have commit B.

### Solution: rebase onto the CI commit

```bash
git pull --rebase
```

This replays your local commits on top of the remote (including CI's manifest commit). If there's a conflict in `manifest.json` (almost always the case), resolve it by regenerating:

```bash
# During a rebase conflict on manifest.json:
python3 .github/scripts/generate_manifest.py
git add manifest.json
git rebase --continue
```

Then push normally:

```bash
git push
```

### If the rebase gets messy

```bash
# Abort and start over
git rebase --abort

# Pull with merge instead (creates a merge commit but avoids conflict hell)
git pull --no-rebase
python3 .github/scripts/generate_manifest.py
git add manifest.json
git commit -m "chore: resolve manifest conflict"
git push
```

### Preventing the issue

The simplest prevention: after pushing, wait a few seconds for CI to commit, then pull before making more changes:

```bash
git push
# wait ~10 seconds
git pull
```

Or just always `git pull --rebase` before pushing.

---

## Common Errors & Fixes

### Pre-commit hook failures

Pre-commit hooks run automatically on `git commit`. If they modify files (e.g., fixing trailing whitespace, reformatting), the commit is rejected and you need to re-stage and retry:

```bash
# After pre-commit modifies files:
git add -A
git commit -m "your message"  # retry — hooks will pass this time
```

### Accidentally committed a PDF

PDFs are gitignored, but if one slips through (e.g., before the ignore rule existed):

```bash
# Remove from git tracking without deleting the local file
git rm --cached "path/to/file.pdf"
git commit -m "fix: remove accidentally tracked PDF"
```

### Untracked files blocking rebase/merge

If git says "untracked working tree files would be overwritten by merge":

```bash
# Move the file temporarily
mv "problematic-file" /tmp/
git rebase --continue
# Move it back after
mv /tmp/problematic-file .
```

### Force push after rebase (use carefully)

If you've rebased and the remote rejects a normal push:

```bash
# Safe force push — only overwrites if no one else pushed in between
git push --force-with-lease
```

Only use this on branches you own. Avoid on `main` unless you're the sole contributor.

---

## Pre-push Checklist

Before pushing to `main`:

1. Run the manifest generator and verify output looks correct
2. Validate JSON syntax on any new/modified test files
3. Run `node --check app.js` if you touched the app
4. Open the app locally and click through the navigation to the new content
5. `git pull --rebase` to pick up any CI commits

---

## GitHub Pages

The site is served from the `main` branch root. No build step is needed — GitHub Pages serves the static files directly.

- **URL**: Check repository Settings → Pages for the live URL
- **Deploy time**: Changes appear within 1–2 minutes of pushing to `main`
- **Cache**: If changes don't appear, hard-refresh (Ctrl+Shift+R) or clear browser cache
