import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1047_BIOMARKER_EVIDENCE_STATE_SCHEMA_VERSION,
  runR1047BiomarkerEvidenceState,
} from "./r1047-biomarker-evidence-state.ts";

describe("R1047 biomarker evidence state", () => {
  it("reduces current glycemia/HbA1c aggregate evidence without product promotion", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1047-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1047BiomarkerEvidenceState({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1047-biomarker-evidence-state.latest.json");
      expect(output.schemaVersion).toBe(R1047_BIOMARKER_EVIDENCE_STATE_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.summary).toEqual({
        currentBloodworkLead: "glucose_hba1c_research_candidate",
        modelUse: "research_only_no_product_display",
        nextAutoresearchStep: "diagnose_mixed_hba1c_controls_before_any_more_promotion_talk",
        reviewGptUse: "major_scientific_result_review_after_next_meaningful_delta",
      });
      expect(output.candidateFamilies.bloodwork.glucoseHba1c).toMatchObject({
        nextLocalLoop: "diagnose_mixed_hba1c_controls_before_any_more_promotion_talk",
        productPromotionAuthorized: false,
        status: "active_research_candidate_mixed_external_support",
        supportCounts: {
          cleanSupport: 2,
          mixedSupport: 1,
          negativeOrMissing: 2,
        },
      });
      expect(output.candidateFamilies.bloodwork.glucoseHba1c.evidence.haalsi.verdict).toBe("supports");
      expect(output.candidateFamilies.bloodwork.glucoseHba1c.evidence.nshap.verdict).toBe("mixed");
      expect(output.candidateFamilies.wearableAdjacent.objectiveActivity.status)
        .toBe("nhanes_objective_activity_bridge_not_consumer_wearable_validation");
      expect(output.candidateFamilies.wearableAdjacent.pulsePhysiology.status).toBe("shadow_only");
      expect(output.artifactBoundary.productDisplayAuthorized).toBe(false);
      expect(output.artifactBoundary.productPromotionAuthorized).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"sourceText\"");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks unsafe aggregate inputs before reducing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1047-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r1044Path, {
        ...r1044Fixture(),
        sourceText: "not allowed",
      });

      await expect(runR1047BiomarkerEvidenceState(paths)).rejects.toThrow(
        "R1047 input r1044HaalsiExternalBiomarker failed aggregate boundary validation",
      );
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo unsafe decision strings from aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1047-strings-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r1044Path, {
        ...r1044Fixture(),
        decision: {
          conclusion: `${tmp}/source-body-fragment`,
          controlVerdict: `${tmp}/control-fragment`,
          productDisplayAuthorized: false,
          productPromotionAuthorized: false,
        },
      });

      const { output, outputPath } = await runR1047BiomarkerEvidenceState(paths);
      const persisted = await readFile(outputPath, "utf8");

      expect(output.candidateFamilies.bloodwork.glucoseHba1c.evidence.haalsi.verdict).toBe("does_not_support");
      expect(output.candidateFamilies.bloodwork.glucoseHba1c.evidence.haalsi.why)
        .toBe("Aggregate decision does not support the biomarker candidate. Control status is unknown from the aggregate artifact.");
      expect(persisted).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo unsafe packet or schema metadata from aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1047-metadata-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r1044Path, {
        ...r1044Fixture(),
        packetId: `${tmp}/packet`,
        schemaVersion: `${tmp}/schema`,
      });

      const { output, outputPath } = await runR1047BiomarkerEvidenceState(paths);
      const persisted = await readFile(outputPath, "utf8");

      expect(output.inputArtifacts.r1044HaalsiExternalBiomarker).toEqual({
        artifact: "r1044-haalsi-external-biomarker-loop.latest.json",
        packetId: null,
        schemaVersion: null,
        status: "available",
      });
      expect(persisted).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not call the bloodwork candidate externally active from NHANES-only support", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1047-nhanes-only-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await Promise.all([
        writeJson(paths.r1041Path, r1041Fixture()),
        writeJson(paths.r1043Path, r1043Fixture()),
        writeJson(paths.r1044Path, decisionFixture(
          "r1044-haalsi-external-biomarker-loop",
          "murph-age-r1044-haalsi-external-biomarker-loop.v1",
          "haalsi_biomarker_signal_not_supported",
          "negative_controls_compete_with_glucose",
        )),
        writeJson(paths.r1046Path, decisionFixture(
          "r1046-nshap-hba1c-replication-loop",
          "murph-age-r1046-nshap-hba1c-replication-loop.v1",
          "nshap_hba1c_replication_not_supported",
          "negative_controls_compete_with_hba1c",
        )),
      ]);

      const { output } = await runR1047BiomarkerEvidenceState(paths);

      expect(output.candidateFamilies.bloodwork.glucoseHba1c.evidence.nhanesLabBridge.verdict).toBe("supports");
      expect(output.summary.currentBloodworkLead).toBe("none");
      expect(output.candidateFamilies.bloodwork.glucoseHba1c.status).toBe("shadow_only_until_external_support");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1047-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1047-biomarker-evidence-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1038_NHANES_LAB_ACTIVITY_PATH: paths.r1038Path,
          MURPH_AGE_R1041_GLYCEMIA_TRANSPORT_PATH: paths.r1041Path,
          MURPH_AGE_R1043_MIDUS_STABILITY_PATH: paths.r1043Path,
          MURPH_AGE_R1044_HAALSI_PATH: paths.r1044Path,
          MURPH_AGE_R1046_NSHAP_PATH: paths.r1046Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r1047-biomarker-evidence-state.latest.json",
        currentBloodworkLead: "glucose_hba1c_research_candidate",
        glucoseHba1cStatus: "active_research_candidate_mixed_external_support",
        nextAutoresearchStep: "diagnose_mixed_hba1c_controls_before_any_more_promotion_talk",
        packetId: "r1047-biomarker-evidence-state",
        productDisplayAuthorized: false,
        schemaVersion: R1047_BIOMARKER_EVIDENCE_STATE_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        supportCounts: {
          cleanSupport: 2,
          mixedSupport: 1,
          negativeOrMissing: 2,
        },
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  outputDir: string;
  r1038Path: string;
  r1041Path: string;
  r1043Path: string;
  r1044Path: string;
  r1046Path: string;
}> {
  const outputDir = path.join(tmp, "out");
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r1038Path: path.join(tmp, "r1038.json"),
    r1041Path: path.join(tmp, "r1041.json"),
    r1043Path: path.join(tmp, "r1043.json"),
    r1044Path: path.join(tmp, "r1044.json"),
    r1046Path: path.join(tmp, "r1046.json"),
  };
  await Promise.all([
    writeJson(paths.r1038Path, r1038Fixture()),
    writeJson(paths.r1041Path, r1041Fixture()),
    writeJson(paths.r1043Path, r1043Fixture()),
    writeJson(paths.r1044Path, r1044Fixture()),
    writeJson(paths.r1046Path, r1046Fixture()),
  ]);
  return paths;
}

