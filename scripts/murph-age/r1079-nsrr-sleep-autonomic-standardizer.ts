import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createGunzip, gzipSync } from "node:zlib";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import type { R1070NsrrSleepAutonomicAggregateReceiptInput } from "./r1070-nsrr-sleep-autonomic-aggregate-receipt.ts";
import { R1078_DEFAULT_ANALYTIC_CACHE_PATH } from "./r1078-nsrr-sleep-autonomic-local-loop.ts";

export const R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION =
  "murph-age-r1079-nsrr-sleep-autonomic-standardizer.v1" as const;

export const R1079_DEFAULT_PRIVATE_MANIFEST_PATH = path.join(
  ".runtime",
  "cache",
  "murph-age",
  "nsrr-sleep-autonomic",
  "private-maps",
  "nsrr-sleep-autonomic-standardizer-manifest.json",
);

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1079-nsrr-sleep-autonomic-standardizer.latest.json";
const ALLOWED_ANALYTIC_CACHE_ROOT = path.dirname(R1078_DEFAULT_ANALYTIC_CACHE_PATH);

const STANDARD_COLUMNS = [
  "split",
  "primary_event",
  "age_years",
  "sex_stratum",
  "analysis_weight",
  "eligible_endpoint",
  "body_mass_index",
  "systolic_blood_pressure",
  "diastolic_blood_pressure",
  "clinical_context_score",
  "sleep_duration_hours",
  "sleep_efficiency",
  "sleep_midpoint_variability",
  "sleep_regularity_index",
  "apnea_hypopnea_index",
  "mean_spo2",
  "min_spo2",
  "resting_heart_rate",
  "heart_rate_variability",
  "mean_daily_activity",
  "sedentary_minutes",
  "active_minutes",
  "sleep_wake_transition_count",
  "valid_night_count",
  "recording_minutes",
  "wear_time_minutes",
] as const;

const REQUIRED_MAPPED_COLUMNS = ["age_years", "primary_event", "sex_stratum"] as const;
const ALLOWED_ENDPOINTS = [
  "all_cause_mortality",
  "frailty_disability_or_functional_decline_auxiliary_head",
  "hospitalization_or_emergency_utilization",
  "incident_cardiometabolic_disease",
  "major_cardiovascular_event",
] as const;
const ALLOWED_HORIZONS = ["5y", "10y", "source_supported"] as const;
const OPTIONAL_DEFAULTS: Partial<Record<StandardColumn, string>> = {
  analysis_weight: "1",
  eligible_endpoint: "1",
};

type Endpoint = R1070NsrrSleepAutonomicAggregateReceiptInput["endpoint"];
type Horizon = R1070NsrrSleepAutonomicAggregateReceiptInput["horizon"];
type StandardColumn = typeof STANDARD_COLUMNS[number];
type Split = "calibration" | "test" | "train";
type SourceFormat = "csv" | "tsv";
type ValueSpec = string | { column: string } | { constant: number | string };

interface ColumnSplitPolicy {
  type: "column";
  value: ValueSpec;
}

interface RowIndexModuloSplitPolicy {
  calibrationRemainders?: number[];
  modulo?: number;
  testRemainders?: number[];
  trainRemainders?: number[];
  type: "row_index_modulo";
}

type SplitPolicy = ColumnSplitPolicy | RowIndexModuloSplitPolicy;

interface R1079Manifest {
  columnMap: Partial<Record<StandardColumn, ValueSpec>>;
  delimiter?: "," | "\t";
  endpoint: Endpoint;
  horizon: Horizon;
  outputAnalyticCachePath?: string;
  schemaVersion: typeof R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION;
  sourceFormat?: SourceFormat;
  sourceTablePath: string;
  splitPolicy?: SplitPolicy;
}

interface MaterializedRow {
  event: 0 | 1 | null;
  eligible: boolean;
  split: Split;
  values: Record<StandardColumn, string>;
}

export interface R1079NsrrSleepAutonomicStandardizerOptions {
  createdAt?: string;
  manifestPath?: string;
  outputAnalyticCachePath?: string;
  outputDir?: string;
}

