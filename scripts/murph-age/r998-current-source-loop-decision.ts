import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R998_CURRENT_SOURCE_LOOP_DECISION_SCHEMA_VERSION =
  "murph-age-r998-current-source-loop-decision.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_REDUCED_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "reviewgpt",
  "reduced",
);
const OUTPUT_FILE_NAME = "r998-current-source-loop-decision.latest.json";

type ArtifactKey =
  | "r826PostureBoard"
  | "r953RealityCheck"
  | "r986CrossSourceFunctionArbitration"
  | "r987CrelesGlycemiaReceipt"
  | "r994ExpandedSourceCacheReadiness"
  | "r995SidecarEvidenceArbitration"
  | "r996ReducedSummary"
  | "r997StrictNshapReplay";

interface ArtifactSummary {
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R998CurrentSourceLoopDecisionOptions {
  createdAt?: string;
  outputDir?: string;
  r826Path?: string;
  r953Path?: string;
  r986Path?: string;
  r987Path?: string;
  r994Path?: string;
  r995Path?: string;
  r996Path?: string;
  r997Path?: string;
}

export interface R998CurrentSourceLoopDecisionOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR998: false;
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
  currentLeadModelFamily: {
    anchor: "frozen_nhis_r399_anchor";
    authorization: "research_only";
    sidecar: "function_disability_diagnostic";
    status: "current_lead";
  };
  dataPriority: {
    first: ["NSHAP", "MHAS", "MIDUS", "CRELES"];
    contextIfPresent: ["HAALSI", "SAGE", "SEBAS", "LSOA", "CLHLS"];
    rationale: "new_local_downloads_prioritize_real_score_or_activation_loops_before_broad_feature_expansion";
  };
  holdDeprioritize: Array<{
    area: "broad_labs" | "wearables" | "cognition_promotion" | "product_ui_display";
    reason: string;
  }>;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  nextRealLocalLoop: {
    loopId:
      | "finish_strict_nshap_replay"
      | "run_interpret_score_bearing_midus_creles_mhas_and_prepare_source_cards";
    actions: string[];
    blockedBy: string[];
    reviewGptRequiredForLocalChecklist: false;
  };
  packetId: "r998-current-source-loop-decision";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  reviewGptRole: {
    localChecklistApproval: false;
    role: "high_value_direction_and_result_review_only";
    useFor: string[];
  };
  schemaVersion: typeof R998_CURRENT_SOURCE_LOOP_DECISION_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    currentLeadModelFamily: "frozen_nhis_r399_anchor_plus_function_disability_diagnostic_sidecar";
    nextLoop: R998CurrentSourceLoopDecisionOutput["nextRealLocalLoop"]["loopId"];
    productDisplayAuthorized: false;
    reviewGptRole: "big_science_decisions_only";
    strictNshapReplayStatus: "available" | "missing";
  };
}

