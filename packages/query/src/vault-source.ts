import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  validateCurrentVaultMetadata,
  VAULT_LAYOUT,
  VAULT_QUERY_SOURCE,
} from "@murphai/contracts";

import {
  compareCanonicalEntities,
  isCanonicalEntityLinkType,
  linkTargetIds,
  normalizeCanonicalDate,
  normalizeCanonicalLinks,
  normalizeUniqueStringArray,
  relatedToLinks,
  resolveCanonicalRecordClass,
  uniqueStrings,
  type CanonicalEntity,
} from "./canonical-entities.ts";
import { collectCanonicalEntities } from "./health/canonical-collector.ts";
import { walkRelativeFiles } from "./health/loaders.ts";
import {
  HEALTH_HISTORY_KINDS,
  collapseEventLedgerEntities,
} from "./health/projectors/history.ts";
import { deriveVaultRecordIdentity } from "./id-families.ts";
import { parseMarkdownDocument } from "./markdown.ts";

export type QueryRecordData = Record<string, unknown>;

type FrontmatterRecordType = "core" | "experiment" | "journal";
type JsonRecordType = "audit" | "event" | "sample";

export interface VaultSourceSnapshot {
  metadata: QueryRecordData | null;
  entities: CanonicalEntity[];
}

export interface QuerySourceManifestEntry {
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
}

const CANONICAL_MARKDOWN_ROOTS = VAULT_QUERY_SOURCE.markdownRoots;
const CANONICAL_JSONL_ROOTS = VAULT_QUERY_SOURCE.jsonlRoots;
const CANONICAL_OPTIONAL_FILES = VAULT_QUERY_SOURCE.optionalFiles;

class QueryVaultSourceError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    this.details = details;
  }
}

function explicitCanonicalLinks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeCanonicalLinks(
    value.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }

      const candidate = entry as Record<string, unknown>;
      const type = typeof candidate.type === "string" ? candidate.type.trim() : "";
      const targetId = typeof candidate.targetId === "string" ? candidate.targetId.trim() : "";

      if (!type || !targetId || !isCanonicalEntityLinkType(type)) {
        return [];
      }

      return [{ type, targetId }];
    }),
  );
}

export async function readVaultSourceStrict(
  vaultRoot: string,
): Promise<VaultSourceSnapshot> {
  const metadata = await readOptionalVaultMetadata(path.join(vaultRoot, VAULT_LAYOUT.metadata));
  const [baseEntities, healthEntities] = await Promise.all([
    readBaseEntities(vaultRoot, metadata),
    collectCanonicalEntities(vaultRoot, { mode: "strict-async" }),
  ]);

  return {
    metadata,
    entities: [...baseEntities, ...healthEntities.entities].sort(compareCanonicalEntities),
  };
}

export async function readVaultSourceTolerant(
  vaultRoot: string,
): Promise<VaultSourceSnapshot> {
  const metadata = await readOptionalVaultMetadata(path.join(vaultRoot, VAULT_LAYOUT.metadata));
  const [baseEntities, healthEntities] = await Promise.all([
    readBaseEntities(vaultRoot, metadata),
    collectCanonicalEntities(vaultRoot, { mode: "tolerant-async" }),
  ]);

  return {
    metadata,
    entities: [...baseEntities, ...healthEntities.entities].sort(compareCanonicalEntities),
  };
}

