import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1032_LABS_WEARABLES_PIVOT_SCAFFOLD_SCHEMA_VERSION,
  runR1032LabsWearablesPivotScaffold,
  type R1032LabsWearablesPivotScaffoldOutput,
} from "./r1032-labs-wearables-pivot-scaffold.ts";

export const R1033_NHANES_LAB_ACTIVITY_RUNNER_SCAFFOLD_SCHEMA_VERSION =
  "murph-age-r1033-nhanes-lab-activity-runner-scaffold.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1033-nhanes-lab-activity-runner-scaffold.latest.json";

const REQUIRED_INPUTS = [
  "MURPH_AGE_NHANES_DEMOGRAPHICS_FILE",
  "MURPH_AGE_NHANES_BODY_BP_FILE",
  "MURPH_AGE_NHANES_LABS_FILE",
  "MURPH_AGE_NHANES_ACTIVITY_FILE",
  "MURPH_AGE_NHANES_MORTALITY_FILE",
] as const;

type RequiredInputEnv = typeof REQUIRED_INPUTS[number];

interface SourceInputStatus {
  envVar: RequiredInputEnv;
  status: "available" | "missing_env" | "missing_local_file";
}

interface CandidateFamily {
  candidateId: string;
  role: "score_bearing_research_candidate" | "negative_control" | "reference_only";
}

export interface R1033NhanesLabActivityRunnerScaffoldOptions {
  createdAt?: string;
  env?: NodeJS.ProcessEnv;
  outputDir?: string;
  r1032Output?: R1032LabsWearablesPivotScaffoldOutput;
}

export interface R1033NhanesLabActivityRunnerScaffoldOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformed: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1033: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
  };
  benchmarkCard: {
    benchmarkCardId: "nhanes_lab_activity_mortality_v1";
    candidateFamilies: CandidateFamily[];
    endpoint: "all_cause_mortality";
    evidenceLabel: "public_bridge_same_family_not_consumer_wearable_validation";
    firstExecutableSourceRoute: "nhanes_labs_body_bp_objective_activity_linked_mortality";
    lockedFromSchemaVersion: typeof R1032_LABS_WEARABLES_PIVOT_SCAFFOLD_SCHEMA_VERSION;
    productDisplayAuthorized: false;
  };
  createdAt: string;
  executionReadiness: {
    blockedBy: string[];
    conclusion:
      | "blocked_missing_local_source_inputs_no_row_parsing"
      | "ready_for_local_private_row_materialization_no_scoring_yet";
    requiredInputStatuses: SourceInputStatus[];
  };
  nextLocalAction:
    | "provide_required_nhanes_env_files_then_rerun_readiness"
    | "implement_private_row_materializer_and_aggregate_evaluator";
  packetId: "r1033-nhanes-lab-activity-runner-scaffold";
  rowMaterializationContract: {
    allowedCacheRoot: ".runtime/cache/research/murph-age/nhanes-lab-activity";
    externalOutputs: string[];
    localOnlyOutputs: string[];
  };
  schemaVersion: typeof R1033_NHANES_LAB_ACTIVITY_RUNNER_SCAFFOLD_SCHEMA_VERSION;
  status: "research-local-scaffold-no-row-parsing";
  summary: {
    candidateFamilyCount: number;
    conclusion:
      | "blocked_missing_local_source_inputs_no_row_parsing"
      | "ready_for_local_private_row_materialization_no_scoring_yet";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1033: false;
  };
}

