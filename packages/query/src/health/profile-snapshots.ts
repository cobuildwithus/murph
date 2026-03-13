import {
  applyLimit,
  asObject,
  firstObject,
  firstString,
  firstStringArray,
  matchesDateRange,
  matchesLookup,
  matchesText,
} from "./shared.js";
import {
  readJsonlRecords,
  readOptionalMarkdownDocument,
} from "./loaders.js";
import {
  fallbackCurrentProfileEntity,
  projectCurrentProfileEntity,
  projectProfileSnapshotEntity,
} from "../canonical-entities.js";

import type {
  CanonicalEntity,
} from "../canonical-entities.js";
import type { MarkdownDocumentRecord } from "./shared.js";

export interface ProfileSnapshotQueryRecord {
  id: string;
  capturedAt: string | null;
  recordedAt: string | null;
  status: string;
  summary: string | null;
  source: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  profile: Record<string, unknown>;
  relativePath: string;
}

export interface CurrentProfileQueryRecord {
  id: "current";
  snapshotId: string | null;
  updatedAt: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  topGoalIds: string[];
  relativePath: string;
  markdown: string | null;
  body: string | null;
}

export interface ProfileSnapshotListOptions {
  from?: string;
  to?: string;
  text?: string;
  limit?: number;
}

function profileSnapshotRecordFromEntity(
  entity: CanonicalEntity,
): ProfileSnapshotQueryRecord | null {
  if (entity.family !== "profile_snapshot") {
    return null;
  }

  const attributes = asObject(entity.attributes);
  if (!attributes) {
    return null;
  }

  return {
    id: entity.entityId,
    capturedAt: firstString(attributes, ["capturedAt", "recordedAt"]),
    recordedAt: firstString(attributes, ["recordedAt", "capturedAt"]),
    status: firstString(attributes, ["status"]) ?? "accepted",
    summary: firstString(attributes, ["summary"]),
    source: firstString(attributes, ["source"]),
    sourceAssessmentIds: firstStringArray(attributes, ["sourceAssessmentIds"]),
    sourceEventIds: firstStringArray(attributes, ["sourceEventIds"]),
    profile: firstObject(attributes, ["profile"]) ?? {},
    relativePath: entity.path,
  };
}

function currentProfileRecordFromEntity(
  entity: CanonicalEntity,
): CurrentProfileQueryRecord | null {
  if (entity.family !== "current_profile") {
    return null;
  }

  const attributes = asObject(entity.attributes);
  if (!attributes) {
    return null;
  }

  return {
    id: "current",
    snapshotId: firstString(attributes, ["snapshotId"]),
    updatedAt: firstString(attributes, ["updatedAt"]),
    sourceAssessmentIds: firstStringArray(attributes, ["sourceAssessmentIds"]),
    sourceEventIds: firstStringArray(attributes, ["sourceEventIds"]),
    topGoalIds: firstStringArray(attributes, ["topGoalIds"]),
    relativePath: entity.path,
    markdown: entity.frontmatter ? entity.body : entity.body,
    body: entity.body,
  };
}

export function buildCurrentProfileRecord(input: {
  snapshotId: string;
  updatedAt: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  topGoalIds: string[];
  markdown: string | null;
  body: string | null;
}): CurrentProfileQueryRecord {
  return {
    id: "current",
    snapshotId: input.snapshotId,
    updatedAt: input.updatedAt,
    sourceAssessmentIds: input.sourceAssessmentIds,
    sourceEventIds: input.sourceEventIds,
    topGoalIds: input.topGoalIds,
    relativePath: "bank/profile/current.md",
    markdown: input.markdown,
    body: input.body,
  };
}

export function toProfileSnapshotRecord(
  value: unknown,
  relativePath: string,
): ProfileSnapshotQueryRecord | null {
  const entity = projectProfileSnapshotEntity(value, relativePath);
  return entity ? profileSnapshotRecordFromEntity(entity) : null;
}

export function compareSnapshots(
  left: ProfileSnapshotQueryRecord,
  right: ProfileSnapshotQueryRecord,
): number {
  const leftTimestamp = left.recordedAt ?? left.capturedAt ?? "";
  const rightTimestamp = right.recordedAt ?? right.capturedAt ?? "";

  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp.localeCompare(leftTimestamp);
  }

  return left.id.localeCompare(right.id);
}

