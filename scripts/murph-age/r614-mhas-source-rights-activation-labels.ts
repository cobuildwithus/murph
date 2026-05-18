import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R614_MHAS_SOURCE_RIGHTS_ACTIVATION_LABELS_SCHEMA_VERSION =
  "murph-age-r614-mhas-source-rights-activation-labels.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_CONFIRMATION_PATH = path.join(
  ".runtime",
  "murph-age",
  "source-confirmations",
  "mhas-public-use-confirmation-r226.local.json",
);
const DEFAULT_GATEWAY_DATA_DIR = path.join(
  ".runtime",
  "cache",
  "murph-age",
  "external-sources",
  "mhas_gateway_harmonized_transport",
);
const DEFAULT_RAW_WAVE_DATA_DIR = path.join(
  ".runtime",
  "cache",
  "murph-age",
  "external-sources",
  "mhas_raw_wave_files_local",
);
const OUTPUT_FILE_NAME = "r614-mhas-source-rights-activation-labels.latest.json";

const REQUIRED_CONFIRMATION_FIELDS = [
  "user_confirms_mhas_public_use_terms_reviewed",
  "user_confirms_no_reidentification_attempt",
  "user_confirms_no_third_party_transfer",
  "user_confirms_local_ignored_cache_only",
  "user_confirms_no_rows_or_source_bodies_to_reviewgpt",
  "user_confirms_aggregate_export_with_attribution_and_small_cell_suppression_only",
  "user_confirms_mhas_credit_and_required_notice",
  "user_confirms_no_genetic_or_restricted_linkage_use_in_first_pass",
  "user_confirms_no_product_claims_from_mhas_results",
] as const;

type ArtifactKey = "humanConfirmation" | "mhasJoinProbe" | "mhasSourceFeasibility" | "r611MetadataSourceIntake";
type ArtifactStatus = "available" | "missing";
type FamilyStatus = "detected" | "missing";
type R614NextGate =
  | "complete_mhas_source_rights_and_local_family_labels"
  | "draft_locked_mhas_endpoint_join_contract";

const INPUT_ARTIFACT_METADATA: Record<ArtifactKey, {
  artifact: string;
  packetIds: readonly string[];
  schemaVersions: readonly string[];
}> = {
  humanConfirmation: {
    artifact: "mhas-public-use-confirmation.local.json",
    packetIds: [],
    schemaVersions: [
      "murph.age.local.mhas-public-use-confirmation.r226.v0",
      "murph-age-mhas-public-use-confirmation.v1",
    ],
  },
  mhasJoinProbe: {
    artifact: "mhas-join-probe.latest.json",
    packetIds: ["mhas-harmonized-eol-aggregate-join-probe"],
    schemaVersions: ["murph-age-mhas-join-probe.v1"],
  },
  mhasSourceFeasibility: {
    artifact: "mhas-source-feasibility.latest.json",
    packetIds: ["mhas-harmonized-eol-source-feasibility"],
    schemaVersions: ["murph-age-mhas-source-feasibility.v1"],
  },
  r611MetadataSourceIntake: {
    artifact: "r611-mhas-metadata-source-intake.latest.json",
    packetIds: ["r611-mhas-metadata-source-intake"],
    schemaVersions: ["murph-age-r611-mhas-metadata-source-intake.v1"],
  },
};

const LOCAL_FILE_FINGERPRINTS = {
  followUpStatusBridge: "18222833f8396e3603b63b3f5d198d518a26256177137b65668e84d25ce82078",
  gatewayEol: "544815e1b57bf3150161642c350af49f4188dd043f81ce4b79944b9aaa7111ed",
  gatewayHarmonized: "4ab93a92719253be362260dffab2379d4cdcc638b8cec2de87fd0126cf4b91b4",
} as const;

const RAW_WAVE_FOLLOW_UP_FINGERPRINTS = new Set([
  "399f8e9cfc21f38375a2a26b0954d9769d0b0e030cd8bc7c74cf852e19c0a069",
]);
const RAW_WAVE_SUPPLEMENTAL_FINGERPRINTS = new Set([
  "8b6752c3336c18de282250d9ef744efb72232c24e0e0f1d633ace240c95acf08",
]);
const RAW_WAVE_SPAN_FINGERPRINT_BUCKETS = new Map<string, string>([
  ["7664d883bf205e1cab35d4022ca75a866109c5e946d97383618285e312125486", "latest_wave"],
  ["399f8e9cfc21f38375a2a26b0954d9769d0b0e030cd8bc7c74cf852e19c0a069", "middle_wave"],
  ["8b6752c3336c18de282250d9ef744efb72232c24e0e0f1d633ace240c95acf08", "earlier_wave"],
]);

