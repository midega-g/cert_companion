#!/usr/bin/env python3
"""
Auto-generates manifest.json by walking the repository tree.

Structure expected:
  <provider>/<topic>/test_N.json

Outputs manifest.json at the repo root.
"""

import json
import os
import re

SKIP_DIRS = {".git", ".github", "node_modules"}
SKIP_FILES = {"index.html", "manifest.json"}
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def to_label(name: str) -> str:
    """Convert a folder/file id to a display label.

    Examples:
        'snowflake'         -> 'Snowflake'
        'virtual-machines'  -> 'Virtual Machines'
        'test_1'            -> 'Test 1'
    """
    # Handle test_N pattern
    match = re.fullmatch(r"test_(\d+)", name)
    if match:
        return f"Test {match.group(1)}"
    # General: replace hyphens/underscores with spaces and title-case
    return name.replace("-", " ").replace("_", " ").title()


def test_sort_key(filename: str) -> int:
    """Return the numeric index from test_N.json, or 0 if not matched."""
    match = re.fullmatch(r"test_(\d+)\.json", filename)
    return int(match.group(1)) if match else 0


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

        topic_dirs = sorted(
            entry.name
            for entry in os.scandir(provider_path)
            if entry.is_dir()
        )

        for topic_id in topic_dirs:
            topic_path = os.path.join(provider_path, topic_id)
            test_files = sorted(
                [
                    f
                    for f in os.listdir(topic_path)
                    if re.fullmatch(r"test_\d+\.json", f)
                ],
                key=test_sort_key,
            )

            if not test_files:
                continue

            tests = [
                {
                    "id": f.replace(".json", ""),
                    "label": to_label(f.replace(".json", "")),
                    "path": f"{provider_id}/{topic_id}/{f}",
                }
                for f in test_files
            ]

            topics.append(
                {
                    "id": topic_id,
                    "label": to_label(topic_id),
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
