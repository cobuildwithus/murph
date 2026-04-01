import { extractIsoDatePrefix } from "@murphai/contracts";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  compareCanonicalEntities,
  linkTargetIds,
  normalizeCanonicalDate,
  normalizeUniqueStringArray,
  relatedToLinks,
  resolveCanonicalRecordClass,
  uniqueStrings,
  type CanonicalEntity,
  type CanonicalEntityFamily,
  type CanonicalRecordClass,
} from "./canonical-entities.ts";
import {
  HEALTH_HISTORY_KINDS,
  collapseEventLedgerEntities,
} from "./health/projectors/history.ts";
import { collectCanonicalEntities } from "./health/canonical-collector.ts";
import { deriveVaultRecordIdentity } from "./id-families.ts";
import { parseMarkdownDocument } from "./markdown.ts";

type QueryRecordData = Record<string, unknown>;
type FrontmatterRecordType = "core" | "experiment" | "journal";
type JsonRecordType = "audit" | "event" | "sample";

type VaultReadModelFamilyViews = {
  [K in VaultManyViewKey]: CanonicalEntity[];
} & {
  [K in VaultSingleViewKey]: CanonicalEntity | null;
};

export type VaultEntitiesByFamily = Partial<Record<CanonicalEntityFamily, CanonicalEntity[]>>;

export interface VaultReadModel extends VaultReadModelFamilyViews {
  format: "murph.query.v1";
  vaultRoot: string;
  metadata: QueryRecordData | null;
  entities: CanonicalEntity[];
  byFamily: VaultEntitiesByFamily;
}

export interface CreateVaultReadModelInput {
  metadata?: QueryRecordData | null;
  vaultRoot: string;
  entities: readonly CanonicalEntity[];
}

type VaultReadModelDerivedViews = {
  byFamily: VaultEntitiesByFamily;
} & VaultReadModelFamilyViews;

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

export const ALL_QUERY_ENTITY_FAMILIES = [
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
] as const satisfies readonly CanonicalEntityFamily[];


// Convenience views stay derived from the authoritative canonical entity array.
const VAULT_FAMILY_VIEW_SPECS = {
  coreDocument: { family: "core", mode: "single" },
  experiments: { family: "experiment", mode: "many" },
  journalEntries: { family: "journal", mode: "many" },
  events: { family: "event", mode: "many" },
  samples: { family: "sample", mode: "many" },
  audits: { family: "audit", mode: "many" },
  assessments: { family: "assessment", mode: "many" },
  profileSnapshots: { family: "profile_snapshot", mode: "many" },
  currentProfile: { family: "current_profile", mode: "single" },
  goals: { family: "goal", mode: "many" },
  conditions: { family: "condition", mode: "many" },
  allergies: { family: "allergy", mode: "many" },
  protocols: { family: "protocol", mode: "many" },
  history: { family: "history", mode: "many" },
  familyMembers: { family: "family", mode: "many" },
  geneticVariants: { family: "genetics", mode: "many" },
  foods: { family: "food", mode: "many" },
  recipes: { family: "recipe", mode: "many" },
  providers: { family: "provider", mode: "many" },
  workoutFormats: { family: "workout_format", mode: "many" },
} as const satisfies Record<
  string,
  {
    readonly mode: "many" | "single";
    readonly family: CanonicalEntityFamily;
  }
>;

type VaultFamilyViewKey = keyof typeof VAULT_FAMILY_VIEW_SPECS;
type VaultFamilyViewSpec = (typeof VAULT_FAMILY_VIEW_SPECS)[VaultFamilyViewKey];
type VaultSingleViewKey = {
  [K in VaultFamilyViewKey]: (typeof VAULT_FAMILY_VIEW_SPECS)[K]["mode"] extends "single"
    ? K
    : never;
}[VaultFamilyViewKey];
type VaultManyViewKey = Exclude<VaultFamilyViewKey, VaultSingleViewKey>;

const VAULT_FAMILY_VIEW_ENTRIES = Object.entries(
  VAULT_FAMILY_VIEW_SPECS,
) as ReadonlyArray<[VaultFamilyViewKey, VaultFamilyViewSpec]>;

function relatedIdsToLinks(...groups: readonly unknown[]) {
  return relatedToLinks(groups.flatMap((group) => normalizeUniqueStringArray(group)));
}

function deriveVaultFamilyViews(
  byFamily: VaultEntitiesByFamily,
): VaultReadModelFamilyViews {
  const views = {} as VaultReadModelFamilyViews;

  for (const [propertyName, spec] of VAULT_FAMILY_VIEW_ENTRIES) {
    (views as Record<
      VaultFamilyViewKey,
      VaultReadModelFamilyViews[VaultFamilyViewKey]
    >)[propertyName] =
      spec.mode === "single"
        ? firstEntityOfFamily(byFamily, spec.family)
        : entitiesOfFamily(byFamily, spec.family);
  }

  return views;
}

