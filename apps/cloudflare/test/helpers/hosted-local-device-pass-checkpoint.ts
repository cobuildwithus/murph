import type { HostedRuntimeLogForTestRow } from "#hosted-web-testing";
import { expect } from "vitest";

import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";

export async function holdPositiveDeviceSyncPassCheckpoint(input: {
  fromAt: Date;
  harness: Pick<HostedLocalDevHarness,
    | "armShutdownCheckpointPublicationBarrierForTest"
    | "armForegroundPriorityOrderingObservationForTest"
    | "releaseShutdownCheckpointPublicationBarrierForTest"
    | "releaseForegroundPriorityOrderingBarrierForTest"
    | "clearForegroundPriorityOrderingObservationForTest"
  >;
  userId: string;
  waitForPreDrain: () => Promise<void>;
  waitForPublication: () => Promise<void>;
  waitForPass: (fromAt: Date) => Promise<HostedRuntimeLogForTestRow>;
}): Promise<HostedRuntimeLogForTestRow> {
  const { harness, userId } = input;
  let fromAt = input.fromAt;
  while (true) {
    // An idle checkpoint is not evidence that another device pass ran. After
    // every empty pass, let housekeeping checkpoints publish until the next
    // pass has persisted its retry fence, then gate that pass's publication.
    await input.waitForPreDrain();
    await harness
      .armShutdownCheckpointPublicationBarrierForTest(userId);
    await expect(harness
      .releaseForegroundPriorityOrderingBarrierForTest(userId))
      .resolves.toEqual({ ok: true, released: true });
    await expect(harness
      .clearForegroundPriorityOrderingObservationForTest(userId))
      .resolves.toEqual({ cleared: true, ok: true });
    await input.waitForPublication();
    const pass = await input.waitForPass(fromAt);
    const processedJobs = pass.redactedJson?.processedJobs;
    if (typeof processedJobs === "number" && Number.isFinite(processedJobs) && processedJobs > 0) {
      return pass;
    }
    expect(pass.redactedJson).toMatchObject({
      processedJobs: 0,
    });
    expect(["completed", "yielded"]).toContain(pass.redactedJson?.outcome);
    // A completed empty pass or a cooperative yield can precede job progress.
    // Publish that checkpoint so later work can establish the positive backlog
    // boundary this test requires; retaining the barrier here would deadlock it.
    await harness
      .armForegroundPriorityOrderingObservationForTest(userId, "canonical_post_commit");
    await expect(harness
      .releaseShutdownCheckpointPublicationBarrierForTest(userId))
      .resolves.toEqual({ ok: true, released: true });
    fromAt = new Date(Date.parse(pass.at) + 1);
  }
}

