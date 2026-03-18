import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  HEALTH_HISTORY_KINDS,
  compareCanonicalEntities,
  normalizeCanonicalDate,
  normalizeUniqueStringArray,
  uniqueStrings,
  type CanonicalEntity,
  type CanonicalEntityFamily,
} from "./canonical-entities.js";
import { collectCanonicalEntities } from "./health/canonical-collector.js";
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

interface SharedListFilterInput {
  ids?: string[];
  kinds?: string[];
  streams?: string[];
  experimentSlug?: string;
  date?: string;
  from?: string;
  to?: string;
  tags?: string[];
  text?: string;
}

interface PreparedTagAndTextFilter {
  tagSet: ReadonlySet<string> | null;
  normalizedText: string | null;
}

interface PreparedRecordLikeFilter extends PreparedTagAndTextFilter {
  idSet: ReadonlySet<string> | null;
  kindSet: ReadonlySet<string> | null;
  streamSet: ReadonlySet<string> | null;
  experimentSlug?: string;
  date?: string;
  from?: string;
  to?: string;
}

interface RecordLikeFilterSource {
  lookupIds: readonly string[];
  kind: string | null;
  stream: string | null;
  experimentSlug: string | null;
  date: string | null;
  occurredAt: string | null;
  tags: readonly string[];
}

export const ALL_VAULT_RECORD_TYPES = [
  "allergy",
  "assessment",
  "audit",
  "condition",
  "core",
  "current_profile",
  "event",
  "experiment",
  "family",
  "genetics",
  "goal",
  "history",
  "journal",
  "profile_snapshot",
  "regimen",
  "sample",
] as const satisfies readonly VaultRecordType[];

// `listRecords()` preserves this historical subset by default for compatibility.
// It is intentionally narrower than the full read-model coverage in `ALL_VAULT_RECORD_TYPES`.
const LEGACY_DEFAULT_LIST_RECORD_TYPES = [
  "audit",
  "core",
  "event",
  "experiment",
  "journal",
  "sample",
] as const satisfies readonly VaultRecordType[];

export async function readVault(vaultRoot: string): Promise<VaultReadModel> {
  return readVaultWithHealthMode(vaultRoot, "strict-async");
}

export async function readVaultTolerant(
  vaultRoot: string,
): Promise<VaultReadModel> {
  return readVaultWithHealthMode(vaultRoot, "tolerant-async");
}

