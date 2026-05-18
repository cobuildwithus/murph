import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1007_MHAS_PANEL_EXTENSION_AGGREGATE_RECEIPT_SCHEMA_VERSION =
  "murph-age-r1007-mhas-panel-extension-aggregate-receipt.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_MHAS_CACHE_DIR = path.join(
  ".runtime",
  "cache",
  "murph-age",
  "external-sources",
  "mhas",
);
const OUTPUT_FILE_NAME = "r1007-mhas-panel-extension-aggregate-receipt.latest.json";

type PrivateStateKey =
  | "sourceCalibrationHoldout"
  | "enrichedCalibrationHoldout"
  | "enrichedFeatureCoverage"
  | "activityProxyMapping"
  | "functionMobilityTransport";
type ArtifactKey = "r1006MhasPanelExtensionRunnerManifest";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface PrivateStateSummary {
  logicalState: PrivateStateKey;
  rowParseExecuted: boolean;
  safeForAggregateReceipt: boolean;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R1007MhasPanelExtensionAggregateReceiptOptions {
  activityProxyMappingPath?: string;
  createdAt?: string;
  enrichedCalibrationHoldoutPath?: string;
  enrichedFeatureCoveragePath?: string;
  functionMobilityTransportPath?: string;
  outputDir?: string;
  r1006Path?: string;
  sourceCalibrationHoldoutPath?: string;
}

export interface R1007MhasPanelExtensionAggregateReceiptOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    modelPromotionAuthorized: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1007: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  packetId: "r1007-mhas-panel-extension-aggregate-receipt";
  panelExtensionEvidence: {
    activityProxyStatus: "not_observed" | "observed_aggregate_support" | "missing";
    enrichedCovariateSupport: Record<string, string>;
    endpointSupport: {
      eventCountBand: string | null;
      eligibleCountBand: string | null;
      minimumCellCount: number | null;
    };
    functionSupport: Record<string, string>;
    splitSupport: {
      calibrationCountBand: string | null;
      calibrationEventCountBand: string | null;
      holdoutCountBand: string | null;
      holdoutEventCountBand: string | null;
    };
  };
  privateStateChecks: {
    allAvailableStatesSafe: boolean;
    panelStateCountBand: string;
    rowParsePrivateOnlyCountBand: string;
    stateSummaries: PrivateStateSummary[];
    unsafePrivateStateCountBand: string;
  };
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  runnerReadiness: {
    candidateFeatureFamily: string | null;
    readyForAggregateScienceReadout: boolean;
    runnerStatus: string | null;
    sourceFamily: "MHAS/Gateway MHAS";
  };
  schemaVersion: typeof R1007_MHAS_PANEL_EXTENSION_AGGREGATE_RECEIPT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "mhas_panel_extension_existing_private_states_support_runner_reuse"
      | "mhas_panel_extension_existing_private_states_hold";
    nextLocalAction:
      | "send_mhas_panel_extension_aggregate_readout_to_reviewgpt"
      | "repair_mhas_private_state_boundaries_or_manifest";
    productDisplayAuthorized: false;
    reviewGptNextUse: "aggregate_result_interpretation_only";
    rowParsingPerformedByR1007: false;
  };
}

interface PrivateInputs {
  activityProxyMapping: unknown | null;
  enrichedCalibrationHoldout: unknown | null;
  enrichedFeatureCoverage: unknown | null;
  functionMobilityTransport: unknown | null;
  sourceCalibrationHoldout: unknown | null;
}

