import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import type { HealthCommonsCatalog, HealthCommonsCatalogEntity } from "@murphai/contracts";

export const HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE = "knowledge.sqlite";
export const HEALTH_COMMONS_KNOWLEDGE_INDEX_SCHEMA_VERSION = 4;
export const HEALTH_COMMONS_KNOWLEDGE_DEFAULT_LIMIT = 3;
export const HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT = 3;
const HEALTH_COMMONS_KNOWLEDGE_MAX_SOURCES_PER_ITEM = 4;
const HEALTH_COMMONS_KNOWLEDGE_MAX_CANDIDATES = 48;
const HEALTH_COMMONS_KNOWLEDGE_MAX_TOPICS = 32;
const HEALTH_COMMONS_KNOWLEDGE_MAX_QUERY_LENGTH = 500;
const HEALTH_COMMONS_KNOWLEDGE_MAX_TOPIC_CANDIDATES = 3;

export type HealthCommonsKnowledgeItemKind = "claim" | "safety" | "source_finding";

export interface HealthCommonsKnowledgeSourceReference {
  authors: string | null;
  designKind: string | null;
  doi: string | null;
  participantCount: number | null;
  pmid: string | null;
  sourceKey: string;
  title: string;
  url: string | null;
  year: number | null;
}

export interface HealthCommonsKnowledgeSearchItem {
  caveat: string | null;
  entityKey: string;
  entityTitle: string;
  kind: HealthCommonsKnowledgeItemKind;
  strength: string | null;
  text: string;
  sources: HealthCommonsKnowledgeSourceReference[];
}

export interface HealthCommonsKnowledgeSearchResult {
  candidates: HealthCommonsKnowledgeTopic[];
  items: HealthCommonsKnowledgeSearchItem[];
  query: string;
  safety: HealthCommonsKnowledgeSearchItem | null;
  topic: HealthCommonsKnowledgeTopic | null;
}

export interface HealthCommonsKnowledgeTopic {
  key: string;
  title: string;
}

interface TopicOwnerRow {
  entityKey: string;
  matchPriority: number;
  ownerKey: string;
  ownerTitle: string;
  phrase: string;
}

interface ResolvedKnowledgeTopic {
  entityKeys: string[];
  matchedPhrase: string;
  topic: HealthCommonsKnowledgeTopic;
}

interface KnowledgeChunk {
  caveat: string | null;
  entityKey: string;
  entityTitle: string;
  id: string;
  kind: HealthCommonsKnowledgeItemKind;
  priority: number;
  searchText: string;
  sources: HealthCommonsKnowledgeSourceReference[];
  strength: string | null;
  text: string;
}

export function writeHealthCommonsKnowledgeIndex(filePath: string, catalog: HealthCommonsCatalog): void {
  const database = openKnowledgeDatabase(filePath);
  try {
    database.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = OFF;
      PRAGMA user_version = ${HEALTH_COMMONS_KNOWLEDGE_INDEX_SCHEMA_VERSION};
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE topic_owners (
        phrase TEXT NOT NULL,
        owner_key TEXT NOT NULL,
        owner_title TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        match_priority INTEGER NOT NULL,
        PRIMARY KEY (phrase, owner_key, entity_key)
      ) WITHOUT ROWID;
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        entity_key TEXT NOT NULL,
        entity_title TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        caveat TEXT,
        strength TEXT,
        sources_json TEXT NOT NULL,
        priority INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        search_text,
        content = '',
        tokenize = 'porter unicode61 remove_diacritics 2'
      );
    `);
    database.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)").run("catalog_hash", catalog.catalogHash);
    const insertTopicOwner = database.prepare(
      `INSERT INTO topic_owners (phrase, owner_key, owner_title, entity_key, match_priority)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (phrase, owner_key, entity_key) DO UPDATE SET
         owner_title = excluded.owner_title,
         match_priority = min(topic_owners.match_priority, excluded.match_priority)`,
    );

    const insertChunk = database.prepare(`
      INSERT INTO chunks
        (id, entity_key, entity_title, kind, text, caveat, strength, sources_json, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSearch = database.prepare("INSERT INTO chunks_fts (rowid, search_text) VALUES (?, ?)");

    database.exec("BEGIN");
    const entitiesByKey = new Map(catalog.entities.map((entity) => [entity.key, entity]));
    for (const entity of catalog.entities) {
      if (entity.entityType !== "source_artifact") {
        for (const [index, phrase] of [entity.title, ...(entity.aliases ?? [])].entries()) {
          if (index === 0 && hasSameTitleParent(entity, entitiesByKey)) {
            continue;
          }
          insertTopicOwner.run(normalizeTopicPhrase(phrase), entity.key, entity.title, entity.key, index === 0 ? 0 : 1);
        }
      }
      if (entity.entityType !== "protocol_variant") {
        if (entity.entityType !== "experiment_family") {
          continue;
        }
        for (const relation of entity.relations ?? []) {
          if (relation.type !== "child_family") {
            continue;
          }
          const child = entitiesByKey.get(relation.target);
          if (child?.entityType !== "experiment_family") {
            continue;
          }
          insertTopicOwner.run(normalizeTopicPhrase(entity.title), entity.key, entity.title, child.key, 0);
        }
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
        insertTopicOwner.run(normalizeTopicPhrase(parent.title), parent.key, parent.title, entity.key, 0);
      }
    }
    for (const chunk of buildKnowledgeChunks(catalog)) {
      const insertResult = insertChunk.run(
        chunk.id,
        chunk.entityKey,
        chunk.entityTitle,
        chunk.kind,
        chunk.text,
        chunk.caveat,
        chunk.strength,
        JSON.stringify(chunk.sources),
        chunk.priority,
      );
      insertSearch.run(insertResult.lastInsertRowid, chunk.searchText);
    }
    database.exec("COMMIT");
    database.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('optimize'); VACUUM;");
  } finally {
    database.close();
  }
}

