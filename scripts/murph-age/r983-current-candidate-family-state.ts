import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R983_CURRENT_CANDIDATE_FAMILY_STATE_SCHEMA_VERSION =
  "murph-age-r983-current-candidate-family-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R981_REDUCTION_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "reviewgpt",
  "reduced",
  "r981-new-data-fast-direction-summary.json",
);
const DEFAULT_R747_FUNCTION_FAMILY_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "contracts",
  "function-frailty-five-source-reduction-r747.v0.json",
);
const OUTPUT_FILE_NAME = "r983-current-candidate-family-state.latest.json";

type ArtifactKey =
  | "r399LayeringReadiness"
  | "r607GlycemiaAblationReviewPacket"
  | "r608FreezeGlycemiaCandidate"
  | "r612NhanesLayeringMap"
  | "r977NshapNextActivationProbe"
  | "r978FastLoopPriorityReducer"
  | "r980MhasFunctionDisabilityAggregateReducer"
  | "r747FunctionFamilyFiveSourceReduction"
  | "r981ReviewGptReduction";
type ArtifactStatus = "available" | "missing";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

export interface R983CurrentCandidateFamilyStateOptions {
  createdAt?: string;
  outputDir?: string;
  r399LayeringPath?: string;
  r607Path?: string;
  r608Path?: string;
  r612Path?: string;
  r977Path?: string;
  r978Path?: string;
  r980Path?: string;
  r747FunctionFamilyPath?: string;
  r981ReductionPath?: string;
}

export interface R983CurrentCandidateFamilyStateOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableListsStored: false;
    variableNamesStored: false;
  };
  candidateFamilies: {
    cognition: {
      status: "diagnostic_only_pending_nshap" | "blocked_no_current_support";
      nextEvidence: string[];
    };
    functionDisability: {
      status:
        | "lead_sidecar_candidate_five_source_diagnostic_only"
        | "lead_sidecar_candidate_diagnostic_only"
        | "hold_diagnostic_only";
      evidenceLabels: string[];
      nextEvidence: string[];
      productPromotionAuthorized: false;
    };
    glycemiaBody: {
      status: "frozen_small_candidate_future_validation" | "hold_falsification_only";
      evidenceLabels: string[];
      frozenCandidateId: string | null;
      productPromotionAuthorized: false;
    };
    nhanesLabBpBody: {
      status: "research_layer_available_not_default" | "historical_internal_only";
      scoreBearingResearchLayer: string | null;
    };
    wearables: {
      status: "shadow_only";
      productPromotionAuthorized: false;
    };
  };
  createdAt: string;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  modelArchitecture: {
    baseAnchor: "nhis_r399_frozen_research_anchor";
    displayPolicy: "no_user_facing_age_display";
    editableCandidateFamilies: string[];
    frozenSurfaces: string[];
    researchOnly: true;
  };
  packetId: "r983-current-candidate-family-state";
  schemaVersion: typeof R983_CURRENT_CANDIDATE_FAMILY_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    currentLeadFamily: "function_disability" | "none";
    nextLocalLoop: string | null;
    productDisplayAuthorized: false;
    reviewGptUse: "high_value_result_review_only";
  };
}

