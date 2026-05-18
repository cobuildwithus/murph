import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1050_WEARABLE_ADJACENT_PHYSIOLOGY_STATE_SCHEMA_VERSION =
  "murph-age-r1050-wearable-adjacent-physiology-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R1044_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1044-haalsi-external-biomarker-loop.latest.json");
const DEFAULT_R1046_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1046-nshap-hba1c-replication-loop.latest.json");
const DEFAULT_R1049_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1049-nhanes-activity-control-diagnostic.latest.json");
const OUTPUT_FILE_NAME = "r1050-wearable-adjacent-physiology-state.latest.json";

const EXPECTED_INPUT_METADATA = {
  r1044Haalsi: {
    packetId: "r1044-haalsi-external-biomarker-loop",
    schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
  },
  r1046Nshap: {
    packetId: "r1046-nshap-hba1c-replication-loop",
    schemaVersion: "murph-age-r1046-nshap-hba1c-replication-loop.v1",
  },
  r1049NhanesActivity: {
    packetId: "r1049-nhanes-activity-control-diagnostic",
    schemaVersion: "murph-age-r1049-nhanes-activity-control-diagnostic.v1",
  },
} as const;

const HAALSI_SOURCE_ID = "haalsi_w1_to_w3" as const;
const NSHAP_SOURCE_IDS = ["nshap_w1_to_w3", "nshap_w2_to_w3"] as const;
const HAALSI_PULSE_CANDIDATES = ["P1_pulse_only", "P2_glucose_pulse", "P3_glucose_body_pulse"] as const;
const NSHAP_PULSE_CANDIDATES = ["P1_pulse_only", "P2_hba1c_pulse", "P3_hba1c_body_pulse"] as const;
const HAALSI_NEGATIVE_CONTROLS = ["NC2_body_only_without_glucose", "NC3_lipid_body_without_glucose", "NC5_noise_feature"] as const;
const NSHAP_NEGATIVE_CONTROLS = ["NC2_body_only_without_hba1c", "NC5_noise_feature"] as const;

type InputKey = keyof typeof EXPECTED_INPUT_METADATA;
type SourceStatus = "clean_pulse_separation" | "missing_pulse_candidate" | "pulse_not_supported" | "pulse_signal_control_limited";

export interface R1050WearableAdjacentPhysiologyStateOptions {
  createdAt?: string;
  outputDir?: string;
  r1044Path?: string;
  r1046Path?: string;
  r1049Path?: string;
}

interface InputArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface CandidateSummary {
  brierDelta: number | null;
  candidateId: string;
  logLossDelta: number | null;
  verdict: "beats_age_sex" | "does_not_beat_age_sex" | "reference" | null;
}

interface SourceDiagnostic {
  bestNegativeControl: CandidateSummary | null;
  bestPulseCandidate: CandidateSummary | null;
  interpretation: string;
  logLossSeparationFromBestControl: number | null;
  status: SourceStatus;
}

export interface R1050WearableAdjacentPhysiologyStateOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  decision: {
    conclusion:
      | "pulse_rhr_inputs_missing"
      | "pulse_rhr_shadow_signal_mixed_control_limited"
      | "pulse_rhr_shadow_signal_not_supported"
      | "pulse_rhr_shadow_signal_supported";
    nextAction:
      | "build_partner_integrated_wearable_evaluator_before_any_score_bearing_pulse_use"
      | "keep_activity_and_pulse_shadow_seek_true_wearable_outcome_source"
      | "rerun_or_repair_pulse_inputs";
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rationale: string;
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  inputArtifacts: Record<InputKey, InputArtifactSummary>;
  objectiveActivityContext: {
    nhanesActivityConclusion: string | null;
    shadowActivityCandidate: "C8_lab9_hba1c_bp_body_activity_primary" | null;
    status: "missing" | "shadow_supported_calibration_limited" | "shadow_unclear";
  };
  packetId: "r1050-wearable-adjacent-physiology-state";
  pulsePhysiology: {
    caveat: "pulse_is_wearable_adjacent_not_consumer_wearable_validation";
    sourceDiagnostics: Record<string, SourceDiagnostic>;
    supportCounts: {
      cleanSupport: number;
      controlLimited: number;
      negativeOrMissing: number;
    };
  };
  schemaVersion: typeof R1050_WEARABLE_ADJACENT_PHYSIOLOGY_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    currentWearableAdjacentLead: "objective_activity_plus_pulse_shadow" | "objective_activity_shadow_only" | "none";
    modelUse: "research_only_no_product_display";
    nextAutoresearchStep: "build_partner_integrated_wearable_evaluator_or_true_wearable_outcome_source";
    reviewGptUse: "major_scientific_result_review_after_partner_or_true_wearable_delta";
  };
}