export async function runR1007MhasPanelExtensionAggregateReceipt(
  options: R1007MhasPanelExtensionAggregateReceiptOptions = {},
): Promise<{ output: R1007MhasPanelExtensionAggregateReceiptOutput; outputPath: string }> {
  const [r1006, privateInputs] = await Promise.all([
    readJsonIfPresent(options.r1006Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1006-mhas-panel-extension-runner-manifest.latest.json")),
    readPrivateInputs(options),
  ]);
  validatePublicInputBoundaries({ r1006MhasPanelExtensionRunnerManifest: r1006 });

  const stateSummaries = summarizePrivateStates(privateInputs);
  const availableStates = stateSummaries.filter((state) => state.status === "available");
  const unsafeStates = availableStates.filter((state) => !state.safeForAggregateReceipt);
  const rowParsePrivateOnlyStates = stateSummaries.filter((state) =>
    state.status === "available" && state.rowParseExecuted && state.safeForAggregateReceipt
  );

  const runnerReady =
    readStringAt(r1006, ["runnerManifest", "runnerStatus"]) === "ready_to_implement_local_private_runner"
    && readStringAt(r1006, ["summary", "conclusion"]) === "mhas_panel_extension_runner_manifest_ready";
  const functionSupport = readStringRecord(privateInputs.functionMobilityTransport, ["function_support_bands"]);
  const enrichedCovariateSupport = mergeSupportRecords(
    readStringRecord(privateInputs.enrichedCalibrationHoldout, ["feature_support_bands"]),
    readStringRecord(privateInputs.enrichedFeatureCoverage, ["feature_support_bands"]),
  );
  const activityProxyStatus = classifyActivityProxy(privateInputs.activityProxyMapping, enrichedCovariateSupport);
  const endpointSupport = {
    eligibleCountBand: firstStringAt([
      [privateInputs.enrichedCalibrationHoldout, ["denominator_bands", "eligible_count_band"]],
      [privateInputs.enrichedFeatureCoverage, ["denominator_bands", "eligible_count_band"]],
      [privateInputs.activityProxyMapping, ["denominator_bands", "eligible_count_band"]],
    ]),
    eventCountBand: firstStringAt([
      [privateInputs.enrichedCalibrationHoldout, ["denominator_bands", "event_count_band"]],
      [privateInputs.enrichedFeatureCoverage, ["denominator_bands", "event_count_band"]],
      [privateInputs.activityProxyMapping, ["denominator_bands", "event_count_band"]],
    ]),
    minimumCellCount: firstNumberAt([
      [privateInputs.functionMobilityTransport, ["denominator_bands", "minimum_cell_count"]],
      [privateInputs.enrichedCalibrationHoldout, ["denominator_bands", "minimum_cell_count"]],
      [privateInputs.enrichedFeatureCoverage, ["denominator_bands", "minimum_cell_count"]],
    ]),
  };
  const splitSupport = {
    calibrationCountBand: firstStringAt([
      [privateInputs.functionMobilityTransport, ["denominator_bands", "calibration_count_band"]],
      [privateInputs.sourceCalibrationHoldout, ["split_bands", "calibration_count_band"]],
    ]),
    calibrationEventCountBand: firstStringAt([
      [privateInputs.functionMobilityTransport, ["denominator_bands", "calibration_event_count_band"]],
      [privateInputs.sourceCalibrationHoldout, ["split_bands", "calibration_event_count_band"]],
    ]),
    holdoutCountBand: firstStringAt([
      [privateInputs.functionMobilityTransport, ["denominator_bands", "holdout_count_band"]],
      [privateInputs.sourceCalibrationHoldout, ["split_bands", "holdout_count_band"]],
    ]),
    holdoutEventCountBand: firstStringAt([
      [privateInputs.functionMobilityTransport, ["denominator_bands", "holdout_event_count_band"]],
      [privateInputs.sourceCalibrationHoldout, ["split_bands", "holdout_event_count_band"]],
    ]),
  };

  const ready = runnerReady
    && availableStates.length >= 3
    && unsafeStates.length === 0
    && rowParsePrivateOnlyStates.length >= 3
    && Object.keys(functionSupport).length > 0
    && endpointSupport.eligibleCountBand !== null
    && endpointSupport.eventCountBand !== null
    && splitSupport.calibrationCountBand !== null
    && splitSupport.holdoutCountBand !== null;

  const output: R1007MhasPanelExtensionAggregateReceiptOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      modelPromotionAuthorized: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1007: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1006MhasPanelExtensionRunnerManifest: summarizeArtifact("r1006MhasPanelExtensionRunnerManifest", r1006),
    },
    packetId: "r1007-mhas-panel-extension-aggregate-receipt",
    panelExtensionEvidence: {
      activityProxyStatus,
      enrichedCovariateSupport,
      endpointSupport,
      functionSupport,
      splitSupport,
    },
    privateStateChecks: {
      allAvailableStatesSafe: unsafeStates.length === 0,
      panelStateCountBand: countBand(availableStates.length),
      rowParsePrivateOnlyCountBand: countBand(rowParsePrivateOnlyStates.length),
      stateSummaries,
      unsafePrivateStateCountBand: countBand(unsafeStates.length),
    },
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
    },
    runnerReadiness: {
      candidateFeatureFamily: readStringAt(r1006, ["runnerManifest", "candidate", "candidateFeatureFamily"]),
      readyForAggregateScienceReadout: ready,
      runnerStatus: readStringAt(r1006, ["runnerManifest", "runnerStatus"]),
      sourceFamily: "MHAS/Gateway MHAS",
    },
    schemaVersion: R1007_MHAS_PANEL_EXTENSION_AGGREGATE_RECEIPT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "mhas_panel_extension_existing_private_states_support_runner_reuse"
        : "mhas_panel_extension_existing_private_states_hold",
      nextLocalAction: ready
        ? "send_mhas_panel_extension_aggregate_readout_to_reviewgpt"
        : "repair_mhas_private_state_boundaries_or_manifest",
      productDisplayAuthorized: false,
      reviewGptNextUse: "aggregate_result_interpretation_only",
      rowParsingPerformedByR1007: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1007Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1007 MHAS panel extension aggregate receipt failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readPrivateInputs(
  options: R1007MhasPanelExtensionAggregateReceiptOptions,
): Promise<PrivateInputs> {
  return {
    activityProxyMapping: await readJsonIfPresent(
      options.activityProxyMappingPath
        ?? path.join(DEFAULT_MHAS_CACHE_DIR, "private-r728-physical-activity-proxy-mapping", "private-r728-mhas-physical-activity-proxy-mapping-state.json"),
    ),
    enrichedCalibrationHoldout: await readJsonIfPresent(
      options.enrichedCalibrationHoldoutPath
        ?? path.join(DEFAULT_MHAS_CACHE_DIR, "private-r723-enriched-calibration-holdout", "private-r723-mhas-enriched-calibration-holdout-state.json"),
    ),
    enrichedFeatureCoverage: await readJsonIfPresent(
      options.enrichedFeatureCoveragePath
        ?? path.join(DEFAULT_MHAS_CACHE_DIR, "private-r725-enriched-feature-coverage-ablation", "private-r725-mhas-enriched-feature-coverage-ablation-state.json"),
    ),
    functionMobilityTransport: await readJsonIfPresent(
      options.functionMobilityTransportPath
        ?? path.join(DEFAULT_MHAS_CACHE_DIR, "private-r731-function-mobility-transport", "private-r731-mhas-function-mobility-transport-state.json"),
    ),
    sourceCalibrationHoldout: await readJsonIfPresent(
      options.sourceCalibrationHoldoutPath
        ?? path.join(DEFAULT_MHAS_CACHE_DIR, "private-r721-source-calibration-holdout", "private-r721-mhas-source-calibration-holdout-state.json"),
    ),
  };
}

