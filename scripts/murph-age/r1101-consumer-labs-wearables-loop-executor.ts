import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1101_CONSUMER_LABS_WEARABLES_LOOP_EXECUTOR_SCHEMA_VERSION =
  "murph-age-r1101-consumer-labs-wearables-loop-executor.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1101-consumer-labs-wearables-loop-executor.latest.json";

const INPUTS = {
  r608: {
    artifact: "r608-freeze-glycemia-candidate.latest.json",
    packetId: "r608-freeze-glycemia-candidate",
    schemaVersion: "murph-age-r608-freeze-glycemia-candidate.v1",
  },
  r1089: {
    artifact: "r1089-labs-wearables-candidate-batch-manifest.latest.json",
    packetId: "r1089-labs-wearables-candidate-batch-manifest",
    schemaVersion: "murph-age-r1089-labs-wearables-candidate-batch-manifest.v1",
  },
  r1090: {
    artifact: "r1090-consumer-feature-registry-state.latest.json",
    packetId: "r1090-consumer-feature-registry-state",
    schemaVersion: "murph-age-r1090-consumer-feature-registry-state.v1",
  },
  r1099: {
    artifact: "r1099-consumer-lab-wearable-receipt-action-router.latest.json",
    packetId: "r1099-consumer-lab-wearable-receipt-action-router",
    schemaVersion: "murph-age-r1099-consumer-lab-wearable-receipt-action-router.v1",
  },
  r1123: {
    artifact: "r1123-consumer-wearable-shadow-evidence-arbitration.latest.json",
    packetId: "r1123-consumer-wearable-shadow-evidence-arbitration",
    schemaVersion: "murph-age-r1123-consumer-wearable-shadow-evidence-arbitration.v1",
  },
  r1124: {
    artifact: "r1124-consumer-first-pass-aggregate-metric-intake.latest.json",
    packetId: "r1124-consumer-first-pass-aggregate-metric-intake",
    schemaVersion: "murph-age-r1124-consumer-first-pass-aggregate-metric-intake.v1",
  },
  r1125: {
    artifact: "r1125-local-private-first-pass-aggregate-metric-runner.latest.json",
    packetId: "r1125-local-private-first-pass-aggregate-metric-runner",
    schemaVersion: "murph-age-r1125-local-private-first-pass-aggregate-metric-runner.v1",
  },
  r1126: {
    artifact: "r1126-nhanes-shadow-first-pass-metric-adapter.latest.json",
    packetId: "r1126-nhanes-shadow-first-pass-metric-adapter",
    schemaVersion: "murph-age-r1126-nhanes-shadow-first-pass-metric-adapter.v1",
  },
  r1127: {
    artifact: "r1127-ordinary-consumer-first-pass-submission-handoff.latest.json",
    packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
    schemaVersion: "murph-age-r1127-ordinary-consumer-first-pass-submission-handoff.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type ExecutorConclusion =
  | "consumer_loop_ready_awaiting_aggregate_receipt"
  | "consumer_loop_ready_for_reviewgpt_delta"
  | "consumer_loop_hold_no_delta_continue_source_search"
  | "consumer_loop_repair_inputs";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface LoopAction {
  actionId: string;
  owner: "codex_local" | "data_holder_or_workbench" | "reviewgpt";
  status: "active_next" | "blocked" | "background" | "ready_when_receipt_lands";
  why: string;
}

export interface R1101ConsumerLabsWearablesLoopExecutorOptions {
  createdAt?: string;
  outputDir?: string;
  r608Path?: string;
  r1089Path?: string;
  r1090Path?: string;
  r1099Path?: string;
  r1123Path?: string;
  r1124Path?: string;
  r1125Path?: string;
  r1126Path?: string;
  r1127Path?: string;
}

export interface R1101ConsumerLabsWearablesLoopExecutorOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1101: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1101: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  loopState: {
    candidateBatchStatus: string | null;
    consumerPriority: "labs_vitals_body_wearables_for_roughly_16_50";
    currentExecutableShadowFamilies: string[];
    frozenLabCandidateFamily: string | null;
    frozenLabCandidateStatus: "available" | "missing";
    firstWearableCandidate: string | null;
    firstPassAggregateMetricConclusion: string | null;
    firstPassAggregateMetricsTemplateArtifact: string | null;
    firstPassCandidateIds: string[];
    firstPassMetricIntakeStatus: "available" | "missing";
    integratedLabWearableStatus: "held_until_components_pass";
    localPrivateFirstPassRunnerConclusion: string | null;
    localPrivateFirstPassRunnerNextAction: string | null;
    localPrivateFirstPassRunnerStatus: "available" | "missing";
    missingFirstPassMetricCandidateIds: string[];
    nhanesShadowFirstPassAggregateMetricsArtifact: string | null;
    nhanesShadowFirstPassConclusion: string | null;
    nhanesShadowFirstPassEvidenceRole:
      | "historical_nhanes_shadow_not_consumer_16_50_validation"
      | "waiting_on_historical_shadow_inputs"
      | null;
    nhanesShadowFirstPassR1124FeedPolicy:
      | "manual_shadow_only_do_not_replace_private_or_workbench_receipt"
      | null;
    nhanesShadowFirstPassStatus: "available" | "missing";
    ordinaryConsumerSubmissionHandoffConclusion: string | null;
    ordinaryConsumerSubmissionHandoffPlanArtifact: string | null;
    ordinaryConsumerSourceFamilyIds: string[];
    ordinaryConsumerTableLayouts: string[];
    ordinaryConsumerSubmissionHandoffStatus: "available" | "missing";
    productDisplayAuthorized: false;
    receiptRouterConclusion: string | null;
    trueWearableFamiliesBlocked: string[];
    wearableShadowArbitrationConclusion: string | null;
    wearableShadowEvidenceStatus: "available" | "missing";
  };
  nextLoop: {
    actions: LoopAction[];
    commands: string[];
    nextAction: string;
    reviewGptRequiredNow: boolean;
    routeTargets: string[];
  };
  packetId: "r1101-consumer-labs-wearables-loop-executor";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1101_CONSUMER_LABS_WEARABLES_LOOP_EXECUTOR_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: ExecutorConclusion;
    nextAction: string;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1101: false;
    firstWearableCandidate: string | null;
    firstPassAggregateMetricsTemplateArtifact: string | null;
    localPrivateFirstPassRunnerConclusion: string | null;
    missingFirstPassMetricCandidateIds: string[];
    nhanesShadowFirstPassAggregateMetricsArtifact: string | null;
    nhanesShadowFirstPassEvidenceRole:
      | "historical_nhanes_shadow_not_consumer_16_50_validation"
      | "waiting_on_historical_shadow_inputs"
      | null;
    ordinaryConsumerSubmissionHandoffPlanArtifact: string | null;
    ordinaryConsumerSourceFamilyIds: string[];
    ordinaryConsumerTableLayouts: string[];
  };
}

