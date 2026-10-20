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
import { test, vi } from "vitest";
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
      const window = snapshot as { windowEnd?: string; windowStart?: string };
      // One import may commit several consecutive closed days.
      for (
        let day = Date.parse(requireValue(window.windowStart, "dense import window"));
        day < Date.parse(requireValue(window.windowEnd, "dense import window end"));
        day += 86_400_000
      ) {
        importedDays.push(new Date(day).toISOString().slice(0, 10));
      }
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

test.each([
  { resource: "floors_climbed", yieldImmediately: false, dayCount: 16 },
  { resource: "floors_climbed", yieldImmediately: true, dayCount: 1 },
  { resource: "mindfulness_minutes", yieldImmediately: false, dayCount: 16 },
  { resource: "mindfulness_minutes", yieldImmediately: true, dayCount: 0 },
])("Junction credits only forward empty-history coverage: $resource, yield $yieldImmediately", async ({ resource, yieldImmediately, dayCount }) => {
  const requestedDays: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [createHistoricalProviderConnection(resource)] });
    }
    if (url.pathname === `/v2/timeseries/junction-user-1/${resource}/grouped`) {
      requestedDays.push(requireValue(url.searchParams.get("start_date"), "requested date"));
      return createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }, { summaryResources: [], timeseriesResources: [resource] });
  const context = createJunctionJobContext({
    account: createAccount({ sources: [createHistoricalSource(resource)] }),
    connectionSourceAdmissionMode: "listed_only",
    now: "2026-04-04T12:00:00.000Z",
    importSnapshot: async () => { throw new Error("Empty history must not import records"); },
    shouldYield: () => yieldImmediately,
  });
  const job = createJob("resource", {
    eventType: `historical.data.${resource}.created`,
    resource,
    resourceCategory: "timeseries",
    sourceProviderSlug: "garmin",
    windowStart: "2026-03-01T00:00:00.000Z",
    windowEnd: "2026-04-01T00:00:00.000Z",
  });
  const result = await executeJunctionJob(provider, context, job);
  assert.equal(requestedDays.length, dayCount);
  const continuation = requireValue(readHistoricalContinuation(result, `historical.data.${resource}.created`), "suffix");
  assert.equal(continuation.payload?.windowStart,
    new Date(Date.parse("2026-03-01T00:00:00.000Z") + dayCount * DAY_MS).toISOString());
  assert.equal(continuation.payload?.windowEnd, job.payload.windowEnd);
  assert.equal(Object.hasOwn(result, "continuationProgress"), dayCount > 0);
});

test("overlapping Garmin pull windows import identical days with 150 versus 42 fetches", async () => {
  const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset)).toISOString();
  async function replay(windows: readonly { start: number; end: number }[]) {
    const requestedDays: string[] = [];
    // Imported records by day: batch boundaries differ, day content must not.
    const imports = new Map<string, unknown>();
    let importCalls = 0;
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [createHistoricalProviderConnection("steps")] });
      }
      assert.equal(url.pathname, "/v2/timeseries/junction-user-1/steps/grouped");
      const dayKey = requireValue(url.searchParams.get("start_date"), "fetch day");
      assert.equal(dayKey, url.searchParams.get("end_date"));
      requestedDays.push(dayKey);
      return createJsonResponse({ groups: { garmin: [{
        data: [{ start: `${dayKey}T09:00:00.000Z`, end: `${dayKey}T10:00:00.000Z`, unit: "count", value: 100 }],
        source: { provider: "garmin", type: "watch" },
      }] } });
    }, { summaryResources: [], timeseriesResources: ["steps"] });
    const context = createJunctionJobContext({
      account: createAccount({ sources: [createHistoricalSource("steps")] }),
      connectionSourceAdmissionMode: "listed_only",
      now: "2026-04-04T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importCalls += 1;
        for (const record of (snapshot as { timeseries: { steps: { start: string }[] } }).timeseries.steps) {
          imports.set(record.start.slice(0, 10), record);
        }
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
    });
    for (const window of windows) {
      await executeJunctionJob(provider, context, createJob("resource", {
        eventType: "daily.data.steps.created", resource: "steps", resourceCategory: "timeseries",
        sourceProviderSlug: "garmin", windowStart: day(window.start), windowEnd: day(window.end),
      }));
    }
    return { requestedDays, imports, importCalls };
  }
  const original = await replay(Array.from({ length: 5 }, (_, index) => ({ start: index * 3, end: 30 + index * 3 })));
  const coalesced = await replay([{ start: 0, end: 42 }]);
  assert.equal(original.requestedDays.length, 150);
  assert.equal(coalesced.requestedDays.length, 42);
  assert.deepEqual(new Set(coalesced.requestedDays), new Set(original.requestedDays));
  assert.equal(coalesced.imports.size, 42);
  assert.deepEqual(coalesced.imports, original.imports);
  assert.equal(coalesced.importCalls, 7, "the first day commits alone, then 41 days in eight-day batches");
});

