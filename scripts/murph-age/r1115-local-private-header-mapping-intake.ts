import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1115_LOCAL_PRIVATE_HEADER_MAPPING_INTAKE_SCHEMA_VERSION =
  "murph-age-r1115-local-private-header-mapping-intake.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1115-local-private-header-mapping-intake.latest.json";

const R1114_EXPECTED = {
  artifact: "r1114-local-wearable-outcome-join-probe.latest.json",
  packetId: "r1114-local-wearable-outcome-join-probe",
  schemaVersion: "murph-age-r1114-local-wearable-outcome-join-probe.v1",
} as const;

const MAPPING_SCHEMA_VERSION = "murph-age-local-private-header-mapping.v1" as const;
const UNSAFE_MAPPING_KEYS = new Set([
  "column",
  "columnname",
  "columns",
  "filename",
  "filenames",
  "filepath",
  "filepaths",
  "header",
  "headername",
  "headers",
  "localpath",
  "localpaths",
  "path",
  "paths",
  "rawheader",
  "rawheaders",
  "row",
  "rows",
  "sourcefield",
  "sourcefields",
  "sourcevariable",
  "sourcevariablename",
  "sourcevariablenames",
  "value",
  "values",
  "variable",
  "variablename",
  "variables",
]);

type CountBand = "0" | "1" | "2-9" | "10-99" | "100+";
type SemanticCategory =
  | "commonLabCore"
  | "dateOrTimeKey"
  | "labGlycemia"
  | "outcomeEvent"
  | "personJoinKey"
  | "vitalsBody"
  | "wearableActivity"
  | "wearableRecovery"
  | "wearableSleep";
type Conclusion =
  | "local_private_header_mapping_incomplete"
  | "local_private_header_mapping_not_provided"
  | "local_private_header_mapping_ready_for_local_aggregate_receipt"
  | "local_private_header_mapping_waiting_on_join_probe";
type NextAction =
  | "build_local_aggregate_receipt_from_private_mapping"
  | "complete_required_private_mapping_categories"
  | "fill_private_header_mapping_before_local_receipt"
  | "regenerate_local_wearable_outcome_join_probe";

interface ArtifactSummary {
  artifact: typeof R1114_EXPECTED.artifact;
  packetId: typeof R1114_EXPECTED.packetId | null;
  schemaVersion: typeof R1114_EXPECTED.schemaVersion | null;
  status: "available" | "missing";
}

interface PrivateHeaderMappingInput {
  attestations?: {
    localOnly?: boolean;
    noHeaderNamesInOutput?: boolean;
    noRowsIncluded?: boolean;
    noSourceTextIncluded?: boolean;
  };
  mappings?: Partial<Record<SemanticCategory, { present?: boolean } | boolean>>;
  schemaVersion?: typeof MAPPING_SCHEMA_VERSION;
}

interface SemanticCoverage {
  commonLabCore: boolean;
  dateOrTimeKey: boolean;
  labGlycemia: boolean;
  outcomeEvent: boolean;
  personJoinKey: boolean;
  vitalsBody: boolean;
  wearableActivity: boolean;
  wearableRecovery: boolean;
  wearableSleep: boolean;
}

export interface R1115LocalPrivateHeaderMappingIntakeOptions {
  createdAt?: string;
  mappingPath?: string;
  outputDir?: string;
  r1114Path?: string;
}

