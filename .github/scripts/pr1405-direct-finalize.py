from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path.cwd()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return updated


def update_topic_ownership() -> None:
    path = "packages/health-commons/src/knowledge-index.ts"
    text = read(path)
    old = '''    for (const entity of catalog.entities) {
      if (entity.entityType !== "source_artifact") {
        for (const [index, phrase] of [entity.title, ...(entity.aliases ?? [])].entries()) {
          if (index === 0 && hasSameTitleParent(entity, entitiesByKey)) {
            continue;
          }
          insertTopicOwner.run(normalizeTopicPhrase(phrase), entity.key, entity.key, index === 0 ? 0 : 1);
        }
      }
      if (entity.entityType === "source_artifact") {
        continue;
      }
      for (const relation of entity.relations ?? []) {
        if (relation.type !== "parent_family") {
          continue;
        }
        const parent = entitiesByKey.get(relation.target);
        if (!parent) {
          continue;
        }
        insertTopicOwner.run(normalizeTopicPhrase(parent.title), parent.key, entity.key, 0);
      }
    }'''
    new = '''    for (const entity of catalog.entities) {
      if (entity.entityType !== "source_artifact") {
        if (!hasSameTitleParent(entity, entitiesByKey)) {
          for (const phrase of canonicalTopicPhrases(entity.title)) {
            insertTopicOwner.run(phrase, entity.key, entity.key, 0);
          }
        }
        for (const alias of entity.aliases ?? []) {
          const phrase = normalizeTopicPhrase(alias);
          if (phrase) {
            insertTopicOwner.run(phrase, entity.key, entity.key, 1);
          }
        }
      }
      if (entity.entityType === "source_artifact") {
        continue;
      }
      for (const relation of entity.relations ?? []) {
        if (relation.type !== "parent_family") {
          continue;
        }
        const parent = entitiesByKey.get(relation.target);
        if (!parent) {
          continue;
        }
        for (const phrase of canonicalTopicPhrases(parent.title)) {
          insertTopicOwner.run(phrase, parent.key, entity.key, 0);
        }
      }
    }'''
    text = replace_once(text, old, new, "topic owner generation")
    helper = '''function canonicalTopicPhrases(title: string): string[] {
  return [...new Set([
    normalizeTopicPhrase(title),
    ...title.split("/").map(normalizeTopicPhrase),
  ].filter(Boolean))];
}

'''
    text = replace_once(
        text,
        "function hasSameTitleParent(",
        helper + "function hasSameTitleParent(",
        "canonical title phrase helper",
    )
    write(path, text)

    sauna_path = "packages/health-commons/content/families/sauna.md"
    sauna = read(sauna_path)
    sauna = replace_once(
        sauna,
        "aliases:\n  - sauna\n  - passive heat\n",
        "aliases:\n  - passive heat\n",
        "temporary sauna alias",
    )
    write(sauna_path, sauna)


