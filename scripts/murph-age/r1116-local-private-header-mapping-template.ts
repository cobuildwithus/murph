import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1115LocalPrivateHeaderMappingIntake } from "./r1115-local-private-header-mapping-intake.ts";

export const R1116_LOCAL_PRIVATE_HEADER_MAPPING_TEMPLATE_SCHEMA_VERSION =
  "murph-age-r1116-local-private-header-mapping-template.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1116-local-private-header-mapping-template.latest.json";
const TEMPLATE_FILE_NAME = "r1116-fillable-private-header-mapping-template.json";

const R1115_EXPECTED = {
  artifact: "r1115-local-private-header-mapping-intake.latest.json",
  packetId: "r1115-local-private-header-mapping-intake",
  schemaVersion: "murph-age-r1115-local-private-header-mapping-intake.v1",
} as const;
const MAPPING_SCHEMA_VERSION = "murph-age-local-private-header-mapping.v1" as const;

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

interface ArtifactSummary {
  artifact: typeof R1115_EXPECTED.artifact;
  packetId: typeof R1115_EXPECTED.packetId | null;
  schemaVersion: typeof R1115_EXPECTED.schemaVersion | null;
  status: "available" | "missing";
}

interface FillablePrivateHeaderMappingTemplate {
  attestations: {
    localOnly: true;
    noHeaderNamesInOutput: true;
    noRowsIncluded: true;
    noSourceTextIncluded: true;
  };
  mappings: Record<SemanticCategory, { present: boolean }>;
  schemaVersion: typeof MAPPING_SCHEMA_VERSION;
}

export interface R1116LocalPrivateHeaderMappingTemplateOptions {
  createdAt?: string;
  outputDir?: string;
  r1115Path?: string;
}