const PRIOR_JOIN_FAMILY_STATUS_LABELS = [
  "candidate_family_overlap_not_detected",
] as const;

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface LocalFamilyEvidence {
  activatedFamilyCountBand: string;
  followUpStatusBridgeFamily: FamilyStatus;
  gatewayEolFamily: FamilyStatus;
  gatewayHarmonizedFamily: FamilyStatus;
  inspected: true;
  rawWaveSectionFamily: {
    fileCountBand: string;
    followUpRoleDetected: boolean;
    status: FamilyStatus;
    supplementalRoleDetected: boolean;
    waveSpanLabel: "multi_wave" | "none" | "single_wave";
  };
  status: "complete" | "incomplete";
}

interface SourceRightsActivationLabels {
  activationLabelsComplete: boolean;
  aggregateOutputLabel: "aggregate_only_with_suppression_confirmed" | "unconfirmed_human_required";
  confirmationArtifactStatus: ArtifactStatus;
  confirmedFieldCountBand: string;
  localResearchUseLabel: "local_ignored_cache_only_confirmed" | "unconfirmed_human_required";
  productClaimRestrictionLabel: "no_product_claims_confirmed" | "unconfirmed_human_required";
  reidentificationRestrictionLabel: "no_reidentification_attempt_confirmed" | "unconfirmed_human_required";
  restrictedLinkageExcluded: boolean | null;
  rowParsingForScoringUnlocked: false;
  sourceCreditNoticeRequired: boolean | null;
  transferRestrictionLabel: "no_third_party_transfer_confirmed" | "unconfirmed_human_required";
}

interface JoinFamilyActivation {
  activatedFamilyCountBand: string;
  blockerReasons: string[];
  localFamilyStatus: "blocked_missing_local_families" | "local_join_families_labeled";
  priorJoinFamilyStatus: string | null;
  readyForEndpointJoinContractMetadata: boolean;
}

interface EndpointJoinContractMetadata {
  aggregateSuppressionPolicy: "required_before_any_result_export";
  contractStatus: "blocked" | "metadata_contract_ready_without_execution";
  denominatorPolicy: "must_be_declared_before_row_execution";
  endpointFamily: "mortality_or_followup";
  joinResolutionPolicy: "role_family_contract_only_no_key_names";
  scoringUnlocked: false;
  sourceRoleFamilies: Array<
    | "baseline_harmonized_panel"
    | "gateway_eol_endpoint"
    | "follow_up_status_bridge"
    | "raw_wave_follow_up_sections"
  >;
}

export interface R614MhasSourceRightsActivationLabelsOptions {
  confirmationPath?: string;
  createdAt?: string;
  gatewayDataDir?: string;
  mhasJoinProbePath?: string;
  mhasSourceFeasibilityPath?: string;
  outputDir?: string;
  r611Path?: string;
  rawWaveDataDir?: string;
}

export interface R614MhasSourceRightsActivationLabelsOutput {
  boundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformed: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowParsingPerformed: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  endpointJoinContractMetadata: EndpointJoinContractMetadata;
  gates: {
    blockedActions: string[];
    nextGate: R614NextGate;
    outcomeScoringUnlocked: false;
    rowExecutionUnlocked: false;
    scoringUnlockRequires: string[];
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  joinFamilyActivation: JoinFamilyActivation;
  localFamilyEvidence: LocalFamilyEvidence;
  packetId: "r614-mhas-source-rights-activation-labels";
  schemaVersion: typeof R614_MHAS_SOURCE_RIGHTS_ACTIVATION_LABELS_SCHEMA_VERSION;
  sourceRightsActivationLabels: SourceRightsActivationLabels;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "mhas_activation_labels_and_contract_metadata_ready_no_execution"
      | "mhas_activation_labels_blocked_no_execution";
    endpointJoinContractReady: boolean;
    outcomeScoringUnlockedCountBand: "0";
    productPromotionAuthorized: false;
    sourceRightsLabelsComplete: boolean;
  };
}

