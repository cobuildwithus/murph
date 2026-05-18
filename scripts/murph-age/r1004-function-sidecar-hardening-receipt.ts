import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1004_FUNCTION_SIDECAR_HARDENING_RECEIPT_SCHEMA_VERSION =
  "murph-age-r1004-function-sidecar-hardening-receipt.v1" as const;

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
const OUTPUT_FILE_NAME = "r1004-function-sidecar-hardening-receipt.latest.json";

type ArtifactKey =
  | "r986CrossSourceFunctionArbitration"
  | "r988MhasAnchorIncrement"
  | "r991MhasDeepDiagnostic"
  | "r995SidecarEvidenceArbitration"
  | "r997StrictNshapReplay"
  | "r999NewDataDirection"
  | "r1001ResultDirection"
  | "r1002ExpandedDataReceipt";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R1004FunctionSidecarHardeningReceiptOptions {
  createdAt?: string;
  outputDir?: string;
  r986Path?: string;
  r988Path?: string;
  r991Path?: string;
  r995Path?: string;
  r997Path?: string;
  r999Path?: string;
  r1001Path?: string;
  r1002Path?: string;
}

export interface R1004FunctionSidecarHardeningReceiptOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    modelPromotionAuthorized: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1004: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableListsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  evidenceChecks: {
    cachedNshapResearchDirectionUsable: boolean;
    crossSourceFunctionSupported: boolean;
    expandedDataReadyForFunctionHardening: boolean;
    mhasAnchorIncrementSupported: boolean;
    mhasDeepDiagnosticSupported: boolean;
    reviewGptDirectionComplete: boolean;
    sidecarArbitrationReady: boolean;
  };
  functionSidecar: {
    displayPolicy: "no_user_facing_age_display";
    modelRole: "research_diagnostic_sidecar_not_product_age";
    status:
      | "hardened_research_lead_sidecar"
      | "hold_pending_required_evidence";
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  nextLocalBatch: Array<{
    actionId:
      | "build_mhas_panel_source_card"
      | "complete_nshap_source_unlock"
      | "run_nshap_function_cognition_falsification_when_unlocked"
      | "keep_glycemia_body_shadow_only"
      | "await_r1003_high_value_direction";
    owner: "local_codex" | "reviewgpt";
    priority: "p0_now" | "p1_next" | "p2_shadow";
    reviewGptRequiredBeforeRunning: boolean;
    why: string;
  }>;
  packetId: "r1004-function-sidecar-hardening-receipt";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  schemaVersion: typeof R1004_FUNCTION_SIDECAR_HARDENING_RECEIPT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    currentLead: "r399_anchor_plus_function_disability_hardened_sidecar";
    nextLocalAction: "build_mhas_panel_source_card";
    productDisplayAuthorized: false;
    sidecarStatus:
      | "hardened_research_lead_sidecar"
      | "hold_pending_required_evidence";
  };
}

