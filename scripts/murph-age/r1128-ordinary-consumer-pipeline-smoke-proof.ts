import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1122LocalPrivateConsumerReceiptRunnerConfigIntake } from "./r1122-local-private-consumer-receipt-runner-config-intake.ts";
import { runR1125LocalPrivateFirstPassAggregateMetricRunner } from "./r1125-local-private-first-pass-aggregate-metric-runner.ts";

export const R1128_ORDINARY_CONSUMER_PIPELINE_SMOKE_PROOF_SCHEMA_VERSION =
  "murph-age-r1128-ordinary-consumer-pipeline-smoke-proof.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1128-ordinary-consumer-pipeline-smoke-proof.latest.json";
const PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION =
  "murph-age-local-private-consumer-receipt-runner-config.v1" as const;
const FIRST_PASS_CANDIDATE_IDS = [
  "L1_tiny_glycemia_only",
  "L2_common_lab_core_shadow",
  "W1_activity_steps_minutes",
  "QC_missingness_coverage",
] as const;
const ORDINARY_TABLE_LAYOUTS = [
  "single_primary_table_fallback",
  "multi_table_or_explicit_refs",
] as const;

const INPUTS = {
  r1113: {
    artifact: "r1113-consumer-source-execution-packet.latest.json",
    packetId: "r1113-consumer-source-execution-packet",
    schemaVersion: "murph-age-r1113-consumer-source-execution-packet.v1",
  },
  r1121: {
    artifact: "r1121-local-private-consumer-receipt-runner-contract.latest.json",
    packetId: "r1121-local-private-consumer-receipt-runner-contract",
    schemaVersion: "murph-age-r1121-local-private-consumer-receipt-runner-contract.v1",
  },
  r1127: {
    artifact: "r1127-ordinary-consumer-first-pass-submission-handoff.latest.json",
    packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
    schemaVersion: "murph-age-r1127-ordinary-consumer-first-pass-submission-handoff.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type FirstPassCandidateId = typeof FIRST_PASS_CANDIDATE_IDS[number];
type OrdinaryTableLayout = typeof ORDINARY_TABLE_LAYOUTS[number];

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SyntheticConfigPaths {
  combinedPath: string;
  labPath: string;
  outcomePath: string;
  wearablePath: string;
}

interface SyntheticSmokeResult {
  aggregateMetricsArtifact: string | null;
  ordinaryTableLayout: OrdinaryTableLayout;
  r1122Conclusion: string | null;
  r1124Conclusion: string | null;
  r1125Conclusion: string | null;
}

export interface R1128OrdinaryConsumerPipelineSmokeProofOptions {
  createdAt?: string;
  outputDir?: string;
  r1113Path?: string;
  r1121Path?: string;
  r1127Path?: string;
}

export interface R1128OrdinaryConsumerPipelineSmokeProofOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1128: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    privateConfigPathStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1128: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
    syntheticRowsPersisted: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1128-ordinary-consumer-pipeline-smoke-proof";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1128_ORDINARY_CONSUMER_PIPELINE_SMOKE_PROOF_SCHEMA_VERSION;
  smokeProof: {
    aggregateMetricsArtifactFromSyntheticRun: string | null;
    firstPassCandidateIds: FirstPassCandidateId[];
    ordinaryTableLayoutsSmokePassed: OrdinaryTableLayout[];
    ordinaryTableLayoutSmokeResults: SyntheticSmokeResult[];
    privateValuesStored: false;
    r1122Conclusion: string | null;
    r1124ConclusionFromSyntheticRun: string | null;
    r1125Conclusion: string | null;
    submissionPlanArtifact: string | null;
    syntheticEvidenceRole: "pipeline_smoke_only_not_model_evidence";
    syntheticRowsGeneratedByR1128: boolean;
    syntheticRowsPersisted: false;
  };
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "ordinary_consumer_pipeline_smoke_passed_non_evidence"
      | "ordinary_consumer_pipeline_smoke_waiting_on_handoff_inputs";
    nextAction:
      | "use_r1127_handoff_with_real_private_or_workbench_data"
      | "refresh_r1113_r1121_r1127_before_smoke_proof";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1128: false;
    syntheticEvidence: false;
  };
}

