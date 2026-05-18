import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1006_MHAS_PANEL_EXTENSION_RUNNER_MANIFEST_SCHEMA_VERSION =
  "murph-age-r1006-mhas-panel-extension-runner-manifest.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_FUNCTION_FAMILY_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "candidates",
  "function-frailty-feature-family-r751.definition.json",
);
const OUTPUT_FILE_NAME = "r1006-mhas-panel-extension-runner-manifest.latest.json";

type ArtifactKey = "r1005MhasPanelSourceCard" | "functionFamilyDefinition";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R1006MhasPanelExtensionRunnerManifestOptions {
  createdAt?: string;
  functionFamilyPath?: string;
  outputDir?: string;
  r1005Path?: string;
}

export interface R1006MhasPanelExtensionRunnerManifestOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    modelPromotionAuthorized: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1006: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  packetId: "r1006-mhas-panel-extension-runner-manifest";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  runnerManifest: {
    allowedAggregateOutputs: string[];
    blockedOutputs: string[];
    candidate: {
      candidateFeatureFamily: string | null;
      familyDefinitionStatus: string | null;
      sourceSpecificTuningAllowedAfterScoring: false;
      trainingTarget: "outcome_risk_not_chronological_age";
    };
    comparator: {
      referenceFeatureFamily: string | null;
      sameDenominatorPolicy: string | null;
    };
    endpointAndSplit: {
      denominatorId: string | null;
      endpointFamily: string | null;
      minimumCellThreshold: number | null;
      splitPolicy: string | null;
    };
    metrics: {
      allowedMetricFamilies: string[];
      negativeControlRequired: true;
    };
    runnerId: "mhas-panel-extension-runner-r1006";
    runnerStatus: "ready_to_implement_local_private_runner" | "hold_pending_source_card_or_family_definition";
    sourceFamily: "MHAS/Gateway MHAS";
  };
  schemaVersion: typeof R1006_MHAS_PANEL_EXTENSION_RUNNER_MANIFEST_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "mhas_panel_extension_runner_manifest_ready"
      | "mhas_panel_extension_runner_manifest_hold";
    nextLocalAction:
      | "implement_mhas_panel_extension_local_private_runner"
      | "repair_mhas_panel_extension_manifest_inputs";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1006: false;
  };
}

