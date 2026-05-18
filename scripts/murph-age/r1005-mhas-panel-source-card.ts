import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1005_MHAS_PANEL_SOURCE_CARD_SCHEMA_VERSION =
  "murph-age-r1005-mhas-panel-source-card.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_REDUCED_REVIEWGPT_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "reviewgpt",
  "reduced",
);
const OUTPUT_FILE_NAME = "r1005-mhas-panel-source-card.latest.json";
const FROZEN_ANCHOR_ID = "r399_compact_age_nonlinear_l2_0p000";

type ArtifactKey =
  | "mhasJoinProbe"
  | "mhasSourceFeasibility"
  | "r614MhasSourceRightsActivationLabels"
  | "r979MhasEndpointJoinContract"
  | "r980MhasFunctionDisabilityAggregateReducer"
  | "r988MhasAnchorIncrement"
  | "r991MhasDeepDiagnostic"
  | "r1002ExpandedDataReceipt"
  | "r1003ExpandedSourceStrategy"
  | "r1004FunctionSidecarHardeningReceipt";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R1005MhasPanelSourceCardOptions {
  createdAt?: string;
  mhasJoinProbePath?: string;
  mhasSourceFeasibilityPath?: string;
  outputDir?: string;
  r614MhasPath?: string;
  r979Path?: string;
  r980Path?: string;
  r988Path?: string;
  r991Path?: string;
  r1002Path?: string;
  r1003Path?: string;
  r1004Path?: string;
}

export interface R1005MhasPanelSourceCardOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    modelPromotionAuthorized: false;
    outcomeScoringPerformedByR1005: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1005: false;
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
  nextLocalBatch: Array<{
    actionId:
      | "prepare_mhas_panel_extension_runner_manifest"
      | "complete_nshap_source_unlock"
      | "send_mhas_aggregate_delta_to_reviewgpt"
      | "keep_glycemia_body_shadow_only";
    owner: "local_codex" | "reviewgpt";
    priority: "p0_now" | "p1_next" | "p2_shadow";
    reviewGptRequiredBeforeRunning: boolean;
    why: string;
  }>;
  packetId: "r1005-mhas-panel-source-card";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  schemaVersion: typeof R1005_MHAS_PANEL_SOURCE_CARD_SCHEMA_VERSION;
  sourceCard: {
    aggregateResultSummary: {
      deepDiagnosticVerdict: string | null;
      functionAggregateConclusion: string | null;
      functionSupportClassification: string | null;
      mhasAnchorIncrementVerdict: string | null;
      rowParsePrivateOnlyAttested: boolean;
    };
    benchmarkCard: {
      abstentionCriteria: string[];
      allowedMetricFamilies: string[];
      denominatorId: string | null;
      evidenceClass: string | null;
      exposureLabel: string | null;
      minimumCellThreshold: number | null;
      sameDenominatorPolicy: string | null;
      splitPolicy: string | null;
      status: "ready_for_research_panel_extension" | "hold_pending_required_evidence";
    };
    modelScope: {
      blockedFamilies: string[];
      candidateFeatureFamily: string | null;
      currentLead: string | null;
      frozenAnchorId: typeof FROZEN_ANCHOR_ID;
      leadSidecarStatus: string | null;
      referenceFeatureFamily: string | null;
    };
    sourceActivation: {
      aggregateOutputLabel: string | null;
      endpointJoinContractReady: boolean;
      expandedMhasCacheDetected: boolean;
      localFamilyStatus: string | null;
      optionalPanelEvidenceBand: string | null;
      sourceRightsLabelsComplete: boolean;
    };
    sourceFamily: "MHAS/Gateway MHAS";
  };
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "mhas_panel_source_card_ready_research_only"
      | "mhas_panel_source_card_hold_pending_evidence";
    nextLocalAction:
      | "prepare_mhas_panel_extension_runner_manifest"
      | "repair_mhas_panel_source_card_inputs";
    productDisplayAuthorized: false;
    reviewGptNextUse: "aggregate_delta_interpretation_only";
    rowParsingPerformedByR1005: false;
  };
}