export async function runR1101ConsumerLabsWearablesLoopExecutor(
  options: R1101ConsumerLabsWearablesLoopExecutorOptions = {},
): Promise<{ output: R1101ConsumerLabsWearablesLoopExecutorOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const conclusion = conclusionFor({
    receiptRouterConclusion: readStringAt(inputs.r1099, ["summary", "conclusion"]),
    r1124Conclusion: readStringAt(inputs.r1124, ["summary", "conclusion"]),
  });
  const nextAction = nextActionFor(conclusion, inputs);
  const output: R1101ConsumerLabsWearablesLoopExecutorOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    loopState: {
      candidateBatchStatus: readStringAt(inputs.r1089, ["summary", "conclusion"]),
      consumerPriority: "labs_vitals_body_wearables_for_roughly_16_50",
      currentExecutableShadowFamilies: readStringArrayAt(inputs.r1090, ["summary", "currentExecutableShadowFamilies"]),
      frozenLabCandidateFamily: readStringAt(inputs.r608, ["candidateFamily", "familyId"])
        ?? readStringAt(inputs.r608, ["frozenCandidateId"]),
      frozenLabCandidateStatus: inputs.r608 ? "available" : "missing",
      firstWearableCandidate: readStringAt(inputs.r1123, ["summary", "firstWearableCandidate"]),
      firstPassAggregateMetricConclusion: readStringAt(inputs.r1124, ["summary", "conclusion"]),
      firstPassAggregateMetricsTemplateArtifact: readStringAt(inputs.r1124, ["metricIntake", "aggregateMetricsTemplateArtifact"]),
      firstPassCandidateIds: readStringArrayAt(inputs.r1124, ["metricIntake", "firstPassCandidateIds"]),
      firstPassMetricIntakeStatus: inputMatchesExpected("r1124", inputs.r1124) ? "available" : "missing",
      integratedLabWearableStatus: "held_until_components_pass",
      localPrivateFirstPassRunnerConclusion: readStringAt(inputs.r1125, ["summary", "conclusion"]),
      localPrivateFirstPassRunnerNextAction: readStringAt(inputs.r1125, ["summary", "nextAction"]),
      localPrivateFirstPassRunnerStatus: inputMatchesExpected("r1125", inputs.r1125) ? "available" : "missing",
      missingFirstPassMetricCandidateIds: readStringArrayAt(inputs.r1124, ["metricIntake", "missingRequiredCandidateIds"]),
      nhanesShadowFirstPassAggregateMetricsArtifact: readStringAt(inputs.r1126, [
        "shadowAdapter",
        "aggregateMetricsArtifact",
      ]),
      nhanesShadowFirstPassConclusion: readStringAt(inputs.r1126, ["summary", "conclusion"]),
      nhanesShadowFirstPassEvidenceRole: nhanesShadowEvidenceRole(inputs.r1126),
      nhanesShadowFirstPassR1124FeedPolicy: readStringAt(inputs.r1126, [
        "shadowAdapter",
        "r1124FeedPolicy",
      ]) === "manual_shadow_only_do_not_replace_private_or_workbench_receipt"
        ? "manual_shadow_only_do_not_replace_private_or_workbench_receipt"
        : null,
      nhanesShadowFirstPassStatus: inputMatchesExpected("r1126", inputs.r1126) ? "available" : "missing",
      ordinaryConsumerSubmissionHandoffConclusion: readStringAt(inputs.r1127, ["summary", "conclusion"]),
      ordinaryConsumerSubmissionHandoffPlanArtifact: readStringAt(inputs.r1127, [
        "summary",
        "submissionPlanArtifact",
      ]),
      ordinaryConsumerSourceFamilyIds: readStringArrayAt(inputs.r1127, ["summary", "ordinarySourceFamilyIds"]),
      ordinaryConsumerTableLayouts: readStringArrayAt(inputs.r1127, [
        "ordinarySubmissionHandoff",
        "ordinaryTableLayouts",
      ]),
      ordinaryConsumerSubmissionHandoffStatus: inputMatchesExpected("r1127", inputs.r1127) ? "available" : "missing",
      productDisplayAuthorized: false,
      receiptRouterConclusion: readStringAt(inputs.r1099, ["summary", "conclusion"]),
      trueWearableFamiliesBlocked: readStringArrayAt(inputs.r1090, ["summary", "trueWearableFamiliesBlocked"]),
      wearableShadowArbitrationConclusion: readStringAt(inputs.r1123, ["summary", "conclusion"]),
      wearableShadowEvidenceStatus: inputMatchesExpected("r1123", inputs.r1123) ? "available" : "missing",
    },
    nextLoop: {
      actions: actionsFor(conclusion, inputs),
      commands: commandsFor(conclusion, inputs),
      nextAction,
      reviewGptRequiredNow: conclusion === "consumer_loop_ready_for_reviewgpt_delta",
      routeTargets: routeTargets(inputs.r1099),
    },
    packetId: "r1101-consumer-labs-wearables-loop-executor",
    productDisplayAuthorized: false,
    schemaVersion: R1101_CONSUMER_LABS_WEARABLES_LOOP_EXECUTOR_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextAction,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: conclusion === "consumer_loop_ready_for_reviewgpt_delta",
      rowParsingPerformedByR1101: false,
      firstWearableCandidate: readStringAt(inputs.r1123, ["summary", "firstWearableCandidate"]),
      firstPassAggregateMetricsTemplateArtifact: readStringAt(inputs.r1124, ["metricIntake", "aggregateMetricsTemplateArtifact"]),
      localPrivateFirstPassRunnerConclusion: readStringAt(inputs.r1125, ["summary", "conclusion"]),
      missingFirstPassMetricCandidateIds: readStringArrayAt(inputs.r1124, ["metricIntake", "missingRequiredCandidateIds"]),
      nhanesShadowFirstPassAggregateMetricsArtifact: readStringAt(inputs.r1126, [
        "shadowAdapter",
        "aggregateMetricsArtifact",
      ]),
      nhanesShadowFirstPassEvidenceRole: nhanesShadowEvidenceRole(inputs.r1126),
      ordinaryConsumerSubmissionHandoffPlanArtifact: readStringAt(inputs.r1127, [
        "summary",
        "submissionPlanArtifact",
      ]),
      ordinaryConsumerSourceFamilyIds: readStringArrayAt(inputs.r1127, ["summary", "ordinarySourceFamilyIds"]),
      ordinaryConsumerTableLayouts: readStringArrayAt(inputs.r1127, [
        "ordinarySubmissionHandoff",
        "ordinaryTableLayouts",
      ]),
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1101 consumer labs/wearables loop executor failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  receiptRouterConclusion: string | null;
  r1124Conclusion: string | null;
}): ExecutorConclusion {
  if (input.r1124Conclusion === "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt"
    || input.receiptRouterConclusion === "send_consumer_lab_wearable_delta_to_reviewgpt") {
    return "consumer_loop_ready_for_reviewgpt_delta";
  }
  if (input.r1124Conclusion === "consumer_first_pass_aggregate_receipt_valid_but_no_delta"
    || input.receiptRouterConclusion === "hold_consumer_lab_wearable_receipt_no_model_change") {
    return "consumer_loop_hold_no_delta_continue_source_search";
  }
  if (input.receiptRouterConclusion === "await_consumer_lab_wearable_aggregate_receipt") {
    return "consumer_loop_ready_awaiting_aggregate_receipt";
  }
  return "consumer_loop_repair_inputs";
}

