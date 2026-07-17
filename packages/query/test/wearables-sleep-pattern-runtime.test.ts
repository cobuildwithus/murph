import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { test } from "vitest";

import {
  rebuildQueryProjection,
  summarizeWearableSleepPatternRuntime,
} from "../src/query-projection.ts";

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