export async function runR1005MhasPanelSourceCard(
  options: R1005MhasPanelSourceCardOptions = {},
): Promise<{ output: R1005MhasPanelSourceCardOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const readyChecks = {
    contractReady: readStringAt(inputs.r979MhasEndpointJoinContract, ["summary", "conclusion"])
      === "mhas_endpoint_join_contract_locked_next_reducer_ready",
    expandedCacheReady: readBooleanAt(inputs.r1002ExpandedDataReceipt, ["summary", "expandedMhasCacheDetected"]) === true,
    functionSidecarHardened: readStringAt(inputs.r1004FunctionSidecarHardeningReceipt, ["functionSidecar", "status"])
      === "hardened_research_lead_sidecar",
    reviewGptDirectionReady:
      readStringAt(inputs.r1003ExpandedSourceStrategy, ["status"]) === "complete"
      && readNumberAt(inputs.r1003ExpandedSourceStrategy, ["aggregateCounts", "sourceDecisionCounts", "MHAS/Gateway MHAS:execute_now"]) === 5,
    sourceRightsReady:
      readBooleanAt(inputs.r614MhasSourceRightsActivationLabels, ["summary", "sourceRightsLabelsComplete"]) === true
      && readBooleanAt(inputs.r614MhasSourceRightsActivationLabels, ["summary", "endpointJoinContractReady"]) === true,
  };
  const ready = Object.values(readyChecks).every(Boolean);
  const optionalPanelEvidenceBand = readMhasOptionalPanelEvidenceBand(inputs.r1002ExpandedDataReceipt);
  const aggregateRowParsePrivateOnly =
    readBooleanAt(inputs.r980MhasFunctionDisabilityAggregateReducer, ["executionReceipt", "rowParseExecutedPrivateOnly"]) === true
    || readBooleanAt(inputs.r991MhasDeepDiagnostic, ["executionEvidence", "rowParseExecutedPrivateOnly"]) === true;

  const output: R1005MhasPanelSourceCardOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      modelPromotionAuthorized: false,
      outcomeScoringPerformedByR1005: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1005: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    nextLocalBatch: [
      {
        actionId: "prepare_mhas_panel_extension_runner_manifest",
        owner: "local_codex",
        priority: "p0_now",
        reviewGptRequiredBeforeRunning: false,
        why: "The MHAS source card is ready enough to define the next panel-extension runner manifest without changing the model or product surface.",
      },
      {
        actionId: "complete_nshap_source_unlock",
        owner: "local_codex",
        priority: "p1_next",
        reviewGptRequiredBeforeRunning: false,
        why: "NSHAP remains the next independent function/cognition falsification lane after the MHAS panel path is carded.",
      },
      {
        actionId: "send_mhas_aggregate_delta_to_reviewgpt",
        owner: "reviewgpt",
        priority: "p1_next",
        reviewGptRequiredBeforeRunning: false,
        why: "ReviewGPT should interpret meaningful aggregate deltas and source contradictions, not approve local checklist work.",
      },
      {
        actionId: "keep_glycemia_body_shadow_only",
        owner: "local_codex",
        priority: "p2_shadow",
        reviewGptRequiredBeforeRunning: false,
        why: "The expanded data and R1003 consensus keep biomarker transport unpromoted while function/disability is the lead sidecar.",
      },
    ],
    packetId: "r1005-mhas-panel-source-card",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
    },
    schemaVersion: R1005_MHAS_PANEL_SOURCE_CARD_SCHEMA_VERSION,
    sourceCard: {
      aggregateResultSummary: {
        deepDiagnosticVerdict: readStringAt(inputs.r991MhasDeepDiagnostic, ["summary", "verdict"]),
        functionAggregateConclusion: readStringAt(inputs.r980MhasFunctionDisabilityAggregateReducer, ["summary", "conclusion"]),
        functionSupportClassification:
          readStringAt(inputs.r980MhasFunctionDisabilityAggregateReducer, ["aggregateResult", "supportClassification"]),
        mhasAnchorIncrementVerdict: readStringAt(inputs.r988MhasAnchorIncrement, ["summary", "verdict"]),
        rowParsePrivateOnlyAttested: aggregateRowParsePrivateOnly,
      },
      benchmarkCard: {
        abstentionCriteria: readStringArrayAt(inputs.r979MhasEndpointJoinContract, ["benchmarkContract", "abstentionCriteria"]),
        allowedMetricFamilies: readStringArrayAt(inputs.r979MhasEndpointJoinContract, ["benchmarkContract", "allowedMetricFamilies"]),
        denominatorId: readStringAt(inputs.r979MhasEndpointJoinContract, ["denominatorPolicy", "denominatorId"]),
        evidenceClass: readStringAt(inputs.r979MhasEndpointJoinContract, ["benchmarkContract", "evidenceClass"]),
        exposureLabel: readStringAt(inputs.r979MhasEndpointJoinContract, ["benchmarkContract", "exposureLabel"]),
        minimumCellThreshold:
          readNumberAt(inputs.r979MhasEndpointJoinContract, ["benchmarkContract", "minimumCellThreshold"]),
        sameDenominatorPolicy:
          readStringAt(inputs.r979MhasEndpointJoinContract, ["denominatorPolicy", "candidateComparisonPolicy"]),
        splitPolicy: readStringAt(inputs.r979MhasEndpointJoinContract, ["splitCalibrationPolicy", "splitPolicy"]),
        status: ready ? "ready_for_research_panel_extension" : "hold_pending_required_evidence",
      },
      modelScope: {
        blockedFamilies: readStringArrayAt(inputs.r979MhasEndpointJoinContract, ["featureContract", "blockedFamilies"]),
        candidateFeatureFamily: readStringAt(inputs.r979MhasEndpointJoinContract, ["featureContract", "candidateFeatureFamily"]),
        currentLead: readStringAt(inputs.r1004FunctionSidecarHardeningReceipt, ["summary", "currentLead"]),
        frozenAnchorId: FROZEN_ANCHOR_ID,
        leadSidecarStatus: readStringAt(inputs.r1004FunctionSidecarHardeningReceipt, ["functionSidecar", "status"]),
        referenceFeatureFamily: readStringAt(inputs.r979MhasEndpointJoinContract, ["featureContract", "referenceFeatureFamily"]),
      },
      sourceActivation: {
        aggregateOutputLabel:
          readStringAt(inputs.r614MhasSourceRightsActivationLabels, ["sourceRightsActivationLabels", "aggregateOutputLabel"]),
        endpointJoinContractReady: readyChecks.contractReady,
        expandedMhasCacheDetected: readyChecks.expandedCacheReady,
        localFamilyStatus:
          readStringAt(inputs.r614MhasSourceRightsActivationLabels, ["joinFamilyActivation", "localFamilyStatus"]),
        optionalPanelEvidenceBand,
        sourceRightsLabelsComplete: readyChecks.sourceRightsReady,
      },
      sourceFamily: "MHAS/Gateway MHAS",
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "mhas_panel_source_card_ready_research_only"
        : "mhas_panel_source_card_hold_pending_evidence",
      nextLocalAction: ready
        ? "prepare_mhas_panel_extension_runner_manifest"
        : "repair_mhas_panel_source_card_inputs",
      productDisplayAuthorized: false,
      reviewGptNextUse: "aggregate_delta_interpretation_only",
      rowParsingPerformedByR1005: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1005Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1005 MHAS panel source card failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R1005MhasPanelSourceCardOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    mhasJoinProbe: await readJsonIfPresent(
      options.mhasJoinProbePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "mhas-join-probe.latest.json"),
    ),
    mhasSourceFeasibility: await readJsonIfPresent(
      options.mhasSourceFeasibilityPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "mhas-source-feasibility.latest.json"),
    ),
    r614MhasSourceRightsActivationLabels: await readJsonIfPresent(
      options.r614MhasPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-mhas-source-rights-activation-labels.latest.json"),
    ),
    r979MhasEndpointJoinContract: await readJsonIfPresent(
      options.r979Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r979-mhas-endpoint-join-contract.latest.json"),
    ),
    r980MhasFunctionDisabilityAggregateReducer: await readJsonIfPresent(
      options.r980Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r980-mhas-function-disability-aggregate-reducer.latest.json"),
    ),
    r988MhasAnchorIncrement: await readJsonIfPresent(
      options.r988Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r988-mhas-anchor-function-increment-check.latest.json"),
    ),
    r991MhasDeepDiagnostic: await readJsonIfPresent(
      options.r991Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r991-mhas-deep-diagnostic-reducer.latest.json"),
    ),
    r1002ExpandedDataReceipt: await readJsonIfPresent(
      options.r1002Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1002-expanded-data-function-hardening-receipt.latest.json"),
    ),
    r1003ExpandedSourceStrategy: await readJsonIfPresent(
      options.r1003Path ?? path.join(DEFAULT_REDUCED_REVIEWGPT_DIR, "r1003-expanded-source-strategy-summary.json"),
    ),
    r1004FunctionSidecarHardeningReceipt: await readJsonIfPresent(
      options.r1004Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1004-function-sidecar-hardening-receipt.latest.json"),
    ),
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1005 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    mhasJoinProbe: summarizeArtifact("mhasJoinProbe", inputs.mhasJoinProbe),
    mhasSourceFeasibility: summarizeArtifact("mhasSourceFeasibility", inputs.mhasSourceFeasibility),
    r614MhasSourceRightsActivationLabels: summarizeArtifact(
      "r614MhasSourceRightsActivationLabels",
      inputs.r614MhasSourceRightsActivationLabels,
    ),
    r979MhasEndpointJoinContract: summarizeArtifact(
      "r979MhasEndpointJoinContract",
      inputs.r979MhasEndpointJoinContract,
    ),
    r980MhasFunctionDisabilityAggregateReducer: summarizeArtifact(
      "r980MhasFunctionDisabilityAggregateReducer",
      inputs.r980MhasFunctionDisabilityAggregateReducer,
    ),
    r988MhasAnchorIncrement: summarizeArtifact(
      "r988MhasAnchorIncrement",
      inputs.r988MhasAnchorIncrement,
    ),
    r991MhasDeepDiagnostic: summarizeArtifact(
      "r991MhasDeepDiagnostic",
      inputs.r991MhasDeepDiagnostic,
    ),
    r1002ExpandedDataReceipt: summarizeArtifact(
      "r1002ExpandedDataReceipt",
      inputs.r1002ExpandedDataReceipt,
    ),
    r1003ExpandedSourceStrategy: summarizeArtifact(
      "r1003ExpandedSourceStrategy",
      inputs.r1003ExpandedSourceStrategy,
    ),
    r1004FunctionSidecarHardeningReceipt: summarizeArtifact(
      "r1004FunctionSidecarHardeningReceipt",
      inputs.r1004FunctionSidecarHardeningReceipt,
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

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readMhasOptionalPanelEvidenceBand(value: unknown | null): string | null {
  const inventory = optionalRecord(optionalRecord(value)?.expandedDataInventory);
  const sources = inventory?.sourceAvailability;
  if (!Array.isArray(sources)) return null;
  for (const item of sources) {
    const record = optionalRecord(item);
    if (record?.family === "MHAS/Gateway MHAS") {
      return typeof record.optionalPanelEvidenceBand === "string" ? record.optionalPanelEvidenceBand : null;
    }
  }
  return null;
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

function readStringArrayAt(value: unknown | null, keys: string[]): string[] {
  const current = readAt(value, keys);
  return Array.isArray(current) ? current.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
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

function findForbiddenR1005Output(output: R1005MhasPanelSourceCardOutput): string[] {
  const encoded = JSON.stringify(output);
  const findings: string[] = [];
  if (/[A-Za-z]:[\\/]|(?:^|")\/(?:Users|home|tmp|var)\//u.test(encoded)) {
    findings.push("output contains path-like local text");
  }
  if (/Downloads|external-sources|cache-entry|\.dta|\.zip|\.rar|sect_/u.test(encoded)) {
    findings.push("output contains local file-name or cache text");
  }
  return findings;
}

async function main(): Promise<void> {
  const { output } = await runR1005MhasPanelSourceCard({
    mhasJoinProbePath: process.env.MURPH_AGE_MHAS_JOIN_PROBE_PATH,
    mhasSourceFeasibilityPath: process.env.MURPH_AGE_MHAS_SOURCE_FEASIBILITY_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r614MhasPath: process.env.MURPH_AGE_R614_MHAS_LABELS_PATH,
    r979Path: process.env.MURPH_AGE_R979_MHAS_ENDPOINT_JOIN_CONTRACT_PATH,
    r980Path: process.env.MURPH_AGE_R980_MHAS_FUNCTION_REDUCER_PATH,
    r988Path: process.env.MURPH_AGE_R988_MHAS_ANCHOR_INCREMENT_PATH,
    r991Path: process.env.MURPH_AGE_R991_MHAS_DEEP_DIAGNOSTIC_PATH,
    r1002Path: process.env.MURPH_AGE_R1002_EXPANDED_DATA_RECEIPT_PATH,
    r1003Path: process.env.MURPH_AGE_R1003_REVIEWGPT_REDUCTION_PATH,
    r1004Path: process.env.MURPH_AGE_R1004_FUNCTION_HARDENING_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptNextUse: output.summary.reviewGptNextUse,
    rowParsingPerformedByR1005: output.summary.rowParsingPerformedByR1005,
    schemaVersion: output.schemaVersion,
    sourceFamily: output.sourceCard.sourceFamily,
    status: output.status,
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1005 MHAS panel source card failed."}\n`);
    process.exitCode = 1;
  });
}
