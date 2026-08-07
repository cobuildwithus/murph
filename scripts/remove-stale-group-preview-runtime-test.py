from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts"
TOP_LEVEL_TEST_START = re.compile(
    r"(?m)^  (?:it|test|describe)(?:\.|\b)"
)
PREVIEW_IMPORT_SYMBOLS = (
    "ASSISTANT_GROUP_PHONE_CALL_PREVIEW_HEADING",
    "hasDeliveredAssistantGroupPhoneCallPreview",
)
PREVIEW_RESIDUE = (
    *PREVIEW_IMPORT_SYMBOLS,
    "ASSISTANT_GROUP_PHONE_CALL_NO_TRANSFER_LINE",
    "renderAssistantGroupPhoneCallPreview",
    "resolveDeliveredAssistantGroupPhoneCallPreviewAuthority",
    "AssistantGroupPhoneCallPreviewAuthority",
)

text = TARGET.read_text(encoding="utf-8")

heading = "binds a late group confirmation to the preview delivery receipt"
if text.count(heading) != 1:
    raise RuntimeError(
        "expected exactly one stale late-confirmation preview test"
    )

heading_index = text.index(heading)
import_region = text[:heading_index]
for symbol in PREVIEW_IMPORT_SYMBOLS:
    import_region, import_count = re.subn(
        rf"(?m)^[ \t]*{symbol},?[ \t]*\n",
        "",
        import_region,
        count=1,
    )
    if import_count != 1:
        raise RuntimeError(
            f"expected exactly one standalone stale preview import: {symbol}"
        )
text = import_region + text[heading_index:]
heading_index = text.index(heading)

starts = list(TOP_LEVEL_TEST_START.finditer(text))
prior_starts = [match for match in starts if match.start() < heading_index]
next_starts = [match for match in starts if match.start() > heading_index]
if not prior_starts:
    raise RuntimeError("could not find the stale top-level test start")
if not next_starts:
    raise RuntimeError("could not find the next top-level test boundary")

block_start = prior_starts[-1].start()
block_end = next_starts[0].start()
block = text[block_start:block_end]

for marker in (
    "sent_before_confirmation",
    "sent_after_confirmation",
    "retryable",
    "terminal",
    "ambiguous",
    *PREVIEW_IMPORT_SYMBOLS,
):
    if marker not in block:
        raise RuntimeError(
            f"stale preview test block is missing expected marker: {marker}"
        )

text = text[:block_start] + text[block_end:]

for stale in (*PREVIEW_RESIDUE, heading):
    if stale in text:
        raise RuntimeError(f"stale preview test residue remains: {stale}")

TARGET.write_text(text, encoding="utf-8")
print("removed obsolete hosted-runtime group preview acceptance test")