export async function runR998CurrentSourceLoopDecision(
  options: R998CurrentSourceLoopDecisionOptions = {},
): Promise<{ output: R998CurrentSourceLoopDecisionOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const strictNshapReplayAvailable = inputs.r997StrictNshapReplay !== null;
  const output: R998CurrentSourceLoopDecisionOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR998: false,
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
    currentLeadModelFamily: {
      anchor: "frozen_nhis_r399_anchor",
      authorization: "research_only",
      sidecar: "function_disability_diagnostic",
      status: "current_lead",
    },
    dataPriority: {
      first: ["NSHAP", "MHAS", "MIDUS", "CRELES"],
      contextIfPresent: ["HAALSI", "SAGE", "SEBAS", "LSOA", "CLHLS"],
      rationale: "new_local_downloads_prioritize_real_score_or_activation_loops_before_broad_feature_expansion",
    },
    holdDeprioritize: [
      { area: "broad_labs", reason: "hold_until_current_score_bearing_loops_are_interpreted" },
      { area: "wearables", reason: "hold_until_external_sidecar_validation_needs_them" },
      { area: "cognition_promotion", reason: "use_only_as_shadow_or_falsification_axis" },
      { area: "product_ui_display", reason: "no_product_display_or_promotion_authorized" },
    ],
    inputArtifacts: summarizeInputs(inputs),
    nextRealLocalLoop: strictNshapReplayAvailable
      ? {
        loopId: "run_interpret_score_bearing_midus_creles_mhas_and_prepare_source_cards",
        actions: [
          "interpret_existing_score_bearing_midus_creles_mhas_aggregate_loops",
          "prepare_source_card_plan_for_nshap_mhas_haalsi_sage_when_applicable",
          "keep_function_disability_as_diagnostic_sidecar_not_replacement_anchor",
        ],
        blockedBy: [],
        reviewGptRequiredForLocalChecklist: false,
      }
      : {
        loopId: "finish_strict_nshap_replay",
        actions: [
          "complete_or_recover_strict_nshap_replay_receipt",
          "then_interpret_score_bearing_midus_creles_mhas_aggregate_loops",
          "then_prepare_source_card_plan_for_nshap_mhas_haalsi_sage_when_applicable",
        ],
        blockedBy: ["strict_nshap_replay_receipt_missing"],
        reviewGptRequiredForLocalChecklist: false,
      },
    packetId: "r998-current-source-loop-decision",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
    },
    reviewGptRole: {
      localChecklistApproval: false,
      role: "high_value_direction_and_result_review_only",
      useFor: [
        "major_source_strategy_decisions",
        "material_result_interpretation",
        "model_family_direction_changes",
      ],
    },
    schemaVersion: R998_CURRENT_SOURCE_LOOP_DECISION_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      currentLeadModelFamily: "frozen_nhis_r399_anchor_plus_function_disability_diagnostic_sidecar",
      nextLoop: strictNshapReplayAvailable
        ? "run_interpret_score_bearing_midus_creles_mhas_and_prepare_source_cards"
        : "finish_strict_nshap_replay",
      productDisplayAuthorized: false,
      reviewGptRole: "big_science_decisions_only",
      strictNshapReplayStatus: strictNshapReplayAvailable ? "available" : "missing",
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR998Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R998 current source loop decision failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R998CurrentSourceLoopDecisionOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    r826PostureBoard: await readJsonIfPresent(
      options.r826Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r826-posture-board.latest.json"),
    ),
    r953RealityCheck: await readJsonIfPresent(
      options.r953Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r953-reality-check.latest.json"),
    ),
    r986CrossSourceFunctionArbitration: await readJsonIfPresent(
      options.r986Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r986-cross-source-function-arbitration.latest.json"),
    ),
    r987CrelesGlycemiaReceipt: await readJsonIfPresent(
      options.r987Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r987-creles-glycemia-receipt-reducer.latest.json"),
    ),
    r994ExpandedSourceCacheReadiness: await readJsonIfPresent(
      options.r994Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r994-expanded-source-cache-readiness.latest.json"),
    ),
    r995SidecarEvidenceArbitration: await readJsonIfPresent(
      options.r995Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r995-sidecar-evidence-arbitration.latest.json"),
    ),
    r996ReducedSummary: await readJsonIfPresent(
      options.r996Path ?? path.join(DEFAULT_REDUCED_DIR, "r996-accelerated-next-model-loops-summary.json"),
    ),
    r997StrictNshapReplay: await readJsonIfPresent(
      options.r997Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r997-strict-nshap-function-cognition-replay.latest.json"),
    ),
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (value === null) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R998 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    r826PostureBoard: summarizeArtifact(inputs.r826PostureBoard),
    r953RealityCheck: summarizeArtifact(inputs.r953RealityCheck),
    r986CrossSourceFunctionArbitration: summarizeArtifact(inputs.r986CrossSourceFunctionArbitration),
    r987CrelesGlycemiaReceipt: summarizeArtifact(inputs.r987CrelesGlycemiaReceipt),
    r994ExpandedSourceCacheReadiness: summarizeArtifact(inputs.r994ExpandedSourceCacheReadiness),
    r995SidecarEvidenceArbitration: summarizeArtifact(inputs.r995SidecarEvidenceArbitration),
    r996ReducedSummary: summarizeArtifact(inputs.r996ReducedSummary),
    r997StrictNshapReplay: summarizeArtifact(inputs.r997StrictNshapReplay),
  };
}

function summarizeArtifact(value: unknown | null): ArtifactSummary {
  if (!value) return { packetId: null, schemaVersion: null, status: "missing" };
  return {
    packetId: readStringAt(value, ["packetId"]) ?? readStringAt(value, ["run_id"]) ?? null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) ?? readStringAt(value, ["schema_version"]),
    status: "available",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("R998 failed to read an aggregate input artifact.");
  }
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.length > 0 && current.length <= 160 && !/[\r\n\t/\\]/u.test(current)
    ? current
    : null;
}

function findForbiddenR998Output(output: R998CurrentSourceLoopDecisionOutput): string[] {
  const encoded = JSON.stringify(output);
  const findings: string[] = [];
  if (/[A-Za-z]:[\\/]|(?:^|")\/(?:Users|home|tmp|var)\//u.test(encoded)) {
    findings.push("output contains path-like local text");
  }
  if (/cache-entry|external-sources/u.test(encoded)) {
    findings.push("output contains cache file or cache path text");
  }
  return findings;
}

async function main(): Promise<void> {
  const { output } = await runR998CurrentSourceLoopDecision({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r826Path: process.env.MURPH_AGE_R826_POSTURE_BOARD_PATH,
    r953Path: process.env.MURPH_AGE_R953_REALITY_CHECK_PATH,
    r986Path: process.env.MURPH_AGE_R986_FUNCTION_ARBITRATION_PATH,
    r987Path: process.env.MURPH_AGE_R987_GLYCEMIA_RECEIPT_PATH,
    r994Path: process.env.MURPH_AGE_R994_SOURCE_CACHE_READINESS_PATH,
    r995Path: process.env.MURPH_AGE_R995_SIDECAR_ARBITRATION_PATH,
    r996Path: process.env.MURPH_AGE_R996_REDUCED_SUMMARY_PATH,
    r997Path: process.env.MURPH_AGE_R997_STRICT_NSHAP_REPLAY_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    currentLeadModelFamily: output.summary.currentLeadModelFamily,
    nextLoop: output.summary.nextLoop,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptRole: output.summary.reviewGptRole,
    schemaVersion: output.schemaVersion,
    status: output.status,
    strictNshapReplayStatus: output.summary.strictNshapReplayStatus,
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R998 current source loop decision failed."}\n`);
    process.exitCode = 1;
  });
}
