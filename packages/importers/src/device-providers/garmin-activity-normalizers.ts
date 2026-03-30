import { stripEmptyObject, stripUndefined } from "../shared.ts";
import {
  minutesBetween,
  pushObservationEvent,
} from "./shared-normalization.ts";
import {
  asObjectArray,
  firstDefined,
  firstIdentifierFromPaths,
  firstIsoFromPaths,
  firstNumberFromPaths,
  firstStringFromPaths,
  formatActivityLabel,
  inferGarminFileFormat,
  inferGarminFileMediaType,
  isStructuredGarminPayload,
  makeGarminExternalRef,
  metersPerSecondToKilometersPerHour,
  metersToKilometers,
  normalizeActivityType,
  normalizePositiveIntegerMinutes,
  pushGarminArtifact,
  secondsToMinutes,
} from "./garmin-helpers.ts";

import type {
  DeviceEventPayload,
  DeviceRawArtifactPayload,
} from "../core-port.ts";

export interface GarminActivityNormalizationContext {
  importedAt: string;
  events: DeviceEventPayload[];
  rawArtifacts: DeviceRawArtifactPayload[];
}

function pushGarminActivityObservation(
  context: GarminActivityNormalizationContext,
  activityId: string,
  version: string | undefined,
  role: string,
  occurredAt: string,
  recordedAt: string,
  metric: string,
  value: unknown,
  unit: string,
  title: string,
  facet: string,
): void {
  pushObservationEvent(context.events, {
    metric,
    value,
    unit,
    occurredAt,
    recordedAt,
    title,
    rawArtifactRoles: [role],
    externalRef: makeGarminExternalRef("activity", activityId, version, facet),
  });
}

function nextActivityAssetRole(
  activityId: string | undefined,
  format: string,
  activityFileRoles: Map<string, string[]>,
  anonymousCount: number,
): { role: string; nextAnonymousCount: number } {
  if (!activityId) {
    const suffix = anonymousCount + 1;
    return {
      role: `activity-asset:unknown:${format}-${suffix}`,
      nextAnonymousCount: suffix,
    };
  }

  const existing = activityFileRoles.get(activityId) ?? [];
  const ordinal = existing.filter((role) => role.startsWith(`activity-asset:${activityId}:${format}`)).length + 1;
  const role = ordinal === 1
    ? `activity-asset:${activityId}:${format}`
    : `activity-asset:${activityId}:${format}-${ordinal}`;

  return {
    role,
    nextAnonymousCount: anonymousCount,
  };
}

function nextActivityAssetDescriptorFileName(
  activityId: string | undefined,
  format: string,
  role: string,
  anonymousCount: number,
): string {
  if (!activityId) {
    return `activity-asset-${anonymousCount || 1}-${format}-descriptor.json`;
  }

  const match = role.match(/-(\d+)$/);
  const ordinal = match ? Number(match[1]) : 1;
  const baseFileName = `${activityId}-${format}-asset-descriptor`;

  return ordinal === 1 ? `${baseFileName}.json` : `${baseFileName}-${ordinal}.json`;
}

