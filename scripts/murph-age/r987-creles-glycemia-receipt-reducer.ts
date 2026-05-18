import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R987_CRELES_GLYCEMIA_RECEIPT_REDUCER_SCHEMA_VERSION =
  "murph-age-r987-creles-glycemia-receipt-reducer.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R603_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r603-transport-readiness-packet.latest.json");
const OUTPUT_FILE_NAME = "r987-creles-glycemia-receipt-reducer.latest.json";

type CandidateId = "tiny_glycemia_only" | "glycemia_body" | "body_only" | "midus_to_creles_transport";
type CandidateVerdict =
  | "keep_for_future_external_validation"
  | "deprioritize_or_retire"
  | "missing_aggregate_evidence";

interface CandidateReceipt {
  candidateId: CandidateId;
  decision: CandidateVerdict;
  evidenceLabels: string[];
  metricDeltasVsReference: {
    aucDelta: number | null;
    brierDelta: number | null;
    logLossDelta: number | null;
  };
  sourceScope: "creles_local_aggregate" | "midus_to_creles_transport_aggregate";
}

export interface R987CrelesGlycemiaReceiptReducerOptions {
  createdAt?: string;
  outputDir?: string;
  r603Path?: string;
}

export interface R987CrelesGlycemiaReceiptReducerOutput {
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
    rowParsingPerformedByR987: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r603TransportReadinessPacket: {
      artifact: "r603-transport-readiness-packet.latest.json";
      packetId: string | null;
      schemaVersion: string | null;
      status: "available" | "missing";
    };
  };
  packetId: "r987-creles-glycemia-receipt-reducer";
  receiptReduction: {
    candidateReceipts: CandidateReceipt[];
    crelesEvidenceStatus: "available" | "missing";
    midusTransportEvidenceStatus: "available" | "missing";
    nonConfirmingTransportPolicy: "deprioritize_non_confirming_midus_to_creles_transport";
  };
  schemaVersion: typeof R987_CRELES_GLYCEMIA_RECEIPT_REDUCER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    keyArtifactVerdict:
      | "keep_tiny_glycemia_only_and_glycemia_body_for_future_external_validation"
      | "hold_glycemia_candidates_until_aggregate_support_exists";
    nextLocalAction: "external_validation_only_no_product_promotion";
    productPromotionAuthorized: false;
    rowParsingPerformedByReducer: false;
  };
}

