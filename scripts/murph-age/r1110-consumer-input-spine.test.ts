import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1110_CONSUMER_INPUT_SPINE_SCHEMA_VERSION,
  runR1110ConsumerInputSpine,
} from "./r1110-consumer-input-spine.ts";

describe("R1110 consumer input spine", () => {
  it("locks the next model spine onto average-user labs and wearables", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1110-"));
    try {
      const paths = await writeInputs(tmp, { ready: true });

      const { output, outputPath } = await runR1110ConsumerInputSpine({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1110-consumer-input-spine.latest.json");
      expect(output.schemaVersion).toBe(R1110_CONSUMER_INPUT_SPINE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "consumer_lab_wearable_spine_ready",
        nextAction: "collect_or_run_aggregate_receipt_then_validate_r1104",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1110: false,
        topPriority: "outcome_linked_aggregate_receipt_with_consumer_labs_and_wearables",
      });
      expect(output.consumerInputSpine.allowedFirstClassInputFamilies.map((family) => family.familyId)).toEqual([
        "bloodwork_common_labs",
        "vitals_body_composition",
        "wearable_activity",
        "wearable_sleep",
        "wearable_recovery",
      ]);
      expect(output.consumerInputSpine.allowedFirstClassInputFamilies.map((family) => family.priority)).toEqual([
        "p0_score_candidate",
        "p0_score_candidate",
        "p0_score_candidate_pending_receipt",
        "p0_score_candidate_pending_receipt",
        "p0_score_candidate_pending_receipt",
      ]);
      expect(output.consumerInputSpine.deprioritizedFamilies).toContainEqual({
        familyId: "function_mobility_context",
        policy: "supporting_context_only",
        reason: "Useful for attribution and older-adult transport, but less central than labs and wearables for average 16-50 Murph users.",
      });
      expect(output.executionPlan.strictRunOrder.map((step) => step.candidateId)).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "QC_missingness_coverage",
        "W1_activity_steps_minutes",
        "W2_sleep_duration_regularity",
        "W3_rhr_hrv_recovery",
        "I1_integrated_lab_wearable_small_panel",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for upstream artifacts before marking the spine ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1110-wait-"));
    try {
      const paths = await writeInputs(tmp, { ready: false });

      const { output } = await runR1110ConsumerInputSpine({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.conclusion).toBe("waiting_on_upstream_consumer_artifacts");
      expect(output.summary.nextAction).toBe("regenerate_r1090_r1103_r1109_before_consumer_spine");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when upstream artifact identity does not match the expected packet and schema", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1110-identity-"));
    try {
      const paths = await writeInputs(tmp, { ready: true });
      await writeJson(paths.r1103Path, {
        artifactBoundary: safeBoundary(),
        packetId: "r1103-consumer-candidate-family-manifest",
        schemaVersion: "murph-age-r1103-consumer-candidate-family-manifest.future",
        summary: {
          conclusion: "consumer_candidate_family_manifest_ready",
        },
      });

      const { output } = await runR1110ConsumerInputSpine({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.conclusion).toBe("waiting_on_upstream_consumer_artifacts");
      expect(output.inputArtifacts.r1103).toMatchObject({
        packetId: "r1103-consumer-candidate-family-manifest",
        schemaVersion: null,
        status: "available",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream artifacts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1110-unsafe-"));
    try {
      const paths = await writeInputs(tmp, { ready: true });
      await writeJson(paths.r1090Path, {
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
        packetId: "r1090-consumer-feature-registry-state",
        schemaVersion: "murph-age-r1090-consumer-feature-registry-state.v1",
      });

      await expect(runR1110ConsumerInputSpine({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1110 rejected unsafe r1090 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1110-cli-"));
    try {
      const paths = await writeInputs(tmp, { ready: true });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1110-consumer-input-spine.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1090_CONSUMER_FEATURE_REGISTRY_PATH: paths.r1090Path,
          MURPH_AGE_R1103_CONSUMER_CANDIDATE_MANIFEST_PATH: paths.r1103Path,
          MURPH_AGE_R1109_ALL_OF_US_HANDOFF_PATH: paths.r1109Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        firstClassFamilies: string[];
        productDisplayAuthorized: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "consumer_lab_wearable_spine_ready",
        firstClassFamilies: [
          "bloodwork_common_labs",
          "vitals_body_composition",
          "wearable_activity",
          "wearable_sleep",
          "wearable_recovery",
        ],
        productDisplayAuthorized: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string, input: { ready: boolean }): Promise<{
  r1090Path: string;
  r1103Path: string;
  r1109Path: string;
}> {
  const paths = {
    r1090Path: path.join(tmp, "r1090.json"),
    r1103Path: path.join(tmp, "r1103.json"),
    r1109Path: path.join(tmp, "r1109.json"),
  };
  await Promise.all([
    writeJson(paths.r1090Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1090-consumer-feature-registry-state",
      schemaVersion: "murph-age-r1090-consumer-feature-registry-state.v1",
      summary: {
        nextLocalAction: input.ready
          ? "use_registry_to_drive_labs_wearables_shadow_batch"
          : "repair_feature_registry",
      },
    }),
    writeJson(paths.r1103Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1103-consumer-candidate-family-manifest",
      schemaVersion: "murph-age-r1103-consumer-candidate-family-manifest.v1",
      summary: {
        conclusion: input.ready
          ? "consumer_candidate_family_manifest_ready"
          : "consumer_candidate_family_manifest_waiting_on_direction",
      },
    }),
    writeJson(paths.r1109Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1109-all-of-us-aggregate-handoff",
      schemaVersion: "murph-age-r1109-all-of-us-aggregate-handoff.v1",
      summary: {
        conclusion: input.ready
          ? "all_of_us_aggregate_handoff_ready"
          : "all_of_us_aggregate_handoff_waiting_on_router_or_template",
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
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
