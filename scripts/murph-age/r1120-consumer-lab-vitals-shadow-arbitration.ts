import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1120_CONSUMER_LAB_VITALS_SHADOW_ARBITRATION_SCHEMA_VERSION =
  "murph-age-r1120-consumer-lab-vitals-shadow-arbitration.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1120-consumer-lab-vitals-shadow-arbitration.latest.json";

const INPUTS = {
  creles: {
    artifact: "creles-local-benchmark.latest.json",
    schemaVersion: "murph-age-creles-local-benchmark.v1",
  },
  haalsi: {
    artifact: "r1044-haalsi-external-biomarker-loop.latest.json",
    packetId: "r1044-haalsi-external-biomarker-loop",
    schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
  },
  midus2: {
    artifact: "midus2-local-benchmark.latest.json",
    schemaVersion: "murph-age-midus2-local-benchmark.v1",
  },
  r1119: {
    artifact: "r1119-consumer-shadow-evidence-memory.latest.json",
    packetId: "r1119-consumer-shadow-evidence-memory",
    schemaVersion: "murph-age-r1119-consumer-shadow-evidence-memory.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type SourceKey = "creles" | "haalsi" | "midus2";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface MetricSummary {
  auc: number | null;
  brier: number | null;
  events: number | null;
  logLoss: number | null;
  n: number | null;
}

interface DeltaSummary {
  aucDelta: number | null;
  brierDelta: number | null;
  logLossDelta: number | null;
  properScoreDirection: "improves_both" | "mixed_or_worse" | "unavailable";
}

interface SourceShadowSummary {
  l1TinyGlycemiaVsReference: DeltaSummary;
  l2CommonLabVitalsVsL1: DeltaSummary;
  sourceKey: SourceKey;
  status: "available" | "missing_or_unusable";
  testEventCountBand: "0" | "1-9" | "10-99" | "100+";
  testRowCountBand: "0" | "1-99" | "100-999" | "1000+";
}

export interface R1120ConsumerLabVitalsShadowArbitrationOptions {
  crelesPath?: string;
  createdAt?: string;
  haalsiPath?: string;
  midus2Path?: string;
  outputDir?: string;
  r1119Path?: string;
}

export interface R1120ConsumerLabVitalsShadowArbitrationOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1120: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1120: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  arbitration: {
    candidateDecision: {
      l1TinyGlycemia: "run_first_in_consumer_compatible_receipt";
      l2CommonLabVitals: "include_as_secondary_comparator_not_lead";
      wearableFamilies: "blocked_until_outcome_linked_wearable_receipt";
    };
    consumerPriority: {
      ageRangeFocus: "16_to_50";
      averageUserInputScope: [
        "common_bloodwork_labs",
        "basic_body_vitals",
        "wearable_activity",
        "wearable_sleep",
        "wearable_recovery",
      ];
      firstExecutableFamily: "common_bloodwork_labs";
      wearableExecutionPolicy: "outcome_linked_receipt_required_before_scoring";
    };
    supportCounts: {
      l1ProperScoreImproveSources: number;
      l1UsableSources: number;
      l2ProperScoreImproveOverL1Sources: number;
      l2UsableSources: number;
    };
    sourceSummaries: SourceShadowSummary[];
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1120-consumer-lab-vitals-shadow-arbitration";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1120_CONSUMER_LAB_VITALS_SHADOW_ARBITRATION_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "consumer_lab_vitals_shadow_arbitration_l1_first"
      | "consumer_lab_vitals_shadow_arbitration_waiting_on_inputs";
    nextAction:
      | "run_consumer_compatible_l1_receipt_with_l2_secondary_or_fill_private_mapping"
      | "refresh_midus_creles_haalsi_r1119_before_arbitration";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1120: false;
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
    topCandidate: "L1_tiny_glycemia_only";
  };
}

