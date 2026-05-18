import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
  R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION,
} from "./r1163-feature-only-safe-confirmation-to-research-runner.ts";

export const R1164_ORDINARY_CONSUMER_FEATURE_ONLY_RESEARCH_HANDOFF_SCHEMA_VERSION =
  "murph-age-r1164-ordinary-consumer-feature-only-research-handoff.v1" as const;
export const R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND =
  "MURPH_AGE_R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_PATH=<r1163-runner.json> pnpm exec tsx scripts/murph-age/r1164-ordinary-consumer-feature-only-research-handoff.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1164-ordinary-consumer-feature-only-research-handoff.latest.json";
const R1163_ARTIFACT =
  "r1163-feature-only-safe-confirmation-to-research-runner.latest.json" as const;
const R1163_PACKET_ID = "r1163-feature-only-safe-confirmation-to-research-runner" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const FEATURE_ONLY_RESEARCH_ROLE =
  "feature_only_coverage_context_not_model_evidence" as const;
const MINIMUM_FEATURE_PAIR_REQUIRED = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const REQUIRED_ASSERTION_ITEM_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_assertion_contains_no_private_values",
] as const;
const BLOCKED_PRIVATE_CONTENT = [
  "private_paths",
  "header_names",
  "private_ref_values",
  "source_variable_names",
  "file_names",
  "row_values",
  "participant_identifiers",
  "predictions",
  "coefficients",
  "source_text",
] as const;

