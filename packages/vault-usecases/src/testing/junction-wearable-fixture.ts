import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as coreRuntime from "@murphai/core";
import {
  importDeviceProviderSnapshot,
  type JunctionSnapshotInput,
} from "@murphai/importers";
import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  normalizeJunctionResourceName,
} from "@murphai/importers/device-providers/junction-resources";
import {
  buildMetricProjection,
  readVault,
  readVaultRawTolerant,
} from "@murphai/query";
import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  parseBrowserVaultReplica,
} from "@murphai/query/browser";
import {
  selectBrowserVaultBiomarkerPanel,
  type BrowserVaultBiomarkerMetricBinding,
  type BrowserVaultBiomarkerPanelStatus,
  type BrowserVaultBiomarkerTrendDefaults,
} from "@murphai/query/browser-biomarkers";

export const JUNCTION_WEARABLE_FIXTURE_PATH_ENV = "MURPH_JUNCTION_WEARABLE_FIXTURE_PATH";
export const JUNCTION_WEARABLE_HOSTED_REPLAY_FIXTURE_PATH_ENV =
  "MURPH_JUNCTION_WEARABLE_HOSTED_REPLAY_FIXTURE_PATH";
export const DEFAULT_JUNCTION_WEARABLE_FIXTURE_RELATIVE_PATH =
  ".runtime/tmp/wearable-fixture-capture/output/junction-wearables-sanitized.json";
export const DEFAULT_JUNCTION_WEARABLE_HOSTED_REPLAY_FIXTURE_RELATIVE_PATH =
  "packages/vault-usecases/fixtures/junction-wearables-hosted-smoke.sanitized.json";
export const JUNCTION_WEARABLE_FIXTURE_SUMMARY_RESOURCES = Object.freeze([
  ...JUNCTION_ALLOWED_SUMMARY_RESOURCES,
]);
export const JUNCTION_WEARABLE_FIXTURE_TIMESERIES_RESOURCES = Object.freeze([
  ...JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
]);
const JUNCTION_ALLOWED_SUMMARY_RESOURCE_NAMES: readonly string[] = JUNCTION_ALLOWED_SUMMARY_RESOURCES;
const JUNCTION_ALLOWED_TIMESERIES_RESOURCE_NAMES: readonly string[] = JUNCTION_ALLOWED_TIMESERIES_RESOURCES;
const DEFAULT_WEARABLE_TREND_DEFAULTS = {
  aggregation: "median",
  comparisonWindowDays: 30,
  latestWindowDays: 7,
  minimumPoints: 5,
} as const satisfies BrowserVaultBiomarkerTrendDefaults;

const HRV_RMSSD_TREND_DEFAULTS = {
  ...DEFAULT_WEARABLE_TREND_DEFAULTS,
  minimumPoints: 7,
} as const satisfies BrowserVaultBiomarkerTrendDefaults;

const DEEP_SLEEP_MINUTES_TREND_DEFAULTS = {
  ...DEFAULT_WEARABLE_TREND_DEFAULTS,
  latestWindowDays: 14,
  minimumPoints: 7,
} as const satisfies BrowserVaultBiomarkerTrendDefaults;

export const JUNCTION_WEARABLE_BROWSER_VAULT_BIOMARKER_EXPECTATIONS = [
  wearableBiomarkerExpectation({
    biomarkerKey: "biomarker:deep-sleep-minutes",
    label: "Deep sleep",
    metricKey: "deep-sleep-minutes",
    trendDefaults: DEEP_SLEEP_MINUTES_TREND_DEFAULTS,
    unit: "minutes",
    valuePrecision: 0,
  }),
  wearableBiomarkerExpectation({
    biomarkerKey: "biomarker:hrv-rmssd",
    label: "HRV",
    metricKey: "hrv-rmssd",
    trendDefaults: HRV_RMSSD_TREND_DEFAULTS,
    unit: "ms",
    valuePrecision: 0,
  }),
  wearableBiomarkerExpectation({
    biomarkerKey: "biomarker:rem-sleep-minutes",
    label: "REM",
    metricKey: "rem-sleep-minutes",
    unit: "minutes",
    valuePrecision: 0,
  }),
  wearableBiomarkerExpectation({
    biomarkerKey: "biomarker:resting-heart-rate",
    label: "RHR",
    metricKey: "resting-heart-rate",
    unit: "bpm",
    valuePrecision: 0,
  }),
] as const satisfies readonly JunctionWearableBiomarkerPanelExpectation[];

export const JUNCTION_WEARABLE_BROWSER_VAULT_METRIC_EXPECTATIONS = [
  { metricKey: "activity-minutes", minimumRows: 5 },
  { metricKey: "body-weight", minimumRows: 1 },
  { metricKey: "deep-sleep-minutes", minimumRows: 7 },
  { metricKey: "hrv-rmssd", minimumRows: 7 },
  { metricKey: "readiness-score", minimumRows: 3 },
  { metricKey: "rem-sleep-minutes", minimumRows: 5 },
  { metricKey: "resting-heart-rate", minimumRows: 5 },
  { metricKey: "sleep-score", minimumRows: 5 },
  { metricKey: "steps", minimumRows: 5 },
  { metricKey: "total-sleep-minutes", minimumRows: 5 },
] as const satisfies readonly JunctionWearableMetricRowExpectation[];

function wearableBiomarkerExpectation(input: {
  biomarkerKey: string;
  label: string;
  metricKey: string;
  minimumRows?: number;
  trendDefaults?: BrowserVaultBiomarkerTrendDefaults;
  unit: string;
  valuePrecision: number;
}): JunctionWearableBiomarkerPanelExpectation {
  const minimumRows = input.minimumRows ?? input.trendDefaults?.minimumPoints ?? 5;
  return {
    biomarkerKey: input.biomarkerKey,
    label: input.label,
    metricKey: input.metricKey,
    minimumRows,
    privateMetricBindings: [{
      metricKey: input.metricKey,
      role: "primary",
      source: "metric",
    }],
    trendDefaults: input.trendDefaults ?? {
      ...DEFAULT_WEARABLE_TREND_DEFAULTS,
      minimumPoints: minimumRows,
    },
    unit: input.unit,
    valuePrecision: input.valuePrecision,
  };
}

