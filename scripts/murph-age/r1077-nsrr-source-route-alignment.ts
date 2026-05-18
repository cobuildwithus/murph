import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveMurphAgeSourceRoute } from "@murphai/health-metrics";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1077_NSRR_SOURCE_ROUTE_ALIGNMENT_SCHEMA_VERSION =
  "murph-age-r1077-nsrr-source-route-alignment.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1077-nsrr-source-route-alignment.latest.json";

const COHORT_ROUTE_MAP = {
  hchs_sol: "nsrr-hchs-sol-sleep-actigraphy",
  mesa_sleep: "nsrr-mesa-sleep-autonomic",
  mros_sleep: "nsrr-mros-sleep-aging",
  shhs: "nsrr-shhs-sleep-heart-health",
  sof_sleep: "nsrr-sof-sleep-aging",
} as const;

type CohortId = "hchs_sol" | "mesa_sleep" | "mros_sleep" | "shhs" | "sof_sleep";
type AlignmentConclusion =
  | "nsrr_preferred_routes_aligned_blocked_on_downloads"
  | "nsrr_ready_route_aligned_fill_receipt"
  | "nsrr_ready_route_missing_registry";

interface CohortRouteAlignment {
  cohortId: CohortId;
  cohortReadinessStatus: string | null;
  downloadCommand: string | null;
  nextAction:
    | "download_derived_tables"
    | "fill_nsrr_aggregate_receipt"
    | "register_source_route_before_receipt";
  routeActivationStatus: string | null;
  routeFound: boolean;
  routeId: string | null;
  routeModelUseStatus: string | null;
  routeProductAuthorized: false | null;
}

export interface R1077NsrrSourceRouteAlignmentOptions {
  createdAt?: string;
  outputDir?: string;
  r1073Path?: string;
}

export interface R1077NsrrSourceRouteAlignmentOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1077: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1077: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  cohortRouteAlignment: CohortRouteAlignment[];
  createdAt: string;
  inputArtifact: {
    packetId: string | null;
    schemaVersion: string | null;
    status: "available" | "missing";
  };
  nextStep: {
    commands: string[];
    conclusion: AlignmentConclusion;
    preferredReadyCohort: string | null;
    preferredReadyRouteId: string | null;
    reviewGptRequiredNow: false;
  };
  packetId: "r1077-nsrr-source-route-alignment";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1077_NSRR_SOURCE_ROUTE_ALIGNMENT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: AlignmentConclusion;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1077: false;
  };
}

