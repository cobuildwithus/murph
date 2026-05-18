import { createReadStream } from "node:fs";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { R1078_DEFAULT_ANALYTIC_CACHE_PATH } from "./r1078-nsrr-sleep-autonomic-local-loop.ts";
import {
  R1079_DEFAULT_PRIVATE_MANIFEST_PATH,
  R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION,
} from "./r1079-nsrr-sleep-autonomic-standardizer.ts";

export const R1080_NSRR_STANDARDIZER_MANIFEST_SCAFFOLD_SCHEMA_VERSION =
  "murph-age-r1080-nsrr-standardizer-manifest-scaffold.v1" as const;

export const R1080_DEFAULT_PRIVATE_MANIFEST_DRAFT_PATH = path.join(
  path.dirname(R1079_DEFAULT_PRIVATE_MANIFEST_PATH),
  "nsrr-sleep-autonomic-standardizer-manifest.draft.json",
);

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1080-nsrr-standardizer-manifest-scaffold.latest.json";
const PRIVATE_MANIFEST_ROOT = path.dirname(R1079_DEFAULT_PRIVATE_MANIFEST_PATH);
const ANALYTIC_CACHE_ROOT = path.dirname(R1078_DEFAULT_ANALYTIC_CACHE_PATH);

const REQUIRED_GENERIC_FIELDS = ["age_years", "primary_event", "sex_stratum"] as const;
const GENERIC_FIELD_FAMILIES = [
  "split_or_row_index_split_policy",
  "endpoint_indicator",
  "age_and_sex",
  "optional_weight_and_eligibility",
  "clinical_context",
  "sleep_duration_regularity",
  "sleep_breathing_autonomic",
  "activity_and_coverage_quality",
] as const;

export interface R1080NsrrStandardizerManifestScaffoldOptions {
  createdAt?: string;
  delimiter?: "," | "\t";
  manifestDraftPath?: string;
  outputAnalyticCachePath?: string;
  outputDir?: string;
  sourceFormat?: "csv" | "tsv";
  sourceTablePath?: string;
}

