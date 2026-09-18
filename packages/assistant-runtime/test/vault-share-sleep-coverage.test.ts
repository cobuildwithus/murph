import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import {
  getHostedGroupWearableReportingGaps,
  type HostedRuntimeGroupSharedProjection,
} from "@murphai/hosted-execution/runtime-control";
import {
  getHostedVaultShareDailyMetricProjectionSpec,
  type HostedVaultShareDailyMetricProjectionKind,
} from "@murphai/hosted-execution/vault-share";
import {
  listMetricPointsByPublicSource,
  summarizeWearableSleepRuntime,
} from "@murphai/query";
import {
  openSqliteRuntimeDatabase,
  QUERY_DB_RELATIVE_PATH,
} from "@murphai/runtime-state/node";
import { afterEach, expect, it, vi } from "vitest";

import {
  readProjectableDailyMetricDays,
  readProjectableSleepNights,
} from "../src/hosted-runtime/vault-share-projection.ts";

const DATE = "2026-07-18";
const PREVIOUS_DATE = "2026-07-17";
const TOTAL_SCOPE = "sleep-duration-days.v0";
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sleepRecords(input: {
  provider: string;
  date?: string;
  sleepType?: "nap" | "main_sleep";
}) {
  const date = input.date ?? DATE;
  const nap = input.sleepType === "nap";
  const id = `${input.provider}_${date}_${input.sleepType ?? "unknown"}`;
  const startAt = `${date}T${nap ? "04:00" : "05:00"}:00.000Z`;
  const endAt = `${date}T${nap ? "04:30" : "11:00"}:00.000Z`;
  const base = {
    schemaVersion: "murph.event.v1",
    dayKey: date,
    occurredAt: endAt,
    recordedAt: endAt,
    source: "device",
    externalRef: { system: input.provider, resourceType: "sleep", resourceId: id },
  };
  return [
    {
      ...base, id: `evt_${id}_session`, kind: "sleep_session",
      title: "Synthetic sleep session", startAt, endAt,
      durationMinutes: nap ? 30 : 360, sleepType: input.sleepType,
    },
    ...[
      ["sleep-total-minutes", nap ? 22 : 310],
      ["sleep-deep-minutes", nap ? 4 : 65],
      ["sleep-rem-minutes", nap ? 5 : 75],
    ].map(([metric, value]) => ({
      ...base, id: `evt_${id}_${metric}`, kind: "observation",
      title: "Synthetic sleep metric", observationGrain: "summary",
      metric, value, unit: "minutes",
    })),
  ];
}

async function createVault(records: ReturnType<typeof sleepRecords>) {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(`${DATE}T12:00:00.000Z`));
  const root = await mkdtemp(join(tmpdir(), "vault-share-sleep-coverage-"));
  roots.push(root);
  await mkdir(join(root, "ledger/events/2026"), { recursive: true });
  await writeFile(join(root, "vault.json"), JSON.stringify({
    formatVersion: CURRENT_VAULT_FORMAT_VERSION,
    vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4E",
    createdAt: "2026-07-01T00:00:00.000Z",
    title: "Synthetic sleep coverage",
    timezone: "UTC",
  }));
  await appendFile(
    join(root, "ledger/events/2026/2026-07.jsonl"),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
  return root;
}

async function shareMetric(root: string, scope: HostedVaultShareDailyMetricProjectionKind) {
  const spec = getHostedVaultShareDailyMetricProjectionSpec(scope);
  if (!spec) throw new Error("Missing sleep projection specification");
  return readProjectableDailyMetricDays(root, spec);
}