export async function runR1004FunctionSidecarHardeningReceipt(
  options: R1004FunctionSidecarHardeningReceiptOptions = {},
): Promise<{ output: R1004FunctionSidecarHardeningReceiptOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const evidenceChecks = {
    cachedNshapResearchDirectionUsable: readStringAt(inputs.r997StrictNshapReplay, ["summary", "artifactVerdict"])
      === "historical_nshap_aggregate_signal_usable_research_direction_only",
    crossSourceFunctionSupported: readStringAt(inputs.r986CrossSourceFunctionArbitration, ["summary", "verdict"])
      === "function_disability_portable_diagnostic_sidecar_supported",
    expandedDataReadyForFunctionHardening: readStringAt(inputs.r1002ExpandedDataReceipt, ["functionSidecarHardening", "status"])
      === "ready_for_local_hardening_loop",
    mhasAnchorIncrementSupported: readStringAt(inputs.r988MhasAnchorIncrement, ["summary", "verdict"])
      === "mhas_function_adds_small_increment_over_frozen_anchor",
    mhasDeepDiagnosticSupported: readStringAt(inputs.r991MhasDeepDiagnostic, ["summary", "verdict"])
      === "function_disability_survives_age_residualized_deep_diagnostic",
    reviewGptDirectionComplete: readStringAt(inputs.r999NewDataDirection, ["status"]) === "complete"
      && readStringAt(inputs.r1001ResultDirection, ["status"]) === "complete"
      && readStringAt(inputs.r1001ResultDirection, ["consensus", "decision"]) === "keep_function_first",
    sidecarArbitrationReady: readStringAt(inputs.r995SidecarEvidenceArbitration, ["summary", "nextCandidateFamily"])
      === "function_disability",
  };
  const hardened = Object.values(evidenceChecks).every(Boolean);
  const sidecarStatus = hardened ? "hardened_research_lead_sidecar" : "hold_pending_required_evidence";

  const output: R1004FunctionSidecarHardeningReceiptOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      modelPromotionAuthorized: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1004: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    evidenceChecks,
    functionSidecar: {
      displayPolicy: "no_user_facing_age_display",
      modelRole: "research_diagnostic_sidecar_not_product_age",
      status: sidecarStatus,
    },
    inputArtifacts: summarizeInputs(inputs),
    nextLocalBatch: [
      {
        actionId: "build_mhas_panel_source_card",
        owner: "local_codex",
        priority: "p0_now",
        reviewGptRequiredBeforeRunning: false,
        why: "The function/disability sidecar is hardened enough for a source-carded MHAS panel extension plan without changing the product model.",
      },
      {
        actionId: "complete_nshap_source_unlock",
        owner: "local_codex",
        priority: "p1_next",
        reviewGptRequiredBeforeRunning: false,
        why: "NSHAP remains the next independent function/cognition falsification source, but fresh scoring is still activation-limited.",
      },
      {
        actionId: "run_nshap_function_cognition_falsification_when_unlocked",
        owner: "local_codex",
        priority: "p1_next",
        reviewGptRequiredBeforeRunning: false,
        why: "Fresh NSHAP should test whether function/disability survives after cognition separation.",
      },
      {
        actionId: "keep_glycemia_body_shadow_only",
        owner: "local_codex",
        priority: "p2_shadow",
        reviewGptRequiredBeforeRunning: false,
        why: "Biomarker transport remains unconfirmed, so glycemia/body should not expand into broad labs.",
      },
      {
        actionId: "await_r1003_high_value_direction",
        owner: "reviewgpt",
        priority: "p1_next",
        reviewGptRequiredBeforeRunning: false,
        why: "The pending R1003 chorus is for high-level source/model strategy only, not local checklist approval.",
      },
    ],
    packetId: "r1004-function-sidecar-hardening-receipt",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
    },
    schemaVersion: R1004_FUNCTION_SIDECAR_HARDENING_RECEIPT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      currentLead: "r399_anchor_plus_function_disability_hardened_sidecar",
      nextLocalAction: "build_mhas_panel_source_card",
      productDisplayAuthorized: false,
      sidecarStatus,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1004 function sidecar hardening receipt failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R1004FunctionSidecarHardeningReceiptOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    r986CrossSourceFunctionArbitration: await readJsonIfPresent(
      options.r986Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r986-cross-source-function-arbitration.latest.json"),
    ),
    r988MhasAnchorIncrement: await readJsonIfPresent(
      options.r988Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r988-mhas-anchor-function-increment-check.latest.json"),
    ),
    r991MhasDeepDiagnostic: await readJsonIfPresent(
      options.r991Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r991-mhas-deep-diagnostic-reducer.latest.json"),
    ),
    r995SidecarEvidenceArbitration: await readJsonIfPresent(
      options.r995Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r995-sidecar-evidence-arbitration.latest.json"),
    ),
    r997StrictNshapReplay: await readJsonIfPresent(
      options.r997Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r997-strict-nshap-function-cognition-replay.latest.json"),
    ),
    r999NewDataDirection: await readJsonIfPresent(
      options.r999Path ?? path.join(DEFAULT_REDUCED_REVIEWGPT_DIR, "r999-new-data-acceleration-direction-summary.json"),
    ),
    r1001ResultDirection: await readJsonIfPresent(
      options.r1001Path ?? path.join(DEFAULT_REDUCED_REVIEWGPT_DIR, "r1001-result-interpretation-direction-summary.json"),
    ),
    r1002ExpandedDataReceipt: await readJsonIfPresent(
      options.r1002Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1002-expanded-data-function-hardening-receipt.latest.json"),
    ),
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1004 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    r986CrossSourceFunctionArbitration: summarizeArtifact(
      "r986-cross-source-function-arbitration.latest.json",
      inputs.r986CrossSourceFunctionArbitration,
    ),
    r988MhasAnchorIncrement: summarizeArtifact(
      "r988-mhas-anchor-function-increment-check.latest.json",
      inputs.r988MhasAnchorIncrement,
    ),
    r991MhasDeepDiagnostic: summarizeArtifact(
      "r991-mhas-deep-diagnostic-reducer.latest.json",
      inputs.r991MhasDeepDiagnostic,
    ),
    r995SidecarEvidenceArbitration: summarizeArtifact(
      "r995-sidecar-evidence-arbitration.latest.json",
      inputs.r995SidecarEvidenceArbitration,
    ),
    r997StrictNshapReplay: summarizeArtifact(
      "r997-strict-nshap-function-cognition-replay.latest.json",
      inputs.r997StrictNshapReplay,
    ),
    r999NewDataDirection: summarizeArtifact(
      "r999-new-data-acceleration-direction-summary.json",
      inputs.r999NewDataDirection,
    ),
    r1001ResultDirection: summarizeArtifact(
      "r1001-result-interpretation-direction-summary.json",
      inputs.r1001ResultDirection,
    ),
    r1002ExpandedDataReceipt: summarizeArtifact(
      "r1002-expanded-data-function-hardening-receipt.latest.json",
      inputs.r1002ExpandedDataReceipt,
    ),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  const root = optionalRecord(value);
  return {
    artifact,
    packetId: readStringAt(root, ["packetId"]) ?? null,
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

function readStringAt(value: unknown | null, keys: string[]): string | null {
  let current: unknown = value;
  for (const key of keys) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return typeof current === "string" ? current : null;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function main(): Promise<void> {
  const { output } = await runR1004FunctionSidecarHardeningReceipt({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r986Path: process.env.MURPH_AGE_R986_FUNCTION_ARBITRATION_PATH,
    r988Path: process.env.MURPH_AGE_R988_MHAS_ANCHOR_INCREMENT_PATH,
    r991Path: process.env.MURPH_AGE_R991_MHAS_DEEP_DIAGNOSTIC_PATH,
    r995Path: process.env.MURPH_AGE_R995_SIDECAR_ARBITRATION_PATH,
    r997Path: process.env.MURPH_AGE_R997_STRICT_NSHAP_REPLAY_PATH,
    r999Path: process.env.MURPH_AGE_R999_REVIEWGPT_DIRECTION_PATH,
    r1001Path: process.env.MURPH_AGE_R1001_REVIEWGPT_DIRECTION_PATH,
    r1002Path: process.env.MURPH_AGE_R1002_EXPANDED_DATA_RECEIPT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    currentLead: output.summary.currentLead,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    schemaVersion: output.schemaVersion,
    sidecarStatus: output.summary.sidecarStatus,
    status: output.status,
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1004 function sidecar hardening receipt failed."}\n`);
    process.exitCode = 1;
  });
}
