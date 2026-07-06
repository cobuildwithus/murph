import {
  parseHostedRuntimeReconciliationFacts,
} from "@murphai/hosted-execution/parsers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const FIXED_NOW = "2026-05-20T12:00:00.000Z";
const MEMBER_ID = "member_orch_1";
const UNSAFE_SENTINEL = "UNSAFE_STATUS_SENTINEL";

const mocks = vi.hoisted(() => ({
  claimHostedAiUsageLimitNotice: vi.fn(),
  decodeHostedMailboxStoredPayload: vi.fn(),
  drainHostedLinqSideEffectsDirect: vi.fn(),
  fetch: vi.fn(),
  getPrisma: vi.fn(),
  hostedThreadContainerParticipantFindFirst: vi.fn(),
  hostedMemberFindUnique: vi.fn(),
  readHostedMailboxConsumedSeqByLane: vi.fn(),
  readHostedMailboxFirstPendingConversationItem: vi.fn(),
  readHostedMailboxMaxSeqByLane: vi.fn(),
  readHostedMailboxPayload: vi.fn(),
  readHostedMailboxPendingSystemItemsNeedAiUsageGate: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedWorkspace: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  releaseHostedAiUsageLimitNotice: vi.fn(),
  resolveHostedRuntimeAiUsageGate: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  decodeHostedMailboxStoredPayload: mocks.decodeHostedMailboxStoredPayload,
  readHostedMailboxConsumedSeqByLane: mocks.readHostedMailboxConsumedSeqByLane,
  readHostedMailboxFirstPendingConversationItem:
    mocks.readHostedMailboxFirstPendingConversationItem,
  readHostedMailboxMaxSeqByLane: mocks.readHostedMailboxMaxSeqByLane,
  readHostedMailboxPayload: mocks.readHostedMailboxPayload,
  readHostedMailboxPendingSystemItemsNeedAiUsageGate:
    mocks.readHostedMailboxPendingSystemItemsNeedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/src/lib/hosted-execution/usage-allowance")
  >();

  return {
    ...original,
    claimHostedAiUsageLimitNotice: mocks.claimHostedAiUsageLimitNotice,
    releaseHostedAiUsageLimitNotice: mocks.releaseHostedAiUsageLimitNotice,
  };
});

vi.mock("@/src/lib/hosted-onboarding/webhook-transport", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/webhook-transport")
  >();

  return {
    ...original,
    drainHostedLinqSideEffectsDirect: mocks.drainHostedLinqSideEffectsDirect,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  readHostedWorkspace: mocks.readHostedWorkspace,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-orchestration/runtime-usage-decision", () => ({
  resolveHostedRuntimeAiUsageGate: mocks.resolveHostedRuntimeAiUsageGate,
}));

type ReconciliationRoute = typeof import(
  "../app/api/internal/hosted-orchestration/users/[userId]/reconciliation-facts/route"
);

let reconciliationRoute: ReconciliationRoute;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