export async function runR1050WearableAdjacentPhysiologyState(
  options: R1050WearableAdjacentPhysiologyStateOptions = {},
): Promise<{ output: R1050WearableAdjacentPhysiologyStateOutput; outputPath: string }> {
  const inputs = {
    r1044Haalsi: await readJsonIfPresent(options.r1044Path ?? DEFAULT_R1044_PATH),
    r1046Nshap: await readJsonIfPresent(options.r1046Path ?? DEFAULT_R1046_PATH),
    r1049NhanesActivity: await readJsonIfPresent(options.r1049Path ?? DEFAULT_R1049_PATH),
  };
  validateInputs(inputs);

  const sourceDiagnostics = {
    [HAALSI_SOURCE_ID]: summarizeSource(
      readRecordAt(inputs.r1044Haalsi, ["models"]),
      HAALSI_PULSE_CANDIDATES,
      HAALSI_NEGATIVE_CONTROLS,
    ),
    ...Object.fromEntries(NSHAP_SOURCE_IDS.map((sourceId) => [
      sourceId,
      summarizeSource(
        readRecordAt(inputs.r1046Nshap, ["sources", sourceId, "models"]),
        NSHAP_PULSE_CANDIDATES,
        NSHAP_NEGATIVE_CONTROLS,
      ),
    ])),
  };
  const supportCounts = countSupport(sourceDiagnostics);
  const objectiveActivityContext = summarizeObjectiveActivity(inputs.r1049NhanesActivity);
  const decision = summarizeDecision(supportCounts, objectiveActivityContext.status);
  const output: R1050WearableAdjacentPhysiologyStateOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    decision,
    inputArtifacts: summarizeInputArtifacts(inputs),
    objectiveActivityContext,
    packetId: "r1050-wearable-adjacent-physiology-state",
    pulsePhysiology: {
      caveat: "pulse_is_wearable_adjacent_not_consumer_wearable_validation",
      sourceDiagnostics,
      supportCounts,
    },
    schemaVersion: R1050_WEARABLE_ADJACENT_PHYSIOLOGY_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      currentWearableAdjacentLead: supportCounts.cleanSupport > 0 || supportCounts.controlLimited > 0
        ? "objective_activity_plus_pulse_shadow"
        : objectiveActivityContext.status === "shadow_supported_calibration_limited"
          ? "objective_activity_shadow_only"
          : "none",
      modelUse: "research_only_no_product_display",
      nextAutoresearchStep: "build_partner_integrated_wearable_evaluator_or_true_wearable_outcome_source",
      reviewGptUse: "major_scientific_result_review_after_partner_or_true_wearable_delta",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1050 wearable-adjacent physiology state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeSource(
  models: Record<string, unknown>,
  pulseCandidateIds: readonly string[],
  negativeControlIds: readonly string[],
): SourceDiagnostic {
  const pulseCandidates = pulseCandidateIds
    .map((candidateId) => summarizeCandidate(candidateId, models[candidateId]))
    .filter((candidate): candidate is CandidateSummary => candidate !== null);
  const negativeControls = negativeControlIds
    .map((candidateId) => summarizeCandidate(candidateId, models[candidateId]))
    .filter((candidate): candidate is CandidateSummary => candidate !== null);
  const bestPulseCandidate = bestByLogLossImprovement(pulseCandidates);
  const bestNegativeControl = bestByLogLossImprovement(negativeControls);
  if (!bestPulseCandidate) {
    return {
      bestNegativeControl,
      bestPulseCandidate: null,
      interpretation: "Pulse candidate missing from aggregate source summary.",
      logLossSeparationFromBestControl: null,
      status: "missing_pulse_candidate",
    };
  }
  if (!properScoreCandidate(bestPulseCandidate)) {
    return {
      bestNegativeControl,
      bestPulseCandidate,
      interpretation: "Pulse candidate does not improve proper scores over age/sex in this aggregate source.",
      logLossSeparationFromBestControl: null,
      status: "pulse_not_supported",
    };
  }
  const controlsCompete = negativeControls.some(properScoreCandidate);
  const separation = bestPulseCandidate.logLossDelta !== null
      && bestNegativeControl !== null
      && bestNegativeControl.logLossDelta !== null
    ? roundMetric(bestPulseCandidate.logLossDelta - bestNegativeControl.logLossDelta)
    : null;
  return {
    bestNegativeControl,
    bestPulseCandidate,
    interpretation: controlsCompete
      ? "Pulse improves, but at least one negative control also improves in this aggregate source."
      : "Pulse improves while negative controls do not compete in this aggregate source.",
    logLossSeparationFromBestControl: separation,
    status: controlsCompete ? "pulse_signal_control_limited" : "clean_pulse_separation",
  };
}

function summarizeCandidate(candidateId: string, value: unknown): CandidateSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    brierDelta: readNumberAt(value, ["deltasVsAgeSexReference", "brierDelta"]),
    candidateId,
    logLossDelta: readNumberAt(value, ["deltasVsAgeSexReference", "logLossDelta"]),
    verdict: safeVerdict(readStringAt(value, ["verdict"])),
  };
}