export interface R1079NsrrSleepAutonomicStandardizerOutput {
  artifactBoundary: {
    aggregateOnlyExternalOutput: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    localRowCacheWritten: true;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    privateColumnMapRead: true;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceSpecificColumnNamesStored: false;
    splitMembershipStored: false;
  };
  cacheReceipt: {
    contentSha256: string;
    privateAnalyticCacheWritten: true;
    rowCacheScope: "ignored_local_runtime_cache_only";
  };
  createdAt: string;
  endpoint: Endpoint;
  horizon: Horizon;
  materialization: {
    eligibleEventCountBand: string;
    eligibleRowCountBand: string;
    mappedGenericFieldCountBand: string;
    missingGenericFieldCountBand: string;
    readyForR1078: boolean;
    sourceFormat: "csv_or_tsv";
    splitPolicy: "manifest_column" | "row_index_modulo";
    splitShape: Record<Split, { eventCountBand: string; rowCountBand: string }>;
    totalMaterializedRowCountBand: string;
  };
  nextStep: {
    conclusion:
      | "nsrr_standard_cache_materialized_but_sparse"
      | "nsrr_standard_cache_ready_for_r1078";
    nextLocalAction:
      | "inspect_private_cache_coverage_before_scoring"
      | "run_r1078_nsrr_sleep_autonomic_local_loop";
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  packetId: "r1079-nsrr-sleep-autonomic-standardizer";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION;
  standardAnalyticCacheContract: {
    cacheRoot: ".runtime/cache/murph-age/nsrr-sleep-autonomic/derived/analytic";
    localOnly: true;
    privateManifestRoot: ".runtime/cache/murph-age/nsrr-sleep-autonomic/private-maps";
    sourceSpecificColumnMapStoredInGit: false;
  };
  status: "research-local-private-cache-plus-aggregate-receipt";
  summary: {
    analyticCacheMaterialized: true;
    productDisplayAuthorized: false;
    readyForR1078: boolean;
    reviewGptRequiredNow: false;
    rowValuesInExternalArtifact: false;
  };
}

export async function runR1079NsrrSleepAutonomicStandardizer(
  options: R1079NsrrSleepAutonomicStandardizerOptions = {},
): Promise<{
  analyticCachePath: string;
  output: R1079NsrrSleepAutonomicStandardizerOutput;
  outputPath: string;
}> {
  const manifestPath = options.manifestPath ?? R1079_DEFAULT_PRIVATE_MANIFEST_PATH;
  const manifest = await readManifest(manifestPath);
  validateManifest(manifest);
  const analyticCachePath = options.outputAnalyticCachePath
    ?? manifest.outputAnalyticCachePath
    ?? R1078_DEFAULT_ANALYTIC_CACHE_PATH;
  assertAllowedAnalyticCachePath(analyticCachePath);
  const rows = await materializeRows(manifest);
  if (rows.length === 0) {
    throw new Error("R1079 could not materialize any standardized NSRR rows.");
  }

  const csv = rowsToCsv(rows);
  const gzipped = gzipSync(Buffer.from(csv, "utf8"));
  await ensurePrivateDirectory(path.dirname(analyticCachePath));
  await writeFile(analyticCachePath, gzipped, { mode: 0o600 });

  const eligibleRows = rows.filter((row) => row.eligible);
  const eligibleEvents = eligibleRows.filter((row) => row.event === 1);
  const readyForR1078 = clearsR1078Minimums(rows);
  const output: R1079NsrrSleepAutonomicStandardizerOutput = {
    artifactBoundary: safeBoundary(),
    cacheReceipt: {
      contentSha256: createHash("sha256").update(gzipped).digest("hex"),
      privateAnalyticCacheWritten: true,
      rowCacheScope: "ignored_local_runtime_cache_only",
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    endpoint: manifest.endpoint,
    horizon: manifest.horizon,
    materialization: {
      eligibleEventCountBand: safeParticipantCountBand(eligibleEvents.length),
      eligibleRowCountBand: safeParticipantCountBand(eligibleRows.length),
      mappedGenericFieldCountBand: countBand(mappedGenericFieldCount(manifest)),
      missingGenericFieldCountBand: countBand(missingGenericFieldCount(manifest)),
      readyForR1078,
      sourceFormat: "csv_or_tsv",
      splitPolicy: manifest.splitPolicy?.type === "column" || manifest.columnMap.split
        ? "manifest_column"
        : "row_index_modulo",
      splitShape: splitShape(rows),
      totalMaterializedRowCountBand: safeParticipantCountBand(rows.length),
    },
    nextStep: {
      conclusion: readyForR1078
        ? "nsrr_standard_cache_ready_for_r1078"
        : "nsrr_standard_cache_materialized_but_sparse",
      nextLocalAction: readyForR1078
        ? "run_r1078_nsrr_sleep_autonomic_local_loop"
        : "inspect_private_cache_coverage_before_scoring",
      reviewGptRequiredBeforeNextLocalRun: false,
    },
    packetId: "r1079-nsrr-sleep-autonomic-standardizer",
    productDisplayAuthorized: false,
    schemaVersion: R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION,
    standardAnalyticCacheContract: {
      cacheRoot: ".runtime/cache/murph-age/nsrr-sleep-autonomic/derived/analytic",
      localOnly: true,
      privateManifestRoot: ".runtime/cache/murph-age/nsrr-sleep-autonomic/private-maps",
      sourceSpecificColumnMapStoredInGit: false,
    },
    status: "research-local-private-cache-plus-aggregate-receipt",
    summary: {
      analyticCacheMaterialized: true,
      productDisplayAuthorized: false,
      readyForR1078,
      reviewGptRequiredNow: false,
      rowValuesInExternalArtifact: false,
    },
  };

  assertR1079Safe(output, manifest);
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { analyticCachePath, output, outputPath };
}

export function assertR1079Safe(
  output: R1079NsrrSleepAutonomicStandardizerOutput,
  manifest: R1079Manifest,
): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1079SpecificFindings(output, manifest),
  ];
  if (findings.length > 0) {
    throw new Error(`R1079 NSRR standardizer failed safety validation: ${findings.join("; ")}`);
  }
}