const SUMMARY_RESOURCE_PREFIX = "junction-summary-";
const TIMESERIES_RESOURCE_PREFIX = "junction-timeseries-";
const PROVIDER_SNAPSHOT_RESOURCE = "junction-provider-snapshot";
const RAW_RECEIPT_RESOURCE_PREFIX = "junction-raw-ingest-receipt-";
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/gu;
const SENSITIVE_KEY_PATTERN =
  /(?:authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password|secret|email|phone)/iu;
const HOSTED_REPLAY_WEBHOOK_DATA_JSON_MAX_BYTES = 64_000;
const DEFAULT_HOSTED_REPLAY_RECORD_LIMIT_PER_PROVIDER_RESOURCE = 24;

export type JunctionWearableHostedReplaySize = "smoke" | "full";

type RiskPatternName =
  | "accessTokenKeyword"
  | "bearerLike"
  | "email"
  | "homePath"
  | "jwtLike"
  | "uuidLike"
  | "whsecLike";

export interface JunctionWearableFixtureE2eInput {
  env?: NodeJS.ProcessEnv;
  fixturePath?: string;
  keepVaultRoot?: boolean;
}

export interface JunctionWearableHostedReplayPlanInput {
  allowDroppedRecords?: boolean;
  env?: NodeJS.ProcessEnv;
  fixturePath?: string;
  maxRecordsPerProviderResource?: number | null;
  replaySize?: JunctionWearableHostedReplaySize;
}

export interface JunctionWearableBiomarkerPanelExpectation {
  biomarkerKey: string;
  label: string;
  metricKey: string;
  minimumRows: number;
  privateMetricBindings: readonly BrowserVaultBiomarkerMetricBinding[];
  trendDefaults: BrowserVaultBiomarkerTrendDefaults;
  unit: string;
  valuePrecision: number;
}

export interface JunctionWearableMetricRowExpectation {
  metricKey: string;
  minimumRows: number;
}

export interface JunctionWearableHostedReplayDirtyResource {
  count: number;
  jobKind: "resource";
  payload: Record<string, boolean | number | string>;
  resource: string;
  resourceCategory: "summary" | "timeseries";
  sourceProviderSlug: string;
  windowEnd: string;
  windowStart: string;
}

export interface JunctionWearableHostedReplayResourceSummary {
  droppedRecordCount: number;
  firstDate: string | null;
  lastDate: string | null;
  provider: string;
  recordCount: number;
  resource: string;
  resourceCategory: "summary" | "timeseries";
}

export interface JunctionWearableHostedReplaySource {
  displayName: string;
  sourceProviderSlug: string;
  targetPresent: boolean;
}

export interface JunctionWearableProviderFixtureCoverage {
  dayCount: number;
  firstDate: string | null;
  lastDate: string | null;
  provider: string;
  rawArtifactCount: number;
  resources: string[];
  targetPresent: boolean;
}

export interface JunctionWearableFixturePrivacyScan {
  droppedKeys: number | null;
  includedJsonFiles: number | null;
  includedJsonlRecords: number | null;
  pseudonymizedValues: number | null;
  riskyContextValueCount: number;
  riskyKeyValueCount: number;
  riskyValuePatternCounts: Record<RiskPatternName, number>;
  scannedFiles: number | null;
  shiftedDates: number | null;
}

export interface JunctionWearableFixtureBiomarkerPanelSummary {
  latestPresent: boolean;
  metricKey: string | null;
  sampleCount: number;
  seriesCount: number;
  status: BrowserVaultBiomarkerPanelStatus;
  warnings: string[];
}

export interface JunctionWearableFixtureMetricSummary {
  metricRowsByKey: Record<string, number>;
  rowCount: number;
  selectedMetricKeys: string[];
  selectionCount: number;
}

export interface JunctionWearableFixtureSourceHealthSummary {
  activityDays: number;
  firstDate: string | null;
  lastDate: string | null;
  provider: string;
  recoveryDays: number;
  selectedMetrics: number;
  sleepNights: number;
}

export interface JunctionWearableFixtureE2eResult {
  biomarkerPanels: Record<string, JunctionWearableFixtureBiomarkerPanelSummary>;
  fixture: {
    rawArtifactCount: number;
    sourceBundleHash: string;
  };
  generatedAt: string;
  metrics: JunctionWearableFixtureMetricSummary;
  privacyScan: JunctionWearableFixturePrivacyScan;
  providerCoverage: JunctionWearableProviderFixtureCoverage[];
  replay: {
    importedSnapshots: number;
    vaultEntityCount: number;
    vaultRoot: string | null;
  };
  sourceHealth: JunctionWearableFixtureSourceHealthSummary[];
}

export interface JunctionWearableBrowserVaultReplicaSummary {
  biomarkerPanels: Record<string, JunctionWearableFixtureBiomarkerPanelSummary>;
  metrics: JunctionWearableFixtureMetricSummary;
  sourceHealth: JunctionWearableFixtureSourceHealthSummary[];
}

export interface JunctionWearableHostedReplayPlan {
  connection: {
    displayName: string;
    externalAccountId: string;
    provider: "junction";
  };
  dirtyResources: JunctionWearableHostedReplayDirtyResource[];
  fixture: {
    rawArtifactCount: number;
    sourceBundleHash: string;
  };
  generatedAt: string;
  privacyScan: JunctionWearableFixturePrivacyScan;
  providerCoverage: JunctionWearableProviderFixtureCoverage[];
  replay: {
    droppedRecordCount: number;
    mode: "directDirtyResource";
    recordLimitPerProviderResource: number | null;
    size: JunctionWearableHostedReplaySize;
  };
  resources: JunctionWearableHostedReplayResourceSummary[];
  sources: JunctionWearableHostedReplaySource[];
}

export interface JunctionWearableBrowserVaultSummaryExpectationInput {
  biomarkerExpectations?: readonly JunctionWearableBiomarkerPanelExpectation[];
  metricExpectations?: readonly JunctionWearableMetricRowExpectation[];
}

export function summarizeJunctionWearableBrowserVaultReplica(input: {
  generatedAt: string;
  replica: unknown;
}): JunctionWearableBrowserVaultReplicaSummary {
  const replica = parseBrowserVaultReplica(input.replica);
  const client = createBrowserVaultQueryClient(replica);

  return {
    biomarkerPanels: summarizeJunctionWearableBiomarkerPanels({ client, generatedAt: input.generatedAt }),
    metrics: summarizeMetrics(replica.metricRows, replica.metricSelectionRows),
    sourceHealth: replica.sourceHealthRows.map((row) => ({
      activityDays: row.activityDays,
      firstDate: row.firstDate,
      lastDate: row.lastDate,
      provider: row.provider,
      recoveryDays: row.recoveryDays,
      selectedMetrics: row.selectedMetrics,
      sleepNights: row.sleepNights,
    })),
  };
}

