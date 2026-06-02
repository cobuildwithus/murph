import { describe, expect, it } from "vitest";

import {
  defaultDeviceProviderAdapters,
  prepareDeviceProviderSnapshotImport,
  resolveDeviceProviderDescriptor,
  stravaProviderAdapter,
} from "../src/index.ts";

describe("Strava importer adapter", () => {
  it("registers Strava through the shared descriptor and adapter seams", () => {
    expect(resolveDeviceProviderDescriptor("strava")?.provider).toBe("strava");
    expect(defaultDeviceProviderAdapters.some((adapter) => adapter.provider === "strava")).toBe(true);
    expect(stravaProviderAdapter.provider).toBe("strava");
  });

  it("normalizes Strava activity snapshots into the canonical device batch shape", async () => {
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "strava",
      snapshot: {
        accountId: "athlete-42",
        athlete: {
          id: 42,
          username: "murph",
        },
        sourceWindow: {
          kind: "backfill",
          windowStart: "2026-03-16T00:00:00.000Z",
          windowEnd: "2026-04-16T00:00:00.000Z",
        },
        activities: [
          {
            id: 1001,
            name: "Morning Run",
            sport_type: "Run",
            start_date: "2026-04-15T06:00:00.000Z",
            updated_at: "2026-04-15T06:31:00.000Z",
            elapsed_time: 1800,
            moving_time: 1740,
            distance: 5000,
            average_heartrate: 150,
            max_heartrate: 165,
            total_elevation_gain: 42,
            average_speed: 2.87,
            max_speed: 4.1,
            calories: 360,
            kilojoules: 1506.24,
            device_name: "Garmin Forerunner",
          },
        ],
      },
    });

    expect(payload.provider).toBe("strava");
    expect(payload.accountId).toBe("athlete-42");
    expect(payload.rawArtifacts?.map((artifact) => artifact.role)).toEqual(
      expect.arrayContaining([
        "athlete",
        "activity:1001",
      ]),
    );
    expect(payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("wearable-raw-receipt:"))).toBe(true);
    expect(payload.rawArtifacts?.find((artifact) => artifact.role === "activity:1001")?.content).toMatchObject({
      device_name: "Garmin Forerunner",
    });

    const sessionEvent = payload.events?.find((event) => event.kind === "activity_session");
    expect(sessionEvent).toMatchObject({
      occurredAt: "2026-04-15T06:00:00.000Z",
      title: "Strava Morning Run",
      externalRef: {
        system: "strava",
        resourceType: "activity",
        resourceId: "1001",
      },
      fields: {
        activityType: "run",
        distanceKm: 5,
        durationMinutes: 30,
        workout: expect.objectContaining({
          movingTimeMinutes: 29,
          sourceApp: "strava",
          sourceWorkoutId: "1001",
          sport: "run",
          sportName: "Run",
          metrics: {
            activeCalories: 360,
            totalCalories: 360,
            averageHeartRate: 150,
            maxHeartRate: 165,
            totalElevationGainMeters: 42,
            averageSpeedMps: 2.87,
            maxSpeedMps: 4.1,
          },
        }),
      },
    });
    expect(sessionEvent?.fields).not.toHaveProperty("deviceName");

    expect(
      payload.events?.filter(
        (event) =>
          event.kind === "observation" &&
          event.externalRef?.resourceType === "activity" &&
          event.externalRef?.resourceId === "1001",
      ),
    ).toEqual([]);
    expect(payload.provenance).toMatchObject({
      sourceWindow: {
        kind: "backfill",
      },
    });
  });

  it("preserves Strava deletion notices as canonical deletion observations", async () => {
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "strava",
      snapshot: {
        accountId: "athlete-42",
        deletions: [
          {
            resource_type: "activity",
            resource_id: "1001",
            occurred_at: "2026-04-16T00:00:00.000Z",
            source_event_type: "activity.delete",
          },
        ],
      },
    });

    expect(payload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "observation",
          fields: expect.objectContaining({
            metric: "external-resource-deleted",
            resourceType: "activity",
            deleted: true,
            sourceEventType: "activity.delete",
          }),
        }),
      ]),
    );
    expect(payload.rawArtifacts?.[0]?.role).toMatch(/^deletion:activity:activity.delete:[0-9a-f]{64}$/u);
    expect(payload.rawArtifacts?.[0]?.role).not.toContain("1001");
  });

  it("covers Strava fallback normalization paths and synthetic deletion ids", async () => {
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "strava",
      snapshot: {
        athlete: {
          athlete_id: 77,
          username: "fallback-athlete",
        },
        sourceWindow: {
          windowKind: "resource",
          resourceId: "activity-42",
          resourceType: "activity",
          windowEnd: "2026-04-16T00:00:00.000Z",
          windowStart: "2026-04-15T00:00:00.000Z",
        },
        activities: [
          {
            name: "  ",
            sportType: "Ride",
            startDateLocal: "2026-04-15T07:00:00.000Z",
            movingTime: 30,
            distanceMeter: 250,
            totalElevationGain: 12,
            averageSpeed: 3.5,
            maxSpeed: 5.1,
            calories: 220,
            kilojoules: "920.48",
            trainer: 1,
            commute: "false",
            manual: "true",
            private: 0,
          },
        ],
        deletions: [
          {
            resourceType: "activity",
            occurredAt: "2026-04-16T00:00:00.000Z",
            event_type: "activity.deleted",
          },
        ],
      },
    });

    expect(payload.accountId).toBe("77");
    expect(payload.provenance?.sourceWindow).toMatchObject({
      kind: "resource",
      resourceId: "activity-42",
      resourceType: "activity",
    });
    expect(payload.rawArtifacts?.find((artifact) => artifact.role === "activity:activity-1")?.content).toMatchObject({
      commute: "false",
      manual: "true",
      private: 0,
      trainer: 1,
    });

    const sessionEvent = payload.events?.find((event) => event.kind === "activity_session");
    expect(sessionEvent).toMatchObject({
      title: "Strava Ride",
      fields: expect.objectContaining({
        activityType: "ride",
        distanceKm: 0.25,
        durationMinutes: 1,
        workout: expect.objectContaining({
          movingTimeMinutes: 0.5,
          sport: "ride",
          sportName: "Ride",
          metrics: {
            activeCalories: 220,
            totalCalories: 220,
            totalElevationGainMeters: 12,
            averageSpeedMps: 3.5,
            maxSpeedMps: 5.1,
          },
        }),
      }),
    });
    expect(sessionEvent?.fields).not.toHaveProperty("commute");
    expect(sessionEvent?.fields).not.toHaveProperty("manual");
    expect(sessionEvent?.fields).not.toHaveProperty("private");
    expect(sessionEvent?.fields).not.toHaveProperty("trainer");
    expect(sessionEvent?.fields).not.toHaveProperty("totalElevationGainMeters");

    const deletionEvent = payload.events?.find(
      (event) => event.kind === "observation" && event.fields?.metric === "external-resource-deleted",
    );
    expect(deletionEvent?.externalRef?.resourceId).toMatch(/^deleted-/u);
  });

  it("rejects non-object Strava snapshots", async () => {
    await expect(
      prepareDeviceProviderSnapshotImport({
        provider: "strava",
        snapshot: [],
      }),
    ).rejects.toThrow(/Strava snapshot must be an object/u);
  });

  it("rejects malformed Strava snapshot collections", async () => {
    await expect(
      prepareDeviceProviderSnapshotImport({
        provider: "strava",
        snapshot: { activities: { id: 1001 } },
      }),
    ).rejects.toThrow(/Strava snapshot activities must be an array/u);

    await expect(
      prepareDeviceProviderSnapshotImport({
        provider: "strava",
        snapshot: { deletions: [null] },
      }),
    ).rejects.toThrow(/Strava snapshot deletions\[0\] must be an object/u);
  });
});