export function searchHealthCommonsKnowledgeIndex(input: {
  databasePath: string;
  limit?: number;
  query: string;
}): HealthCommonsKnowledgeSearchResult {
  const query = input.query.trim();
  if (!query) {
    throw new Error("Health Commons knowledge query must not be blank.");
  }
  if (query.length > HEALTH_COMMONS_KNOWLEDGE_MAX_QUERY_LENGTH) {
    throw new Error(
      `Health Commons knowledge query must be at most ${HEALTH_COMMONS_KNOWLEDGE_MAX_QUERY_LENGTH} characters.`,
    );
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
    const resolution = resolveKnowledgeTopic(database, normalizedQuestion);
    if (!resolution.resolved) {
      return {
        candidates: resolution.candidates,
        items: [],
        query,
        safety: null,
        topic: null,
      };
    }
    const { entityKeys, matchedPhrase, topic } = resolution.resolved;
    if (entityKeys.length === 0 || entityKeys.length > HEALTH_COMMONS_KNOWLEDGE_MAX_TOPICS) {
      return {
        candidates: [],
        items: [],
        query,
        safety: null,
        topic,
      };
    }
    const focusTokens = questionFocusTokens(normalizedQuestion, matchedPhrase);
    const safetyOnlyQuestion =
      focusTokens.some((token) => GENERIC_SAFETY_TERMS.has(token)) &&
      !focusTokens.some((token) => GENERIC_EVIDENCE_TERMS.has(token));
    const contentTokens = focusTokens.filter(
      (token) => !GENERIC_SAFETY_TERMS.has(token) && !GENERIC_EVIDENCE_TERMS.has(token),
    );
    const items = safetyOnlyQuestion
      ? []
      : searchResolvedKnowledge(database, {
          entityKeys,
          kind: "evidence",
          limit,
          tokens: contentTokens,
        });
    const safety =
      searchResolvedKnowledge(database, {
        entityKeys,
        kind: "safety",
        limit: 1,
        tokens: contentTokens,
      })[0] ?? null;

    return { candidates: [], items, query, safety, topic };
  } finally {
    database.close();
  }
}

function resolveKnowledgeTopic(
  database: DatabaseSync,
  normalizedQuestion: string,
): {
  candidates: HealthCommonsKnowledgeTopic[];
  resolved: ResolvedKnowledgeTopic | null;
} {
  const rows = database
    .prepare(
      `
    SELECT phrase, owner_key, owner_title, entity_key, match_priority
    FROM topic_owners
    ORDER BY match_priority ASC, length(phrase) DESC, phrase ASC, owner_key ASC, entity_key ASC
  `,
    )
    .all()
    .map(readTopicOwnerRow);
  const exactRows = rows.filter((row) => containsPhrase(normalizedQuestion, row.phrase));
  const rankedRows = exactRows.length > 0 ? exactRows : conservativeOverlapRows(rows, normalizedQuestion);
  if (rankedRows.length === 0) {
    return { candidates: [], resolved: null };
  }

  const bestPriority = Math.min(...rankedRows.map((row) => row.matchPriority));
  const priorityRows = rankedRows.filter((row) => row.matchPriority === bestPriority);
  const longestTokenCount = Math.max(...priorityRows.map((row) => phraseTokens(row.phrase).length));
  const tokenRows = priorityRows.filter((row) => phraseTokens(row.phrase).length === longestTokenCount);
  const longestPhrase = Math.max(...tokenRows.map((row) => row.phrase.length));
  const bestRows = tokenRows.filter((row) => row.phrase.length === longestPhrase);
  const owners = uniqueTopics(bestRows);
  if (owners.length !== 1) {
    return {
      candidates: owners.slice(0, HEALTH_COMMONS_KNOWLEDGE_MAX_TOPIC_CANDIDATES),
      resolved: null,
    };
  }

  const topic = owners[0];
  if (!topic) {
    return { candidates: [], resolved: null };
  }
  const matchedPhrase = bestRows[0]?.phrase ?? "";
  const entityKeys = rows
    .filter((row) => row.ownerKey === topic.key && row.phrase === matchedPhrase)
    .map((row) => row.entityKey)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  return { candidates: [], resolved: { entityKeys, matchedPhrase, topic } };
}

