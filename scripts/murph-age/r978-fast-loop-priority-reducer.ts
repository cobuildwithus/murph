import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R978_FAST_LOOP_PRIORITY_REDUCER_SCHEMA_VERSION =
  "murph-age-r978-fast-loop-priority-reducer.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_REVIEW_MARKDOWN_PATH = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "reviewgpt-prompts",
  "r399-midus-next-architecture.response.md",
);
const OUTPUT_FILE_NAME = "r978-fast-loop-priority-reducer.latest.json";

type ArtifactKey =
  | "r610NextExecutableLoopScaffold"
  | "r614MhasSourceRightsActivationLabels"
  | "r615CrossSourceActivationMatrix"
  | "r976ExternalGeneralizationEvaluator"
  | "r977NshapNextActivationProbe"
  | "reviewMarkdown";
type ArtifactStatus = "available" | "missing";
type DataSource = "MHAS" | "NSHAP" | "HAALSI" | "SAGE" | "NHANES" | "CRELES" | "cross_source";
type PriorityBand = "p0_next" | "p1_after_primary" | "p2_activation_blocked" | "shadow_only";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface SourceLabelSet {
  activationTier: string | null;
  aggregateOutputLabel: string | null;
  evidenceClass: string | null;
  functionOrDisability: string | null;
  hardOutcome: string | null;
  joinOrWaveLabel: string | null;
  sourceRightsLabel: string | null;
  wearableOrActivity: string | null;
}

interface QueueItem {
  blockedActions: string[];
  dataSource: DataSource;
  editable: string[];
  evidenceArtifacts: string[];
  frozen: string[];
  loopId: string;
  nextLocalAction: string;
  outcomeScoringUnlocked: false;
  priorityBand: PriorityBand;
  productPromotionAuthorized: false;
  reviewScope: "local_reducer_only" | "aggregate_strategy_review";
  rowExecutionUnlocked: false;
  sourceLabels: SourceLabelSet;
  why: string[];
}

export interface R978FastLoopPriorityReducerOptions {
  createdAt?: string;
  outputDir?: string;
  r610Path?: string;
  r614MhasPath?: string;
  r615Path?: string;
  r976Path?: string;
  r977Path?: string;
  reviewMarkdownPath?: string;
}

export interface R978FastLoopPriorityReducerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    markdownBodiesStored: false;
    modelParametersStored: false;
    outcomeScoringPerformed: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformed: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableListsStored: false;
    variableNamesStored: false;
  };
  consensusReduction: {
    labFamilyPolicy: {
      fallbackLabel: "lab5_fallback_warning";
      preferredLabel: "lab9_preferred";
      variableListsStored: false;
    };
    primaryExecutionLane: "mhas_function_disability";
    researchOnly: true;
    wearablePolicy: "shadow_only";
  };
  createdAt: string;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  packetId: "r978-fast-loop-priority-reducer";
  queue: QueueItem[];
  schemaVersion: typeof R978_FAST_LOOP_PRIORITY_REDUCER_SCHEMA_VERSION;
  status: "research-local-aggregate-only" | "blocked-missing-aggregate-artifacts";
  summary: {
    conclusion: "next_loop_queue_ready" | "next_loop_queue_manifest_only";
    nextDataSource: DataSource | null;
    nextLoopId: string | null;
    outcomeScoringUnlocked: false;
    productDisplayAuthorized: false;
    queueItemCountBand: string;
    rowExecutionUnlocked: false;
  };
}

