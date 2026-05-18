import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1012_CROSS_SOURCE_FUNCTION_CONSISTENCY_SCHEMA_VERSION =
  "murph-age-r1012-cross-source-function-consistency.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_REVIEWGPT_REDUCED_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "reviewgpt",
  "reduced",
);
const OUTPUT_FILE_NAME = "r1012-cross-source-function-consistency.latest.json";

type ArtifactKey =
  | "r986CrossSourceFunctionArbitration"
  | "r997StrictNshapReplay"
  | "r1009MhasFunctionPanelResult"
  | "r1010ReviewGptReduction"
  | "r1011MhasFunctionDomainAttribution";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R1012CrossSourceFunctionConsistencyOptions {
  createdAt?: string;
  outputDir?: string;
  r986Path?: string;
  r997Path?: string;
  r1009Path?: string;
  r1010Path?: string;
  r1011Path?: string;
}

export interface R1012CrossSourceFunctionConsistencyOutput {
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
    rowParsingPerformedByR1012: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableListsStored: false;
    variableNamesStored: false;
  };
  consistencyState: {
    currentLeadFamily: "function_disability" | "none";
    functionSidecarStatus:
      | "lead_diagnostic_supported_pending_fresh_nshap"
      | "hold_pending_support"
      | "demote";
    generalizationEvidence: {
      historicalNshapUsableForDirection: boolean;
      mhasCrossSourcePortableVerdict: boolean;
      mhasDomainAttributionSupportive: boolean;
      mhasPanelSupportive: boolean;
      reviewGptFunctionLeadConsensus: boolean;
    };
    productDisplayAuthorized: false;
    sourceSupportSummary: {
      negativeFunctionBrierDeltaCount: number | null;
      positiveFunctionCDeltaCount: number | null;
      sourceCount: number | null;
      supportiveSourceCount: number | null;
    };
  };
  createdAt: string;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  nextActions: Array<{
    actionId: string;
    blockedBy: string[];
    owner: "user_source_confirmation" | "codex_local";
    priority: "p0" | "p1" | "p2";
    purpose: string;
    reviewGptRole: "none" | "after_meaningful_aggregate_delta";
    status: "blocked" | "runnable";
  }>;
  packetId: "r1012-cross-source-function-consistency";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  schemaVersion: typeof R1012_CROSS_SOURCE_FUNCTION_CONSISTENCY_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "function_disability_lead_sidecar_supported_pending_fresh_nshap"
      | "function_disability_hold_pending_support";
    nextLocalAction:
      | "complete_nshap_source_confirmation_then_run_fresh_function_cognition"
      | "continue_shadow_biomarker_transport_or_candidate_search";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1012: false;
  };
}

interface Inputs {
  r986CrossSourceFunctionArbitration: unknown | null;
  r997StrictNshapReplay: unknown | null;
  r1009MhasFunctionPanelResult: unknown | null;
  r1010ReviewGptReduction: unknown | null;
  r1011MhasFunctionDomainAttribution: unknown | null;
}