function nextActionFor(
  conclusion: ExecutorConclusion,
  inputs: Record<InputKey, unknown | null>,
): string {
  if (conclusion === "consumer_loop_ready_for_reviewgpt_delta") {
    return "send_aggregate_only_consumer_lab_wearable_delta_to_reviewgpt";
  }
  if (conclusion === "consumer_loop_hold_no_delta_continue_source_search") {
    return "record_no_delta_memory_and_continue_consumer_source_search";
  }
  if (conclusion === "consumer_loop_ready_awaiting_aggregate_receipt") {
    if (inputMatchesExpected("r1124", inputs.r1124)) {
      if (readStringAt(inputs.r1125, ["summary", "conclusion"]) === "local_private_first_pass_runner_missing_config") {
        return "provide_r1125_private_runner_config_or_fill_r1124_template";
      }
      if (readStringAt(inputs.r1125, ["summary", "conclusion"]) === "local_private_first_pass_runner_not_enough_usable_data") {
        return "use_better_covered_private_data_or_fill_r1124_template";
      }
      return "fill_r1124_first_pass_aggregate_metrics_template";
    }
    return "collect_or_run_consumer_lab_wearable_aggregate_receipt";
  }
  return "repair_consumer_lab_wearable_chain";
}

function actionsFor(
  conclusion: ExecutorConclusion,
  inputs: Record<InputKey, unknown | null>,
): LoopAction[] {
  const frozenLabFamily = readStringAt(inputs.r608, ["candidateFamily", "familyId"]) ?? "tiny_glycemia_only";
  if (conclusion === "consumer_loop_ready_for_reviewgpt_delta") {
    return [
      {
        actionId: "review_aggregate_delta",
        owner: "reviewgpt",
        status: "active_next",
        why: "A real outcome-linked aggregate receipt landed with a model delta; this is the right point for high-value scientific interpretation.",
      },
    ];
  }
  if (conclusion === "consumer_loop_hold_no_delta_continue_source_search") {
    return [
      {
        actionId: "append_no_delta_memory",
        owner: "codex_local",
        status: "active_next",
        why: "A safe aggregate receipt produced no model-improving delta, so it should inform future candidate pruning.",
      },
      {
        actionId: "continue_source_search",
        owner: "codex_local",
        status: "background",
        why: "Consumer lab and wearable validation still needs stronger outcome-linked aggregate evidence.",
      },
    ];
  }
  if (conclusion === "consumer_loop_ready_awaiting_aggregate_receipt") {
    return [
      {
        actionId: firstPassMetricActionId(inputs),
        owner: "data_holder_or_workbench",
        status: "active_next",
        why: inputMatchesExpected("r1124", inputs.r1124)
          ? "The next score-relevant evidence is the R1124 fillable L1/L2/W1/QC aggregate-metrics template, which can be filled by a row-owning runner or workbench."
          : "The first-pass aggregate metric intake is missing or stale, so refresh R1124 before handing work to a row-owning runner.",
      },
      {
        actionId: firstPassPrivateRunnerActionId(inputs),
        owner: "data_holder_or_workbench",
        status: inputMatchesExpected("r1125", inputs.r1125) ? "active_next" : "background",
        why: inputMatchesExpected("r1125", inputs.r1125)
          ? "The local private first-pass runner is the executable bridge from a completed private config to R1124 aggregate metrics."
          : "The R1125 local private runner status is missing, so manual R1124 aggregate metric fill remains the fallback.",
      },
      {
        actionId: ordinarySubmissionHandoffActionId(inputs),
        owner: "data_holder_or_workbench",
        status: inputMatchesExpected("r1127", inputs.r1127) ? "active_next" : "background",
        why: inputMatchesExpected("r1127", inputs.r1127)
          ? "The ordinary consumer submission handoff is ready, so a row-owning person or workbench can fill semantic refs and run R1125 without exposing private values."
          : "The ordinary consumer submission handoff is missing or stale; regenerate R1127 before handing the private config task to a row owner.",
      },
      {
        actionId: `carry_${frozenLabFamily}_as_smallest_lab_candidate`,
        owner: "codex_local",
        status: "ready_when_receipt_lands",
        why: "The tiny glycemia family is the cleanest lab candidate to compare before broader lab panels.",
      },
      {
        actionId: "keep_common_lab_core_shadow",
        owner: "codex_local",
        status: "background",
        why: "Common labs plus vitals/body remain useful shadow candidates but need external or workbench aggregate support.",
      },
      {
        actionId: nhanesShadowActionId(inputs),
        owner: "codex_local",
        status: "background",
        why: inputMatchesExpected("r1126", inputs.r1126)
          ? "Historical NHANES lab/activity shadow metrics are available as non-primary context, but the private/workbench R1125/R1124 path remains authoritative for consumer validation."
          : "The NHANES lab/activity shadow adapter is missing or stale; refresh it as context only while keeping real consumer aggregate metrics as the active handoff.",
      },
      {
        actionId: firstWearableActionId(inputs),
        owner: "codex_local",
        status: inputMatchesExpected("r1123", inputs.r1123) ? "background" : "blocked",
        why: inputMatchesExpected("r1123", inputs.r1123)
          ? "The wearable shadow arbitration keeps activity/steps/minutes as the first wearable candidate, but it still needs an outcome-linked receipt before scoring."
          : "The wearable shadow arbitration artifact is missing or stale, so first-wearable routing should refresh before the next consumer receipt handoff.",
      },
      {
        actionId: "keep_wearables_blocked_until_outcome_linked_receipt",
        owner: "codex_local",
        status: "blocked",
        why: "Wearable features are high-priority for the product, but need coverage controls and outcome-linked aggregate validation.",
      },
    ];
  }
  return [
    {
      actionId: "repair_consumer_artifacts",
      owner: "codex_local",
      status: "active_next",
      why: "The consumer candidate batch, registry, or receipt router is missing or stale.",
    },
  ];
}

