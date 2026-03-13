import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  HEALTH_HISTORY_KINDS,
  compareCanonicalEntities,
  normalizeCanonicalDate,
  uniqueStrings,
  type CanonicalEntity,
  type CanonicalEntityFamily,
} from "./canonical-entities.js";
import { collectCanonicalEntities } from "./health/canonical-collector.js";
import { maybeString } from "./health/shared.js";
import { deriveVaultRecordIdentity } from "./id-families.js";
import { parseMarkdownDocument } from "./markdown.js";

type QueryRecordData = Record<string, unknown>;
type FrontmatterRecordType = "core" | "experiment" | "journal";
type JsonRecordType = "audit" | "event" | "sample";

export type VaultRecordType = CanonicalEntityFamily;

export interface VaultRecord {
  displayId: string;
  primaryLookupId: string;
  /** @deprecated Use `displayId` instead. */
  id: string;
  lookupIds: string[];
  recordType: VaultRecordType;
  sourcePath: string;
  sourceFile: string;
  occurredAt: string | null;
  date: string | null;
  kind: string | null;
  status?: string | null;
  stream: string | null;
  experimentSlug: string | null;
  title: string | null;
  tags: string[];
  data: QueryRecordData;
  body: string | null;
  frontmatter: QueryRecordData | null;
  relatedIds?: string[];
}

export interface VaultReadModel {
  format: "healthybob.query.v1";
  vaultRoot: string;
  metadata: QueryRecordData | null;
  entities: CanonicalEntity[];
  coreDocument: VaultRecord | null;
  experiments: VaultRecord[];
  journalEntries: VaultRecord[];
  events: VaultRecord[];
  samples: VaultRecord[];
  audits: VaultRecord[];
  assessments: VaultRecord[];
  profileSnapshots: VaultRecord[];
  currentProfile: VaultRecord | null;
  goals: VaultRecord[];
  conditions: VaultRecord[];
  allergies: VaultRecord[];
  regimens: VaultRecord[];
  history: VaultRecord[];
  familyMembers: VaultRecord[];
  geneticVariants: VaultRecord[];
  records: VaultRecord[];
}

export interface EntityFilter {
  ids?: string[];
  families?: CanonicalEntityFamily[];
  kinds?: string[];
  statuses?: string[];
  streams?: string[];
  experimentSlug?: string;
  date?: string;
  from?: string;
  to?: string;
  tags?: string[];
  text?: string;
}

export interface RecordFilter {
  ids?: string[];
  recordTypes?: VaultRecordType[];
  kinds?: string[];
  streams?: string[];
  experimentSlug?: string;
  date?: string;
  from?: string;
  to?: string;
  tags?: string[];
  text?: string;
}

export interface ExperimentFilter {
  slug?: string;
  tags?: string[];
  text?: string;
}

export interface JournalFilter {
  from?: string;
  to?: string;
  experimentSlug?: string;
  tags?: string[];
  text?: string;
}

const DEFAULT_LIST_RECORD_TYPES: VaultRecordType[] = [
  "audit",
  "core",
  "event",
  "experiment",
  "journal",
  "sample",
];

export async function readVault(vaultRoot: string): Promise<VaultReadModel> {
  const metadata = await readOptionalJson(path.join(vaultRoot, "vault.json"));
  const [baseEntities, healthEntities] = await Promise.all([
    readBaseEntities(vaultRoot, metadata),
    collectCanonicalEntities(vaultRoot, { mode: "tolerant-async" }),
  ]);
  const entities = [...baseEntities, ...healthEntities.entities]
    .sort(compareCanonicalEntities);
  const records = entities.map((entity) => toVaultRecord(entity, vaultRoot));

  const coreDocument = firstRecordOfType(records, "core");
  const experiments = recordsOfType(records, "experiment");
  const journalEntries = recordsOfType(records, "journal");
  const events = recordsOfType(records, "event");
  const samples = recordsOfType(records, "sample");
  const audits = recordsOfType(records, "audit");
  const assessments = recordsOfType(records, "assessment");
  const profileSnapshots = recordsOfType(records, "profile_snapshot");
  const currentProfile = firstRecordOfType(records, "current_profile");
  const goals = recordsOfType(records, "goal");
  const conditions = recordsOfType(records, "condition");
  const allergies = recordsOfType(records, "allergy");
  const regimens = recordsOfType(records, "regimen");
  const history = recordsOfType(records, "history");
  const familyMembers = recordsOfType(records, "family");
  const geneticVariants = recordsOfType(records, "genetics");

  return {
    format: "healthybob.query.v1",
    vaultRoot,
    metadata,
    entities,
    coreDocument,
    experiments,
    journalEntries,
    events,
    samples,
    audits,
    assessments,
    profileSnapshots,
    currentProfile,
    goals,
    conditions,
    allergies,
    regimens,
    history,
    familyMembers,
    geneticVariants,
    records,
  };
}

