import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1064_NHANES_WRIST_PRIVATE_MATERIALIZER_SCHEMA_VERSION =
  "murph-age-r1064-nhanes-wrist-private-materializer.v1" as const;

const DEFAULT_SOURCE_CACHE_ROOT = path.join(".runtime", "cache", "murph-age", "nhanes-bench-0");
const DEFAULT_ANALYTIC_CACHE_PATH = path.join(
  ".runtime",
  "cache",
  "murph-age",
  "nhanes-wrist-2011-2014",
  "derived",
  "analytic",
  "nhanes-wrist-2011-2014-lab-activity-5y-v0.csv.gz",
);
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1064-nhanes-wrist-private-materializer.latest.json";

const CYCLE_CONFIGS = [
  {
    cycleId: "2011-2012",
    mortalityFile: path.join("raw", "linked-mortality-2019", "NHANES_2011_2012_MORT_2019_PUBLIC.dat"),
    suffix: "G",
    xptDir: path.join("raw", "nhanes-public-xpt", "2011"),
  },
  {
    cycleId: "2013-2014",
    mortalityFile: path.join("raw", "linked-mortality-2019", "NHANES_2013_2014_MORT_2019_PUBLIC.dat"),
    suffix: "H",
    xptDir: path.join("raw", "nhanes-public-xpt", "2013"),
  },
] as const;

const FIVE_YEAR_MONTHS = 60;
const TEN_YEAR_MONTHS = 120;

type Split = "calibration" | "test" | "train";

interface XptVariableLayout {
  length: number;
  name: string;
  offset: number;
  type: "character" | "numeric" | "unknown";
}

interface XptTable {
  rowCount: number;
  rows: Record<string, number | string | null>[];
}

interface MortalityRow {
  eligible: boolean;
  examFollowupMonths: number | null;
  deceased: boolean;
}

interface AnalyticRow {
  activitySourceShape: string;
  ageYears: number | null;
  albumin: number | null;
  alkalinePhosphatase: number | null;
  bodyMassIndex: number | null;
  creatinine: number | null;
  cycleId: string;
  diastolicBloodPressure: number | null;
  eligibleFiveYearEndpoint: boolean;
  fiveYearEvent: 0 | 1 | null;
  fiveYearFollowupMonths: number | null;
  hba1c: number | null;
  hdlCholesterol: number | null;
  lymphocytePercent: number | null;
  meanDailyNonwearMinutes: number | null;
  meanDailySleepWearMinutes: number | null;
  meanDailyTotalActivity: number | null;
  meanDailyValidMinutes: number | null;
  meanDailyWakeWearMinutes: number | null;
  participantKey: string;
  redCellDistributionWidth: number | null;
  sampleWeightCombined: number | null;
  sexStratum: string | null;
  split: Split;
  systolicBloodPressure: number | null;
  triglycerides: number | null;
  validDayCount: number;
  waistCircumference: number | null;
  whiteBloodCellCount: number | null;
}

interface CycleSummary {
  activityCoverageCountBand: string;
  adultEligibleCountBand: string;
  cycleId: "2011-2012" | "2013-2014";
  fiveYearEndpointObservedCountBand: string;
  fiveYearEventCountBand: string;
  lab9CoverageCountBand: string;
  materializedRowCountBand: string;
}

export interface R1064NhanesWristPrivateMaterializerOptions {
  analyticCachePath?: string;
  createdAt?: string;
  outputDir?: string;
  sourceCacheRoot?: string;
}

