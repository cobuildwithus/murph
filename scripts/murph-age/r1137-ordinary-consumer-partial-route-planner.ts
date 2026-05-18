import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1137_ORDINARY_CONSUMER_PARTIAL_ROUTE_PLANNER_SCHEMA_VERSION =
  "murph-age-r1137-ordinary-consumer-partial-route-planner.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1137-ordinary-consumer-partial-route-planner.latest.json";
const R1137_PARTIAL_ROUTE_PLANNER_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1137-ordinary-consumer-partial-route-planner.ts" as const;
const R1133_EXPECTED = {
  artifact: "r1133-ordinary-consumer-data-availability-preflight.latest.json",
  packetId: "r1133-ordinary-consumer-data-availability-preflight",
  schemaVersion: "murph-age-r1133-ordinary-consumer-data-availability-preflight.v1",
} as const;
const R1136_EXPECTED = {
  artifact: "r1136-ordinary-consumer-availability-chain-runner.latest.json",
  packetId: "r1136-ordinary-consumer-availability-chain-runner",
  schemaVersion: "murph-age-r1136-ordinary-consumer-availability-chain-runner.v1",
} as const;

const PRIMARY_SUBMITTER_INPUT_FAMILY_IDS = [
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "wearable_activity_daily",
  "vitals_body_context",
] as const;
const REQUIRED_LINKAGE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
] as const;
const ROUTE_DEFINITIONS = [
  {
    currentRunnerSupportStatus: "partial_route_runner_extension_required",
    firstPassCandidateIds: ["L1_tiny_glycemia_only"],
    requiredSourceFamilyIds: ["outcome_linkage", "join_time_alignment", "bloodwork_glycemia"],
    routeId: "lab_glycemia_minimum_route",
    routeKind: "partial_lab_route",
  },
  {
    currentRunnerSupportStatus: "partial_route_runner_extension_required",
    firstPassCandidateIds: ["L2_common_lab_core_shadow"],
    requiredSourceFamilyIds: [
      "outcome_linkage",
      "join_time_alignment",
      "bloodwork_glycemia",
      "common_bloodwork_core",
      "vitals_body_context",
    ],
    routeId: "common_lab_core_with_context_route",
    routeKind: "partial_lab_route",
  },
  {
    currentRunnerSupportStatus: "partial_route_runner_extension_required",
    firstPassCandidateIds: ["W1_activity_steps_minutes"],
    requiredSourceFamilyIds: ["outcome_linkage", "join_time_alignment", "wearable_activity_daily"],
    routeId: "wearable_activity_minimum_route",
    routeKind: "partial_wearable_route",
  },
  {
    currentRunnerSupportStatus: "supported_by_current_first_pass_runner",
    firstPassCandidateIds: [
      "L1_tiny_glycemia_only",
      "L2_common_lab_core_shadow",
      "W1_activity_steps_minutes",
      "QC_missingness_coverage",
    ],
    requiredSourceFamilyIds: [
      "outcome_linkage",
      "join_time_alignment",
      "bloodwork_glycemia",
      "common_bloodwork_core",
      "vitals_body_context",
      "wearable_activity_daily",
    ],
    routeId: "full_labs_wearable_first_pass_route",
    routeKind: "full_supported_route",
  },
] as const;

type PlannerConclusion =
  | "ordinary_partial_route_planner_blocked_missing_linkage"
  | "ordinary_partial_route_planner_collect_wearable_or_lab_sources"
  | "ordinary_partial_route_planner_full_route_ready_for_private_config_mapping"
  | "ordinary_partial_route_planner_partial_routes_available_runner_extension_needed"
  | "ordinary_partial_route_planner_waiting_on_safe_manifest"
  | "ordinary_partial_route_planner_waiting_on_refresh";
type PlannerNextAction =
  | "collect_outcome_and_join_linkage_then_rerun_r1136_r1137"
  | "collect_wearable_or_lab_sources_then_rerun_r1136_r1137"
  | "extend_r1125_r1124_for_partial_lab_wearable_routes_or_collect_missing_full_route"
  | "fill_private_config_mapping_for_full_labs_wearable_route"
  | "fill_safe_availability_manifest_then_run_r1136_r1137_chain"
  | "refresh_r1133_r1136_before_partial_route_planning";
type RouteAvailabilityStatus =
  | "available_but_runner_extension_required"
  | "blocked_missing_inputs"
  | "blocked_missing_linkage"
  | "blocked_waiting_on_manifest"
  | "ready_for_current_runner";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface PartialRouteStatus {
  availableSourceFamilyIds: string[];
  currentRunnerSupportStatus: string;
  firstPassCandidateIds: string[];
  missingSourceFamilyIds: string[];
  productDisplayAuthorized: false;
  requiredSourceFamilyIds: string[];
  routeAvailabilityStatus: RouteAvailabilityStatus;
  routeId: string;
  routeKind: string;
  reviewGptRequiredNow: false;
}

