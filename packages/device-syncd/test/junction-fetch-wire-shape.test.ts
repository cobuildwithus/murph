import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  ClientActivityResponse,
  ClientBodyResponse,
  ClientFacingActivity,
  ClientFacingBody,
  ClientFacingElectrocardiogramResponse,
  ClientFacingMealResponse,
  ClientFacingProfile,
  ClientFacingSleep,
  ClientFacingSleepCycle,
  ClientFacingStream,
  ClientFacingWorkout,
  ClientSleepCycleResponse,
  ClientSleepResponse,
  ClientWorkoutResponse,
  GroupedBodyFatResponse,
  GroupedBodyMassIndexResponse,
  GroupedBodyWeightResponse,
  GroupedHrvResponse,
  GroupedLeanBodyMassResponse,
  GroupedWaistCircumferenceResponse,
  MenstrualCycleResponse,
} from "@junction-api/sdk/serialization";
import { initializeVault, readJsonlRecords } from "@murphai/core";
import { importDeviceProviderSnapshot } from "@murphai/importers";
import {
  normalizeJunctionSnapshot,
  type JunctionSnapshotInput,
} from "@murphai/importers/device-providers/junction";
import { test } from "vitest";

import { JunctionClient } from "../src/providers/junction-client.ts";
import {
  createAccount,
  createJob,
  createJobFromInput,
  createJunctionJobContext,
  createJunctionProvider,
  createStoredAccount,
  executeJunctionJob,
} from "./junction-provider.harness.ts";
import { createJsonResponse, makeTempDirectory, readUrl } from "./helpers.ts";

// Every fixture is Junction's documented wire shape and is accepted by the
// installed SDK's own response serializer, so each fetch below takes the path
// production takes: the SDK parses the response into camelCase keys and Dates.
// Fixtures the SDK rejects fall back to the raw body and would prove nothing.
interface SdkResponseSerializer {
  parseOrThrow(value: unknown, options: Record<string, unknown>): unknown;
}

const SDK_PARSE_OPTIONS = {
  unrecognizedObjectKeys: "passthrough",
  allowUnrecognizedUnionMembers: true,
  allowUnrecognizedEnumValues: true,
} as const;
const VAULT_TIME_ZONE = "America/New_York";
const SOURCE = {
  provider: "garmin",
  type: "watch",
  name: "Garmin",
  slug: "garmin",
  logo: "https://example.test/garmin.png",
  app_id: "com.example.app",
  device_id: "device-1",
};
const RECORD_BASE = {
  user_id: "junction-user-1",
  source: SOURCE,
  created_at: "2026-04-02T23:00:00+00:00",
  updated_at: "2026-04-02T23:30:00+00:00",
};

