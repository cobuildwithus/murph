import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { R1078_DEFAULT_ANALYTIC_CACHE_PATH } from "./r1078-nsrr-sleep-autonomic-local-loop.ts";
import {
  R1079_DEFAULT_PRIVATE_MANIFEST_PATH,
  R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION,
} from "./r1079-nsrr-sleep-autonomic-standardizer.ts";
import { R1080_DEFAULT_PRIVATE_MANIFEST_DRAFT_PATH } from "./r1080-nsrr-standardizer-manifest-scaffold.ts";

export const R1082_NSRR_STANDARDIZER_MANIFEST_READINESS_SCHEMA_VERSION =
  "murph-age-r1082-nsrr-standardizer-manifest-readiness.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1082-nsrr-standardizer-manifest-readiness.latest.json";
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

const REQUIRED_GENERIC_FIELDS = ["age_years", "primary_event", "sex_stratum"] as const;
const ALLOWED_ENDPOINTS = [
  "all_cause_mortality",
  "frailty_disability_or_functional_decline_auxiliary_head",
  "hospitalization_or_emergency_utilization",
  "incident_cardiometabolic_disease",
  "major_cardiovascular_event",
] as const;
const ALLOWED_HORIZONS = ["5y", "10y", "source_supported"] as const;
const OPTIONAL_DEFAULT_FIELDS = ["analysis_weight", "eligible_endpoint"] as const;
const FEATURE_FAMILIES = {
  activity_and_coverage_quality: [
    "mean_daily_activity",
    "sedentary_minutes",
    "active_minutes",
    "sleep_wake_transition_count",
    "valid_night_count",
    "recording_minutes",
    "wear_time_minutes",
  ],
  clinical_context: [
    "body_mass_index",
    "systolic_blood_pressure",
    "diastolic_blood_pressure",
    "clinical_context_score",
  ],
  sleep_breathing_autonomic: [
    "apnea_hypopnea_index",
    "mean_spo2",
    "min_spo2",
    "resting_heart_rate",
    "heart_rate_variability",
  ],
  sleep_duration_regularity: [
    "sleep_duration_hours",
    "sleep_efficiency",
    "sleep_midpoint_variability",
    "sleep_regularity_index",
  ],
} as const satisfies Record<string, readonly StandardColumn[]>;

type StandardColumn = typeof STANDARD_COLUMNS[number];
type BlockingReasonCode =
  | "analytic_cache_target_outside_allowed_root"
  | "column_map_missing"
  | "endpoint_missing_or_unsupported"
  | "horizon_missing_or_unsupported"
  | "manifest_schema_unsupported"
  | "required_generic_mappings_incomplete"
  | "source_table_unreadable"
  | "split_policy_missing_or_unsupported";

export interface R1082NsrrStandardizerManifestReadinessOptions {
  createdAt?: string;
  manifestPath?: string;
  outputDir?: string;
}

