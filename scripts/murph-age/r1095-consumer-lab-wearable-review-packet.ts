import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1095_CONSUMER_LAB_WEARABLE_REVIEW_PACKET_SCHEMA_VERSION =
  "murph-age-r1095-consumer-lab-wearable-review-packet.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1095-consumer-lab-wearable-review-packet.latest.json";

const INPUTS = {
  r1091: {
    artifact: "r1091-consumer-input-loop-state.latest.json",
    packetId: "r1091-consumer-input-loop-state",
    schemaVersion: "murph-age-r1091-consumer-input-loop-state.v1",
  },
  r1092: {
    artifact: "r1092-consumer-bloodwork-control-hardening.latest.json",
    packetId: "r1092-consumer-bloodwork-control-hardening",
    schemaVersion: "murph-age-r1092-consumer-bloodwork-control-hardening.v1",
  },
  r1093: {
    artifact: "r1093-consumer-lab-shadow-candidate-selector.latest.json",
    packetId: "r1093-consumer-lab-shadow-candidate-selector",
    schemaVersion: "murph-age-r1093-consumer-lab-shadow-candidate-selector.v1",
  },
  r1094: {
    artifact: "r1094-consumer-age-domain-applicability-guard.latest.json",
    packetId: "r1094-consumer-age-domain-applicability-guard",
    schemaVersion: "murph-age-r1094-consumer-age-domain-applicability-guard.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ReviewerQuestion {
  questionId:
    | "candidate_shape"
    | "external_validation_priority"
    | "wearable_unblocker"
    | "age_domain_guard"
    | "simplicity_risk";
  prompt: string;
}

export interface R1095ConsumerLabWearableReviewPacketOptions {
  createdAt?: string;
  outputDir?: string;
  r1091Path?: string;
  r1092Path?: string;
  r1093Path?: string;
  r1094Path?: string;
}

export interface R1095ConsumerLabWearableReviewPacketOutput {
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
    rowParsingPerformedByR1095: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  currentDecision: {
    candidateId: "common_lab_core_shadow" | "none";
    candidateStatus: "research_shadow_only";
    primaryTargetUserInputs: [
      "common_bloodwork",
      "manual_or_device_vitals",
      "consumer_wearable_aggregates",
    ];
    productDisplayAuthorized: false;
    targetAgeBand: "roughly_16_50";
  };
  evidenceSnapshot: {
    blockedWearableFamilies: string[];
    bloodworkConclusion: string | null;
    candidateSelectionConclusion: string | null;
    consumerLoopConclusion: string | null;
    labCandidatePromotionBlockers: string[];
    validationGap: string | null;
  };
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1095-consumer-lab-wearable-review-packet";
  productDisplayAuthorized: false;
  reviewerAsk: {
    instruction: "review_science_direction_only_not_local_plumbing";
    questions: ReviewerQuestion[];
    returnFormat: "concise_json_plus_short_rationale";
  };
  schemaVersion: typeof R1095_CONSUMER_LAB_WEARABLE_REVIEW_PACKET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "review_packet_ready_for_high_value_reviewgpt"
      | "review_packet_blocked_missing_current_decision";
    nextLocalAction:
      | "send_to_reviewgpt_for_science_direction_critique"
      | "repair_consumer_lab_wearable_state";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1095: false;
  };
}