export async function runR1128OrdinaryConsumerPipelineSmokeProof(
  options: R1128OrdinaryConsumerPipelineSmokeProofOptions = {},
): Promise<{ output: R1128OrdinaryConsumerPipelineSmokeProofOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);
  const ready = inputsReadyForSmoke(inputs);
  const smokeResults = ready
    ? await runSyntheticSmoke({ r1113Path: options.r1113Path, r1121Path: options.r1121Path })
    : null;
  const primarySmoke = smokeResults
    ?.find((result) => result.ordinaryTableLayout === "single_primary_table_fallback")
    ?? smokeResults?.[0]
    ?? null;
  const output: R1128OrdinaryConsumerPipelineSmokeProofOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1128-ordinary-consumer-pipeline-smoke-proof",
    productDisplayAuthorized: false,
    schemaVersion: R1128_ORDINARY_CONSUMER_PIPELINE_SMOKE_PROOF_SCHEMA_VERSION,
    smokeProof: {
      aggregateMetricsArtifactFromSyntheticRun: primarySmoke?.aggregateMetricsArtifact ?? null,
      firstPassCandidateIds: [...FIRST_PASS_CANDIDATE_IDS],
      ordinaryTableLayoutsSmokePassed: smokeResults ? smokePassedLayouts(smokeResults) : [],
      ordinaryTableLayoutSmokeResults: smokeResults ?? [],
      privateValuesStored: false,
      r1122Conclusion: primarySmoke?.r1122Conclusion ?? null,
      r1124ConclusionFromSyntheticRun: primarySmoke?.r1124Conclusion ?? null,
      r1125Conclusion: primarySmoke?.r1125Conclusion ?? null,
      submissionPlanArtifact: readStringAt(inputs.r1127, ["summary", "submissionPlanArtifact"]),
      syntheticEvidenceRole: "pipeline_smoke_only_not_model_evidence",
      syntheticRowsGeneratedByR1128: Boolean(smokeResults?.length),
      syntheticRowsPersisted: false,
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: smokeResults
        ? "ordinary_consumer_pipeline_smoke_passed_non_evidence"
        : "ordinary_consumer_pipeline_smoke_waiting_on_handoff_inputs",
      nextAction: smokeResults
        ? "use_r1127_handoff_with_real_private_or_workbench_data"
        : "refresh_r1113_r1121_r1127_before_smoke_proof",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1128: false,
      syntheticEvidence: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1128 ordinary consumer pipeline smoke proof failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function runSyntheticSmoke(input: {
  r1113Path?: string;
  r1121Path?: string;
}): Promise<SyntheticSmokeResult[]> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "r1128-smoke-"));
  try {
    const paths = syntheticPaths(tmp);
    await writeSyntheticPrivateTables(paths, 240);
    const results = await Promise.all(ORDINARY_TABLE_LAYOUTS.map(async (ordinaryTableLayout) => {
      const configPath = path.join(tmp, `${ordinaryTableLayout}.json`);
      const outputDir = path.join(tmp, `out-${ordinaryTableLayout}`);
      await writeJson(configPath, syntheticPrivateConfig(paths, ordinaryTableLayout));

      const r1122 = await runR1122LocalPrivateConsumerReceiptRunnerConfigIntake({
        configPath,
        outputDir,
        r1121Path: input.r1121Path,
      });
      const r1125 = await runR1125LocalPrivateFirstPassAggregateMetricRunner({
        configPath,
        outputDir,
        r1113Path: input.r1113Path,
        r1121Path: input.r1121Path,
        r1122Path: r1122.outputPath,
      });

      return {
        aggregateMetricsArtifact: r1125.output.privateExecution.aggregateMetricsArtifact,
        ordinaryTableLayout,
        r1122Conclusion: r1122.output.summary.conclusion,
        r1124Conclusion: r1125.output.privateExecution.r1124Conclusion,
        r1125Conclusion: r1125.output.summary.conclusion,
      };
    }));
    return results;
  } finally {
    await rm(tmp, { force: true, recursive: true });
  }
}

function syntheticPaths(tmp: string): SyntheticConfigPaths {
  return {
    combinedPath: path.join(tmp, "combined.csv"),
    labPath: path.join(tmp, "lab.csv"),
    outcomePath: path.join(tmp, "outcome.csv"),
    wearablePath: path.join(tmp, "wearable.csv"),
  };
}