export function getVaultEntities(vault: VaultReadModel): CanonicalEntity[] {
  return vault.entities;
}

export function lookupEntityById(
  vault: VaultReadModel,
  entityId: string,
): CanonicalEntity | null {
  if (typeof entityId !== "string" || !entityId.trim()) {
    return null;
  }

  const normalizedId = entityId.trim();
  const entities = getVaultEntities(vault);

  return (
    entities.find((entity) => entity.entityId === normalizedId) ??
    entities.find((entity) => entity.lookupIds.includes(normalizedId)) ??
    null
  );
}

export function listEntities(
  vault: VaultReadModel,
  filters: EntityFilter = {},
): CanonicalEntity[] {
  const {
    ids,
    families,
    kinds,
    statuses,
    streams,
    experimentSlug,
    date,
    from,
    to,
    tags,
    text,
  } = filters;

  const idSet = ids ? new Set(ids) : null;
  const familySet = families ? new Set(families) : null;
  const kindSet = kinds ? new Set(kinds) : null;
  const statusSet = statuses ? new Set(statuses) : null;
  const streamSet = streams ? new Set(streams) : null;
  const tagSet = tags ? new Set(tags) : null;
  const normalizedText = normalizeFilterText(text);

  return getVaultEntities(vault).filter((entity) => {
    if (idSet && !entity.lookupIds.some((lookupId) => idSet.has(lookupId))) {
      return false;
    }

    if (familySet && !familySet.has(entity.family)) {
      return false;
    }

    if (kindSet && !kindSet.has(entity.kind)) {
      return false;
    }

    if (statusSet && (!entity.status || !statusSet.has(entity.status))) {
      return false;
    }

    if (streamSet && (!entity.stream || !streamSet.has(entity.stream))) {
      return false;
    }

    if (experimentSlug && entity.experimentSlug !== experimentSlug) {
      return false;
    }

    if (date && entity.date !== date) {
      return false;
    }

    if (!matchesDateBounds(entity.date ?? entity.occurredAt, from, to)) {
      return false;
    }

    if (!matchesTagSet(entity.tags, tagSet)) {
      return false;
    }

    return matchesFilterText(
      [
        entity.entityId,
        entity.primaryLookupId,
        ...entity.lookupIds,
        entity.family,
        entity.kind,
        entity.status,
        entity.stream,
        entity.experimentSlug,
        entity.title,
        entity.body,
        JSON.stringify(entity.attributes),
      ],
      normalizedText,
    );
  });
}

export function lookupRecordById(
  vault: VaultReadModel,
  recordId: string,
): VaultRecord | null {
  if (typeof recordId !== "string" || !recordId.trim()) {
    return null;
  }

  const normalizedId = recordId.trim();

  return (
    vault.records.find((record) => record.displayId === normalizedId) ??
    vault.records.find((record) => record.lookupIds.includes(normalizedId)) ??
    null
  );
}

