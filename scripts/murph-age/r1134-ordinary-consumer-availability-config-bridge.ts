import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1134_ORDINARY_CONSUMER_AVAILABILITY_CONFIG_BRIDGE_SCHEMA_VERSION =
  "murph-age-r1134-ordinary-consumer-availability-config-bridge.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1134-ordinary-consumer-availability-config-bridge.latest.json";
const R1134_BRIDGE_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1134-ordinary-consumer-availability-config-bridge.ts" as const;

const R1132_EXPECTED = {
  artifact: "r1132-ordinary-consumer-submission-readiness.latest.json",
  packetId: "r1132-ordinary-consumer-submission-readiness",
  schemaVersion: "murph-age-r1132-ordinary-consumer-submission-readiness.v1",
} as const;
const R1133_EXPECTED = {
  artifact: "r1133-ordinary-consumer-data-availability-preflight.latest.json",
  packetId: "r1133-ordinary-consumer-data-availability-preflight",
  schemaVersion: "murph-age-r1133-ordinary-consumer-data-availability-preflight.v1",
} as const;
const REQUIRED_SUBMISSION_CONTEXT_FIELDS = [
  "evidenceRole",
  "ordinaryConsumerSubmission",
  "outcomeLinked",
  "priorityInputFamilies",
  "targetAgeBand",
] as const;

type BridgeConclusion =
  | "ordinary_availability_config_bridge_blocked_missing_required_availability"
  | "ordinary_availability_config_bridge_ready_for_private_config_mapping"
  | "ordinary_availability_config_bridge_ready_for_private_runner"
  | "ordinary_availability_config_bridge_waiting_on_availability_manifest"
  | "ordinary_availability_config_bridge_waiting_on_refresh";
type BridgeNextAction =
  | "collect_missing_outcome_linked_labs_wearable_sources"
  | "fill_private_config_mapping_for_available_ordinary_sources"
  | "fill_safe_ordinary_data_availability_manifest"
  | "refresh_r1132_r1133_before_availability_config_bridge"
  | "run_r1125_private_runner_then_r1124_real_metric_intake";
type MappingPlanStatus =
  | "blocked_missing_required_availability"
  | "ready_for_private_config_mapping"
  | "ready_for_private_runner"
  | "waiting_on_availability_manifest"
  | "waiting_on_refresh";
type SourceFamilyMappingStatus =
  | "available_mapped_or_ready"
  | "available_needs_private_mapping"
  | "missing_or_not_declared"
  | "waiting_on_refresh";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SourceFamilyMapping {
  availabilityStatus: string | null;
  familyId: string;
  inputKind: string | null;
  mappingStatus: SourceFamilyMappingStatus;
  privateDetailsStored: false;
  requiredForCandidateIds: string[];
  requiredPrivateFieldRefFamilies: string[];
  requiredPrivateTableRefs: string[];
}

export interface R1134OrdinaryConsumerAvailabilityConfigBridgeOptions {
  createdAt?: string;
  outputDir?: string;
  r1132Path?: string;
  r1133Path?: string;
}