export async function listCanonicalSourceManifest(
  vaultRoot: string,
): Promise<QuerySourceManifestEntry[]> {
  const relativePaths = new Set<string>();

  for (const relativePath of CANONICAL_OPTIONAL_FILES) {
    if (await pathExists(path.join(vaultRoot, relativePath))) {
      relativePaths.add(relativePath);
    }
  }

  for (const root of CANONICAL_MARKDOWN_ROOTS) {
    for (const relativePath of await walkRelativeFiles(vaultRoot, root, ".md")) {
      relativePaths.add(relativePath);
    }
  }

  for (const root of CANONICAL_JSONL_ROOTS) {
    for (const relativePath of await walkRelativeFiles(vaultRoot, root, ".jsonl")) {
      relativePaths.add(relativePath);
    }
  }

  const manifest = await Promise.all(
    [...relativePaths].sort().map(async (relativePath) => {
      const fileStats = await stat(path.join(vaultRoot, relativePath));
      return {
        relativePath,
        sizeBytes: fileStats.size,
        mtimeMs: fileStats.mtimeMs,
      } satisfies QuerySourceManifestEntry;
    }),
  );

  return manifest;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

async function readOptionalVaultMetadata(filePath: string): Promise<QueryRecordData | null> {
  try {
    const contents = await readFile(filePath, "utf8");
    return validateVaultMetadataForQuery(JSON.parse(contents));
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

function validateVaultMetadataForQuery(value: unknown): QueryRecordData {
  const result = validateCurrentVaultMetadata(value, {
    relativePath: VAULT_LAYOUT.metadata,
  });

  if (result.success) {
    return result.data.metadata;
  }

  throw new QueryVaultSourceError(
    result.error.code,
    result.error.message,
    result.error.details,
  );
}

async function readBaseEntities(
  vaultRoot: string,
  metadata: QueryRecordData | null,
): Promise<CanonicalEntity[]> {
  const coreDocument = await readOptionalCoreEntity(vaultRoot, metadata);
  const experiments = await readExperimentEntities(vaultRoot);
  const journalEntries = await readJournalEntities(vaultRoot);
  const events = await readJsonlRecordFamily(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, "event");
  const samples = await readSampleEntities(vaultRoot);
  const audits = await readJsonlRecordFamily(vaultRoot, VAULT_LAYOUT.auditDirectory, "audit");

  return [
    ...(coreDocument ? [coreDocument] : []),
    ...experiments,
    ...journalEntries,
    ...events,
    ...samples,
    ...audits,
  ];
}

async function readOptionalCoreEntity(
  vaultRoot: string,
  metadata: QueryRecordData | null,
): Promise<CanonicalEntity | null> {
  const filePath = path.join(vaultRoot, VAULT_LAYOUT.coreDocument);

  try {
    const source = await readFile(filePath, "utf8");
    const document = parseMarkdownDocument(source);
    const attributes = normalizeFrontmatterAttributes("core", document.attributes);
    const title = pickString(attributes, ["title"]) ?? extractMarkdownHeading(document.body);
    const id = pickString(attributes, ["vaultId"]) ?? pickString(metadata, ["vaultId"]) ?? "core";

    return {
      entityId: id,
      primaryLookupId: id,
      lookupIds: uniqueStrings([id]),
      family: "core",
      recordClass: resolveCanonicalRecordClass("core"),
      kind: "core_document",
      status: null,
      occurredAt: pickString(attributes, ["updatedAt"]),
      date: null,
      path: VAULT_LAYOUT.coreDocument,
      title,
      body: document.body,
      attributes: {
        ...(metadata ?? {}),
        ...attributes,
      },
      frontmatter: attributes,
      links: [],
      relatedIds: [],
      stream: null,
      experimentSlug: null,
      tags: normalizeTags(attributes.tags),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

async function readExperimentEntities(vaultRoot: string): Promise<CanonicalEntity[]> {
  const relativePaths = await walkRelativeFiles(vaultRoot, VAULT_LAYOUT.experimentsDirectory, ".md");

  const pages = await Promise.all(
    relativePaths.map(async (relativePath) => {
      const filePath = path.join(vaultRoot, relativePath);
      const source = await readFile(filePath, "utf8");
      const document = parseMarkdownDocument(source);
      const attributes = normalizeFrontmatterAttributes(
        "experiment",
        document.attributes,
      );
      const id = requireCanonicalString(
        attributes,
        "experimentId",
        `experiment frontmatter at ${relativePath}`,
      );
      const slug = requireCanonicalString(
        attributes,
        "slug",
        `experiment frontmatter at ${relativePath}`,
      );
      const startedOn = pickString(attributes, ["startedOn"]);
      const title =
        pickString(attributes, ["title"]) ??
        extractMarkdownHeading(document.body) ??
        slug;
      const links: CanonicalEntity["links"] = [];

      return {
        entityId: id,
        primaryLookupId: id,
        lookupIds: uniqueStrings([id, slug]),
        family: "experiment",
        recordClass: resolveCanonicalRecordClass("experiment"),
        kind: "experiment",
        status: pickString(attributes, ["status"]),
        occurredAt: pickString(attributes, ["updatedAt"]) ?? startedOn,
        date: normalizeCanonicalDate(startedOn),
        path: relativePath,
        title,
        body: document.body,
        attributes: {
          ...attributes,
        },
        frontmatter: attributes,
        links,
        relatedIds: linkTargetIds(links),
        stream: null,
        experimentSlug: slug,
        tags: normalizeTags(attributes.tags),
      } satisfies CanonicalEntity;
    }),
  );

  return pages.sort(compareCanonicalEntities);
}

async function readJournalEntities(vaultRoot: string): Promise<CanonicalEntity[]> {
  const relativePaths = await walkRelativeFiles(vaultRoot, VAULT_LAYOUT.journalDirectory, ".md");
  const pages: CanonicalEntity[] = [];

  for (const relativePath of relativePaths) {
    const filePath = path.join(vaultRoot, relativePath);
    const source = await readFile(filePath, "utf8");
    const document = parseMarkdownDocument(source);
    const attributes = normalizeFrontmatterAttributes("journal", document.attributes);
    const date = pickString(attributes, ["dayKey"]) ?? path.basename(relativePath, ".md");
    const title =
      pickString(attributes, ["title"]) ??
      extractMarkdownHeading(document.body) ??
      date;
    const id = `journal:${date}`;
    const links = relatedToLinks(normalizeUniqueStringArray(attributes.eventIds));

    pages.push({
      entityId: id,
      primaryLookupId: id,
      lookupIds: uniqueStrings([id, date]),
      family: "journal",
      recordClass: resolveCanonicalRecordClass("journal"),
      kind: "journal_day",
      status: pickString(attributes, ["status"]),
      occurredAt: pickString(attributes, ["updatedAt"]),
      date,
      path: relativePath,
      title,
      body: document.body,
      attributes: {
        ...attributes,
      },
      frontmatter: attributes,
      links,
      relatedIds: linkTargetIds(links),
      stream: null,
      experimentSlug: pickString(attributes, ["experimentSlug"]),
      tags: normalizeTags(attributes.tags),
    });
  }

  return pages.sort(compareCanonicalEntities);
}

async function readJsonlRecordFamily(
  vaultRoot: string,
  relativeDir: string,
  recordType: Exclude<JsonRecordType, "sample">,
): Promise<CanonicalEntity[]> {
  const entities = await readSortedJsonlRecords(
    vaultRoot,
    relativeDir,
    (sourcePath, lineNumber, rawPayload) => {
      const payload = normalizeJsonRecordPayload(recordType, rawPayload);
      const kind =
        recordType === "audit"
          ? pickString(payload, ["kind"]) ?? "audit"
          : requireCanonicalString(
              payload,
              "kind",
              `${recordType} record at ${sourcePath}:${lineNumber}`,
            );

      if (recordType === "event" && HEALTH_HISTORY_KINDS.has(kind as never)) {
        return null;
      }

      const rawRecordId = requireCanonicalString(
        payload,
        "id",
        `${recordType} record at ${sourcePath}:${lineNumber}`,
      );
      const occurredAt = requireCanonicalString(
        payload,
        "occurredAt",
        `${recordType} record at ${sourcePath}:${lineNumber}`,
      );
      const identity = deriveVaultRecordIdentity(recordType, payload, rawRecordId);
      const links = explicitCanonicalLinks(payload.links);
      const relatedIds = linkTargetIds(links);

      return {
        entityId: identity.displayId,
        primaryLookupId: identity.primaryLookupId,
        lookupIds: uniqueStrings([
          identity.displayId,
          identity.primaryLookupId,
          rawRecordId,
          ...relatedIds,
        ]),
        family: recordType,
        recordClass: resolveCanonicalRecordClass(recordType),
        kind,
        status: pickString(payload, ["status"]),
        occurredAt,
        date: pickString(payload, ["dayKey"]) ?? normalizeCanonicalDate(occurredAt),
        path: sourcePath,
        title: pickString(payload, ["title", "summary"]),
        body: pickString(payload, ["note", "summary"]),
        attributes: normalizeRecordData(payload, {
          recordType,
          displayId: identity.displayId,
          primaryLookupId: identity.primaryLookupId,
          rawRecordId,
        }),
        frontmatter: null,
        links,
        relatedIds,
        stream: null,
        experimentSlug: pickString(payload, ["experimentSlug"]),
        tags: normalizeTags(payload.tags),
      };
    },
  );

  return recordType === "event" ? collapseEventLedgerEntities(entities) : entities;
}

async function readSampleEntities(vaultRoot: string): Promise<CanonicalEntity[]> {
  return readSortedJsonlRecords(
    vaultRoot,
    VAULT_LAYOUT.sampleLedgerDirectory,
    (sourcePath, lineNumber, rawPayload) => {
      const payload = normalizeJsonRecordPayload("sample", rawPayload);
      const rawRecordId = requireCanonicalString(
        payload,
        "id",
        `sample record at ${sourcePath}:${lineNumber}`,
      );
      const occurredAt = requireCanonicalString(
        payload,
        "recordedAt",
        `sample record at ${sourcePath}:${lineNumber}`,
      );
      const stream = requireCanonicalString(
        payload,
        "stream",
        `sample record at ${sourcePath}:${lineNumber}`,
      );
      const links: CanonicalEntity["links"] = [];

      return {
        entityId: rawRecordId,
        primaryLookupId: rawRecordId,
        lookupIds: uniqueStrings([rawRecordId]),
        family: "sample",
        recordClass: resolveCanonicalRecordClass("sample"),
        kind: "sample",
        status: pickString(payload, ["quality"]),
        occurredAt,
        date: pickString(payload, ["dayKey"]) ?? normalizeCanonicalDate(occurredAt),
        path: sourcePath,
        title: `${stream} sample`,
        body: null,
        attributes: payload,
        frontmatter: null,
        links,
        relatedIds: linkTargetIds(links),
        stream,
        experimentSlug: pickString(payload, ["experimentSlug"]),
        tags: normalizeTags(payload.tags),
      };
    },
  );
}

async function readSortedJsonlRecords(
  vaultRoot: string,
  relativeDir: string,
  buildEntity: (
    sourcePath: string,
    lineNumber: number,
    payload: QueryRecordData,
  ) => CanonicalEntity | null,
): Promise<CanonicalEntity[]> {
  const entities: CanonicalEntity[] = [];

  await forEachJsonlPayload(vaultRoot, relativeDir, (sourcePath, lineNumber, payload) => {
    const entity = buildEntity(sourcePath, lineNumber, payload);
    if (entity) {
      entities.push(entity);
    }
  });

  return entities.sort(compareCanonicalEntities);
}

async function forEachJsonlPayload(
  vaultRoot: string,
  relativeDir: string,
  visit: (
    sourcePath: string,
    lineNumber: number,
    payload: QueryRecordData,
  ) => void,
): Promise<void> {
  const targetDir = path.join(vaultRoot, relativeDir);

  for (const filePath of await listFilesByExtension(targetDir, ".jsonl")) {
    const sourcePath = toPosixRelative(vaultRoot, filePath);
    await readJsonlFile(filePath, sourcePath, visit);
  }
}

async function readJsonlFile(
  filePath: string,
  sourcePath: string,
  visit: (
    sourcePath: string,
    lineNumber: number,
    payload: QueryRecordData,
  ) => void,
): Promise<void> {
  const contents = await readFile(filePath, "utf8");

  for (const [index, rawLine] of contents.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    visit(
      sourcePath,
      index + 1,
      JSON.parse(line) as QueryRecordData,
    );
  }
}

async function listFilesByExtension(
  directoryPath: string,
  extension: string,
): Promise<string[]> {
  return (await walkFiles(directoryPath)).filter((entry) => entry.endsWith(extension));
}

async function walkFiles(directoryPath: string): Promise<string[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await walkFiles(entryPath)));
        continue;
      }

      if (entry.isFile()) {
        files.push(entryPath);
      }
    }

    return files;
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

function extractMarkdownHeading(body: string): string | null {
  const match = /^#\s+(.+)$/m.exec(body);
  return match ? match[1].trim() : null;
}

function normalizeTags(value: unknown): string[] {
  return normalizeUniqueStringArray(value);
}

function pickString(
  object: QueryRecordData | null | undefined,
  keys: readonly string[],
): string | null {
  if (!object || typeof object !== "object") {
    return null;
  }

  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function normalizeFrontmatterAttributes(
  recordType: FrontmatterRecordType,
  attributes: QueryRecordData,
): QueryRecordData {
  const normalized = cloneRecordData(attributes);

  switch (recordType) {
    case "core":
      removeKeys(normalized, ["id", "vault_id", "updated_at"]);
      normalizeArrayField(normalized, "tags");
      return normalized;
    case "experiment":
      removeKeys(normalized, [
        "id",
        "experiment_id",
        "experimentSlug",
        "experiment_slug",
        "started_on",
        "relatedIds",
        "related_ids",
        "eventIds",
        "event_ids",
        "updated_at",
      ]);
      normalizeArrayField(normalized, "tags");
      return normalized;
    case "journal":
      removeKeys(normalized, [
        "day_key",
        "date",
        "relatedIds",
        "related_ids",
        "event_ids",
        "sample_streams",
        "experiment_slug",
        "updated_at",
      ]);
      normalizeArrayField(normalized, "tags");
      normalizeArrayField(normalized, "eventIds");
      normalizeArrayField(normalized, "sampleStreams");
      return normalized;
    default:
      return normalized;
  }
}

function normalizeJsonRecordPayload(
  _recordType: JsonRecordType,
  payload: QueryRecordData,
): QueryRecordData {
  const normalized = cloneRecordData(payload);

  removeKeys(normalized, [
    "occurred_at",
    "recorded_at",
    "timestamp",
    "day_key",
    "experiment_id",
    "experiment_slug",
    "document_id",
    "document_path",
    "mime_type",
    "meal_id",
    "transform_id",
    "relatedIds",
    "related_ids",
    "raw_refs",
    "eventIds",
    "event_ids",
    "documentPath",
    "photoPaths",
    "audioPaths",
    "photo_paths",
    "audio_paths",
  ]);
  normalizeArrayField(normalized, "tags");
  normalizeObjectArrayField(normalized, "attachments");
  normalizeArrayField(normalized, "rawRefs");

  return normalized;
}

function normalizeRecordData(
  payload: QueryRecordData,
  meta: {
    recordType: "audit" | "event";
    displayId: string;
    primaryLookupId: string;
    rawRecordId: string;
  },
): QueryRecordData {
  const { recordType, displayId, rawRecordId } = meta;
  const data = cloneRecordData(payload);

  if (recordType === "event" && displayId !== rawRecordId) {
    data.entityId = displayId;
    data.eventIds = uniqueStrings([
      ...normalizeUniqueStringArray(data.eventIds),
      rawRecordId,
    ]);
  }

  return data;
}

function cloneRecordData(
  value: QueryRecordData | null | undefined,
): QueryRecordData {
  return value && typeof value === "object" ? { ...value } : {};
}

function requireCanonicalString(
  object: QueryRecordData | null | undefined,
  key: string,
  context: string,
): string {
  const value = pickString(object, [key]);
  if (value) {
    return value;
  }

  throw new Error(`Missing canonical "${key}" in ${context}.`);
}

function removeKeys(target: QueryRecordData, keys: readonly string[]): void {
  for (const key of keys) {
    delete target[key];
  }
}

function normalizeArrayField(target: QueryRecordData, key: string): void {
  if (key in target) {
    target[key] = normalizeUniqueStringArray(target[key]);
  }
}

function normalizeObjectArrayField(target: QueryRecordData, key: string): void {
  if (!(key in target)) {
    return;
  }

  target[key] = Array.isArray(target[key])
    ? target[key].filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function toPosixRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join(path.posix.sep);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
