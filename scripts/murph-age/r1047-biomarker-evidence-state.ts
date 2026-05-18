import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1047_BIOMARKER_EVIDENCE_STATE_SCHEMA_VERSION =
  "murph-age-r1047-biomarker-evidence-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1047-biomarker-evidence-state.latest.json";

type ArtifactKey =
  | "r1038NhanesLabActivity"
  | "r1041CrossSourceGlycemiaTransport"
  | "r1043MidusFamilyStability"
  | "r1044HaalsiExternalBiomarker"
  | "r1046NshapHba1cReplication";

type ArtifactStatus = "available" | "missing";
type ControlInterpretation = "controls_compete" | "controls_do_not_block" | "controls_unknown";
type EvidenceVerdict = "supports" | "mixed" | "does_not_support" | "missing";

const EXPECTED_INPUT_METADATA: Record<ArtifactKey, { packetIds: string[]; schemaVersions: string[] }> = {
  r1038NhanesLabActivity: {
    packetIds: ["r1038-nhanes-modern-lab-activity-calibrated-receipt"],
    schemaVersions: ["murph-age-r1038-r1034-compatible-calibrated-aggregate-receipt.v1"],
  },
  r1041CrossSourceGlycemiaTransport: {
    packetIds: ["r1041-minimal-glycemia-transport-loop"],
    schemaVersions: ["murph-age-r1041-minimal-glycemia-transport-loop.v1"],
  },
  r1043MidusFamilyStability: {
    packetIds: ["r1043-midus-family-glycemia-stability-loop"],
    schemaVersions: ["murph-age-r1043-midus-family-glycemia-stability-loop.v1"],
  },
  r1044HaalsiExternalBiomarker: {
    packetIds: ["r1044-haalsi-external-biomarker-loop"],
    schemaVersions: ["murph-age-r1044-haalsi-external-biomarker-loop.v1"],
  },
  r1046NshapHba1cReplication: {
    packetIds: ["r1046-nshap-hba1c-replication-loop"],
    schemaVersions: ["murph-age-r1046-nshap-hba1c-replication-loop.v1"],
  },
};

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

export interface R1047BiomarkerEvidenceStateOptions {
  createdAt?: string;
  outputDir?: string;
  r1038Path?: string;
  r1041Path?: string;
  r1043Path?: string;
  r1044Path?: string;
  r1046Path?: string;
}

interface EvidenceSummary {
  evidenceClass: string;
  inputArtifact: string;
  status: ArtifactStatus;
  verdict: EvidenceVerdict;
  why: string;
}

export interface R1047BiomarkerEvidenceStateOutput {
  artifactBoundary: {
    aggregateOnly: true;
    calibrationParametersStored: false;
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
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  candidateFamilies: {
    bloodwork: {
      broadLabLayer: {
        status: "nhanes_research_layer_only";
        why: string;
      };
      glucoseHba1c: {
        evidence: {
          haalsi: EvidenceSummary;
          midusCrelesTransport: EvidenceSummary;
          midusFamily: EvidenceSummary;
          nhanesLabBridge: EvidenceSummary;
          nshap: EvidenceSummary;
        };
        nextLocalLoop:
          | "seek_next_clean_external_glucose_hba1c_source"
          | "diagnose_mixed_hba1c_controls_before_any_more_promotion_talk";
        productPromotionAuthorized: false;
        status:
          | "active_research_candidate_mixed_external_support"
          | "shadow_only_until_external_support";
        supportCounts: {
          cleanSupport: number;
          mixedSupport: number;
          negativeOrMissing: number;
        };
      };
    };
    wearableAdjacent: {
      objectiveActivity: {
        status: "nhanes_objective_activity_bridge_not_consumer_wearable_validation";
        why: string;
      };
      pulsePhysiology: {
        status: "shadow_only";
        why: string;
      };
    };
  };
  createdAt: string;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  packetId: "r1047-biomarker-evidence-state";
  schemaVersion: typeof R1047_BIOMARKER_EVIDENCE_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    currentBloodworkLead: "glucose_hba1c_research_candidate" | "none";
    modelUse: "research_only_no_product_display";
    nextAutoresearchStep: string;
    reviewGptUse: "major_scientific_result_review_after_next_meaningful_delta";
  };
}

