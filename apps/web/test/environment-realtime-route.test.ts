import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  createEnvironmentRealtimeCall: vi.fn(),
  hasPendingHostedEnvironmentInterviewMailboxItem: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readPendingHostedEnvironmentInterviewMailboxItem: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  resolveHostedRuntimeAiUsageGate: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

const transaction = vi.fn(async (callback: (tx: {
  hostedMember: {
    findUnique: () => Promise<{ suspendedAt: null }>;
  };
}) => Promise<unknown>) =>
  await callback({
    hostedMember: {
      findUnique: async () => ({ suspendedAt: null }),
    },
  })
);

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: () => ({
    createEnvironmentRealtimeCall: mocks.createEnvironmentRealtimeCall,
  }),
}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  hasPendingHostedEnvironmentInterviewMailboxItem:
    mocks.hasPendingHostedEnvironmentInterviewMailboxItem,
  readPendingHostedEnvironmentInterviewMailboxItem:
    mocks.readPendingHostedEnvironmentInterviewMailboxItem,
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
}));
vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: {},
  lockHostedMemberRow: mocks.lockHostedMemberRow,
}));
vi.mock("@/src/lib/hosted-orchestration/runtime-usage-decision", () => ({
  resolveHostedRuntimeAiUsageGate: mocks.resolveHostedRuntimeAiUsageGate,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ $transaction: transaction }),
}));

import { POST as createRealtimeCall } from "../app/api/environment/realtime/route";
import {
  GET as readTopicProcessing,
  PATCH as recheckTopicProcessing,
  POST as saveTopics,
} from "../app/api/environment/realtime/topics/route";
import {
  buildEnvironmentVoiceScriptForGroup,
} from "../app/(dashboard)/environment/environment-voice-script";

describe("Environment Realtime routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_123" },
    });
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({ status: "allowed" });
    mocks.createEnvironmentRealtimeCall.mockResolvedValue({
      sdp: "v=0\r\nanswer",
    });
    mocks.hasPendingHostedEnvironmentInterviewMailboxItem.mockResolvedValue(false);
    mocks.readPendingHostedEnvironmentInterviewMailboxItem.mockResolvedValue(null);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      duplicate: false,
      item: { id: "mailbox_123" },
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue(undefined);
  });

  it("forwards an authenticated SDP offer without exposing provider credentials", async () => {
    const request = new Request(
      "https://local.withmurph.ai/api/environment/realtime",
      {
        body: "v=0\r\noffer",
        headers: { "content-type": "application/sdp" },
        method: "POST",
      },
    );

    const response = await createRealtimeCall(request);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("v=0\r\nanswer");
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.createEnvironmentRealtimeCall).toHaveBeenCalledWith({
      sdp: "v=0\r\noffer",
      userId: "member_123",
    });
  });

  it("rejects invalid SDP before calling the control plane", async () => {
    const response = await createRealtimeCall(new Request(
      "https://local.withmurph.ai/api/environment/realtime",
      {
        body: "not-sdp",
        headers: { "content-type": "application/sdp" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(400);
    expect(mocks.createEnvironmentRealtimeCall).not.toHaveBeenCalled();
  });

  it("queues validated topic facts through the canonical mailbox owner", async () => {
    const completedAt = new Date().toISOString();
    const request = new Request(
      "https://local.withmurph.ai/api/environment/realtime/topics",
      {
        body: JSON.stringify({
          completedAt,
          completionId: "550e8400-e29b-41d4-a716-446655440000",
          topics: [
            {
              answers: [
                {
                  aspectId: "sleep-environment",
                  indicatorId: "night_temp_c",
                  note: "The bedroom stays near 19 degrees at night.",
                  value: 19,
                },
              ],
              topicId: "sleep:0",
            },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await saveTopics(request);

    expect(response.status).toBe(202);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "environment-interview.completed",
        userId: "member_123",
      }),
      tx: expect.any(Object),
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_123",
    });
  });

  it("accepts the topic id emitted by a category voice script", async () => {
    const script = buildEnvironmentVoiceScriptForGroup("sleep", {});
    const topicId = script?.topics[0]?.id;
    expect(topicId).toBe("sleep:0");
    const completedAt = new Date().toISOString();

    const response = await saveTopics(new Request(
      "https://local.withmurph.ai/api/environment/realtime/topics",
      {
        body: JSON.stringify({
          completedAt,
          completionId: "550e8400-e29b-41d4-a716-446655440001",
          topics: [{
            answers: [{
              aspectId: "sleep-environment",
              indicatorId: "night_temp_c",
              value: 19,
            }],
            topicId,
          }],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(202);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledOnce();
  });

  it("reports and re-signals pending topic work", async () => {
    mocks.hasPendingHostedEnvironmentInterviewMailboxItem.mockResolvedValue(true);
    mocks.readPendingHostedEnvironmentInterviewMailboxItem.mockResolvedValue({
      id: "mailbox_123",
    });

    const status = await readTopicProcessing(new Request(
      "https://local.withmurph.ai/api/environment/realtime/topics",
    ));
    const recheckRequest = new Request(
      "https://local.withmurph.ai/api/environment/realtime/topics",
      { method: "PATCH" },
    );
    const recheck = await recheckTopicProcessing(recheckRequest);

    await expect(status.json()).resolves.toEqual({ processing: true });
    await expect(recheck.json()).resolves.toEqual({
      processing: true,
      recheckRequested: true,
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
      recheckRequest,
    );
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_123",
    });
  });
});
