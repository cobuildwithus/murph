import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CloudflareHostedControlBrowserVaultReplicaNotFoundError } from "@murphai/cloudflare-hosted-control/client";
import { addDaysToIsoDate } from "@murphai/contracts";
import {
  getBrowserVaultMetricBucketId, parseBrowserVaultReplica, splitBrowserVaultReplica,
  type BrowserVaultMetricRow, type BrowserVaultReplica, type BrowserVaultReplicaShardSet,
} from "@murphai/query/browser-replica-client";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), current: vi.fn(), authority: vi.fn(), workspace: vi.fn(),
  control: vi.fn(), decode: vi.fn(), wake: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({ requireActiveHostedMemberAuthFromBearerToken: mocks.auth }));
vi.mock("@/src/lib/better-auth/native-auth", () => ({ assertHostedNativeMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("@/src/lib/hosted-workspace/store", () => ({ readHostedWorkspace: mocks.workspace }));
vi.mock("@/src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: () => ({
  createBrowserVaultSession: mocks.control, ensureProcessing: mocks.wake, requestBrowserVaultRefresh: mocks.refresh,
}) }));
vi.mock("@/src/lib/browser-vault/loader", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/browser-vault/loader")>("@/src/lib/browser-vault/loader");
  return { ...actual, parseBrowserVaultSessionResponse: (value: unknown) => value, decodeReadyBrowserVaultSession: mocks.decode };
});
import { createBrowserVaultRouteQueryClient, selectBrowserVaultReplicaDemand } from "@/src/lib/browser-vault/loader";
import type { decodeReadyBrowserVaultSession } from "@/src/lib/browser-vault/loader";
import { GET } from "../app/api/device-sync/companion/numbers/route";

const savedAt = "2026-11-04T18:00:00.000Z";
const replicaRef = {
  byteLength: 128, dataVersion: "d".repeat(64), generatedAt: savedAt, generation: 18,
  keyId: "browser-vault-replica:d", objectKey: "users/browser-vault-replicas/opaque/replica.json",
  replicaSchema: "murph.browser-vault-replica", runtimeRootKeyId: "udrk:runtime:test-root",
  schema: "murph.hosted-browser-vault-replica-ref.v1", sourceBundleHash: "a".repeat(64),
};
const from = "2026-08-07";
const through = "2026-11-04";
const yearFrom = "2025-11-05";
const stepsThrough = "2026-11-03";
const request = (query = "") => new Request(`https://app.example.test/api/device-sync/companion/numbers${query}`);
let shards: BrowserVaultReplicaShardSet;

function row(metricKey: string, date: string, value: number, unit: string, overrides: Partial<BrowserVaultMetricRow> = {}): BrowserVaultMetricRow {
  return {
    biomarkerKey: null, comparator: null, confidence: "high", context: { publicSourceProvider: "garmin" },
    date, grain: "day", id: `metric-row:${metricKey}:${date}`, metricKey,
    observedAt: `${date}T12:00:00.000Z`, pointIds: ["synthetic-point"], recordIds: ["synthetic-record"],
    rowSchema: "murph.browser-vault.metric-row.v1", sourceFamily: "derived",
    sourceKind: "activity-summary", sourceLabel: "Garmin", statistic: "value", unit, value, valueLabel: "private display label",
    ...overrides,
  };
}

