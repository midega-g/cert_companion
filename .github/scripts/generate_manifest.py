#!/usr/bin/env python3
"""
Auto-generates manifest.json by walking the repository tree.

Structure supported (any depth):
  <provider>/test_N.json
  <provider>/<topic>/test_N.json
  <provider>/<topic>/<subtopic>/test_N.json
  <provider>/<topic>/<subtopic>/<...>/test_N.json

The first directory level is always the provider (e.g., snowflake, aws).
Intermediate directories become navigable nodes in the UI.
Leaf directories (containing test_N.json files) become the final topic.

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

# Words that should remain fully uppercased
UPPERCASE_WORDS = {
    "ai",
    "aws",
    "gcp",
    "iam",
    "vpc",
    "api",
    "sql",
    "ml",
    "dr",
    "ui",
    "ci",
    "cd",
}


def to_label(name: str) -> str:
    """Convert a folder id to a display label with smart casing."""
    words = name.replace("-", " ").replace("_", " ").split()
    result = []
    for word in words:
        if word.lower() in UPPERCASE_WORDS:
            result.append(word.upper())
        else:
            result.append(word.capitalize())
    return " ".join(result)


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


def build_node(
    dir_path: str, node_id: str, node_label: str, rel_root: str
) -> dict | None:
    """Recursively build a tree node for a directory.

    Returns a node dict or None if the directory has no test content.
    A node can have:
      - "tests" if it contains test_N.json files (leaf node)
      - "children" if it has subdirectories with test content (branch node)
      - both if it has tests AND subdirectories with tests
    """
    try:
        entries = sorted(os.scandir(dir_path), key=lambda e: e.name)
    except PermissionError:
        return None

    # Check for test files in this directory
    test_files = sorted(
        [e.name for e in entries if e.is_file() and TEST_PATTERN.fullmatch(e.name)],
        key=test_sort_key,
    )

    # Check for child directories
    child_dirs = [e for e in entries if e.is_dir() and e.name not in SKIP_DIRS]

    tests = []
    children = []

    # Build tests list if this directory has test files
    if test_files:
        for f in test_files:
            n = TEST_PATTERN.fullmatch(f).group(1)
            filepath = os.path.join(dir_path, f)
            meta = read_test_metadata(filepath)

            rel_path = os.path.relpath(filepath, rel_root).replace(os.sep, "/")
            fallback_label = f"Test {n}"
            label = meta.get("label") or fallback_label
            order_val = meta.get("order")
            order = int(order_val) if order_val is not None else int(n)

            entry = {
                "id": f.replace(".json", ""),
                "label": label,
                "path": rel_path,
                "_order": order,
            }
            if meta.get("questionType"):
                entry["questionType"] = meta["questionType"]
            tests.append(entry)

        tests.sort(key=lambda t: t["_order"])
        for t in tests:
            del t["_order"]

    # Recursively build children
    for child_entry in child_dirs:
        child_node = build_node(
            child_entry.path,
            child_entry.name,
            to_label(child_entry.name),
            rel_root,
        )
        if child_node:
            children.append(child_node)

    # If nothing found, return None
    if not tests and not children:
        return None

    node = {
        "id": node_id,
        "label": node_label,
    }

    if children:
        node["children"] = children
    if tests:
        node["tests"] = tests

    return node


def build_manifest(root: str) -> dict:
    providers = []

    top_level = sorted(
        entry.name
        for entry in os.scandir(root)
        if entry.is_dir() and entry.name not in SKIP_DIRS
    )

    for provider_id in top_level:
        provider_path = os.path.join(root, provider_id)
        provider_node = build_node(
            provider_path, provider_id, to_label(provider_id), root
        )
        if provider_node:
            providers.append(provider_node)

    return {"providers": providers}


if __name__ == "__main__":
    manifest = build_manifest(ROOT)
    output_path = os.path.join(ROOT, "manifest.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"manifest.json written to {output_path}")
    print(json.dumps(manifest, indent=2))