export async function runR978FastLoopPriorityReducer(
  options: R978FastLoopPriorityReducerOptions = {},
): Promise<{ output: R978FastLoopPriorityReducerOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const queue = buildQueue(inputs);
  const next = queue.find((item) => item.priorityBand === "p0_next") ?? queue[0] ?? null;
  const missingCore = inputs.r615CrossSourceActivationMatrix === null || inputs.r614MhasSourceRightsActivationLabels === null;
  const output: R978FastLoopPriorityReducerOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      markdownBodiesStored: false,
      modelParametersStored: false,
      outcomeScoringPerformed: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformed: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
    },
    consensusReduction: {
      labFamilyPolicy: {
        fallbackLabel: "lab5_fallback_warning",
        preferredLabel: "lab9_preferred",
        variableListsStored: false,
      },
      primaryExecutionLane: "mhas_function_disability",
      researchOnly: true,
      wearablePolicy: "shadow_only",
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r978-fast-loop-priority-reducer",
    queue,
    schemaVersion: R978_FAST_LOOP_PRIORITY_REDUCER_SCHEMA_VERSION,
    status: missingCore ? "blocked-missing-aggregate-artifacts" : "research-local-aggregate-only",
    summary: {
      conclusion: missingCore ? "next_loop_queue_manifest_only" : "next_loop_queue_ready",
      nextDataSource: next?.dataSource ?? null,
      nextLoopId: next?.loopId ?? null,
      outcomeScoringUnlocked: false,
      productDisplayAuthorized: false,
      queueItemCountBand: countBand(queue.length),
      rowExecutionUnlocked: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR978Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R978 fast-loop priority reducer failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R978FastLoopPriorityReducerOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    r610NextExecutableLoopScaffold: await readJsonIfPresent(
      options.r610Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r610-next-executable-loop-scaffold.latest.json"),
    ),
    r614MhasSourceRightsActivationLabels: await readJsonIfPresent(
      options.r614MhasPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-mhas-source-rights-activation-labels.latest.json"),
    ),
    r615CrossSourceActivationMatrix: await readJsonIfPresent(
      options.r615Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r615-cross-source-activation-matrix.latest.json"),
    ),
    r976ExternalGeneralizationEvaluator: await readJsonIfPresent(
      options.r976Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r976-external-generalization-evaluator.latest.json"),
    ),
    r977NshapNextActivationProbe: await readJsonIfPresent(
      options.r977Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r977-nshap-next-activation-probe.latest.json"),
    ),
    reviewMarkdown: await readMarkdownSignalIfPresent(options.reviewMarkdownPath ?? DEFAULT_REVIEW_MARKDOWN_PATH),
  };
}

function buildQueue(inputs: Record<ArtifactKey, unknown | null>): QueueItem[] {
  const rows = readSourceRows(inputs.r615CrossSourceActivationMatrix);
  const queue = [
    buildMhasQueueItem(rows.get("MHAS"), inputs.r614MhasSourceRightsActivationLabels, inputs.r610NextExecutableLoopScaffold),
    buildCrelesQueueItem(rows.get("CRELES"), inputs.r976ExternalGeneralizationEvaluator),
    buildNshapQueueItem(rows.get("NSHAP"), inputs.r977NshapNextActivationProbe),
    buildEndpointGatedQueueItem("HAALSI", rows.get("HAALSI")),
    buildEndpointGatedQueueItem("SAGE", rows.get("SAGE")),
    buildNhanesShadowQueueItem(rows.get("NHANES")),
  ];
  return queue.filter((item): item is QueueItem => item !== null);
}