interface FixtureArtifact {
  content: unknown;
  relativePath: string;
}

interface ParsedFixture {
  artifacts: FixtureArtifact[];
  record: Record<string, unknown>;
}

interface ReplayGroup {
  artifacts: FixtureArtifact[];
  dates: Set<string>;
  manifest: Record<string, unknown> | null;
}

interface ProviderCoverageAccumulator {
  dates: Set<string>;
  provider: string;
  rawArtifactCount: number;
  resources: Set<string>;
  targetPresent: boolean;
}

interface HostedReplayRecordGroup {
  provider: string;
  records: Record<string, unknown>[];
  resource: string;
  resourceCategory: "summary" | "timeseries";
}

export async function resolveJunctionWearableFixturePath(input: {
  env?: NodeJS.ProcessEnv;
  fixturePath?: string;
} = {}): Promise<string> {
  const explicitPath =
    input.fixturePath?.trim()
    || input.env?.[JUNCTION_WEARABLE_FIXTURE_PATH_ENV]?.trim()
    || process.env[JUNCTION_WEARABLE_FIXTURE_PATH_ENV]?.trim();
  const repoRoot = await findRepoRoot(process.cwd());
  return resolveRepoRelativePath(
    repoRoot,
    explicitPath ?? DEFAULT_JUNCTION_WEARABLE_FIXTURE_RELATIVE_PATH,
  );
}

export async function resolveJunctionWearableHostedReplayFixturePath(input: {
  env?: NodeJS.ProcessEnv;
  fixturePath?: string;
} = {}): Promise<string> {
  const explicitPath =
    input.fixturePath?.trim()
    || input.env?.[JUNCTION_WEARABLE_HOSTED_REPLAY_FIXTURE_PATH_ENV]?.trim()
    || process.env[JUNCTION_WEARABLE_HOSTED_REPLAY_FIXTURE_PATH_ENV]?.trim();
  const repoRoot = await findRepoRoot(process.cwd());
  return resolveRepoRelativePath(
    repoRoot,
    explicitPath ?? DEFAULT_JUNCTION_WEARABLE_HOSTED_REPLAY_FIXTURE_RELATIVE_PATH,
  );
}

function resolveRepoRelativePath(repoRoot: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

export async function runJunctionWearableFixtureE2e(
  input: JunctionWearableFixtureE2eInput = {},
): Promise<JunctionWearableFixtureE2eResult> {
  const fixturePath = await resolveJunctionWearableFixturePath(input);
  const fixtureText = await readFixtureText(fixturePath);
  const fixture = parseFixture(fixtureText);
  const privacyScan = scanFixturePrivacy(fixture);
  assertFixturePrivacySafe(privacyScan);
  const providerCoverage = buildProviderCoverage(fixture);
  const generatedAt = buildGeneratedAt(providerCoverage);
  const sourceBundleHash = createHash("sha256").update(fixtureText).digest("hex");
  const snapshots = buildJunctionSnapshotsFromFixture(fixture, generatedAt);
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-junction-wearable-fixture-"));

  try {
    await coreRuntime.initializeVault({
      createdAt: generatedAt,
      vaultRoot,
    });

    for (const snapshot of snapshots) {
      await importDeviceProviderSnapshot(
        {
          provider: "junction",
          snapshot,
          vaultRoot,
        },
        { corePort: coreRuntime },
      );
    }

    const vault = await readVault(vaultRoot);
    const rawVault = await readVaultRawTolerant(vaultRoot);
    const projection = buildMetricProjection(rawVault);
    const replica = await createBrowserVaultReplica({
      generatedAt,
      metricPoints: projection.metricPoints,
      sourceBundleHash,
      vault,
    });
    const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));

    return {
      biomarkerPanels: summarizeJunctionWearableBiomarkerPanels({ client, generatedAt }),
      fixture: {
        rawArtifactCount: fixture.artifacts.length,
        sourceBundleHash,
      },
      generatedAt,
      metrics: summarizeMetrics(replica.metricRows, replica.metricSelectionRows),
      privacyScan,
      providerCoverage,
      replay: {
        importedSnapshots: snapshots.length,
        vaultEntityCount: vault.entities.length,
        vaultRoot: input.keepVaultRoot === true ? vaultRoot : null,
      },
      sourceHealth: replica.sourceHealthRows.map((row) => ({
        activityDays: row.activityDays,
        firstDate: row.firstDate,
        lastDate: row.lastDate,
        provider: row.provider,
        recoveryDays: row.recoveryDays,
        selectedMetrics: row.selectedMetrics,
        sleepNights: row.sleepNights,
      })),
    };
  } finally {
    if (input.keepVaultRoot !== true) {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  }
}

export async function buildJunctionWearableHostedReplayPlan(
  input: JunctionWearableHostedReplayPlanInput = {},
): Promise<JunctionWearableHostedReplayPlan> {
  const replayOptions = normalizeHostedReplayOptions(input);
  const fixturePath = await resolveJunctionWearableHostedReplayFixturePath(input);
  const fixtureText = await readFixtureText(
    fixturePath,
    JUNCTION_WEARABLE_HOSTED_REPLAY_FIXTURE_PATH_ENV,
  );
  const fixture = parseFixture(fixtureText);
  const privacyScan = scanFixturePrivacy(fixture);
  assertFixturePrivacySafe(privacyScan);
  assertHostedReplayFixtureRedactionProof(fixture, privacyScan);
  const providerCoverage = buildProviderCoverage(fixture);
  const generatedAt = buildGeneratedAt(providerCoverage);
  const sourceBundleHash = createHash("sha256").update(fixtureText).digest("hex");
  const groups = buildHostedReplayRecordGroups(
    fixture,
    replayOptions.recordLimitPerProviderResource,
  );
  const replay = buildHostedReplayDirtyResources(groups, generatedAt);
  assertHostedReplayDroppedRecordsAllowed(replay.resources, replayOptions.allowDroppedRecords);

  return {
    connection: {
      displayName: "Junction wearable fixture",
      externalAccountId: "junction-wearable-fixture-account",
      provider: "junction",
    },
    dirtyResources: replay.dirtyResources,
    fixture: {
      rawArtifactCount: fixture.artifacts.length,
      sourceBundleHash,
    },
    generatedAt,
    privacyScan,
    providerCoverage,
    replay: {
      droppedRecordCount: sumDroppedHostedReplayRecords(replay.resources),
      mode: "directDirtyResource",
      recordLimitPerProviderResource: replayOptions.recordLimitPerProviderResource,
      size: replayOptions.size,
    },
    resources: replay.resources,
    sources: buildHostedReplaySources(providerCoverage, groups),
  };
}

