import {
  createAccount,
  createConnectionSource,
  createJob,
  createJobFromInput,
  createJunctionJobContext,
  createJunctionProvider,
  executeJunctionJob,
} from "./junction-provider.harness.ts";

import assert from "node:assert/strict";
import { test } from "vitest";
import { createJsonResponse, readUrl, requireValue } from "./helpers.ts";
import type {
  DeviceSyncJobInput,
  ProviderJobResult,
} from "../src/types.ts";

const DAY_MS = 24 * 60 * 60_000;
const HISTORICAL_RESOURCE_JOB_MAX_OWNER_UNITS = 16;
const HISTORICAL_FLOORS_EVENT = "historical.data.floors_climbed.created";
const HISTORICAL_MINDFULNESS_EVENT = "historical.data.mindfulness_minutes.created";

function buildUtcDayKeys(windowStart: string, windowEnd: string): string[] {
  const dayKeys: string[] = [];
  for (
    let cursor = Date.parse(windowStart);
    cursor < Date.parse(windowEnd);
    cursor += DAY_MS
  ) {
    dayKeys.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dayKeys;
}

function createHistoricalSource(resource: string) {
  return {
    ...createConnectionSource({
      firstSeenAt: "2025-01-01T00:00:00.000Z",
      resourceAvailabilitySummary: { [resource]: true },
    }),
    resourceCount: 1,
  };
}

function createHistoricalProviderConnection(resource: string) {
  return {
    id: "provider-garmin-1",
    name: "Garmin",
    resource_availability: { [resource]: true },
    slug: "garmin",
    status: "connected",
  };
}

function readHistoricalContinuation(
  result: ProviderJobResult,
  eventType: string,
): DeviceSyncJobInput | null {
  const continuations = (result.scheduledJobs ?? []).filter((job) =>
    job.kind === "resource"
    && job.payload?.eventType === eventType
    && job.payload?.calendarRefreshDay === undefined
  );
  assert.ok(continuations.length <= 1, "historical work should return at most one suffix");
  return continuations[0] ?? null;
}

function readCalendarRefreshDays(result: ProviderJobResult, resource: string): string[] {
  return (result.scheduledJobs ?? []).flatMap((job) => {
    const dayKey = job.payload?.calendarRefreshDay;
    if (typeof dayKey !== "string") {
      return [];
    }
    assert.equal(job.kind, "resource");
    assert.equal(job.payload?.resource, resource);
    assert.equal(job.payload?.sourceProviderSlug, "garmin");
    return [dayKey];
  });
}

test("Junction cheap 365-day dense history advances in bounded multi-day suffixes", async () => {
  const windowStart = "2025-04-03T00:00:00.000Z";
  const windowEnd = "2026-04-03T00:00:00.000Z";
  const expectedDays = buildUtcDayKeys(windowStart, windowEnd);
  assert.equal(expectedDays.length, 365);

  const requestedDays: string[] = [];
  const importedDays: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [createHistoricalProviderConnection("floors_climbed")],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/floors_climbed/grouped") {
      const dayKey = requireValue(
        url.searchParams.get("start_date"),
        "dense history start date",
      );
      assert.equal(dayKey, url.searchParams.get("end_date"));
      requestedDays.push(dayKey);
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              end: `${dayKey}T10:00:00.000Z`,
              start: `${dayKey}T09:00:00.000Z`,
              unit: "count",
              value: 1,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["floors_climbed"],
  });
  const source = createHistoricalSource("floors_climbed");
  const context = createJunctionJobContext({
    account: createAccount({ sources: [source] }),
    connectionSourceAdmissionMode: "listed_only",
    importSnapshot: async (snapshot) => {
      const window = snapshot as { windowStart?: string };
      importedDays.push(requireValue(window.windowStart, "dense import window").slice(0, 10));
      return { canonicalEventCount: 1, durableDeliveryAccepted: true };
    },
    now: "2026-04-04T12:00:00.000Z",
  });

  let job = createJob("resource", {
    eventType: HISTORICAL_FLOORS_EVENT,
    resource: "floors_climbed",
    resourceCategory: "timeseries",
    sourceProviderSlug: "garmin",
    windowEnd,
    windowStart,
  });
  const claimOwnerCounts: number[] = [];
  const continuationStarts: string[] = [];
  let claimIndex = 0;

  while (true) {
    const requestsBeforeClaim = requestedDays.length;
    const importsBeforeClaim = importedDays.length;
    const result = await executeJunctionJob(provider, context, job);
    const ownerCount = requestedDays.length - requestsBeforeClaim;
    claimOwnerCounts.push(ownerCount);
    assert.ok(ownerCount > 0);
    assert.ok(ownerCount <= HISTORICAL_RESOURCE_JOB_MAX_OWNER_UNITS);
    assert.equal(importedDays.length - importsBeforeClaim, ownerCount);

    const continuation = readHistoricalContinuation(result, HISTORICAL_FLOORS_EVENT);
    if (!continuation) {
      break;
    }
    const expectedSuffixStart = requireValue(
      expectedDays[requestedDays.length],
      "dense continuation suffix",
    );
    assert.equal(continuation.payload?.windowStart, `${expectedSuffixStart}T00:00:00.000Z`);
    assert.equal(continuation.payload?.windowEnd, windowEnd);
    continuationStarts.push(requireValue(
      continuation.payload?.windowStart as string | undefined,
      "dense continuation start",
    ));
    claimIndex += 1;
    job = createJobFromInput(continuation, claimIndex);
  }

  assert.equal(claimOwnerCounts[0], HISTORICAL_RESOURCE_JOB_MAX_OWNER_UNITS);
  assert.ok(claimOwnerCounts[0]! > 1);
  assert.equal(
    claimOwnerCounts.length,
    Math.ceil(expectedDays.length / HISTORICAL_RESOURCE_JOB_MAX_OWNER_UNITS),
  );
  assert.ok(claimOwnerCounts.length < expectedDays.length);
  assert.deepEqual(requestedDays, expectedDays);
  assert.deepEqual(importedDays, expectedDays);
  assert.equal(new Set(requestedDays).size, expectedDays.length);
  assert.equal(new Set(importedDays).size, expectedDays.length);
  assert.equal(new Set(continuationStarts).size, continuationStarts.length);
});