async function readManifest(filePath: string): Promise<R1079Manifest> {
  try {
    return parseManifest(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof Error && !/(?:\/|\\)/u.test(error.message)) throw error;
    throw new Error("R1079 requires a private local NSRR standardizer manifest before materialization.");
  }
}

function parseManifest(value: unknown): R1079Manifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("R1079 private manifest must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION) {
    throw new Error("R1079 private manifest schema version is not supported.");
  }
  if (typeof record.sourceTablePath !== "string" || record.sourceTablePath.trim() === "") {
    throw new Error("R1079 private manifest requires a local source table path.");
  }
  if (!record.columnMap || typeof record.columnMap !== "object" || Array.isArray(record.columnMap)) {
    throw new Error("R1079 private manifest requires a column map.");
  }
  const columnMap = parseColumnMap(record.columnMap as Record<string, unknown>);
  return {
    columnMap,
    delimiter: parseDelimiter(record.delimiter),
    endpoint: parseEndpoint(record.endpoint),
    horizon: parseHorizon(record.horizon),
    outputAnalyticCachePath: typeof record.outputAnalyticCachePath === "string"
      ? record.outputAnalyticCachePath
      : undefined,
    schemaVersion: R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION,
    sourceFormat: record.sourceFormat === "tsv" ? "tsv" : "csv",
    sourceTablePath: record.sourceTablePath,
    splitPolicy: parseSplitPolicy(record.splitPolicy),
  };
}

function parseColumnMap(value: Record<string, unknown>): Partial<Record<StandardColumn, ValueSpec>> {
  const columnMap: Partial<Record<StandardColumn, ValueSpec>> = {};
  const allowed = new Set<string>(STANDARD_COLUMNS);
  for (const [key, spec] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    columnMap[key as StandardColumn] = parseValueSpec(spec, key);
  }
  return columnMap;
}

function parseSplitPolicy(value: unknown): SplitPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.type === "column") {
    return { type: "column", value: parseValueSpec(record.value, "splitPolicy.value") };
  }
  if (record.type === "row_index_modulo") {
    return {
      calibrationRemainders: parseRemainders(record.calibrationRemainders),
      modulo: parseModulo(record.modulo),
      testRemainders: parseRemainders(record.testRemainders),
      trainRemainders: parseRemainders(record.trainRemainders),
      type: "row_index_modulo",
    };
  }
  return undefined;
}

