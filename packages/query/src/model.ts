import { extractIsoDatePrefix } from "@murph/contracts";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  HEALTH_HISTORY_KINDS,
  collapseEventLedgerEntities,
  compareCanonicalEntities,
  linkTargetIds,
  normalizeCanonicalDate,
  normalizeUniqueStringArray,
  relatedToLinks,
  resolveCanonicalRecordClass,
  uniqueStrings,
  type CanonicalEntity,
  type CanonicalEntityLink,
  type CanonicalEntityFamily,
  type CanonicalRecordClass,
} from "./canonical-entities.ts";
import { collectCanonicalEntities } from "./health/canonical-collector.ts";
import { deriveVaultRecordIdentity } from "./id-families.ts";
import { parseMarkdownDocument } from "./markdown.ts";

type QueryRecordData = Record<string, unknown>;
type FrontmatterRecordType = "core" | "experiment" | "journal";
type JsonRecordType = "audit" | "event" | "sample";

export type VaultRecordType = CanonicalEntityFamily;
export type VaultRecordsByFamily = Partial<Record<VaultRecordType, VaultRecord[]>>;

export interface VaultRecord {
  displayId: string;
  primaryLookupId: string;
  lookupIds: string[];
  recordType: VaultRecordType;
  recordClass: CanonicalRecordClass;
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
  links: CanonicalEntityLink[];
  relatedIds?: string[];
}

export interface VaultReadModel {
  format: "murph.query.v1";
  vaultRoot: string;
  metadata: QueryRecordData | null;
  entities: CanonicalEntity[];
  byFamily: VaultRecordsByFamily;
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
  protocols: VaultRecord[];
  history: VaultRecord[];
  familyMembers: VaultRecord[];
  geneticVariants: VaultRecord[];
  foods: VaultRecord[];
  recipes: VaultRecord[];
  providers: VaultRecord[];
  workoutFormats: VaultRecord[];
  records: VaultRecord[];
}

export interface CreateVaultReadModelInput {
  metadata?: QueryRecordData | null;
  records: readonly VaultRecord[];
  vaultRoot: string;
}

interface VaultReadModelDerivedViews {
  entities: CanonicalEntity[];
  byFamily: VaultRecordsByFamily;
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
  protocols: VaultRecord[];
  history: VaultRecord[];
  familyMembers: VaultRecord[];
  geneticVariants: VaultRecord[];
  foods: VaultRecord[];
  recipes: VaultRecord[];
  providers: VaultRecord[];
  workoutFormats: VaultRecord[];
}

export interface EntityFilter {
  ids?: string[];
  families?: CanonicalEntityFamily[];
  recordClasses?: CanonicalRecordClass[];
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
  recordClasses?: CanonicalRecordClass[];
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
  recordClasses?: CanonicalRecordClass[];
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
  recordClassSet: ReadonlySet<CanonicalRecordClass> | null;
  kindSet: ReadonlySet<string> | null;
  streamSet: ReadonlySet<string> | null;
  experimentSlug?: string;
  date?: string;
  from?: string;
  to?: string;
}

function relatedIdsToLinks(...groups: readonly unknown[]): CanonicalEntityLink[] {
  return relatedToLinks(groups.flatMap((group) => normalizeUniqueStringArray(group)));
}

interface RecordLikeFilterSource {
  lookupIds: readonly string[];
  recordClass: CanonicalRecordClass;
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
  "food",
  "genetics",
  "goal",
  "history",
  "journal",
  "profile_snapshot",
  "protocol",
  "provider",
  "recipe",
  "sample",
  "workout_format",
] as const satisfies readonly VaultRecordType[];


function toCanonicalEntity(record: VaultRecord): CanonicalEntity {
  return {
    entityId: record.displayId,
    primaryLookupId: record.primaryLookupId,
    lookupIds: [...record.lookupIds],
    family: record.recordType,
    recordClass: record.recordClass,
    kind: record.kind ?? '',
    status: record.status ?? null,
    occurredAt: record.occurredAt,
    date: record.date,
    path: record.sourcePath,
    title: record.title,
    body: record.body,
    attributes: record.data,
    frontmatter: record.frontmatter,
    links: record.links,
    relatedIds: record.relatedIds ?? [],
    stream: record.stream,
    experimentSlug: record.experimentSlug,
    tags: [...record.tags],
  };
}

