import { extractIsoDatePrefix } from "@murphai/contracts";

import {
  linkTargetIds,
  type CanonicalEntity,
  type CanonicalEntityFamily,
  type CanonicalRecordClass,
} from "./canonical-entities.ts";
import { readVaultSourceTolerant, type QueryRecordData } from "./vault-source.ts";

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
  "event",
  "experiment",
  "family",
  "food",
  "genetics",
  "goal",
  "journal",
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
  goals: { family: "goal", mode: "many" },
  conditions: { family: "condition", mode: "many" },
  allergies: { family: "allergy", mode: "many" },
  protocols: { family: "protocol", mode: "many" },
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
  const { loadProjectedVaultSource } = await import("./query-projection.ts");
  const snapshot = await loadProjectedVaultSource(vaultRoot);

  return createVaultReadModel({
    vaultRoot,
    metadata: snapshot.metadata,
    entities: snapshot.entities,
  });
}

export async function readVaultTolerant(
  vaultRoot: string,
): Promise<VaultReadModel> {
  const snapshot = await readVaultSourceTolerant(vaultRoot);

  return createVaultReadModel({
    vaultRoot,
    metadata: snapshot.metadata,
    entities: snapshot.entities,
  });
}

export function getVaultEntities(vault: VaultReadModel): CanonicalEntity[] {
  return vault.entities;
}

export function entityRelationTargetIds(
  entity: Pick<CanonicalEntity, "links" | "lookupIds">,
): string[] {
  return entity.links.length > 0
    ? linkTargetIds(entity.links)
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
