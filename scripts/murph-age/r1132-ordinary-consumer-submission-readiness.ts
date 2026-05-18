import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_SCHEMA_VERSION =
  "murph-age-r1132-ordinary-consumer-submission-readiness.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1132-ordinary-consumer-submission-readiness.latest.json";
const R1131_COMPLETION_AUDIT_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1131-consumer-real-evidence-completion-audit.ts" as const;

const INPUTS = {
  r1127: {
    artifact: "r1127-ordinary-consumer-first-pass-submission-handoff.latest.json",
    packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
    schemaVersion: "murph-age-r1127-ordinary-consumer-first-pass-submission-handoff.v1",
  },
  r1130: {
    artifact: "r1130-ordinary-consumer-real-evidence-handoff.latest.json",
    packetId: "r1130-ordinary-consumer-real-evidence-handoff",
    schemaVersion: "murph-age-r1130-ordinary-consumer-real-evidence-handoff.v1",
  },
  r1131: {
    artifact: "r1131-consumer-real-evidence-completion-audit.latest.json",
    packetId: "r1131-consumer-real-evidence-completion-audit",
    schemaVersion: "murph-age-r1131-consumer-real-evidence-completion-audit.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type ReadinessConclusion =
  | "ordinary_consumer_submission_readiness_ready_for_completion_review"
  | "ordinary_consumer_submission_readiness_ready_for_private_runner"
  | "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping"
  | "ordinary_consumer_submission_readiness_waiting_on_refresh";
type ReadinessNextAction =
  | "continue_after_real_labs_wearables_receipt_review"
  | "fill_average_submitter_private_config_slots"
  | "refresh_r1127_r1130_r1131_before_submitter_readiness"
  | "run_r1125_private_runner_then_r1124_real_metric_intake";
type SourceFamilyStatus =
  | "mapped_or_not_blocking"
  | "needs_private_config"
  | "needs_private_ref_mapping"
  | "ready_for_private_runner"
  | "waiting_on_handoff_refresh";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SourceFamilyReadiness {
  acceptableForAverageUser: true;
  familyId: string;
  inputKind: string | null;
  missingSlotCount: number;
  missingSlotIds: string[];
  privateDetailsStored: false;
  requiredForCandidateIds: string[];
  requiredForFirstPass: boolean;
  requiredPrivateFieldRefFamilies: string[];
  requiredPrivateTableRefs: string[];
  status: SourceFamilyStatus;
}

interface MissingSlotSummary {
  bySlotType: Record<string, number>;
  missingSlotIds: string[];
  total: number;
}

export interface R1132OrdinaryConsumerSubmissionReadinessOptions {
  createdAt?: string;
  outputDir?: string;
  r1127Path?: string;
  r1130Path?: string;
  r1131Path?: string;
}

export interface R1132OrdinaryConsumerSubmissionReadinessOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1132: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1132: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  ordinaryConsumerReadiness: {
    blockers: string[];
    commands: {
      completionAuditCommand: typeof R1131_COMPLETION_AUDIT_COMMAND;
      configIntakeCommand: string | null;
      metricIntakeCommand: string | null;
      privateRunnerCommand: string | null;
    };
    completionAudit: {
      goalAchieved: boolean;
      readyToMarkComplete: boolean;
      topMissingRequirement: string | null;
    };
    minimalSubmissionBundle: {
      acceptedInputProfile: string | null;
      acceptedTableLayouts: string[];
      firstPassCandidateIds: string[];
      minimumEvidenceFloor: {
        eventCount: string | null;
        usableRecordCount: string | null;
      };
      priorityInputFamilies: string[];
      requiresOutcomeLinkage: true;
      targetAgeBand: "roughly_16_50";
    };
    missingSlotSummary: MissingSlotSummary;
    privateValuesStored: false;
    readyForPrivateRunner: boolean;
    sourceFamilies: SourceFamilyReadiness[];
  };
  packetId: "r1132-ordinary-consumer-submission-readiness";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    averageSubmitterFamilyIds: string[];
    conclusion: ReadinessConclusion;
    missingSlotCount: number;
    missingSlotTypes: string[];
    nextAction: ReadinessNextAction;
    productDisplayAuthorized: false;
    readyForPrivateRunner: boolean;
    realAggregateStillMissing: boolean;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1132: false;
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1132OrdinaryConsumerSubmissionReadiness(
  options: R1132OrdinaryConsumerSubmissionReadinessOptions = {},
): Promise<{ output: R1132OrdinaryConsumerSubmissionReadinessOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);
  const requiredInputsReady = inputMatchesExpected("r1127", inputs.r1127)
    && inputMatchesExpected("r1130", inputs.r1130)
    && inputMatchesExpected("r1131", inputs.r1131);
  const missingSlotSummary = missingSlotSummaryFor(inputs.r1130);
  const readyForPrivateRunner = requiredInputsReady
    && readStringAt(inputs.r1130, ["summary", "rowOwnerWorkType"]) === "run_private_runner";
  const goalAchieved = readBooleanAt(inputs.r1131, ["summary", "goalAchieved"]) === true;
  const readyToMarkComplete = readBooleanAt(inputs.r1131, ["summary", "readyToMarkComplete"]) === true;
  const conclusion = conclusionFor({ goalAchieved, readyForPrivateRunner, requiredInputsReady });
  const nextAction = nextActionFor(conclusion);
  const blockers = blockersFor({ inputs, requiredInputsReady });
  const sourceFamilies = sourceFamiliesFor({
    missingSlotIds: new Set(missingSlotSummary.missingSlotIds),
    r1130: inputs.r1130,
    r1127: inputs.r1127,
    readyForPrivateRunner,
    requiredInputsReady,
  });
  const output: R1132OrdinaryConsumerSubmissionReadinessOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    ordinaryConsumerReadiness: {
      blockers,
      commands: {
        completionAuditCommand: R1131_COMPLETION_AUDIT_COMMAND,
        configIntakeCommand: readStringAt(inputs.r1130, ["realEvidenceHandoff", "commands", "configIntakeCommand"]),
        metricIntakeCommand: readStringAt(inputs.r1130, ["realEvidenceHandoff", "commands", "metricIntakeCommand"]),
        privateRunnerCommand: readStringAt(inputs.r1130, ["realEvidenceHandoff", "commands", "privateRunnerCommand"]),
      },
      completionAudit: {
        goalAchieved,
        readyToMarkComplete,
        topMissingRequirement: readStringAt(inputs.r1131, ["summary", "topMissingRequirement"]),
      },
      minimalSubmissionBundle: {
        acceptedInputProfile: readStringAt(inputs.r1127, ["ordinarySubmissionHandoff", "acceptedInputProfile"]),
        acceptedTableLayouts: readStringArrayAt(inputs.r1130, ["realEvidenceHandoff", "acceptedTableLayouts"]),
        firstPassCandidateIds: readStringArrayAt(inputs.r1130, ["realEvidenceHandoff", "firstPassCandidateIds"]),
        minimumEvidenceFloor: {
          eventCount: readStringAt(inputs.r1130, ["realEvidenceHandoff", "minimumEvidenceFloor", "eventCount"]),
          usableRecordCount: readStringAt(inputs.r1130, [
            "realEvidenceHandoff",
            "minimumEvidenceFloor",
            "usableRecordCount",
          ]),
        },
        priorityInputFamilies: readStringArrayAt(inputs.r1130, ["realEvidenceHandoff", "priorityInputFamilies"]),
        requiresOutcomeLinkage: true,
        targetAgeBand: "roughly_16_50",
      },
      missingSlotSummary,
      privateValuesStored: false,
      readyForPrivateRunner,
      sourceFamilies,
    },
    packetId: "r1132-ordinary-consumer-submission-readiness",
    productDisplayAuthorized: false,
    schemaVersion: R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      averageSubmitterFamilyIds: sourceFamilies.map((family) => family.familyId),
      conclusion,
      missingSlotCount: missingSlotSummary.total,
      missingSlotTypes: Object.keys(missingSlotSummary.bySlotType),
      nextAction,
      productDisplayAuthorized: false,
      readyForPrivateRunner,
      realAggregateStillMissing: blockers.includes("real_outcome_linked_labs_wearables_aggregate_missing"),
      reviewGptRequiredNow: readBooleanAt(inputs.r1131, ["summary", "reviewGptRequiredNow"]) === true,
      rowParsingPerformedByR1132: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1132 ordinary consumer submission readiness failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function sourceFamiliesFor(input: {
  missingSlotIds: Set<string>;
  r1130: unknown | null;
  r1127: unknown | null;
  readyForPrivateRunner: boolean;
  requiredInputsReady: boolean;
}): SourceFamilyReadiness[] {
  const handoffRollup = readObjectArrayAt(input.r1130, [
    "realEvidenceHandoff",
    "ordinarySubmitterGuidance",
    "sourceFamilyMissingSlotRollup",
  ]);
  if (handoffRollup.length > 0) {
    return handoffRollup.map((family) => {
      const missingSlotIds = readStringArrayAt(family, ["missingSlotIds"]);
      const requiredForCandidateIds = readStringArrayAt(family, ["requiredForCandidateIds"]);
      return {
        acceptableForAverageUser: true,
        familyId: readStringAt(family, ["familyId"]) ?? "unknown_source_family",
        inputKind: readStringAt(family, ["inputKind"]),
        missingSlotCount: readNumberAt(family, ["missingSlotCount"]) ?? missingSlotIds.length,
        missingSlotIds,
        privateDetailsStored: false,
        requiredForCandidateIds,
        requiredForFirstPass: requiredForCandidateIds.length > 0,
        requiredPrivateFieldRefFamilies: readStringArrayAt(family, ["requiredSemanticRefFamilies"]),
        requiredPrivateTableRefs: readStringArrayAt(family, ["requiredTableRefs"]),
        status: sourceFamilyStatusFromString(readStringAt(family, ["status"])),
      };
    });
  }
  const families = readObjectArrayAt(input.r1127, ["ordinarySubmissionHandoff", "ordinarySourceFamilies"]);
  return families.map((family) => {
    const requiredPrivateFieldRefFamilies = readStringArrayAt(family, ["requiredPrivateFieldRefFamilies"]);
    const requiredPrivateTableRefs = readStringArrayAt(family, ["requiredPrivateTableRefs"]);
    const hasMissingSlot = [...requiredPrivateFieldRefFamilies, ...requiredPrivateTableRefs].some((slot) =>
      input.missingSlotIds.has(slot)
    );
    const missingSlotIds = [...requiredPrivateFieldRefFamilies, ...requiredPrivateTableRefs].filter((slot) =>
      input.missingSlotIds.has(slot)
    );
    return {
      acceptableForAverageUser: true,
      familyId: readStringAt(family, ["familyId"]) ?? "unknown_source_family",
      inputKind: readStringAt(family, ["inputKind"]),
      missingSlotCount: missingSlotIds.length,
      missingSlotIds,
      privateDetailsStored: false,
      requiredForCandidateIds: readStringArrayAt(family, ["requiredForCandidateIds"]),
      requiredForFirstPass: readStringArrayAt(family, ["requiredForCandidateIds"]).length > 0,
      requiredPrivateFieldRefFamilies,
      requiredPrivateTableRefs,
      status: sourceFamilyStatusFor({
        hasMissingSlot,
        readyForPrivateRunner: input.readyForPrivateRunner,
        requiredInputsReady: input.requiredInputsReady,
      }),
    };
  });
}

function sourceFamilyStatusFromString(status: string | null): SourceFamilyStatus {
  if (
    status === "mapped_or_not_blocking"
    || status === "needs_private_config"
    || status === "needs_private_ref_mapping"
    || status === "ready_for_private_runner"
    || status === "waiting_on_handoff_refresh"
  ) {
    return status;
  }
  return "needs_private_ref_mapping";
}

function sourceFamilyStatusFor(input: {
  hasMissingSlot: boolean;
  readyForPrivateRunner: boolean;
  requiredInputsReady: boolean;
}): SourceFamilyStatus {
  if (!input.requiredInputsReady) return "waiting_on_handoff_refresh";
  if (input.readyForPrivateRunner) return "ready_for_private_runner";
  return input.hasMissingSlot ? "needs_private_ref_mapping" : "mapped_or_not_blocking";
}

function missingSlotSummaryFor(r1130: unknown | null): MissingSlotSummary {
  const checklist = readObjectArrayAt(r1130, ["realEvidenceHandoff", "missingConfigChecklist"]);
  const bySlotType: Record<string, number> = {};
  const missingSlotIds: string[] = [];
  for (const item of checklist) {
    const slotType = readStringAt(item, ["slotType"]);
    const slotId = readStringAt(item, ["slotId"]);
    if (slotType) bySlotType[slotType] = (bySlotType[slotType] ?? 0) + 1;
    if (slotId) missingSlotIds.push(slotId);
  }
  return {
    bySlotType,
    missingSlotIds,
    total: checklist.length,
  };
}

function blockersFor(input: {
  inputs: Record<InputKey, unknown | null>;
  requiredInputsReady: boolean;
}): string[] {
  if (!input.requiredInputsReady) return ["refresh_required_submitter_readiness_inputs"];
  return Array.from(new Set([
    ...readStringArrayAt(input.inputs.r1130, ["realEvidenceHandoff", "blockers"]),
    ...readStringArrayAt(input.inputs.r1131, ["completionAudit", "blockers"]),
  ]));
}

function conclusionFor(input: {
  goalAchieved: boolean;
  readyForPrivateRunner: boolean;
  requiredInputsReady: boolean;
}): ReadinessConclusion {
  if (!input.requiredInputsReady) return "ordinary_consumer_submission_readiness_waiting_on_refresh";
  if (input.goalAchieved) return "ordinary_consumer_submission_readiness_ready_for_completion_review";
  if (input.readyForPrivateRunner) return "ordinary_consumer_submission_readiness_ready_for_private_runner";
  return "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping";
}

function nextActionFor(conclusion: ReadinessConclusion): ReadinessNextAction {
  if (conclusion === "ordinary_consumer_submission_readiness_waiting_on_refresh") {
    return "refresh_r1127_r1130_r1131_before_submitter_readiness";
  }
  if (conclusion === "ordinary_consumer_submission_readiness_ready_for_private_runner") {
    return "run_r1125_private_runner_then_r1124_real_metric_intake";
  }
  if (conclusion === "ordinary_consumer_submission_readiness_ready_for_completion_review") {
    return "continue_after_real_labs_wearables_receipt_review";
  }
  return "fill_average_submitter_private_config_slots";
}

async function readInputs(
  options: R1132OrdinaryConsumerSubmissionReadinessOptions,
): Promise<Record<InputKey, unknown | null>> {
  return {
    r1127: await readJsonIfPresent(options.r1127Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1127.artifact)),
    r1130: await readJsonIfPresent(options.r1130Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1130.artifact)),
    r1131: await readJsonIfPresent(options.r1131Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1131.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1132 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return {
    r1127: summarizeInput("r1127", inputs.r1127),
    r1130: summarizeInput("r1130", inputs.r1130),
    r1131: summarizeInput("r1131", inputs.r1131),
  };
}

function summarizeInput(key: InputKey, input: unknown | null): ArtifactSummary {
  const expected = INPUTS[key];
  const packetId = readStringAt(input, ["packetId"]);
  const schemaVersion = readStringAt(input, ["schemaVersion"]);
  return {
    artifact: expected.artifact,
    packetId: packetId === expected.packetId ? expected.packetId : null,
    schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
    status: input ? "available" : "missing",
  };
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

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readNumberAt(value: unknown | null, pathParts: readonly string[]): number | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "number" ? resolved : null;
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown | null, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readObjectArrayAt(value: unknown | null, pathParts: readonly string[]): Array<Record<string, unknown>> {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved)
    ? resolved.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
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

function safeBoundary(): R1132OrdinaryConsumerSubmissionReadinessOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1132: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1132: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1132OrdinaryConsumerSubmissionReadiness({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1127Path: process.env.MURPH_AGE_R1127_ORDINARY_CONSUMER_SUBMISSION_HANDOFF_PATH,
    r1130Path: process.env.MURPH_AGE_R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_PATH,
    r1131Path: process.env.MURPH_AGE_R1131_CONSUMER_REAL_EVIDENCE_COMPLETION_AUDIT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    averageSubmitterFamilyIds: output.summary.averageSubmitterFamilyIds,
    conclusion: output.summary.conclusion,
    missingSlotCount: output.summary.missingSlotCount,
    missingSlotTypes: output.summary.missingSlotTypes,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyForPrivateRunner: output.summary.readyForPrivateRunner,
    realAggregateStillMissing: output.summary.realAggregateStillMissing,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1132: output.summary.rowParsingPerformedByR1132,
    schemaVersion: output.schemaVersion,
    sourceFamilyMissingSlotRollup: output.ordinaryConsumerReadiness.sourceFamilies.map((family) => ({
      familyId: family.familyId,
      missingSlotCount: family.missingSlotCount,
      missingSlotIds: family.missingSlotIds,
      status: family.status,
    })),
    status: output.status,
    targetInputPriority: output.summary.targetInputPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1132 ordinary consumer submission readiness failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
