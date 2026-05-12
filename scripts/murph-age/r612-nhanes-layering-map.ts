import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R612_NHANES_LAYERING_MAP_SCHEMA_VERSION =
  "murph-age-r612-nhanes-layering-map.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r612-nhanes-layering-map.latest.json";
const DEFAULT_R846_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r846_nhanes_objective_activity_lab_first_loop",
  "nhanes-objective-activity-lab-first-loop-r846.json",
);
const DEFAULT_R849_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r849_nhanes_lab_first_product_shaped_loop",
  "nhanes-lab-first-product-shaped-loop-r849.json",
);
const DEFAULT_R850_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r850_nhanes_2003_2006_hip_activity_loop",
  "nhanes-2003-2006-hip-activity-loop-r850.json",
);
const DEFAULT_R852_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r852_r850_activity_stability",
  "r850-activity-stability-r852.json",
);
const DEFAULT_R871_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "model-cards",
  "research-model-card-manifest-r871.json",
);
const DEFAULT_R176_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "reviewgpt",
  "reduced",
  "r176-nhanes-iii-aggregate-results-review-summary.json",
);

type LayerId =
  | "lab-bp-body-score-bearing-research"
  | "objective-activity-shadow"
  | "historical-same-family-caveat"
  | "overfit-guard";

type LayerRole =
  | "score_bearing_research_layer"
  | "shadow_context_layer"
  | "same_family_context_only"
  | "selection_pressure_guard";

type LayerStatus =
  | "research_score_candidate_not_product_default"
  | "shadow_only_until_hard_outcome_device_validation"
  | "historical_same_family_not_external_validation"
  | "active_guardrail";

type ArtifactStatus = "available";
type Direction = "improved" | "not_clearly_improved" | "mixed_or_context_only";

interface EvidenceArtifactSummary {
  artifact: string;
  artifactId: string;
  evidenceClass: string | null;
  promotionStatus: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface DeltaSummary {
  aucDelta: number | null;
  brierDelta: number | null;
  comparisonId: string;
  direction: Direction;
  logLossDelta: number | null;
}

interface StabilitySummary {
  aucDeltaCiCrossesZero: boolean;
  brierImprovedFraction: number;
  brierWeightedDeltaCi: { p025: number; p50: number; p975: number };
  logLossImprovedFraction: number;
  logLossWeightedDeltaCi: { p025: number; p50: number; p975: number };
  repsBand: string;
}

interface LayerSummary {
  allowedUse: string[];
  artifactIds: string[];
  blockedUse: string[];
  evidenceLabel: string;
  featureFamilies: string[];
  layerId: LayerId;
  modelLayerRole: LayerRole;
  productDisplayAuthorized: false;
  productPromotionAuthorized: false;
  scoreBearingInResearch: boolean;
  scoreBearingInProduct: false;
  status: LayerStatus;
  support: string[];
}

export interface R612NhanesLayeringMapOptions {
  createdAt?: string;
  outputDir?: string;
  r176Path?: string;
  r846Path?: string;
  r849Path?: string;
  r850Path?: string;
  r852Path?: string;
  r871Path?: string;
}

export interface R612NhanesLayeringMap {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformed: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: EvidenceArtifactSummary[];
  layers: {
    historicalSameFamilyCaveat: LayerSummary & {
      nhanesBench0Role: string;
      nhanesIiiRole: string;
      r176ReviewDecision: string;
      r176SafeToContinue: boolean;
    };
    labBpBodyScoreBearingResearch: LayerSummary & {
      primaryComparison: DeltaSummary;
      r871PromotionStatus: string | null;
    };
    objectiveActivityShadow: LayerSummary & {
      activityComparisons: DeltaSummary[];
      stability: StabilitySummary;
      r871PromotionStatus: string | null;
    };
    overfitGuard: LayerSummary & {
      blockedActions: string[];
      nextAllowedUses: string[];
      selectionPressureRule: string;
    };
  };
  packetId: "r612-nhanes-layering-map";
  schemaVersion: typeof R612_NHANES_LAYERING_MAP_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: "nhanes_layers_mapped_without_product_promotion";
    modelDefaultAuthorized: false;
    objectiveActivityLayer: "shadow_only";
    scoreBearingResearchLayer: "lab_bp_body";
  };
}

