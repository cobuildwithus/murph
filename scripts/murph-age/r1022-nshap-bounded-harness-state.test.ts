import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1022_NSHAP_BOUNDED_HARNESS_STATE_SCHEMA_VERSION,
  runR1022NshapBoundedHarnessState,
} from "./r1022-nshap-bounded-harness-state.ts";

describe("R1022 NSHAP bounded harness state", () => {
  it("persists a bounded harness contract while activation labels still block rows", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1022-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1022NshapBoundedHarnessState({
        createdAt: "2026-05-13T23:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1022-nshap-bounded-harness-state.latest.json");
      expect(output.schemaVersion).toBe(R1022_NSHAP_BOUNDED_HARNESS_STATE_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "bounded_nshap_harness_contract_ready_but_activation_blocked",
        nextLocalAction: "wait_for_nshap_activation_then_prepare_row_adapter",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1022: false,
      });
      expect(output.harnessContract).toMatchObject({
        productDisplayAuthorized: false,
        scoringAuthorizedByR1022: false,
        status: "blocked_activation_labels_missing",
      });
      expect(output.nextActions.map((action) => [action.actionId, action.status, action.owner])).toEqual([
        ["complete_nshap_activation_labels", "blocked", "human_user"],
        ["prepare_row_adapter_after_activation", "blocked", "local_codex"],
        ["run_bounded_function_disability_falsification", "blocked", "local_codex"],
        ["run_cognition_shadow_only_after_function", "held", "local_codex"],
        ["send_reviewgpt_after_fresh_aggregate_delta", "held", "reviewgpt"],
      ]);
      expect(output.nextActions[0]?.blockedBy).toContain("missing_aggregate_output_permission_clear");
      expect(output.nextActions[1]?.blockedBy).toContain("missing_wave_linkage_policy_clear");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".latest.json");
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain(".zip");
      expect(persisted).not.toContain(".rar");
      expect(persisted).not.toContain("ICPSR_");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks the bounded harness runnable only after activation is complete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1022-ready-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { nshapReady: true });
      const { output } = await runR1022NshapBoundedHarnessState({
        createdAt: "2026-05-13T23:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("bounded_nshap_harness_ready_after_activation");
      expect(output.summary.nextLocalAction).toBe("prepare_bounded_nshap_row_adapter_no_product");
      expect(output.harnessContract.status).toBe("ready_after_activation_no_scoring");
      expect(output.nextActions[0]).toMatchObject({ blockedBy: [], status: "held" });
      expect(output.nextActions[1]).toMatchObject({ blockedBy: [], status: "runnable" });
      expect(output.nextActions[2]).toMatchObject({ blockedBy: [], status: "runnable" });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds when required harness inputs are missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1022-missing-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { fastPathConclusion: "fast_path_inputs_missing_or_not_supportive" });
      const { output } = await runR1022NshapBoundedHarnessState({
        createdAt: "2026-05-13T23:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("bounded_nshap_harness_inputs_missing");
      expect(output.summary.nextLocalAction).toBe("recover_nshap_harness_inputs");
      expect(output.nextActions[1]?.blockedBy).toContain("nshap_harness_inputs_missing");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1022-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafePath = path.join(tmp, "unsafe-r1018.json");
      await writeJson(unsafePath, {
        ...r1018Fixture(),
        artifactBoundary: {
          ...safeBoundary(),
          predictionsStored: true,
        },
      });

      await expect(runR1022NshapBoundedHarnessState({
        ...paths,
        r1018Path: unsafePath,
      })).rejects.toThrow("R1022 input r1018ScoreBearingSignal failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1022-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1022-nshap-bounded-harness-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1018_SCORE_BEARING_SIGNAL_PATH: paths.r1018Path,
          MURPH_AGE_R1021_FAST_PATH_STATE_PATH: paths.r1021Path,
          MURPH_AGE_R613_NSHAP_BENCHMARK_CARD_PATH: paths.r613Path,
          MURPH_AGE_R614_NSHAP_ACTIVATION_LABELS_PATH: paths.r614Path,
          MURPH_AGE_R977_NSHAP_ACTIVATION_PROBE_PATH: paths.r977Path,
          MURPH_AGE_R992_NSHAP_SCAFFOLD_PATH: paths.r992Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "bounded_nshap_harness_contract_ready_but_activation_blocked",
        harnessStatus: "blocked_activation_labels_missing",
        nextLocalAction: "wait_for_nshap_activation_then_prepare_row_adapter",
        packetId: "r1022-nshap-bounded-harness-state",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1022: false,
        schemaVersion: R1022_NSHAP_BOUNDED_HARNESS_STATE_SCHEMA_VERSION,
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
  options: { fastPathConclusion?: string; nshapReady?: boolean } = {},
): Promise<{
  outputDir: string;
  r613Path: string;
  r614Path: string;
  r977Path: string;
  r992Path: string;
  r1018Path: string;
  r1021Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r613Path: path.join(fixtureDir, "r613.json"),
    r614Path: path.join(fixtureDir, "r614.json"),
    r977Path: path.join(fixtureDir, "r977.json"),
    r992Path: path.join(fixtureDir, "r992.json"),
    r1018Path: path.join(fixtureDir, "r1018.json"),
    r1021Path: path.join(fixtureDir, "r1021.json"),
  };
  await Promise.all([
    writeJson(paths.r613Path, r613Fixture()),
    writeJson(paths.r614Path, r614Fixture(options.nshapReady === true)),
    writeJson(paths.r977Path, r977Fixture()),
    writeJson(paths.r992Path, r992Fixture()),
    writeJson(paths.r1018Path, r1018Fixture()),
    writeJson(paths.r1021Path, r1021Fixture(options.fastPathConclusion)),
  ]);
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

function r613Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r613-nshap-metadata-benchmark-card",
    schemaVersion: "murph-age-r613-nshap-metadata-benchmark-card.v1",
    status: "research-local-aggregate-only",
    summary: { conclusion: "nshap_metadata_benchmark_card_locked_without_execution" },
  };
}

function r614Fixture(ready: boolean): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r614-nshap-activation-labels",
    rowExecutionReadiness: {
      blockingReasons: ready ? [] : ["activation_label_missing"],
    },
    schemaVersion: "murph-age-r614-nshap-activation-labels.v1",
    sourceRightsAndAggregateOutput: {
      requiredHumanLabels: ready
        ? []
        : [
          "aggregate_output_permission_clear",
          "biomarker_overlap_clear",
          "mortality_or_followup_endpoint_available",
          "terms_allow_local_research_rows",
          "wave_linkage_policy_clear",
        ],
    },
    status: "research-local-aggregate-only",
    summary: {
      aggregateOutputsActive: ready,
      sourceRightsLabelsComplete: ready,
    },
  };
}

function r977Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r977-nshap-next-activation-probe",
    schemaVersion: "murph-age-r977-nshap-next-activation-probe.v1",
    status: "research-local-aggregate-only",
    summary: { conclusion: "nshap_benchmark_card_ready_but_sidecar_blocked_by_activation_labels" },
  };
}

function r992Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r992-nshap-function-cognition-scaffold",
    schemaVersion: "murph-age-r992-nshap-function-cognition-scaffold.v1",
    status: "research-local-aggregate-only",
  };
}

function r1018Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1018-score-bearing-model-signal-receipt",
    schemaVersion: "murph-age-r1018-score-bearing-model-signal-receipt.v1",
    status: "research-local-aggregate-only",
    summary: { conclusion: "function_lead_glycemia_shadow_broad_labs_hold" },
  };
}

function r1021Fixture(conclusion = "mhas_refreshed_nshap_activation_next"): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1021-fast-path-execution-state",
    schemaVersion: "murph-age-r1021-fast-path-execution-state.v1",
    status: "research-local-aggregate-only",
    summary: { conclusion },
  };
}