export interface R1115LocalPrivateHeaderMappingIntakeOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    mappingPathStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1115: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1115: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1114: ArtifactSummary;
  };
  mappingIntake: {
    attestationStatus: "complete" | "missing_or_false" | "not_provided";
    blockedMappingContent: [
      "header_names",
      "source_variable_names",
      "file_names",
      "local_paths",
      "row_values",
      "participant_identifiers",
      "source_text",
    ];
    completedCategoryCountBand: CountBand;
    mappingPathConfigured: boolean;
    mappingSchemaVersion: typeof MAPPING_SCHEMA_VERSION | null;
    privateMappingStatus: "available" | "missing";
    semanticCoverage: SemanticCoverage;
    semanticOnlyBooleansStored: true;
  };
  packetId: "r1115-local-private-header-mapping-intake";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1115_LOCAL_PRIVATE_HEADER_MAPPING_INTAKE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: Conclusion;
    nextAction: NextAction;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1115: false;
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1115LocalPrivateHeaderMappingIntake(
  options: R1115LocalPrivateHeaderMappingIntakeOptions = {},
): Promise<{ output: R1115LocalPrivateHeaderMappingIntakeOutput; outputPath: string }> {
  const r1114 = await readJsonIfPresent(options.r1114Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1114_EXPECTED.artifact));
  validateInputBoundary("r1114", r1114);
  const mapping = await readMapping(options.mappingPath ?? process.env.MURPH_AGE_LOCAL_PRIVATE_HEADER_MAPPING_PATH);
  const mappingPathConfigured = Boolean((options.mappingPath ?? process.env.MURPH_AGE_LOCAL_PRIVATE_HEADER_MAPPING_PATH)?.trim());
  const r1114ReadyForMapping = inputMatchesExpected(r1114)
    && (
      readStringAt(r1114, ["summary", "conclusion"]) === "local_wearable_outcome_headers_need_human_mapping"
      || readStringAt(r1114, ["summary", "conclusion"]) === "local_wearable_outcome_headers_potential_person_join"
    );
  const coverage = mapping ? semanticCoverageFor(mapping) : emptySemanticCoverage();
  const attestationComplete = mapping ? mappingAttestationsComplete(mapping) : false;
  const mappingReady = attestationComplete && semanticCoverageReady(coverage);
  const conclusion = conclusionFor({
    mapping,
    mappingReady,
    r1114ReadyForMapping,
  });

  const output: R1115LocalPrivateHeaderMappingIntakeOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1114: summarizeR1114(r1114),
    },
    mappingIntake: {
      attestationStatus: mapping ? attestationComplete ? "complete" : "missing_or_false" : "not_provided",
      blockedMappingContent: [
        "header_names",
        "source_variable_names",
        "file_names",
        "local_paths",
        "row_values",
        "participant_identifiers",
        "source_text",
      ],
      completedCategoryCountBand: countBand(countCompletedCategories(coverage)),
      mappingPathConfigured,
      mappingSchemaVersion: mapping?.schemaVersion === MAPPING_SCHEMA_VERSION ? MAPPING_SCHEMA_VERSION : null,
      privateMappingStatus: mapping ? "available" : "missing",
      semanticCoverage: coverage,
      semanticOnlyBooleansStored: true,
    },
    packetId: "r1115-local-private-header-mapping-intake",
    productDisplayAuthorized: false,
    schemaVersion: R1115_LOCAL_PRIVATE_HEADER_MAPPING_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextAction: nextActionFor(conclusion),
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1115: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1115 local private header mapping intake failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  mapping: PrivateHeaderMappingInput | null;
  mappingReady: boolean;
  r1114ReadyForMapping: boolean;
}): Conclusion {
  if (!input.r1114ReadyForMapping) return "local_private_header_mapping_waiting_on_join_probe";
  if (!input.mapping) return "local_private_header_mapping_not_provided";
  if (input.mappingReady) return "local_private_header_mapping_ready_for_local_aggregate_receipt";
  return "local_private_header_mapping_incomplete";
}

function nextActionFor(conclusion: Conclusion): NextAction {
  if (conclusion === "local_private_header_mapping_ready_for_local_aggregate_receipt") {
    return "build_local_aggregate_receipt_from_private_mapping";
  }
  if (conclusion === "local_private_header_mapping_not_provided") {
    return "fill_private_header_mapping_before_local_receipt";
  }
  if (conclusion === "local_private_header_mapping_incomplete") {
    return "complete_required_private_mapping_categories";
  }
  return "regenerate_local_wearable_outcome_join_probe";
}