export async function runR1095ConsumerLabWearableReviewPacket(
  options: R1095ConsumerLabWearableReviewPacketOptions = {},
): Promise<{ output: R1095ConsumerLabWearableReviewPacketOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const candidateId = readStringAt(inputs.r1093, ["selection", "candidateId"]) === "common_lab_core_shadow"
    ? "common_lab_core_shadow"
    : "none";
  const validationGap = readStringAt(inputs.r1094, ["applicability", "validationGap"]);
  const ready = candidateId === "common_lab_core_shadow"
    && validationGap === "candidate_sources_not_direct_young_adult_consumer_validation";
  const output: R1095ConsumerLabWearableReviewPacketOutput = {
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
      rowParsingPerformedByR1095: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    currentDecision: {
      candidateId,
      candidateStatus: "research_shadow_only",
      primaryTargetUserInputs: [
        "common_bloodwork",
        "manual_or_device_vitals",
        "consumer_wearable_aggregates",
      ],
      productDisplayAuthorized: false,
      targetAgeBand: "roughly_16_50",
    },
    evidenceSnapshot: {
      blockedWearableFamilies: readStringArrayAt(inputs.r1091, ["consumerInputLoop", "wearables", "blockedFamilies"]),
      bloodworkConclusion: readStringAt(inputs.r1092, ["summary", "conclusion"]),
      candidateSelectionConclusion: readStringAt(inputs.r1093, ["summary", "conclusion"]),
      consumerLoopConclusion: readStringAt(inputs.r1091, ["summary", "conclusion"]),
      labCandidatePromotionBlockers: readStringArrayAt(inputs.r1093, ["selection", "promotionBlockedBy"]),
      validationGap,
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1095-consumer-lab-wearable-review-packet",
    productDisplayAuthorized: false,
    reviewerAsk: {
      instruction: "review_science_direction_only_not_local_plumbing",
      questions: [
        {
          questionId: "candidate_shape",
          prompt: "Is common_lab_core_shadow the right next research-only candidate shape for average 16-50 users, or should the lab family be narrower or broader?",
        },
        {
          questionId: "external_validation_priority",
          prompt: "What source or validation route should be prioritized next for younger or all-age common bloodwork plus vitals validation?",
        },
        {
          questionId: "wearable_unblocker",
          prompt: "What is the cleanest next true-wearable outcome-linked route without turning wearables into context-free claims?",
        },
        {
          questionId: "age_domain_guard",
          prompt: "Is the current 16-50 applicability guard too strict, too loose, or correctly scoped?",
        },
        {
          questionId: "simplicity_risk",
          prompt: "What is the simplest maintainable model shape that avoids construct collapse between age mimicry, prognosis, and intervention relevance?",
        },
      ],
      returnFormat: "concise_json_plus_short_rationale",
    },
    schemaVersion: R1095_CONSUMER_LAB_WEARABLE_REVIEW_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "review_packet_ready_for_high_value_reviewgpt"
        : "review_packet_blocked_missing_current_decision",
      nextLocalAction: ready
        ? "send_to_reviewgpt_for_science_direction_critique"
        : "repair_consumer_lab_wearable_state",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1095: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1095 consumer lab/wearable review packet failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1095ConsumerLabWearableReviewPacketOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1091: await readJsonIfPresent(options.r1091Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1091.artifact)),
    r1092: await readJsonIfPresent(options.r1092Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1092.artifact)),
    r1093: await readJsonIfPresent(options.r1093Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1093.artifact)),
    r1094: await readJsonIfPresent(options.r1094Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1094.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1095 rejected unsafe ${key} input: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.keys(INPUTS) as InputKey[]).map((key) => [key, summarizeInput(INPUTS[key].artifact, inputs[key])]),
  ) as Record<InputKey, ArtifactSummary>;
}

function summarizeInput(artifact: string, value: unknown | null): ArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value ? "available" : "missing",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function readStringArrayAt(value: unknown | null, keys: readonly string[]): string[] {
  const found = readAt(value, keys);
  return Array.isArray(found) ? found.filter((item): item is string => typeof item === "string") : [];
}

function readStringAt(value: unknown | null, keys: readonly string[]): string | null {
  const found = readAt(value, keys);
  return typeof found === "string" ? found : null;
}

function readAt(value: unknown | null, keys: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1095ConsumerLabWearableReviewPacket()
    .then(({ output }) => {
      process.stdout.write(`${JSON.stringify({
        candidateId: output.currentDecision.candidateId,
        conclusion: output.summary.conclusion,
        nextLocalAction: output.summary.nextLocalAction,
        packetId: output.packetId,
        productDisplayAuthorized: output.productDisplayAuthorized,
        rowParsingPerformedByR1095: output.summary.rowParsingPerformedByR1095,
        schemaVersion: output.schemaVersion,
        status: output.status,
      }, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "R1095 consumer lab/wearable review packet failed."}\n`);
      process.exitCode = 1;
    });
}
