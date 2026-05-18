import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1048_NSHAP_HBA1C_CONTROL_DIAGNOSTIC_SCHEMA_VERSION =
  "murph-age-r1048-nshap-hba1c-control-diagnostic.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R1046_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1046-nshap-hba1c-replication-loop.latest.json");
const OUTPUT_FILE_NAME = "r1048-nshap-hba1c-control-diagnostic.latest.json";
const ALLOWED_SOURCE_IDS = ["nshap_w1_to_w3", "nshap_w2_to_w3"] as const;
const ALLOWED_NEGATIVE_CONTROL_CANDIDATE_IDS = ["NC2_body_only_without_hba1c", "NC5_noise_feature"] as const;

type SourceDiagnosticStatus = "clean_hba1c_separation" | "control_competition" | "missing_hba1c_candidate";

export interface R1048NshapHba1cControlDiagnosticOptions {
  createdAt?: string;
  outputDir?: string;
  r1046Path?: string;
}

interface ModelDeltaSummary {
  brierDelta: number | null;
  candidateId: string;
  logLossDelta: number | null;
  verdict: string | null;
}

interface SourceDiagnostic {
  bestNegativeControl: ModelDeltaSummary | null;
  hba1cCandidate: ModelDeltaSummary | null;
  interpretation: string;
  logLossSeparationFromBestControl: number | null;
  status: SourceDiagnosticStatus;
}

export interface R1048NshapHba1cControlDiagnosticOutput {
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
      | "nshap_hba1c_separation_clean"
      | "nshap_hba1c_signal_partial_control_limited"
      | "nshap_hba1c_signal_not_supported";
    nextAction:
      | "carry_nshap_as_supportive_replication"
      | "keep_nshap_partial_and_seek_new_external_source"
      | "hold_nshap_as_non_supportive";
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rationale: string;
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  inputArtifact: {
    artifact: "r1046-nshap-hba1c-replication-loop.latest.json";
    packetId: string | null;
    schemaVersion: string | null;
    status: "available";
  };
  packetId: "r1048-nshap-hba1c-control-diagnostic";
  schemaVersion: typeof R1048_NSHAP_HBA1C_CONTROL_DIAGNOSTIC_SCHEMA_VERSION;
  sourceDiagnostics: Record<string, SourceDiagnostic>;
  status: "research-local-aggregate-only";
}

export async function runR1048NshapHba1cControlDiagnostic(
  options: R1048NshapHba1cControlDiagnosticOptions = {},
): Promise<{ output: R1048NshapHba1cControlDiagnosticOutput; outputPath: string }> {
  const input = await readJson(options.r1046Path ?? DEFAULT_R1046_PATH);
  const inputFindings = findForbiddenAggregateEgress(input);
  if (inputFindings.length > 0) {
    throw new Error(`R1048 input R1046 failed aggregate boundary validation: ${inputFindings.join("; ")}`);
  }

  const sources = readRecordAt(input, ["sources"]);
  const sourceDiagnostics = Object.fromEntries(
    ALLOWED_SOURCE_IDS
      .filter((sourceId) => sources[sourceId] !== undefined)
      .map((sourceId) => [sourceId, summarizeSource(sources[sourceId])]),
  );
  const output: R1048NshapHba1cControlDiagnosticOutput = {
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
    decision: summarizeDecision(sourceDiagnostics),
    inputArtifact: {
      artifact: "r1046-nshap-hba1c-replication-loop.latest.json",
      packetId: readStringAt(input, ["packetId"]) === "r1046-nshap-hba1c-replication-loop"
        ? "r1046-nshap-hba1c-replication-loop"
        : null,
      schemaVersion: readStringAt(input, ["schemaVersion"]) === "murph-age-r1046-nshap-hba1c-replication-loop.v1"
        ? "murph-age-r1046-nshap-hba1c-replication-loop.v1"
        : null,
      status: "available",
    },
    packetId: "r1048-nshap-hba1c-control-diagnostic",
    schemaVersion: R1048_NSHAP_HBA1C_CONTROL_DIAGNOSTIC_SCHEMA_VERSION,
    sourceDiagnostics,
    status: "research-local-aggregate-only",
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1048 NSHAP HbA1c control diagnostic failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeSource(sourceValue: unknown): SourceDiagnostic {
  const models = readRecordAt(sourceValue, ["models"]);
  const hba1cCandidate = summarizeCandidate("A1_hba1c", models.A1_hba1c);
  const negativeControlRows = ALLOWED_NEGATIVE_CONTROL_CANDIDATE_IDS
    .map((candidateId) => summarizeCandidate(candidateId, models[candidateId]))
    .filter((value): value is ModelDeltaSummary => value !== null);
  const bestNegativeControl = bestByLogLossImprovement(negativeControlRows);
  if (!hba1cCandidate) {
    return {
      bestNegativeControl,
      hba1cCandidate: null,
      interpretation: "HbA1c candidate missing from aggregate source summary.",
      logLossSeparationFromBestControl: null,
      status: "missing_hba1c_candidate",
    };
  }
  const controlsCompete = negativeControlRows.some((candidate) => candidate.verdict === "beats_age_sex");
  const status: SourceDiagnosticStatus = hba1cCandidate.verdict === "beats_age_sex" && !controlsCompete
    ? "clean_hba1c_separation"
    : "control_competition";
  const separation = hba1cCandidate.logLossDelta !== null
      && bestNegativeControl !== null
      && bestNegativeControl.logLossDelta !== null
    ? hba1cCandidate.logLossDelta - bestNegativeControl.logLossDelta
    : null;
  return {
    bestNegativeControl,
    hba1cCandidate,
    interpretation: status === "clean_hba1c_separation"
      ? "HbA1c beats age/sex while negative controls do not."
      : "HbA1c is not cleanly separated from negative controls on this aggregate source.",
    logLossSeparationFromBestControl: separation,
    status,
  };
}

function summarizeCandidate(candidateId: string, value: unknown): ModelDeltaSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    brierDelta: readNumberAt(value, ["deltasVsAgeSexReference", "brierDelta"]),
    candidateId,
    logLossDelta: readNumberAt(value, ["deltasVsAgeSexReference", "logLossDelta"]),
    verdict: safeVerdict(readStringAt(value, ["verdict"])),
  };
}

