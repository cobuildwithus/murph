import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1054_CROSS_SOURCE_FUNCTION_PHYSIOLOGY_STATE_SCHEMA_VERSION =
  "murph-age-r1054-cross-source-function-physiology-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R1044_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1044-haalsi-external-biomarker-loop.latest.json");
const DEFAULT_R1052_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1052-nshap-physiology-expansion-diagnostic.latest.json");
const OUTPUT_FILE_NAME = "r1054-cross-source-function-physiology-state.latest.json";

export interface R1054CrossSourceFunctionPhysiologyStateOptions {
  createdAt?: string;
  outputDir?: string;
  r1044Path?: string;
  r1052Path?: string;
}

type SignalStatus = "missing" | "not_supported" | "supported";

interface AggregateSignal {
  brierDelta: number | null;
  candidateId: string;
  expectedOverObserved: number | null;
  logLossDelta: number | null;
  status: SignalStatus;
}

export interface R1054CrossSourceFunctionPhysiologyStateOutput {
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
      | "function_activity_shadow_inputs_missing"
      | "function_activity_shadow_signal_clean_enough_for_review"
      | "function_activity_shadow_signal_control_limited"
      | "function_activity_shadow_signal_not_supported";
    nextAction:
      | "ask_reviewgpt_after_current_science_review_if_function_should_drive_next_public_loop"
      | "keep_function_activity_shadow_and_seek_true_activity_or_partner_validation"
      | "rerun_or_repair_function_activity_receipts";
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rationale: string;
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  inputArtifacts: {
    r1044Haalsi: InputArtifactSummary;
    r1052Nshap: InputArtifactSummary;
  };
  packetId: "r1054-cross-source-function-physiology-state";
  schemaVersion: typeof R1054_CROSS_SOURCE_FUNCTION_PHYSIOLOGY_STATE_SCHEMA_VERSION;
  signals: {
    haalsi: {
      glucose: AggregateSignal;
      integrated: AggregateSignal;
      missingnessControl: AggregateSignal;
      pulse: AggregateSignal;
      walkDifficulty: AggregateSignal;
    } | null;
    nshap: {
      integratedSupportCount: number;
      missingnessControlSupportCount: number;
      pulseSupportCount: number;
      sourceCount: number;
      walkingFunctionSupportCount: number;
    } | null;
  };
  status: "research-local-aggregate-only";
  summary: {
    currentFunctionActivityLead: "walking_function_shadow" | "none";
    modelUse: "research_only_no_product_display";
    nextAutoresearchStep: "true_activity_or_partner_integrated_validation";
    reviewGptUse: "major_scientific_result_review_only";
  };
}

