import { createReadStream } from "node:fs";
import { access, chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1080_DEFAULT_PRIVATE_MANIFEST_DRAFT_PATH,
} from "./r1080-nsrr-standardizer-manifest-scaffold.ts";

export const R1081_NSRR_SOURCE_TABLE_CANDIDATE_SCANNER_SCHEMA_VERSION =
  "murph-age-r1081-nsrr-source-table-candidate-scanner.v1" as const;

export const R1081_DEFAULT_PRIVATE_CANDIDATE_DRAFT_PATH = path.join(
  path.dirname(R1080_DEFAULT_PRIVATE_MANIFEST_DRAFT_PATH),
  "nsrr-source-table-candidates.draft.json",
);

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1081-nsrr-source-table-candidate-scanner.latest.json";
const PRIVATE_MANIFEST_ROOT = path.dirname(R1080_DEFAULT_PRIVATE_MANIFEST_DRAFT_PATH);
const DEFAULT_SCAN_LIMIT = 2500;

type Delimiter = "," | "\t";
type SourceFormat = "csv" | "tsv";
type SignalKey = "activity_like" | "age_like" | "autonomic_like" | "endpoint_like" | "sex_like" | "sleep_like";

interface CandidateRecord {
  candidateId: string;
  delimiter: Delimiter;
  header: string[];
  sourceFormat: SourceFormat;
  sourceTablePath: string;
  signalFlags: Record<SignalKey, boolean>;
}

interface PrivateCandidateDraft {
  candidates: CandidateRecord[];
  schemaVersion: typeof R1081_NSRR_SOURCE_TABLE_CANDIDATE_SCANNER_SCHEMA_VERSION;
}

export interface R1081NsrrSourceTableCandidateScannerOptions {
  createdAt?: string;
  maxFiles?: number;
  outputDir?: string;
  privateCandidateDraftPath?: string;
  scanRoots?: string[];
}