function deriveVaultReadModelViews(
  entities: readonly CanonicalEntity[],
): VaultReadModelDerivedViews {
  const byFamily = groupEntitiesByFamily(entities);

  return {
    byFamily,
    ...deriveVaultFamilyViews(byFamily),
  };
}

function flattenVaultEntitiesByFamily(
  byFamily: VaultEntitiesByFamily,
): CanonicalEntity[] {
  return ALL_QUERY_ENTITY_FAMILIES.flatMap((family) => byFamily[family]?.slice() ?? []);
}

function replaceVaultEntityFamily(
  entities: readonly CanonicalEntity[],
  family: CanonicalEntityFamily,
  nextEntities: readonly CanonicalEntity[],
): CanonicalEntity[] {
  const byFamily = groupEntitiesByFamily(entities);

  if (nextEntities.length > 0) {
    byFamily[family] = nextEntities.slice();
  } else {
    delete byFamily[family];
  }

  return flattenVaultEntitiesByFamily(byFamily);
}

function normalizeVaultFamilyViewEntities(
  spec: VaultFamilyViewSpec,
  value: VaultReadModelFamilyViews[VaultFamilyViewKey],
): CanonicalEntity[] {
  if (spec.mode === "single") {
    return value ? [value as CanonicalEntity] : [];
  }

  return (value as CanonicalEntity[]).slice();
}

export function createVaultReadModel(
  input: CreateVaultReadModelInput,
): VaultReadModel {
  let entityState = input.entities.slice();
  let cachedViews: VaultReadModelDerivedViews | null = null;

  const readViews = (): VaultReadModelDerivedViews => {
    if (cachedViews === null) {
      cachedViews = deriveVaultReadModelViews(entityState);
    }

    return cachedViews;
  };

  const updateEntities = (nextEntities: readonly CanonicalEntity[]): void => {
    entityState = nextEntities.slice();
    cachedViews = null;
  };

  const updateEntityFamily = (
    family: CanonicalEntityFamily,
    nextEntities: readonly CanonicalEntity[],
  ): void => {
    updateEntities(replaceVaultEntityFamily(entityState, family, nextEntities));
  };

  const model = {
    format: "murph.query.v1" as const,
    metadata: input.metadata ?? null,
    vaultRoot: input.vaultRoot,
  } as VaultReadModel;

  const descriptors: PropertyDescriptorMap = {
    entities: {
      enumerable: true,
      get() {
        return entityState;
      },
      set(value: CanonicalEntity[]) {
        updateEntities(value);
      },
    },
    byFamily: {
      enumerable: true,
      get() {
        return readViews().byFamily;
      },
      set(value: VaultEntitiesByFamily) {
        updateEntities(flattenVaultEntitiesByFamily(value));
      },
    },
  };

  for (const [propertyName, spec] of VAULT_FAMILY_VIEW_ENTRIES) {
    descriptors[propertyName] = {
      enumerable: true,
      get() {
        return readViews()[propertyName];
      },
      set(value: VaultReadModelFamilyViews[typeof propertyName]) {
        updateEntityFamily(
          spec.family,
          normalizeVaultFamilyViewEntities(spec, value),
        );
      },
    };
  }

  Object.defineProperties(model, descriptors);

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
    entities,
  });
}

export function getVaultEntities(vault: VaultReadModel): CanonicalEntity[] {
  return vault.entities;
}

export function entityRelationTargetIds(
  entity: Pick<CanonicalEntity, "links" | "relatedIds" | "lookupIds">,
): string[] {
  return entity.links.length > 0
    ? linkTargetIds(entity.links)
    : entity.relatedIds.length > 0
      ? entity.relatedIds
      : entity.lookupIds;
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

export function listExperiments(
  vault: VaultReadModel,
  filters: ExperimentFilter = {},
): CanonicalEntity[] {
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
): CanonicalEntity | null {
  return vault.experiments.find((record) => record.experimentSlug === slug) ?? null;
}

export function listJournalEntries(
  vault: VaultReadModel,
  filters: JournalFilter = {},
): CanonicalEntity[] {
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
): CanonicalEntity | null {
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

function groupEntitiesByFamily(
  entities: readonly CanonicalEntity[],
): VaultEntitiesByFamily {
  const byFamily: VaultEntitiesByFamily = {};

  for (const entity of entities) {
    const familyEntities = byFamily[entity.family];
    if (familyEntities) {
      familyEntities.push(entity);
      continue;
    }

    byFamily[entity.family] = [entity];
  }

  return byFamily;
}

function firstEntityOfFamily(
  byFamily: VaultEntitiesByFamily,
  family: CanonicalEntityFamily,
): CanonicalEntity | null {
  return byFamily[family]?.[0] ?? null;
}

function entitiesOfFamily(
  byFamily: VaultEntitiesByFamily,
  family: CanonicalEntityFamily,
): CanonicalEntity[] {
  return byFamily[family]?.slice() ?? [];
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