export interface R1080NsrrStandardizerManifestScaffoldOutput {
  artifactBoundary: {
    aggregateOnlyExternalOutput: true;
    codebookTextStored: false;
    headerValuesStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    privateDraftManifestWritten: true;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowValuesRead: false;
    rowValuesStored: false;
    sourceBodiesStored: false;
    sourceHeaderReadOnly: true;
    sourceSpecificColumnNamesStored: false;
  };
  createdAt: string;
  draftManifest: {
    draftRequiresPrivateColumnMapFill: true;
    headerColumnCountBand: string;
    privateDraftContainsSourceHeaders: true;
    privateDraftScope: "ignored_local_runtime_cache_only";
    sourceFormat: "csv_or_tsv";
  };
  nextStep: {
    conclusion: "nsrr_private_manifest_draft_ready_for_local_fill";
    nextLocalAction: "fill_private_manifest_column_map_then_run_r1079";
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  packetId: "r1080-nsrr-standardizer-manifest-scaffold";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1080_NSRR_STANDARDIZER_MANIFEST_SCAFFOLD_SCHEMA_VERSION;
  standardizerContract: {
    genericFieldFamilies: readonly string[];
    requiredGenericFieldCountBand: string;
    sourceSpecificColumnMapStoredInGit: false;
  };
  status: "research-local-private-draft-plus-aggregate-receipt";
  summary: {
    draftManifestWritten: true;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowValuesRead: false;
    rowValuesStored: false;
    sourceSpecificColumnNamesInExternalArtifact: false;
  };
}

interface DraftManifest {
  availableSourceColumns: string[];
  columnMap: Record<string, never>;
  delimiter: "," | "\t";
  endpoint: "fill_one_of_allowed_endpoint_values";
  genericFieldFamilies: readonly string[];
  horizon: "fill_one_of_allowed_horizon_values";
  outputAnalyticCachePath: string;
  requiredGenericFields: readonly string[];
  schemaVersion: typeof R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION;
  sourceFormat: "csv" | "tsv";
  sourceTablePath: string;
  splitPolicy: { type: "row_index_modulo" };
}

export async function runR1080NsrrStandardizerManifestScaffold(
  options: R1080NsrrStandardizerManifestScaffoldOptions = {},
): Promise<{ output: R1080NsrrStandardizerManifestScaffoldOutput; outputPath: string }> {
  const sourceTablePath = options.sourceTablePath?.trim();
  if (!sourceTablePath) {
    throw new Error("R1080 requires a local NSRR source table path.");
  }
  await access(sourceTablePath);

  const manifestDraftPath = options.manifestDraftPath ?? R1080_DEFAULT_PRIVATE_MANIFEST_DRAFT_PATH;
  const outputAnalyticCachePath = options.outputAnalyticCachePath ?? R1078_DEFAULT_ANALYTIC_CACHE_PATH;
  assertPrivateDraftPath(manifestDraftPath);
  assertAnalyticCachePath(outputAnalyticCachePath);

  const { delimiter, header } = await readHeader(sourceTablePath, options.delimiter ?? delimiterFromFormat(options.sourceFormat));
  const sourceFormat = delimiter === "\t" ? "tsv" : "csv";
  const draft: DraftManifest = {
    availableSourceColumns: header,
    columnMap: {},
    delimiter,
    endpoint: "fill_one_of_allowed_endpoint_values",
    genericFieldFamilies: GENERIC_FIELD_FAMILIES,
    horizon: "fill_one_of_allowed_horizon_values",
    outputAnalyticCachePath,
    requiredGenericFields: REQUIRED_GENERIC_FIELDS,
    schemaVersion: R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION,
    sourceFormat,
    sourceTablePath,
    splitPolicy: { type: "row_index_modulo" },
  };

  await ensurePrivateDirectory(path.dirname(manifestDraftPath));
  await writeFile(manifestDraftPath, `${JSON.stringify(draft, null, 2)}\n`, { mode: 0o600 });

  const output: R1080NsrrStandardizerManifestScaffoldOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    draftManifest: {
      draftRequiresPrivateColumnMapFill: true,
      headerColumnCountBand: countBand(header.length),
      privateDraftContainsSourceHeaders: true,
      privateDraftScope: "ignored_local_runtime_cache_only",
      sourceFormat: "csv_or_tsv",
    },
    nextStep: {
      conclusion: "nsrr_private_manifest_draft_ready_for_local_fill",
      nextLocalAction: "fill_private_manifest_column_map_then_run_r1079",
      reviewGptRequiredBeforeNextLocalRun: false,
    },
    packetId: "r1080-nsrr-standardizer-manifest-scaffold",
    productDisplayAuthorized: false,
    schemaVersion: R1080_NSRR_STANDARDIZER_MANIFEST_SCAFFOLD_SCHEMA_VERSION,
    standardizerContract: {
      genericFieldFamilies: GENERIC_FIELD_FAMILIES,
      requiredGenericFieldCountBand: countBand(REQUIRED_GENERIC_FIELDS.length),
      sourceSpecificColumnMapStoredInGit: false,
    },
    status: "research-local-private-draft-plus-aggregate-receipt",
    summary: {
      draftManifestWritten: true,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowValuesRead: false,
      rowValuesStored: false,
      sourceSpecificColumnNamesInExternalArtifact: false,
    },
  };

  assertR1080Safe(output, { header, manifestDraftPath, outputAnalyticCachePath, sourceTablePath });
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

export function assertR1080Safe(
  output: R1080NsrrStandardizerManifestScaffoldOutput,
  privateTokens: {
    header: readonly string[];
    manifestDraftPath: string;
    outputAnalyticCachePath: string;
    sourceTablePath: string;
  },
): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1080SpecificFindings(output, privateTokens),
  ];
  if (findings.length > 0) {
    throw new Error(`R1080 NSRR manifest scaffold failed safety validation: ${findings.join("; ")}`);
  }
}

