import { mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1087_DOWNLOADED_AGING_SOURCE_FEASIBILITY_SCHEMA_VERSION =
  "murph-age-r1087-downloaded-aging-source-feasibility.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1087-downloaded-aging-source-feasibility.latest.json";

type SourceFamily =
  | "CRELES"
  | "HAALSI"
  | "MHAS/Gateway MHAS"
  | "MIDUS core/refresher"
  | "NSHAP"
  | "SAGE South Africa"
  | "SEBAS Taiwan";
type SourceReadyStatus =
  | "blocked_data_archive_missing"
  | "blocked_endpoint_or_terms_context_only"
  | "ready_for_existing_aggregate_loop"
  | "ready_for_metadata_source_card_no_rows"
  | "ready_for_score_receipt_reuse";
type Coverage = "complete" | "none" | "partial";

interface SourceRule {
  dataPatterns: RegExp[];
  documentationPatterns?: RegExp[];
  family: SourceFamily;
  requiredDataPackageCount: number;
  sourceRole:
    | "biomarker_function_candidate"
    | "function_disability_candidate"
    | "function_disability_lead_support"
    | "glycemia_transport_evidence"
    | "metadata_context_only";
}

const SOURCE_RULES: SourceRule[] = [
  {
    dataPatterns: [
      /^ICPSR_0?3792\b.*\.(?:zip|tsv|csv|dta|sav|por)$/iu,
      /^0?3792\b.*\.(?:zip|tsv|csv|dta|sav|por)$/iu,
      /\bsebas\b.*\.(?:zip|tsv|csv|dta|sav|por)$/iu,
    ],
    documentationPatterns: [/0?3792\b.*(?:agreement|documentation|doc|pdf).*\.zip$/iu, /\bsebas\b.*(?:doc|pdf)/iu],
    family: "SEBAS Taiwan",
    requiredDataPackageCount: 1,
    sourceRole: "biomarker_function_candidate",
  },
  {
    dataPatterns: [
      /^ICPSR_04652\b.*\.zip$/iu,
      /^ICPSR_29282\b.*\.zip$/iu,
      /^ICPSR_36532\b.*\.zip$/iu,
      /^ICPSR_36901\b.*\.zip$/iu,
      /^ICPSR_37237\b.*\.zip$/iu,
      /^ICPSR_38024\b.*\.zip$/iu,
    ],
    family: "MIDUS core/refresher",
    requiredDataPackageCount: 6,
    sourceRole: "glycemia_transport_evidence",
  },
  {
    dataPatterns: [/^ICPSR_26681\b.*\.zip$/iu, /^ICPSR_31263\b.*\.zip$/iu, /^ICPSR_35250\b.*\.zip$/iu],
    family: "CRELES",
    requiredDataPackageCount: 3,
    sourceRole: "glycemia_transport_evidence",
  },
  {
    dataPatterns: [/^ICPSR_36633\b.*\.zip$/iu],
    family: "HAALSI",
    requiredDataPackageCount: 1,
    sourceRole: "biomarker_function_candidate",
  },
  {
    dataPatterns: [/^ICPSR_20541\b.*\.zip$/iu, /^ICPSR_34921\b.*\.zip$/iu, /^ICPSR_36873\b.*\.zip$/iu],
    family: "NSHAP",
    requiredDataPackageCount: 3,
    sourceRole: "function_disability_candidate",
  },
  {
    dataPatterns: [/^H_MHAS_.*\.dta$/iu, /^GH_MHAS_EOL_.*\.dta$/iu, /^master_follow_up_file_.*\.dta$/iu],
    family: "MHAS/Gateway MHAS",
    requiredDataPackageCount: 3,
    sourceRole: "function_disability_lead_support",
  },
  {
    dataPatterns: [/^SAGESouthAfrica\b.*\.zip$/iu, /^SouthAfrica.*Data\.dta$/iu],
    family: "SAGE South Africa",
    requiredDataPackageCount: 2,
    sourceRole: "metadata_context_only",
  },
];

export interface R1087DownloadedAgingSourceFeasibilityOptions {
  createdAt?: string;
  downloadsDir?: string;
  outputDir?: string;
}

export interface R1087DownloadedAgingSourceFeasibilityOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    downloadedFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowParsingPerformedByR1087: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableListsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  downloadedSourceFeasibility: {
    downloadsDirInspected: true;
    fileNameValuesStored: false;
    localPathsStored: false;
    sourceRows: Array<{
      allowedNextUse:
        | "continue_existing_aggregate_loop"
        | "metadata_source_card_only"
        | "request_data_archive_before_use"
        | "reuse_existing_receipts_only";
      dataPackageEvidenceBand: string;
      documentationEvidenceBand: string;
      family: SourceFamily;
      requiredDataCoverage: Coverage;
      sourceReadyStatus: SourceReadyStatus;
      sourceRole: SourceRule["sourceRole"];
    }>;
  };
  packetId: "r1087-downloaded-aging-source-feasibility";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1087_DOWNLOADED_AGING_SOURCE_FEASIBILITY_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "downloaded_sources_ready_for_existing_loops_sebas_blocked"
      | "downloaded_sources_ready_for_existing_loops_sebas_metadata_ready"
      | "downloaded_sources_need_more_data_before_new_loops";
    nextLocalAction:
      | "continue_existing_midus_creles_haalsi_mhas_aggregate_loops"
      | "download_sebas_data_archive_before_sebas_loop"
      | "recover_downloaded_source_packages";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1087: false;
    sebasStatus: SourceReadyStatus;
  };
}

