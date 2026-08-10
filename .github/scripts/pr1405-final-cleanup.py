from __future__ import annotations

import re
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
        raise RuntimeError(f"{relative}: expected one literal match, found {count}: {old[:140]!r}")
    write(relative, text.replace(old, new, 1))


def replace_regex_once(relative: str, pattern: str, replacement: str) -> None:
    text = read(relative)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one regex match, found {count}: {pattern}")
    write(relative, updated)


# A broad authored family alias can expand to typed child families, while
# experiment-family aliases remain isolated from child protocols.
replace_once(
    "packages/health-commons/src/knowledge-index.ts",
    '''        insertTopicOwner.run(normalizeTopicPhrase(parent.title), parent.key, entity.key, 0);\n''',
    '''        insertTopicOwner.run(normalizeTopicPhrase(parent.title), parent.key, entity.key, 0);\n        if (entity.entityType === "experiment_family") {\n          for (const alias of parent.aliases ?? []) {\n            insertTopicOwner.run(\n              normalizeTopicPhrase(alias),\n              parent.key,\n              entity.key,\n              1,\n            );\n          }\n        }\n''',
)

# Keep the public agent contract to one question and one compact status packet.
CLI = "packages/cli/src/commands/commons.ts"
replace_once(CLI, "  HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT,\n", "")
replace_once(
    CLI,
    '''export const commonsKnowledgeSearchResultSchema = z.object({\n  available: z.boolean(),\n  catalogHash: z.string(),\n  items: z.array(commonsKnowledgeItemSchema),\n  query: z.string().min(1),\n  safety: commonsKnowledgeItemSchema.nullable(),\n  topicResolved: z.boolean(),\n  warning: z.string().min(1).nullable(),\n});\n''',
    '''export const commonsKnowledgeSearchResultSchema = z.object({\n  status: z.enum(["ok", "no_match", "unavailable"]),\n  items: z.array(commonsKnowledgeItemSchema),\n  query: z.string().min(1),\n  safety: commonsKnowledgeItemSchema.nullable(),\n  warning: z.string().min(1).nullable(),\n});\n''',
)
replace_regex_once(
    CLI,
    r'''  knowledge\.command\("search", \{\n    description:.*?\n  \}\);\n\n  protocol\.command\("list",''',
    '''  knowledge.command("search", {
    description:
      "Return one small source-backed evidence and safety packet for a natural-language health question.",
    args: z.object({
      query: z.string().min(2).max(480),
    }),
    options: z.object({}),
    examples: [{
      description: "Ask an ordinary health question about dry sauna.",
      args: { query: "Does Finnish dry sauna improve immunity, and is it safe after fainting?" },
    }],
    output: commonsKnowledgeSearchResultSchema,
    run({ args }) {
      try {
        const result = searchGeneratedHealthCommonsKnowledge({ query: args.query });
        return commonsKnowledgeSearchResultSchema.parse({
          status: result.items.length > 0 || result.safety ? "ok" : "no_match",
          items: result.items,
          query: result.query,
          safety: result.safety,
          warning: null,
        });
      } catch {
        return commonsKnowledgeSearchResultSchema.parse({
          status: "unavailable",
          items: [],
          query: args.query,
          safety: null,
          warning: "Health Commons knowledge index is unavailable; continue without corpus context.",
        });
      }
    },
  });

  protocol.command("list",''',
)

CLI_TEST = "packages/cli/test/commons-command-coverage.test.ts"
text = read(CLI_TEST)
text = text.replace(
    '''    available: boolean;\n    items: Array<{\n''',
    '''    status: "ok" | "no_match" | "unavailable";\n    items: Array<{\n''',
    1,
)
text = text.replace('''    safety: { kind: string } | null;\n    topicResolved: boolean;\n''', '''    safety: { kind: string } | null;\n''', 1)
text = text.replace('''    "What does the evidence say about Finnish Dry Sauna?",\n    "--limit",\n    "3",\n''', '''    "What does the evidence say about Finnish Dry Sauna?",
''', 1)
text = text.replace('''  assert.equal(data.available, true);\n  assert.equal(data.topicResolved, true);\n''', '''  assert.equal(data.status, "ok");
  assert.equal("catalogHash" in data, false);
  assert.equal("topicResolved" in data, false);
''', 1)
text = text.replace('''    available: boolean;\n    items: unknown[];\n''', '''    status: "ok" | "no_match" | "unavailable";
    items: unknown[];
''', 1)
text = text.replace('''  assert.equal(data.available, true);\n  assert.deepEqual(data.items, []);\n''', '''  assert.equal(data.status, "ok");
  assert.deepEqual(data.items, []);
''', 1)
text = text.replace(
    'test("commons knowledge search rejects a packet larger than three items", async () => {',
    'test("commons knowledge search exposes no result-size tuning", async () => {',
    1,
)
text = text.replace('''      available: boolean;\n        items: unknown[];\n      warning: string | null;\n''', '''      status: "ok" | "no_match" | "unavailable";
      items: unknown[];
      warning: string | null;
''', 1)
text = text.replace('''    assert.equal(data.available, false);\n    assert.deepEqual(data.items, []);\n''', '''    assert.equal(data.status, "unavailable");
    assert.deepEqual(data.items, []);
''', 1)
no_match_test = '''
test("commons knowledge search reports no match without leaking internal resolver state", async () => {
  const result = await runInProcessJsonCli<{
    status: "ok" | "no_match" | "unavailable";
    items: unknown[];
    safety: unknown | null;
  }>(createCommonsSliceCli(), [
    "commons",
    "knowledge",
    "search",
    "Does unsupported quux therapy improve health?",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.status, "no_match");
  assert.deepEqual(data.items, []);
  assert.equal(data.safety, null);
  assert.equal("catalogHash" in data, false);
  assert.equal("topicResolved" in data, false);
});

'''
marker = 'test("commons knowledge search exposes no result-size tuning", async () => {'
if text.count(marker) != 1:
    raise RuntimeError(f"{CLI_TEST}: limit-test marker not found")