describe("hosted orchestration reconciliation facts", () => {
  beforeAll(async () => {
    reconciliationRoute = await import(
      "../app/api/internal/hosted-orchestration/users/[userId]/reconciliation-facts/route"
    );
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    vi.clearAllMocks();
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.getPrisma.mockReturnValue(createPrismaClientStub());
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue(MEMBER_ID);
    mocks.readHostedMemberCoreState.mockResolvedValue(buildActiveMemberRecord());
    mocks.hostedMemberFindUnique.mockResolvedValue(buildMemberAccessRecord());
    mocks.hostedThreadContainerParticipantFindFirst.mockResolvedValue(null);
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord());
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue(noMailboxBacklog());
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValue([
      {
        consumedSeq: "0",
        lane: "conversation",
      },
    ]);
    mocks.readHostedMailboxFirstPendingConversationItem.mockResolvedValue(null);
    mocks.readHostedMailboxPayload.mockResolvedValue(null);
    mocks.readHostedMailboxPendingSystemItemsNeedAiUsageGate.mockResolvedValue(false);
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(null);
    mocks.claimHostedAiUsageLimitNotice.mockResolvedValue(false);
    mocks.drainHostedLinqSideEffectsDirect.mockResolvedValue(undefined);
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 7001 } }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({ status: "allowed" });
    mocks.releaseHostedAiUsageLimitNotice.mockResolvedValue(undefined);
    vi.stubEnv("TELEGRAM_API_BASE_URL", "https://telegram.example.test/");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "telegram-token");
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns source-less reconciliation facts for mailbox lag", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        payload: UNSAFE_SENTINEL,
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "5",
      },
      {
        lane: "system",
        maxSeq: "0",
      },
    ]);

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const body = await response.json();
    const facts = parseHostedRuntimeReconciliationFacts(body);

    expect(response.status).toBe(200);
    expect(facts).toMatchObject({
      blocked: null,
      workspace: {
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: null,
        nextWakeReason: null,
        version: "4",
      },
    });
    expect(facts.mailboxLag).toEqual([
      {
        importedSeq: "2",
        lag: "3",
        lane: "conversation",
        maxSeq: "5",
      },
      {
        importedSeq: "0",
        lag: "0",
        lane: "system",
        maxSeq: "0",
      },
    ]);
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "mutating",
      now: new Date(FIXED_NOW),
      userId: MEMBER_ID,
    });
    expect(JSON.stringify(body)).not.toContain("redactedStatus");
    expect(JSON.stringify(body)).not.toContain(UNSAFE_SENTINEL);
    expect(JSON.stringify(body)).not.toMatch(/payload|message|transcript|source/u);
  });

  it("logs one metadata-only reconciliation record", async () => {
    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "Hosted runtime reconciliation facts.",
      {
        blockedReason: null,
        component: "hosted.orchestration.reconciliation",
        conversationLagPresent: false,
        decisionSource: "workflow",
        mailboxLagLaneCount: 2,
        retryAtPresent: false,
        schema: "murph.hosted-runtime.reconciliation-facts.v1",
        status: "idle",
        usageGateRequired: false,
        usageGateStatus: "not_required",
        userIdPresent: true,
        workspaceInboxMediaRetentionWakeAtPresent: false,
        workspaceNextWakeAtPresent: false,
        workspaceNextWakeReason: null,
        workspacePresent: true,
      },
    );
    const loggedMetadata = consoleInfoSpy.mock.calls[0]?.[1];
    expect(JSON.stringify(loggedMetadata)).not.toMatch(
      /payload|body|prompt|message|transcript|redactedStatus/u,
    );
    expect(JSON.stringify(loggedMetadata)).not.toContain(MEMBER_ID);
  });

  it("gates any pending manual system mailbox item behind non-gated system work", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "0",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "0",
      },
      {
        lane: "system",
        maxSeq: "1",
      },
    ]);
    mocks.readHostedMailboxPendingSystemItemsNeedAiUsageGate
      .mockResolvedValue(true);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: buildDeniedUsageGateDecision(),
      status: "denied",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: null,
    });
    expect(mocks.readHostedMailboxPendingSystemItemsNeedAiUsageGate)
      .toHaveBeenCalledWith({
        afterSeq: "0",
        prisma: expect.objectContaining({ kind: "prisma" }),
        userId: MEMBER_ID,
      });
    expect(mocks.readHostedMailboxFirstPendingConversationItem).not.toHaveBeenCalled();
    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
  });

  it("does not AI-gate a due inbox media retention wake", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      inboxMediaRetentionWakeAt: FIXED_NOW,
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "2",
      },
      {
        lane: "system",
        maxSeq: "0",
      },
    ]);

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toBeNull();
    expect(facts.workspace).toMatchObject({
      inboxMediaRetentionWakeAt: FIXED_NOW,
      nextWakeAt: null,
      nextWakeReason: null,
    });
    expect(facts.mailboxLag).toEqual([
      {
        importedSeq: "2",
        lag: "0",
        lane: "conversation",
        maxSeq: "2",
      },
      {
        importedSeq: "0",
        lag: "0",
        lane: "system",
        maxSeq: "0",
      },
    ]);
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxFirstPendingConversationItem).not.toHaveBeenCalled();
    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
  });

  it("AI-gates pending system work even when inbox media retention is due", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      inboxMediaRetentionWakeAt: FIXED_NOW,
      redactedStatusJson: {
        conversationImportedSeq: "0",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "0",
      },
      {
        lane: "system",
        maxSeq: "1",
      },
    ]);
    mocks.readHostedMailboxPendingSystemItemsNeedAiUsageGate
      .mockResolvedValue(true);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: buildDeniedUsageGateDecision(),
      status: "denied",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: null,
    });
    expect(facts.workspace).toMatchObject({
      inboxMediaRetentionWakeAt: FIXED_NOW,
    });
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "mutating",
      now: new Date(FIXED_NOW),
      userId: MEMBER_ID,
    });
  });

  it("preserves inactive workspace retention clocks for retention-only workflow dispatch", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue(buildActiveMemberRecord({
      billingStatus: "canceled",
    }));
    mocks.hostedMemberFindUnique.mockResolvedValue(buildMemberAccessRecord({
      billingStatus: "canceled",
    }));
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      inboxMediaRetentionWakeAt: FIXED_NOW,
    }));

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "user_not_active",
      retryAt: null,
    });
    expect(facts.workspace).toMatchObject({
      inboxMediaRetentionWakeAt: FIXED_NOW,
      version: "4",
    });
    expect(mocks.readHostedMailboxMaxSeqByLane).not.toHaveBeenCalled();
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
  });

  it("AI-gates fresh conversation work before a due inbox media retention wake", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      inboxMediaRetentionWakeAt: FIXED_NOW,
      nextWakeAt: FIXED_NOW,
      nextWakeReason: "assistant_due",
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "3",
      },
      {
        lane: "system",
        maxSeq: "0",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      retryAt: "2026-05-20T12:00:30.000Z",
      status: "unavailable",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "ai_usage_gate_unavailable",
      retryAt: "2026-05-20T12:00:30.000Z",
    });
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "mutating",
      now: new Date(FIXED_NOW),
      userId: MEMBER_ID,
    });
  });

  it("keeps a future inbox media retention wake when assistant work is AI-denied", async () => {
    const retentionWakeAt = "2026-05-20T12:14:00.000Z";
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      inboxMediaRetentionWakeAt: retentionWakeAt,
      nextWakeAt: FIXED_NOW,
      nextWakeReason: "assistant_due",
    }));
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: buildDeniedUsageGateDecision(),
      status: "denied",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: retentionWakeAt,
    });
    expect(facts.workspace).toMatchObject({
      inboxMediaRetentionWakeAt: retentionWakeAt,
      nextWakeAt: FIXED_NOW,
      nextWakeReason: "assistant_due",
    });
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "mutating",
      now: new Date(FIXED_NOW),
      userId: MEMBER_ID,
    });
    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
  });

  it("sends the current-chat Linq usage-limit notice when pending conversation work is runtime-denied", async () => {
    const deniedDecision = buildDeniedUsageGateDecision();
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "3",
      },
      {
        lane: "system",
        maxSeq: "0",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: deniedDecision,
      status: "denied",
    });
    mocks.readHostedMailboxFirstPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:line_runtime_denied",
      channel: "linq" as const,
      containerMemberId: MEMBER_ID,
      threadId: "chat_runtime_denied",
    };
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildLinqConversationWake({
      routeAuthority,
    }));
    mocks.claimHostedAiUsageLimitNotice.mockResolvedValue(true);

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: null,
    });
    expect(mocks.readHostedMailboxFirstPendingConversationItem).toHaveBeenCalledWith({
      afterSeq: "2",
      prisma: expect.objectContaining({ kind: "prisma" }),
      userId: MEMBER_ID,
    });
    expect(mocks.claimHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
      prisma: expect.objectContaining({ kind: "prisma" }),
      sentAt: new Date(FIXED_NOW),
    });
    expect(mocks.drainHostedLinqSideEffectsDirect).toHaveBeenCalledWith({
      prisma: expect.objectContaining({ kind: "prisma" }),
      sideEffects: [
        expect.objectContaining({
          payload: expect.objectContaining({
            chatId: "chat_runtime_denied",
            memberId: MEMBER_ID,
            message: deniedDecision.userNotice.message,
            noticeCode: deniedDecision.userNotice.code,
            replyToMessageId: "msg_runtime_denied",
            routeAuthority,
            template: "ai_usage_quota",
          }),
        }),
      ],
    });
    const linqDrainInput = mocks.drainHostedLinqSideEffectsDirect.mock.calls[0]?.[0];
    expect(linqDrainInput).not.toHaveProperty("currentInboundReply");
  });

  it("sends the current-chat Telegram usage-limit notice when pending conversation work is runtime-denied", async () => {
    const deniedDecision = buildDeniedUsageGateDecision();
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "3",
      },
      {
        lane: "system",
        maxSeq: "0",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: deniedDecision,
      status: "denied",
    });
    mocks.readHostedMailboxFirstPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.claimHostedAiUsageLimitNotice.mockResolvedValue(true);

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: null,
    });
    expect(mocks.claimHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
      prisma: expect.objectContaining({ kind: "prisma" }),
      sentAt: new Date(FIXED_NOW),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://telegram.example.test/bottelegram-token/sendMessage");
    expect(init).toMatchObject({
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      business_connection_id: "biz-42",
      chat_id: "telegram_chat_runtime_denied",
      direct_messages_topic_id: 9,
      reply_to_message_id: 7000,
      text: deniedDecision.userNotice.message,
    });
    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
  });

  it("releases the Telegram usage-limit notice claim when provider delivery fails", async () => {
    const deniedDecision = buildDeniedUsageGateDecision();
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "3",
      },
      {
        lane: "system",
        maxSeq: "0",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: deniedDecision,
      status: "denied",
    });
    mocks.readHostedMailboxFirstPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.claimHostedAiUsageLimitNotice.mockResolvedValue(true);
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          description: "Forbidden: bot was blocked by the user",
          error_code: 403,
          ok: false,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 403,
        },
      ),
    );

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    consoleErrorSpy.mockRestore();

    expect(response.status).toBe(500);
    expect(mocks.releaseHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
      prisma: expect.objectContaining({ kind: "prisma" }),
      sentAt: new Date(FIXED_NOW),
    });
  });

  it("does not send a current-chat usage-limit notice for email runtime denial", async () => {
    const deniedDecision = buildDeniedUsageGateDecision();
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "3",
      },
      {
        lane: "system",
        maxSeq: "0",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: deniedDecision,
      status: "denied",
    });
    mocks.readHostedMailboxFirstPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildEmailConversationWake());

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: null,
    });
    expect(mocks.claimHostedAiUsageLimitNotice).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
  });

  it("does not claim the Telegram usage-limit notice when Telegram delivery is unconfigured", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const deniedDecision = buildDeniedUsageGateDecision();
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "3",
      },
      {
        lane: "system",
        maxSeq: "0",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: deniedDecision,
      status: "denied",
    });
    mocks.readHostedMailboxFirstPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: null,
    });
    expect(mocks.claimHostedAiUsageLimitNotice).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
  });

  it("does not gate replay-only conversation lag above local import but at or below consumed", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "0",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "250",
      },
      {
        lane: "system",
        maxSeq: "1",
      },
    ]);
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValue([
      {
        consumedSeq: "250",
        lane: "conversation",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: buildDeniedUsageGateDecision(),
      status: "denied",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toBeNull();
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxPendingSystemItemsNeedAiUsageGate)
      .toHaveBeenCalledWith({
        afterSeq: "0",
        prisma: expect.objectContaining({ kind: "prisma" }),
        userId: MEMBER_ID,
      });
    expect(mocks.readHostedMailboxFirstPendingConversationItem).not.toHaveBeenCalled();
  });

  it("selects usage-limit notice conversations above the consumed replay floor", async () => {
    const deniedDecision = buildDeniedUsageGateDecision();
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "0",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "251",
      },
      {
        lane: "system",
        maxSeq: "0",
      },
    ]);
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValue([
      {
        consumedSeq: "250",
        lane: "conversation",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: deniedDecision,
      status: "denied",
    });
    mocks.readHostedMailboxFirstPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem({
        laneSeq: "251",
      }),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildLinqConversationWake());
    mocks.claimHostedAiUsageLimitNotice.mockResolvedValue(true);

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: null,
    });
    expect(mocks.readHostedMailboxFirstPendingConversationItem).toHaveBeenCalledWith({
      afterSeq: "250",
      prisma: expect.objectContaining({ kind: "prisma" }),
      userId: MEMBER_ID,
    });
  });

  it("does not send a current-chat Linq usage-limit notice for read-only status checks", async () => {
    const deniedDecision = buildDeniedUsageGateDecision();
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "3",
      },
      {
        lane: "system",
        maxSeq: "0",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: deniedDecision,
      status: "denied",
    });

    const {
      readHostedRuntimeReconciliationFacts,
    } = await import("../src/lib/hosted-orchestration/runtime-reconciliation-facts");
    const facts = await readHostedRuntimeReconciliationFacts({
      decisionSource: "status",
      usageGateMode: "read_only",
      userId: MEMBER_ID,
    });

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: null,
    });
    expect(mocks.readHostedMailboxFirstPendingConversationItem).not.toHaveBeenCalled();
    expect(mocks.claimHostedAiUsageLimitNotice).not.toHaveBeenCalled();
    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
  });

  it("does not gate future model-capable workspace wakes", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T12:05:00.000Z",
      nextWakeReason: "assistant_due",
    }));

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toBeNull();
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
  });

  it("does not block thread-container runtime facts when an active participant keeps an inactive-owner group alive", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue(buildMemberAccessRecord({
      billingStatus: "not_started",
      threadContainer: {
        owner: {
          accountGroupMemberships: [],
          billingStatus: "paused",
          suspendedAt: null,
        },
      },
    }));
    mocks.hostedThreadContainerParticipantFindFirst.mockResolvedValue({
      participantMemberId: "member_active_participant",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toBeNull();
    expect(mocks.hostedThreadContainerParticipantFindFirst).toHaveBeenCalledWith({
      select: {
        participantMemberId: true,
      },
      where: expect.objectContaining({
        containerMemberId: MEMBER_ID,
        removedAt: null,
      }),
    });
  });

  it("gates due model-capable workspace wakes", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:59:59.000Z",
      nextWakeReason: "assistant_due",
    }));
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      retryAt: "2026-05-20T12:00:30.000Z",
      status: "unavailable",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_gate_unavailable",
      retryAt: "2026-05-20T12:00:30.000Z",
    });
  });

  it("blocks inactive members while preserving workspace facts", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue(buildActiveMemberRecord({
      billingStatus: "paused",
    }));
    mocks.hostedMemberFindUnique.mockResolvedValue(buildMemberAccessRecord({
      billingStatus: "paused",
    }));

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts).toEqual({
      blocked: {
        reason: "user_not_active",
        retryAt: null,
      },
      mailboxLag: [],
      workspace: {
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: null,
        nextWakeReason: null,
        version: "4",
      },
    });
    expect(mocks.readHostedMailboxMaxSeqByLane).not.toHaveBeenCalled();
  });
});

