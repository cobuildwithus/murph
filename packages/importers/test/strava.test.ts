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
            device_name: "Garmin Forerunner",
          },
        ],
      },
    });

    expect(payload.provider).toBe("strava");
    expect(payload.accountId).toBe("athlete-42");
    expect(payload.rawArtifacts?.map((artifact) => artifact.role)).toEqual([
      "athlete",
      "activity:1001",
    ]);

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
        deviceName: "Garmin Forerunner",
      },
    });

    expect(
      payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "distance"),
    ).toBe(true);
    expect(
      payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "active-calories"),
    ).toBe(true);
    expect(
      payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "average-heart-rate"),
    ).toBe(true);
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
    expect(payload.rawArtifacts?.[0]?.role).toContain("deletion:activity:1001");
  });
});