async function readMapping(filePath?: string): Promise<PrivateHeaderMappingInput | null> {
  if (!filePath?.trim()) return null;
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const unsafeSignals = countUnsafeMappingSignals(parsed);
  if (unsafeSignals > 0) {
    throw new Error(`R1115 rejected unsafe private mapping: ${unsafeSignals} unsafe mapping shape signal${unsafeSignals === 1 ? "" : "s"}.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("R1115 private mapping must be a JSON object.");
  }
  return parsed as PrivateHeaderMappingInput;
}

function countUnsafeMappingSignals(value: unknown): number {
  let count = 0;
  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      count += 1;
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
      if (UNSAFE_MAPPING_KEYS.has(normalized)) count += 1;
      if (typeof child === "string" || typeof child === "number") {
        if (normalized !== "schemaversion") count += 1;
        continue;
      }
      visit(child);
    }
  }
  visit(value);
  return count;
}

function mappingAttestationsComplete(mapping: PrivateHeaderMappingInput): boolean {
  return mapping.schemaVersion === MAPPING_SCHEMA_VERSION
    && mapping.attestations?.localOnly === true
    && mapping.attestations.noHeaderNamesInOutput === true
    && mapping.attestations.noRowsIncluded === true
    && mapping.attestations.noSourceTextIncluded === true;
}

function semanticCoverageFor(mapping: PrivateHeaderMappingInput): SemanticCoverage {
  const mappings = mapping.mappings ?? {};
  return {
    commonLabCore: categoryPresent(mappings.commonLabCore),
    dateOrTimeKey: categoryPresent(mappings.dateOrTimeKey),
    labGlycemia: categoryPresent(mappings.labGlycemia),
    outcomeEvent: categoryPresent(mappings.outcomeEvent),
    personJoinKey: categoryPresent(mappings.personJoinKey),
    vitalsBody: categoryPresent(mappings.vitalsBody),
    wearableActivity: categoryPresent(mappings.wearableActivity),
    wearableRecovery: categoryPresent(mappings.wearableRecovery),
    wearableSleep: categoryPresent(mappings.wearableSleep),
  };
}

function categoryPresent(value: { present?: boolean } | boolean | undefined): boolean {
  if (typeof value === "boolean") return value;
  return value?.present === true;
}

function semanticCoverageReady(coverage: SemanticCoverage): boolean {
  return coverage.personJoinKey
    && coverage.dateOrTimeKey
    && coverage.outcomeEvent
    && (coverage.wearableActivity || coverage.wearableSleep || coverage.wearableRecovery)
    && (coverage.labGlycemia || coverage.vitalsBody || coverage.commonLabCore);
}

function countCompletedCategories(coverage: SemanticCoverage): number {
  return Object.values(coverage).filter(Boolean).length;
}

function emptySemanticCoverage(): SemanticCoverage {
  return {
    commonLabCore: false,
    dateOrTimeKey: false,
    labGlycemia: false,
    outcomeEvent: false,
    personJoinKey: false,
    vitalsBody: false,
    wearableActivity: false,
    wearableRecovery: false,
    wearableSleep: false,
  };
}

function summarizeR1114(input: unknown | null): ArtifactSummary {
  const packetId = readStringAt(input, ["packetId"]);
  const schemaVersion = readStringAt(input, ["schemaVersion"]);
  return {
    artifact: R1114_EXPECTED.artifact,
    packetId: packetId === R1114_EXPECTED.packetId ? R1114_EXPECTED.packetId : null,
    schemaVersion: schemaVersion === R1114_EXPECTED.schemaVersion ? R1114_EXPECTED.schemaVersion : null,
    status: input ? "available" : "missing",
  };
}

function inputMatchesExpected(input: unknown | null): boolean {
  return readStringAt(input, ["packetId"]) === R1114_EXPECTED.packetId
    && readStringAt(input, ["schemaVersion"]) === R1114_EXPECTED.schemaVersion;
}

function validateInputBoundary(label: "r1114", input: unknown | null): void {
  if (!input) return;
  const findings = findForbiddenAggregateEgress(input);
  if (findings.length > 0) {
    throw new Error(`R1115 rejected unsafe ${label} input: ${formatFindingCount(findings)}`);
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : null;
}

function countBand(count: number): CountBand {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count < 10) return "2-9";
  if (count < 100) return "10-99";
  return "100+";
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

function safeBoundary(): R1115LocalPrivateHeaderMappingIntakeOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    mappingPathStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1115: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1115: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1115LocalPrivateHeaderMappingIntake({
    mappingPath: process.env.MURPH_AGE_LOCAL_PRIVATE_HEADER_MAPPING_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1114Path: process.env.MURPH_AGE_R1114_LOCAL_JOIN_PROBE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    completedCategoryCountBand: output.mappingIntake.completedCategoryCountBand,
    conclusion: output.summary.conclusion,
    mappingPathConfigured: output.mappingIntake.mappingPathConfigured,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1115: output.summary.rowParsingPerformedByR1115,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetInputPriority: output.summary.targetInputPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1115 local private header mapping intake failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