export async function runR987CrelesGlycemiaReceiptReducer(
  options: R987CrelesGlycemiaReceiptReducerOptions = {},
): Promise<{ output: R987CrelesGlycemiaReceiptReducerOutput; outputPath: string }> {
  const r603 = await readJsonIfPresent(options.r603Path ?? DEFAULT_R603_PATH);
  validateInputBoundary(r603);
  const candidateReceipts = reduceCandidateReceipts(r603);
  const keepGlycemia = candidateReceipts.some((receipt) =>
    receipt.candidateId === "tiny_glycemia_only" && receipt.decision === "keep_for_future_external_validation"
  ) && candidateReceipts.some((receipt) =>
    receipt.candidateId === "glycemia_body" && receipt.decision === "keep_for_future_external_validation"
  );

  const output: R987CrelesGlycemiaReceiptReducerOutput = {
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
      rowParsingPerformedByR987: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r603TransportReadinessPacket: summarizeR603(r603),
    },
    packetId: "r987-creles-glycemia-receipt-reducer",
    receiptReduction: {
      candidateReceipts,
      crelesEvidenceStatus: crelesModels(r603).length > 0 ? "available" : "missing",
      midusTransportEvidenceStatus: transportModels(r603).length > 0 ? "available" : "missing",
      nonConfirmingTransportPolicy: "deprioritize_non_confirming_midus_to_creles_transport",
    },
    schemaVersion: R987_CRELES_GLYCEMIA_RECEIPT_REDUCER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      keyArtifactVerdict: keepGlycemia
        ? "keep_tiny_glycemia_only_and_glycemia_body_for_future_external_validation"
        : "hold_glycemia_candidates_until_aggregate_support_exists",
      nextLocalAction: "external_validation_only_no_product_promotion",
      productPromotionAuthorized: false,
      rowParsingPerformedByReducer: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R987 CRELES glycemia receipt reducer failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function reduceCandidateReceipts(r603: unknown | null): CandidateReceipt[] {
  const creles = crelesModels(r603);
  const transport = transportModels(r603);
  return [
    crelesCandidateReceipt("tiny_glycemia_only", creles, "glycemia_only_no_crp"),
    crelesCandidateReceipt("glycemia_body", creles, "glycemia_body_no_crp"),
    crelesCandidateReceipt("body_only", creles, "body_only_no_crp"),
    transportReceipt(r603, transport),
  ];
}

function crelesCandidateReceipt(
  candidateId: Exclude<CandidateId, "midus_to_creles_transport">,
  models: Record<string, unknown>[],
  modelId: string,
): CandidateReceipt {
  const model = models.find((item) => readStringAt(item, ["modelId"]) === modelId);
  const deltas = readDeltas(model);
  if (!model || !deltas) {
    return missingReceipt(candidateId, "creles_local_aggregate");
  }
  const properScoresImprove = (deltas.brierDelta ?? 0) < 0 && (deltas.logLossDelta ?? 0) < 0;
  const discriminationImproves = deltas.aucDelta !== null && deltas.aucDelta > 0;
  const supported = properScoresImprove && discriminationImproves;
  return {
    candidateId,
    decision: supported && candidateId !== "body_only"
      ? "keep_for_future_external_validation"
      : "deprioritize_or_retire",
    evidenceLabels: [
      supported ? "creles_local_aggregate_deltas_supportive" : "creles_local_aggregate_deltas_not_supportive",
      candidateId === "body_only" ? "body_only_not_confirming" : "future_external_validation_only",
      "no_product_promotion",
    ],
    metricDeltasVsReference: deltas,
    sourceScope: "creles_local_aggregate",
  };
}

function transportReceipt(r603: unknown | null, models: Record<string, unknown>[]): CandidateReceipt {
  const model = models.find((item) => readStringAt(item, ["modelId"]) === "midus2_lab5_source_creles_recalibrated");
  const deltas = readDeltas(model);
  if (!model || !deltas) return missingReceipt("midus_to_creles_transport", "midus_to_creles_transport_aggregate");
  const conclusion = readStringAt(r603, ["readiness", "conclusion"]);
  const confirmed = conclusion === "transport_ready_for_review"
    && (deltas.brierDelta ?? 1) < 0
    && (deltas.logLossDelta ?? 1) < 0
    && deltas.aucDelta !== null
    && deltas.aucDelta >= 0;
  return {
    candidateId: "midus_to_creles_transport",
    decision: confirmed ? "keep_for_future_external_validation" : "deprioritize_or_retire",
    evidenceLabels: [
      confirmed ? "midus_to_creles_transport_confirming" : "midus_to_creles_transport_not_confirming",
      "transport_stress_only",
      "no_product_promotion",
    ],
    metricDeltasVsReference: deltas,
    sourceScope: "midus_to_creles_transport_aggregate",
  };
}

function missingReceipt(candidateId: CandidateId, sourceScope: CandidateReceipt["sourceScope"]): CandidateReceipt {
  return {
    candidateId,
    decision: "missing_aggregate_evidence",
    evidenceLabels: ["aggregate_artifact_missing", "no_product_promotion"],
    metricDeltasVsReference: {
      aucDelta: null,
      brierDelta: null,
      logLossDelta: null,
    },
    sourceScope,
  };
}

function readDeltas(model: unknown): CandidateReceipt["metricDeltasVsReference"] | null {
  const deltas = readRecordAt(model, ["metricDeltasVsReference"]);
  if (!deltas) return null;
  return {
    aucDelta: readNumberAt(deltas, ["aucDelta"]),
    brierDelta: readNumberAt(deltas, ["brierDelta"]),
    logLossDelta: readNumberAt(deltas, ["logLossDelta"]),
  };
}

function crelesModels(r603: unknown | null): Record<string, unknown>[] {
  if (readStringAt(r603, ["transport", "crelesLocal", "status"]) !== "available") return [];
  return readRecordArrayAt(r603, ["transport", "crelesLocal", "models"]);
}

function transportModels(r603: unknown | null): Record<string, unknown>[] {
  if (readStringAt(r603, ["transport", "midusToCreles", "status"]) !== "available") return [];
  return readRecordArrayAt(r603, ["transport", "midusToCreles", "models"]);
}

function summarizeR603(value: unknown | null): R987CrelesGlycemiaReceiptReducerOutput["inputArtifacts"]["r603TransportReadinessPacket"] {
  if (!value) {
    return {
      artifact: "r603-transport-readiness-packet.latest.json",
      packetId: null,
      schemaVersion: null,
      status: "missing",
    };
  }
  return {
    artifact: "r603-transport-readiness-packet.latest.json",
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: "available",
  };
}

function validateInputBoundary(value: unknown | null): void {
  if (!value) return;
  const boundary = readRecordAt(value, ["boundary"]) ?? readRecordAt(value, ["artifactBoundary"]);
  if (!boundary) throw new Error("R603 aggregate packet is missing boundary flags.");
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R603 aggregate packet failed aggregate-egress validation: ${findings.join("; ")}`);
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read R987 aggregate input artifact.");
  }
}

function readRecordAt(value: unknown, pathParts: readonly string[]): Record<string, unknown> | null {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return null;
  return current as Record<string, unknown>;
}

function readRecordArrayAt(value: unknown, pathParts: readonly string[]): Record<string, unknown>[] {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return [];
    current = (current as Record<string, unknown>)[part];
  }
  if (!Array.isArray(current)) return [];
  return current.filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : null;
}

function readNumberAt(value: unknown, pathParts: readonly string[]): number | null {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR987CrelesGlycemiaReceiptReducer({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r603Path: process.env.MURPH_AGE_R603_TRANSPORT_READINESS_PACKET_PATH,
  }).then(({ output: packet, outputPath }) => {
    const keepCount = packet.receiptReduction.candidateReceipts.filter((receipt) =>
      receipt.decision === "keep_for_future_external_validation"
    ).length;
    const cliSummary = {
      artifact: path.basename(outputPath),
      keyArtifactVerdict: packet.summary.keyArtifactVerdict,
      packetId: packet.packetId,
      productPromotionAuthorized: packet.summary.productPromotionAuthorized,
      retainedForFutureExternalValidation: keepCount,
      rowParsingPerformedByReducer: packet.summary.rowParsingPerformedByReducer,
      schemaVersion: packet.schemaVersion,
      status: packet.status,
    };
    console.log(JSON.stringify(cliSummary, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R987 CRELES glycemia receipt reducer failed.");
    process.exitCode = 1;
  });
}
