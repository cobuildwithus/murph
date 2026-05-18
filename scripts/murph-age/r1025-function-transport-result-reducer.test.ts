import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1025_FUNCTION_TRANSPORT_RESULT_REDUCER_SCHEMA_VERSION,
  runR1025FunctionTransportResultReducer,
} from "./r1025-function-transport-result-reducer.ts";

describe("R1025 function transport result reducer", () => {
  it("blocks cleanly when no fresh aggregate packet exists", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1025-missing-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { aggregatePacket: null });
      const { output, outputPath } = await runR1025FunctionTransportResultReducer({
        createdAt: "2026-05-14T01:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1025-function-transport-result-reducer.latest.json");
      expect(output.schemaVersion).toBe(R1025_FUNCTION_TRANSPORT_RESULT_REDUCER_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "fresh_function_transport_result_missing",
        productDisplayAuthorized: false,
        reviewGptNextUse: "fresh_aggregate_delta_or_architecture_fork_only",
        rowParsingPerformedByR1025: false,
      });
      expect(output.decision).toMatchObject({
        action: "blocked_missing_fresh_aggregate",
        nextLocalAction: "await_fresh_private_aggregate_packet",
        reviewGptRequired: false,
      });
      expect(output.aggregateEvidence.freshAggregateAvailable).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain(".zip");
      expect(persisted).not.toContain(".rar");
      expect(persisted).not.toContain("ICPSR_");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"predictions\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps a research candidate when proper scores, calibration, controls, and suppression pass", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1025-keep-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, {
        aggregatePacket: aggregatePacketFixture({
          aggregate_verdict: "supports_generalization",
        }),
      });
      const { output } = await runR1025FunctionTransportResultReducer({
        createdAt: "2026-05-14T01:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("function_transport_candidate_kept_research_only");
      expect(output.decision).toMatchObject({
        action: "keep_research_candidate",
        nextLocalAction: "continue_next_locked_source_test",
        reviewGptRequired: false,
      });
      expect(output.decision.rationaleLabels).toEqual([
        "same_denominator_valid",
        "proper_scores_improve",
        "calibration_non_worse",
        "shuffled_control_beaten",
        "missingness_control_beaten",
        "abstention_acceptable",
        "suppression_passed",
      ]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("discards to negative memory when the aggregate evidence fails controls", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1025-discard-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, {
        aggregatePacket: aggregatePacketFixture({
          function_beats_missingness_control: false,
          function_beats_shuffled_control: false,
          proper_scores_improve: false,
          aggregate_verdict: "not_confirmed",
        }),
      });
      const { output } = await runR1025FunctionTransportResultReducer({
        createdAt: "2026-05-14T01:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("function_transport_candidate_discarded");
      expect(output.decision.action).toBe("discard_to_negative_memory");
      expect(output.decision.nextLocalAction).toBe("record_negative_result_and_hold_family");
      expect(output.decision.reviewGptRequired).toBe(false);
      expect(output.decision.rationaleLabels).toContain("proper_scores_not_confirmed");
      expect(output.decision.rationaleLabels).toContain("shuffled_control_not_beaten");
      expect(output.decision.rationaleLabels).toContain("missingness_control_not_beaten");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes meaningful aggregate deltas or architecture forks to ReviewGPT", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1025-review-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, {
        aggregatePacket: aggregatePacketFixture({
          cognition_dominates_function: true,
          meaningful_aggregate_delta: true,
        }),
      });
      const { output } = await runR1025FunctionTransportResultReducer({
        createdAt: "2026-05-14T01:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("function_transport_result_needs_reviewgpt");
      expect(output.decision).toMatchObject({
        action: "send_reviewgpt_aggregate_delta",
        nextLocalAction: "send_fresh_aggregate_delta_to_reviewgpt",
        reviewGptRequired: true,
      });
      expect(output.decision.rationaleLabels).toContain("meaningful_aggregate_delta");
      expect(output.decision.rationaleLabels).toContain("cognition_dominates_function");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1025-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, {
        aggregatePacket: {
          ...aggregatePacketFixture({}),
          predictionsStored: true,
        },
      });

      await expect(runR1025FunctionTransportResultReducer(paths)).rejects.toThrow(
        "R1025 aggregatePacket failed aggregate boundary validation",
      );
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1025-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { aggregatePacket: null });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1025-function-transport-result-reducer.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1023_FUNCTION_TRANSPORT_MANIFEST_PATH: paths.manifestPath,
          MURPH_AGE_R1025_FUNCTION_TRANSPORT_AGGREGATE_PACKET_PATH: paths.aggregatePacketPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "fresh_function_transport_result_missing",
        decision: "blocked_missing_fresh_aggregate",
        nextLocalAction: "await_fresh_private_aggregate_packet",
        packetId: "r1025-function-transport-result-reducer",
        productDisplayAuthorized: false,
        reviewGptRequired: false,
        rowParsingPerformedByR1025: false,
        schemaVersion: R1025_FUNCTION_TRANSPORT_RESULT_REDUCER_SCHEMA_VERSION,
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
  manifestPath: string;
  outputDir: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    aggregatePacketPath: path.join(fixtureDir, "aggregate.json"),
    manifestPath: path.join(fixtureDir, "manifest.json"),
    outputDir,
  };
  await writeJson(paths.manifestPath, manifestFixture());
  if (options.aggregatePacket === null) {
    paths.aggregatePacketPath = path.join(fixtureDir, "missing-aggregate.json");
  } else {
    await writeJson(paths.aggregatePacketPath, options.aggregatePacket);
  }
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

function manifestFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1023-function-transport-candidate-manifest",
    schemaVersion: "murph-age-r1023-function-transport-candidate-manifest.v1",
    summary: {
      conclusion: "function_transport_v1_manifest_ready_waiting_on_nshap_activation",
    },
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
      aggregate_verdict: "directional_only",
      calibration_non_worse: true,
      cognition_dominates_function: false,
      contradicts_prior_function_evidence: false,
      function_beats_missingness_control: true,
      function_beats_shuffled_control: true,
      meaningful_aggregate_delta: false,
      proper_scores_improve: true,
      same_denominator_valid: true,
      suppression_passed: true,
      ...overrides,
    },
    packetId: "r1025-function-transport-aggregate-packet",
    schemaVersion: "murph-age-r1025-function-transport-aggregate-packet.v0",
    status: "research-local-aggregate-only",
  };
}