test("slow successful historical reads commit before a pass deadline and resume without re-reading committed days", async () => {
  // Each closed day reads successfully but slowly. A pass deadline aborts the
  // job mid-range; the service then rejects writes, as production does.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-04-04T12:00:00.000Z"));
  try {
    const windowStart = "2026-03-01T00:00:00.000Z";
    const windowEnd = "2026-03-17T00:00:00.000Z";
    const expectedDays = buildUtcDayKeys(windowStart, windowEnd);
    const requestedDays: string[] = [];
    const importedDays: string[] = [];
    let pass: AbortController = new AbortController();
    let abortAfterReads = 3;
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [createHistoricalProviderConnection("floors_climbed")] });
      }
      assert.equal(url.pathname, "/v2/timeseries/junction-user-1/floors_climbed/grouped");
      pass.signal.throwIfAborted();
      const dayKey = requireValue(url.searchParams.get("start_date"), "slow history day");
      requestedDays.push(dayKey);
      vi.setSystemTime(Date.now() + 6_000);
      abortAfterReads -= 1;
      if (abortAfterReads === 0) pass.abort(new Error("synthetic pass deadline"));
      return createJsonResponse({ groups: { garmin: [{
        data: [{ end: `${dayKey}T10:00:00.000Z`, start: `${dayKey}T09:00:00.000Z`, unit: "count", value: 1 }],
        source: { provider: "garmin", type: "watch" },
      }] } });
    }, { summaryResources: [], timeseriesResources: ["floors_climbed"] });
    const createContext = () => createJunctionJobContext({
      account: createAccount({ sources: [createHistoricalSource("floors_climbed")] }),
      connectionSourceAdmissionMode: "listed_only",
      importSnapshot: async (snapshot) => {
        // Production rejects writes once the job has yielded or aborted.
        pass.signal.throwIfAborted();
        const window = snapshot as { windowEnd: string; windowStart: string };
        importedDays.push(...buildUtcDayKeys(window.windowStart, window.windowEnd));
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
      now: "2026-04-04T12:00:00.000Z",
      shouldYield: () => pass.signal.aborted,
      signal: pass.signal,
      throwIfAborted: () => pass.signal.throwIfAborted(),
    });

    let job = createJob("resource", {
      eventType: HISTORICAL_FLOORS_EVENT,
      resource: "floors_climbed",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      windowEnd,
      windowStart,
    });
    const continuationStarts: string[] = [];
    for (let claim = 0; claim < 10; claim += 1) {
      const result = await executeJunctionJob(provider, createContext(), job);
      const continuation = readHistoricalContinuation(result, HISTORICAL_FLOORS_EVENT);
      if (!continuation) break;
      continuationStarts.push(requireValue(continuation.payload?.windowStart as string | undefined, "resume day"));
      pass = new AbortController();
      abortAfterReads = 3;
      job = createJobFromInput(continuation, claim + 1);
    }

    // Each six-second read exceeds the batching budget, so the two days read
    // before the deadline commit; the day whose write the abort rejects resumes.
    assert.equal(continuationStarts[0], `${expectedDays[2]}T00:00:00.000Z`);
    assert.deepEqual(importedDays, expectedDays, "every day lands exactly once, in order");
    const readCounts = new Map<string, number>();
    for (const day of requestedDays) readCounts.set(day, (readCounts.get(day) ?? 0) + 1);
    assert.ok([...readCounts.values()].every((count) => count <= 2));
    for (const [index, start] of continuationStarts.entries()) {
      // A resumed pass never re-reads a day committed before its continuation.
      const committedBefore = expectedDays.slice(0, expectedDays.indexOf(start.slice(0, 10)));
      const readsAfterResume = requestedDays.slice(3 * (index + 1));
      assert.ok(committedBefore.every((day) => !readsAfterResume.includes(day)));
    }
  } finally {
    vi.useRealTimers();
  }
});