function commandsFor(
  conclusion: ExecutorConclusion,
  inputs: Record<InputKey, unknown | null>,
): string[] {
  if (conclusion === "consumer_loop_ready_for_reviewgpt_delta") {
    return [
      "send aggregate-only consumer lab/wearable delta to ReviewGPT for science interpretation",
      "pnpm exec tsx scripts/murph-age/r1101-consumer-labs-wearables-loop-executor.ts",
    ];
  }
  if (conclusion === "consumer_loop_hold_no_delta_continue_source_search") {
    return [
      "record aggregate no-delta memory in the next proposal batch",
      "continue source search for All of Us, CARDIA, workbench aggregate, NHANES bridge, and UKB-supporting receipts",
    ];
  }
  if (conclusion === "consumer_loop_ready_awaiting_aggregate_receipt") {
    if (inputMatchesExpected("r1124", inputs.r1124)) {
      return [
        "pnpm exec tsx scripts/murph-age/r1127-ordinary-consumer-first-pass-submission-handoff.ts",
        "fill r1127-fillable ordinary consumer first-pass submission plan with private semantic refs only",
        "with a completed private config: MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts",
        "fill r1124-fillable consumer first-pass aggregate metrics template with aggregate L1/L2/W1/QC metrics only",
        "MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH=<aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1124-consumer-first-pass-aggregate-metric-intake.ts",
        "pnpm exec tsx scripts/murph-age/r1101-consumer-labs-wearables-loop-executor.ts",
      ];
    }
    return [
      "use r1105-fillable consumer labs/wearables aggregate receipt template with All of Us, CARDIA, or equivalent outcome-linked workbench data",
      "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts",
      "pnpm exec tsx scripts/murph-age/r1099-consumer-lab-wearable-receipt-action-router.ts",
      "pnpm exec tsx scripts/murph-age/r1101-consumer-labs-wearables-loop-executor.ts",
    ];
  }
  return [
    "pnpm exec tsx scripts/murph-age/r1089-labs-wearables-candidate-batch-manifest.ts",
    "pnpm exec tsx scripts/murph-age/r1090-consumer-feature-registry-state.ts",
    "pnpm exec tsx scripts/murph-age/r1099-consumer-lab-wearable-receipt-action-router.ts",
  ];
}

