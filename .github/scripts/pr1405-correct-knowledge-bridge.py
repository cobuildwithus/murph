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
        raise RuntimeError(f"{relative}: expected one literal match, found {count}: {old[:120]!r}")
    write(relative, text.replace(old, new, 1))


def replace_regex_once(relative: str, pattern: str, replacement: str) -> None:
    text = read(relative)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one regex match, found {count}: {pattern}")
    write(relative, updated)


INDEX = "packages/health-commons/src/knowledge-index.ts"

replace_once(
    INDEX,
    '''  "a",\n  "about",''',
    '''  "a",\n  "about",\n  "after",''',
)
replace_once(
    INDEX,
    '''  "research",\n  "say",''',
    '''  "research",\n  "safe",\n  "safely",\n  "safety",\n  "say",''',
)
replace_once(
    INDEX,
    ''']);\n\nexport type HealthCommonsKnowledgeItemKind''',
    ''']);\n\nconst HEALTH_COMMONS_EVIDENCE_INTENT_TERMS = new Set([\n  "affect",\n  "affects",\n  "benefit",\n  "benefits",\n  "evidence",\n  "effect",\n  "effects",\n  "efficacy",\n  "help",\n  "helps",\n  "improve",\n  "improved",\n  "improves",\n  "outcome",\n  "outcomes",\n  "research",\n  "study",\n  "studies",\n  "work",\n  "works",\n]);\n\nconst HEALTH_COMMONS_SAFETY_INTENT_TERMS = new Set([\n  "avoid",\n  "contraindication",\n  "contraindications",\n  "danger",\n  "dangerous",\n  "risk",\n  "risks",\n  "safe",\n  "safely",\n  "safety",\n]);\n\nexport type HealthCommonsKnowledgeItemKind''',
)

replace_once(
    INDEX,
    '''    const focusTokens = questionFocusTokens(normalizedQuestion, topic.phrase);\n    const contentQuery = focusTokens.length > 0 ? toFtsQuery(focusTokens) : null;\n    const candidateRows = contentQuery === null\n''',
    '''    const questionTokens = searchTokens(normalizedQuestion);\n    const focusTokens = questionFocusTokens(normalizedQuestion, topic.phrase);\n    const contentQuery = focusTokens.length > 0 ? toFtsQuery(focusTokens) : null;\n    const safetyOnly = questionTokens.some((token) =>\n      HEALTH_COMMONS_SAFETY_INTENT_TERMS.has(token)\n    ) && !questionTokens.some((token) =>\n      HEALTH_COMMONS_EVIDENCE_INTENT_TERMS.has(token)\n    );\n    const candidateRows = safetyOnly\n      ? []\n      : contentQuery === null\n''',
)

