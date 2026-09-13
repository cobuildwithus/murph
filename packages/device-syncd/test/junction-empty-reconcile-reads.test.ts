import assert from "node:assert/strict";
import { test } from "vitest";
import { DeviceSyncError } from "../src/errors.ts";
import {
  createAccount,
  createConnectionSource,
  createJob,
  createJobFromInput,
  createJunctionJobContext,
  createJunctionProvider,
  executeJunctionJob,
} from "./junction-provider.harness.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";

function emptyReconcileFixture(options: {
  kind?: "backfill" | "reconcile";
  changeAtRequest?: number;
  omitSource?: boolean;
  failSourceRead?: boolean;
  nonemptyAtRequests?: readonly number[];
  yieldAfter?: number;
  windowStart?: string;
} = {}) {
  const originalSource = createConnectionSource({ lifecycleEpoch: 1 });
  let liveSource = originalSource;
  let requests = 0;
  let sourceReads = 0;
  let imports = 0;
  const provider = createJunctionProvider(async (input) => {
    requests += 1;
    const day = new URL(readUrl(input)).searchParams.get("start_date");
    assert.ok(day);
    if (requests === options.changeAtRequest) {
      liveSource = createConnectionSource({ lifecycleEpoch: 2 });
    }
    return createJsonResponse({
      groups: options.nonemptyAtRequests?.includes(requests)
        ? {
            garmin: [{
              data: [{
                end: `${day}T10:01:00.000Z`,
                id: `synthetic-heart-alert-${requests}`,
                start: `${day}T10:00:00.000Z`,
                type: "irregular_rhythm",
                unit: "count",
                value: 1,
              }],
              source: { provider: "garmin", type: "watch" },
            }],
          }
        : {},
    });
  }, { summaryResources: [], timeseriesResources: ["heart_rate_alert"] });
  const context = createJunctionJobContext({
    account: createAccount({ sources: [{ ...originalSource, resourceCount: 1 }] }),
    listConnectionSources: async () => {
      sourceReads += 1;
      if (options.failSourceRead) throw new Error("Synthetic source read unavailable");
      return options.omitSource ? [] : [liveSource];
    },
    importSnapshot: async () => { imports += 1; return { imported: true }; },
    shouldYield: () => requests >= (options.yieldAfter ?? Infinity),
  });
  const job = createJob(options.kind ?? "reconcile", {
    windowStart: options.windowStart ?? "2026-03-27T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
    timeseriesCursor: options.windowStart ?? "2026-03-27T00:00:00.000Z",
    timeseriesResourceCursor: "heart_rate_alert",
  });
  return {
    run: (nextJob = job) => executeJunctionJob(provider, context, nextJob),
    counts: () => ({ requests, sourceReads, imports }),
  };
}

test("empty daily reconcile checks source authority once for seven complete windows", async () => {
  const fixture = emptyReconcileFixture();
  const result = await fixture.run();
  assert.equal(result.scheduledJobs, undefined);
  assert.deepEqual(fixture.counts(), { requests: 7, sourceReads: 1, imports: 0 });
});

test.each([1, 4, 7])("empty reconcile rejects source reconnect at window %i before returning progress", async (changeAtRequest) => {
  const fixture = emptyReconcileFixture({ changeAtRequest });
  await assert.rejects(fixture.run, (error) => error instanceof DeviceSyncError
    && error.code === "JUNCTION_TIMESERIES_SOURCE_LIFECYCLE_SUPERSEDED"
    && error.retryable);
  assert.equal(fixture.counts().imports, 0);
});

test("empty reconcile rejects a removed source before returning progress", async () => {
  const fixture = emptyReconcileFixture({ omitSource: true });
  await assert.rejects(fixture.run, (error) => error instanceof DeviceSyncError
    && error.code === "JUNCTION_TIMESERIES_SOURCE_LIFECYCLE_SUPERSEDED");
  assert.equal(fixture.counts().imports, 0);
});

test("empty reconcile fails closed when its final source read is unavailable", async () => {
  const fixture = emptyReconcileFixture({ failSourceRead: true });
  await assert.rejects(fixture.run, /Synthetic source read unavailable/u);
});

test("empty reconcile validates before yielding its exact remaining suffix", async () => {
  const fixture = emptyReconcileFixture({ yieldAfter: 3 });
  const result = await fixture.run();
  assert.equal(result.scheduledJobs?.[0]?.payload?.timeseriesCursor, "2026-03-30T00:00:00.000Z");
  assert.deepEqual(fixture.counts(), { requests: 3, sourceReads: 1, imports: 0 });
});

test("empty reconcile rejects changed authority even when foreground work ends its batch", async () => {
  const fixture = emptyReconcileFixture({ changeAtRequest: 3, yieldAfter: 3 });
  await assert.rejects(fixture.run, (error) => error instanceof DeviceSyncError
    && error.code === "JUNCTION_TIMESERIES_SOURCE_LIFECYCLE_SUPERSEDED");
});

test("empty backfill keeps each existing source lifecycle check", async () => {
  const fixture = emptyReconcileFixture({ kind: "backfill" });
  await fixture.run();
  assert.deepEqual(fixture.counts(), { requests: 7, sourceReads: 7, imports: 0 });
});

test("nonempty windows keep fresh import authority inside an otherwise empty batch", async () => {
  const fixture = emptyReconcileFixture({ nonemptyAtRequests: [3] });
  await fixture.run();
  assert.deepEqual(fixture.counts(), { requests: 7, sourceReads: 2, imports: 1 });
});

test("a reconnect before a nonempty window blocks import immediately", async () => {
  const fixture = emptyReconcileFixture({ changeAtRequest: 3, nonemptyAtRequests: [3] });
  await assert.rejects(fixture.run, (error) => error instanceof DeviceSyncError
    && error.code === "JUNCTION_TIMESERIES_SOURCE_LIFECYCLE_SUPERSEDED");
  assert.deepEqual(fixture.counts(), { requests: 3, sourceReads: 1, imports: 0 });
});

test("nonempty reconciliation adds no deferred authority request", async () => {
  const fixture = emptyReconcileFixture({ nonemptyAtRequests: [1, 2, 3, 4, 5, 6, 7] });
  await fixture.run();
  assert.deepEqual(fixture.counts(), { requests: 7, sourceReads: 7, imports: 7 });
});

test("source authority is never reused across reconcile executions", async () => {
  const fixture = emptyReconcileFixture({ changeAtRequest: 8 });
  await fixture.run();
  await assert.rejects(fixture.run, (error) => error instanceof DeviceSyncError
    && error.code === "JUNCTION_TIMESERIES_SOURCE_LIFECYCLE_SUPERSEDED");
  assert.deepEqual(fixture.counts(), { requests: 14, sourceReads: 2, imports: 0 });
});

test("empty reconcile validates each bounded prefix and resumes the unchanged durable suffix", async () => {
  const fixture = emptyReconcileFixture({ windowStart: "2026-03-02T00:00:00.000Z" });
  const first = await fixture.run();
  const continuation = first.scheduledJobs?.[0];
  assert.ok(continuation);
  assert.equal(continuation.payload?.timeseriesCursor, "2026-03-18T00:00:00.000Z");
  assert.deepEqual(fixture.counts(), { requests: 16, sourceReads: 1, imports: 0 });
  const second = await fixture.run(createJobFromInput(JSON.parse(JSON.stringify(continuation))));
  assert.equal(second.scheduledJobs, undefined);
  assert.deepEqual(fixture.counts(), { requests: 32, sourceReads: 2, imports: 0 });
});