function fixture(metricRows?: BrowserVaultMetricRow[]): BrowserVaultReplica {
  const dailyRows = [0, 1, 2, 3].flatMap(offset => [
    row("resting-heart-rate", addDaysToIsoDate(from, offset), 61.2, "bpm"),
    row("resting-heart-rate", addDaysToIsoDate(through, -offset), 58.2, "bpm"),
    row("total-sleep-minutes", addDaysToIsoDate(from, offset), 7, "hours"),
    row("total-sleep-minutes", addDaysToIsoDate(through, -offset), 450.4, "minutes"),
    row("steps", addDaysToIsoDate(from, offset), 7000.2, "count"),
    row("steps", addDaysToIsoDate(stepsThrough, -offset), 8000.2, "count"),
  ]);
  return {
    assistantSummary: { highlights: [], latestDate: through }, entities: [],
    generatedAt: savedAt, generation: 18, labResultRows: [],
    meals: { schemaVersion: 1, timeZone: "America/New_York", days: [] },
    metricGoalProgressRows: [], metricSelectionRows: [],
    metricRows: metricRows ?? [
      ...dailyRows,
      row("estimated-vo2-max", from, 42.2, "mL/kg/min"),
      row("estimated-vo2-max", addDaysToIsoDate(from, 6), 44.2, "mL/kg/min"),
      row("estimated-vo2-max", addDaysToIsoDate(through, -6), 46.34, "mL/kg/min"),
      row("estimated-vo2-max", through, 48.34, "mL/kg/min"),
      // Older than the 90 days the change counts from, but on the chart.
      row("steps", addDaysToIsoDate(from, -30), 300, "count"),
      row("steps", addDaysToIsoDate(through, -365), 100, "count"),
      row("steps", through, 100, "count"),
      row("steps", addDaysToIsoDate(through, 1), 200, "count"),
      row("body-weight", through, 70, "kg"),
    ].reverse(),
    policy: { id: "health-vault-browser", bodyPreviewChars: 280, excludedFamilies: [], includedFamilies: [], metricLookbackDays: 365 },
    demographics: { birthYear: 1986, birthYearPrecision: "exact", biologicalSex: "female", status: "resolved", revision: "f".repeat(64) },
    schema: "murph.browser-vault-replica", searchRows: [],
    source: { dataVersion: replicaRef.dataVersion, sourceBundleHash: replicaRef.sourceBundleHash },
    sourceHealthRows: [], timelineRows: [], weeklySampleSummaries: [],
  };
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T19:00:00Z"));
  shards = await splitBrowserVaultReplica(parseBrowserVaultReplica(fixture()));
  mocks.auth.mockResolvedValue({ member: { id: "member_native" } });
  mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: replicaRef, version: "v1" });
  mocks.control.mockResolvedValue({ state: "ready" });
  // The external decryption boundary is mocked, while real saved-shard selection
  // and query construction reject absent buckets and preserve provider rows.
  mocks.decode.mockImplementation(async (input: Parameters<typeof decodeReadyBrowserVaultSession>[0]) => ({
    client: createBrowserVaultRouteQueryClient(
      selectBrowserVaultReplicaDemand(shards, input.requestedShards ?? ["core"], input.requestedMetricBuckets ?? []),
      input.requestedShards ?? ["core"], input.requestedMetricBuckets,
    ),
  }));
});

afterEach(() => {
  expect(mocks.wake).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
  vi.useRealTimers();
});

it("serves only the documented four saved series and comparison fields, including cloud VO2", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["timeZone", "savedAt", "freshness", "window", "demographics", "numbers"]);
  expect(body).toMatchObject({ timeZone: "America/New_York", savedAt, freshness: "fresh", window: { from: yearFrom, through } });
  expect(Object.keys(body.numbers)).toEqual(["restingHeartRate", "sleep", "steps", "vo2Max"]);
  for (const [name, unit, baseline, current, delta] of [
    ["restingHeartRate", "bpm", 61, 58, -3], ["sleep", "minutes", 420, 450, 30], ["steps", "steps", 7000, 8000, 1000],
  ] as const) {
    const metricThrough = name === "steps" ? stepsThrough : through;
    expect(body.numbers[name]).toEqual({
      unit, latest: { date: metricThrough, value: current }, stale: false,
      source: "Garmin",
      daily: [
        ...name === "steps" ? [{ date: addDaysToIsoDate(from, -30), value: 300 }] : [],
        ...[0, 1, 2, 3].map(offset => ({ date: addDaysToIsoDate(from, offset), value: baseline })),
        ...[3, 2, 1, 0].map(offset => ({ date: addDaysToIsoDate(metricThrough, -offset), value: current })),
      ],
      comparison: {
        baseline: { from, through: "2026-08-13", value: baseline, days: 4 },
        current: { from: addDaysToIsoDate(metricThrough, -6), through: metricThrough, value: current, days: 4 }, delta,
      },
    });
  }
  expect(body.numbers.vo2Max).toEqual({
    unit: "ml/kg/min", latest: { date: through, value: 48.3 }, stale: false,
    source: "Garmin",
    daily: [{ date: from, value: 42.2 }, { date: "2026-08-13", value: 44.2 }, { date: "2026-10-29", value: 46.3 }, { date: through, value: 48.3 }],
    comparison: {
      baseline: { from, through: "2026-08-13", value: 43.2, days: 2 },
      current: { from: "2026-10-29", through, value: 47.3, days: 2 }, delta: 4.1,
    },
  });
  const buckets = [...new Set(await Promise.all([
    "resting-heart-rate", "total-sleep-minutes", "steps", "estimated-vo2-max",
  ].map(getBrowserVaultMetricBucketId)))].sort();
  const selection = { requestedShards: ["core", "metricsIndex"], requestedMetricBuckets: buckets };
  expect(mocks.control).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ...selection, userId: "member_native" }));
  expect(mocks.decode).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ...selection, expectedMemberId: "member_native", signal: expect.any(AbortSignal) }));
  expect(mocks.current).toHaveBeenCalledExactlyOnceWith({ member: { id: "member_native" } }, {});
  expect(mocks.authority).toHaveBeenCalledTimes(2);
});