export interface R1137OrdinaryConsumerPartialRoutePlannerOptions {
  createdAt?: string;
  outputDir?: string;
  r1133Path?: string;
  r1136Path?: string;
}

export interface R1137OrdinaryConsumerPartialRoutePlannerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1137: false;
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
    rowParsingPerformedByR1137: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1133: ArtifactSummary;
    r1136: ArtifactSummary;
  };
  packetId: "r1137-ordinary-consumer-partial-route-planner";
  partialRoutePlanner: {
    availableSourceFamilyIds: string[];
    blockers: string[];
    commands: {
      availabilityChainRunnerCommand: string | null;
      availabilityPreflightCommand: string | null;
      partialRoutePlannerCommand: typeof R1137_PARTIAL_ROUTE_PLANNER_COMMAND;
    };
    currentEvidenceGate: "full_l1_l2_w1_qc_required_for_real_evidence_gate";
    fullSupportedRouteReady: boolean;
    manifestStatus: string | null;
    partialRouteIdsReadyButUnsupported: string[];
    primarySubmitterInputFamilyIds: typeof PRIMARY_SUBMITTER_INPUT_FAMILY_IDS[number][];
    privateDetailsStored: false;
    requiredLinkageFamilyIds: typeof REQUIRED_LINKAGE_FAMILY_IDS[number][];
    routeStatuses: PartialRouteStatus[];
  };
  productDisplayAuthorized: false;
  schemaVersion: typeof R1137_ORDINARY_CONSUMER_PARTIAL_ROUTE_PLANNER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    availableSourceFamilyIds: string[];
    conclusion: PlannerConclusion;
    fullSupportedRouteReady: boolean;
    nextAction: PlannerNextAction;
    partialRouteIdsReadyButUnsupported: string[];
    primarySubmitterInputFamilyIds: typeof PRIMARY_SUBMITTER_INPUT_FAMILY_IDS[number][];
    productDisplayAuthorized: false;
    readyForPrivateConfigMapping: boolean;
    realAggregateStillMissing: true;
    requiredLinkageFamilyIds: typeof REQUIRED_LINKAGE_FAMILY_IDS[number][];
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1137: false;
    targetAgeBand: "roughly_16_50";
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1137OrdinaryConsumerPartialRoutePlanner(
  options: R1137OrdinaryConsumerPartialRoutePlannerOptions = {},
): Promise<{ output: R1137OrdinaryConsumerPartialRoutePlannerOutput; outputPath: string }> {
  const r1133 = await readJsonIfPresent(options.r1133Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1133_EXPECTED.artifact));
  const r1136 = await readJsonIfPresent(options.r1136Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1136_EXPECTED.artifact));
  validateInputBoundary("r1133", r1133);
  validateInputBoundary("r1136", r1136);

  const r1133Expected = matchesExpected(r1133, R1133_EXPECTED);
  const r1136Expected = matchesExpected(r1136, R1136_EXPECTED);
  const manifestStatus = r1133Expected ? readStringAt(r1133, ["summary", "manifestStatus"]) : null;
  const availableSourceFamilyIds = availableSourceFamilyIdsFor(r1133Expected ? r1133 : null);
  const routeStatuses = routeStatusesFor({ availableSourceFamilyIds, manifestStatus, r1133Expected });
  const fullSupportedRouteReady = routeStatuses.some(
    (route) => route.routeId === "full_labs_wearable_first_pass_route"
      && route.routeAvailabilityStatus === "ready_for_current_runner",
  );
  const partialRouteIdsReadyButUnsupported = routeStatuses
    .filter((route) => route.routeAvailabilityStatus === "available_but_runner_extension_required")
    .map((route) => route.routeId);
  const conclusion = conclusionFor({
    availableSourceFamilyIds,
    fullSupportedRouteReady,
    manifestStatus,
    partialRouteIdsReadyButUnsupported,
    r1133Expected,
    r1136Expected,
  });
  const output: R1137OrdinaryConsumerPartialRoutePlannerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1133: summarizeInput(R1133_EXPECTED, r1133),
      r1136: summarizeInput(R1136_EXPECTED, r1136),
    },
    packetId: "r1137-ordinary-consumer-partial-route-planner",
    partialRoutePlanner: {
      availableSourceFamilyIds,
      blockers: blockersFor({ conclusion, routeStatuses }),
      commands: {
        availabilityChainRunnerCommand: readStringAt(r1136, [
          "availabilityChain",
          "commands",
          "availabilityChainRunnerCommand",
        ]),
        availabilityPreflightCommand: readStringAt(r1133, [
          "ordinaryDataAvailabilityPreflight",
          "commands",
          "availabilityPreflightCommand",
        ]),
        partialRoutePlannerCommand: R1137_PARTIAL_ROUTE_PLANNER_COMMAND,
      },
      currentEvidenceGate: "full_l1_l2_w1_qc_required_for_real_evidence_gate",
      fullSupportedRouteReady,
      manifestStatus,
      partialRouteIdsReadyButUnsupported,
      primarySubmitterInputFamilyIds: [...PRIMARY_SUBMITTER_INPUT_FAMILY_IDS],
      privateDetailsStored: false,
      requiredLinkageFamilyIds: [...REQUIRED_LINKAGE_FAMILY_IDS],
      routeStatuses,
    },
    productDisplayAuthorized: false,
    schemaVersion: R1137_ORDINARY_CONSUMER_PARTIAL_ROUTE_PLANNER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      availableSourceFamilyIds,
      conclusion,
      fullSupportedRouteReady,
      nextAction: nextActionFor(conclusion),
      partialRouteIdsReadyButUnsupported,
      primarySubmitterInputFamilyIds: [...PRIMARY_SUBMITTER_INPUT_FAMILY_IDS],
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: fullSupportedRouteReady,
      realAggregateStillMissing: true,
      requiredLinkageFamilyIds: [...REQUIRED_LINKAGE_FAMILY_IDS],
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1137: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1137 ordinary consumer partial route planner failed aggregate-egress validation: ${formatFindingCount(findings)}`);
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
    throw new Error(`R1137 ${name} failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }
}

