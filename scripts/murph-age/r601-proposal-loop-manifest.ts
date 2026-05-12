import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R601_PROPOSAL_LOOP_MANIFEST_SCHEMA_VERSION =
  "murph-age-r601-proposal-loop-manifest.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(".runtime", "operations", "research", "murph-age", "model-runs");
const DEFAULT_PACKET_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r600-aggregate-results-packet.latest.json");
const DEFAULT_OUTPUT_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "autoresearch",
  "candidate-manifests",
);
const OUTPUT_FILE_NAME = "r601-proposal-loop-manifest.latest.json";

type CandidateRole =
  | "external-validation-handoff"
  | "negative-result-memory"
  | "reviewer-direction"
  | "source-activation-readiness";

interface ProposalCandidate {
  allowedEvaluatorIds: string[];
  blockedActions: string[];
  candidateId:
    | "partner-aggregate-frozen-evaluator-handoff"
    | "public-external-source-activation-readiness"
    | "residual-increment-negative-result-memory"
    | "reviewer-direction-packet";
  complexity: "low";
  hypothesis: string;
  proposalRole: CandidateRole;
  requiresReviewGptBeforeExecution: boolean;
}

export interface R601ProposalLoopManifestOptions {
  createdAt?: string;
  outputDir?: string;
  packetPath?: string;
}