it("uses local today across midnight and DST, retaining canonical daily dates", async () => {
  vi.setSystemTime(new Date("2026-11-05T02:00:00Z"));
  const body = await (await GET(request())).json();
  expect(body.window).toEqual({ from: yearFrom, through });
  expect(body.numbers.steps.daily).toHaveLength(9);
  shards = await splitBrowserVaultReplica({ ...fixture(), meals: { schemaVersion: 1, timeZone: "Asia/Tokyo", days: [] } });
  const east = await (await GET(request())).json();
  expect(east.window).toEqual({ from: "2025-11-06", through: "2026-11-05" });
  expect(east.numbers.steps.latest).toEqual({ date: "2026-11-04", value: 100 });
});

it.each([
  ["07:00:00", "2026-11-03", 8000, 11],
  ["08:00:00", "2026-11-04", 7429, 12],
])("leaves unsettled steps out at %s local while keeping today's heart rate", async (time, settledThrough, current, days) => {
  vi.setSystemTime(new Date(`2026-11-05T${time}-05:00`));
  shards = await splitBrowserVaultReplica(fixture([
    ...[0, 1, 2, 3].map(offset => row("steps", addDaysToIsoDate("2026-08-08", offset), 6000, "count")),
    ...Array.from({ length: 7 }, (_, offset) => row("steps", addDaysToIsoDate("2026-10-28", offset), 8000, "count")),
    row("steps", "2026-11-04", 4000, "count"),
    row("steps", "2026-11-05", 1000, "count"),
    row("resting-heart-rate", "2026-11-05", 59, "bpm"),
  ]));
  const body = await (await GET(request())).json();
  expect(body.window).toEqual({ from: "2025-11-06", through: "2026-11-05" });
  expect(body.numbers.steps).toMatchObject({
    latest: { date: settledThrough, value: time === "07:00:00" ? 8000 : 4000 }, stale: false,
    comparison: {
      baseline: { from: "2026-08-08", through: "2026-08-14", value: 6000, days: 4 },
      current: { from: addDaysToIsoDate(settledThrough, -6), through: settledThrough, value: current, days: 7 },
      delta: current - 6000,
    },
  });
  expect(body.numbers.steps.daily).toHaveLength(days);
  expect(body.numbers.steps.daily.every((point: { date: string }) => point.date <= settledThrough)).toBe(true);
  expect(body.numbers.restingHeartRate.latest).toEqual({ date: "2026-11-05", value: 59 });
  expect(body.numbers.restingHeartRate.daily).toEqual([{ date: "2026-11-05", value: 59 }]);
});

it.each(["age", "generation"])("returns saved stale data without refreshing (%s)", async cause => {
  if (cause === "age") vi.setSystemTime(new Date("2026-11-06T19:00:00Z"));
  else mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: { ...replicaRef, generation: 16 } });
  const body = await (await GET(request())).json();
  expect(body.freshness).toBe("stale");
  expect(body.numbers.restingHeartRate.latest.value).toBe(58);
});

