import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1103ConsumerCandidateFamilyManifest } from "./r1103-consumer-candidate-family-manifest.ts";
import { runR1104ConsumerAggregateReceiptValidator } from "./r1104-consumer-aggregate-receipt-validator.ts";
import { runR1105ConsumerAggregateReceiptTemplate } from "./r1105-consumer-aggregate-receipt-template.ts";
import {
  R1106_CONSUMER_AGGREGATE_HANDOFF_BUNDLE_SCHEMA_VERSION,
  runR1106ConsumerAggregateHandoffBundle,
} from "./r1106-consumer-aggregate-handoff-bundle.ts";

describe("R1106 consumer aggregate handoff bundle", () => {
  it("packages the fixed consumer lab/wearable aggregate handoff without row egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1106-"));
    try {
      const paths = await buildReadyInputs(tmp);

      const { output, outputPath } = await runR1106ConsumerAggregateHandoffBundle({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1106-consumer-aggregate-handoff-bundle.latest.json");
      expect(output.schemaVersion).toBe(R1106_CONSUMER_AGGREGATE_HANDOFF_BUNDLE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        candidateResultCount: 7,
        conclusion: "consumer_aggregate_handoff_ready",
        nextAction: "run_or_request_outcome_linked_consumer_aggregate_receipt",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1106: false,
      });
      expect(output.handoff.requiredReceiptSchemaVersion).toBe("murph-age-consumer-lab-wearable-aggregate-receipt.v1");
      expect(output.handoff.requiredEvaluatorId).toBe("consumer_lab_wearable_aggregate_evaluator_v1");
      expect(output.handoff.expectedReceiptArtifact).toBe("r1105-fillable-consumer-aggregate-receipt-template.json");
      expect(output.handoff.candidateResults.find((candidate) =>
        candidate.candidateId === "L1_tiny_glycemia_only"
      )).toMatchObject({
        candidateKind: "lab",
        priority: 1,
        status: "active_external_aggregate_validation",
      });
      expect(output.handoff.candidateResults.find((candidate) =>
        candidate.candidateId === "W1_activity_steps_minutes"
      )).toMatchObject({
        candidateKind: "wearable",
        priority: 3,
        status: "blocked_until_outcome_linked_aggregate_receipt",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits if the consumer candidate manifest is not ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1106-wait-"));
    try {
      const paths = await buildReadyInputs(tmp, { manifestReady: false });

      const { output } = await runR1106ConsumerAggregateHandoffBundle({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.conclusion).toBe("consumer_aggregate_handoff_waiting_on_manifest_or_template");
      expect(output.summary.nextAction).toBe("regenerate_r1103_r1105_before_handoff");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream artifacts before writing a handoff", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1106-unsafe-"));
    try {
      const paths = await buildReadyInputs(tmp);
      const unsafeR1105 = JSON.parse(await readFile(paths.r1105Path, "utf8")) as Record<string, unknown>;
      unsafeR1105.artifactBoundary = {
        ...(unsafeR1105.artifactBoundary as Record<string, unknown>),
        rowValuesStored: true,
      };
      await writeJson(paths.r1105Path, unsafeR1105);

      await expect(runR1106ConsumerAggregateHandoffBundle({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1106 rejected unsafe r1105 input");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1106-cli-"));
    try {
      const paths = await buildReadyInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1106-consumer-aggregate-handoff-bundle.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1103_CONSUMER_CANDIDATE_MANIFEST_PATH: paths.r1103Path,
          MURPH_AGE_R1104_CONSUMER_AGGREGATE_VALIDATOR_PATH: paths.r1104Path,
          MURPH_AGE_R1105_CONSUMER_AGGREGATE_TEMPLATE_PATH: paths.r1105Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "cli-out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        packetId: string;
        productDisplayAuthorized: boolean;
        reviewGptRequiredNow: boolean;
        rowParsingPerformedByR1106: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "consumer_aggregate_handoff_ready",
        packetId: "r1106-consumer-aggregate-handoff-bundle",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1106: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("SEQN");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function buildReadyInputs(
  tmp: string,
  options: { manifestReady?: boolean } = {},
): Promise<{ r1103Path: string; r1104Path: string; r1105Path: string }> {
  const sourcePaths = await writeR1103Inputs(tmp, options.manifestReady ?? true);
  const outputDir = path.join(tmp, "inputs");
  const [
    { outputPath: r1103Path },
    { outputPath: r1104Path },
    { outputPath: r1105Path },
  ] = await Promise.all([
    runR1103ConsumerCandidateFamilyManifest({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir,
      ...sourcePaths,
    }),
    runR1104ConsumerAggregateReceiptValidator({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir,
    }),
    runR1105ConsumerAggregateReceiptTemplate({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir,
    }),
  ]);
  return { r1103Path, r1104Path, r1105Path };
}

async function writeR1103Inputs(
  tmp: string,
  ready: boolean,
): Promise<{ r1101Path: string; r1102Path: string }> {
  const paths = {
    r1101Path: path.join(tmp, "r1101.json"),
    r1102Path: path.join(tmp, "r1102.json"),
  };
  await Promise.all([
    writeJson(paths.r1101Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1101-consumer-labs-wearables-loop-executor",
      schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
      summary: {
        conclusion: "consumer_loop_ready_awaiting_aggregate_receipt",
      },
    }),
    writeJson(paths.r1102Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1102-reviewgpt-consumer-direction-reducer",
      reviewGptJson: {
        next_model_loops: [
          {
            success_threshold: "delta_logLoss <= -0.0020 and delta_Brier <= -0.0005",
          },
          {
            success_threshold: "beat L1 and keep calibration stable",
          },
        ],
        wearable_policy: {
          score_bearing_unlock_condition: "Only after an outcome-linked aggregate receipt clears the wearable threshold.",
        },
      },
      schemaVersion: "murph-age-r1102-reviewgpt-consumer-direction-reducer.v1",
      summary: {
        conclusion: ready
          ? "reviewgpt_consumer_direction_reduced"
          : "reviewgpt_consumer_direction_missing_or_unusable",
      },
    }),
  ]);
  return paths;
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
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
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
