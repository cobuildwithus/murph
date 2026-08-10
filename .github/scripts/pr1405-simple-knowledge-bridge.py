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
        raise RuntimeError(f"{relative}: expected one literal match, found {count}: {old[:100]!r}")
    write(relative, text.replace(old, new, 1))


def replace_regex_once(relative: str, pattern: str, replacement: str) -> None:
    text = read(relative)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one regex match, found {count}: {pattern}")
    write(relative, updated)


KNOWLEDGE_INDEX = "packages/health-commons/src/knowledge-index.ts"

replace_once(
    KNOWLEDGE_INDEX,
    'export const HEALTH_COMMONS_KNOWLEDGE_INDEX_SCHEMA_VERSION = 3;\n',
    'export const HEALTH_COMMONS_KNOWLEDGE_INDEX_SCHEMA_VERSION = 4;\n',
)
replace_once(
    KNOWLEDGE_INDEX,
    'export const HEALTH_COMMONS_KNOWLEDGE_OVERALL_FOCUS = "overall evidence";\n',
    '''const HEALTH_COMMONS_QUESTION_STOP_WORDS = new Set([\n  "a",\n  "about",\n  "all",\n  "an",\n  "and",\n  "any",\n  "are",\n  "as",\n  "at",\n  "be",\n  "benefit",\n  "benefits",\n  "can",\n  "could",\n  "did",\n  "do",\n  "does",\n  "evidence",\n  "effect",\n  "effects",\n  "for",\n  "from",\n  "health",\n  "help",\n  "helps",\n  "how",\n  "i",\n  "in",\n  "is",\n  "it",\n  "me",\n  "my",\n  "of",\n  "on",\n  "or",\n  "overall",\n  "please",\n  "research",\n  "say",\n  "should",\n  "study",\n  "studies",\n  "tell",\n  "the",\n  "this",\n  "to",\n  "use",\n  "using",\n  "what",\n  "when",\n  "whether",\n  "while",\n  "with",\n  "work",\n  "works",\n  "would",\n]);\n''',
)
replace_once(
    KNOWLEDGE_INDEX,
    '''export interface HealthCommonsKnowledgeSearchResult {\n  catalogHash: string;\n  focus: string;\n  items: HealthCommonsKnowledgeSearchItem[];\n  query: string;\n  safety: HealthCommonsKnowledgeSearchItem | null;\n  topicResolved: boolean;\n}\n''',
    '''export interface HealthCommonsKnowledgeSearchResult {\n  catalogHash: string;\n  items: HealthCommonsKnowledgeSearchItem[];\n  query: string;\n  safety: HealthCommonsKnowledgeSearchItem | null;\n  topicResolved: boolean;\n}\n''',
)
replace_once(
    KNOWLEDGE_INDEX,
    '''      if (entity.entityType !== "protocol_variant") {\n        continue;\n      }\n      for (const relation of entity.relations ?? []) {\n''',
    '''      if (entity.entityType === "source_artifact") {\n        continue;\n      }\n      for (const relation of entity.relations ?? []) {\n''',
)