export async function runR983CurrentCandidateFamilyState(
  options: R983CurrentCandidateFamilyStateOptions = {},
): Promise<{ output: R983CurrentCandidateFamilyStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const functionSupportive = readStringAt(inputs.r980MhasFunctionDisabilityAggregateReducer, [
    "summary",
    "conclusion",
  ]) === "mhas_function_disability_supportive_diagnostic_only";
  const r981FirstLoop = readStringAt(inputs.r981ReviewGptReduction, ["consensus", "first_loop"]);
  const r981ConsensusSupportsMhas = typeof r981FirstLoop === "string" && r981FirstLoop.includes("MHAS");
  const fiveSourceFunctionStatus = readStringAt(inputs.r747FunctionFamilyFiveSourceReduction, ["status"]);
  const fiveSourceFunctionSupportive = fiveSourceFunctionStatus
    === "five_source_concordant_candidate_domain_ready_for_family_definition_and_comparison";
  const glycemiaConclusion = readStringAt(inputs.r607GlycemiaAblationReviewPacket, ["summary", "conclusion"]);
  const frozenCandidateId = readStringAt(inputs.r608FreezeGlycemiaCandidate, ["frozenCandidateId"]);
  const nshapConclusion = readStringAt(inputs.r977NshapNextActivationProbe, ["summary", "conclusion"]);
  const nextLoop = readStringAt(inputs.r978FastLoopPriorityReducer, ["summary", "nextLoopId"]);
  const nhanesLayer = readStringAt(inputs.r612NhanesLayeringMap, ["summary", "scoreBearingResearchLayer"])
    ?? readStringAt(inputs.r612NhanesLayeringMap, ["scoreBearingResearchLayer"]);

  const output: R983CurrentCandidateFamilyStateOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
    },
    candidateFamilies: {
      cognition: {
        status: nshapConclusion === "nshap_benchmark_card_ready_but_sidecar_blocked_by_activation_labels"
          ? "diagnostic_only_pending_nshap"
          : "blocked_no_current_support",
        nextEvidence: [
          "nshap_function_only_vs_cognition_only_aggregate_sidecar_after_activation",
          "keep_cognition_separate_from_function_attribution",
        ],
      },
      functionDisability: {
        status: fiveSourceFunctionSupportive
          ? "lead_sidecar_candidate_five_source_diagnostic_only"
          : functionSupportive && r981ConsensusSupportsMhas
            ? "lead_sidecar_candidate_diagnostic_only"
            : "hold_diagnostic_only",
        evidenceLabels: functionEvidenceLabels({
          fiveSourceFunctionSupportive,
          functionSupportive,
          r981ConsensusSupportsMhas,
        }),
        nextEvidence: [
          "review_r982_aggregate_result_direction_chorus",
          "nshap_function_cognition_sidecar_after_activation_labels",
          "keep_no_product_display_until_external_validation_strengthens",
        ],
        productPromotionAuthorized: false,
      },
      glycemiaBody: {
        status: glycemiaConclusion === "glycemia_signal_supported_but_small"
          ? "frozen_small_candidate_future_validation"
          : "hold_falsification_only",
        evidenceLabels: [
          glycemiaConclusion ?? "glycemia_evidence_missing",
          "midus_creles_transport_weaker_than_same_denominator_age_sex",
        ],
        frozenCandidateId,
        productPromotionAuthorized: false,
      },
      nhanesLabBpBody: {
        status: nhanesLayer === "lab_bp_body"
          ? "research_layer_available_not_default"
          : "historical_internal_only",
        scoreBearingResearchLayer: nhanesLayer,
      },
      wearables: {
        status: "shadow_only",
        productPromotionAuthorized: false,
      },
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    modelArchitecture: {
      baseAnchor: "nhis_r399_frozen_research_anchor",
      displayPolicy: "no_user_facing_age_display",
      editableCandidateFamilies: [
        "function_disability_sidecar_candidate",
        "glycemia_body_small_candidate",
        "nshap_cognition_diagnostic_candidate",
      ],
      frozenSurfaces: [
        "nhis_r399_anchor_weights",
        "product_age_display",
        "clinical_recommendations",
        "wearable_score_bearing_path",
      ],
      researchOnly: true,
    },
    packetId: "r983-current-candidate-family-state",
    schemaVersion: R983_CURRENT_CANDIDATE_FAMILY_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      currentLeadFamily: fiveSourceFunctionSupportive || (functionSupportive && r981ConsensusSupportsMhas)
        ? "function_disability"
        : "none",
      nextLocalLoop: nextLoop,
      productDisplayAuthorized: false,
      reviewGptUse: "high_value_result_review_only",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R983 candidate family state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R983CurrentCandidateFamilyStateOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    r399LayeringReadiness: await readJsonIfPresent(
      options.r399LayeringPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r399-layering-readiness.latest.json"),
    ),
    r607GlycemiaAblationReviewPacket: await readJsonIfPresent(
      options.r607Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r607-glycemia-ablation-review-packet.latest.json"),
    ),
    r608FreezeGlycemiaCandidate: await readJsonIfPresent(
      options.r608Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r608-freeze-glycemia-candidate.latest.json"),
    ),
    r612NhanesLayeringMap: await readJsonIfPresent(
      options.r612Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r612-nhanes-layering-map.latest.json"),
    ),
    r977NshapNextActivationProbe: await readJsonIfPresent(
      options.r977Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r977-nshap-next-activation-probe.latest.json"),
    ),
    r978FastLoopPriorityReducer: await readJsonIfPresent(
      options.r978Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r978-fast-loop-priority-reducer.latest.json"),
    ),
    r980MhasFunctionDisabilityAggregateReducer: await readJsonIfPresent(
      options.r980Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r980-mhas-function-disability-aggregate-reducer.latest.json"),
    ),
    r747FunctionFamilyFiveSourceReduction: await readJsonIfPresent(
      options.r747FunctionFamilyPath ?? DEFAULT_R747_FUNCTION_FAMILY_PATH,
    ),
    r981ReviewGptReduction: await readJsonIfPresent(options.r981ReductionPath ?? DEFAULT_R981_REDUCTION_PATH),
  };
}