export async function runR1120ConsumerLabVitalsShadowArbitration(
  options: R1120ConsumerLabVitalsShadowArbitrationOptions = {},
): Promise<{ output: R1120ConsumerLabVitalsShadowArbitrationOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const sourceSummaries = [
    summarizeSource("midus2", inputs.midus2, {
      l1Id: "glycemia_only_no_crp",
      l2Id: "clinical_core_labs_no_albumin_no_crp",
      referenceId: "age_sex_reference",
    }),
    summarizeSource("creles", inputs.creles, {
      l1Id: "glycemia_only_no_crp",
      l2Id: "bp_lipid_body_no_crp",
      referenceId: "age_sex_reference",
    }),
    summarizeSource("haalsi", inputs.haalsi, {
      l1Id: "A1_glucose",
      l2Id: "B1_glucose_lipid_body_no_crp",
      referenceId: "A0_age_sex",
    }),
  ];
  const supportCounts = summarizeSupport(sourceSummaries);
  const ready = inputMatchesExpected("midus2", inputs.midus2)
    && inputMatchesExpected("creles", inputs.creles)
    && inputMatchesExpected("haalsi", inputs.haalsi)
    && inputMatchesExpected("r1119", inputs.r1119)
    && readStringAt(inputs.r1119, ["summary", "conclusion"]) === "shadow_lab_evidence_recorded_continue_consumer_receipt_search"
    && supportCounts.l1UsableSources >= 2;

  const output: R1120ConsumerLabVitalsShadowArbitrationOutput = {
    arbitration: {
      candidateDecision: {
        l1TinyGlycemia: "run_first_in_consumer_compatible_receipt",
        l2CommonLabVitals: "include_as_secondary_comparator_not_lead",
        wearableFamilies: "blocked_until_outcome_linked_wearable_receipt",
      },
      consumerPriority: {
        ageRangeFocus: "16_to_50",
        averageUserInputScope: [
          "common_bloodwork_labs",
          "basic_body_vitals",
          "wearable_activity",
          "wearable_sleep",
          "wearable_recovery",
        ],
        firstExecutableFamily: "common_bloodwork_labs",
        wearableExecutionPolicy: "outcome_linked_receipt_required_before_scoring",
      },
      sourceSummaries,
      supportCounts,
    },
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1120-consumer-lab-vitals-shadow-arbitration",
    productDisplayAuthorized: false,
    schemaVersion: R1120_CONSUMER_LAB_VITALS_SHADOW_ARBITRATION_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "consumer_lab_vitals_shadow_arbitration_l1_first"
        : "consumer_lab_vitals_shadow_arbitration_waiting_on_inputs",
      nextAction: ready
        ? "run_consumer_compatible_l1_receipt_with_l2_secondary_or_fill_private_mapping"
        : "refresh_midus_creles_haalsi_r1119_before_arbitration",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1120: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      topCandidate: "L1_tiny_glycemia_only",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1120 consumer lab/vitals shadow arbitration failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeSource(
  sourceKey: SourceKey,
  input: unknown | null,
  ids: { l1Id: string; l2Id: string; referenceId: string },
): SourceShadowSummary {
  const reference = readMetric(input, ids.referenceId);
  const l1 = readMetric(input, ids.l1Id);
  const l2 = readMetric(input, ids.l2Id);
  const status = reference && l1 && l2 ? "available" : "missing_or_unusable";
  return {
    l1TinyGlycemiaVsReference: deltaSummary(l1, reference),
    l2CommonLabVitalsVsL1: deltaSummary(l2, l1),
    sourceKey,
    status,
    testEventCountBand: eventBand(l1?.events ?? reference?.events ?? null),
    testRowCountBand: rowBand(l1?.n ?? reference?.n ?? null),
  };
}

function readMetric(input: unknown | null, modelId: string): MetricSummary | null {
  const raw = readAt(input, ["models", modelId, "splitMetrics", "test"]);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return {
    auc: finiteNumber(record.auc),
    brier: finiteNumber(record.brier),
    events: finiteNumber(record.events),
    logLoss: finiteNumber(record.logLoss),
    n: finiteNumber(record.n),
  };
}

function deltaSummary(candidate: MetricSummary | null, comparator: MetricSummary | null): DeltaSummary {
  const aucDelta = delta(candidate?.auc ?? null, comparator?.auc ?? null);
  const brierDelta = delta(candidate?.brier ?? null, comparator?.brier ?? null);
  const logLossDelta = delta(candidate?.logLoss ?? null, comparator?.logLoss ?? null);
  return {
    aucDelta,
    brierDelta,
    logLossDelta,
    properScoreDirection: brierDelta === null || logLossDelta === null
      ? "unavailable"
      : brierDelta < 0 && logLossDelta < 0
        ? "improves_both"
        : "mixed_or_worse",
  };
}

function summarizeSupport(sourceSummaries: SourceShadowSummary[]): R1120ConsumerLabVitalsShadowArbitrationOutput["arbitration"]["supportCounts"] {
  return {
    l1ProperScoreImproveSources: sourceSummaries.filter((source) =>
      source.l1TinyGlycemiaVsReference.properScoreDirection === "improves_both"
    ).length,
    l1UsableSources: sourceSummaries.filter((source) => source.status === "available").length,
    l2ProperScoreImproveOverL1Sources: sourceSummaries.filter((source) =>
      source.l2CommonLabVitalsVsL1.properScoreDirection === "improves_both"
    ).length,
    l2UsableSources: sourceSummaries.filter((source) => source.status === "available").length,
  };
}

async function readInputs(options: R1120ConsumerLabVitalsShadowArbitrationOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    creles: await readJsonIfPresent(options.crelesPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.creles.artifact)),
    haalsi: await readJsonIfPresent(options.haalsiPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.haalsi.artifact)),
    midus2: await readJsonIfPresent(options.midus2Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.midus2.artifact)),
    r1119: await readJsonIfPresent(options.r1119Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1119.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1120 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.entries(INPUTS) as Array<[InputKey, typeof INPUTS[InputKey]]>).map(([key, expected]) => {
      const input = inputs[key];
      const packetId = "packetId" in expected ? readStringAt(input, ["packetId"]) : null;
      const schemaVersion = readStringAt(input, ["schemaVersion"]);
      return [key, {
        artifact: expected.artifact,
        packetId: "packetId" in expected && packetId === expected.packetId ? expected.packetId : null,
        schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
        status: input ? "available" : "missing",
      }];
    }),
  ) as Record<InputKey, ArtifactSummary>;
}