export function promoteWearableCaptureToJunctionHostedSmokeFixture(
  capture: unknown,
  input: { sourceExportHash?: string } = {},
): Record<string, unknown> {
  const record = readRecord(capture);
  if (!record) {
    throw new Error("Wearable capture fixture must be a JSON object.");
  }
  if (readString(record.schema) !== "murph.wearable-fixture-capture.v1") {
    throw new Error("Wearable capture fixture must declare the capture schema.");
  }

  const sourceExportHash =
    input.sourceExportHash
    ?? createHash("sha256").update(JSON.stringify(record)).digest("hex");
  if (!/^[0-9a-f]{64}$/iu.test(sourceExportHash)) {
    throw new Error("Hosted-smoke fixture promotion requires a SHA-256 source export hash.");
  }

  const hostedSmokeRecord = { ...record };
  delete hostedSmokeRecord.eventLedgers;
  delete hostedSmokeRecord.metricSampleLedgers;

  return {
    ...hostedSmokeRecord,
    fixtureKind: "hosted-smoke",
    schema: "murph.junction-wearables-sanitized-fixture.v1",
    sourceExportHash,
  };
}

export function normalizeJunctionProviderSlugForComparison(provider: string): string {
  return provider
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function collectJunctionWearableBrowserVaultSummaryFailures(
  summary: JunctionWearableBrowserVaultReplicaSummary,
  input: JunctionWearableBrowserVaultSummaryExpectationInput = {},
): string[] {
  const metricExpectations =
    input.metricExpectations ?? JUNCTION_WEARABLE_BROWSER_VAULT_METRIC_EXPECTATIONS;
  const biomarkerExpectations =
    input.biomarkerExpectations ?? JUNCTION_WEARABLE_BROWSER_VAULT_BIOMARKER_EXPECTATIONS;
  const failures: string[] = [];

  for (const expectation of metricExpectations) {
    const rowCount = summary.metrics.metricRowsByKey[expectation.metricKey] ?? 0;
    if (rowCount < expectation.minimumRows) {
      failures.push(
        `metric ${expectation.metricKey} rows ${rowCount} < ${expectation.minimumRows}`,
      );
    }
  }

  const selectedMetricKeys = new Set(summary.metrics.selectedMetricKeys);
  for (const expectation of metricExpectations) {
    if (!selectedMetricKeys.has(expectation.metricKey)) {
      failures.push(`metric ${expectation.metricKey} is not selected`);
    }
  }

  for (const expectation of biomarkerExpectations) {
    const panel = summary.biomarkerPanels[expectation.biomarkerKey];
    if (!panel) {
      failures.push(`biomarker ${expectation.biomarkerKey} panel missing`);
      continue;
    }
    if (panel.metricKey !== expectation.metricKey) {
      failures.push(
        `biomarker ${expectation.biomarkerKey} metric ${String(panel.metricKey)} != ${expectation.metricKey}`,
      );
    }
    if (panel.status !== "ready") {
      failures.push(`biomarker ${expectation.biomarkerKey} status ${panel.status}`);
    }
    if (!panel.latestPresent) {
      failures.push(`biomarker ${expectation.biomarkerKey} latest missing`);
    }
    if (panel.sampleCount < expectation.minimumRows) {
      failures.push(
        `biomarker ${expectation.biomarkerKey} samples ${panel.sampleCount} < ${expectation.minimumRows}`,
      );
    }
    if (panel.seriesCount < expectation.minimumRows) {
      failures.push(
        `biomarker ${expectation.biomarkerKey} series ${panel.seriesCount} < ${expectation.minimumRows}`,
      );
    }
  }

  return failures;
}

export function assertJunctionWearableBrowserVaultSummary(
  summary: JunctionWearableBrowserVaultReplicaSummary,
  input: JunctionWearableBrowserVaultSummaryExpectationInput = {},
): void {
  const failures = collectJunctionWearableBrowserVaultSummaryFailures(summary, input);
  if (failures.length === 0) {
    return;
  }

  throw new Error(
    [
      "Junction wearable browser-vault summary did not satisfy expected biomarker contract.",
      ...failures,
      `summary=${JSON.stringify({
        biomarkerPanels: summary.biomarkerPanels,
        metricRowsByKey: summary.metrics.metricRowsByKey,
        selectedMetricKeys: summary.metrics.selectedMetricKeys,
        sourceHealth: summary.sourceHealth,
      })}`,
    ].join("\n"),
  );
}

async function readFixtureText(
  fixturePath: string,
  pathEnvName: string = JUNCTION_WEARABLE_FIXTURE_PATH_ENV,
): Promise<string> {
  try {
    return await readFile(fixturePath, "utf8");
  } catch {
    throw new Error(
      [
        "Unable to read the Junction wearable fixture.",
        `Set ${pathEnvName} to a sanitized fixture export or run the local capture helper first.`,
      ].join(" "),
    );
  }
}

function normalizeHostedReplayOptions(
  input: JunctionWearableHostedReplayPlanInput,
): {
  allowDroppedRecords: boolean;
  recordLimitPerProviderResource: number | null;
  size: JunctionWearableHostedReplaySize;
} {
  const size = input.replaySize ?? "smoke";
  if (size !== "smoke" && size !== "full") {
    throw new TypeError("replaySize must be smoke or full.");
  }

  const recordLimitPerProviderResource = normalizeHostedReplayRecordLimit(
    input.maxRecordsPerProviderResource,
    size,
  );
  return {
    allowDroppedRecords: input.allowDroppedRecords === true,
    recordLimitPerProviderResource,
    size: recordLimitPerProviderResource === null ? "full" : "smoke",
  };
}

function normalizeHostedReplayRecordLimit(
  value: number | null | undefined,
  size: JunctionWearableHostedReplaySize,
): number | null {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return size === "full" ? null : DEFAULT_HOSTED_REPLAY_RECORD_LIMIT_PER_PROVIDER_RESOURCE;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError("maxRecordsPerProviderResource must be a positive integer or null.");
  }
  return value;
}