export async function runR1006MhasPanelExtensionRunnerManifest(
  options: R1006MhasPanelExtensionRunnerManifestOptions = {},
): Promise<{ output: R1006MhasPanelExtensionRunnerManifestOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const sourceCardReady = readStringAt(inputs.r1005MhasPanelSourceCard, ["summary", "conclusion"])
    === "mhas_panel_source_card_ready_research_only"
    && readStringAt(inputs.r1005MhasPanelSourceCard, ["sourceCard", "benchmarkCard", "status"])
      === "ready_for_research_panel_extension";
  const familyDefinitionReady = readStringAt(inputs.functionFamilyDefinition, ["family_id"])
    === "function_limitation_disability_v1"
    && readStringAt(inputs.functionFamilyDefinition, ["status"])
      === "proposal_only_tightened_after_r748_reviewgpt_reduction";
  const ready = sourceCardReady && familyDefinitionReady;

  const output: R1006MhasPanelExtensionRunnerManifestOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      modelPromotionAuthorized: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1006: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1006-mhas-panel-extension-runner-manifest",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
    },
    runnerManifest: {
      allowedAggregateOutputs: [
        "eligible_count_band",
        "event_count_band",
        "feature_support_bands",
        "same_denominator_metric_deltas",
        "calibration_summary",
        "negative_control_shuffle_summary",
        "suppression_verdict",
      ],
      blockedOutputs: [
        "row_values",
        "participant_identifiers",
        "split_memberships",
        "individual_predictions",
        "model_coefficients",
        "model_parameters",
        "source_text",
        "source_variable_names",
        "unsuppressed_small_cells",
        "product_or_recommendation_claims",
      ],
      candidate: {
        candidateFeatureFamily:
          readStringAt(inputs.r1005MhasPanelSourceCard, ["sourceCard", "modelScope", "candidateFeatureFamily"]),
        familyDefinitionStatus: readStringAt(inputs.functionFamilyDefinition, ["status"]),
        sourceSpecificTuningAllowedAfterScoring: false,
        trainingTarget: "outcome_risk_not_chronological_age",
      },
      comparator: {
        referenceFeatureFamily:
          readStringAt(inputs.r1005MhasPanelSourceCard, ["sourceCard", "modelScope", "referenceFeatureFamily"]),
        sameDenominatorPolicy:
          readStringAt(inputs.r1005MhasPanelSourceCard, ["sourceCard", "benchmarkCard", "sameDenominatorPolicy"]),
      },
      endpointAndSplit: {
        denominatorId: readStringAt(inputs.r1005MhasPanelSourceCard, ["sourceCard", "benchmarkCard", "denominatorId"]),
        endpointFamily: readStringAt(inputs.r1005MhasPanelSourceCard, ["sourceCard", "benchmarkCard", "evidenceClass"]),
        minimumCellThreshold:
          readNumberAt(inputs.r1005MhasPanelSourceCard, ["sourceCard", "benchmarkCard", "minimumCellThreshold"]),
        splitPolicy: readStringAt(inputs.r1005MhasPanelSourceCard, ["sourceCard", "benchmarkCard", "splitPolicy"]),
      },
      metrics: {
        allowedMetricFamilies:
          readStringArrayAt(inputs.r1005MhasPanelSourceCard, ["sourceCard", "benchmarkCard", "allowedMetricFamilies"]),
        negativeControlRequired: true,
      },
      runnerId: "mhas-panel-extension-runner-r1006",
      runnerStatus: ready
        ? "ready_to_implement_local_private_runner"
        : "hold_pending_source_card_or_family_definition",
      sourceFamily: "MHAS/Gateway MHAS",
    },
    schemaVersion: R1006_MHAS_PANEL_EXTENSION_RUNNER_MANIFEST_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "mhas_panel_extension_runner_manifest_ready"
        : "mhas_panel_extension_runner_manifest_hold",
      nextLocalAction: ready
        ? "implement_mhas_panel_extension_local_private_runner"
        : "repair_mhas_panel_extension_manifest_inputs",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1006: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1006Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1006 MHAS panel extension runner manifest failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R1006MhasPanelExtensionRunnerManifestOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    functionFamilyDefinition: await readJsonIfPresent(options.functionFamilyPath ?? DEFAULT_FUNCTION_FAMILY_PATH),
    r1005MhasPanelSourceCard: await readJsonIfPresent(
      options.r1005Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1005-mhas-panel-source-card.latest.json"),
    ),
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1006 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    functionFamilyDefinition: summarizeArtifact(
      "functionFamilyDefinition",
      inputs.functionFamilyDefinition,
    ),
    r1005MhasPanelSourceCard: summarizeArtifact(
      "r1005MhasPanelSourceCard",
      inputs.r1005MhasPanelSourceCard,
    ),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  const root = optionalRecord(value);
  return {
    artifact,
    packetId: readStringAt(root, ["packetId"]) ?? readStringAt(root, ["candidate_id"]) ?? readStringAt(root, ["family_id"]) ?? null,
    schemaVersion: readStringAt(root, ["schemaVersion"]) ?? readStringAt(root, ["schema_version"]) ?? null,
    status: root ? "available" : "missing",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readNumberAt(value: unknown | null, keys: string[]): number | null {
  const current = readAt(value, keys);
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  const current = readAt(value, keys);
  return typeof current === "string" && current.length > 0 ? current : null;
}

function readStringArrayAt(value: unknown | null, keys: string[]): string[] {
  const current = readAt(value, keys);
  return Array.isArray(current) ? current.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function readAt(value: unknown | null, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return current;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function findForbiddenR1006Output(output: R1006MhasPanelExtensionRunnerManifestOutput): string[] {
  const encoded = JSON.stringify(output);
  const findings: string[] = [];
  if (/[A-Za-z]:[\\/]|(?:^|")\/(?:Users|home|tmp|var)\//u.test(encoded)) {
    findings.push("output contains path-like local text");
  }
  if (/Downloads|external-sources|cache-entry|\.dta|\.zip|\.rar|sect_/u.test(encoded)) {
    findings.push("output contains local file-name or cache text");
  }
  return findings;
}

async function main(): Promise<void> {
  const { output } = await runR1006MhasPanelExtensionRunnerManifest({
    functionFamilyPath: process.env.MURPH_AGE_FUNCTION_FAMILY_DEFINITION_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1005Path: process.env.MURPH_AGE_R1005_MHAS_PANEL_SOURCE_CARD_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    rowParsingPerformedByR1006: output.summary.rowParsingPerformedByR1006,
    runnerStatus: output.runnerManifest.runnerStatus,
    schemaVersion: output.schemaVersion,
    status: output.status,
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1006 MHAS runner manifest failed."}\n`);
    process.exitCode = 1;
  });
}
