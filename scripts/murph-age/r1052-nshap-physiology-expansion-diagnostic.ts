import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1052_NSHAP_PHYSIOLOGY_EXPANSION_DIAGNOSTIC_SCHEMA_VERSION =
  "murph-age-r1052-nshap-physiology-expansion-diagnostic.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R1046_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1046-nshap-hba1c-replication-loop.latest.json");
const OUTPUT_FILE_NAME = "r1052-nshap-physiology-expansion-diagnostic.latest.json";

const REQUIRED_PACKET_ID = "r1046-nshap-hba1c-replication-loop";
const REQUIRED_SCHEMA_VERSION = "murph-age-r1046-nshap-hba1c-replication-loop.v1";

const CANDIDATE_IDS = {
  bodyControl: "NC2_body_only_without_hba1c",
  integrated: "I1_hba1c_body_pulse_sleep_function",
  missingnessControl: "NC4_missingness_quality_only",
  noiseControl: "NC5_noise_feature",
  pulse: "P1_pulse_only",
  sleep: "S1_sleep_problem_shadow",
  walkingFunction: "F1_walking_function_shadow",
} as const;

type SourceId = "nshap_w1_to_w3" | "nshap_w2_to_w3";
type Verdict = "beats_age_sex" | "does_not_beat_age_sex" | "missing" | "reference";

export interface R1052NshapPhysiologyExpansionDiagnosticOptions {
  createdAt?: string;
  outputDir?: string;
  r1046Path?: string;
}

interface CandidateSignal {
  brierDelta: number | null;
  candidateId: string;
  expectedOverObserved: number | null;
  logLossDelta: number | null;
  verdict: Verdict;
}

interface SourceSignal {
  bodyControl: CandidateSignal;
  integrated: CandidateSignal;
  missingnessControl: CandidateSignal;
  noiseControl: CandidateSignal;
  pulse: CandidateSignal;
  sleep: CandidateSignal;
  walkingFunction: CandidateSignal;
}