export interface R1082NsrrStandardizerManifestReadinessOutput {
  artifactBoundary: {
    aggregateOnlyExternalOutput: true;
    codebookTextStored: false;
    headerValuesStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    privateManifestRead: true;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowValuesRead: false;
    rowValuesStored: false;
    sourceBodiesStored: false;
    sourceHeaderRead: false;
    sourceSpecificColumnNamesStored: false;
  };
  createdAt: string;
  manifestReadiness: {
    analyticCacheTargetAllowed: boolean;
    blockingReasonCodes: BlockingReasonCode[];
    blockingReasonCountBand: string;
    declaredEndpointSupported: boolean;
    declaredHorizonSupported: boolean;
    mappedFeatureFamilyCountBands: Record<keyof typeof FEATURE_FAMILIES, string>;
    mappedGenericFieldCountBand: string;
    manifestSchemaSupported: boolean;
    missingRequiredGenericMappingCountBand: string;
    readyForR1079: boolean;
    requiredGenericMappingCountBand: string;
    sourceTableAccessible: boolean;
    splitPolicyDeclared: boolean;
  };
  nextStep: {
    conclusion:
      | "nsrr_private_manifest_needs_local_fill_or_repair"
      | "nsrr_private_manifest_ready_for_r1079";
    nextLocalAction:
      | "fill_private_manifest_column_map_endpoint_horizon_then_rerun_r1082"
      | "run_r1079_nsrr_sleep_autonomic_standardizer";
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  packetId: "r1082-nsrr-standardizer-manifest-readiness";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1082_NSRR_STANDARDIZER_MANIFEST_READINESS_SCHEMA_VERSION;
  status: "research-local-private-manifest-readiness-plus-aggregate-receipt";
  summary: {
    productDisplayAuthorized: false;
    readyForR1079: boolean;
    reviewGptRequiredNow: false;
    rowValuesRead: false;
    sourceSpecificColumnNamesInExternalArtifact: false;
  };
}

export async function runR1082NsrrStandardizerManifestReadiness(
  options: R1082NsrrStandardizerManifestReadinessOptions = {},
): Promise<{ output: R1082NsrrStandardizerManifestReadinessOutput; outputPath: string }> {
  const manifestPath = options.manifestPath ?? await defaultManifestPath();
  const manifest = await readPrivateManifest(manifestPath);
  const inspection = await inspectManifest(manifest);
  const readyForR1079 = inspection.blockingReasonCodes.length === 0;
  const output: R1082NsrrStandardizerManifestReadinessOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    manifestReadiness: {
      analyticCacheTargetAllowed: inspection.analyticCacheTargetAllowed,
      blockingReasonCodes: inspection.blockingReasonCodes,
      blockingReasonCountBand: countBand(inspection.blockingReasonCodes.length),
      declaredEndpointSupported: inspection.declaredEndpointSupported,
      declaredHorizonSupported: inspection.declaredHorizonSupported,
      mappedFeatureFamilyCountBands: inspection.mappedFeatureFamilyCountBands,
      mappedGenericFieldCountBand: countBand(inspection.mappedGenericFieldCount),
      manifestSchemaSupported: inspection.manifestSchemaSupported,
      missingRequiredGenericMappingCountBand: countBand(inspection.missingRequiredGenericMappingCount),
      readyForR1079,
      requiredGenericMappingCountBand: countBand(inspection.requiredGenericMappingCount),
      sourceTableAccessible: inspection.sourceTableAccessible,
      splitPolicyDeclared: inspection.splitPolicyDeclared,
    },
    nextStep: {
      conclusion: readyForR1079
        ? "nsrr_private_manifest_ready_for_r1079"
        : "nsrr_private_manifest_needs_local_fill_or_repair",
      nextLocalAction: readyForR1079
        ? "run_r1079_nsrr_sleep_autonomic_standardizer"
        : "fill_private_manifest_column_map_endpoint_horizon_then_rerun_r1082",
      reviewGptRequiredBeforeNextLocalRun: false,
    },
    packetId: "r1082-nsrr-standardizer-manifest-readiness",
    productDisplayAuthorized: false,
    schemaVersion: R1082_NSRR_STANDARDIZER_MANIFEST_READINESS_SCHEMA_VERSION,
    status: "research-local-private-manifest-readiness-plus-aggregate-receipt",
    summary: {
      productDisplayAuthorized: false,
      readyForR1079,
      reviewGptRequiredNow: false,
      rowValuesRead: false,
      sourceSpecificColumnNamesInExternalArtifact: false,
    },
  };

  assertR1082Safe(output, { manifest, manifestPath });
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

export function assertR1082Safe(
  output: R1082NsrrStandardizerManifestReadinessOutput,
  privateTokens: { manifest: Record<string, unknown>; manifestPath: string },
): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1082SpecificFindings(output, privateTokens),
  ];
  if (findings.length > 0) {
    throw new Error(`R1082 NSRR manifest readiness failed safety validation: ${findings.join("; ")}`);
  }
}

