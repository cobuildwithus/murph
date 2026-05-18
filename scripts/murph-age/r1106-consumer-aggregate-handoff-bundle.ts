import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1106_CONSUMER_AGGREGATE_HANDOFF_BUNDLE_SCHEMA_VERSION =
  "murph-age-r1106-consumer-aggregate-handoff-bundle.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1106-consumer-aggregate-handoff-bundle.latest.json";

const INPUTS = {
  r1103: {
    artifact: "r1103-consumer-candidate-family-manifest.latest.json",
    packetId: "r1103-consumer-candidate-family-manifest",
    schemaVersion: "murph-age-r1103-consumer-candidate-family-manifest.v1",
  },
  r1104: {
    artifact: "r1104-consumer-aggregate-receipt-validator.latest.json",
    packetId: "r1104-consumer-aggregate-receipt-validator",
    schemaVersion: "murph-age-r1104-consumer-aggregate-receipt-validator.v1",
  },
  r1105: {
    artifact: "r1105-consumer-aggregate-receipt-template.latest.json",
    packetId: "r1105-consumer-aggregate-receipt-template",
    schemaVersion: "murph-age-r1105-consumer-aggregate-receipt-template.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface HandoffCandidate {
  candidateId: string;
  candidateKind: string;
  comparatorId: string;
  priority: number | null;
  status: string | null;
}

export interface R1106ConsumerAggregateHandoffBundleOptions {
  createdAt?: string;
  outputDir?: string;
  r1103Path?: string;
  r1104Path?: string;
  r1105Path?: string;
}

export interface R1106ConsumerAggregateHandoffBundleOutput {
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
    rowParsingPerformedByR1106: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  handoff: {
    blockedEgress: string[];
    candidateResults: HandoffCandidate[];
    expectedReceiptArtifact: "r1105-fillable-consumer-aggregate-receipt-template.json";
    intendedRunner: "all_of_us_or_partner_workbench_or_equivalent_outcome_linked_source";
    requiredAttestations: string[];
    requiredReceiptSchemaVersion: "murph-age-consumer-lab-wearable-aggregate-receipt.v1" | null;
    requiredEvaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1" | null;
    successRouting: {
      aggregateReceiptMissing: "collect_or_run_consumer_lab_wearable_aggregate_receipt";
      aggregateReceiptReadyForReviewGpt: "send_aggregate_only_consumer_lab_wearable_delta_to_reviewgpt";
      aggregateReceiptValidButNoDelta: "record_no_delta_memory_and_continue_source_search";
    };
    validationCommand: "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts";
  };
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1106-consumer-aggregate-handoff-bundle";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1106_CONSUMER_AGGREGATE_HANDOFF_BUNDLE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    candidateResultCount: number;
    conclusion:
      | "consumer_aggregate_handoff_ready"
      | "consumer_aggregate_handoff_waiting_on_manifest_or_template";
    nextAction:
      | "run_or_request_outcome_linked_consumer_aggregate_receipt"
      | "regenerate_r1103_r1105_before_handoff";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1106: false;
  };
  thresholds: {
    generalUnlock: string | null;
    labUnlock: string | null;
    wearableUnlock: string | null;
  };
}