test("Junction multi-page sparse history obeys the same owner bound and preserves exact calendar work", async () => {
  const windowStart = "2026-01-01T00:00:00.000Z";
  const windowEnd = "2026-02-10T00:00:00.000Z";
  const expectedDays = buildUtcDayKeys(windowStart, windowEnd);
  assert.equal(expectedDays.length, 40);

  const pagesByDay = new Map<string, number>();
  const ownerDays: string[] = [];
  let rawTimeseriesRequests = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [createHistoricalProviderConnection("mindfulness_minutes")],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/mindfulness_minutes/grouped") {
      rawTimeseriesRequests += 1;
      const dayKey = requireValue(
        url.searchParams.get("start_date"),
        "sparse history start date",
      ).slice(0, 10);
      const page = (pagesByDay.get(dayKey) ?? 0) + 1;
      assert.ok(page <= 3, `sparse owner ${dayKey} should not replay`);
      pagesByDay.set(dayKey, page);
      if (page === 1) {
        ownerDays.push(dayKey);
      }
      return createJsonResponse({
        groups: page === 1
          ? {
              garmin: [{
                data: [{
                  end: `${dayKey}T08:05:00.000Z`,
                  sampleId: `mindfulness-${dayKey}`,
                  mindfulnessMinutes: 5,
                  start: `${dayKey}T08:00:00.000Z`,
                }],
                source: { provider: "garmin", type: "watch" },
              }],
            }
          : {},
        ...(page < 3 ? { next_cursor: `${dayKey}-page-${page + 1}` } : {}),
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["mindfulness_minutes"],
  });
  const source = createHistoricalSource("mindfulness_minutes");
  const importedDayBatches: string[][] = [];
  const context = createJunctionJobContext({
    account: createAccount({ sources: [source] }),
    connectionSourceAdmissionMode: "listed_only",
    importSnapshot: async (snapshot) => {
      const records = (snapshot as {
        timeseries?: { mindfulness_minutes?: Array<{ start?: string }> };
      }).timeseries?.mindfulness_minutes ?? [];
      const dayKeys = records.map((record) =>
        requireValue(record.start, "accepted mindfulness timestamp").slice(0, 10)
      );
      importedDayBatches.push(dayKeys);
      return {
        canonicalEventCount: records.length,
        canonicalEventDayKeys: dayKeys,
        canonicalSparseCalendarTargets: dayKeys.map((dayKey) => ({
          dayKey,
          sourceProviderSlug: "garmin",
          sourceType: "watch",
        })),
        durableDeliveryAccepted: true,
      };
    },
    now: "2026-04-04T12:00:00.000Z",
  });

  let job = createJob("resource", {
    eventType: HISTORICAL_MINDFULNESS_EVENT,
    resource: "mindfulness_minutes",
    resourceCategory: "timeseries",
    sourceProviderSlug: "garmin",
    windowEnd,
    windowStart,
  });
  const claimOwnerCounts: number[] = [];
  const calendarRefreshDays: string[] = [];
  let claimIndex = 0;

  while (true) {
    const ownersBeforeClaim = ownerDays.length;
    const requestsBeforeClaim = rawTimeseriesRequests;
    const importBatchesBeforeClaim = importedDayBatches.length;
    const result = await executeJunctionJob(provider, context, job);
    const ownerCount = ownerDays.length - ownersBeforeClaim;
    const requestCount = rawTimeseriesRequests - requestsBeforeClaim;
    const claimCalendarRefreshDays = readCalendarRefreshDays(
      result,
      "mindfulness_minutes",
    );
    claimOwnerCounts.push(ownerCount);
    calendarRefreshDays.push(...claimCalendarRefreshDays);
    assert.ok(ownerCount > 0);
    assert.ok(ownerCount <= HISTORICAL_RESOURCE_JOB_MAX_OWNER_UNITS);
    assert.equal(requestCount, ownerCount * 3);
    assert.equal(importedDayBatches.length - importBatchesBeforeClaim, 1);
    assert.equal(claimCalendarRefreshDays.length, ownerCount);
    assert.ok(
      requestCount <= HISTORICAL_RESOURCE_JOB_MAX_OWNER_UNITS * 3,
      "one sparse claim should retain the composed page bound",
    );

    const continuation = readHistoricalContinuation(result, HISTORICAL_MINDFULNESS_EVENT);
    if (!continuation) {
      break;
    }
    const expectedSuffixStart = requireValue(
      expectedDays[ownerDays.length],
      "sparse continuation suffix",
    );
    assert.equal(continuation.payload?.windowStart, `${expectedSuffixStart}T00:00:00.000Z`);
    assert.equal(continuation.payload?.windowEnd, windowEnd);
    claimIndex += 1;
    job = createJobFromInput(continuation, claimIndex);
  }

  assert.equal(claimOwnerCounts[0], HISTORICAL_RESOURCE_JOB_MAX_OWNER_UNITS);
  assert.equal(
    claimOwnerCounts.length,
    Math.ceil(expectedDays.length / HISTORICAL_RESOURCE_JOB_MAX_OWNER_UNITS),
  );
  assert.deepEqual(ownerDays, expectedDays);
  assert.deepEqual(importedDayBatches.flat(), expectedDays);
  assert.deepEqual(calendarRefreshDays, expectedDays);
  assert.equal(new Set(ownerDays).size, expectedDays.length);
  assert.equal(new Set(calendarRefreshDays).size, expectedDays.length);
  assert.equal(rawTimeseriesRequests, expectedDays.length * 3);
});