async function defaultManifestPath(): Promise<string> {
  try {
    await access(R1079_DEFAULT_PRIVATE_MANIFEST_PATH);
    return R1079_DEFAULT_PRIVATE_MANIFEST_PATH;
  } catch {
    return R1080_DEFAULT_PRIVATE_MANIFEST_DRAFT_PATH;
  }
}

async function readPrivateManifest(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("R1082 private manifest must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && !/(?:\/|\\)/u.test(error.message)) throw error;
    throw new Error("R1082 requires a private local NSRR standardizer manifest before readiness validation.");
  }
}

async function inspectManifest(manifest: Record<string, unknown>): Promise<{
  analyticCacheTargetAllowed: boolean;
  blockingReasonCodes: BlockingReasonCode[];
  declaredEndpointSupported: boolean;
  declaredHorizonSupported: boolean;
  mappedFeatureFamilyCountBands: Record<keyof typeof FEATURE_FAMILIES, string>;
  mappedGenericFieldCount: number;
  manifestSchemaSupported: boolean;
  missingRequiredGenericMappingCount: number;
  requiredGenericMappingCount: number;
  sourceTableAccessible: boolean;
  splitPolicyDeclared: boolean;
}> {
  const columnMap = parseColumnMap(manifest.columnMap);
  const manifestSchemaSupported = manifest.schemaVersion === R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION;
  const declaredEndpointSupported = ALLOWED_ENDPOINTS.includes(manifest.endpoint as typeof ALLOWED_ENDPOINTS[number]);
  const declaredHorizonSupported = ALLOWED_HORIZONS.includes(manifest.horizon as typeof ALLOWED_HORIZONS[number]);
  const missingRequiredGenericMappingCount = REQUIRED_GENERIC_FIELDS
    .filter((field) => !columnMap.has(field))
    .length;
  const splitPolicyDeclared = hasSplitPolicy(manifest.splitPolicy) || columnMap.has("split");
  const analyticCacheTargetAllowed = analyticCachePathAllowed(
    typeof manifest.outputAnalyticCachePath === "string"
      ? manifest.outputAnalyticCachePath
      : R1078_DEFAULT_ANALYTIC_CACHE_PATH,
  );
  const sourceTableAccessible = await localPathAccessible(manifest.sourceTablePath);
  const blockingReasonCodes: BlockingReasonCode[] = [];
  if (!manifestSchemaSupported) blockingReasonCodes.push("manifest_schema_unsupported");
  if (!manifest.columnMap || typeof manifest.columnMap !== "object" || Array.isArray(manifest.columnMap)) {
    blockingReasonCodes.push("column_map_missing");
  }
  if (!declaredEndpointSupported) blockingReasonCodes.push("endpoint_missing_or_unsupported");
  if (!declaredHorizonSupported) blockingReasonCodes.push("horizon_missing_or_unsupported");
  if (missingRequiredGenericMappingCount > 0) blockingReasonCodes.push("required_generic_mappings_incomplete");
  if (!splitPolicyDeclared) blockingReasonCodes.push("split_policy_missing_or_unsupported");
  if (!analyticCacheTargetAllowed) blockingReasonCodes.push("analytic_cache_target_outside_allowed_root");
  if (!sourceTableAccessible) blockingReasonCodes.push("source_table_unreadable");

  return {
    analyticCacheTargetAllowed,
    blockingReasonCodes,
    declaredEndpointSupported,
    declaredHorizonSupported,
    mappedFeatureFamilyCountBands: mappedFeatureFamilyCountBands(columnMap),
    mappedGenericFieldCount: mappedGenericFieldCount(columnMap),
    manifestSchemaSupported,
    missingRequiredGenericMappingCount,
    requiredGenericMappingCount: REQUIRED_GENERIC_FIELDS.length,
    sourceTableAccessible,
    splitPolicyDeclared,
  };
}

function parseColumnMap(value: unknown): Set<StandardColumn> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Set();
  const allowed = new Set<string>(STANDARD_COLUMNS);
  return new Set(Object.keys(value as Record<string, unknown>)
    .filter((key): key is StandardColumn => allowed.has(key)));
}

