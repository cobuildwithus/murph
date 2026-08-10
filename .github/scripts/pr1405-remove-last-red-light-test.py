from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / "packages/assistant-engine/test/assistant-skill-assets.test.ts"
text = path.read_text(encoding="utf-8")

start_marker = "  it('keeps red light therapy registered with dose math and device seeds', async () => {"
end_marker = "  it('keeps behavior follow-through policy in the skill file with only compact bridges elsewhere', async () => {"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError("remaining red-light test range not found")
text = text[:start] + text[end:]

helper = '''function expectRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  expect(value, `${label} must be an object`).toBeTruthy()
  expect(typeof value, `${label} must be an object`).toBe('object')
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false)
}

'''
if "expectRecord(" not in text.replace(helper, "", 1):
    if text.count(helper) != 1:
        raise RuntimeError("unused expectRecord helper not found exactly once")
    text = text.replace(helper, "", 1)

path.write_text(text, encoding="utf-8")
print("Removed the final red-light device-seed test mirror")
