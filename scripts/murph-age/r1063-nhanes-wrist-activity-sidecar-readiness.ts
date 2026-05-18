import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1063_NHANES_WRIST_ACTIVITY_SIDECAR_READINESS_SCHEMA_VERSION =
  "murph-age-r1063-nhanes-wrist-activity-sidecar-readiness.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_CACHE_ROOT = path.join(".runtime", "cache", "murph-age", "nhanes-bench-0");
const OUTPUT_FILE_NAME = "r1063-nhanes-wrist-activity-sidecar-readiness.latest.json";

const CYCLE_CONFIGS = [
  {
    cycleId: "2011-2012",
    mortalityFile: path.join("raw", "linked-mortality-2019", "NHANES_2011_2012_MORT_2019_PUBLIC.dat"),
    xptDir: path.join("raw", "nhanes-public-xpt", "2011"),
    suffix: "G",
  },
  {
    cycleId: "2013-2014",
    mortalityFile: path.join("raw", "linked-mortality-2019", "NHANES_2013_2014_MORT_2019_PUBLIC.dat"),
    xptDir: path.join("raw", "nhanes-public-xpt", "2013"),
    suffix: "H",
  },
] as const;

const XPT_GROUPS = [
  "activityDay",
  "activityHeader",
  "body",
  "bp",
  "cbc",
  "chemistry",
  "demographics",
  "glycemia",
  "hdl",
  "triglycerides",
] as const;

const REQUIRED_VARIABLES: Record<typeof XPT_GROUPS[number], readonly string[]> = {
  activityDay: ["SEQN", "PAXDAYD", "PAXTMD", "PAXVMD", "PAXMTSD", "PAXWWMD", "PAXSWMD", "PAXNWMD", "PAXQFD"],
  activityHeader: ["SEQN", "PAXSTS", "PAXHAND", "PAXORENT"],
  body: ["SEQN", "BMXBMI", "BMXWAIST"],
  bp: ["SEQN", "BPXSY1", "BPXDI1"],
  cbc: ["SEQN", "LBXWBCSI", "LBXLYPCT", "LBXRDW"],
  chemistry: ["SEQN", "LBXSAL", "LBXSCR", "LBXSAPSI"],
  demographics: ["SEQN", "RIDAGEYR", "RIAGENDR", "WTMEC2YR"],
  glycemia: ["SEQN", "LBXGH"],
  hdl: ["SEQN", "LBDHDD"],
  triglycerides: ["SEQN", "LBXTR"],
};

type XptGroup = typeof XPT_GROUPS[number];

interface XptVariableMetadata {
  length: number;
  name: string;
  type: "character" | "numeric" | "unknown";
}

interface XptMetadata {
  rowCountBand: string;
  rowLengthBand: string;
  variableCount: number;
  variables: XptVariableMetadata[];
}

interface FileReadiness {
  group: XptGroup | "mortality";
  missingRequiredVariables: string[];
  requiredVariablesPresent: boolean;
  rowCountBand: string | null;
  status: "missing" | "parse_failed" | "ready";
  variableCount: number | null;
}

interface CycleReadiness {
  cycleId: "2011-2012" | "2013-2014";
  files: FileReadiness[];
  ready: boolean;
}

export interface R1063NhanesWristActivitySidecarReadinessOptions {
  cacheRoot?: string;
  createdAt?: string;
  outputDir?: string;
}

export interface R1063NhanesWristActivitySidecarReadinessOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1063: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    xptMetadataOnly: true;
  };
  createdAt: string;
  cycles: CycleReadiness[];
  nextStep: {
    conclusion:
      | "nhanes_wrist_activity_sidecar_ready_for_private_materializer"
      | "nhanes_wrist_activity_sidecar_sources_missing_or_unreadable";
    nextLocalAction:
      | "build_private_wrist_activity_materializer"
      | "repair_or_download_missing_wrist_activity_sources";
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  packetId: "r1063-nhanes-wrist-activity-sidecar-readiness";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1063_NHANES_WRIST_ACTIVITY_SIDECAR_READINESS_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    readyCycleCount: number;
    requiredCycleCount: 2;
    rowParsingPerformedByR1063: false;
    sourceRoute: "nhanes_2011_2014_wrist_activity_labs_mortality_sidecar";
    usableAsConsumerWearableValidation: false;
  };
}