export async function runR1047BiomarkerEvidenceState(
  options: R1047BiomarkerEvidenceStateOptions = {},
): Promise<{ output: R1047BiomarkerEvidenceStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const nhanesLabBridge = summarizeNhanesLabBridge(inputs.r1038NhanesLabActivity);
  const midusCrelesTransport = summarizeDecisionArtifact(
    "r1041-minimal-glycemia-transport-loop.latest.json",
    "cross-source minimal cardiometabolic transport diagnostic",
    inputs.r1041CrossSourceGlycemiaTransport,
    "minimal_glycemia_transport_confirmed",
    "minimal_glycemia_transport_partial",
  );
  const midusFamily = summarizeDecisionArtifact(
    "r1043-midus-family-glycemia-stability-loop.latest.json",
    "same-family MIDUS glycemia stability diagnostic",
    inputs.r1043MidusFamilyStability,
    "same_family_glycemia_stability_confirmed",
    "same_family_glycemia_stability_partial",
  );
  const haalsi = summarizeDecisionArtifact(
    "r1044-haalsi-external-biomarker-loop.latest.json",
    "external non-NHANES glucose biomarker diagnostic",
    inputs.r1044HaalsiExternalBiomarker,
    "haalsi_glucose_biomarker_signal_supported",
    "haalsi_broad_biomarker_signal_not_specific",
  );
  const nshap = summarizeDecisionArtifact(
    "r1046-nshap-hba1c-replication-loop.latest.json",
    "non-NHANES independent HbA1c replication diagnostic",
    inputs.r1046NshapHba1cReplication,
    "nshap_hba1c_replication_supported",
    "nshap_hba1c_replication_partial",
  );

  const evidence = { haalsi, midusCrelesTransport, midusFamily, nhanesLabBridge, nshap };
  const supportCounts = countSupport(evidence);
  const externalSupportCounts = countSupport({ haalsi, midusCrelesTransport, midusFamily, nshap });
  const currentBloodworkLead = externalSupportCounts.cleanSupport > 0 || externalSupportCounts.mixedSupport > 0
    ? "glucose_hba1c_research_candidate"
    : "none";
  const glycemiaStatus = externalSupportCounts.cleanSupport > 0
    ? "active_research_candidate_mixed_external_support"
    : "shadow_only_until_external_support";
  const nextLocalLoop = supportCounts.mixedSupport > 0 || supportCounts.negativeOrMissing > 1
    ? "diagnose_mixed_hba1c_controls_before_any_more_promotion_talk"
    : "seek_next_clean_external_glucose_hba1c_source";

  const output: R1047BiomarkerEvidenceStateOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      calibrationParametersStored: false,
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
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    candidateFamilies: {
      bloodwork: {
        broadLabLayer: {
          status: "nhanes_research_layer_only",
          why: "NHANES lab/body/BP results support lab plumbing and same-family signal, but external biomarker evidence is not strong enough for product display.",
        },
        glucoseHba1c: {
          evidence,
          nextLocalLoop,
          productPromotionAuthorized: false,
          status: glycemiaStatus,
          supportCounts,
        },
      },
      wearableAdjacent: {
        objectiveActivity: {
          status: "nhanes_objective_activity_bridge_not_consumer_wearable_validation",
          why: summarizeActivityWhy(inputs.r1038NhanesLabActivity),
        },
        pulsePhysiology: {
          status: "shadow_only",
          why: "HAALSI/NSHAP pulse-style physiology can generate hypotheses, but it is not consumer wearable validation and cannot become score-bearing without same-denominator wearable controls.",
        },
      },
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1047-biomarker-evidence-state",
    schemaVersion: R1047_BIOMARKER_EVIDENCE_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      currentBloodworkLead,
      modelUse: "research_only_no_product_display",
      nextAutoresearchStep: nextLocalLoop,
      reviewGptUse: "major_scientific_result_review_after_next_meaningful_delta",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1047 biomarker evidence state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R1047BiomarkerEvidenceStateOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    r1038NhanesLabActivity: await readJsonIfPresent(
      options.r1038Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1038-r1034-compatible-calibrated-aggregate-receipt.latest.json"),
    ),
    r1041CrossSourceGlycemiaTransport: await readJsonIfPresent(
      options.r1041Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1041-minimal-glycemia-transport-loop.latest.json"),
    ),
    r1043MidusFamilyStability: await readJsonIfPresent(
      options.r1043Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1043-midus-family-glycemia-stability-loop.latest.json"),
    ),
    r1044HaalsiExternalBiomarker: await readJsonIfPresent(
      options.r1044Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1044-haalsi-external-biomarker-loop.latest.json"),
    ),
    r1046NshapHba1cReplication: await readJsonIfPresent(
      options.r1046Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1046-nshap-hba1c-replication-loop.latest.json"),
    ),
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (value === null) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1047 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeNhanesLabBridge(value: unknown | null): EvidenceSummary {
  const artifact = "r1038-r1034-compatible-calibrated-aggregate-receipt.latest.json";
  if (!value) {
    return missingEvidence(artifact, "NHANES lab/activity bridge");
  }
  const metrics = readArrayAt(value, ["candidateMetrics"]);
  const hba1cPrimary = metrics.find((metric) =>
    readStringAt(metric, ["candidateId"]) === "C3_lab9_hba1c_bp_body_primary"
  );
  const brierDelta = readNumberAt(hba1cPrimary, ["brierDelta"]);
  const logLossDelta = readNumberAt(hba1cPrimary, ["logLossDelta"]);
  const supports = typeof brierDelta === "number" && brierDelta < 0
    && typeof logLossDelta === "number" && logLossDelta < 0;
  return {
    evidenceClass: "same-family public lab/activity bridge",
    inputArtifact: artifact,
    status: "available",
    verdict: supports ? "supports" : "does_not_support",
    why: supports
      ? "NHANES lab9 HbA1c/body/BP primary candidate improves aggregate proper scores over the age/sex/body/BP comparator."
      : "NHANES lab bridge is present but the primary HbA1c lab candidate does not improve proper scores.",
  };
}

function summarizeDecisionArtifact(
  artifact: string,
  evidenceClass: string,
  value: unknown | null,
  supportConclusion: string,
  mixedConclusion: string,
): EvidenceSummary {
  if (!value) return missingEvidence(artifact, evidenceClass);
  const conclusion = readStringAt(value, ["decision", "conclusion"]);
  const controlVerdict = readStringAt(value, ["decision", "controlVerdict"]);
  const verdict: EvidenceVerdict = conclusion === supportConclusion
    ? "supports"
    : conclusion === mixedConclusion
      ? "mixed"
      : "does_not_support";
  return {
    evidenceClass,
    inputArtifact: artifact,
    status: "available",
    verdict,
    why: explainDecision(verdict, classifyControlVerdict(controlVerdict), conclusion === null),
  };
}

function explainDecision(
  verdict: EvidenceVerdict,
  controlInterpretation: ControlInterpretation,
  missingConclusion: boolean,
): string {
  if (missingConclusion) return "Decision conclusion missing or not recognized from aggregate artifact.";
  const verdictText = verdict === "supports"
    ? "Aggregate decision supports the biomarker candidate."
    : verdict === "mixed"
      ? "Aggregate decision is mixed for the biomarker candidate."
      : "Aggregate decision does not support the biomarker candidate.";
  if (controlInterpretation === "controls_compete") {
    return `${verdictText} Controls compete, so this is not clean promotable evidence.`;
  }
  if (controlInterpretation === "controls_do_not_block") {
    return `${verdictText} Controls do not block the aggregate interpretation.`;
  }
  return `${verdictText} Control status is unknown from the aggregate artifact.`;
}

function classifyControlVerdict(controlVerdict: string | null): ControlInterpretation {
  if (!controlVerdict) return "controls_unknown";
  if ([
    "negative_controls_compete_with_glucose",
    "negative_controls_compete_with_glycemia",
    "negative_controls_compete_with_hba1c",
  ].includes(controlVerdict)) {
    return "controls_compete";
  }
  if (["negative_controls_clean", "negative_controls_not_applicable"].includes(controlVerdict)) {
    return "controls_do_not_block";
  }
  return "controls_unknown";
}

function summarizeActivityWhy(value: unknown | null): string {
  if (!value) return "NHANES activity bridge aggregate artifact is missing.";
  const metrics = readArrayAt(value, ["candidateMetrics"]);
  const primary = metrics.find((metric) =>
    readStringAt(metric, ["candidateId"]) === "C8_lab9_hba1c_bp_body_activity_primary"
  );
  const brierDelta = readNumberAt(primary, ["brierDelta"]);
  const logLossDelta = readNumberAt(primary, ["logLossDelta"]);
  const controlStatus = readStringAt(primary, ["negativeControlStatus"]);
  if (typeof brierDelta === "number" && brierDelta < 0 && typeof logLossDelta === "number" && logLossDelta < 0) {
    return `NHANES objective activity improves aggregate proper scores over the lab/body/BP comparator; activity-control status is ${activityControlStatusLabel(controlStatus)}, and this remains objective-activity research evidence only.`;
  }
  return "NHANES objective activity bridge is available but does not yet support a score-bearing wearable increment.";
}

function activityControlStatusLabel(controlStatus: string | null): string {
  if (controlStatus === "beaten") return "beaten";
  if (controlStatus === "not_beaten") return "not beaten";
  if (controlStatus === "not_applicable") return "not applicable";
  return "unknown";
}

function countSupport(evidence: Record<string, EvidenceSummary>): {
  cleanSupport: number;
  mixedSupport: number;
  negativeOrMissing: number;
} {
  const values = Object.values(evidence);
  return {
    cleanSupport: values.filter((item) => item.verdict === "supports").length,
    mixedSupport: values.filter((item) => item.verdict === "mixed").length,
    negativeOrMissing: values.filter((item) => item.verdict === "does_not_support" || item.verdict === "missing").length,
  };
}

function missingEvidence(artifact: string, evidenceClass: string): EvidenceSummary {
  return {
    evidenceClass,
    inputArtifact: artifact,
    status: "missing",
    verdict: "missing",
    why: "Aggregate artifact missing; no inference made.",
  };
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    r1038NhanesLabActivity:
      summarizeArtifact(
        "r1038-r1034-compatible-calibrated-aggregate-receipt.latest.json",
        inputs.r1038NhanesLabActivity,
        EXPECTED_INPUT_METADATA.r1038NhanesLabActivity,
      ),
    r1041CrossSourceGlycemiaTransport:
      summarizeArtifact(
        "r1041-minimal-glycemia-transport-loop.latest.json",
        inputs.r1041CrossSourceGlycemiaTransport,
        EXPECTED_INPUT_METADATA.r1041CrossSourceGlycemiaTransport,
      ),
    r1043MidusFamilyStability:
      summarizeArtifact(
        "r1043-midus-family-glycemia-stability-loop.latest.json",
        inputs.r1043MidusFamilyStability,
        EXPECTED_INPUT_METADATA.r1043MidusFamilyStability,
      ),
    r1044HaalsiExternalBiomarker:
      summarizeArtifact(
        "r1044-haalsi-external-biomarker-loop.latest.json",
        inputs.r1044HaalsiExternalBiomarker,
        EXPECTED_INPUT_METADATA.r1044HaalsiExternalBiomarker,
      ),
    r1046NshapHba1cReplication:
      summarizeArtifact(
        "r1046-nshap-hba1c-replication-loop.latest.json",
        inputs.r1046NshapHba1cReplication,
        EXPECTED_INPUT_METADATA.r1046NshapHba1cReplication,
      ),
  };
}

function summarizeArtifact(
  artifact: string,
  value: unknown | null,
  expected: { packetIds: string[]; schemaVersions: string[] },
): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  const packetId = readStringAt(value, ["packetId"]) ?? readStringAt(value, ["manifestId"]) ?? readStringAt(value, ["schema_version"]);
  const schemaVersion = readStringAt(value, ["schemaVersion"]) ?? readStringAt(value, ["schema_version"]);
  return {
    artifact,
    packetId: packetId && expected.packetIds.includes(packetId) ? packetId : null,
    schemaVersion: schemaVersion && expected.schemaVersions.includes(schemaVersion) ? schemaVersion : null,
    status: "available",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("R1047 failed to read an aggregate input artifact.");
  }
}