function safeVerdict(verdict: string | null): string | null {
  if (verdict === "beats_age_sex" || verdict === "does_not_beat_age_sex" || verdict === "reference") {
    return verdict;
  }
  return null;
}

function bestByLogLossImprovement(candidates: ModelDeltaSummary[]): ModelDeltaSummary | null {
  let best: ModelDeltaSummary | null = null;
  for (const candidate of candidates) {
    if (candidate.logLossDelta === null) continue;
    if (best === null || best.logLossDelta === null || candidate.logLossDelta < best.logLossDelta) {
      best = candidate;
    }
  }
  return best;
}

function summarizeDecision(
  sourceDiagnostics: Record<string, SourceDiagnostic>,
): R1048NshapHba1cControlDiagnosticOutput["decision"] {
  const values = Object.values(sourceDiagnostics);
  const cleanCount = values.filter((diagnostic) => diagnostic.status === "clean_hba1c_separation").length;
  const controlLimitedCount = values.filter((diagnostic) => diagnostic.status === "control_competition").length;
  const missingCount = values.filter((diagnostic) => diagnostic.status === "missing_hba1c_candidate").length;
  const conclusion = cleanCount > 0 && controlLimitedCount === 0 && missingCount === 0
    ? "nshap_hba1c_separation_clean"
    : cleanCount > 0
      ? "nshap_hba1c_signal_partial_control_limited"
      : "nshap_hba1c_signal_not_supported";
  return {
    conclusion,
    nextAction: conclusion === "nshap_hba1c_separation_clean"
      ? "carry_nshap_as_supportive_replication"
      : conclusion === "nshap_hba1c_signal_partial_control_limited"
        ? "keep_nshap_partial_and_seek_new_external_source"
        : "hold_nshap_as_non_supportive",
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rationale: conclusion === "nshap_hba1c_separation_clean"
      ? "All aggregate NSHAP sources separate HbA1c from negative controls."
      : conclusion === "nshap_hba1c_signal_partial_control_limited"
        ? "At least one aggregate NSHAP source separates HbA1c, but another source has competing controls."
        : "Aggregate NSHAP sources do not cleanly separate HbA1c from controls.",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("R1048 failed to read the R1046 aggregate artifact.");
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

async function main(): Promise<void> {
  const { output } = await runR1048NshapHba1cControlDiagnostic({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1046Path: process.env.MURPH_AGE_R1046_NSHAP_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    conclusion: output.decision.conclusion,
    nextAction: output.decision.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.decision.productDisplayAuthorized,
    schemaVersion: output.schemaVersion,
    sourceStatuses: Object.fromEntries(
      Object.entries(output.sourceDiagnostics).map(([sourceId, diagnostic]) => [sourceId, diagnostic.status]),
    ),
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R1048 NSHAP HbA1c control diagnostic failed.\n");
    process.exitCode = 1;
  });
}
