import { describe, expect, it } from "vitest";

import type {
  DeviceRawArtifactPayload,
} from "../src/core-port.ts";
import {
  GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  createNamedDeviceProviderRegistry,
  requireDeviceProviderOAuthDescriptor,
  requireDeviceProviderSyncDescriptor,
  requireDeviceProviderWebhookDescriptor,
  resolveDeviceProviderDescriptor,
  resolveDeviceProviderSourcePriority,
  type DeviceProviderDescriptor,
} from "../src/device-providers/provider-descriptors.ts";
import {
  firstDayKey,
  firstDefined,
  firstIdentifier,
  firstInstant,
  firstNumber,
  firstString,
  firstTimeZone,
  formatActivityLabel,
  gramsToKilograms,
  inferGarminFileFormat,
  inferGarminFileMediaType,
  isStructuredGarminPayload,
  metersPerSecondToKilometersPerHour,
  normalizeActivityType,
  normalizePositiveIntegerMinutes,
  normalizeSleepStage,
  pushGarminArtifact,
  secondsToMinutes,
  synthesizeUtcStartOfDay,
} from "../src/device-providers/garmin-helpers.ts";
import {
  normalizeGarminActivityFiles,
  normalizeGarminActivities,
  type GarminActivityNormalizationContext,
} from "../src/device-providers/garmin-activity-normalizers.ts";
import {
  normalizeGarminDailySummaries,
  normalizeGarminSleeps,
  normalizeGarminWomenHealth,
  type GarminHealthNormalizationContext,
} from "../src/device-providers/garmin-health-normalizers.ts";

function makeActivityContext(importedAt = "2026-03-17T10:00:00.000Z"): GarminActivityNormalizationContext {
  return {
    importedAt,
    events: [],
    rawArtifacts: [],
  };
}

function makeHealthContext(importedAt = "2026-03-17T10:00:00.000Z"): GarminHealthNormalizationContext {
  return {
    importedAt,
    events: [],
    samples: [],
    rawArtifacts: [],
  };
}