export async function runR1033NhanesLabActivityRunnerScaffold(
  options: R1033NhanesLabActivityRunnerScaffoldOptions = {},
): Promise<{ output: R1033NhanesLabActivityRunnerScaffoldOutput; outputPath: string }> {
  const r1032 = options.r1032Output ?? (await runR1032LabsWearablesPivotScaffold({
    createdAt: options.createdAt,
    outputDir: options.outputDir,
  })).output;
  const card = r1032.benchmarkCards.find((candidateCard) =>
    candidateCard.benchmarkCardId === "nhanes_lab_activity_mortality_v1"
  );
  if (!card) {
    throw new Error("R1033 requires the R1032 NHANES lab/activity benchmark card.");
  }

  const env = options.env ?? process.env;
  const requiredInputStatuses = await Promise.all(REQUIRED_INPUTS.map((envVar) => sourceInputStatus(env, envVar)));
  const blockedBy = requiredInputStatuses
    .filter((status) => status.status !== "available")
    .map((status) => status.envVar);
  const conclusion = blockedBy.length > 0
    ? "blocked_missing_local_source_inputs_no_row_parsing"
    : "ready_for_local_private_row_materialization_no_scoring_yet";

  const output: R1033NhanesLabActivityRunnerScaffoldOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformed: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1033: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
    },
    benchmarkCard: {
      benchmarkCardId: "nhanes_lab_activity_mortality_v1",
      candidateFamilies: card.candidateFamilies.map((candidate) => ({
        candidateId: candidate.candidateId,
        role: candidate.role,
      })),
      endpoint: "all_cause_mortality",
      evidenceLabel: "public_bridge_same_family_not_consumer_wearable_validation",
      firstExecutableSourceRoute: "nhanes_labs_body_bp_objective_activity_linked_mortality",
      lockedFromSchemaVersion: R1032_LABS_WEARABLES_PIVOT_SCAFFOLD_SCHEMA_VERSION,
      productDisplayAuthorized: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    executionReadiness: {
      blockedBy,
      conclusion,
      requiredInputStatuses,
    },
    nextLocalAction: conclusion === "blocked_missing_local_source_inputs_no_row_parsing"
      ? "provide_required_nhanes_env_files_then_rerun_readiness"
      : "implement_private_row_materializer_and_aggregate_evaluator",
    packetId: "r1033-nhanes-lab-activity-runner-scaffold",
    rowMaterializationContract: {
      allowedCacheRoot: ".runtime/cache/research/murph-age/nhanes-lab-activity",
      externalOutputs: [
        "aggregate_count_bands",
        "aggregate_metric_tables",
        "calibration_summaries",
        "missingness_and_coverage_summaries",
        "negative_control_verdicts",
      ],
      localOnlyOutputs: [
        "derived_rows",
        "split_assignments",
        "row_level_diagnostics",
        "fitted_model_artifacts",
      ],
    },
    schemaVersion: R1033_NHANES_LAB_ACTIVITY_RUNNER_SCAFFOLD_SCHEMA_VERSION,
    status: "research-local-scaffold-no-row-parsing",
    summary: {
      candidateFamilyCount: card.candidateFamilies.length,
      conclusion,
      productDisplayAuthorized: false,
      rowParsingPerformedByR1033: false,
    },
  };

  assertR1033Safe(output);
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

export function assertR1033Safe(output: R1033NhanesLabActivityRunnerScaffoldOutput): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1033SpecificFindings(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1033 NHANES lab/activity runner scaffold failed safety validation: ${findings.join("; ")}`);
  }
}

async function sourceInputStatus(env: NodeJS.ProcessEnv, envVar: RequiredInputEnv): Promise<SourceInputStatus> {
  const value = env[envVar];
  if (!value) return { envVar, status: "missing_env" };
  try {
    await access(value);
    return { envVar, status: "available" };
  } catch {
    return { envVar, status: "missing_local_file" };
  }
}

function findR1033SpecificFindings(output: R1033NhanesLabActivityRunnerScaffoldOutput): string[] {
  const findings: string[] = [];
  if (output.summary.productDisplayAuthorized !== false) {
    findings.push("summary.productDisplayAuthorized must remain false");
  }
  if (output.summary.rowParsingPerformedByR1033 !== false) {
    findings.push("R1033 must not parse rows");
  }
  if (output.artifactBoundary.outcomeScoringPerformed !== false) {
    findings.push("R1033 must not score outcomes");
  }
  if (!output.rowMaterializationContract.allowedCacheRoot.startsWith(".runtime/cache/")) {
    findings.push("row materialization must stay under ignored cache");
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1033NhanesLabActivityRunnerScaffold({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      blockedByCount: output.executionReadiness.blockedBy.length,
      candidateFamilyCount: output.summary.candidateFamilyCount,
      conclusion: output.summary.conclusion,
      nextLocalAction: output.nextLocalAction,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      rowParsingPerformedByR1033: output.summary.rowParsingPerformedByR1033,
      schemaVersion: output.schemaVersion,
      status: output.status,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