test("a fast first day commits before a slow paginated day can exhaust the pass", async () => {
  // Day one reads in four seconds, day two in 297; a pass ends at 300 seconds
  // of reads and the service then rejects writes, as production does.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-04-04T12:00:00.000Z"));
  try {
    const windowStart = "2026-03-01T00:00:00.000Z";
    const windowEnd = "2026-03-03T00:00:00.000Z";
    const [firstDay, secondDay] = buildUtcDayKeys(windowStart, windowEnd);
    const readSeconds = new Map([[firstDay, 4], [secondDay, 297]]);
    const requestedDays: string[] = [];
    const importedDays: string[] = [];
    let pass = new AbortController();
    let passSeconds = 0;
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [createHistoricalProviderConnection("floors_climbed")] });
      }
      pass.signal.throwIfAborted();
      const dayKey = requireValue(url.searchParams.get("start_date"), "paginated history day");
      requestedDays.push(dayKey);
      const seconds = requireValue(readSeconds.get(dayKey), "read duration");
      vi.setSystemTime(Date.now() + seconds * 1_000);
      passSeconds += seconds;
      if (passSeconds >= 300) pass.abort(new Error("synthetic pass deadline"));
      return createJsonResponse({ groups: { garmin: [{
        data: [{ end: `${dayKey}T10:00:00.000Z`, start: `${dayKey}T09:00:00.000Z`, unit: "count", value: 1 }],
        source: { provider: "garmin", type: "watch" },
      }] } });
    }, { summaryResources: [], timeseriesResources: ["floors_climbed"] });
    const runPass = (job: ReturnType<typeof createJob>) => executeJunctionJob(provider, createJunctionJobContext({
      account: createAccount({ sources: [createHistoricalSource("floors_climbed")] }),
      connectionSourceAdmissionMode: "listed_only",
      importSnapshot: async (snapshot) => {
        pass.signal.throwIfAborted();
        const window = snapshot as { windowEnd: string; windowStart: string };
        importedDays.push(...buildUtcDayKeys(window.windowStart, window.windowEnd));
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
      now: "2026-04-04T12:00:00.000Z",
      shouldYield: () => pass.signal.aborted,
      signal: pass.signal,
      throwIfAborted: () => pass.signal.throwIfAborted(),
    }), job);

    const first = await runPass(createJob("resource", {
      eventType: HISTORICAL_FLOORS_EVENT,
      resource: "floors_climbed",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      windowEnd,
      windowStart,
    }));
    const continuation = readHistoricalContinuation(first, HISTORICAL_FLOORS_EVENT);
    assert.equal(continuation?.payload?.windowStart, `${secondDay}T00:00:00.000Z`);
    assert.deepEqual(importedDays, [firstDay]);

    pass = new AbortController();
    passSeconds = 0;
    const second = await runPass(createJobFromInput(requireValue(continuation, "slow day continuation"), 1));
    assert.equal(readHistoricalContinuation(second, HISTORICAL_FLOORS_EVENT), null);
    assert.deepEqual(importedDays, [firstDay, secondDay]);
    assert.deepEqual(requestedDays, [firstDay, secondDay, secondDay], "the committed first day is not read again");
  } finally {
    vi.useRealTimers();
  }
});

