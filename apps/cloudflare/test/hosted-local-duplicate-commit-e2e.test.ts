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
const stabilityUserId = "member_duplicate_commit_local_smoke_stability";
const overlapUserId = "member_overlap_claim_local_e2e";
const overlapEventId = "evt_serialized_run_loop_claim_local_e2e";
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
const stabilityActivationDispatch = buildHostedExecutionMemberActivatedDispatch({
  eventId: `member.activated:stripe.invoice.paid:${stabilityUserId}:evt_duplicate_local_smoke_stability`,
  firstContact: {
    channel: "linq",
    identityId: `linq:${stabilityUserId}`,
    threadId: `thread:${stabilityUserId}`,
    threadIsDirect: true,
  },
  memberId: stabilityUserId,
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
        state: "queued",
      },
      status: {
        pendingEventCount: 1,
        retryingEventId: activationDispatch.eventId,
        userId,
      },
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await worker.client.postJson("/__test/alarm", { userId });
    }

    const finalStatus = await worker.waitForUserStatus(
      userId,
      (status) => status.pendingEventCount === 0 && status.retryingEventId === null,
    );
    expect(finalStatus).toMatchObject({
      lastEventId: expect.stringMatching(/^alarm:/u),
      pendingEventCount: 0,
      retryingEventId: null,
      userId,
    });

    await worker.client.postJson("/__test/runner/clear", {
      eventId: activationDispatch.eventId,
    });
  });

  it("stays drained when extra alarms arrive after duplicate-commit recovery", async () => {
    const worker = workerFixture;
    if (worker === null) {
      throw new Error("Expected the hosted local test worker fixture to be initialized.");
    }

    await worker.client.postJson("/__test/runner/pause", {
      eventId: stabilityActivationDispatch.eventId,
    });

    const dispatchPromise = worker.client.postJson("/__test/dispatch-with-outcome", stabilityActivationDispatch);

    await worker.waitForRunnerPauseEntry(stabilityActivationDispatch.eventId);
    await worker.client.postJson("/__test/seed-duplicate-commit", {
      eventId: stabilityActivationDispatch.eventId,
      userId: stabilityUserId,
    });
    await worker.client.postJson("/__test/runner/release", {
      eventId: stabilityActivationDispatch.eventId,
    });

    const dispatchResult = await dispatchPromise;
    expect(dispatchResult).toMatchObject({
      event: {
        eventId: stabilityActivationDispatch.eventId,
        state: "queued",
      },
      status: {
        pendingEventCount: 1,
        retryingEventId: stabilityActivationDispatch.eventId,
        userId: stabilityUserId,
      },
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await worker.client.postJson("/__test/alarm", { userId: stabilityUserId });
    }

    const recoveredStatus = await worker.waitForUserStatus(
      stabilityUserId,
      (status) => status.pendingEventCount === 0 && status.retryingEventId === null,
    );
    expect(recoveredStatus).toMatchObject({
      lastError: null,
      pendingEventCount: 0,
      retryingEventId: null,
      userId: stabilityUserId,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await worker.client.postJson("/__test/alarm", { userId: stabilityUserId });
    }

    const stableStatus = await worker.waitForUserStatus(
      stabilityUserId,
      (status) => status.pendingEventCount === 0 && status.retryingEventId === null && status.inFlight === false,
    );
    expect(stableStatus).toMatchObject({
      lastError: null,
      pendingEventCount: 0,
      retryingEventId: null,
      userId: stabilityUserId,
    });
    expect(stableStatus.bundleRef).toEqual(recoveredStatus.bundleRef);

    await worker.client.postJson("/__test/runner/clear", {
      eventId: stabilityActivationDispatch.eventId,
    });
  });

  it("serializes overlapping run loops before the pending dispatch lease is written", async () => {
    const worker = workerFixture;
    if (worker === null) {
      throw new Error("Expected the hosted local test worker fixture to be initialized.");
    }

    const dispatch = {
      event: {
        kind: "assistant.cron.tick" as const,
        reason: "manual" as const,
        userId: overlapUserId,
      },
      eventId: overlapEventId,
      occurredAt: "2026-04-17T03:30:00.000Z",
    };

    await worker.client.postJson("/__test/bootstrap-user", {
      userId: overlapUserId,
    });
    await worker.client.postJson("/__test/runner/invocations/clear", {
      userId: overlapUserId,
    });
    await worker.client.postJson("/__test/runner/payload-read-pause", {
      dispatch,
    });

    const dispatchPromise = worker.client.postJson("/__test/dispatch-with-outcome", dispatch);
    await worker.waitForRunnerPayloadReadPauseEntry(overlapEventId);

    const alarmResult = await worker.client.postJson("/__test/alarm", {
      userId: overlapUserId,
    });
    expect(alarmResult).toMatchObject({
      ok: true,
      userId: overlapUserId,
    });

    const invocationsWhilePaused = await worker.client.getJson(
      `/__test/runner/invocations?userId=${encodeURIComponent(overlapUserId)}`,
    );
    expect(invocationsWhilePaused).toMatchObject({
      count: 0,
      eventIds: [],
    });

    await worker.client.postJson("/__test/runner/payload-read-release", {
      eventId: overlapEventId,
    });

    const dispatchResult = await dispatchPromise;
    expect(dispatchResult).toMatchObject({
      event: {
        eventId: overlapEventId,
        lastError: null,
        state: "completed",
        userId: overlapUserId,
      },
      status: {
        lastError: null,
        pendingEventCount: 0,
        retryingEventId: null,
        userId: overlapUserId,
      },
    });

    const finalStatus = await worker.waitForUserStatus(
      overlapUserId,
      (status) => status.pendingEventCount === 0 && status.retryingEventId === null,
    );
    expect(finalStatus).toMatchObject({
      lastError: null,
      pendingEventCount: 0,
      retryingEventId: null,
      userId: overlapUserId,
    });

    const finalInvocations = await worker.client.getJson(
      `/__test/runner/invocations?userId=${encodeURIComponent(overlapUserId)}`,
    );
    expect(finalInvocations).toMatchObject({
      count: 2,
      eventIds: [overlapEventId, overlapEventId],
    });

    await worker.client.postJson("/__test/runner/payload-read-clear", {
      eventId: overlapEventId,
    });
    await worker.client.postJson("/__test/runner/invocations/clear", {
      userId: overlapUserId,
    });
  });
});