function buildMhasQueueItem(
  row: Record<string, unknown> | null | undefined,
  r614: unknown | null,
  r610: unknown | null,
): QueueItem | null {
  const gates = optionalRecord(optionalRecord(r614)?.gates);
  const summary = optionalRecord(optionalRecord(r614)?.summary);
  const nextAction = optionalMetadataLabel(gates?.nextGate, "MHAS next gate")
    ?? firstActionForLane(r610, "mhas-harmonized-eol")
    ?? firstAllowedAction(row)
    ?? "draft_locked_mhas_endpoint_join_contract";
  const endpointReady = optionalBoolean(summary?.endpointJoinContractReady) === true
    || optionalMetadataLabel(gates?.nextGate, "MHAS next gate") === "draft_locked_mhas_endpoint_join_contract";
  return {
    blockedActions: safeLabelArray(gates?.blockedActions, "MHAS blocked actions", [
      "row_execution_until_locked_endpoint_join_contract",
      "outcome_scoring_until_locked_benchmark",
      "model_mutation_until_execution_gate",
      "product_claims_blocked",
    ]),
    dataSource: "MHAS",
    editable: [
      "endpoint_join_contract_metadata",
      "function_disability_aggregate_reducer_scaffold",
      "benchmark_card_scaffold",
      "suppression_policy_receipt",
    ],
    evidenceArtifacts: [
      "r614-mhas-source-rights-activation-labels.latest.json",
      "r615-cross-source-activation-matrix.latest.json",
    ],
    frozen: [
      "primary_execution_lane",
      "source_rights_activation_labels",
      "local_role_family_labels",
      "prior_local_model_family_selection",
      "research_only_boundary",
      "wearables_shadow_only",
    ],
    loopId: "mhas-function-disability-fast-loop",
    nextLocalAction: nextAction,
    outcomeScoringUnlocked: false,
    priorityBand: endpointReady ? "p0_next" : "p2_activation_blocked",
    productPromotionAuthorized: false,
    reviewScope: "local_reducer_only",
    rowExecutionUnlocked: false,
    sourceLabels: sourceLabelsFromRow(row),
    why: [
      "consensus_primary_lane_mhas_function_disability",
      endpointReady ? "mhas_endpoint_contract_metadata_ready_no_execution" : "mhas_endpoint_contract_metadata_incomplete",
      "r615_next_batch_prefers_mhas_before_secondary_receipts",
    ],
  };
}

function buildCrelesQueueItem(row: Record<string, unknown> | null | undefined, r976: unknown | null): QueueItem | null {
  if (!row && !r976) return null;
  return {
    blockedActions: [
      "model_promotion_until_multi_source_validation",
      "feature_expansion_without_predeclared_card",
      "product_claims_blocked",
    ],
    dataSource: "CRELES",
    editable: ["aggregate_receipt_reduction_only"],
    evidenceArtifacts: [
      "r976-external-generalization-evaluator.latest.json",
      "r615-cross-source-activation-matrix.latest.json",
    ],
    frozen: [
      "existing_aggregate_metric_slots",
      "lab_family_policy_labels",
      "research_only_boundary",
      "product_claims_blocked",
    ],
    loopId: "creles-aggregate-receipt-reduction",
    nextLocalAction: firstAllowedAction(row) ?? "reduce_creles_glycemia_transport_receipt",
    outcomeScoringUnlocked: false,
    priorityBand: "p1_after_primary",
    productPromotionAuthorized: false,
    reviewScope: "aggregate_strategy_review",
    rowExecutionUnlocked: false,
    sourceLabels: sourceLabelsFromRow(row),
    why: [
      "secondary_receipt_after_mhas_primary_lane",
      "aggregate_metric_slots_available_but_not_product_claims",
    ],
  };
}

function buildNshapQueueItem(row: Record<string, unknown> | null | undefined, r977: unknown | null): QueueItem | null {
  if (!row && !r977) return null;
  const gate = optionalRecord(optionalRecord(r977)?.rowExecutionGate);
  return {
    blockedActions: safeLabelArray(gate?.blockingReasons, "NSHAP blocking reasons", [
      "source_rights_or_aggregate_output_permission_unconfirmed",
      "outcome_scoring_requires_separate_execution_gate",
    ]),
    dataSource: "NSHAP",
    editable: [
      "source_rights_endpoint_labels",
      "metadata_only_sidecar_scaffold_after_labels",
    ],
    evidenceArtifacts: [
      "r977-nshap-next-activation-probe.latest.json",
      "r615-cross-source-activation-matrix.latest.json",
    ],
    frozen: [
      "metadata_activation_only_until_labels",
      "row_execution_blocked",
      "outcome_scoring_blocked",
      "research_only_boundary",
    ],
    loopId: "nshap-metadata-activation-labels",
    nextLocalAction: optionalMetadataLabel(gate?.nextAction, "NSHAP next action")
      ?? firstAllowedAction(row)
      ?? "complete_nshap_source_rights_and_aggregate_output_labels",
    outcomeScoringUnlocked: false,
    priorityBand: "p2_activation_blocked",
    productPromotionAuthorized: false,
    reviewScope: "local_reducer_only",
    rowExecutionUnlocked: false,
    sourceLabels: sourceLabelsFromRow(row),
    why: [
      "nshap_stays_metadata_activation_until_labels",
      "benchmark_metadata_can_be_tracked_without_row_execution",
    ],
  };
}

