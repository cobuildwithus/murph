import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import type {
  HealthCommonsCatalog,
  HealthCommonsCatalogEntity,
} from "@murphai/contracts";

export const HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE = "knowledge.sqlite";
export const HEALTH_COMMONS_KNOWLEDGE_INDEX_SCHEMA_VERSION = 2;
export const HEALTH_COMMONS_KNOWLEDGE_DEFAULT_LIMIT = 3;
export const HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT = 6;
const HEALTH_COMMONS_KNOWLEDGE_MAX_SOURCES_PER_ITEM = 4;
const HEALTH_COMMONS_KNOWLEDGE_MAX_CANDIDATES = 48;

export type HealthCommonsKnowledgeItemKind =
  | "appraisal"
  | "claim"
  | "overview"
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
  topicText: string;
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
        topic_text,
        search_text,
        content = '',
        tokenize = 'porter unicode61 remove_diacritics 2'
      );
    `);
    database.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)")
      .run("catalog_hash", catalog.catalogHash);

    const insertChunk = database.prepare(`
      INSERT INTO chunks
        (id, entity_key, entity_title, kind, text, caveat, strength, sources_json, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSearch = database.prepare(
      "INSERT INTO chunks_fts (rowid, topic_text, search_text) VALUES (?, ?, ?)",
    );

    database.exec("BEGIN");
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
      insertSearch.run(insertResult.lastInsertRowid, chunk.topicText, chunk.searchText);
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
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? HEALTH_COMMONS_KNOWLEDGE_DEFAULT_LIMIT), 1),
    HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT,
  );
  const ftsQuery = toFtsQuery(query);
  const database = openKnowledgeDatabase(input.databasePath, true);
  try {
    const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version !== HEALTH_COMMONS_KNOWLEDGE_INDEX_SCHEMA_VERSION) {
      throw new Error(`Unsupported Health Commons knowledge index version ${version}.`);
    }
    const catalogHashRow = database
      .prepare("SELECT value FROM metadata WHERE key = 'catalog_hash'")
      .get();
    const candidateRows = database.prepare(`
      SELECT c.id, c.entity_key, c.entity_title, c.kind, c.text, c.caveat,
             c.strength, c.sources_json, c.priority, bm25(chunks_fts) AS rank
      FROM chunks_fts
      JOIN chunks c ON c.rowid = chunks_fts.rowid
      WHERE chunks_fts MATCH ? AND c.kind <> 'safety'
      ORDER BY rank ASC, c.priority ASC, c.id ASC
      LIMIT ?
    `).all(
      ftsQuery,
      Math.min(limit * 8, HEALTH_COMMONS_KNOWLEDGE_MAX_CANDIDATES),
    );
    const rows = selectDiverseKnowledgeRows(candidateRows, limit);

    const items = rows.map(readKnowledgeRow);
    const safetyRow = database.prepare(`
      SELECT c.id, c.entity_key, c.entity_title, c.kind, c.text, c.caveat,
             c.strength, c.sources_json, c.priority
      FROM chunks_fts
      JOIN chunks c ON c.rowid = chunks_fts.rowid
      WHERE chunks_fts MATCH ? AND c.kind = 'safety'
      ORDER BY c.priority ASC, bm25(chunks_fts) ASC, c.id ASC
      LIMIT 1
    `).get(ftsQuery);
    const safety = safetyRow ? readKnowledgeRow(safetyRow) : null;

    return {
      catalogHash: String(catalogHashRow?.["value"] ?? ""),
      items,
      query,
      safety,
    };
  } finally {
    database.close();
  }
}