export interface R1134OrdinaryConsumerAvailabilityConfigBridgeOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1134: false;
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
    rowParsingPerformedByR1134: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  availabilityConfigBridge: {
    availableSourceFamilyIds: string[];
    blockers: string[];
    commands: {
      availabilityConfigBridgeCommand: typeof R1134_BRIDGE_COMMAND;
      availabilityPreflightCommand: string | null;
      configIntakeCommand: string | null;
      metricIntakeCommand: string | null;
      privateRunnerCommand: string | null;
    };
    mappingPlan: {
      acceptedTableLayouts: string[];
      candidateRunOrderIds: string[];
      privateDetailsStored: false;
      selectedTableLayout: string | null;
      sourceFamilyMappings: SourceFamilyMapping[];
      status: MappingPlanStatus;
      submissionContextChecklist: Array<{
        fieldId: typeof REQUIRED_SUBMISSION_CONTEXT_FIELDS[number];
        requiredStatus: "complete_in_private_config";
      }>;
    };
    missingSourceFamilyIds: string[];
    privateValuesStored: false;
    readyForPrivateConfigMapping: boolean;
    readyForPrivateRunner: boolean;
    realAggregateStillMissing: boolean;
  };
  createdAt: string;
  inputArtifacts: {
    r1132: ArtifactSummary;
    r1133: ArtifactSummary;
  };
  packetId: "r1134-ordinary-consumer-availability-config-bridge";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1134_ORDINARY_CONSUMER_AVAILABILITY_CONFIG_BRIDGE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: BridgeConclusion;
    mappingPlanStatus: MappingPlanStatus;
    missingSourceFamilyIds: string[];
    nextAction: BridgeNextAction;
    productDisplayAuthorized: false;
    readyForPrivateConfigMapping: boolean;
    readyForPrivateRunner: boolean;
    realAggregateStillMissing: boolean;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1134: false;
    selectedTableLayout: string | null;
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1134OrdinaryConsumerAvailabilityConfigBridge(
  options: R1134OrdinaryConsumerAvailabilityConfigBridgeOptions = {},
): Promise<{ output: R1134OrdinaryConsumerAvailabilityConfigBridgeOutput; outputPath: string }> {
  const r1132 = await readJsonIfPresent(options.r1132Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1132_EXPECTED.artifact));
  const r1133 = await readJsonIfPresent(options.r1133Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1133_EXPECTED.artifact));
  validateInputBoundary("r1132", r1132);
  validateInputBoundary("r1133", r1133);

  const r1132Ready = matchesExpected(r1132, R1132_EXPECTED);
  const r1133Ready = matchesExpected(r1133, R1133_EXPECTED);
  const readyForPrivateConfigMapping = r1132Ready
    && r1133Ready
    && readBooleanAt(r1133, ["summary", "readyForPrivateConfigMapping"]) === true;
  const readyForPrivateRunner = readyForPrivateConfigMapping
    && readBooleanAt(r1133, ["summary", "readyForPrivateRunner"]) === true;
  const missingSourceFamilyIds = r1133Ready
    ? readStringArrayAt(r1133, ["summary", "missingSourceFamilyIds"])
    : [];
  const selectedTableLayout = r1133Ready
    ? readStringAt(r1133, ["ordinaryDataAvailabilityPreflight", "selectedTableLayout"])
    : null;
  const availableSourceFamilyIds = sourceFamilyMappingsFor({ r1132, r1133, readyForPrivateConfigMapping, readyForPrivateRunner })
    .filter((family) => family.mappingStatus === "available_needs_private_mapping" || family.mappingStatus === "available_mapped_or_ready")
    .map((family) => family.familyId);
  const mappingPlanStatus = mappingPlanStatusFor({ r1132Ready, r1133, r1133Ready, readyForPrivateConfigMapping, readyForPrivateRunner });
  const conclusion = conclusionFor(mappingPlanStatus);
  const nextAction = nextActionFor(conclusion);
  const output: R1134OrdinaryConsumerAvailabilityConfigBridgeOutput = {
    artifactBoundary: safeBoundary(),
    availabilityConfigBridge: {
      availableSourceFamilyIds,
      blockers: blockersFor({ mappingPlanStatus, r1132Ready, r1133, r1133Ready }),
      commands: {
        availabilityConfigBridgeCommand: R1134_BRIDGE_COMMAND,
        availabilityPreflightCommand: readStringAt(r1133, [
          "ordinaryDataAvailabilityPreflight",
          "commands",
          "availabilityPreflightCommand",
        ]),
        configIntakeCommand: readStringAt(r1132, [
          "ordinaryConsumerReadiness",
          "commands",
          "configIntakeCommand",
        ]) ?? readStringAt(r1133, [
          "ordinaryDataAvailabilityPreflight",
          "commands",
          "configIntakeCommand",
        ]),
        metricIntakeCommand: readStringAt(r1132, [
          "ordinaryConsumerReadiness",
          "commands",
          "metricIntakeCommand",
        ]) ?? readStringAt(r1133, [
          "ordinaryDataAvailabilityPreflight",
          "commands",
          "metricIntakeCommand",
        ]),
        privateRunnerCommand: readStringAt(r1132, [
          "ordinaryConsumerReadiness",
          "commands",
          "privateRunnerCommand",
        ]) ?? readStringAt(r1133, [
          "ordinaryDataAvailabilityPreflight",
          "commands",
          "privateRunnerCommand",
        ]),
      },
      mappingPlan: {
        acceptedTableLayouts: readStringArrayAt(r1133, ["ordinaryDataAvailabilityPreflight", "acceptedTableLayouts"]),
        candidateRunOrderIds: readStringArrayAt(r1132, [
          "ordinaryConsumerReadiness",
          "minimalSubmissionBundle",
          "firstPassCandidateIds",
        ]),
        privateDetailsStored: false,
        selectedTableLayout,
        sourceFamilyMappings: sourceFamilyMappingsFor({
          r1132,
          r1133,
          readyForPrivateConfigMapping,
          readyForPrivateRunner,
        }),
        status: mappingPlanStatus,
        submissionContextChecklist: REQUIRED_SUBMISSION_CONTEXT_FIELDS.map((fieldId) => ({
          fieldId,
          requiredStatus: "complete_in_private_config",
        })),
      },
      missingSourceFamilyIds,
      privateValuesStored: false,
      readyForPrivateConfigMapping,
      readyForPrivateRunner,
      realAggregateStillMissing: !readyForPrivateRunner,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1132: summarizeInput(R1132_EXPECTED, r1132),
      r1133: summarizeInput(R1133_EXPECTED, r1133),
    },
    packetId: "r1134-ordinary-consumer-availability-config-bridge",
    productDisplayAuthorized: false,
    schemaVersion: R1134_ORDINARY_CONSUMER_AVAILABILITY_CONFIG_BRIDGE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      mappingPlanStatus,
      missingSourceFamilyIds,
      nextAction,
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping,
      readyForPrivateRunner,
      realAggregateStillMissing: !readyForPrivateRunner,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1134: false,
      selectedTableLayout,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1134 ordinary consumer availability config bridge failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function validateInputBoundary(name: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1134 ${name} failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }
}

