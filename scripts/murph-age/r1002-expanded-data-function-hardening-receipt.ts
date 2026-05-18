import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1002_EXPANDED_DATA_FUNCTION_HARDENING_RECEIPT_SCHEMA_VERSION =
  "murph-age-r1002-expanded-data-function-hardening-receipt.v1" as const;

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
const OUTPUT_FILE_NAME = "r1002-expanded-data-function-hardening-receipt.latest.json";

type SourceFamily = "CRELES" | "HAALSI" | "MHAS/Gateway MHAS" | "MIDUS" | "NSHAP" | "SAGE South Africa";
type SourceStatus =
  | "expanded_cache_ready_for_source_card"
  | "score_receipts_available_no_retune"
  | "source_unlock_candidate"
  | "context_or_endpoint_blocked";

interface SourceGroup {
  family: SourceFamily;
  requiredNames: string[];
  optionalNamePatterns?: RegExp[];
  nextUse:
    | "function_disability_panel_hardening"
    | "source_unlock_for_function_cognition_falsification"
    | "reuse_existing_score_receipts"
    | "endpoint_or_terms_feasibility_only";
  status: SourceStatus;
}

const SOURCE_GROUPS: SourceGroup[] = [
  {
    family: "NSHAP",
    nextUse: "source_unlock_for_function_cognition_falsification",
    requiredNames: ["ICPSR_20541-V10.zip", "ICPSR_34921-V5.zip", "ICPSR_36873-V9.zip"],
    status: "source_unlock_candidate",
  },
  {
    family: "MHAS/Gateway MHAS",
    nextUse: "function_disability_panel_hardening",
    optionalNamePatterns: [/^sect_.*\.dta$/u],
    requiredNames: ["H_MHAS_d.dta", "GH_MHAS_EOL_c.dta", "master_follow_up_file_2024.dta"],
    status: "expanded_cache_ready_for_source_card",
  },
  {
    family: "MIDUS",
    nextUse: "reuse_existing_score_receipts",
    requiredNames: [
      "ICPSR_04652-V8.zip",
      "ICPSR_29282-V11.zip",
      "ICPSR_36532-V4.zip",
      "ICPSR_36901-V6.zip",
      "ICPSR_37237-V6.zip",
      "ICPSR_38024-V3.zip",
    ],
    status: "score_receipts_available_no_retune",
  },
  {
    family: "CRELES",
    nextUse: "reuse_existing_score_receipts",
    requiredNames: ["ICPSR_26681-V3.zip", "ICPSR_31263-V2.zip", "ICPSR_35250-V2.zip"],
    status: "score_receipts_available_no_retune",
  },
  {
    family: "HAALSI",
    nextUse: "endpoint_or_terms_feasibility_only",
    requiredNames: ["ICPSR_36633-V4.zip"],
    status: "context_or_endpoint_blocked",
  },
  {
    family: "SAGE South Africa",
    nextUse: "endpoint_or_terms_feasibility_only",
    requiredNames: [
      "SouthAfricaINDData.rar",
      "SouthAfricaHHData.dta",
      "SouthAfricaHHMembersData.dta",
      "SAGESouthAfrica.zip",
    ],
    status: "context_or_endpoint_blocked",
  },
];

type ArtifactKey = "r1000CurrentAccelerationState" | "r1001ReviewGptDirection";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R1002ExpandedDataFunctionHardeningReceiptOptions {
  createdAt?: string;
  downloadsDir?: string;
  outputDir?: string;
  r1000Path?: string;
  r1001Path?: string;
}

export interface R1002ExpandedDataFunctionHardeningReceiptOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    downloadedFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1002: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableListsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  expandedDataInventory: {
    downloadsDirInspected: boolean;
    fileNameValuesStored: false;
    sourceAvailability: Array<{
      allRequiredArtifactsPresent: boolean;
      family: SourceFamily;
      nextUse: SourceGroup["nextUse"];
      optionalPanelEvidenceBand: string;
      presentRequiredCountBand: string;
      status: SourceStatus;
    }>;
  };
  functionSidecarHardening: {
    localAction:
      | "run_mhas_function_sidecar_hardening_receipt"
      | "recover_function_hardening_inputs";
    reviewGptConsensus:
      | "complete_keep_function_first"
      | "pending_or_not_keep_function_first";
    status:
      | "ready_for_local_hardening_loop"
      | "blocked_pending_consensus_or_inputs";
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  nextLocalBatch: Array<{
    actionId:
      | "run_function_sidecar_hardening_receipt"
      | "build_mhas_panel_source_card"
      | "complete_nshap_source_unlock"
      | "reuse_midus_creles_score_receipts"
      | "send_expanded_source_strategy_chorus";
    owner: "local_codex" | "reviewgpt";
    priority: "p0_now" | "p1_next" | "p2_shadow";
    reviewGptRequiredBeforeRunning: boolean;
    why: string;
  }>;
  packetId: "r1002-expanded-data-function-hardening-receipt";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  reviewGptPacket: {
    readyForChorus: true;
    scope: "high_value_source_and_model_direction_only";
    suggestedLenses: [
      "source_execution_operator",
      "function_disability_scientist",
      "biomarker_transport_skeptic",
      "external_generalization_methodologist",
      "simple_architecture_guard",
    ];
  };
  schemaVersion: typeof R1002_EXPANDED_DATA_FUNCTION_HARDENING_RECEIPT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    currentLead: "r399_anchor_plus_function_disability_sidecar";
    expandedMhasCacheDetected: boolean;
    nextLocalAction: "run_function_sidecar_hardening_receipt";
    productDisplayAuthorized: false;
    reviewGptChorusReady: true;
  };
}