function deriveVaultReadModelViews(
  records: readonly VaultRecord[],
): VaultReadModelDerivedViews {
  const byFamily = groupRecordsByFamily(records);

  return {
    entities: records.map((record) => toCanonicalEntity(record)),
    byFamily,
    coreDocument: firstRecordOfType(byFamily, "core"),
    experiments: recordsOfType(byFamily, "experiment"),
    journalEntries: recordsOfType(byFamily, "journal"),
    events: recordsOfType(byFamily, "event"),
    samples: recordsOfType(byFamily, "sample"),
    audits: recordsOfType(byFamily, "audit"),
    assessments: recordsOfType(byFamily, "assessment"),
    profileSnapshots: recordsOfType(byFamily, "profile_snapshot"),
    currentProfile: firstRecordOfType(byFamily, "current_profile"),
    goals: recordsOfType(byFamily, "goal"),
    conditions: recordsOfType(byFamily, "condition"),
    allergies: recordsOfType(byFamily, "allergy"),
    protocols: recordsOfType(byFamily, "protocol"),
    history: recordsOfType(byFamily, "history"),
    familyMembers: recordsOfType(byFamily, "family"),
    geneticVariants: recordsOfType(byFamily, "genetics"),
    foods: recordsOfType(byFamily, "food"),
    recipes: recordsOfType(byFamily, "recipe"),
    providers: recordsOfType(byFamily, "provider"),
    workoutFormats: recordsOfType(byFamily, "workout_format"),
  };
}

function flattenVaultRecordsByFamily(
  byFamily: VaultRecordsByFamily,
): VaultRecord[] {
  return ALL_VAULT_RECORD_TYPES.flatMap((recordType) => byFamily[recordType]?.slice() ?? []);
}

function replaceVaultRecordFamily(
  records: readonly VaultRecord[],
  recordType: VaultRecordType,
  nextRecords: readonly VaultRecord[],
): VaultRecord[] {
  const byFamily = groupRecordsByFamily(records);

  if (nextRecords.length > 0) {
    byFamily[recordType] = nextRecords.slice();
  } else {
    delete byFamily[recordType];
  }

  return flattenVaultRecordsByFamily(byFamily);
}