function functionEvidenceLabels(input: {
  fiveSourceFunctionSupportive: boolean;
  functionSupportive: boolean;
  r981ConsensusSupportsMhas: boolean;
}): string[] {
  if (input.fiveSourceFunctionSupportive) {
    return [
      "five_source_function_disability_concordant_diagnostic_only",
      "function_limitation_disability_v1_proposal_only",
      "reviewgpt_consensus_prioritize_mhas_function",
    ];
  }
  if (input.functionSupportive && input.r981ConsensusSupportsMhas) {
    return [
      "mhas_concordant_supportive_diagnostic_only",
      "reviewgpt_consensus_prioritize_mhas_function",
    ];
  }
  return ["mhas_not_yet_supportive_or_missing"];
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (value === null) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R983 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    r399LayeringReadiness: summarizeArtifact("r399-layering-readiness.latest.json", inputs.r399LayeringReadiness),
    r607GlycemiaAblationReviewPacket:
      summarizeArtifact("r607-glycemia-ablation-review-packet.latest.json", inputs.r607GlycemiaAblationReviewPacket),
    r608FreezeGlycemiaCandidate:
      summarizeArtifact("r608-freeze-glycemia-candidate.latest.json", inputs.r608FreezeGlycemiaCandidate),
    r612NhanesLayeringMap: summarizeArtifact("r612-nhanes-layering-map.latest.json", inputs.r612NhanesLayeringMap),
    r977NshapNextActivationProbe:
      summarizeArtifact("r977-nshap-next-activation-probe.latest.json", inputs.r977NshapNextActivationProbe),
    r978FastLoopPriorityReducer:
      summarizeArtifact("r978-fast-loop-priority-reducer.latest.json", inputs.r978FastLoopPriorityReducer),
    r980MhasFunctionDisabilityAggregateReducer:
      summarizeArtifact("r980-mhas-function-disability-aggregate-reducer.latest.json", inputs.r980MhasFunctionDisabilityAggregateReducer),
    r747FunctionFamilyFiveSourceReduction:
      summarizeArtifact("function-frailty-five-source-reduction-r747.v0.json", inputs.r747FunctionFamilyFiveSourceReduction),
    r981ReviewGptReduction: summarizeArtifact("r981-new-data-fast-direction-summary.json", inputs.r981ReviewGptReduction),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"])
      ?? readStringAt(value, ["manifestId"])
      ?? readStringAt(value, ["schema_version"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]) ?? readStringAt(value, ["schema_version"]),
    status: "available",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("R983 failed to read an aggregate input artifact.");
  }
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  const found = readAt(value, keys);
  return typeof found === "string" && found.length > 0 ? found : null;
}

function readAt(value: unknown | null, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function main(): Promise<void> {
  const { output } = await runR983CurrentCandidateFamilyState({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r399LayeringPath: process.env.MURPH_AGE_R399_LAYERING_PATH,
    r607Path: process.env.MURPH_AGE_R607_GLYCEMIA_PACKET_PATH,
    r608Path: process.env.MURPH_AGE_R608_FREEZE_PATH,
    r612Path: process.env.MURPH_AGE_R612_NHANES_LAYERING_PATH,
    r977Path: process.env.MURPH_AGE_R977_NSHAP_PROBE_PATH,
    r978Path: process.env.MURPH_AGE_R978_PRIORITY_REDUCER_PATH,
    r980Path: process.env.MURPH_AGE_R980_MHAS_FUNCTION_PATH,
    r747FunctionFamilyPath: process.env.MURPH_AGE_R747_FUNCTION_FAMILY_PATH,
    r981ReductionPath: process.env.MURPH_AGE_R981_REDUCTION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    currentLeadFamily: output.summary.currentLeadFamily,
    functionDisabilityStatus: output.candidateFamilies.functionDisability.status,
    glycemiaBodyStatus: output.candidateFamilies.glycemiaBody.status,
    nextLocalLoop: output.summary.nextLocalLoop,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R983 current candidate family state failed.\n");
    process.exitCode = 1;
  });
}
