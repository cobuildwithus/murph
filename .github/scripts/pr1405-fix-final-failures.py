from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, text: str) -> None:
    (ROOT / relative).write_text(text, encoding="utf-8")


def replace_once(relative: str, old: str, new: str) -> None:
    text = read(relative)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one match, found {count}: {old[:140]!r}")
    write(relative, text.replace(old, new, 1))


for relative, quoted in [
    ("packages/health-commons/content/families/dry-sauna.md", True),
    ("packages/health-commons/content/families/infrared-sauna.md", False),
]:
    text = read(relative)
    if "type: \"parent_family\"" in text or "type: parent_family" in text:
        continue
    if quoted:
        insertion = '''relations:\n\n  -\n    type: "parent_family"\n    target: "experiment_family:sauna"\n'''
    else:
        insertion = '''relations:\n\n  -\n    type: parent_family\n    target: experiment_family:sauna\n'''
    replace_once(relative, "relations:\n\n", insertion)

skill_test = "packages/assistant-engine/test/assistant-skill-assets.test.ts"
text = read(skill_test)
start_marker = "  it('keeps red light therapy registered with dose math and device seeds', async () => {"
end_marker = "  it('keeps behavior follow-through policy in the skill file with only compact bridges elsewhere', async () => {"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError(f"{skill_test}: remaining red-light test range not found")
text = text[:start] + text[end:]
if text.count("expectRecord(") == 1:
    text, count = re.subn(
        r'''\nfunction expectRecord\(value: unknown, label: string\): asserts value is Record<string, unknown> \{.*?\n\}\n''',
        "\n",
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError(f"{skill_test}: unused expectRecord helper not found")
write(skill_test, text)

print("Added explicit sauna family edges and removed the remaining red-light mirror test")