function readArrayAt(value: unknown | null, keys: string[]): unknown[] {
  const found = readAt(value, keys);
  return Array.isArray(found) ? found : [];
}

function readNumberAt(value: unknown | null, keys: string[]): number | null {
  const found = readAt(value, keys);
  return typeof found === "number" && Number.isFinite(found) ? found : null;
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  const found = readAt(value, keys);
  return typeof found === "string" && found.length > 0 ? found : null;
}

function readAt(value: unknown | null, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function main(): Promise<void> {
  const { output } = await runR1047BiomarkerEvidenceState({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1038Path: process.env.MURPH_AGE_R1038_NHANES_LAB_ACTIVITY_PATH,
    r1041Path: process.env.MURPH_AGE_R1041_GLYCEMIA_TRANSPORT_PATH,
    r1043Path: process.env.MURPH_AGE_R1043_MIDUS_STABILITY_PATH,
    r1044Path: process.env.MURPH_AGE_R1044_HAALSI_PATH,
    r1046Path: process.env.MURPH_AGE_R1046_NSHAP_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    currentBloodworkLead: output.summary.currentBloodworkLead,
    glucoseHba1cStatus: output.candidateFamilies.bloodwork.glucoseHba1c.status,
    nextAutoresearchStep: output.summary.nextAutoresearchStep,
    packetId: output.packetId,
    productDisplayAuthorized: output.artifactBoundary.productDisplayAuthorized,
    schemaVersion: output.schemaVersion,
    status: output.status,
    supportCounts: output.candidateFamilies.bloodwork.glucoseHba1c.supportCounts,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R1047 biomarker evidence state failed.\n");
    process.exitCode = 1;
  });
}
