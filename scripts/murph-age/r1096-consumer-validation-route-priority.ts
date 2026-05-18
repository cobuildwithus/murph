import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  listMurphAgePrioritySourceRoutes,
  validateMurphAgeSourceRouteRegistry,
  type MurphAgeSourceRoute,
  type MurphAgeSourceRouteId,
} from "@murphai/health-metrics";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1096_CONSUMER_VALIDATION_ROUTE_PRIORITY_SCHEMA_VERSION =
  "murph-age-r1096-consumer-validation-route-priority.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1096-consumer-validation-route-priority.latest.json";

const INPUTS = {
  r1094: {
    artifact: "r1094-consumer-age-domain-applicability-guard.latest.json",
    packetId: "r1094-consumer-age-domain-applicability-guard",
    schemaVersion: "murph-age-r1094-consumer-age-domain-applicability-guard.v1",
  },
  r1095: {
    artifact: "r1095-consumer-lab-wearable-review-packet.latest.json",
    packetId: "r1095-consumer-lab-wearable-review-packet",
    schemaVersion: "murph-age-r1095-consumer-lab-wearable-review-packet.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;

type ConsumerFit = "direct_consumer_fit" | "good_consumer_proxy" | "limited_consumer_proxy" | "background_only";
type RoutePriorityTier = "p0_exact_consumer_validation" | "p1_high_value_workbench" | "p2_public_bridge" | "p3_module_specific" | "p4_background";
type NextLocalAction =
  | "package_consumer_lab_wearable_aggregate_receipt_template"
  | "repair_consumer_lab_wearable_current_decision";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ConsumerRoutePriority {
  accessMode: MurphAgeSourceRoute["accessMode"];
  consumerFit: ConsumerFit;
  directLocalDownloadPriority:
    | "not_needed_for_aggregate_route"
    | "not_recommended_for_true_wearable_outcome_route"
    | "public_bridge_only"
    | "terms_or_workbench_before_download";
  evidenceRole: MurphAgeSourceRoute["evidenceRole"];
  featureFamilies: MurphAgeSourceRoute["featureFamilies"];
  rank: number;
  routeId: MurphAgeSourceRouteId;
  routePriorityTier: RoutePriorityTier;
  routeUse:
    | "bloodwork_and_wearable_external_validation"
    | "bloodwork_external_validation"
    | "public_lab_activity_bridge"
    | "sleep_autonomic_module_validation"
    | "transport_background";
  why: string;
}

export interface R1096ConsumerValidationRoutePriorityOptions {
  createdAt?: string;
  outputDir?: string;
  r1094Path?: string;
  r1095Path?: string;
}

export interface R1096ConsumerValidationRoutePriorityOutput {
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
    rowParsingPerformedByR1096: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  currentConsumerTarget: {
    candidateId: "common_lab_core_shadow" | "none";
    targetData: [
      "common_bloodwork",
      "manual_or_device_vitals",
      "consumer_wearable_aggregates",
    ];
    targetUserAgeBand: "roughly_16_50";
  };
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1096-consumer-validation-route-priority";
  productDisplayAuthorized: false;
  registryValidation: {
    routeCount: number;
    status: "invalid" | "valid";
  };
  routePriorities: ConsumerRoutePriority[];
  schemaVersion: typeof R1096_CONSUMER_VALIDATION_ROUTE_PRIORITY_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "consumer_lab_wearable_validation_routes_ranked"
      | "consumer_lab_wearable_routes_blocked_missing_candidate";
    nextLocalAction: NextLocalAction;
    productDisplayAuthorized: false;
    reviewGptStatus: "awaiting_r1095_science_direction_response";
    rowParsingPerformedByR1096: false;
    trueWearableOutcomeRouteStatus:
      | "aggregate_or_workbench_route_required"
      | "blocked_until_consumer_candidate_repaired";
  };
}

export async function runR1096ConsumerValidationRoutePriority(
  options: R1096ConsumerValidationRoutePriorityOptions = {},
): Promise<{ output: R1096ConsumerValidationRoutePriorityOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const routes = listMurphAgePrioritySourceRoutes();
  const registryValidation = validateMurphAgeSourceRouteRegistry(routes);
  const candidateId = readStringAt(inputs.r1095, ["currentDecision", "candidateId"]) === "common_lab_core_shadow"
    ? "common_lab_core_shadow"
    : "none";
  const validationGap = readStringAt(inputs.r1094, ["applicability", "validationGap"]);
  const currentDecisionReady = candidateId === "common_lab_core_shadow"
    && validationGap === "candidate_sources_not_direct_young_adult_consumer_validation"
    && registryValidation.status === "valid";

  const output: R1096ConsumerValidationRoutePriorityOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    currentConsumerTarget: {
      candidateId,
      targetData: [
        "common_bloodwork",
        "manual_or_device_vitals",
        "consumer_wearable_aggregates",
      ],
      targetUserAgeBand: "roughly_16_50",
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1096-consumer-validation-route-priority",
    productDisplayAuthorized: false,
    registryValidation: {
      routeCount: routes.length,
      status: registryValidation.status,
    },
    routePriorities: currentDecisionReady ? buildConsumerRoutePriorities(routes) : [],
    schemaVersion: R1096_CONSUMER_VALIDATION_ROUTE_PRIORITY_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: currentDecisionReady
        ? "consumer_lab_wearable_validation_routes_ranked"
        : "consumer_lab_wearable_routes_blocked_missing_candidate",
      nextLocalAction: currentDecisionReady
        ? "package_consumer_lab_wearable_aggregate_receipt_template"
        : "repair_consumer_lab_wearable_current_decision",
      productDisplayAuthorized: false,
      reviewGptStatus: "awaiting_r1095_science_direction_response",
      rowParsingPerformedByR1096: false,
      trueWearableOutcomeRouteStatus: currentDecisionReady
        ? "aggregate_or_workbench_route_required"
        : "blocked_until_consumer_candidate_repaired",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1096 consumer validation route priority failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function buildConsumerRoutePriorities(routes: readonly MurphAgeSourceRoute[]): ConsumerRoutePriority[] {
  return routes
    .map(scoreConsumerRoute)
    .filter((priority): priority is ConsumerRoutePriority => priority !== null)
    .sort((a, b) => a.rank - b.rank || a.routeId.localeCompare(b.routeId));
}

function scoreConsumerRoute(route: MurphAgeSourceRoute): ConsumerRoutePriority | null {
  switch (route.routeId) {
    case "partner-aggregate-evaluator":
      return routePriority(route, {
        consumerFit: "direct_consumer_fit",
        directLocalDownloadPriority: "not_needed_for_aggregate_route",
        rank: 1,
        routePriorityTier: "p0_exact_consumer_validation",
        routeUse: "bloodwork_and_wearable_external_validation",
        why: "Best near-term path when a data holder can evaluate common labs, vitals, activity, sleep, resting heart rate, or HRV on an outcome-linked denominator without sending rows.",
      });
    case "all-of-us-fitbit-labs-ehr":
      return routePriority(route, {
        consumerFit: "direct_consumer_fit",
        directLocalDownloadPriority: "terms_or_workbench_before_download",
        rank: 2,
        routePriorityTier: "p1_high_value_workbench",
        routeUse: "bloodwork_and_wearable_external_validation",
        why: "Strongest named consumer-style route because it can combine Fitbit-like streams, labs, physical measures, EHR context, and outcome/event labels inside a governed workbench.",
      });
    case "midus-biomarker-mortality":
      return routePriority(route, {
        consumerFit: "good_consumer_proxy",
        directLocalDownloadPriority: "terms_or_workbench_before_download",
        rank: 3,
        routePriorityTier: "p1_high_value_workbench",
        routeUse: "bloodwork_external_validation",
        why: "Useful bloodwork/vitals mortality route for the common lab core even though it does not solve true consumer wearable validation.",
      });
    case "nhanes-activity-shadow-lmf":
      return routePriority(route, {
        consumerFit: "good_consumer_proxy",
        directLocalDownloadPriority: "public_bridge_only",
        rank: 4,
        routePriorityTier: "p2_public_bridge",
        routeUse: "public_lab_activity_bridge",
        why: "Public labs plus objective activity can stress plumbing and shadows, but it remains same-family bridge evidence rather than direct consumer wearable validation.",
      });
    case "uk-biobank-integrated":
      return routePriority(route, {
        consumerFit: "direct_consumer_fit",
        directLocalDownloadPriority: "terms_or_workbench_before_download",
        rank: 5,
        routePriorityTier: "p1_high_value_workbench",
        routeUse: "bloodwork_and_wearable_external_validation",
        why: "High-powered lab, accelerometry, and outcome validation route, but admin/workbench access makes it a later parallel lane rather than the immediate local loop.",
      });
    case "nsrr-hchs-sol-sleep-actigraphy":
      return routePriority(route, {
        consumerFit: "good_consumer_proxy",
        directLocalDownloadPriority: "terms_or_workbench_before_download",
        rank: 6,
        routePriorityTier: "p3_module_specific",
        routeUse: "sleep_autonomic_module_validation",
        why: "Useful objective activity and sleep stress test for wearable modules, but sleep-cohort measures are not equivalent to normal consumer wearable exports.",
      });
    case "nsrr-shhs-sleep-heart-health":
      return routePriority(route, {
        consumerFit: "limited_consumer_proxy",
        directLocalDownloadPriority: "terms_or_workbench_before_download",
        rank: 7,
        routePriorityTier: "p3_module_specific",
        routeUse: "sleep_autonomic_module_validation",
        why: "Good sleep and cardiometabolic outcome stress route for sleep/recovery ideas, not a broad 16-50 consumer lab/wearable validation source.",
      });
    case "nsrr-mesa-sleep-autonomic":
      return routePriority(route, {
        consumerFit: "limited_consumer_proxy",
        directLocalDownloadPriority: "not_recommended_for_true_wearable_outcome_route",
        rank: 8,
        routePriorityTier: "p3_module_specific",
        routeUse: "sleep_autonomic_module_validation",
        why: "Potential sleep/autonomic validation route, but access is controlled and it should not outrank integrated lab/wearable routes.",
      });
    case "nshap-integrated-aging":
      return routePriority(route, {
        consumerFit: "limited_consumer_proxy",
        directLocalDownloadPriority: "terms_or_workbench_before_download",
        rank: 9,
        routePriorityTier: "p4_background",
        routeUse: "bloodwork_external_validation",
        why: "Integrated labs and vitals can support older-adult background stress, but it is not the primary 16-50 consumer input route.",
      });
    case "creles-transport-stress":
    case "haalsi-transport-stress":
    case "mhas-harmonized-aging":
    case "who-sage-south-africa-transport":
    case "nsrr-mros-sleep-aging":
    case "nsrr-sof-sleep-aging":
      return routePriority(route, {
        consumerFit: "background_only",
        directLocalDownloadPriority: route.accessMode === "public-use"
          ? "public_bridge_only"
          : "terms_or_workbench_before_download",
        rank: backgroundRank(route.routeId),
        routePriorityTier: "p4_background",
        routeUse: "transport_background",
        why: "Useful transport or module context, but not a lead path for average 16-50 users submitting consumer labs, vitals, and wearable aggregates.",
      });
    default:
      return null;
  }
}

function routePriority(
  route: MurphAgeSourceRoute,
  priority: Omit<ConsumerRoutePriority, "accessMode" | "evidenceRole" | "featureFamilies" | "routeId">,
): ConsumerRoutePriority {
  return {
    ...priority,
    accessMode: route.accessMode,
    evidenceRole: route.evidenceRole,
    featureFamilies: route.featureFamilies,
    routeId: route.routeId,
  };
}

function backgroundRank(routeId: MurphAgeSourceRouteId): number {
  const ranks: Partial<Record<MurphAgeSourceRouteId, number>> = {
    "creles-transport-stress": 20,
    "haalsi-transport-stress": 21,
    "mhas-harmonized-aging": 22,
    "who-sage-south-africa-transport": 23,
    "nsrr-mros-sleep-aging": 24,
    "nsrr-sof-sleep-aging": 25,
  };
  return ranks[routeId] ?? 99;
}

async function readInputs(options: R1096ConsumerValidationRoutePriorityOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1094: await readJsonIfPresent(options.r1094Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1094.artifact)),
    r1095: await readJsonIfPresent(options.r1095Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1095.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1096 rejected unsafe ${key} input: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.keys(INPUTS) as InputKey[]).map((key) => [key, summarizeInput(INPUTS[key].artifact, inputs[key])]),
  ) as Record<InputKey, ArtifactSummary>;
}

function summarizeInput(artifact: string, value: unknown | null): ArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value ? "available" : "missing",
  };
}

function safeBoundary() {
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
    rowParsingPerformedByR1096: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  } as const;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
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
    if (!current || typeof current !== "object" || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function main(): Promise<void> {
  const { output } = await runR1096ConsumerValidationRoutePriority({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptStatus: output.summary.reviewGptStatus,
    routePriorities: output.routePriorities.slice(0, 6).map((route) => ({
      consumerFit: route.consumerFit,
      rank: route.rank,
      routeId: route.routeId,
      routeUse: route.routeUse,
    })),
    schemaVersion: output.schemaVersion,
    status: output.status,
    trueWearableOutcomeRouteStatus: output.summary.trueWearableOutcomeRouteStatus,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1096 consumer validation route priority failed."}\n`);
    process.exitCode = 1;
  });
}