const SUMMARY_FIXTURES: Record<string, {
  /** Facts the SDK-shaped record lost before this boundary existed. */
  restored: readonly string[];
  record: Record<string, unknown>;
  response: (record: Record<string, unknown>) => unknown;
  serializer: SdkResponseSerializer;
}> = {
  activity: {
    serializer: ClientActivityResponse,
    response: (record) => ({ activity: [record] }),
    restored: [
      "active-calories=640", "total-calories=2400", "resting-heart-rate=52",
      "activity-average-heart-rate=72", "minimum-heart-rate=44", "max-heart-rate=148",
      "walking-average-heart-rate=83",
    ],
    record: {
      ...RECORD_BASE,
      id: "11111111-1111-4111-8111-111111111111",
      date: "2026-04-02T00:00:00+00:00",
      calendar_date: "2026-04-02",
      calories_total: 2400,
      calories_active: 640,
      steps: 9400,
      daily_movement: 7000,
      distance: 7500,
      low: 84,
      medium: 15,
      high: 29,
      floors_climbed: 18,
      time_zone: VAULT_TIME_ZONE,
      timezone_offset: -14400,
      heart_rate: { avg_bpm: 72, min_bpm: 44, max_bpm: 148, resting_bpm: 52, avg_walking_bpm: 83 },
    },
  },
  sleep: {
    serializer: ClientSleepResponse,
    response: (record) => ({ sleep: [record] }),
    restored: [
      "hrv=61", "resting-heart-rate=50", "average-heart-rate=54", "lowest-heart-rate=46",
      "temperature=34.1",
    ],
    record: {
      ...RECORD_BASE,
      id: "22222222-2222-4222-8222-222222222222",
      date: "2026-04-02T00:00:00+00:00",
      calendar_date: "2026-04-02",
      bedtime_start: "2026-04-02T02:30:00+00:00",
      bedtime_stop: "2026-04-02T10:30:00+00:00",
      type: "long_sleep",
      timezone_offset: -14400,
      duration: 28800,
      total: 26400,
      awake: 2400,
      light: 14400,
      rem: 6000,
      deep: 6000,
      score: 82,
      recovery_readiness_score: 77,
      hr_lowest: 46,
      hr_average: 54,
      hr_resting: 50,
      efficiency: 92,
      latency: 600,
      temperature_delta: 0.2,
      skin_temperature: 34.1,
      hr_dip: 12,
      state: "confirmed",
      average_hrv: 61,
      respiratory_rate: 14.2,
    },
  },
  body: {
    serializer: ClientBodyResponse,
    response: (record) => ({ body: [record] }),
    restored: ["bmi=22.3"],
    record: {
      ...RECORD_BASE,
      source: { ...SOURCE, type: "scale" },
      id: "33333333-3333-4333-8333-333333333333",
      date: "2026-04-03T01:00:00+00:00",
      calendar_date: "2026-04-02",
      weight: 80,
      fat: 21.5,
      water_percentage: 51.8,
      muscle_mass_percentage: 63.4,
      visceral_fat_index: 7,
      bone_mass_percentage: 4.2,
      body_mass_index: 22.3,
      lean_body_mass_kilogram: 62.1,
      waist_circumference_centimeter: 86.4,
    },
  },
  workouts: {
    serializer: ClientWorkoutResponse,
    response: (record) => ({ workouts: [record] }),
    restored: ["workout.averageHeartRate=141", "workout.maxHeartRate=172"],
    record: {
      ...RECORD_BASE,
      id: "44444444-4444-4444-8444-444444444444",
      title: "Morning run",
      timezone_offset: -14400,
      average_hr: 141,
      max_hr: 172,
      distance: 8200,
      calendar_date: "2026-04-02",
      time_start: "2026-04-02T11:00:00+00:00",
      time_end: "2026-04-02T11:45:00+00:00",
      calories: 610,
      sport: { id: 1, name: "Running", slug: "running" },
      hr_zones: [60, 300, 900, 1200, 240],
      moving_time: 2600,
      total_elevation_gain: 120,
      average_speed: 3.1,
      max_speed: 4.6,
      average_watts: 210,
      max_watts: 420,
      steps: 7800,
      provider_id: "provider-workout-1",
    },
  },
  meal: {
    serializer: ClientFacingMealResponse,
    response: (record) => ({ meals: [record] }),
    restored: ["meal.chromiumMcg=4", "meal.copperMg=1", "meal.seleniumMcg=9"],
    record: {
      ...RECORD_BASE,
      id: "66666666-6666-4666-8666-666666666666",
      priority_id: 1,
      source_id: 2,
      provider_id: "provider-meal-1",
      timestamp: "2026-04-02T16:30:00+00:00",
      calendar_date: "2026-04-02",
      name: "Lunch",
      energy: { unit: "kcal", value: 640 },
      macros: { carbs: 70, protein: 35, fats: { total: 22 }, fibre: 9, water: 300 },
      micros: {
        minerals: { sodium: 0.6 },
        trace_elements: { chromium: 4, copper: 1, selenium: 9 },
        vitamins: { vitamin_c: 30 },
      },
      source_app_id: "com.example.app",
      source_device_id: "device-1",
    },
  },
  sleep_cycle: {
    serializer: ClientSleepCycleResponse,
    response: (record) => ({ sleep_cycle: [record] }),
    restored: [],
    record: {
      ...RECORD_BASE,
      id: "55555555-5555-4555-8555-555555555555",
      sleep_id: "22222222-2222-4222-8222-222222222222",
      session_start: "2026-04-02T02:30:00+00:00",
      session_end: "2026-04-02T10:30:00+00:00",
      stage_start_offset_second: [0, 3600, 7200],
      stage_end_offset_second: [3600, 7200, 28800],
      stage_type: [1, 2, 3],
      time_zone: VAULT_TIME_ZONE,
      source_provider: "garmin",
      source_type: "watch",
      source_app_id: "com.example.app",
      source_device_id: "device-1",
    },
  },
  menstrual_cycle: {
    serializer: MenstrualCycleResponse,
    response: (record) => ({ menstrual_cycle: [record] }),
    restored: [],
    record: {
      ...RECORD_BASE,
      id: "77777777-7777-4777-8777-777777777777",
      period_start: "2026-04-01",
      period_end: "2026-04-05",
      cycle_end: "2026-04-28",
      is_predicted: false,
      menstrual_flow: [{ date: "2026-04-02", flow: "medium" }],
      source_provider: "garmin",
      source_type: "watch",
      source_app_id: "com.example.app",
      source_device_id: "device-1",
    },
  },
  electrocardiogram: {
    serializer: ClientFacingElectrocardiogramResponse,
    response: (record) => ({ electrocardiogram: [record] }),
    restored: [],
    record: {
      ...RECORD_BASE,
      id: "88888888-8888-4888-8888-888888888888",
      session_start: "2026-04-02T13:00:00+00:00",
      session_end: "2026-04-02T13:00:30+00:00",
      voltage_sample_count: 3,
      heart_rate_mean: 64,
      sampling_frequency_hz: 512,
      classification: "sinus_rhythm",
      algorithm_version: "2",
      time_zone: VAULT_TIME_ZONE,
      source_provider: "garmin",
      source_type: "watch",
      source_app_id: "com.example.app",
      source_device_model: "Watch",
      source_device_id: "device-1",
    },
  },
  profile: {
    serializer: ClientFacingProfile,
    response: (record) => record,
    restored: [],
    record: {
      ...RECORD_BASE,
      id: "99999999-9999-4999-8999-999999999999",
      height: 180,
      birth_date: "1990-01-01",
      gender: "male",
      sex: "male",
    },
  },
};