async function readHeader(
  filePath: string,
  requestedDelimiter: "," | "\t" | undefined,
): Promise<{ delimiter: "," | "\t"; header: string[] }> {
  const rl = createInterface({ crlfDelay: Infinity, input: sourceReadStream(filePath) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const delimiter = requestedDelimiter ?? inferDelimiter(line);
    return {
      delimiter,
      header: parseDelimitedLine(line, delimiter).map((column) => column.trim()).filter(Boolean),
    };
  }
  throw new Error("R1080 could not read a source header from the local NSRR table.");
}

function sourceReadStream(filePath: string) {
  const stream = createReadStream(filePath);
  return filePath.endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
}

function inferDelimiter(line: string): "," | "\t" {
  return line.split("\t").length > line.split(",").length ? "\t" : ",";
}

function delimiterFromFormat(sourceFormat: "csv" | "tsv" | undefined): "," | "\t" | undefined {
  if (sourceFormat === "csv") return ",";
  if (sourceFormat === "tsv") return "\t";
  return undefined;
}

function parseDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === "\"" && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function assertPrivateDraftPath(filePath: string): void {
  const resolved = path.resolve(filePath);
  const root = path.resolve(PRIVATE_MANIFEST_ROOT);
  if (!isPathInside(resolved, root) || !resolved.endsWith(".draft.json")) {
    throw new Error("R1080 draft manifest output must stay under the ignored NSRR private-map runtime cache root.");
  }
}

async function ensurePrivateDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { mode: 0o700, recursive: true });
  await chmod(directoryPath, 0o700);
}

function assertAnalyticCachePath(filePath: string): void {
  const resolved = path.resolve(filePath);
  const root = path.resolve(ANALYTIC_CACHE_ROOT);
  if (!isPathInside(resolved, root) || !resolved.endsWith(".csv.gz")) {
    throw new Error("R1080 analytic cache target must stay under the ignored NSRR analytic runtime cache root.");
  }
}

function isPathInside(filePath: string, root: string): boolean {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeBoundary(): R1080NsrrStandardizerManifestScaffoldOutput["artifactBoundary"] {
  return {
    aggregateOnlyExternalOutput: true,
    codebookTextStored: false,
    headerValuesStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    privateDraftManifestWritten: true,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowValuesRead: false,
    rowValuesStored: false,
    sourceBodiesStored: false,
    sourceHeaderReadOnly: true,
    sourceSpecificColumnNamesStored: false,
  };
}

function findR1080SpecificFindings(
  output: R1080NsrrStandardizerManifestScaffoldOutput,
  privateTokens: {
    header: readonly string[];
    manifestDraftPath: string;
    outputAnalyticCachePath: string;
    sourceTablePath: string;
  },
): string[] {
  const findings: string[] = [];
  const serialized = JSON.stringify(output);
  for (const token of privateTokenList(privateTokens)) {
    if (token.length >= 3 && serialized.includes(token)) {
      findings.push("private source or manifest token egress");
      break;
    }
  }
  if (output.productDisplayAuthorized !== false || output.summary.productDisplayAuthorized !== false) {
    findings.push("product display must remain locked");
  }
  return findings;
}

function privateTokenList(input: {
  header: readonly string[];
  manifestDraftPath: string;
  outputAnalyticCachePath: string;
  sourceTablePath: string;
}): string[] {
  return [
    path.basename(input.manifestDraftPath),
    path.basename(input.outputAnalyticCachePath),
    path.basename(input.sourceTablePath),
    input.manifestDraftPath,
    input.outputAnalyticCachePath,
    input.sourceTablePath,
    ...input.header,
  ].filter((token) => token.trim().length > 0);
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 100) return "10-99";
  if (count < 1000) return "100-999";
  if (count < 10000) return "1000-9999";
  return "10000+";
}

async function main(): Promise<void> {
  const { output } = await runR1080NsrrStandardizerManifestScaffold({
    manifestDraftPath: process.env.MURPH_AGE_NSRR_STANDARDIZER_DRAFT_PATH,
    outputAnalyticCachePath: process.env.MURPH_AGE_NSRR_SLEEP_AUTONOMIC_ANALYTIC_CACHE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    sourceFormat: sourceFormatFromEnv(process.env.MURPH_AGE_NSRR_SOURCE_FORMAT),
    sourceTablePath: process.env.MURPH_AGE_NSRR_SOURCE_TABLE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.nextStep.conclusion,
    draftManifestWritten: output.summary.draftManifestWritten,
    nextLocalAction: output.nextStep.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowValuesRead: output.summary.rowValuesRead,
    schemaVersion: output.schemaVersion,
    sourceSpecificColumnNamesInExternalArtifact: output.summary.sourceSpecificColumnNamesInExternalArtifact,
    status: output.status,
  }, null, 2)}\n`);
}

function sourceFormatFromEnv(value: string | undefined): "csv" | "tsv" | undefined {
  return value === "csv" || value === "tsv" ? value : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1080 NSRR manifest scaffold failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