function assertHostedReplayDroppedRecordsAllowed(
  resources: readonly JunctionWearableHostedReplayResourceSummary[],
  allowDroppedRecords: boolean,
): void {
  const dropped = resources.filter((resource) => resource.droppedRecordCount > 0);
  if (dropped.length === 0 || allowDroppedRecords) {
    return;
  }

  throw new Error(
    [
      "Hosted Junction replay fixture dropped oversized record(s).",
      "Pass allowDroppedRecords only for an explicitly partial replay.",
      `dropped=${JSON.stringify(dropped.map((resource) => ({
        provider: resource.provider,
        resource: resource.resource,
        resourceCategory: resource.resourceCategory,
        droppedRecordCount: resource.droppedRecordCount,
      })))}`,
    ].join(" "),
  );
}

function sumDroppedHostedReplayRecords(
  resources: readonly JunctionWearableHostedReplayResourceSummary[],
): number {
  return resources.reduce((total, resource) => total + resource.droppedRecordCount, 0);
}

function parseFixture(fixtureText: string): ParsedFixture {
  const parsed: unknown = JSON.parse(fixtureText);
  const record = readRecord(parsed);
  if (!record) {
    throw new Error("Junction wearable fixture must be a JSON object.");
  }

  const artifacts = readArray(record.rawArtifacts).flatMap((entry) => {
    const artifact = readArtifact(entry);
    return artifact ? [artifact] : [];
  });
  if (artifacts.length === 0) {
    throw new Error("Junction wearable fixture did not include raw artifacts.");
  }

  return { artifacts, record };
}

function buildHostedReplayRecordGroups(
  fixture: ParsedFixture,
  recordLimitPerProviderResource: number | null,
): HostedReplayRecordGroup[] {
  const groups = new Map<string, HostedReplayRecordGroup>();
  for (const artifact of fixture.artifacts) {
    const replayResource = hostedReplayResourceFromRelativePath(artifact.relativePath);
    if (!replayResource || !isHostedReplayResourceAllowed(replayResource)) {
      continue;
    }

    for (const entry of readArray(artifact.content)) {
      const record = readRecord(entry);
      if (!record) {
        continue;
      }

      const sourceProviderSlug = readSingleRecordProviderSlug(record);
      if (!sourceProviderSlug) {
        continue;
      }

      const key = [
        sourceProviderSlug,
        replayResource.resourceCategory,
        replayResource.resource,
      ].join(":");
      let group = groups.get(key);
      if (!group) {
        group = {
          provider: sourceProviderSlug,
          records: [],
          resource: replayResource.resource,
          resourceCategory: replayResource.resourceCategory,
        };
        groups.set(key, group);
      }
      group.records.push(record);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      records: selectHostedReplayRecords(group.records, recordLimitPerProviderResource),
    }))
    .filter((group) => group.records.length > 0)
    .sort((left, right) =>
      [
        left.provider.localeCompare(right.provider),
        left.resourceCategory.localeCompare(right.resourceCategory),
        left.resource.localeCompare(right.resource),
      ].find((comparison) => comparison !== 0) ?? 0
    );
}

function hostedReplayResourceFromRelativePath(
  relativePath: string,
): { resource: string; resourceCategory: "summary" | "timeseries" } | null {
  const resourceName = resourceNameFromRelativePath(relativePath);
  if (!resourceName) {
    return null;
  }

  if (resourceName.startsWith(SUMMARY_RESOURCE_PREFIX)) {
    const resource = normalizeJunctionResourceName(
      resourceName.slice(SUMMARY_RESOURCE_PREFIX.length),
    );
    return resource ? { resource, resourceCategory: "summary" } : null;
  }

  if (resourceName.startsWith(TIMESERIES_RESOURCE_PREFIX)) {
    const resource = normalizeJunctionResourceName(
      resourceName.slice(TIMESERIES_RESOURCE_PREFIX.length),
    );
    return resource ? { resource, resourceCategory: "timeseries" } : null;
  }

  return null;
}

function isHostedReplayResourceAllowed(input: {
  resource: string;
  resourceCategory: "summary" | "timeseries";
}): boolean {
  return input.resourceCategory === "summary"
    ? JUNCTION_ALLOWED_SUMMARY_RESOURCE_NAMES.includes(input.resource)
    : JUNCTION_ALLOWED_TIMESERIES_RESOURCE_NAMES.includes(input.resource);
}

function selectHostedReplayRecords(
  records: readonly Record<string, unknown>[],
  recordLimit: number | null,
): Record<string, unknown>[] {
  const sorted = [...records].sort((left, right) => {
    const byDate = latestIsoDate(right).localeCompare(latestIsoDate(left));
    return byDate !== 0 ? byDate : stableRecordHash(right).localeCompare(stableRecordHash(left));
  });

  return recordLimit === null
    ? sorted
    : sorted.slice(0, Math.max(1, Math.trunc(recordLimit)));
}

function buildHostedReplayDirtyResources(
  groups: readonly HostedReplayRecordGroup[],
  generatedAt: string,
): {
  dirtyResources: JunctionWearableHostedReplayDirtyResource[];
  resources: JunctionWearableHostedReplayResourceSummary[];
} {
  const dirtyResources: JunctionWearableHostedReplayDirtyResource[] = [];
  const resources: JunctionWearableHostedReplayResourceSummary[] = [];

  for (const group of groups) {
    const dates = collectIsoDates(group.records);
    const sortedDates = [...dates].sort();
    const windowStart = sortedDates[0] ? `${sortedDates[0]}T00:00:00.000Z` : generatedAt;
    const windowEnd = sortedDates.at(-1) ? `${sortedDates.at(-1)}T23:59:59.999Z` : generatedAt;
    let droppedRecordCount = 0;
    let recordCount = 0;

    for (const record of group.records) {
      const webhookDataJson = JSON.stringify(record);
      if (Buffer.byteLength(webhookDataJson, "utf8") > HOSTED_REPLAY_WEBHOOK_DATA_JSON_MAX_BYTES) {
        droppedRecordCount += 1;
        continue;
      }

      recordCount += 1;
      dirtyResources.push({
        count: 1,
        jobKind: "resource",
        payload: {
          eventType: buildHostedReplayJunctionDataEventType(group.resource),
          objectId: `fixture-${stableRecordHash(record).slice(0, 24)}`,
          occurredAt: windowEnd,
          resource: group.resource,
          resourceCategory: group.resourceCategory,
          sourceProviderSlug: group.provider,
          webhookDataJson,
          windowEnd,
          windowStart,
        },
        resource: group.resource,
        resourceCategory: group.resourceCategory,
        sourceProviderSlug: group.provider,
        windowEnd,
        windowStart,
      });
    }

    resources.push({
      droppedRecordCount,
      firstDate: sortedDates[0] ?? null,
      lastDate: sortedDates.at(-1) ?? null,
      provider: group.provider,
      recordCount,
      resource: group.resource,
      resourceCategory: group.resourceCategory,
    });
  }

  return { dirtyResources, resources };
}

