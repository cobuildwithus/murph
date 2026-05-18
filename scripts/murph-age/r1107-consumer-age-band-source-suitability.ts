import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1107_CONSUMER_AGE_BAND_SOURCE_SUITABILITY_SCHEMA_VERSION =
  "murph-age-r1107-consumer-age-band-source-suitability.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1107-consumer-age-band-source-suitability.latest.json";

const SOURCE_CONFIGS = {
  midus2: {
    ageColumn: "B4ZAGE",
    biomarkerEntry: "ICPSR_29282/DS0001/29282-0001-Data.tsv",
    biomarkerZip: "ICPSR_29282-V11.zip",
    endpointLabel: "10-year all-cause mortality",
    idColumn: "M2ID",
    labColumns: ["B4PBMI", "B4BHA1C", "B4BTRIGL", "B4BHDL"],
    mortalityEntry: "ICPSR_37237/DS0001/37237-0001-Data.tsv",
    mortalityZip: "ICPSR_37237-V6.zip",
    sourceLabel: "MIDUS 2",
    surveyBaselineYearColumn: "B1PIDATE_YR",
    surveyEntry: "ICPSR_04652/DS0001/04652-0001-Data.tsv",
    surveyZip: "ICPSR_04652-V8.zip",
  },
  midusRefresher: {
    ageColumn: "RA4ZAGE",
    biomarkerEntry: "ICPSR_36901/DS0001/36901-0001-Data.tsv",
    biomarkerZip: "ICPSR_36901-V6.zip",
    endpointLabel: "10-year all-cause mortality",
    idColumn: "MRID",
    labColumns: ["RA4PBMI", "RA4BHA1C", "RA4BTRIGL", "RA4BHDL"],
    mortalityEntry: "ICPSR_38024/DS0001/38024-0001-Data.tsv",
    mortalityZip: "ICPSR_38024-V3.zip",
    sourceLabel: "MIDUS Refresher",
    surveyBaselineYearColumn: "RA1PIDATE_YR",
    surveyEntry: "ICPSR_36532/DS0001/36532-0001-Data.tsv",
    surveyZip: "ICPSR_36532-V4.zip",
  },
} as const;

const CRELES_CONFIG = {
  ageColumn: "AGE",
  biomarkerEntry: "ICPSR_26681/DS0002/26681-0002-Data.tsv",
  biomarkerZip: "ICPSR_26681-V3.zip",
  endpointLabel: "death by wave 3 known status",
  followupEntry: "ICPSR_35250/DS0013/35250-0013-Data.tsv",
  followupStatusColumn: "TRACK_W3",
  followupZip: "ICPSR_35250-V2.zip",
  idColumn: "IDSUJETO",
  labColumns: ["IMC", "HBAC1", "TGS", "HDL", "SISTOLICA", "DIASTOLICA"],
  recodedEntry: "ICPSR_26681/DS0010/26681-0010-Data.tsv",
  recodedZip: "ICPSR_26681-V3.zip",
  sourceLabel: "CRELES",
} as const;

type AgeBand = "16_34" | "35_50" | "51_65" | "66_plus" | "outside_or_unknown";
type SourceId = "creles" | "midus2" | "midusRefresher";
type TsvRow = Record<string, string>;

interface InternalAgeBandCounts {
  events: number;
  rows: number;
  rowsWithCommonLabs: number;
}

interface SourceInternalSummary {
  ageBands: Record<AgeBand, InternalAgeBandCounts>;
  endpointLabel: string;
  sourceLabel: string;
  status: "available" | "missing_or_unreadable";
}

interface SourceOutputSummary {
  ageBands: Record<AgeBand, {
    eventCountBand: string;
    rowCountBand: string;
    rowsWithCommonLabsBand: string;
  }>;
  consumer16To50EventBand: string;
  consumer16To50RowBand: string;
  endpointLabel: string;
  sourceLabel: string;
  status: "available" | "missing_or_unreadable";
}

export interface R1107ConsumerAgeBandSourceSuitabilityOptions {
  createdAt?: string;
  downloadsDir?: string;
  outputDir?: string;
}