function searchResolvedKnowledge(
  database: DatabaseSync,
  input: {
    entityKeys: readonly string[];
    kind: "evidence" | "safety";
    limit: number;
    tokens: readonly string[];
  },
): HealthCommonsKnowledgeSearchItem[] {
  const placeholders = input.entityKeys.map(() => "?").join(", ");
  const contentQuery = toFtsQuery(input.tokens);
  const kindPredicate = input.kind === "safety" ? "c.kind = 'safety'" : "c.kind <> 'safety'";
  const candidateRows =
    contentQuery === null
      ? database
          .prepare(
            `
          SELECT c.id, c.entity_key, c.entity_title, c.kind, c.text, c.caveat,
                 c.strength, c.sources_json, c.priority, 0 AS rank
          FROM chunks c
          WHERE ${kindPredicate}
            AND c.entity_key IN (${placeholders})
            AND c.sources_json <> '[]'
          ORDER BY c.priority ASC, c.id ASC
          LIMIT ?
        `,
          )
          .all(...input.entityKeys, Math.min(input.limit * 8, HEALTH_COMMONS_KNOWLEDGE_MAX_CANDIDATES))
      : database
          .prepare(
            `
          SELECT c.id, c.entity_key, c.entity_title, c.kind, c.text, c.caveat,
                 c.strength, c.sources_json, c.priority, bm25(chunks_fts) AS rank
          FROM chunks_fts
          JOIN chunks c ON c.rowid = chunks_fts.rowid
          WHERE chunks_fts MATCH ? AND ${kindPredicate}
            AND c.entity_key IN (${placeholders})
            AND c.sources_json <> '[]'
          ORDER BY rank ASC, c.priority ASC, c.id ASC
          LIMIT ?
        `,
          )
          .all(contentQuery, ...input.entityKeys, Math.min(input.limit * 8, HEALTH_COMMONS_KNOWLEDGE_MAX_CANDIDATES));
  return selectDiverseKnowledgeRows(candidateRows, input.limit).map(readKnowledgeRow);
}

function selectDiverseKnowledgeRows(
  rows: readonly Record<string, SQLOutputValue>[],
  limit: number,
): Record<string, SQLOutputValue>[] {
  const selected: Record<string, SQLOutputValue>[] = [];
  const sourceSets = new Set<string>();

  for (const row of rows) {
    const sourcesJson = String(row["sources_json"]);
    if (sourceSets.has(sourcesJson)) {
      continue;
    }
    sourceSets.add(sourcesJson);
    selected.push(row);
    if (selected.length === limit) {
      break;
    }
  }

  return selected;
}

function readKnowledgeRow(
  row: Record<string, SQLOutputValue>,
): HealthCommonsKnowledgeSearchItem {
  return {
    caveat: nullableString(row["caveat"]),
    entityKey: String(row["entity_key"]),
    entityTitle: String(row["entity_title"]),
    kind: readKnowledgeItemKind(row["kind"]),
    strength: nullableString(row["strength"]),
    text: String(row["text"]),
    sources: readSourceReferences(row["sources_json"]),
  };
}

function readKnowledgeItemKind(value: SQLOutputValue): HealthCommonsKnowledgeItemKind {
  const normalized = String(value);
  if (
    normalized === "claim"
    || normalized === "safety"
    || normalized === "source_finding"
  ) {
    return normalized;
  }
  throw new Error(`Invalid Health Commons knowledge item kind ${normalized}.`);
}

function readSourceReferences(value: SQLOutputValue): HealthCommonsKnowledgeSourceReference[] {
  const parsed: unknown = JSON.parse(String(value));
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid Health Commons knowledge source references.");
  }
  return parsed.map((entry) => readSourceReference(entry));
}