function summarizePrivateStates(inputs: PrivateInputs): PrivateStateSummary[] {
  return [
    summarizePrivateState("sourceCalibrationHoldout", inputs.sourceCalibrationHoldout),
    summarizePrivateState("enrichedCalibrationHoldout", inputs.enrichedCalibrationHoldout),
    summarizePrivateState("enrichedFeatureCoverage", inputs.enrichedFeatureCoverage),
    summarizePrivateState("activityProxyMapping", inputs.activityProxyMapping),
    summarizePrivateState("functionMobilityTransport", inputs.functionMobilityTransport),
  ];
}

function summarizePrivateState(logicalState: PrivateStateKey, value: unknown | null): PrivateStateSummary {
  return {
    logicalState,
    rowParseExecuted: readBooleanAt(value, ["row_parse_executed"]) === true,
    safeForAggregateReceipt: value !== null && privateStateBoundaryIsSafe(value),
    schemaVersion: readStringAt(value, ["schema_version"]) ?? readStringAt(value, ["schemaVersion"]),
    status: value ? "available" : "missing",
  };
}

function privateStateBoundaryIsSafe(value: unknown): boolean {
  const directUnsafe = [
    readBooleanAt(value, ["row_values_stored"]),
    readBooleanAt(value, ["row_level_predictions_stored"]),
    readBooleanAt(value, ["storage_attestation", "row_values_stored"]),
    readBooleanAt(value, ["storage_attestation", "row_level_predictions_stored"]),
    readBooleanAt(value, ["storage_attestation", "predictions_exported"]),
    readBooleanAt(value, ["storage_attestation", "coefficients_stored"]),
    readBooleanAt(value, ["storage_attestation", "model_params_stored"]),
    readBooleanAt(value, ["storage_attestation", "source_bodies_stored"]),
    readBooleanAt(value, ["storage_attestation", "codebook_prose_stored"]),
  ];
  return directUnsafe.every((flag) => flag !== true);
}

function validatePublicInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1007 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  const root = optionalRecord(value);
  return {
    artifact,
    packetId: readStringAt(root, ["packetId"]) ?? readStringAt(root, ["candidate_id"]) ?? null,
    schemaVersion: readStringAt(root, ["schemaVersion"]) ?? readStringAt(root, ["schema_version"]) ?? null,
    status: root ? "available" : "missing",
  };
}

function mergeSupportRecords(
  first: Record<string, string>,
  second: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    [...Object.entries(first), ...Object.entries(second)]
      .filter(([key]) => isAllowedLogicalSupportKey(key)),
  );
}