export interface R1107ConsumerAgeBandSourceSuitabilityOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1107: true;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  packetId: "r1107-consumer-age-band-source-suitability";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1107_CONSUMER_AGE_BAND_SOURCE_SUITABILITY_SCHEMA_VERSION;
  sources: Record<SourceId, SourceOutputSummary>;
  status: "research-local-aggregate-only";
  summary: {
    combinedConsumer16To50EventBand: string;
    combinedConsumer16To50RowBand: string;
    conclusion:
      | "current_sources_support_consumer_16_50_outcome_loop"
      | "current_sources_are_shadow_or_older_transport_only"
      | "current_sources_missing";
    nextAction:
      | "run_consumer_lab_loop_on_current_sources"
      | "keep_labs_as_shadow_seek_younger_or_consumer_outcome_source"
      | "repair_or_download_source_packages";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    wearableOutcomeLinkedRowsAvailable: false;
  };
}

export async function runR1107ConsumerAgeBandSourceSuitability(
  options: R1107ConsumerAgeBandSourceSuitabilityOptions = {},
): Promise<{ output: R1107ConsumerAgeBandSourceSuitabilityOutput; outputPath: string }> {
  const downloadsDir = options.downloadsDir ?? path.join(os.homedir(), "Downloads");
  const internalSources = {
    creles: await readCreles(downloadsDir),
    midus2: await readMidusLike(downloadsDir, SOURCE_CONFIGS.midus2),
    midusRefresher: await readMidusLike(downloadsDir, SOURCE_CONFIGS.midusRefresher),
  } satisfies Record<SourceId, SourceInternalSummary>;

  const combinedConsumer = sumConsumer16To50(Object.values(internalSources));
  const availableSources = Object.values(internalSources).filter((source) => source.status === "available").length;
  const conclusion = availableSources === 0
    ? "current_sources_missing"
    : combinedConsumer.events >= 100
      ? "current_sources_support_consumer_16_50_outcome_loop"
      : "current_sources_are_shadow_or_older_transport_only";
  const output: R1107ConsumerAgeBandSourceSuitabilityOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    packetId: "r1107-consumer-age-band-source-suitability",
    productDisplayAuthorized: false,
    schemaVersion: R1107_CONSUMER_AGE_BAND_SOURCE_SUITABILITY_SCHEMA_VERSION,
    sources: {
      creles: toSourceOutput(internalSources.creles),
      midus2: toSourceOutput(internalSources.midus2),
      midusRefresher: toSourceOutput(internalSources.midusRefresher),
    },
    status: "research-local-aggregate-only",
    summary: {
      combinedConsumer16To50EventBand: countBand(combinedConsumer.events),
      combinedConsumer16To50RowBand: countBand(combinedConsumer.rows),
      conclusion,
      nextAction: conclusion === "current_sources_support_consumer_16_50_outcome_loop"
        ? "run_consumer_lab_loop_on_current_sources"
        : conclusion === "current_sources_missing"
          ? "repair_or_download_source_packages"
          : "keep_labs_as_shadow_seek_younger_or_consumer_outcome_source",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      wearableOutcomeLinkedRowsAvailable: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1107 consumer age-band source suitability failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readMidusLike(
  downloadsDir: string,
  config: typeof SOURCE_CONFIGS[keyof typeof SOURCE_CONFIGS],
): Promise<SourceInternalSummary> {
  try {
    const surveyRows = await readZippedTsvColumns(
      path.join(downloadsDir, config.surveyZip),
      config.surveyEntry,
      [config.idColumn, config.surveyBaselineYearColumn],
    );
    const biomarkerRows = await readZippedTsvColumns(
      path.join(downloadsDir, config.biomarkerZip),
      config.biomarkerEntry,
      [config.idColumn, config.ageColumn, ...config.labColumns],
    );
    const mortalityRows = await readZippedTsvColumns(
      path.join(downloadsDir, config.mortalityZip),
      config.mortalityEntry,
      [config.idColumn, "DOD_Y"],
    );
    const surveyById = new Map(surveyRows.filter((row) => row[config.idColumn]).map((row) => [row[config.idColumn]!, row]));
    const mortalityById = new Map(mortalityRows.filter((row) => row[config.idColumn]).map((row) => [row[config.idColumn]!, row]));
    const summary = emptySourceSummary(config.sourceLabel, config.endpointLabel, "available");
    for (const biomarkerRow of biomarkerRows) {
      const key = biomarkerRow[config.idColumn];
      if (!key) continue;
      const baselineYear = parseYear(surveyById.get(key)?.[config.surveyBaselineYearColumn]);
      if (!baselineYear || baselineYear + 10 > 2023) continue;
      const age = parseMetricValue(biomarkerRow[config.ageColumn]);
      const deathYear = parseYear(mortalityById.get(key)?.DOD_Y);
      addRow(summary, age, deathYear && deathYear - baselineYear > 0 && deathYear - baselineYear <= 10 ? 1 : 0, hasAllLabs(biomarkerRow, config.labColumns));
    }
    return summary;
  } catch {
    return emptySourceSummary(config.sourceLabel, config.endpointLabel, "missing_or_unreadable");
  }
}

async function readCreles(downloadsDir: string): Promise<SourceInternalSummary> {
  try {
    const recodedRows = await readZippedTsvColumns(
      path.join(downloadsDir, CRELES_CONFIG.recodedZip),
      CRELES_CONFIG.recodedEntry,
      [CRELES_CONFIG.idColumn, CRELES_CONFIG.ageColumn],
    );
    const biomarkerRows = await readZippedTsvColumns(
      path.join(downloadsDir, CRELES_CONFIG.biomarkerZip),
      CRELES_CONFIG.biomarkerEntry,
      [CRELES_CONFIG.idColumn, ...CRELES_CONFIG.labColumns],
    );
    const followupRows = await readZippedTsvColumns(
      path.join(downloadsDir, CRELES_CONFIG.followupZip),
      CRELES_CONFIG.followupEntry,
      [CRELES_CONFIG.idColumn, CRELES_CONFIG.followupStatusColumn],
    );
    const recodedById = new Map(recodedRows.filter((row) => row[CRELES_CONFIG.idColumn]).map((row) => [row[CRELES_CONFIG.idColumn]!, row]));
    const followupById = new Map(followupRows.filter((row) => row[CRELES_CONFIG.idColumn]).map((row) => [row[CRELES_CONFIG.idColumn]!, row]));
    const summary = emptySourceSummary(CRELES_CONFIG.sourceLabel, CRELES_CONFIG.endpointLabel, "available");
    for (const biomarkerRow of biomarkerRows) {
      const key = biomarkerRow[CRELES_CONFIG.idColumn];
      if (!key) continue;
      const recodedRow = recodedById.get(key);
      const followupStatus = parseCrelesFollowupStatus(followupById.get(key)?.[CRELES_CONFIG.followupStatusColumn]);
      if (!recodedRow || followupStatus === "missing" || followupStatus === "lost") continue;
      addRow(summary, parseMetricValue(recodedRow[CRELES_CONFIG.ageColumn]), followupStatus === "dead" ? 1 : 0, hasAllLabs(biomarkerRow, CRELES_CONFIG.labColumns));
    }
    return summary;
  } catch {
    return emptySourceSummary(CRELES_CONFIG.sourceLabel, CRELES_CONFIG.endpointLabel, "missing_or_unreadable");
  }
}

function addRow(summary: SourceInternalSummary, age: number | null, event: 0 | 1, hasCommonLabs: boolean): void {
  const band = ageBand(age);
  summary.ageBands[band].rows += 1;
  summary.ageBands[band].events += event;
  if (hasCommonLabs) summary.ageBands[band].rowsWithCommonLabs += 1;
}

function ageBand(age: number | null): AgeBand {
  if (age === null || age < 16) return "outside_or_unknown";
  if (age <= 34) return "16_34";
  if (age <= 50) return "35_50";
  if (age <= 65) return "51_65";
  return "66_plus";
}

function emptySourceSummary(
  sourceLabel: string,
  endpointLabel: string,
  status: SourceInternalSummary["status"],
): SourceInternalSummary {
  return {
    ageBands: {
      "16_34": emptyCounts(),
      "35_50": emptyCounts(),
      "51_65": emptyCounts(),
      "66_plus": emptyCounts(),
      outside_or_unknown: emptyCounts(),
    },
    endpointLabel,
    sourceLabel,
    status,
  };
}

function emptyCounts(): InternalAgeBandCounts {
  return { events: 0, rows: 0, rowsWithCommonLabs: 0 };
}

function toSourceOutput(summary: SourceInternalSummary): SourceOutputSummary {
  const consumer = sourceConsumer16To50(summary);
  return {
    ageBands: Object.fromEntries(
      (Object.entries(summary.ageBands) as Array<[AgeBand, InternalAgeBandCounts]>).map(([band, counts]) => [
        band,
        {
          eventCountBand: countBand(counts.events),
          rowCountBand: countBand(counts.rows),
          rowsWithCommonLabsBand: countBand(counts.rowsWithCommonLabs),
        },
      ]),
    ) as SourceOutputSummary["ageBands"],
    consumer16To50EventBand: countBand(consumer.events),
    consumer16To50RowBand: countBand(consumer.rows),
    endpointLabel: summary.endpointLabel,
    sourceLabel: summary.sourceLabel,
    status: summary.status,
  };
}

function sourceConsumer16To50(summary: SourceInternalSummary): InternalAgeBandCounts {
  return {
    events: summary.ageBands["16_34"].events + summary.ageBands["35_50"].events,
    rows: summary.ageBands["16_34"].rows + summary.ageBands["35_50"].rows,
    rowsWithCommonLabs: summary.ageBands["16_34"].rowsWithCommonLabs + summary.ageBands["35_50"].rowsWithCommonLabs,
  };
}

function sumConsumer16To50(sources: readonly SourceInternalSummary[]): InternalAgeBandCounts {
  return sources.map(sourceConsumer16To50).reduce((sum, counts) => ({
    events: sum.events + counts.events,
    rows: sum.rows + counts.rows,
    rowsWithCommonLabs: sum.rowsWithCommonLabs + counts.rowsWithCommonLabs,
  }), emptyCounts());
}

async function readZippedTsvColumns(
  zipPath: string,
  entry: string,
  columns: readonly string[],
): Promise<TsvRow[]> {
  const unzip = spawn("unzip", ["-p", zipPath, entry], { stdio: ["ignore", "pipe", "ignore"] });
  const rl = createInterface({ crlfDelay: Infinity, input: unzip.stdout });
  let indexes: Record<string, number> | null = null;
  const rows: TsvRow[] = [];
  for await (const line of rl) {
    if (!indexes) {
      const header = line.split("\t");
      indexes = Object.fromEntries(columns.map((column) => [column, header.indexOf(column)]));
      continue;
    }
    const cells = line.split("\t");
    const row: TsvRow = {};
    for (const [column, index] of Object.entries(indexes)) {
      row[column] = index >= 0 ? String(cells[index] ?? "").trim() : "";
    }
    rows.push(row);
  }
  await new Promise<void>((resolve, reject) => {
    unzip.on("close", (code) => code === 0 ? resolve() : reject(new Error(`unzip exited with ${code}`)));
    unzip.on("error", reject);
  });
  return rows;
}

function hasAllLabs(row: TsvRow, columns: readonly string[]): boolean {
  return columns.every((column) => parseMetricValue(row[column]) !== null);
}

function parseCrelesFollowupStatus(value: string | undefined): "alive" | "dead" | "lost" | "missing" {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (parsed === 1) return "alive";
  if (parsed === 2) return "dead";
  if (parsed === 3 || parsed === 4) return "lost";
  return "missing";
}

function parseMetricValue(value: string | undefined): number | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 999_999) return null;
  return parsed;
}

function parseYear(value: string | undefined): number | null {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 1900 && parsed < 2100 ? parsed : null;
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 50) return "10-49";
  if (count < 100) return "50-99";
  if (count < 250) return "100-249";
  if (count < 500) return "250-499";
  if (count < 1000) return "500-999";
  return "1000_plus";
}

function safeBoundary(): R1107ConsumerAgeBandSourceSuitabilityOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1107: true,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1107ConsumerAgeBandSourceSuitability({
    downloadsDir: process.env.MURPH_AGE_DOWNLOADS_DIR,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    combinedConsumer16To50EventBand: output.summary.combinedConsumer16To50EventBand,
    combinedConsumer16To50RowBand: output.summary.combinedConsumer16To50RowBand,
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    schemaVersion: output.schemaVersion,
    status: output.status,
    wearableOutcomeLinkedRowsAvailable: output.summary.wearableOutcomeLinkedRowsAvailable,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1107 consumer age-band source suitability failed."}\n`);
    process.exitCode = 1;
  });
}