export function listRecords(
  vault: VaultReadModel,
  filters: RecordFilter = {},
): VaultRecord[] {
  const {
    ids,
    recordTypes,
    kinds,
    streams,
    experimentSlug,
    date,
    from,
    to,
    tags,
    text,
  } = filters;

  const idSet = ids ? new Set(ids) : null;
  const typeSet = new Set(recordTypes ?? DEFAULT_LIST_RECORD_TYPES);
  const kindSet = kinds ? new Set(kinds) : null;
  const streamSet = streams ? new Set(streams) : null;
  const tagSet = tags ? new Set(tags) : null;
  const normalizedText = normalizeFilterText(text);

  return vault.records.filter((record) => {
    if (idSet && !record.lookupIds.some((lookupId) => idSet.has(lookupId))) {
      return false;
    }

    if (!typeSet.has(record.recordType)) {
      return false;
    }

    if (kindSet && (!record.kind || !kindSet.has(record.kind))) {
      return false;
    }

    if (streamSet && (!record.stream || !streamSet.has(record.stream))) {
      return false;
    }

    if (experimentSlug && record.experimentSlug !== experimentSlug) {
      return false;
    }

    if (date && record.date !== date) {
      return false;
    }

    if (!matchesDateBounds(record.date ?? record.occurredAt, from, to)) {
      return false;
    }

    if (!matchesTagSet(record.tags, tagSet)) {
      return false;
    }

    return matchesFilterText(
      [
        record.displayId,
        record.primaryLookupId,
        ...record.lookupIds,
        record.kind,
        record.status,
        record.stream,
        record.experimentSlug,
        record.title,
        record.body,
        JSON.stringify(record.data),
      ],
      normalizedText,
    );
  });
}

export function listExperiments(
  vault: VaultReadModel,
  filters: ExperimentFilter = {},
): VaultRecord[] {
  const { slug, tags, text } = filters;
  const tagSet = tags ? new Set(tags) : null;
  const normalizedText = normalizeFilterText(text);

  return vault.experiments.filter((record) => {
    if (slug && record.experimentSlug !== slug) {
      return false;
    }

    if (!matchesTagSet(record.tags, tagSet)) {
      return false;
    }

    return matchesFilterText(
      [record.title, record.body, JSON.stringify(record.frontmatter)],
      normalizedText,
    );
  });
}

export function getExperiment(
  vault: VaultReadModel,
  slug: string,
): VaultRecord | null {
  return vault.experiments.find((record) => record.experimentSlug === slug) ?? null;
}

export function listJournalEntries(
  vault: VaultReadModel,
  filters: JournalFilter = {},
): VaultRecord[] {
  const { from, to, experimentSlug, tags, text } = filters;
  const tagSet = tags ? new Set(tags) : null;
  const normalizedText = normalizeFilterText(text);

  return vault.journalEntries.filter((record) => {
    if (!matchesDateBounds(record.date, from, to)) {
      return false;
    }

    if (experimentSlug && record.experimentSlug !== experimentSlug) {
      return false;
    }

    if (!matchesTagSet(record.tags, tagSet)) {
      return false;
    }

    return matchesFilterText(
      [record.title, record.body, JSON.stringify(record.frontmatter)],
      normalizedText,
    );
  });
}

export function getJournalEntry(
  vault: VaultReadModel,
  date: string,
): VaultRecord | null {
  return vault.journalEntries.find((record) => record.date === date) ?? null;
}