async function writeSyntheticPrivateTables(paths: SyntheticConfigPaths, rowCount: number): Promise<void> {
  await mkdir(path.dirname(paths.labPath), { recursive: true });
  const labRows = [["person_key", "glucose_value", "hba1c_value", "triglyceride_value", "systolic_value", "bmi_value"].join(",")];
  const wearableRows = [["person_key", "step_count", "active_minutes"].join(",")];
  const outcomeRows = [["person_key", "event_flag"].join(",")];
  const combinedRows = [[
    "person_key",
    "event_flag",
    "glucose_value",
    "hba1c_value",
    "triglyceride_value",
    "systolic_value",
    "bmi_value",
    "step_count",
    "active_minutes",
  ].join(",")];
  for (let index = 0; index < rowCount; index += 1) {
    const event = index < Math.ceil(rowCount * 0.52) ? 1 : 0;
    const person = `synthetic-person-${index}`;
    const jitter = (index % 7) * 0.03;
    labRows.push([
      person,
      (event ? 142 + jitter : 88 + jitter).toFixed(2),
      (event ? 6.7 + jitter : 5.1 + jitter).toFixed(2),
      (event ? 210 + jitter : 115 + jitter).toFixed(2),
      (event ? 138 + jitter : 112 + jitter).toFixed(2),
      (event ? 31 + jitter : 23 + jitter).toFixed(2),
    ].join(","));
    wearableRows.push([
      person,
      (event ? 3200 - jitter : 8600 + jitter).toFixed(2),
      (event ? 22 - jitter : 68 + jitter).toFixed(2),
    ].join(","));
    outcomeRows.push([person, String(event)].join(","));
    combinedRows.push([
      person,
      String(event),
      (event ? 142 + jitter : 88 + jitter).toFixed(2),
      (event ? 6.7 + jitter : 5.1 + jitter).toFixed(2),
      (event ? 210 + jitter : 115 + jitter).toFixed(2),
      (event ? 138 + jitter : 112 + jitter).toFixed(2),
      (event ? 31 + jitter : 23 + jitter).toFixed(2),
      (event ? 3200 - jitter : 8600 + jitter).toFixed(2),
      (event ? 22 - jitter : 68 + jitter).toFixed(2),
    ].join(","));
  }
  await Promise.all([
    writeFile(paths.combinedPath, `${combinedRows.join("\n")}\n`),
    writeFile(paths.labPath, `${labRows.join("\n")}\n`),
    writeFile(paths.outcomePath, `${outcomeRows.join("\n")}\n`),
    writeFile(paths.wearablePath, `${wearableRows.join("\n")}\n`),
  ]);
}

function syntheticPrivateConfig(paths: SyntheticConfigPaths, ordinaryTableLayout: OrdinaryTableLayout): Record<string, unknown> {
  return {
    aggregateReceiptTarget: {
      evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
      schemaVersion: "murph-age-consumer-lab-wearable-aggregate-receipt.v1",
    },
    attestations: {
      localOnly: true,
      noCoefficientEgress: true,
      noHeaderNameEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      noSourceTextEgress: true,
    },
    candidateRunOrder: FIRST_PASS_CANDIDATE_IDS.map((candidateId) => ({ candidateId })),
    privateFieldRefs: {
      commonLabCore: "triglyceride_value",
      dateOrTimeKey: "synthetic_date",
      labGlycemia: "glucose_value|hba1c_value",
      outcomeEvent: "event_flag",
      personJoinKey: "person_key",
      vitalsBody: "systolic_value|bmi_value",
      wearableActivity: "step_count|active_minutes",
    },
    privateTableRefs: ordinaryTableLayout === "single_primary_table_fallback"
      ? {
        labTableRef: "",
        outcomeTableRef: "",
        primaryTableRef: paths.combinedPath,
        wearableTableRef: "",
      }
      : {
        labTableRef: paths.labPath,
        outcomeTableRef: paths.outcomePath,
        primaryTableRef: paths.outcomePath,
        wearableTableRef: paths.wearablePath,
      },
    schemaVersion: PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION,
    submissionContext: {
      evidenceRole: "synthetic_pipeline_smoke",
      ordinaryConsumerSubmission: true,
      outcomeLinked: true,
      priorityInputFamilies: [
        "bloodwork_labs",
        "vitals_body_context",
        "wearable_activity",
      ],
      targetAgeBand: "roughly_16_50",
    },
  };
}

