import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1097ConsumerLabWearableAggregateTemplate } from "./r1097-consumer-lab-wearable-aggregate-template.ts";

describe("R1097 consumer lab/wearable aggregate template", () => {
  it("packages a consumer lab and wearable receipt guide when route priority is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1097-"));
    const paths = await writeFixtures(tmp, true);

    const { output } = await runR1097ConsumerLabWearableAggregateTemplate({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "consumer_lab_wearable_template_ready_for_data_holder_fill",
      nextLocalAction: "await_true_consumer_lab_wearable_aggregate_receipt_or_workbench_run",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1097: false,
      templateReadyForDataFill: true,
    });
    expect(output.templateBundle.baseReceiptTemplateArtifact).toBe("r1062-fillable-aggregate-receipt-template.json");
    expect(output.templateBundle.ageDomainPolicy.requiredEvidenceSubbands).toEqual(["16_17", "18_39", "40_50"]);
    expect(output.templateBundle.targetRoutes.slice(0, 3)).toEqual([
      "partner-aggregate-evaluator",
      "all-of-us-fitbit-labs-ehr",
      "midus-biomarker-mortality",
    ]);
    expect(output.templateBundle.candidateGuide.find((row) =>
      row.candidateId === "C2a_common_labs_only"
    )).toMatchObject({
      interpretation: "Lab-only block for isolating bloodwork signal before vitals or wearables are added.",
      modelRole: "research_candidate",
    });
    expect(output.templateBundle.candidateGuide.find((row) =>
      row.candidateId === "C3_wearable_activity_sleep_rhr_hrv_only"
    )).toMatchObject({
      interpretation: "Wearable-only block for separating wearable signal from common labs and vitals.",
      modelRole: "research_candidate",
    });
    expect(output.templateBundle.candidateGuide.find((row) =>
      row.candidateId === "C2_lab5_or_lab9_bp_body"
    )).toMatchObject({
      interpretation: "Current common_lab_core_shadow candidate for normal bloodwork and basic vitals.",
      modelRole: "research_candidate",
    });
    expect(output.templateBundle.candidateGuide.find((row) =>
      row.candidateId === "C7_wearable_coverage_quality_only_negative_control"
    )?.modelRole).toBe("negative_control");
  });

  it("blocks the handoff when the route priority is not ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1097-"));
    const paths = await writeFixtures(tmp, false);

    const { output } = await runR1097ConsumerLabWearableAggregateTemplate({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "consumer_lab_wearable_template_blocked_missing_route_or_candidate",
      nextLocalAction: "repair_consumer_route_priority_before_template",
      templateReadyForDataFill: false,
    });
    expect(output.templateBundle.baseReceiptTemplateArtifact).toBeNull();
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1097-"));
    const r1096Path = path.join(tmp, "unsafe.json");
    await writeJson(r1096Path, {
      packetId: "r1096-consumer-validation-route-priority",
      rowValuesStored: true,
      schemaVersion: "murph-age-r1096-consumer-validation-route-priority.v1",
    });

    await expect(runR1097ConsumerLabWearableAggregateTemplate({
      outputDir: path.join(tmp, "out"),
      r1096Path,
    })).rejects.toThrow("R1097 rejected unsafe r1096 input");
  });
});

async function writeFixtures(tmp: string, ready: boolean): Promise<{
  r1090Path: string;
  r1093Path: string;
  r1096Path: string;
}> {
  const paths = {
    r1090Path: path.join(tmp, "r1090.json"),
    r1093Path: path.join(tmp, "r1093.json"),
    r1096Path: path.join(tmp, "r1096.json"),
  };

  await Promise.all([
    writeJson(paths.r1090Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1090-consumer-feature-registry-state",
      schemaVersion: "murph-age-r1090-consumer-feature-registry-state.v1",
    }),
    writeJson(paths.r1093Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1093-consumer-lab-shadow-candidate-selector",
      schemaVersion: "murph-age-r1093-consumer-lab-shadow-candidate-selector.v1",
      selection: {
        candidateId: ready ? "common_lab_core_shadow" : "hold_no_lab_shadow_candidate",
      },
    }),
    writeJson(paths.r1096Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1096-consumer-validation-route-priority",
      routePriorities: ready
        ? [
          { routeId: "partner-aggregate-evaluator" },
          { routeId: "all-of-us-fitbit-labs-ehr" },
          { routeId: "midus-biomarker-mortality" },
          { routeId: "nhanes-activity-shadow-lmf" },
          { routeId: "uk-biobank-integrated" },
        ]
        : [],
      schemaVersion: "murph-age-r1096-consumer-validation-route-priority.v1",
      summary: {
        conclusion: ready
          ? "consumer_lab_wearable_validation_routes_ranked"
          : "consumer_lab_wearable_routes_blocked_missing_candidate",
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