function readSourceReference(value: unknown): HealthCommonsKnowledgeSourceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Health Commons knowledge source reference.");
  }
  const entry = value as Record<string, unknown>;
  return {
    authors: nullableString(entry["authors"]),
    designKind: nullableString(entry["designKind"]),
    doi: nullableString(entry["doi"]),
    participantCount: typeof entry["participantCount"] === "number"
      ? entry["participantCount"]
      : null,
    pmid: nullableString(entry["pmid"]),
    sourceKey: String(entry["sourceKey"]),
    title: String(entry["title"]),
    url: nullableString(entry["url"]),
    year: typeof entry["year"] === "number" ? entry["year"] : null,
  };
}

function buildKnowledgeChunks(catalog: HealthCommonsCatalog): KnowledgeChunk[] {
  const entitiesByKey = new Map(catalog.entities.map((entity) => [entity.key, entity]));
  const chunks: KnowledgeChunk[] = [];

  for (const entity of catalog.entities) {
    const entityTopic = entityTopicText(entity);
    for (const [claimIndex, claim] of (entity.claims ?? []).entries()) {
      chunks.push({
        caveat: claim.caveats?.join(" ") ?? null,
        entityKey: entity.key,
        entityTitle: entity.title,
        id: `claim:${entity.key}:${claim.claimId}:${claimIndex}`,
        kind: claim.type === "safety" ? "safety" : "claim",
        priority: claim.type === "safety" ? 5 : 20,
        searchText: `${entityTopic} ${claim.text} ${(claim.caveats ?? []).join(" ")}`,
        sources: resolveSources(claim.sourceKeys ?? [], entitiesByKey),
        strength: claim.strength,
        text: claim.text,
      });
    }
    for (const [findingIndex, finding] of (entity.sourceFindings ?? []).entries()) {
      const safetyFinding = finding.findingKind === "safety"
        || finding.findingKind === "adverse_event";
      const evidenceUse = finding.evidenceUse?.join(", ") ?? null;
      for (const target of sourceFindingTargets(entity, entitiesByKey)) {
        chunks.push({
          caveat: evidenceUse ? `Evidence use: ${evidenceUse}.` : null,
          entityKey: target.key,
          entityTitle: target.title,
          id: `finding:${entity.key}:${target.key}:${finding.findingId}:${findingIndex}`,
          kind: safetyFinding ? "safety" : "source_finding",
          priority: safetyFinding ? 10 : 25,
          searchText: [
            entityTopicText(target),
            entity.source?.title ?? "",
            finding.population ?? "",
            finding.exposure ?? "",
            finding.outcome ?? "",
            finding.summary ?? "",
          ].join(" "),
          sources: resolveSources([entity.key], entitiesByKey),
          strength: null,
          text: finding.summary ?? finding.outcome ?? "",
        });
      }
    }
  }

  return chunks
    .filter((chunk) => chunk.sources.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((chunk, index) => ({ ...chunk, id: `${chunk.id}:${index}` }));
}

function resolveSources(
  sourceKeys: readonly string[],
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): HealthCommonsKnowledgeSourceReference[] {
  return [...new Set(sourceKeys)]
    .slice(0, HEALTH_COMMONS_KNOWLEDGE_MAX_SOURCES_PER_ITEM)
    .flatMap((sourceKey) => {
      const entity = entitiesByKey.get(sourceKey);
      if (!entity?.source) {
        return [];
      }
      return [{
        authors: entity.source.authors ?? null,
        designKind: entity.researchEvidence?.designKind ?? null,
        doi: entity.source.doi ?? null,
        participantCount: entity.researchEvidence?.participantCount ?? null,
        pmid: entity.source.pmid ?? null,
        sourceKey,
        title: entity.source.title ?? entity.title,
        url: entity.source.url ?? null,
        year: entity.source.year ?? null,
      }];
    });
}

function openKnowledgeDatabase(filePath: string, readOnly = false): DatabaseSync {
  const { DatabaseSync: NodeSqliteDatabaseSync } = process.getBuiltinModule("node:sqlite");
  return readOnly
    ? new NodeSqliteDatabaseSync(filePath, { readOnly: true })
    : new NodeSqliteDatabaseSync(filePath);
}

function entityTopicText(entity: HealthCommonsCatalogEntity): string {
  return [entity.title, ...(entity.aliases ?? [])].join(" ");
}

function hasSameTitleParent(
  entity: HealthCommonsCatalogEntity,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): boolean {
  if (entity.entityType !== "protocol_variant") {
    return false;
  }
  const title = normalizeTopicPhrase(entity.title);
  return (entity.relations ?? []).some((relation) =>
    relation.type === "parent_family"
    && normalizeTopicPhrase(entitiesByKey.get(relation.target)?.title ?? "") === title
  );
}

function sourceFindingTargets(
  entity: HealthCommonsCatalogEntity,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): HealthCommonsCatalogEntity[] {
  if (entity.entityType !== "source_artifact") {
    return [entity];
  }
  const relations = entity.relations ?? [];
  for (const relationType of ["related_protocol", "parent_family", "measures"] as const) {
    const targetKeys = [...new Set(relations
      .filter((relation) => relation.type === relationType)
      .map((relation) => relation.target))];
    if (targetKeys.length !== 1) {
      continue;
    }
    const target = entitiesByKey.get(targetKeys[0] ?? "");
    return target && target.entityType !== "source_artifact" ? [target] : [];
  }
  return [];
}

const QUESTION_GRAMMAR_TERMS = new Set([
  "a",
  "about",
  "after",
  "am",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "before",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "should",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "which",
  "will",
  "with",
  "would",
]);
const GENERIC_EVIDENCE_TERMS = new Set([
  "benefit",
  "benefits",
  "evidence",
  "health",
  "help",
  "helps",
  "improve",
  "improves",
  "overall",
  "say",
]);
const GENERIC_SAFETY_TERMS = new Set(["danger", "dangerous", "risk", "risks", "safe", "safely", "safety"]);

function toFtsQuery(tokens: readonly string[]): string | null {
  if (tokens.length === 0) {
    return null;
  }
  const terms = tokens.map((token) => {
    const quoted = `"${token.replaceAll('"', '""')}"`;
    return token.length === 1 ? quoted : `${quoted}*`;
  });
  return terms.join(" OR ");
}

function readTopicOwnerRow(row: Record<string, SQLOutputValue>): TopicOwnerRow {
  return {
    entityKey: String(row["entity_key"]),
    matchPriority: Number(row["match_priority"]),
    ownerKey: String(row["owner_key"]),
    ownerTitle: String(row["owner_title"]),
    phrase: String(row["phrase"]),
  };
}

function containsPhrase(question: string, phrase: string): boolean {
  return ` ${question} `.includes(` ${phrase} `);
}

function conservativeOverlapRows(rows: readonly TopicOwnerRow[], normalizedQuestion: string): TopicOwnerRow[] {
  const questionTokenSet = new Set(
    phraseTokens(normalizedQuestion).filter((token) => !QUESTION_GRAMMAR_TERMS.has(token)),
  );
  const scored = rows.flatMap((row) => {
    const tokens = phraseTokens(row.phrase).filter((token) => !QUESTION_GRAMMAR_TERMS.has(token));
    if (tokens.length < 2 || !tokens.every((token) => questionTokenSet.has(token))) {
      return [];
    }
    return [{ row, score: tokens.length }];
  });
  if (scored.length === 0) {
    return [];
  }
  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === bestScore).map((entry) => entry.row);
  return best;
}