function hasSplitPolicy(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = (value as Record<string, unknown>).type;
  return type === "column" || type === "row_index_modulo";
}

function analyticCachePathAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const root = path.resolve(ALLOWED_ANALYTIC_CACHE_ROOT);
  return isPathInside(resolved, root) && resolved.endsWith(".csv.gz");
}

function isPathInside(filePath: string, root: string): boolean {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function localPathAccessible(value: unknown): Promise<boolean> {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

function mappedFeatureFamilyCountBands(
  columnMap: ReadonlySet<StandardColumn>,
): Record<keyof typeof FEATURE_FAMILIES, string> {
  return Object.fromEntries(Object.entries(FEATURE_FAMILIES).map(([family, fields]) => [
    family,
    countBand(fields.filter((field) => columnMap.has(field)).length),
  ])) as Record<keyof typeof FEATURE_FAMILIES, string>;
}

function mappedGenericFieldCount(columnMap: ReadonlySet<StandardColumn>): number {
  return STANDARD_COLUMNS.filter((column) =>
    columnMap.has(column) || OPTIONAL_DEFAULT_FIELDS.includes(column as typeof OPTIONAL_DEFAULT_FIELDS[number])
  ).length;
}

function safeBoundary(): R1082NsrrStandardizerManifestReadinessOutput["artifactBoundary"] {
  return {
    aggregateOnlyExternalOutput: true,
    codebookTextStored: false,
    headerValuesStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    privateManifestRead: true,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowValuesRead: false,
    rowValuesStored: false,
    sourceBodiesStored: false,
    sourceHeaderRead: false,
    sourceSpecificColumnNamesStored: false,
  };
}

function findR1082SpecificFindings(
  output: R1082NsrrStandardizerManifestReadinessOutput,
  privateTokens: { manifest: Record<string, unknown>; manifestPath: string },
): string[] {
  const findings: string[] = [];
  const serialized = JSON.stringify(output);
  for (const token of privateManifestTokens(privateTokens)) {
    if (token.length >= 3 && serialized.includes(token)) {
      findings.push("private manifest token egress");
      break;
    }
  }
  if (output.productDisplayAuthorized !== false || output.summary.productDisplayAuthorized !== false) {
    findings.push("product display must remain locked");
  }
  return findings;
}

function privateManifestTokens(input: { manifest: Record<string, unknown>; manifestPath: string }): string[] {
  return [
    path.basename(input.manifestPath),
    input.manifestPath,
    ...stringTokensFromUnknown(input.manifest.sourceTablePath)
      .flatMap((token) => [token, path.basename(token)]),
    ...stringTokensFromUnknown(input.manifest.outputAnalyticCachePath)
      .flatMap((token) => [token, path.basename(token)]),
    ...stringTokensFromUnknown(input.manifest.availableSourceColumns),
    ...stringTokensFromUnknown(input.manifest.columnMap),
    ...stringTokensFromUnknown(input.manifest.splitPolicy),
  ].filter((token) => token.trim().length > 0);
}

function stringTokensFromUnknown(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringTokensFromUnknown);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(stringTokensFromUnknown);
  }
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

async function main(): Promise<void> {
  const { output } = await runR1082NsrrStandardizerManifestReadiness({
    manifestPath: process.env.MURPH_AGE_NSRR_STANDARDIZER_MANIFEST_PATH
      ?? process.env.MURPH_AGE_NSRR_STANDARDIZER_DRAFT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    blockingReasonCountBand: output.manifestReadiness.blockingReasonCountBand,
    conclusion: output.nextStep.conclusion,
    nextLocalAction: output.nextStep.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyForR1079: output.summary.readyForR1079,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowValuesRead: output.summary.rowValuesRead,
    schemaVersion: output.schemaVersion,
    sourceSpecificColumnNamesInExternalArtifact: output.summary.sourceSpecificColumnNamesInExternalArtifact,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1082 NSRR manifest readiness failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
