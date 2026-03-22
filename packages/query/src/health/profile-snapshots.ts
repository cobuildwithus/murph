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
  readOptionalMarkdownDocumentOutcome,
} from "./loaders.js";
import {
  projectCurrentProfileEntity,
  projectProfileSnapshotEntity,
} from "../canonical-entities.js";
import {
  compareCurrentProfileSnapshotRecency,
  resolveCurrentProfileDocument,
  fallbackCurrentProfileEntityFromSnapshotRecord,
  resolveCurrentProfileSnapshot,
  type CurrentProfileDocumentOutcome,
  type CurrentProfileSnapshotSortFields,
} from "./current-profile-resolution.js";

import type {
  CanonicalEntity,
} from "../canonical-entities.js";
import type { ParseFailure } from "./loaders.js";
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

interface CurrentProfileState {
  currentProfile: CurrentProfileQueryRecord | null;
  snapshots: ProfileSnapshotQueryRecord[];
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

function currentProfileRecordFromProjectedEntity(
  entity: CanonicalEntity,
  rawDocumentMarkdown: string | null = entity.body,
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
    markdown: rawDocumentMarkdown,
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
  return compareCurrentProfileSnapshotRecency(
    profileSnapshotSortFields(left),
    profileSnapshotSortFields(right),
  );
}

function isProfileSnapshotRecord(
  record: ProfileSnapshotQueryRecord | null,
): record is ProfileSnapshotQueryRecord {
  return record !== null;
}

export function toCurrentProfileRecord(
  document: MarkdownDocumentRecord,
): CurrentProfileQueryRecord {
  const projectedCurrentProfile = projectCurrentProfileEntity(document);
  const record = currentProfileRecordFromProjectedEntity(
    projectedCurrentProfile,
    document.markdown,
  );

  if (!record) {
    throw new Error("Failed to project current profile.");
  }

  return record;
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
  return (await readCurrentProfileState(vaultRoot)).currentProfile;
}

export async function showProfile(
  vaultRoot: string,
  lookup: string,
): Promise<ProfileSnapshotQueryRecord | CurrentProfileQueryRecord | null> {
  const { currentProfile, snapshots } = await readCurrentProfileState(vaultRoot);
  if (currentProfile && matchesLookup(lookup, currentProfile.id, currentProfile.snapshotId)) {
    return currentProfile;
  }

  return snapshots.find((snapshot) => matchesLookup(lookup, snapshot.id, snapshot.summary)) ?? null;
}

async function readCurrentProfileState(
  vaultRoot: string,
): Promise<CurrentProfileState> {
  const snapshots = await listProfileSnapshots(vaultRoot);
  const resolution = resolveCurrentProfileSnapshot(
    snapshots,
    profileSnapshotSortFields,
    fallbackCurrent,
  );

  if (resolution.latestSnapshotId === null) {
    return {
      currentProfile: null,
      snapshots,
    };
  }

  try {
    const resolvedCurrentProfile = resolveCurrentProfileDocument(
      resolution,
      await readCurrentProfileRecordOutcome(vaultRoot),
      (currentProfile) => currentProfile.snapshotId,
    );

    return {
      currentProfile: resolvedCurrentProfile.currentProfile,
      snapshots,
    };
  } catch {
    return {
      currentProfile: resolution.fallbackCurrentProfile,
      snapshots,
    };
  }
}

function fallbackCurrent(
  latestSnapshot: ProfileSnapshotQueryRecord,
): CurrentProfileQueryRecord | null {
  const fallback = fallbackCurrentProfileEntityFromSnapshotRecord(latestSnapshot);

  return fallback ? currentProfileRecordFromProjectedEntity(fallback) : null;
}

function profileSnapshotSortFields(
  snapshot: ProfileSnapshotQueryRecord,
): CurrentProfileSnapshotSortFields {
  return {
    snapshotId: snapshot.id,
    snapshotTimestamp: snapshot.recordedAt ?? snapshot.capturedAt,
  };
}

async function readCurrentProfileRecordOutcome(
  vaultRoot: string,
): Promise<CurrentProfileDocumentOutcome<CurrentProfileQueryRecord, ParseFailure>> {
  const outcome = await readOptionalMarkdownDocumentOutcome(
    vaultRoot,
    "bank/profile/current.md",
  );

  if (!outcome) {
    return { status: "missing" };
  }

  if (!outcome.ok) {
    return {
      status: "parse-failed",
      failure: outcome,
    };
  }

  return {
    status: "ok",
    currentProfile: toCurrentProfileRecord(outcome.document),
  };
}
