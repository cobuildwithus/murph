import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1000_CURRENT_ACCELERATION_STATE_SCHEMA_VERSION =
  "murph-age-r1000-current-acceleration-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_REDUCED_REVIEWGPT_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "reviewgpt",
  "reduced",
);
const OUTPUT_FILE_NAME = "r1000-current-acceleration-state.latest.json";

type ArtifactKey =
  | "r399LayeringReadiness"
  | "r603TransportReadiness"
  | "r614MhasActivationLabels"
  | "r614NshapActivationLabels"
  | "r615CrossSourceActivationMatrix"
  | "r978FastLoopPriority"
  | "r986CrossSourceFunction"
  | "r987CrelesGlycemia"
  | "r994SourceCacheReadiness"
  | "r995SidecarEvidenceArbitration"
  | "r997StrictNshapReplay"
  | "r998CurrentSourceLoopDecision"
  | "r999NewDataReviewGptReduction";

interface ArtifactSummary {
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R1000CurrentAccelerationStateOptions {
  createdAt?: string;
  outputDir?: string;
  r399Path?: string;
  r603Path?: string;
  r614MhasPath?: string;
  r614NshapPath?: string;
  r615Path?: string;
  r978Path?: string;
  r986Path?: string;
  r987Path?: string;
  r994Path?: string;
  r995Path?: string;
  r997Path?: string;
  r998Path?: string;
  r999Path?: string;
}

export interface R1000CurrentAccelerationStateOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1000: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableListsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  currentModel: {
    anchor: "frozen_nhis_r399_anchor";
    biomarkerLayer: "glycemia_body_shadow_only";
    broadLabsPolicy: "kill_for_now";
    productDisplay: "blocked";
    researchPosture: "research_only";
    sidecar: "function_disability_lead_diagnostic";
    wearableLayer: "hold_shadow_context_only";
  };
  evidence: {
    biomarkerTransport: {
      crelesGlycemiaVerdict: string | null;
      r399BiomarkerTransportConfirmed: boolean;
      transportReadiness: string | null;
    };
    functionDisability: {
      crossSourceVerdict: string | null;
      mhasEndpointReady: boolean;
      mhasFastLoopReady: boolean;
      nextSidecarLoop: string | null;
      nshapFreshScoringUnlocked: boolean;
      nshapHistoricalReplayUsable: boolean;
      supportiveSourceCountBand: string;
    };
    reviewGptDirection: {
      firstLoop: string | null;
      pendingCount: number;
      trustedCount: number;
      useRole: "major_result_interpretation_only";
    };
    sourceReadiness: {
      fastestLaneNow: "MHAS/Gateway MHAS" | "unknown";
      haalsiStatus: "endpoint_blocked_or_metadata_only";
      nshapStatus: "fresh_scoring_blocked";
      sageStatus: "join_or_activation_blocked";
      scoreBearingComplete: string[];
    };
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  nextAutoresearchBatch: Array<{
    actionId: string;
    expectedLearning: string;
    owner: "local_codex" | "reviewgpt";
    priority: "p0_now" | "p1_next" | "p2_shadow";
    reviewGptRequiredBeforeRunning: false;
    stopOrDemoteIf: string;
  }>;
  packetId: "r1000-current-acceleration-state";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  reviewGptOperatingRule: {
    localChecklistApproval: false;
    useFor: Array<"aggregate_result_interpretation" | "major_model_family_change" | "source_strategy_pivot">;
  };
  schemaVersion: typeof R1000_CURRENT_ACCELERATION_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    currentLead: "r399_anchor_plus_function_disability_sidecar";
    nextLocalAction: "harden_function_disability_sidecar";
    productDisplayAuthorized: false;
    whyNotBroadLabs: "transport_not_confirmed";
    whyNotWearables: "shadow_context_only";
  };
}