export async function runR1106ConsumerAggregateHandoffBundle(
  options: R1106ConsumerAggregateHandoffBundleOptions = {},
): Promise<{ output: R1106ConsumerAggregateHandoffBundleOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const templateReady = readBooleanAt(inputs.r1105, ["summary", "templateReadyForDataFill"]) === true;
  const manifestReady = readStringAt(inputs.r1103, ["summary", "conclusion"]) === "consumer_candidate_family_manifest_ready";
  const ready = templateReady && manifestReady;
  const candidateResults = handoffCandidates(inputs.r1103, inputs.r1105);
  const output: R1106ConsumerAggregateHandoffBundleOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    handoff: {
      blockedEgress: [
        "participant_identifiers",
        "row_values",
        "split_membership",
        "participant_level_predictions",
        "coefficients",
        "model_parameters",
        "source_bodies_or_codebook_text",
        "small_cells",
        "product_claims",
      ],
      candidateResults,
      expectedReceiptArtifact: "r1105-fillable-consumer-aggregate-receipt-template.json",
      intendedRunner: "all_of_us_or_partner_workbench_or_equivalent_outcome_linked_source",
      requiredAttestations: [
        "aggregateOnly",
        "endpointFrozenBeforeScoring",
        "evaluatorFrozenBeforeExecution",
        "noCoefficientEgress",
        "noParticipantEgress",
        "noPredictionEgress",
        "noRowEgress",
        "noSmallCellEgress",
        "sameDenominatorComparisons",
      ],
      requiredEvaluatorId: readStringAt(inputs.r1105, ["fillableReceiptTemplate", "evaluatorId"]) === "consumer_lab_wearable_aggregate_evaluator_v1"
        ? "consumer_lab_wearable_aggregate_evaluator_v1"
        : null,
      requiredReceiptSchemaVersion: readStringAt(inputs.r1105, ["fillableReceiptTemplate", "schemaVersion"]) === "murph-age-consumer-lab-wearable-aggregate-receipt.v1"
        ? "murph-age-consumer-lab-wearable-aggregate-receipt.v1"
        : null,
      successRouting: {
        aggregateReceiptMissing: "collect_or_run_consumer_lab_wearable_aggregate_receipt",
        aggregateReceiptReadyForReviewGpt: "send_aggregate_only_consumer_lab_wearable_delta_to_reviewgpt",
        aggregateReceiptValidButNoDelta: "record_no_delta_memory_and_continue_source_search",
      },
      validationCommand:
        "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts",
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1106-consumer-aggregate-handoff-bundle",
    productDisplayAuthorized: false,
    schemaVersion: R1106_CONSUMER_AGGREGATE_HANDOFF_BUNDLE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      candidateResultCount: candidateResults.length,
      conclusion: ready
        ? "consumer_aggregate_handoff_ready"
        : "consumer_aggregate_handoff_waiting_on_manifest_or_template",
      nextAction: ready
        ? "run_or_request_outcome_linked_consumer_aggregate_receipt"
        : "regenerate_r1103_r1105_before_handoff",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1106: false,
    },
    thresholds: {
      generalUnlock: readStringAt(inputs.r1103, ["thresholds", "generalUnlock"]),
      labUnlock: readStringAt(inputs.r1103, ["thresholds", "labUnlock"]),
      wearableUnlock: readStringAt(inputs.r1103, ["thresholds", "wearableUnlock"]),
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1106 consumer aggregate handoff bundle failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function handoffCandidates(r1103: unknown | null, r1105: unknown | null): HandoffCandidate[] {
  const manifestCandidates = readArrayAt(r1103, ["candidateFamilies"]);
  const priorities = new Map<string, { priority: number | null; status: string | null }>();
  for (const candidate of manifestCandidates) {
    const candidateId = readStringAt(candidate, ["candidateId"]);
    if (!candidateId) continue;
    priorities.set(candidateId, {
      priority: readNumberAt(candidate, ["priority"]),
      status: readStringAt(candidate, ["status"]),
    });
  }
  return readArrayAt(r1105, ["fillableReceiptTemplate", "candidateResults"])
    .map((candidate): HandoffCandidate | null => {
      const candidateId = readStringAt(candidate, ["candidateId"]);
      const candidateKind = readStringAt(candidate, ["candidateKind"]);
      const comparatorId = readStringAt(candidate, ["comparatorId"]);
      if (!candidateId || !candidateKind || !comparatorId) return null;
      const manifestState = priorities.get(candidateId);
      return {
        candidateId,
        candidateKind,
        comparatorId,
        priority: manifestState?.priority ?? null,
        status: manifestState?.status ?? null,
      };
    })
    .filter((candidate): candidate is HandoffCandidate => candidate !== null);
}

async function readInputs(options: R1106ConsumerAggregateHandoffBundleOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1103: await readJsonIfPresent(options.r1103Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1103.artifact)),
    r1104: await readJsonIfPresent(options.r1104Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1104.artifact)),
    r1105: await readJsonIfPresent(options.r1105Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1105.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1106 rejected unsafe ${key} input: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.entries(INPUTS) as Array<[InputKey, typeof INPUTS[InputKey]]>).map(([key, expected]) => {
      const input = inputs[key];
      return [key, {
        artifact: expected.artifact,
        packetId: readStringAt(input, ["packetId"]),
        schemaVersion: readStringAt(input, ["schemaVersion"]),
        status: input ? "available" : "missing",
      }];
    }),
  ) as Record<InputKey, ArtifactSummary>;
}

function safeBoundary(): R1106ConsumerAggregateHandoffBundleOutput["artifactBoundary"] {
  return {
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
    rowParsingPerformedByR1106: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return null;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object" || Array.isArray(current) || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readArrayAt(value: unknown, pathParts: readonly string[]): unknown[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved : [];
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readNumberAt(value: unknown, pathParts: readonly string[]): number | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "number" ? resolved : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

async function main(): Promise<void> {
  const { output } = await runR1106ConsumerAggregateHandoffBundle({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1103Path: process.env.MURPH_AGE_R1103_CONSUMER_CANDIDATE_MANIFEST_PATH,
    r1104Path: process.env.MURPH_AGE_R1104_CONSUMER_AGGREGATE_VALIDATOR_PATH,
    r1105Path: process.env.MURPH_AGE_R1105_CONSUMER_AGGREGATE_TEMPLATE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    candidateResultCount: output.summary.candidateResultCount,
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1106: output.summary.rowParsingPerformedByR1106,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1106 consumer aggregate handoff bundle failed."}\n`);
    process.exitCode = 1;
  });
}