export async function runR1063NhanesWristActivitySidecarReadiness(
  options: R1063NhanesWristActivitySidecarReadinessOptions = {},
): Promise<{ output: R1063NhanesWristActivitySidecarReadinessOutput; outputPath: string }> {
  const cacheRoot = options.cacheRoot ?? DEFAULT_CACHE_ROOT;
  const cycles = await Promise.all(CYCLE_CONFIGS.map((cycle) => inspectCycle(cacheRoot, cycle)));
  const readyCycleCount = cycles.filter((cycle) => cycle.ready).length;
  const fullyReady = readyCycleCount === CYCLE_CONFIGS.length;
  const output: R1063NhanesWristActivitySidecarReadinessOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    cycles,
    nextStep: {
      conclusion: fullyReady
        ? "nhanes_wrist_activity_sidecar_ready_for_private_materializer"
        : "nhanes_wrist_activity_sidecar_sources_missing_or_unreadable",
      nextLocalAction: fullyReady
        ? "build_private_wrist_activity_materializer"
        : "repair_or_download_missing_wrist_activity_sources",
      reviewGptRequiredBeforeNextLocalRun: false,
    },
    packetId: "r1063-nhanes-wrist-activity-sidecar-readiness",
    productDisplayAuthorized: false,
    schemaVersion: R1063_NHANES_WRIST_ACTIVITY_SIDECAR_READINESS_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      readyCycleCount,
      requiredCycleCount: 2,
      rowParsingPerformedByR1063: false,
      sourceRoute: "nhanes_2011_2014_wrist_activity_labs_mortality_sidecar",
      usableAsConsumerWearableValidation: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1063SpecificFindings(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1063 NHANES wrist activity sidecar readiness failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function inspectCycle(
  cacheRoot: string,
  cycle: typeof CYCLE_CONFIGS[number],
): Promise<CycleReadiness> {
  const files = await Promise.all([
    inspectXptGroup(cacheRoot, cycle, "activityDay", `PAXDAY_${cycle.suffix}.XPT`),
    inspectXptGroup(cacheRoot, cycle, "activityHeader", `PAXHD_${cycle.suffix}.XPT`),
    inspectXptGroup(cacheRoot, cycle, "body", `BMX_${cycle.suffix}.XPT`),
    inspectXptGroup(cacheRoot, cycle, "bp", `BPX_${cycle.suffix}.XPT`),
    inspectXptGroup(cacheRoot, cycle, "cbc", `CBC_${cycle.suffix}.XPT`),
    inspectXptGroup(cacheRoot, cycle, "chemistry", `BIOPRO_${cycle.suffix}.XPT`),
    inspectXptGroup(cacheRoot, cycle, "demographics", `DEMO_${cycle.suffix}.XPT`),
    inspectXptGroup(cacheRoot, cycle, "glycemia", `GHB_${cycle.suffix}.XPT`),
    inspectXptGroup(cacheRoot, cycle, "hdl", `HDL_${cycle.suffix}.XPT`),
    inspectXptGroup(cacheRoot, cycle, "triglycerides", `TRIGLY_${cycle.suffix}.XPT`),
    inspectMortalityFile(cacheRoot, cycle.mortalityFile),
  ]);
  return {
    cycleId: cycle.cycleId,
    files,
    ready: files.every((file) => file.status === "ready" && file.requiredVariablesPresent),
  };
}

async function inspectXptGroup(
  cacheRoot: string,
  cycle: typeof CYCLE_CONFIGS[number],
  group: XptGroup,
  fileName: string,
): Promise<FileReadiness> {
  try {
    const metadata = await readXptMetadata(path.join(cacheRoot, cycle.xptDir, fileName));
    const present = new Set(metadata.variables.map((variable) => variable.name));
    const missingRequiredVariables = REQUIRED_VARIABLES[group].filter((variable) => !present.has(variable));
    return {
      group,
      missingRequiredVariables,
      requiredVariablesPresent: missingRequiredVariables.length === 0,
      rowCountBand: metadata.rowCountBand,
      status: "ready",
      variableCount: metadata.variableCount,
    };
  } catch {
    return {
      group,
      missingRequiredVariables: [...REQUIRED_VARIABLES[group]],
      requiredVariablesPresent: false,
      rowCountBand: null,
      status: "parse_failed",
      variableCount: null,
    };
  }
}

async function inspectMortalityFile(cacheRoot: string, relativeFilePath: string): Promise<FileReadiness> {
  try {
    const fileStat = await stat(path.join(cacheRoot, relativeFilePath));
    return {
      group: "mortality",
      missingRequiredVariables: [],
      requiredVariablesPresent: fileStat.size > 0,
      rowCountBand: fileSizeBand(fileStat.size),
      status: fileStat.size > 0 ? "ready" : "missing",
      variableCount: null,
    };
  } catch {
    return {
      group: "mortality",
      missingRequiredVariables: [],
      requiredVariablesPresent: false,
      rowCountBand: null,
      status: "missing",
      variableCount: null,
    };
  }
}

export async function readXptMetadata(filePath: string): Promise<XptMetadata> {
  const buffer = await readFile(filePath);
  const ascii = buffer.toString("ascii");
  const namestrHeaderOffset = ascii.indexOf("HEADER RECORD*******NAMESTR HEADER RECORD");
  if (namestrHeaderOffset < 0) throw new Error("XPT NAMESTR header not found.");
  const variableCount = Number.parseInt(ascii.slice(namestrHeaderOffset + 50, namestrHeaderOffset + 58), 10);
  if (!Number.isInteger(variableCount) || variableCount <= 0) throw new Error("XPT variable count not readable.");
  const namestrStart = namestrHeaderOffset + 80;
  const variables: XptVariableMetadata[] = [];
  for (let index = 0; index < variableCount; index += 1) {
    const descriptor = buffer.subarray(namestrStart + index * 140, namestrStart + (index + 1) * 140);
    variables.push({
      length: descriptor.readUInt16BE(4),
      name: descriptor.toString("ascii", 8, 16).trim(),
      type: variableType(descriptor.readUInt16BE(0)),
    });
  }
  const rowLength = variables.reduce((sum, variable) => sum + variable.length, 0);
  const obsHeaderOffset = ascii.indexOf("HEADER RECORD*******OBS", namestrStart + variableCount * 140);
  const dataStart = obsHeaderOffset >= 0 ? obsHeaderOffset + 80 : align80(namestrStart + variableCount * 140) + 80;
  const rawDataLength = Math.max(0, buffer.length - dataStart);
  const rowCount = rowLength > 0 ? Math.floor(rawDataLength / rowLength) : 0;
  return {
    rowCountBand: countBand(rowCount),
    rowLengthBand: countBand(rowLength),
    variableCount,
    variables,
  };
}

function variableType(typeCode: number): XptVariableMetadata["type"] {
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

function fileSizeBand(bytes: number): string {
  if (bytes <= 0) return "0";
  if (bytes < 1024) return "lt_1kb";
  if (bytes < 1024 * 1024) return "kb_to_lt_1mb";
  return "gte_1mb";
}

function safeBoundary() {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1063: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    xptMetadataOnly: true,
  } as const;
}

function findR1063SpecificFindings(output: R1063NhanesWristActivitySidecarReadinessOutput): string[] {
  const findings: string[] = [];
  if (output.productDisplayAuthorized !== false || output.artifactBoundary.productDisplayAuthorized !== false) {
    findings.push("product display must remain locked");
  }
  const serialized = JSON.stringify(output);
  for (const forbidden of [".runtime/", "Respondent sequence number", "participant_key", "SEQN value"]) {
    if (serialized.includes(forbidden)) findings.push(`forbidden metadata egress ${forbidden}`);
  }
  return findings;
}

async function main(): Promise<void> {
  const { output } = await runR1063NhanesWristActivitySidecarReadiness({
    cacheRoot: process.env.MURPH_AGE_NHANES_BENCH_CACHE_ROOT,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.nextStep.conclusion,
    nextLocalAction: output.nextStep.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyCycleCount: output.summary.readyCycleCount,
    reviewGptRequiredBeforeNextLocalRun: output.nextStep.reviewGptRequiredBeforeNextLocalRun,
    schemaVersion: output.schemaVersion,
    status: output.status,
    usableAsConsumerWearableValidation: output.summary.usableAsConsumerWearableValidation,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1063 NHANES wrist activity sidecar readiness failed."}\n`);
    process.exitCode = 1;
  });
}