test("Junction historical foreground yield remains earlier than the owner budget", async () => {
  const windowStart = "2026-03-01T00:00:00.000Z";
  const windowEnd = "2026-03-11T00:00:00.000Z";
  const expectedDays = buildUtcDayKeys(windowStart, windowEnd);
  const ownerDays: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [createHistoricalProviderConnection("mindfulness_minutes")],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/mindfulness_minutes/grouped") {
      const dayKey = requireValue(
        url.searchParams.get("start_date"),
        "foreground-yield history start date",
      ).slice(0, 10);
      ownerDays.push(dayKey);
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              end: `${dayKey}T08:05:00.000Z`,
              sampleId: `mindfulness-${dayKey}`,
              mindfulnessMinutes: 5,
              start: `${dayKey}T08:00:00.000Z`,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["mindfulness_minutes"],
  });
  const source = createHistoricalSource("mindfulness_minutes");
  const acceptedDays: string[] = [];
  const context = createJunctionJobContext({
    account: createAccount({ sources: [source] }),
    connectionSourceAdmissionMode: "listed_only",
    importSnapshot: async (snapshot) => {
      const records = (snapshot as {
        timeseries?: { mindfulness_minutes?: Array<{ start?: string }> };
      }).timeseries?.mindfulness_minutes ?? [];
      const dayKeys = records.map((record) =>
        requireValue(record.start, "foreground-yield accepted timestamp").slice(0, 10)
      );
      acceptedDays.push(...dayKeys);
      return {
        canonicalEventCount: records.length,
        canonicalEventDayKeys: dayKeys,
        canonicalSparseCalendarTargets: dayKeys.map((dayKey) => ({
          dayKey,
          sourceProviderSlug: "garmin",
          sourceType: "watch",
        })),
        durableDeliveryAccepted: true,
      };
    },
    now: "2026-04-04T12:00:00.000Z",
    shouldYield: () => ownerDays.length >= 3,
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      eventType: HISTORICAL_MINDFULNESS_EVENT,
      resource: "mindfulness_minutes",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      windowEnd,
      windowStart,
    }),
  );
  const continuation = requireValue(
    readHistoricalContinuation(result, HISTORICAL_MINDFULNESS_EVENT),
    "foreground yield should persist the unprocessed suffix",
  );

  const expectedSuffixStart = requireValue(
    expectedDays[3],
    "foreground-yield continuation suffix",
  );
  assert.deepEqual(ownerDays, expectedDays.slice(0, 3));
  assert.deepEqual(acceptedDays, expectedDays.slice(0, 3));
  assert.deepEqual(
    readCalendarRefreshDays(result, "mindfulness_minutes"),
    expectedDays.slice(0, 3),
  );
  assert.equal(continuation.payload?.windowStart, `${expectedSuffixStart}T00:00:00.000Z`);
  assert.equal(continuation.payload?.windowEnd, windowEnd);
  assert.ok(ownerDays.length < HISTORICAL_RESOURCE_JOB_MAX_OWNER_UNITS);
});
