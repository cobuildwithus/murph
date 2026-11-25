import {
  BLOOD_TEST_CATEGORY,
  BLOOD_TEST_SPECIMEN_TYPES,
} from "@murphai/contracts";
import type { CanonicalEntity } from "../canonical-entities.ts";
import { listCanonicalEventEntitiesRuntime } from "../query-projection.ts";
import { readCanonicalEntityFamilySource } from "../vault-source.ts";
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
// Blood tests are `test` events; other kinds never project to a record.
const BLOOD_TEST_EVENT_SOURCE = { eventKinds: ["test"] } as const;

/**
 * One projected `test` event. Blood tests are the blood subset; diagnostic
 * tests are every test event (stool, microbiome, urine, saliva and blood).
 */
export interface TestQueryRecord<TKind extends "blood_test" | "test"> {
  id: string;
  kind: TKind;
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

export type BloodTestQueryRecord = TestQueryRecord<"blood_test">;
export type DiagnosticTestQueryRecord = TestQueryRecord<"test">;

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
  const record = testRecordFromEventEntity(entity, "blood_test");
  return record && isBloodTestData(record.data) ? record : null;
}

function diagnosticTestRecordFromEventEntity(
  entity: CanonicalEntity,
): DiagnosticTestQueryRecord | null {
  return testRecordFromEventEntity(entity, "test");
}

function testRecordFromEventEntity<TKind extends "blood_test" | "test">(
  entity: CanonicalEntity,
  kind: TKind,
): TestQueryRecord<TKind> | null {
  if (
    entity.family !== "event" ||
    entity.kind !== "test" ||
    !entity.occurredAt
  ) {
    return null;
  }

  const data = asObject(entity.attributes);
  if (!data) {
    return null;
  }

  return {
    id: entity.entityId,
    kind,
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

function matchesTestOptions(
  record: TestQueryRecord<"blood_test" | "test">,
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

function selectProjectedTests<TRecord extends TestQueryRecord<"blood_test" | "test">>(
  entities: readonly CanonicalEntity[],
  toRecord: (entity: CanonicalEntity) => TRecord | null,
  options: BloodTestListOptions = {},
): TRecord[] {
  const records = entities
    .map(toRecord)
    .filter((record): record is TRecord => record !== null)
    .filter((record) => matchesDateRange(record.occurredAt, options.from, options.to))
    .filter((record) => matchesTestOptions(record, options))
    .sort(compareByOccurredAtDescThenId);

  return applyLimit(records, options.limit);
}

async function listProjectedTests<TRecord extends TestQueryRecord<"blood_test" | "test">>(
  vaultRoot: string,
  toRecord: (entity: CanonicalEntity) => TRecord | null,
  options: BloodTestListOptions,
): Promise<TRecord[]> {
  const entities = await listCanonicalEventEntitiesRuntime(vaultRoot, {
    from: options.from,
    kinds: ["test"],
    // The event reader is unlimited: classification and text matching must
    // still precede the selector's final limit.
    to: options.to,
  });
  return selectProjectedTests(entities, toRecord, options);
}

async function showProjectedTest<TRecord extends TestQueryRecord<"blood_test" | "test">>(
  vaultRoot: string,
  toRecord: (entity: CanonicalEntity) => TRecord | null,
  lookup: string,
): Promise<TRecord | null> {
  const records = selectProjectedTests(
    await readCanonicalEntityFamilySource(vaultRoot, "event", BLOOD_TEST_EVENT_SOURCE),
    toRecord,
  );
  return (
    records.find((record) =>
      matchesLookup(lookup, record.id, record.title, record.testName, record.labPanelId),
    ) ?? null
  );
}

export async function listBloodTests(
  vaultRoot: string,
  options: BloodTestListOptions = {},
): Promise<BloodTestQueryRecord[]> {
  return listProjectedTests(vaultRoot, bloodTestRecordFromEventEntity, options);
}

export async function readBloodTest(
  vaultRoot: string,
  eventId: string,
): Promise<BloodTestQueryRecord | null> {
  const records = selectProjectedTests(
    await readCanonicalEntityFamilySource(vaultRoot, "event", BLOOD_TEST_EVENT_SOURCE),
    bloodTestRecordFromEventEntity,
  );
  return records.find((record) => record.id === eventId) ?? null;
}

export async function showBloodTest(
  vaultRoot: string,
  lookup: string,
): Promise<BloodTestQueryRecord | null> {
  return showProjectedTest(vaultRoot, bloodTestRecordFromEventEntity, lookup);
}

/** Every saved test, blood or not, with the same filters as blood tests. */
export async function listDiagnosticTests(
  vaultRoot: string,
  options: BloodTestListOptions = {},
): Promise<DiagnosticTestQueryRecord[]> {
  return listProjectedTests(vaultRoot, diagnosticTestRecordFromEventEntity, options);
}

export async function showDiagnosticTest(
  vaultRoot: string,
  lookup: string,
): Promise<DiagnosticTestQueryRecord | null> {
  return showProjectedTest(vaultRoot, diagnosticTestRecordFromEventEntity, lookup);
}