export async function runR1000CurrentAccelerationState(
  options: R1000CurrentAccelerationStateOptions = {},
): Promise<{ output: R1000CurrentAccelerationStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const mhasEndpointReady = readBooleanAt(inputs.r614MhasActivationLabels, ["summary", "endpointJoinContractReady"]) === true;
  const mhasFastLoopReady = readStringAt(inputs.r978FastLoopPriority, ["summary", "nextLoopId"]) === "mhas-function-disability-fast-loop"
    || readStringAt(inputs.r615CrossSourceActivationMatrix, ["summary", "nextPrimaryLocalAction"]) === "draft_locked_mhas_endpoint_join_contract";
  const nshapFreshScoringUnlocked = readBooleanAt(inputs.r614NshapActivationLabels, ["rowExecutionReadiness", "rowExecutionUnlocked"]) === true
    || readBooleanAt(inputs.r614NshapActivationLabels, ["summary", "aggregateOutputsActive"]) === true;
  const nshapHistoricalReplayUsable =
    readStringAt(inputs.r997StrictNshapReplay, ["artifactVerdict"]) === "historical_nshap_aggregate_signal_usable_research_direction_only";
  const supportiveSourceCountBand = countBand(readNumberAt(inputs.r986CrossSourceFunction, [
    "arbitration",
    "sourceSupportSummary",
    "supportiveSourceCount",
  ]));
  const r999Counts = optionalRecord(inputs.r999NewDataReviewGptReduction)?.counts;
  const scoreBearingComplete = readStringArrayAt(inputs.r994SourceCacheReadiness, ["scoreBearingComplete"]);

  const output: R1000CurrentAccelerationStateOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1000: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    currentModel: {
      anchor: "frozen_nhis_r399_anchor",
      biomarkerLayer: "glycemia_body_shadow_only",
      broadLabsPolicy: "kill_for_now",
      productDisplay: "blocked",
      researchPosture: "research_only",
      sidecar: "function_disability_lead_diagnostic",
      wearableLayer: "hold_shadow_context_only",
    },
    evidence: {
      biomarkerTransport: {
        crelesGlycemiaVerdict: readStringAt(inputs.r987CrelesGlycemia, ["keyArtifactVerdict"]),
        r399BiomarkerTransportConfirmed:
          readBooleanAt(inputs.r399LayeringReadiness, ["gates", "biomarkerTransportConfirmed", "status"]) === true
          || readStringAt(inputs.r399LayeringReadiness, ["gates", "biomarkerTransportConfirmed", "status"]) === "passed",
        transportReadiness: readStringAt(inputs.r603TransportReadiness, ["conclusion"]),
      },
      functionDisability: {
        crossSourceVerdict: readStringAt(inputs.r986CrossSourceFunction, ["summary", "verdict"])
          ?? readStringAt(inputs.r986CrossSourceFunction, ["arbitration", "functionDisabilityVerdict"]),
        mhasEndpointReady,
        mhasFastLoopReady,
        nextSidecarLoop: readStringAt(inputs.r995SidecarEvidenceArbitration, ["summary", "nextLoop"]),
        nshapFreshScoringUnlocked,
        nshapHistoricalReplayUsable,
        supportiveSourceCountBand,
      },
      reviewGptDirection: {
        firstLoop: readStringAt(inputs.r999NewDataReviewGptReduction, ["consensus", "firstLoop"]),
        pendingCount: readNumberAt(r999Counts, ["pending"]) ?? 0,
        trustedCount: readNumberAt(r999Counts, ["trusted"]) ?? 0,
        useRole: "major_result_interpretation_only",
      },
      sourceReadiness: {
        fastestLaneNow: readStringAt(inputs.r994SourceCacheReadiness, ["fastestLaneNow"]) === "MHAS/Gateway MHAS"
          ? "MHAS/Gateway MHAS"
          : "unknown",
        haalsiStatus: "endpoint_blocked_or_metadata_only",
        nshapStatus: "fresh_scoring_blocked",
        sageStatus: "join_or_activation_blocked",
        scoreBearingComplete,
      },
    },
    inputArtifacts: summarizeInputs(inputs),
    nextAutoresearchBatch: [
      {
        actionId: "harden_function_disability_sidecar",
        expectedLearning: "whether the lead sidecar remains the best interpretable non-bloodwork layer after refreshed MHAS and historical NSHAP evidence",
        owner: "local_codex",
        priority: "p0_now",
        reviewGptRequiredBeforeRunning: false,
        stopOrDemoteIf: "cross-source function support falls below the supportive threshold or residualized MHAS performance collapses",
      },
      {
        actionId: "complete_nshap_activation_or_keep_historical_replay_only",
        expectedLearning: "whether fresh NSHAP can become an executable function/cognition falsification source instead of only historical aggregate evidence",
        owner: "local_codex",
        priority: "p1_next",
        reviewGptRequiredBeforeRunning: false,
        stopOrDemoteIf: "source-rights or aggregate-output labels remain incomplete",
      },
      {
        actionId: "keep_glycemia_body_shadow_falsification_small",
        expectedLearning: "whether tiny CRELES glycemia/body support survives without expanding into weak broad labs",
        owner: "local_codex",
        priority: "p2_shadow",
        reviewGptRequiredBeforeRunning: false,
        stopOrDemoteIf: "MIDUS-to-CRELES transport remains not confirmed or proper scores reverse",
      },
      {
        actionId: "review_meaningful_result_deltas",
        expectedLearning: "whether the architecture should pivot after aggregate deltas, not after checklist churn",
        owner: "reviewgpt",
        priority: "p1_next",
        reviewGptRequiredBeforeRunning: false,
        stopOrDemoteIf: "no material aggregate result change exists",
      },
    ],
    packetId: "r1000-current-acceleration-state",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
    },
    reviewGptOperatingRule: {
      localChecklistApproval: false,
      useFor: ["aggregate_result_interpretation", "major_model_family_change", "source_strategy_pivot"],
    },
    schemaVersion: R1000_CURRENT_ACCELERATION_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      currentLead: "r399_anchor_plus_function_disability_sidecar",
      nextLocalAction: "harden_function_disability_sidecar",
      productDisplayAuthorized: false,
      whyNotBroadLabs: "transport_not_confirmed",
      whyNotWearables: "shadow_context_only",
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1000Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1000 current acceleration state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R1000CurrentAccelerationStateOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    r399LayeringReadiness: await readJsonIfPresent(
      options.r399Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r399-layering-readiness.latest.json"),
    ),
    r603TransportReadiness: await readJsonIfPresent(
      options.r603Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r603-transport-readiness-packet.latest.json"),
    ),
    r614MhasActivationLabels: await readJsonIfPresent(
      options.r614MhasPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-mhas-source-rights-activation-labels.latest.json"),
    ),
    r614NshapActivationLabels: await readJsonIfPresent(
      options.r614NshapPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-nshap-activation-labels.latest.json"),
    ),
    r615CrossSourceActivationMatrix: await readJsonIfPresent(
      options.r615Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r615-cross-source-activation-matrix.latest.json"),
    ),
    r978FastLoopPriority: await readJsonIfPresent(
      options.r978Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r978-fast-loop-priority-reducer.latest.json"),
    ),
    r986CrossSourceFunction: await readJsonIfPresent(
      options.r986Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r986-cross-source-function-arbitration.latest.json"),
    ),
    r987CrelesGlycemia: await readJsonIfPresent(
      options.r987Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r987-creles-glycemia-receipt-reducer.latest.json"),
    ),
    r994SourceCacheReadiness: await readJsonIfPresent(
      options.r994Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r994-expanded-source-cache-readiness.latest.json"),
    ),
    r995SidecarEvidenceArbitration: await readJsonIfPresent(
      options.r995Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r995-sidecar-evidence-arbitration.latest.json"),
    ),
    r997StrictNshapReplay: await readJsonIfPresent(
      options.r997Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r997-strict-nshap-function-cognition-replay.latest.json"),
    ),
    r998CurrentSourceLoopDecision: await readJsonIfPresent(
      options.r998Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r998-current-source-loop-decision.latest.json"),
    ),
    r999NewDataReviewGptReduction: await readJsonIfPresent(
      options.r999Path ?? path.join(DEFAULT_REDUCED_REVIEWGPT_DIR, "r999-new-data-acceleration-direction-summary.json"),
    ),
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (value === null) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1000 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    r399LayeringReadiness: summarizeArtifact(inputs.r399LayeringReadiness),
    r603TransportReadiness: summarizeArtifact(inputs.r603TransportReadiness),
    r614MhasActivationLabels: summarizeArtifact(inputs.r614MhasActivationLabels),
    r614NshapActivationLabels: summarizeArtifact(inputs.r614NshapActivationLabels),
    r615CrossSourceActivationMatrix: summarizeArtifact(inputs.r615CrossSourceActivationMatrix),
    r978FastLoopPriority: summarizeArtifact(inputs.r978FastLoopPriority),
    r986CrossSourceFunction: summarizeArtifact(inputs.r986CrossSourceFunction),
    r987CrelesGlycemia: summarizeArtifact(inputs.r987CrelesGlycemia),
    r994SourceCacheReadiness: summarizeArtifact(inputs.r994SourceCacheReadiness),
    r995SidecarEvidenceArbitration: summarizeArtifact(inputs.r995SidecarEvidenceArbitration),
    r997StrictNshapReplay: summarizeArtifact(inputs.r997StrictNshapReplay),
    r998CurrentSourceLoopDecision: summarizeArtifact(inputs.r998CurrentSourceLoopDecision),
    r999NewDataReviewGptReduction: summarizeArtifact(inputs.r999NewDataReviewGptReduction),
  };
}

