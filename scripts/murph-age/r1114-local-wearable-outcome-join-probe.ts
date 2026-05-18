import { open, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1114_LOCAL_WEARABLE_OUTCOME_JOIN_PROBE_SCHEMA_VERSION =
  "murph-age-r1114-local-wearable-outcome-join-probe.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1114-local-wearable-outcome-join-probe.latest.json";

type CountBand = "0" | "1" | "2-9" | "10-99" | "100+";
type RootKind = "local_user_downloads" | "murph_cache" | "other_local_root";
type HeaderFamily = "outcome_label_like" | "unknown" | "wearable_health_like";
type JoinCategory = "date_like" | "id_like" | "time_like";

interface HeaderSummary {
  family: HeaderFamily;
  hasDateLike: boolean;
  hasIdLike: boolean;
  hasTimeLike: boolean;
}

interface RootSummary {
  familyJoinKeyCoverage: Record<Exclude<HeaderFamily, "unknown">, Record<JoinCategory, CountBand>>;
  headerFamilyCountBands: Record<HeaderFamily, CountBand>;
  joinKeyCoverage: Record<JoinCategory, CountBand>;
  kind: RootKind;
  status: "available" | "missing_or_unreadable";
}

interface InternalRootScan {
  output: RootSummary;
  rawCounts: Record<HeaderFamily, number>;
}

export interface R1114LocalWearableOutcomeJoinProbeOptions {
  createdAt?: string;
  outputDir?: string;
  scanRoots?: string[];
}

export interface R1114LocalWearableOutcomeJoinProbeOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1114: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1114: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  joinProbe: {
    fileNameValuesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    roots: RootSummary[];
    rootCountBand: CountBand;
    sourceVariableNamesStored: false;
  };
  packetId: "r1114-local-wearable-outcome-join-probe";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1114_LOCAL_WEARABLE_OUTCOME_JOIN_PROBE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "local_header_join_probe_not_configured"
      | "local_wearable_outcome_headers_need_human_mapping"
      | "local_wearable_outcome_headers_not_joinable"
      | "local_wearable_outcome_headers_potential_person_join";
    nextAction:
      | "configure_local_join_scan_roots"
      | "map_allowed_local_headers_privately_before_receipt"
      | "ignore_local_wearable_file_until_outcome_join_exists";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1114: false;
    scanRootsConfigured: boolean;
  };
}

export async function runR1114LocalWearableOutcomeJoinProbe(
  options: R1114LocalWearableOutcomeJoinProbeOptions = {},
): Promise<{ output: R1114LocalWearableOutcomeJoinProbeOutput; outputPath: string }> {
  const roots = options.scanRoots ?? scanRootsFromEnv(process.env.MURPH_AGE_LOCAL_JOIN_SCAN_ROOTS);
  const rootScans = await Promise.all(roots.map(scanRoot));
  const rootSummaries = rootScans.map((scan) => scan.output);
  const output: R1114LocalWearableOutcomeJoinProbeOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    joinProbe: {
      fileNameValuesStored: false,
      headerValuesStored: false,
      localPathsStored: false,
      rootCountBand: countBand(roots.length),
      roots: rootSummaries,
      sourceVariableNamesStored: false,
    },
    packetId: "r1114-local-wearable-outcome-join-probe",
    productDisplayAuthorized: false,
    schemaVersion: R1114_LOCAL_WEARABLE_OUTCOME_JOIN_PROBE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: summarize(rootScans, roots.length > 0),
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1114 local wearable outcome join probe failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function scanRoot(root: string): Promise<InternalRootScan> {
  const kind = classifyRoot(root);
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) return emptyRootSummary(kind, "missing_or_unreadable");
    const entries = await readdir(root, { withFileTypes: true });
    const headerSummaries: HeaderSummary[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".csv") continue;
      try {
        const firstLine = await readFirstLine(path.join(root, entry.name));
        headerSummaries.push(classifyHeader(firstLine));
      } catch {
        // A single malformed local CSV should not erase evidence from sibling files.
      }
    }
    return summarizeRoot(kind, headerSummaries, "available");
  } catch {
    return emptyRootSummary(kind, "missing_or_unreadable");
  }
}

