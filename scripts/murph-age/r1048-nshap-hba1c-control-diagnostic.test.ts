import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1048_NSHAP_HBA1C_CONTROL_DIAGNOSTIC_SCHEMA_VERSION,
  runR1048NshapHba1cControlDiagnostic,
} from "./r1048-nshap-hba1c-control-diagnostic.ts";

describe("R1048 NSHAP HbA1c control diagnostic", () => {
  it("diagnoses partial NSHAP HbA1c support when one source has competing controls", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1048-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1048NshapHba1cControlDiagnostic({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1048-nshap-hba1c-control-diagnostic.latest.json");
      expect(output.schemaVersion).toBe(R1048_NSHAP_HBA1C_CONTROL_DIAGNOSTIC_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.decision).toEqual({
        conclusion: "nshap_hba1c_signal_partial_control_limited",
        nextAction: "keep_nshap_partial_and_seek_new_external_source",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rationale: "At least one aggregate NSHAP source separates HbA1c, but another source has competing controls.",
        reviewGptRequiredBeforeNextLocalRun: false,
      });
      expect(output.sourceDiagnostics.nshap_w1_to_w3?.status).toBe("clean_hba1c_separation");
      expect(output.sourceDiagnostics.nshap_w2_to_w3?.status).toBe("control_competition");
      expect(output.sourceDiagnostics.nshap_w2_to_w3?.bestNegativeControl?.candidateId).toBe("NC2_body_only_without_hba1c");
      expect(output.sourceDiagnostics.nshap_w2_to_w3?.logLossSeparationFromBestControl).toBeCloseTo(0.0003, 5);
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

  it("blocks unsafe R1046 aggregate input", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1048-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r1046Path, {
        ...r1046Fixture(),
        rowValues: [{ notAllowed: true }],
      });

      await expect(runR1048NshapHba1cControlDiagnostic(paths)).rejects.toThrow(
        "R1048 input R1046 failed aggregate boundary validation",
      );
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("ignores unsafe source and candidate keys instead of echoing them", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1048-keys-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const fixture = r1046Fixture();
      await writeJson(paths.r1046Path, {
        ...fixture,
        packetId: `${tmp}/packet`,
        schemaVersion: `${tmp}/schema`,
        sources: {
          ...(fixture.sources as Record<string, unknown>),
          [`${tmp}/source-key`]: {
            models: {
              [`${tmp}/candidate-key`]: model("negative_control", "beats_age_sex", -1, -1),
            },
          },
          nshap_w1_to_w3: {
            models: {
              ...((fixture.sources as Record<string, { models: Record<string, unknown> }>).nshap_w1_to_w3.models),
              [`${tmp}/candidate-key`]: model("negative_control", "beats_age_sex", -1, -1),
            },
          },
        },
      });

      const { output, outputPath } = await runR1048NshapHba1cControlDiagnostic(paths);
      const persisted = await readFile(outputPath, "utf8");

      expect(Object.keys(output.sourceDiagnostics)).toEqual(["nshap_w1_to_w3", "nshap_w2_to_w3"]);
      expect(output.inputArtifact.packetId).toBeNull();
      expect(output.inputArtifact.schemaVersion).toBeNull();
      expect(persisted).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1048-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1048-nshap-hba1c-control-diagnostic.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1046_NSHAP_PATH: paths.r1046Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r1048-nshap-hba1c-control-diagnostic.latest.json",
        conclusion: "nshap_hba1c_signal_partial_control_limited",
        nextAction: "keep_nshap_partial_and_seek_new_external_source",
        packetId: "r1048-nshap-hba1c-control-diagnostic",
        productDisplayAuthorized: false,
        schemaVersion: R1048_NSHAP_HBA1C_CONTROL_DIAGNOSTIC_SCHEMA_VERSION,
        sourceStatuses: {
          nshap_w1_to_w3: "clean_hba1c_separation",
          nshap_w2_to_w3: "control_competition",
        },
        status: "research-local-aggregate-only",
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
  r1046Path: string;
}> {
  const outputDir = path.join(tmp, "out");
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r1046Path: path.join(tmp, "r1046.json"),
  };
  await writeJson(paths.r1046Path, r1046Fixture());
  return paths;
}

function r1046Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: boundaryFixture(),
    decision: {
      conclusion: "nshap_hba1c_replication_partial",
      controlVerdict: "negative_controls_compete_with_hba1c",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
    },
    packetId: "r1046-nshap-hba1c-replication-loop",
    schemaVersion: "murph-age-r1046-nshap-hba1c-replication-loop.v1",
    sources: {
      nshap_w1_to_w3: {
        models: {
          A1_hba1c: model("score_bearing_candidate", "beats_age_sex", -0.00091, -0.00207),
          NC2_body_only_without_hba1c: model("negative_control", "does_not_beat_age_sex", 0.00052, 0.0017),
          NC5_noise_feature: model("negative_control", "does_not_beat_age_sex", 0.00003, 0.00019),
        },
      },
      nshap_w2_to_w3: {
        models: {
          A1_hba1c: model("score_bearing_candidate", "beats_age_sex", -0.00047, -0.00178),
          NC2_body_only_without_hba1c: model("negative_control", "beats_age_sex", -0.00055, -0.00208),
          NC5_noise_feature: model("negative_control", "beats_age_sex", -0.00017, -0.00016),
        },
      },
    },
    status: "research-local-aggregate-only",
  };
}

function model(
  candidateRole: string,
  verdict: string,
  brierDelta: number,
  logLossDelta: number,
): Record<string, unknown> {
  return {
    candidateRole,
    deltasVsAgeSexReference: {
      brierDelta,
      logLossDelta,
    },
    verdict,
  };
}

function boundaryFixture(): Record<string, false | true> {
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
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