function parseValueSpec(value: unknown, label: string): ValueSpec {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.column === "string" && record.column.trim() !== "") return { column: record.column };
    if (typeof record.constant === "string" || typeof record.constant === "number") {
      return { constant: record.constant };
    }
  }
  throw new Error(`R1079 private manifest has an invalid value spec for ${label}.`);
}

function parseDelimiter(value: unknown): "," | "\t" | undefined {
  return value === "," || value === "\t" ? value : undefined;
}

function parseEndpoint(value: unknown): Endpoint {
  if (ALLOWED_ENDPOINTS.includes(value as Endpoint)) return value as Endpoint;
  throw new Error("R1079 private manifest requires an explicit supported endpoint.");
}

function parseHorizon(value: unknown): Horizon {
  if (ALLOWED_HORIZONS.includes(value as Horizon)) return value as Horizon;
  throw new Error("R1079 private manifest requires an explicit supported horizon.");
}

function parseModulo(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 1 ? value : undefined;
}

function parseRemainders(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const remainders = value.filter((item): item is number => Number.isInteger(item) && item >= 0);
  return remainders.length > 0 ? remainders : undefined;
}

function validateManifest(manifest: R1079Manifest): void {
  for (const column of REQUIRED_MAPPED_COLUMNS) {
    if (!manifest.columnMap[column]) {
      throw new Error("R1079 private manifest is missing a required generic mapping.");
    }
  }
  if (!manifest.columnMap.split && manifest.splitPolicy?.type !== "column" && manifest.splitPolicy?.type !== "row_index_modulo") {
    throw new Error("R1079 private manifest requires either a split mapping or row-index split policy.");
  }
}

async function ensurePrivateDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { mode: 0o700, recursive: true });
  await chmod(directoryPath, 0o700);
}

function assertAllowedAnalyticCachePath(filePath: string): void {
  const resolved = path.resolve(filePath);
  const root = path.resolve(ALLOWED_ANALYTIC_CACHE_ROOT);
  if (!isPathInside(resolved, root) || !resolved.endsWith(".csv.gz")) {
    throw new Error("R1079 analytic cache output must stay under the ignored NSRR runtime cache root.");
  }
}

