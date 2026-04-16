import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedDispatch,
} from "@murphai/hosted-execution";

import {
  startHostedLocalTestWorkerFixture,
  type HostedLocalTestWorkerFixture,
} from "./helpers/hosted-local-test-worker-fixture.js";

const workerPort = 8912;
const userId = "member_duplicate_commit_local_e2e";
const activationDispatch = buildHostedExecutionMemberActivatedDispatch({
  eventId: `member.activated:stripe.invoice.paid:${userId}:evt_duplicate_local_e2e`,
  firstContact: {
    channel: "linq",
    identityId: `linq:${userId}`,
    threadId: `thread:${userId}`,
    threadIsDirect: true,
  },
  memberId: userId,
  memberChannels: {
    email: false,
    linq: true,
    telegram: false,
  },
  occurredAt: new Date().toISOString(),
});

describe("hosted local duplicate commit e2e", () => {
  let workerFixture: HostedLocalTestWorkerFixture | null = null;

  beforeAll(async () => {
    workerFixture = await startHostedLocalTestWorkerFixture({
      persistDirPrefix: "murph-hosted-duplicate-commit-e2e-",
      port: workerPort,
    });
  });

  afterAll(async () => {
    await workerFixture?.dispose();
  });

  it("accepts a live duplicate committed activation when the assistant delivery fingerprint matches but the effect id rotates", async () => {
    const worker = workerFixture;
    if (worker === null) {
      throw new Error("Expected the hosted local test worker fixture to be initialized.");
    }

    await worker.client.postJson("/__test/runner/pause", {
      eventId: activationDispatch.eventId,
    });

    const dispatchPromise = worker.client.postJson("/__test/dispatch-with-outcome", activationDispatch);

    await worker.waitForRunnerPauseEntry(activationDispatch.eventId);
    await worker.client.postJson("/__test/seed-duplicate-commit", {
      eventId: activationDispatch.eventId,
      userId,
    });
    await worker.client.postJson("/__test/runner/release", {
      eventId: activationDispatch.eventId,
    });

    const dispatchResult = await dispatchPromise;
    expect(dispatchResult).toMatchObject({
      event: {
        eventId: activationDispatch.eventId,
        state: "completed",
      },
      status: {
        lastEventId: activationDispatch.eventId,
        pendingEventCount: 0,
        retryingEventId: null,
        userId,
      },
    });

    const finalStatus = await worker.client.getJson(`/__test/status?userId=${encodeURIComponent(userId)}`);
    expect(finalStatus).toMatchObject({
      lastEventId: activationDispatch.eventId,
      pendingEventCount: 0,
      retryingEventId: null,
      userId,
    });

    await worker.client.postJson("/__test/runner/clear", {
      eventId: activationDispatch.eventId,
    });
  });
});