new_resolver = r'''function resolveKnowledgeTopic(
  database: DatabaseSync,
  normalizedQuestion: string,
): { ownerKey: string; phrase: string } | null {
  const paddedQuestion = ` ${normalizedQuestion} `;
  const matches = database.prepare(`
    SELECT DISTINCT phrase, owner_key, match_priority
    FROM topic_owners
    ORDER BY length(phrase) DESC, match_priority ASC, owner_key ASC
  `).all().flatMap((row) => {
    const phrase = String(row["phrase"]);
    if (!phrase || !paddedQuestion.includes(` ${phrase} `)) {
      return [];
    }
    return [{
      matchPriority: Number(row["match_priority"]),
      ownerKey: String(row["owner_key"]),
      phrase,
      tokenCount: phrase.split(" ").length,
    }];
  });
  matches.sort((left, right) =>
    right.tokenCount - left.tokenCount
    || right.phrase.length - left.phrase.length
    || left.matchPriority - right.matchPriority
    || left.ownerKey.localeCompare(right.ownerKey)
  );
  const best = matches[0];
  if (!best) {
    return null;
  }
  const topMatches = [...new Map(matches
    .filter((match) =>
      match.tokenCount === best.tokenCount
      && match.phrase.length === best.phrase.length
      && match.matchPriority === best.matchPriority
    )
    .map((match) => [match.ownerKey, match])).values()];
  if (topMatches.length === 1) {
    return {
      ownerKey: best.ownerKey,
      phrase: best.phrase,
    };
  }
  if (best.tokenCount > 1) {
    return null;
  }
  const focusTokens = questionFocusTokens(normalizedQuestion, best.phrase);
  const contentQuery = focusTokens.length > 0 ? toFtsQuery(focusTokens) : null;
  const scores = topMatches
    .map((match) => scoreKnowledgeTopicOwner(database, match, contentQuery))
    .filter((score) => score.count > 0)
    .sort((left, right) =>
      right.count - left.count
      || left.rank - right.rank
      || topicOwnerTypePriority(left.ownerKey) - topicOwnerTypePriority(right.ownerKey)
      || left.ownerKey.localeCompare(right.ownerKey)
    );
  const selected = scores[0];
  if (!selected) {
    return null;
  }
  const runnerUp = scores[1];
  if (
    runnerUp
    && selected.count === runnerUp.count
    && Math.abs(selected.rank - runnerUp.rank) < 1e-9
    && topicOwnerTypePriority(selected.ownerKey)
      === topicOwnerTypePriority(runnerUp.ownerKey)
  ) {
    return null;
  }
  return {
    ownerKey: selected.ownerKey,
    phrase: selected.phrase,
  };
}

function scoreKnowledgeTopicOwner(
  database: DatabaseSync,
  match: {
    ownerKey: string;
    phrase: string;
  },
  contentQuery: string | null,
): {
  count: number;
  ownerKey: string;
  phrase: string;
  rank: number;
} {
  const topicRows = database.prepare(`
    SELECT entity_key
    FROM topic_owners
    WHERE phrase = ? AND owner_key = ?
    ORDER BY entity_key ASC
    LIMIT ?
  `).all(match.phrase, match.ownerKey, HEALTH_COMMONS_KNOWLEDGE_MAX_TOPICS + 1);
  const entityKeys = topicRows.map((row) => String(row["entity_key"]));
  if (entityKeys.length === 0 || entityKeys.length > HEALTH_COMMONS_KNOWLEDGE_MAX_TOPICS) {
    return { ...match, count: 0, rank: Number.POSITIVE_INFINITY };
  }
  const placeholders = entityKeys.map(() => "?").join(", ");
  const rows = contentQuery === null
    ? database.prepare(`
        SELECT c.priority AS rank
        FROM chunks c
        WHERE c.entity_key IN (${placeholders})
          AND c.sources_json <> '[]'
        ORDER BY c.priority ASC, c.id ASC
        LIMIT 16
      `).all(...entityKeys)
    : database.prepare(`
        SELECT bm25(chunks_fts) AS rank
        FROM chunks_fts
        JOIN chunks c ON c.rowid = chunks_fts.rowid
        WHERE chunks_fts MATCH ?
          AND c.entity_key IN (${placeholders})
          AND c.sources_json <> '[]'
        ORDER BY rank ASC, c.priority ASC, c.id ASC
        LIMIT 16
      `).all(contentQuery, ...entityKeys);
  return {
    ...match,
    count: rows.length,
    rank: Number(rows[0]?.["rank"] ?? Number.POSITIVE_INFINITY),
  };
}

function topicOwnerTypePriority(ownerKey: string): number {
  if (ownerKey.startsWith("experiment_family:")) {
    return 0;
  }
  if (ownerKey.startsWith("protocol_variant:")) {
    return 1;
  }
  return 2;
}

function questionFocusTokens'''
replace_regex_once(
    INDEX,
    r'function resolveKnowledgeTopic\(.*?\n\}\n\nfunction questionFocusTokens',
    new_resolver,
)

replace_regex_once(
    "packages/assistant-engine/src/assistant/system-prompt.ts",
    r'''function buildAssistantHealthCommonsGuidanceText\(\): string \{\n  return `Health Commons tools:\n.*?`;\n\}''',
    '''function buildAssistantHealthCommonsGuidanceText(): string {
  return `Health Commons tools:
- Before substantive health claims or recommendations, run \`vault-cli commons knowledge search "<member's health question in concise English>" --format json\` once. Use its evidence, caveats, safety, and sources. If unavailable or empty, continue without claiming Commons support. Skip acknowledgements, logging, and non-health turns. Suggest an experiment only when asked to try or track.
- For protocol discovery/setup, search first. ${buildHealthCommonsDiscoverySurfaceText()}`;
}''',
)

model_test = "packages/assistant-engine/test/model-behavior.test.ts"
replace_once(
    model_test,
    '''    expect(prompt).toContain(\n      '`vault-cli commons knowledge search "<exact title or alias>" "<focus>" --format json`',\n    )\n    expect(prompt).toContain('Broad: focus exactly "overall evidence"')\n    expect(prompt).not.toContain('omit focus for broad evidence')\n    expect(prompt).toContain(\n      'Skip trivial/non-health;',\n    )\n    expect(prompt).toContain(\n      'no experiments.',\n    )\n    expect(prompt).toContain(\n      'retry topic only if topicResolved=false',\n    )\n    expect(prompt).toContain(\n      'No index: continue.',\n    )\n    expect(prompt).toContain(\n      'use 2 only for separate evidence+safety.',\n    )\n    expect(prompt).toContain(\n      'Across both: same catalogHash, 3 sourced + 1 safety.',\n    )\n    expect(prompt).toContain('Use 1 search;')\n''',
    '''    expect(prompt).toContain(\n      '`vault-cli commons knowledge search "<member\\'s health question in concise English>" --format json`',\n    )\n    expect(prompt).toContain('Before substantive health claims or recommendations')\n    expect(prompt).toContain('Use its evidence, caveats, safety, and sources.')\n    expect(prompt).toContain('Skip acknowledgements, logging, and non-health turns.')\n    expect(prompt).toContain('Suggest an experiment only when asked to try or track.')\n    expect(prompt).not.toContain('overall evidence')\n    expect(prompt).not.toContain('catalogHash')\n    expect(prompt).not.toContain('<exact title or alias>')\n    expect(prompt).not.toContain('<focus>')\n''',
)

print("Applied PR #1405 validation corrections")