async function readInputs(options: R1101ConsumerLabsWearablesLoopExecutorOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r608: await readJsonIfPresent(options.r608Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r608.artifact)),
    r1089: await readJsonIfPresent(options.r1089Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1089.artifact)),
    r1090: await readJsonIfPresent(options.r1090Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1090.artifact)),
    r1099: await readJsonIfPresent(options.r1099Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1099.artifact)),
    r1123: await readJsonIfPresent(options.r1123Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1123.artifact)),
    r1124: await readJsonIfPresent(options.r1124Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1124.artifact)),
    r1125: await readJsonIfPresent(options.r1125Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1125.artifact)),
    r1126: await readJsonIfPresent(options.r1126Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1126.artifact)),
    r1127: await readJsonIfPresent(options.r1127Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1127.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1101 rejected unsafe ${key} input: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.entries(INPUTS) as Array<[InputKey, typeof INPUTS[InputKey]]>).map(([key, expected]) => {
      const input = inputs[key];
      return [key, {
        artifact: expected.artifact,
        packetId: readStringAt(input, ["packetId"]),
        schemaVersion: readStringAt(input, ["schemaVersion"]),
        status: input ? "available" : "missing",
      }];
    }),
  ) as Record<InputKey, ArtifactSummary>;
}

function routeTargets(value: unknown | null): string[] {
  const targets = readStringArrayAt(value, ["nextLoop", "routeTargets"]);
  return orderConsumerRouteTargets(targets.length > 0
    ? targets
    : [
      "all-of-us-fitbit-labs-ehr",
      "cardia-authorized-or-aggregate",
      "partner-aggregate-evaluator",
      "nhanes-activity-shadow-lmf",
      "midus-biomarker-mortality",
      "uk-biobank-integrated",
    ]);
}

