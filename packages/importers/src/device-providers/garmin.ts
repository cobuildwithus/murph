import { stripEmptyObject } from "../shared.ts";
import {
  asPlainObject,
  makeNormalizedDeviceBatch,
  pushDeletionObservation as pushSharedDeletionObservation,
  slugify,
  stringId,
  toIso,
} from "./shared-normalization.ts";
import {
  asObjectArray,
  firstIdentifierFromPaths,
  firstIso,
  firstString,
  makeGarminExternalRef,
  pushGarminArtifact,
} from "./garmin-helpers.ts";
import {
  normalizeGarminActivities,
  normalizeGarminActivityFiles,
} from "./garmin-activity-normalizers.ts";
import {
  normalizeGarminDailySummaries,
  normalizeGarminEpochSummaries,
  normalizeGarminSleeps,
  normalizeGarminWomenHealth,
} from "./garmin-health-normalizers.ts";

import type {
  DeviceEventPayload,
  DeviceRawArtifactPayload,
  DeviceSamplePayload,
} from "../core-port.ts";
import type { PlainObject } from "./shared-normalization.ts";
import type { DeviceProviderAdapter, NormalizedDeviceBatch } from "./types.ts";

export interface GarminSnapshotInput {
  accountId?: string | number;
  importedAt?: string | number | Date;
  profile?: unknown;
  dailySummaries?: unknown[];
  dailySummary?: unknown[];
  epochSummaries?: unknown[];
  epochs?: unknown[];
  sleeps?: unknown[];
  activities?: unknown[];
  activityFiles?: unknown[];
  files?: unknown[];
  womenHealth?: unknown[];
  womenHealthSummaries?: unknown[];
  deletions?: unknown[];
}

function pushDeletionObservation(
  events: DeviceEventPayload[],
  rawArtifacts: DeviceRawArtifactPayload[],
  importedAt: string,
  deletion: PlainObject,
): void {
  const resourceType = slugify(
    deletion.resourceType ?? deletion.resource_type ?? deletion.dataType ?? deletion.data_type,
    "resource",
  );
  const resourceId =
    stringId(deletion.resourceId ?? deletion.resource_id ?? deletion.objectId ?? deletion.object_id) ??
    `deleted-${events.length + 1}`;
  const occurredAt =
    firstIso(
      deletion.occurredAt,
      deletion.occurred_at,
      deletion.eventTime,
      deletion.event_time,
    ) ?? importedAt;
  const sourceEventType =
    firstString(
      deletion.sourceEventType,
      deletion.source_event_type,
      deletion.eventType,
      deletion.event_type,
    );

  pushSharedDeletionObservation(events, rawArtifacts, {
    provider: "garmin",
    providerDisplayName: "Garmin",
    deletion,
    resourceType,
    resourceId,
    occurredAt,
    sourceEventType,
    makeExternalRef: makeGarminExternalRef,
  });
}

export function normalizeGarminSnapshot(snapshot: GarminSnapshotInput): NormalizedDeviceBatch {
  const request = asPlainObject(snapshot) ?? {};
  const importedAt = toIso(request.importedAt) ?? new Date().toISOString();
  const profile = asPlainObject(request.profile);
  const dailySummaries = asObjectArray(request.dailySummaries ?? request.dailySummary);
  const epochSummaries = asObjectArray(request.epochSummaries ?? request.epochs);
  const sleeps = asObjectArray(request.sleeps);
  const activities = asObjectArray(request.activities);
  const activityFiles = asObjectArray(request.activityFiles ?? request.files);
  const womenHealth = asObjectArray(request.womenHealth ?? request.womenHealthSummaries);
  const deletions = asObjectArray(request.deletions);
  const events: DeviceEventPayload[] = [];
  const samples: DeviceSamplePayload[] = [];
  const rawArtifacts: DeviceRawArtifactPayload[] = [];
  const accountId =
    stringId(request.accountId) ??
    firstIdentifierFromPaths(profile, [
      "id",
      "userId",
      "user_id",
      "accountId",
      "account_id",
      "externalAccountId",
      "external_account_id",
    ]);

  pushGarminArtifact(rawArtifacts, "profile", "profile.json", profile);

  normalizeGarminDailySummaries({ importedAt, events, samples, rawArtifacts }, dailySummaries);
  normalizeGarminEpochSummaries({ importedAt, events, samples, rawArtifacts }, epochSummaries);
  normalizeGarminSleeps({ importedAt, events, samples, rawArtifacts }, sleeps);

  const activityFileRoles = normalizeGarminActivityFiles(rawArtifacts, activityFiles);
  normalizeGarminActivities({ importedAt, events, rawArtifacts }, activities, activityFileRoles);
  normalizeGarminWomenHealth({ importedAt, events, samples, rawArtifacts }, womenHealth);

  for (const deletion of deletions) {
    pushDeletionObservation(events, rawArtifacts, importedAt, deletion);
  }

  const provenance = stripEmptyObject({
    garminUserId: firstIdentifierFromPaths(profile, ["id", "userId", "user_id"]),
    importedSections: {
      profile: Boolean(profile),
      dailySummaries: dailySummaries.length,
      epochSummaries: epochSummaries.length,
      sleeps: sleeps.length,
      activities: activities.length,
      activityFiles: activityFiles.length,
      womenHealth: womenHealth.length,
      deletions: deletions.length,
    },
  });

  return makeNormalizedDeviceBatch({
    provider: "garmin",
    accountId,
    importedAt,
    events,
    samples,
    rawArtifacts,
    provenance,
  });
}

export const garminProviderAdapter: DeviceProviderAdapter<GarminSnapshotInput> = {
  provider: "garmin",
  normalizeSnapshot: normalizeGarminSnapshot,
};
