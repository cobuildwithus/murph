import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";

import {
  startHostedLocalTestWorkerFixture,
  type HostedLocalTestWorkerFixture,
} from "./helpers/hosted-local-test-worker-fixture.js";

const userId = "member_duplicate_commit_local_e2e";
const stabilityUserId = "member_duplicate_commit_local_smoke_stability";
const overlapUserId = "member_overlap_claim_local_e2e";
const overlapEventId = "evt_serialized_run_loop_claim_local_e2e";
const invalidBundleUserId = "member_invalid_bundle_observability_local_e2e";
const invalidBundleActivationWake = buildHostedExecutionMemberActivatedWake({
  eventId: `member.activated:stripe.invoice.paid:${invalidBundleUserId}:evt_invalid_bundle_local_e2e`,
  memberId: invalidBundleUserId,
  memberChannels: {
    email: false,
    linq: true,
    telegram: false,
  },
  occurredAt: new Date().toISOString(),
});
const activationWake = buildHostedExecutionMemberActivatedWake({
  eventId: `member.activated:stripe.invoice.paid:${userId}:evt_duplicate_local_e2e`,
  memberId: userId,
  memberChannels: {
    email: false,
    linq: true,
    telegram: false,
  },
  occurredAt: new Date().toISOString(),
});
const stabilityActivationWake = buildHostedExecutionMemberActivatedWake({
  eventId: `member.activated:stripe.invoice.paid:${stabilityUserId}:evt_duplicate_local_smoke_stability`,
  memberId: stabilityUserId,
  memberChannels: {
    email: false,
    linq: true,
    telegram: false,
  },
  occurredAt: new Date().toISOString(),
});