def remove_red_light_topic_skill() -> None:
    registry_path = "packages/assistant-engine/src/assistant-skill-assets.ts"
    registry = read(registry_path)
    registry = regex_once(
        registry,
        r'''  \{\n    slug: 'red-light-therapy',\n    name: 'red-light-therapy',\n    triggerHint:\n      '.*?',\n  \},\n''',
        "",
        "red-light skill registry entry",
    )
    registry = replace_once(
        registry,
        "Use for sauna, cold plunge, contrast therapy, compression, massage, foam rolling, percussion guns, stretching-as-recovery, breathwork-as-recovery, and recovery modality tradeoffs. Use red-light-therapy for red/NIR photobiomodulation dose, duration, distance, wavelengths, device irradiance, or Bestqool questions.",
        "Use for sauna, cold plunge, contrast therapy, compression, massage, foam rolling, percussion guns, stretching-as-recovery, breathwork-as-recovery, red light therapy, photobiomodulation, and recovery modality tradeoffs.",
        "recovery modalities trigger",
    )
    write(registry_path, registry)

    recovery_path = "packages/assistant-engine/skills/recovery-modalities/SKILL.md"
    recovery = read(recovery_path)
    recovery = replace_once(
        recovery,
        "description: Use for sauna cold plunge contrast therapy compression massage foam rolling percussion guns stretching and recovery modality tradeoff questions.",
        "description: Use for sauna cold plunge red light therapy photobiomodulation contrast therapy compression massage foam rolling percussion guns stretching and recovery modality tradeoff questions.",
        "recovery modalities description",
    )
    recovery = replace_once(
        recovery,
        "- Sauna, hot exposure, cold plunge, cold showers, contrast therapy, compression garments/boots, massage, percussion guns, foam rolling, and recovery modality tradeoffs.",
        "- Sauna, hot exposure, cold plunge, cold showers, red light therapy, photobiomodulation, contrast therapy, compression garments/boots, massage, percussion guns, foam rolling, and recovery modality tradeoffs.",
        "recovery modalities ownership",
    )
    recovery = replace_once(
        recovery,
        "- Use red-light-therapy for red/NIR photobiomodulation dose, duration, distance, wavelengths, device irradiance, Bestqool lamps, or PBM experiment setup.\n",
        "",
        "red-light skill handoff",
    )
    recovery = replace_once(
        recovery,
        "- This skill does not own PBM device-dose math.\n",
        "",
        "PBM ownership exclusion",
    )
    write(recovery_path, recovery)

    skill_dir = ROOT / "packages/assistant-engine/skills/red-light-therapy"
    if not skill_dir.is_dir():
        raise RuntimeError("expected red-light-therapy skill directory")
    shutil.rmtree(skill_dir)


def update_red_light_tests() -> None:
    path = "packages/assistant-engine/test/assistant-skill-assets.test.ts"
    text = read(path)
    text = re.sub(
        r'''\n    expect\(registeredSkillSlugs\.has\('red-light-therapy'\)\)\.toBe\(true\)\n    expect\(buildAssistantSkillFileRef\('red-light-therapy'\)\)\.toBe\(\n      '\$MURPH_ASSISTANT_SKILLS_ROOT/red-light-therapy/SKILL\.md',\n    \)''',
        "",
        text,
        count=1,
        flags=re.S,
    )
    for title in (
        "routes red light dose ownership to the dedicated red-light skill",
        "keeps red light therapy registered with device seed data",
    ):
        pattern = rf'''\n  it\('{re.escape(title)}'.*?(?=\n  it\(|\n\}}\)\n)'''
        text, count = re.subn(pattern, "", text, count=1, flags=re.S)
        if count != 1:
            raise RuntimeError(f"red-light test removal failed for: {title}")

    new_test = '''
  it('keeps red-light research in Health Commons instead of a topic skill', async () => {
    const registeredSkillSlugs = new Set(
      ASSISTANT_SKILLS.map((skill) => skill.slug),
    )
    expect(registeredSkillSlugs.has('red-light-therapy')).toBe(false)

    const recoverySkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'recovery-modalities',
    )
    expect(recoverySkill).toBeTruthy()
    if (!recoverySkill) {
      return
    }

    expect(recoverySkill.triggerHint).toContain('red light therapy')
    expect(recoverySkill.triggerHint).not.toContain('Use red-light-therapy')
    const recoveryText = await readSkillFile(recoverySkill)
    expect(recoveryText).not.toContain('Use red-light-therapy')
    expect(recoveryText).not.toContain('device-seeds.json')
  })
'''
    marker = "\n})\n"
    index = text.rfind(marker)
    if index < 0:
        raise RuntimeError("could not find assistant skill test suite terminator")
    text = text[:index] + new_test + text[index:]
    write(path, text)