function groupedTimeseries(samples: readonly Record<string, unknown>[]) {
  return { groups: { garmin: [{ source: SOURCE, data: samples }] } };
}

function createClient(response: unknown): JunctionClient {
  return new JunctionClient({
    apiKey: "sk_us_synthetic",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => createJsonResponse(response),
  });
}

/** Imports one resource the way a webhook-triggered job does: inline, or by fetching. */
async function importResource(input: {
  category: "summary" | "timeseries";
  inlineRecord?: unknown;
  resource: string;
  response?: unknown;
}): Promise<JunctionSnapshotInput[]> {
  const snapshots: JunctionSnapshotInput[] = [];
  const provider = createJunctionProvider(async (request) => {
    const url = new URL(readUrl(request));
    if (url.pathname.includes("/user/providers/")) {
      return createJsonResponse({ providers: [{
        id: "synthetic-provider", name: "Garmin", slug: "garmin", status: "connected",
        resource_availability: {},
      }] });
    }
    if (input.response === undefined) {
      throw new Error(`Unexpected request: ${url.pathname}`);
    }
    return createJsonResponse(input.response);
  }, {
    summaryResources: input.category === "summary" ? [input.resource] : [],
    timeseriesResources: input.category === "timeseries" ? [input.resource] : [],
  });
  await executeJunctionJob(provider, createJunctionJobContext({
    now: "2026-04-05T12:00:00.000Z",
    vaultTimeZone: VAULT_TIME_ZONE,
    importSnapshot: async (snapshot) => {
      // The import boundary is JSON: the runner receives the snapshot serialized.
      snapshots.push(JSON.parse(JSON.stringify(snapshot)) as JunctionSnapshotInput);
      return { imported: true };
    },
  }), createJob("resource", {
    eventType: `daily.data.${input.resource}.created`,
    occurredAt: "2026-04-02T12:00:00.000Z",
    resource: input.resource,
    resourceCategory: input.category,
    sourceProviderSlug: "garmin",
    ...(input.inlineRecord === undefined
      ? {}
      : { webhookDataJson: JSON.stringify(input.inlineRecord) }),
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-05T00:00:00.000Z",
  }));
  return snapshots;
}

function normalizedEvents(snapshot: JunctionSnapshotInput | undefined) {
  assert.ok(snapshot, "the job should import one snapshot");
  return (normalizeJunctionSnapshot(snapshot, { defaultTimeZone: VAULT_TIME_ZONE }).events ?? [])
    .map((event) => ({
      dayKey: event.dayKey,
      externalRef: event.externalRef,
      fields: event.fields,
      kind: event.kind,
      occurredAt: event.occurredAt,
      recordedAt: event.recordedAt,
    }));
}

/** Compact `metric=value` facts, so a missing field reads as a missing line. */
function importedFacts(events: ReturnType<typeof normalizedEvents>): string[] {
  return events.flatMap((event) => {
    const fields = event.fields as Record<string, unknown> | undefined;
    const workout = fields?.workout as { metrics?: Record<string, unknown> } | undefined;
    const nutrition = fields?.nutrition as { micros?: Record<string, unknown> } | undefined;
    const measurements = Array.isArray(fields?.measurements)
      ? fields.measurements as Array<{ metric?: unknown; value?: unknown }>
      : [];
    return [
      ...(typeof fields?.metric === "string" ? [`${fields.metric}=${String(fields.value)}`] : []),
      ...measurements.map((entry) => `${String(entry.metric)}=${String(entry.value)}`),
      ...Object.entries(workout?.metrics ?? {}).map(([key, value]) => `workout.${key}=${String(value)}`),
      ...Object.entries(nutrition?.micros ?? {}).map(([key, value]) => `meal.${key}=${String(value)}`),
    ];
  });
}

test("the installed SDK parses these fixtures into camelCase keys and Dates", () => {
  const parsed = ClientActivityResponse.parseOrThrow(
    SUMMARY_FIXTURES.activity!.response(SUMMARY_FIXTURES.activity!.record),
    SDK_PARSE_OPTIONS,
  ) as unknown as { activity: Array<Record<string, unknown>> };
  const record = parsed.activity[0]!;
  assert.equal(record.caloriesActive, 640);
  assert.equal(record.calories_active, undefined);
  assert.deepEqual(record.heartRate, {
    avgBpm: 72, minBpm: 44, maxBpm: 148, restingBpm: 52, avgWalkingBpm: 83,
  });
  assert.ok(record.date instanceof Date);

  for (const [resource, fixture] of Object.entries(SUMMARY_FIXTURES)) {
    assert.doesNotThrow(
      () => fixture.serializer.parseOrThrow(fixture.response(fixture.record), SDK_PARSE_OPTIONS),
      `${resource} fixture must take the SDK's parsed path`,
    );
  }
});