function summarizeRoot(
  kind: RootKind,
  headers: HeaderSummary[],
  status: RootSummary["status"],
): InternalRootScan {
  const familyCounts = emptyFamilyCounts();
  const familyJoinCounts = {
    outcome_label_like: emptyJoinCounts(),
    wearable_health_like: emptyJoinCounts(),
  };
  let dateLike = 0;
  let idLike = 0;
  let timeLike = 0;
  for (const header of headers) {
    familyCounts[header.family] += 1;
    if (header.hasDateLike) dateLike += 1;
    if (header.hasIdLike) idLike += 1;
    if (header.hasTimeLike) timeLike += 1;
    if (header.family !== "unknown") {
      if (header.hasDateLike) familyJoinCounts[header.family].date_like += 1;
      if (header.hasIdLike) familyJoinCounts[header.family].id_like += 1;
      if (header.hasTimeLike) familyJoinCounts[header.family].time_like += 1;
    }
  }
  return {
    output: {
      familyJoinKeyCoverage: {
        outcome_label_like: bandJoinCounts(familyJoinCounts.outcome_label_like),
        wearable_health_like: bandJoinCounts(familyJoinCounts.wearable_health_like),
      },
      headerFamilyCountBands: {
        outcome_label_like: countBand(familyCounts.outcome_label_like),
        unknown: countBand(familyCounts.unknown),
        wearable_health_like: countBand(familyCounts.wearable_health_like),
      },
      joinKeyCoverage: {
        date_like: countBand(dateLike),
        id_like: countBand(idLike),
        time_like: countBand(timeLike),
      },
      kind,
      status,
    },
    rawCounts: familyCounts,
  };
}

function summarize(
  roots: InternalRootScan[],
  scanRootsConfigured: boolean,
): R1114LocalWearableOutcomeJoinProbeOutput["summary"] {
  if (!scanRootsConfigured) {
    return {
      conclusion: "local_header_join_probe_not_configured",
      nextAction: "configure_local_join_scan_roots",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1114: false,
      scanRootsConfigured,
    };
  }
  const wearableCount = roots.reduce((sum, root) => sum + root.rawCounts.wearable_health_like, 0);
  const outcomeCount = roots.reduce((sum, root) => sum + root.rawCounts.outcome_label_like, 0);
  const wearableWithId = roots.some((root) => root.output.familyJoinKeyCoverage.wearable_health_like.id_like !== "0");
  const outcomeWithId = roots.some((root) => root.output.familyJoinKeyCoverage.outcome_label_like.id_like !== "0");
  if (wearableCount > 0 && outcomeCount > 0 && wearableWithId && outcomeWithId) {
    return {
      conclusion: "local_wearable_outcome_headers_potential_person_join",
      nextAction: "map_allowed_local_headers_privately_before_receipt",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1114: false,
      scanRootsConfigured,
    };
  }
  if (wearableCount > 0 && outcomeCount > 0) {
    return {
      conclusion: "local_wearable_outcome_headers_need_human_mapping",
      nextAction: "map_allowed_local_headers_privately_before_receipt",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1114: false,
      scanRootsConfigured,
    };
  }
  return {
    conclusion: "local_wearable_outcome_headers_not_joinable",
    nextAction: "ignore_local_wearable_file_until_outcome_join_exists",
    productDisplayAuthorized: false,
    reviewGptRequiredNow: false,
    rowParsingPerformedByR1114: false,
    scanRootsConfigured,
  };
}