export async function runR614MhasSourceRightsActivationLabels(
  options: R614MhasSourceRightsActivationLabelsOptions = {},
): Promise<{ output: R614MhasSourceRightsActivationLabelsOutput; outputPath: string }> {
  const inputs = {
    humanConfirmation: await readJsonIfPresent(options.confirmationPath ?? DEFAULT_CONFIRMATION_PATH),
    mhasJoinProbe: await readJsonIfPresent(
      options.mhasJoinProbePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "mhas-join-probe.latest.json"),
    ),
    mhasSourceFeasibility: await readJsonIfPresent(
      options.mhasSourceFeasibilityPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "mhas-source-feasibility.latest.json"),
    ),
    r611MetadataSourceIntake: await readJsonIfPresent(
      options.r611Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r611-mhas-metadata-source-intake.latest.json"),
    ),
  };
  validateInputBoundaries(inputs);

  const inputArtifacts = summarizeInputs(inputs);
  const localFamilyEvidence = await inspectLocalFamilyEvidence({
    gatewayDataDir: options.gatewayDataDir ?? DEFAULT_GATEWAY_DATA_DIR,
    rawWaveDataDir: options.rawWaveDataDir ?? DEFAULT_RAW_WAVE_DATA_DIR,
  });
  const sourceRightsActivationLabels = summarizeSourceRightsActivationLabels(inputs.humanConfirmation);
  const joinFamilyActivation = summarizeJoinFamilyActivation({
    localFamilyEvidence,
    mhasJoinProbe: inputs.mhasJoinProbe,
    r611MetadataSourceIntake: inputs.r611MetadataSourceIntake,
    sourceRightsActivationLabels,
  });
  const endpointJoinContractMetadata = summarizeEndpointJoinContractMetadata(joinFamilyActivation);
  const ready = joinFamilyActivation.readyForEndpointJoinContractMetadata
    && endpointJoinContractMetadata.contractStatus === "metadata_contract_ready_without_execution";

  const output: R614MhasSourceRightsActivationLabelsOutput = {
    boundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformed: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformed: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    endpointJoinContractMetadata,
    gates: {
      blockedActions: blockedActionsFor({
        joinFamilyActivation,
        localFamilyEvidence,
        sourceRightsActivationLabels,
      }),
      nextGate: ready
        ? "draft_locked_mhas_endpoint_join_contract"
        : "complete_mhas_source_rights_and_local_family_labels",
      outcomeScoringUnlocked: false,
      rowExecutionUnlocked: false,
      scoringUnlockRequires: [
        "locked_endpoint_join_contract",
        "declared_denominator_policy",
        "declared_survey_weight_policy",
        "aggregate_export_suppression_policy",
        "locked_benchmark_card",
      ],
    },
    inputArtifacts,
    joinFamilyActivation,
    localFamilyEvidence,
    packetId: "r614-mhas-source-rights-activation-labels",
    schemaVersion: R614_MHAS_SOURCE_RIGHTS_ACTIVATION_LABELS_SCHEMA_VERSION,
    sourceRightsActivationLabels,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "mhas_activation_labels_and_contract_metadata_ready_no_execution"
        : "mhas_activation_labels_blocked_no_execution",
      endpointJoinContractReady: ready,
      outcomeScoringUnlockedCountBand: "0",
      productPromotionAuthorized: false,
      sourceRightsLabelsComplete: sourceRightsActivationLabels.activationLabelsComplete,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R614 MHAS source-rights activation labels failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeInputs(
  inputs: Record<ArtifactKey, unknown | null>,
): Record<ArtifactKey, ArtifactSummary> {
  return {
    humanConfirmation: summarizeArtifact("humanConfirmation", inputs.humanConfirmation),
    mhasJoinProbe: summarizeArtifact("mhasJoinProbe", inputs.mhasJoinProbe),
    mhasSourceFeasibility: summarizeArtifact("mhasSourceFeasibility", inputs.mhasSourceFeasibility),
    r611MetadataSourceIntake: summarizeArtifact("r611MetadataSourceIntake", inputs.r611MetadataSourceIntake),
  };
}

function summarizeArtifact(key: ArtifactKey, value: unknown | null): ArtifactSummary {
  const metadata = INPUT_ARTIFACT_METADATA[key];
  if (!value) return { artifact: metadata.artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, metadata.artifact);
  const packetId = optionalString(root.packetId);
  const schemaVersion = optionalString(root.schemaVersion) ?? optionalString(root.schema_version);
  return {
    artifact: metadata.artifact,
    packetId: packetId && metadata.packetIds.includes(packetId) ? packetId : null,
    schemaVersion: schemaVersion && metadata.schemaVersions.includes(schemaVersion) ? schemaVersion : null,
    status: "available",
  };
}

async function inspectLocalFamilyEvidence(input: {
  gatewayDataDir: string;
  rawWaveDataDir: string;
}): Promise<LocalFamilyEvidence> {
  const gatewayNames = await readDirectoryNames(input.gatewayDataDir);
  const rawNames = await readDirectoryNames(input.rawWaveDataDir);
  const gatewayFingerprints = hashFileNames([...gatewayNames].filter(isLocalDataFileName));
  const rawWaveFingerprints = hashFileNames([...rawNames].filter(isLocalDataFileName));
  const gatewayHarmonizedFamily = gatewayFingerprints.has(LOCAL_FILE_FINGERPRINTS.gatewayHarmonized)
    ? "detected"
    : "missing";
  const gatewayEolFamily = gatewayFingerprints.has(LOCAL_FILE_FINGERPRINTS.gatewayEol) ? "detected" : "missing";
  const followUpStatusBridgeFamily = gatewayFingerprints.has(LOCAL_FILE_FINGERPRINTS.followUpStatusBridge)
    ? "detected"
    : "missing";
  const rawWaveSectionStatus = rawWaveFingerprints.size > 0 ? "detected" : "missing";
  const familyStatuses: FamilyStatus[] = [
    gatewayHarmonizedFamily,
    gatewayEolFamily,
    followUpStatusBridgeFamily,
    rawWaveSectionStatus,
  ];
  const activatedCount = familyStatuses.filter((status) => status === "detected").length;
  const allDetected = activatedCount === familyStatuses.length;

  return {
    activatedFamilyCountBand: countBand(activatedCount),
    followUpStatusBridgeFamily,
    gatewayEolFamily,
    gatewayHarmonizedFamily,
    inspected: true,
    rawWaveSectionFamily: {
      fileCountBand: countBand(rawWaveFingerprints.size),
      followUpRoleDetected: [...rawWaveFingerprints].some((hash) => RAW_WAVE_FOLLOW_UP_FINGERPRINTS.has(hash)),
      status: rawWaveSectionStatus,
      supplementalRoleDetected: [...rawWaveFingerprints].some((hash) => RAW_WAVE_SUPPLEMENTAL_FINGERPRINTS.has(hash)),
      waveSpanLabel: waveSpanLabel(rawWaveFingerprints),
    },
    status: allDetected ? "complete" : "incomplete",
  };
}

async function readDirectoryNames(directory: string): Promise<Set<string>> {
  try {
    const stats = await stat(directory);
    if (!stats.isDirectory()) return new Set();
    const entries = await readdir(directory, { withFileTypes: true });
    return new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
      return new Set();
    }
    throw new Error("Failed to inspect MHAS local file-family structure.");
  }
}