function readStringRecord(value: unknown | null, keys: string[]): Record<string, string> {
  const current = readAt(value, keys);
  if (!current || typeof current !== "object" || Array.isArray(current)) return {};
  return Object.fromEntries(
    Object.entries(current)
      .filter((entry): entry is [string, string] =>
        isAllowedLogicalSupportKey(entry[0])
        && typeof entry[1] === "string"
        && isAllowedSupportBand(entry[1])
      ),
  );
}

function classifyActivityProxy(
  activityProxyMapping: unknown | null,
  enrichedCovariateSupport: Record<string, string>,
): R1007MhasPanelExtensionAggregateReceiptOutput["panelExtensionEvidence"]["activityProxyStatus"] {
  const activitySupport = readStringRecord(activityProxyMapping, ["activity_support_bands"]);
  if (Object.keys(activitySupport).length > 0) return "observed_aggregate_support";
  if (Object.values(enrichedCovariateSupport).includes("not_observed")) return "not_observed";
  return "missing";
}

function isAllowedLogicalSupportKey(key: string): boolean {
  return /^[a-z][a-z0-9_]{2,80}$/u.test(key)
    && !/(?:field|variable|column|name|id|path|file|source|codebook|label|row|prediction|coefficient|param)/iu.test(key);
}

function isAllowedSupportBand(value: string): boolean {
  return /^(?:gte_1000|gte_100_lt_1000|lt_100|not_observed|missing)$/u.test(value)
    || /^\d+$/u.test(value);
}

function firstStringAt(pairs: Array<[unknown | null, string[]]>): string | null {
  for (const [value, keys] of pairs) {
    const current = readStringAt(value, keys);
    if (current) return current;
  }
  return null;
}

function firstNumberAt(pairs: Array<[unknown | null, string[]]>): number | null {
  for (const [value, keys] of pairs) {
    const current = readNumberAt(value, keys);
    if (current !== null) return current;
  }
  return null;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readBooleanAt(value: unknown | null, keys: string[]): boolean | null {
  const current = readAt(value, keys);
  return typeof current === "boolean" ? current : null;
}

function readNumberAt(value: unknown | null, keys: string[]): number | null {
  const current = readAt(value, keys);
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  const current = readAt(value, keys);
  return typeof current === "string" && current.length > 0 ? current : null;
}

function readAt(value: unknown | null, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return current;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function countBand(count: number): string {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count <= 5) return "3_to_5";
  return "6_plus";
}

function findForbiddenR1007Output(output: R1007MhasPanelExtensionAggregateReceiptOutput): string[] {
  const encoded = JSON.stringify(output);
  const findings: string[] = [];
  if (/[A-Za-z]:[\\/]|(?:^|")\/(?:Users|home|tmp|var)\//u.test(encoded)) {
    findings.push("output contains path-like local text");
  }
  if (/Downloads|external-sources|cache-entry|\.dta|\.zip|\.rar|sect_|latest\.json/u.test(encoded)) {
    findings.push("output contains local file-name or cache text");
  }
  if (/field_names_private|fit_params_private_only|calibration_params_private_only|model_artifact_manifest_private/u.test(encoded)) {
    findings.push("output contains private-state implementation fields");
  }
  return findings;
}

async function main(): Promise<void> {
  const { output } = await runR1007MhasPanelExtensionAggregateReceipt({
    activityProxyMappingPath: process.env.MURPH_AGE_MHAS_ACTIVITY_PROXY_MAPPING_STATE_PATH,
    enrichedCalibrationHoldoutPath: process.env.MURPH_AGE_MHAS_ENRICHED_CALIBRATION_HOLDOUT_STATE_PATH,
    enrichedFeatureCoveragePath: process.env.MURPH_AGE_MHAS_ENRICHED_FEATURE_COVERAGE_STATE_PATH,
    functionMobilityTransportPath: process.env.MURPH_AGE_MHAS_FUNCTION_MOBILITY_STATE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1006Path: process.env.MURPH_AGE_R1006_MHAS_PANEL_EXTENSION_RUNNER_MANIFEST_PATH,
    sourceCalibrationHoldoutPath: process.env.MURPH_AGE_MHAS_SOURCE_CALIBRATION_HOLDOUT_STATE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    readyForAggregateScienceReadout: output.runnerReadiness.readyForAggregateScienceReadout,
    rowParsingPerformedByR1007: output.summary.rowParsingPerformedByR1007,
    schemaVersion: output.schemaVersion,
    status: output.status,
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1007 MHAS panel aggregate receipt failed."}\n`);
    process.exitCode = 1;
  });
}