function routeStatusesFor(input: {
  availableSourceFamilyIds: readonly string[];
  manifestStatus: string | null;
  r1133Expected: boolean;
}): PartialRouteStatus[] {
  const available = new Set(input.availableSourceFamilyIds);
  const linkageMissing = REQUIRED_LINKAGE_FAMILY_IDS.some((familyId) => !available.has(familyId));
  return ROUTE_DEFINITIONS.map((route): PartialRouteStatus => {
    const missingSourceFamilyIds = route.requiredSourceFamilyIds.filter((familyId) => !available.has(familyId));
    const availableSourceFamilyIds = route.requiredSourceFamilyIds.filter((familyId) => available.has(familyId));
    const routeAvailabilityStatus = routeAvailabilityStatusFor({
      currentRunnerSupportStatus: route.currentRunnerSupportStatus,
      linkageMissing,
      manifestStatus: input.manifestStatus,
      missingSourceFamilyIds,
      r1133Expected: input.r1133Expected,
    });
    return {
      availableSourceFamilyIds,
      currentRunnerSupportStatus: route.currentRunnerSupportStatus,
      firstPassCandidateIds: [...route.firstPassCandidateIds],
      missingSourceFamilyIds,
      productDisplayAuthorized: false,
      requiredSourceFamilyIds: [...route.requiredSourceFamilyIds],
      routeAvailabilityStatus,
      routeId: route.routeId,
      routeKind: route.routeKind,
      reviewGptRequiredNow: false,
    };
  });
}

function routeAvailabilityStatusFor(input: {
  currentRunnerSupportStatus: string;
  linkageMissing: boolean;
  manifestStatus: string | null;
  missingSourceFamilyIds: readonly string[];
  r1133Expected: boolean;
}): RouteAvailabilityStatus {
  if (!input.r1133Expected || input.manifestStatus !== "provided") return "blocked_waiting_on_manifest";
  if (input.linkageMissing) return "blocked_missing_linkage";
  if (input.missingSourceFamilyIds.length > 0) return "blocked_missing_inputs";
  return input.currentRunnerSupportStatus === "supported_by_current_first_pass_runner"
    ? "ready_for_current_runner"
    : "available_but_runner_extension_required";
}

function conclusionFor(input: {
  availableSourceFamilyIds: readonly string[];
  fullSupportedRouteReady: boolean;
  manifestStatus: string | null;
  partialRouteIdsReadyButUnsupported: readonly string[];
  r1133Expected: boolean;
  r1136Expected: boolean;
}): PlannerConclusion {
  if (!input.r1133Expected || !input.r1136Expected) return "ordinary_partial_route_planner_waiting_on_refresh";
  if (input.manifestStatus !== "provided") return "ordinary_partial_route_planner_waiting_on_safe_manifest";
  const available = new Set(input.availableSourceFamilyIds);
  if (REQUIRED_LINKAGE_FAMILY_IDS.some((familyId) => !available.has(familyId))) {
    return "ordinary_partial_route_planner_blocked_missing_linkage";
  }
  if (input.fullSupportedRouteReady) return "ordinary_partial_route_planner_full_route_ready_for_private_config_mapping";
  if (input.partialRouteIdsReadyButUnsupported.length > 0) {
    return "ordinary_partial_route_planner_partial_routes_available_runner_extension_needed";
  }
  return "ordinary_partial_route_planner_collect_wearable_or_lab_sources";
}

