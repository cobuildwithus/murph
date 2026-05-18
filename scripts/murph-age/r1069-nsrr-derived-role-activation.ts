import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1069_NSRR_DERIVED_ROLE_ACTIVATION_SCHEMA_VERSION =
  "murph-age-r1069-nsrr-derived-role-activation.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1069-nsrr-derived-role-activation.latest.json";

type RoleFamily =
  | "baseline_covariates"
  | "derived_sleep_activity_or_autonomic"
  | "documentation_or_metadata"
  | "outcome_or_followup"
  | "raw_signal_only";
type RoleStatus = "detected" | "missing";

interface InputArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface TargetCohort {
  cohortId: "mesa_sleep" | "mros_sleep" | "shhs" | "sof_sleep";
  priority: 1 | 2 | 3 | 4;
  requestedRoleFamilies: Array<Exclude<RoleFamily, "raw_signal_only">>;
  why: string;
}

export interface R1069NsrrDerivedRoleActivationOptions {
  createdAt?: string;
  outputDir?: string;
  r1068Path?: string;
  scanRoots?: string[];
}

export interface R1069NsrrDerivedRoleActivationOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1069: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1069: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  downloadRequest: {
    avoidForNow: string[];
    preferredFormatOrder: Array<"csv_or_tsv" | "sas_or_xpt" | "zip_archive" | "raw_signal_files">;
    targetCohorts: TargetCohort[];
  };
  inputArtifacts: {
    r1068TrueWearableSourceActivationMatrix: InputArtifactSummary;
  };
  packetId: "r1069-nsrr-derived-role-activation";
  productDisplayAuthorized: false;
  roleFamilyScan: {
    roleFamilies: Record<RoleFamily, {
      fileCountBand: string;
      status: RoleStatus;
    }>;
    rootCountBand: string;
    scanned: boolean;
  };
  rowExecutionReadiness: {
    blockingReasons: string[];
    nextAction:
      | "download_nsrr_derived_covariate_sleep_outcome_files"
      | "hold_raw_signal_files_until_derived_tables_exist"
      | "prepare_nsrr_aggregate_receipt_scaffold";
    outcomeScoringUnlocked: false;
    rowParsingUnlocked: false;
    status:
      | "blocked_missing_derived_role_families"
      | "blocked_raw_signal_only"
      | "metadata_role_families_ready_no_scoring";
  };
  schemaVersion: typeof R1069_NSRR_DERIVED_ROLE_ACTIVATION_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "nsrr_derived_download_needed"
      | "nsrr_derived_role_families_ready_for_receipt_scaffold"
      | "nsrr_raw_signal_only_not_useful_yet";
    productDisplayAuthorized: false;
    reviewGptUse: "not_needed_until_aggregate_result_delta";
    rowParsingPerformedByR1069: false;
  };
}