function summarizeObjectiveActivity(value: unknown | null): R1050WearableAdjacentPhysiologyStateOutput["objectiveActivityContext"] {
  const conclusion = readStringAt(value, ["decision", "conclusion"]);
  const activityCandidate = readStringAt(value, ["shadowCarryForward", "activityCandidate"]);
  if (!conclusion) {
    return {
      nhanesActivityConclusion: null,
      shadowActivityCandidate: null,
      status: "missing",
    };
  }
  return {
    nhanesActivityConclusion: safeActivityConclusion(conclusion),
    shadowActivityCandidate: activityCandidate === "C8_lab9_hba1c_bp_body_activity_primary"
      ? "C8_lab9_hba1c_bp_body_activity_primary"
      : null,
    status: conclusion === "nhanes_activity_signal_control_clean_global_calibration_limited"
      ? "shadow_supported_calibration_limited"
      : "shadow_unclear",
  };
}

function summarizeDecision(
  supportCounts: R1050WearableAdjacentPhysiologyStateOutput["pulsePhysiology"]["supportCounts"],
  activityStatus: R1050WearableAdjacentPhysiologyStateOutput["objectiveActivityContext"]["status"],
): R1050WearableAdjacentPhysiologyStateOutput["decision"] {
  if (supportCounts.cleanSupport === 0 && supportCounts.controlLimited === 0 && supportCounts.negativeOrMissing === 3) {
    return {
      conclusion: activityStatus === "missing" ? "pulse_rhr_inputs_missing" : "pulse_rhr_shadow_signal_not_supported",
      nextAction: activityStatus === "missing"
        ? "rerun_or_repair_pulse_inputs"
        : "keep_activity_and_pulse_shadow_seek_true_wearable_outcome_source",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rationale: activityStatus === "missing"
        ? "Required aggregate pulse/activity inputs are missing or incomplete."
        : "Aggregate pulse physiology does not add a clean signal over age/sex in current sources.",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }
  if (supportCounts.controlLimited > 0) {
    return {
      conclusion: "pulse_rhr_shadow_signal_mixed_control_limited",
      nextAction: "build_partner_integrated_wearable_evaluator_before_any_score_bearing_pulse_use",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rationale: "Pulse/RHR-style physiology has aggregate support, but at least one source has competing controls and none are true consumer wearable validation.",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }
  return {
    conclusion: "pulse_rhr_shadow_signal_supported",
    nextAction: "build_partner_integrated_wearable_evaluator_before_any_score_bearing_pulse_use",
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rationale: "Pulse/RHR-style physiology improves in available aggregate sources, but remains shadow until true wearable outcome validation exists.",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

function countSupport(
  sourceDiagnostics: Record<string, SourceDiagnostic>,
): R1050WearableAdjacentPhysiologyStateOutput["pulsePhysiology"]["supportCounts"] {
  const values = Object.values(sourceDiagnostics);
  return {
    cleanSupport: values.filter((diagnostic) => diagnostic.status === "clean_pulse_separation").length,
    controlLimited: values.filter((diagnostic) => diagnostic.status === "pulse_signal_control_limited").length,
    negativeOrMissing: values.filter((diagnostic) =>
      diagnostic.status === "missing_pulse_candidate" || diagnostic.status === "pulse_not_supported"
    ).length,
  };
}

function properScoreCandidate(candidate: CandidateSummary): boolean {
  return candidate.verdict === "beats_age_sex"
    && candidate.brierDelta !== null
    && candidate.brierDelta < 0
    && candidate.logLossDelta !== null
    && candidate.logLossDelta < 0;
}

function bestByLogLossImprovement(candidates: CandidateSummary[]): CandidateSummary | null {
  let best: CandidateSummary | null = null;
  for (const candidate of candidates) {
    if (candidate.logLossDelta === null) continue;
    if (best === null || best.logLossDelta === null || candidate.logLossDelta < best.logLossDelta) {
      best = candidate;
    }
  }
  return best;
}

function safeVerdict(verdict: string | null): CandidateSummary["verdict"] {
  if (verdict === "beats_age_sex" || verdict === "does_not_beat_age_sex" || verdict === "reference") return verdict;
  return null;
}

function safeActivityConclusion(conclusion: string): string | null {
  return conclusion === "nhanes_activity_signal_control_clean_global_calibration_limited"
      || conclusion === "nhanes_activity_signal_control_clean_calibration_acceptable"
      || conclusion === "nhanes_activity_signal_control_competed"
      || conclusion === "nhanes_activity_signal_not_supported"
      || conclusion === "nhanes_activity_receipt_missing"
    ? conclusion
    : null;
}

function summarizeInputArtifacts(inputs: Record<InputKey, unknown | null>): Record<InputKey, InputArtifactSummary> {
  return Object.fromEntries((Object.keys(EXPECTED_INPUT_METADATA) as InputKey[]).map((key) => {
    const value = inputs[key];
    const expected = EXPECTED_INPUT_METADATA[key];
    if (value === null) {
      return [key, {
        artifact: artifactNameForInput(key),
        packetId: null,
        schemaVersion: null,
        status: "missing",
      }];
    }
    const packetId = readStringAt(value, ["packetId"]);
    const schemaVersion = readStringAt(value, ["schemaVersion"]);
    return [key, {
      artifact: artifactNameForInput(key),
      packetId: packetId === expected.packetId ? packetId : null,
      schemaVersion: schemaVersion === expected.schemaVersion ? schemaVersion : null,
      status: "available",
    }];
  })) as Record<InputKey, InputArtifactSummary>;
}

function artifactNameForInput(key: InputKey): string {
  if (key === "r1044Haalsi") return "r1044-haalsi-external-biomarker-loop.latest.json";
  if (key === "r1046Nshap") return "r1046-nshap-hba1c-replication-loop.latest.json";
  return "r1049-nhanes-activity-control-diagnostic.latest.json";
}

function validateInputs(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (value === null) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1050 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readRecordAt(value: unknown | null, keys: string[]): Record<string, unknown> {
  const found = readAt(value, keys);
  return found && typeof found === "object" && !Array.isArray(found) ? found as Record<string, unknown> : {};
}

function readNumberAt(value: unknown | null, keys: string[]): number | null {
  const found = readAt(value, keys);
  return typeof found === "number" && Number.isFinite(found) ? found : null;
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

function roundMetric(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(8)) : null;
}

async function main(): Promise<void> {
  const { output } = await runR1050WearableAdjacentPhysiologyState({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1044Path: process.env.MURPH_AGE_R1044_HAALSI_PATH,
    r1046Path: process.env.MURPH_AGE_R1046_NSHAP_PATH,
    r1049Path: process.env.MURPH_AGE_R1049_ACTIVITY_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    conclusion: output.decision.conclusion,
    currentWearableAdjacentLead: output.summary.currentWearableAdjacentLead,
    nextAction: output.decision.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.decision.productDisplayAuthorized,
    reviewGptRequiredBeforeNextLocalRun: output.decision.reviewGptRequiredBeforeNextLocalRun,
    schemaVersion: output.schemaVersion,
    status: output.status,
    supportCounts: output.pulsePhysiology.supportCounts,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R1050 wearable-adjacent physiology state failed.\n");
    process.exitCode = 1;
  });
}