export function normalizeGarminActivityFiles(
  rawArtifacts: DeviceRawArtifactPayload[],
  activityFiles: readonly unknown[],
): Map<string, string[]> {
  const activityFileRoles = new Map<string, string[]>();
  let anonymousCount = 0;

  for (const file of asObjectArray(activityFiles)) {
    const activityId = firstIdentifierFromPaths(file, [
      "activityId",
      "activity_id",
      "activity.activityId",
      "activity.id",
      "metadata.activityId",
    ]);
    const format = inferGarminFileFormat(file);
    const { role, nextAnonymousCount } = nextActivityAssetRole(activityId, format, activityFileRoles, anonymousCount);
    anonymousCount = nextAnonymousCount;
    const extractedContent = firstDefined(file.content, file.fileContent, file.payload, file.data);
    const hasFileContent = extractedContent !== undefined && extractedContent !== null;
    const descriptorOnly =
      !hasFileContent ||
      (isStructuredGarminPayload(extractedContent) && format !== "json");

    if (descriptorOnly) {
      const descriptorMetadata = stripEmptyObject({
        activityId,
        intendedFileType: format,
        intendedFileName: firstStringFromPaths(file, ["fileName", "filename", "name"]),
        intendedMediaType:
          firstStringFromPaths(file, ["mediaType", "mimeType", "contentType"]) ??
          inferGarminFileMediaType(format),
        checksum: firstStringFromPaths(file, ["checksum", "sha256", "md5"]),
        downloadUrl: firstStringFromPaths(file, ["downloadUrl", "url", "sourceUrl"]),
        downloadedAt: firstIsoFromPaths(file, ["downloadedAt", "createdAt", "timestamp"]),
        ...(typeof file.metadata === "object" && file.metadata && !Array.isArray(file.metadata)
          ? (file.metadata as Record<string, unknown>)
          : {}),
      });

      pushGarminArtifact(
        rawArtifacts,
        role,
        nextActivityAssetDescriptorFileName(activityId, format, role, anonymousCount),
        file,
        {
          mediaType: "application/json",
          metadata: descriptorMetadata,
        },
      );

      if (activityId) {
        const roles = activityFileRoles.get(activityId) ?? [];
        roles.push(role);
        activityFileRoles.set(activityId, roles);
      }

      continue;
    }

    const fileName =
      firstStringFromPaths(file, ["fileName", "filename", "name"]) ??
      `${activityId ?? `activity-asset-${anonymousCount || rawArtifacts.length + 1}`}.${format}`;
    const mediaType =
      firstStringFromPaths(file, ["mediaType", "mimeType", "contentType"]) ??
      inferGarminFileMediaType(format, fileName);
    const metadata = stripEmptyObject({
      activityId,
      fileType: format,
      checksum: firstStringFromPaths(file, ["checksum", "sha256", "md5"]),
      downloadUrl: firstStringFromPaths(file, ["downloadUrl", "url", "sourceUrl"]),
      downloadedAt: firstIsoFromPaths(file, ["downloadedAt", "createdAt", "timestamp"]),
      ...(typeof file.metadata === "object" && file.metadata && !Array.isArray(file.metadata)
        ? (file.metadata as Record<string, unknown>)
        : {}),
    });

    pushGarminArtifact(
      rawArtifacts,
      role,
      fileName,
      extractedContent,
      {
        mediaType,
        metadata,
      },
    );

    if (activityId) {
      const roles = activityFileRoles.get(activityId) ?? [];
      roles.push(role);
      activityFileRoles.set(activityId, roles);
    }
  }

  return activityFileRoles;
}