function orderConsumerRouteTargets(targets: readonly string[]): string[] {
  const targetSet = new Set(targets);
  const priority = [
    "all-of-us-fitbit-labs-ehr",
    "cardia-authorized-or-aggregate",
    "partner-aggregate-evaluator",
    "nhanes-activity-shadow-lmf",
    "midus-biomarker-mortality",
    "uk-biobank-integrated",
  ];
  const ordered = priority.filter((target) =>
    target === "cardia-authorized-or-aggregate" || targetSet.has(target)
  );
  for (const target of targets) {
    if (!ordered.includes(target)) ordered.push(target);
  }
  return ordered;
}

function firstWearableActionId(inputs: Record<InputKey, unknown | null>): string {
  const candidate = readStringAt(inputs.r1123, ["summary", "firstWearableCandidate"]);
  if (candidate === "W1_activity_steps_minutes") {
    return "keep_w1_activity_steps_minutes_as_first_wearable_candidate";
  }
  return "refresh_wearable_shadow_arbitration";
}

function firstPassMetricActionId(inputs: Record<InputKey, unknown | null>): string {
  if (inputMatchesExpected("r1124", inputs.r1124)) {
    return "fill_r1124_first_pass_aggregate_metrics_template";
  }
  return "run_r1124_first_pass_aggregate_metric_intake";
}