export async function runR1087DownloadedAgingSourceFeasibility(
  options: R1087DownloadedAgingSourceFeasibilityOptions = {},
): Promise<{ output: R1087DownloadedAgingSourceFeasibilityOutput; outputPath: string }> {
  const basenames = await safeReadBasenames(options.downloadsDir ?? path.join(os.homedir(), "Downloads"));
  const sourceRows = SOURCE_RULES.map((rule) => summarizeSource(rule, basenames));
  const sebasStatus = sourceRows.find((row) => row.family === "SEBAS Taiwan")?.sourceReadyStatus
    ?? "blocked_data_archive_missing";
  const existingLoopReady = sourceRows.some((row) =>
    row.sourceReadyStatus === "ready_for_existing_aggregate_loop"
    || row.sourceReadyStatus === "ready_for_score_receipt_reuse"
  );

  const output: R1087DownloadedAgingSourceFeasibilityOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      downloadedFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformedByR1087: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableListsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    downloadedSourceFeasibility: {
      downloadsDirInspected: true,
      fileNameValuesStored: false,
      localPathsStored: false,
      sourceRows,
    },
    packetId: "r1087-downloaded-aging-source-feasibility",
    productDisplayAuthorized: false,
    schemaVersion: R1087_DOWNLOADED_AGING_SOURCE_FEASIBILITY_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: sebasStatus === "ready_for_metadata_source_card_no_rows"
        ? "downloaded_sources_ready_for_existing_loops_sebas_metadata_ready"
        : existingLoopReady
          ? "downloaded_sources_ready_for_existing_loops_sebas_blocked"
          : "downloaded_sources_need_more_data_before_new_loops",
      nextLocalAction: existingLoopReady
        ? "continue_existing_midus_creles_haalsi_mhas_aggregate_loops"
        : sebasStatus === "blocked_data_archive_missing"
          ? "download_sebas_data_archive_before_sebas_loop"
          : "recover_downloaded_source_packages",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1087: false,
      sebasStatus,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1087Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1087 downloaded aging source feasibility failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function safeReadBasenames(downloadsDir: string): Promise<string[]> {
  try {
    return await readdir(downloadsDir);
  } catch {
    return [];
  }
}

function summarizeSource(
  rule: SourceRule,
  basenames: string[],
): R1087DownloadedAgingSourceFeasibilityOutput["downloadedSourceFeasibility"]["sourceRows"][number] {
  const dataPackageCount = countDistinctMatchingPatternGroups(basenames, rule.dataPatterns, {
    excludeDocumentation: rule.family === "SEBAS Taiwan",
  });
  const documentationCount = countDistinctMatchingPatternGroups(basenames, rule.documentationPatterns ?? []);
  const requiredDataCoverage = coverageFor(dataPackageCount, rule.requiredDataPackageCount);
  const sourceReadyStatus = sourceStatusFor(rule, requiredDataCoverage);
  return {
    allowedNextUse: nextUseFor(sourceReadyStatus),
    dataPackageEvidenceBand: countBand(dataPackageCount),
    documentationEvidenceBand: countBand(documentationCount),
    family: rule.family,
    requiredDataCoverage,
    sourceReadyStatus,
    sourceRole: rule.sourceRole,
  };
}

function countDistinctMatchingPatternGroups(
  basenames: string[],
  patterns: RegExp[],
  options: { excludeDocumentation?: boolean } = {},
): number {
  return patterns.filter((pattern) =>
    basenames.some((basename) =>
      pattern.test(basename)
      && (!options.excludeDocumentation || !/(agreement|documentation|readme|pdf)/iu.test(basename))
    )
  ).length;
}

function coverageFor(found: number, required: number): Coverage {
  if (found <= 0) return "none";
  if (found >= required) return "complete";
  return "partial";
}

function sourceStatusFor(rule: SourceRule, coverage: Coverage): SourceReadyStatus {
  if (coverage !== "complete") {
    return rule.family === "SEBAS Taiwan" ? "blocked_data_archive_missing" : "blocked_endpoint_or_terms_context_only";
  }
  if (rule.family === "MIDUS core/refresher" || rule.family === "CRELES") return "ready_for_score_receipt_reuse";
  if (rule.family === "SAGE South Africa") return "blocked_endpoint_or_terms_context_only";
  return "ready_for_existing_aggregate_loop";
}

function nextUseFor(status: SourceReadyStatus): R1087DownloadedAgingSourceFeasibilityOutput["downloadedSourceFeasibility"]["sourceRows"][number]["allowedNextUse"] {
  if (status === "blocked_data_archive_missing") return "request_data_archive_before_use";
  if (status === "ready_for_existing_aggregate_loop") return "continue_existing_aggregate_loop";
  if (status === "ready_for_score_receipt_reuse") return "reuse_existing_receipts_only";
  return "metadata_source_card_only";
}

function countBand(count: number): string {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count <= 5) return "3-5";
  return "6+";
}

function findForbiddenR1087Output(output: R1087DownloadedAgingSourceFeasibilityOutput): string[] {
  const encoded = JSON.stringify(output);
  const findings: string[] = [];
  if (/\/Users\/|Downloads|\.zip|\.dta|\.csv|\.tsv|\.sav|\.por|ICPSR_/u.test(encoded)) {
    findings.push("output contains local path, file extension, package id, or downloaded filename text");
  }
  if (output.summary.rowParsingPerformedByR1087 !== false) findings.push("R1087 must not parse rows");
  if (output.productDisplayAuthorized !== false) findings.push("R1087 must not authorize product display");
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1087DownloadedAgingSourceFeasibility()
    .then(({ output }) => {
      process.stdout.write(`${JSON.stringify({
        conclusion: output.summary.conclusion,
        nextLocalAction: output.summary.nextLocalAction,
        packetId: output.packetId,
        productDisplayAuthorized: output.productDisplayAuthorized,
        rowParsingPerformedByR1087: output.summary.rowParsingPerformedByR1087,
        schemaVersion: output.schemaVersion,
        sebasStatus: output.summary.sebasStatus,
        status: output.status,
      }, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "R1087 downloaded source feasibility failed."}\n`);
      process.exitCode = 1;
    });
}