export function normalizeGarminActivities(
  context: GarminActivityNormalizationContext,
  activities: readonly unknown[],
  activityFileRoles: ReadonlyMap<string, readonly string[]> = new Map(),
): void {
  for (const activity of asObjectArray(activities)) {
    const activityId =
      firstIdentifierFromPaths(activity, ["activityId", "id", "summaryId", "startTime", "startAt"]) ??
      `activity-${context.events.length + 1}`;
    const startAt = firstIsoFromPaths(activity, ["startTime", "startAt", "startDateTime"]);
    const endAt = firstIsoFromPaths(activity, ["endTime", "endAt", "endDateTime"]);
    const recordedAt =
      firstIsoFromPaths(activity, ["timestamp", "recordedAt", "updatedAt", "endTime", "endAt"]) ??
      endAt ??
      startAt ??
      context.importedAt;
    const occurredAt = startAt ?? recordedAt;
    const version =
      firstIsoFromPaths(activity, ["updatedAt", "timestamp", "recordedAt"]) ??
      recordedAt;
    const durationMinutes =
      normalizePositiveIntegerMinutes(firstNumberFromPaths(activity, ["durationMinutes"])) ??
      normalizePositiveIntegerMinutes(
        secondsToMinutes(firstNumberFromPaths(activity, ["durationSeconds", "durationInSeconds"])),
      ) ??
      normalizePositiveIntegerMinutes(minutesBetween(startAt, endAt));
    const distanceMeters = firstNumberFromPaths(activity, ["distanceMeters", "distanceInMeters", "distance"]);
    const distanceKm = metersToKilometers(distanceMeters);
    const activityLabel = formatActivityLabel(
      firstStringFromPaths(activity, ["activityTypeLabel", "activityName", "activityType", "sportName", "type"]),
    );
    const activityType = normalizeActivityType(
      firstStringFromPaths(activity, ["activityType", "type", "sportName"]),
    );
    const role = `activity:${activityId}`;
    const rawArtifactRoles = [role, ...(activityFileRoles.get(activityId) ?? [])];

    pushGarminArtifact(
      context.rawArtifacts,
      role,
      `activity-${activityId}.json`,
      activity,
    );

    if (occurredAt && durationMinutes !== undefined) {
      context.events.push(
        stripUndefined({
          kind: "activity_session",
          occurredAt,
          recordedAt,
          source: "device",
          title: `Garmin ${activityLabel}`,
          rawArtifactRoles,
          externalRef: makeGarminExternalRef("activity", activityId, version),
          fields: stripUndefined({
            activityType,
            durationMinutes,
            distanceKm,
          }),
        }),
      );
    }

    pushGarminActivityObservation(
      context,
      activityId,
      version,
      role,
      occurredAt,
      recordedAt,
      "active-calories",
      firstNumberFromPaths(activity, ["activeCalories", "calories", "activeKilocalories"]),
      "kcal",
      `Garmin ${activityLabel} calories`,
      "active-calories",
    );
    pushGarminActivityObservation(
      context,
      activityId,
      version,
      role,
      occurredAt,
      recordedAt,
      "distance",
      distanceMeters,
      "meter",
      `Garmin ${activityLabel} distance`,
      "distance",
    );
    pushGarminActivityObservation(
      context,
      activityId,
      version,
      role,
      occurredAt,
      recordedAt,
      "average-heart-rate",
      firstNumberFromPaths(activity, ["averageHeartRate", "averageHeartRateInBeatsPerMinute"]),
      "bpm",
      `Garmin ${activityLabel} average heart rate`,
      "average-heart-rate",
    );
    pushGarminActivityObservation(
      context,
      activityId,
      version,
      role,
      occurredAt,
      recordedAt,
      "max-heart-rate",
      firstNumberFromPaths(activity, ["maxHeartRate", "maxHeartRateInBeatsPerMinute"]),
      "bpm",
      `Garmin ${activityLabel} max heart rate`,
      "max-heart-rate",
    );
    pushGarminActivityObservation(
      context,
      activityId,
      version,
      role,
      occurredAt,
      recordedAt,
      "average-speed",
      firstNumberFromPaths(activity, ["averageSpeedKph"]) ??
        metersPerSecondToKilometersPerHour(firstNumberFromPaths(activity, ["averageSpeedMetersPerSecond", "averageSpeed"])),
      "km_h",
      `Garmin ${activityLabel} average speed`,
      "average-speed",
    );
    pushGarminActivityObservation(
      context,
      activityId,
      version,
      role,
      occurredAt,
      recordedAt,
      "max-speed",
      firstNumberFromPaths(activity, ["maxSpeedKph"]) ??
        metersPerSecondToKilometersPerHour(firstNumberFromPaths(activity, ["maxSpeedMetersPerSecond", "maxSpeed"])),
      "km_h",
      `Garmin ${activityLabel} max speed`,
      "max-speed",
    );
    pushGarminActivityObservation(
      context,
      activityId,
      version,
      role,
      occurredAt,
      recordedAt,
      "elevation-gain",
      firstNumberFromPaths(activity, ["elevationGainMeters", "elevationGain", "ascentMeters"]),
      "meter",
      `Garmin ${activityLabel} elevation gain`,
      "elevation-gain",
    );
    pushGarminActivityObservation(
      context,
      activityId,
      version,
      role,
      occurredAt,
      recordedAt,
      "training-effect",
      firstNumberFromPaths(activity, ["trainingEffect"]),
      "score",
      `Garmin ${activityLabel} training effect`,
      "training-effect",
    );
    pushGarminActivityObservation(
      context,
      activityId,
      version,
      role,
      occurredAt,
      recordedAt,
      "aerobic-training-effect",
      firstNumberFromPaths(activity, ["aerobicTrainingEffect"]),
      "score",
      `Garmin ${activityLabel} aerobic training effect`,
      "aerobic-training-effect",
    );
    pushGarminActivityObservation(
      context,
      activityId,
      version,
      role,
      occurredAt,
      recordedAt,
      "anaerobic-training-effect",
      firstNumberFromPaths(activity, ["anaerobicTrainingEffect"]),
      "score",
      `Garmin ${activityLabel} anaerobic training effect`,
      "anaerobic-training-effect",
    );
  }
}
