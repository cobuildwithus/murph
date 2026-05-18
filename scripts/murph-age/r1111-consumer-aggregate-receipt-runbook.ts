import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1111_CONSUMER_AGGREGATE_RECEIPT_RUNBOOK_SCHEMA_VERSION =
  "murph-age-r1111-consumer-aggregate-receipt-runbook.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1111-consumer-aggregate-receipt-runbook.latest.json";

const INPUTS = {
  r1099: {
    artifact: "r1099-consumer-lab-wearable-receipt-action-router.latest.json",
    packetId: "r1099-consumer-lab-wearable-receipt-action-router",
    schemaVersion: "murph-age-r1099-consumer-lab-wearable-receipt-action-router.v1",
  },
  r1101: {
    artifact: "r1101-consumer-labs-wearables-loop-executor.latest.json",
    packetId: "r1101-consumer-labs-wearables-loop-executor",
    schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
  },
  r1105: {
    artifact: "r1105-consumer-aggregate-receipt-template.latest.json",
    packetId: "r1105-consumer-aggregate-receipt-template",
    schemaVersion: "murph-age-r1105-consumer-aggregate-receipt-template.v1",
  },
  r1109: {
    artifact: "r1109-all-of-us-aggregate-handoff.latest.json",
    packetId: "r1109-all-of-us-aggregate-handoff",
    schemaVersion: "murph-age-r1109-all-of-us-aggregate-handoff.v1",
  },
  r1110: {
    artifact: "r1110-consumer-input-spine.latest.json",
    packetId: "r1110-consumer-input-spine",
    schemaVersion: "murph-age-r1110-consumer-input-spine.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type SourceRoute =
  | "all_of_us_workbench_aggregate"
  | "cardia_authorized_or_aggregate"
  | "partner_aggregate_evaluator"
  | "nhanes_activity_shadow"
  | "midus_biomarker_mortality_shadow"
  | "ukb_integrated_support";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SourceRunRoute {
  rank: number;
  route: SourceRoute;
  role: "primary_workbench" | "secondary_authorized_source" | "fallback_aggregate" | "shadow_or_support";
  runCondition: string;
}

interface RunbookStep {
  stepId:
    | "choose_endpoint"
    | "freeze_denominator"
    | "run_candidates"
    | "run_controls"
    | "fill_receipt"
    | "validate_receipt";
  instruction: string;
}

export interface R1111ConsumerAggregateReceiptRunbookOptions {
  createdAt?: string;
  outputDir?: string;
  r1099Path?: string;
  r1101Path?: string;
  r1105Path?: string;
  r1109Path?: string;
  r1110Path?: string;
}

export interface R1111ConsumerAggregateReceiptRunbookOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1111: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1111: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  handoff: {
    allowedExternalOutput: [
      "filled_r1105_receipt_json",
      "aggregate_metric_deltas_only",
      "candidate_gate_statuses_only",
      "coarse_event_and_coverage_bands_only",
    ];
    blockedExternalOutput: [
      "rows",
      "participant_ids",
      "split_membership",
      "predictions",
      "coefficients_or_model_parameters",
      "source_tables_or_codebook_text",
      "small_cells",
      "product_claims_or_recommendations",
    ];
    consumerTarget: {
      excludedFirstPassSignals: [
        "exotic_research_assays",
        "hospital_only_stress_markers",
        "older_adult_only_function_tests",
        "chronological_age_mimicry",
      ];
      firstPassInputPolicy: "average_consumer_submittable_labs_vitals_wearables_first";
      primaryAgeBand: "roughly_16_50";
      scoreCandidateFamilies: [
        "bloodwork_common_labs",
        "vitals_body_composition",
        "wearable_activity",
        "wearable_sleep",
        "wearable_recovery",
      ];
    };
    endpointOrder: string[];
    featureFamilyOrder: string[];
    receiptTemplateArtifact: "r1105-fillable-consumer-aggregate-receipt-template.json" | null;
    routePriority: SourceRunRoute[];
    runbookSteps: RunbookStep[];
    validationCommand: "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts";
  };
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1111-consumer-aggregate-receipt-runbook";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1111_CONSUMER_AGGREGATE_RECEIPT_RUNBOOK_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "consumer_aggregate_receipt_runbook_ready"
      | "consumer_aggregate_receipt_runbook_waiting_on_upstream";
    nextAction:
      | "run_all_of_us_or_cardia_aggregate_receipt_then_validate_r1104"
      | "regenerate_consumer_receipt_prerequisites";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1111: false;
  };
}