async function readVaultWithHealthMode(
  vaultRoot: string,
  healthMode: "strict-async" | "tolerant-async",
): Promise<VaultReadModel> {
  const metadata = await readOptionalJson(path.join(vaultRoot, "vault.json"));
  const healthEntitiesPromise =
    healthMode === "strict-async"
      ? collectCanonicalEntities(vaultRoot, { mode: "strict-async" })
      : collectCanonicalEntities(vaultRoot, { mode: "tolerant-async" });
  const [baseEntities, healthEntities] = await Promise.all([
    readBaseEntities(vaultRoot, metadata),
    healthEntitiesPromise,
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
  return lookupById(getVaultEntities(vault), entityId, (entity) => entity.entityId);
}

export function listEntities(
  vault: VaultReadModel,
  filters: EntityFilter = {},
): CanonicalEntity[] {
  const { families, statuses } = filters;
  const recordLikeFilter = prepareRecordLikeFilter(filters);
  const familySet = toOptionalSet(families);
  const statusSet = toOptionalSet(statuses);

  return getVaultEntities(vault).filter((entity) => {
    if (!matchesRequiredSet(entity.family, familySet)) {
      return false;
    }

    if (!matchesOptionalSet(entity.status, statusSet)) {
      return false;
    }

    return matchesRecordLikeFilter(
      entity,
      recordLikeFilter,
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
    );
  });
}

export function lookupRecordById(
  vault: VaultReadModel,
  recordId: string,
): VaultRecord | null {
  return lookupById(vault.records, recordId, (record) => record.displayId);
}

export function listRecords(
  vault: VaultReadModel,
  filters: RecordFilter = {},
): VaultRecord[] {
  const { recordTypes } = filters;
  const recordLikeFilter = prepareRecordLikeFilter(filters);
  const typeSet = new Set(recordTypes ?? LEGACY_DEFAULT_LIST_RECORD_TYPES);

  return vault.records.filter((record) => {
    if (!matchesRequiredSet(record.recordType, typeSet)) {
      return false;
    }

    return matchesRecordLikeFilter(
      record,
      recordLikeFilter,
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
    );
  });
}

export function listExperiments(
  vault: VaultReadModel,
  filters: ExperimentFilter = {},
): VaultRecord[] {
  const { slug } = filters;
  const tagAndTextFilter = prepareTagAndTextFilter(filters);

  return vault.experiments.filter((record) => {
    if (slug && record.experimentSlug !== slug) {
      return false;
    }

    return matchesTagAndTextFilter(
      record.tags,
      [record.title, record.body, JSON.stringify(record.frontmatter)],
      tagAndTextFilter,
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
  const { from, to, experimentSlug } = filters;
  const tagAndTextFilter = prepareTagAndTextFilter(filters);

  return vault.journalEntries.filter((record) => {
    if (!matchesDateBounds(record.date, from, to)) {
      return false;
    }

    if (experimentSlug && record.experimentSlug !== experimentSlug) {
      return false;
    }

    return matchesTagAndTextFilter(
      record.tags,
      [record.title, record.body, JSON.stringify(record.frontmatter)],
      tagAndTextFilter,
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
    const id = pickString(attributes, ["vaultId"]) ?? pickString(metadata, ["vaultId"]) ?? "core";

    return {
      entityId: id,
      primaryLookupId: id,
      lookupIds: uniqueStrings([id]),
      family: "core",
      kind: "core_document",
      status: null,
      occurredAt: pickString(attributes, ["updatedAt"]),
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
  const experimentDir = path.join(vaultRoot, "bank/experiments");
  const fileEntries = await listDirectoryFiles(experimentDir);

  const pages = await Promise.all(
    fileEntries.filter(hasMarkdownExtension).map(async (entry) => {
      const filePath = path.join(experimentDir, entry);
      const relativePath = path.posix.join("bank/experiments", entry);
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

      return {
        entityId: id,
        primaryLookupId: id,
        lookupIds: uniqueStrings([id, slug]),
        family: "experiment",
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
        relatedIds: uniqueStrings([
          ...normalizeUniqueStringArray(attributes.relatedIds),
          ...normalizeUniqueStringArray(attributes.eventIds),
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
      const date = pickString(attributes, ["dayKey"]) ?? path.basename(dayEntry, ".md");
      const title =
        pickString(attributes, ["title"]) ??
        extractMarkdownHeading(document.body) ??
        date;
      const id = `journal:${date}`;
      const relatedIds = uniqueStrings([
        ...normalizeUniqueStringArray(attributes.relatedIds),
        ...normalizeUniqueStringArray(attributes.eventIds),
      ]);

      pages.push({
        entityId: id,
        primaryLookupId: id,
        lookupIds: uniqueStrings([id, date]),
        family: "journal",
        kind: "journal_day",
        status: pickString(attributes, ["status"]),
        occurredAt: pickString(attributes, ["updatedAt"]),
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
        experimentSlug: pickString(attributes, ["experimentSlug"]),
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
      const relatedIds = uniqueStrings([
        ...normalizeUniqueStringArray(payload.relatedIds),
        ...normalizeUniqueStringArray(payload.eventIds),
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
        date: normalizeCanonicalDate(occurredAt) ?? pickString(payload, ["dayKey"]),
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
        experimentSlug: pickString(payload, ["experimentSlug"]),
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

      return {
        entityId: rawRecordId,
        primaryLookupId: rawRecordId,
        lookupIds: uniqueStrings([rawRecordId]),
        family: "sample",
        kind: "sample",
        status: pickString(payload, ["quality"]),
        occurredAt,
        date: normalizeCanonicalDate(occurredAt) ?? pickString(payload, ["dayKey"]),
        path: sourcePath,
        title: `${stream} sample`,
        body: null,
        attributes: payload,
        frontmatter: null,
        relatedIds: uniqueStrings(normalizeUniqueStringArray(payload.relatedIds)),
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
  return normalizeUniqueStringArray(value);
}

function lookupById<T extends { lookupIds: readonly string[] }>(
  items: readonly T[],
  rawId: string,
  getDirectId: (item: T) => string,
): T | null {
  const normalizedId = normalizeLookupId(rawId);
  if (!normalizedId) {
    return null;
  }

  return (
    items.find((item) => getDirectId(item) === normalizedId) ??
    items.find((item) => item.lookupIds.includes(normalizedId)) ??
    null
  );
}

function normalizeLookupId(value: string): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.trim();
}

function prepareTagAndTextFilter(filters: {
  tags?: string[];
  text?: string;
}): PreparedTagAndTextFilter {
  return {
    tagSet: toOptionalSet(filters.tags),
    normalizedText: normalizeFilterText(filters.text),
  };
}

function prepareRecordLikeFilter(
  filters: SharedListFilterInput,
): PreparedRecordLikeFilter {
  return {
    ...prepareTagAndTextFilter(filters),
    idSet: toOptionalSet(filters.ids),
    kindSet: toOptionalSet(filters.kinds),
    streamSet: toOptionalSet(filters.streams),
    experimentSlug: filters.experimentSlug,
    date: filters.date,
    from: filters.from,
    to: filters.to,
  };
}

function matchesRecordLikeFilter(
  source: RecordLikeFilterSource,
  filter: PreparedRecordLikeFilter,
  haystackValues: readonly unknown[],
): boolean {
  if (!matchesLookupIds(source.lookupIds, filter.idSet)) {
    return false;
  }

  if (!matchesOptionalSet(source.kind, filter.kindSet)) {
    return false;
  }

  if (!matchesOptionalSet(source.stream, filter.streamSet)) {
    return false;
  }

  if (filter.experimentSlug && source.experimentSlug !== filter.experimentSlug) {
    return false;
  }

  if (filter.date && source.date !== filter.date) {
    return false;
  }

  if (!matchesDateBounds(source.date ?? source.occurredAt, filter.from, filter.to)) {
    return false;
  }

  return matchesTagAndTextFilter(source.tags, haystackValues, filter);
}

function matchesLookupIds(
  lookupIds: readonly string[],
  idSet: ReadonlySet<string> | null,
): boolean {
  return !idSet || lookupIds.some((lookupId) => idSet.has(lookupId));
}

function matchesRequiredSet<T>(
  value: T,
  valueSet: ReadonlySet<T> | null,
): boolean {
  return !valueSet || valueSet.has(value);
}

function matchesOptionalSet<T>(
  value: T | null | undefined,
  valueSet: ReadonlySet<T> | null,
): boolean {
  return !valueSet || (value !== null && value !== undefined && valueSet.has(value));
}

function toOptionalSet<T>(values: readonly T[] | undefined): ReadonlySet<T> | null {
  return values ? new Set(values) : null;
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

function matchesTagAndTextFilter(
  tags: readonly string[],
  haystackValues: readonly unknown[],
  filter: PreparedTagAndTextFilter,
): boolean {
  if (!matchesTagSet(tags, filter.tagSet)) {
    return false;
  }

  return matchesFilterText(haystackValues, filter.normalizedText);
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
        "updated_at",
      ]);
      normalizeArrayField(normalized, "tags");
      normalizeArrayField(normalized, "relatedIds");
      normalizeArrayField(normalized, "eventIds");
      return normalized;
    case "journal":
      removeKeys(normalized, [
        "day_key",
        "date",
        "event_ids",
        "sample_streams",
        "experiment_slug",
        "updated_at",
      ]);
      normalizeArrayField(normalized, "tags");
      normalizeArrayField(normalized, "eventIds");
      normalizeArrayField(normalized, "sampleStreams");
      normalizeArrayField(normalized, "relatedIds");
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
    "related_ids",
    "raw_refs",
    "event_ids",
    "photo_paths",
    "audio_paths",
  ]);
  normalizeArrayField(normalized, "tags");
  normalizeArrayField(normalized, "relatedIds");
  normalizeArrayField(normalized, "rawRefs");
  normalizeArrayField(normalized, "eventIds");
  normalizeArrayField(normalized, "photoPaths");
  normalizeArrayField(normalized, "audioPaths");

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
      ...normalizeUniqueStringArray(data.eventIds),
      primaryLookupId,
    ]);
    data.relatedIds = uniqueStrings(normalizeUniqueStringArray(data.relatedIds)).filter(
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

function hasMarkdownExtension(entry: string): boolean {
  return entry.endsWith(".md");
}

function toPosixRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join(path.posix.sep);
}