function buildHostedReplayJunctionDataEventType(resource: string): string {
  const eventResource = (() => {
    switch (resource) {
      case "heartrate":
        return "heart_rate";
      case "weight":
        return "body_weight";
      default:
        return resource;
    }
  })();
  return `daily.data.${eventResource}.created`;
}

function buildHostedReplaySources(
  providerCoverage: readonly JunctionWearableProviderFixtureCoverage[],
  groups: readonly HostedReplayRecordGroup[],
): JunctionWearableHostedReplaySource[] {
  const dataProviders = new Set(groups.map((group) => group.provider));
  return providerCoverage
    .filter((coverage) => coverage.targetPresent || dataProviders.has(coverage.provider))
    .map((coverage) => ({
      displayName: displayNameForJunctionSourceProvider(coverage.provider),
      sourceProviderSlug: coverage.provider,
      targetPresent: coverage.targetPresent,
    }))
    .sort((left, right) => left.sourceProviderSlug.localeCompare(right.sourceProviderSlug));
}

function displayNameForJunctionSourceProvider(provider: string): string {
  switch (provider) {
    case "garmin":
      return "Garmin";
    case "oura":
      return "Oura";
    case "whoop_v2":
      return "WHOOP";
    default:
      return provider
        .split(/[_-]+/u)
        .filter(Boolean)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(" ");
  }
}

function readSingleRecordProviderSlug(record: Record<string, unknown>): string | null {
  const providers = collectDirectProviderSlugs(record);
  return providers.size === 1 ? [...providers][0] ?? null : null;
}

function readArtifact(value: unknown): FixtureArtifact | null {
  const record = readRecord(value);
  if (!record) return null;

  const relativePath = readString(record.relativePath);
  if (!relativePath) return null;

  return {
    content: record.content,
    relativePath,
  };
}

function scanFixturePrivacy(fixture: ParsedFixture): JunctionWearableFixturePrivacyScan {
  const riskyValuePatternCounts = createEmptyRiskPatternCounts();
  let riskyContextValueCount = 0;
  let riskyKeyValueCount = 0;

  const visit = (value: unknown, keyPath: readonly string[] = []): void => {
    if (typeof value === "string") {
      for (const [name, pattern] of Object.entries(RISK_VALUE_PATTERNS) as Array<[RiskPatternName, RegExp]>) {
        if (pattern.test(value)) {
          riskyValuePatternCounts[name] += 1;
        }
      }
      if (isRiskyContextValue(keyPath.at(-1) ?? "", value)) {
        riskyContextValueCount += 1;
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, keyPath);
      return;
    }

    const record = readRecord(value);
    if (!record) return;

    for (const [key, child] of Object.entries(record)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && hasNonEmptyPrimitive(child)) {
        riskyKeyValueCount += 1;
      }
      visit(child, [...keyPath, key]);
    }
  };

  visit(fixture.record);

  const redactionReport = readRecord(fixture.record.redactionReport);
  return {
    droppedKeys: readNumber(redactionReport?.droppedKeys),
    includedJsonFiles: readNumber(redactionReport?.includedJsonFiles),
    includedJsonlRecords: readNumber(redactionReport?.includedJsonlRecords),
    pseudonymizedValues: readNumber(redactionReport?.pseudonymizedValues),
    riskyContextValueCount,
    riskyKeyValueCount,
    riskyValuePatternCounts,
    scannedFiles: readNumber(redactionReport?.scannedFiles),
    shiftedDates: readNumber(redactionReport?.shiftedDates),
  };
}

function assertFixturePrivacySafe(privacyScan: JunctionWearableFixturePrivacyScan): void {
  const riskyPatternEntries = Object.entries(privacyScan.riskyValuePatternCounts)
    .filter(([, count]) => count > 0);
  if (
    privacyScan.riskyKeyValueCount === 0
    && privacyScan.riskyContextValueCount === 0
    && riskyPatternEntries.length === 0
  ) {
    return;
  }

  throw new Error(
    [
      "Junction wearable fixture is privacy unsafe.",
      `riskyKeyValueCount=${privacyScan.riskyKeyValueCount}`,
      `riskyContextValueCount=${privacyScan.riskyContextValueCount}`,
      `riskyValuePatterns=${riskyPatternEntries.map(([name, count]) => `${name}:${count}`).join(",") || "none"}`,
    ].join(" "),
  );
}

function assertHostedReplayFixtureRedactionProof(
  fixture: ParsedFixture,
  privacyScan: JunctionWearableFixturePrivacyScan,
): void {
  if (readString(fixture.record.schema) !== "murph.junction-wearables-sanitized-fixture.v1") {
    throw new Error("Hosted Junction replay fixture must declare the sanitized fixture schema.");
  }
  if (readString(fixture.record.fixtureKind) !== "hosted-smoke") {
    throw new Error("Hosted Junction replay fixture must declare fixtureKind hosted-smoke.");
  }
  const sourceExportHash = readString(fixture.record.sourceExportHash);
  if (!sourceExportHash || !/^[0-9a-f]{64}$/iu.test(sourceExportHash)) {
    throw new Error("Hosted Junction replay fixture must include a source export hash.");
  }
  if ((privacyScan.scannedFiles ?? 0) <= 0) {
    throw new Error("Hosted Junction replay fixture must include redaction scanned file proof.");
  }
  if ((privacyScan.includedJsonFiles ?? 0) <= 0 && (privacyScan.includedJsonlRecords ?? 0) <= 0) {
    throw new Error("Hosted Junction replay fixture must include redaction input-count proof.");
  }
  if ((privacyScan.pseudonymizedValues ?? 0) <= 0) {
    throw new Error("Hosted Junction replay fixture must include pseudonymization proof.");
  }
  if ((privacyScan.shiftedDates ?? 0) <= 0) {
    throw new Error("Hosted Junction replay fixture must include date-shift proof.");
  }
}

