import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1108_CONSUMER_SOURCE_ENDPOINT_ROUTER_SCHEMA_VERSION =
  "murph-age-r1108-consumer-source-endpoint-router.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1108-consumer-source-endpoint-router.latest.json";

const INPUTS = {
  r1106: {
    artifact: "r1106-consumer-aggregate-handoff-bundle.latest.json",
    packetId: "r1106-consumer-aggregate-handoff-bundle",
    schemaVersion: "murph-age-r1106-consumer-aggregate-handoff-bundle.v1",
  },
  r1107: {
    artifact: "r1107-consumer-age-band-source-suitability.latest.json",
    packetId: "r1107-consumer-age-band-source-suitability",
    schemaVersion: "murph-age-r1107-consumer-age-band-source-suitability.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type RouteStatus =
  | "primary_next"
  | "high_value_admin_or_collaborator"
  | "public_shadow"
  | "older_range_external_shadow"
  | "current_shadow_only"
  | "future_murph_native";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SourceRoute {
  accessMode:
    | "workbench_aggregate_receipt"
    | "authorized_download_or_aggregate_receipt"
    | "public_or_existing_local_shadow"
    | "access_application_or_aggregate_receipt"
    | "murph_native_observational_intake";
  ageFit: "strong_18_plus" | "strong_young_adult_to_midlife" | "mixed_or_older_signal" | "partial_40_to_50_only" | "future_user_cohort";
  endpointPolicy:
    | "incident_clinical_outcomes_first_mortality_if_powered"
    | "premature_cardiometabolic_events_and_risk_progression"
    | "mortality_shadow_activity_or_lab_signal"
    | "mortality_and_incident_disease_older_range_shadow"
    | "not_score_bearing_until_outcomes_accrue";
  featureFit: string[];
  nextLocalAction: string;
  priority: number;
  routeKey:
    | "all_of_us_workbench_aggregate"
    | "cardia_authorized_or_aggregate"
    | "nhanes_lab_activity_shadow"
    | "ukb_integrated_lab_accelerometer"
    | "midus_creles_existing_shadow"
    | "murph_native_coverage_and_experiment_data";
  routeStatus: RouteStatus;
  why: string;
}

export interface R1108ConsumerSourceEndpointRouterOptions {
  createdAt?: string;
  outputDir?: string;
  r1106Path?: string;
  r1107Path?: string;
}

export interface R1108ConsumerSourceEndpointRouterOutput {
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
    rowParsingPerformedByR1108: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  endpointDecision: {
    mortalityOnlyFor16To50: "underpowered_in_current_sources";
    nearTermPrimaryEndpoint: "incident_clinical_or_cardiometabolic_outcomes_with_mortality_as_secondary_when_powered";
    reason: string;
    reviewGptQuestion: string;
  };
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1108-consumer-source-endpoint-router";
  productDisplayAuthorized: false;
  reviewGptPrompt: {
    promptFileRecommended: "r1108-consumer-endpoint-source-review.prompt.md";
    purpose: "high_value_science_call_on_16_50_endpoint_policy";
    shouldAskReviewGptNow: boolean;
  };
  schemaVersion: typeof R1108_CONSUMER_SOURCE_ENDPOINT_ROUTER_SCHEMA_VERSION;
  sourceRoutes: SourceRoute[];
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "route_all_of_us_or_cardia_aggregate_first"
      | "repair_consumer_source_inputs_before_routing";
    nextAction:
      | "prepare_single_reviewgpt_endpoint_source_question_and_pursue_aggregate_receipt"
      | "regenerate_r1106_r1107_before_source_routing";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1108: false;
  };
}

export async function runR1108ConsumerSourceEndpointRouter(
  options: R1108ConsumerSourceEndpointRouterOptions = {},
): Promise<{ output: R1108ConsumerSourceEndpointRouterOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const handoffReady = readStringAt(inputs.r1106, ["summary", "conclusion"]) === "consumer_aggregate_handoff_ready";
  const currentSourcesAreSparse = readStringAt(inputs.r1107, ["summary", "conclusion"]) === "current_sources_are_shadow_or_older_transport_only";
  const ready = handoffReady && currentSourcesAreSparse;
  const output: R1108ConsumerSourceEndpointRouterOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    endpointDecision: {
      mortalityOnlyFor16To50: "underpowered_in_current_sources",
      nearTermPrimaryEndpoint: "incident_clinical_or_cardiometabolic_outcomes_with_mortality_as_secondary_when_powered",
      reason:
        "The current downloaded lab/outcome sources have too few 16-50 events for a mortality-only consumer model, so the next route should test consumer-submittable labs and wearables against earlier outcome-linked clinical endpoints while keeping mortality as a powered secondary endpoint.",
      reviewGptQuestion:
        "For Murph Age users roughly 16-50, should the next benchmark prioritize incident clinical/cardiometabolic outcomes over mortality, and which source route should be first for labs plus wearables?",
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1108-consumer-source-endpoint-router",
    productDisplayAuthorized: false,
    reviewGptPrompt: {
      promptFileRecommended: "r1108-consumer-endpoint-source-review.prompt.md",
      purpose: "high_value_science_call_on_16_50_endpoint_policy",
      shouldAskReviewGptNow: ready,
    },
    schemaVersion: R1108_CONSUMER_SOURCE_ENDPOINT_ROUTER_SCHEMA_VERSION,
    sourceRoutes: sourceRoutes(),
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "route_all_of_us_or_cardia_aggregate_first"
        : "repair_consumer_source_inputs_before_routing",
      nextAction: ready
        ? "prepare_single_reviewgpt_endpoint_source_question_and_pursue_aggregate_receipt"
        : "regenerate_r1106_r1107_before_source_routing",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: ready,
      rowParsingPerformedByR1108: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1108 consumer source endpoint router failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function sourceRoutes(): SourceRoute[] {
  return [
    {
      accessMode: "workbench_aggregate_receipt",
      ageFit: "strong_18_plus",
      endpointPolicy: "incident_clinical_outcomes_first_mortality_if_powered",
      featureFit: ["ordinary labs", "basic vitals", "body metrics", "wearable activity", "wearable sleep", "resting heart rate"],
      nextLocalAction: "use_r1105_receipt_template_in_workbench_or_partner_environment",
      priority: 1,
      routeKey: "all_of_us_workbench_aggregate",
      routeStatus: "primary_next",
      why: "Best near-term overlap between consumer-submittable features, younger adults, EHR outcomes, and wearable data.",
    },
    {
      accessMode: "authorized_download_or_aggregate_receipt",
      ageFit: "strong_young_adult_to_midlife",
      endpointPolicy: "premature_cardiometabolic_events_and_risk_progression",
      featureFit: ["ordinary labs", "body metrics", "blood pressure", "physical activity", "fitness"],
      nextLocalAction: "pursue_authorized_access_or_aggregate_receipt_without_blocking_all_of_us",
      priority: 2,
      routeKey: "cardia_authorized_or_aggregate",
      routeStatus: "high_value_admin_or_collaborator",
      why: "Strong scientific fit for 16-50 life-course cardiometabolic risk, but access is slower than an already available workbench receipt route.",
    },
    {
      accessMode: "public_or_existing_local_shadow",
      ageFit: "mixed_or_older_signal",
      endpointPolicy: "mortality_shadow_activity_or_lab_signal",
      featureFit: ["ordinary labs", "body metrics", "blood pressure", "objective activity"],
      nextLocalAction: "keep_as_shadow_activity_labs_benchmark_not_primary_consumer_validation",
      priority: 3,
      routeKey: "nhanes_lab_activity_shadow",
      routeStatus: "public_shadow",
      why: "Useful public benchmark for labs plus objective activity, but mortality signal in younger adults is too sparse and device data is not true consumer wearable continuity.",
    },
    {
      accessMode: "access_application_or_aggregate_receipt",
      ageFit: "partial_40_to_50_only",
      endpointPolicy: "mortality_and_incident_disease_older_range_shadow",
      featureFit: ["broad labs", "body metrics", "accelerometer activity", "linked outcomes"],
      nextLocalAction: "treat_as_powerful_older_range_external_shadow_if_access_lands",
      priority: 4,
      routeKey: "ukb_integrated_lab_accelerometer",
      routeStatus: "older_range_external_shadow",
      why: "Excellent lab/activity/outcome depth, but the cohort starts at 40 and is not enough for the 16-39 consumer band.",
    },
    {
      accessMode: "public_or_existing_local_shadow",
      ageFit: "mixed_or_older_signal",
      endpointPolicy: "mortality_shadow_activity_or_lab_signal",
      featureFit: ["glycemia", "lipids", "body metrics", "blood pressure in some sources"],
      nextLocalAction: "stop_tuning_current_sources_for_consumer_claims_and_keep_as_transport_memory",
      priority: 5,
      routeKey: "midus_creles_existing_shadow",
      routeStatus: "current_shadow_only",
      why: "Already downloaded and useful for transport diagnostics, but R1107 shows too few 16-50 events for the consumer target.",
    },
    {
      accessMode: "murph_native_observational_intake",
      ageFit: "future_user_cohort",
      endpointPolicy: "not_score_bearing_until_outcomes_accrue",
      featureFit: ["ordinary labs", "wearable activity", "wearable sleep", "resting heart rate", "heart rate variability", "body metrics"],
      nextLocalAction: "use_for_coverage_quality_units_and_longitudinal_change_not_hard_outcome_training_yet",
      priority: 6,
      routeKey: "murph_native_coverage_and_experiment_data",
      routeStatus: "future_murph_native",
      why: "Best eventual product-fit data stream, but it cannot validate hard outcomes until outcomes accrue or external validation bridges it.",
    },
  ];
}

async function readInputs(options: R1108ConsumerSourceEndpointRouterOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1106: await readJsonIfPresent(options.r1106Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1106.artifact)),
    r1107: await readJsonIfPresent(options.r1107Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1107.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1108 rejected unsafe ${key} input: ${findings.join("; ")}`);
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

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function safeBoundary(): R1108ConsumerSourceEndpointRouterOutput["artifactBoundary"] {
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
    rowParsingPerformedByR1108: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1108ConsumerSourceEndpointRouter({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1106Path: process.env.MURPH_AGE_R1106_CONSUMER_HANDOFF_PATH,
    r1107Path: process.env.MURPH_AGE_R1107_CONSUMER_AGE_BAND_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    primaryRoute: output.sourceRoutes[0]?.routeKey ?? null,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1108 consumer source endpoint router failed."}\n`);
    process.exitCode = 1;
  });
}
