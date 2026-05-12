import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  MHAS_JOIN_PROBE_SCHEMA_VERSION,
  runMhasJoinProbe,
} from "./mhas-join-probe.ts";

describe("MHAS join probe", () => {
  it("summarizes aggregate-only harmonized plus EOL join readiness", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-mhas-join-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const localDataDir = path.join(tmp, "local-data");
      await mkdir(path.join(localDataDir, "nested"), { recursive: true });
      await Promise.all([
        writeFile(path.join(localDataDir, "nested", "H_MHAS_d.dta"), ""),
        writeFile(path.join(localDataDir, "GH_MHAS_EOL_c.dta"), ""),
      ]);

      const { output, outputPath } = await runMhasJoinProbe({
        createdAt: "2026-05-12T00:00:00.000Z",
        localDataDir,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("mhas-join-probe.latest.json");
      expect(output.schemaVersion).toBe(MHAS_JOIN_PROBE_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        codebookTextStored: false,
        coefficientsStored: false,
        joinKeyValuesStored: false,
        localFileNamesStored: false,
        localPathsStored: false,
        modelParamsStored: false,
        modelScoringPerformed: false,
        participantIdentifiersStored: false,
        participantIdentifiersWritten: false,
        predictionsStored: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowParsingPerformed: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
        variableNamesStored: false,
      });
      expect(output.sourceArtifactsPresent).toEqual({
        allRequiredInventoryArtifactsPresent: true,
        allRequiredLocalArtifactsDetected: true,
        allRequiredMetadataPresent: true,
      });
      expect(output.requiredSourceArtifacts).toEqual({
        endOfLife: {
          headerMetadataPresent: true,
          inventoryArtifactPresent: true,
          localStructureDetected: true,
          role: "endOfLife",
        },
        harmonizedPanel: {
          headerMetadataPresent: true,
          inventoryArtifactPresent: true,
          localStructureDetected: true,
          role: "harmonizedPanel",
        },
      });
      expect(output.endpointEolMetadataStatus).toEqual({
        eolArtifactPresent: true,
        eolHeaderPresent: true,
        mortalityOrEolSignal: "present",
        status: "endpoint_metadata_ready_for_contract",
      });
      expect(output.joinFeasibility).toEqual({
        blockerReasons: [],
        joinKeyFamilyStatus: "candidate_family_overlap_detected",
        matchingFamilyCountBand: "1-4",
        readyForLockedJoinContract: true,
        status: "metadata_ready",
      });
      expect(output.rowParsingAndScoring).toEqual({
        blocked: true,
        reason: "join_probe_is_metadata_and_file_structure_only",
        rowParsingPerformed: false,
        scoringPerformed: false,
      });
      expect(output.nextRunnableAction).toBe("draft_locked_mhas_join_and_endpoint_contract");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("H_MHAS_d.dta");
      expect(persisted).not.toContain("GH_MHAS_EOL_c.dta");
      expect(persisted).not.toContain("syntheticHeaderTokens");
      expect(persisted).not.toContain("respondent_token");
      expect(persisted).not.toContain("visit_token");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("coefficients\":");
      expect(persisted).not.toContain("sourceText");
      expect(persisted).not.toContain("27159");
      expect(persisted).not.toContain("7418");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-mhas-join-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/mhas-join-probe.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOAD_INVENTORY_PATH: paths.downloadInventoryPath,
          MURPH_AGE_MHAS_HEADER_PREFLIGHT_PATH: paths.headerPreflightPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "mhas-join-probe.latest.json",
        joinKeyFamilyStatus: "candidate_family_overlap_detected",
        nextRunnableAction: "draft_locked_mhas_join_and_endpoint_contract",
        packetId: "mhas-harmonized-eol-aggregate-join-probe",
        productPromotionAuthorized: false,
        readyForLockedJoinContract: true,
        rowParsingPerformed: false,
        schemaVersion: MHAS_JOIN_PROBE_SCHEMA_VERSION,
        scoringPerformed: false,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("H_MHAS_d.dta");
      expect(stdout).not.toContain("GH_MHAS_EOL_c.dta");
      expect(stdout).not.toContain("predictions");
      expect(stdout).not.toContain("coefficients");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps rows and scoring blocked when local structure is not configured", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-mhas-join-no-local-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output } = await runMhasJoinProbe({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.localFileStructure).toEqual({
        inspected: false,
        requiredRoleStatus: {
          endOfLife: "not_inspected",
          harmonizedPanel: "not_inspected",
        },
        status: "not_configured",
      });
      expect(output.sourceArtifactsPresent.allRequiredLocalArtifactsDetected).toBeNull();
      expect(output.joinFeasibility.readyForLockedJoinContract).toBe(true);
      expect(output.rowParsingAndScoring.blocked).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks join-contract readiness when EOL endpoint metadata is absent", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-mhas-join-missing-eol-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { eolMortalityMatchCount: 0 });
      const { output } = await runMhasJoinProbe({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.endpointEolMetadataStatus).toMatchObject({
        mortalityOrEolSignal: "absent",
        status: "blocked_missing_eol_artifact_or_metadata",
      });
      expect(output.joinFeasibility.status).toBe("blocked");
      expect(output.joinFeasibility.blockerReasons).toContain("missing_endpoint_eol_metadata");
      expect(output.nextRunnableAction).toBe("complete_mhas_metadata_source_intake");
      expect(output.boundary.rowParsingPerformed).toBe(false);
      expect(output.boundary.modelScoringPerformed).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { eolMortalityMatchCount?: number } = {},
): Promise<{ downloadInventoryPath: string; headerPreflightPath: string }> {
  await mkdir(tmp, { recursive: true });
  const headerPreflightPath = path.join(tmp, "mhas-header-preflight.latest.json");
  const downloadInventoryPath = path.join(tmp, "download-inventory.latest.json");
  await Promise.all([
    writeJson(headerPreflightPath, headerPreflightArtifact(options)),
    writeJson(downloadInventoryPath, downloadInventoryArtifact()),
  ]);
  return { downloadInventoryPath, headerPreflightPath };
}

function headerPreflightArtifact(options: { eolMortalityMatchCount?: number } = {}) {
  const eolMortalityMatchCount = options.eolMortalityMatchCount ?? 2;
  return {
    boundary: {
      codebookTextStored: false,
      localPathsStored: false,
      participantIdentifiersStored: false,
      rowValuesStored: false,
      sourceBodiesStored: false,
      variableLabelsStored: false,
    },
    datasets: [
      {
        categorySignals: {
          activity_or_function: signal(4),
          mortality_or_eol: signal(3),
        },
        columnCount: 6542,
        dataset: "mhas_harmonized",
        fileName: "H_MHAS_d.dta",
        rowCount: 27159,
        syntheticHeaderTokens: ["respondent_token", "visit_token"],
      },
      {
        categorySignals: {
          mortality_or_eol: signal(eolMortalityMatchCount),
          self_rated_or_disease_history: signal(1),
        },
        columnCount: 264,
        dataset: "mhas_eol",
        fileName: "GH_MHAS_EOL_c.dta",
        rowCount: 7418,
        syntheticHeaderTokens: ["respondent_token"],
      },
    ],
    schemaVersion: "fixture",
  };
}

function downloadInventoryArtifact() {
  return {
    activationNeededBeforeParsingRows: true,
    files: [
      {
        file: "H_MHAS_d.dta",
        lane: "mhas-harmonized",
        present: true,
        role: "harmonized-panel",
        sizeBytes: 225274725,
      },
      {
        file: "GH_MHAS_EOL_c.dta",
        lane: "mhas-end-of-life",
        present: true,
        role: "mortality-eol",
        sizeBytes: 3219400,
      },
    ],
    lanes: [
      {
        activationStatus: "metadata-only-not-activated",
        files: ["H_MHAS_d.dta"],
        lane: "mhas-harmonized",
        presentFileCount: 1,
        roles: ["harmonized-panel"],
      },
      {
        activationStatus: "metadata-only-not-activated",
        files: ["GH_MHAS_EOL_c.dta"],
        lane: "mhas-end-of-life",
        presentFileCount: 1,
        roles: ["mortality-eol"],
      },
    ],
    modelScoringPerformed: false,
    participantIdentifiersStored: false,
    rowParsing: "not-performed",
    rowValuesStored: false,
    schemaVersion: "fixture",
    sourceBodiesStored: false,
  };
}

function signal(matchCount: number) {
  return { matchCount };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