function isPathInside(filePath: string, root: string): boolean {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function materializeRows(manifest: R1079Manifest): Promise<MaterializedRow[]> {
  await access(manifest.sourceTablePath);
  const delimiter = manifest.delimiter ?? (manifest.sourceFormat === "tsv" ? "\t" : ",");
  const rl = createInterface({ crlfDelay: Infinity, input: sourceReadStream(manifest.sourceTablePath) });
  let header: string[] | null = null;
  const rows: MaterializedRow[] = [];
  let sourceRowIndex = 0;
  for await (const line of rl) {
    if (!header) {
      header = parseDelimitedLine(line, delimiter).map((column) => column.trim());
      continue;
    }
    if (!line.trim()) continue;
    const cells = parseDelimitedLine(line, delimiter);
    const raw = Object.fromEntries(header.map((column, index) => [column, String(cells[index] ?? "").trim()]));
    const row = materializeRow(raw, manifest, sourceRowIndex);
    sourceRowIndex += 1;
    if (row) rows.push(row);
  }
  return rows;
}

function sourceReadStream(filePath: string) {
  const stream = createReadStream(filePath);
  return filePath.endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
}

function materializeRow(
  raw: Record<string, string>,
  manifest: R1079Manifest,
  sourceRowIndex: number,
): MaterializedRow | null {
  const split = resolveSplit(raw, manifest, sourceRowIndex);
  const event = normalizeBinary(resolveValue(raw, manifest.columnMap.primary_event));
  const age = normalizeNumber(resolveValue(raw, manifest.columnMap.age_years));
  const sex = normalizeSex(resolveValue(raw, manifest.columnMap.sex_stratum));
  if (!split || event === null || age === "" || sex === "") return null;

  const values = Object.fromEntries(STANDARD_COLUMNS.map((column) => {
    if (column === "split") return [column, split];
    if (column === "primary_event") return [column, String(event)];
    if (column === "age_years") return [column, age];
    if (column === "sex_stratum") return [column, sex];
    if (column === "eligible_endpoint") {
      return [column, normalizeEligibility(resolveValue(raw, manifest.columnMap.eligible_endpoint))];
    }
    if (column === "analysis_weight") {
      return [column, normalizePositiveNumber(resolveValue(raw, manifest.columnMap.analysis_weight)) || "1"];
    }
    return [column, normalizeNumber(resolveValue(raw, manifest.columnMap[column]))];
  })) as Record<StandardColumn, string>;

  return {
    eligible: values.eligible_endpoint === "1",
    event,
    split,
    values,
  };
}

function resolveSplit(
  raw: Record<string, string>,
  manifest: R1079Manifest,
  sourceRowIndex: number,
): Split | null {
  const mapped = manifest.splitPolicy?.type === "column"
    ? resolveValue(raw, manifest.splitPolicy.value)
    : resolveValue(raw, manifest.columnMap.split);
  const parsed = parseSplit(mapped);
  if (parsed) return parsed;
  if (manifest.splitPolicy?.type === "row_index_modulo") {
    return splitFromRowIndex(sourceRowIndex, manifest.splitPolicy);
  }
  return null;
}

function splitFromRowIndex(sourceRowIndex: number, policy: RowIndexModuloSplitPolicy): Split {
  const modulo = policy.modulo ?? 4;
  const remainder = sourceRowIndex % modulo;
  const train = new Set(policy.trainRemainders ?? [0, 1]);
  const calibration = new Set(policy.calibrationRemainders ?? [2]);
  const test = new Set(policy.testRemainders ?? [3]);
  if (test.has(remainder)) return "test";
  if (calibration.has(remainder)) return "calibration";
  if (train.has(remainder)) return "train";
  return "train";
}

function resolveValue(raw: Record<string, string>, spec: ValueSpec | undefined): string {
  if (!spec) return "";
  if (typeof spec === "string") return raw[spec] ?? "";
  if ("column" in spec) return raw[spec.column] ?? "";
  return String(spec.constant);
}

function rowsToCsv(rows: readonly MaterializedRow[]): string {
  return [
    STANDARD_COLUMNS.join(","),
    ...rows.map((row) => STANDARD_COLUMNS.map((column) => csvCell(row.values[column])).join(",")),
  ].join("\n") + "\n";
}

function csvCell(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, "\"\"")}"` : value;
}

function parseDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === "\"" && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parseSplit(value: string): Split | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "train" || normalized === "training") return "train";
  if (normalized === "cal" || normalized === "calibration" || normalized === "validation") return "calibration";
  if (normalized === "test" || normalized === "holdout") return "test";
  return null;
}

function normalizeBinary(value: string): 0 | 1 | null {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "event", "deceased", "case"].includes(normalized)) return 1;
  if (["0", "false", "no", "n", "nonevent", "alive", "control"].includes(normalized)) return 0;
  return null;
}

function normalizeEligibility(value: string): "0" | "1" {
  if (!value.trim()) return "1";
  return normalizeBinary(value) === 0 ? "0" : "1";
}

function normalizeSex(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (["1", "m", "male", "man"].includes(normalized)) return "male";
  if (["2", "0", "f", "female", "woman"].includes(normalized)) return "female";
  return "";
}

function normalizeNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

function normalizePositiveNumber(value: string): string {
  const normalized = normalizeNumber(value);
  if (!normalized) return "";
  return Number(normalized) > 0 ? normalized : "";
}

function clearsR1078Minimums(rows: readonly MaterializedRow[]): boolean {
  const eligibleRows = rows.filter((row) => row.eligible);
  const eligibleEvents = eligibleRows.reduce((sum, row) => sum + (row.event === 1 ? 1 : 0), 0);
  if (eligibleRows.length < 100 || eligibleEvents < 10) return false;
  for (const split of ["calibration", "test", "train"] as const) {
    const subset = eligibleRows.filter((row) => row.split === split);
    const events = subset.reduce((sum, row) => sum + (row.event === 1 ? 1 : 0), 0);
    if (subset.length < 10 || events < 10) return false;
  }
  return eligibleRows.filter((row) => row.split === "test").length >= 100;
}

