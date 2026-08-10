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
        raise RuntimeError(
            f"{relative}: expected one literal match, found {count}: {old[:160]!r}"
        )
    write(relative, text.replace(old, new, 1))


def regex_once(relative: str, pattern: str, replacement: str) -> None:
    text = read(relative)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(
            f"{relative}: expected one regex match, found {count}: {pattern[:160]}"
        )
    write(relative, updated)


INDEX = "packages/health-commons/src/knowledge-index.ts"
FULL_CATALOG_TEST = "packages/health-commons/test/knowledge-index-full-catalog.test.ts"
PROMPT = "packages/assistant-engine/src/assistant/system-prompt.ts"
MODEL_TEST = "packages/assistant-engine/test/model-behavior.test.ts"
PRODUCT_SPEC = "agent-docs/product-specs/health-commons.md"
PLAN = "agent-docs/exec-plans/active/2026-08-07-health-commons-agent-knowledge.md"

# Canonical slash-title components are authored identity, not fuzzy matching.
# "Sauna / Passive Heat" therefore exposes "sauna" to its typed children,
# while ordinary aliases remain scoped to their own owner.
replace_once(
    INDEX,
    '''    for (const entity of catalog.entities) {
      if (entity.entityType !== "source_artifact") {
        for (const [index, phrase] of [entity.title, ...(entity.aliases ?? [])].entries()) {
          if (index === 0 && hasSameTitleParent(entity, entitiesByKey)) {
            continue;
          }
          insertTopicOwner.run(normalizeTopicPhrase(phrase), entity.key, entity.key, index === 0 ? 0 : 1);
        }
      }
''',
    '''    for (const entity of catalog.entities) {
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
''',
)
replace_once(
    INDEX,
    '''        insertTopicOwner.run(normalizeTopicPhrase(parent.title), parent.key, entity.key, 0);
        if (entity.entityType === "experiment_family") {
          for (const alias of parent.aliases ?? []) {
            insertTopicOwner.run(
              normalizeTopicPhrase(alias),
              parent.key,
              entity.key,
              1,
            );
          }
        }
''',
    '''        for (const phrase of canonicalTopicPhrases(parent.title)) {
          insertTopicOwner.run(phrase, parent.key, entity.key, 0);
        }
''',
)
replace_once(
    INDEX,
    '''function entityTopicText(entity: HealthCommonsCatalogEntity): string {
''',
    '''function canonicalTopicPhrases(title: string): string[] {
  return [...new Set([
    normalizeTopicPhrase(title),
    ...title.split("/").map(normalizeTopicPhrase),
  ].filter(Boolean))];
}

function entityTopicText(entity: HealthCommonsCatalogEntity): string {
''',
)

# Route-intent words and temporal filler should not narrow the packet itself.
replace_once(
    INDEX,
    '''  "research",
  "safe",
''',
    '''  "research",
  "recent",
  "recently",
  "safe",
''',
)
replace_once(
    INDEX,
    '''  return searchTokens(normalizedQuestion).filter((token) =>
    !topicTokens.has(token)
    && !HEALTH_COMMONS_QUESTION_STOP_WORDS.has(token)
  );
''',
    '''  return searchTokens(normalizedQuestion).filter((token) =>
    !topicTokens.has(token)
    && !HEALTH_COMMONS_QUESTION_STOP_WORDS.has(token)
    && !HEALTH_COMMONS_EVIDENCE_INTENT_TERMS.has(token)
    && !HEALTH_COMMONS_SAFETY_INTENT_TERMS.has(token)
  );
''',
)

# Remove the temporary owner-scoped alias. The canonical title now owns it.
replace_once(
    "packages/health-commons/content/families/sauna.md",
    '''aliases:
  - sauna
  - passive heat
''',
    '''aliases:
  - passive heat
''',
)