test("fetched summaries keep Junction's wire keys with UTC timestamps", async () => {
  const fixture = SUMMARY_FIXTURES.activity!;
  const [record] = await createClient(fixture.response(fixture.record)).listSummary({
    resource: "activity",
    userId: "junction-user-1",
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-05T00:00:00.000Z",
  });

  assert.deepEqual(record, {
    ...fixture.record,
    date: "2026-04-02T00:00:00.000Z",
    created_at: "2026-04-02T23:00:00.000Z",
    updated_at: "2026-04-02T23:30:00.000Z",
  });
});

test("fetched collections whose envelope the SDK renames keep their records", async () => {
  const fixture = SUMMARY_FIXTURES.sleep_cycle!;
  const [record] = await createClient(fixture.response(fixture.record)).listSummary({
    resource: "sleep_cycle",
    userId: "junction-user-1",
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-05T00:00:00.000Z",
  }) as Array<Record<string, unknown>>;

  assert.equal(record?.session_start, "2026-04-02T02:30:00.000Z");
  assert.deepEqual(record?.stage_start_offset_second, [0, 3600, 7200]);
  assert.equal(record?.sessionStart, undefined);
});

test("fetched timeseries samples keep wire keys with UTC timestamps", async () => {
  const response = groupedTimeseries([{
    id: 1, timezone_offset: -14400, type: "automatic", unit: "kg",
    timestamp: "2026-04-02T12:00:00+00:00", value: 80.5,
  }]);
  assert.doesNotThrow(() => GroupedBodyWeightResponse.parseOrThrow(response, SDK_PARSE_OPTIONS));

  const [sample] = await createClient(response).listTimeseries({
    resource: "weight",
    userId: "junction-user-1",
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  }) as Array<Record<string, unknown>>;

  assert.equal(sample?.timestamp, "2026-04-02T12:00:00.000Z");
  assert.equal(sample?.timezone_offset, -14400);
  assert.equal(sample?.timezoneOffset, undefined);
  assert.equal(sample?.sourceProviderSlug, "garmin");
});

test("fetched workout streams keep the speed series under its wire key", async () => {
  const response = {
    time: [0, 1, 2], heartrate: [100, 101, 102], velocity_smooth: [2.1, 2.2, 2.3],
    distance: [0, 2, 4],
  };
  assert.doesNotThrow(() => ClientFacingStream.parseOrThrow(response, SDK_PARSE_OPTIONS));

  assert.deepEqual(
    await createClient(response).getWorkoutStream({ workoutId: "workout-1" }),
    response,
  );
});

test.each(Object.keys(SUMMARY_FIXTURES))(
  "fetched and webhook-delivered %s summaries import the same events",
  async (resource) => {
    const fixture = SUMMARY_FIXTURES[resource]!;
    const [fetched] = await importResource({
      category: "summary", resource, response: fixture.response(fixture.record),
    });
    const [inline] = await importResource({
      category: "summary", resource, inlineRecord: fixture.record,
    });

    const fetchedEvents = normalizedEvents(fetched);
    assert.ok(fetchedEvents.length > 0);
    assert.deepEqual(fetchedEvents, normalizedEvents(inline));
    const facts = importedFacts(fetchedEvents);
    for (const fact of fixture.restored) {
      assert.ok(facts.includes(fact), `${resource} import should include ${fact}`);
    }
  },
);

test.each([
  {
    resource: "weight", serializer: GroupedBodyWeightResponse, fact: "weight=80.5",
    sample: { unit: "kg", value: 80.5 },
  },
  {
    resource: "fat", serializer: GroupedBodyFatResponse, fact: "body-fat-percentage=21.5",
    sample: { unit: "%", value: 21.5 },
  },
  {
    resource: "body_mass_index", serializer: GroupedBodyMassIndexResponse, fact: "bmi=22.3",
    sample: { unit: "index", value: 22.3, start: "2026-04-02T12:00:00+00:00", end: "2026-04-02T12:01:00+00:00" },
  },
  {
    resource: "lean_body_mass", serializer: GroupedLeanBodyMassResponse, fact: "lean-body-mass=62.1",
    sample: { unit: "kg", value: 62.1, start: "2026-04-02T12:00:00+00:00", end: "2026-04-02T12:01:00+00:00" },
  },
  {
    resource: "waist_circumference", serializer: GroupedWaistCircumferenceResponse,
    fact: "waist-circumference=86.4",
    sample: { unit: "cm", value: 86.4, start: "2026-04-02T12:00:00+00:00", end: "2026-04-02T12:01:00+00:00" },
  },
] satisfies Array<{
  fact: string;
  resource: string;
  sample: Record<string, unknown>;
  serializer: SdkResponseSerializer;
}>)("fetched $resource samples are imported instead of dropped", async ({
  fact,
  resource,
  sample,
  serializer,
}) => {
  const response = groupedTimeseries([{
    id: 1, timezone_offset: -14400, type: "automatic",
    timestamp: "2026-04-02T12:00:00+00:00", ...sample,
  }]);
  assert.doesNotThrow(() => serializer.parseOrThrow(response, SDK_PARSE_OPTIONS));

  const snapshots = await importResource({ category: "timeseries", resource, response });

  assert.equal(snapshots.length, 1);
  assert.deepEqual(importedFacts(normalizedEvents(snapshots[0])), [fact]);
});