export async function runR1069NsrrDerivedRoleActivation(
  options: R1069NsrrDerivedRoleActivationOptions = {},
): Promise<{ output: R1069NsrrDerivedRoleActivationOutput; outputPath: string }> {
  const r1068 = await readJsonIfPresent(
    options.r1068Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1068-true-wearable-source-activation-matrix.latest.json"),
  );
  validateInputBoundaries({ r1068 });
  const roleFamilyScan = await summarizeRoleFamilies(options.scanRoots ?? scanRootsFromEnv());
  const rowExecutionReadiness = readinessFor(roleFamilyScan);
  const output: R1069NsrrDerivedRoleActivationOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    downloadRequest: downloadRequest(),
    inputArtifacts: {
      r1068TrueWearableSourceActivationMatrix: summarizeInput(
        "r1068-true-wearable-source-activation-matrix.latest.json",
        r1068,
      ),
    },
    packetId: "r1069-nsrr-derived-role-activation",
    productDisplayAuthorized: false,
    roleFamilyScan,
    rowExecutionReadiness,
    schemaVersion: R1069_NSRR_DERIVED_ROLE_ACTIVATION_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: conclusionFor(rowExecutionReadiness.status),
      productDisplayAuthorized: false,
      reviewGptUse: "not_needed_until_aggregate_result_delta",
      rowParsingPerformedByR1069: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1069 NSRR derived role activation failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function readinessFor(
  scan: R1069NsrrDerivedRoleActivationOutput["roleFamilyScan"],
): R1069NsrrDerivedRoleActivationOutput["rowExecutionReadiness"] {
  const hasBaseline = scan.roleFamilies.baseline_covariates.status === "detected";
  const hasDerived = scan.roleFamilies.derived_sleep_activity_or_autonomic.status === "detected";
  const hasOutcome = scan.roleFamilies.outcome_or_followup.status === "detected";
  const hasRawOnly = scan.roleFamilies.raw_signal_only.status === "detected"
    && !hasBaseline
    && !hasDerived
    && !hasOutcome;
  if (hasBaseline && hasDerived && hasOutcome) {
    return {
      blockingReasons: [
        "source_rights_confirmation_required_before_row_materialization",
        "aggregate_receipt_contract_required_before_any_result_export",
      ],
      nextAction: "prepare_nsrr_aggregate_receipt_scaffold",
      outcomeScoringUnlocked: false,
      rowParsingUnlocked: false,
      status: "metadata_role_families_ready_no_scoring",
    };
  }
  if (hasRawOnly) {
    return {
      blockingReasons: [
        "raw_signal_files_are_not_the_near_term_path",
        "derived_covariate_sleep_outcome_tables_missing",
      ],
      nextAction: "hold_raw_signal_files_until_derived_tables_exist",
      outcomeScoringUnlocked: false,
      rowParsingUnlocked: false,
      status: "blocked_raw_signal_only",
    };
  }
  return {
    blockingReasons: missingRoleFamilyReasons({ hasBaseline, hasDerived, hasOutcome }),
    nextAction: "download_nsrr_derived_covariate_sleep_outcome_files",
    outcomeScoringUnlocked: false,
    rowParsingUnlocked: false,
    status: "blocked_missing_derived_role_families",
  };
}

function missingRoleFamilyReasons(input: {
  hasBaseline: boolean;
  hasDerived: boolean;
  hasOutcome: boolean;
}): string[] {
  const reasons: string[] = [];
  if (!input.hasBaseline) reasons.push("baseline_covariate_role_family_missing");
  if (!input.hasDerived) reasons.push("derived_sleep_activity_or_autonomic_role_family_missing");
  if (!input.hasOutcome) reasons.push("outcome_or_followup_role_family_missing");
  return reasons;
}

function conclusionFor(
  status: R1069NsrrDerivedRoleActivationOutput["rowExecutionReadiness"]["status"],
): R1069NsrrDerivedRoleActivationOutput["summary"]["conclusion"] {
  if (status === "metadata_role_families_ready_no_scoring") {
    return "nsrr_derived_role_families_ready_for_receipt_scaffold";
  }
  if (status === "blocked_raw_signal_only") return "nsrr_raw_signal_only_not_useful_yet";
  return "nsrr_derived_download_needed";
}

async function summarizeRoleFamilies(
  scanRoots: string[],
): Promise<R1069NsrrDerivedRoleActivationOutput["roleFamilyScan"]> {
  const counts: Record<RoleFamily, number> = {
    baseline_covariates: 0,
    derived_sleep_activity_or_autonomic: 0,
    documentation_or_metadata: 0,
    outcome_or_followup: 0,
    raw_signal_only: 0,
  };
  for (const root of scanRoots) {
    const rootStat = await statOrNull(root);
    if (!rootStat?.isDirectory()) continue;
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const family = classifyNsrrRoleFamily(entry.name.toLowerCase());
      if (family) counts[family] += 1;
    }
  }
  return {
    roleFamilies: {
      baseline_covariates: roleFamilySummary(counts.baseline_covariates),
      derived_sleep_activity_or_autonomic: roleFamilySummary(counts.derived_sleep_activity_or_autonomic),
      documentation_or_metadata: roleFamilySummary(counts.documentation_or_metadata),
      outcome_or_followup: roleFamilySummary(counts.outcome_or_followup),
      raw_signal_only: roleFamilySummary(counts.raw_signal_only),
    },
    rootCountBand: countBand(scanRoots.length),
    scanned: scanRoots.length > 0,
  };
}