export interface R1052NshapPhysiologyExpansionDiagnosticOutput {
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
    rowParsingPerformedByR1052: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  decision: {
    conclusion:
      | "nshap_physiology_expansion_missing"
      | "nshap_physiology_shadow_not_supported"
      | "nshap_physiology_shadow_signal_clean"
      | "nshap_physiology_shadow_signal_control_limited";
    nextAction:
      | "keep_activity_function_pulse_shadow_seek_true_wearable_or_partner_validation"
      | "rerun_or_repair_expanded_nshap_receipt";
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rationale: string;
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  inputArtifact: {
    artifact: "r1046-nshap-hba1c-replication-loop.latest.json";
    packetId: string | null;
    schemaVersion: string | null;
    status: "available" | "missing";
  };
  packetId: "r1052-nshap-physiology-expansion-diagnostic";
  schemaVersion: typeof R1052_NSHAP_PHYSIOLOGY_EXPANSION_DIAGNOSTIC_SCHEMA_VERSION;
  signals: Record<SourceId, SourceSignal> | null;
  status: "research-local-aggregate-only";
  supportCounts: {
    controlCompetingSourceCount: number;
    integratedSupportCount: number;
    missingnessControlSupportCount: number;
    pulseSupportCount: number;
    sleepSupportCount: number;
    sourceCount: number;
    walkingFunctionSupportCount: number;
  };
}

export async function runR1052NshapPhysiologyExpansionDiagnostic(
  options: R1052NshapPhysiologyExpansionDiagnosticOptions = {},
): Promise<{ output: R1052NshapPhysiologyExpansionDiagnosticOutput; outputPath: string }> {
  const r1046 = await readJsonIfPresent(options.r1046Path ?? DEFAULT_R1046_PATH);
  if (r1046) validateInput(r1046);

  const signals = r1046 ? readSignals(r1046) : null;
  const supportCounts = summarizeSupport(signals);
  const decision = summarizeDecision(signals, supportCounts);
  const output: R1052NshapPhysiologyExpansionDiagnosticOutput = {
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
      rowParsingPerformedByR1052: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    decision,
    inputArtifact: {
      artifact: "r1046-nshap-hba1c-replication-loop.latest.json",
      packetId: safeMetadata(readStringAt(r1046, ["packetId"])),
      schemaVersion: safeMetadata(readStringAt(r1046, ["schemaVersion"])),
      status: r1046 ? "available" : "missing",
    },
    packetId: "r1052-nshap-physiology-expansion-diagnostic",
    schemaVersion: R1052_NSHAP_PHYSIOLOGY_EXPANSION_DIAGNOSTIC_SCHEMA_VERSION,
    signals,
    status: "research-local-aggregate-only",
    supportCounts,
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1052 NSHAP physiology expansion diagnostic failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function validateInput(value: unknown): void {
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1052 input R1046 receipt failed aggregate boundary validation: ${findings.join("; ")}`);
  }
  const packetId = readStringAt(value, ["packetId"]);
  if (packetId !== null && packetId !== REQUIRED_PACKET_ID) {
    throw new Error("R1052 requires the expanded R1046 NSHAP receipt packet.");
  }
  if (readStringAt(value, ["schemaVersion"]) !== REQUIRED_SCHEMA_VERSION) {
    throw new Error("R1052 requires the expanded R1046 NSHAP receipt schema.");
  }
}

function readSignals(value: unknown): Record<SourceId, SourceSignal> {
  return {
    nshap_w1_to_w3: readSourceSignal(value, "nshap_w1_to_w3"),
    nshap_w2_to_w3: readSourceSignal(value, "nshap_w2_to_w3"),
  };
}

function readSourceSignal(value: unknown, sourceId: SourceId): SourceSignal {
  const sourcePath = ["sources", sourceId, "models"] as const;
  return {
    bodyControl: readCandidate(value, sourcePath, CANDIDATE_IDS.bodyControl),
    integrated: readCandidate(value, sourcePath, CANDIDATE_IDS.integrated),
    missingnessControl: readCandidate(value, sourcePath, CANDIDATE_IDS.missingnessControl),
    noiseControl: readCandidate(value, sourcePath, CANDIDATE_IDS.noiseControl),
    pulse: readCandidate(value, sourcePath, CANDIDATE_IDS.pulse),
    sleep: readCandidate(value, sourcePath, CANDIDATE_IDS.sleep),
    walkingFunction: readCandidate(value, sourcePath, CANDIDATE_IDS.walkingFunction),
  };
}

function readCandidate(value: unknown, sourcePath: readonly string[], candidateId: string): CandidateSignal {
  const basePath = [...sourcePath, candidateId];
  const verdict = readStringAt(value, [...basePath, "verdict"]);
  return {
    brierDelta: readNumberAt(value, [...basePath, "deltasVsAgeSexReference", "brierDelta"]),
    candidateId,
    expectedOverObserved: readNumberAt(value, [...basePath, "splitMetrics", "test", "expectedOverObserved"]),
    logLossDelta: readNumberAt(value, [...basePath, "deltasVsAgeSexReference", "logLossDelta"]),
    verdict: verdict === "beats_age_sex" || verdict === "does_not_beat_age_sex" || verdict === "reference"
      ? verdict
      : "missing",
  };
}

function summarizeSupport(signals: Record<SourceId, SourceSignal> | null): R1052NshapPhysiologyExpansionDiagnosticOutput["supportCounts"] {
  const sources = signals ? Object.values(signals) : [];
  return {
    controlCompetingSourceCount: sources.filter((source) => controlCompetes(source)).length,
    integratedSupportCount: sources.filter((source) => source.integrated.verdict === "beats_age_sex").length,
    missingnessControlSupportCount: sources.filter((source) => source.missingnessControl.verdict === "beats_age_sex").length,
    pulseSupportCount: sources.filter((source) => source.pulse.verdict === "beats_age_sex").length,
    sleepSupportCount: sources.filter((source) => source.sleep.verdict === "beats_age_sex").length,
    sourceCount: sources.length,
    walkingFunctionSupportCount: sources.filter((source) => source.walkingFunction.verdict === "beats_age_sex").length,
  };
}

function summarizeDecision(
  signals: Record<SourceId, SourceSignal> | null,
  supportCounts: R1052NshapPhysiologyExpansionDiagnosticOutput["supportCounts"],
): R1052NshapPhysiologyExpansionDiagnosticOutput["decision"] {
  if (!signals) {
    return {
      conclusion: "nshap_physiology_expansion_missing",
      nextAction: "rerun_or_repair_expanded_nshap_receipt",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rationale: "The expanded NSHAP aggregate receipt is missing or incomplete.",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }

  const anyPhysiologySignal = supportCounts.pulseSupportCount > 0
    || supportCounts.sleepSupportCount > 0
    || supportCounts.walkingFunctionSupportCount > 0
    || supportCounts.integratedSupportCount > 0;
  const conclusion = !anyPhysiologySignal
    ? "nshap_physiology_shadow_not_supported"
    : supportCounts.controlCompetingSourceCount > 0
      ? "nshap_physiology_shadow_signal_control_limited"
      : "nshap_physiology_shadow_signal_clean";
  return {
    conclusion,
    nextAction: "keep_activity_function_pulse_shadow_seek_true_wearable_or_partner_validation",
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rationale: conclusion === "nshap_physiology_shadow_signal_control_limited"
      ? "NSHAP pulse/function/sleep shadow candidates show aggregate signal, but at least one source also has competing body/noise controls."
      : conclusion === "nshap_physiology_shadow_signal_clean"
        ? "NSHAP pulse/function/sleep shadow candidates improve aggregate proper scores without competing controls, but remain non-wearable shadow evidence."
        : "Expanded NSHAP physiology shadow candidates do not improve aggregate proper scores over age/sex.",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

function controlCompetes(source: SourceSignal): boolean {
  return source.bodyControl.verdict === "beats_age_sex"
    || source.missingnessControl.verdict === "beats_age_sex"
    || source.noiseControl.verdict === "beats_age_sex";
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
  const { output } = await runR1052NshapPhysiologyExpansionDiagnostic({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1046Path: process.env.MURPH_AGE_R1046_RECEIPT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    conclusion: output.decision.conclusion,
    nextAction: output.decision.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.decision.productDisplayAuthorized,
    reviewGptRequiredBeforeNextLocalRun: output.decision.reviewGptRequiredBeforeNextLocalRun,
    schemaVersion: output.schemaVersion,
    status: output.status,
    supportCounts: output.supportCounts,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1052 NSHAP physiology expansion diagnostic failed."}\n`);
    process.exitCode = 1;
  });
}