export async function runR1077NsrrSourceRouteAlignment(
  options: R1077NsrrSourceRouteAlignmentOptions = {},
): Promise<{ output: R1077NsrrSourceRouteAlignmentOutput; outputPath: string }> {
  const r1073 = await readJsonIfPresent(
    options.r1073Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1073-nsrr-derived-cohort-readiness-intake.latest.json"),
  );
  validateInputBoundary(r1073);

  const alignments = buildAlignments(r1073);
  const nextStep = nextStepFrom(r1073, alignments);
  const output: R1077NsrrSourceRouteAlignmentOutput = {
    artifactBoundary: safeBoundary(),
    cohortRouteAlignment: alignments,
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifact: {
      packetId: readStringAt(r1073, ["packetId"]),
      schemaVersion: readStringAt(r1073, ["schemaVersion"]),
      status: r1073 ? "available" : "missing",
    },
    nextStep,
    packetId: "r1077-nsrr-source-route-alignment",
    productDisplayAuthorized: false,
    schemaVersion: R1077_NSRR_SOURCE_ROUTE_ALIGNMENT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: nextStep.conclusion,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1077: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1077 NSRR source-route alignment failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function buildAlignments(r1073: unknown | null): CohortRouteAlignment[] {
  const cohortRows = readArrayAt(r1073, ["cohortReadiness"]);
  return cohortIdsFrom(r1073).map((cohortId) => {
    const routeId = routeIdForCohort(cohortId);
    const route = routeId ? resolveMurphAgeSourceRoute(routeId) : null;
    const cohort = cohortRows.find((row) => readStringAt(row, ["cohortId"]) === cohortId) ?? null;
    const readinessStatus = readStringAt(cohort, ["readinessStatus"]);
    const routeFound = route !== null;
    return {
      cohortId,
      cohortReadinessStatus: readinessStatus,
      downloadCommand: downloadCommandFor(cohortId),
      nextAction: readinessStatus === "ready_for_local_materializer_or_aggregate_receipt"
        ? routeFound ? "fill_nsrr_aggregate_receipt" : "register_source_route_before_receipt"
        : "download_derived_tables",
      routeActivationStatus: route?.activationStatus ?? null,
      routeFound,
      routeId,
      routeModelUseStatus: route?.modelUseStatus ?? null,
      routeProductAuthorized: route ? false : null,
    };
  });
}

function nextStepFrom(
  r1073: unknown | null,
  alignments: CohortRouteAlignment[],
): R1077NsrrSourceRouteAlignmentOutput["nextStep"] {
  const preferredReadyCohort = readStringAt(r1073, ["globalReadiness", "preferredReadyCohort"]);
  const readyAlignment = preferredReadyCohort
    ? alignments.find((alignment) => alignment.cohortId === preferredReadyCohort)
    : null;
  if (readyAlignment?.routeFound === true) {
    return {
      commands: [
        "MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts",
      ],
      conclusion: "nsrr_ready_route_aligned_fill_receipt",
      preferredReadyCohort,
      preferredReadyRouteId: readyAlignment.routeId,
      reviewGptRequiredNow: false,
    };
  }
  if (preferredReadyCohort) {
    return {
      commands: ["register missing NSRR source route before filling the aggregate receipt"],
      conclusion: "nsrr_ready_route_missing_registry",
      preferredReadyCohort,
      preferredReadyRouteId: null,
      reviewGptRequiredNow: false,
    };
  }
  return {
    commands: [
      "nsrr download shhs/datasets",
      "nsrr download mesa/datasets",
      "nsrr download mesa/actigraphy",
      "nsrr download hchs/datasets",
      "nsrr download hchs/actigraphy",
      "nsrr download mros/datasets",
      "nsrr download sof/datasets",
      "pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts",
    ],
    conclusion: "nsrr_preferred_routes_aligned_blocked_on_downloads",
    preferredReadyCohort: null,
    preferredReadyRouteId: null,
    reviewGptRequiredNow: false,
  };
}

function cohortIdsFrom(r1073: unknown | null): CohortId[] {
  const ids = readArrayAt(r1073, ["downloadRequest", "priorityOrder"])
    .map((value) => typeof value === "string" ? value : null)
    .filter((value): value is CohortId => value !== null && isCohortId(value));
  return ids.length > 0 ? ids : ["mesa_sleep", "shhs", "hchs_sol", "mros_sleep", "sof_sleep"];
}

function isCohortId(value: string): value is CohortId {
  return value === "hchs_sol" || value === "mesa_sleep" || value === "mros_sleep" || value === "shhs" || value === "sof_sleep";
}

function routeIdForCohort(cohortId: CohortId): string | null {
  return COHORT_ROUTE_MAP[cohortId];
}

function downloadCommandFor(cohortId: CohortId): string | null {
  if (cohortId === "hchs_sol") return "nsrr download hchs/datasets && nsrr download hchs/actigraphy";
  if (cohortId === "mesa_sleep") return "nsrr download mesa/datasets && nsrr download mesa/actigraphy";
  if (cohortId === "mros_sleep") return "nsrr download mros/datasets";
  if (cohortId === "shhs") return "nsrr download shhs/datasets";
  if (cohortId === "sof_sleep") return "nsrr download sof/datasets";
  return null;
}

function validateInputBoundary(value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1077 input R1073 artifact failed aggregate-egress validation: ${findings.join("; ")}`);
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function readArrayAt(value: unknown | null, pathParts: readonly string[]): unknown[] {
  const current = readAt(value, pathParts);
  return Array.isArray(current) ? current : [];
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const current = readAt(value, pathParts);
  return typeof current === "string" ? current : null;
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function safeBoundary(): R1077NsrrSourceRouteAlignmentOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1077: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1077: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1077NsrrSourceRouteAlignment({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1073Path: process.env.MURPH_AGE_R1073_NSRR_COHORT_READINESS_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    packetId: output.packetId,
    preferredReadyCohort: output.nextStep.preferredReadyCohort,
    preferredReadyRouteId: output.nextStep.preferredReadyRouteId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1077: output.summary.rowParsingPerformedByR1077,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1077 NSRR source-route alignment failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