function summarizeArtifact(value: unknown | null): ArtifactSummary {
  if (!value) return { packetId: null, schemaVersion: null, status: "missing" };
  return {
    packetId: readStringAt(value, ["packetId"]) ?? readStringAt(value, ["packet_id"]) ?? null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) ?? readStringAt(value, ["schema_version"]),
    status: "available",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("R1000 failed to read an aggregate input artifact.");
  }
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  let current: unknown = value;
  for (const key of keys) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return typeof current === "string" && current.length > 0 && current.length <= 180 && !/[\r\n\t/\\]/u.test(current)
    ? current
    : null;
}

function readBooleanAt(value: unknown | null, keys: string[]): boolean | null {
  let current: unknown = value;
  for (const key of keys) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return typeof current === "boolean" ? current : null;
}

function readNumberAt(value: unknown | null, keys: string[]): number | null {
  let current: unknown = value;
  for (const key of keys) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function readStringArrayAt(value: unknown | null, keys: string[]): string[] {
  let current: unknown = value;
  for (const key of keys) {
    const record = optionalRecord(current);
    if (!record) return [];
    current = record[key];
  }
  if (!Array.isArray(current)) return [];
  return current
    .filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 80)
    .map((item) => item.replace(/[^\w ./+-]/g, "").replace(/[\\/]/g, ""))
    .filter(Boolean);
}