export interface R1116LocalPrivateHeaderMappingTemplateOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1116: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1116: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1115: ArtifactSummary;
  };
  mappingTemplate: {
    blockedTemplateContent: [
      "header_names",
      "source_variable_names",
      "file_names",
      "local_paths",
      "row_values",
      "participant_identifiers",
      "source_text",
    ];
    categoriesToFill: SemanticCategory[];
    initialPresentValues: "all_false";
    r1115TemplateValidationConclusion: "local_private_header_mapping_incomplete";
    semanticOnlyBooleansStored: true;
    templateArtifact: typeof TEMPLATE_FILE_NAME;
    validationCommand: "MURPH_AGE_LOCAL_PRIVATE_HEADER_MAPPING_PATH=<mapping.json> pnpm exec tsx scripts/murph-age/r1115-local-private-header-mapping-intake.ts";
  };
  packetId: "r1116-local-private-header-mapping-template";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1116_LOCAL_PRIVATE_HEADER_MAPPING_TEMPLATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: "local_private_header_mapping_template_ready";
    nextAction: "fill_semantic_boolean_template_then_run_r1115";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1116: false;
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1116LocalPrivateHeaderMappingTemplate(
  options: R1116LocalPrivateHeaderMappingTemplateOptions = {},
): Promise<{ output: R1116LocalPrivateHeaderMappingTemplateOutput; outputPath: string; templatePath: string }> {
  const r1115 = await readJsonIfPresent(options.r1115Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1115_EXPECTED.artifact));
  validateInputBoundary(r1115);
  const fillableTemplate = createFillableTemplate();
  const validationConclusion = await validateTemplateWithR1115(fillableTemplate);
  const output: R1116LocalPrivateHeaderMappingTemplateOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1115: summarizeR1115(r1115),
    },
    mappingTemplate: {
      blockedTemplateContent: [
        "header_names",
        "source_variable_names",
        "file_names",
        "local_paths",
        "row_values",
        "participant_identifiers",
        "source_text",
      ],
      categoriesToFill: semanticCategories(),
      initialPresentValues: "all_false",
      r1115TemplateValidationConclusion: validationConclusion,
      semanticOnlyBooleansStored: true,
      templateArtifact: TEMPLATE_FILE_NAME,
      validationCommand:
        "MURPH_AGE_LOCAL_PRIVATE_HEADER_MAPPING_PATH=<mapping.json> pnpm exec tsx scripts/murph-age/r1115-local-private-header-mapping-intake.ts",
    },
    packetId: "r1116-local-private-header-mapping-template",
    productDisplayAuthorized: false,
    schemaVersion: R1116_LOCAL_PRIVATE_HEADER_MAPPING_TEMPLATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "local_private_header_mapping_template_ready",
      nextAction: "fill_semantic_boolean_template_then_run_r1115",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1116: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenAggregateEgress(fillableTemplate),
  ];
  if (findings.length > 0) {
    throw new Error(`R1116 local private header mapping template failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const templatePath = path.join(outputDir, TEMPLATE_FILE_NAME);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(templatePath, `${JSON.stringify(fillableTemplate, null, 2)}\n`),
  ]);
  return { output, outputPath, templatePath };
}

function createFillableTemplate(): FillablePrivateHeaderMappingTemplate {
  return {
    attestations: {
      localOnly: true,
      noHeaderNamesInOutput: true,
      noRowsIncluded: true,
      noSourceTextIncluded: true,
    },
    mappings: Object.fromEntries(
      semanticCategories().map((category) => [category, { present: false }]),
    ) as Record<SemanticCategory, { present: boolean }>,
    schemaVersion: MAPPING_SCHEMA_VERSION,
  };
}

async function validateTemplateWithR1115(
  template: FillablePrivateHeaderMappingTemplate,
): Promise<R1116LocalPrivateHeaderMappingTemplateOutput["mappingTemplate"]["r1115TemplateValidationConclusion"]> {
  const tmp = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "murph-age-r1116-r1115-")));
  try {
    const mappingPath = path.join(tmp, "mapping.json");
    const r1114Path = path.join(tmp, "r1114.json");
    await Promise.all([
      writeFile(mappingPath, `${JSON.stringify(template, null, 2)}\n`),
      writeFile(r1114Path, `${JSON.stringify(r1114ReadyForMapping(), null, 2)}\n`),
    ]);
    const { output } = await runR1115LocalPrivateHeaderMappingIntake({
      mappingPath,
      outputDir: tmp,
      r1114Path,
    });
    if (output.summary.conclusion !== "local_private_header_mapping_incomplete") {
      throw new Error("R1116 fillable template should validate as incomplete until semantic categories are filled.");
    }
    return output.summary.conclusion;
  } finally {
    await import("node:fs/promises").then(({ rm }) => rm(tmp, { force: true, recursive: true }));
  }
}

function r1114ReadyForMapping(): unknown {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformedByR1114: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1114: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    packetId: "r1114-local-wearable-outcome-join-probe",
    schemaVersion: "murph-age-r1114-local-wearable-outcome-join-probe.v1",
    summary: {
      conclusion: "local_wearable_outcome_headers_need_human_mapping",
    },
  };
}

function semanticCategories(): SemanticCategory[] {
  return [
    "personJoinKey",
    "dateOrTimeKey",
    "outcomeEvent",
    "labGlycemia",
    "commonLabCore",
    "vitalsBody",
    "wearableActivity",
    "wearableSleep",
    "wearableRecovery",
  ];
}

function summarizeR1115(input: unknown | null): ArtifactSummary {
  const packetId = readStringAt(input, ["packetId"]);
  const schemaVersion = readStringAt(input, ["schemaVersion"]);
  return {
    artifact: R1115_EXPECTED.artifact,
    packetId: packetId === R1115_EXPECTED.packetId ? R1115_EXPECTED.packetId : null,
    schemaVersion: schemaVersion === R1115_EXPECTED.schemaVersion ? R1115_EXPECTED.schemaVersion : null,
    status: input ? "available" : "missing",
  };
}

function validateInputBoundary(input: unknown | null): void {
  if (!input) return;
  const findings = findForbiddenAggregateEgress(input);
  if (findings.length > 0) {
    throw new Error(`R1116 rejected unsafe r1115 input: ${formatFindingCount(findings)}`);
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

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1116LocalPrivateHeaderMappingTemplateOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1116: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1116: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1116LocalPrivateHeaderMappingTemplate({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1115Path: process.env.MURPH_AGE_R1115_LOCAL_PRIVATE_MAPPING_INTAKE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    categoriesToFill: output.mappingTemplate.categoriesToFill,
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1116: output.summary.rowParsingPerformedByR1116,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetInputPriority: output.summary.targetInputPriority,
    templateArtifact: output.mappingTemplate.templateArtifact,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1116 local private header mapping template failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
