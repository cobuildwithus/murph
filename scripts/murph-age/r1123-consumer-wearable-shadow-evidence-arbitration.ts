import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1123_CONSUMER_WEARABLE_SHADOW_EVIDENCE_ARBITRATION_SCHEMA_VERSION =
  "murph-age-r1123-consumer-wearable-shadow-evidence-arbitration.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1123-consumer-wearable-shadow-evidence-arbitration.latest.json";

const INPUTS = {
  r1049: {
    artifact: "r1049-nhanes-activity-control-diagnostic.latest.json",
    packetId: "r1049-nhanes-activity-control-diagnostic",
    schemaVersion: "murph-age-r1049-nhanes-activity-control-diagnostic.v1",
  },
  r1065: {
    artifact: "r1065-nhanes-wrist-activity-shadow-loop.latest.json",
    packetId: "r1065-nhanes-wrist-activity-shadow-loop",
    schemaVersion: "murph-age-r1065-nhanes-wrist-activity-shadow-loop.v1",
  },
  r1066: {
    artifact: "r1066-nhanes-wrist-activity-robustness-loop.latest.json",
    packetId: "r1066-nhanes-wrist-activity-robustness-loop",
    schemaVersion: "murph-age-r1066-nhanes-wrist-activity-robustness-loop.v1",
  },
  r1067: {
    artifact: "r1067-nhanes-wrist-final-stress-test.latest.json",
    packetId: "r1067-nhanes-wrist-final-stress-test",
    schemaVersion: "murph-age-r1067-nhanes-wrist-final-stress-test.v1",
  },
  r1120: {
    artifact: "r1120-consumer-lab-vitals-shadow-arbitration.latest.json",
    packetId: "r1120-consumer-lab-vitals-shadow-arbitration",
    schemaVersion: "murph-age-r1120-consumer-lab-vitals-shadow-arbitration.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type ArtifactStatus = "available" | "missing";
type WearableCandidateDecision =
  | "keep_first_wearable_candidate_after_l1_l2"
  | "hold_until_shadow_inputs_refresh"
  | "keep_blocked_until_outcome_linked_receipt";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface NhanesActivitySummary {
  calibrationBlocker: string | null;
  conclusion: string | null;
  negativeControlStatus: string | null;
  properScoreStatus: string | null;
  shadowCarryForwardCandidate: string | null;
}

interface WristInitialSummary {
  aucDelta: number | null;
  brierDelta: number | null;
  conclusion: string | null;
  eOverO: number | null;
  logLossDelta: number | null;
  negativeControlsBeaten: boolean | null;
  usableAsConsumerWearableValidation: false | null;
}

interface WristRobustnessSummary {
  activitySignalVerdict: string | null;
  conclusion: string | null;
  signStability: {
    brierImprovedFraction: number | null;
    logLossImprovedFraction: number | null;
  };
  usableAsConsumerWearableValidation: false | null;
}

interface WristFinalStressSummary {
  conclusion: string | null;
  earlyDeathStress: string | null;
  subgroupStress: string | null;
  transportStress: string | null;
  usableAsConsumerWearableValidation: false | null;
}

export interface R1123ConsumerWearableShadowEvidenceArbitrationOptions {
  createdAt?: string;
  outputDir?: string;
  r1049Path?: string;
  r1065Path?: string;
  r1066Path?: string;
  r1067Path?: string;
  r1120Path?: string;
}

export interface R1123ConsumerWearableShadowEvidenceArbitrationOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1123: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1123: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  arbitration: {
    candidateDecision: {
      integratedLabWearable: "held_until_lab_and_wearable_components_pass";
      l1TinyGlycemia: "run_first_in_consumer_compatible_receipt";
      l2CommonLabVitals: "include_as_secondary_comparator_not_lead";
      w1ActivityStepsMinutes: WearableCandidateDecision;
      w2SleepDurationRegularity: "keep_blocked_until_outcome_linked_receipt";
      w3RhrHrvRecovery: "keep_blocked_until_outcome_linked_receipt";
    };
    consumerPriority: {
      ageRangeFocus: "16_to_50";
      averageUserInputScope: [
        "common_bloodwork_labs",
        "basic_body_vitals",
        "wearable_activity_steps_minutes",
        "wearable_sleep",
        "wearable_recovery",
      ];
      firstExecutableFamily: "common_bloodwork_labs";
      firstWearableFamily: "wearable_activity_steps_minutes";
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
      wearableExecutionPolicy: "outcome_linked_receipt_required_before_scoring";
    };
    evidenceCounts: {
      missingShadowInputs: number;
      outcomeLinkedWearableReceipts: 0;
      wearableRobustnessBlockers: number;
      wearableShadowSupportSignals: number;
    };
    sourceSummaries: {
      nhanesActivity: NhanesActivitySummary;
      wristFinalStress: WristFinalStressSummary;
      wristInitial: WristInitialSummary;
      wristRobustness: WristRobustnessSummary;
    };
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1123-consumer-wearable-shadow-evidence-arbitration";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1123_CONSUMER_WEARABLE_SHADOW_EVIDENCE_ARBITRATION_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "consumer_wearable_shadow_evidence_insufficient"
      | "consumer_wearable_shadow_evidence_keep_w1_first_but_unvalidated"
      | "consumer_wearable_shadow_evidence_strengthened_but_requires_external_receipt"
      | "consumer_wearable_shadow_evidence_waiting_on_inputs";
    firstWearableCandidate: "W1_activity_steps_minutes" | null;
    nextAction:
      | "collect_outcome_linked_w1_receipt_after_l1_l2"
      | "refresh_nhanes_activity_wrist_shadow_artifacts"
      | "search_for_true_wearable_outcome_linked_receipt";
    outcomeLinkedWearableReceiptRequired: true;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1123: false;
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
    topLabCandidate: "L1_tiny_glycemia_only";
  };
}

export async function runR1123ConsumerWearableShadowEvidenceArbitration(
  options: R1123ConsumerWearableShadowEvidenceArbitrationOptions = {},
): Promise<{ output: R1123ConsumerWearableShadowEvidenceArbitrationOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const sourceSummaries = {
    nhanesActivity: summarizeNhanesActivity(inputs.r1049),
    wristFinalStress: summarizeWristFinalStress(inputs.r1067),
    wristInitial: summarizeWristInitial(inputs.r1065),
    wristRobustness: summarizeWristRobustness(inputs.r1066),
  };
  const evidenceCounts = summarizeEvidenceCounts(inputs, sourceSummaries);
  const summary = summarizeDecision(evidenceCounts);

  const output: R1123ConsumerWearableShadowEvidenceArbitrationOutput = {
    arbitration: {
      candidateDecision: {
        integratedLabWearable: "held_until_lab_and_wearable_components_pass",
        l1TinyGlycemia: "run_first_in_consumer_compatible_receipt",
        l2CommonLabVitals: "include_as_secondary_comparator_not_lead",
        w1ActivityStepsMinutes: w1Decision(summary.conclusion),
        w2SleepDurationRegularity: "keep_blocked_until_outcome_linked_receipt",
        w3RhrHrvRecovery: "keep_blocked_until_outcome_linked_receipt",
      },
      consumerPriority: {
        ageRangeFocus: "16_to_50",
        averageUserInputScope: [
          "common_bloodwork_labs",
          "basic_body_vitals",
          "wearable_activity_steps_minutes",
          "wearable_sleep",
          "wearable_recovery",
        ],
        firstExecutableFamily: "common_bloodwork_labs",
        firstWearableFamily: "wearable_activity_steps_minutes",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        wearableExecutionPolicy: "outcome_linked_receipt_required_before_scoring",
      },
      evidenceCounts,
      sourceSummaries,
    },
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1123-consumer-wearable-shadow-evidence-arbitration",
    productDisplayAuthorized: false,
    schemaVersion: R1123_CONSUMER_WEARABLE_SHADOW_EVIDENCE_ARBITRATION_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary,
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1123 consumer wearable shadow evidence arbitration failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeNhanesActivity(input: unknown | null): NhanesActivitySummary {
  return {
    calibrationBlocker: readStringAt(input, ["calibrationDiagnostic", "blocker"]),
    conclusion: readStringAt(input, ["decision", "conclusion"]),
    negativeControlStatus: readStringAt(input, ["negativeControlDiagnostic", "status"]),
    properScoreStatus: readStringAt(input, ["activityIncrement", "properScoreStatusAcrossReceipts"]),
    shadowCarryForwardCandidate: readStringAt(input, ["shadowCarryForward", "activityCandidate"]),
  };
}

function summarizeWristInitial(input: unknown | null): WristInitialSummary {
  const primary = readAt(input, ["summary", "c4WristActivityVsLab9"]);
  return {
    aucDelta: readNumberAt(primary, ["aucDelta"]),
    brierDelta: readNumberAt(primary, ["brierDelta"]),
    conclusion: readStringAt(input, ["summary", "conclusion"]),
    eOverO: readNumberAt(primary, ["eOverO"]),
    logLossDelta: readNumberAt(primary, ["logLossDelta"]),
    negativeControlsBeaten: readBooleanAt(primary, ["negativeControlsBeaten"]),
    usableAsConsumerWearableValidation: readFalseAt(input, ["summary", "usableAsConsumerWearableValidation"]),
  };
}

function summarizeWristRobustness(input: unknown | null): WristRobustnessSummary {
  return {
    activitySignalVerdict: readStringAt(input, ["summary", "robustness", "activitySignalVerdict"]),
    conclusion: readStringAt(input, ["summary", "conclusion"]),
    signStability: {
      brierImprovedFraction: readNumberAt(input, [
        "summary",
        "robustness",
        "uncertainty",
        "signStability",
        "brierImprovedFraction",
      ]),
      logLossImprovedFraction: readNumberAt(input, [
        "summary",
        "robustness",
        "uncertainty",
        "signStability",
        "logLossImprovedFraction",
      ]),
    },
    usableAsConsumerWearableValidation: readFalseAt(input, ["summary", "usableAsConsumerWearableValidation"]),
  };
}

function summarizeWristFinalStress(input: unknown | null): WristFinalStressSummary {
  return {
    conclusion: readStringAt(input, ["summary", "conclusion"]),
    earlyDeathStress: readStringAt(input, ["summary", "earlyDeathStress"]),
    subgroupStress: readStringAt(input, ["summary", "subgroupStress"]),
    transportStress: readStringAt(input, ["summary", "transportStress"]),
    usableAsConsumerWearableValidation: readFalseAt(input, ["summary", "usableAsConsumerWearableValidation"]),
  };
}

function summarizeEvidenceCounts(
  inputs: Record<InputKey, unknown | null>,
  sourceSummaries: R1123ConsumerWearableShadowEvidenceArbitrationOutput["arbitration"]["sourceSummaries"],
): R1123ConsumerWearableShadowEvidenceArbitrationOutput["arbitration"]["evidenceCounts"] {
  const missingShadowInputs = (["r1049", "r1065", "r1066", "r1067"] as const)
    .filter((key) => !inputMatchesExpected(key, inputs[key])).length;
  const activitySupport = sourceSummaries.nhanesActivity.conclusion === "nhanes_activity_signal_control_clean_global_calibration_limited"
    || sourceSummaries.nhanesActivity.conclusion === "nhanes_activity_signal_control_clean_calibration_acceptable";
  const wristInitialSupport = sourceSummaries.wristInitial.conclusion === "wrist_activity_signal_ready_for_r1034_review"
    && sourceSummaries.wristInitial.negativeControlsBeaten === true;
  const wristRobustnessSupport =
    sourceSummaries.wristRobustness.conclusion === "wrist_activity_robustness_supports_stronger_shadow_evidence";
  const wristFinalSupport =
    sourceSummaries.wristFinalStress.conclusion === "activity_wear_signal_persistent_but_non_specific_keep_shadow";
  const wristRobustnessBlockers = [
    sourceSummaries.wristRobustness.conclusion === "wrist_activity_robustness_inconclusive_keep_shadow",
    sourceSummaries.wristFinalStress.conclusion === "activity_wear_signal_unstable_keep_shadow",
    sourceSummaries.wristFinalStress.transportStress === "unstable",
    sourceSummaries.wristFinalStress.subgroupStress === "unstable",
  ].filter(Boolean).length;
  return {
    missingShadowInputs,
    outcomeLinkedWearableReceipts: 0,
    wearableRobustnessBlockers: wristRobustnessBlockers,
    wearableShadowSupportSignals: [
      activitySupport,
      wristInitialSupport,
      wristRobustnessSupport,
      wristFinalSupport,
    ].filter(Boolean).length,
  };
}

function summarizeDecision(
  evidenceCounts: R1123ConsumerWearableShadowEvidenceArbitrationOutput["arbitration"]["evidenceCounts"],
): R1123ConsumerWearableShadowEvidenceArbitrationOutput["summary"] {
  const base = {
    outcomeLinkedWearableReceiptRequired: true,
    productDisplayAuthorized: false,
    reviewGptRequiredNow: false,
    rowParsingPerformedByR1123: false,
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    topLabCandidate: "L1_tiny_glycemia_only",
  } as const;
  if (evidenceCounts.missingShadowInputs > 0) {
    return {
      ...base,
      conclusion: "consumer_wearable_shadow_evidence_waiting_on_inputs",
      firstWearableCandidate: null,
      nextAction: "refresh_nhanes_activity_wrist_shadow_artifacts",
    };
  }
  if (evidenceCounts.wearableShadowSupportSignals >= 3 && evidenceCounts.wearableRobustnessBlockers === 0) {
    return {
      ...base,
      conclusion: "consumer_wearable_shadow_evidence_strengthened_but_requires_external_receipt",
      firstWearableCandidate: "W1_activity_steps_minutes",
      nextAction: "collect_outcome_linked_w1_receipt_after_l1_l2",
    };
  }
  if (evidenceCounts.wearableShadowSupportSignals >= 2) {
    return {
      ...base,
      conclusion: "consumer_wearable_shadow_evidence_keep_w1_first_but_unvalidated",
      firstWearableCandidate: "W1_activity_steps_minutes",
      nextAction: "collect_outcome_linked_w1_receipt_after_l1_l2",
    };
  }
  return {
    ...base,
    conclusion: "consumer_wearable_shadow_evidence_insufficient",
    firstWearableCandidate: "W1_activity_steps_minutes",
    nextAction: "search_for_true_wearable_outcome_linked_receipt",
  };
}

function w1Decision(
  conclusion: R1123ConsumerWearableShadowEvidenceArbitrationOutput["summary"]["conclusion"],
): WearableCandidateDecision {
  if (conclusion === "consumer_wearable_shadow_evidence_waiting_on_inputs") {
    return "hold_until_shadow_inputs_refresh";
  }
  if (conclusion === "consumer_wearable_shadow_evidence_insufficient") {
    return "keep_blocked_until_outcome_linked_receipt";
  }
  return "keep_first_wearable_candidate_after_l1_l2";
}

async function readInputs(
  options: R1123ConsumerWearableShadowEvidenceArbitrationOptions,
): Promise<Record<InputKey, unknown | null>> {
  return {
    r1049: await readJsonIfPresent(options.r1049Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1049.artifact)),
    r1065: await readJsonIfPresent(options.r1065Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1065.artifact)),
    r1066: await readJsonIfPresent(options.r1066Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1066.artifact)),
    r1067: await readJsonIfPresent(options.r1067Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1067.artifact)),
    r1120: await readJsonIfPresent(options.r1120Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1120.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1123 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.entries(INPUTS) as Array<[InputKey, typeof INPUTS[InputKey]]>).map(([key, expected]) => {
      const input = inputs[key];
      return [key, {
        artifact: expected.artifact,
        packetId: readStringAt(input, ["packetId"]) === expected.packetId ? expected.packetId : null,
        schemaVersion: readStringAt(input, ["schemaVersion"]) === expected.schemaVersion ? expected.schemaVersion : null,
        status: input ? "available" : "missing",
      }];
    }),
  ) as Record<InputKey, ArtifactSummary>;
}