export interface R1081NsrrSourceTableCandidateScannerOutput {
  artifactBoundary: {
    aggregateOnlyExternalOutput: true;
    codebookTextStored: false;
    headerValuesStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    privateCandidateDraftWritten: true;
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
  nextStep: {
    conclusion:
      | "nsrr_candidate_tables_incomplete_for_sleep_autonomic_contract"
      | "nsrr_candidate_tables_found_private_draft_ready"
      | "nsrr_candidate_tables_not_found";
    nextLocalAction:
      | "download_nsrr_tables_or_set_scan_root"
      | "inspect_private_candidates_or_download_nsrr_tables"
      | "choose_private_candidate_then_run_r1080";
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  packetId: "r1081-nsrr-source-table-candidate-scanner";
  privateDraft: {
    candidateCountBand: string;
    sleepAutonomicContractCandidateCountBand: string;
    privateDraftContainsLocalPaths: true;
    privateDraftContainsSourceHeaders: true;
    privateDraftScope: "ignored_local_runtime_cache_only";
    readableTableCountBand: string;
    scanLimitHit: boolean;
    scanRootCountBand: string;
    signalCountBands: Record<SignalKey, string>;
  };
  productDisplayAuthorized: false;
  schemaVersion: typeof R1081_NSRR_SOURCE_TABLE_CANDIDATE_SCANNER_SCHEMA_VERSION;
  status: "research-local-private-draft-plus-aggregate-receipt";
  summary: {
    candidateDraftWritten: true;
    candidateTablesFound: boolean;
    sleepAutonomicContractCandidateFound: boolean;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowValuesRead: false;
    rowValuesStored: false;
    sourceSpecificColumnNamesInExternalArtifact: false;
  };
}

export async function runR1081NsrrSourceTableCandidateScanner(
  options: R1081NsrrSourceTableCandidateScannerOptions = {},
): Promise<{ output: R1081NsrrSourceTableCandidateScannerOutput; outputPath: string }> {
  const scanRoots = (options.scanRoots ?? []).map((root) => root.trim()).filter(Boolean);
  if (scanRoots.length === 0) {
    throw new Error("R1081 requires at least one local NSRR scan root.");
  }
  const privateCandidateDraftPath = options.privateCandidateDraftPath ?? R1081_DEFAULT_PRIVATE_CANDIDATE_DRAFT_PATH;
  assertPrivateDraftPath(privateCandidateDraftPath);
  await Promise.all(scanRoots.map((root) => access(root)));

  const scanResult = await scanCandidateTables(scanRoots, options.maxFiles ?? DEFAULT_SCAN_LIMIT);
  const candidateDraft: PrivateCandidateDraft = {
    candidates: scanResult.candidates,
    schemaVersion: R1081_NSRR_SOURCE_TABLE_CANDIDATE_SCANNER_SCHEMA_VERSION,
  };

  await ensurePrivateDirectory(path.dirname(privateCandidateDraftPath));
  await writeFile(privateCandidateDraftPath, `${JSON.stringify(candidateDraft, null, 2)}\n`, { mode: 0o600 });

  const contractCandidateCount = scanResult.candidates.filter(isSleepAutonomicContractCandidate).length;
  const candidateTablesFound = scanResult.candidates.length > 0;
  const sleepAutonomicContractCandidateFound = contractCandidateCount > 0;
  const output: R1081NsrrSourceTableCandidateScannerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    nextStep: {
      conclusion: sleepAutonomicContractCandidateFound
        ? "nsrr_candidate_tables_found_private_draft_ready"
        : candidateTablesFound
          ? "nsrr_candidate_tables_incomplete_for_sleep_autonomic_contract"
          : "nsrr_candidate_tables_not_found",
      nextLocalAction: sleepAutonomicContractCandidateFound
        ? "choose_private_candidate_then_run_r1080"
        : candidateTablesFound
          ? "inspect_private_candidates_or_download_nsrr_tables"
          : "download_nsrr_tables_or_set_scan_root",
      reviewGptRequiredBeforeNextLocalRun: false,
    },
    packetId: "r1081-nsrr-source-table-candidate-scanner",
    privateDraft: {
      candidateCountBand: countBand(scanResult.candidates.length),
      sleepAutonomicContractCandidateCountBand: countBand(contractCandidateCount),
      privateDraftContainsLocalPaths: true,
      privateDraftContainsSourceHeaders: true,
      privateDraftScope: "ignored_local_runtime_cache_only",
      readableTableCountBand: countBand(scanResult.readableTableCount),
      scanLimitHit: scanResult.scanLimitHit,
      scanRootCountBand: countBand(scanRoots.length),
      signalCountBands: signalCountBands(scanResult.candidates),
    },
    productDisplayAuthorized: false,
    schemaVersion: R1081_NSRR_SOURCE_TABLE_CANDIDATE_SCANNER_SCHEMA_VERSION,
    status: "research-local-private-draft-plus-aggregate-receipt",
    summary: {
      candidateDraftWritten: true,
      candidateTablesFound,
      sleepAutonomicContractCandidateFound,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowValuesRead: false,
      rowValuesStored: false,
      sourceSpecificColumnNamesInExternalArtifact: false,
    },
  };

  assertR1081Safe(output, { candidates: scanResult.candidates, privateCandidateDraftPath, scanRoots });
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

export function assertR1081Safe(
  output: R1081NsrrSourceTableCandidateScannerOutput,
  privateTokens: {
    candidates: readonly CandidateRecord[];
    privateCandidateDraftPath: string;
    scanRoots: readonly string[];
  },
): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1081SpecificFindings(output, privateTokens),
  ];
  if (findings.length > 0) {
    throw new Error(`R1081 NSRR source-table candidate scanner failed safety validation: ${findings.join("; ")}`);
  }
}

