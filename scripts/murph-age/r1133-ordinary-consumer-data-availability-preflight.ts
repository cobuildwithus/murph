import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_SCHEMA_VERSION =
  "murph-age-r1133-ordinary-consumer-data-availability-preflight.v1" as const;

const AVAILABILITY_MANIFEST_SCHEMA_VERSION =
  "murph-age-r1133-ordinary-consumer-data-availability-manifest.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1133-ordinary-consumer-data-availability-preflight.latest.json";
const FILLABLE_MANIFEST_FILE_NAME =
  "r1133-fillable-ordinary-consumer-data-availability-manifest.json";
const R1133_PREFLIGHT_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> pnpm exec tsx scripts/murph-age/r1133-ordinary-consumer-data-availability-preflight.ts" as const;

const R1132_EXPECTED = {
  artifact: "r1132-ordinary-consumer-submission-readiness.latest.json",
  packetId: "r1132-ordinary-consumer-submission-readiness",
  schemaVersion: "murph-age-r1132-ordinary-consumer-submission-readiness.v1",
} as const;

const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
] as const;
const ACCEPTED_TABLE_LAYOUTS = [
  "single_primary_table_fallback",
  "multi_table_or_explicit_refs",
] as const;
const BLOCKED_MANIFEST_CONTENT = [
  "private_paths",
  "header_names",
  "source_variable_names",
  "file_names",
  "row_values",
  "participant_identifiers",
  "predictions",
  "coefficients",
  "source_text",
] as const;
const REQUIRED_SAFE_MANIFEST_ATTESTATIONS = [
  "aggregateOnly",
  "noCoefficientEgress",
  "noHeaderNameEgress",
  "noParticipantEgress",
  "noPredictionEgress",
  "noRowEgress",
  "noSmallCellEgress",
  "noSourceTextEgress",
] as const;

type OrdinarySourceFamilyId = typeof ORDINARY_SOURCE_FAMILY_IDS[number];
type AcceptedTableLayout = typeof ACCEPTED_TABLE_LAYOUTS[number];
type BlockedManifestContent = typeof BLOCKED_MANIFEST_CONTENT[number];
type RequiredSafeManifestAttestation = typeof REQUIRED_SAFE_MANIFEST_ATTESTATIONS[number];
type CountBand =
  | "unknown"
  | "below_minimum"
  | "10_plus"
  | "50_plus"
  | "100_plus"
  | "500_plus";
type ManifestStatus =
  | "invalid_or_stale_schema"
  | "not_provided"
  | "provided";
type SourceAvailabilityStatus =
  | "declared_available"
  | "declared_missing"
  | "not_declared";
type PreflightConclusion =
  | "ordinary_data_availability_preflight_missing_required_availability"
  | "ordinary_data_availability_preflight_ready_for_private_config_mapping"
  | "ordinary_data_availability_preflight_ready_for_private_runner"
  | "ordinary_data_availability_preflight_waiting_on_manifest"
  | "ordinary_data_availability_preflight_waiting_on_readiness_refresh";
type PreflightNextAction =
  | "collect_missing_outcome_linked_labs_wearable_sources"
  | "complete_private_config_for_available_labs_wearables"
  | "fill_safe_ordinary_data_availability_manifest"
  | "refresh_r1132_before_data_availability_preflight"
  | "run_r1125_private_runner_then_r1124_real_metric_intake";

