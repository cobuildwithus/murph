import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveJunctionOrigin } from "@murphai/importers/device-providers/junction-origin";

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

test("Junction ECG voltage binds the documented id-less group to summary identity", async () => {
  const count = 30_000;
  const urls: string[] = [];
  const client = createClient(async (input) => {
    urls.push(readUrl(input));
    return createJsonResponse({
      groups: {
        apple_health_kit: [{
          source: { provider: "apple_health_kit", type: "watch", device_id: "watch-1" },
          data: Array.from({ length: count }, (_, index) => ({
            id: index,
            timestamp: new Date(Date.parse("2026-01-15T12:00:00.000Z") + index * 4).toISOString(),
            type: "lead_i",
            unit: "mV",
            value: index % 2 === 0 ? -0.1 : 0.1,
          })),
        }],
      },
    });
  });

  const records = await client.listElectrocardiogramVoltage({
    ...WINDOW,
    maxRecords: count,
    recordingId: "ecg-recording-1",
    sourceProviderSlug: "apple_health_kit",
    windowStart: "2026-01-15T12:00:00.000Z",
    windowEnd: "2026-01-15T12:02:00.000Z",
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
  assert.equal("id" in (first ?? {}), false);
  const url = new URL(urls[0] ?? "https://invalid.example");
  assert.equal(url.searchParams.get("start_date"), "2026-01-15T12:00:00.000Z");
  assert.equal(url.searchParams.get("end_date"), "2026-01-15T12:02:00.000Z");
  assert.equal(url.searchParams.get("provider"), "apple_health_kit");
});

test("Junction ECG voltage admits only the complete summary source identity", async () => {
  const targetSource = {
    device_id: "watch-b",
    provider: "apple_health_kit",
    type: "watch",
  };
  const sourceInstanceId = resolveJunctionOrigin({ source: targetSource }).sourceInstanceId;
  assert.ok(sourceInstanceId);
  const sample = (source: Record<string, unknown>, value: number) => ({
    data: [{
      timestamp: "2026-01-15T12:00:00.000Z",
      type: "lead_i",
      unit: "mV",
      value,
    }],
    source,
  });
  const client = createClient(async () => createJsonResponse({
    groups: {
      apple_health_kit: [
        sample({ provider: "apple_health_kit" }, 0.1),
        sample({ ...targetSource, type: "phone" }, 0.2),
        sample({ ...targetSource, device_id: "watch-a" }, 0.3),
        sample(targetSource, 0.4),
      ],
    },
  }));

  const records = await client.listElectrocardiogramVoltage({
    ...WINDOW,
    recordingId: "ecg-recording-1",
    sourceInstanceId,
    sourceProviderSlug: "apple_health_kit",
    sourceType: "watch",
  });

  assert.equal(records.length, 1);
  assert.equal((records[0] as Record<string, unknown>).value, 0.4);
});

test("Junction ECG grouped fetch rejects responses above the explicit dense cap", async () => {
  const client = createClient(async () => createJsonResponse({
    groups: {
      apple_health_kit: [{
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
    client.listElectrocardiogramVoltage({
      ...WINDOW,
      maxRecords: 100_000,
      recordingId: "ecg-recording-over-cap",
      sourceProviderSlug: "apple_health_kit",
    }),
    { code: "JUNCTION_API_RECORD_LIMIT" },
  );
});

test("Junction ECG voltage rejects conflicting provider identities retryably", async () => {
  for (const group of [
    {
      data: [{
        timestamp: "2026-01-15T12:00:00.000Z",
        type: "lead_i",
        unit: "mV",
        value: 0.1,
      }],
      id: "different-recording",
      source: { provider: "apple_health_kit", type: "watch" },
    },
    {
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
      client.listElectrocardiogramVoltage({
        ...WINDOW,
        recordingId: "ecg-group-1",
        sourceProviderSlug: "apple_health_kit",
      }),
      { code: "JUNCTION_ECG_RECORDING_BINDING_INCOMPLETE", retryable: true },
    );
  }
});

test("Junction ECG voltage cannot use the unbound generic collection path", async () => {
  const client = createClient(async () => createJsonResponse({ groups: {} }));
  await assert.rejects(
    client.listTimeseries({ ...WINDOW, resource: "electrocardiogram_voltage" }),
    /dedicated identity-bound fetch path/u,
  );
});

test("Junction ECG voltage honors the bounded collection attempt contract", async () => {
  let requests = 0;
  const client = createClient(async () => {
    requests += 1;
    return createJsonResponse({ error: "temporary" }, 500);
  });

  await assert.rejects(
    client.listElectrocardiogramVoltage({
      ...WINDOW,
      collectionWorkLimit: {
        maxAttemptsPerPage: 1,
        maxPages: 3,
        requestTimeoutMs: 8_000,
      },
      recordingId: "ecg-recording-1",
      sourceProviderSlug: "apple_health_kit",
    }),
    { code: "JUNCTION_API_REQUEST_FAILED" },
  );
  assert.equal(requests, 1);
});

test("Junction grouped timeseries honor the bounded collection attempt contract", async () => {
  let requests = 0;
  const client = createClient(async () => {
    requests += 1;
    return createJsonResponse({ error: "temporary" }, 500);
  });

  await assert.rejects(
    client.listTimeseries({
      ...WINDOW,
      collectionWorkLimit: {
        maxAttemptsPerPage: 1,
        maxPages: 3,
        requestTimeoutMs: 8_000,
      },
      resource: "fat",
    }),
    { code: "JUNCTION_API_REQUEST_FAILED" },
  );
  assert.equal(requests, 1);
});

test("Junction ECG voltage preserves bound identity across pagination", async () => {
  let page = 0;
  const client = createClient(async () => {
    page += 1;
    return createJsonResponse({
      groups: {
        apple_health_kit: [{
          source: { provider: "apple_health_kit", type: "watch" },
          data: [{
            timestamp: `2026-01-15T12:00:0${page}.000Z`,
            type: "lead_i",
            unit: "mV",
            value: page / 10,
          }],
        }],
      },
      ...(page < 3 ? { next_cursor: `page-${page + 1}` } : {}),
    });
  });

  const records = await client.listElectrocardiogramVoltage({
    ...WINDOW,
    maxRecords: 4,
    recordingId: "ecg-recording-1",
    sourceProviderSlug: "apple_health_kit",
  });

  assert.equal(page, 3);
  assert.deepEqual(
    records.map((record) => (record as Record<string, unknown>).junctionGroupId),
    ["ecg-recording-1", "ecg-recording-1", "ecg-recording-1"],
  );
});

test("Junction ECG voltage rejects source changes across pages", async () => {
  let page = 0;
  const client = createClient(async () => {
    page += 1;
    return createJsonResponse({
      groups: {
        apple_health_kit: [{
          source: {
            provider: "apple_health_kit",
            type: "watch",
            device_id: `watch-${page}`,
          },
          data: [{
            timestamp: `2026-01-15T12:00:0${page}.000Z`,
            type: "lead_i",
            unit: "mV",
            value: page / 10,
          }],
        }],
      },
      ...(page === 1 ? { next_cursor: "page-2" } : {}),
    });
  });

  await assert.rejects(
    client.listElectrocardiogramVoltage({
      ...WINDOW,
      maxRecords: 3,
      recordingId: "ecg-recording-1",
      sourceProviderSlug: "apple_health_kit",
    }),
    (error) => {
      assert.equal(
        (error as { code?: unknown }).code,
        "JUNCTION_ECG_RECORDING_BINDING_INCOMPLETE",
      );
      assert.equal(
        (error as { details?: { reason?: unknown } }).details?.reason,
        "collection_source_ambiguous",
      );
      return true;
    },
  );
  assert.equal(page, 2);
});