it.each(["missing ref", "missing object", "empty session"])("returns the Journal-style empty response for legacy %s", async cause => {
  mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: { ...replicaRef, generation: 17 }, version: "v1" });
  if (cause === "missing ref") mocks.workspace.mockResolvedValue(null);
  if (cause === "missing object") mocks.control.mockRejectedValue(new CloudflareHostedControlBrowserVaultReplicaNotFoundError());
  if (cause === "empty session") mocks.control.mockResolvedValue({ state: "empty" });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ numbers: null, demographics: null, freshness: "stale" });
  expect(mocks.decode).not.toHaveBeenCalled();
  if (cause === "missing ref") expect(mocks.control).not.toHaveBeenCalled();
});

it("distinguishes no data from a missing metric bucket and hides decrypt error details", async () => {
  shards = await splitBrowserVaultReplica(fixture([]));
  expect((await (await GET(request())).json()).numbers).toEqual({ restingHeartRate: null, sleep: null, steps: null, vo2Max: null });
  const bucket = await getBrowserVaultMetricBucketId("estimated-vo2-max");
  const { [bucket]: omitted, ...remaining } = shards.metricBuckets;
  expect(omitted).toBeDefined();
  mocks.decode.mockImplementationOnce(() => ({
    client: createBrowserVaultRouteQueryClient({ ...shards, metricBuckets: remaining }, ["core", "metricsIndex"], [bucket]),
  }));
  expect(await (await GET(request())).json()).toMatchObject({ error: { code: "NUMBERS_PROJECTION_UNAVAILABLE", retryable: true } });
  mocks.decode.mockRejectedValueOnce(new Error("synthetic private ciphertext locator"));
  const failed = await GET(request());
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("ciphertext locator");
});

it("fails closed without canonical timezone metadata", async () => {
  delete shards.core.meals;
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: "NUMBERS_PROJECTION_UNAVAILABLE" } });
});

it.each(["?memberId=another-member", "?from=2026-01-01", "?limit=7", "?refresh=1", "?x=&x=2"])("rejects undocumented parameters %s before saved-data I/O", async query => {
  const response = await GET(request(query));
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ error: { code: "NUMBERS_INVALID_REQUEST" } });
  expect(mocks.workspace).not.toHaveBeenCalled();
});

it("requires bearer access and consent before reading the replica", async () => {
  mocks.auth.mockRejectedValueOnce(hostedOnboardingError({ code: "UNAUTHORIZED", httpStatus: 401, message: "Sign in required." }));
  expect((await GET(request())).status).toBe(401);
  expect(mocks.authority).not.toHaveBeenCalled();
  mocks.authority.mockRejectedValueOnce(hostedOnboardingError({ code: "HOSTED_CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." }));
  expect((await GET(request())).status).toBe(403);
  expect(mocks.workspace).not.toHaveBeenCalled();
  expect(mocks.decode).not.toHaveBeenCalled();
});

it.each(["session", "access", "consent"])("withholds numbers when %s is lost after decryption", async kind => {
  const httpStatus = kind === "session" ? 401 : 403;
  const error = hostedOnboardingError({ code: "ACCESS_DENIED", httpStatus, message: "Access denied." });
  if (kind === "session") mocks.current.mockRejectedValue(error);
  else mocks.authority.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);
  const response = await GET(request());
  expect(mocks.decode).toHaveBeenCalledOnce();
  expect(response.status).toBe(httpStatus);
  expect(await response.text()).not.toContain("numbers");
});

it("requires distinct covered dates, ignores summary/comparator rows, and keeps one latest value per date", async () => {
  shards = await splitBrowserVaultReplica(fixture([
    ...[0, 1, 2].flatMap(offset => [
      row("steps", addDaysToIsoDate(from, offset), 100, "count"),
      row("steps", addDaysToIsoDate(stepsThrough, -offset), 200, "count"),
    ]),
    row("steps", stepsThrough, 300, "count", { observedAt: `${stepsThrough}T13:00:00Z`, sourceLabel: "WHOOP" }),
    row("steps", addDaysToIsoDate(from, 3), 900, "count", { statistic: "mean" }),
    row("steps", addDaysToIsoDate(stepsThrough, -3), 900, "count", { comparator: ">" }),
    row("steps", stepsThrough, 999, "count", { grain: "week" }),
    row("estimated-vo2-max", from, 40, "mL/kg/min"),
    row("estimated-vo2-max", through, 45, "mL/kg/min", { sourceLabel: null }),
  ]));
  const body = await (await GET(request())).json();
  expect(body.numbers.steps.daily).toHaveLength(6);
  expect(body.numbers.steps.latest).toEqual({ date: stepsThrough, value: 300 });
  expect(body.numbers.steps.source).toBe("WHOOP");
  expect(body.numbers.vo2Max.source).toBeNull();
  expect(body.numbers.steps.comparison).toBeNull();
  expect(body.numbers.vo2Max.comparison).toBeNull();
  expect(body.numbers.sleep).toBeNull();
});