interface ArtifactSummary {
  artifact: typeof R1132_EXPECTED.artifact;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SourceFamilyAvailability {
  declaredAvailable: boolean | null;
  familyId: OrdinarySourceFamilyId;
  inputKind: string | null;
  missingSlotCount: number;
  missingSlotIds: string[];
  privateDetailsStored: false;
  requiredForFirstPass: true;
  status: SourceAvailabilityStatus;
}

interface AggregateReadinessFacts {
  eventCountBand: CountBand;
  meetsMinimumEventCount: boolean;
  meetsMinimumUsableRecordCount: boolean;
  outcomeLinked: boolean;
  sameDenominator: boolean;
  targetAgeBand: "roughly_16_50" | "unknown";
  usableRecordCountBand: CountBand;
}

interface SafeManifestAttestationChecklistItem {
  attestationId: RequiredSafeManifestAttestation;
  currentStatus: "complete" | "missing_or_false";
  safeExpectedValue: true;
}

interface SafeManifestAttestations {
  checklist: SafeManifestAttestationChecklistItem[];
  complete: boolean;
  requiredAttestationIds: RequiredSafeManifestAttestation[];
}

interface FillableAvailabilityManifest {
  aggregateReadinessFacts: {
    eventCountBand: "unknown";
    outcomeLinked: false;
    sameDenominator: false;
    targetAgeBand: "roughly_16_50";
    usableRecordCountBand: "unknown";
  };
  attestations: {
    aggregateOnly: true;
    noCoefficientEgress: true;
    noHeaderNameEgress: true;
    noParticipantEgress: true;
    noPredictionEgress: true;
    noRowEgress: true;
    noSmallCellEgress: true;
    noSourceTextEgress: true;
  };
  blockedManifestContent: BlockedManifestContent[];
  selectedTableLayout: "";
  sourceFamilies: Array<{
    available: false;
    familyId: OrdinarySourceFamilyId;
    inputKind: string;
  }>;
  schemaVersion: typeof AVAILABILITY_MANIFEST_SCHEMA_VERSION;
  targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
}

export interface R1133OrdinaryConsumerDataAvailabilityPreflightOptions {
  availabilityManifestPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1132Path?: string;
}

export interface R1133OrdinaryConsumerDataAvailabilityPreflightOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1133: false;
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
    rowParsingPerformedByR1133: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1132: ArtifactSummary;
  };
  ordinaryDataAvailabilityPreflight: {
    acceptedTableLayouts: AcceptedTableLayout[];
    aggregateReadinessFacts: AggregateReadinessFacts;
    blockers: string[];
    commands: {
      availabilityPreflightCommand: typeof R1133_PREFLIGHT_COMMAND;
      configIntakeCommand: string | null;
      metricIntakeCommand: string | null;
      privateRunnerCommand: string | null;
    };
    fillableManifestArtifact: typeof FILLABLE_MANIFEST_FILE_NAME;
    manifestStatus: ManifestStatus;
    missingSourceFamilyIds: OrdinarySourceFamilyId[];
    privateDetailsStored: false;
    readyForPrivateConfigMapping: boolean;
    readyForPrivateRunner: boolean;
    safeManifestAttestations: SafeManifestAttestations;
    selectedTableLayout: AcceptedTableLayout | null;
    sourceFamilies: SourceFamilyAvailability[];
  };
  packetId: "r1133-ordinary-consumer-data-availability-preflight";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: PreflightConclusion;
    manifestStatus: ManifestStatus;
    missingSourceFamilyIds: OrdinarySourceFamilyId[];
    nextAction: PreflightNextAction;
    productDisplayAuthorized: false;
    readyForPrivateConfigMapping: boolean;
    readyForPrivateRunner: boolean;
    realAggregateStillMissing: boolean;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1133: false;
    safeManifestAttestationsComplete: boolean;
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1133OrdinaryConsumerDataAvailabilityPreflight(
  options: R1133OrdinaryConsumerDataAvailabilityPreflightOptions = {},
): Promise<{
  fillableManifestPath: string;
  output: R1133OrdinaryConsumerDataAvailabilityPreflightOutput;
  outputPath: string;
}> {
  const r1132 = await readJsonIfPresent(options.r1132Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1132_EXPECTED.artifact));
  validateInputBoundary("r1132", r1132);
  const availabilityManifestPath = options.availabilityManifestPath
    ?? process.env.MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH;
  const availabilityManifest = await readJsonIfPresent(availabilityManifestPath);
  validateInputBoundary("availability manifest", availabilityManifest);

  const r1132Ready = r1132MatchesExpected(r1132);
  const manifestStatus = manifestStatusFor(availabilityManifest);
  const sourceFamilies = sourceFamiliesFor({ availabilityManifest, r1132 });
  const aggregateReadinessFacts = aggregateReadinessFactsFor(availabilityManifest);
  const safeManifestAttestations = safeManifestAttestationsFor(availabilityManifest);
  const selectedTableLayout = selectedTableLayoutFor(availabilityManifest);
  const missingSourceFamilyIds = sourceFamilies
    .filter((family) => family.declaredAvailable !== true)
    .map((family) => family.familyId);
  const availabilityComplete = manifestStatus === "provided"
    && missingSourceFamilyIds.length === 0
    && aggregateReadinessFacts.outcomeLinked
    && aggregateReadinessFacts.sameDenominator
    && aggregateReadinessFacts.meetsMinimumEventCount
    && aggregateReadinessFacts.meetsMinimumUsableRecordCount
    && safeManifestAttestations.complete
    && selectedTableLayout !== null;
  const r1132ReadyForPrivateRunner = readBooleanAt(r1132, ["summary", "readyForPrivateRunner"]) === true;
  const readyForPrivateConfigMapping = r1132Ready && availabilityComplete;
  const readyForPrivateRunner = readyForPrivateConfigMapping && r1132ReadyForPrivateRunner;
  const conclusion = conclusionFor({
    availabilityComplete,
    manifestStatus,
    r1132Ready,
    readyForPrivateRunner,
  });
  const blockers = blockersFor({
    aggregateReadinessFacts,
    manifestStatus,
    missingSourceFamilyIds,
    r1132Ready,
    r1132ReadyForPrivateRunner,
    safeManifestAttestations,
    selectedTableLayout,
  });

  const output: R1133OrdinaryConsumerDataAvailabilityPreflightOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1132: summarizeR1132(r1132),
    },
    ordinaryDataAvailabilityPreflight: {
      acceptedTableLayouts: [...ACCEPTED_TABLE_LAYOUTS],
      aggregateReadinessFacts,
      blockers,
      commands: {
        availabilityPreflightCommand: R1133_PREFLIGHT_COMMAND,
        configIntakeCommand: readStringAt(r1132, [
          "ordinaryConsumerReadiness",
          "commands",
          "configIntakeCommand",
        ]),
        metricIntakeCommand: readStringAt(r1132, [
          "ordinaryConsumerReadiness",
          "commands",
          "metricIntakeCommand",
        ]),
        privateRunnerCommand: readStringAt(r1132, [
          "ordinaryConsumerReadiness",
          "commands",
          "privateRunnerCommand",
        ]),
      },
      fillableManifestArtifact: FILLABLE_MANIFEST_FILE_NAME,
      manifestStatus,
      missingSourceFamilyIds,
      privateDetailsStored: false,
      readyForPrivateConfigMapping,
      readyForPrivateRunner,
      safeManifestAttestations,
      selectedTableLayout,
      sourceFamilies,
    },
    packetId: "r1133-ordinary-consumer-data-availability-preflight",
    productDisplayAuthorized: false,
    schemaVersion: R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      manifestStatus,
      missingSourceFamilyIds,
      nextAction: nextActionFor(conclusion),
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping,
      readyForPrivateRunner,
      realAggregateStillMissing: !readyForPrivateRunner,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1133: false,
      safeManifestAttestationsComplete: safeManifestAttestations.complete,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
  const fillableManifest = createFillableAvailabilityManifest(r1132);
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenAggregateEgress(fillableManifest),
  ];
  if (findings.length > 0) {
    throw new Error(`R1133 ordinary consumer data availability preflight failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const fillableManifestPath = path.join(outputDir, FILLABLE_MANIFEST_FILE_NAME);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(fillableManifestPath, `${JSON.stringify(fillableManifest, null, 2)}\n`),
  ]);
  return { fillableManifestPath, output, outputPath };
}

async function readJsonIfPresent(filePath: string | undefined): Promise<unknown | null> {
  if (!filePath?.trim()) return null;
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
    throw new Error(`R1133 ${name} failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }
}