interface InputArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export async function runR1054CrossSourceFunctionPhysiologyState(
  options: R1054CrossSourceFunctionPhysiologyStateOptions = {},
): Promise<{ output: R1054CrossSourceFunctionPhysiologyStateOutput; outputPath: string }> {
  const r1044 = await readJsonIfPresent(options.r1044Path ?? DEFAULT_R1044_PATH);
  const r1052 = await readJsonIfPresent(options.r1052Path ?? DEFAULT_R1052_PATH);
  validateInputIfPresent("R1044 HAALSI", r1044);
  validateInputIfPresent("R1052 NSHAP physiology", r1052);

  const haalsi = r1044 ? summarizeHaalsi(r1044) : null;
  const nshap = r1052 ? summarizeNshap(r1052) : null;
  const decision = summarizeDecision(haalsi, nshap);
  const output: R1054CrossSourceFunctionPhysiologyStateOutput = {
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
    inputArtifacts: {
      r1044Haalsi: summarizeInputArtifact(r1044, "r1044-haalsi-external-biomarker-loop.latest.json"),
      r1052Nshap: summarizeInputArtifact(r1052, "r1052-nshap-physiology-expansion-diagnostic.latest.json"),
    },
    packetId: "r1054-cross-source-function-physiology-state",
    schemaVersion: R1054_CROSS_SOURCE_FUNCTION_PHYSIOLOGY_STATE_SCHEMA_VERSION,
    signals: {
      haalsi,
      nshap,
    },
    status: "research-local-aggregate-only",
    summary: {
      currentFunctionActivityLead: decision.conclusion === "function_activity_shadow_signal_not_supported"
        || decision.conclusion === "function_activity_shadow_inputs_missing"
        ? "none"
        : "walking_function_shadow",
      modelUse: "research_only_no_product_display",
      nextAutoresearchStep: "true_activity_or_partner_integrated_validation",
      reviewGptUse: "major_scientific_result_review_only",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1054 cross-source function physiology state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeHaalsi(value: unknown): R1054CrossSourceFunctionPhysiologyStateOutput["signals"]["haalsi"] {
  return {
    glucose: readCandidate(value, "A1_glucose"),
    integrated: readCandidate(value, "I1_glucose_body_pulse_walk_shadow"),
    missingnessControl: readCandidate(value, "NC6_missingness_quality_only"),
    pulse: readCandidate(value, "P1_pulse_only"),
    walkDifficulty: readCandidate(value, "F1_walk_difficulty_shadow"),
  };
}

function summarizeNshap(value: unknown): R1054CrossSourceFunctionPhysiologyStateOutput["signals"]["nshap"] {
  return {
    integratedSupportCount: readNumberAt(value, ["supportCounts", "integratedSupportCount"]) ?? 0,
    missingnessControlSupportCount: readNumberAt(value, ["supportCounts", "missingnessControlSupportCount"]) ?? 0,
    pulseSupportCount: readNumberAt(value, ["supportCounts", "pulseSupportCount"]) ?? 0,
    sourceCount: readNumberAt(value, ["supportCounts", "sourceCount"]) ?? 0,
    walkingFunctionSupportCount: readNumberAt(value, ["supportCounts", "walkingFunctionSupportCount"]) ?? 0,
  };
}

function readCandidate(value: unknown, candidateId: string): AggregateSignal {
  const verdict = readStringAt(value, ["models", candidateId, "verdict"]);
  return {
    brierDelta: readNumberAt(value, ["models", candidateId, "deltasVsAgeSexReference", "brierDelta"]),
    candidateId,
    expectedOverObserved: readNumberAt(value, ["models", candidateId, "splitMetrics", "test", "expectedOverObserved"]),
    logLossDelta: readNumberAt(value, ["models", candidateId, "deltasVsAgeSexReference", "logLossDelta"]),
    status: verdict === "beats_age_sex" ? "supported" : verdict === "does_not_beat_age_sex" ? "not_supported" : "missing",
  };
}

function summarizeDecision(
  haalsi: R1054CrossSourceFunctionPhysiologyStateOutput["signals"]["haalsi"],
  nshap: R1054CrossSourceFunctionPhysiologyStateOutput["signals"]["nshap"],
): R1054CrossSourceFunctionPhysiologyStateOutput["decision"] {
  if (!haalsi || !nshap || nshap.sourceCount === 0) {
    return {
      conclusion: "function_activity_shadow_inputs_missing",
      nextAction: "rerun_or_repair_function_activity_receipts",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rationale: "Required aggregate HAALSI or NSHAP function/activity receipts are missing.",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }
  const functionSupported = haalsi.walkDifficulty.status === "supported"
    && nshap.walkingFunctionSupportCount === nshap.sourceCount;
  if (!functionSupported) {
    return {
      conclusion: "function_activity_shadow_signal_not_supported",
      nextAction: "keep_function_activity_shadow_and_seek_true_activity_or_partner_validation",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rationale: "Walking-function shadow features do not consistently improve aggregate proper scores across HAALSI and NSHAP.",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }
  const controlLimited = haalsi.missingnessControl.status === "supported"
    || nshap.missingnessControlSupportCount > 0;
  return {
    conclusion: controlLimited
      ? "function_activity_shadow_signal_control_limited"
      : "function_activity_shadow_signal_clean_enough_for_review",
    nextAction: controlLimited
      ? "keep_function_activity_shadow_and_seek_true_activity_or_partner_validation"
      : "ask_reviewgpt_after_current_science_review_if_function_should_drive_next_public_loop",
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rationale: controlLimited
      ? "Walking-function shadow signal appears across HAALSI and NSHAP, but missingness or other controls compete in at least one source."
      : "Walking-function shadow signal appears across HAALSI and NSHAP without missingness-control competition, but remains non-product research evidence.",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

function validateInputIfPresent(label: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1054 input ${label} failed aggregate boundary validation: ${findings.join("; ")}`);
  }
}

function summarizeInputArtifact(value: unknown | null, artifact: string): InputArtifactSummary {
  return {
    artifact,
    packetId: safeMetadata(readStringAt(value, ["packetId"])),
    schemaVersion: safeMetadata(readStringAt(value, ["schemaVersion"])),
    status: value ? "available" : "missing",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function readStringAt(value: unknown, pathSegments: readonly string[]): string | null {
  const valueAtPath = readAt(value, pathSegments);
  return typeof valueAtPath === "string" ? valueAtPath : null;
}

function readNumberAt(value: unknown, pathSegments: readonly string[]): number | null {
  const valueAtPath = readAt(value, pathSegments);
  return typeof valueAtPath === "number" && Number.isFinite(valueAtPath) ? valueAtPath : null;
}

function readAt(value: unknown, pathSegments: readonly string[]): unknown {
  let current = value;
  for (const segment of pathSegments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function safeMetadata(value: string | null): string | null {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,120}$/u.test(value) ? value : null;
}

async function main(): Promise<void> {
  const { output } = await runR1054CrossSourceFunctionPhysiologyState({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1044Path: process.env.MURPH_AGE_R1044_RECEIPT_PATH,
    r1052Path: process.env.MURPH_AGE_R1052_RECEIPT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    conclusion: output.decision.conclusion,
    currentFunctionActivityLead: output.summary.currentFunctionActivityLead,
    nextAction: output.decision.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.decision.productDisplayAuthorized,
    reviewGptRequiredBeforeNextLocalRun: output.decision.reviewGptRequiredBeforeNextLocalRun,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1054 cross-source function physiology state failed."}\n`);
    process.exitCode = 1;
  });
}