function splitShape(rows: readonly MaterializedRow[]): R1079NsrrSleepAutonomicStandardizerOutput["materialization"]["splitShape"] {
  const eligibleRows = rows.filter((row) => row.eligible);
  return Object.fromEntries((["calibration", "test", "train"] as const).map((split) => {
    const subset = eligibleRows.filter((row) => row.split === split);
    return [split, {
      eventCountBand: safeParticipantCountBand(subset.reduce((sum, row) => sum + (row.event === 1 ? 1 : 0), 0)),
      rowCountBand: safeParticipantCountBand(subset.length),
    }];
  })) as R1079NsrrSleepAutonomicStandardizerOutput["materialization"]["splitShape"];
}

function mappedGenericFieldCount(manifest: R1079Manifest): number {
  return STANDARD_COLUMNS.filter((column) =>
    Boolean(manifest.columnMap[column]) || Boolean(OPTIONAL_DEFAULTS[column]) || column === "split"
  ).length;
}

function missingGenericFieldCount(manifest: R1079Manifest): number {
  return STANDARD_COLUMNS.length - mappedGenericFieldCount(manifest);
}

function safeBoundary(): R1079NsrrSleepAutonomicStandardizerOutput["artifactBoundary"] {
  return {
    aggregateOnlyExternalOutput: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    localRowCacheWritten: true,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    predictionsStored: false,
    privateColumnMapRead: true,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceSpecificColumnNamesStored: false,
    splitMembershipStored: false,
  };
}

function findR1079SpecificFindings(
  output: R1079NsrrSleepAutonomicStandardizerOutput,
  manifest: R1079Manifest,
): string[] {
  const findings: string[] = [];
  const serialized = JSON.stringify(output);
  for (const token of privateManifestTokens(manifest)) {
    if (token.length >= 3 && serialized.includes(token)) {
      findings.push("private manifest token egress");
      break;
    }
  }
  for (const forbidden of ["sourceTablePath", "source_column", "nsrrid", "subject_id"]) {
    if (serialized.includes(forbidden)) findings.push(`forbidden source egress ${forbidden}`);
  }
  if (output.productDisplayAuthorized !== false || output.summary.productDisplayAuthorized !== false) {
    findings.push("product display must remain locked");
  }
  return findings;
}

function privateManifestTokens(manifest: R1079Manifest): string[] {
  return [
    path.basename(manifest.sourceTablePath),
    manifest.sourceTablePath,
    manifest.outputAnalyticCachePath ?? "",
    ...Object.values(manifest.columnMap).flatMap(valueSpecTokens),
    ...(manifest.splitPolicy?.type === "column" ? valueSpecTokens(manifest.splitPolicy.value) : []),
  ].filter((token) => token.trim().length > 0);
}

function valueSpecTokens(spec: ValueSpec | undefined): string[] {
  if (!spec) return [];
  if (typeof spec === "string") return [spec];
  if ("column" in spec) return [spec.column];
  return [];
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 100) return "10-99";
  if (count < 1000) return "100-999";
  if (count < 10000) return "1000-9999";
  return "10000+";
}

function safeParticipantCountBand(count: number): string {
  return count < 10 ? "below_threshold" : countBand(count);
}

async function main(): Promise<void> {
  const { output } = await runR1079NsrrSleepAutonomicStandardizer({
    manifestPath: process.env.MURPH_AGE_NSRR_STANDARDIZER_MANIFEST_PATH,
    outputAnalyticCachePath: process.env.MURPH_AGE_NSRR_SLEEP_AUTONOMIC_ANALYTIC_CACHE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    analyticCacheMaterialized: output.summary.analyticCacheMaterialized,
    conclusion: output.nextStep.conclusion,
    nextLocalAction: output.nextStep.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyForR1078: output.summary.readyForR1078,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowValuesInExternalArtifact: output.summary.rowValuesInExternalArtifact,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1079 NSRR standardizer failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