function summarizeSourceRightsActivationLabels(value: unknown | null): SourceRightsActivationLabels {
  const root = optionalRecord(value);
  const confirmedCount = root
    ? REQUIRED_CONFIRMATION_FIELDS.filter((field) => root[field] === true).length
    : 0;
  const complete = root !== null && confirmedCount === REQUIRED_CONFIRMATION_FIELDS.length;
  return {
    activationLabelsComplete: complete,
    aggregateOutputLabel: complete ? "aggregate_only_with_suppression_confirmed" : "unconfirmed_human_required",
    confirmationArtifactStatus: root ? "available" : "missing",
    confirmedFieldCountBand: countBand(confirmedCount),
    localResearchUseLabel: complete ? "local_ignored_cache_only_confirmed" : "unconfirmed_human_required",
    productClaimRestrictionLabel: complete ? "no_product_claims_confirmed" : "unconfirmed_human_required",
    reidentificationRestrictionLabel: complete ? "no_reidentification_attempt_confirmed" : "unconfirmed_human_required",
    restrictedLinkageExcluded: root ? root.user_confirms_no_genetic_or_restricted_linkage_use_in_first_pass === true : null,
    rowParsingForScoringUnlocked: false,
    sourceCreditNoticeRequired: root ? root.user_confirms_mhas_credit_and_required_notice === true : null,
    transferRestrictionLabel: complete ? "no_third_party_transfer_confirmed" : "unconfirmed_human_required",
  };
}

