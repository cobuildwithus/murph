import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R607_GLYCEMIA_ABLATION_REVIEW_PACKET_SCHEMA_VERSION =
  "murph-age-r607-glycemia-ablation-review-packet.v1" as const;

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
const DEFAULT_R604_PATH = path.join(DEFAULT_REVIEWGPT_REDUCED_DIR, "r604-transport-result-next-direction-summary.json");
const DEFAULT_R605_PATH = path.join(DEFAULT_REVIEWGPT_REDUCED_DIR, "r605-candidate-direction-chorus-summary.json");
const DEFAULT_MHAS_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "mhas-join-probe.latest.json");
const DEFAULT_HAALSI_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "haalsi-source-feasibility.latest.json");
const DEFAULT_NSHAP_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "nshap-activation-feasibility.latest.json");
const OUTPUT_FILE_NAME = "r607-glycemia-ablation-review-packet.latest.json";

type CandidateId =
  | "age_sex_reference"
  | "age_sex_plus_bmi"
  | "age_sex_plus_glycemia"
  | "age_sex_plus_glycemia_body";

type Direction =
  | "glycemia_only"
  | "glycemia_body"
  | "body_only"
  | "source_validation"
  | "stop_family";

interface CandidateResult {
  candidateId: CandidateId;
  modelId: string;
  properScoreDirection: "better_than_age_sex" | "same_as_age_sex" | "worse_than_age_sex";
  sourceId: string;
  testDeltasVsAgeSex: {
    aucDelta: number | null;
    brierDelta: number;
    logLossDelta: number;
  };
}

interface SourceLaneSummary {
  laneId: "haalsi" | "mhas" | "nshap";
  nextRunnableAction: string;
  productPromotionAuthorized: false;
  resultLabel: string;
  status: string;
}

export interface R607GlycemiaAblationReviewPacketOptions {
  createdAt?: string;
  haalsiPath?: string;
  mhasPath?: string;
  nshapPath?: string;
  outputDir?: string;
  r604Path?: string;
  r605Path?: string;
  r606Path?: string;
}