const RISK_VALUE_PATTERNS: Record<RiskPatternName, RegExp> = {
  accessTokenKeyword: /access[_-]?token/iu,
  bearerLike: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/u,
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  homePath: /\/Users\/[^/\s"]+/u,
  jwtLike: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
  uuidLike: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
  whsecLike: /\bwhsec_[A-Za-z0-9]{10,}\b/u,
};

const CONTEXT_KEY_NAMES = new Set([
  "address",
  "city",
  "country",
  "county",
  "location",
  "locality",
  "place",
  "placename",
  "postalcode",
  "postcode",
  "route",
  "state",
  "street",
  "title",
  "zipcode",
]);

function isRiskyContextValue(key: string, value: string): boolean {
  if (!CONTEXT_KEY_NAMES.has(normalizeFixtureKey(key))) {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0
    && trimmed !== "<redacted>"
    && !/^fixture-[a-z0-9]+-\d+$/u.test(trimmed);
}

function normalizeFixtureKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function createEmptyRiskPatternCounts(): Record<RiskPatternName, number> {
  return {
    accessTokenKeyword: 0,
    bearerLike: 0,
    email: 0,
    homePath: 0,
    jwtLike: 0,
    uuidLike: 0,
    whsecLike: 0,
  };
}

function buildProviderCoverage(fixture: ParsedFixture): JunctionWearableProviderFixtureCoverage[] {
  const targets = collectTargetProviderSlugs(fixture.record);
  const byProvider = new Map<string, ProviderCoverageAccumulator>();
  for (const provider of targets) {
    ensureProviderCoverage(byProvider, provider).targetPresent = true;
  }

  for (const artifact of fixture.artifacts) {
    const resource = resourceNameFromRelativePath(artifact.relativePath);
    if (!resource || resource === "manifest" || resource.startsWith(RAW_RECEIPT_RESOURCE_PREFIX)) {
      continue;
    }

    const providerDates = collectProviderDateBuckets(artifact.content);
    for (const [provider, dates] of providerDates) {
      const coverage = ensureProviderCoverage(byProvider, provider);
      coverage.rawArtifactCount += 1;
      coverage.resources.add(resource);
      for (const date of dates) coverage.dates.add(date);
    }
  }

  return [...byProvider.values()]
    .map((coverage) => {
      const dates = [...coverage.dates].sort();
      return {
        dayCount: dates.length,
        firstDate: dates[0] ?? null,
        lastDate: dates.at(-1) ?? null,
        provider: coverage.provider,
        rawArtifactCount: coverage.rawArtifactCount,
        resources: [...coverage.resources].sort(),
        targetPresent: coverage.targetPresent,
      };
    })
    .sort((left, right) => left.provider.localeCompare(right.provider));
}

function ensureProviderCoverage(
  byProvider: Map<string, ProviderCoverageAccumulator>,
  provider: string,
): ProviderCoverageAccumulator {
  const existing = byProvider.get(provider);
  if (existing) return existing;

  const created: ProviderCoverageAccumulator = {
    dates: new Set(),
    provider,
    rawArtifactCount: 0,
    resources: new Set(),
    targetPresent: false,
  };
  byProvider.set(provider, created);
  return created;
}

function buildGeneratedAt(providerCoverage: readonly JunctionWearableProviderFixtureCoverage[]): string {
  const latestDate = providerCoverage
    .flatMap((coverage) => coverage.lastDate ? [coverage.lastDate] : [])
    .sort()
    .at(-1);
  return `${latestDate ?? "2026-01-01"}T12:00:00.000Z`;
}

function buildJunctionSnapshotsFromFixture(
  fixture: ParsedFixture,
  generatedAt: string,
): JunctionSnapshotInput[] {
  const groups = new Map<string, ReplayGroup>();
  for (const artifact of fixture.artifacts) {
    const groupKey = path.posix.dirname(artifact.relativePath);
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        artifacts: [],
        dates: new Set(),
        manifest: null,
      };
      groups.set(groupKey, group);
    }

    const resource = resourceNameFromRelativePath(artifact.relativePath);
    if (resource === "manifest") {
      group.manifest = readRecord(artifact.content);
    } else {
      group.artifacts.push(artifact);
    }

    for (const date of collectIsoDates(artifact.content)) {
      group.dates.add(date);
    }
  }

  return [...groups.values()]
    .map((group) => buildSnapshotFromGroup(group, generatedAt))
    .filter((snapshot): snapshot is JunctionSnapshotInput => snapshot !== null);
}

function buildSnapshotFromGroup(
  group: ReplayGroup,
  generatedAt: string,
): JunctionSnapshotInput | null {
  const summaries: Record<string, unknown> = {};
  const timeseries: Record<string, unknown> = {};
  const connections: unknown[] = [];

  for (const artifact of group.artifacts) {
    const resource = resourceNameFromRelativePath(artifact.relativePath);
    if (!resource || resource.startsWith(RAW_RECEIPT_RESOURCE_PREFIX)) {
      continue;
    }

    if (resource === PROVIDER_SNAPSHOT_RESOURCE) {
      const providerSnapshot = readRecord(artifact.content);
      if (providerSnapshot) {
        connections.push(...readArray(providerSnapshot.connections));
        mergeRecordValues(summaries, readRecord(providerSnapshot.summaries));
        mergeRecordValues(timeseries, readRecord(providerSnapshot.timeseries));
      }
      continue;
    }

    if (resource.startsWith(SUMMARY_RESOURCE_PREFIX)) {
      summaries[normalizeResourceKey(resource.slice(SUMMARY_RESOURCE_PREFIX.length))] = artifact.content;
      continue;
    }

    if (resource.startsWith(TIMESERIES_RESOURCE_PREFIX)) {
      timeseries[normalizeResourceKey(resource.slice(TIMESERIES_RESOURCE_PREFIX.length))] = artifact.content;
    }
  }

  if (
    connections.length === 0
    && Object.keys(summaries).length === 0
    && Object.keys(timeseries).length === 0
  ) {
    return null;
  }

  const dates = [...group.dates].sort();
  const importedAt =
    readString(group.manifest?.importedAt)
    ?? readString(readRecord(group.manifest?.provenance)?.importedAt)
    ?? generatedAt;

  return {
    accountId: "junction-wearable-fixture-account",
    connections,
    importedAt,
    summaries,
    timeseries,
    windowEnd: dates.at(-1) ? `${dates.at(-1)}T23:59:59.999Z` : undefined,
    windowStart: dates[0] ? `${dates[0]}T00:00:00.000Z` : undefined,
  };
}