function manifestStatusFor(availabilityManifest: unknown | null): ManifestStatus {
  if (!availabilityManifest) return "not_provided";
  return readStringAt(availabilityManifest, ["schemaVersion"]) === AVAILABILITY_MANIFEST_SCHEMA_VERSION
    ? "provided"
    : "invalid_or_stale_schema";
}

function sourceFamiliesFor(input: {
  availabilityManifest: unknown | null;
  r1132: unknown | null;
}): SourceFamilyAvailability[] {
  const declaredAvailability = declaredAvailabilityFor(input.availabilityManifest);
  return ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => {
    const sourceFamily = sourceFamilyRecordFor(input.r1132, familyId);
    const declaredAvailable = declaredAvailability.get(familyId) ?? null;
    return {
      declaredAvailable,
      familyId,
      inputKind: readStringAt(sourceFamily, ["inputKind"]) ?? defaultInputKindFor(familyId),
      missingSlotCount: readNumberAt(sourceFamily, ["missingSlotCount"]) ?? 0,
      missingSlotIds: readStringArrayAt(sourceFamily, ["missingSlotIds"]),
      privateDetailsStored: false,
      requiredForFirstPass: true,
      status: declaredAvailable === null
        ? "not_declared"
        : declaredAvailable
          ? "declared_available"
          : "declared_missing",
    };
  });
}