function buildEndpointGatedQueueItem(
  source: "HAALSI" | "SAGE",
  row: Record<string, unknown> | null | undefined,
): QueueItem | null {
  if (!row) return null;
  return {
    blockedActions: safeLabelArray(row.blockedNextActions, `${source} blocked actions`, [
      "score_bearing_modeling_until_endpoint_ready",
      "product_claims_blocked",
    ]),
    dataSource: source,
    editable: ["terms_endpoint_join_feasibility_card"],
    evidenceArtifacts: ["r615-cross-source-activation-matrix.latest.json"],
    frozen: [
      "endpoint_gated",
      "row_execution_blocked",
      "outcome_scoring_blocked",
      "research_only_boundary",
    ],
    loopId: `${source.toLowerCase()}-endpoint-gated-activation`,
    nextLocalAction: firstAllowedAction(row) ?? "refresh_endpoint_feasibility_card",
    outcomeScoringUnlocked: false,
    priorityBand: "p2_activation_blocked",
    productPromotionAuthorized: false,
    reviewScope: "local_reducer_only",
    rowExecutionUnlocked: false,
    sourceLabels: sourceLabelsFromRow(row),
    why: [`${source.toLowerCase()}_stays_endpoint_gated_until_labels_ready`],
  };
}

function buildNhanesShadowQueueItem(row: Record<string, unknown> | null | undefined): QueueItem | null {
  if (!row) return null;
  return {
    blockedActions: safeLabelArray(row.blockedNextActions, "NHANES blocked actions", [
      "true_external_validation_claim_from_nhanes",
      "consumer_wearable_validation_from_nhanes_activity",
      "product_claims_blocked",
    ]),
    dataSource: "NHANES",
    editable: ["layering_map_refresh_after_primary_receipts"],
    evidenceArtifacts: ["r615-cross-source-activation-matrix.latest.json"],
    frozen: [
      "same_family_internal_only",
      "wearables_shadow_only",
      "product_claims_blocked",
    ],
    loopId: "nhanes-wearables-shadow-only",
    nextLocalAction: "keep_objective_activity_shadow_only",
    outcomeScoringUnlocked: false,
    priorityBand: "shadow_only",
    productPromotionAuthorized: false,
    reviewScope: "local_reducer_only",
    rowExecutionUnlocked: false,
    sourceLabels: sourceLabelsFromRow(row),
    why: ["wearables_remain_shadow_only_not_primary_execution_lane"],
  };
}

function readSourceRows(value: unknown | null): Map<DataSource, Record<string, unknown>> {
  const root = optionalRecord(value);
  const rows = readRecordArray(root?.sourceRows, "R615 source rows", false);
  const bySource = new Map<DataSource, Record<string, unknown>>();
  for (const row of rows) {
    const source = optionalMetadataLabel(row.sourceFamily, "source family");
    if (isDataSource(source)) bySource.set(source, row);
  }
  return bySource;
}

