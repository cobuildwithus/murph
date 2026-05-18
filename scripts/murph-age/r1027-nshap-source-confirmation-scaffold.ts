import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1027_NSHAP_SOURCE_CONFIRMATION_SCAFFOLD_SCHEMA_VERSION =
  "murph-age-r1027-nshap-source-confirmation-scaffold.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_CONFIRMATION_PATH = path.join(
  ".runtime",
  "murph-age",
  "source-confirmations",
  "nshap-public-use-confirmation.local.json",
);
const OUTPUT_FILE_NAME = "r1027-nshap-source-confirmation-scaffold.latest.json";

const CONFIRMATION_FIELDS = [
  "user_confirms_terms_allow_local_research_rows",
  "user_confirms_aggregate_output_permission_clear",
  "user_confirms_mortality_or_followup_endpoint_available",
  "user_confirms_wave_linkage_policy_clear",
  "user_confirms_biomarker_overlap_clear",
  "user_confirms_local_ignored_cache_only",
  "user_confirms_no_rows_or_source_bodies_to_reviewgpt",
  "user_confirms_aggregate_export_with_attribution_and_small_cell_suppression_only",
  "user_confirms_no_reidentification_attempt",
  "user_confirms_no_third_party_transfer",
  "user_confirms_no_product_claims_from_nshap_results",
] as const;

type ConfirmationField = typeof CONFIRMATION_FIELDS[number];

export interface R1027NshapSourceConfirmationScaffoldOptions {
  confirmationPath?: string;
  createdAt?: string;
  outputDir?: string;
  overwrite?: boolean;
}

export interface R1027NshapSourceConfirmationScaffoldOutput {
  artifactBoundary: {
    aggregateOnly: true;
    archiveBasenamesStored: false;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowParsingPerformedByR1027: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  confirmationScaffold: {
    confirmationArtifact: "nshap-public-use-confirmation.local.json";
    existingConfirmationPreserved: boolean;
    falseFieldCountBand: "0" | "1-9" | "10+";
    requiredFieldCountBand: "10+";
    schemaVersion: "murph.age.local.nshap-public-use-confirmation.v0";
    status: "created_false_by_default" | "existing_confirmation_preserved";
    trueFieldCountBand: "0" | "1-9" | "10+";
    userActionRequired: "review_source_terms_and_set_each_field_true_only_if_accurate";
  };
  createdAt: string;
  packetId: "r1027-nshap-source-confirmation-scaffold";
  schemaVersion: typeof R1027_NSHAP_SOURCE_CONFIRMATION_SCAFFOLD_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "nshap_confirmation_template_created_blocking_by_default"
      | "nshap_confirmation_template_preserved_existing_file";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1027: false;
    sourceConfirmationUnlocked: false;
  };
}

type LocalConfirmationTemplate = Record<ConfirmationField, boolean> & {
  schema_version: "murph.age.local.nshap-public-use-confirmation.v0";
};

export async function runR1027NshapSourceConfirmationScaffold(
  options: R1027NshapSourceConfirmationScaffoldOptions = {},
): Promise<{ output: R1027NshapSourceConfirmationScaffoldOutput; outputPath: string }> {
  const confirmationPath = options.confirmationPath ?? DEFAULT_CONFIRMATION_PATH;
  const exists = await fileExists(confirmationPath);
  const shouldWrite = !exists || options.overwrite === true;
  let template = falseTemplate();
  if (shouldWrite) {
    await mkdir(path.dirname(confirmationPath), { recursive: true });
    await writeFile(confirmationPath, `${JSON.stringify(template, null, 2)}\n`);
  } else {
    template = await readExistingConfirmationShape(confirmationPath);
  }

  const trueFieldCount = CONFIRMATION_FIELDS.filter((field) => template[field] === true).length;
  const falseFieldCount = CONFIRMATION_FIELDS.length - trueFieldCount;
  const output: R1027NshapSourceConfirmationScaffoldOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      archiveBasenamesStored: false,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformedByR1027: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    confirmationScaffold: {
      confirmationArtifact: "nshap-public-use-confirmation.local.json",
      existingConfirmationPreserved: exists && options.overwrite !== true,
      falseFieldCountBand: countBand(falseFieldCount),
      requiredFieldCountBand: "10+",
      schemaVersion: "murph.age.local.nshap-public-use-confirmation.v0",
      status: shouldWrite ? "created_false_by_default" : "existing_confirmation_preserved",
      trueFieldCountBand: countBand(trueFieldCount),
      userActionRequired: "review_source_terms_and_set_each_field_true_only_if_accurate",
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    packetId: "r1027-nshap-source-confirmation-scaffold",
    schemaVersion: R1027_NSHAP_SOURCE_CONFIRMATION_SCAFFOLD_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: shouldWrite
        ? "nshap_confirmation_template_created_blocking_by_default"
        : "nshap_confirmation_template_preserved_existing_file",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1027: false,
      sourceConfirmationUnlocked: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1027 NSHAP confirmation scaffold failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function falseTemplate(): LocalConfirmationTemplate {
  return {
    schema_version: "murph.age.local.nshap-public-use-confirmation.v0",
    user_confirms_aggregate_export_with_attribution_and_small_cell_suppression_only: false,
    user_confirms_aggregate_output_permission_clear: false,
    user_confirms_biomarker_overlap_clear: false,
    user_confirms_local_ignored_cache_only: false,
    user_confirms_mortality_or_followup_endpoint_available: false,
    user_confirms_no_product_claims_from_nshap_results: false,
    user_confirms_no_reidentification_attempt: false,
    user_confirms_no_rows_or_source_bodies_to_reviewgpt: false,
    user_confirms_no_third_party_transfer: false,
    user_confirms_terms_allow_local_research_rows: false,
    user_confirms_wave_linkage_policy_clear: false,
  };
}

async function readExistingConfirmationShape(filePath: string): Promise<LocalConfirmationTemplate> {
  try {
    const root = JSON.parse(await readFile(filePath, "utf8"));
    const template = falseTemplate();
    for (const field of CONFIRMATION_FIELDS) {
      template[field] = root?.[field] === true;
    }
    return template;
  } catch {
    return falseTemplate();
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function countBand(count: number): "0" | "1-9" | "10+" {
  if (count <= 0) return "0";
  if (count < 10) return "1-9";
  return "10+";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1027NshapSourceConfirmationScaffold({
    confirmationPath: process.env.MURPH_AGE_NSHAP_SOURCE_CONFIRMATION_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    overwrite: process.env.MURPH_AGE_OVERWRITE_NSHAP_CONFIRMATION_TEMPLATE === "true",
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      falseFieldCountBand: output.confirmationScaffold.falseFieldCountBand,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      rowParsingPerformedByR1027: output.summary.rowParsingPerformedByR1027,
      schemaVersion: output.schemaVersion,
      sourceConfirmationUnlocked: output.summary.sourceConfirmationUnlocked,
      status: output.status,
      trueFieldCountBand: output.confirmationScaffold.trueFieldCountBand,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    process.stdout.write(`${JSON.stringify({
      error: error instanceof Error ? error.message : "unknown R1027 failure",
      packetId: "r1027-nshap-source-confirmation-scaffold",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1027: false,
      sourceConfirmationUnlocked: false,
      status: "blocked",
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