function countBand(value: number | null): string {
  if (value === null || value <= 0) return "0";
  if (value <= 4) return "1-4";
  if (value <= 9) return "5-9";
  if (value <= 49) return "10-49";
  return "50+";
}

function findForbiddenR1000Output(output: R1000CurrentAccelerationStateOutput): string[] {
  const encoded = JSON.stringify(output);
  const findings: string[] = [];
  if (/[A-Za-z]:[\\/]|(?:^|")\/(?:Users|home|tmp|var)\//u.test(encoded)) {
    findings.push("output contains path-like local text");
  }
  if (/cache-entry|external-sources|Downloads/u.test(encoded)) {
    findings.push("output contains cache file or cache path text");
  }
  return findings;
}

async function main(): Promise<void> {
  const { output } = await runR1000CurrentAccelerationState({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r399Path: process.env.MURPH_AGE_R399_LAYERING_READINESS_PATH,
    r603Path: process.env.MURPH_AGE_R603_TRANSPORT_READINESS_PATH,
    r614MhasPath: process.env.MURPH_AGE_R614_MHAS_ACTIVATION_LABELS_PATH,
    r614NshapPath: process.env.MURPH_AGE_R614_NSHAP_ACTIVATION_LABELS_PATH,
    r615Path: process.env.MURPH_AGE_R615_CROSS_SOURCE_MATRIX_PATH,
    r978Path: process.env.MURPH_AGE_R978_FAST_LOOP_PRIORITY_PATH,
    r986Path: process.env.MURPH_AGE_R986_FUNCTION_ARBITRATION_PATH,
    r987Path: process.env.MURPH_AGE_R987_GLYCEMIA_RECEIPT_PATH,
    r994Path: process.env.MURPH_AGE_R994_SOURCE_CACHE_READINESS_PATH,
    r995Path: process.env.MURPH_AGE_R995_SIDECAR_ARBITRATION_PATH,
    r997Path: process.env.MURPH_AGE_R997_STRICT_NSHAP_REPLAY_PATH,
    r998Path: process.env.MURPH_AGE_R998_CURRENT_SOURCE_LOOP_PATH,
    r999Path: process.env.MURPH_AGE_R999_REVIEWGPT_REDUCTION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    currentLead: output.summary.currentLead,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptTrustedCount: output.evidence.reviewGptDirection.trustedCount,
    schemaVersion: output.schemaVersion,
    status: output.status,
    whyNotBroadLabs: output.summary.whyNotBroadLabs,
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1000 current acceleration state failed."}\n`);
    process.exitCode = 1;
  });
}