function sourceLabelsFromRow(row: Record<string, unknown> | null | undefined): SourceLabelSet {
  const domains = optionalRecord(row?.candidateDomainLabels);
  return {
    activationTier: optionalMetadataLabel(row?.activationTier, "activation tier"),
    aggregateOutputLabel: optionalMetadataLabel(row?.aggregateOutputLabel, "aggregate output label"),
    evidenceClass: optionalMetadataLabel(row?.evidenceClass, "evidence class"),
    functionOrDisability: optionalMetadataLabel(domains?.functionOrDisability, "function disability label"),
    hardOutcome: optionalMetadataLabel(domains?.hardOutcome, "hard outcome label"),
    joinOrWaveLabel: optionalMetadataLabel(row?.joinOrWaveLabel, "join or wave label"),
    sourceRightsLabel: optionalMetadataLabel(row?.sourceRightsLabel, "source rights label"),
    wearableOrActivity: optionalMetadataLabel(domains?.wearableOrActivity, "wearable activity label"),
  };
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    r610NextExecutableLoopScaffold: summarizeArtifact(
      "r610-next-executable-loop-scaffold.latest.json",
      inputs.r610NextExecutableLoopScaffold,
    ),
    r614MhasSourceRightsActivationLabels: summarizeArtifact(
      "r614-mhas-source-rights-activation-labels.latest.json",
      inputs.r614MhasSourceRightsActivationLabels,
    ),
    r615CrossSourceActivationMatrix: summarizeArtifact(
      "r615-cross-source-activation-matrix.latest.json",
      inputs.r615CrossSourceActivationMatrix,
    ),
    r976ExternalGeneralizationEvaluator: summarizeArtifact(
      "r976-external-generalization-evaluator.latest.json",
      inputs.r976ExternalGeneralizationEvaluator,
    ),
    r977NshapNextActivationProbe: summarizeArtifact(
      "r977-nshap-next-activation-probe.latest.json",
      inputs.r977NshapNextActivationProbe,
    ),
    reviewMarkdown: summarizeMarkdownArtifact(inputs.reviewMarkdown),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, artifact);
  return {
    artifact,
    packetId: optionalMetadataLabel(root.packetId, `${artifact} packet id`),
    schemaVersion: optionalMetadataLabel(root.schemaVersion, `${artifact} schema version`),
    status: "available",
  };
}

function summarizeMarkdownArtifact(value: unknown | null): ArtifactSummary {
  if (!value) return { artifact: "reviewgpt-strategy-markdown", packetId: null, schemaVersion: null, status: "missing" };
  return {
    artifact: "reviewgpt-strategy-markdown",
    packetId: "markdown_signal_body_not_stored",
    schemaVersion: null,
    status: "available",
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value || key === "reviewMarkdown") continue;
    const record = requiredRecord(value, key);
    const boundary = optionalRecord(record.boundary) ?? optionalRecord(record.artifactBoundary);
    if (!boundary) continue;
    for (const [flag, flagValue] of Object.entries(boundary)) {
      if (flag === "aggregateOnly") continue;
      if ((flag.endsWith("Stored") || flag.endsWith("Included") || flag.endsWith("Authorized")) && flagValue !== false) {
        throw new Error(`${key} boundary has unsafe boundary flag ${flag}`);
      }
    }
  }
}

function findForbiddenR978Output(value: R978FastLoopPriorityReducerOutput): string[] {
  const forbidden = [
    "caseid",
    "coefficient",
    "codebook",
    "localpath",
    "modelparameter",
    "participantid",
    "prediction",
    "rawrow",
    "rowvalue",
    "smallcell",
    "sourcebody",
    "sourcetext",
    "splitid",
    "variablelist",
  ];
  const findings: string[] = [];
  function visit(node: unknown): void {
    if (typeof node === "string") {
      const text = node.toLowerCase().replace(/[_\s-]+/gu, "");
      for (const token of forbidden) {
        if (text.includes(token)) findings.push(`forbidden string token ${token}`);
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    Object.values(node).forEach(visit);
  }
  visit(value);
  return findings;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (optionalRecord(error)?.code === "ENOENT") return null;
    throw new Error("Failed to read R978 aggregate input artifact.");
  }
}

async function readMarkdownSignalIfPresent(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await readFile(filePath, "utf8");
    return {
      aggregateOnlySignal: true,
      bodyStored: false,
      mentionsFunctionDisability: /\bfunction\b|\bdisability\b/iu.test(text),
      mentionsMhas: /\bmhas\b/iu.test(text),
    };
  } catch (error) {
    if (optionalRecord(error)?.code === "ENOENT") return null;
    throw new Error("Failed to read R978 markdown signal artifact.");
  }
}