export interface R601ProposalLoopManifest {
  aggregateBoundary: {
    aggregateOnly: true;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowValuesStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  approvedEvaluatorRegistry: Array<{
    evaluatorId: string;
    status: "manifest-only" | "approved-local-aggregate-runner";
  }>;
  candidates: ProposalCandidate[];
  createdAt: string;
  inputReceipt: {
    packetHash: string;
    packetId: string;
    packetSchemaVersion: string;
  };
  manifestId: "r601-post-r600-proposal-loop";
  nextStep: {
    codexLocalAction: "prepare-approved-runner-only-after-r601-results";
    reviewGptAction: "harvest_r601_aggregate_results_next_loop_chorus";
  };
  negativeResultMemory: {
    conclusion: string;
    retainAsEvidence: true;
    retuneSameInternalSources: false;
  };
  schemaVersion: typeof R601_PROPOSAL_LOOP_MANIFEST_SCHEMA_VERSION;
  status: "research-proposal-only";
}

export async function runR601ProposalLoopManifest(
  options: R601ProposalLoopManifestOptions = {},
): Promise<{ output: R601ProposalLoopManifest; outputPath: string }> {
  const packet = requiredRecord(await readJson(options.packetPath ?? DEFAULT_PACKET_PATH), "R600 aggregate packet");
  const output: R601ProposalLoopManifest = {
    aggregateBoundary: readBoundary(packet.boundary),
    approvedEvaluatorRegistry: [
      {
        evaluatorId: "r399-midus-biomarker-increment-aggregate-only",
        status: "approved-local-aggregate-runner",
      },
      {
        evaluatorId: "partner-aggregate-frozen-evaluator",
        status: "manifest-only",
      },
      {
        evaluatorId: "public-external-source-activation-intake",
        status: "manifest-only",
      },
    ],
    candidates: [
      {
        allowedEvaluatorIds: ["partner-aggregate-frozen-evaluator"],
        blockedActions: [
          "row intake",
          "individual-level output",
          "product display",
          "model promotion",
        ],
        candidateId: "partner-aggregate-frozen-evaluator-handoff",
        complexity: "low",
        hypothesis: "A frozen aggregate evaluator handoff is the cleanest way to test whether the weak internal biomarker signal transports without receiving external rows.",
        proposalRole: "external-validation-handoff",
        requiresReviewGptBeforeExecution: true,
      },
      {
        allowedEvaluatorIds: ["public-external-source-activation-intake"],
        blockedActions: [
          "terms bypass",
          "source body storage",
          "row parsing",
          "model scoring",
        ],
        candidateId: "public-external-source-activation-readiness",
        complexity: "low",
        hypothesis: "A metadata-only source activation pass should choose the next lawful public transport lane before more internal tuning.",
        proposalRole: "source-activation-readiness",
        requiresReviewGptBeforeExecution: true,
      },
      {
        allowedEvaluatorIds: [],
        blockedActions: [
          "retune compact bloodwork/body residuals on inspected MIDUS lanes",
          "select by tiny-event internal replication lift",
          "product display",
        ],
        candidateId: "residual-increment-negative-result-memory",
        complexity: "low",
        hypothesis: "The R600 result should be retained as weak internal evidence so the loop does not keep rediscovering the same small lift.",
        proposalRole: "negative-result-memory",
        requiresReviewGptBeforeExecution: false,
      },
      {
        allowedEvaluatorIds: [],
        blockedActions: [
          "micro-gate review",
          "row-level packet",
          "product claim",
        ],
        candidateId: "reviewer-direction-packet",
        complexity: "low",
        hypothesis: "The R601 aggregate-results chorus should choose the next scientific direction; Codex should handle local runner mechanics without extra ReviewGPT approval.",
        proposalRole: "reviewer-direction",
        requiresReviewGptBeforeExecution: false,
      },
    ],
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputReceipt: {
      packetHash: `sha256:${sha256(JSON.stringify(packet))}`,
      packetId: requiredString(packet.packetId, "R600 packet id"),
      packetSchemaVersion: requiredString(packet.schemaVersion, "R600 packet schema version"),
    },
    manifestId: "r601-post-r600-proposal-loop",
    negativeResultMemory: {
      conclusion: readConclusion(packet),
      retainAsEvidence: true,
      retuneSameInternalSources: false,
    },
    nextStep: {
      codexLocalAction: "prepare-approved-runner-only-after-r601-results",
      reviewGptAction: "harvest_r601_aggregate_results_next_loop_chorus",
    },
    schemaVersion: R601_PROPOSAL_LOOP_MANIFEST_SCHEMA_VERSION,
    status: "research-proposal-only",
  };
  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R601 proposal manifest failed aggregate-egress validation: ${findings.join("; ")}`);
  }
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function readBoundary(value: unknown): R601ProposalLoopManifest["aggregateBoundary"] {
  const boundary = requiredRecord(value, "R600 aggregate boundary");
  return {
    aggregateOnly: requiredTrue(boundary.aggregateOnly, "aggregateOnly"),
    coefficientsStored: requiredFalse(boundary.coefficientsStored, "coefficientsStored"),
    localPathsStored: requiredFalse(boundary.localPathsStored, "localPathsStored"),
    modelParametersStored: requiredFalse(boundary.modelParametersStored, "modelParametersStored"),
    participantIdentifiersStored: requiredFalse(boundary.participantIdentifiersStored, "participantIdentifiersStored"),
    predictionsStored: requiredFalse(boundary.predictionsStored, "predictionsStored"),
    productDisplayAuthorized: requiredFalse(boundary.productDisplayAuthorized, "productDisplayAuthorized"),
    productPromotionAuthorized: requiredFalse(boundary.productPromotionAuthorized, "productPromotionAuthorized"),
    rowValuesStored: requiredFalse(boundary.rowValuesStored, "rowValuesStored"),
    sourceBodiesStored: requiredFalse(boundary.sourceBodiesStored, "sourceBodiesStored"),
    splitMembershipStored: requiredFalse(boundary.splitMembershipStored, "splitMembershipStored"),
  };
}

function readConclusion(packet: Record<string, unknown>): string {
  const summary = requiredRecord(packet.summary, "R600 packet summary");
  return requiredString(summary.conclusion, "R600 packet conclusion");
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("Failed to read the R600 aggregate-results packet.");
  }
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a string.`);
  return value;
}

function requiredTrue(value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label} must be true.`);
  return true;
}

function requiredFalse(value: unknown, label: string): false {
  if (value !== false) throw new Error(`${label} must be false.`);
  return false;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR601ProposalLoopManifest({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    packetPath: process.env.MURPH_AGE_R600_PACKET_PATH,
  }).then(({ output: manifest, outputPath }) => {
    const cliSummary = toCliSummary(manifest, outputPath);
    console.log(JSON.stringify(cliSummary, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R601 proposal manifest failed.");
    process.exitCode = 1;
  });
}

function toCliSummary(output: R601ProposalLoopManifest, outputPath: string): {
  artifact: string;
  candidateCount: number;
  manifestId: R601ProposalLoopManifest["manifestId"];
  productPromotionAuthorized: false;
  schemaVersion: typeof R601_PROPOSAL_LOOP_MANIFEST_SCHEMA_VERSION;
  status: R601ProposalLoopManifest["status"];
} {
  return {
    artifact: path.basename(outputPath),
    candidateCount: output.candidates.length,
    manifestId: output.manifestId,
    productPromotionAuthorized: output.aggregateBoundary.productPromotionAuthorized,
    schemaVersion: output.schemaVersion,
    status: output.status,
  };
}