it.each([
  TOTAL_SCOPE, "deep-sleep-days.v0", "deep-sleep-sources-days.v1",
  "rem-sleep-days.v0", "rem-sleep-sources-days.v1",
] as const)("keeps a nap-only date missing in shared %s", async (scope) => {
  const root = await createVault(sleepRecords({ provider: "oura", sleepType: "nap" }));
  // Warm the ordinary store before the share reads its existing provider summaries.
  const personal = await summarizeWearableSleepRuntime(root, { date: DATE });
  expect(personal[0]?.sleepType).toBe("nap");
  expect(personal[0]?.totalSleepMinutes.selection.value).toBe(22);
  // Simulate cached MetricPoints from before sleepType was propagated.
  const database = openSqliteRuntimeDatabase(join(root, QUERY_DB_RELATIVE_PATH), { create: false });
  try {
    const update = database.prepare(`
      UPDATE query_metric_points
      SET metric_point_json = json_remove(metric_point_json, '$.context.sleepType')
      WHERE metric_key = 'total-sleep-minutes'
    `).run();
    expect(update.changes).toBeGreaterThan(0);
  } finally {
    database.close();
  }
  const [group] = await listMetricPointsByPublicSource(root, {
    from: DATE, to: DATE, providers: ["oura"], metricKeys: ["total-sleep-minutes"],
  });
  expect.soft(group?.points[0]?.context.sleepType).toBe("nap");
  expect(await shareMetric(root, scope)).toEqual([]);
  expect(await readProjectableSleepNights(root)).toEqual([]);
});

it("keeps a nap-only date eligible for freshness recovery until main sleep arrives", async () => {
  const root = await createVault([
    ...sleepRecords({ provider: "oura", date: PREVIOUS_DATE, sleepType: "main_sleep" }),
    ...sleepRecords({ provider: "oura", sleepType: "nap" }),
  ]);
  const records = await shareMetric(root, TOTAL_SCOPE);
  const projection: HostedRuntimeGroupSharedProjection = {
    projectionScope: { projectionKind: TOTAL_SCOPE }, projectionScopeKey: TOTAL_SCOPE,
    grantStatus: "granted", grantedAt: "2026-07-01T00:00:00.000Z",
    dataStatus: "available", records,
  };
  const requirements = [{ projectionScopeKey: TOTAL_SCOPE, date: DATE }];
  expect(getHostedGroupWearableReportingGaps(projection, requirements)).toEqual([
    { date: DATE, source: { source: "oura", label: "Oura" }, reportingHistory: "recent_reporting" },
  ]);
  await appendFile(
    join(root, "ledger/events/2026/2026-07.jsonl"),
    sleepRecords({ provider: "oura", sleepType: "main_sleep" })
      .map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
  const refreshed = await shareMetric(root, TOTAL_SCOPE);
  expect(refreshed).toContainEqual(expect.objectContaining({
    data: expect.objectContaining({ date: DATE, value: 310 }),
  }));
  expect(getHostedGroupWearableReportingGaps({ ...projection, records: refreshed }, requirements)).toEqual([]);
  for (const [scope, value] of [
    ["deep-sleep-sources-days.v1", 65],
    ["rem-sleep-sources-days.v1", 75],
  ] as const) {
    expect(await shareMetric(root, scope)).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({ date: DATE, value }),
    }));
  }
  expect(await readProjectableSleepNights(root)).toContainEqual(expect.objectContaining({
    data: {
      date: DATE,
      sleepStartAt: `${DATE}T05:00:00.000Z`,
      sleepEndAt: `${DATE}T11:00:00.000Z`,
    },
  }));
});

it("preserves another source's main sleep beside an explicit nap", async () => {
  const root = await createVault([
    ...sleepRecords({ provider: "oura", sleepType: "nap" }),
    ...sleepRecords({ provider: "garmin", sleepType: "main_sleep" }),
  ]);
  const records = await shareMetric(root, TOTAL_SCOPE);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    source: { source: "garmin", label: "Garmin" }, data: { date: DATE, value: 310 },
  });
  expect((await readProjectableSleepNights(root)).map((record) => record.source?.source)).toEqual(["garmin"]);
});

it("preserves legacy unknown sleep types and independent main-sleep sources", async () => {
  const root = await createVault([
    ...sleepRecords({ provider: "oura" }),
    ...sleepRecords({ provider: "garmin", sleepType: "main_sleep" }),
  ]);
  for (const records of [
    await shareMetric(root, TOTAL_SCOPE),
    await readProjectableSleepNights(root),
  ]) {
    expect(records.map((record) => record.source?.source).sort()).toEqual(["garmin", "oura"]);
  }
});