function summarizeJunctionWearableBiomarkerPanels(input: {
  client: ReturnType<typeof createBrowserVaultQueryClient>;
  generatedAt: string;
}): Record<string, JunctionWearableFixtureBiomarkerPanelSummary> {
  return Object.fromEntries(
    JUNCTION_WEARABLE_BROWSER_VAULT_BIOMARKER_EXPECTATIONS.map((expectation) => {
      const panel = selectBrowserVaultBiomarkerPanel({
        biomarkerKey: expectation.biomarkerKey,
        client: input.client,
        generatedAt: input.generatedAt,
        label: expectation.label,
        privateMetricBindings: expectation.privateMetricBindings,
        trendDefaults: expectation.trendDefaults,
        unit: expectation.unit,
        valuePrecision: expectation.valuePrecision,
      });

      return [expectation.biomarkerKey, summarizeBiomarkerPanel(panel)];
    }),
  );
}

function summarizeBiomarkerPanel(panel: {
  primary: {
    binding: { metricKey: string };
    latest: unknown;
    sampleCount: number;
    series: readonly unknown[];
  } | null;
  status: BrowserVaultBiomarkerPanelStatus;
  warnings: readonly { code: string }[];
}): JunctionWearableFixtureBiomarkerPanelSummary {
  return {
    latestPresent: panel.primary?.latest !== undefined && panel.primary.latest !== null,
    metricKey: panel.primary?.binding.metricKey ?? null,
    sampleCount: panel.primary?.sampleCount ?? 0,
    seriesCount: panel.primary?.series.length ?? 0,
    status: panel.status,
    warnings: panel.warnings.map((warning) => warning.code),
  };
}

function summarizeMetrics(
  metricRows: readonly { metricKey: string }[],
  metricSelectionRows: readonly { metricKey: string; selectedMetricRowId: string | null }[],
): JunctionWearableFixtureMetricSummary {
  const metricRowsByKey: Record<string, number> = {};
  for (const row of metricRows) {
    metricRowsByKey[row.metricKey] = (metricRowsByKey[row.metricKey] ?? 0) + 1;
  }

  return {
    metricRowsByKey,
    rowCount: metricRows.length,
    selectedMetricKeys: metricSelectionRows
      .filter((row) => row.selectedMetricRowId)
      .map((row) => row.metricKey)
      .sort(),
    selectionCount: metricSelectionRows.length,
  };
}

function mergeRecordValues(
  target: Record<string, unknown>,
  source: Record<string, unknown> | null,
): void {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    target[key] = value;
  }
}

function collectTargetProviderSlugs(fixtureRecord: Record<string, unknown>): Set<string> {
  const providers = new Set<string>();
  for (const target of readArray(fixtureRecord.targets)) {
    const record = readRecord(target);
    const provider = normalizeProviderSlug(
      readString(record?.slug)
      ?? readString(record?.provider)
      ?? readString(record?.providerSlug)
      ?? readString(record?.sourceProviderSlug),
    );
    if (provider) providers.add(provider);
  }
  return providers;
}

function collectProviderDateBuckets(value: unknown): Map<string, Set<string>> {
  const buckets = new Map<string, Set<string>>();
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }

    const record = readRecord(entry);
    if (!record) return;

    const providers = collectDirectProviderSlugs(record);
    if (providers.size > 0) {
      const dates = collectIsoDates(record);
      for (const provider of providers) {
        const bucket = buckets.get(provider) ?? new Set<string>();
        for (const date of dates) bucket.add(date);
        buckets.set(provider, bucket);
      }
    }

    for (const child of Object.values(record)) {
      visit(child);
    }
  };

  visit(value);
  return buckets;
}

function collectDirectProviderSlugs(record: Record<string, unknown>): Set<string> {
  const providers = new Set<string>();

    for (const [key, child] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase().replaceAll("_", "");
      if (
        normalizedKey === "sourceproviderslug"
        || normalizedKey === "sourceprovider"
        || normalizedKey === "providerslug"
        || normalizedKey === "provider"
      ) {
        const provider = normalizeProviderSlug(readString(child));
        if (provider && provider !== "junction") {
          providers.add(provider);
        }
      }
    }

  return providers;
}

function collectIsoDates(value: unknown): Set<string> {
  const dates = new Set<string>();
  const visit = (entry: unknown): void => {
    if (typeof entry === "string") {
      for (const match of entry.matchAll(ISO_DATE_PATTERN)) {
        dates.add(match[0]);
      }
      return;
    }

    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }

    const record = readRecord(entry);
    if (!record) return;
    for (const child of Object.values(record)) visit(child);
  };

  visit(value);
  return dates;
}

function latestIsoDate(value: unknown): string {
  return [...collectIsoDates(value)].sort().at(-1) ?? "";
}

function stableRecordHash(record: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

function resourceNameFromRelativePath(relativePath: string): string | null {
  const fileName = path.posix.basename(relativePath);
  if (fileName.startsWith("manifest.")) {
    return "manifest";
  }

  const withoutExtension = fileName.endsWith(".json") ? fileName.slice(0, -5) : fileName;
  const withoutOrderPrefix = withoutExtension.replace(/^\d+-/u, "");
  return withoutOrderPrefix || null;
}

function normalizeResourceKey(resource: string): string {
  return resource.replaceAll("-", "_");
}

function normalizeProviderSlug(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function hasNonEmptyPrimitive(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  return false;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function findRepoRoot(startDirectory: string): Promise<string> {
  let current = path.resolve(startDirectory);
  while (true) {
    if (await pathExists(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDirectory);
    }
    current = parent;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
