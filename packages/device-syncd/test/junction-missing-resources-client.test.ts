import assert from "node:assert/strict";
import { test } from "vitest";

import {
  JunctionClient,
  resolveJunctionTimeseriesApiResource,
} from "../src/providers/junction-client.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";

function createClient(fetchImpl: typeof fetch): JunctionClient {
  return new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl,
  });
}

const WINDOW = {
  userId: "junction-user-1",
  windowStart: "2026-01-01T00:00:00.000Z",
  windowEnd: "2026-01-31T00:00:00.000Z",
};

test("Junction timeseries API mapping changes only public fat and legacy weight names", async () => {
  assert.equal(resolveJunctionTimeseriesApiResource("fat"), "body_fat");
  assert.equal(resolveJunctionTimeseriesApiResource("weight"), "body_weight");
  assert.equal(resolveJunctionTimeseriesApiResource("body_mass_index"), "body_mass_index");
  for (const resource of [
    "calories_basal",
    "daylight_exposure",
    "fall",
    "floors_climbed",
    "handwashing",
    "stand_duration",
    "stand_hour",
    "uv_exposure",
    "wheelchair_push",
    "workout_distance",
    "workout_duration",
    "workout_swimming_stroke",
  ]) {
    assert.equal(resolveJunctionTimeseriesApiResource(resource), resource);
  }

  const paths: string[] = [];
  const client = createClient(async (input) => {
    paths.push(new URL(readUrl(input)).pathname);
    return createJsonResponse({ groups: {} });
  });

  await client.listTimeseries({ ...WINDOW, resource: "fat" });
  await client.listTimeseries({ ...WINDOW, resource: "body_mass_index" });
  await client.listTimeseries({ ...WINDOW, resource: "workout_distance" });

  assert.deepEqual(paths, [
    "/v2/timeseries/junction-user-1/body_fat/grouped",
    "/v2/timeseries/junction-user-1/body_mass_index/grouped",
    "/v2/timeseries/junction-user-1/workout_distance/grouped",
  ]);
});

test("Junction sparse collection fetches retain the existing 100-page cap", async () => {
  let calls = 0;
  const client = createClient(async () => {
    calls += 1;
    return createJsonResponse({
      groups: {},
      next_cursor: `page-${calls + 1}`,
    });
  });

  await assert.rejects(
    client.listTimeseries({ ...WINDOW, resource: "fat" }),
    { code: "JUNCTION_API_PAGINATION_LIMIT" },
  );
  assert.equal(calls, 100);
});

test("Junction sparse collection fetches retain the existing 25,000-record cap", async () => {
  const client = createClient(async () => createJsonResponse({
    groups: {
      withings: [{
        data: Array.from({ length: 25_001 }, (_, index) => ({
          id: `fat-${index}`,
          timestamp: "2026-01-15T12:00:00.000Z",
          unit: "%",
          value: 18,
        })),
        source: { provider: "withings", type: "scale" },
      }],
    },
  }));

  await assert.rejects(
    client.listTimeseries({ ...WINDOW, resource: "fat" }),
    { code: "JUNCTION_API_RECORD_LIMIT" },
  );
});

test("Junction workout_stream uses only the dedicated workout stream endpoint", async () => {
  const urls: string[] = [];
  const client = createClient(async (input) => {
    urls.push(readUrl(input));
    return createJsonResponse({
      time: [1_783_000_000],
      heartrate: [120],
    });
  });

  await assert.rejects(
    client.listTimeseries({ ...WINDOW, resource: "workout_stream" }),
    /dedicated workout stream endpoint/u,
  );
  const payload = await client.getWorkoutStream({ workoutId: "workout/1" });

  assert.deepEqual(payload, { time: [1_783_000_000], heartrate: [120] });
  assert.equal(
    new URL(urls[0] ?? "https://invalid.example").pathname,
    "/v2/timeseries/workouts/workout%2F1/stream",
  );
  assert.equal(urls.length, 1);
});

test("Junction ECG grouped fetch admits its explicit dense cap and preserves group identity", async () => {
  const count = 30_000;
  const client = createClient(async () => createJsonResponse({
    groups: {
      apple_health_kit: [{
        id: "ecg-recording-1",
        session_start: "2026-01-15T12:00:00.000Z",
        session_end: "2026-01-15T12:02:00.000Z",
        revision: 2,
        updated_at: "2026-01-15T13:00:00.000Z",
        source: { provider: "apple_health_kit", type: "watch", device_id: "watch-1" },
        data: Array.from({ length: count }, (_, index) => ({
          timestamp: new Date(Date.parse("2026-01-15T12:00:00.000Z") + index * 4).toISOString(),
          type: "lead_i",
          unit: "mV",
          value: index % 2 === 0 ? -0.1 : 0.1,
        })),
      }],
    },
  }));

  const records = await client.listTimeseries({
    ...WINDOW,
    resource: "electrocardiogram_voltage",
  });

  assert.equal(records.length, count);
  const first = records[0] as Record<string, unknown> | undefined;
  assert.deepEqual(records[0], {
    junctionGroupId: "ecg-recording-1",
    junctionResource: "electrocardiogram_voltage",
    sourceInstanceId: first?.sourceInstanceId,
    sourceProviderSlug: "apple-health-kit",
    sourceType: "watch",
    timestamp: "2026-01-15T12:00:00.000Z",
    type: "lead_i",
    unit: "mV",
    value: -0.1,
  });
  assert.match(String(first?.sourceInstanceId), /^source-[a-f0-9]{24}$/u);
});

test("Junction ECG grouped fetch rejects responses above the explicit dense cap", async () => {
  const client = createClient(async () => createJsonResponse({
    groups: {
      apple_health_kit: [{
        id: "ecg-recording-over-cap",
        data: Array.from({ length: 100_001 }, (_, index) => ({
          timestamp: new Date(Date.parse("2026-01-15T12:00:00.000Z") + index).toISOString(),
          type: "lead_i",
          unit: "mV",
          value: 0,
        })),
        source: { provider: "apple_health_kit", type: "watch" },
      }],
    },
  }));

  await assert.rejects(
    client.listTimeseries({
      ...WINDOW,
      maxRecords: 200_000,
      resource: "electrocardiogram_voltage",
    }),
    { code: "JUNCTION_API_RECORD_LIMIT" },
  );
});

test("Junction ECG grouped fetch requires group identity and rejects sample conflicts", async () => {
  for (const group of [
    {
      data: [{
        timestamp: "2026-01-15T12:00:00.000Z",
        type: "lead_i",
        unit: "mV",
        value: 0.1,
      }],
      source: { provider: "apple_health_kit", type: "watch" },
    },
    {
      id: "ecg-group-1",
      data: [{
        recording_id: "ecg-sample-2",
        timestamp: "2026-01-15T12:00:00.000Z",
        type: "lead_i",
        unit: "mV",
        value: 0.1,
      }],
      source: { provider: "apple_health_kit", type: "watch" },
    },
  ]) {
    const client = createClient(async () => createJsonResponse({
      groups: { apple_health_kit: [group] },
    }));
    await assert.rejects(
      client.listTimeseries({ ...WINDOW, resource: "electrocardiogram_voltage" }),
      /ECG (?:group lacked|sample conflicted)/u,
    );
  }
});
