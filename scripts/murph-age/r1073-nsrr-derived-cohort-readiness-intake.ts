import { execFile } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1073_NSRR_DERIVED_COHORT_READINESS_INTAKE_SCHEMA_VERSION =
  "murph-age-r1073-nsrr-derived-cohort-readiness-intake.v1" as const;

const execFileAsync = promisify(execFile);
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1073-nsrr-derived-cohort-readiness-intake.latest.json";
const DEFAULT_MAX_FILE_LIKE_ENTRIES = 7_500;
const DEFAULT_MAX_ARCHIVE_ENTRIES = 2_000;
const DEFAULT_MAX_ARCHIVE_BYTES_TO_LIST = 250 * 1024 * 1024;

type CohortId = "hchs_sol" | "mesa_sleep" | "mros_sleep" | "shhs" | "sof_sleep";
type RoleFamily =
  | "baseline_covariates"
  | "derived_sleep_activity_or_autonomic"
  | "documentation_or_metadata"
  | "outcome_or_followup"
  | "raw_signal_only";
type RoleStatus = "detected" | "missing";
type CohortReadinessStatus =
  | "blocked_missing_baseline_or_sleep_roles"
  | "blocked_missing_outcome_or_followup"
  | "blocked_raw_signal_only"
  | "missing"
  | "ready_for_local_materializer_or_aggregate_receipt";

interface RoleFamilySummary {
  fileLikeEntryCountBand: string;
  status: RoleStatus;
}

interface CohortReadinessRow {
  blockingReasons: string[];
  cohortId: CohortId;
  directRowParsingUnlocked: false;
  nextAction:
    | "download_derived_covariate_sleep_outcome_tables"
    | "hold_raw_signal_files_until_derived_tables_exist"
    | "prepare_local_materializer_or_fill_aggregate_receipt";
  outcomeScoringUnlocked: false;
  priority: 1 | 2 | 3 | 4 | 5;
  readinessStatus: CohortReadinessStatus;
  roleFamilies: Record<RoleFamily, RoleFamilySummary>;
}

interface ScanState {
  archiveEntryLimitHit: boolean;
  archiveEntriesInspected: number;
  fileLikeEntriesInspected: number;
  scanLimitHit: boolean;
  skippedArchiveCount: number;
  unreadableArchiveCount: number;
  zipArchiveCount: number;
}

export interface R1073NsrrDerivedCohortReadinessIntakeOptions {
  createdAt?: string;
  maxArchiveBytesToList?: number;
  maxArchiveEntries?: number;
  maxFileLikeEntries?: number;
  outputDir?: string;
  scanRoots?: string[];
}

export interface R1073NsrrDerivedCohortReadinessIntakeOutput {
  artifactBoundary: {
    aggregateOnly: true;
    archiveEntryNamesStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1073: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1073: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  cohortReadiness: CohortReadinessRow[];
  createdAt: string;
  downloadRequest: {
    avoidForNow: string[];
    preferredCommands: string[];
    priorityOrder: CohortId[];
  };
  globalReadiness: {
    blockingReasons: string[];
    nextAction:
      | "download_nsrr_derived_covariate_sleep_outcome_files"
      | "prepare_nsrr_local_materializer_or_fill_aggregate_receipt";
    preferredReadyCohort: CohortId | null;
    reviewGptRequiredNow: false;
    status:
      | "blocked_download_or_outcome_missing"
      | "ready_for_local_materializer_or_aggregate_receipt";
  };
  packetId: "r1073-nsrr-derived-cohort-readiness-intake";
  productDisplayAuthorized: false;
  scanSummary: {
    archiveEntryLimitHit: boolean;
    archiveEntryScanCountBand: string;
    fileLikeEntryScanCountBand: string;
    rootCountBand: string;
    scanLimitHit: boolean;
    scanned: boolean;
    skippedArchiveCountBand: string;
    unreadableArchiveCountBand: string;
    zipArchiveCountBand: string;
  };
  schemaVersion: typeof R1073_NSRR_DERIVED_COHORT_READINESS_INTAKE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "nsrr_cohort_ready_for_local_receipt"
      | "nsrr_download_or_outcome_still_missing";
    productDisplayAuthorized: false;
    reviewGptUse: "not_needed_until_real_nsrr_aggregate_delta";
    rowParsingPerformedByR1073: false;
  };
}