export interface R1064NhanesWristPrivateMaterializerOutput {
  artifactBoundary: {
    aggregateOnlyExternalOutput: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    localRowCacheWritten: true;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  cacheReceipt: {
    contentSha256: string;
    privateAnalyticCacheWritten: true;
    rowCacheScope: "ignored_local_runtime_cache_only";
  };
  createdAt: string;
  cycles: CycleSummary[];
  endpointPolicy: {
    primaryExecutableEndpoint: "5y_all_cause_mortality";
    tenYearEndpointReady: false;
    tenYearEndpointReason: "2011_2014_public_lmf_followup_is_not_clean_10y_for_this_sidecar";
  };
  nextStep: {
    conclusion:
      | "nhanes_wrist_private_cache_ready_for_5y_shadow_loop"
      | "nhanes_wrist_private_cache_materialized_but_sparse";
    nextLocalAction:
      | "build_5y_wrist_activity_shadow_loop"
      | "inspect_private_cache_coverage_before_scoring";
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  packetId: "r1064-nhanes-wrist-private-materializer";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1064_NHANES_WRIST_PRIVATE_MATERIALIZER_SCHEMA_VERSION;
  status: "research-local-private-cache-plus-aggregate-receipt";
  summary: {
    analyticCacheMaterialized: true;
    eligibleFiveYearCountBand: string;
    eligibleFiveYearEventCountBand: string;
    productDisplayAuthorized: false;
    rowValuesInExternalArtifact: false;
    sourceRoute: "nhanes_2011_2014_wrist_activity_labs_mortality_sidecar";
    totalMaterializedRowCountBand: string;
    usableAsConsumerWearableValidation: false;
  };
}

export async function runR1064NhanesWristPrivateMaterializer(
  options: R1064NhanesWristPrivateMaterializerOptions = {},
): Promise<{
  analyticCachePath: string;
  output: R1064NhanesWristPrivateMaterializerOutput;
  outputPath: string;
}> {
  const sourceCacheRoot = options.sourceCacheRoot ?? DEFAULT_SOURCE_CACHE_ROOT;
  const analyticCachePath = options.analyticCachePath ?? DEFAULT_ANALYTIC_CACHE_PATH;
  const rowsByCycle = await Promise.all(CYCLE_CONFIGS.map((cycle) => buildCycleRows(sourceCacheRoot, cycle)));
  const rows = rowsByCycle.flatMap((cycle) => cycle.rows);
  if (rows.length === 0) throw new Error("R1064 could not materialize any local NHANES wrist rows.");

  const csv = rowsToCsv(rows);
  const gzipped = gzipSync(Buffer.from(csv, "utf8"));
  await mkdir(path.dirname(analyticCachePath), { recursive: true });
  await writeFile(analyticCachePath, gzipped);

  const eligibleRows = rows.filter((row) => row.eligibleFiveYearEndpoint);
  const eligibleEvents = eligibleRows.filter((row) => row.fiveYearEvent === 1);
  const cycles = rowsByCycle.map(({ cycleId, rows: cycleRows }) => cycleSummary(cycleId, cycleRows));
  const enoughEndpointRows = eligibleRows.length >= 100 && eligibleEvents.length >= 10;
  const output: R1064NhanesWristPrivateMaterializerOutput = {
    artifactBoundary: safeBoundary(),
    cacheReceipt: {
      contentSha256: createHash("sha256").update(gzipped).digest("hex"),
      privateAnalyticCacheWritten: true,
      rowCacheScope: "ignored_local_runtime_cache_only",
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    cycles,
    endpointPolicy: {
      primaryExecutableEndpoint: "5y_all_cause_mortality",
      tenYearEndpointReady: false,
      tenYearEndpointReason: "2011_2014_public_lmf_followup_is_not_clean_10y_for_this_sidecar",
    },
    nextStep: {
      conclusion: enoughEndpointRows
        ? "nhanes_wrist_private_cache_ready_for_5y_shadow_loop"
        : "nhanes_wrist_private_cache_materialized_but_sparse",
      nextLocalAction: enoughEndpointRows
        ? "build_5y_wrist_activity_shadow_loop"
        : "inspect_private_cache_coverage_before_scoring",
      reviewGptRequiredBeforeNextLocalRun: false,
    },
    packetId: "r1064-nhanes-wrist-private-materializer",
    productDisplayAuthorized: false,
    schemaVersion: R1064_NHANES_WRIST_PRIVATE_MATERIALIZER_SCHEMA_VERSION,
    status: "research-local-private-cache-plus-aggregate-receipt",
    summary: {
      analyticCacheMaterialized: true,
      eligibleFiveYearCountBand: countBand(eligibleRows.length),
      eligibleFiveYearEventCountBand: countBand(eligibleEvents.length),
      productDisplayAuthorized: false,
      rowValuesInExternalArtifact: false,
      sourceRoute: "nhanes_2011_2014_wrist_activity_labs_mortality_sidecar",
      totalMaterializedRowCountBand: countBand(rows.length),
      usableAsConsumerWearableValidation: false,
    },
  };

  assertR1064Safe(output);
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { analyticCachePath, output, outputPath };
}

export async function readXptRows(filePath: string, selectedVariables: readonly string[]): Promise<XptTable> {
  const buffer = await readFile(filePath);
  const layout = readXptLayout(buffer);
  const selected = selectedVariables.map((name) => {
    const variable = layout.variables.find((candidate) => candidate.name === name);
    if (!variable) throw new Error(`XPT variable not found: ${name}`);
    return variable;
  });
  const rows: Record<string, number | string | null>[] = [];
  for (let rowIndex = 0; rowIndex < layout.rowCount; rowIndex += 1) {
    const rowOffset = layout.dataStart + rowIndex * layout.rowLength;
    const row: Record<string, number | string | null> = {};
    for (const variable of selected) {
      const start = rowOffset + variable.offset;
      const cell = buffer.subarray(start, start + variable.length);
      row[variable.name] = variable.type === "numeric" ? decodeXptNumeric(cell) : decodeXptCharacter(cell);
    }
    if (Object.values(row).some((value) => value !== null)) rows.push(row);
  }
  return { rowCount: layout.rowCount, rows };
}

function readXptLayout(buffer: Buffer): {
  dataStart: number;
  rowCount: number;
  rowLength: number;
  variables: XptVariableLayout[];
} {
  const ascii = buffer.toString("ascii");
  const namestrHeaderOffset = ascii.indexOf("HEADER RECORD*******NAMESTR HEADER RECORD");
  if (namestrHeaderOffset < 0) throw new Error("XPT NAMESTR header not found.");
  const variableCount = Number.parseInt(ascii.slice(namestrHeaderOffset + 50, namestrHeaderOffset + 58), 10);
  if (!Number.isInteger(variableCount) || variableCount <= 0) throw new Error("XPT variable count not readable.");
  const namestrStart = namestrHeaderOffset + 80;
  const variables: XptVariableLayout[] = [];
  let rowOffset = 0;
  for (let index = 0; index < variableCount; index += 1) {
    const descriptor = buffer.subarray(namestrStart + index * 140, namestrStart + (index + 1) * 140);
    const length = descriptor.readUInt16BE(4);
    variables.push({
      length,
      name: descriptor.toString("ascii", 8, 16).trim(),
      offset: rowOffset,
      type: variableType(descriptor.readUInt16BE(0)),
    });
    rowOffset += length;
  }
  const obsHeaderOffset = ascii.indexOf("HEADER RECORD*******OBS", namestrStart + variableCount * 140);
  const dataStart = obsHeaderOffset >= 0 ? obsHeaderOffset + 80 : align80(namestrStart + variableCount * 140) + 80;
  const rowLength = rowOffset;
  const rowCount = rowLength > 0 ? Math.floor(Math.max(0, buffer.length - dataStart) / rowLength) : 0;
  return { dataStart, rowCount, rowLength, variables };
}

function decodeXptCharacter(buffer: Buffer): string | null {
  const value = buffer.toString("ascii").trim();
  return value.length > 0 ? value : null;
}

export function decodeXptNumeric(buffer: Buffer): number | null {
  if (buffer.every((byte) => byte === 0)) return 0;
  if (buffer.every((byte) => byte === 0x20)) return null;
  const first = buffer[0];
  if (first === undefined) return null;
  if (first === 0x2e || first === 0x5f) return null;
  const sign = (first & 0x80) === 0x80 ? -1 : 1;
  const exponent = (first & 0x7f) - 64;
  let fraction = 0;
  for (let index = 1; index < Math.min(buffer.length, 8); index += 1) {
    fraction += buffer[index]! / (256 ** index);
  }
  const value = sign * fraction * (16 ** exponent);
  return Number.isFinite(value) ? value : null;
}

async function buildCycleRows(
  cacheRoot: string,
  cycle: typeof CYCLE_CONFIGS[number],
): Promise<{ cycleId: CycleSummary["cycleId"]; rows: AnalyticRow[] }> {
  const xptPath = (fileName: string) => path.join(cacheRoot, cycle.xptDir, fileName);
  const [
    activityDay,
    body,
    bp,
    cbc,
    chemistry,
    demographics,
    glycemia,
    hdl,
    triglycerides,
    mortalityByParticipant,
  ] = await Promise.all([
    readXptRows(xptPath(`PAXDAY_${cycle.suffix}.XPT`), [
      "SEQN",
      "PAXTMD",
      "PAXVMD",
      "PAXMTSD",
      "PAXWWMD",
      "PAXSWMD",
      "PAXNWMD",
    ]),
    readXptRows(xptPath(`BMX_${cycle.suffix}.XPT`), ["SEQN", "BMXBMI", "BMXWAIST"]),
    readXptRows(xptPath(`BPX_${cycle.suffix}.XPT`), ["SEQN", "BPXSY1", "BPXDI1"]),
    readXptRows(xptPath(`CBC_${cycle.suffix}.XPT`), ["SEQN", "LBXWBCSI", "LBXLYPCT", "LBXRDW"]),
    readXptRows(xptPath(`BIOPRO_${cycle.suffix}.XPT`), ["SEQN", "LBXSAL", "LBXSCR", "LBXSAPSI"]),
    readXptRows(xptPath(`DEMO_${cycle.suffix}.XPT`), ["SEQN", "RIDAGEYR", "RIAGENDR", "WTMEC2YR"]),
    readXptRows(xptPath(`GHB_${cycle.suffix}.XPT`), ["SEQN", "LBXGH"]),
    readXptRows(xptPath(`HDL_${cycle.suffix}.XPT`), ["SEQN", "LBDHDD"]),
    readXptRows(xptPath(`TRIGLY_${cycle.suffix}.XPT`), ["SEQN", "LBXTR"]),
    readMortalityRows(path.join(cacheRoot, cycle.mortalityFile)),
  ]);

  const activityByParticipant = summarizeActivityDays(activityDay.rows);
  const bodyByParticipant = indexByParticipant(body.rows);
  const bpByParticipant = indexByParticipant(bp.rows);
  const cbcByParticipant = indexByParticipant(cbc.rows);
  const chemistryByParticipant = indexByParticipant(chemistry.rows);
  const glycemiaByParticipant = indexByParticipant(glycemia.rows);
  const hdlByParticipant = indexByParticipant(hdl.rows);
  const triglyceridesByParticipant = indexByParticipant(triglycerides.rows);
  const rows: AnalyticRow[] = [];

  for (const demographicsRow of demographics.rows) {
    const participantId = participantIdFromValue(demographicsRow.SEQN);
    if (!participantId) continue;
    const ageYears = numericValue(demographicsRow.RIDAGEYR);
    const mortality = mortalityByParticipant.get(participantId);
    if (!mortality?.eligible) continue;

    const participantKey = stableParticipantKey(cycle.cycleId, participantId);
    const followupMonths = mortality.examFollowupMonths;
    const fiveYearEvent = mortality.deceased && followupMonths !== null && followupMonths <= FIVE_YEAR_MONTHS ? 1 : 0;
    const eligibleFiveYearEndpoint = followupMonths !== null
      && (followupMonths >= FIVE_YEAR_MONTHS || fiveYearEvent === 1);
    const bodyRow = bodyByParticipant.get(participantId);
    const bpRow = bpByParticipant.get(participantId);
    const cbcRow = cbcByParticipant.get(participantId);
    const chemistryRow = chemistryByParticipant.get(participantId);
    const glycemiaRow = glycemiaByParticipant.get(participantId);
    const hdlRow = hdlByParticipant.get(participantId);
    const triglyceridesRow = triglyceridesByParticipant.get(participantId);
    const activity = activityByParticipant.get(participantId) ?? emptyActivitySummary();

    rows.push({
      activitySourceShape: "wrist_2011_2014_mims_daily_summary_v0",
      ageYears,
      albumin: numericValue(chemistryRow?.LBXSAL),
      alkalinePhosphatase: numericValue(chemistryRow?.LBXSAPSI),
      bodyMassIndex: numericValue(bodyRow?.BMXBMI),
      creatinine: numericValue(chemistryRow?.LBXSCR),
      cycleId: cycle.cycleId,
      diastolicBloodPressure: numericValue(bpRow?.BPXDI1),
      eligibleFiveYearEndpoint,
      fiveYearEvent: eligibleFiveYearEndpoint ? fiveYearEvent : null,
      fiveYearFollowupMonths: followupMonths,
      hba1c: numericValue(glycemiaRow?.LBXGH),
      hdlCholesterol: numericValue(hdlRow?.LBDHDD),
      lymphocytePercent: numericValue(cbcRow?.LBXLYPCT),
      meanDailyNonwearMinutes: activity.meanDailyNonwearMinutes,
      meanDailySleepWearMinutes: activity.meanDailySleepWearMinutes,
      meanDailyTotalActivity: activity.meanDailyTotalActivity,
      meanDailyValidMinutes: activity.meanDailyValidMinutes,
      meanDailyWakeWearMinutes: activity.meanDailyWakeWearMinutes,
      participantKey,
      redCellDistributionWidth: numericValue(cbcRow?.LBXRDW),
      sampleWeightCombined: combinedTwoCycleWeight(demographicsRow.WTMEC2YR),
      sexStratum: sexStratum(demographicsRow.RIAGENDR),
      split: stableSplit(participantKey),
      systolicBloodPressure: numericValue(bpRow?.BPXSY1),
      triglycerides: numericValue(triglyceridesRow?.LBXTR),
      validDayCount: activity.validDayCount,
      waistCircumference: numericValue(bodyRow?.BMXWAIST),
      whiteBloodCellCount: numericValue(cbcRow?.LBXWBCSI),
    });
  }

  return { cycleId: cycle.cycleId, rows };
}

async function readMortalityRows(filePath: string): Promise<Map<string, MortalityRow>> {
  const content = await readFile(filePath, "utf8");
  const rows = new Map<string, MortalityRow>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const participantId = line.slice(0, 5).trim();
    if (!participantId) continue;
    rows.set(participantId, {
      deceased: line.slice(15, 16).trim() === "1",
      eligible: line.slice(14, 15).trim() === "1",
      examFollowupMonths: parseFixedWidthNumber(line.slice(45, 48)),
    });
  }
  return rows;
}

function summarizeActivityDays(rows: readonly Record<string, number | string | null>[]): Map<string, ReturnType<typeof emptyActivitySummary>> {
  const grouped = new Map<string, Record<string, number | string | null>[]>();
  for (const row of rows) {
    const participantId = participantIdFromValue(row.SEQN);
    if (!participantId) continue;
    const participantRows = grouped.get(participantId) ?? [];
    participantRows.push(row);
    grouped.set(participantId, participantRows);
  }
  const summaries = new Map<string, ReturnType<typeof emptyActivitySummary>>();
  for (const [participantId, participantRows] of grouped) {
    const usableRows = participantRows.filter((row) =>
      numericValue(row.PAXMTSD) !== null && dailyWearMinutes(row) !== null && dailyWearMinutes(row)! > 0
    );
    summaries.set(participantId, {
      meanDailyNonwearMinutes: meanMetric(usableRows, "PAXNWMD"),
      meanDailySleepWearMinutes: meanMetric(usableRows, "PAXSWMD"),
      meanDailyTotalActivity: meanMetric(usableRows, "PAXMTSD"),
      meanDailyValidMinutes: meanOf(usableRows.map(dailyWearMinutes)),
      meanDailyWakeWearMinutes: meanMetric(usableRows, "PAXWWMD"),
      validDayCount: usableRows.length,
    });
  }
  return summaries;
}

function emptyActivitySummary() {
  return {
    meanDailyNonwearMinutes: null as number | null,
    meanDailySleepWearMinutes: null as number | null,
    meanDailyTotalActivity: null as number | null,
    meanDailyValidMinutes: null as number | null,
    meanDailyWakeWearMinutes: null as number | null,
    validDayCount: 0,
  };
}

function dailyWearMinutes(row: Record<string, number | string | null>): number | null {
  const validMinutes = numericValue(row.PAXVMD);
  if (validMinutes !== null) return validMinutes;
  const totalMinutes = numericValue(row.PAXTMD);
  const nonwearMinutes = numericValue(row.PAXNWMD);
  if (totalMinutes !== null && nonwearMinutes !== null) return totalMinutes - nonwearMinutes;
  const wakeWearMinutes = numericValue(row.PAXWWMD);
  const sleepWearMinutes = numericValue(row.PAXSWMD);
  if (wakeWearMinutes !== null && sleepWearMinutes !== null) return wakeWearMinutes + sleepWearMinutes;
  return null;
}

function rowsToCsv(rows: readonly AnalyticRow[]): string {
  const header = [
    "participant_key",
    "cycle_id",
    "split",
    "sample_weight_combined",
    "primary_5y_event",
    "primary_5y_followup_months",
    "eligible_5y_endpoint",
    "age_years",
    "sex_stratum",
    "systolic_blood_pressure",
    "diastolic_blood_pressure",
    "body_mass_index",
    "waist_circumference",
    "albumin",
    "creatinine",
    "hba1c",
    "alkaline_phosphatase",
    "white_blood_cell_count",
    "lymphocyte_percent",
    "red_cell_distribution_width",
    "hdl_cholesterol",
    "triglycerides",
    "valid_day_count",
    "mean_daily_valid_minutes",
    "mean_daily_total_activity",
    "mean_daily_wake_wear_minutes",
    "mean_daily_sleep_wear_minutes",
    "mean_daily_nonwear_minutes",
    "activity_source_shape",
  ] as const;
  const lines = [
    header.join(","),
    ...rows.map((row) => [
      row.participantKey,
      row.cycleId,
      row.split,
      row.sampleWeightCombined,
      row.fiveYearEvent,
      row.fiveYearFollowupMonths,
      row.eligibleFiveYearEndpoint ? 1 : 0,
      row.ageYears,
      row.sexStratum,
      row.systolicBloodPressure,
      row.diastolicBloodPressure,
      row.bodyMassIndex,
      row.waistCircumference,
      row.albumin,
      row.creatinine,
      row.hba1c,
      row.alkalinePhosphatase,
      row.whiteBloodCellCount,
      row.lymphocytePercent,
      row.redCellDistributionWidth,
      row.hdlCholesterol,
      row.triglycerides,
      row.validDayCount,
      row.meanDailyValidMinutes,
      row.meanDailyTotalActivity,
      row.meanDailyWakeWearMinutes,
      row.meanDailySleepWearMinutes,
      row.meanDailyNonwearMinutes,
      row.activitySourceShape,
    ].map(csvCell).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

function cycleSummary(cycleId: CycleSummary["cycleId"], rows: readonly AnalyticRow[]): CycleSummary {
  const eligibleFiveYearRows = rows.filter((row) => row.eligibleFiveYearEndpoint);
  return {
    activityCoverageCountBand: countBand(rows.filter((row) => row.validDayCount > 0).length),
    adultEligibleCountBand: countBand(rows.filter((row) => row.ageYears !== null && row.ageYears >= 40 && row.ageYears <= 79).length),
    cycleId,
    fiveYearEndpointObservedCountBand: countBand(eligibleFiveYearRows.length),
    fiveYearEventCountBand: countBand(eligibleFiveYearRows.filter((row) => row.fiveYearEvent === 1).length),
    lab9CoverageCountBand: countBand(rows.filter(hasLab9Coverage).length),
    materializedRowCountBand: countBand(rows.length),
  };
}

function hasLab9Coverage(row: AnalyticRow): boolean {
  return [
    row.albumin,
    row.alkalinePhosphatase,
    row.bodyMassIndex,
    row.creatinine,
    row.hba1c,
    row.hdlCholesterol,
    row.lymphocytePercent,
    row.redCellDistributionWidth,
    row.triglycerides,
    row.waistCircumference,
    row.whiteBloodCellCount,
  ].every((value) => value !== null);
}

function assertR1064Safe(output: R1064NhanesWristPrivateMaterializerOutput): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1064SpecificFindings(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1064 NHANES wrist private materializer failed aggregate-egress validation: ${findings.join("; ")}`);
  }
}

function findR1064SpecificFindings(output: R1064NhanesWristPrivateMaterializerOutput): string[] {
  const findings: string[] = [];
  if (output.productDisplayAuthorized !== false || output.summary.productDisplayAuthorized !== false) {
    findings.push("product display must remain locked");
  }
  if (output.summary.rowValuesInExternalArtifact !== false) {
    findings.push("row values must not leave the local cache");
  }
  const serialized = JSON.stringify(output);
  for (const forbidden of [".runtime/", "participant_key", "SEQN", "primary_5y_event"]) {
    if (serialized.includes(forbidden)) findings.push(`forbidden external artifact content ${forbidden}`);
  }
  return findings;
}

function safeBoundary() {
  return {
    aggregateOnlyExternalOutput: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    localRowCacheWritten: true,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  } as const;
}

function indexByParticipant(rows: readonly Record<string, number | string | null>[]): Map<string, Record<string, number | string | null>> {
  const indexed = new Map<string, Record<string, number | string | null>>();
  for (const row of rows) {
    const participantId = participantIdFromValue(row.SEQN);
    if (participantId) indexed.set(participantId, row);
  }
  return indexed;
}

function stableParticipantKey(cycleId: string, participantId: string): string {
  return createHash("sha256").update(`murph-age:${cycleId}:${participantId}`).digest("hex").slice(0, 24);
}

function stableSplit(participantKey: string): Split {
  const byte = createHash("sha256").update(`r1064-split:${participantKey}`).digest()[0] ?? 0;
  if (byte < 153) return "train";
  if (byte < 204) return "calibration";
  return "test";
}

function participantIdFromValue(value: unknown): string | null {
  const numeric = numericValue(value);
  if (numeric === null) return null;
  return String(Math.trunc(numeric));
}

function sexStratum(value: unknown): string | null {
  const numeric = numericValue(value);
  if (numeric === 1) return "male";
  if (numeric === 2) return "female";
  return null;
}

function combinedTwoCycleWeight(value: unknown): number | null {
  const weight = numericValue(value);
  return weight === null ? null : weight / CYCLE_CONFIGS.length;
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseFixedWidthNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === ".") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function meanMetric(rows: readonly Record<string, number | string | null>[], key: string): number | null {
  return meanOf(rows.map((row) => numericValue(row[key])));
}

function meanOf(values: readonly (number | null)[]): number | null {
  const observed = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return observed.length > 0 ? observed.reduce((sum, value) => sum + value, 0) / observed.length : null;
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function variableType(typeCode: number): XptVariableLayout["type"] {
  if (typeCode === 1) return "numeric";
  if (typeCode === 2) return "character";
  return "unknown";
}

function align80(value: number): number {
  return Math.ceil(value / 80) * 80;
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 100) return "10-99";
  if (count < 1000) return "100-999";
  return "1000+";
}

async function main(): Promise<void> {
  const { output } = await runR1064NhanesWristPrivateMaterializer({
    analyticCachePath: process.env.MURPH_AGE_NHANES_WRIST_ANALYTIC_CACHE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    sourceCacheRoot: process.env.MURPH_AGE_NHANES_BENCH_CACHE_ROOT,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.nextStep.conclusion,
    eligibleFiveYearCountBand: output.summary.eligibleFiveYearCountBand,
    eligibleFiveYearEventCountBand: output.summary.eligibleFiveYearEventCountBand,
    nextLocalAction: output.nextStep.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredBeforeNextLocalRun: output.nextStep.reviewGptRequiredBeforeNextLocalRun,
    schemaVersion: output.schemaVersion,
    status: output.status,
    usableAsConsumerWearableValidation: output.summary.usableAsConsumerWearableValidation,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1064 NHANES wrist private materializer failed."}\n`);
    process.exitCode = 1;
  });
}
