import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1089LabsWearablesCandidateBatchManifest } from "./r1089-labs-wearables-candidate-batch-manifest.ts";

describe("R1089 labs/wearables candidate batch manifest", () => {
  it("queues common labs while blocking true wearable candidates until aggregate data lands", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1089-"));
    const r1088Path = path.join(tmp, "r1088.json");
    await writeJson(r1088Path, r1088Fixture("bloodwork_plus_wearable_priority_loop"));

    const { output } = await runR1089LabsWearablesCandidateBatchManifest({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      r1088Path,
    });

    expect(output.summary).toMatchObject({
      conclusion: "labs_wearables_batch_ready",
      nextLocalAction: "run_labs_wearables_shadow_batch_when_aggregate_data_available",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1089: false,
    });
    expect(output.batch.candidateFamilies.find((candidate) =>
      candidate.candidateId === "L1_glycemia_minimal_shadow"
    )?.status).toBe("queued_for_next_local_loop");
    expect(output.batch.candidateFamilies.find((candidate) =>
      candidate.candidateId === "W3_recovery_rhr_hrv_quality_gated_shadow"
    )?.status).toBe("blocked_until_true_wearable_receipt");
    expect(output.batch.candidateFamilies.find((candidate) =>
      candidate.candidateId === "I1_lab_plus_wearable_small_panel_shadow"
    )?.status).toBe("held_until_components_pass");
  });

  it("stays blocked when consumer input priority is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1089-"));
    const { output } = await runR1089LabsWearablesCandidateBatchManifest({
      outputDir: path.join(tmp, "out"),
      r1088Path: path.join(tmp, "missing-r1088.json"),
    });

    expect(output.summary.conclusion).toBe("consumer_priority_missing_or_not_ready");
    expect(output.batch.candidateFamilies.every((candidate) =>
      candidate.status === "ready_reference" || candidate.status === "held_until_components_pass"
    )).toBe(true);
  });
});

function r1088Fixture(nextAutoresearchLoop: string): Record<string, unknown> {
  return {
    artifactBoundary: {
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
    },
    packetId: "r1088-consumer-input-priority-state",
    schemaVersion: "murph-age-r1088-consumer-input-priority-state.v1",
    summary: {
      nextAutoresearchLoop,
    },
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
