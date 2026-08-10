import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import type {
  HealthCommonsCatalog,
  HealthCommonsCatalogEntity,
} from "@murphai/contracts";

export const HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE = "knowledge.sqlite";
export const HEALTH_COMMONS_KNOWLEDGE_INDEX_SCHEMA_VERSION = 4;
export const HEALTH_COMMONS_KNOWLEDGE_DEFAULT_LIMIT = 3;
export const HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT = 3;
const HEALTH_COMMONS_KNOWLEDGE_MAX_SOURCES_PER_ITEM = 4;
const HEALTH_COMMONS_KNOWLEDGE_MAX_CANDIDATES = 48;
const HEALTH_COMMONS_KNOWLEDGE_MAX_TOPICS = 32;
const HEALTH_COMMONS_QUESTION_STOP_WORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "benefit",
  "benefits",
  "can",
  "could",
  "did",
  "do",
  "does",
  "evidence",
  "effect",
  "effects",
  "for",
  "from",
  "health",
  "help",
  "helps",
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
  "overall",
  "please",
  "research",
  "safe",
  "safely",
  "safety",
  "say",
  "should",
  "study",
  "studies",
  "tell",
  "the",
  "this",
  "to",
  "use",
  "using",
  "what",
  "when",
  "whether",
  "while",
  "with",
  "work",
  "works",
  "would",
]);

const HEALTH_COMMONS_EVIDENCE_INTENT_TERMS = new Set([
  "affect",
  "affects",
  "benefit",
  "benefits",
  "evidence",
  "effect",
  "effects",
  "efficacy",
  "help",
  "helps",
  "improve",
  "improved",
  "improves",
  "outcome",
  "outcomes",
  "research",
  "study",
  "studies",
  "work",
  "works",
]);

const HEALTH_COMMONS_SAFETY_INTENT_TERMS = new Set([
  "avoid",
  "contraindication",
  "contraindications",
  "danger",
  "dangerous",
  "risk",
  "risks",
  "safe",
  "safely",
  "safety",
]);

export type HealthCommonsKnowledgeItemKind =
  | "claim"
  | "safety"
  | "source_finding";

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
  catalogHash: string;
  items: HealthCommonsKnowledgeSearchItem[];
  query: string;
  safety: HealthCommonsKnowledgeSearchItem | null;
  topicResolved: boolean;
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

export function writeHealthCommonsKnowledgeIndex(
  filePath: string,
  catalog: HealthCommonsCatalog,
): void {
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
    database.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)")
      .run("catalog_hash", catalog.catalogHash);
    const insertTopicOwner = database.prepare(
      `INSERT INTO topic_owners (phrase, owner_key, entity_key, match_priority)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (phrase, owner_key, entity_key) DO UPDATE SET
         match_priority = min(topic_owners.match_priority, excluded.match_priority)`,
    );

    const insertChunk = database.prepare(`
      INSERT INTO chunks
        (id, entity_key, entity_title, kind, text, caveat, strength, sources_json, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSearch = database.prepare(
      "INSERT INTO chunks_fts (rowid, search_text) VALUES (?, ?)",
    );

    database.exec("BEGIN");
    const entitiesByKey = new Map(catalog.entities.map((entity) => [entity.key, entity]));
    for (const entity of catalog.entities) {
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
    const questionTokens = searchTokens(normalizedQuestion);
    const focusTokens = questionFocusTokens(normalizedQuestion, topic.phrase);
    const contentQuery = focusTokens.length > 0 ? toFtsQuery(focusTokens) : null;
    const safetyOnly = questionTokens.some((token) =>
      HEALTH_COMMONS_SAFETY_INTENT_TERMS.has(token)
    ) && !questionTokens.some((token) =>
      HEALTH_COMMONS_EVIDENCE_INTENT_TERMS.has(token)
    );
    const candidateRows = safetyOnly
      ? []
      : contentQuery === null
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

function toFtsQuery(tokens: readonly string[]): string {
  if (tokens.length === 0) {
    throw new Error("Health Commons knowledge query needs at least one searchable term.");
  }
  return tokens.map((token) => {
    const quoted = `"${token.replaceAll('"', '""')}"`;
    return token.length === 1 ? quoted : `${quoted}*`;
  }).join(" OR ");
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