function uniqueTopics(rows: readonly TopicOwnerRow[]): HealthCommonsKnowledgeTopic[] {
  const topics = new Map<string, HealthCommonsKnowledgeTopic>();
  for (const row of rows) {
    topics.set(row.ownerKey, { key: row.ownerKey, title: row.ownerTitle });
  }
  return [...topics.values()].sort(
    (left, right) => left.title.localeCompare(right.title) || left.key.localeCompare(right.key),
  );
}

function questionFocusTokens(normalizedQuestion: string, matchedPhrase: string): string[] {
  const questionTokens = phraseTokens(normalizedQuestion);
  const matchedTokens = phraseTokens(matchedPhrase);
  const phraseStart = findContiguousTokens(questionTokens, matchedTokens);
  const matchedTokenSet = new Set(matchedTokens);
  const withoutTopic =
    phraseStart === -1
      ? questionTokens.filter((token) => !matchedTokenSet.has(token))
      : questionTokens.filter((_, index) => index < phraseStart || index >= phraseStart + matchedTokens.length);
  return [...new Set(withoutTopic.filter((token) => !QUESTION_GRAMMAR_TERMS.has(token)))];
}

function findContiguousTokens(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) {
    return -1;
  }
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((token, offset) => haystack[index + offset] === token)) {
      return index;
    }
  }
  return -1;
}

function phraseTokens(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function normalizeTopicPhrase(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(" ") ?? "";
}

function searchTokens(query: string): string[] {
  return [...new Set(query
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [])];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