function firstActionForLane(value: unknown | null, laneId: string): string | null {
  const loops = readRecordArray(optionalRecord(value)?.executableLocalLoops, "R610 executable loops", false);
  const loop = loops.find((candidate) => optionalMetadataLabel(candidate.laneId, "R610 lane id") === laneId);
  return optionalMetadataLabel(loop?.localAction, "R610 local action");
}

function firstAllowedAction(row: Record<string, unknown> | null | undefined): string | null {
  const actions = readMetadataLabelArray(row?.allowedNextLocalActions, "allowed next local actions", false);
  return actions[0] ?? null;
}

function safeLabelArray(value: unknown, label: string, fallback: string[]): string[] {
  const values = readMetadataLabelArray(value, label, false);
  return values.length > 0 ? values : fallback.map((item) => requiredMetadataLabel(item, label));
}

function readRecordArray(value: unknown, label: string, required = true): Record<string, unknown>[] {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} must be an object array.`);
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`${label} must be an object array.`);
  }
  return value as Record<string, unknown>[];
}

function readMetadataLabelArray(value: unknown, label: string, required = true): string[] {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} must be a string array.`);
    return [];
  }
  if (!Array.isArray(value)) throw new Error(`${label} must be a string array.`);
  return value.map((item, index) => requiredMetadataLabel(item, `${label} ${index + 1}`));
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalMetadataLabel(value: unknown, label: string): string | null {
  return typeof value === "string" && value.length > 0 ? requiredMetadataLabel(value, label) : null;
}

function requiredMetadataLabel(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    /[\r\n\t/\\]/u.test(value) ||
    /\b(?:authorization|codebook|coefficient|identifier|participant|prediction|raw\s*row|row\s*value|small\s*cell|source\s*body|source\s*text|split\s*id|variable\s*list)\b/iu.test(value)
  ) {
    throw new Error(`${label} is not a safe metadata label.`);
  }
  return value;
}

function isDataSource(value: string | null): value is DataSource {
  return value === "MHAS"
    || value === "NSHAP"
    || value === "HAALSI"
    || value === "SAGE"
    || value === "NHANES"
    || value === "CRELES"
    || value === "cross_source";
}

function countBand(count: number): string {
  if (count <= 0) return "0";
  if (count <= 4) return "1-4";
  if (count <= 9) return "5-9";
  return "10+";
}

async function main(): Promise<void> {
  const { output } = await runR978FastLoopPriorityReducer({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r610Path: process.env.MURPH_AGE_R610_LOOP_SCAFFOLD_PATH,
    r614MhasPath: process.env.MURPH_AGE_R614_MHAS_LABELS_PATH,
    r615Path: process.env.MURPH_AGE_R615_ACTIVATION_MATRIX_PATH,
    r976Path: process.env.MURPH_AGE_R976_GENERALIZATION_EVALUATOR_PATH,
    r977Path: process.env.MURPH_AGE_R977_NSHAP_PROBE_PATH,
    reviewMarkdownPath: process.env.MURPH_AGE_REVIEW_MARKDOWN_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    conclusion: output.summary.conclusion,
    nextDataSource: output.summary.nextDataSource,
    nextLoopId: output.summary.nextLoopId,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    queueItemCountBand: output.summary.queueItemCountBand,
    rowExecutionUnlocked: output.summary.rowExecutionUnlocked,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R978 fast-loop priority reducer failed.\n");
    process.exitCode = 1;
  });
}