type RoleCountsByCohort = Record<CohortId, Record<RoleFamily, number>>;

export async function runR1073NsrrDerivedCohortReadinessIntake(
  options: R1073NsrrDerivedCohortReadinessIntakeOptions = {},
): Promise<{ output: R1073NsrrDerivedCohortReadinessIntakeOutput; outputPath: string }> {
  const scanRoots = options.scanRoots ?? scanRootsFromEnvOrDefault();
  const scanOptions = {
    maxArchiveBytesToList: options.maxArchiveBytesToList ?? DEFAULT_MAX_ARCHIVE_BYTES_TO_LIST,
    maxArchiveEntries: options.maxArchiveEntries ?? DEFAULT_MAX_ARCHIVE_ENTRIES,
    maxFileLikeEntries: options.maxFileLikeEntries ?? DEFAULT_MAX_FILE_LIKE_ENTRIES,
  };
  const { counts, state } = await scanNsrrDerivedCohorts(scanRoots, scanOptions);
  const cohortReadiness = cohortReadinessRows(counts);
  const globalReadiness = globalReadinessFrom(cohortReadiness);
  const output: R1073NsrrDerivedCohortReadinessIntakeOutput = {
    artifactBoundary: safeBoundary(),
    cohortReadiness,
    createdAt: options.createdAt ?? new Date().toISOString(),
    downloadRequest: {
      avoidForNow: [
        "large_raw_psg_or_edf_signal_files_before_derived_tables",
        "participant_level_exports_to_reviewgpt",
        "source_text_or_codebook_prose_in_repo_outputs",
      ],
      preferredCommands: [
        "nsrr download mesa/datasets",
        "nsrr download mesa/actigraphy",
        "nsrr download shhs/datasets",
        "nsrr download hchs/datasets",
        "nsrr download hchs/actigraphy",
        "nsrr download mros/datasets",
        "nsrr download sof/datasets",
      ],
      priorityOrder: ["mesa_sleep", "shhs", "hchs_sol", "mros_sleep", "sof_sleep"],
    },
    globalReadiness,
    packetId: "r1073-nsrr-derived-cohort-readiness-intake",
    productDisplayAuthorized: false,
    scanSummary: {
      archiveEntryLimitHit: state.archiveEntryLimitHit,
      archiveEntryScanCountBand: countBand(state.archiveEntriesInspected),
      fileLikeEntryScanCountBand: countBand(state.fileLikeEntriesInspected),
      rootCountBand: countBand(scanRoots.length),
      scanLimitHit: state.scanLimitHit,
      scanned: scanRoots.length > 0,
      skippedArchiveCountBand: countBand(state.skippedArchiveCount),
      unreadableArchiveCountBand: countBand(state.unreadableArchiveCount),
      zipArchiveCountBand: countBand(state.zipArchiveCount),
    },
    schemaVersion: R1073_NSRR_DERIVED_COHORT_READINESS_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: globalReadiness.status === "ready_for_local_materializer_or_aggregate_receipt"
        ? "nsrr_cohort_ready_for_local_receipt"
        : "nsrr_download_or_outcome_still_missing",
      productDisplayAuthorized: false,
      reviewGptUse: "not_needed_until_real_nsrr_aggregate_delta",
      rowParsingPerformedByR1073: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1073 NSRR derived cohort readiness intake failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function scanNsrrDerivedCohorts(
  scanRoots: string[],
  options: {
    maxArchiveBytesToList: number;
    maxArchiveEntries: number;
    maxFileLikeEntries: number;
  },
): Promise<{ counts: RoleCountsByCohort; state: ScanState }> {
  const counts = emptyRoleCountsByCohort();
  const state: ScanState = {
    archiveEntryLimitHit: false,
    archiveEntriesInspected: 0,
    fileLikeEntriesInspected: 0,
    scanLimitHit: false,
    skippedArchiveCount: 0,
    unreadableArchiveCount: 0,
    zipArchiveCount: 0,
  };
  for (const root of scanRoots) {
    if (state.scanLimitHit) break;
    const rootStat = await statOrNull(root);
    if (!rootStat?.isDirectory()) continue;
    await scanDirectory(root, counts, state, options, 0);
  }
  return { counts, state };
}

async function scanDirectory(
  dirPath: string,
  counts: RoleCountsByCohort,
  state: ScanState,
  options: {
    maxArchiveBytesToList: number;
    maxArchiveEntries: number;
    maxFileLikeEntries: number;
  },
  depth: number,
): Promise<void> {
  if (depth > 5 || state.scanLimitHit) return;
  const entries = await readdirOrEmpty(dirPath);
  for (const entry of entries) {
    if (state.scanLimitHit) break;
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;
      await scanDirectory(entryPath, counts, state, options, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    observeToken(entry.name, counts, state, options);
    if (/\.zip$/iu.test(entry.name)) {
      await observeZipEntries(entryPath, counts, state, options);
    }
  }
}

function observeToken(
  token: string,
  counts: RoleCountsByCohort,
  state: ScanState,
  options: { maxFileLikeEntries: number },
): void {
  const observations = classifyObservedToken(token);
  if (observations.length === 0) return;
  const novelObservations = observations.filter((observation) =>
    counts[observation.cohortId][observation.roleFamily] === 0
  );
  if (novelObservations.length === 0) return;
  if (state.fileLikeEntriesInspected >= options.maxFileLikeEntries) {
    state.scanLimitHit = true;
    return;
  }
  state.fileLikeEntriesInspected += 1;
  for (const observation of observations) {
    counts[observation.cohortId][observation.roleFamily] += 1;
  }
}

async function observeZipEntries(
  archivePath: string,
  counts: RoleCountsByCohort,
  state: ScanState,
  options: {
    maxArchiveBytesToList: number;
    maxArchiveEntries: number;
    maxFileLikeEntries: number;
  },
): Promise<void> {
  state.zipArchiveCount += 1;
  const archiveStat = await statOrNull(archivePath);
  if (!archiveStat || archiveStat.size > options.maxArchiveBytesToList) {
    state.skippedArchiveCount += 1;
    return;
  }
  try {
    const { stdout } = await execFileAsync("unzip", ["-Z1", archivePath], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const archiveEntries = stdout.split(/\r?\n/u).filter(Boolean);
    if (archiveEntries.length > options.maxArchiveEntries) state.archiveEntryLimitHit = true;
    for (const archiveEntry of archiveEntries.slice(0, options.maxArchiveEntries)) {
      state.archiveEntriesInspected += 1;
      observeToken(archiveEntry, counts, state, options);
      if (state.scanLimitHit) break;
    }
  } catch {
    state.unreadableArchiveCount += 1;
  }
}

function classifyObservedToken(token: string): Array<{ cohortId: CohortId; roleFamily: RoleFamily }> {
  const name = token.toLowerCase();
  const cohortId = cohortFor(name);
  if (!cohortId) return [];
  const roles = new Set<RoleFamily>();
  if (/\.(edf|mat|h5|xml)$/u.test(name) && /(?:actigraphy|psg|raw|signal|sleep)/u.test(name)) {
    roles.add("raw_signal_only");
  }
  if (!/\.(csv|tsv|sas7bdat|xpt|zip|json|pdf|txt)$/u.test(name)) {
    return Array.from(roles).map((roleFamily) => ({ cohortId, roleFamily }));
  }
  if (/(?:dictionary|documentation|metadata|variables?|codebook|readme|changelog)/u.test(name)) {
    roles.add("documentation_or_metadata");
  }
  if (/(?:death|mortality|event|outcome|follow[-_ ]?up|incident|hospital|cvd|cardio)/u.test(name)) {
    roles.add("outcome_or_followup");
  }
  if (/(?:baseline|covariate|demographic|phenotype|health|exam|visit|anthro|bp|lab|medication)/u.test(name)) {
    roles.add("baseline_covariates");
  }
  if (/(?:actigraphy|activity|autonomic|derived|hrv|heart[-_ ]?rate|sleep[-_ ]?summary|sleep[-_ ]?variables|polysomn|apnea|ahi|sueno)/u.test(name)) {
    roles.add("derived_sleep_activity_or_autonomic");
  }
  if (/(?:dataset|harmonized)/u.test(name) && /(sleep|shhs|mros|sof|mesa|hchs|hispanic[-_ ]?community|sueno)/u.test(name)) {
    roles.add("baseline_covariates");
    roles.add("derived_sleep_activity_or_autonomic");
  }
  return Array.from(roles).map((roleFamily) => ({ cohortId, roleFamily }));
}

function cohortFor(name: string): CohortId | null {
  if (/(?:mesa[-_ /]?sleep|\/mesa\/|^mesa[-_])/u.test(name)) return "mesa_sleep";
  if (/(?:shhs|sleep[-_ ]?heart[-_ ]?health)/u.test(name)) return "shhs";
  if (/(?:hchs[-_ /]?sol|\/hchs\/|^hchs[-_]|hispanic[-_ ]?community[-_ ]?health|sueno)/u.test(name)) return "hchs_sol";
  if (/(?:mros[-_ /]?sleep|\/mros\/|^mros[-_])/u.test(name)) return "mros_sleep";
  if (/(?:sof[-_ /]?sleep|\/sof\/|^sof[-_])/u.test(name)) return "sof_sleep";
  return null;
}

function cohortReadinessRows(counts: RoleCountsByCohort): CohortReadinessRow[] {
  return [
    cohortReadinessRow("mesa_sleep", 1, counts.mesa_sleep),
    cohortReadinessRow("shhs", 2, counts.shhs),
    cohortReadinessRow("hchs_sol", 3, counts.hchs_sol),
    cohortReadinessRow("mros_sleep", 4, counts.mros_sleep),
    cohortReadinessRow("sof_sleep", 5, counts.sof_sleep),
  ];
}

function cohortReadinessRow(
  cohortId: CohortId,
  priority: CohortReadinessRow["priority"],
  counts: Record<RoleFamily, number>,
): CohortReadinessRow {
  const hasBaseline = counts.baseline_covariates > 0;
  const hasDerived = counts.derived_sleep_activity_or_autonomic > 0;
  const hasOutcome = counts.outcome_or_followup > 0;
  const hasRawOnly = counts.raw_signal_only > 0 && !hasBaseline && !hasDerived && !hasOutcome;
  const readinessStatus = readinessStatusFor({ hasBaseline, hasDerived, hasOutcome, hasRawOnly });
  return {
    blockingReasons: blockingReasonsFor({ hasBaseline, hasDerived, hasOutcome, hasRawOnly }),
    cohortId,
    directRowParsingUnlocked: false,
    nextAction: readinessStatus === "ready_for_local_materializer_or_aggregate_receipt"
      ? "prepare_local_materializer_or_fill_aggregate_receipt"
      : readinessStatus === "blocked_raw_signal_only"
        ? "hold_raw_signal_files_until_derived_tables_exist"
        : "download_derived_covariate_sleep_outcome_tables",
    outcomeScoringUnlocked: false,
    priority,
    readinessStatus,
    roleFamilies: {
      baseline_covariates: roleSummary(counts.baseline_covariates),
      derived_sleep_activity_or_autonomic: roleSummary(counts.derived_sleep_activity_or_autonomic),
      documentation_or_metadata: roleSummary(counts.documentation_or_metadata),
      outcome_or_followup: roleSummary(counts.outcome_or_followup),
      raw_signal_only: roleSummary(counts.raw_signal_only),
    },
  };
}

function readinessStatusFor(input: {
  hasBaseline: boolean;
  hasDerived: boolean;
  hasOutcome: boolean;
  hasRawOnly: boolean;
}): CohortReadinessStatus {
  if (input.hasBaseline && input.hasDerived && input.hasOutcome) {
    return "ready_for_local_materializer_or_aggregate_receipt";
  }
  if (input.hasRawOnly) return "blocked_raw_signal_only";
  if (input.hasBaseline || input.hasDerived) return "blocked_missing_outcome_or_followup";
  if (input.hasOutcome) return "blocked_missing_baseline_or_sleep_roles";
  return "missing";
}

function blockingReasonsFor(input: {
  hasBaseline: boolean;
  hasDerived: boolean;
  hasOutcome: boolean;
  hasRawOnly: boolean;
}): string[] {
  if (input.hasBaseline && input.hasDerived && input.hasOutcome) return [];
  if (input.hasRawOnly) {
    return [
      "raw_signal_files_are_not_the_near_term_validation_path",
      "derived_covariate_sleep_outcome_tables_missing",
    ];
  }
  const reasons: string[] = [];
  if (!input.hasBaseline) reasons.push("baseline_covariate_role_family_missing");
  if (!input.hasDerived) reasons.push("derived_sleep_activity_or_autonomic_role_family_missing");
  if (!input.hasOutcome) reasons.push("outcome_or_followup_role_family_missing");
  return reasons;
}

function globalReadinessFrom(
  cohortRows: CohortReadinessRow[],
): R1073NsrrDerivedCohortReadinessIntakeOutput["globalReadiness"] {
  const ready = cohortRows
    .filter((row) => row.readinessStatus === "ready_for_local_materializer_or_aggregate_receipt")
    .sort((a, b) => a.priority - b.priority)[0];
  if (ready) {
    return {
      blockingReasons: [],
      nextAction: "prepare_nsrr_local_materializer_or_fill_aggregate_receipt",
      preferredReadyCohort: ready.cohortId,
      reviewGptRequiredNow: false,
      status: "ready_for_local_materializer_or_aggregate_receipt",
    };
  }
  return {
    blockingReasons: Array.from(new Set(cohortRows.flatMap((row) => row.blockingReasons))),
    nextAction: "download_nsrr_derived_covariate_sleep_outcome_files",
    preferredReadyCohort: null,
    reviewGptRequiredNow: false,
    status: "blocked_download_or_outcome_missing",
  };
}

function roleSummary(count: number): RoleFamilySummary {
  return {
    fileLikeEntryCountBand: countBand(count),
    status: count > 0 ? "detected" : "missing",
  };
}

function emptyRoleCountsByCohort(): RoleCountsByCohort {
  return {
    hchs_sol: emptyRoleCounts(),
    mesa_sleep: emptyRoleCounts(),
    mros_sleep: emptyRoleCounts(),
    shhs: emptyRoleCounts(),
    sof_sleep: emptyRoleCounts(),
  };
}

function emptyRoleCounts(): Record<RoleFamily, number> {
  return {
    baseline_covariates: 0,
    derived_sleep_activity_or_autonomic: 0,
    documentation_or_metadata: 0,
    outcome_or_followup: 0,
    raw_signal_only: 0,
  };
}

function safeBoundary(): R1073NsrrDerivedCohortReadinessIntakeOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    archiveEntryNamesStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1073: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1073: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

function shouldSkipDirectory(name: string): boolean {
  return /^(?:\.git|node_modules|dist|build)$/u.test(name);
}

async function readdirOrEmpty(dirPath: string) {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function statOrNull(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 100) return "10-99";
  if (count < 1_000) return "100-999";
  return "1000+";
}

function scanRootsFromEnvOrDefault(): string[] {
  const raw = process.env.MURPH_AGE_NSRR_SCAN_ROOTS;
  if (raw?.trim()) {
    return raw.split(path.delimiter).map((root) => root.trim()).filter(Boolean);
  }
  return [path.join(os.homedir(), "Downloads")];
}

async function main(): Promise<void> {
  const { output } = await runR1073NsrrDerivedCohortReadinessIntake({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextAction: output.globalReadiness.nextAction,
    packetId: output.packetId,
    preferredReadyCohort: output.globalReadiness.preferredReadyCohort,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.globalReadiness.reviewGptRequiredNow,
    rowParsingPerformedByR1073: output.artifactBoundary.rowParsingPerformedByR1073,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1073 NSRR derived cohort readiness intake failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