function selectDiverseKnowledgeRows(
  rows: readonly Record<string, SQLOutputValue>[],
  limit: number,
): Record<string, SQLOutputValue>[] {
  const selected: Record<string, SQLOutputValue>[] = [];
  const sourceSets = new Set<string>();
  let hasOverview = false;

  for (const row of rows) {
    const kind = String(row["kind"]);
    if (kind === "overview") {
      if (hasOverview) {
        continue;
      }
      hasOverview = true;
    }
    const sourcesJson = String(row["sources_json"]);
    if (sourcesJson !== "[]") {
      if (sourceSets.has(sourcesJson)) {
        continue;
      }
      sourceSets.add(sourcesJson);
    }
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
    normalized === "appraisal"
    || normalized === "claim"
    || normalized === "overview"
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
    const entityTitle = entitySearchText(entity);
    if (entity.summary && entity.entityType !== "source_artifact") {
      const text = entity.researchLandscape?.bottomLine ?? entity.summary;
      chunks.push({
        caveat: entity.researchLandscape?.mainCaveat ?? null,
        entityKey: entity.key,
        entityTitle: entity.title,
        id: `overview:${entity.key}`,
        kind: "overview",
        priority: overviewPriority(entity),
        searchText: `${entityTitle} ${text} ${entity.researchLandscape?.mainCaveat ?? ""}`,
        sources: [],
        strength: entity.researchLandscape?.confidenceLabel ?? null,
        text,
        topicText: entityTitle,
      });
    }
    for (const [claimIndex, claim] of (entity.claims ?? []).entries()) {
      chunks.push({
        caveat: claim.caveats?.join(" ") ?? null,
        entityKey: entity.key,
        entityTitle: entity.title,
        id: `claim:${entity.key}:${claim.claimId}:${claimIndex}`,
        kind: claim.type === "safety" ? "safety" : "claim",
        priority: claim.type === "safety" ? 5 : 20,
        searchText: `${entityTitle} ${sourceTitles(claim.sourceKeys ?? [], entitiesByKey)} ${claim.text} ${(claim.caveats ?? []).join(" ")}`,
        sources: resolveSources(claim.sourceKeys ?? [], entitiesByKey),
        strength: claim.strength,
        text: claim.text,
        topicText: `${entityTitle} ${sourceTitles(claim.sourceKeys ?? [], entitiesByKey)}`,
      });
    }
    for (const [findingIndex, finding] of (entity.sourceFindings ?? []).entries()) {
      const safetyFinding = finding.findingKind === "safety"
        || finding.findingKind === "adverse_event";
      chunks.push({
        caveat: null,
        entityKey: entity.key,
        entityTitle: entity.title,
        id: `finding:${entity.key}:${finding.findingId}:${findingIndex}`,
        kind: safetyFinding ? "safety" : "source_finding",
        priority: safetyFinding ? 10 : 25,
        searchText: `${entityTitle} ${finding.summary ?? finding.outcome ?? ""}`,
        sources: resolveSources([entity.key], entitiesByKey),
        strength: null,
        text: finding.summary ?? finding.outcome ?? "",
        topicText: entityTitle,
      });
    }
    if (entity.safety) {
      const safetyText = [
        ...(entity.safety.avoidOrGetClinicianGuidance ?? []),
        ...(entity.safety.stopIf ?? []),
        ...(entity.safety.notes ?? []),
      ].join(" ");
      if (safetyText) {
        chunks.push({
          caveat: null,
          entityKey: entity.key,
          entityTitle: entity.title,
          id: `safety:${entity.key}`,
          kind: "safety",
          priority: 5,
          searchText: `${entityTitle} ${safetyText}`,
          sources: resolveSources(collectEntitySourceKeys(entity), entitiesByKey),
          strength: entity.safety.cautionLevel,
          text: safetyText,
          topicText: entityTitle,
        });
      }
    }
  }

  for (const [appraisalIndex, appraisal] of catalog.evidenceAppraisals.entries()) {
    const target = entitiesByKey.get(appraisal.targetKey);
    const source = entitiesByKey.get(appraisal.sourceKey);
    const topicText = [target?.title, source?.title].filter(Boolean).join(" ");
    const safetyAppraisal = appraisal.stance === "safety_boundary"
      || /\bsafety-only\b/iu.test(`${appraisal.headline} ${appraisal.implication}`);
    chunks.push({
      caveat: appraisal.caveat ?? null,
      entityKey: appraisal.targetKey,
      entityTitle: target?.title ?? appraisal.targetKey,
      id: `appraisal:${appraisal.key}:${appraisalIndex}`,
      kind: safetyAppraisal ? "safety" : "appraisal",
      priority: safetyAppraisal ? 10 : evidencePriority(source),
      searchText: `${topicText} ${appraisal.headline} ${appraisal.implication} ${appraisal.caveat ?? ""}`,
      sources: resolveSources([appraisal.sourceKey], entitiesByKey),
      strength: appraisal.result,
      text: `${appraisal.headline} ${appraisal.implication}`,
      topicText,
    });
  }

  return chunks
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

function collectEntitySourceKeys(entity: HealthCommonsCatalogEntity): string[] {
  return [...new Set([
    ...(entity.claims ?? []).flatMap((claim) => claim.sourceKeys ?? []),
    ...(entity.relations ?? []).filter((relation) => relation.type === "cites").map((relation) => relation.target),
  ])];
}

function sourceTitles(
  sourceKeys: readonly string[],
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): string {
  return [...new Set(sourceKeys)]
    .map((sourceKey) => entitiesByKey.get(sourceKey)?.title)
    .filter((title): title is string => Boolean(title))
    .join(" ");
}

function evidencePriority(source: HealthCommonsCatalogEntity | undefined): number {
  switch (source?.researchEvidence?.designKind) {
    case "systematic_review":
    case "meta_analysis":
      return 12;
    case "randomized_controlled_trial":
    case "prospective_cohort":
      return 13;
    case "controlled_trial":
      return 14;
    case "guideline":
    case "narrative_review":
      return 15;
    default:
      return 18;
  }
}

function overviewPriority(entity: HealthCommonsCatalogEntity): number {
  if (entity.entityType === "protocol_variant") {
    return entity.lineage?.relationship === "external_named_protocol" ? 12 : 10;
  }
  return entity.entityType === "source_artifact" ? 40 : 30;
}

function entitySearchText(entity: HealthCommonsCatalogEntity): string {
  return entity.title;
}

function toFtsQuery(query: string): string {
  const tokens = searchTokens(query);
  if (tokens.length === 0) {
    throw new Error("Health Commons knowledge query needs at least one searchable term.");
  }
  const terms = tokens.map((token) => {
    const quoted = `"${token.replaceAll('"', '""')}"`;
    return token.length === 1 ? quoted : `${quoted}*`;
  });
  const qualifierPhrases = tokens.flatMap((token, index) => {
    if (token.length !== 1 || index === 0) {
      return [];
    }
    return [`"${tokens[index - 1]} ${token}"`];
  });
  return `topic_text : ${terms[0]} AND search_text : (${[
    ...terms,
    ...qualifierPhrases,
  ].join(" AND ")})`;
}

function searchTokens(query: string): string[] {
  return [...new Set(query
    .normalize("NFKD")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, 8) ?? [])];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