function summarizeJoinFamilyActivation(input: {
  localFamilyEvidence: LocalFamilyEvidence;
  mhasJoinProbe: unknown | null;
  r611MetadataSourceIntake: unknown | null;
  sourceRightsActivationLabels: SourceRightsActivationLabels;
}): JoinFamilyActivation {
  const blockerReasons: string[] = [];
  const endpointReady = priorEndpointMetadataReady(input.r611MetadataSourceIntake, input.mhasJoinProbe);
  if (!input.sourceRightsActivationLabels.activationLabelsComplete) {
    blockerReasons.push("missing_human_source_confirmation");
  }
  if (input.localFamilyEvidence.status !== "complete") {
    blockerReasons.push("missing_local_family_artifacts");
  }
  if (!endpointReady) {
    blockerReasons.push("missing_endpoint_metadata");
  }
  return {
    activatedFamilyCountBand: input.localFamilyEvidence.activatedFamilyCountBand,
    blockerReasons,
    localFamilyStatus: input.localFamilyEvidence.status === "complete"
      ? "local_join_families_labeled"
      : "blocked_missing_local_families",
    priorJoinFamilyStatus: priorJoinFamilyStatus(input.r611MetadataSourceIntake, input.mhasJoinProbe),
    readyForEndpointJoinContractMetadata: blockerReasons.length === 0,
  };
}

function summarizeEndpointJoinContractMetadata(
  joinFamilyActivation: JoinFamilyActivation,
): EndpointJoinContractMetadata {
  return {
    aggregateSuppressionPolicy: "required_before_any_result_export",
    contractStatus: joinFamilyActivation.readyForEndpointJoinContractMetadata
      ? "metadata_contract_ready_without_execution"
      : "blocked",
    denominatorPolicy: "must_be_declared_before_row_execution",
    endpointFamily: "mortality_or_followup",
    joinResolutionPolicy: "role_family_contract_only_no_key_names",
    scoringUnlocked: false,
    sourceRoleFamilies: [
      "baseline_harmonized_panel",
      "gateway_eol_endpoint",
      "follow_up_status_bridge",
      "raw_wave_follow_up_sections",
    ],
  };
}

function blockedActionsFor(input: {
  joinFamilyActivation: JoinFamilyActivation;
  localFamilyEvidence: LocalFamilyEvidence;
  sourceRightsActivationLabels: SourceRightsActivationLabels;
}): string[] {
  return dedupeLabels([
    ...input.joinFamilyActivation.blockerReasons,
    input.sourceRightsActivationLabels.activationLabelsComplete ? null : "source_rights_labels_incomplete",
    input.localFamilyEvidence.status === "complete" ? null : "local_family_labels_incomplete",
    "row_execution_until_locked_endpoint_join_contract",
    "outcome_scoring_until_locked_benchmark",
    "model_mutation_until_execution_gate",
    "product_claims_blocked",
  ]);
}

function priorEndpointMetadataReady(r611: unknown | null, joinProbe: unknown | null): boolean {
  const r611Endpoint = optionalRecord(optionalRecord(r611)?.joinAndEndpointMetadata);
  const joinEndpoint = optionalRecord(optionalRecord(joinProbe)?.endpointEolMetadataStatus);
  return optionalString(r611Endpoint?.eolEndpointMetadataStatus) === "endpoint_metadata_ready_for_contract"
    || optionalString(joinEndpoint?.status) === "endpoint_metadata_ready_for_contract";
}

function priorJoinFamilyStatus(r611: unknown | null, joinProbe: unknown | null): string | null {
  const r611Join = optionalRecord(optionalRecord(r611)?.joinAndEndpointMetadata);
  const join = optionalRecord(optionalRecord(joinProbe)?.joinFeasibility);
  return optionalAllowlistedMetadataLabel(r611Join?.joinKeyFamilyStatus, PRIOR_JOIN_FAMILY_STATUS_LABELS)
    ?? optionalAllowlistedMetadataLabel(join?.joinKeyFamilyStatus, PRIOR_JOIN_FAMILY_STATUS_LABELS);
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value || key === "humanConfirmation") continue;
    const root = requiredRecord(value, `${key} input`);
    const boundary = root.boundary ?? root.artifactBoundary;
    if (boundary !== undefined) assertBoundaryFlags(boundary, `${key} boundary`);
  }
}

