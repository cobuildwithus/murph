import type { CanonicalEntity } from "../canonical-entities.ts";
import { listEntities, readVault, type VaultReadModel } from "../model.ts";
import {
  applyLimit,
  asObject,
  firstString,
  firstStringArray,
  matchesLookup,
  matchesText,
} from "./shared.ts";
import { compareByOccurredAtDescThenId } from "./comparators.ts";

export interface ImmunizationQueryRecord {
  id: string;
  kind: "immunization";
  occurredAt: string;
  recordedAt: string | null;
  source: string | null;
  title: string;
  vaccineName: string;
  manufacturer: string | null;
  lotNumber: string | null;
  route: string | null;
  site: string | null;
  series: string | null;
  targetDiseases: string[];
  tags: string[];
  relatedIds: string[];
  relativePath: string;
  data: Record<string, unknown>;
}

export interface ImmunizationListOptions {
  from?: string;
  to?: string;
  text?: string;
  limit?: number;
}

function immunizationRecordFromEventEntity(
  entity: CanonicalEntity,
): ImmunizationQueryRecord | null {
  if (
    entity.family !== "event" ||
    entity.kind !== "immunization" ||
    !entity.occurredAt
  ) {
    return null;
  }

  const data = asObject(entity.attributes);
  const vaccineName = data ? firstString(data, ["vaccineName"]) : null;
  if (!data || !vaccineName) {
    return null;
  }

  return {
    id: entity.entityId,
    kind: "immunization",
    occurredAt: entity.occurredAt,
    recordedAt: firstString(data, ["recordedAt"]),
    source: firstString(data, ["source"]),
    title: entity.title ?? vaccineName,
    vaccineName,
    manufacturer: firstString(data, ["manufacturer"]),
    lotNumber: firstString(data, ["lotNumber"]),
    route: firstString(data, ["route"]),
    site: firstString(data, ["site"]),
    series: firstString(data, ["series"]),
    targetDiseases: firstStringArray(data, ["targetDiseases"]),
    tags: entity.tags,
    relatedIds: entity.relatedIds,
    relativePath: entity.path,
    data,
  };
}

export function toImmunizationRecord(
  value: unknown,
  relativePath: string,
): ImmunizationQueryRecord | null {
  const data = asObject(value);
  if (!data) {
    return null;
  }

  return immunizationRecordFromEventEntity({
    entityId: firstString(data, ["id"]) ?? "",
    primaryLookupId: firstString(data, ["id"]) ?? "",
    lookupIds: [firstString(data, ["id"]) ?? ""].filter(Boolean),
    family: "event",
    recordClass: "ledger",
    kind: firstString(data, ["kind"]) ?? "",
    status: null,
    occurredAt: firstString(data, ["occurredAt"]),
    date: firstString(data, ["dayKey"]),
    path: relativePath,
    title: firstString(data, ["title"]),
    body: firstString(data, ["note"]),
    attributes: data,
    frontmatter: null,
    links: [],
    relatedIds: Array.isArray(data.relatedIds)
      ? data.relatedIds.filter((entry): entry is string => typeof entry === "string")
      : [],
    stream: null,
    experimentSlug: null,
    tags: Array.isArray(data.tags)
      ? data.tags.filter((entry): entry is string => typeof entry === "string")
      : [],
  });
}

export function compareImmunizations(
  left: ImmunizationQueryRecord,
  right: ImmunizationQueryRecord,
): number {
  return compareByOccurredAtDescThenId(left, right);
}

function isImmunizationRecord(
  record: ImmunizationQueryRecord | null,
): record is ImmunizationQueryRecord {
  return record !== null;
}

function matchesImmunizationOptions(
  record: ImmunizationQueryRecord,
  options: ImmunizationListOptions,
): boolean {
  return matchesText(
    [
      record.id,
      record.title,
      record.vaccineName,
      record.manufacturer,
      record.lotNumber,
      record.route,
      record.site,
      record.series,
      record.targetDiseases,
      record.tags,
      record.relatedIds,
      record.data,
    ],
    options.text,
  );
}

function selectProjectedImmunizations(
  vault: VaultReadModel,
  options: ImmunizationListOptions = {},
): ImmunizationQueryRecord[] {
  const records = listEntities(vault, {
    families: ["event"],
    kinds: ["immunization"],
    from: options.from,
    to: options.to,
  })
    .map(immunizationRecordFromEventEntity)
    .filter(isImmunizationRecord)
    .filter((record) => matchesImmunizationOptions(record, options))
    .sort(compareImmunizations);

  return applyLimit(records, options.limit);
}

export async function listImmunizations(
  vaultRoot: string,
  options: ImmunizationListOptions = {},
): Promise<ImmunizationQueryRecord[]> {
  return selectProjectedImmunizations(await readVault(vaultRoot), options);
}

export async function readImmunization(
  vaultRoot: string,
  eventId: string,
): Promise<ImmunizationQueryRecord | null> {
  const records = await listImmunizations(vaultRoot);
  return records.find((record) => record.id === eventId) ?? null;
}

export async function showImmunization(
  vaultRoot: string,
  lookup: string,
): Promise<ImmunizationQueryRecord | null> {
  const records = await listImmunizations(vaultRoot);
  return (
    records.find((record) =>
      matchesLookup(
        lookup,
        record.id,
        record.title,
        record.vaccineName,
        record.lotNumber,
      ),
    ) ?? null
  );
}
