import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1094ConsumerAgeDomainApplicabilityGuard } from "./r1094-consumer-age-domain-applicability-guard.ts";

describe("R1094 consumer age-domain applicability guard", () => {
  it("keeps the common lab candidate research-only for 16-50 consumer applicability", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1094-"));
    const paths = await writeFixtures(tmp, true);

    const { output } = await runR1094ConsumerAgeDomainApplicabilityGuard({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "common_lab_shadow_candidate_allowed_for_research_not_user_age",
      nextLocalAction: "seek_young_or_all_age_lab_wearable_external_validation",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1094: false,
    });
    expect(output.applicability).toMatchObject({
      currentShadowCandidate: "common_lab_core_shadow",
      requiredEvidenceSubbands: ["16_17", "18_39", "40_50"],
      targetUserAgeBand: "roughly_16_50",
      validationGap: "candidate_sources_not_direct_young_adult_consumer_validation",
    });
    expect(output.applicability.rules.find((rule) =>
      rule.ruleId === "abstain_from_user_age_display"
    )).toMatchObject({ status: "blocking" });
    expect(output.applicability.rules.find((rule) =>
      rule.ruleId === "wearables_need_true_outcome_link"
    )).toMatchObject({ status: "blocking" });
  });

  it("does not open age-domain validation when no lab candidate was selected", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1094-"));
    const paths = await writeFixtures(tmp, false);

    const { output } = await runR1094ConsumerAgeDomainApplicabilityGuard({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "no_shadow_candidate_to_guard",
      nextLocalAction: "repair_consumer_lab_shadow_candidate_selection",
    });
    expect(output.applicability.currentShadowCandidate).toBe("none");
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1094-"));
    const r1093Path = path.join(tmp, "unsafe.json");
    await writeJson(r1093Path, {
      packetId: "r1093-consumer-lab-shadow-candidate-selector",
      rowValuesStored: true,
      schemaVersion: "murph-age-r1093-consumer-lab-shadow-candidate-selector.v1",
    });

    await expect(runR1094ConsumerAgeDomainApplicabilityGuard({
      outputDir: path.join(tmp, "out"),
      r1093Path,
    })).rejects.toThrow("R1094 rejected unsafe r1093 input");
  });
});

async function writeFixtures(tmp: string, selected: boolean): Promise<{
  r1038Path: string;
  r1044Path: string;
  r1093Path: string;
}> {
  const paths = {
    r1038Path: path.join(tmp, "r1038.json"),
    r1044Path: path.join(tmp, "r1044.json"),
    r1093Path: path.join(tmp, "r1093.json"),
  };

  await Promise.all([
    writeJson(paths.r1038Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1038-nhanes-modern-lab-activity-loop",
      schemaVersion: "murph-age-r1038-nhanes-modern-lab-activity-loop.v1",
    }),
    writeJson(paths.r1044Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1044-haalsi-external-biomarker-loop",
      schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
    }),
    writeJson(paths.r1093Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1093-consumer-lab-shadow-candidate-selector",
      schemaVersion: "murph-age-r1093-consumer-lab-shadow-candidate-selector.v1",
      selection: {
        candidateId: selected ? "common_lab_core_shadow" : "hold_no_lab_shadow_candidate",
        selectedForNextShadowRun: selected,
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
