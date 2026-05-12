import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R603_TRANSPORT_READINESS_PACKET_SCHEMA_VERSION,
  runR603TransportReadinessPacket,
} from "./r603-transport-readiness-packet.ts";

describe("R603 transport readiness packet", () => {
  it("summarizes CRELES transport stress as aggregate-only metadata", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r603-transport-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR603TransportReadinessPacket({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r603-transport-readiness-packet.latest.json");
      expect(output.schemaVersion).toBe(R603_TRANSPORT_READINESS_PACKET_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        coefficientsStored: false,
        localPathsStored: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
        splitMembershipStored: false,
      });
      expect(output.r602Consensus).toEqual({
        strongestInternalCandidate: "bloodwork-plus-body-residual",
        transportStressRecommended: true,
      });
      expect(output.transport.crelesLocal.status).toBe("available");
      expect(output.transport.midusToCreles.status).toBe("available");
      if (output.transport.midusToCreles.status !== "available") throw new Error("expected transport");
      expect(output.transport.midusToCreles.countBands).toEqual({
        completeCaseRows: "1000+",
        eventCount: "100-499",
        testEventCount: "100-499",
        testRows: "1000+",
      });
      expect(output.transport.midusToCreles.models.map((model) => model.modelId)).toEqual([
        "midus2_lab5_source_raw",
        "midus2_lab5_source_creles_recalibrated",
        "creles_age_sex_reference",
      ]);
      expect(output.readiness.conclusion).toBe("transport_signal_not_confirmed");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("coefficients\":");
      expect(persisted).not.toContain("selectedPointIds");
      expect(persisted).not.toContain("\"events\":");
      expect(persisted).not.toContain("\"n\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless aggregate CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r603-transport-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r603-transport-readiness-packet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_CRELES_OUTPUT_PATH: paths.crelesPath,
          MURPH_AGE_MIDUS_CRELES_TRANSPORT_OUTPUT_PATH: paths.transportPath,
          MURPH_AGE_R602_PACKET_PATH: paths.r602Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual({
        artifact: "r603-transport-readiness-packet.latest.json",
        conclusion: "transport_signal_not_confirmed",
        packetId: "r603-creles-transport-readiness",
        productPromotionAuthorized: false,
        schemaVersion: R603_TRANSPORT_READINESS_PACKET_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("reports missing transport artifacts without unsafe fallback data", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r603-transport-missing-"));
    try {
      const { output } = await runR603TransportReadinessPacket({
        createdAt: "2026-05-12T00:00:00.000Z",
        crelesPath: path.join(tmp, "missing-creles.json"),
        outputDir: path.join(tmp, "out"),
        r602Path: path.join(tmp, "missing-r602.json"),
        transportPath: path.join(tmp, "missing-transport.json"),
      });

      expect(output.transport.crelesLocal).toEqual({
        reason: "missing_artifact",
        status: "missing",
      });
      expect(output.transport.midusToCreles).toEqual({
        reason: "missing_artifact",
        status: "missing",
      });
      expect(output.r602Consensus).toEqual({
        strongestInternalCandidate: null,
        transportStressRecommended: null,
      });
      expect(output.readiness.conclusion).toBe("transport_signal_not_confirmed");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  crelesPath: string;
  r602Path: string;
  transportPath: string;
}> {
  await mkdir(tmp, { recursive: true });
  const crelesPath = path.join(tmp, "creles.json");
  const transportPath = path.join(tmp, "transport.json");
  const r602Path = path.join(tmp, "r602.json");
  await Promise.all([
    writeJson(crelesPath, crelesArtifact()),
    writeJson(transportPath, transportArtifact()),
    writeJson(r602Path, {
      summary: {
        strongestInternalCandidate: "bloodwork-plus-body-residual",
      },
    }),
  ]);
  return { crelesPath, r602Path, transportPath };
}

function crelesArtifact() {
  return {
    benchmarkId: "creles-wave1-biomarker-wave3-mortality-status-local-0",
    codebookTextStored: false,
    coefficientsStored: false,
    dataShape: {
      eligibleRows: 2374,
      events: 523,
      splitCounts: {
        test: {
          events: 83,
          n: 467,
        },
      },
    },
    endpoint: "death by CRELES wave 3 among participants with known wave-3 status",
    models: {
      age_sex_reference: model({
        auc: 0.757075,
        brier: 0.129681,
        candidateRole: "reference",
        featureKeys: ["age", "male"],
        logLoss: 0.412860,
        meanPrediction: 0.224407,
        observedRate: 0.177730,
      }),
      glycemia_body_no_crp: model({
        auc: 0.762738,
        brier: 0.128096,
        candidateRole: "proposal",
        featureKeys: ["age", "male", "bmi", "hba1c"],
        logLoss: 0.408479,
        meanPrediction: 0.223393,
        observedRate: 0.177730,
      }),
    },
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    rowValuesStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

function transportArtifact() {
  return {
    benchmarkId: "midus2-lab5-to-creles-wave3-transport-local-0",
    calibrationParametersStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    endpointComparison: {
      mismatchPolicy: "transport-stress-only",
      productPromotionAuthorized: false,
    },
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    rowValuesStored: false,
    sourceBodiesStored: false,
    sourceModel: {
      featureKeys: ["age", "male", "bmi", "hba1c", "triglycerides", "hdl-c"],
    },
    splitMembershipStored: false,
    targetDataShape: {
      completeCaseRows: 2108,
      events: 419,
      splitCounts: {
        test: {
          events: 213,
          n: 1033,
        },
      },
    },
    transportModels: {
      midus2_lab5_source_raw: model({
        auc: 0.750641,
        brier: 0.142832,
        candidateRole: "source_model",
        featureKeys: ["age", "male", "bmi", "hba1c", "triglycerides", "hdl-c"],
        logLoss: 0.449010,
        meanPrediction: 0.272006,
        observedRate: 0.206196,
      }),
      midus2_lab5_source_creles_recalibrated: model({
        auc: 0.750641,
        brier: 0.136869,
        candidateRole: "target_calibrated_source_model",
        featureKeys: ["age", "male", "bmi", "hba1c", "triglycerides", "hdl-c"],
        logLoss: 0.435778,
        meanPrediction: 0.185495,
        observedRate: 0.206196,
      }),
      creles_age_sex_reference: model({
        auc: 0.753318,
        brier: 0.136428,
        candidateRole: "target_reference",
        featureKeys: ["age", "male"],
        logLoss: 0.434092,
        meanPrediction: 0.185792,
        observedRate: 0.206196,
      }),
    },
  };
}

function model(input: {
  auc: number;
  brier: number;
  candidateRole: string;
  featureKeys: string[];
  logLoss: number;
  meanPrediction: number;
  observedRate: number;
}) {
  return {
    candidateRole: input.candidateRole,
    featureKeys: input.featureKeys,
    splitMetrics: {
      test: {
        auc: input.auc,
        brier: input.brier,
        logLoss: input.logLoss,
        meanPrediction: input.meanPrediction,
        observedRate: input.observedRate,
      },
    },
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