test("fetched samples stay on the member's local day, not the UTC date Junction writes", async () => {
  const response = groupedTimeseries([
    // 20:30 the evening before, in a UTC-4 zone.
    { id: 1, timezone_offset: -14400, type: "automatic", unit: "rmssd", timestamp: "2026-04-02T00:30:00+00:00", value: 40 },
    { id: 2, timezone_offset: -14400, type: "automatic", unit: "rmssd", timestamp: "2026-04-02T12:00:00+00:00", value: 50 },
    // 01:30 the next morning, in a UTC+2 zone.
    { id: 3, timezone_offset: 7200, type: "automatic", unit: "rmssd", timestamp: "2026-04-02T23:30:00+00:00", value: 60 },
  ]);
  assert.doesNotThrow(() => GroupedHrvResponse.parseOrThrow(response, SDK_PARSE_OPTIONS));

  const snapshots = await importResource({ category: "timeseries", resource: "hrv", response });

  assert.deepEqual(
    normalizedEvents(snapshots[0]).map((event) => [event.dayKey, event.fields?.value]),
    [["2026-04-01", 40], ["2026-04-02", 50], ["2026-04-03", 60]],
  );
});

test("re-reading a day repairs records imported while fields were being dropped", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-wire-shape-repair");
  const coreRuntime = await import("@murphai/core");
  await initializeVault({ vaultRoot });
  const importSnapshot = (snapshot: JunctionSnapshotInput) => importDeviceProviderSnapshot({
    vaultRoot, provider: "junction", snapshot,
  }, { corePort: coreRuntime });
  const readLedger = async () => await readJsonlRecords({
    vaultRoot, relativePath: "ledger/events/2026/2026-04.jsonl",
  }) as Array<{
    externalRef?: { facet?: string };
    lifecycle?: { revision?: number };
    metric?: string;
    workout?: { metrics?: Record<string, unknown> };
  }>;
  // The pre-fix snapshot: the same sanitized records, in the SDK's parsed shape.
  const sdkShaped = (snapshot: JunctionSnapshotInput, resource: string, serializer: SdkResponseSerializer) =>
    JSON.parse(JSON.stringify({
      ...snapshot,
      summaries: {
        [resource]: (snapshot.summaries?.[resource] as unknown[]).map((record) =>
          serializer.parseOrThrow(record, { ...SDK_PARSE_OPTIONS, skipValidation: true })
        ),
      },
    })) as JunctionSnapshotInput;

  try {
    const [activity] = await importResource({
      category: "summary", resource: "activity",
      response: SUMMARY_FIXTURES.activity!.response(SUMMARY_FIXTURES.activity!.record),
    });
    const [workout] = await importResource({
      category: "summary", resource: "workouts",
      response: SUMMARY_FIXTURES.workouts!.response(SUMMARY_FIXTURES.workouts!.record),
    });
    assert.ok(activity && workout);

    await importSnapshot(sdkShaped(activity, "activity", ClientFacingActivity));
    await importSnapshot(sdkShaped(workout, "workouts", ClientFacingWorkout));
    const before = await readLedger();
    assert.equal(before.some((event) => event.metric === "resting-heart-rate"), false);
    assert.equal(before.some((event) => event.metric === "active-calories"), false);
    assert.equal(before.find((event) => event.workout)?.workout?.metrics?.averageHeartRate, undefined);

    await importSnapshot(activity);
    await importSnapshot(workout);
    const repaired = await readLedger();
    // Each missing field is added once and nothing already stored is duplicated.
    const facets = repaired.filter((event) => !event.workout).map((event) => event.externalRef?.facet);
    assert.equal(new Set(facets).size, facets.length);
    assert.equal(facets.length, before.filter((event) => !event.workout).length + 7);
    assert.ok(facets.includes("resting-heart-rate"));
    assert.ok(facets.includes("active-calories"));
    // The stored workout gains its heart rate as a new revision of the same event.
    const workoutRevisions = repaired.filter((event) => event.workout);
    assert.deepEqual(workoutRevisions.map((event) => event.lifecycle?.revision), [undefined, 2]);
    assert.equal(workoutRevisions.at(-1)?.workout?.metrics?.averageHeartRate, 141);

    await importSnapshot(activity);
    await importSnapshot(workout);
    assert.equal((await readLedger()).length, repaired.length, "a further re-read is a no-op");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

// Older history is read again by one path only: the connect-window backfill a
// coverage generation bump re-queues, which then continues to the reconcile
// window. These days were imported once already, in the shape that dropped
// fields: the days before the connection by its first backfill, and later
// days by the fetch for a source that joined afterwards.
const HISTORY_CONNECTED_AT = "2026-04-14T15:00:00.000Z";
const HISTORY_NOW = "2026-05-20T12:00:00.000Z";
const HISTORY_WINDOW = {
  windowStart: "2026-04-01T00:00:00.000Z",
  windowEnd: "2026-04-14T00:00:00.000Z",
};
// Day 0 is 2026-04-01. Twelve days before the connection, two fetched after it.
const HISTORY_FETCHED_DAYS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 18, 31];
// Delivered whole by webhook after the connection; the re-read must not touch it.
const HISTORY_WEBHOOK_DAY = 24;
const HISTORY_WORKOUT_DAYS = HISTORY_FETCHED_DAYS.filter((day) => day % 3 === 0);
const HISTORY_SUMMARY_SERIALIZERS: Record<string, SdkResponseSerializer> = {
  activity: ClientFacingActivity,
  body: ClientFacingBody,
  sleep: ClientFacingSleep,
  sleep_cycle: ClientFacingSleepCycle,
  workouts: ClientFacingWorkout,
};

function historyDate(day: number): string {
  return new Date(Date.UTC(2026, 3, 1 + day)).toISOString().slice(0, 10);
}

/** The fixture record moved onto one history day, with ids of its own. */
function onHistoryDay(record: Record<string, unknown>, day: number): Record<string, unknown> {
  const suffix = String(day).padStart(2, "0");
  return JSON.parse(
    JSON.stringify(record)
      .replace(/2026-04-0([23])/gu, (_match, fixtureDay: string) => historyDate(day + Number(fixtureDay) - 2))
      .replace(/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{10})[0-9a-f]{2}/gu, `$1${suffix}`)
      .replace(/provider-workout-1/gu, `provider-workout-${suffix}`),
  ) as Record<string, unknown>;
}