function r1038Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: boundaryFixture(),
    candidateMetrics: [
      {
        brierDelta: -0.0064,
        candidateId: "C3_lab9_hba1c_bp_body_primary",
        logLossDelta: -0.0313,
      },
      {
        brierDelta: -0.0048,
        candidateId: "C8_lab9_hba1c_bp_body_activity_primary",
        logLossDelta: -0.0137,
        negativeControlStatus: "beaten",
      },
    ],
    packetId: "r1038-nhanes-modern-lab-activity-calibrated-receipt",
    schemaVersion: "murph-age-r1038-r1034-compatible-calibrated-aggregate-receipt.v1",
  };
}

function r1041Fixture(): Record<string, unknown> {
  return decisionFixture(
    "r1041-minimal-glycemia-transport-loop",
    "murph-age-r1041-minimal-glycemia-transport-loop.v1",
    "minimal_glycemia_transport_not_confirmed",
    "negative_controls_compete_with_glycemia",
  );
}

function r1043Fixture(): Record<string, unknown> {
  return decisionFixture(
    "r1043-midus-family-glycemia-stability-loop",
    "murph-age-r1043-midus-family-glycemia-stability-loop.v1",
    "same_family_glycemia_stability_not_confirmed",
    "negative_controls_compete_with_glycemia",
  );
}

function r1044Fixture(): Record<string, unknown> {
  return decisionFixture(
    "r1044-haalsi-external-biomarker-loop",
    "murph-age-r1044-haalsi-external-biomarker-loop.v1",
    "haalsi_glucose_biomarker_signal_supported",
    "negative_controls_clean",
  );
}

function r1046Fixture(): Record<string, unknown> {
  return decisionFixture(
    "r1046-nshap-hba1c-replication-loop",
    "murph-age-r1046-nshap-hba1c-replication-loop.v1",
    "nshap_hba1c_replication_partial",
    "negative_controls_compete_with_hba1c",
  );
}

function decisionFixture(
  packetId: string,
  schemaVersion: string,
  conclusion: string,
  controlVerdict: string,
): Record<string, unknown> {
  return {
    artifactBoundary: boundaryFixture(),
    decision: {
      conclusion,
      controlVerdict,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
    },
    packetId,
    schemaVersion,
    status: "research-local-aggregate-only",
  };
}

function boundaryFixture(): Record<string, false | true> {
  return {
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
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
