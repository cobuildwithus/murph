import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1004_FUNCTION_SIDECAR_HARDENING_RECEIPT_SCHEMA_VERSION,
  runR1004FunctionSidecarHardeningReceipt,
} from "./r1004-function-sidecar-hardening-receipt.ts";

describe("R1004 function sidecar hardening receipt", () => {
  it("hardens the function/disability sidecar when all aggregate evidence is present", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1004-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1004FunctionSidecarHardeningReceipt({
        createdAt: "2026-05-13T02:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1004-function-sidecar-hardening-receipt.latest.json");
      expect(output.schemaVersion).toBe(R1004_FUNCTION_SIDECAR_HARDENING_RECEIPT_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        currentLead: "r399_anchor_plus_function_disability_hardened_sidecar",
        nextLocalAction: "build_mhas_panel_source_card",
        productDisplayAuthorized: false,
        sidecarStatus: "hardened_research_lead_sidecar",
      });
      expect(output.functionSidecar).toEqual({
        displayPolicy: "no_user_facing_age_display",
        modelRole: "research_diagnostic_sidecar_not_product_age",
        status: "hardened_research_lead_sidecar",
      });
      expect(Object.values(output.evidenceChecks).every(Boolean)).toBe(true);
      expect(output.nextLocalBatch.map((item) => item.actionId)).toEqual([
        "build_mhas_panel_source_card",
        "complete_nshap_source_unlock",
        "run_nshap_function_cognition_falsification_when_unlocked",
        "keep_glycemia_body_shadow_only",
        "await_r1003_high_value_direction",
      ]);
      expect(output.nextLocalBatch.every((item) => item.reviewGptRequiredBeforeRunning === false)).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps the CLI summary compact and pathless", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1004-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1004-function-sidecar-hardening-receipt.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1001_REVIEWGPT_DIRECTION_PATH: paths.r1001Path,
          MURPH_AGE_R1002_EXPANDED_DATA_RECEIPT_PATH: paths.r1002Path,
          MURPH_AGE_R986_FUNCTION_ARBITRATION_PATH: paths.r986Path,
          MURPH_AGE_R988_MHAS_ANCHOR_INCREMENT_PATH: paths.r988Path,
          MURPH_AGE_R991_MHAS_DEEP_DIAGNOSTIC_PATH: paths.r991Path,
          MURPH_AGE_R995_SIDECAR_ARBITRATION_PATH: paths.r995Path,
          MURPH_AGE_R997_STRICT_NSHAP_REPLAY_PATH: paths.r997Path,
          MURPH_AGE_R999_REVIEWGPT_DIRECTION_PATH: paths.r999Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        currentLead: "r399_anchor_plus_function_disability_hardened_sidecar",
        nextLocalAction: "build_mhas_panel_source_card",
        packetId: "r1004-function-sidecar-hardening-receipt",
        productDisplayAuthorized: false,
        schemaVersion: R1004_FUNCTION_SIDECAR_HARDENING_RECEIPT_SCHEMA_VERSION,
        sidecarStatus: "hardened_research_lead_sidecar",
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds the sidecar if a required evidence check is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1004-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { r991Support: false });
      const { output } = await runR1004FunctionSidecarHardeningReceipt({
        createdAt: "2026-05-13T02:00:00.000Z",
        ...paths,
      });

      expect(output.summary.sidecarStatus).toBe("hold_pending_required_evidence");
      expect(output.evidenceChecks.mhasDeepDiagnosticSupported).toBe(false);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe aggregate input egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1004-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r988Path, {
        ...aggregateFixture("r988-mhas-anchor-function-increment-check"),
        modelParameters: { beta: 1 },
      });

      await expect(runR1004FunctionSidecarHardeningReceipt({
        ...paths,
      })).rejects.toThrow("R1004 input r988MhasAnchorIncrement failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { r991Support?: boolean } = {},
): Promise<{
  outputDir: string;
  r986Path: string;
  r988Path: string;
  r991Path: string;
  r995Path: string;
  r997Path: string;
  r999Path: string;
  r1001Path: string;
  r1002Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r986Path: path.join(fixtureDir, "r986.json"),
    r988Path: path.join(fixtureDir, "r988.json"),
    r991Path: path.join(fixtureDir, "r991.json"),
    r995Path: path.join(fixtureDir, "r995.json"),
    r997Path: path.join(fixtureDir, "r997.json"),
    r999Path: path.join(fixtureDir, "r999.json"),
    r1001Path: path.join(fixtureDir, "r1001.json"),
    r1002Path: path.join(fixtureDir, "r1002.json"),
  };

  await Promise.all([
    writeJson(paths.r986Path, {
      ...aggregateFixture("r986-cross-source-function-arbitration"),
      summary: { verdict: "function_disability_portable_diagnostic_sidecar_supported" },
    }),
    writeJson(paths.r988Path, {
      ...aggregateFixture("r988-mhas-anchor-function-increment-check"),
      summary: { verdict: "mhas_function_adds_small_increment_over_frozen_anchor" },
    }),
    writeJson(paths.r991Path, {
      ...aggregateFixture("r991-mhas-deep-diagnostic-reducer"),
      summary: {
        verdict: options.r991Support === false
          ? "function_disability_deep_diagnostic_not_confirmed"
          : "function_disability_survives_age_residualized_deep_diagnostic",
      },
    }),
    writeJson(paths.r995Path, {
      ...aggregateFixture("r995-sidecar-evidence-arbitration"),
      summary: { nextCandidateFamily: "function_disability" },
    }),
    writeJson(paths.r997Path, {
      ...aggregateFixture("r997-strict-nshap-function-cognition-replay"),
      summary: { artifactVerdict: "historical_nshap_aggregate_signal_usable_research_direction_only" },
    }),
    writeJson(paths.r999Path, {
      schema_version: "murph-age-r999-new-data-acceleration-direction-reduction.v1",
      status: "complete",
    }),
    writeJson(paths.r1001Path, {
      schema_version: "murph-age-r1001-result-interpretation-direction-reduction.v1",
      status: "complete",
      consensus: { decision: "keep_function_first" },
    }),
    writeJson(paths.r1002Path, {
      ...aggregateFixture("r1002-expanded-data-function-hardening-receipt"),
      functionSidecarHardening: { status: "ready_for_local_hardening_loop" },
    }),
  ]);
  return paths;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function aggregateFixture(packetId: string): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
    },
    packetId,
    schemaVersion: `murph-age-${packetId}.v1`,
    status: "research-local-aggregate-only",
  };
}
