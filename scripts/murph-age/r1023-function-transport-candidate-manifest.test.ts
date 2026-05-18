import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1023_FUNCTION_TRANSPORT_CANDIDATE_MANIFEST_SCHEMA_VERSION,
  runR1023FunctionTransportCandidateManifest,
} from "./r1023-function-transport-candidate-manifest.ts";

describe("R1023 function transport candidate manifest", () => {
  it("creates the function transport batch while NSHAP activation is still blocked", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1023-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1023FunctionTransportCandidateManifest({
        createdAt: "2026-05-14T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1023-function-transport-candidate-manifest.latest.json");
      expect(output.schemaVersion).toBe(R1023_FUNCTION_TRANSPORT_CANDIDATE_MANIFEST_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "function_transport_v1_manifest_ready_waiting_on_nshap_activation",
        nextLocalAction: "complete_nshap_activation_then_run_function_transport_batch",
        productDisplayAuthorized: false,
        reviewGptNextUse: "fresh_aggregate_delta_or_architecture_fork_only",
        rowParsingPerformedByR1023: false,
      });
      expect(output.batch).toMatchObject({
        batchId: "function_transport_v1",
        candidateLimit: 3,
        hypothesisSource: "reviewgpt_direction_plus_mhas_aggregate_support",
      });
      expect(output.batch.candidates.map((candidate) => [candidate.candidateId, candidate.role, candidate.status])).toEqual([
        ["anchor_same_denominator_reference", "reference", "ready_reference"],
        ["function_disability_lead", "lead_diagnostic", "queued_after_activation"],
        ["cognition_shadow_after_function", "shadow", "held_after_function"],
      ]);
      expect(output.nextActions.map((action) => [action.actionId, action.status, action.owner])).toEqual([
        ["keep_mhas_function_receipts_fresh", "completed", "local_codex"],
        ["prepare_nshap_harness_after_activation", "blocked", "local_codex"],
        ["execute_function_transport_batch", "blocked", "local_codex"],
        ["reduce_aggregate_delta_before_reviewgpt", "held", "local_codex"],
      ]);
      expect(output.nextActions[1]?.blockedBy).toContain("missing_aggregate_output_permission_clear");
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

  it("marks the batch runnable after the bounded NSHAP harness is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1023-ready-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { nshapReady: true });
      const { output } = await runR1023FunctionTransportCandidateManifest({
        createdAt: "2026-05-14T00:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("function_transport_v1_ready_for_bounded_execution");
      expect(output.summary.nextLocalAction).toBe("run_bounded_function_transport_batch");
      expect(output.batch.candidates[1]).toMatchObject({
        candidateId: "function_disability_lead",
        status: "ready_after_activation",
      });
      expect(output.nextActions[1]).toMatchObject({ blockedBy: [], status: "runnable" });
      expect(output.nextActions[2]).toMatchObject({ blockedBy: [], status: "runnable" });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks when the supporting function transport inputs are missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1023-missing-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { mhasSupportive: false });
      const { output } = await runR1023FunctionTransportCandidateManifest({
        createdAt: "2026-05-14T00:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("function_transport_v1_inputs_missing");
      expect(output.summary.nextLocalAction).toBe("recover_function_transport_inputs");
      expect(output.nextActions[0]?.status).toBe("blocked");
      expect(output.nextActions[1]?.blockedBy).toContain("function_transport_inputs_missing");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1023-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafePath = path.join(tmp, "unsafe-r1013.json");
      await writeJson(unsafePath, {
        ...r1013Fixture(),
        artifactBoundary: {
          ...safeBoundary(),
          predictionsStored: true,
        },
      });

      await expect(runR1023FunctionTransportCandidateManifest({
        ...paths,
        r1013Path: unsafePath,
      })).rejects.toThrow("R1023 input r1013BiomarkerShadowState failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1023-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1023-function-transport-candidate-manifest.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1009_MHAS_FUNCTION_RESULT_PATH: paths.r1009Path,
          MURPH_AGE_R1011_MHAS_DOMAIN_ATTRIBUTION_PATH: paths.r1011Path,
          MURPH_AGE_R1013_BIOMARKER_SHADOW_STATE_PATH: paths.r1013Path,
          MURPH_AGE_R1021_FAST_PATH_STATE_PATH: paths.r1021Path,
          MURPH_AGE_R1022_NSHAP_BOUNDED_HARNESS_STATE_PATH: paths.r1022Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        batchId: "function_transport_v1",
        conclusion: "function_transport_v1_manifest_ready_waiting_on_nshap_activation",
        nextLocalAction: "complete_nshap_activation_then_run_function_transport_batch",
        packetId: "r1023-function-transport-candidate-manifest",
        productDisplayAuthorized: false,
        reviewGptNextUse: "fresh_aggregate_delta_or_architecture_fork_only",
        rowParsingPerformedByR1023: false,
        schemaVersion: R1023_FUNCTION_TRANSPORT_CANDIDATE_MANIFEST_SCHEMA_VERSION,
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
  options: { mhasSupportive?: boolean; nshapReady?: boolean } = {},
): Promise<{
  outputDir: string;
  r1009Path: string;
  r1011Path: string;
  r1013Path: string;
  r1021Path: string;
  r1022Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r1009Path: path.join(fixtureDir, "r1009.json"),
    r1011Path: path.join(fixtureDir, "r1011.json"),
    r1013Path: path.join(fixtureDir, "r1013.json"),
    r1021Path: path.join(fixtureDir, "r1021.json"),
    r1022Path: path.join(fixtureDir, "r1022.json"),
  };
  await Promise.all([
    writeJson(paths.r1009Path, r1009Fixture(options.mhasSupportive !== false)),
    writeJson(paths.r1011Path, r1011Fixture(options.mhasSupportive !== false)),
    writeJson(paths.r1013Path, r1013Fixture()),
    writeJson(paths.r1021Path, r1021Fixture()),
    writeJson(paths.r1022Path, r1022Fixture(options.nshapReady === true)),
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

function r1009Fixture(supportive: boolean): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1009-mhas-function-panel-extension-result",
    schemaVersion: "murph-age-r1009-mhas-function-panel-extension-result.v1",
    summary: {
      conclusion: supportive
        ? "mhas_function_panel_extension_supports_lead_sidecar"
        : "mhas_function_panel_extension_hold",
    },
  };
}

function r1011Fixture(supportive: boolean): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1011-mhas-function-domain-attribution",
    schemaVersion: "murph-age-r1011-mhas-function-domain-attribution.v1",
    summary: {
      conclusion: supportive
        ? "mhas_function_domain_attribution_supportive"
        : "mhas_function_domain_attribution_hold",
    },
  };
}

function r1013Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1013-biomarker-shadow-layer-state",
    schemaVersion: "murph-age-r1013-biomarker-shadow-layer-state.v1",
    summary: { conclusion: "biomarker_body_shadow_layer_mapped_not_promotable" },
  };
}

function r1021Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1021-fast-path-execution-state",
    schemaVersion: "murph-age-r1021-fast-path-execution-state.v1",
    summary: { conclusion: "mhas_refreshed_nshap_activation_next" },
  };
}

function r1022Fixture(ready: boolean): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    nextActions: [
      {
        actionId: "prepare_row_adapter_after_activation",
        blockedBy: ready ? [] : ["missing_aggregate_output_permission_clear"],
      },
    ],
    packetId: "r1022-nshap-bounded-harness-state",
    schemaVersion: "murph-age-r1022-nshap-bounded-harness-state.v1",
    summary: {
      conclusion: ready
        ? "bounded_nshap_harness_ready_after_activation"
        : "bounded_nshap_harness_contract_ready_but_activation_blocked",
    },
  };
}