function nextActionFor(conclusion: PlannerConclusion): PlannerNextAction {
  if (conclusion === "ordinary_partial_route_planner_waiting_on_refresh") {
    return "refresh_r1133_r1136_before_partial_route_planning";
  }
  if (conclusion === "ordinary_partial_route_planner_waiting_on_safe_manifest") {
    return "fill_safe_availability_manifest_then_run_r1136_r1137_chain";
  }
  if (conclusion === "ordinary_partial_route_planner_blocked_missing_linkage") {
    return "collect_outcome_and_join_linkage_then_rerun_r1136_r1137";
  }
  if (conclusion === "ordinary_partial_route_planner_partial_routes_available_runner_extension_needed") {
    return "extend_r1125_r1124_for_partial_lab_wearable_routes_or_collect_missing_full_route";
  }
  if (conclusion === "ordinary_partial_route_planner_full_route_ready_for_private_config_mapping") {
    return "fill_private_config_mapping_for_full_labs_wearable_route";
  }
  return "collect_wearable_or_lab_sources_then_rerun_r1136_r1137";
}

function blockersFor(input: {
  conclusion: PlannerConclusion;
  routeStatuses: readonly PartialRouteStatus[];
}): string[] {
  if (input.conclusion === "ordinary_partial_route_planner_full_route_ready_for_private_config_mapping") {
    return ["private_config_not_ready_for_r1125"];
  }
  if (input.conclusion === "ordinary_partial_route_planner_partial_routes_available_runner_extension_needed") {
    return ["current_r1125_r1124_gate_requires_full_l1_l2_w1_qc_metrics"];
  }
  const blockers = new Set<string>();
  for (const route of input.routeStatuses) {
    for (const familyId of route.missingSourceFamilyIds) blockers.add(`source_family_not_available:${familyId}`);
  }
  if (input.conclusion === "ordinary_partial_route_planner_waiting_on_safe_manifest") {
    blockers.add("ordinary_data_availability_manifest_missing");
  }
  if (input.conclusion === "ordinary_partial_route_planner_waiting_on_refresh") {
    blockers.add("r1133_or_r1136_missing_or_stale");
  }
  return [...blockers];
}

function availableSourceFamilyIdsFor(r1133: unknown | null): string[] {
  return readObjectArrayAt(r1133, ["ordinaryDataAvailabilityPreflight", "sourceFamilies"])
    .filter((family) => readStringAt(family, ["status"]) === "declared_available")
    .map((family) => readStringAt(family, ["familyId"]))
    .filter((familyId): familyId is string => Boolean(familyId));
}

function summarizeInput(
  expected: typeof R1133_EXPECTED | typeof R1136_EXPECTED,
  input: unknown | null,
): ArtifactSummary {
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
  expected: typeof R1133_EXPECTED | typeof R1136_EXPECTED,
): boolean {
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
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

function safeBoundary(): R1137OrdinaryConsumerPartialRoutePlannerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1137: false,
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
    rowParsingPerformedByR1137: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1137OrdinaryConsumerPartialRoutePlanner({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1133Path: process.env.MURPH_AGE_R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_PATH,
    r1136Path: process.env.MURPH_AGE_R1136_ORDINARY_CONSUMER_AVAILABILITY_CHAIN_RUNNER_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    availableSourceFamilyIds: output.summary.availableSourceFamilyIds,
    conclusion: output.summary.conclusion,
    fullSupportedRouteReady: output.summary.fullSupportedRouteReady,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    partialRouteIdsReadyButUnsupported: output.summary.partialRouteIdsReadyButUnsupported,
    primarySubmitterInputFamilyIds: output.summary.primarySubmitterInputFamilyIds,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyForPrivateConfigMapping: output.summary.readyForPrivateConfigMapping,
    requiredLinkageFamilyIds: output.summary.requiredLinkageFamilyIds,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1137: output.summary.rowParsingPerformedByR1137,
    schemaVersion: output.schemaVersion,
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
    process.stderr.write(`${safeCliErrorMessage(error, "R1137 ordinary consumer partial route planner failed.")}\n`);
    process.exitCode = 1;
  });
}