export interface R607GlycemiaAblationReviewPacket {
  boundary: {
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
    recommendationClaimsIncluded: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  packetId: "r607-glycemia-ablation-review-packet";
  priorReviewGptConsensus: {
    r604: {
      decisionCounts: Record<string, number>;
      topDecision: string | null;
      trustedCount: number | null;
    };
    r605: {
      decisionCounts: Record<string, number>;
      topDecision: string | null;
      trustedCount: number | null;
    };
  };
  resultInterpretation: {
    candidateResults: CandidateResult[];
    crossSourcePattern: {
      bodyOnly: "not_supported";
      glycemiaBody: "supported_small_signal";
      glycemiaOnly: "supported_small_signal";
    };
    strongestProperScoreDirection: Direction;
  };
  reviewQuestion: string;
  schemaVersion: typeof R607_GLYCEMIA_ABLATION_REVIEW_PACKET_SCHEMA_VERSION;
  sourceLanes: SourceLaneSummary[];
  status: "research-local-aggregate-only";
  summary: {
    candidateFamily: "parsimonious_glycemia_body";
    conclusion: "glycemia_signal_supported_but_small";
    nextLocalAction: "freeze_tiny_glycemia_candidate_and_seek_external_outcome_lane";
    productPromotionAuthorized: false;
  };
}

export async function runR607GlycemiaAblationReviewPacket(
  options: R607GlycemiaAblationReviewPacketOptions = {},
): Promise<{ output: R607GlycemiaAblationReviewPacket; outputPath: string }> {
  const [r606, r604, r605, mhas, haalsi, nshap] = await Promise.all([
    readJsonIfPresent(options.r606Path ?? DEFAULT_R606_PATH),
    readJsonIfPresent(options.r604Path ?? DEFAULT_R604_PATH),
    readJsonIfPresent(options.r605Path ?? DEFAULT_R605_PATH),
    readJsonIfPresent(options.mhasPath ?? DEFAULT_MHAS_PATH),
    readJsonIfPresent(options.haalsiPath ?? DEFAULT_HAALSI_PATH),
    readJsonIfPresent(options.nshapPath ?? DEFAULT_NSHAP_PATH),
  ]);
  const candidateResults = summarizeCandidateResults(r606);
  const output: R607GlycemiaAblationReviewPacket = {
    boundary: {
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
      recommendationClaimsIncluded: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    packetId: "r607-glycemia-ablation-review-packet",
    priorReviewGptConsensus: {
      r604: summarizeReviewGptReduction(r604),
      r605: summarizeReviewGptReduction(r605),
    },
    resultInterpretation: {
      candidateResults,
      crossSourcePattern: {
        bodyOnly: "not_supported",
        glycemiaBody: "supported_small_signal",
        glycemiaOnly: "supported_small_signal",
      },
      strongestProperScoreDirection: strongestProperScoreDirection(candidateResults),
    },
    reviewQuestion: "Given R604/R605 and the R606 aggregate ablation results, should Murph Age freeze a tiny glycemia-only or glycemia+body candidate for the next external outcome lane, or treat the effect as too small until stronger external validation exists?",
    schemaVersion: R607_GLYCEMIA_ABLATION_REVIEW_PACKET_SCHEMA_VERSION,
    sourceLanes: [
      summarizeMhas(mhas),
      summarizeHaalsi(haalsi),
      summarizeNshap(nshap),
    ],
    status: "research-local-aggregate-only",
    summary: {
      candidateFamily: "parsimonious_glycemia_body",
      conclusion: "glycemia_signal_supported_but_small",
      nextLocalAction: "freeze_tiny_glycemia_candidate_and_seek_external_outcome_lane",
      productPromotionAuthorized: false,
    },
  };
  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R607 glycemia ablation review packet failed aggregate-egress validation: ${findings.join("; ")}`);
  }
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeCandidateResults(value: unknown | null): CandidateResult[] {
  if (!value) return [];
  const root = requiredRecord(value, "R606 packet");
  const sources = readRecordArray(root.sources, "R606 sources");
  return sources.flatMap((source) => {
    if (source.status !== "available") return [];
    const sourceId = requiredMetadataLabel(source.sourceId, "R606 source id");
    return readRecordArray(source.parsimoniousCandidates, `${sourceId} candidates`).flatMap((candidate) => {
      const candidateId = optionalString(candidate.candidateId) as CandidateId | null;
      if (!candidateId || candidate.status !== "available" || candidateId === "age_sex_reference") return [];
      const deltas = requiredRecord(candidate.deltasVsAgeSex, `${candidateId} deltas`);
      const brierDelta = requiredNumber(deltas.brierDelta, `${candidateId} brier delta`);
      const logLossDelta = requiredNumber(deltas.logLossDelta, `${candidateId} logLoss delta`);
      return [{
        candidateId,
        modelId: requiredMetadataLabel(candidate.modelId, `${candidateId} model id`),
        properScoreDirection: properScoreDirection({ brierDelta, logLossDelta }),
        sourceId,
        testDeltasVsAgeSex: {
          aucDelta: optionalNumber(deltas.aucDelta),
          brierDelta,
          logLossDelta,
        },
      }];
    });
  });
}

function summarizeReviewGptReduction(value: unknown | null): R607GlycemiaAblationReviewPacket["priorReviewGptConsensus"]["r604"] {
  if (!value) return { decisionCounts: {}, topDecision: null, trustedCount: null };
  const root = requiredRecord(value, "ReviewGPT reduction");
  const consensus = optionalRecord(root.consensus);
  return {
    decisionCounts: readNumberRecord(root.decision_counts),
    topDecision: optionalString(consensus?.top_decision),
    trustedCount: optionalNumber(root.trusted_count),
  };
}

function summarizeMhas(value: unknown | null): SourceLaneSummary {
  if (!value) {
    return {
      laneId: "mhas",
      nextRunnableAction: "complete_mhas_metadata_source_intake",
      productPromotionAuthorized: false,
      resultLabel: "missing_join_probe",
      status: "missing",
    };
  }
  const root = requiredRecord(value, "MHAS join probe");
  const joinFeasibility = requiredRecord(root.joinFeasibility, "MHAS join feasibility");
  return {
    laneId: "mhas",
    nextRunnableAction: requiredMetadataLabel(root.nextRunnableAction, "MHAS next action"),
    productPromotionAuthorized: false,
    resultLabel: requiredMetadataLabel(joinFeasibility.joinKeyFamilyStatus, "MHAS join status"),
    status: requiredMetadataLabel(root.status, "MHAS status"),
  };
}

function summarizeHaalsi(value: unknown | null): SourceLaneSummary {
  if (!value) {
    return {
      laneId: "haalsi",
      nextRunnableAction: "complete_haalsi_source_intake_metadata",
      productPromotionAuthorized: false,
      resultLabel: "missing_source_feasibility",
      status: "missing",
    };
  }
  const root = requiredRecord(value, "HAALSI feasibility");
  const laneAssessment = requiredRecord(root.laneAssessment, "HAALSI lane assessment");
  const endpointReadiness = requiredRecord(root.endpointReadiness, "HAALSI endpoint readiness");
  return {
    laneId: "haalsi",
    nextRunnableAction: requiredMetadataLabel(laneAssessment.nextAction, "HAALSI next action"),
    productPromotionAuthorized: false,
    resultLabel: requiredMetadataLabel(endpointReadiness.status, "HAALSI endpoint status"),
    status: requiredMetadataLabel(root.status, "HAALSI status"),
  };
}

function summarizeNshap(value: unknown | null): SourceLaneSummary {
  if (!value) {
    return {
      laneId: "nshap",
      nextRunnableAction: "complete_source_intake_metadata",
      productPromotionAuthorized: false,
      resultLabel: "missing_activation_feasibility",
      status: "missing",
    };
  }
  const root = requiredRecord(value, "NSHAP feasibility");
  const noScoreReadiness = requiredRecord(root.noScoreReadiness, "NSHAP no-score readiness");
  return {
    laneId: "nshap",
    nextRunnableAction: requiredMetadataLabel(noScoreReadiness.nextAction, "NSHAP next action"),
    productPromotionAuthorized: false,
    resultLabel: requiredMetadataLabel(noScoreReadiness.conclusion, "NSHAP conclusion"),
    status: requiredMetadataLabel(root.status, "NSHAP status"),
  };
}

function strongestProperScoreDirection(results: CandidateResult[]): Direction {
  const improved = results.filter((result) => result.properScoreDirection === "better_than_age_sex");
  if (!improved.length) return "stop_family";
  const byCandidate = new Map<CandidateId, number>();
  for (const result of improved) byCandidate.set(result.candidateId, (byCandidate.get(result.candidateId) ?? 0) + 1);
  const glycemiaBodyCount = byCandidate.get("age_sex_plus_glycemia_body") ?? 0;
  const glycemiaOnlyCount = byCandidate.get("age_sex_plus_glycemia") ?? 0;
  if (glycemiaBodyCount > glycemiaOnlyCount) return "glycemia_body";
  if (glycemiaOnlyCount > glycemiaBodyCount) return "glycemia_only";
  return "source_validation";
}

function properScoreDirection(input: { brierDelta: number; logLossDelta: number }): CandidateResult["properScoreDirection"] {
  if (input.brierDelta < 0 && input.logLossDelta < 0) return "better_than_age_sex";
  if (input.brierDelta > 0 || input.logLossDelta > 0) return "worse_than_age_sex";
  return "same_as_age_sex";
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read a Murph Age aggregate artifact.");
  }
}

function readRecordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`${label} must be an object array.`);
  }
  return value as Record<string, unknown>[];
}

function readNumberRecord(value: unknown): Record<string, number> {
  const record = optionalRecord(value);
  if (!record) return {};
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
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

function requiredMetadataLabel(value: unknown, label: string): string {
  const stringValue = optionalString(value);
  if (!stringValue || stringValue.length > 96 || /[\r\n\t/\\]/u.test(stringValue) || /\b(?:http|file|authorization|coefficient|participant|prediction|row|source\s*body)\b/iu.test(stringValue)) {
    throw new Error(`${label} is not a safe metadata label.`);
  }
  return stringValue;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredNumber(value: unknown, label: string): number {
  const number = optionalNumber(value);
  if (number === null) throw new Error(`${label} must be a finite number.`);
  return number;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR607GlycemiaAblationReviewPacket({
    haalsiPath: process.env.MURPH_AGE_HAALSI_FEASIBILITY_PATH,
    mhasPath: process.env.MURPH_AGE_MHAS_JOIN_PROBE_PATH,
    nshapPath: process.env.MURPH_AGE_NSHAP_FEASIBILITY_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r604Path: process.env.MURPH_AGE_R604_REDUCTION_PATH,
    r605Path: process.env.MURPH_AGE_R605_REDUCTION_PATH,
    r606Path: process.env.MURPH_AGE_R606_PACKET_PATH,
  }).then(({ output, outputPath }) => {
    process.stdout.write(`${JSON.stringify({
      artifact: path.basename(outputPath),
      candidateFamily: output.summary.candidateFamily,
      conclusion: output.summary.conclusion,
      packetId: output.packetId,
      productPromotionAuthorized: output.boundary.productPromotionAuthorized,
      schemaVersion: output.schemaVersion,
      status: output.status,
      strongestProperScoreDirection: output.resultInterpretation.strongestProperScoreDirection,
    }, null, 2)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R607 glycemia ablation review packet failed.");
    process.exitCode = 1;
  });
}
