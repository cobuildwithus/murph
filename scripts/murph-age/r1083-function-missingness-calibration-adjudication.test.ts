import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1083_FUNCTION_MISSINGNESS_CALIBRATION_ADJUDICATION_SCHEMA_VERSION,
  runR1083FunctionMissingnessCalibrationAdjudication,
} from "./r1083-function-missingness-calibration-adjudication.ts";

describe("R1083 function missingness/calibration adjudication", () => {
  it("blocks cleanly when the function aggregate packet is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1083-missing-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { aggregatePacket: null });
      const { output, outputPath } = await runR1083FunctionMissingnessCalibrationAdjudication({
        createdAt: "2026-05-15T14:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1083-function-missingness-calibration-adjudication.latest.json");
      expect(output.schemaVersion).toBe(R1083_FUNCTION_MISSINGNESS_CALIBRATION_ADJUDICATION_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "function_adjudication_blocked_missing_aggregate",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1083: false,
      });
      expect(output.decision).toMatchObject({
        action: "blocked_missing_or_invalid_aggregate",
        nextLocalAction: "await_valid_function_transport_aggregate",
        reviewGptRequiredNow: false,
      });
      expect(output.decision.blockerLabels).toEqual(["fresh_function_aggregate_missing"]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".zip");
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain("source_archive_");
      expect(persisted).not.toContain("\"predictions\":");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes the current function lead into missingness/calibration adjudication", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1083-adjudicate-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, {
        aggregatePacket: aggregatePacketFixture({
          calibration_non_worse: false,
          function_beats_missingness_control: false,
        }),
      });
      const { output } = await runR1083FunctionMissingnessCalibrationAdjudication({
        createdAt: "2026-05-15T14:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("function_content_adjudication_needed");
      expect(output.decision).toMatchObject({
        action: "run_function_missingness_calibration_adjudication",
        nextLocalAction: "run_ordered_function_missingness_calibration_loop",
        reviewGptRequiredNow: false,
      });
      expect(output.decision.blockerLabels).toContain("calibration_worse_or_unknown");
      expect(output.decision.blockerLabels).toContain("missingness_control_not_beaten");
      expect(output.nextLoop.comparisonOrder).toEqual([
        "frozen_anchor_only",
        "anchor_plus_function_missingness_only_control",
        "anchor_plus_shuffled_function_control",
        "anchor_plus_function_content_sidecar",
        "anchor_plus_function_content_missingness_adjudicated",
        "anchor_plus_function_plus_cognition_shadow",
        "compact_labs_glycemia_shadow_optional",
      ]);
      expect(output.nextLoop.mustPassLabels).toContain("function_beats_missingness_control");
      expect(output.nextLoop.mustPassLabels).toContain("calibration_non_worse");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps the function lead research-only when calibration and controls all pass", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1083-keep-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, {
        aggregatePacket: aggregatePacketFixture({}),
      });
      const { output } = await runR1083FunctionMissingnessCalibrationAdjudication({
        createdAt: "2026-05-15T14:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("function_lead_kept_research_only");
      expect(output.decision).toMatchObject({
        action: "keep_lead_and_seek_fresh_source",
        nextLocalAction: "seek_fresh_function_source_or_true_wearable_validation",
      });
      expect(output.decision.blockerLabels).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds or demotes the family when core support fails", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1083-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, {
        aggregatePacket: aggregatePacketFixture({
          function_beats_shuffled_control: false,
          meaningful_aggregate_delta: false,
          proper_scores_improve: false,
        }),
      });
      const { output } = await runR1083FunctionMissingnessCalibrationAdjudication({
        createdAt: "2026-05-15T14:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("function_sidecar_held_or_demoted");
      expect(output.decision.action).toBe("hold_or_demote_function_sidecar");
      expect(output.decision.nextLocalAction).toBe("hold_function_family_and_redirect_next_source");
      expect(output.decision.blockerLabels).toContain("proper_scores_not_confirmed");
      expect(output.decision.blockerLabels).toContain("shuffled_control_not_beaten");
      expect(output.decision.blockerLabels).toContain("meaningful_delta_not_confirmed");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe aggregate input boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1083-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, {
        aggregatePacket: {
          ...aggregatePacketFixture({}),
          predictionsStored: true,
        },
      });

      await expect(runR1083FunctionMissingnessCalibrationAdjudication(paths)).rejects.toThrow(
        "R1083 aggregatePacket failed aggregate boundary validation",
      );
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1083-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, {
        aggregatePacket: aggregatePacketFixture({
          calibration_non_worse: false,
          function_beats_missingness_control: false,
        }),
      });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1083-function-missingness-calibration-adjudication.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1025_FUNCTION_TRANSPORT_AGGREGATE_PACKET_PATH: paths.aggregatePacketPath,
          MURPH_AGE_R1025_FUNCTION_TRANSPORT_REDUCER_PATH: paths.reducerPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "function_content_adjudication_needed",
        decision: "run_function_missingness_calibration_adjudication",
        nextLocalAction: "run_ordered_function_missingness_calibration_loop",
        packetId: "r1083-function-missingness-calibration-adjudication",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1083: false,
        schemaVersion: R1083_FUNCTION_MISSINGNESS_CALIBRATION_ADJUDICATION_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain(".latest.json");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { aggregatePacket: Record<string, unknown> | null },
): Promise<{
  aggregatePacketPath: string;
  outputDir: string;
  reducerPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    aggregatePacketPath: path.join(fixtureDir, "aggregate.json"),
    outputDir,
    reducerPath: path.join(fixtureDir, "reducer.json"),
  };
  if (options.aggregatePacket === null) {
    paths.aggregatePacketPath = path.join(fixtureDir, "missing-aggregate.json");
  } else {
    await writeJson(paths.aggregatePacketPath, options.aggregatePacket);
  }
  await writeJson(paths.reducerPath, reducerFixture());
  return paths;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function safeBoundary(): Record<string, unknown> {
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

function reducerFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    decision: {
      action: "send_reviewgpt_aggregate_delta",
      allowedEffect: "candidate_memory_only",
      productDisplayAuthorized: false,
      reviewGptRequired: true,
    },
    packetId: "r1025-function-transport-result-reducer",
    schemaVersion: "murph-age-r1025-function-transport-result-reducer.v1",
    status: "research-local-aggregate-only",
  };
}

function aggregatePacketFixture(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary(),
      rowParsingPerformedByPrivateAdapter: true,
    },
    decision_inputs: {
      abstention_acceptable: true,
      aggregate_verdict: "supports_generalization",
      calibration_non_worse: true,
      cognition_dominates_function: false,
      contradicts_prior_function_evidence: false,
      function_beats_missingness_control: true,
      function_beats_shuffled_control: true,
      meaningful_aggregate_delta: true,
      proper_scores_improve: true,
      same_denominator_valid: true,
      suppression_passed: true,
      ...overrides,
    },
    metric_deltas: {
      anchor_plus_function_sidecar_vs_frozen_anchor: {
        auc_delta: 0.04,
        brier_delta: -0.02,
        log_loss_delta: null,
      },
      function_sidecar_vs_missingness_only_reference: {
        auc_delta: null,
        brier_delta: null,
        log_loss_delta: null,
      },
      function_sidecar_vs_shuffled_function_control: {
        auc_delta: 0.03,
        brier_delta: -0.006,
        log_loss_delta: null,
      },
    },
    packetId: "r1025-function-transport-aggregate-packet",
    schemaVersion: "murph-age-r1025-function-transport-aggregate-packet.v0",
    status: "research-local-aggregate-only",
  };
}