function smokePassedLayouts(results: readonly SyntheticSmokeResult[]): OrdinaryTableLayout[] {
  return results
    .filter((result) =>
      result.r1122Conclusion === "local_private_runner_config_ready_for_local_aggregate_receipt"
        && (
          result.r1125Conclusion === "local_private_first_pass_runner_ready_for_reviewgpt_delta"
          || result.r1125Conclusion === "local_private_first_pass_runner_valid_no_delta"
        )
        && Boolean(result.aggregateMetricsArtifact)
    )
    .map((result) => result.ordinaryTableLayout);
}

function inputsReadyForSmoke(inputs: Record<InputKey, unknown | null>): boolean {
  return inputMatchesExpected("r1113", inputs.r1113)
    && inputMatchesExpected("r1121", inputs.r1121)
    && inputMatchesExpected("r1127", inputs.r1127)
    && readStringAt(inputs.r1127, ["summary", "conclusion"])
      === "ordinary_consumer_first_pass_submission_handoff_ready"
    && firstPassCandidatesComplete(readStringArrayAt(inputs.r1127, [
      "ordinarySubmissionHandoff",
      "firstPassCandidateIds",
    ]));
}

async function readInputs(options: R1128OrdinaryConsumerPipelineSmokeProofOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1113: await readJsonIfPresent(options.r1113Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1113.artifact)),
    r1121: await readJsonIfPresent(options.r1121Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1121.artifact)),
    r1127: await readJsonIfPresent(options.r1127Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1127.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1128 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.entries(INPUTS) as Array<[InputKey, typeof INPUTS[InputKey]]>).map(([key, expected]) => {
      const input = inputs[key];
      const packetId = readStringAt(input, ["packetId"]);
      const schemaVersion = readStringAt(input, ["schemaVersion"]);
      return [key, {
        artifact: expected.artifact,
        packetId: packetId === expected.packetId ? expected.packetId : null,
        schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
        status: input ? "available" : "missing",
      }];
    }),
  ) as Record<InputKey, ArtifactSummary>;
}

function inputMatchesExpected(key: InputKey, input: unknown | null): boolean {
  const expected = INPUTS[key];
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function firstPassCandidatesComplete(candidateIds: readonly string[]): boolean {
  const present = new Set(candidateIds);
  return FIRST_PASS_CANDIDATE_IDS.every((candidateId) => present.has(candidateId));
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown | null, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
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

function safeBoundary(): R1128OrdinaryConsumerPipelineSmokeProofOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1128: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    privateConfigPathStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1128: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
    syntheticRowsPersisted: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1128OrdinaryConsumerPipelineSmokeProof({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1113Path: process.env.MURPH_AGE_R1113_CONSUMER_SOURCE_EXECUTION_PACKET_PATH,
    r1121Path: process.env.MURPH_AGE_R1121_LOCAL_PRIVATE_RUNNER_CONTRACT_PATH,
    r1127Path: process.env.MURPH_AGE_R1127_ORDINARY_CONSUMER_SUBMISSION_HANDOFF_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    aggregateMetricsArtifactFromSyntheticRun: output.smokeProof.aggregateMetricsArtifactFromSyntheticRun,
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    ordinaryTableLayoutsSmokePassed: output.smokeProof.ordinaryTableLayoutsSmokePassed,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    r1122Conclusion: output.smokeProof.r1122Conclusion,
    r1124ConclusionFromSyntheticRun: output.smokeProof.r1124ConclusionFromSyntheticRun,
    r1125Conclusion: output.smokeProof.r1125Conclusion,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1128: output.summary.rowParsingPerformedByR1128,
    schemaVersion: output.schemaVersion,
    status: output.status,
    syntheticEvidence: output.summary.syntheticEvidence,
    syntheticEvidenceRole: output.smokeProof.syntheticEvidenceRole,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1128 ordinary consumer pipeline smoke proof failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