export async function runR1012CrossSourceFunctionConsistency(
  options: R1012CrossSourceFunctionConsistencyOptions = {},
): Promise<{ output: R1012CrossSourceFunctionConsistencyOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputs(inputs);

  const mhasCrossSourcePortableVerdict =
    readStringAt(inputs.r986CrossSourceFunctionArbitration, ["summary", "verdict"])
      === "function_disability_portable_diagnostic_sidecar_supported";
  const historicalNshapUsableForDirection =
    readStringAt(inputs.r997StrictNshapReplay, ["summary", "artifactVerdict"])
      === "historical_nshap_aggregate_signal_usable_research_direction_only";
  const mhasPanelSupportive =
    readStringAt(inputs.r1009MhasFunctionPanelResult, ["summary", "conclusion"])
      === "mhas_function_panel_extension_supports_lead_sidecar";
  const mhasDomainAttributionSupportive =
    readStringAt(inputs.r1011MhasFunctionDomainAttribution, ["summary", "conclusion"])
      === "mhas_function_domain_attribution_supportive";
  const reviewGptFunctionLeadConsensus =
    readNumberAt(inputs.r1010ReviewGptReduction, ["counts", "trusted"]) === 5
      && readStringAt(inputs.r1010ReviewGptReduction, ["consensus", "function_sidecar_status"]) === "lead_diagnostic";
  const supported = [
    mhasCrossSourcePortableVerdict,
    historicalNshapUsableForDirection,
    mhasPanelSupportive,
    mhasDomainAttributionSupportive,
    reviewGptFunctionLeadConsensus,
  ].every(Boolean);
  const currentLeadFamily =
    readStringAt(inputs.r986CrossSourceFunctionArbitration, ["summary", "currentLeadFamily"]) === "function_disability"
      ? "function_disability"
      : "none";
  const labelsComplete = readBooleanAt(inputs.r997StrictNshapReplay, ["activationFrame", "labelsComplete"]) === true;
  const aggregateOutputsActive =
    readBooleanAt(inputs.r997StrictNshapReplay, ["activationFrame", "aggregateOutputsActive"]) === true;
  const nshapBlockedBy = [
    labelsComplete ? null : "source_labels_incomplete",
    aggregateOutputsActive ? null : "aggregate_output_permission_inactive",
    "fresh_scoring_requires_separate_execution_after_labels",
  ].filter((item): item is string => item !== null);

  const output: R1012CrossSourceFunctionConsistencyOutput = {
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
      rowParsingPerformedByR1012: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
    },
    consistencyState: {
      currentLeadFamily,
      functionSidecarStatus: supported && currentLeadFamily === "function_disability"
        ? "lead_diagnostic_supported_pending_fresh_nshap"
        : "hold_pending_support",
      generalizationEvidence: {
        historicalNshapUsableForDirection,
        mhasCrossSourcePortableVerdict,
        mhasDomainAttributionSupportive,
        mhasPanelSupportive,
        reviewGptFunctionLeadConsensus,
      },
      productDisplayAuthorized: false,
      sourceSupportSummary: {
        negativeFunctionBrierDeltaCount:
          readNumberAt(inputs.r986CrossSourceFunctionArbitration, ["arbitration", "sourceSupportSummary", "negativeFunctionBrierDeltaCount"]),
        positiveFunctionCDeltaCount:
          readNumberAt(inputs.r986CrossSourceFunctionArbitration, ["arbitration", "sourceSupportSummary", "positiveFunctionCDeltaCount"]),
        sourceCount:
          readNumberAt(inputs.r986CrossSourceFunctionArbitration, ["arbitration", "sourceSupportSummary", "sourceCount"]),
        supportiveSourceCount:
          readNumberAt(inputs.r986CrossSourceFunctionArbitration, ["arbitration", "sourceSupportSummary", "supportiveSourceCount"]),
      },
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    nextActions: [
      {
        actionId: "complete_nshap_source_confirmation_then_run_fresh_function_cognition",
        blockedBy: nshapBlockedBy,
        owner: "user_source_confirmation",
        priority: "p0",
        purpose: "Turn historical NSHAP function/cognition support into a fresh current-source falsification run.",
        reviewGptRole: "after_meaningful_aggregate_delta",
        status: nshapBlockedBy.length === 0 ? "runnable" : "blocked",
      },
      {
        actionId: "keep_mhas_domain_attribution_as_research_explanation_layer",
        blockedBy: [],
        owner: "codex_local",
        priority: "p1",
        purpose: "Use the MHAS function/mobility attribution receipt as the current explanation-layer evidence, not as product UI.",
        reviewGptRole: "none",
        status: "runnable",
      },
      {
        actionId: "continue_shadow_biomarker_transport_after_function_falsification",
        blockedBy: ["lower_priority_until_fresh_function_falsification_or_user_unblock"],
        owner: "codex_local",
        priority: "p2",
        purpose: "Keep labs/body/glycemia as shadow transport evidence until function generalization is refreshed.",
        reviewGptRole: "after_meaningful_aggregate_delta",
        status: "blocked",
      },
    ],
    packetId: "r1012-cross-source-function-consistency",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
    },
    schemaVersion: R1012_CROSS_SOURCE_FUNCTION_CONSISTENCY_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: supported && currentLeadFamily === "function_disability"
        ? "function_disability_lead_sidecar_supported_pending_fresh_nshap"
        : "function_disability_hold_pending_support",
      nextLocalAction: supported
        ? "complete_nshap_source_confirmation_then_run_fresh_function_cognition"
        : "continue_shadow_biomarker_transport_or_candidate_search",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1012: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1012Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1012 cross-source function consistency failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1012CrossSourceFunctionConsistencyOptions): Promise<Inputs> {
  return {
    r986CrossSourceFunctionArbitration: await readJsonIfPresent(
      options.r986Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r986-cross-source-function-arbitration.latest.json"),
    ),
    r997StrictNshapReplay: await readJsonIfPresent(
      options.r997Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r997-strict-nshap-function-cognition-replay.latest.json"),
    ),
    r1009MhasFunctionPanelResult: await readJsonIfPresent(
      options.r1009Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1009-mhas-function-panel-extension-result.latest.json"),
    ),
    r1010ReviewGptReduction: await readJsonIfPresent(
      options.r1010Path ?? path.join(DEFAULT_REVIEWGPT_REDUCED_DIR, "r1010-mhas-function-panel-result-direction-summary.json"),
    ),
    r1011MhasFunctionDomainAttribution: await readJsonIfPresent(
      options.r1011Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1011-mhas-function-domain-attribution.latest.json"),
    ),
  };
}