function inputMatchesExpected(key: InputKey, input: unknown | null): boolean {
  const expected = INPUTS[key];
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readNumberAt(value: unknown, pathParts: readonly string[]): number | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "number" && Number.isFinite(resolved) ? roundMetric(resolved) : null;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readFalseAt(value: unknown, pathParts: readonly string[]): false | null {
  return readAt(value, pathParts) === false ? false : null;
}

function roundMetric(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1123ConsumerWearableShadowEvidenceArbitrationOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1123: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1123: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1123ConsumerWearableShadowEvidenceArbitration({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1049Path: process.env.MURPH_AGE_R1049_ACTIVITY_CONTROL_PATH,
    r1065Path: process.env.MURPH_AGE_R1065_WRIST_SHADOW_PATH,
    r1066Path: process.env.MURPH_AGE_R1066_WRIST_ROBUSTNESS_PATH,
    r1067Path: process.env.MURPH_AGE_R1067_WRIST_STRESS_PATH,
    r1120Path: process.env.MURPH_AGE_R1120_LAB_VITALS_ARBITRATION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    firstWearableCandidate: output.summary.firstWearableCandidate,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1123: output.summary.rowParsingPerformedByR1123,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetInputPriority: output.summary.targetInputPriority,
    topLabCandidate: output.summary.topLabCandidate,
    wearableRobustnessBlockers: output.arbitration.evidenceCounts.wearableRobustnessBlockers,
    wearableShadowSupportSignals: output.arbitration.evidenceCounts.wearableShadowSupportSignals,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1123 consumer wearable shadow evidence arbitration failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