async function hashVaultTree(root: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    hashes.set(path.relative(root, file), createHash("sha256").update(await readFile(file)).digest("hex"));
  }
  return hashes;
}

test("a coverage generation bump re-reads older summaries once, in place, and repeats as a no-op", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-history-repull");
  const coreRuntime = await import("@murphai/core");
  await initializeVault({ vaultRoot });
  const importSnapshot = (snapshot: JunctionSnapshotInput) => importDeviceProviderSnapshot({
    vaultRoot, provider: "junction", snapshot,
  }, { corePort: coreRuntime });
  // The pre-fix import: the same sanitized records in the SDK's parsed shape.
  const importDroppingFields = (snapshot: JunctionSnapshotInput) => importSnapshot({
    ...snapshot,
    summaries: Object.fromEntries(Object.entries(snapshot.summaries ?? {}).map(([resource, records]) => [
      resource,
      (records as unknown[]).map((record) => JSON.parse(JSON.stringify(
        HISTORY_SUMMARY_SERIALIZERS[resource]!.parseOrThrow(record, { ...SDK_PARSE_OPTIONS, skipValidation: true }),
      )) as unknown),
    ])),
  });
  const readLedger = async () => {
    const shards = (await readdir(path.join(vaultRoot, "ledger/events"), { recursive: true }))
      .filter((file) => file.endsWith(".jsonl")).sort();
    const events = await Promise.all(shards.map((file) => readJsonlRecords({
      vaultRoot, relativePath: path.join("ledger/events", file),
    })));
    return events.flat() as Array<{
      dayKey?: string;
      externalRef?: { facet?: string; resourceId?: string; resourceType?: string };
      id?: string;
      lifecycle?: { revision?: number };
      metric?: string;
      workout?: { metrics?: Record<string, unknown> };
    }>;
  };
  const requests: string[] = [];
  let seeding = true;
  const provider = createJunctionProvider(async (request) => {
    const url = new URL(readUrl(request));
    const resource = /^\/v2\/summary\/([a-z_]+)\//u.exec(url.pathname)?.[1];
    requests.push(resource
      ? `${resource} ${url.searchParams.get("start_date")} ${url.searchParams.get("end_date")}`
      : url.pathname);
    if (url.pathname.includes("/user/providers/")) {
      return createJsonResponse({ providers: [{
        id: "synthetic-provider", name: "Garmin", slug: "garmin", status: "connected",
        resource_availability: {},
      }] });
    }
    if (resource && HISTORY_SUMMARY_SERIALIZERS[resource]) {
      const fixture = SUMMARY_FIXTURES[resource]!;
      const start = url.searchParams.get("start_date")!.slice(0, 10);
      const end = url.searchParams.get("end_date")!.slice(0, 10);
      return createJsonResponse({
        [Object.keys(fixture.response({}) as object)[0]!]:
          (resource === "workouts"
            ? HISTORY_WORKOUT_DAYS
            // The re-read also fetches the activity a webhook already delivered whole.
            : resource === "activity" && !seeding
              ? [...HISTORY_FETCHED_DAYS, HISTORY_WEBHOOK_DAY]
              : HISTORY_FETCHED_DAYS)
            .filter((day) => historyDate(day) >= start && historyDate(day) <= end)
            .map((day) => onHistoryDay(fixture.record, day)),
      });
    }
    if (url.pathname.startsWith("/v2/timeseries/")) {
      return createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }, {
    summaryBackfillDays: 13,
    summaryResources: Object.keys(HISTORY_SUMMARY_SERIALIZERS),
    timeseriesResources: ["blood_oxygen", "hrv", "respiratory_rate", "steps", "weight", "fat"],
  });
  const schedule = (metadata: Record<string, unknown>) => provider.jobExecutor!.createScheduledJobs!(
    createStoredAccount({ connectedAt: HISTORY_CONNECTED_AT, metadata }),
    HISTORY_NOW,
  ).jobs.filter((job) => job.kind === "backfill");
  const runBackfill = async (
    metadata: Record<string, unknown>,
    sink: (snapshot: JunctionSnapshotInput) => Promise<unknown>,
  ) => {
    const [job] = schedule(metadata);
    assert.ok(job, "the connect-window backfill should be due");
    assert.deepEqual(job.payload, HISTORY_WINDOW);
    const result = await executeJunctionJob(provider, createJunctionJobContext({
      account: createAccount({ connectedAt: HISTORY_CONNECTED_AT, metadata }),
      now: HISTORY_NOW,
      vaultTimeZone: VAULT_TIME_ZONE,
      importSnapshot: async (snapshot) => {
        await sink(JSON.parse(JSON.stringify(snapshot)) as JunctionSnapshotInput);
        return { imported: true };
      },
    }), createJobFromInput(job));
    return result;
  };
  // What the last generation left behind: its terminal status and the
  // temporal sweep marker the reconcile owns.
  const settled = {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: HISTORY_WINDOW.windowStart,
    junctionHistoricalBackfillWindowEnd: HISTORY_WINDOW.windowEnd,
    junctionTemporalSweepV1: "the-reconcile-owned-sweep-marker",
  };

  try {
    await runBackfill(settled, importDroppingFields);
    const [webhookDay] = await importResource({
      category: "summary", resource: "activity",
      inlineRecord: onHistoryDay(SUMMARY_FIXTURES.activity!.record, HISTORY_WEBHOOK_DAY),
    });
    assert.ok(webhookDay);
    await importSnapshot(webhookDay);
    const before = await readLedger();
    const fetchedBefore = before.filter((event) => event.dayKey !== historyDate(HISTORY_WEBHOOK_DAY));
    for (const metric of ["resting-heart-rate", "active-calories", "hrv", "bmi"]) {
      assert.equal(fetchedBefore.some((event) => event.metric === metric), false, metric);
    }
    assert.equal(before.filter((event) => event.workout).length, HISTORY_WORKOUT_DAYS.length);

    requests.length = 0;
    seeding = false;
    const repair = await runBackfill(settled, importSnapshot);
    // One job reads each summary over the connect window, then on to the
    // reconcile window in spans no longer than the backfill's own. It reads
    // no timeseries and queues none: not the bounded window, not a sweep.
    assert.deepEqual(requests, [
      "/v2/user/providers/junction-user-1",
      ...[
        ["2026-04-01T00:00:00.000Z", "2026-04-14T00:00:00.000Z"],
        ["2026-04-14T00:00:00.000Z", "2026-04-27T00:00:00.000Z"],
        ["2026-04-27T00:00:00.000Z", "2026-05-10T00:00:00.000Z"],
        ["2026-05-10T00:00:00.000Z", "2026-05-13T12:00:00.000Z"],
      ].flatMap(([start, end]) => Object.keys(HISTORY_SUMMARY_SERIALIZERS).map(
        // Sleep cycles are queried by calendar date, with an inclusive end.
        (resource) => resource === "sleep_cycle"
          ? `${resource} ${start!.slice(0, 10)} ${new Date(Date.parse(end!) - 1).toISOString().slice(0, 10)}`
          : `${resource} ${start} ${end}`,
      )),
    ]);
    assert.deepEqual(repair.scheduledJobs ?? [], []);
    assert.equal(repair.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v4_complete");
    assert.equal("junctionTemporalSweepV1" in (repair.metadataPatch ?? {}), false);
    assert.deepEqual(schedule({ ...settled, ...repair.metadataPatch }), [], "the re-read runs once");

    const repaired = await readLedger();
    const identities = repaired.filter((event) => !event.workout).map((event) => JSON.stringify([
      event.externalRef?.resourceType, event.externalRef?.resourceId, event.externalRef?.facet,
    ]));
    assert.equal(new Set(identities).size, identities.length, "no record is stored twice");
    assert.deepEqual(
      repaired.filter((event) => event.dayKey === historyDate(HISTORY_WEBHOOK_DAY)),
      before.filter((event) => event.dayKey === historyDate(HISTORY_WEBHOOK_DAY)),
      "a day already whole gains no event when it is fetched again",
    );
    // Per fetched day: seven activity facts, five sleep facts and BMI.
    assert.equal(
      identities.length,
      before.filter((event) => !event.workout).length + HISTORY_FETCHED_DAYS.length * 13,
    );
    for (const [metric, perDay] of [
      ["active-calories", 1], ["total-calories", 1], ["walking-average-heart-rate", 1],
      ["hrv", 1], ["bmi", 1],
    ] as const) {
      assert.equal(
        repaired.filter((event) => event.metric === metric
          && event.dayKey !== historyDate(HISTORY_WEBHOOK_DAY)).length,
        HISTORY_FETCHED_DAYS.length * perDay,
        metric,
      );
    }
    // Each stored workout gains its heart rate as one new revision of the same event.
    const workouts = repaired.filter((event) => event.workout);
    assert.equal(new Set(workouts.map((event) => event.id)).size, HISTORY_WORKOUT_DAYS.length);
    assert.deepEqual(
      workouts.map((event) => event.lifecycle?.revision ?? 1).sort(),
      HISTORY_WORKOUT_DAYS.flatMap(() => [1, 2]).sort(),
    );
    assert.equal(
      workouts.filter((event) => event.workout?.metrics?.averageHeartRate === 141).length,
      HISTORY_WORKOUT_DAYS.length,
    );

    // The same re-read again changes no file in the vault. A late webhook for
    // one of its days stores that delivery's raw payload and no event.
    const vault = await hashVaultTree(vaultRoot);
    await runBackfill(settled, importSnapshot);
    assert.deepEqual(await hashVaultTree(vaultRoot), vault);
    const [lateWebhook] = await importResource({
      category: "summary", resource: "activity",
      inlineRecord: onHistoryDay(SUMMARY_FIXTURES.activity!.record, 5),
    });
    assert.ok(lateWebhook);
    await importSnapshot(lateWebhook);
    assert.deepEqual(await readLedger(), repaired);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

// Before sessions were keyed on their id, a night's stage minutes were keyed
// on its window, so every summary a source sent for that window wrote one
// record. A source can send two summaries for one night under different
// session ids. The re-read now names both sessions against that one record.
test("a re-read finishes when a source sends two sessions for a window the vault holds as one", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-history-shared-window");
  const coreRuntime = await import("@murphai/core");
  await initializeVault({ vaultRoot });
  const night = onHistoryDay(SUMMARY_FIXTURES.sleep!.record, 3);
  const { id: _id, ...nightWithoutSession } = night;
  let sleeps: Record<string, unknown>[] = [nightWithoutSession];
  const provider = createJunctionProvider(async (request) => {
    const url = new URL(readUrl(request));
    if (url.pathname.includes("/user/providers/")) {
      return createJsonResponse({ providers: [{
        id: "synthetic-provider", name: "Garmin", slug: "garmin", status: "connected",
        resource_availability: {},
      }] });
    }
    if (url.pathname.startsWith("/v2/summary/sleep/")) {
      const start = url.searchParams.get("start_date")!.slice(0, 10);
      const end = url.searchParams.get("end_date")!.slice(0, 10);
      return createJsonResponse({
        sleep: historyDate(3) >= start && historyDate(3) <= end ? sleeps : [],
      });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }, { summaryBackfillDays: 13, summaryResources: ["sleep"], timeseriesResources: [] });
  const settled = {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillWindowStart: HISTORY_WINDOW.windowStart,
    junctionHistoricalBackfillWindowEnd: HISTORY_WINDOW.windowEnd,
  };
  const runReread = async () => {
    const [job] = provider.jobExecutor!.createScheduledJobs!(
      createStoredAccount({ connectedAt: HISTORY_CONNECTED_AT, metadata: settled }),
      HISTORY_NOW,
    ).jobs.filter((candidate) => candidate.kind === "backfill");
    assert.ok(job, "a settled window under an older generation is re-read");
    return await executeJunctionJob(provider, createJunctionJobContext({
      account: createAccount({ connectedAt: HISTORY_CONNECTED_AT, metadata: settled }),
      now: HISTORY_NOW,
      vaultTimeZone: VAULT_TIME_ZONE,
      importSnapshot: async (snapshot) => {
        await importDeviceProviderSnapshot({
          vaultRoot, provider: "junction", snapshot: JSON.parse(JSON.stringify(snapshot)),
        }, { corePort: coreRuntime });
        return { imported: true };
      },
    }), createJobFromInput(job));
  };
  const readDeepSleep = async () => (await readJsonlRecords({
    vaultRoot, relativePath: "ledger/events/2026/2026-04.jsonl",
  }) as Array<{ externalRef?: { resourceId?: string }; id?: string; metric?: string; value?: number }>)
    .filter((event) => event.metric === "sleep-deep-minutes");

  try {
    // What the vault holds for the night from before the change.
    await runReread();
    const [stored] = await readDeepSleep();
    assert.ok(stored?.externalRef?.resourceId?.startsWith("sleep-stage-"));

    sleeps = [night, { ...night, id: "22222222-2222-4222-8222-2222222222ff", deep: 5400 }];
    const reread = await runReread();
    assert.equal(reread.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v4_complete");

    // One session takes the stored record over; the other starts its own.
    const latest = new Map((await readDeepSleep()).map((event) => [event.id, event]));
    assert.deepEqual(
      [...latest.values()].map((event) => [event.id === stored.id, event.value]).sort(),
      [[false, 90], [true, 100]],
    );
    for (const event of latest.values()) {
      assert.ok(event.externalRef?.resourceId?.startsWith("sleep-session-"));
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