function validateInputs(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1012 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Inputs): Record<ArtifactKey, ArtifactSummary> {
  return {
    r986CrossSourceFunctionArbitration: summarizeArtifact(
      "r986CrossSourceFunctionArbitration",
      inputs.r986CrossSourceFunctionArbitration,
    ),
    r997StrictNshapReplay: summarizeArtifact("r997StrictNshapReplay", inputs.r997StrictNshapReplay),
    r1009MhasFunctionPanelResult: summarizeArtifact(
      "r1009MhasFunctionPanelResult",
      inputs.r1009MhasFunctionPanelResult,
    ),
    r1010ReviewGptReduction: summarizeArtifact("r1010ReviewGptReduction", inputs.r1010ReviewGptReduction),
    r1011MhasFunctionDomainAttribution: summarizeArtifact(
      "r1011MhasFunctionDomainAttribution",
      inputs.r1011MhasFunctionDomainAttribution,
    ),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  const root = optionalRecord(value);
  return {
    artifact,
    packetId: readStringAt(root, ["packetId"]) ?? readStringAt(root, ["run_id"]) ?? null,
    schemaVersion: readStringAt(root, ["schemaVersion"]) ?? readStringAt(root, ["schema_version"]) ?? null,
    status: root ? "available" : "missing",
  };
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

function findForbiddenR1012Output(output: R1012CrossSourceFunctionConsistencyOutput): string[] {
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

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const { output } = await runR1012CrossSourceFunctionConsistency({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r986Path: process.env.MURPH_AGE_R986_CROSS_SOURCE_FUNCTION_PATH,
    r997Path: process.env.MURPH_AGE_R997_NSHAP_REPLAY_PATH,
    r1009Path: process.env.MURPH_AGE_R1009_MHAS_FUNCTION_PANEL_RESULT_PATH,
    r1010Path: process.env.MURPH_AGE_R1010_MHAS_FUNCTION_PANEL_REVIEWGPT_REDUCTION_PATH,
    r1011Path: process.env.MURPH_AGE_R1011_MHAS_FUNCTION_DOMAIN_ATTRIBUTION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    currentLeadFamily: output.consistencyState.currentLeadFamily,
    functionSidecarStatus: output.consistencyState.functionSidecarStatus,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    rowParsingPerformedByR1012: output.summary.rowParsingPerformedByR1012,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1012 cross-source function consistency failed."}\n`);
    process.exit(1);
  });
}