text = text.replace(marker, no_match_test + marker, 1)
write(CLI_TEST, text)

# Remove the topic-specific red-light knowledge mirror. Health Commons is the
# evidence owner; current device documentation supplies model-specific inputs.
REGISTRY = "packages/assistant-engine/src/assistant-skill-assets.ts"
replace_once(
    REGISTRY,
    '''  {\n    slug: 'red-light-therapy',\n    name: 'red-light-therapy',\n    triggerHint:\n      'Use for red light therapy or photobiomodulation questions, including dosing, session duration, treatment distance, wavelengths, device irradiance, Bestqool lamps, safety boundaries, and whether to set up a bounded Health Commons PBM experiment.',\n  },\n''',
    "",
)
replace_once(
    REGISTRY,
    '''      'Use for sauna, cold plunge, contrast therapy, compression, massage, foam rolling, percussion guns, stretching-as-recovery, breathwork-as-recovery, and recovery modality tradeoffs. Use red-light-therapy for red/NIR photobiomodulation dose, duration, distance, wavelengths, device irradiance, or Bestqool questions.',\n''',
    '''      'Use for sauna, cold plunge, contrast therapy, compression, massage, foam rolling, percussion guns, stretching-as-recovery, breathwork-as-recovery, and recovery modality tradeoffs. Red/NIR photobiomodulation evidence comes from the ordinary Health Commons lookup; use current device documentation for model-specific dose inputs.',\n''',
)
replace_once(
    "packages/assistant-engine/skills/recovery-modalities/SKILL.md",
    '''- Use red-light-therapy for red/NIR photobiomodulation dose, duration, distance, wavelengths, device irradiance, Bestqool lamps, or PBM experiment setup.\n- This skill does not own PBM device-dose math.\n''',
    '''- Red/NIR photobiomodulation evidence comes from the ordinary Health Commons lookup. Use current official device documentation and ordinary calculation for model-specific dose inputs.\n''',
)
replace_once(
    "packages/assistant-engine/skills/general-eye-health/SKILL.md",
    '''- Use red-light-therapy for photobiomodulation devices, dose, and device-specific eye-exposure precautions; return here for eye symptoms or vision changes.\n''',
    '''- For photobiomodulation evidence, use the ordinary Health Commons lookup and current official device documentation; return here for eye symptoms or vision changes.\n''',
)
replace_once(
    "packages/assistant-engine/src/assistant/system-prompt.ts",
    '''    "- Training/movement: daily-activity owns factual wearable day/workout reads; running-cardio and strength-training own programming; aerobic-fitness, competition-training, mobility-posture, physical-therapy, recovery-modalities, red-light-therapy.",\n''',
    '''    "- Training/movement: daily-activity owns factual wearable day/workout reads; running-cardio and strength-training own programming; aerobic-fitness, competition-training, mobility-posture, physical-therapy, recovery-modalities.",\n''',
)
replace_once(
    "packages/assistant-engine/test/model-behavior.test.ts",
    '''      'Training/movement: daily-activity owns factual wearable day/workout reads; running-cardio and strength-training own programming; aerobic-fitness, competition-training, mobility-posture, physical-therapy, recovery-modalities, red-light-therapy.',\n''',
    '''      'Training/movement: daily-activity owns factual wearable day/workout reads; running-cardio and strength-training own programming; aerobic-fitness, competition-training, mobility-posture, physical-therapy, recovery-modalities.',\n''',
)

SKILL_TEST = "packages/assistant-engine/test/assistant-skill-assets.test.ts"
text = read(SKILL_TEST)
text = text.replace(
    '''    expect(registeredSkillSlugs.has('red-light-therapy')).toBe(true)\n    expect(buildAssistantSkillFileRef('red-light-therapy')).toBe(\n      '$MURPH_ASSISTANT_SKILLS_ROOT/red-light-therapy/SKILL.md',\n    )\n''',
    "",
    1,
)
replacement_test = '''
  it('keeps photobiomodulation knowledge in Health Commons instead of a topic skill', async () => {
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

  it('routes general eye health with evidence and contact-lens safety boundaries', async () => {'''
text, count = re.subn(
    r'''\n  it\('routes red light dose ownership to its dedicated skill', async \(\) => \{.*?\n  it\('routes general eye health with evidence and contact-lens safety boundaries', async \(\) => \{''',
    replacement_test,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError(f"{SKILL_TEST}: red-light test blocks not found")
if text.count("expectRecord(") == 1:
    text, count = re.subn(
        r'''\nfunction expectRecord\(value: unknown, label: string\): asserts value is Record<string, unknown> \{.*?\n\}\n''',
        "\n",
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError(f"{SKILL_TEST}: unused expectRecord helper not found")
write(SKILL_TEST, text)

shutil.rmtree(ROOT / "packages/assistant-engine/skills/red-light-therapy")

for relative in [
    REGISTRY,
    "packages/assistant-engine/src/assistant/system-prompt.ts",
    "packages/assistant-engine/skills/recovery-modalities/SKILL.md",
    "packages/assistant-engine/skills/general-eye-health/SKILL.md",
]:
    if "red-light-therapy" in read(relative):
        raise RuntimeError(f"{relative}: stale red-light-therapy routing remains")

plan = "agent-docs/exec-plans/active/2026-08-07-health-commons-agent-knowledge.md"
plan_text = read(plan)
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

print("Applied final PR #1405 cleanup")