function declaredAvailabilityFor(availabilityManifest: unknown | null): Map<OrdinarySourceFamilyId, boolean> {
  const result = new Map<OrdinarySourceFamilyId, boolean>();
  for (const family of readArrayAt(availabilityManifest, ["sourceFamilies"])) {
    const familyId = readStringAt(family, ["familyId"]);
    if (!isOrdinarySourceFamilyId(familyId)) continue;
    const available = readBooleanAt(family, ["available"]);
    if (available !== null) result.set(familyId, available);
  }
  return result;
}

function aggregateReadinessFactsFor(availabilityManifest: unknown | null): AggregateReadinessFacts {
  const eventCountBand = readCountBandAt(availabilityManifest, ["aggregateReadinessFacts", "eventCountBand"]);
  const usableRecordCountBand = readCountBandAt(availabilityManifest, [
    "aggregateReadinessFacts",
    "usableRecordCountBand",
  ]);
  const targetAgeBand = readStringAt(availabilityManifest, ["aggregateReadinessFacts", "targetAgeBand"]);
  return {
    eventCountBand,
    meetsMinimumEventCount: countBandMeets(eventCountBand, "10_plus"),
    meetsMinimumUsableRecordCount: countBandMeets(usableRecordCountBand, "50_plus"),
    outcomeLinked: readBooleanAt(availabilityManifest, ["aggregateReadinessFacts", "outcomeLinked"]) === true,
    sameDenominator: readBooleanAt(availabilityManifest, ["aggregateReadinessFacts", "sameDenominator"]) === true,
    targetAgeBand: targetAgeBand === "roughly_16_50" ? "roughly_16_50" : "unknown",
    usableRecordCountBand,
  };
}

function selectedTableLayoutFor(availabilityManifest: unknown | null): AcceptedTableLayout | null {
  const selectedTableLayout = readStringAt(availabilityManifest, ["selectedTableLayout"]);
  return isAcceptedTableLayout(selectedTableLayout) ? selectedTableLayout : null;
}

function safeManifestAttestationsFor(availabilityManifest: unknown | null): SafeManifestAttestations {
  const checklist = REQUIRED_SAFE_MANIFEST_ATTESTATIONS.map((attestationId): SafeManifestAttestationChecklistItem => {
    const currentStatus = readBooleanAt(availabilityManifest, ["attestations", attestationId]) === true
      ? "complete"
      : "missing_or_false";
    return {
      attestationId,
      currentStatus,
      safeExpectedValue: true,
    };
  });
  return {
    checklist,
    complete: checklist.every((item) => item.currentStatus === "complete"),
    requiredAttestationIds: [...REQUIRED_SAFE_MANIFEST_ATTESTATIONS],
  };
}

