from __future__ import annotations

import shutil
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


SKILL_TEST = "packages/assistant-engine/test/assistant-skill-assets.test.ts"
text = read(SKILL_TEST)
registration = '''    expect(registeredSkillSlugs.has('red-light-therapy')).toBe(true)\n    expect(buildAssistantSkillFileRef('red-light-therapy')).toBe(\n      '$MURPH_ASSISTANT_SKILLS_ROOT/red-light-therapy/SKILL.md',\n    )\n'''
if text.count(registration) != 1:
    raise RuntimeError(f"{SKILL_TEST}: red-light registration expectations not found")
text = text.replace(registration, "", 1)
start_marker = "  it('routes red light dose ownership to the dedicated red-light skill', async () => {"
end_marker = "  it('routes general eye health with evidence and contact-lens safety boundaries', async () => {"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError(f"{SKILL_TEST}: red-light test range not found")
replacement = '''  it('keeps photobiomodulation knowledge in Health Commons instead of a topic skill', async () => {
    expect(ASSISTANT_SKILLS.some((skill) => skill.slug === 'red-light-therapy')).toBe(false)

    const recoverySkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'recovery-modalities',
    )
    expect(recoverySkill).toBeTruthy()
    if (!recoverySkill) {
      return
    }

    expect(recoverySkill.triggerHint).toContain('Health Commons')
    const recoveryText = await readSkillFile(recoverySkill)
    expect(recoveryText).toContain('Health Commons')
    expect(recoveryText).not.toContain('Use red-light-therapy')
    expect(recoveryText).not.toContain('device-seeds.json')
    await expect(
      readFile(
        path.join(
          resolveAssistantSkillsRoot(),
          'red-light-therapy',
          'SKILL.md',
        ),
        'utf8',
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

'''
text = text[:start] + replacement + text[end:]
if text.count("expectRecord(") == 1:
    helper_start = text.find("function expectRecord(")
    helper_end = text.find("\n}\n", helper_start)
    if helper_start < 0 or helper_end < 0:
        raise RuntimeError(f"{SKILL_TEST}: unused expectRecord helper range not found")
    text = text[:helper_start] + text[helper_end + 3 :]
write(SKILL_TEST, text)

skill_dir = ROOT / "packages/assistant-engine/skills/red-light-therapy"
if not skill_dir.is_dir():
    raise RuntimeError(f"Missing skill directory: {skill_dir}")
shutil.rmtree(skill_dir)

FULL_TEST = "packages/health-commons/test/knowledge-index-full-catalog.test.ts"
text = read(FULL_TEST)
marker = '''  it("returns a safety-only hard stop for sauna and fentanyl patches", () => {\n'''
red_light_test = '''  it("answers red-light questions through Health Commons without a topic-specific skill", () => {
    const result = searchQuestion("Does red light for skin improve wrinkles?");

    expect(result.topicResolved).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.sources.length > 0)).toBe(true);
    expect(packetText(result)).toMatch(/red|photo|skin|wrinkl/iu);
  });

'''
if text.count(marker) != 1:
    raise RuntimeError(f"{FULL_TEST}: insertion marker not found")
text = text.replace(marker, red_light_test + marker, 1)
write(FULL_TEST, text)

plan = "agent-docs/exec-plans/active/2026-08-07-health-commons-agent-knowledge.md"
plan_text = read(plan)
if "## Agent-facing cleanup" not in plan_text:
    plan_text += '''

## Agent-facing cleanup

- The CLI exposes one fixed-size result with only `ok`, `no_match`, or
  `unavailable`; catalog hashes and resolver bookkeeping remain internal.
- The dedicated red-light-therapy skill and manufacturer device-seed mirror were
  removed. Photobiomodulation evidence now follows the same Health Commons path
  as every other ordinary health topic; current device documentation supplies
  model-specific inputs when needed.
'''
    write(plan, plan_text)

for relative in [
    "packages/assistant-engine/src/assistant-skill-assets.ts",
    "packages/assistant-engine/src/assistant/system-prompt.ts",
    "packages/assistant-engine/skills/recovery-modalities/SKILL.md",
    "packages/assistant-engine/skills/general-eye-health/SKILL.md",
]:
    if "red-light-therapy" in read(relative):
        raise RuntimeError(f"{relative}: stale red-light-therapy routing remains")

print("Completed PR #1405 cleanup")
