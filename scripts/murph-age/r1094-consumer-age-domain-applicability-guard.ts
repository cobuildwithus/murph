import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1094_CONSUMER_AGE_DOMAIN_APPLICABILITY_GUARD_SCHEMA_VERSION =
  "murph-age-r1094-consumer-age-domain-applicability-guard.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1094-consumer-age-domain-applicability-guard.latest.json";

const INPUTS = {
  r1038: {
    artifact: "r1038-nhanes-modern-lab-activity-loop.latest.json",
    packetId: "r1038-nhanes-modern-lab-activity-loop",
    schemaVersion: "murph-age-r1038-nhanes-modern-lab-activity-loop.v1",
  },
  r1044: {
    artifact: "r1044-haalsi-external-biomarker-loop.latest.json",
    packetId: "r1044-haalsi-external-biomarker-loop",
    schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
  },
  r1093: {
    artifact: "r1093-consumer-lab-shadow-candidate-selector.latest.json",
    packetId: "r1093-consumer-lab-shadow-candidate-selector",
    schemaVersion: "murph-age-r1093-consumer-lab-shadow-candidate-selector.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ApplicabilityRule {
  ruleId:
    | "abstain_from_user_age_display"
    | "mark_lab_candidate_shadow_only"
    | "prioritize_younger_or_all_age_validation"
    | "wearables_need_true_outcome_link";
  status: "blocking" | "required";
  why: string;
}

export interface R1094ConsumerAgeDomainApplicabilityGuardOptions {
  createdAt?: string;
  outputDir?: string;
  r1038Path?: string;
  r1044Path?: string;
  r1093Path?: string;
}

export interface R1094ConsumerAgeDomainApplicabilityGuardOutput {
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
    rowParsingPerformedByR1094: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  applicability: {
    currentShadowCandidate: "common_lab_core_shadow" | "none";
    requiredEvidenceSubbands: ["16_17", "18_39", "40_50"];
    targetData: [
      "common_bloodwork",
      "manual_or_device_vitals",
      "consumer_wearable_aggregates",
    ];
    targetUserAgeBand: "roughly_16_50";
    validationGap:
      | "candidate_sources_not_direct_young_adult_consumer_validation"
      | "candidate_not_selected";
    rules: ApplicabilityRule[];
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1094-consumer-age-domain-applicability-guard";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1094_CONSUMER_AGE_DOMAIN_APPLICABILITY_GUARD_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "common_lab_shadow_candidate_allowed_for_research_not_user_age"
      | "no_shadow_candidate_to_guard";
    nextLocalAction:
      | "seek_young_or_all_age_lab_wearable_external_validation"
      | "repair_consumer_lab_shadow_candidate_selection";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1094: false;
  };
}

export async function runR1094ConsumerAgeDomainApplicabilityGuard(
  options: R1094ConsumerAgeDomainApplicabilityGuardOptions = {},
): Promise<{ output: R1094ConsumerAgeDomainApplicabilityGuardOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const candidateSelected = readStringAt(inputs.r1093, ["selection", "candidateId"]) === "common_lab_core_shadow"
    && readBooleanAt(inputs.r1093, ["selection", "selectedForNextShadowRun"]) === true;
  const output: R1094ConsumerAgeDomainApplicabilityGuardOutput = {
    artifactBoundary: {
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
      rowParsingPerformedByR1094: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    applicability: {
      currentShadowCandidate: candidateSelected ? "common_lab_core_shadow" : "none",
      requiredEvidenceSubbands: ["16_17", "18_39", "40_50"],
      rules: buildRules(candidateSelected),
      targetData: [
        "common_bloodwork",
        "manual_or_device_vitals",
        "consumer_wearable_aggregates",
      ],
      targetUserAgeBand: "roughly_16_50",
      validationGap: candidateSelected
        ? "candidate_sources_not_direct_young_adult_consumer_validation"
        : "candidate_not_selected",
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1094-consumer-age-domain-applicability-guard",
    productDisplayAuthorized: false,
    schemaVersion: R1094_CONSUMER_AGE_DOMAIN_APPLICABILITY_GUARD_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: candidateSelected
        ? "common_lab_shadow_candidate_allowed_for_research_not_user_age"
        : "no_shadow_candidate_to_guard",
      nextLocalAction: candidateSelected
        ? "seek_young_or_all_age_lab_wearable_external_validation"
        : "repair_consumer_lab_shadow_candidate_selection",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1094: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1094 consumer age-domain applicability guard failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1094ConsumerAgeDomainApplicabilityGuardOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1038: await readJsonIfPresent(options.r1038Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1038.artifact)),
    r1044: await readJsonIfPresent(options.r1044Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1044.artifact)),
    r1093: await readJsonIfPresent(options.r1093Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1093.artifact)),
  };
}

function buildRules(candidateSelected: boolean): ApplicabilityRule[] {
  if (!candidateSelected) {
    return [
      {
        ruleId: "mark_lab_candidate_shadow_only",
        status: "blocking",
        why: "No consumer lab shadow candidate is selected, so there is nothing to carry into age-domain validation.",
      },
    ];
  }
  return [
    {
      ruleId: "mark_lab_candidate_shadow_only",
      status: "required",
      why: "The selected lab signal is useful for research, but the current evidence is not direct 16-50 consumer validation.",
    },
    {
      ruleId: "abstain_from_user_age_display",
      status: "blocking",
      why: "A user-facing age number requires validated risk-to-age mapping in a relevant reference population.",
    },
    {
      ruleId: "prioritize_younger_or_all_age_validation",
      status: "required",
      why: "The next validation source should better represent normal user-submittable data across young adult through midlife users.",
    },
    {
      ruleId: "wearables_need_true_outcome_link",
      status: "blocking",
      why: "Wearable activity, sleep, recovery, and HRV remain context-only until a true outcome-linked aggregate receipt lands.",
    },
  ];
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1094 rejected unsafe ${key} input: ${findings.join("; ")}`);
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

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function readBooleanAt(value: unknown | null, keys: readonly string[]): boolean | null {
  const found = readAt(value, keys);
  return typeof found === "boolean" ? found : null;
}

function readStringAt(value: unknown | null, keys: readonly string[]): string | null {
  const found = readAt(value, keys);
  return typeof found === "string" ? found : null;
}

function readAt(value: unknown | null, keys: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1094ConsumerAgeDomainApplicabilityGuard()
    .then(({ output }) => {
      process.stdout.write(`${JSON.stringify({
        conclusion: output.summary.conclusion,
        currentShadowCandidate: output.applicability.currentShadowCandidate,
        nextLocalAction: output.summary.nextLocalAction,
        packetId: output.packetId,
        productDisplayAuthorized: output.productDisplayAuthorized,
        rowParsingPerformedByR1094: output.summary.rowParsingPerformedByR1094,
        schemaVersion: output.schemaVersion,
        status: output.status,
        validationGap: output.applicability.validationGap,
      }, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "R1094 consumer age-domain applicability guard failed."}\n`);
      process.exitCode = 1;
    });
}