function firstPassPrivateRunnerActionId(inputs: Record<InputKey, unknown | null>): string {
  const conclusion = readStringAt(inputs.r1125, ["summary", "conclusion"]);
  if (conclusion === "local_private_first_pass_runner_missing_config") {
    return "provide_r1125_private_runner_config";
  }
  if (conclusion === "local_private_first_pass_runner_not_enough_usable_data") {
    return "improve_private_runner_coverage";
  }
  if (conclusion === "local_private_first_pass_runner_valid_no_delta") {
    return "use_r1125_metrics_no_delta_memory";
  }
  if (conclusion === "local_private_first_pass_runner_ready_for_reviewgpt_delta") {
    return "use_r1125_metrics_reviewgpt_delta";
  }
  return "run_r1125_local_private_first_pass_runner";
}

function ordinarySubmissionHandoffActionId(inputs: Record<InputKey, unknown | null>): string {
  if (
    inputMatchesExpected("r1127", inputs.r1127)
    && readStringAt(inputs.r1127, ["summary", "conclusion"]) === "ordinary_consumer_first_pass_submission_handoff_ready"
  ) {
    return "use_r1127_ordinary_consumer_submission_plan_for_r1125";
  }
  return "run_r1127_ordinary_consumer_submission_handoff";
}

function nhanesShadowActionId(inputs: Record<InputKey, unknown | null>): string {
  if (
    inputMatchesExpected("r1126", inputs.r1126)
    && readStringAt(inputs.r1126, ["summary", "conclusion"])
      === "nhanes_shadow_first_pass_metrics_ready_not_primary_consumer_validation"
  ) {
    return "carry_r1126_nhanes_shadow_first_pass_as_non_primary_context";
  }
  return "refresh_r1126_nhanes_shadow_first_pass_adapter";
}

