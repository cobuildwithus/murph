import {
  fallbackCurrentProfileEntity,
  normalizeCanonicalDate,
  type CanonicalEntity,
} from "../canonical-entities.js";

export interface CurrentProfileSnapshotSortFields {
  snapshotId: string;
  snapshotTimestamp: string | null;
}

export interface CurrentProfileFallbackSnapshotRecord {
  id: string;
  capturedAt: string | null;
  recordedAt: string | null;
  status: string;
  summary: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  profile: Record<string, unknown>;
  relativePath: string;
}

export interface CurrentProfileResolution<TFallback> {
  latestSnapshotId: string | null;
  fallbackCurrentProfile: TFallback | null;
}

export function compareCurrentProfileSnapshotRecency(
  left: CurrentProfileSnapshotSortFields,
  right: CurrentProfileSnapshotSortFields,
): number {
  const leftSortKey = left.snapshotTimestamp ?? "";
  const rightSortKey = right.snapshotTimestamp ?? "";

  if (leftSortKey !== rightSortKey) {
    return rightSortKey.localeCompare(leftSortKey);
  }

  return left.snapshotId.localeCompare(right.snapshotId);
}

export function selectLatestCurrentProfileSnapshot<T>(
  snapshots: readonly T[],
  getSortFields: (snapshot: T) => CurrentProfileSnapshotSortFields,
): T | null {
  return (
    [...snapshots].sort((left, right) =>
      compareCurrentProfileSnapshotRecency(
        getSortFields(left),
        getSortFields(right),
      ),
    )[0] ?? null
  );
}

export function isCurrentProfileStale(
  currentSnapshotId: string | null | undefined,
  latestSnapshotId: string | null,
): boolean {
  return latestSnapshotId !== null && currentSnapshotId !== latestSnapshotId;
}

export function resolveCurrentProfileSnapshot<TSnapshot, TFallback>(
  snapshots: readonly TSnapshot[],
  getSortFields: (snapshot: TSnapshot) => CurrentProfileSnapshotSortFields,
  buildFallback: (snapshot: TSnapshot) => TFallback | null,
): CurrentProfileResolution<TFallback> {
  const latestSnapshot = selectLatestCurrentProfileSnapshot(snapshots, getSortFields);

  return {
    latestSnapshotId: latestSnapshot ? getSortFields(latestSnapshot).snapshotId : null,
    fallbackCurrentProfile: latestSnapshot ? buildFallback(latestSnapshot) : null,
  };
}

export function resolveCurrentProfileProjection<TCurrent, TFallback>(
  resolution: Pick<
    CurrentProfileResolution<TFallback>,
    "latestSnapshotId" | "fallbackCurrentProfile"
  >,
  currentProfile: TCurrent | null,
  getSnapshotId: (currentProfile: TCurrent) => string | null | undefined,
): TCurrent | TFallback | null {
  if (resolution.latestSnapshotId === null) {
    return null;
  }

  if (!currentProfile) {
    return resolution.fallbackCurrentProfile;
  }

  return isCurrentProfileStale(
    getSnapshotId(currentProfile),
    resolution.latestSnapshotId,
  )
    ? resolution.fallbackCurrentProfile
    : currentProfile;
}

export function fallbackCurrentProfileEntityFromSnapshotRecord(
  latestSnapshot: CurrentProfileFallbackSnapshotRecord,
): CanonicalEntity | null {
  return fallbackCurrentProfileEntity({
    entityId: latestSnapshot.id,
    primaryLookupId: latestSnapshot.id,
    lookupIds: [latestSnapshot.id],
    family: "profile_snapshot",
    kind: "profile_snapshot",
    status: latestSnapshot.status,
    occurredAt: latestSnapshot.recordedAt ?? latestSnapshot.capturedAt,
    date: normalizeCanonicalDate(
      latestSnapshot.recordedAt ?? latestSnapshot.capturedAt,
    ),
    path: latestSnapshot.relativePath,
    title: latestSnapshot.summary ?? latestSnapshot.id,
    body: latestSnapshot.summary,
    attributes: {
      profile: latestSnapshot.profile,
      sourceAssessmentIds: latestSnapshot.sourceAssessmentIds,
      sourceEventIds: latestSnapshot.sourceEventIds,
    },
    frontmatter: null,
    relatedIds: [
      ...latestSnapshot.sourceAssessmentIds,
      ...latestSnapshot.sourceEventIds,
    ],
    stream: null,
    experimentSlug: null,
    tags: ["profile_snapshot", latestSnapshot.status],
  });
}