function conclusionFor(input: {
  availabilityComplete: boolean;
  manifestStatus: ManifestStatus;
  r1132Ready: boolean;
  readyForPrivateRunner: boolean;
}): PreflightConclusion {
  if (!input.r1132Ready) return "ordinary_data_availability_preflight_waiting_on_readiness_refresh";
  if (input.manifestStatus !== "provided") return "ordinary_data_availability_preflight_waiting_on_manifest";
  if (!input.availabilityComplete) return "ordinary_data_availability_preflight_missing_required_availability";
  if (input.readyForPrivateRunner) return "ordinary_data_availability_preflight_ready_for_private_runner";
  return "ordinary_data_availability_preflight_ready_for_private_config_mapping";
}

function nextActionFor(conclusion: PreflightConclusion): PreflightNextAction {
  if (conclusion === "ordinary_data_availability_preflight_waiting_on_readiness_refresh") {
    return "refresh_r1132_before_data_availability_preflight";
  }
  if (conclusion === "ordinary_data_availability_preflight_waiting_on_manifest") {
    return "fill_safe_ordinary_data_availability_manifest";
  }
  if (conclusion === "ordinary_data_availability_preflight_missing_required_availability") {
    return "collect_missing_outcome_linked_labs_wearable_sources";
  }
  if (conclusion === "ordinary_data_availability_preflight_ready_for_private_runner") {
    return "run_r1125_private_runner_then_r1124_real_metric_intake";
  }
  return "complete_private_config_for_available_labs_wearables";
}

function blockersFor(input: {
  aggregateReadinessFacts: AggregateReadinessFacts;
  manifestStatus: ManifestStatus;
  missingSourceFamilyIds: readonly OrdinarySourceFamilyId[];
  r1132Ready: boolean;
  r1132ReadyForPrivateRunner: boolean;
  safeManifestAttestations: SafeManifestAttestations;
  selectedTableLayout: AcceptedTableLayout | null;
}): string[] {
  const blockers: string[] = [];
  if (!input.r1132Ready) blockers.push("r1132_submitter_readiness_missing_or_stale");
  if (input.manifestStatus === "not_provided") blockers.push("ordinary_data_availability_manifest_missing");
  if (input.manifestStatus === "invalid_or_stale_schema") {
    blockers.push("ordinary_data_availability_manifest_schema_invalid_or_stale");
  }
  if (input.manifestStatus === "provided" && !input.safeManifestAttestations.complete) {
    blockers.push("safe_manifest_attestations_missing_or_incomplete");
  }
  blockers.push(...input.missingSourceFamilyIds.map((familyId) => `source_family_not_available:${familyId}`));
  if (input.selectedTableLayout === null) blockers.push("accepted_table_layout_not_declared");
  if (!input.aggregateReadinessFacts.outcomeLinked) blockers.push("outcome_linkage_not_declared");
  if (!input.aggregateReadinessFacts.sameDenominator) blockers.push("same_denominator_not_declared");
  if (!input.aggregateReadinessFacts.meetsMinimumEventCount) {
    blockers.push("event_count_floor_not_declared_or_below_minimum");
  }
  if (!input.aggregateReadinessFacts.meetsMinimumUsableRecordCount) {
    blockers.push("usable_record_floor_not_declared_or_below_minimum");
  }
  if (blockers.length === 0 && !input.r1132ReadyForPrivateRunner) {
    blockers.push("private_config_not_ready_for_r1125");
  }
  return blockers;
}

function createFillableAvailabilityManifest(r1132: unknown | null): FillableAvailabilityManifest {
  return {
    aggregateReadinessFacts: {
      eventCountBand: "unknown",
      outcomeLinked: false,
      sameDenominator: false,
      targetAgeBand: "roughly_16_50",
      usableRecordCountBand: "unknown",
    },
    attestations: {
      aggregateOnly: true,
      noCoefficientEgress: true,
      noHeaderNameEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      noSourceTextEgress: true,
    },
    blockedManifestContent: [...BLOCKED_MANIFEST_CONTENT],
    selectedTableLayout: "",
    sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
      available: false,
      familyId,
      inputKind: readStringAt(sourceFamilyRecordFor(r1132, familyId), ["inputKind"]) ?? defaultInputKindFor(familyId),
    })),
    schemaVersion: AVAILABILITY_MANIFEST_SCHEMA_VERSION,
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
  };
}