function mappingPlanStatusFor(input: {
  r1132Ready: boolean;
  r1133: unknown | null;
  r1133Ready: boolean;
  readyForPrivateConfigMapping: boolean;
  readyForPrivateRunner: boolean;
}): MappingPlanStatus {
  if (!input.r1132Ready || !input.r1133Ready) return "waiting_on_refresh";
  if (input.readyForPrivateRunner) return "ready_for_private_runner";
  if (input.readyForPrivateConfigMapping) return "ready_for_private_config_mapping";
  const manifestStatus = readStringAt(input.r1133, ["summary", "manifestStatus"]);
  if (manifestStatus !== "provided") return "waiting_on_availability_manifest";
  return "blocked_missing_required_availability";
}

function conclusionFor(mappingPlanStatus: MappingPlanStatus): BridgeConclusion {
  if (mappingPlanStatus === "waiting_on_refresh") return "ordinary_availability_config_bridge_waiting_on_refresh";
  if (mappingPlanStatus === "waiting_on_availability_manifest") {
    return "ordinary_availability_config_bridge_waiting_on_availability_manifest";
  }
  if (mappingPlanStatus === "blocked_missing_required_availability") {
    return "ordinary_availability_config_bridge_blocked_missing_required_availability";
  }
  if (mappingPlanStatus === "ready_for_private_runner") {
    return "ordinary_availability_config_bridge_ready_for_private_runner";
  }
  return "ordinary_availability_config_bridge_ready_for_private_config_mapping";
}

function nextActionFor(conclusion: BridgeConclusion): BridgeNextAction {
  if (conclusion === "ordinary_availability_config_bridge_waiting_on_refresh") {
    return "refresh_r1132_r1133_before_availability_config_bridge";
  }
  if (conclusion === "ordinary_availability_config_bridge_waiting_on_availability_manifest") {
    return "fill_safe_ordinary_data_availability_manifest";
  }
  if (conclusion === "ordinary_availability_config_bridge_blocked_missing_required_availability") {
    return "collect_missing_outcome_linked_labs_wearable_sources";
  }
  if (conclusion === "ordinary_availability_config_bridge_ready_for_private_runner") {
    return "run_r1125_private_runner_then_r1124_real_metric_intake";
  }
  return "fill_private_config_mapping_for_available_ordinary_sources";
}

function blockersFor(input: {
  mappingPlanStatus: MappingPlanStatus;
  r1132Ready: boolean;
  r1133: unknown | null;
  r1133Ready: boolean;
}): string[] {
  const blockers = new Set<string>();
  if (!input.r1132Ready) blockers.add("r1132_submitter_readiness_missing_or_stale");
  if (!input.r1133Ready) blockers.add("r1133_availability_preflight_missing_or_stale");
  for (const blocker of readStringArrayAt(input.r1133, ["ordinaryDataAvailabilityPreflight", "blockers"])) {
    blockers.add(blocker);
  }
  if (input.mappingPlanStatus === "ready_for_private_config_mapping") {
    blockers.add("private_config_not_ready_for_r1125");
  }
  return [...blockers];
}