export async function runR1111ConsumerAggregateReceiptRunbook(
  options: R1111ConsumerAggregateReceiptRunbookOptions = {},
): Promise<{ output: R1111ConsumerAggregateReceiptRunbookOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const inputIdentityReady = (Object.keys(INPUTS) as InputKey[]).every((key) => inputMatchesExpected(key, inputs[key]));
  const templateReady = readBooleanAt(inputs.r1105, ["summary", "templateReadyForDataFill"]) === true;
  const ready = inputIdentityReady
    && readStringAt(inputs.r1099, ["summary", "conclusion"]) === "await_consumer_lab_wearable_aggregate_receipt"
    && readStringAt(inputs.r1101, ["summary", "conclusion"]) === "consumer_loop_ready_awaiting_aggregate_receipt"
    && templateReady
    && readStringAt(inputs.r1109, ["summary", "conclusion"]) === "all_of_us_aggregate_handoff_ready"
    && readStringAt(inputs.r1110, ["summary", "conclusion"]) === "consumer_lab_wearable_spine_ready"
    && routeTargetsReady(inputs.r1099);

  const output: R1111ConsumerAggregateReceiptRunbookOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    handoff: {
      allowedExternalOutput: [
        "filled_r1105_receipt_json",
        "aggregate_metric_deltas_only",
        "candidate_gate_statuses_only",
        "coarse_event_and_coverage_bands_only",
      ],
      blockedExternalOutput: [
        "rows",
        "participant_ids",
        "split_membership",
        "predictions",
        "coefficients_or_model_parameters",
        "source_tables_or_codebook_text",
        "small_cells",
        "product_claims_or_recommendations",
      ],
      consumerTarget: {
        excludedFirstPassSignals: [
          "exotic_research_assays",
          "hospital_only_stress_markers",
          "older_adult_only_function_tests",
          "chronological_age_mimicry",
        ],
        firstPassInputPolicy: "average_consumer_submittable_labs_vitals_wearables_first",
        primaryAgeBand: "roughly_16_50",
        scoreCandidateFamilies: [
          "bloodwork_common_labs",
          "vitals_body_composition",
          "wearable_activity",
          "wearable_sleep",
          "wearable_recovery",
        ],
      },
      endpointOrder: [
        "incident_cardiometabolic_disease",
        "risk_factor_progression",
        "hospitalization_or_acute_event_sensitivity",
        "all_cause_mortality_secondary_when_powered",
      ],
      featureFamilyOrder: [
        "bloodwork_common_labs",
        "vitals_body_composition",
        "wearable_activity",
        "wearable_sleep",
        "wearable_recovery",
        "missingness_and_coverage_controls",
      ],
      receiptTemplateArtifact: readStringAt(inputs.r1105, ["receiptTemplateArtifact"]) === "r1105-fillable-consumer-aggregate-receipt-template.json"
        ? "r1105-fillable-consumer-aggregate-receipt-template.json"
        : null,
      routePriority: routePriority(),
      runbookSteps: runbookSteps(),
      validationCommand:
        "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts",
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1111-consumer-aggregate-receipt-runbook",
    productDisplayAuthorized: false,
    schemaVersion: R1111_CONSUMER_AGGREGATE_RECEIPT_RUNBOOK_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "consumer_aggregate_receipt_runbook_ready"
        : "consumer_aggregate_receipt_runbook_waiting_on_upstream",
      nextAction: ready
        ? "run_all_of_us_or_cardia_aggregate_receipt_then_validate_r1104"
        : "regenerate_consumer_receipt_prerequisites",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1111: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1111 consumer aggregate receipt runbook failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function routePriority(): SourceRunRoute[] {
  return [
    {
      rank: 1,
      role: "primary_workbench",
      route: "all_of_us_workbench_aggregate",
      runCondition: "authorized workbench access with EHR, physical measures, labs, and wearable aggregate coverage",
    },
    {
      rank: 2,
      role: "secondary_authorized_source",
      route: "cardia_authorized_or_aggregate",
      runCondition: "authorized source access or aggregate-only collaborator receipt for young-adult cardiometabolic outcomes",
    },
    {
      rank: 3,
      role: "fallback_aggregate",
      route: "partner_aggregate_evaluator",
      runCondition: "lawful data holder can run the frozen evaluator and return only aggregate receipt fields",
    },
    {
      rank: 4,
      role: "shadow_or_support",
      route: "nhanes_activity_shadow",
      runCondition: "use only as same-family activity/lab shadow evidence, not consumer wearable validation",
    },
    {
      rank: 5,
      role: "shadow_or_support",
      route: "midus_biomarker_mortality_shadow",
      runCondition: "use as biomarker transport memory, not first consumer validation",
    },
    {
      rank: 6,
      role: "shadow_or_support",
      route: "ukb_integrated_support",
      runCondition: "use as older-range support if access lands, not full 16-39 consumer validation",
    },
  ];
}

function runbookSteps(): RunbookStep[] {
  return [
    {
      instruction: "Choose the earliest powered endpoint family first; for ages 16-50, hard mortality is secondary unless event counts are adequate.",
      stepId: "choose_endpoint",
    },
    {
      instruction: "Freeze denominator, endpoint, comparison set, missingness policy, and suppression policy before calculating candidate metrics.",
      stepId: "freeze_denominator",
    },
    {
      instruction: "Run candidate families in R1110 strict order: tiny glycemia, common lab core, coverage control, then wearable activity, sleep, recovery, and integrated panel only when coverage exists.",
      stepId: "run_candidates",
    },
    {
      instruction: "Require same-denominator missingness, coverage, and shuffled or coverage-only controls before any wearable candidate is treated as score-bearing evidence.",
      stepId: "run_controls",
    },
    {
      instruction: "Fill only the R1105 aggregate receipt fields: metric deltas, calibration status, evidence support, coverage status, and missingness or coverage control status.",
      stepId: "fill_receipt",
    },
    {
      instruction: "Run R1104 locally on the filled receipt; send to ReviewGPT only if R1104 returns a valid scientific delta.",
      stepId: "validate_receipt",
    },
  ];
}

async function readInputs(options: R1111ConsumerAggregateReceiptRunbookOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1099: await readJsonIfPresent(options.r1099Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1099.artifact)),
    r1101: await readJsonIfPresent(options.r1101Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1101.artifact)),
    r1105: await readJsonIfPresent(options.r1105Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1105.artifact)),
    r1109: await readJsonIfPresent(options.r1109Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1109.artifact)),
    r1110: await readJsonIfPresent(options.r1110Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1110.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1111 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
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

function routeTargetsReady(value: unknown | null): boolean {
  const targets = readStringArrayAt(value, ["nextLoop", "routeTargets"]);
  return targets[0] === "all-of-us-fitbit-labs-ehr"
    && targets[1] === "cardia-authorized-or-aggregate";
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
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

function safeBoundary(): R1111ConsumerAggregateReceiptRunbookOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1111: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1111: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1111ConsumerAggregateReceiptRunbook({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1099Path: process.env.MURPH_AGE_R1099_RECEIPT_ROUTER_PATH,
    r1101Path: process.env.MURPH_AGE_R1101_CONSUMER_LOOP_EXECUTOR_PATH,
    r1105Path: process.env.MURPH_AGE_R1105_CONSUMER_RECEIPT_TEMPLATE_PATH,
    r1109Path: process.env.MURPH_AGE_R1109_ALL_OF_US_HANDOFF_PATH,
    r1110Path: process.env.MURPH_AGE_R1110_CONSUMER_INPUT_SPINE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    routePriority: output.handoff.routePriority.map((route) => route.route),
    rowParsingPerformedByR1111: output.summary.rowParsingPerformedByR1111,
    schemaVersion: output.schemaVersion,
    status: output.status,
    validationCommand: output.handoff.validationCommand,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1111 consumer aggregate receipt runbook failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