new_search = r'''export function searchHealthCommonsKnowledgeIndex(input: {
  databasePath: string;
  limit?: number;
  query: string;
}): HealthCommonsKnowledgeSearchResult {
  const query = input.query.trim();
  if (!query) {
    throw new Error("Health Commons knowledge query must not be blank.");
  }
  const normalizedQuestion = normalizeTopicPhrase(query);
  if (!normalizedQuestion) {
    throw new Error("Health Commons knowledge query needs at least one searchable term.");
  }
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? HEALTH_COMMONS_KNOWLEDGE_DEFAULT_LIMIT), 1),
    HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT,
  );
  const database = openKnowledgeDatabase(input.databasePath, true);
  try {
    const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version !== HEALTH_COMMONS_KNOWLEDGE_INDEX_SCHEMA_VERSION) {
      throw new Error(`Unsupported Health Commons knowledge index version ${version}.`);
    }
    const catalogHashRow = database
      .prepare("SELECT value FROM metadata WHERE key = 'catalog_hash'")
      .get();
    const catalogHash = String(catalogHashRow?.["value"] ?? "");
    const topic = resolveKnowledgeTopic(database, normalizedQuestion);
    if (!topic) {
      return {
        catalogHash,
        items: [],
        query,
        safety: null,
        topicResolved: false,
      };
    }
    const topicRows = database.prepare(`
      SELECT entity_key
      FROM topic_owners
      WHERE phrase = ? AND owner_key = ?
      ORDER BY entity_key ASC
      LIMIT ?
    `).all(topic.phrase, topic.ownerKey, HEALTH_COMMONS_KNOWLEDGE_MAX_TOPICS + 1);
    const entityKeys = topicRows.map((row) => String(row["entity_key"]));
    if (entityKeys.length === 0 || entityKeys.length > HEALTH_COMMONS_KNOWLEDGE_MAX_TOPICS) {
      return {
        catalogHash,
        items: [],
        query,
        safety: null,
        topicResolved: true,
      };
    }
    const placeholders = entityKeys.map(() => "?").join(", ");
    const focusTokens = questionFocusTokens(normalizedQuestion, topic.phrase);
    const contentQuery = focusTokens.length > 0 ? toFtsQuery(focusTokens) : null;
    const candidateRows = contentQuery === null
      ? database.prepare(`
          SELECT c.id, c.entity_key, c.entity_title, c.kind, c.text, c.caveat,
                 c.strength, c.sources_json, c.priority, 0 AS rank
          FROM chunks c
          WHERE c.kind <> 'safety'
            AND c.entity_key IN (${placeholders})
            AND c.sources_json <> '[]'
          ORDER BY c.priority ASC, c.id ASC
          LIMIT ?
        `).all(
          ...entityKeys,
          Math.min(limit * 8, HEALTH_COMMONS_KNOWLEDGE_MAX_CANDIDATES),
        )
      : database.prepare(`
          SELECT c.id, c.entity_key, c.entity_title, c.kind, c.text, c.caveat,
                 c.strength, c.sources_json, c.priority, bm25(chunks_fts) AS rank
          FROM chunks_fts
          JOIN chunks c ON c.rowid = chunks_fts.rowid
          WHERE chunks_fts MATCH ? AND c.kind <> 'safety'
            AND c.entity_key IN (${placeholders})
            AND c.sources_json <> '[]'
          ORDER BY rank ASC, c.priority ASC, c.id ASC
          LIMIT ?
        `).all(
          contentQuery,
          ...entityKeys,
          Math.min(limit * 8, HEALTH_COMMONS_KNOWLEDGE_MAX_CANDIDATES),
        );
    const rows = selectDiverseKnowledgeRows(candidateRows, limit);
    const items = rows.map(readKnowledgeRow);
    const safetyRow = contentQuery === null
      ? database.prepare(`
          SELECT c.id, c.entity_key, c.entity_title, c.kind, c.text, c.caveat,
                 c.strength, c.sources_json, c.priority
          FROM chunks c
          WHERE c.kind = 'safety'
            AND c.entity_key IN (${placeholders})
          ORDER BY c.priority ASC, c.id ASC
          LIMIT 1
        `).get(...entityKeys)
      : database.prepare(`
          SELECT c.id, c.entity_key, c.entity_title, c.kind, c.text, c.caveat,
                 c.strength, c.sources_json, c.priority
          FROM chunks_fts
          JOIN chunks c ON c.rowid = chunks_fts.rowid
          WHERE chunks_fts MATCH ? AND c.kind = 'safety'
            AND c.entity_key IN (${placeholders})
          ORDER BY bm25(chunks_fts) ASC, c.priority ASC, c.id ASC
          LIMIT 1
        `).get(contentQuery, ...entityKeys);
    const safety = safetyRow ? readKnowledgeRow(safetyRow) : null;

    return {
      catalogHash,
      items,
      query,
      safety,
      topicResolved: true,
    };
  } finally {
    database.close();
  }
}

function resolveKnowledgeTopic(
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
  const equallyRankedOwners = new Set(matches
    .filter((match) =>
      match.tokenCount === best.tokenCount
      && match.phrase.length === best.phrase.length
      && match.matchPriority === best.matchPriority
    )
    .map((match) => match.ownerKey));
  if (equallyRankedOwners.size !== 1) {
    return null;
  }
  return {
    ownerKey: best.ownerKey,
    phrase: best.phrase,
  };
}

function questionFocusTokens(
  normalizedQuestion: string,
  topicPhrase: string,
): string[] {
  const topicTokens = new Set(searchTokens(topicPhrase));
  return searchTokens(normalizedQuestion).filter((token) =>
    !topicTokens.has(token)
    && !HEALTH_COMMONS_QUESTION_STOP_WORDS.has(token)
  );
}

function selectDiverseKnowledgeRows'''
replace_regex_once(
    KNOWLEDGE_INDEX,
    r'export function searchHealthCommonsKnowledgeIndex\(input: \{.*?\n\}\n\nfunction selectDiverseKnowledgeRows',
    new_search,
)
replace_regex_once(
    KNOWLEDGE_INDEX,
    r'function toFtsQuery\(query: string\): string \{.*?\n\}\n\nfunction normalizeTopicPhrase',
    r'''function toFtsQuery(tokens: readonly string[]): string {
  if (tokens.length === 0) {
    throw new Error("Health Commons knowledge query needs at least one searchable term.");
  }
  return tokens.map((token) => {
    const quoted = `"${token.replaceAll('"', '""')}"`;
    return token.length === 1 ? quoted : `${quoted}*`;
  }).join(" OR ");
}

function normalizeTopicPhrase''',
)