function classifyHeader(firstLine: string): HeaderSummary {
  const normalized = firstLine.toLowerCase();
  const tokenized = normalized.replace(/[_-]+/gu, " ");
  const family = headerFamily(normalized);
  return {
    family,
    hasDateLike: /\b(?:date|day|month|year|ymd|timestamp)\b/iu.test(tokenized),
    hasIdLike: hasPersonJoinKey(tokenized, normalized),
    hasTimeLike: /\b(?:time|hour|minute|second|timestamp)\b/iu.test(tokenized),
  };
}

function hasPersonJoinKey(tokenizedHeader: string, normalizedHeader: string): boolean {
  return /\bseqn\b/iu.test(tokenizedHeader)
    || /\b(?:person|participant|subject|patient|member)\s+(?:id|identifier)\b/iu.test(tokenizedHeader)
    || /\bcase\s+(?:id|identifier)\b/iu.test(tokenizedHeader)
    || /\b(?:personid|participantid|subjectid|patientid|memberid|caseid)\b/iu.test(normalizedHeader);
}

function headerFamily(normalized: string): HeaderFamily {
  const outcomeSignals = ["death", "mortality", "hospital", "diagnosis", "event", "frailty", "disability"];
  const wearableSignals = [
    "active",
    "calories",
    "distance",
    "heart",
    "hrv",
    "oxygen",
    "pulse",
    "resting",
    "sedentary",
    "sleep",
    "spo2",
    "steps",
    "workout",
  ];
  if (outcomeSignals.some((signal) => normalized.includes(signal))) return "outcome_label_like";
  if (wearableSignals.some((signal) => normalized.includes(signal))) return "wearable_health_like";
  return "unknown";
}

async function readFirstLine(filePath: string): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(16 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead).split(/\r?\n/u)[0] ?? "";
  } finally {
    await handle.close();
  }
}

function classifyRoot(root: string): RootKind {
  const normalized = root.toLowerCase();
  if (normalized.includes("downloads")) return "local_user_downloads";
  if (normalized.includes(".runtime") || normalized.includes("murph-age")) return "murph_cache";
  return "other_local_root";
}

function emptyRootSummary(kind: RootKind, status: RootSummary["status"]): InternalRootScan {
  return {
    output: {
      familyJoinKeyCoverage: {
        outcome_label_like: emptyJoinBands(),
        wearable_health_like: emptyJoinBands(),
      },
      headerFamilyCountBands: {
        outcome_label_like: "0",
        unknown: "0",
        wearable_health_like: "0",
      },
      joinKeyCoverage: emptyJoinBands(),
      kind,
      status,
    },
    rawCounts: emptyFamilyCounts(),
  };
}

function emptyFamilyCounts(): Record<HeaderFamily, number> {
  return {
    outcome_label_like: 0,
    unknown: 0,
    wearable_health_like: 0,
  };
}

function emptyJoinCounts(): Record<JoinCategory, number> {
  return {
    date_like: 0,
    id_like: 0,
    time_like: 0,
  };
}

function emptyJoinBands(): Record<JoinCategory, CountBand> {
  return {
    date_like: "0",
    id_like: "0",
    time_like: "0",
  };
}

function bandJoinCounts(counts: Record<JoinCategory, number>): Record<JoinCategory, CountBand> {
  return {
    date_like: countBand(counts.date_like),
    id_like: countBand(counts.id_like),
    time_like: countBand(counts.time_like),
  };
}

function scanRootsFromEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}

function countBand(count: number): CountBand {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count < 10) return "2-9";
  if (count < 100) return "10-99";
  return "100+";
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1114LocalWearableOutcomeJoinProbeOutput["artifactBoundary"] {
  return {
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
  };
}

async function main(): Promise<void> {
  const { output } = await runR1114LocalWearableOutcomeJoinProbe({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1114: output.summary.rowParsingPerformedByR1114,
    scanRootsConfigured: output.summary.scanRootsConfigured,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1114 local wearable outcome join probe failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
