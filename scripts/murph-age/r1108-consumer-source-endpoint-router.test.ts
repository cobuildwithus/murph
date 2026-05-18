import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1108_CONSUMER_SOURCE_ENDPOINT_ROUTER_SCHEMA_VERSION,
  runR1108ConsumerSourceEndpointRouter,
} from "./r1108-consumer-source-endpoint-router.ts";

describe("R1108 consumer source endpoint router", () => {
  it("routes sparse 16-50 mortality evidence toward All of Us or CARDIA aggregate receipts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1108-"));
    try {
      const paths = await writeInputs(tmp, {
        handoffReady: true,
        sparseCurrentSources: true,
      });

      const { output, outputPath } = await runR1108ConsumerSourceEndpointRouter({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1108-consumer-source-endpoint-router.latest.json");
      expect(output.schemaVersion).toBe(R1108_CONSUMER_SOURCE_ENDPOINT_ROUTER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "route_all_of_us_or_cardia_aggregate_first",
        nextAction: "prepare_single_reviewgpt_endpoint_source_question_and_pursue_aggregate_receipt",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: true,
        rowParsingPerformedByR1108: false,
      });
      expect(output.endpointDecision).toMatchObject({
        mortalityOnlyFor16To50: "underpowered_in_current_sources",
        nearTermPrimaryEndpoint: "incident_clinical_or_cardiometabolic_outcomes_with_mortality_as_secondary_when_powered",
      });
      expect(output.sourceRoutes.map((route) => route.routeKey)).toEqual([
        "all_of_us_workbench_aggregate",
        "cardia_authorized_or_aggregate",
        "nhanes_lab_activity_shadow",
        "ukb_integrated_lab_accelerometer",
        "midus_creles_existing_shadow",
        "murph_native_coverage_and_experiment_data",
      ]);
      expect(output.sourceRoutes[0]).toMatchObject({
        accessMode: "workbench_aggregate_receipt",
        ageFit: "strong_18_plus",
        priority: 1,
        routeStatus: "primary_next",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when source or handoff inputs are missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1108-wait-"));
    try {
      const paths = await writeInputs(tmp, {
        handoffReady: true,
        sparseCurrentSources: false,
      });

      const { output } = await runR1108ConsumerSourceEndpointRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.conclusion).toBe("repair_consumer_source_inputs_before_routing");
      expect(output.summary.reviewGptRequiredNow).toBe(false);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream artifacts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1108-unsafe-"));
    try {
      const paths = await writeInputs(tmp, {
        handoffReady: true,
        sparseCurrentSources: true,
      });
      await writeJson(paths.r1107Path, {
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
        packetId: "r1107-consumer-age-band-source-suitability",
        schemaVersion: "murph-age-r1107-consumer-age-band-source-suitability.v1",
      });

      await expect(runR1108ConsumerSourceEndpointRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1108 rejected unsafe r1107 input");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1108-cli-"));
    try {
      const paths = await writeInputs(tmp, {
        handoffReady: true,
        sparseCurrentSources: true,
      });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1108-consumer-source-endpoint-router.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1106_CONSUMER_HANDOFF_PATH: paths.r1106Path,
          MURPH_AGE_R1107_CONSUMER_AGE_BAND_PATH: paths.r1107Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        packetId: string;
        primaryRoute: string;
        productDisplayAuthorized: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "route_all_of_us_or_cardia_aggregate_first",
        packetId: "r1108-consumer-source-endpoint-router",
        primaryRoute: "all_of_us_workbench_aggregate",
        productDisplayAuthorized: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(
  tmp: string,
  input: { handoffReady: boolean; sparseCurrentSources: boolean },
): Promise<{ r1106Path: string; r1107Path: string }> {
  const paths = {
    r1106Path: path.join(tmp, "r1106.json"),
    r1107Path: path.join(tmp, "r1107.json"),
  };
  await Promise.all([
    writeJson(paths.r1106Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1106-consumer-aggregate-handoff-bundle",
      schemaVersion: "murph-age-r1106-consumer-aggregate-handoff-bundle.v1",
      summary: {
        conclusion: input.handoffReady
          ? "consumer_aggregate_handoff_ready"
          : "consumer_aggregate_handoff_waiting_on_manifest_or_template",
      },
    }),
    writeJson(paths.r1107Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1107-consumer-age-band-source-suitability",
      schemaVersion: "murph-age-r1107-consumer-age-band-source-suitability.v1",
      summary: {
        conclusion: input.sparseCurrentSources
          ? "current_sources_are_shadow_or_older_transport_only"
          : "current_sources_support_consumer_16_50_outcome_loop",
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