function inputMatchesExpected(key: InputKey, input: unknown | null): boolean {
  const expected = INPUTS[key];
  const schemaMatches = readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
  if (!("packetId" in expected)) return schemaMatches;
  return schemaMatches && readStringAt(input, ["packetId"]) === expected.packetId;
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
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function delta(candidate: number | null, comparator: number | null): number | null {
  if (candidate === null || comparator === null) return null;
  return Math.round((candidate - comparator) * 100_000_000) / 100_000_000;
}

function eventBand(value: number | null): SourceShadowSummary["testEventCountBand"] {
  if (value === null || value <= 0) return "0";
  if (value < 10) return "1-9";
  if (value < 100) return "10-99";
  return "100+";
}

function rowBand(value: number | null): SourceShadowSummary["testRowCountBand"] {
  if (value === null || value <= 0) return "0";
  if (value < 100) return "1-99";
  if (value < 1000) return "100-999";
  return "1000+";
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

function safeBoundary(): R1120ConsumerLabVitalsShadowArbitrationOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1120: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1120: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1120ConsumerLabVitalsShadowArbitration({
    crelesPath: process.env.MURPH_AGE_CRELES_LOCAL_BENCHMARK_PATH,
    haalsiPath: process.env.MURPH_AGE_R1044_HAALSI_BIOMARKER_PATH,
    midus2Path: process.env.MURPH_AGE_MIDUS2_LOCAL_BENCHMARK_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1119Path: process.env.MURPH_AGE_R1119_SHADOW_MEMORY_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    l1ProperScoreImproveSources: output.arbitration.supportCounts.l1ProperScoreImproveSources,
    l2ProperScoreImproveOverL1Sources: output.arbitration.supportCounts.l2ProperScoreImproveOverL1Sources,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1120: output.summary.rowParsingPerformedByR1120,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetInputPriority: output.summary.targetInputPriority,
    topCandidate: output.summary.topCandidate,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1120 consumer lab/vitals shadow arbitration failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
