import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";
import {
  QUERY_DB_RELATIVE_PATH,
  openSqliteRuntimeDatabase,
} from "@murphai/runtime-state/node";

import {
  rebuildQueryProjection,
  summarizeWearableActivityRuntime,
  summarizeWearableSleepRuntime,
  summarizeWearableSourceHealthRuntime,
} from "../src/index.ts";

test("runtime wearable provider filters do not fall back to all-provider summaries", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-provider-scope-"));
  const eventLedgerPath = path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl");

  try {
    await mkdir(path.dirname(eventLedgerPath), { recursive: true });
    const eventRecords = [
      ...Array.from({ length: 7 }, (_, index) => ({
        schemaVersion: "murph.event.v1",
        id: `evt_provider_scope_steps_${index}`,
        kind: "observation",
        occurredAt: "2026-03-20T07:00:00Z",
        recordedAt: "2026-03-20T07:01:00Z",
        dayKey: "2026-03-20",
        source: "device",
        title: `Provider ${index} steps`,
        metric: "steps",
        value: 5000 + index,
        unit: "count",
        externalRef: {
          system: `wearable${index}`,
          resourceType: "daily_activity",
          resourceId: `daily-activity-2026-03-20-${index}`,
        },
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        schemaVersion: "murph.event.v1",
        id: `evt_provider_scope_floors_${index}`,
        kind: "observation",
        occurredAt: "2026-03-20T07:00:00Z",
        recordedAt: "2026-03-20T07:01:00Z",
        dayKey: "2026-03-20",
        source: "device",
        title: `Provider ${index} floors`,
        metric: "floors-climbed",
        value: 10 + index,
        unit: "count",
        externalRef: {
          system: `wearable${index}`,
          resourceType: "daily_activity",
          resourceId: `daily-activity-floors-2026-03-20-${index}`,
        },
      })),
    ];
    await writeFile(
      eventLedgerPath,
      eventRecords.map((record) => JSON.stringify(record)).join("\n").concat("\n"),
    );
    await rebuildQueryProjection(vaultRoot);

    const database = openSqliteRuntimeDatabase(path.join(vaultRoot, QUERY_DB_RELATIVE_PATH), {
      readOnly: true,
    });
    try {
      const expectedProviderScopeKeys = Array.from({ length: 7 }, (_, index) => `providers:wearable${index}`);
      const activityScopeRows = database
        .prepare(`
          SELECT provider_scope_key AS providerScopeKey
          FROM query_wearable_summaries
          WHERE summary_kind = 'activity'
            AND summary_date = '2026-03-20'
          ORDER BY provider_scope_key ASC
        `)
        .all() as Array<{ providerScopeKey: string }>;

      assert.deepEqual(
        activityScopeRows.map((row) => row.providerScopeKey),
        expectedProviderScopeKeys,
      );

      const storedScopeRows = database
        .prepare(`
          SELECT DISTINCT
            provider_scope_key AS providerScopeKey,
            provider_scope_json AS providerScopeJson
          FROM query_wearable_summaries
          ORDER BY provider_scope_key ASC, provider_scope_json ASC
        `)
        .all() as Array<{ providerScopeJson: string; providerScopeKey: string }>;

      assert.deepEqual(
        storedScopeRows.map((row) => row.providerScopeKey),
        expectedProviderScopeKeys,
      );
      assert.deepEqual(
        storedScopeRows.map((row) => JSON.parse(row.providerScopeJson)),
        expectedProviderScopeKeys.map((key) => [key.replace(/^providers:/u, "")]),
      );
    } finally {
      database.close();
    }

    const absentProvider = await summarizeWearableActivityRuntime(vaultRoot, {
      date: "2026-03-20",
      providers: ["absent-provider"],
    });
    const blankProvider = await summarizeWearableActivityRuntime(vaultRoot, {
      date: "2026-03-20",
      providers: [" "],
    });
    const composedProviderPair = await summarizeWearableActivityRuntime(vaultRoot, {
      date: "2026-03-20",
      providers: ["wearable0", "wearable1"],
    });
    const normalizedSingleProvider = await summarizeWearableActivityRuntime(vaultRoot, {
      date: "2026-03-20",
      providers: [" WEARABLE0 ", "wearable0"],
    });

    assert.deepEqual(absentProvider, []);
    assert.deepEqual(blankProvider, []);
    assert.equal(composedProviderPair.length, 1);
    assert.equal(composedProviderPair[0]?.steps.confidence.candidateCount, 2);
    assert.equal(composedProviderPair[0]?.steps.selection.provider, "wearable0");
    assert.equal(composedProviderPair[0]?.floorsClimbed.confidence.candidateCount, 2);
    assert.equal(composedProviderPair[0]?.floorsClimbed.selection.provider, "wearable0");
    assert.equal(normalizedSingleProvider[0]?.steps.selection.provider, "wearable0");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("runtime all-provider wearable source health recomputes provider staleness", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-provider-health-"));
  const eventLedgerPath = path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl");

  try {
    await mkdir(path.dirname(eventLedgerPath), { recursive: true });
    await writeFile(
      eventLedgerPath,
      [
        {
          schemaVersion: "murph.event.v1",
          id: "evt_provider_health_alpha_steps",
          kind: "observation",
          occurredAt: "2026-03-18T07:00:00Z",
          recordedAt: "2026-03-18T07:01:00Z",
          dayKey: "2026-03-18",
          source: "device",
          title: "Alpha steps",
          metric: "steps",
          value: 5_000,
          unit: "count",
          externalRef: {
            system: "alpha",
            resourceType: "daily_activity",
            resourceId: "alpha-daily-activity-2026-03-18",
          },
        },
        {
          schemaVersion: "murph.event.v1",
          id: "evt_provider_health_beta_steps",
          kind: "observation",
          occurredAt: "2026-03-20T07:00:00Z",
          recordedAt: "2026-03-20T07:01:00Z",
          dayKey: "2026-03-20",
          source: "device",
          title: "Beta steps",
          metric: "steps",
          value: 6_000,
          unit: "count",
          externalRef: {
            system: "beta",
            resourceType: "daily_activity",
            resourceId: "beta-daily-activity-2026-03-20",
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")
        .concat("\n"),
    );
    await rebuildQueryProjection(vaultRoot);

    const database = openSqliteRuntimeDatabase(path.join(vaultRoot, QUERY_DB_RELATIVE_PATH));
    try {
      const alphaSourceHealthRow = database
        .prepare(`
          SELECT id, summary_json AS summaryJson
          FROM query_wearable_summaries
          WHERE provider_scope_key = 'providers:alpha'
            AND summary_kind = 'source_health'
          LIMIT 1
        `)
        .get() as { id: string; summaryJson: string } | undefined;

      assert.ok(alphaSourceHealthRow);
      const alphaSourceHealthSummary = JSON.parse(alphaSourceHealthRow.summaryJson);
      alphaSourceHealthSummary.notes = [
        ...(alphaSourceHealthSummary.notes ?? []),
        "Synthetic stored source-health note that must not survive recomposition.",
      ];
      database
        .prepare("UPDATE query_wearable_summaries SET summary_json = ? WHERE id = ?")
        .run(JSON.stringify(alphaSourceHealthSummary), alphaSourceHealthRow.id);
    } finally {
      database.close();
    }

    const alphaOnlySourceHealth = await summarizeWearableSourceHealthRuntime(vaultRoot, {
      providers: ["alpha"],
    });
    const alphaBetaSourceHealth = await summarizeWearableSourceHealthRuntime(vaultRoot, {
      providers: ["alpha", "beta"],
    });
    const allProviderSourceHealth = await summarizeWearableSourceHealthRuntime(vaultRoot);
    const allProviderSourceHealthByProvider = new Map(
      allProviderSourceHealth.map((summary) => [summary.provider, summary]),
    );
    const alphaBetaSourceHealthByProvider = new Map(
      alphaBetaSourceHealth.map((summary) => [summary.provider, summary]),
    );
    const alphaSourceHealth = allProviderSourceHealthByProvider.get("alpha");
    const betaSourceHealth = allProviderSourceHealthByProvider.get("beta");

    assert.equal(alphaOnlySourceHealth[0]?.stalenessVsNewestDays, 0);
    assert.equal(alphaBetaSourceHealthByProvider.get("alpha")?.stalenessVsNewestDays, 2);
    assert.equal(alphaBetaSourceHealthByProvider.get("beta")?.stalenessVsNewestDays, 0);
    assert.equal(
      alphaBetaSourceHealthByProvider.get("alpha")?.notes.some((note) => note.includes("must not survive")),
      false,
    );
    assert.equal(alphaSourceHealth?.lastDate, "2026-03-18");
    assert.equal(alphaSourceHealth?.stalenessVsNewestDays, 2);
    assert.equal(
      alphaSourceHealth?.notes.some((note) => note.includes("trails the newest wearable source by 2 days")),
      true,
    );
    assert.equal(
      alphaSourceHealth?.notes.some((note) => note.includes("must not survive")),
      false,
    );
    assert.equal(betaSourceHealth?.lastDate, "2026-03-20");
    assert.equal(betaSourceHealth?.stalenessVsNewestDays, 0);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("provider-scoped wearable source health does not duplicate unknown rows", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-provider-source-health-"));
  const eventLedgerPath = path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl");

  try {
    await mkdir(path.dirname(eventLedgerPath), { recursive: true });
    await writeFile(
      eventLedgerPath,
      [
        {
          schemaVersion: "murph.event.v1",
          id: "evt_provider_source_health_known",
          kind: "observation",
          occurredAt: "2026-04-01T07:00:00Z",
          recordedAt: "2026-04-01T07:01:00Z",
          dayKey: "2026-04-01",
          source: "device",
          title: "Garmin steps",
          metric: "steps",
          value: 6400,
          unit: "count",
          externalRef: {
            system: "garmin",
            resourceType: "daily_activity",
            resourceId: "daily-activity-2026-04-01",
          },
        },
        {
          schemaVersion: "murph.event.v1",
          id: "evt_provider_source_health_unknown",
          kind: "observation",
          occurredAt: "2026-04-01T07:05:00Z",
          recordedAt: "2026-04-01T07:06:00Z",
          dayKey: "2026-04-01",
          source: "device",
          title: "Sleep total without provider",
          metric: "sleep-total-minutes",
          value: 420,
          unit: "minutes",
          externalRef: {
            resourceType: "sleep_summary",
            resourceId: "sleep-summary-2026-04-01",
          },
        },
      ].map((record) => JSON.stringify(record)).join("\n").concat("\n"),
      "utf8",
    );
    await rebuildQueryProjection(vaultRoot);

    const database = openSqliteRuntimeDatabase(path.join(vaultRoot, QUERY_DB_RELATIVE_PATH), {
      readOnly: true,
    });
    try {
      const sourceHealthRows = database
        .prepare(`
          SELECT
            provider_scope_key AS providerScopeKey,
            summary_json AS summaryJson
          FROM query_wearable_summaries
          WHERE summary_kind = 'source_health'
          ORDER BY provider_scope_key ASC, sort_rank ASC
        `)
        .all() as Array<{ providerScopeKey: string; summaryJson: string }>;

      assert.deepEqual(
        sourceHealthRows.map((row) => ({
          provider: JSON.parse(row.summaryJson).provider,
          scope: row.providerScopeKey,
        })),
        [
          { provider: "garmin", scope: "providers:garmin" },
          { provider: "unknown", scope: "providers:unknown" },
        ],
      );
    } finally {
      database.close();
    }

    const allSourceHealth = await summarizeWearableSourceHealthRuntime(vaultRoot);
    const garminSourceHealth = await summarizeWearableSourceHealthRuntime(vaultRoot, {
      providers: ["garmin"],
    });

    assert.deepEqual(allSourceHealth.map((row) => row.provider), ["garmin", "unknown"]);
    assert.deepEqual(garminSourceHealth.map((row) => row.provider), ["garmin"]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("provider-scoped wearable projection rows use resolved public providers", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-public-provider-"));
  const eventLedgerPath = path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl");

  try {
    await mkdir(path.dirname(eventLedgerPath), { recursive: true });
    await writeFile(
      eventLedgerPath,
      [
        {
          schemaVersion: "murph.event.v1",
          id: "evt_public_provider_steps",
          kind: "observation",
          occurredAt: "2026-04-03T07:00:00Z",
          recordedAt: "2026-04-03T07:01:00Z",
          dayKey: "2026-04-03",
          source: "device",
          title: "Resolved provider steps",
          metric: "steps",
          value: 7200,
          unit: "count",
          dataOrigin: {
            version: 1,
            aggregatorProvider: "junction",
            sourceProviderSlug: "garmin",
            sourceType: "watch",
          },
          externalRef: {
            system: "junction",
            resourceType: "junction-garmin-activity",
          },
        },
        {
          schemaVersion: "murph.event.v1",
          id: "evt_direct_garmin_steps",
          kind: "observation",
          occurredAt: "2026-04-03T06:00:00Z",
          recordedAt: "2026-04-03T06:01:00Z",
          dayKey: "2026-04-03",
          source: "device",
          title: "Direct Garmin steps",
          metric: "steps",
          value: 6800,
          unit: "count",
          externalRef: {
            system: "garmin",
            resourceType: "daily_activity",
            resourceId: "garmin-daily-activity-2026-04-03",
          },
        },
        {
          schemaVersion: "murph.event.v1",
          id: "evt_source_instance_only_steps",
          kind: "observation",
          occurredAt: "2026-04-03T08:00:00Z",
          recordedAt: "2026-04-03T08:01:00Z",
          dayKey: "2026-04-03",
          source: "device",
          title: "Source instance only steps",
          metric: "steps",
          value: 4100,
          unit: "count",
          dataOrigin: {
            version: 1,
            aggregatorProvider: "junction",
            sourceInstanceId: "opaque-source-instance",
            sourceType: "watch",
          },
          externalRef: {
            system: "junction",
            resourceType: "junction-activity",
          },
        },
      ].map((record) => JSON.stringify(record)).join("\n").concat("\n"),
      "utf8",
    );
    await rebuildQueryProjection(vaultRoot);

    const database = openSqliteRuntimeDatabase(path.join(vaultRoot, QUERY_DB_RELATIVE_PATH), {
      readOnly: true,
    });
    try {
      const activityScopeRows = database
        .prepare(`
          SELECT
            provider_scope_key AS providerScopeKey,
            summary_json AS summaryJson
          FROM query_wearable_summaries
          WHERE summary_kind = 'activity'
            AND summary_date = '2026-04-03'
          ORDER BY provider_scope_key ASC
        `)
        .all() as Array<{ providerScopeKey: string; summaryJson: string }>;

      assert.deepEqual(
        activityScopeRows.map((row) => row.providerScopeKey),
        ["providers:garmin", "providers:unknown"],
      );
      assert.equal(
        activityScopeRows.every((row) => !row.summaryJson.includes("opaque-source-instance")),
        true,
      );
      assert.doesNotMatch(
        activityScopeRows.map((row) => row.summaryJson).join("\n"),
        /externalRef|dataOrigin|candidateId/u,
      );
    } finally {
      database.close();
    }

    const garminActivity = await summarizeWearableActivityRuntime(vaultRoot, {
      date: "2026-04-03",
      providers: ["garmin"],
    });
    const junctionActivity = await summarizeWearableActivityRuntime(vaultRoot, {
      date: "2026-04-03",
      providers: ["junction"],
    });
    const unknownActivity = await summarizeWearableActivityRuntime(vaultRoot, {
      date: "2026-04-03",
      providers: ["unknown"],
    });

    assert.equal(garminActivity.length, 1);
    assert.equal(garminActivity[0]?.steps.selection.provider, "garmin");
    assert.equal(garminActivity[0]?.steps.selection.value, 6800);
    assert.equal(garminActivity[0]?.steps.confidence.candidateCount, 2);
    assert.deepEqual(junctionActivity, []);
    assert.equal(unknownActivity.length, 1);
    assert.equal(unknownActivity[0]?.steps.selection.provider, "unknown");
    assert.equal(unknownActivity[0]?.steps.selection.value, 4100);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("multi-provider projected sleep reads do not invent sleep windows from total sleep metrics", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-provider-sleep-total-"));
  const eventLedgerPath = path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl");

  try {
    await mkdir(path.dirname(eventLedgerPath), { recursive: true });
    await writeFile(
      eventLedgerPath,
      ["garmin", "oura"].map((provider, index) => JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: `evt_total_sleep_${provider}`,
        kind: "observation",
        occurredAt: "2026-04-02T06:00:00Z",
        recordedAt: `2026-04-02T06:0${index + 1}:00Z`,
        dayKey: "2026-04-02",
        source: "device",
        title: `${provider} total sleep`,
        metric: "sleep-total-minutes",
        value: 410 + index,
        unit: "minutes",
        externalRef: {
          system: provider,
          resourceType: "sleep_summary",
          resourceId: `sleep-summary-2026-04-02-${provider}`,
        },
      })).join("\n").concat("\n"),
      "utf8",
    );

    const sleep = await summarizeWearableSleepRuntime(vaultRoot, {
      date: "2026-04-02",
      providers: ["garmin", "oura"],
    });
    const night = sleep[0];

    assert.equal(sleep.length, 1);
    assert.ok(
      night?.totalSleepMinutes.selection.value === 410 ||
      night?.totalSleepMinutes.selection.value === 411,
    );
    assert.equal(night?.sessionMinutes.selection.value, null);
    assert.equal(night?.timeInBedMinutes.selection.value, null);
    assert.equal(night?.sleepWindowProvider, null);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("wearable summary projection keeps explicit dates older than the default display horizon", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-provider-history-"));
  const eventLedgerPath = path.join(vaultRoot, "ledger/events/2026/2026-05.jsonl");
  const dates = Array.from({ length: 366 }, (_, index) => isoDateDaysBefore("2026-05-01", index));
  const oldestDate = dates.at(-1);

  assert.ok(oldestDate);

  try {
    await mkdir(path.dirname(eventLedgerPath), { recursive: true });
    await writeFile(
      eventLedgerPath,
      dates.map((date, index) => JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: `evt_provider_history_steps_${index}`,
        kind: "observation",
        occurredAt: `${date}T07:00:00Z`,
        recordedAt: `${date}T07:01:00Z`,
        dayKey: date,
        source: "device",
        title: `Garmin steps ${date}`,
        metric: "steps",
        value: 1000 + index,
        unit: "count",
        externalRef: {
          system: "garmin",
          resourceType: "daily_activity",
          resourceId: `daily-activity-${date}`,
        },
      })).join("\n").concat("\n"),
      "utf8",
    );

    const activity = await summarizeWearableActivityRuntime(vaultRoot, {
      date: oldestDate,
      providers: ["garmin"],
    });

    assert.equal(activity.length, 1);
    assert.equal(activity[0]?.date, oldestDate);
    assert.equal(activity[0]?.steps.selection.value, 1365);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

function isoDateDaysBefore(anchorDate: string, daysBefore: number): string {
  const [year, month, day] = anchorDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - daysBefore));
  return date.toISOString().slice(0, 10);
}
