import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R608_FREEZE_GLYCEMIA_CANDIDATE_SCHEMA_VERSION =
  "murph-age-r608-freeze-glycemia-candidate.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(".runtime", "operations", "research", "murph-age", "model-runs");
const DEFAULT_REVIEWGPT_REDUCED_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "reviewgpt",
  "reduced",
);
const DEFAULT_R606_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r606-parsimonious-glycemia-ablation.latest.json");
const DEFAULT_R607_PACKET_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r607-glycemia-ablation-review-packet.latest.json");
const DEFAULT_R607_REVIEWGPT_PATH = path.join(DEFAULT_REVIEWGPT_REDUCED_DIR, "r607-glycemia-ablation-review-summary.json");
const OUTPUT_FILE_NAME = "r608-freeze-glycemia-candidate.latest.json";

type FrozenCandidateId = "age_sex_plus_glycemia";

interface EvidenceInput {
  artifact: string;
  inputId: "r606_aggregate_ablation" | "r607_review_packet";
  relevantConclusion: string;
  schemaVersion: string;
  status: string;
}

interface ConsensusInput {
  artifact: string;
  completedReviewCount: number;
  decisionCounts: Record<string, number>;
  status: "trusted_majority";
  topDecision: "freeze_glycemia_only_candidate";
  trustedReviewCount: number;
}

export interface R608FreezeGlycemiaCandidateOptions {
  createdAt?: string;
  outputDir?: string;
  r606Path?: string;
  r607PacketPath?: string;
  r607ReviewGptPath?: string;
}

export interface R608FreezeGlycemiaCandidateManifest {
  allowedNextUse: {
    allowedActions: string[];
    requiredBeforeExecution: string[];
    scope: "future_external_or_source_validation_only";
  };
  blockedUses: string[];
  candidateFamily: {
    familyId: "tiny_glycemia_only";
    frozenFromDecision: "freeze_glycemia_only_candidate";
    includedDomains: string[];
    label: "age_sex_plus_glycemia";
    excludedDomainsForThisFreeze: string[];
  };
  consensusInputs: ConsensusInput[];
  createdAt: string;
  evidenceInputs: EvidenceInput[];
  frozenCandidateId: FrozenCandidateId;
  manifestId: "r608-freeze-glycemia-candidate";
  schemaVersion: typeof R608_FREEZE_GLYCEMIA_CANDIDATE_SCHEMA_VERSION;
  sourceValidationNeed: {
    conclusion: "external_source_validation_required_before_any_product_or_scoring_use";
    minimumNextEvidenceClass: "true_external_validation_or_partner_aggregate_validation";
    reason: string;
  };
  storageAttestation: {
    aggregateOnly: true;
    calibrationParametersStored: false;
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
    protocolClaimsIncluded: false;
    recommendationClaimsIncluded: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceTextStored: false;
    splitMembershipStored: false;
  };
  status: "candidate_family_frozen_for_future_validation";
}