replace_once(
    "packages/health-commons/src/runtime.ts",
    '''export interface SearchGeneratedHealthCommonsKnowledgeOptions {\n  focus: string;\n  knowledgeIndexPath?: string | URL;\n  limit?: number;\n  query: string;\n}\n''',
    '''export interface SearchGeneratedHealthCommonsKnowledgeOptions {\n  knowledgeIndexPath?: string | URL;\n  limit?: number;\n  query: string;\n}\n''',
)
replace_once(
    "packages/health-commons/src/runtime.ts",
    '''  return searchHealthCommonsKnowledgeIndex({\n    databasePath,\n    focus: options.focus,\n    limit: Math.min(\n''',
    '''  return searchHealthCommonsKnowledgeIndex({\n    databasePath,\n    limit: Math.min(\n''',
)

replace_once(
    "packages/cli/src/commands/commons.ts",
    '''export const commonsKnowledgeSearchResultSchema = z.object({\n  available: z.boolean(),\n  catalogHash: z.string(),\n  focus: z.string().min(1),\n  items: z.array(commonsKnowledgeItemSchema),\n''',
    '''export const commonsKnowledgeSearchResultSchema = z.object({\n  available: z.boolean(),\n  catalogHash: z.string(),\n  items: z.array(commonsKnowledgeItemSchema),\n''',
)
replace_regex_once(
    "packages/cli/src/commands/commons.ts",
    r'''  knowledge\.command\("search", \{\n    description:.*?\n  \}\);\n\n  protocol\.command\("list",''',
    '''  knowledge.command("search", {
    description:
      "Return one small source-backed evidence and safety packet for a natural-language health question.",
    args: z.object({
      query: z.string().min(2).max(480),
    }),
    options: z.object({
      limit: z.number().int().positive().max(HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT).default(3),
    }),
    examples: [{
      description: "Ask an ordinary health question about dry sauna.",
      args: { query: "Does Finnish dry sauna improve immunity, and is it safe after fainting?" },
      options: { limit: 3 },
    }],
    output: commonsKnowledgeSearchResultSchema,
    run({ args, options }) {
      try {
        return commonsKnowledgeSearchResultSchema.parse({
          available: true,
          ...searchGeneratedHealthCommonsKnowledge({
            limit: options.limit,
            query: args.query,
          }),
          warning: null,
        });
      } catch {
        return commonsKnowledgeSearchResultSchema.parse({
          available: false,
          catalogHash: "",
          items: [],
          query: args.query,
          safety: null,
          topicResolved: false,
          warning: "Health Commons knowledge index is unavailable; continue without corpus context.",
        });
      }
    },
  });

  protocol.command("list",''',
)

replace_regex_once(
    "packages/assistant-engine/src/assistant/system-prompt.ts",
    r'''function buildAssistantHealthCommonsGuidanceText\(\): string \{\n  return `Health Commons tools:\n.*?`;\n\}''',
    '''function buildAssistantHealthCommonsGuidanceText(): string {
  return `Health Commons tools:
- Before answering a substantive health question or making a health recommendation, run \`vault-cli commons knowledge search "<the member's health question in concise English>" --format json\` once. Use the returned evidence, caveats, safety, and sources. If the index is unavailable or no matching evidence is returned, continue honestly without claiming Health Commons support. Skip acknowledgements, pure logging, and non-health turns. Do not create or suggest an experiment unless the member asks to try or track something.
- For protocol discovery/setup, search first. ${buildHealthCommonsDiscoverySurfaceText()}`;
}''',
)

