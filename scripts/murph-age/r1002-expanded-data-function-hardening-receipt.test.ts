import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1002_EXPANDED_DATA_FUNCTION_HARDENING_RECEIPT_SCHEMA_VERSION,
  runR1002ExpandedDataFunctionHardeningReceipt,
} from "./r1002-expanded-data-function-hardening-receipt.ts";

describe("R1002 expanded data function hardening receipt", () => {
  it("summarizes expanded local data availability and completed R1001 consensus without leaking file names", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1002-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeExpandedDownloadFixtures(paths.downloadsDir);

      const { output, outputPath } = await runR1002ExpandedDataFunctionHardeningReceipt({
        createdAt: "2026-05-13T01:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1002-expanded-data-function-hardening-receipt.latest.json");
      expect(output.schemaVersion).toBe(R1002_EXPANDED_DATA_FUNCTION_HARDENING_RECEIPT_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        currentLead: "r399_anchor_plus_function_disability_sidecar",
        expandedMhasCacheDetected: true,
        nextLocalAction: "run_function_sidecar_hardening_receipt",
        productDisplayAuthorized: false,
        reviewGptChorusReady: true,
      });
      expect(output.functionSidecarHardening).toEqual({
        localAction: "run_mhas_function_sidecar_hardening_receipt",
        reviewGptConsensus: "complete_keep_function_first",
        status: "ready_for_local_hardening_loop",
      });
      expect(output.expandedDataInventory.sourceAvailability).toEqual(expect.arrayContaining([
        expect.objectContaining({
          allRequiredArtifactsPresent: true,
          family: "MHAS/Gateway MHAS",
          optionalPanelEvidenceBand: "50+",
          status: "expanded_cache_ready_for_source_card",
        }),
        expect.objectContaining({
          allRequiredArtifactsPresent: true,
          family: "NSHAP",
          status: "source_unlock_candidate",
        }),
      ]));
      expect(output.nextLocalBatch.map((item) => item.actionId)).toEqual([
        "run_function_sidecar_hardening_receipt",
        "build_mhas_panel_source_card",
        "complete_nshap_source_unlock",
        "reuse_midus_creles_score_receipts",
        "send_expanded_source_strategy_chorus",
      ]);
      expect(output.nextLocalBatch.every((item) => item.reviewGptRequiredBeforeRunning === false)).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("H_MHAS");
      expect(persisted).not.toContain("ICPSR_20541");
      expect(persisted).not.toContain("sect_");
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain(".zip");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps the CLI summary pathless and file-name-free", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1002-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeExpandedDownloadFixtures(paths.downloadsDir);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1002-expanded-data-function-hardening-receipt.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOADS_DIR: paths.downloadsDir,
          MURPH_AGE_R1000_CURRENT_ACCELERATION_STATE_PATH: paths.r1000Path,
          MURPH_AGE_R1001_REVIEWGPT_REDUCTION_PATH: paths.r1001Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        currentLead: "r399_anchor_plus_function_disability_sidecar",
        expandedMhasCacheDetected: true,
        nextLocalAction: "run_function_sidecar_hardening_receipt",
        packetId: "r1002-expanded-data-function-hardening-receipt",
        productDisplayAuthorized: false,
        reviewGptChorusReady: true,
        schemaVersion: R1002_EXPANDED_DATA_FUNCTION_HARDENING_RECEIPT_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("H_MHAS");
      expect(stdout).not.toContain("ICPSR_20541");
      expect(stdout).not.toContain("sect_");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks hardening if the ReviewGPT result-direction consensus is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1002-blocked-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { r1001Complete: false });
      await writeExpandedDownloadFixtures(paths.downloadsDir);

      const { output } = await runR1002ExpandedDataFunctionHardeningReceipt({
        createdAt: "2026-05-13T01:00:00.000Z",
        ...paths,
      });

      expect(output.functionSidecarHardening).toEqual({
        localAction: "recover_function_hardening_inputs",
        reviewGptConsensus: "pending_or_not_keep_function_first",
        status: "blocked_pending_consensus_or_inputs",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe aggregate input egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1002-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r1000Path, {
        ...aggregateFixture("r1000-current-acceleration-state"),
        predictions: [0.1, 0.2],
      });

      await expect(runR1002ExpandedDataFunctionHardeningReceipt({
        ...paths,
      })).rejects.toThrow("R1002 input r1000CurrentAccelerationState failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { r1001Complete?: boolean } = {},
): Promise<{
  downloadsDir: string;
  outputDir: string;
  r1000Path: string;
  r1001Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const downloadsDir = path.join(tmp, "downloads");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    downloadsDir,
    outputDir,
    r1000Path: path.join(fixtureDir, "r1000.json"),
    r1001Path: path.join(fixtureDir, "r1001.json"),
  };
  await Promise.all([
    writeJson(paths.r1000Path, {
      ...aggregateFixture("r1000-current-acceleration-state"),
      summary: {
        currentLead: "r399_anchor_plus_function_disability_sidecar",
        nextLocalAction: "harden_function_disability_sidecar",
        productDisplayAuthorized: false,
      },
    }),
    writeJson(paths.r1001Path, {
      schema_version: "murph-age-r1001-result-interpretation-direction-reduction.v1",
      status: options.r1001Complete === false ? "pending" : "complete",
      consensus: {
        decision: options.r1001Complete === false ? "push_nshap_activation_first" : "keep_function_first",
      },
      counts: {
        pending: options.r1001Complete === false ? 1 : 0,
        quarantine: 0,
        trusted: options.r1001Complete === false ? 2 : 3,
      },
    }),
  ]);
  return paths;
}

async function writeExpandedDownloadFixtures(downloadsDir: string): Promise<void> {
  const names = [
    "ICPSR_20541-V10.zip",
    "ICPSR_34921-V5.zip",
    "ICPSR_36873-V9.zip",
    "H_MHAS_d.dta",
    "GH_MHAS_EOL_c.dta",
    "master_follow_up_file_2024.dta",
    "ICPSR_04652-V8.zip",
    "ICPSR_29282-V11.zip",
    "ICPSR_36532-V4.zip",
    "ICPSR_36901-V6.zip",
    "ICPSR_37237-V6.zip",
    "ICPSR_38024-V3.zip",
    "ICPSR_26681-V3.zip",
    "ICPSR_31263-V2.zip",
    "ICPSR_35250-V2.zip",
    "ICPSR_36633-V4.zip",
    "SouthAfricaINDData.rar",
    "SouthAfricaHHData.dta",
    "SouthAfricaHHMembersData.dta",
    "SAGESouthAfrica.zip",
    ...Array.from({ length: 50 }, (_unused, index) => `sect_fixture_${index}.dta`),
  ];
  await Promise.all(names.map((name) => writeFile(path.join(downloadsDir, name), "")));
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