function sourceFamilyMappingsFor(input: {
  r1132: unknown | null;
  r1133: unknown | null;
  readyForPrivateConfigMapping: boolean;
  readyForPrivateRunner: boolean;
}): SourceFamilyMapping[] {
  const readinessFamilies = readObjectArrayAt(input.r1132, ["ordinaryConsumerReadiness", "sourceFamilies"]);
  const availabilityFamilies = readObjectArrayAt(input.r1133, [
    "ordinaryDataAvailabilityPreflight",
    "sourceFamilies",
  ]);
  return readinessFamilies.map((readinessFamily) => {
    const familyId = readStringAt(readinessFamily, ["familyId"]) ?? "unknown_source_family";
    const availabilityFamily = availabilityFamilies.find((family) => readStringAt(family, ["familyId"]) === familyId);
    const availabilityStatus = readStringAt(availabilityFamily, ["status"]);
    return {
      availabilityStatus,
      familyId,
      inputKind: readStringAt(readinessFamily, ["inputKind"]) ?? readStringAt(availabilityFamily, ["inputKind"]),
      mappingStatus: mappingStatusFor({
        availabilityStatus,
        readyForPrivateConfigMapping: input.readyForPrivateConfigMapping,
        readyForPrivateRunner: input.readyForPrivateRunner,
      }),
      privateDetailsStored: false,
      requiredForCandidateIds: readStringArrayAt(readinessFamily, ["requiredForCandidateIds"]),
      requiredPrivateFieldRefFamilies: readStringArrayAt(readinessFamily, ["requiredPrivateFieldRefFamilies"]),
      requiredPrivateTableRefs: readStringArrayAt(readinessFamily, ["requiredPrivateTableRefs"]),
    };
  });
}

function mappingStatusFor(input: {
  availabilityStatus: string | null;
  readyForPrivateConfigMapping: boolean;
  readyForPrivateRunner: boolean;
}): SourceFamilyMappingStatus {
  if (input.readyForPrivateRunner) return "available_mapped_or_ready";
  if (input.readyForPrivateConfigMapping) return "available_needs_private_mapping";
  if (input.availabilityStatus === "declared_available") return "available_needs_private_mapping";
  if (input.availabilityStatus === null) return "waiting_on_refresh";
  return "missing_or_not_declared";
}

function summarizeInput(expected: typeof R1132_EXPECTED | typeof R1133_EXPECTED, input: unknown | null): ArtifactSummary {
  const packetId = readStringAt(input, ["packetId"]);
  const schemaVersion = readStringAt(input, ["schemaVersion"]);
  return {
    artifact: expected.artifact,
    packetId: packetId === expected.packetId ? expected.packetId : null,
    schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
    status: input ? "available" : "missing",
  };
}

function matchesExpected(
  input: unknown | null,
  expected: typeof R1132_EXPECTED | typeof R1133_EXPECTED,
): boolean {
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
}

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
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

function safeBoundary(): R1134OrdinaryConsumerAvailabilityConfigBridgeOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1134: false,
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
    rowParsingPerformedByR1134: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1134OrdinaryConsumerAvailabilityConfigBridge({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1132Path: process.env.MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH,
    r1133Path: process.env.MURPH_AGE_R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    availableSourceFamilyIds: output.availabilityConfigBridge.availableSourceFamilyIds,
    conclusion: output.summary.conclusion,
    mappingPlanStatus: output.summary.mappingPlanStatus,
    missingSourceFamilyIds: output.summary.missingSourceFamilyIds,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyForPrivateConfigMapping: output.summary.readyForPrivateConfigMapping,
    readyForPrivateRunner: output.summary.readyForPrivateRunner,
    realAggregateStillMissing: output.summary.realAggregateStillMissing,
    rowParsingPerformedByR1134: output.summary.rowParsingPerformedByR1134,
    schemaVersion: output.schemaVersion,
    selectedTableLayout: output.summary.selectedTableLayout,
    sourceFamilyMappings: output.availabilityConfigBridge.mappingPlan.sourceFamilyMappings.map((family) => ({
      familyId: family.familyId,
      mappingStatus: family.mappingStatus,
    })),
    status: output.status,
  }, null, 2)}\n`);
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1134 ordinary consumer availability config bridge failed.")}\n`);
    process.exitCode = 1;
  });
}
