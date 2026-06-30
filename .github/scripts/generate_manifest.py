#!/usr/bin/env python3
"""
Auto-generates manifest.json by walking the repository tree.

Structure supported (any depth):
  <provider>/test_N.json
  <provider>/<topic>/test_N.json
  <provider>/<topic>/<subtopic>/test_N.json
  <provider>/<topic>/<subtopic>/<...>/test_N.json

The first directory level is always the provider (e.g., snowflake, aws).
Any leaf directory containing test_N.json files becomes a "topic" in the manifest.
The topic label is built from all intermediate folder names joined with " > ".

Each test_N.json may contain optional top-level fields:
  "label": string         — display name shown in the UI (falls back to "Test N")
  "order": int            — explicit sort position within the topic (falls back to N)
  "questionType": string  — e.g. "recall" (passed through to manifest)

Outputs manifest.json at the repo root.
"""

import json
import os
import re

SKIP_DIRS = {".git", ".github", "node_modules", ".vscode", ".ruff_cache", "sources"}
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEST_PATTERN = re.compile(r"test_(\d+)\.json")


def to_label(name: str) -> str:
    """Convert a folder id to a display label.

    Handles acronyms (AI, AWS, GCP, etc.) by uppercasing known words.
    """
    ACRONYMS = {
        "ai",
        "aws",
        "gcp",
        "iam",
        "vpc",
        "ec2",
        "s3",
        "rds",
        "sql",
        "api",
        "dr",
        "ui",
        "cd",
        "ci",
    }
    words = name.replace("-", " ").replace("_", " ").split()
    return " ".join(w.upper() if w.lower() in ACRONYMS else w.title() for w in words)


def test_sort_key(filename: str) -> int:
    match = TEST_PATTERN.fullmatch(filename)
    return int(match.group(1)) if match else 0


def read_test_metadata(filepath: str) -> dict:
    """Read optional fields from a test JSON file."""
    try:
        with open(filepath, encoding="utf-8") as f:
            data = json.load(f)
        return {
            "label": data.get("label"),
            "order": data.get("order"),
            "questionType": data.get("questionType"),
        }
    except Exception:
        return {}


def find_test_dirs(
    base_path: str, rel_parts: list[str] = None
) -> list[tuple[str, list[str]]]:
    """Recursively find all directories containing test_N.json files.

    Returns list of (absolute_path, relative_path_parts) tuples.
    """
    if rel_parts is None:
        rel_parts = []

    results = []

    try:
        entries = sorted(os.scandir(base_path), key=lambda e: e.name)
    except PermissionError:
        return results

    # Check if this directory has test files
    test_files = [
        e.name for e in entries if e.is_file() and TEST_PATTERN.fullmatch(e.name)
    ]
    if test_files:
        results.append((base_path, list(rel_parts)))

    # Recurse into subdirectories
    for entry in entries:
        if entry.is_dir() and entry.name not in SKIP_DIRS:
            results.extend(find_test_dirs(entry.path, rel_parts + [entry.name]))

    return results


def build_manifest(root: str) -> dict:
    providers = []

    top_level = sorted(
        entry.name
        for entry in os.scandir(root)
        if entry.is_dir() and entry.name not in SKIP_DIRS
    )

    for provider_id in top_level:
        provider_path = os.path.join(root, provider_id)
        topics = []

        # Find all directories with test files under this provider
        test_dirs = find_test_dirs(provider_path)

        for dir_path, rel_parts in test_dirs:
            # Build topic id from relative path parts
            topic_id = "/".join(rel_parts) if rel_parts else provider_id
            # Topic label uses only the leaf (deepest) folder name
            topic_label = (
                to_label(rel_parts[-1]) if rel_parts else to_label(provider_id)
            )

            # Collect test files
            test_files = sorted(
                [f for f in os.listdir(dir_path) if TEST_PATTERN.fullmatch(f)],
                key=test_sort_key,
            )

            tests = []
            for f in test_files:
                n = TEST_PATTERN.fullmatch(f).group(1)
                filepath = os.path.join(dir_path, f)
                meta = read_test_metadata(filepath)

                # Build the path relative to repo root
                rel_path_from_root = os.path.relpath(filepath, root).replace(
                    os.sep, "/"
                )

                fallback_label = f"Test {n}"
                label = meta.get("label") or fallback_label
                order_val = meta.get("order")
                order = int(order_val) if order_val is not None else int(n)

                entry = {
                    "id": f.replace(".json", ""),
                    "label": label,
                    "path": rel_path_from_root,
                    "_order": order,
                }
                if meta.get("questionType"):
                    entry["questionType"] = meta["questionType"]
                tests.append(entry)

            # Sort by explicit order, then strip internal field
            tests.sort(key=lambda t: t["_order"])
            for t in tests:
                del t["_order"]

            topics.append(
                {
                    "id": topic_id,
                    "label": topic_label,
                    "tests": tests,
                }
            )

        if topics:
            providers.append(
                {
                    "id": provider_id,
                    "label": to_label(provider_id),
                    "topics": topics,
                }
            )

    return {"providers": providers}


if __name__ == "__main__":
    manifest = build_manifest(ROOT)
    output_path = os.path.join(ROOT, "manifest.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"manifest.json written to {output_path}")
    print(json.dumps(manifest, indent=2))