function isProfileSnapshotRecord(
  record: ProfileSnapshotQueryRecord | null,
): record is ProfileSnapshotQueryRecord {
  return record !== null;
}

export function toCurrentProfileRecord(
  document: MarkdownDocumentRecord,
): CurrentProfileQueryRecord {
  const entity = projectCurrentProfileEntity(document);
  const record = currentProfileRecordFromEntity(entity);

  if (!record) {
    throw new Error("Failed to project current profile.");
  }

  return {
    ...record,
    markdown: document.markdown,
  };
}

export async function listProfileSnapshots(
  vaultRoot: string,
  options: ProfileSnapshotListOptions = {},
): Promise<ProfileSnapshotQueryRecord[]> {
  const entries = await readJsonlRecords(vaultRoot, "ledger/profile-snapshots");
  const records = entries
    .map((entry) => projectProfileSnapshotEntity(entry.value, entry.relativePath))
    .map((entity) => (entity ? profileSnapshotRecordFromEntity(entity) : null))
    .filter(isProfileSnapshotRecord)
    .filter((record) => matchesDateRange(record.recordedAt ?? record.capturedAt, options.from, options.to))
    .filter((record) => matchesText([record], options.text))
    .sort(compareSnapshots);

  return applyLimit(records, options.limit);
}

export async function readProfileSnapshot(
  vaultRoot: string,
  snapshotId: string,
): Promise<ProfileSnapshotQueryRecord | null> {
  const snapshots = await listProfileSnapshots(vaultRoot);
  return snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null;
}

export async function readCurrentProfile(
  vaultRoot: string,
): Promise<CurrentProfileQueryRecord | null> {
  const snapshots = await listProfileSnapshots(vaultRoot);
  const latestSnapshot = snapshots[0] ?? null;

  if (!latestSnapshot) {
    return null;
  }

  try {
    const document = await readOptionalMarkdownDocument(vaultRoot, "bank/profile/current.md");
    if (!document) {
      return fallbackCurrent(latestSnapshot);
    }

    const record = toCurrentProfileRecord(document);
    if (record.snapshotId !== latestSnapshot.id) {
      return fallbackCurrent(latestSnapshot);
    }

    return record;
  } catch {
    return fallbackCurrent(latestSnapshot);
  }
}

export async function showProfile(
  vaultRoot: string,
  lookup: string,
): Promise<ProfileSnapshotQueryRecord | CurrentProfileQueryRecord | null> {
  const current = await readCurrentProfile(vaultRoot);
  if (current && matchesLookup(lookup, current.id, current.snapshotId)) {
    return current;
  }

  const snapshots = await listProfileSnapshots(vaultRoot);
  return snapshots.find((snapshot) => matchesLookup(lookup, snapshot.id, snapshot.summary)) ?? null;
}

function fallbackCurrent(
  latestSnapshot: ProfileSnapshotQueryRecord,
): CurrentProfileQueryRecord | null {
  const fallback = fallbackCurrentProfileEntity({
    entityId: latestSnapshot.id,
    primaryLookupId: latestSnapshot.id,
    lookupIds: [latestSnapshot.id],
    family: "profile_snapshot",
    kind: "profile_snapshot",
    status: latestSnapshot.status,
    occurredAt: latestSnapshot.recordedAt ?? latestSnapshot.capturedAt,
    date: (latestSnapshot.recordedAt ?? latestSnapshot.capturedAt)?.slice(0, 10) ?? null,
    path: latestSnapshot.relativePath,
    title: latestSnapshot.summary ?? latestSnapshot.id,
    body: latestSnapshot.summary,
    attributes: {
      profile: latestSnapshot.profile,
      sourceAssessmentIds: latestSnapshot.sourceAssessmentIds,
      sourceEventIds: latestSnapshot.sourceEventIds,
    },
    frontmatter: null,
    relatedIds: [...latestSnapshot.sourceAssessmentIds, ...latestSnapshot.sourceEventIds],
    stream: null,
    experimentSlug: null,
    tags: ["profile_snapshot", latestSnapshot.status],
  });

  return fallback ? currentProfileRecordFromEntity(fallback) : null;
}
