import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { addDaysToIsoDate, CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import * as core from "@murphai/core";
import { timeCliDispatch, withCliTiming } from "@murphai/runtime-state/node/cli-timing";
import { afterEach, test, vi } from "vitest";

import {
  getQueryProjectionStatus,
  rebuildQueryProjection,
  summarizeWearableSleepPatternRuntime,
} from "../src/query-projection.ts";
import * as rebuild from "../src/projection/rebuild.ts";
import { currentQueryProjectionLocation } from "../src/projection/schema.ts";
import * as wearableStore from "../src/projection/wearable-summary-store.ts";
import * as vaultSource from "../src/vault-source.ts";
import type { WearableSleepPatternFilters, WearableSleepPatternSummary } from "../src/wearables.ts";

afterEach(() => vi.restoreAllMocks());

async function createSleepPatternVault(
  timeZone?: string,
  options: {
    includeFreshGenericHrv?: boolean;
    includeWhoop?: boolean;
    localizedDateMismatch?: boolean;
  } = {},
): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-sleep-pattern-"));
  await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });

  if (timeZone !== undefined) {
    await writeFile(
      path.join(vaultRoot, "vault.json"),
      `${JSON.stringify({
        createdAt: "2026-07-01T00:00:00.000Z",
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        timezone: timeZone,
        title: "Sleep pattern runtime fixture",
        vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      })}\n`,
      "utf8",
    );
  }

  const events: Array<Record<string, unknown>> = [{
    dayKey: options.localizedDateMismatch ? "2026-07-09" : "2026-07-10",
    durationMinutes: 480,
    endAt: options.localizedDateMismatch
      ? "2026-07-10T00:30:00.000Z"
      : "2026-07-10T11:00:00.000Z",
    externalRef: {
      resourceId: "sleep-runtime-2026-07-10",
      resourceType: "sleep",
      system: "oura",
    },
    id: "evt_sleep_pattern_runtime_01",
    kind: "sleep_session",
    occurredAt: options.localizedDateMismatch
      ? "2026-07-09T16:30:00.000Z"
      : "2026-07-10T03:00:00.000Z",
    recordedAt: options.localizedDateMismatch
      ? "2026-07-10T00:35:00.000Z"
      : "2026-07-10T11:05:00.000Z",
    schemaVersion: "murph.event.v1",
    sleepType: "main_sleep",
    source: "device",
    startAt: options.localizedDateMismatch
      ? "2026-07-09T16:30:00.000Z"
      : "2026-07-10T03:00:00.000Z",
    timeZone: options.localizedDateMismatch ? "Asia/Tokyo" : undefined,
    title: "Provider sleep session",
  }];
  if (options.includeWhoop) {
    events.push({
      dayKey: "2026-07-08",
      durationMinutes: 450,
      endAt: "2026-07-08T10:30:00.000Z",
      externalRef: {
        resourceId: "sleep-runtime-whoop-2026-07-08",
        resourceType: "sleep",
        system: "whoop",
      },
      id: "evt_sleep_pattern_runtime_02",
      kind: "sleep_session",
      occurredAt: "2026-07-08T03:00:00.000Z",
      recordedAt: "2026-07-08T10:35:00.000Z",
      schemaVersion: "murph.event.v1",
      sleepType: "main_sleep",
      source: "device",
      startAt: "2026-07-08T03:00:00.000Z",
      title: "Second provider sleep session",
    });
  }
  if (options.includeFreshGenericHrv) {
    events.push({
      dayKey: "2026-07-15",
      externalRef: {
        resourceId: "daily-hrv-2026-07-15",
        resourceType: "daily-summary",
        system: "oura",
      },
      id: "evt_sleep_pattern_runtime_hrv_01",
      kind: "observation",
      metric: "hrv",
      observationGrain: "daily-summary",
      occurredAt: "2026-07-15T12:00:00.000Z",
      recordedAt: "2026-07-15T12:05:00.000Z",
      schemaVersion: "murph.event.v1",
      source: "device",
      title: "Daily HRV",
      unit: "ms",
      value: 47,
    });
  }

  await writeFile(
    path.join(vaultRoot, "ledger/events/2026/2026-07.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );

  return vaultRoot;
}

test("sleep-pattern runtime uses validated vault metadata as the reporting-zone fallback", async () => {
  const vaultRoot = await createSleepPatternVault("America/New_York");

  try {
    await rebuildQueryProjection(vaultRoot);
    const summary = await summarizeWearableSleepPatternRuntime(vaultRoot, {
      date: "2026-07-10",
      now: "2026-07-11T12:00:00.000Z",
    });

    assert.equal(summary.reportingTimeZone, "America/New_York");
    assert.equal(summary.reportingTimeZoneSource, "vault_metadata");
    assert.equal(summary.reportingTimeZoneFallbackNightCount, 1);
    assert.equal(summary.timingOmittedNightCount, 0);
    assert.equal(summary.bedtime.medianLocalTime, "23:00");
    assert.equal(summary.wakeTime.medianLocalTime, "07:00");
    assert.equal(
      summary.notes.some((note) => note.includes("validated reporting-zone fallback")),
      true,
    );
    assert.equal(
      summary.notes.some((note) => note.includes("came from vault metadata")),
      true,
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("sleep-pattern runtime scopes both nights and source freshness to requested providers", async () => {
  const vaultRoot = await createSleepPatternVault("UTC", { includeWhoop: true });

  try {
    await rebuildQueryProjection(vaultRoot);
    const summary = await summarizeWearableSleepPatternRuntime(vaultRoot, {
      from: "2026-07-08",
      now: "2026-07-11T12:00:00.000Z",
      providers: ["oura"],
      to: "2026-07-10",
    });

    assert.deepEqual(summary.providers, ["oura"]);
    assert.deepEqual(summary.sourceFreshness.map((source) => source.provider), ["oura"]);
    assert.equal(summary.validNightCount, 1);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("sleep-pattern runtime keeps clock timing unavailable when neither event nor vault has a valid zone", async () => {
  const vaultRoot = await createSleepPatternVault();

  try {
    await rebuildQueryProjection(vaultRoot);
    const summary = await summarizeWearableSleepPatternRuntime(vaultRoot, {
      date: "2026-07-10",
      now: "2026-07-11T12:00:00.000Z",
    });

    assert.equal(summary.reportingTimeZone, null);
    assert.equal(summary.reportingTimeZoneSource, "none");
    assert.equal(summary.reportingTimeZoneFallbackNightCount, 0);
    assert.equal(summary.timingOmittedNightCount, 1);
    assert.equal(summary.bedtime.count, 0);
    assert.equal(summary.wakeTime.count, 0);
    assert.equal(summary.notes.some((note) => note.includes("clock timing was omitted")), true);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("sleep-pattern runtime reads adjacent stored dates before exact localized-date filtering", async () => {
  const vaultRoot = await createSleepPatternVault("Asia/Tokyo", {
    localizedDateMismatch: true,
  });

  try {
    await rebuildQueryProjection(vaultRoot);
    const summary = await summarizeWearableSleepPatternRuntime(vaultRoot, {
      date: "2026-07-10",
      now: "2026-07-11T00:00:00.000Z",
    });

    assert.equal(summary.validNightCount, 1);
    assert.equal(summary.latestNightDate, "2026-07-10");
    assert.equal(summary.sourceFreshness[0]?.lastSleepEvidenceDate, "2026-07-10");
    assert.equal(summary.notes.some((note) => note.includes("localized sleep-end date")), true);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("sleep-pattern runtime does not treat a fresh generic HRV observation as fresh sleep", async () => {
  const vaultRoot = await createSleepPatternVault("UTC", {
    includeFreshGenericHrv: true,
  });

  try {
    await rebuildQueryProjection(vaultRoot);
    const summary = await summarizeWearableSleepPatternRuntime(vaultRoot, {
      now: "2026-07-16T12:00:00.000Z",
    });

    assert.deepEqual(summary.sourceFreshness, [{
      lastSleepEvidenceDate: "2026-07-10",
      provider: "oura",
      stalenessVsNewestDays: 0,
      stalenessVsNowDays: 6,
    }]);
    assert.equal(summary.allSourcesStale, true);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

async function measuredSleepPattern(vaultRoot: string, filters: WearableSleepPatternFilters) {
  let summary!: WearableSleepPatternSummary;
  let counts: Record<string, number> = {};
  let droppedSpans = -1;
  await withCliTiming(
    () => timeCliDispatch("wearables sleep pattern", async () => {
      summary = await summarizeWearableSleepPatternRuntime(vaultRoot, filters);
    }),
    (report) => {
      counts = Object.fromEntries(report.commands.flatMap((command) => command.phases)
        .map(({ phase, count }) => [phase, count]));
      droppedSpans = report.droppedSpans;
    },
  );
  assert.equal(droppedSpans, 0);
  return { summary, counts };
}

function assertFocusedSleepWork(counts: Record<string, number>, rebuilds: number): void {
  for (const phase of ["query-metric-projection", "query-search-documents"]) {
    assert.equal(counts[phase] ?? 0, 0, phase);
  }
  for (const phase of ["query-rebuild", "query-source-read", "query-wearable-dataset",
    "query-wearable-summary", "query-publication"]) {
    assert.equal(counts[phase] ?? 0, rebuilds, phase);
  }
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

const parityCases: Array<{
  label: string;
  timeZone?: string;
  options?: Parameters<typeof createSleepPatternVault>[1];
  filters: WearableSleepPatternFilters;
}> = [
  { label: "metadata fallback", timeZone: "America/New_York", filters: {} },
  { label: "one provider", timeZone: "UTC",
    filters: { from: "2026-07-08", to: "2026-07-10", providers: ["oura"] } },
  { label: "provider union", timeZone: "UTC",
    filters: { from: "2026-07-08", to: "2026-07-10", providers: ["whoop", "oura"] } },
  { label: "explicit zone precedence", timeZone: "America/New_York",
    filters: { date: "2026-07-10", timeZone: "UTC" } },
  { label: "missing metadata", filters: { date: "2026-07-10" } },
  { label: "adjacent localized date", timeZone: "Asia/Tokyo",
    options: { localizedDateMismatch: true }, filters: { date: "2026-07-10" } },
  { label: "source freshness outside the window", timeZone: "UTC",
    filters: { date: "2026-07-16", providers: ["oura"] } },
  { label: "empty scope", timeZone: "UTC", filters: { providers: [] } },
  { label: "unknown scope", timeZone: "UTC", filters: { providers: ["missing"] } },
];

for (const scenario of parityCases) {
  test(`cold and warm focused sleep patterns equal the full global result: ${scenario.label}`, async () => {
    const vaultRoot = await createSleepPatternVault(scenario.timeZone, {
      includeWhoop: true, includeFreshGenericHrv: true, ...scenario.options,
    });
    const filters = { now: "2026-07-16T12:00:00.000Z", ...scenario.filters };
    const rows = vi.spyOn(wearableStore, "readWearableSummaryRows");
    try {
      const cold = await measuredSleepPattern(vaultRoot, filters);
      assertFocusedSleepWork(cold.counts, 1);
      assert.equal(cold.counts["query-wait"], 2);
      assert.deepEqual(rows.mock.calls[0]?.[1], {
        from: addDaysToIsoDate(cold.summary.from, -1),
        providers: filters.providers,
        to: addDaysToIsoDate(cold.summary.to, 1),
        summaryKinds: ["sleep", "source_health"],
      });
      const warm = await measuredSleepPattern(vaultRoot, filters);
      assertFocusedSleepWork(warm.counts, 0);
      const status = await getQueryProjectionStatus(vaultRoot);
      assert.equal(status.fresh, false);
      assert.equal(status.builtAt, null);
      assert.equal(status.entityCount, 0);
      assert.equal(status.searchDocumentCount, 0);

      // The existing public fresh-global path is the oracle, not a copied builder.
      await rebuildQueryProjection(vaultRoot);
      const global = await measuredSleepPattern(vaultRoot, filters);
      assertFocusedSleepWork(global.counts, 0);
      assert.equal(global.counts["query-wait"] ?? 0, 0);
      assert.equal(JSON.stringify(cold.summary), JSON.stringify(global.summary));
      assert.equal(JSON.stringify(warm.summary), JSON.stringify(global.summary));
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });
}

test("fresh-global sleep patterns finish before an unrelated parked writer without taking its lock", async () => {
  const vaultRoot = await createSleepPatternVault("America/New_York", { includeWhoop: true });
  try {
    await rebuildQueryProjection(vaultRoot);
    const filtersList: WearableSleepPatternFilters[] = [
      { now: "2026-07-16T12:00:00.000Z" },
      { now: "2026-07-16T12:00:00.000Z", providers: [] },
      { now: "2026-07-16T12:00:00.000Z", date: "2026-07-10", providers: ["oura"], timeZone: "UTC" },
    ];
    const cases = await Promise.all(filtersList.map(async (filters) => ({
      filters, expected: JSON.stringify(await summarizeWearableSleepPatternRuntime(vaultRoot, filters)),
    })));
    const held = gate(); const release = gate(); const attempted = gate();
    const owner = core.withCanonicalWriteLock(vaultRoot, async () => { held.release(); await release.promise; });
    await held.promise;
    const lock = core.withCanonicalWriteLock;
    const acquired = vi.spyOn(core, "withCanonicalWriteLock").mockImplementation((...args: Parameters<typeof lock>) => {
      attempted.release(); return lock(...args);
    });
    const focused = vi.spyOn(rebuild, "readFreshWearableSummaryRows");
    const metadata = vi.spyOn(vaultSource, "readVaultMetadataSource");
    const pending: Promise<unknown>[] = [];
    try {
      for (const { filters, expected } of cases) {
        const read = measuredSleepPattern(vaultRoot, filters);
        pending.push(read);
        assert.equal(await Promise.race([read.then(() => "read"), attempted.promise.then(() => "locked")]), "read");
        const result = await read;
        assert.equal(JSON.stringify(result.summary), expected);
        assertFocusedSleepWork(result.counts, 0);
        for (const phase of ["query-freshness", "query-manifest", "query-status"]) {
          assert.equal(result.counts[phase], 1, phase);
        }
        assert.equal(result.counts["query-wait"] ?? 0, 0);
      }
      assert.equal(acquired.mock.calls.length, 0);
      assert.equal(focused.mock.calls.length, 0);
      assert.equal(metadata.mock.calls.length, 0);
    } finally {
      release.release(); await owner; await Promise.allSettled(pending);
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

for (const state of ["cold", "stale"] as const) {
  test(`${state} sleep-pattern capture waits for one committed metadata and wearable generation`, async () => {
    const vaultRoot = await createSleepPatternVault("America/New_York");
    const filters = { date: "2026-07-10", now: "2026-07-11T13:00:00.000Z" };
    try {
      if (state === "stale") await rebuildQueryProjection(vaultRoot);
      const metadataPath = path.join(vaultRoot, "vault.json");
      const shard = path.join(vaultRoot, "ledger/events/2026/2026-07.jsonl");
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      const event = JSON.parse((await readFile(shard, "utf8")).trim());
      const held = gate(); const release = gate(); const attempted = gate();
      const owner = core.withCanonicalWriteLock(vaultRoot, async () => {
        await writeFile(metadataPath, `${JSON.stringify({ ...metadata, timezone: "UTC" })}\n`, "utf8");
        held.release();
        await release.promise;
        await writeFile(shard, `${JSON.stringify({
          ...event, durationMinutes: 540, endAt: "2026-07-10T12:00:00.000Z",
          recordedAt: "2026-07-10T12:05:00.000Z", title: "Changed synthetic sleep window",
        })}\n`, "utf8");
      });
      await held.promise;
      const lock = core.withCanonicalWriteLock;
      vi.spyOn(core, "withCanonicalWriteLock").mockImplementation((...args: Parameters<typeof lock>) => {
        attempted.release(); return lock(...args);
      });
      const metadataRead = vi.spyOn(vaultSource, "readVaultMetadataSource");
      const read = measuredSleepPattern(vaultRoot, filters);
      try {
        assert.equal(await Promise.race([read.then(() => "read"), attempted.promise.then(() => "locked")]), "locked");
        // Metadata must not be captured from the writer's intermediate state.
        assert.equal(metadataRead.mock.calls.length, 0);
        release.release(); await owner;
        const result = await read;
        assertFocusedSleepWork(result.counts, 1);
        // Outer acquisition and the focused owner's reentrant recheck are named waits.
        assert.equal(result.counts["query-wait"], 2);
        assert.equal(result.summary.reportingTimeZone, "UTC");
        assert.equal(result.summary.reportingTimeZoneSource, "vault_metadata");
        assert.equal(result.summary.validNightCount, 1);
        assert.equal(result.summary.sessionDurationMinutes.average, 540);
        assert.equal(result.summary.wakeTime.medianLocalTime, "12:00");
        assert.equal((await getQueryProjectionStatus(vaultRoot)).fresh, false);
        await rebuildQueryProjection(vaultRoot);
        assert.equal(JSON.stringify(result.summary),
          JSON.stringify(await summarizeWearableSleepPatternRuntime(vaultRoot, filters)));
      } finally {
        release.release(); await owner; await Promise.allSettled([read]);
      }
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });
}

async function assertStrictSleepPatternFailure(vaultRoot: string): Promise<void> {
  const expected = await vaultSource.readVaultSourceStrict(vaultRoot).then(() => null, (error: unknown) => error);
  assert.ok(expected instanceof Error);
  for (const providers of [undefined, [], ["missing"]]) {
    for (const timeZone of [undefined, "UTC"]) {
      await assert.rejects(summarizeWearableSleepPatternRuntime(vaultRoot, {
        date: "2026-07-10", now: "2026-07-11T12:00:00.000Z", providers, timeZone,
      }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.constructor, expected.constructor);
        assert.equal(error.message, expected.message);
        return true;
      });
    }
  }
}

test("sleep patterns validate all stale canonical source even for empty or unknown provider scopes", async () => {
  const vaultRoot = await createSleepPatternVault("UTC");
  try {
    await rebuildQueryProjection(vaultRoot);
    const dbPath = currentQueryProjectionLocation(vaultRoot).absolutePath;
    const before = await readFile(dbPath);
    // Outside the requested sleep window: selection must not narrow validation.
    await core.withCanonicalWriteLock(vaultRoot, () => appendFile(
      path.join(vaultRoot, "ledger/events/2026/2026-08.jsonl"), "{malformed synthetic source\n",
    ));
    await assertStrictSleepPatternFailure(vaultRoot);
    assert.deepEqual(await readFile(dbPath), before);
    assert.equal((await getQueryProjectionStatus(vaultRoot)).fresh, false);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("invalid optional metadata is not ignored, including with an explicit reporting zone", async () => {
  const vaultRoot = await createSleepPatternVault("UTC");
  try {
    await rebuildQueryProjection(vaultRoot);
    const dbPath = currentQueryProjectionLocation(vaultRoot).absolutePath;
    const before = await readFile(dbPath);
    for (const contents of ["{malformed metadata\n", "{}\n"]) {
      await core.withCanonicalWriteLock(vaultRoot, () => writeFile(path.join(vaultRoot, "vault.json"), contents, "utf8"));
      await assertStrictSleepPatternFailure(vaultRoot);
      assert.deepEqual(await readFile(dbPath), before);
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});