export async function runR608FreezeGlycemiaCandidate(
  options: R608FreezeGlycemiaCandidateOptions = {},
): Promise<{ output: R608FreezeGlycemiaCandidateManifest; outputPath: string }> {
  const [r606, r607Packet, r607ReviewGpt] = await Promise.all([
    readRequiredJson(options.r606Path ?? DEFAULT_R606_PATH, "r606 aggregate ablation"),
    readRequiredJson(options.r607PacketPath ?? DEFAULT_R607_PACKET_PATH, "r607 aggregate review packet"),
    readRequiredJson(options.r607ReviewGptPath ?? DEFAULT_R607_REVIEWGPT_PATH, "r607 ReviewGPT reduction"),
  ]);

  const evidenceInputs = [
    summarizeR606Evidence(r606),
    summarizeR607PacketEvidence(r607Packet),
  ];
  const consensusInputs = [summarizeR607Consensus(r607ReviewGpt)];
  assertR607FreezeReady(r607Packet, consensusInputs[0]);

  const output: R608FreezeGlycemiaCandidateManifest = {
    allowedNextUse: {
      allowedActions: [
        "reference_manifest_in_future_benchmark_card",
        "prepare_source_specific_feature_crosswalk_labels",
        "run_frozen_family_only_after_source_activation_and_aggregate_export_rules",
        "compare_against_age_sex_reference_on_locked_external_or_partner_lane",
      ],
      requiredBeforeExecution: [
        "source_rights_activation",
        "locked_endpoint_denominator_and_censoring_rules",
        "aggregate_export_policy_with_small_cell_suppression",
        "predeclared_missingness_and_abstention_policy",
      ],
      scope: "future_external_or_source_validation_only",
    },
    blockedUses: [
      "same_lane_candidate_tuning",
      "row_level_export",
      "participant_level_scoring",
      "prediction_export",
      "coefficient_or_parameter_export",
      "product_display",
      "product_promotion",
      "protocol_or_recommendation_claims",
      "clinical_or_actionability_claims",
      "source_text_or_codebook_body_storage",
    ],
    candidateFamily: {
      excludedDomainsForThisFreeze: ["body_size", "lipids", "inflammation", "blood_pressure", "medications", "wearables"],
      familyId: "tiny_glycemia_only",
      frozenFromDecision: "freeze_glycemia_only_candidate",
      includedDomains: ["demographics", "glycemia"],
      label: "age_sex_plus_glycemia",
    },
    consensusInputs,
    createdAt: options.createdAt ?? new Date().toISOString(),
    evidenceInputs,
    frozenCandidateId: "age_sex_plus_glycemia",
    manifestId: "r608-freeze-glycemia-candidate",
    schemaVersion: R608_FREEZE_GLYCEMIA_CANDIDATE_SCHEMA_VERSION,
    sourceValidationNeed: {
      conclusion: "external_source_validation_required_before_any_product_or_scoring_use",
      minimumNextEvidenceClass: "true_external_validation_or_partner_aggregate_validation",
      reason: "R607 consensus froze the tiny glycemia-only family as the next candidate to carry forward, but the supporting evidence remains local aggregate and source-validation seeking.",
    },
    status: "candidate_family_frozen_for_future_validation",
    storageAttestation: {
      aggregateOnly: true,
      calibrationParametersStored: false,
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
      protocolClaimsIncluded: false,
      recommendationClaimsIncluded: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceTextStored: false,
      splitMembershipStored: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R608 freeze manifest failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeR606Evidence(value: unknown): EvidenceInput {
  const root = requiredRecord(value, "R606 aggregate ablation");
  const summary = requiredRecord(root.summary, "R606 summary");
  return {
    artifact: "r606-parsimonious-glycemia-ablation.latest.json",
    inputId: "r606_aggregate_ablation",
    relevantConclusion: requiredMetadataLabel(summary.conclusion, "R606 conclusion"),
    schemaVersion: requiredMetadataLabel(root.schemaVersion, "R606 schema version"),
    status: requiredMetadataLabel(root.status, "R606 status"),
  };
}

function summarizeR607PacketEvidence(value: unknown): EvidenceInput {
  const root = requiredRecord(value, "R607 aggregate review packet");
  const summary = requiredRecord(root.summary, "R607 summary");
  if (summary.productPromotionAuthorized !== false) {
    throw new Error("R607 aggregate review packet does not preserve the product-promotion boundary.");
  }
  return {
    artifact: "r607-glycemia-ablation-review-packet.latest.json",
    inputId: "r607_review_packet",
    relevantConclusion: requiredMetadataLabel(summary.nextLocalAction, "R607 next local action"),
    schemaVersion: requiredMetadataLabel(root.schemaVersion, "R607 schema version"),
    status: requiredMetadataLabel(root.status, "R607 status"),
  };
}

function summarizeR607Consensus(value: unknown): ConsensusInput {
  const root = requiredRecord(value, "R607 ReviewGPT reduction");
  const consensus = requiredRecord(root.consensus, "R607 ReviewGPT consensus");
  const decisionCounts = readNumberRecord(root.decision_counts, "R607 ReviewGPT decision counts");
  const topDecision = requiredMetadataLabel(consensus.top_decision, "R607 top decision");
  if (topDecision !== "freeze_glycemia_only_candidate") {
    throw new Error("R607 ReviewGPT consensus did not approve freezing the glycemia-only candidate.");
  }
  const trustedReviewCount = requiredNumber(root.trusted_count, "R607 trusted count");
  const completedReviewCount = requiredNumber(consensus.completed_count, "R607 completed count");
  const topCount = requiredNumber(consensus.top_count, "R607 top count");
  if (trustedReviewCount < 3 || completedReviewCount < 3 || topCount < 3) {
    throw new Error("R607 ReviewGPT consensus is below the required trusted-majority threshold.");
  }
  if (decisionCounts.freeze_glycemia_only_candidate !== topCount) {
    throw new Error("R607 ReviewGPT decision counts do not match the consensus top count.");
  }
  return {
    artifact: "r607-glycemia-ablation-review-summary.json",
    completedReviewCount,
    decisionCounts,
    status: "trusted_majority",
    topDecision,
    trustedReviewCount,
  };
}

function assertR607FreezeReady(value: unknown, consensus: ConsensusInput): void {
  const root = requiredRecord(value, "R607 aggregate review packet");
  const summary = requiredRecord(root.summary, "R607 summary");
  const resultInterpretation = requiredRecord(root.resultInterpretation, "R607 result interpretation");
  const candidateResults = readRecordArray(resultInterpretation.candidateResults, "R607 candidate results");
  const supportedSources = new Set<string>();
  for (const result of candidateResults) {
    if (
      result.candidateId === "age_sex_plus_glycemia" &&
      result.properScoreDirection === "better_than_age_sex"
    ) {
      supportedSources.add(requiredMetadataLabel(result.sourceId, "R607 supporting source id"));
    }
  }
  if (requiredMetadataLabel(summary.nextLocalAction, "R607 next local action") !== "freeze_tiny_glycemia_candidate_and_seek_external_outcome_lane") {
    throw new Error("R607 aggregate review packet does not request the expected freeze action.");
  }
  if (supportedSources.size < 2) {
    throw new Error("R607 aggregate review packet does not show glycemia-only support on enough aggregate source lanes.");
  }
  if (consensus.topDecision !== "freeze_glycemia_only_candidate") {
    throw new Error("R607 consensus is not aligned with the freeze action.");
  }
}

async function readRequiredJson(filePath: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
      throw new Error(`Missing required aggregate artifact: ${label}.`);
    }
    throw new Error(`Failed to read required Murph Age aggregate artifact: ${label}.`);
  }
}

function readRecordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`${label} must be an object array.`);
  }
  return value as Record<string, unknown>[];
}