replace_once(
    FULL_CATALOG_TEST,
    '''  it("answers a normal sauna question without requiring an exact catalog title", () => {
    const result = searchQuestion("Does sauna improve immunity?");

    expect(result.topicResolved).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(packetText(result)).toMatch(/immun/iu);
  });
''',
    '''  it("answers one normal sauna evidence-and-safety question in one lookup", () => {
    const result = searchQuestion(
      "Does sauna improve immunity, and is it safe after I fainted recently?",
    );

    expect(result.topicResolved).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(packetText(result)).toMatch(/immun/iu);
    expect(result.safety?.text).toMatch(/faint/iu);
  });
''',
)

replace_once(
    PROMPT,
    '''- Before substantive health claims or recommendations, run `vault-cli commons knowledge search "<member's health question in concise English>" --format json` once. Use its evidence, caveats, safety, and sources. If unavailable or empty, continue without claiming Commons support. Skip acknowledgements, logging, and non-health turns. Suggest an experiment only when asked to try or track.
''',
    '''- Before substantive health claims or recommendations, run `vault-cli commons knowledge search "<member's health question in concise English>" --format json` once. Use its evidence, caveats, safety, and sources. If unavailable, continue without claiming Commons support. If `topicResolved=false` and the topic is genuinely ambiguous, ask one short clarification; never guess another topic. If the topic resolved but no evidence matched, say Health Commons has no matching evidence. Skip acknowledgements, logging, and non-health turns. Do not create or suggest an experiment unless the member asks to try or track the intervention.
''',
)
replace_once(
    MODEL_TEST,
    '''    expect(prompt).toContain('Use its evidence, caveats, safety, and sources.')
    expect(prompt).toContain('Skip acknowledgements, logging, and non-health turns.')
    expect(prompt).toContain('Suggest an experiment only when asked to try or track.')
''',
    '''    expect(prompt).toContain('Use its evidence, caveats, safety, and sources.')
    expect(prompt).toContain('never guess another topic')
    expect(prompt).toContain('no matching evidence')
    expect(prompt).toContain('Skip acknowledgements, logging, and non-health turns.')
    expect(prompt).toContain(
      'Do not create or suggest an experiment unless the member asks to try or track the intervention.',
    )
''',
)

regex_once(
    PRODUCT_SPEC,
    r'''The command first resolves one exact\nnormalized entity title or authored alias\..*?three-item plus one-safety ceiling\.\n''',
    '''The command accepts one natural-language health question. Topic resolution
stays inside the Health Commons reader: canonical authored titles, authored
slash-title components, and authored aliases may establish identity, while
evidence text and source titles may only rank content after a topic resolves.
Canonical family titles may include typed child protocols; aliases stay scoped
to their own owner. Unknown topics and equally ranked owners fail closed, and
the reader never guesses a second topic after an empty result. One call returns
at most three distinct sourced evidence items and one matching safety item, with
at most four source locators per item. The agent does not supply a separate
focus, reserved broad-search phrase, catalog hash, or multi-call merge policy.
Source findings use one unambiguous authored target: `related_protocol`, then
`parent_family`, then `measures`. Multi-target and untargeted findings stay out
of the projection until their ownership is authored more precisely. Safety
comes only from a directly sourced safety claim or typed source finding.
Page-wide `safety` arrays, unsourced overview text, and editorial evidence-
appraisal rows do not enter the assistant projection. Topic-specific assistant
skills must not duplicate Health Commons evidence or safety; skills remain for
genuine workflows, while current device specifications are ordinary external
inputs.
''',
)

plan = read(PLAN)
addition = '''
- Canonical slash-title components are authored topic identity, so an ordinary
  phrase such as `sauna` resolves the broad family and typed children without
  fuzzy alias composition. Aliases remain owner-scoped.
- One natural question may retrieve both matching evidence and matching safety;
  the reader never retries another topic after an empty result.
'''
if "Canonical slash-title components are authored topic identity" not in plan:
    write(PLAN, plan.rstrip() + "\n" + addition)

print("Applied the final one-path Health Commons correction.")