function assertBoundaryFlags(value: unknown, label: string): void {
  const boundary = requiredRecord(value, label);
  for (const key of [
    "codebookProseStored",
    "codebookTextStored",
    "coefficientsStored",
    "localPathsStored",
    "modelParametersStored",
    "modelScoringPerformed",
    "outcomeScoringPerformed",
    "participantIdentifiersStored",
    "participantIdentifiersWritten",
    "predictionsStored",
    "productClaimsIncluded",
    "productDisplayAuthorized",
    "productPromotionAuthorized",
    "rowParsingPerformed",
    "rowValuesStored",
    "smallCellsStored",
    "sourceBodiesStored",
    "splitMembershipStored",
    "variableLabelsStored",
    "variableNamesStored",
  ]) {
    if (boundary[key] !== undefined && boundary[key] !== false) {
      throw new Error(`${label} flag ${key} must be false.`);
    }
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read an aggregate MHAS metadata artifact.");
  }
}

function waveSpanLabel(fileNameFingerprints: Set<string>): LocalFamilyEvidence["rawWaveSectionFamily"]["waveSpanLabel"] {
  if (fileNameFingerprints.size === 0) return "none";
  const waves = new Set(
    [...fileNameFingerprints]
      .map((fingerprint) => RAW_WAVE_SPAN_FINGERPRINT_BUCKETS.get(fingerprint))
      .filter(isString),
  );
  if (waves.size === 0) return "none";
  return waves.size > 1 ? "multi_wave" : "single_wave";
}

function hashFileNames(names: string[]): Set<string> {
  return new Set(names.map(fileNameFingerprint));
}

function fileNameFingerprint(name: string): string {
  return createHash("sha256").update(name, "utf8").digest("hex");
}

function isLocalDataFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".dta");
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

function optionalMetadataLabel(value: unknown, label: string): string | null {
  return typeof value === "string" && value.length > 0 ? requiredMetadataLabel(value, label) : null;
}

function optionalAllowlistedMetadataLabel(value: unknown, allowedLabels: readonly string[]): string | null {
  const label = optionalString(value);
  return label && allowedLabels.includes(label) ? label : null;
}

function requiredMetadataLabel(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    /[\r\n\t/\\]/u.test(value) ||
    /\b(?:authorization|codebook|coefficient|identifier|participant|prediction|raw\s*row|row\s*value|source\s*body|source\s*text|split\s*id)\b/iu.test(value)
  ) {
    throw new Error(`${label} is not a safe metadata label.`);
  }
  return value;
}

function dedupeLabels(values: Array<string | null>): string[] {
  return [...new Set(values.filter(isString).map((value) => requiredMetadataLabel(value, "blocked action")))].sort();
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function countBand(count: number): string {
  if (count <= 0) return "0";
  if (count < 5) return "1-4";
  if (count < 10) return "5-9";
  return "10+";
}

async function main(): Promise<void> {
  const { output } = await runR614MhasSourceRightsActivationLabels({
    confirmationPath: process.env.MURPH_AGE_MHAS_SOURCE_CONFIRMATION_PATH,
    gatewayDataDir: process.env.MURPH_AGE_MHAS_GATEWAY_DATA_DIR,
    mhasJoinProbePath: process.env.MURPH_AGE_MHAS_JOIN_PROBE_PATH,
    mhasSourceFeasibilityPath: process.env.MURPH_AGE_MHAS_SOURCE_FEASIBILITY_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r611Path: process.env.MURPH_AGE_R611_MHAS_SOURCE_INTAKE_PATH,
    rawWaveDataDir: process.env.MURPH_AGE_MHAS_RAW_WAVE_DATA_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    conclusion: output.summary.conclusion,
    endpointJoinContractReady: output.summary.endpointJoinContractReady,
    nextGate: output.gates.nextGate,
    outcomeScoringUnlockedCountBand: output.summary.outcomeScoringUnlockedCountBand,
    packetId: output.packetId,
    productPromotionAuthorized: output.summary.productPromotionAuthorized,
    rowExecutionUnlocked: output.gates.rowExecutionUnlocked,
    schemaVersion: output.schemaVersion,
    sourceRightsLabelsComplete: output.summary.sourceRightsLabelsComplete,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R614 MHAS source-rights activation labels failed."}\n`);
    process.exitCode = 1;
  });
}