describe("hosted local duplicate-commit worker-only e2e", () => {
  let workerFixture: HostedLocalTestWorkerFixture | null = null;

  beforeAll(async () => {
    workerFixture = await startHostedLocalTestWorkerFixture({
      persistDirPrefix: "murph-hosted-duplicate-commit-e2e-",
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
      eventId: activationWake.eventId,
    });

    const dispatchPromise = worker.client.postJson("/__test/wake-with-outcome", activationWake);

    await worker.waitForRunnerPauseEntry(activationWake.eventId);
    await worker.client.postJson("/__test/seed-duplicate-commit", {
      eventId: activationWake.eventId,
      userId,
    });
    await worker.client.postJson("/__test/runner/release", {
      eventId: activationWake.eventId,
    });

    const dispatchResult = await dispatchPromise;
    expect(dispatchResult).toMatchObject({
      event: {
        eventId: activationWake.eventId,
        state: "completed",
      },
      status: {
        pendingIngressEventCount: 0,
        userId,
      },
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await worker.client.postJson("/__test/alarm", { userId });
    }

    const finalStatus = await worker.waitForUserStatus(
      userId,
      (status) => status.pendingIngressEventCount === 0,
    );
    expect(finalStatus).toMatchObject({
      lastEventId: expect.stringMatching(/^hosted-run:/),
      pendingIngressEventCount: 0,
      userId,
    });

    await worker.client.postJson("/__test/runner/clear", {
      eventId: activationWake.eventId,
    });
  });

  it("stays drained when extra alarms arrive after duplicate-commit recovery", async () => {
    const worker = workerFixture;
    if (worker === null) {
      throw new Error("Expected the hosted local test worker fixture to be initialized.");
    }

    await worker.client.postJson("/__test/runner/pause", {
      eventId: stabilityActivationWake.eventId,
    });

    const dispatchPromise = worker.client.postJson("/__test/wake-with-outcome", stabilityActivationWake);

    await worker.waitForRunnerPauseEntry(stabilityActivationWake.eventId);
    await worker.client.postJson("/__test/seed-duplicate-commit", {
      eventId: stabilityActivationWake.eventId,
      userId: stabilityUserId,
    });
    await worker.client.postJson("/__test/runner/release", {
      eventId: stabilityActivationWake.eventId,
    });

    const dispatchResult = await dispatchPromise;
    expect(dispatchResult).toMatchObject({
      event: {
        eventId: stabilityActivationWake.eventId,
        state: "completed",
      },
      status: {
        pendingIngressEventCount: 0,
        userId: stabilityUserId,
      },
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await worker.client.postJson("/__test/alarm", { userId: stabilityUserId });
    }

    const recoveredStatus = await worker.waitForUserStatus(
      stabilityUserId,
      (status) => status.pendingIngressEventCount === 0,
    );
    expect(recoveredStatus).toMatchObject({
      lastError: null,
      pendingIngressEventCount: 0,
      userId: stabilityUserId,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await worker.client.postJson("/__test/alarm", { userId: stabilityUserId });
    }

    const stableStatus = await worker.waitForUserStatus(
      stabilityUserId,
      (status) => status.pendingIngressEventCount === 0 && status.inFlight === false,
    );
    expect(stableStatus).toMatchObject({
      lastError: null,
      pendingIngressEventCount: 0,
      userId: stabilityUserId,
    });
    expect(stableStatus.bundleRef).toEqual(recoveredStatus.bundleRef);

    await worker.client.postJson("/__test/runner/clear", {
      eventId: stabilityActivationWake.eventId,
    });
  });

  it("serializes overlapping run loops before the pending dispatch lease is written", async () => {
    const worker = workerFixture;
    if (worker === null) {
      throw new Error("Expected the hosted local test worker fixture to be initialized.");
    }

    const wake = buildHostedExecutionRuntimeTimerWake({
      eventId: overlapEventId,
      occurredAt: "2026-04-17T03:30:00.000Z",
      triggerKind: "runtime_timer",
      userId: overlapUserId,
    });

    await worker.client.postJson("/__test/bootstrap-user", {
      userId: overlapUserId,
    });
    await worker.client.postJson("/__test/runner/invocations/clear", {
      userId: overlapUserId,
    });
    await worker.client.postJson("/__test/runner/pause", {
      eventId: overlapEventId,
    });

    const dispatchPromise = worker.client.postJson("/__test/wake-with-outcome", wake);
    await worker.waitForRunnerPauseEntry(overlapEventId);

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
      count: 1,
      eventIds: [overlapEventId],
    });

    await worker.client.postJson("/__test/runner/release", {
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
        pendingIngressEventCount: 0,
        userId: overlapUserId,
      },
    });

    const finalStatus = await worker.waitForUserStatus(
      overlapUserId,
      (status) => status.pendingIngressEventCount === 0,
    );
    expect(finalStatus).toMatchObject({
      lastError: null,
      pendingIngressEventCount: 0,
      userId: overlapUserId,
    });

    const finalInvocations = await worker.client.getJson(
      `/__test/runner/invocations?userId=${encodeURIComponent(overlapUserId)}`,
    );
    expect(finalInvocations).toMatchObject({
      count: 2,
      eventIds: [overlapEventId, overlapEventId],
    });

    await worker.client.postJson("/__test/runner/invocations/clear", {
      userId: overlapUserId,
    });
  });

  it("records actionable hosted-run diagnostics when the runner returns an invalid bundle archive", async () => {
    const worker = workerFixture;
    if (worker === null) {
      throw new Error("Expected the hosted local test worker fixture to be initialized.");
    }

    await worker.client.postJson("/__test/runner/invocations/clear", {
      userId: invalidBundleUserId,
    });
    await worker.client.postJson("/__test/runner/output-bundle-fault", {
      invocations: 1,
      userId: invalidBundleUserId,
    });

    const dispatchResult = await worker.client.postJson(
      "/__test/wake-with-outcome",
      invalidBundleActivationWake,
    );
    expect(dispatchResult).toMatchObject({
      event: {
        eventId: invalidBundleActivationWake.eventId,
        state: "queued",
        userId: invalidBundleUserId,
      },
      status: {
        lastError: "Hosted bundle archive validation failed.",
        lastErrorCode: "bundle_archive_validation_error",
        pendingIngressEventCount: 1,
        userId: invalidBundleUserId,
      },
    });

    const invalidBundleLog = await waitForHostedRunLog(
      worker,
      invalidBundleUserId,
      (log) => (
        log.message === "Cloudflare runner invocation failed while preparing the hosted run snapshot."
        && isRecord(log.redacted)
        && log.redacted.errorCode === "bundle_archive_validation_error"
        && typeof log.redacted.assistantNotificationErrorDetail === "string"
        && log.redacted.assistantNotificationErrorDetail.includes("HostedBundleArchiveValidationError")
      ),
    );
    expect(invalidBundleLog.message).not.toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(invalidBundleLog.phase).toBe("runtime_failed");
    expect(invalidBundleLog.redacted).toMatchObject({
      errorCode: "bundle_archive_validation_error",
      errorMessage: "Hosted bundle archive validation failed.",
      reason: "runner_invocation_failed",
    });
    expect(invalidBundleLog.redacted).toMatchObject({
      assistantNotificationErrorCode: "bundle_archive_validation_error",
      assistantNotificationErrorDetail: expect.stringContaining("HostedBundleArchiveValidationError"),
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await worker.client.postJson("/__test/alarm", {
        userId: invalidBundleUserId,
      });
    }

    const recoveredStatus = await worker.waitForUserStatus(
      invalidBundleUserId,
      (status) => status.pendingIngressEventCount === 0 && status.lastError === null,
    );
    expect(recoveredStatus).toMatchObject({
      lastError: null,
      pendingIngressEventCount: 0,
      userId: invalidBundleUserId,
    });

    const finalInvocations = await worker.client.getJson(
      `/__test/runner/invocations?userId=${encodeURIComponent(invalidBundleUserId)}`,
    );
    expect(finalInvocations).toMatchObject({
      count: 3,
      eventIds: [
        invalidBundleActivationWake.eventId,
        invalidBundleActivationWake.eventId,
        expect.stringMatching(/^hosted-run:/u),
      ],
    });

    await worker.client.postJson("/__test/runner/output-bundle-fault/clear", {
      userId: invalidBundleUserId,
    });
    await worker.client.postJson("/__test/runner/invocations/clear", {
      userId: invalidBundleUserId,
    });
  });
});

async function waitForHostedRunLog(
  worker: HostedLocalTestWorkerFixture,
  userId: string,
  predicate: (log: Awaited<ReturnType<HostedLocalTestWorkerFixture["getHostedRunLogs"]>>[number]) => boolean,
): Promise<Awaited<ReturnType<HostedLocalTestWorkerFixture["getHostedRunLogs"]>>[number]> {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < 30_000) {
    const logs = await worker.getHostedRunLogs(userId);
    const log = logs.find(predicate);
    if (log) {
      return log;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for hosted run log for ${userId}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