function readNumberRecord(value: unknown, label: string): Record<string, number> {
  const record = requiredRecord(value, label);
  const entries = Object.entries(record);
  if (entries.some((entry) => typeof entry[1] !== "number" || !Number.isFinite(entry[1]))) {
    throw new Error(`${label} must contain finite numbers.`);
  }
  return Object.fromEntries(entries) as Record<string, number>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function requiredMetadataLabel(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 120 ||
    /[\r\n\t/\\]/u.test(value) ||
    /\b(?:http|file|authorization|coefficient|participant|prediction|row|source\s*body|source\s*text)\b/iu.test(value)
  ) {
    throw new Error(`${label} is not a safe metadata label.`);
  }
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR608FreezeGlycemiaCandidate({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r606Path: process.env.MURPH_AGE_R606_PACKET_PATH,
    r607PacketPath: process.env.MURPH_AGE_R607_PACKET_PATH,
    r607ReviewGptPath: process.env.MURPH_AGE_R607_REVIEWGPT_PATH,
  }).then(({ output, outputPath }) => {
    process.stdout.write(`${JSON.stringify({
      artifact: path.basename(outputPath),
      consensusStatus: output.consensusInputs[0]?.status,
      frozenCandidateId: output.frozenCandidateId,
      manifestId: output.manifestId,
      productPromotionAuthorized: output.storageAttestation.productPromotionAuthorized,
      schemaVersion: output.schemaVersion,
      status: output.status,
    }, null, 2)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R608 freeze manifest failed.");
    process.exitCode = 1;
  });
}
