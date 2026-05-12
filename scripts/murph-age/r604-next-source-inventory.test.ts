import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R604_NEXT_SOURCE_INVENTORY_SCHEMA_VERSION,
  runR604NextSourceInventory,
} from "./r604-next-source-inventory.ts";

describe("R604 next-source inventory", () => {
  it("builds a metadata-only next action packet from local artifacts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r604-inventory-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR604NextSourceInventory({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r604-next-source-inventory.latest.json");
      expect(output.schemaVersion).toBe(R604_NEXT_SOURCE_INVENTORY_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-metadata-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        codebookProseStored: false,
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
        splitIdentifiersStored: false,
      });
      expect(output.inventory.downloadInventory).toMatchObject({
        activationNeededBeforeParsingRows: true,
        laneCountBand: "10-49",
        presentLaneCountBand: "1-9",
        rowParsing: "not-performed",
        storedPathPolicy: "base-file-names-only",
      });
      expect(output.inventory.activationQueue.queue.map((item) => item.laneGroup)).toEqual([
        "midus-refresher-triad",
        "haalsi",
      ]);
      expect(output.inventory.preflights.haalsi).toMatchObject({
        datasetCountBand: "1-9",
        sourceLabel: "HAALSI local fixture",
        status: "available",
      });
      expect(output.inventory.preflights.haalsi.categoryAvailability).toEqual({
        age_or_demographics: "present",
        biomarker_or_lab: "present",
        mortality_or_followup: "absent",
      });
      expect(output.inventory.preflights.haalsi.tableSizeBands).toEqual([
        {
          columnCountBand: "1000+",
          dataset: "haalsi-fixture",
          rowCountBand: "1000+",
        },
      ]);
      expect(output.inventory.r603TransportReadiness).toMatchObject({
        conclusion: "transport_signal_not_confirmed",
        productPromotionAuthorized: false,
        status: "available",
      });
      expect(output.inventory.reviewGptReducedDecisions).toEqual({
        artifactCountBand: "1-9",
        files: [
          {
            artifact: "r603-reduced-decision.latest.json",
            decisionId: "r603-next-source",
            packetId: "review-reduced-r603",
            schemaVersion: "reviewgpt-reduced-decision.v1",
            status: "accepted",
          },
        ],
        status: "present",
      });
      expect(output.nextLocalActionQueue.map((action) => action.actionId)).toEqual([
        "classify-mhas-survey-eol-transport-fit",
        "classify-nshap-wave-endpoint-biomarker-fit",
        "map-haalsi-endpoint-feature-labels",
        "fill-activation-labels-haalsi",
        "refresh-r603-transport-readiness-before-next-review",
        "fold-reduced-reviewgpt-decisions-into-source-priority",
        "fill-activation-labels-midus-refresher-triad",
      ]);
      expect(output.nextLocalActionQueue[0]).toMatchObject({
        actionKind: "endpoint_feature_mapping",
        blockedUntil: ["terms and endpoint-join labels before scoring"],
        laneGroup: "mhas-harmonized-eol",
        runnableNow: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("sampleVariableNames");
      expect(persisted).not.toContain("source body text");
      expect(persisted).not.toContain("\"rowCount\":");
      expect(persisted).not.toContain("\"columnCount\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless metadata CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r604-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r604-next-source-inventory.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_ACTIVATION_QUEUE_PATH: paths.activationQueuePath,
          MURPH_AGE_DOWNLOAD_INVENTORY_PATH: paths.downloadInventoryPath,
          MURPH_AGE_HAALSI_PREFLIGHT_PATH: paths.haalsiPreflightPath,
          MURPH_AGE_MHAS_PREFLIGHT_PATH: paths.mhasPreflightPath,
          MURPH_AGE_NSHAP_PREFLIGHT_PATH: paths.nshapPreflightPath,
          MURPH_AGE_R603_PACKET_PATH: paths.r603Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
          MURPH_AGE_REVIEW_DECISION_DIR: paths.reviewDecisionDir,
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual({
        actionCountBand: "1-9",
        artifact: "r604-next-source-inventory.latest.json",
        packetId: "r604-next-source-inventory",
        productPromotionAuthorized: false,
        safestNextAction: "classify-mhas-survey-eol-transport-fit",
        schemaVersion: R604_NEXT_SOURCE_INVENTORY_SCHEMA_VERSION,
        status: "research-local-metadata-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("reports missing inputs without fabricating runnable row work", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r604-missing-"));
    try {
      const { output } = await runR604NextSourceInventory({
        activationQueuePath: path.join(tmp, "missing-activation.json"),
        downloadInventoryPath: path.join(tmp, "missing-download.json"),
        haalsiPreflightPath: path.join(tmp, "missing-haalsi.json"),
        mhasPreflightPath: path.join(tmp, "missing-mhas.json"),
        nshapPreflightPath: path.join(tmp, "missing-nshap.json"),
        outputDir: path.join(tmp, "out"),
        r603Path: path.join(tmp, "missing-r603.json"),
        reviewDecisionDir: path.join(tmp, "missing-review"),
      });

      expect(output.inventory.downloadInventory.status).toBe("missing");
      expect(output.inventory.activationQueue).toMatchObject({ queue: [], status: "missing" });
      expect(output.inventory.preflights.haalsi.status).toBe("missing");
      expect(output.inventory.r603TransportReadiness.status).toBe("missing");
      expect(output.inventory.reviewGptReducedDecisions).toEqual({
        artifactCountBand: "0",
        files: [],
        status: "none_present",
      });
      expect(output.nextLocalActionQueue).toEqual([]);
      expect(output.summary.safestNextAction).toBeNull();
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  activationQueuePath: string;
  downloadInventoryPath: string;
  haalsiPreflightPath: string;
  mhasPreflightPath: string;
  nshapPreflightPath: string;
  r603Path: string;
  reviewDecisionDir: string;
}> {
  await mkdir(tmp, { recursive: true });
  const activationQueuePath = path.join(tmp, "activation-queue.json");
  const downloadInventoryPath = path.join(tmp, "download-inventory.json");
  const haalsiPreflightPath = path.join(tmp, "haalsi-preflight.json");
  const mhasPreflightPath = path.join(tmp, "mhas-preflight.json");
  const nshapPreflightPath = path.join(tmp, "nshap-preflight.json");
  const r603Path = path.join(tmp, "r603.json");
  const reviewDecisionDir = path.join(tmp, "review-decisions");
  await mkdir(reviewDecisionDir, { recursive: true });
  await Promise.all([
    writeJson(downloadInventoryPath, downloadInventoryFixture()),
    writeJson(activationQueuePath, activationQueueFixture()),
    writeJson(haalsiPreflightPath, headerPreflightFixture("HAALSI local fixture", "haalsi-fixture")),
    writeJson(mhasPreflightPath, headerPreflightFixture("MHAS local fixture", "mhas-fixture")),
    writeJson(nshapPreflightPath, headerPreflightFixture("NSHAP local fixture", "nshap-fixture")),
    writeJson(r603Path, r603Fixture()),
    writeJson(path.join(reviewDecisionDir, "r603-reduced-decision.latest.json"), {
      decisionId: "r603-next-source",
      packetId: "review-reduced-r603",
      schemaVersion: "reviewgpt-reduced-decision.v1",
      status: "accepted",
      ignoredBody: "source body text must not be copied",
    }),
  ]);
  return {
    activationQueuePath,
    downloadInventoryPath,
    haalsiPreflightPath,
    mhasPreflightPath,
    nshapPreflightPath,
    r603Path,
    reviewDecisionDir,
  };
}

function downloadInventoryFixture() {
  return {
    activationNeededBeforeParsingRows: true,
    lanes: [
      { lane: "midus-refresher-survey", presentFileCount: 1 },
      { lane: "midus-refresher-biomarker", presentFileCount: 1 },
      { lane: "midus-refresher-mortality", presentFileCount: 1 },
      { lane: "haalsi", presentFileCount: 1 },
      { lane: "nshap", presentFileCount: 0 },
      { lane: "mhas", presentFileCount: 0 },
      { lane: "creles", presentFileCount: 0 },
      { lane: "sage", presentFileCount: 0 },
      { lane: "sebas", presentFileCount: 0 },
      { lane: "charls", presentFileCount: 0 },
    ],
    recommendedNearTermOrder: ["midus-refresher-biomarker+mortality+survey", "haalsi"],
    rowParsing: "not-performed",
    schemaVersion: "murph-age-source-download-inventory.v1",
    storedPathPolicy: "base-file-names-only",
  };
}

function activationQueueFixture() {
  return {
    queue: [
      {
        activationLabelsNeeded: ["terms_allow_local_research_rows", "terms_allow_aggregate_outputs"],
        evidenceLabelTarget: "true-external-candidate",
        filesPresent: true,
        laneGroup: "midus-refresher-triad",
        priority: 1,
        rowParsingUnlocked: false,
      },
      {
        activationLabelsNeeded: ["endpoint_or_followup_available"],
        evidenceLabelTarget: "transport-stress-candidate",
        filesPresent: true,
        laneGroup: "haalsi",
        priority: 3,
        rowParsingUnlocked: false,
      },
    ],
    schemaVersion: "murph-age-source-activation-queue.v1",
  };
}

function headerPreflightFixture(source: string, dataset: string) {
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
          age_or_demographics: { matchCount: 4, sampleVariableNames: ["AGE"] },
          biomarker_or_lab: { matchCount: 2, sampleVariableNames: ["GLUCOSE"] },
          mortality_or_followup: { matchCount: 0, sampleVariableNames: [] },
        },
        columnCount: 1200,
        dataset,
        fileName: "ignored-local-entry.tsv",
        rowCount: 5000,
      },
    ],
    preflightConclusion: "metadata-only-source-candidate",
    schemaVersion: "murph-age-source-header-preflight.v1",
    source,
  };
}

function r603Fixture() {
  return {
    boundary: {
      productPromotionAuthorized: false,
    },
    readiness: {
      conclusion: "transport_signal_not_confirmed",
    },
    schemaVersion: "murph-age-r603-transport-readiness-packet.v1",
    status: "research-local-aggregate-only",
    transport: {
      crelesLocal: { status: "available" },
      midusToCreles: { status: "available" },
    },
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