type FeatureOnlyFamilyId = typeof MINIMUM_FEATURE_PAIR_REQUIRED[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type RequiredInputKindId = typeof REQUIRED_INPUT_KIND_IDS[number];
type RequiredAssertionItemId = typeof REQUIRED_ASSERTION_ITEM_IDS[number];
type BlockedPrivateContent = typeof BLOCKED_PRIVATE_CONTENT[number];
type HandoffConclusion =
  | "ordinary_feature_only_research_handoff_invalid_r1163_state"
  | "ordinary_feature_only_research_handoff_ready_research_only"
  | "ordinary_feature_only_research_handoff_waiting_on_feature_only_chain"
  | "ordinary_feature_only_research_handoff_waiting_on_r1163"
  | "ordinary_feature_only_research_handoff_waiting_on_row_owner_assertion";
type HandoffNextAction =
  | "complete_r1163_feature_only_availability_assertion_contract"
  | "refresh_r1163_feature_only_safe_confirmation_to_research_runner"
  | "rerun_r1163_feature_only_safe_confirmation_to_research_runner"
  | "use_feature_only_coverage_context_for_research_planning_only";

interface ArtifactSummary {
  artifact: typeof R1163_ARTIFACT;
  packetId: typeof R1163_PACKET_ID | null;
  schemaVersion: typeof R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION | null;
  status: "available" | "missing";
}

interface PrioritizedSubmitterInputKind {
  inputKindId: RequiredInputKindId;
  mapsToFeatureFamilyIds: Array<FeatureOnlyFamilyId | OptionalAddOnFamilyId>;
  privateDetailsStored: false;
  requiredForFeatureOnlyPlanning: true;
  safeSubmitterDescription: string;
}

interface R1163State {
  explicitRowOwnerConfirmationAssertionProvided: boolean | null;
  featureOnlyChainRan: boolean | null;
  featureOnlyResearchPlanningReady: boolean | null;
  requiredAssertionContractReady: boolean | null;
  requiredAssertionItemIdsPresent: boolean | null;
  requiredInputKindIdsPresent: boolean | null;
  rowOwnerAssertionStillRequired: boolean | null;
  safeConfirmationArtifactWritten: boolean | null;
  schemaCurrent: boolean;
  targetAgeBandMatches: boolean | null;
  targetInputPriorityMatches: boolean | null;
}

export interface R1164OrdinaryConsumerFeatureOnlyResearchHandoffOptions {
  createdAt?: string;
  outputDir?: string;
  r1163Path?: string;
}

export interface R1164OrdinaryConsumerFeatureOnlyResearchHandoffOutput {
  artifactBoundary: {
    aggregateOnly: true;
    childOutputPathsStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    featureValuesStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelEvidencePromotedByR1164: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateDetailsStored: false;
    privateFieldRefValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefValuesStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    r1163InputPathStored: false;
    rowLevelDataAcceptedByR1164: false;
    rowParsingPerformedByR1164: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  featureOnlyResearchHandoff: {
    blockedPrivateContent: BlockedPrivateContent[];
    commands: {
      assertionToResearchRunnerCommand: typeof R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND;
      featureOnlyResearchHandoffCommand: typeof R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND;
    };
    evidenceUse: "research_planning_only_not_model_evidence";
    featureOnlyResearchPlanningReady: boolean;
    minimumFeaturePairRequired: FeatureOnlyFamilyId[];
    modelEvidencePromotionAllowed: false;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    outcomeLinkedModelEvidenceStillRequired: true;
    prioritizedSubmitterInputKinds: PrioritizedSubmitterInputKind[];
    privateDetailsStored: false;
    requiredAssertionItemIds: RequiredAssertionItemId[];
    requiredInputKindIds: RequiredInputKindId[];
    researchPlanningAllowed: boolean;
    researchRole: typeof FEATURE_ONLY_RESEARCH_ROLE;
    rowLevelDataAcceptedByR1164: false;
    rowOwnerPrivateValuesStored: false;
    sourceFamilyPriority: Array<{
      familyId: FeatureOnlyFamilyId | OptionalAddOnFamilyId;
      priority: number;
      role: string;
    }>;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  inputArtifacts: {
    r1163: ArtifactSummary;
  };
  packetId: "r1164-ordinary-consumer-feature-only-research-handoff";
  productDisplayAuthorized: false;
  r1163State: R1163State;
  schemaVersion: typeof R1164_ORDINARY_CONSUMER_FEATURE_ONLY_RESEARCH_HANDOFF_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: HandoffConclusion;
    explicitRowOwnerConfirmationAssertionProvided: boolean | null;
    featureOnlyChainRan: boolean | null;
    featureOnlyResearchPlanningReady: boolean;
    minimumFeaturePairRequired: FeatureOnlyFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: HandoffNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    outcomeLinkedModelEvidenceStillRequired: true;
    prioritizedInputKindIds: RequiredInputKindId[];
    productDisplayAuthorized: false;
    r1163Available: boolean;
    r1163SchemaCurrent: boolean;
    researchPlanningAllowed: boolean;
    researchRole: typeof FEATURE_ONLY_RESEARCH_ROLE;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1164: false;
    rowOwnerAssertionStillRequired: boolean | null;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1164: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1164OrdinaryConsumerFeatureOnlyResearchHandoff(
  options: R1164OrdinaryConsumerFeatureOnlyResearchHandoffOptions = {},
): Promise<{ output: R1164OrdinaryConsumerFeatureOnlyResearchHandoffOutput; outputPath: string }> {
  const r1163 = await readJsonIfPresent(options.r1163Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1163_ARTIFACT));
  validateInputBoundary("r1163", r1163);
  const r1163State = stateFromR1163(r1163);
  const featureOnlyResearchPlanningReady =
    r1163State.featureOnlyResearchPlanningReady === true
    && r1163State.featureOnlyChainRan === true
    && r1163State.rowOwnerAssertionStillRequired === false
    && r1163State.requiredInputKindIdsPresent === true
    && r1163State.requiredAssertionItemIdsPresent === true
    && r1163State.targetAgeBandMatches === true
    && r1163State.targetInputPriorityMatches === true;
  const researchPlanningAllowed = featureOnlyResearchPlanningReady;
  const conclusion = conclusionFor({ featureOnlyResearchPlanningReady, r1163, r1163State });
  const output: R1164OrdinaryConsumerFeatureOnlyResearchHandoffOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    featureOnlyResearchHandoff: {
      blockedPrivateContent: [...BLOCKED_PRIVATE_CONTENT],
      commands: {
        assertionToResearchRunnerCommand: R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
        featureOnlyResearchHandoffCommand: R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND,
      },
      evidenceUse: "research_planning_only_not_model_evidence",
      featureOnlyResearchPlanningReady,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_REQUIRED],
      modelEvidencePromotionAllowed: false,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      outcomeLinkedModelEvidenceStillRequired: true,
      prioritizedSubmitterInputKinds: prioritizedSubmitterInputKinds(),
      privateDetailsStored: false,
      requiredAssertionItemIds: [...REQUIRED_ASSERTION_ITEM_IDS],
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      researchPlanningAllowed,
      researchRole: FEATURE_ONLY_RESEARCH_ROLE,
      rowLevelDataAcceptedByR1164: false,
      rowOwnerPrivateValuesStored: false,
      sourceFamilyPriority: sourceFamilyPriority(),
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    inputArtifacts: {
      r1163: summarizeR1163(r1163),
    },
    packetId: "r1164-ordinary-consumer-feature-only-research-handoff",
    productDisplayAuthorized: false,
    r1163State,
    schemaVersion: R1164_ORDINARY_CONSUMER_FEATURE_ONLY_RESEARCH_HANDOFF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      explicitRowOwnerConfirmationAssertionProvided:
        r1163State.explicitRowOwnerConfirmationAssertionProvided,
      featureOnlyChainRan: r1163State.featureOnlyChainRan,
      featureOnlyResearchPlanningReady,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_REQUIRED],
      modelEvidencePromotionAllowed: false,
      nextAction: nextActionFor(conclusion),
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      outcomeLinkedModelEvidenceStillRequired: true,
      prioritizedInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      productDisplayAuthorized: false,
      r1163Available: r1163 !== null,
      r1163SchemaCurrent: r1163State.schemaCurrent,
      researchPlanningAllowed,
      researchRole: FEATURE_ONLY_RESEARCH_ROLE,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1164: false,
      rowOwnerAssertionStillRequired: r1163State.rowOwnerAssertionStillRequired,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1164: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1164 feature-only research handoff failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function stateFromR1163(value: unknown | null): R1163State {
  const schemaCurrent = matchesR1163(value);
  const requiredInputKindIds = readStringArrayAt(value, ["summary", "requiredInputKindIds"]);
  const requiredAssertionItemIds = readStringArrayAt(value, ["summary", "rowOwnerAssertionContractItemIds"]);
  return {
    explicitRowOwnerConfirmationAssertionProvided: schemaCurrent
      ? readBooleanAt(value, ["summary", "explicitRowOwnerConfirmationAssertionProvided"])
      : null,
    featureOnlyChainRan: schemaCurrent ? readBooleanAt(value, ["summary", "featureOnlyChainRan"]) : null,
    featureOnlyResearchPlanningReady: schemaCurrent
      ? readBooleanAt(value, ["summary", "featureOnlyResearchPlanningReady"])
      : null,
    requiredAssertionContractReady: schemaCurrent
      ? readBooleanAt(value, ["summary", "rowOwnerAssertionContractReady"])
      : null,
    requiredAssertionItemIdsPresent: schemaCurrent
      ? includesEvery(requiredAssertionItemIds, REQUIRED_ASSERTION_ITEM_IDS)
      : null,
    requiredInputKindIdsPresent: schemaCurrent
      ? includesEvery(requiredInputKindIds, REQUIRED_INPUT_KIND_IDS)
      : null,
    rowOwnerAssertionStillRequired: schemaCurrent
      ? readBooleanAt(value, ["summary", "rowOwnerAssertionStillRequired"])
      : null,
    safeConfirmationArtifactWritten: schemaCurrent
      ? readBooleanAt(value, ["summary", "safeConfirmationArtifactWritten"])
      : null,
    schemaCurrent,
    targetAgeBandMatches: schemaCurrent
      ? readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
      : null,
    targetInputPriorityMatches: schemaCurrent
      ? readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
      : null,
  };
}

function conclusionFor(input: {
  featureOnlyResearchPlanningReady: boolean;
  r1163: unknown | null;
  r1163State: R1163State;
}): HandoffConclusion {
  if (input.r1163 === null) return "ordinary_feature_only_research_handoff_waiting_on_r1163";
  if (!input.r1163State.schemaCurrent) return "ordinary_feature_only_research_handoff_invalid_r1163_state";
  if (input.featureOnlyResearchPlanningReady) return "ordinary_feature_only_research_handoff_ready_research_only";
  if (input.r1163State.rowOwnerAssertionStillRequired === true) {
    return "ordinary_feature_only_research_handoff_waiting_on_row_owner_assertion";
  }
  if (
    input.r1163State.requiredAssertionContractReady !== true
    || input.r1163State.requiredInputKindIdsPresent !== true
    || input.r1163State.requiredAssertionItemIdsPresent !== true
    || input.r1163State.targetAgeBandMatches !== true
    || input.r1163State.targetInputPriorityMatches !== true
  ) {
    return "ordinary_feature_only_research_handoff_invalid_r1163_state";
  }
  return "ordinary_feature_only_research_handoff_waiting_on_feature_only_chain";
}

function nextActionFor(conclusion: HandoffConclusion): HandoffNextAction {
  if (conclusion === "ordinary_feature_only_research_handoff_ready_research_only") {
    return "use_feature_only_coverage_context_for_research_planning_only";
  }
  if (conclusion === "ordinary_feature_only_research_handoff_waiting_on_row_owner_assertion") {
    return "complete_r1163_feature_only_availability_assertion_contract";
  }
  if (conclusion === "ordinary_feature_only_research_handoff_waiting_on_feature_only_chain") {
    return "rerun_r1163_feature_only_safe_confirmation_to_research_runner";
  }
  return "refresh_r1163_feature_only_safe_confirmation_to_research_runner";
}

function prioritizedSubmitterInputKinds(): PrioritizedSubmitterInputKind[] {
  return [
    {
      inputKindId: "lab_portal_export_or_spreadsheet",
      mapsToFeatureFamilyIds: ["bloodwork_glycemia", "common_bloodwork_core"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPlanning: true,
      safeSubmitterDescription:
        "A normal lab portal export or spreadsheet can establish glycemia/bloodwork coverage for planning without sharing private labels, headers, paths, or row values.",
    },
    {
      inputKindId: "phone_watch_or_wearable_activity_export",
      mapsToFeatureFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPlanning: true,
      safeSubmitterDescription:
        "A phone, watch, or wearable activity export can establish daily activity coverage for planning without sharing private labels, headers, paths, or row values.",
    },
  ];
}

function sourceFamilyPriority(): R1164OrdinaryConsumerFeatureOnlyResearchHandoffOutput["featureOnlyResearchHandoff"]["sourceFamilyPriority"] {
  return [
    {
      familyId: "bloodwork_glycemia",
      priority: 1,
      role: "required_feature_only_lab_signal",
    },
    {
      familyId: "wearable_activity_daily",
      priority: 2,
      role: "required_feature_only_wearable_signal",
    },
    {
      familyId: "common_bloodwork_core",
      priority: 3,
      role: "optional_lab_context",
    },
    {
      familyId: "vitals_body_context",
      priority: 4,
      role: "optional_body_context",
    },
  ];
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function summarizeR1163(value: unknown | null): ArtifactSummary {
  if (!matchesR1163(value)) {
    return {
      artifact: R1163_ARTIFACT,
      packetId: null,
      schemaVersion: null,
      status: value === null ? "missing" : "available",
    };
  }
  return {
    artifact: R1163_ARTIFACT,
    packetId: R1163_PACKET_ID,
    schemaVersion: R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION,
    status: "available",
  };
}

function matchesR1163(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1163_PACKET_ID
    && readStringAt(value, ["schemaVersion"]) === R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION;
}

function validateInputBoundary(name: string, value: unknown | null): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1164 input ${name} failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function includesEvery(values: readonly string[], requiredValues: readonly string[]): boolean {
  const valueSet = new Set(values);
  return requiredValues.every((value) => valueSet.has(value));
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeBoundary(): R1164OrdinaryConsumerFeatureOnlyResearchHandoffOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    childOutputPathsStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    featureValuesStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1164: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateDetailsStored: false,
    privateFieldRefValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefValuesStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    r1163InputPathStored: false,
    rowLevelDataAcceptedByR1164: false,
    rowParsingPerformedByR1164: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function cliSummary(output: R1164OrdinaryConsumerFeatureOnlyResearchHandoffOutput): Record<string, unknown> {
  return {
    conclusion: output.summary.conclusion,
    explicitRowOwnerConfirmationAssertionProvided:
      output.summary.explicitRowOwnerConfirmationAssertionProvided,
    featureOnlyChainRan: output.summary.featureOnlyChainRan,
    featureOnlyResearchPlanningReady: output.summary.featureOnlyResearchPlanningReady,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    outcomeLinkedModelEvidenceStillRequired: output.summary.outcomeLinkedModelEvidenceStillRequired,
    packetId: output.packetId,
    prioritizedInputKindIds: output.summary.prioritizedInputKindIds,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    r1163Available: output.summary.r1163Available,
    r1163SchemaCurrent: output.summary.r1163SchemaCurrent,
    researchPlanningAllowed: output.summary.researchPlanningAllowed,
    researchRole: output.summary.researchRole,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1164: output.summary.rowLevelDataAcceptedByR1164,
    rowOwnerAssertionStillRequired: output.summary.rowOwnerAssertionStillRequired,
    rowOwnerPrivateValuesStored: output.summary.rowOwnerPrivateValuesStored,
    rowParsingPerformedByR1164: output.summary.rowParsingPerformedByR1164,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1164OrdinaryConsumerFeatureOnlyResearchHandoff({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1163Path: process.env.MURPH_AGE_R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_PATH,
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1164 feature-only research handoff failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