unit_test = "packages/health-commons/test/knowledge-index.test.ts"
text = read(unit_test)
text = text.replace('''      const result = searchHealthCommonsKnowledgeIndex({\n        databasePath: firstPath,\n        focus: "cardiovascular",\n        limit: 2,\n        query: "dry sauna",\n      });\n\n      expect(result.focus).toBe("cardiovascular");\n''', '''      const result = searchHealthCommonsKnowledgeIndex({
        databasePath: firstPath,
        limit: 2,
        query: "Does dry sauna affect cardiovascular health?",
      });

''')
text = text.replace('''      expect(searchHealthCommonsKnowledgeIndex({\n        databasePath: firstPath,\n        focus: "immunity",\n        query: "dry sauna",\n      }).items).toEqual([]);\n''', '''      expect(searchHealthCommonsKnowledgeIndex({
        databasePath: firstPath,
        query: "Does dry sauna improve immunity?",
      }).items).toEqual([]);
''')
text = text.replace('''      expect(searchHealthCommonsKnowledgeIndex({\n        databasePath: firstPath,\n        focus: "spermatogenesis",\n        query: "dry sauna",\n      }).safety).toMatchObject({\n''', '''      expect(searchHealthCommonsKnowledgeIndex({
        databasePath: firstPath,
        query: "Can dry sauna affect spermatogenesis?",
      }).safety).toMatchObject({
''')
text = text.replace('''      const broad = searchHealthCommonsKnowledgeIndex({\n        databasePath: firstPath,\n        focus: "overall evidence",\n        query: "dry sauna",\n      });\n''', '''      const broad = searchHealthCommonsKnowledgeIndex({
        databasePath: firstPath,
        query: "What does the evidence say about dry sauna?",
      });
''')
text = text.replace('''    expect(() => searchHealthCommonsKnowledgeIndex({\n      databasePath: "unused.sqlite",\n      focus: "health evidence",\n      query: " - ",\n    })).toThrow("at least one searchable term");\n    expect(() => searchHealthCommonsKnowledgeIndex({\n      databasePath: "unused.sqlite",\n      focus: " ",\n      query: "dry sauna",\n    })).toThrow("focus must not be blank");\n''', '''    expect(() => searchHealthCommonsKnowledgeIndex({
      databasePath: "unused.sqlite",
      query: " - ",
    })).toThrow("at least one searchable term");
''')
text, count = re.subn(
    r'''\n  it\("requires every focus term instead of silently dropping terms after eight", async \(\) => \{.*?\n  \}\);\n''',
    "\n",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError(f"{unit_test}: focus-term test block not found")
text = text.replace('''      expect(searchHealthCommonsKnowledgeIndex({\n        databasePath,\n        focus: "heat",\n        query: "shared heat",\n      }))\n''', '''      expect(searchHealthCommonsKnowledgeIndex({
        databasePath,
        query: "What does shared heat do for recovery?",
      }))
''')
write(unit_test, text)

full_test = "packages/health-commons/test/knowledge-index-full-catalog.test.ts"
replace_once(
    full_test,
    '''function search(query: string, focus: string): HealthCommonsKnowledgeSearchResult {\n  return searchHealthCommonsKnowledgeIndex({\n    databasePath: knowledgeIndexPath,\n    focus,\n    query,\n  });\n}\n''',
    '''function search(topic: string, focus: string): HealthCommonsKnowledgeSearchResult {\n  return searchHealthCommonsKnowledgeIndex({\n    databasePath: knowledgeIndexPath,\n    query: `${topic}. ${focus}`,\n  });\n}\n\nfunction searchQuestion(query: string): HealthCommonsKnowledgeSearchResult {\n  return searchHealthCommonsKnowledgeIndex({\n    databasePath: knowledgeIndexPath,\n    query,\n  });\n}\n''',
)
text = read(full_test).replace('result.focus ?? ""', 'result.query ?? ""')
needle = 'describe("Health Commons full-catalog knowledge retrieval", () => {\n'
addition = '''describe("Health Commons full-catalog knowledge retrieval", () => {
  it("answers a normal sauna question without requiring an exact catalog title", () => {
    const result = searchQuestion("Does sauna improve immunity?");

    expect(result.topicResolved).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(packetText(result)).toMatch(/immun/iu);
  });

'''
if text.count(needle) != 1:
    raise RuntimeError(f"{full_test}: describe marker not found")
text = text.replace(needle, addition, 1)
write(full_test, text)

cli_test = "packages/cli/test/commons-command-coverage.test.ts"
text = read(cli_test)
text = text.replace('''    focus: string;\n''', "")
text = text.replace('''    "Finnish Dry Sauna",\n    "overall evidence",\n''', '''    "What does the evidence say about Finnish Dry Sauna?",
''', 1)
text = text.replace('''  assert.equal(data.focus, "overall evidence");\n''', "")
text = text.replace('''    "Finnish Dry Sauna",\n    "fentanyl patch",\n''', '''    "Is Finnish Dry Sauna safe with a fentanyl patch?",
''', 1)
text = text.replace('''    "Finnish Dry Sauna",\n    "overall evidence",\n    "--limit",\n    "4",\n''', '''    "What does the evidence say about Finnish Dry Sauna?",
    "--limit",
    "4",
''', 1)
text, count = re.subn(
    r'''\ntest\("commons knowledge search requires a question focus", async \(\) => \{.*?\n\}\);\n''',
    "\n",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError(f"{cli_test}: old focus requirement test not found")
text = text.replace('''      focus: string;\n''', "")
text = text.replace('''      "Finnish Dry Sauna",\n      "recent fainting",\n''', '''      "Is Finnish Dry Sauna safe after recent fainting?",
''', 1)
text = text.replace('''    assert.equal(data.focus, "recent fainting");\n''', "")
write(cli_test, text)

model_test = "packages/assistant-engine/test/model-behavior.test.ts"
text = read(model_test)
text = text.replace('''    expect(prompt).toContain(
      '`vault-cli commons knowledge search "<exact title or alias>" "<focus>" --format json`',
    )
    expect(prompt).toContain('Broad: focus exactly "overall evidence"; other focus is strict.')
    expect(prompt).toContain('Use 1 search; use 2 only for separate evidence+safety.')
    expect(prompt).toContain('Across both: same catalogHash, 3 sourced + 1 safety.')
    expect(prompt).toContain('Empty: retry topic only if topicResolved=false; else no matching Commons evidence.')
    expect(prompt).toContain('No index: continue. Skip trivial/non-health; no experiments.')
''', '''    expect(prompt).toContain(
      '`vault-cli commons knowledge search "<the member\\'s health question in concise English>" --format json`',
    )
    expect(prompt).toContain('Before answering a substantive health question')
    expect(prompt).toContain('run `vault-cli commons knowledge search')
    expect(prompt).toContain('once.')
    expect(prompt).toContain('Use the returned evidence, caveats, safety, and sources.')
    expect(prompt).toContain('Skip acknowledgements, pure logging, and non-health turns.')
    expect(prompt).toContain(
      'Do not create or suggest an experiment unless the member asks to try or track something.',
    )
    expect(prompt).not.toContain('overall evidence')
    expect(prompt).not.toContain('catalogHash')
    expect(prompt).not.toContain('<exact title or alias>')
    expect(prompt).not.toContain('<focus>')
''')
write(model_test, text)

e2e_test = "packages/assistant-engine/test/assistant-codex-real-e2e.test.ts"
text = read(e2e_test)
text = text.replace("      expect(knowledgeCommands[0] ?? '').toMatch(/overall evidence/iu)\n", "")
text = text.replace("      expect(knowledgeCommands).toHaveLength(2)\n", "      expect(knowledgeCommands).toHaveLength(1)\n", 1)
text = text.replace('''      expect(knowledgeCommands.every((command) =>\n        /finnish dry sauna/iu.test(command)\n      )).toBe(true)\n      expect(knowledgeCommands.some((command) => /immun/iu.test(command))).toBe(true)\n      expect(knowledgeCommands.some((command) => /faint/iu.test(command))).toBe(true)\n''', '''      expect(knowledgeCommands[0] ?? '').toMatch(/finnish dry sauna/iu)
      expect(knowledgeCommands[0] ?? '').toMatch(/immun/iu)
      expect(knowledgeCommands[0] ?? '').toMatch(/faint/iu)
''')
write(e2e_test, text)

replace_once(
    "ARCHITECTURE.md",
    'a read-only generated SQLite FTS claim projection that resolves an exact authored topic before filtering sourced claims, appraisals, typed-target source findings, and matching safety within that owner',
    'a read-only generated SQLite FTS projection that accepts one natural-language health question, resolves a typed authored topic, and returns a bounded packet of sourced claims, typed-target findings, and matching safety',
)

plan = "agent-docs/exec-plans/active/2026-08-07-health-commons-agent-knowledge.md"
plan_text = read(plan)
plan_text += '''

## Final simplification

- The agent now sends one natural-language health question. It does not resolve an
  exact catalog title, invent a separate focus, use a magic broad-evidence token,
  merge multiple calls, or compare catalog hashes.
- Topic resolution, family expansion, evidence ranking, safety selection, and
  packet limits stay behind the Health Commons runtime boundary.
- The stable assistant rule is one lookup before substantive health claims, with
  no experiment suggestion unless the member asks to try or track something.
'''
write(plan, plan_text)

print("Applied PR #1405 simplification")