async function scanCandidateTables(
  scanRoots: readonly string[],
  maxFiles: number,
): Promise<{
  candidates: CandidateRecord[];
  readableTableCount: number;
  scanLimitHit: boolean;
}> {
  const tablePaths: string[] = [];
  let scanLimitHit = false;
  for (const root of scanRoots) {
    for await (const filePath of walkFiles(root)) {
      if (tablePaths.length >= maxFiles) {
        scanLimitHit = true;
        break;
      }
      if (isSupportedTable(filePath)) tablePaths.push(filePath);
    }
    if (scanLimitHit) break;
  }

  const candidates: CandidateRecord[] = [];
  let readableTableCount = 0;
  for (const filePath of tablePaths) {
    const header = await readHeaderIfPossible(filePath);
    if (!header) continue;
    readableTableCount += 1;
    const signalFlags = signalFlagsForHeader(header.header);
    if (Object.values(signalFlags).some(Boolean)) {
      candidates.push({
        candidateId: `candidate_${String(candidates.length + 1).padStart(4, "0")}`,
        delimiter: header.delimiter,
        header: header.header,
        sourceFormat: header.delimiter === "\t" ? "tsv" : "csv",
        sourceTablePath: filePath,
        signalFlags,
      });
    }
  }
  return { candidates, readableTableCount, scanLimitHit };
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(filePath);
    } else if (entry.isFile()) {
      yield filePath;
    }
  }
}

function isSupportedTable(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".csv")
    || lower.endsWith(".tsv")
    || lower.endsWith(".csv.gz")
    || lower.endsWith(".tsv.gz");
}

async function readHeaderIfPossible(filePath: string): Promise<{ delimiter: Delimiter; header: string[] } | null> {
  try {
    const rl = createInterface({ crlfDelay: Infinity, input: sourceReadStream(filePath) });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const delimiter = inferDelimiter(line);
      return {
        delimiter,
        header: parseDelimitedLine(line, delimiter).map((column) => column.trim()).filter(Boolean),
      };
    }
  } catch {
    return null;
  }
  return null;
}

function sourceReadStream(filePath: string) {
  const stream = createReadStream(filePath);
  return filePath.endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
}

function inferDelimiter(line: string): Delimiter {
  return line.split("\t").length > line.split(",").length ? "\t" : ",";
}

function parseDelimitedLine(line: string, delimiter: Delimiter): string[] {
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

function signalFlagsForHeader(header: readonly string[]): Record<SignalKey, boolean> {
  const normalized = header.map((column) => column.toLowerCase());
  return {
    activity_like: hasAny(normalized, [/activity/u, /active/u, /sedentary/u, /steps?/u, /actigraphy/u]),
    age_like: hasAny(normalized, [/^age$/u, /age_/u, /_age/u, /years?/u]),
    autonomic_like: hasAny(normalized, [/heart/u, /\brhr\b/u, /\bhrv\b/u, /pulse/u, /spo2/u, /oxygen/u]),
    endpoint_like: hasAny(normalized, [/death/u, /mort/u, /event/u, /cvd/u, /follow/u, /outcome/u]),
    sex_like: hasAny(normalized, [/^sex$/u, /sex_/u, /_sex/u, /gender/u, /\bmale\b/u, /\bfemale\b/u]),
    sleep_like: hasAny(normalized, [/sleep/u, /ahi/u, /apnea/u, /hypopnea/u, /efficiency/u]),
  };
}

function hasAny(values: readonly string[], patterns: readonly RegExp[]): boolean {
  return values.some((value) => patterns.some((pattern) => pattern.test(value)));
}

function signalCountBands(candidates: readonly CandidateRecord[]): Record<SignalKey, string> {
  const keys: SignalKey[] = ["activity_like", "age_like", "autonomic_like", "endpoint_like", "sex_like", "sleep_like"];
  return Object.fromEntries(keys.map((key) => [
    key,
    countBand(candidates.filter((candidate) => candidate.signalFlags[key]).length),
  ])) as Record<SignalKey, string>;
}

function isSleepAutonomicContractCandidate(candidate: CandidateRecord): boolean {
  const flags = candidate.signalFlags;
  return flags.age_like
    && flags.endpoint_like
    && flags.sex_like
    && flags.sleep_like
    && (flags.activity_like || flags.autonomic_like);
}

function assertPrivateDraftPath(filePath: string): void {
  const resolved = path.resolve(filePath);
  const root = path.resolve(PRIVATE_MANIFEST_ROOT);
  if (!isPathInside(resolved, root) || !resolved.endsWith(".draft.json")) {
    throw new Error("R1081 candidate draft output must stay under the ignored NSRR private-map runtime cache root.");
  }
}

async function ensurePrivateDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { mode: 0o700, recursive: true });
  await chmod(directoryPath, 0o700);
}