export function createVaultReadModel(
  input: CreateVaultReadModelInput,
): VaultReadModel {
  let recordState = input.records.slice();
  let cachedViews: VaultReadModelDerivedViews | null = null;

  const readViews = (): VaultReadModelDerivedViews => {
    if (cachedViews === null) {
      cachedViews = deriveVaultReadModelViews(recordState);
    }

    return cachedViews;
  };

  const updateRecords = (nextRecords: readonly VaultRecord[]): void => {
    recordState = nextRecords.slice();
    cachedViews = null;
  };

  const updateRecordFamily = (
    recordType: VaultRecordType,
    nextRecords: readonly VaultRecord[],
  ): void => {
    updateRecords(replaceVaultRecordFamily(recordState, recordType, nextRecords));
  };

  const model = {
    format: "murph.query.v1" as const,
    metadata: input.metadata ?? null,
    vaultRoot: input.vaultRoot,
  } as VaultReadModel;

  Object.defineProperties(model, {
    records: {
      enumerable: true,
      get() {
        return recordState;
      },
      set(value: VaultRecord[]) {
        updateRecords(value);
      },
    },
    entities: {
      enumerable: true,
      get() {
        return readViews().entities;
      },
      set(value: CanonicalEntity[]) {
        updateRecords(value.map((entity) => toVaultRecord(entity, input.vaultRoot)));
      },
    },
    byFamily: {
      enumerable: true,
      get() {
        return readViews().byFamily;
      },
      set(value: VaultRecordsByFamily) {
        updateRecords(flattenVaultRecordsByFamily(value));
      },
    },
    coreDocument: {
      enumerable: true,
      get() {
        return readViews().coreDocument;
      },
      set(value: VaultRecord | null) {
        updateRecordFamily("core", value ? [value] : []);
      },
    },
    experiments: {
      enumerable: true,
      get() {
        return readViews().experiments;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("experiment", value);
      },
    },
    journalEntries: {
      enumerable: true,
      get() {
        return readViews().journalEntries;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("journal", value);
      },
    },
    events: {
      enumerable: true,
      get() {
        return readViews().events;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("event", value);
      },
    },
    samples: {
      enumerable: true,
      get() {
        return readViews().samples;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("sample", value);
      },
    },
    audits: {
      enumerable: true,
      get() {
        return readViews().audits;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("audit", value);
      },
    },
    assessments: {
      enumerable: true,
      get() {
        return readViews().assessments;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("assessment", value);
      },
    },
    profileSnapshots: {
      enumerable: true,
      get() {
        return readViews().profileSnapshots;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("profile_snapshot", value);
      },
    },
    currentProfile: {
      enumerable: true,
      get() {
        return readViews().currentProfile;
      },
      set(value: VaultRecord | null) {
        updateRecordFamily("current_profile", value ? [value] : []);
      },
    },
    goals: {
      enumerable: true,
      get() {
        return readViews().goals;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("goal", value);
      },
    },
    conditions: {
      enumerable: true,
      get() {
        return readViews().conditions;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("condition", value);
      },
    },
    allergies: {
      enumerable: true,
      get() {
        return readViews().allergies;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("allergy", value);
      },
    },
    protocols: {
      enumerable: true,
      get() {
        return readViews().protocols;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("protocol", value);
      },
    },
    history: {
      enumerable: true,
      get() {
        return readViews().history;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("history", value);
      },
    },
    familyMembers: {
      enumerable: true,
      get() {
        return readViews().familyMembers;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("family", value);
      },
    },
    geneticVariants: {
      enumerable: true,
      get() {
        return readViews().geneticVariants;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("genetics", value);
      },
    },
    foods: {
      enumerable: true,
      get() {
        return readViews().foods;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("food", value);
      },
    },
    recipes: {
      enumerable: true,
      get() {
        return readViews().recipes;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("recipe", value);
      },
    },
    providers: {
      enumerable: true,
      get() {
        return readViews().providers;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("provider", value);
      },
    },
    workoutFormats: {
      enumerable: true,
      get() {
        return readViews().workoutFormats;
      },
      set(value: VaultRecord[]) {
        updateRecordFamily("workout_format", value);
      },
    },
  });

  return model;
}

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

  return createVaultReadModel({
    vaultRoot,
    metadata,
    records: entities.map((entity) => toVaultRecord(entity, vaultRoot)),
  });
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
  const typeSet = new Set(recordTypes ?? ALL_VAULT_RECORD_TYPES);

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
      recordClass: resolveCanonicalRecordClass("core"),
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
      const links = relatedIdsToLinks(attributes.relatedIds, attributes.eventIds);

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
      const links = relatedIdsToLinks(attributes.relatedIds, attributes.eventIds);

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
        path: path.posix.join("journal", yearEntry, dayEntry),
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
      const links = relatedIdsToLinks(payload.relatedIds, payload.eventIds);
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
      const links = relatedIdsToLinks(payload.relatedIds);

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
    lookupIds: entity.lookupIds,
    recordType: entity.family,
    recordClass: entity.recordClass,
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
    links: entity.links,
    relatedIds: entity.relatedIds,
  };
}

export function recordRelationTargetIds(
  record: Pick<VaultRecord, "links" | "relatedIds" | "lookupIds">,
): string[] {
  return record.links.length > 0
    ? linkTargetIds(record.links)
    : record.relatedIds && record.relatedIds.length > 0
      ? record.relatedIds
      : record.lookupIds;
}

function groupRecordsByFamily(
  records: readonly VaultRecord[],
): VaultRecordsByFamily {
  const byFamily: VaultRecordsByFamily = {};

  for (const record of records) {
    const familyRecords = byFamily[record.recordType];
    if (familyRecords) {
      familyRecords.push(record);
      continue;
    }

    byFamily[record.recordType] = [record];
  }

  return byFamily;
}

function firstRecordOfType(
  byFamily: VaultRecordsByFamily,
  recordType: VaultRecordType,
): VaultRecord | null {
  return byFamily[recordType]?.[0] ?? null;
}

function recordsOfType(
  byFamily: VaultRecordsByFamily,
  recordType: VaultRecordType,
): VaultRecord[] {
  return byFamily[recordType]?.slice() ?? [];
}

function compareDateStrings(
  value: string | null | undefined,
  boundary: string,
): number {
  if (!value) {
    return -1;
  }

  const normalizedValue = extractIsoDatePrefix(value) ?? value;
  const normalizedBoundary = extractIsoDatePrefix(boundary) ?? boundary;

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
    recordClassSet: toOptionalSet(filters.recordClasses),
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

  if (!matchesRequiredSet(source.recordClass, filter.recordClassSet)) {
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