function requestForFacts(): Request {
  return new Request(
    `https://join.example.test/api/internal/hosted-orchestration/users/${
      encodeURIComponent(MEMBER_ID)
    }/reconciliation-facts`,
    { method: "GET" },
  );
}

function buildDeniedUsageGateDecision() {
  return {
    allowed: false,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER_ID,
    periodEnd: new Date("2026-07-01T00:00:00.000Z"),
    periodStart: new Date("2026-06-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-07-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_001n,
    userNotice: {
      code: "edge_usage_limit_reached",
      message: "You hit your monthly Murph AI limit.",
    },
  };
}

function buildPendingConversationItem(overrides: Partial<{
  laneSeq: string;
}> = {}) {
  return {
    createdAt: FIXED_NOW,
    dedupeKey: "linq_event_runtime_denied",
    expiresAt: null,
    id: "mailbox_runtime_denied",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: overrides.laneSeq ?? "3",
    occurredAt: FIXED_NOW,
    payloadBytes: 256,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox.item.v1",
    updatedAt: FIXED_NOW,
    userId: MEMBER_ID,
  };
}

function buildLinqConversationWake(overrides: Partial<{
  routeAuthority: {
    accountLookupKey: string;
    channel: "linq";
    containerMemberId: string;
    threadId: string;
  } | null;
}> = {}) {
  return {
    eventId: "linq_event_runtime_denied",
    kind: "conversation.message",
    message: {
      channel: "linq",
      contactKind: "phone",
      contactLookupKey: "contact_lookup",
      linqMessage: {
        chatId: "chat_runtime_denied",
        from: "+15550000000",
        isFromMe: false,
        messageId: "msg_runtime_denied",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      phoneLookupKey: "contact_lookup",
      ...(overrides.routeAuthority === undefined
        ? {}
        : { routeAuthority: overrides.routeAuthority }),
    },
    occurredAt: FIXED_NOW,
    userId: MEMBER_ID,
  };
}

function buildTelegramConversationWake() {
  return {
    eventId: "telegram_event_runtime_denied",
    kind: "conversation.message",
    message: {
      channel: "telegram",
      telegramMessage: {
        messageId: "7000",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "telegram_chat_runtime_denied:business:biz-42:dm-topic:9",
      },
    },
    occurredAt: FIXED_NOW,
    userId: MEMBER_ID,
  };
}

function buildEmailConversationWake() {
  return {
    eventId: "email_event_runtime_denied",
    kind: "conversation.message",
    message: {
      channel: "email",
      identityId: "identity_email_runtime_denied",
      messageId: "email_message_runtime_denied",
      rawMessageKey: "raw_email_runtime_denied",
      threadTarget: "thread_email_runtime_denied",
    },
    occurredAt: FIXED_NOW,
    userId: MEMBER_ID,
  };
}

function routeContext(): { params: Promise<{ userId: string }> } {
  return {
    params: Promise.resolve({
      userId: MEMBER_ID,
    }),
  };
}

function noMailboxBacklog() {
  return [
    {
      lane: "system",
      maxSeq: "0",
    },
    {
      lane: "conversation",
      maxSeq: "0",
    },
  ];
}

function buildActiveMemberRecord(overrides: Partial<{
  billingStatus: string;
  suspendedAt: Date | null;
}> = {}) {
  return {
    billingStatus: "active",
    createdAt: new Date(FIXED_NOW),
    id: MEMBER_ID,
    suspendedAt: null,
    updatedAt: new Date(FIXED_NOW),
    ...overrides,
  };
}

function createPrismaClientStub() {
  return {
    hostedAccountGroupMembership: {
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => null),
    },
    hostedMember: {
      findUnique: mocks.hostedMemberFindUnique,
    },
    hostedThreadContainerParticipant: {
      findFirst: mocks.hostedThreadContainerParticipantFindFirst,
    },
    kind: "prisma",
  };
}

function buildMemberAccessRecord(overrides: Partial<{
  accountGroupMemberships: Array<{
    status: string;
    group: {
      billingStatus: string;
      suspendedAt: Date | null;
    };
  }>;
  billingStatus: string;
  suspendedAt: Date | null;
  threadContainer: unknown;
}> = {}) {
  return {
    accountGroupMemberships: [],
    billingStatus: "active",
    suspendedAt: null,
    threadContainer: null,
    ...overrides,
  };
}

function buildWorkspaceRecord(overrides: Partial<{
  browserVaultReplicaRef: Record<string, unknown> | null;
  checkpointedAt: string | null;
  createdAt: string;
  inboxMediaRetentionWakeAt: string | null;
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  redactedStatusJson: Record<string, unknown> | null;
  snapshotRef: Record<string, unknown> | null;
  updatedAt: string;
  userId: string;
  version: string;
}> = {}) {
  return {
    browserVaultReplicaRef: null,
    checkpointedAt: FIXED_NOW,
    createdAt: FIXED_NOW,
    inboxMediaRetentionWakeAt: null,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: {
      conversationImportedSeq: "0",
      systemImportedSeq: "0",
    },
    snapshotRef: {
      hash: "snapshot_hash",
      key: "snapshot/object",
      size: 128,
      updatedAt: FIXED_NOW,
    },
    updatedAt: FIXED_NOW,
    userId: MEMBER_ID,
    version: "4",
    ...overrides,
  };
}