async function readOptionalJson(filePath: string): Promise<QueryRecordData | null> {
  try {
    const contents = await readFile(filePath, "utf8");
    return JSON.parse(contents) as QueryRecordData;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

async function readBaseEntities(
  vaultRoot: string,
  metadata: QueryRecordData | null,
): Promise<CanonicalEntity[]> {
  const coreDocument = await readOptionalCoreEntity(vaultRoot, metadata);
  const experiments = await readExperimentEntities(vaultRoot);
  const journalEntries = await readJournalEntities(vaultRoot);
  const events = await readJsonlRecordFamily(vaultRoot, "ledger/events", "event");
  const samples = await readSampleEntities(vaultRoot);
  const audits = await readJsonlRecordFamily(vaultRoot, "audit", "audit");

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
  const filePath = path.join(vaultRoot, "CORE.md");

  try {
    const source = await readFile(filePath, "utf8");
    const document = parseMarkdownDocument(source);
    const attributes = normalizeFrontmatterAttributes("core", document.attributes);
    const title = pickString(attributes, ["title"]) ?? extractMarkdownHeading(document.body);
    const id =
      pickString(attributes, ["vaultId", "vault_id", "id"]) ??
      pickString(metadata, ["vaultId", "vault_id"]) ??
      "core";

    return {
      entityId: id,
      primaryLookupId: id,
      lookupIds: uniqueStrings([id]),
      family: "core",
      kind: "core_document",
      status: null,
      occurredAt: pickString(attributes, ["updatedAt", "updated_at"]),
      date: null,
      path: "CORE.md",
      title,
      body: document.body,
      attributes: {
        ...(metadata ?? {}),
        ...attributes,
      },
      frontmatter: attributes,
      relatedIds: [],
      stream: null,
      experimentSlug: null,
      tags: normalizeTags(document.attributes.tags),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

async function readExperimentEntities(vaultRoot: string): Promise<CanonicalEntity[]> {
  const experimentDir = path.join(vaultRoot, "bank/experiments");
  const fileEntries = await listDirectoryFiles(experimentDir);

  const pages = await Promise.all(
    fileEntries.filter(hasMarkdownExtension).map(async (entry) => {
      const filePath = path.join(experimentDir, entry);
      const source = await readFile(filePath, "utf8");
      const document = parseMarkdownDocument(source);
      const attributes = normalizeFrontmatterAttributes(
        "experiment",
        document.attributes,
      );
      const slug = pickString(attributes, ["slug"]) ?? path.basename(entry, ".md");
      const title =
        pickString(attributes, ["title"]) ??
        extractMarkdownHeading(document.body) ??
        slug;
      const startedOn = pickString(attributes, ["startedOn", "started_on"]);
      const id = pickString(attributes, ["experimentId", "id"]) ?? `experiment:${slug}`;

      return {
        entityId: id,
        primaryLookupId: id,
        lookupIds: uniqueStrings([id, slug]),
        family: "experiment",
        kind: "experiment",
        status: pickString(attributes, ["status"]),
        occurredAt: pickString(attributes, ["updatedAt", "updated_at"]) ?? startedOn,
        date: normalizeCanonicalDate(startedOn),
        path: path.posix.join("bank/experiments", entry),
        title,
        body: document.body,
        attributes: {
          ...attributes,
        },
        frontmatter: attributes,
        relatedIds: uniqueStrings([
          ...normalizeStringArray(attributes.relatedIds),
          ...normalizeStringArray(attributes.eventIds),
        ]),
        stream: null,
        experimentSlug: slug,
        tags: normalizeTags(attributes.tags),
      } satisfies CanonicalEntity;
    }),
  );

  return pages.sort(compareCanonicalEntities);
}

async function readJournalEntities(vaultRoot: string): Promise<CanonicalEntity[]> {
  const journalDir = path.join(vaultRoot, "journal");
  const yearEntries = await listDirectoryFiles(journalDir);
  const pages: CanonicalEntity[] = [];

  for (const yearEntry of yearEntries) {
    const yearDir = path.join(journalDir, yearEntry);
    const dayEntries = await listDirectoryFiles(yearDir);

    for (const dayEntry of dayEntries) {
      if (!hasMarkdownExtension(dayEntry)) {
        continue;
      }

      const filePath = path.join(yearDir, dayEntry);
      const source = await readFile(filePath, "utf8");
      const document = parseMarkdownDocument(source);
      const attributes = normalizeFrontmatterAttributes("journal", document.attributes);
      const date = pickString(attributes, ["dayKey", "date"]) ?? path.basename(dayEntry, ".md");
      const title =
        pickString(attributes, ["title"]) ??
        extractMarkdownHeading(document.body) ??
        date;
      const id = pickString(attributes, ["id"]) ?? `journal:${date}`;
      const relatedIds = uniqueStrings([
        ...normalizeStringArray(attributes.relatedIds),
        ...normalizeStringArray(attributes.eventIds),
      ]);

      pages.push({
        entityId: id,
        primaryLookupId: id,
        lookupIds: uniqueStrings([id, date]),
        family: "journal",
        kind: "journal_day",
        status: pickString(attributes, ["status"]),
        occurredAt: pickString(attributes, ["updatedAt", "updated_at"]),
        date,
        path: path.posix.join("journal", yearEntry, dayEntry),
        title,
        body: document.body,
        attributes: {
          ...attributes,
        },
        frontmatter: attributes,
        relatedIds,
        stream: null,
        experimentSlug: pickString(attributes, ["experimentSlug", "experiment_slug"]),
        tags: normalizeTags(attributes.tags),
      });
    }
  }

  return pages.sort(compareCanonicalEntities);
}

async function readJsonlRecordFamily(
  vaultRoot: string,
  relativeDir: string,
  recordType: Exclude<JsonRecordType, "sample">,
): Promise<CanonicalEntity[]> {
  return readSortedJsonlRecords(
    vaultRoot,
    relativeDir,
    (sourcePath, lineNumber, rawPayload) => {
      const payload = normalizeJsonRecordPayload(recordType, rawPayload);
      const kind =
        pickString(payload, ["kind"]) ?? (recordType === "audit" ? "audit" : recordType);

      if (recordType === "event" && kind && HEALTH_HISTORY_KINDS.has(kind as never)) {
        return null;
      }

      const rawRecordId =
        pickString(payload, ["id"]) ??
        `${recordType}:${sourcePath}:${lineNumber}`;
      const occurredAt = pickString(payload, [
        "occurredAt",
        "recordedAt",
        "occurred_at",
        "recorded_at",
        "timestamp",
      ]);
      const identity = deriveVaultRecordIdentity(recordType, payload, rawRecordId);
      const relatedIds = uniqueStrings([
        ...normalizeStringArray(payload.relatedIds),
        ...normalizeStringArray(payload.eventIds),
      ]);

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
        kind,
        status: pickString(payload, ["status"]),
        occurredAt,
        date: normalizeCanonicalDate(occurredAt) ?? pickString(payload, ["dayKey", "day_key"]),
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
        relatedIds,
        stream: null,
        experimentSlug: pickString(payload, ["experimentSlug", "experiment_slug"]),
        tags: normalizeTags(payload.tags),
      };
    },
  );
}

async function readSampleEntities(vaultRoot: string): Promise<CanonicalEntity[]> {
  return readSortedJsonlRecords(
    vaultRoot,
    "ledger/samples",
    (sourcePath, lineNumber, rawPayload) => {
      const streamFromPath = inferSampleStreamFromPath(sourcePath);
      const payload = normalizeJsonRecordPayload("sample", rawPayload);
      const rawRecordId =
        pickString(payload, ["id"]) ?? `sample:${sourcePath}:${lineNumber}`;
      const occurredAt = pickString(payload, [
        "recordedAt",
        "occurredAt",
        "recorded_at",
        "occurred_at",
        "timestamp",
      ]);
      const stream = pickString(payload, ["stream"]) ?? streamFromPath;

      return {
        entityId: rawRecordId,
        primaryLookupId: rawRecordId,
        lookupIds: uniqueStrings([rawRecordId]),
        family: "sample",
        kind: "sample",
        status: pickString(payload, ["quality"]),
        occurredAt,
        date: normalizeCanonicalDate(occurredAt) ?? pickString(payload, ["dayKey", "day_key"]),
        path: sourcePath,
        title: stream ? `${stream} sample` : "sample",
        body: null,
        attributes: payload,
        frontmatter: null,
        relatedIds: uniqueStrings(normalizeStringArray(payload.relatedIds)),
        stream,
        experimentSlug: pickString(payload, ["experimentSlug", "experiment_slug"]),
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

async function listDirectoryFiles(directoryPath: string): Promise<string[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries.map((entry) => entry.name).sort();
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
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

function toVaultRecord(entity: CanonicalEntity, vaultRoot: string): VaultRecord {
  return {
    displayId: entity.entityId,
    primaryLookupId: entity.primaryLookupId,
    id: entity.entityId,
    lookupIds: entity.lookupIds,
    recordType: entity.family,
    sourcePath: entity.path,
    sourceFile: path.join(vaultRoot, ...entity.path.split("/")),
    occurredAt: entity.occurredAt,
    date: entity.date,
    kind: entity.kind,
    status: entity.status,
    stream: entity.stream,
    experimentSlug: entity.experimentSlug,
    title: entity.title,
    tags: entity.tags,
    data: entity.attributes,
    body: entity.body,
    frontmatter: entity.frontmatter,
    relatedIds: entity.relatedIds,
  };
}

function recordToCanonicalEntity(record: VaultRecord): CanonicalEntity {
  return {
    entityId: record.displayId,
    primaryLookupId: record.primaryLookupId,
    lookupIds: record.lookupIds,
    family: record.recordType,
    kind: record.kind ?? record.recordType,
    status: record.status ?? maybeString(record.data.status),
    occurredAt: record.occurredAt,
    date: record.date,
    path: record.sourcePath,
    title: record.title,
    body: record.body,
    attributes: record.data,
    frontmatter: record.frontmatter,
    relatedIds:
      record.relatedIds ??
      uniqueStrings([
        ...normalizeStringArray(record.data.relatedIds),
        ...normalizeStringArray(record.data.eventIds),
      ]),
    stream: record.stream,
    experimentSlug: record.experimentSlug,
    tags: record.tags,
  };
}

function firstRecordOfType(
  records: readonly VaultRecord[],
  recordType: VaultRecordType,
): VaultRecord | null {
  return records.find((record) => record.recordType === recordType) ?? null;
}

function recordsOfType(
  records: readonly VaultRecord[],
  recordType: VaultRecordType,
): VaultRecord[] {
  return records.filter((record) => record.recordType === recordType);
}

function compareDateStrings(
  value: string | null | undefined,
  boundary: string,
): number {
  if (!value) {
    return -1;
  }

  const normalizedValue = value.length > 10 ? value.slice(0, 10) : value;
  const normalizedBoundary = boundary.length > 10 ? boundary.slice(0, 10) : boundary;

  if (normalizedValue < normalizedBoundary) {
    return -1;
  }

  if (normalizedValue > normalizedBoundary) {
    return 1;
  }

  return 0;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function extractMarkdownHeading(body: string): string | null {
  const match = /^#\s+(.+)$/m.exec(body);
  return match ? match[1].trim() : null;
}

function normalizeTags(value: unknown): string[] {
  return normalizeStringArray(value);
}

function normalizeFilterText(text: string | undefined): string | null {
  return text ? text.toLowerCase() : null;
}

function matchesDateBounds(
  value: string | null | undefined,
  from?: string,
  to?: string,
): boolean {
  if (from && compareDateStrings(value, from) < 0) {
    return false;
  }

  if (to && compareDateStrings(value, to) > 0) {
    return false;
  }

  return true;
}

function matchesTagSet(
  values: readonly string[],
  tagSet: ReadonlySet<string> | null,
): boolean {
  return !tagSet || values.some((value) => tagSet.has(value));
}

function matchesFilterText(
  values: readonly unknown[],
  normalizedText: string | null,
): boolean {
  return !normalizedText || buildTextHaystack(values).includes(normalizedText);
}

function buildTextHaystack(values: readonly unknown[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .toLowerCase();
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

function inferSampleStreamFromPath(sourcePath: string): string | null {
  const segments = sourcePath.split("/");
  const sampleIndex = segments.indexOf("samples");

  if (sampleIndex === -1) {
    return null;
  }

  return segments[sampleIndex + 1] ?? null;
}

function normalizeFrontmatterAttributes(
  recordType: FrontmatterRecordType,
  attributes: QueryRecordData,
): QueryRecordData {
  const normalized = cloneRecordData(attributes);

  switch (recordType) {
    case "core":
      assignCanonicalStrings(normalized, attributes, [
        ["vaultId", ["vaultId", "vault_id", "id"]],
        ["updatedAt", ["updatedAt", "updated_at"]],
      ]);
      normalized.tags = normalizeStringArray(normalized.tags);
      return normalized;
    case "experiment":
      assignCanonicalStrings(normalized, attributes, [
        ["experimentId", ["experimentId", "experiment_id", "id"]],
        ["slug", ["slug", "experimentSlug", "experiment_slug"]],
        ["startedOn", ["startedOn", "started_on"]],
        ["updatedAt", ["updatedAt", "updated_at"]],
      ]);
      normalized.tags = normalizeStringArray(normalized.tags);
      return normalized;
    case "journal":
      assignCanonicalStrings(normalized, attributes, [
        ["dayKey", ["dayKey", "day_key", "date"]],
        ["experimentSlug", ["experimentSlug", "experiment_slug"]],
        ["updatedAt", ["updatedAt", "updated_at"]],
      ]);
      assignCanonicalArrays(normalized, attributes, [
        ["eventIds", ["eventIds", "event_ids"]],
        ["sampleStreams", ["sampleStreams", "sample_streams"]],
      ]);
      normalized.tags = normalizeStringArray(normalized.tags);
      return normalized;
    default:
      return normalized;
  }
}

function normalizeJsonRecordPayload(
  recordType: JsonRecordType,
  payload: QueryRecordData,
): QueryRecordData {
  const normalized = cloneRecordData(payload);

  assignCanonicalStrings(normalized, payload, [
    ["id", ["id"]],
    ["kind", ["kind"]],
    ["stream", ["stream"]],
    ["source", ["source"]],
    ["title", ["title"]],
    ["summary", ["summary"]],
    ["note", ["note"]],
    ["occurredAt", ["occurredAt", "occurred_at"]],
    ["recordedAt", ["recordedAt", "recorded_at", "timestamp"]],
    ["dayKey", ["dayKey", "day_key"]],
    ["experimentId", ["experimentId", "experiment_id"]],
    ["experimentSlug", ["experimentSlug", "experiment_slug"]],
    ["documentId", ["documentId", "document_id"]],
    ["documentPath", ["documentPath", "document_path"]],
    ["mimeType", ["mimeType", "mime_type"]],
    ["mealId", ["mealId", "meal_id"]],
    ["transformId", ["transformId", "transform_id"]],
    ["status", ["status"]],
  ]);
  assignCanonicalArrays(normalized, payload, [
    ["tags", ["tags"]],
    ["relatedIds", ["relatedIds", "related_ids"]],
    ["rawRefs", ["rawRefs", "raw_refs"]],
    ["eventIds", ["eventIds", "event_ids"]],
    ["photoPaths", ["photoPaths", "photo_paths"]],
    ["audioPaths", ["audioPaths", "audio_paths"]],
  ]);

  if (recordType === "sample") {
    assignCanonicalStrings(normalized, payload, [
      ["quality", ["quality"]],
      ["unit", ["unit"]],
    ]);
  }

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
  const { recordType, displayId, primaryLookupId, rawRecordId } = meta;
  const data = cloneRecordData(payload);

  if (recordType === "event" && displayId !== rawRecordId) {
    data.entityId = displayId;
    data.eventIds = uniqueStrings([
      ...normalizeStringArray(data.eventIds),
      primaryLookupId,
    ]);
    data.relatedIds = uniqueStrings(normalizeStringArray(data.relatedIds)).filter(
      (relatedId) => relatedId !== displayId,
    );
  }

  return data;
}

function cloneRecordData(
  value: QueryRecordData | null | undefined,
): QueryRecordData {
  return value && typeof value === "object" ? { ...value } : {};
}

function assignCanonicalString(
  target: QueryRecordData,
  source: QueryRecordData | null | undefined,
  key: string,
  aliases: readonly string[],
): void {
  const value = pickString(source, aliases);
  if (value) {
    target[key] = value;
  }
}

function assignCanonicalArray(
  target: QueryRecordData,
  source: QueryRecordData | null | undefined,
  key: string,
  aliases: readonly string[],
): void {
  const value = pickFirstArray(source, aliases);
  if (value) {
    target[key] = normalizeStringArray(value);
  }
}

function assignCanonicalStrings(
  target: QueryRecordData,
  source: QueryRecordData | null | undefined,
  entries: ReadonlyArray<readonly [string, readonly string[]]>,
): void {
  for (const [key, aliases] of entries) {
    assignCanonicalString(target, source, key, aliases);
  }
}

function assignCanonicalArrays(
  target: QueryRecordData,
  source: QueryRecordData | null | undefined,
  entries: ReadonlyArray<readonly [string, readonly string[]]>,
): void {
  for (const [key, aliases] of entries) {
    assignCanonicalArray(target, source, key, aliases);
  }
}

function pickFirstArray(
  object: QueryRecordData | null | undefined,
  keys: readonly string[],
): unknown[] | null {
  if (!object || typeof object !== "object") {
    return null;
  }

  for (const key of keys) {
    const value = object[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function hasMarkdownExtension(entry: string): boolean {
  return entry.endsWith(".md");
}

function toPosixRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join(path.posix.sep);
}
