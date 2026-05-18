import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1096ConsumerValidationRoutePriority } from "./r1096-consumer-validation-route-priority.ts";

describe("R1096 consumer validation route priority", () => {
  it("ranks aggregate and workbench routes above the public bridge for consumer labs and wearables", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1096-"));
    const paths = await writeFixtures(tmp, true);

    const { output } = await runR1096ConsumerValidationRoutePriority({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "consumer_lab_wearable_validation_routes_ranked",
      nextLocalAction: "package_consumer_lab_wearable_aggregate_receipt_template",
      productDisplayAuthorized: false,
      reviewGptStatus: "awaiting_r1095_science_direction_response",
      rowParsingPerformedByR1096: false,
      trueWearableOutcomeRouteStatus: "aggregate_or_workbench_route_required",
    });
    expect(output.currentConsumerTarget).toMatchObject({
      candidateId: "common_lab_core_shadow",
      targetUserAgeBand: "roughly_16_50",
    });
    expect(output.registryValidation.status).toBe("valid");

    const routeIds = output.routePriorities.map((route) => route.routeId);
    expect(routeIds.slice(0, 4)).toEqual([
      "partner-aggregate-evaluator",
      "all-of-us-fitbit-labs-ehr",
      "midus-biomarker-mortality",
      "nhanes-activity-shadow-lmf",
    ]);
    expect(routeIds.indexOf("partner-aggregate-evaluator")).toBeLessThan(routeIds.indexOf("nhanes-activity-shadow-lmf"));
    expect(routeIds.indexOf("all-of-us-fitbit-labs-ehr")).toBeLessThan(routeIds.indexOf("nhanes-activity-shadow-lmf"));
    expect(output.routePriorities[0]).toMatchObject({
      consumerFit: "direct_consumer_fit",
      directLocalDownloadPriority: "not_needed_for_aggregate_route",
      routeUse: "bloodwork_and_wearable_external_validation",
    });
  });

  it("does not rank routes when the current consumer lab candidate is not ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1096-"));
    const paths = await writeFixtures(tmp, false);

    const { output } = await runR1096ConsumerValidationRoutePriority({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "consumer_lab_wearable_routes_blocked_missing_candidate",
      nextLocalAction: "repair_consumer_lab_wearable_current_decision",
      trueWearableOutcomeRouteStatus: "blocked_until_consumer_candidate_repaired",
    });
    expect(output.routePriorities).toEqual([]);
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1096-"));
    const r1095Path = path.join(tmp, "unsafe.json");
    await writeJson(r1095Path, {
      packetId: "r1095-consumer-lab-wearable-review-packet",
      rowValuesStored: true,
      schemaVersion: "murph-age-r1095-consumer-lab-wearable-review-packet.v1",
    });

    await expect(runR1096ConsumerValidationRoutePriority({
      outputDir: path.join(tmp, "out"),
      r1095Path,
    })).rejects.toThrow("R1096 rejected unsafe r1095 input");
  });
});

async function writeFixtures(tmp: string, ready: boolean): Promise<{
  r1094Path: string;
  r1095Path: string;
}> {
  const paths = {
    r1094Path: path.join(tmp, "r1094.json"),
    r1095Path: path.join(tmp, "r1095.json"),
  };

  await Promise.all([
    writeJson(paths.r1094Path, {
      applicability: {
        validationGap: ready
          ? "candidate_sources_not_direct_young_adult_consumer_validation"
          : "candidate_not_selected",
      },
      artifactBoundary: safeBoundary(),
      packetId: "r1094-consumer-age-domain-applicability-guard",
      schemaVersion: "murph-age-r1094-consumer-age-domain-applicability-guard.v1",
    }),
    writeJson(paths.r1095Path, {
      artifactBoundary: safeBoundary(),
      currentDecision: {
        candidateId: ready ? "common_lab_core_shadow" : "none",
      },
      packetId: "r1095-consumer-lab-wearable-review-packet",
      schemaVersion: "murph-age-r1095-consumer-lab-wearable-review-packet.v1",
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