export async function runR1002ExpandedDataFunctionHardeningReceipt(
  options: R1002ExpandedDataFunctionHardeningReceiptOptions = {},
): Promise<{ output: R1002ExpandedDataFunctionHardeningReceiptOutput; outputPath: string }> {
  const [inputs, localBasenames] = await Promise.all([
    readInputs(options),
    readLocalBasenames(options.downloadsDir ?? path.join(os.homedir(), "Downloads")),
  ]);
  validateInputBoundaries(inputs);

  const sourceAvailability = SOURCE_GROUPS.map((group) => summarizeGroup(group, localBasenames));
  const r1000Lead =
    readStringAt(inputs.r1000CurrentAccelerationState, ["summary", "currentLead"])
    === "r399_anchor_plus_function_disability_sidecar";
  const r1000Next =
    readStringAt(inputs.r1000CurrentAccelerationState, ["summary", "nextLocalAction"])
    === "harden_function_disability_sidecar";
  const r1001Complete =
    readStringAt(inputs.r1001ReviewGptDirection, ["status"]) === "complete"
    && readStringAt(inputs.r1001ReviewGptDirection, ["consensus", "decision"]) === "keep_function_first";
  const ready = r1000Lead && r1000Next && r1001Complete;
  const expandedMhasCacheDetected = sourceAvailability.some((source) =>
    source.family === "MHAS/Gateway MHAS"
    && source.allRequiredArtifactsPresent
    && source.optionalPanelEvidenceBand !== "0"
  );

  const output: R1002ExpandedDataFunctionHardeningReceiptOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      downloadedFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1002: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    expandedDataInventory: {
      downloadsDirInspected: true,
      fileNameValuesStored: false,
      sourceAvailability,
    },
    functionSidecarHardening: {
      localAction: ready
        ? "run_mhas_function_sidecar_hardening_receipt"
        : "recover_function_hardening_inputs",
      reviewGptConsensus: r1001Complete
        ? "complete_keep_function_first"
        : "pending_or_not_keep_function_first",
      status: ready ? "ready_for_local_hardening_loop" : "blocked_pending_consensus_or_inputs",
    },
    inputArtifacts: summarizeInputs(inputs),
    nextLocalBatch: [
      {
        actionId: "run_function_sidecar_hardening_receipt",
        owner: "local_codex",
        priority: "p0_now",
        reviewGptRequiredBeforeRunning: false,
        why: "R1001 unanimously keeps function/disability first and the local aggregate evidence is already present.",
      },
      {
        actionId: "build_mhas_panel_source_card",
        owner: "local_codex",
        priority: "p0_now",
        reviewGptRequiredBeforeRunning: false,
        why: "Expanded MHAS/Gateway MHAS cache appears ready for a source-carded function/disability panel extension path.",
      },
      {
        actionId: "complete_nshap_source_unlock",
        owner: "local_codex",
        priority: "p1_next",
        reviewGptRequiredBeforeRunning: false,
        why: "NSHAP rounds are the next best function/cognition falsification source once source activation labels are complete.",
      },
      {
        actionId: "reuse_midus_creles_score_receipts",
        owner: "local_codex",
        priority: "p2_shadow",
        reviewGptRequiredBeforeRunning: false,
        why: "Existing MIDUS and CRELES score receipts should inform source priority without same-lane retuning.",
      },
      {
        actionId: "send_expanded_source_strategy_chorus",
        owner: "reviewgpt",
        priority: "p1_next",
        reviewGptRequiredBeforeRunning: false,
        why: "Use ReviewGPT only for the higher-level source/model direction now that expanded data is visible.",
      },
    ],
    packetId: "r1002-expanded-data-function-hardening-receipt",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
    },
    reviewGptPacket: {
      readyForChorus: true,
      scope: "high_value_source_and_model_direction_only",
      suggestedLenses: [
        "source_execution_operator",
        "function_disability_scientist",
        "biomarker_transport_skeptic",
        "external_generalization_methodologist",
        "simple_architecture_guard",
      ],
    },
    schemaVersion: R1002_EXPANDED_DATA_FUNCTION_HARDENING_RECEIPT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      currentLead: "r399_anchor_plus_function_disability_sidecar",
      expandedMhasCacheDetected,
      nextLocalAction: "run_function_sidecar_hardening_receipt",
      productDisplayAuthorized: false,
      reviewGptChorusReady: true,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1002Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1002 expanded data function hardening receipt failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R1002ExpandedDataFunctionHardeningReceiptOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    r1000CurrentAccelerationState: await readJsonIfPresent(
      options.r1000Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1000-current-acceleration-state.latest.json"),
    ),
    r1001ReviewGptDirection: await readJsonIfPresent(
      options.r1001Path ?? path.join(DEFAULT_REDUCED_REVIEWGPT_DIR, "r1001-result-interpretation-direction-summary.json"),
    ),
  };
}