describe("garmin provider coverage", () => {
  it("covers provider registry normalization, duplicate handling, and priority fallback rules", () => {
    const registry = createNamedDeviceProviderRegistry("device provider");
    const whoopProvider = { provider: " WhOoP " };
    const garminProvider = { provider: "garmin" };

    registry.register(whoopProvider);
    registry.register(garminProvider);

    expect(registry.get("whoop")).toBe(whoopProvider);
    expect(registry.get(" GARMIN ")).toBe(garminProvider);
    expect(registry.get("   ")).toBeUndefined();
    expect(registry.list()).toEqual([whoopProvider, garminProvider]);

    expect(() => registry.register({ provider: " whoop " })).toThrow(/already registered/);
    expect(() => registry.register({ provider: "   " })).toThrow(/non-empty string/);

    expect(resolveDeviceProviderDescriptor(" garmin ")).toBe(GARMIN_DEVICE_PROVIDER_DESCRIPTOR);
    expect(resolveDeviceProviderDescriptor("   ")).toBeUndefined();

    const descriptorWithoutOptionalMetadata = {
      provider: "minimal",
      displayName: "Minimal",
      transportModes: ["scheduled_poll"],
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "passthrough",
      },
      sourcePriorityHints: {
        defaultPriority: 10,
        metricFamilies: {},
      },
    } satisfies DeviceProviderDescriptor;

    expect(() => requireDeviceProviderOAuthDescriptor(descriptorWithoutOptionalMetadata)).toThrow(
      /does not define OAuth metadata/,
    );
    expect(() => requireDeviceProviderWebhookDescriptor(descriptorWithoutOptionalMetadata)).toThrow(
      /does not define webhook metadata/,
    );
    expect(() => requireDeviceProviderSyncDescriptor(descriptorWithoutOptionalMetadata)).toThrow(
      /does not define sync metadata/,
    );

    expect(
      resolveDeviceProviderSourcePriority(OURA_DEVICE_PROVIDER_DESCRIPTOR, {
        metric: "sleepScore",
        metricFamily: "activity",
      }),
    ).toBe(100);
    expect(
      resolveDeviceProviderSourcePriority(OURA_DEVICE_PROVIDER_DESCRIPTOR, {
        metric: "missing-metric",
        metricFamily: "sleep",
      }),
    ).toBe(100);
    expect(
      resolveDeviceProviderSourcePriority(OURA_DEVICE_PROVIDER_DESCRIPTOR, {
        metric: "missing-metric",
      }),
    ).toBe(85);
  });

  it("covers helper inference, payload detection, and numeric normalization branches", () => {
    expect(firstDefined(undefined, null, 0, "later")).toBe(0);
    expect(firstString(undefined, "  Garmin Run  ", "later")).toBe("Garmin Run");
    expect(firstIdentifier(undefined, "  activity-42  ", "later")).toBe("activity-42");
    expect(firstInstant("2026-03-15", "2026-03-15T01:02:03Z")).toBe("2026-03-15T01:02:03.000Z");
    expect(firstDayKey("2026-03-15T01:02:03Z")).toBe("2026-03-15");
    expect(firstTimeZone("  UTC  ")).toBe("UTC");
    expect(firstNumber(undefined, "4.25", "ignored")).toBe(4.25);

    expect(normalizeActivityType(" Long Ride! ")).toBe("long-ride");
    expect(formatActivityLabel(undefined)).toBe("activity");
    expect(formatActivityLabel("  Evening Ride  ")).toBe("Evening Ride");
    expect(normalizeSleepStage("slow-wave")).toBe("deep");
    expect(normalizeSleepStage("rapid-eye-movement")).toBe("rem");
    expect(normalizeSleepStage("awake-time")).toBe("awake");
    expect(normalizeSleepStage("light-sleep")).toBe("light");
    expect(normalizeSleepStage("garmin-stage")).toBeUndefined();

    expect(isStructuredGarminPayload([])).toBe(true);
    expect(isStructuredGarminPayload({})).toBe(true);
    expect(isStructuredGarminPayload(new Date("2026-03-15T00:00:00.000Z"))).toBe(false);
    expect(isStructuredGarminPayload(new ArrayBuffer(8))).toBe(false);
    expect(isStructuredGarminPayload(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isStructuredGarminPayload(null)).toBe(false);

    expect(inferGarminFileFormat({ fileType: " FIT " })).toBe("fit");
    expect(inferGarminFileFormat({ fileName: "track.gpx" })).toBe("gpx");
    expect(inferGarminFileFormat({})).toBe("file");
    expect(inferGarminFileMediaType("fit")).toBe("application/octet-stream");
    expect(inferGarminFileMediaType("gpx")).toBe("application/gpx+xml");
    expect(inferGarminFileMediaType("tcx")).toBe("application/xml");
    expect(inferGarminFileMediaType("json")).toBe("application/json");
    expect(inferGarminFileMediaType("other", "fallback.json")).toBe("application/json");
    expect(inferGarminFileMediaType("other")).toBeUndefined();

    expect(secondsToMinutes(90)).toBe(1.5);
    expect(secondsToMinutes(-30)).toBe(0);
    expect(gramsToKilograms("7250")).toBe(7.25);
    expect(metersPerSecondToKilometersPerHour(3)).toBe(10.8);
    expect(normalizePositiveIntegerMinutes(0)).toBeUndefined();
    expect(normalizePositiveIntegerMinutes(2.6)).toBe(3);

    expect(synthesizeUtcStartOfDay("2026-03-15", "UTC")).toBe("2026-03-15T00:00:00.000Z");
    expect(synthesizeUtcStartOfDay("2026-03-15", "not/a-zone")).toBeUndefined();

    const rawArtifacts: DeviceRawArtifactPayload[] = [];
    expect(pushGarminArtifact(rawArtifacts, "empty", "empty.json", {})).toBe(false);
    expect(pushGarminArtifact(rawArtifacts, "non-empty", "artifact.json", { ok: true })).toBe(true);
    expect(rawArtifacts).toHaveLength(1);
    expect(rawArtifacts[0]).toMatchObject({
      role: "non-empty",
      fileName: "artifact.json",
      mediaType: "application/json",
      content: { ok: true },
    });
  });

  it("covers Garmin activity file descriptor-only and content paths plus session duration fallback", () => {
    const rawArtifacts: DeviceRawArtifactPayload[] = [];
    const descriptorFile = {
      activityId: "activity-1",
      fileType: "fit",
      fileName: "activity.fit",
      content: {
        nested: true,
      },
      metadata: {
        source: "device",
      },
    };
    const contentFile = {
      activity_id: "activity-1",
      file_type: "json",
      fileName: "activity.json",
      content: {
        message: "ready",
      },
      checksum: "abc123",
    };
    const anonymousDescriptorFile = {
      fileName: "route.fit",
    };

    const roles = normalizeGarminActivityFiles(rawArtifacts, [
      descriptorFile,
      contentFile,
      anonymousDescriptorFile,
    ]);

    expect(rawArtifacts).toHaveLength(3);
    expect(rawArtifacts[0]).toMatchObject({
      role: "activity-asset:activity-1:fit",
      fileName: "activity-1-fit-asset-descriptor.json",
      mediaType: "application/json",
      metadata: {
        activityId: "activity-1",
        intendedFileType: "fit",
        intendedFileName: "activity.fit",
        intendedMediaType: "application/octet-stream",
        source: "device",
      },
    });
    expect(rawArtifacts[0].content).toBe(descriptorFile);
    expect(rawArtifacts[1]).toMatchObject({
      role: "activity-asset:activity-1:json",
      fileName: "activity.json",
      mediaType: "application/json",
      content: {
        message: "ready",
      },
      metadata: {
        activityId: "activity-1",
        fileType: "json",
        checksum: "abc123",
      },
    });
    expect(rawArtifacts[2]).toMatchObject({
      role: "activity-asset:unknown:fit-1",
      fileName: "activity-asset-1-fit-descriptor.json",
      mediaType: "application/json",
    });
    expect(roles.get("activity-1")).toEqual([
      "activity-asset:activity-1:fit",
      "activity-asset:activity-1:json",
    ]);

    const context = makeActivityContext();
    normalizeGarminActivities(context, [
      {
        activityId: "activity-1",
        startTime: "2026-03-15T08:00:00.000Z",
        endTime: "2026-03-15T08:30:00.000Z",
        type: "Run",
        activeCalories: 250,
        distanceMeters: 5000,
      },
      {
        id: "activity-2",
        type: "Walk",
      },
    ], roles);

    const activitySession = context.events.find(
      (event) => event.kind === "activity_session" && event.externalRef?.resourceId === "activity-1",
    );

    expect(activitySession).toMatchObject({
      kind: "activity_session",
      occurredAt: "2026-03-15T08:00:00.000Z",
      recordedAt: "2026-03-15T08:30:00.000Z",
      fields: {
        activityType: "run",
        durationMinutes: 30,
        distanceKm: 5,
      },
    });
    expect(activitySession?.rawArtifactRoles).toEqual([
      "activity:activity-1",
      "activity-asset:activity-1:fit",
      "activity-asset:activity-1:json",
    ]);

    expect(context.events.some((event) => event.kind === "activity_session" && event.externalRef?.resourceId === "activity-2")).toBe(false);
  });

  it("covers Garmin health timing fallbacks, sleep stage sampling, and aggregate stage durations", () => {
    const dailyContext = makeHealthContext("2026-03-16T12:00:00.000Z");
    normalizeGarminDailySummaries(dailyContext, [
      {
        summaryId: "day-1",
        calendarDate: "2026-03-15",
        timeZone: "UTC",
        steps: 1234,
      },
      {
        id: "day-2",
        steps: 2222,
      },
    ]);

    const dayOneSteps = dailyContext.events.find(
      (event) => event.externalRef?.resourceId === "day-1" && event.externalRef?.facet === "steps",
    );
    const fallbackSteps = dailyContext.events.find(
      (event) => event.externalRef?.resourceId === "day-2" && event.externalRef?.facet === "steps",
    );

    expect(dayOneSteps).toMatchObject({
      dayKey: "2026-03-15",
      timeZone: "UTC",
      recordedAt: "2026-03-15T00:00:00.000Z",
      fields: {
        metric: "daily-steps",
        value: 1234,
        unit: "count",
      },
    });
    expect(fallbackSteps).toMatchObject({
      recordedAt: "2026-03-16T12:00:00.000Z",
      fields: {
        metric: "daily-steps",
        value: 2222,
        unit: "count",
      },
    });
    expect(fallbackSteps?.dayKey).toBeUndefined();

    const womenHealthContext = makeHealthContext();
    normalizeGarminWomenHealth(womenHealthContext, [
      {
        recordId: "cycle-1",
        calendarDate: "2026-03-16",
        timeZone: "UTC",
        recordedAt: "2026-03-16T09:15:00.000Z",
        cycleDay: 7,
        periodDay: 2,
      },
    ]);

    const cycleDayEvent = womenHealthContext.events.find(
      (event) => event.externalRef?.facet === "cycle-day",
    );

    expect(cycleDayEvent).toMatchObject({
      dayKey: "2026-03-16",
      timeZone: "UTC",
      recordedAt: "2026-03-16T09:15:00.000Z",
      fields: {
        metric: "cycle-day",
        value: 7,
        unit: "count",
      },
    });

    const sleepContext = makeHealthContext();
    normalizeGarminSleeps(sleepContext, [
      {
        sleepId: "sleep-1",
        startTime: "2026-03-15T22:00:00.000Z",
        endTime: "2026-03-16T06:00:00.000Z",
        sleepScore: 88,
        sleepEfficiency: 92,
        sleepLevels: [
          {
            level: "awake-time",
            startAt: "2026-03-15T22:00:00.000Z",
            endAt: "2026-03-15T22:15:00.000Z",
            durationSeconds: 900,
          },
          {
            sleepStage: "light-sleep",
            startTime: "2026-03-15T22:15:00.000Z",
            endTime: "2026-03-16T01:00:00.000Z",
            durationMillis: 9_900_000,
          },
          {
            name: "deep-sleep",
            start_timestamp: "2026-03-16T01:00:00.000Z",
            end_timestamp: "2026-03-16T03:00:00.000Z",
            durationMinutes: 120,
          },
          {
            stage: "rapid-eye-movement",
            startAt: "2026-03-16T03:00:00.000Z",
            endAt: "2026-03-16T06:00:00.000Z",
            durationSeconds: 10_800,
          },
          {
            stage: "mystery",
            startAt: "2026-03-16T06:00:00.000Z",
          },
        ],
      },
    ]);

    const sleepSession = sleepContext.events.find((event) => event.kind === "sleep_session");
    const awakeMinutes = sleepContext.events.find(
      (event) => event.externalRef?.facet === "sleep-awake-minutes",
    );
    const sleepStageSamples = sleepContext.samples.filter((sample) => sample.stream === "sleep_stage");

    expect(sleepSession).toMatchObject({
      occurredAt: "2026-03-15T22:00:00.000Z",
      recordedAt: "2026-03-16T06:00:00.000Z",
      fields: {
        startAt: "2026-03-15T22:00:00.000Z",
        endAt: "2026-03-16T06:00:00.000Z",
        durationMinutes: 480,
      },
    });
    expect(awakeMinutes).toMatchObject({
      fields: {
        metric: "sleep-awake-minutes",
        value: 15,
        unit: "minutes",
      },
    });
    expect(sleepStageSamples).toHaveLength(4);
    expect(sleepStageSamples[0]).toMatchObject({
      stream: "sleep_stage",
      sample: {
        stage: "awake",
        durationMinutes: 15,
      },
    });
    expect(sleepStageSamples.some((sample) => sample.sample.stage === "awake")).toBe(true);
  });
});