function nhanesShadowEvidenceRole(
  input: unknown | null,
): R1101ConsumerLabsWearablesLoopExecutorOutput["loopState"]["nhanesShadowFirstPassEvidenceRole"] {
  const evidenceRole = readStringAt(input, ["shadowAdapter", "evidenceRole"]);
  if (
    evidenceRole === "historical_nhanes_shadow_not_consumer_16_50_validation"
    || evidenceRole === "waiting_on_historical_shadow_inputs"
  ) {
    return evidenceRole;
  }
  return null;
}

function inputMatchesExpected(key: InputKey, input: unknown | null): boolean {
  const expected = INPUTS[key];
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
}

function safeBoundary(): R1101ConsumerLabsWearablesLoopExecutorOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1101: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1101: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function readRecordAt(value: unknown, pathParts: string[]): Record<string, unknown> | null {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : null;
}

function readStringAt(value: unknown, pathParts: string[]): string | null {
  if (pathParts.length === 0) return typeof value === "string" ? value : null;
  const parent = readRecordAt(value, pathParts.slice(0, -1));
  const leaf = parent?.[pathParts[pathParts.length - 1] ?? ""];
  return typeof leaf === "string" ? leaf : null;
}

function readStringArrayAt(value: unknown, pathParts: string[]): string[] {
  const parent = readRecordAt(value, pathParts.slice(0, -1));
  const leaf = parent?.[pathParts[pathParts.length - 1] ?? ""];
  return Array.isArray(leaf) ? leaf.filter((item): item is string => typeof item === "string") : [];
}

async function main(): Promise<void> {
  const { output } = await runR1101ConsumerLabsWearablesLoopExecutor({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r608Path: process.env.MURPH_AGE_R608_FREEZE_GLYCEMIA_PATH,
    r1089Path: process.env.MURPH_AGE_R1089_CONSUMER_CANDIDATE_BATCH_PATH,
    r1090Path: process.env.MURPH_AGE_R1090_FEATURE_REGISTRY_PATH,
    r1099Path: process.env.MURPH_AGE_R1099_RECEIPT_ROUTER_PATH,
    r1123Path: process.env.MURPH_AGE_R1123_WEARABLE_SHADOW_ARBITRATION_PATH,
    r1124Path: process.env.MURPH_AGE_R1124_FIRST_PASS_METRIC_INTAKE_PATH,
    r1125Path: process.env.MURPH_AGE_R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_PATH,
    r1126Path: process.env.MURPH_AGE_R1126_NHANES_SHADOW_FIRST_PASS_ADAPTER_PATH,
    r1127Path: process.env.MURPH_AGE_R1127_ORDINARY_CONSUMER_SUBMISSION_HANDOFF_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    firstPassAggregateMetricsTemplateArtifact: output.summary.firstPassAggregateMetricsTemplateArtifact,
    firstWearableCandidate: output.summary.firstWearableCandidate,
    localPrivateFirstPassRunnerConclusion: output.summary.localPrivateFirstPassRunnerConclusion,
    missingFirstPassMetricCandidateIds: output.summary.missingFirstPassMetricCandidateIds,
    nextAction: output.summary.nextAction,
    nhanesShadowFirstPassAggregateMetricsArtifact: output.summary.nhanesShadowFirstPassAggregateMetricsArtifact,
    nhanesShadowFirstPassEvidenceRole: output.summary.nhanesShadowFirstPassEvidenceRole,
    ordinaryConsumerSubmissionHandoffPlanArtifact: output.summary.ordinaryConsumerSubmissionHandoffPlanArtifact,
    ordinaryConsumerSourceFamilyIds: output.summary.ordinaryConsumerSourceFamilyIds,
    ordinaryConsumerTableLayouts: output.summary.ordinaryConsumerTableLayouts,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1101: output.summary.rowParsingPerformedByR1101,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1101 consumer labs/wearables loop executor failed."}\n`);
    process.exitCode = 1;
  });
}