function sourceFamilyRecordFor(r1132: unknown | null, familyId: OrdinarySourceFamilyId): unknown | null {
  return readArrayAt(r1132, ["ordinaryConsumerReadiness", "sourceFamilies"]).find(
    (family) => readStringAt(family, ["familyId"]) === familyId,
  ) ?? null;
}

function defaultInputKindFor(familyId: OrdinarySourceFamilyId): string {
  if (familyId === "bloodwork_glycemia" || familyId === "common_bloodwork_core") {
    return "bloodwork_table_or_lab_portal_export";
  }
  if (familyId === "vitals_body_context") return "body_or_vitals_table";
  if (familyId === "wearable_activity_daily") return "daily_wearable_activity_export_or_spreadsheet";
  if (familyId === "outcome_linkage") return "outcome_or_followup_table";
  return "stable_join_key_and_date_fields";
}

function summarizeR1132(r1132: unknown | null): ArtifactSummary {
  return {
    artifact: R1132_EXPECTED.artifact,
    packetId: readStringAt(r1132, ["packetId"]),
    schemaVersion: readStringAt(r1132, ["schemaVersion"]),
    status: r1132 ? "available" : "missing",
  };
}

function r1132MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1132_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1132_EXPECTED.schemaVersion;
}

function readCountBandAt(value: unknown | null, pathParts: readonly string[]): CountBand {
  const countBand = readStringAt(value, pathParts);
  return isCountBand(countBand) ? countBand : "unknown";
}

function countBandMeets(value: CountBand, minimum: "10_plus" | "50_plus"): boolean {
  const rank: Record<CountBand, number> = {
    unknown: 0,
    below_minimum: 0,
    "10_plus": 1,
    "50_plus": 2,
    "100_plus": 3,
    "500_plus": 4,
  };
  return rank[value] >= rank[minimum];
}

function isCountBand(value: string | null): value is CountBand {
  return value === "unknown"
    || value === "below_minimum"
    || value === "10_plus"
    || value === "50_plus"
    || value === "100_plus"
    || value === "500_plus";
}

function isOrdinarySourceFamilyId(value: string | null): value is OrdinarySourceFamilyId {
  return value === "join_time_alignment"
    || value === "outcome_linkage"
    || value === "bloodwork_glycemia"
    || value === "common_bloodwork_core"
    || value === "vitals_body_context"
    || value === "wearable_activity_daily";
}

function isAcceptedTableLayout(value: string | null): value is AcceptedTableLayout {
  return value === "single_primary_table_fallback" || value === "multi_table_or_explicit_refs";
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

function readArrayAt(value: unknown | null, pathParts: readonly string[]): unknown[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved : [];
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function safeBoundary(): R1133OrdinaryConsumerDataAvailabilityPreflightOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1133: false,
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
    rowParsingPerformedByR1133: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1133OrdinaryConsumerDataAvailabilityPreflight({
    availabilityManifestPath: process.env.MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1132Path: process.env.MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    blockers: output.ordinaryDataAvailabilityPreflight.blockers,
    conclusion: output.summary.conclusion,
    fillableManifestArtifact: output.ordinaryDataAvailabilityPreflight.fillableManifestArtifact,
    manifestStatus: output.summary.manifestStatus,
    missingSourceFamilyIds: output.summary.missingSourceFamilyIds,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyForPrivateConfigMapping: output.summary.readyForPrivateConfigMapping,
    readyForPrivateRunner: output.summary.readyForPrivateRunner,
    realAggregateStillMissing: output.summary.realAggregateStillMissing,
    rowParsingPerformedByR1133: output.summary.rowParsingPerformedByR1133,
    safeManifestAttestationsComplete: output.summary.safeManifestAttestationsComplete,
    schemaVersion: output.schemaVersion,
    sourceFamilies: output.ordinaryDataAvailabilityPreflight.sourceFamilies.map((family) => ({
      declaredAvailable: family.declaredAvailable,
      familyId: family.familyId,
      status: family.status,
    })),
    status: output.status,
  }, null, 2)}\n`);
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} forbidden aggregate-egress finding(s)`;
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1133 ordinary consumer data availability preflight failed.")}\n`);
    process.exitCode = 1;
  });
}