export async function runR612NhanesLayeringMap(
  options: R612NhanesLayeringMapOptions = {},
): Promise<{ output: R612NhanesLayeringMap; outputPath: string }> {
  const [r846, r849, r850, r852, r871, r176] = await Promise.all([
    readJson(options.r846Path ?? DEFAULT_R846_PATH),
    readJson(options.r849Path ?? DEFAULT_R849_PATH),
    readJson(options.r850Path ?? DEFAULT_R850_PATH),
    readJson(options.r852Path ?? DEFAULT_R852_PATH),
    readJson(options.r871Path ?? DEFAULT_R871_PATH),
    readJson(options.r176Path ?? DEFAULT_R176_PATH),
  ]);

  assertAggregateBoundary(r846, "r846");
  assertAggregateBoundary(r849, "r849");
  assertAggregateBoundary(r850, "r850");
  assertAggregateBoundary(r852, "r852");
  assertAggregateBoundary(r871, "r871");

  const labCard = cardById(r871, "lab9_bp_body_10y_acm_research");
  const activityCard = cardById(r871, "lab10_bp_body_objective_activity_10y_acm_research");
  const wearableSidecar = cardById(r871, "wearable_context_no_risk");
  const r176ReviewDecision = r176Decision(r176);

  const output: R612NhanesLayeringMap = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformed: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: [
      artifactSummary(r846, "r846", "nhanes-objective-activity-lab-first-loop-r846.json"),
      artifactSummary(r849, "r849", "nhanes-lab-first-product-shaped-loop-r849.json"),
      artifactSummary(r850, "r850", "nhanes-2003-2006-hip-activity-loop-r850.json"),
      artifactSummary(r852, "r852", "r850-activity-stability-r852.json"),
      artifactSummary(r871, "r871", "research-model-card-manifest-r871.json"),
      artifactSummary(r176, "r176", "r176-nhanes-iii-aggregate-results-review-summary.json"),
    ],
    layers: {
      historicalSameFamilyCaveat: {
        ...baseLayer({
          allowedUse: [
            "plumbing_context",
            "feature_family_context",
            "hypothesis_generation_for_new_locked_benchmarks",
          ],
          artifactIds: ["r176", "r846", "r849", "r850", "r852", "r871"],
          blockedUse: [
            "true_external_validation_claim",
            "product_promotion",
            "same_family_test_split_optimization",
          ],
          evidenceLabel: "same-family-sanity",
          featureFamilies: [
            "blood-pressure",
            "body-composition",
            "labs",
            "objective-activity",
          ],
          layerId: "historical-same-family-caveat",
          modelLayerRole: "same_family_context_only",
          scoreBearingInResearch: false,
          status: "historical_same_family_not_external_validation",
          support: [
            "NHANES Bench-0 remains a historical lab, BP, and body anchor, not the current live model.",
            "NHANES III aggregate review approved same-family sanity use and continuing toward external sources.",
            "NHANES objective activity runs are measurement-family stress evidence, not consumer wearable validation.",
          ],
        }),
        nhanesBench0Role: "historical_internal_lab_body_reference_only",
        nhanesIiiRole: "aggregate_only_same_family_historical_sanity",
        r176ReviewDecision,
        r176SafeToContinue: r176SafeToContinue(r176),
      },
      labBpBodyScoreBearingResearch: {
        ...baseLayer({
          allowedUse: [
            "research_scoring_candidate",
            "lab_bp_body_feature_family_evidence",
            "future_external_validation_hypothesis",
          ],
          artifactIds: ["r849", "r871"],
          blockedUse: [
            "product_default",
            "biological_age_display",
            "causal_or_intervention_claim",
          ],
          evidenceLabel: "internal-same-family-nhanes-lab-vitals",
          featureFamilies: [
            "age-sex",
            "blood-pressure",
            "body-composition",
            "non-crp-labs",
          ],
          layerId: "lab-bp-body-score-bearing-research",
          modelLayerRole: "score_bearing_research_layer",
          scoreBearingInResearch: true,
          status: "research_score_candidate_not_product_default",
          support: [
            supportRead(r849, "primary_lab9_over_bp_body"),
            "R871 keeps the lab, BP, and body card blocked until external fixed-horizon validation.",
          ],
        }),
        primaryComparison: comparisonDelta(r849, "lab9_hba1c_vs_bp_body"),
        r871PromotionStatus: optionalString(labCard.promotion_status),
      },
      objectiveActivityShadow: {
        ...baseLayer({
          allowedUse: [
            "shadow_context",
            "objective_activity_transport_stress",
            "future_partner_or_external_validation_hypothesis",
          ],
          artifactIds: ["r846", "r850", "r852", "r871"],
          blockedUse: [
            "current_score_contribution",
            "consumer_wearable_interchange_claim",
            "device_feature_product_validation",
          ],
          evidenceLabel: "same-family-objective-activity-shadow",
          featureFamilies: [
            "objective-wrist-activity",
            "objective-hip-activity",
            "wearable-context",
          ],
          layerId: "objective-activity-shadow",
          modelLayerRole: "shadow_context_layer",
          scoreBearingInResearch: false,
          status: "shadow_only_until_hard_outcome_device_validation",
          support: [
            supportRead(r846, "objective_activity_increment"),
            supportRead(r850, "activity_increment_over_lab10_bp_body"),
            "R852 stability supports split-level context only and does not create external or consumer-device validation.",
            `R871 wearable sidecar remains ${requiredString(wearableSidecar.promotion_status, "wearable sidecar promotion status")}.`,
          ],
        }),
        activityComparisons: [
          comparisonDelta(r846, "objective_activity_increment"),
          comparisonDelta(r850, "activity_increment_over_lab10_bp_body"),
        ],
        r871PromotionStatus: optionalString(activityCard.promotion_status),
        stability: stabilitySummary(r852),
      },
      overfitGuard: {
        ...baseLayer({
          allowedUse: [
            "selection_pressure_control",
            "future_benchmark_predeclaration",
            "aggregate_diagnostics_only",
          ],
          artifactIds: ["r176", "r846", "r849", "r850", "r852", "r871"],
          blockedUse: [
            "nhanes_only_tuning",
            "reselecting_features_from_inspected_same_family_results",
            "product_readiness_claim",
          ],
          evidenceLabel: "overfit-guard",
          featureFamilies: [],
          layerId: "overfit-guard",
          modelLayerRole: "selection_pressure_guard",
          scoreBearingInResearch: false,
          status: "active_guardrail",
          support: [
            "Treat inspected NHANES and NHANES III residuals as hypothesis sources only.",
            "Activity can move forward only through a new locked external or partner aggregate validation lane.",
            "Lab, BP, and body can remain the research score-bearing lane only under product-blocked research status.",
          ],
        }),
        blockedActions: [
          "parse_or_download_new_nhanes_rows_for_this_map",
          "tune_against_r846_r849_r850_r852_results",
          "promote_same_family_results_as_external_validation",
          "turn_objective_activity_into_consumer_wearable_validation",
        ],
        nextAllowedUses: [
          "predeclare_external_or_partner_benchmark_card",
          "carry_activity_as_shadow_context",
          "use_lab_bp_body_as_research_only_score_bearing_candidate",
        ],
        selectionPressureRule: "Already-inspected NHANES and NHANES III artifacts may only generate hypotheses for new locked benchmarks or partner aggregate validation.",
      },
    },
    packetId: "r612-nhanes-layering-map",
    schemaVersion: R612_NHANES_LAYERING_MAP_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "nhanes_layers_mapped_without_product_promotion",
      modelDefaultAuthorized: false,
      objectiveActivityLayer: "shadow_only",
      scoreBearingResearchLayer: "lab_bp_body",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R612 NHANES layering map failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function baseLayer(input: {
  allowedUse: string[];
  artifactIds: string[];
  blockedUse: string[];
  evidenceLabel: string;
  featureFamilies: string[];
  layerId: LayerId;
  modelLayerRole: LayerRole;
  scoreBearingInResearch: boolean;
  status: LayerStatus;
  support: string[];
}): LayerSummary {
  return {
    allowedUse: input.allowedUse,
    artifactIds: input.artifactIds,
    blockedUse: input.blockedUse,
    evidenceLabel: input.evidenceLabel,
    featureFamilies: input.featureFamilies,
    layerId: input.layerId,
    modelLayerRole: input.modelLayerRole,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    scoreBearingInProduct: false,
    scoreBearingInResearch: input.scoreBearingInResearch,
    status: input.status,
    support: input.support,
  };
}

function artifactSummary(value: unknown, artifactId: string, artifact: string): EvidenceArtifactSummary {
  const root = requiredRecord(value, artifactId);
  return {
    artifact,
    artifactId,
    evidenceClass: optionalString(root.evidence_class),
    promotionStatus: promotionStatus(root),
    schemaVersion: optionalString(root.schema_version),
    status: "available",
  };
}

function promotionStatus(root: Record<string, unknown>): string | null {
  const support = optionalRecord(root.support_read);
  if (support) return optionalString(support.promotion_status);
  return optionalString(root.status);
}

function supportRead(value: unknown, key: string): string {
  const root = requiredRecord(value, "support read artifact");
  const support = requiredRecord(root.support_read, "support read");
  return requiredString(support[key], `support read ${key}`);
}

function comparisonDelta(value: unknown, comparisonId: string): DeltaSummary {
  const root = requiredRecord(value, "comparison artifact");
  const comparisons = requiredRecord(root.comparisons, "comparisons");
  const comparison = requiredRecord(comparisons[comparisonId], comparisonId);
  return {
    aucDelta: optionalNumber(comparison.auc_delta),
    brierDelta: optionalNumber(comparison.brier_weighted_delta) ?? optionalNumber(comparison.brier_delta),
    comparisonId,
    direction: comparisonDirection(comparison.direction),
    logLossDelta: optionalNumber(comparison.log_loss_weighted_delta) ?? optionalNumber(comparison.log_loss_delta),
  };
}

function stabilitySummary(value: unknown): StabilitySummary {
  const root = requiredRecord(value, "R852 activity stability");
  const comparisons = requiredRecord(root.comparisons, "R852 comparisons");
  const comparison = requiredRecord(
    comparisons.activity_increment_over_lab10_bp_body,
    "R852 activity increment comparison",
  );
  const bootstrap = requiredRecord(comparison.bootstrap, "R852 activity bootstrap");
  const aucCi = ciRecord(bootstrap.auc_delta_ci, "R852 AUC delta CI");
  return {
    aucDeltaCiCrossesZero: aucCi.p025 < 0 && aucCi.p975 > 0,
    brierImprovedFraction: requiredNumber(bootstrap.fraction_brier_improved, "R852 Brier improved fraction"),
    brierWeightedDeltaCi: ciRecord(bootstrap.brier_weighted_delta_ci, "R852 Brier weighted delta CI"),
    logLossImprovedFraction: requiredNumber(bootstrap.fraction_log_loss_improved, "R852 log-loss improved fraction"),
    logLossWeightedDeltaCi: ciRecord(bootstrap.log_loss_weighted_delta_ci, "R852 log-loss weighted delta CI"),
    repsBand: countBand(requiredNumber(bootstrap.bootstrap_reps, "R852 bootstrap reps")),
  };
}

function cardById(value: unknown, cardId: string): Record<string, unknown> {
  const root = requiredRecord(value, "R871 manifest");
  const cards = requiredRecordArray(root.cards, "R871 cards");
  const card = cards.find((candidate) => candidate.card_id === cardId);
  if (!card) throw new Error(`R871 manifest is missing card ${cardId}.`);
  return card;
}

function r176Decision(value: unknown): string {
  const root = requiredRecord(value, "R176 NHANES III review summary");
  const counts = requiredRecord(root.counts_by_decision, "R176 decision counts");
  const entries = Object.entries(counts)
    .filter(([, count]) => typeof count === "number")
    .sort(([, left], [, right]) => (right as number) - (left as number));
  const [decision] = entries[0] ?? [];
  return decision ?? "no_completed_decision";
}

function r176SafeToContinue(value: unknown): boolean {
  const root = requiredRecord(value, "R176 NHANES III review summary");
  return root.safe_to_continue_after_review === true;
}

function assertAggregateBoundary(value: unknown, artifactId: string): void {
  const root = requiredRecord(value, artifactId);
  const boundary = optionalRecord(root.artifact_boundary);
  if (!boundary) return;
  const falseKeys = [
    "coefficients_exported",
    "minute_values_exported",
    "model_parameters_exported",
    "participant_ids_exported",
    "predictions_exported",
    "product_claims",
    "product_claims_created",
    "product_defaults_exported",
    "row_values_exported",
    "rows_exported",
    "source_bodies_exported",
    "split_memberships_exported",
  ];
  for (const key of falseKeys) {
    if (key in boundary && boundary[key] !== false) {
      throw new Error(`${artifactId} aggregate boundary flag ${key} must be false.`);
    }
  }
}

function ciRecord(value: unknown, label: string): { p025: number; p50: number; p975: number } {
  const record = requiredRecord(value, label);
  return {
    p025: requiredNumber(record.p025, `${label} p025`),
    p50: requiredNumber(record.p50, `${label} p50`),
    p975: requiredNumber(record.p975, `${label} p975`),
  };
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
      throw new Error("Missing required Murph Age aggregate artifact.");
    }
    throw new Error("Failed to read a Murph Age aggregate artifact.");
  }
}

function requiredRecordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`${label} must be an object array.`);
  }
  return value as Record<string, unknown>[];
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a string.`);
  return value;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredNumber(value: unknown, label: string): number {
  const number = optionalNumber(value);
  if (number === null) throw new Error(`${label} must be a finite number.`);
  return number;
}

function comparisonDirection(value: unknown): Direction {
  if (value === "improved" || value === "not_clearly_improved") return value;
  return "mixed_or_context_only";
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 50) return "10-49";
  if (count < 100) return "50-99";
  if (count < 500) return "100-499";
  if (count < 1000) return "500-999";
  return "1000+";
}

async function main(): Promise<void> {
  const { output } = await runR612NhanesLayeringMap({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r176Path: process.env.MURPH_AGE_R176_NHANES_III_REVIEW_PATH,
    r846Path: process.env.MURPH_AGE_R846_NHANES_ACTIVITY_PATH,
    r849Path: process.env.MURPH_AGE_R849_NHANES_LAB_PATH,
    r850Path: process.env.MURPH_AGE_R850_NHANES_HIP_ACTIVITY_PATH,
    r852Path: process.env.MURPH_AGE_R852_ACTIVITY_STABILITY_PATH,
    r871Path: process.env.MURPH_AGE_R871_MODEL_CARD_MANIFEST_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    conclusion: output.summary.conclusion,
    modelDefaultAuthorized: output.summary.modelDefaultAuthorized,
    objectiveActivityLayer: output.summary.objectiveActivityLayer,
    packetId: output.packetId,
    schemaVersion: output.schemaVersion,
    scoreBearingResearchLayer: output.summary.scoreBearingResearchLayer,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R612 NHANES layering map failed."}\n`);
    process.exitCode = 1;
  });
}