function classifyNsrrRoleFamily(name: string): RoleFamily | null {
  if (/\.(edf|mat|h5|xml)$/u.test(name) && /(?:actigraphy|psg|raw|signal|sleep)/u.test(name)) {
    return "raw_signal_only";
  }
  if (!/\.(csv|tsv|sas7bdat|xpt|zip|json|pdf|txt)$/u.test(name)) return null;
  if (!hasNsrrCohortSignal(name)) return null;
  if (/(?:dictionary|documentation|metadata|variables?|codebook|readme)/u.test(name)) {
    return "documentation_or_metadata";
  }
  if (/(?:death|mortality|event|outcome|follow[-_ ]?up|incident|hospital|cvd|cardio)/u.test(name)) {
    return "outcome_or_followup";
  }
  if (/(?:baseline|covariate|demographic|phenotype|health|exam|visit|anthro|bp|lab|medication)/u.test(name)) {
    return "baseline_covariates";
  }
  if (/(?:actigraphy|activity|autonomic|derived|hrv|heart[-_ ]?rate|mesa[-_ ]?sleep|mros[-_ ]?sleep|shhs|sleep[-_ ]?summary|sleep[-_ ]?variables)/u.test(name)) {
    return "derived_sleep_activity_or_autonomic";
  }
  return null;
}

function hasNsrrCohortSignal(name: string): boolean {
  return /(?:nsrr|sleepdata|mesa[-_ ]?sleep|shhs|mros(?:[-_ ]?sleep)?|sof[-_ ]?sleep|sleep[-_ ]?heart[-_ ]?health)/u
    .test(name);
}

function roleFamilySummary(count: number): { fileCountBand: string; status: RoleStatus } {
  return {
    fileCountBand: countBand(count),
    status: count > 0 ? "detected" : "missing",
  };
}

function downloadRequest(): R1069NsrrDerivedRoleActivationOutput["downloadRequest"] {
  return {
    avoidForNow: [
      "large_raw_psg_or_edf_signal_files",
      "source_text_bodies_or_codebook_prose_in_repo_outputs",
      "participant_level_exports_to_reviewgpt",
    ],
    preferredFormatOrder: ["csv_or_tsv", "sas_or_xpt", "zip_archive", "raw_signal_files"],
    targetCohorts: [
      targetCohort("mesa_sleep", 1, "Best near-term NSRR sleep/autonomic candidate if derived covariates, sleep summaries, and outcomes are present."),
      targetCohort("shhs", 2, "Useful sleep and cardiometabolic outcome stress lane after MESA-style role families are confirmed."),
      targetCohort("mros_sleep", 3, "Older-adult sleep/autonomic transport lane if outcome role families are available."),
      targetCohort("sof_sleep", 4, "Older-adult female cohort sidecar if role families are available."),
    ],
  };
}

function targetCohort(cohortId: TargetCohort["cohortId"], priority: TargetCohort["priority"], why: string): TargetCohort {
  return {
    cohortId,
    priority,
    requestedRoleFamilies: [
      "baseline_covariates",
      "derived_sleep_activity_or_autonomic",
      "outcome_or_followup",
      "documentation_or_metadata",
    ],
    why,
  };
}

function safeBoundary(): R1069NsrrDerivedRoleActivationOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1069: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1069: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

function validateInputBoundaries(inputs: Record<string, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1069 input ${key} failed aggregate-egress validation: ${findings.join("; ")}`);
    }
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

async function statOrNull(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

function summarizeInput(artifact: string, value: unknown | null): InputArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value ? "available" : "missing",
  };
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : null;
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 100) return "10-99";
  return "100+";
}

function scanRootsFromEnv(): string[] {
  return (process.env.MURPH_AGE_NSRR_SCAN_ROOTS ?? "")
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const { output } = await runR1069NsrrDerivedRoleActivation({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1068Path: process.env.MURPH_AGE_R1068_TRUE_WEARABLE_SOURCE_ACTIVATION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextAction: output.rowExecutionReadiness.nextAction,
    outcomeScoringUnlocked: output.rowExecutionReadiness.outcomeScoringUnlocked,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptUse: output.summary.reviewGptUse,
    roleFamilies: output.roleFamilyScan.roleFamilies,
    rowParsingPerformedByR1069: output.artifactBoundary.rowParsingPerformedByR1069,
    rowParsingUnlocked: output.rowExecutionReadiness.rowParsingUnlocked,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1069 NSRR derived role activation failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
