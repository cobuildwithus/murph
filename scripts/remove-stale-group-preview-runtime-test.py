from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts"

text = TARGET.read_text(encoding="utf-8")

preview_import = "  ASSISTANT_GROUP_PHONE_CALL_PREVIEW_HEADING,\n"
if text.count(preview_import) != 1:
    raise RuntimeError(
        "expected exactly one stale group preview heading import"
    )
text = text.replace(preview_import, "", 1)

heading = "binds a late group confirmation to the preview delivery receipt"
if text.count(heading) != 1:
    raise RuntimeError(
        "expected exactly one stale late-confirmation preview test"
    )

heading_index = text.index(heading)
block_start = text.rfind("\n  it.each(", 0, heading_index)
if block_start < 0:
    raise RuntimeError("could not find the stale parameterized test start")

next_test = re.search(
    r"\n  (?:it(?:\.each)?|describe)\(",
    text[heading_index + len(heading):],
)
if next_test is None:
    raise RuntimeError("could not find the next top-level test boundary")
block_end = heading_index + len(heading) + next_test.start()
block = text[block_start:block_end]

for marker in (
    "sent_before_confirmation",
    "sent_after_confirmation",
    "retryable",
    "terminal",
    "ambiguous",
    "ASSISTANT_GROUP_PHONE_CALL_PREVIEW_HEADING",
):
    if marker not in block:
        raise RuntimeError(
            f"stale preview test block is missing expected marker: {marker}"
        )

text = text[:block_start] + text[block_end:]

for stale in (
    "ASSISTANT_GROUP_PHONE_CALL_PREVIEW_HEADING",
    heading,
):
    if stale in text:
        raise RuntimeError(f"stale preview test residue remains: {stale}")

TARGET.write_text(text, encoding="utf-8")
print("removed obsolete hosted-runtime group preview acceptance test")