async function readLocalBasenames(downloadsDir: string): Promise<Set<string>> {
  try {
    const entries = await readdir(downloadsDir, { recursive: false });
    return new Set(entries.map((entry) => path.basename(String(entry))));
  } catch {
    return new Set();
  }
}

function summarizeGroup(
  group: SourceGroup,
  basenames: Set<string>,
): R1002ExpandedDataFunctionHardeningReceiptOutput["expandedDataInventory"]["sourceAvailability"][number] {
  const presentRequiredCount = group.requiredNames.filter((name) => basenames.has(name)).length;
  const optionalPanelEvidenceCount = group.optionalNamePatterns
    ? [...basenames].filter((name) => group.optionalNamePatterns?.some((pattern) => pattern.test(name))).length
    : 0;
  return {
    allRequiredArtifactsPresent: presentRequiredCount === group.requiredNames.length,
    family: group.family,
    nextUse: group.nextUse,
    optionalPanelEvidenceBand: countBand(optionalPanelEvidenceCount),
    presentRequiredCountBand: countBand(presentRequiredCount),
    status: group.status,
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1002 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    r1000CurrentAccelerationState: summarizeArtifact(
      "r1000-current-acceleration-state.latest.json",
      inputs.r1000CurrentAccelerationState,
    ),
    r1001ReviewGptDirection: summarizeArtifact(
      "r1001-result-interpretation-direction-summary.json",
      inputs.r1001ReviewGptDirection,
    ),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  const root = optionalRecord(value);
  return {
    artifact,
    packetId: readStringAt(root, ["packetId"]) ?? null,
    schemaVersion: readStringAt(root, ["schemaVersion"]) ?? readStringAt(root, ["schema_version"]) ?? null,
    status: root ? "available" : "missing",
  };
}

function countBand(value: number): string {
  if (value <= 0) return "0";
  if (value <= 4) return "1-4";
  if (value <= 9) return "5-9";
  if (value <= 49) return "10-49";
  return "50+";
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  let current: unknown = value;
  for (const key of keys) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return typeof current === "string" ? current : null;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function findForbiddenR1002Output(output: R1002ExpandedDataFunctionHardeningReceiptOutput): string[] {
  const encoded = JSON.stringify(output);
  const findings: string[] = [];
  if (/[A-Za-z]:[\\/]|(?:^|")\/(?:Users|home|tmp|var)\//u.test(encoded)) {
    findings.push("output contains path-like local text");
  }
  if (/Downloads|cache-entry|external-sources|\.dta|\.zip|\.rar|sect_/u.test(encoded)) {
    findings.push("output contains local file-name or cache text");
  }
  return findings;
}

async function main(): Promise<void> {
  const { output } = await runR1002ExpandedDataFunctionHardeningReceipt({
    downloadsDir: process.env.MURPH_AGE_DOWNLOADS_DIR,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1000Path: process.env.MURPH_AGE_R1000_CURRENT_ACCELERATION_STATE_PATH,
    r1001Path: process.env.MURPH_AGE_R1001_REVIEWGPT_REDUCTION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    currentLead: output.summary.currentLead,
    expandedMhasCacheDetected: output.summary.expandedMhasCacheDetected,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptChorusReady: output.summary.reviewGptChorusReady,
    schemaVersion: output.schemaVersion,
    status: output.status,
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1002 expanded data function hardening receipt failed."}\n`);
    process.exitCode = 1;
  });
}
