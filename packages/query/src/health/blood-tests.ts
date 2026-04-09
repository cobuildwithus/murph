import {
  BLOOD_TEST_CATEGORY,
  BLOOD_TEST_SPECIMEN_TYPES,
} from "@murphai/contracts";
import type { CanonicalEntity } from "../canonical-entities.ts";
import { listEntities, readVault, type VaultReadModel } from "../model.ts";
import {
  applyLimit,
  asObject,
  firstString,
  matchesDateRange,
  matchesLookup,
  matchesStatus,
  matchesText,
} from "./shared.ts";
import { compareByOccurredAtDescThenId } from "./comparators.ts";

const BLOOD_TEST_SPECIMEN_TYPE_SET = new Set<string>(BLOOD_TEST_SPECIMEN_TYPES);

export interface BloodTestQueryRecord {
  id: string;
  kind: "blood_test";
  occurredAt: string;
  recordedAt: string | null;
  collectedAt: string | null;
  reportedAt: string | null;
  source: string | null;
  title: string;
  testName: string | null;
  status: string | null;
  labName: string | null;
  labPanelId: string | null;
  specimenType: string | null;
  fastingStatus: string | null;
  tags: string[];
  relatedIds: string[];
  relativePath: string;
  data: Record<string, unknown>;
}

export interface BloodTestListOptions {
  status?: string | string[];
  from?: string;
  to?: string;
  text?: string;
  limit?: number;
}

function isBloodTestData(data: Record<string, unknown>): boolean {
  const testCategory = firstString(data, ["testCategory"]);
  const specimenType = firstString(data, ["specimenType"]);

  return (
    testCategory === BLOOD_TEST_CATEGORY ||
    (specimenType !== null && BLOOD_TEST_SPECIMEN_TYPE_SET.has(specimenType))
  );
}

function bloodTestRecordFromEventEntity(
  entity: CanonicalEntity,
): BloodTestQueryRecord | null {
  if (
    entity.family !== "event" ||
    entity.kind !== "test" ||
    !entity.occurredAt
  ) {
    return null;
  }

  const data = asObject(entity.attributes);
  if (!data || !isBloodTestData(data)) {
    return null;
  }

  return {
    id: entity.entityId,
    kind: "blood_test",
    occurredAt: entity.occurredAt,
    recordedAt: firstString(data, ["recordedAt"]),
    collectedAt: firstString(data, ["collectedAt"]),
    reportedAt: firstString(data, ["reportedAt"]),
    source: firstString(data, ["source"]),
    title: entity.title ?? entity.entityId,
    testName: firstString(data, ["testName"]),
    status: firstString(data, ["resultStatus", "status"]),
    labName: firstString(data, ["labName"]),
    labPanelId: firstString(data, ["labPanelId"]),
    specimenType: firstString(data, ["specimenType"]),
    fastingStatus: firstString(data, ["fastingStatus"]),
    tags: entity.tags,
    relatedIds: entity.relatedIds,
    relativePath: entity.path,
    data,
  };
}

export function toBloodTestRecord(
  value: unknown,
  relativePath: string,
): BloodTestQueryRecord | null {
  const data = asObject(value);
  if (!data) {
    return null;
  }

  return bloodTestRecordFromEventEntity({
    entityId: firstString(data, ["id"]) ?? "",
    primaryLookupId: firstString(data, ["id"]) ?? "",
    lookupIds: [firstString(data, ["id"]) ?? ""].filter(Boolean),
    family: "event",
    recordClass: "ledger",
    kind: firstString(data, ["kind"]) ?? "",
    status: firstString(data, ["resultStatus", "status"]),
    occurredAt: firstString(data, ["occurredAt"]),
    date: firstString(data, ["dayKey"]),
    path: relativePath,
    title: firstString(data, ["title"]),
    body: firstString(data, ["note", "summary"]),
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

export function compareBloodTests(
  left: BloodTestQueryRecord,
  right: BloodTestQueryRecord,
): number {
  return compareByOccurredAtDescThenId(left, right);
}

function isBloodTestRecord(
  record: BloodTestQueryRecord | null,
): record is BloodTestQueryRecord {
  return record !== null;
}

function matchesBloodTestOptions(
  record: BloodTestQueryRecord,
  options: BloodTestListOptions,
): boolean {
  return (
    matchesStatus(record.status, options.status) &&
    matchesText(
      [
        record.id,
        record.title,
        record.testName,
        record.labName,
        record.labPanelId,
        record.specimenType,
        record.fastingStatus,
        record.tags,
        record.relatedIds,
        record.data,
      ],
      options.text,
    )
  );
}

function selectProjectedBloodTests(
  vault: VaultReadModel,
  options: BloodTestListOptions = {},
): BloodTestQueryRecord[] {
  const records = listEntities(vault, {
    families: ["event"],
    kinds: ["test"],
    from: options.from,
    to: options.to,
  })
    .map(bloodTestRecordFromEventEntity)
    .filter(isBloodTestRecord)
    .filter((record) => matchesDateRange(record.occurredAt, options.from, options.to))
    .filter((record) => matchesBloodTestOptions(record, options))
    .sort(compareBloodTests);

  return applyLimit(records, options.limit);
}

export async function listBloodTests(
  vaultRoot: string,
  options: BloodTestListOptions = {},
): Promise<BloodTestQueryRecord[]> {
  return selectProjectedBloodTests(await readVault(vaultRoot), options);
}

export async function readBloodTest(
  vaultRoot: string,
  eventId: string,
): Promise<BloodTestQueryRecord | null> {
  const records = await listBloodTests(vaultRoot);
  return records.find((record) => record.id === eventId) ?? null;
}

export async function showBloodTest(
  vaultRoot: string,
  lookup: string,
): Promise<BloodTestQueryRecord | null> {
  const records = await listBloodTests(vaultRoot);
  return (
    records.find((record) =>
      matchesLookup(lookup, record.id, record.title, record.testName, record.labPanelId),
    ) ?? null
  );
}