it("keeps a day's summary over a later raw reading, and raw readings on days without one", async () => {
  const raw = { sourceFamily: "event", sourceKind: "observation" };
  shards = await splitBrowserVaultReplica(fixture([
    row("total-sleep-minutes", from, 400, "minutes", raw),
    row("total-sleep-minutes", through, 480, "minutes", { observedAt: `${through}T00:00:00.000Z`, sourceKind: "sleep-summary" }),
    row("total-sleep-minutes", through, 90, "minutes", { ...raw, id: "metric-row:raw", observedAt: `${through}T13:00:00.000Z` }),
  ]));
  const body = await (await GET(request())).json();
  expect(body.numbers.sleep.daily).toEqual([{ date: from, value: 400 }, { date: through, value: 480 }]);
  expect(body.numbers.sleep.latest).toEqual({ date: through, value: 480 });
});

it("uses catalog stale thresholds and returns null for data older than a year or in unsupported units", async () => {
  shards = await splitBrowserVaultReplica(fixture([
    row("resting-heart-rate", addDaysToIsoDate(through, -15), 60, "bpm"),
    row("total-sleep-minutes", addDaysToIsoDate(through, -14), 420, "minutes"),
    row("steps", addDaysToIsoDate(through, -365), 8000, "count"),
    row("steps", stepsThrough, 8000, "km"),
    row("estimated-vo2-max", addDaysToIsoDate(through, -45), 45, "mL/kg/min"),
  ]));
  const body = await (await GET(request())).json();
  expect(body.numbers.restingHeartRate.stale).toBe(true);
  expect(body.numbers.sleep.stale).toBe(false);
  expect(body.numbers.vo2Max.stale).toBe(false);
  expect(body.numbers.steps).toBeNull();
  vi.setSystemTime(new Date("2026-11-05T19:00:00Z"));
  expect((await (await GET(request())).json()).numbers.vo2Max.stale).toBe(true);
});


it("returns only resolved fields without the memory revision or DOB", async () => {
  const body = await (await GET(request())).json();
  expect(body.demographics).toEqual({ birthYear: 1986, birthYearPrecision: "exact", biologicalSex: "female", status: "resolved" });
  expect(JSON.stringify(body)).not.toContain("revision");
});

it("distinguishes legacy absence, known-null and unresolved fields", async () => {
  const replica = fixture();
  replica.generation = 17;
  delete replica.demographics;
  shards = await splitBrowserVaultReplica(parseBrowserVaultReplica(replica));
  expect((await (await GET(request())).json()).demographics).toBeNull();
  for (const status of ["resolved", "unresolved"] as const) {
    replica.generation = 18;
    replica.demographics = { birthYear: null, birthYearPrecision: null, biologicalSex: null, status, revision: "e".repeat(64) };
    shards = await splitBrowserVaultReplica(parseBrowserVaultReplica(replica));
    expect((await (await GET(request())).json()).demographics).toEqual({ birthYear: null, birthYearPrecision: null, biologicalSex: null, status });
  }
  // Memory the runtime couldn't read: the numbers still come back, with
  // demographics unknown so the app falls back to the phone.
  delete replica.demographics;
  shards = await splitBrowserVaultReplica(parseBrowserVaultReplica(replica));
  const unknown = await GET(request());
  expect(unknown.status).toBe(200);
  const body = await unknown.json();
  expect(body.demographics).toBeNull();
  expect(body.numbers).not.toBeNull();
});


it.each(["missing object", "empty session"])("keeps the empty answer for a generation-18 %s, demographics unknown", async cause => {
  if (cause === "missing object") mocks.control.mockRejectedValue(new CloudflareHostedControlBrowserVaultReplicaNotFoundError());
  else mocks.control.mockResolvedValue({ state: "empty" });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ numbers: null, demographics: null, freshness: "stale" });
});