function isPathInside(filePath: string, root: string): boolean {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeBoundary(): R1081NsrrSourceTableCandidateScannerOutput["artifactBoundary"] {
  return {
    aggregateOnlyExternalOutput: true,
    codebookTextStored: false,
    headerValuesStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    privateCandidateDraftWritten: true,
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

function findR1081SpecificFindings(
  output: R1081NsrrSourceTableCandidateScannerOutput,
  privateTokens: {
    candidates: readonly CandidateRecord[];
    privateCandidateDraftPath: string;
    scanRoots: readonly string[];
  },
): string[] {
  const findings: string[] = [];
  const serialized = JSON.stringify(output);
  for (const token of privateTokenList(privateTokens)) {
    if (token.length >= 3 && serialized.includes(token)) {
      findings.push("private source-table candidate token egress");
      break;
    }
  }
  if (output.productDisplayAuthorized !== false || output.summary.productDisplayAuthorized !== false) {
    findings.push("product display must remain locked");
  }
  return findings;
}

function privateTokenList(input: {
  candidates: readonly CandidateRecord[];
  privateCandidateDraftPath: string;
  scanRoots: readonly string[];
}): string[] {
  const sourceHeaderTokens = input.candidates
    .flatMap((candidate) => candidate.header)
    .filter(isSensitiveHeaderToken);
  return [
    path.basename(input.privateCandidateDraftPath),
    input.privateCandidateDraftPath,
    ...input.scanRoots,
    ...input.candidates.flatMap((candidate) => [
      path.basename(candidate.sourceTablePath),
      candidate.sourceTablePath,
    ]),
    ...sourceHeaderTokens,
  ].filter((token) => token.trim().length > 0);
}

const GENERIC_HEADER_TOKENS_ALLOWED_IN_AGGREGATE_RECEIPTS = new Set([
  "activity",
  "active",
  "age",
  "ahi",
  "autonomic",
  "cvd",
  "death",
  "efficiency",
  "endpoint",
  "event",
  "follow",
  "heart",
  "hrv",
  "mort",
  "outcome",
  "oxygen",
  "pulse",
  "rhr",
    "sedentary",
    "sex",
    "sleep",
  "spo2",
  "status",
  "steps",
  "years",
]);

function isSensitiveHeaderToken(token: string): boolean {
  const normalized = token.trim().toLowerCase();
  if (normalized.length < 6) return false;
  if (GENERIC_HEADER_TOKENS_ALLOWED_IN_AGGREGATE_RECEIPTS.has(normalized)) {
    return false;
  }
  return /[_\d]/u.test(normalized) || normalized.length >= 16;
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
  const { output } = await runR1081NsrrSourceTableCandidateScanner({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    privateCandidateDraftPath: process.env.MURPH_AGE_NSRR_SOURCE_CANDIDATE_DRAFT_PATH,
    scanRoots: parseScanRoots(process.env.MURPH_AGE_NSRR_SCAN_ROOTS),
  });
  process.stdout.write(`${JSON.stringify({
    candidateCountBand: output.privateDraft.candidateCountBand,
    conclusion: output.nextStep.conclusion,
    nextLocalAction: output.nextStep.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowValuesRead: output.summary.rowValuesRead,
    schemaVersion: output.schemaVersion,
    sleepAutonomicContractCandidateCountBand: output.privateDraft.sleepAutonomicContractCandidateCountBand,
    sourceSpecificColumnNamesInExternalArtifact: output.summary.sourceSpecificColumnNamesInExternalArtifact,
    status: output.status,
  }, null, 2)}\n`);
}

function parseScanRoots(value: string | undefined): string[] {
  return String(value ?? "")
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1081 NSRR source-table candidate scanner failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