def update_docs() -> None:
    plan_path = "agent-docs/exec-plans/active/2026-08-07-health-commons-agent-knowledge.md"
    write(plan_path, '''# Health Commons agent knowledge retrieval

Status: active
Created: 2026-08-07
Updated: 2026-08-10

## Goal

Let Murph use source-backed Health Commons knowledge in ordinary health
conversation without requiring a protocol or experiment and without loading the
corpus into every prompt.

## Final design

- Health Commons Markdown and JSONL remain the only source of truth.
- The build emits one ignored, read-only SQLite FTS projection containing only
  member-readable sourced claims, typed source findings, safety findings, and
  direct source references.
- The assistant makes one call with the member's natural-language question:
  `vault-cli commons knowledge search "<question>" --format json`.
- The reader resolves the strongest authored title or alias from that question,
  derives evidence and safety terms internally, and returns at most three
  evidence items plus one safety item.
- Canonical slash-separated family titles expose their short canonical forms and
  typed children; authored aliases stay scoped to their owner.
- Unknown or equally ranked topics fail closed. A resolved topic with no matching
  evidence remains distinguishable through `topicResolved`.
- Missing or invalid indexes do not block the response.
- Knowledge lookup never starts, proposes, or mutates an experiment. Protocol
  discovery remains a separate optional route when the member asks to try or
  track an intervention.

## Complexity deliberately avoided

- No vector database, embedding model, network service, migration, runtime write,
  query-rewriting model, or second knowledge owner.
- No exact-title/focus grammar, reserved `overall evidence` token, two-call
  evidence/safety protocol, or catalog-hash coordination in the assistant prompt.
- No topic-specific red-light knowledge skill or device-seed catalog. Health
  Commons owns the research; general assistant safety and workflow policy remain
  available.

## Verification

- Health Commons generation, determinism, typecheck, and full test suite.
- CLI generated contracts, typecheck, command coverage, and skill-hash checks.
- Assistant typecheck, prompt behavior, skill registry, and real-model harness.
- Hosted runner packaging/deployment tests and exact-head CI.
''')

    spec_path = "agent-docs/product-specs/health-commons.md"
    spec = read(spec_path)
    replacement = '''The generated `knowledge.sqlite` FTS projection gives the assistant one bounded
claim-level read path for ordinary health questions. Authored Markdown and JSONL
remain authoritative. The SQLite file is read-only build output, contains no
user data, and returns at most three sourced evidence items plus one safety item.
The command accepts one natural-language health question. The reader resolves
the strongest authored title or alias, derives evidence and safety terms
internally, and searches only that resolved owner set. Canonical slash-separated
family titles expose their short canonical forms and typed children; authored
aliases stay owner-scoped. Unknown or equally ranked topics fail closed. A
resolved topic with no matching evidence remains distinguishable through
`topicResolved`. Claims and extracted typed findings are the only member-facing
evidence shapes. Source findings still require one unambiguous authored target.
One question uses one lookup; the assistant does not manage focus syntax,
reserved tokens, multiple calls, result merging, or catalog hashes.'''
    spec = regex_once(
        spec,
        r'''The\s+generated `knowledge\.sqlite` FTS projection.*?combined packet keeps the same\nthree-item plus one-safety ceiling\.''',
        replacement,
        "Health Commons knowledge product spec",
    )
    write(spec_path, spec)


def assert_shape() -> None:
    knowledge = read("packages/health-commons/src/knowledge-index.ts")
    prompt = read("packages/assistant-engine/src/assistant/system-prompt.ts")
    registry = read("packages/assistant-engine/src/assistant-skill-assets.ts")
    if "HEALTH_COMMONS_KNOWLEDGE_OVERALL_FOCUS" in knowledge:
        raise RuntimeError("reserved broad-focus token remains")
    if "same catalogHash" in prompt or "overall evidence" in prompt:
        raise RuntimeError("old assistant search choreography remains")
    if "slug: 'red-light-therapy'" in registry:
        raise RuntimeError("red-light topic skill remains registered")
    if (ROOT / "packages/assistant-engine/skills/red-light-therapy").exists():
        raise RuntimeError("red-light topic skill files remain")


def main() -> None:
    update_topic_ownership()
    remove_red_light_topic_skill()
    update_red_light_tests()
    update_docs()
    assert_shape()
    print("Applied final Health Commons simplification.")


if __name__ == "__main__":
    main()
