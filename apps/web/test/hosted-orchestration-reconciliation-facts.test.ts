import {
  parseHostedRuntimeReconciliationFacts,
} from "@murphai/hosted-execution/parsers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";

const FIXED_NOW = "2026-05-20T12:00:00.000Z";
const MEMBER_ID = "member_orch_1";
const UNSAFE_SENTINEL = "UNSAFE_STATUS_SENTINEL";

const mocks = vi.hoisted(() => ({
  claimHostedAiUsageLimitNoticeDeliveryTx: vi.fn(),
  decodeHostedMailboxStoredPayload: vi.fn(),
  fetch: vi.fn(),
  getPrisma: vi.fn(),
  hasHostedLinqInboundWithinDays: vi.fn(),
  hasHostedMemberEstablishedLinqThreadRoute: vi.fn(),
  hasHostedMemberEstablishedLinqHomeRoute: vi.fn(),
  hostedThreadContainerParticipantFindFirst: vi.fn(),
  hostedMemberFindUnique: vi.fn(),
  readHostedMailboxConsumedSeqByLane: vi.fn(),
  readHostedMailboxLatestPendingConversationItem: vi.fn(),
  readHostedMailboxMaxSeqByLane: vi.fn(),
  readHostedMailboxPayload: vi.fn(),
  readHostedMailboxPendingSystemItemsNeedAiUsageGate: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedWorkspace: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  markHostedLinqDeliveryAcceptedTx: vi.fn(),
  markHostedLinqDeliveryProviderDispatchStartedTx: vi.fn(),
  markHostedLinqDeliverySendFailedTx: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  readCloudflareHostedControlHttpError: vi.fn(),
  resolveHostedRuntimeAiUsageGate: vi.fn(),
  sendClaimedHostedAiUsageLimitNoticeToLinqChat: vi.fn(),
  sendHostedTrialConversionNoticeToLinqChat: vi.fn(),
  sendTelegramUsageLimitNotice: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  decodeHostedMailboxStoredPayload: mocks.decodeHostedMailboxStoredPayload,
  readHostedMailboxConsumedSeqByLane: mocks.readHostedMailboxConsumedSeqByLane,
  readHostedMailboxLatestPendingConversationItem:
    mocks.readHostedMailboxLatestPendingConversationItem,
  readHostedMailboxMaxSeqByLane: mocks.readHostedMailboxMaxSeqByLane,
  readHostedMailboxPayload: mocks.readHostedMailboxPayload,
  readHostedMailboxPendingSystemItemsNeedAiUsageGate:
    mocks.readHostedMailboxPendingSystemItemsNeedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));

vi.mock("@murphai/cloudflare-hosted-control/client", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@murphai/cloudflare-hosted-control/client")
  >();

  return {
    ...original,
    readCloudflareHostedControlHttpError:
      mocks.readCloudflareHostedControlHttpError,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-delivery-store")
  >();
  return {
    ...original,
    claimHostedAiUsageLimitNoticeDeliveryTx:
      mocks.claimHostedAiUsageLimitNoticeDeliveryTx,
    markHostedLinqDeliveryAcceptedTx: mocks.markHostedLinqDeliveryAcceptedTx,
    markHostedLinqDeliveryProviderDispatchStartedTx:
      mocks.markHostedLinqDeliveryProviderDispatchStartedTx,
    markHostedLinqDeliverySendFailedTx: mocks.markHostedLinqDeliverySendFailedTx,
  };
});

vi.mock("@/src/lib/hosted-execution/usage-limit-notice", () => ({
  sendClaimedHostedAiUsageLimitNoticeToLinqChat:
    mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat,
  sendHostedTrialConversionNoticeToLinqChat: mocks.sendHostedTrialConversionNoticeToLinqChat,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-routing-store")
  >();

  return {
    ...original,
    hasHostedMemberEstablishedLinqHomeRoute:
      mocks.hasHostedMemberEstablishedLinqHomeRoute,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-daily-state")
  >();

  return {
    ...original,
    hasHostedLinqInboundWithinDays: mocks.hasHostedLinqInboundWithinDays,
  };
});

vi.mock("@/src/lib/hosted-routing/thread-route-store", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/src/lib/hosted-routing/thread-route-store")
  >();

  return {
    ...original,
    hasHostedMemberEstablishedLinqThreadRoute:
      mocks.hasHostedMemberEstablishedLinqThreadRoute,
  };
});

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
    mocks.hasHostedMemberEstablishedLinqHomeRoute.mockResolvedValue(false);
    mocks.hasHostedMemberEstablishedLinqThreadRoute.mockResolvedValue(false);
    mocks.hasHostedLinqInboundWithinDays.mockImplementation(async () => {
      throw new Error("Configure Linq inbound evidence explicitly for engagement tests.");
    });
    mocks.hostedThreadContainerParticipantFindFirst.mockResolvedValue(null);
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord());
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue(noMailboxBacklog());
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValue([
      {
        consumedSeq: "0",
        lane: "conversation",
      },
    ]);
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(null);
    mocks.readHostedMailboxPayload.mockResolvedValue(null);
    mocks.readHostedMailboxPendingSystemItemsNeedAiUsageGate.mockResolvedValue(false);
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(null);
    mocks.claimHostedAiUsageLimitNoticeDeliveryTx
      .mockImplementation(async (input: { memberId: string; periodStart: Date }) => ({
        idempotencyKey: buildHostedAiUsageGateNoticeIdempotencyKey(input),
        status: "claimed",
      }));
    mocks.markHostedLinqDeliveryAcceptedTx.mockResolvedValue({
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    });
    mocks.markHostedLinqDeliveryProviderDispatchStartedTx.mockResolvedValue(true);
    mocks.markHostedLinqDeliverySendFailedTx.mockResolvedValue(undefined);
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      sendTelegramUsageLimitNotice: mocks.sendTelegramUsageLimitNotice,
    });
    mocks.readCloudflareHostedControlHttpError.mockReturnValue(null);
    mocks.sendTelegramUsageLimitNotice.mockImplementation(async (
      input: { onRequestAttempted?: () => Promise<void> | void },
    ) => {
      await input.onRequestAttempted?.();
      return { status: "sent" };
    });
    mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat.mockResolvedValue({ status: "sent" });
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({ status: "allowed" });
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
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    expect(mocks.readHostedMailboxPendingSystemItemsNeedAiUsageGate)
      .toHaveBeenCalledWith({
        afterSeq: "0",
        prisma: expect.objectContaining({ kind: "prisma" }),
        userId: MEMBER_ID,
      });
    expect(mocks.readHostedMailboxLatestPendingConversationItem).not.toHaveBeenCalled();
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
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
    expect(mocks.readHostedMailboxLatestPendingConversationItem).not.toHaveBeenCalled();
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
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
      retryAt: "2026-07-01T00:00:00.000Z",
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
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
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

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    expect(mocks.readHostedMailboxLatestPendingConversationItem).toHaveBeenCalledWith({
      afterSeq: "2",
      prisma: expect.objectContaining({ kind: "prisma" }),
      userId: MEMBER_ID,
    });
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).toHaveBeenCalledWith({
      chatId: "chat_runtime_denied",
      claimToken: {
        periodStart: deniedDecision.periodStart.toISOString(),
        sentAt: FIXED_NOW,
      },
      memberId: MEMBER_ID,
      message: deniedDecision.userNotice.message,
      noticeCode: deniedDecision.userNotice.code,
      occurredAt: FIXED_NOW,
      prisma: expect.objectContaining({ kind: "prisma" }),
      replyToMessageId: "msg_runtime_denied",
      routeAuthority,
      sourceEventId: "linq_event_runtime_denied",
    });
  });

  it("sends the current-chat Linq trial conversion notice when pending conversation work is runtime-denied", async () => {
    const deniedDecision = buildTrialConversionPendingUsageGateDecision();
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
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

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-05-20T12:15:00.000Z",
    });
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
    expect(mocks.sendHostedTrialConversionNoticeToLinqChat).toHaveBeenCalledWith({
      chatId: "chat_runtime_denied",
      memberId: MEMBER_ID,
      message: deniedDecision.userNotice.message,
      occurredAt: FIXED_NOW,
      prisma: expect.objectContaining({ kind: "prisma" }),
      replyToMessageId: "msg_runtime_denied",
      routeAuthority,
      sourceEventId: "linq_event_runtime_denied",
    });
  });

  it("selects the latest pending conversation row for the current Linq notice", async () => {
    const deniedDecision = buildTrialConversionPendingUsageGateDecision();
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "13",
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem({ laneSeq: "13" }),
    );
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:line_runtime_denied",
      channel: "linq" as const,
      containerMemberId: MEMBER_ID,
      threadId: "chat_runtime_denied",
    };
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(
      buildLinqConversationWake({ routeAuthority }),
    );

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-05-20T12:15:00.000Z",
    });
    expect(mocks.readHostedMailboxLatestPendingConversationItem).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMailboxLatestPendingConversationItem).toHaveBeenCalledWith({
      afterSeq: "2",
      prisma: expect.objectContaining({ kind: "prisma" }),
      userId: MEMBER_ID,
    });
    expect(mocks.sendHostedTrialConversionNoticeToLinqChat).toHaveBeenCalledWith({
      chatId: "chat_runtime_denied",
      memberId: MEMBER_ID,
      message: deniedDecision.userNotice.message,
      occurredAt: FIXED_NOW,
      prisma: expect.objectContaining({ kind: "prisma" }),
      replyToMessageId: "msg_runtime_denied",
      routeAuthority,
      sourceEventId: "linq_event_runtime_denied",
    });
  });

  it("ignores a pending notice row that does not advance past the replay floor", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem({ laneSeq: "2" }),
    );

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    expect(mocks.readHostedMailboxLatestPendingConversationItem).toHaveBeenCalledWith({
      afterSeq: "2",
      prisma: expect.objectContaining({ kind: "prisma" }),
      userId: MEMBER_ID,
    });
    expect(mocks.decodeHostedMailboxStoredPayload).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
    expect(mocks.sendHostedTrialConversionNoticeToLinqChat).not.toHaveBeenCalled();
  });

  it("sets a runtime retry when the Linq usage-limit notice is still in flight", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildLinqConversationWake({
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:line_runtime_denied",
        channel: "linq",
        containerMemberId: MEMBER_ID,
        threadId: "chat_runtime_denied",
      },
    }));
    mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat.mockResolvedValueOnce({
      status: "in_flight",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-05-20T12:15:00.000Z",
    });
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).toHaveBeenCalledOnce();
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
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
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
    });
    expect(mocks.claimHostedAiUsageLimitNoticeDeliveryTx).toHaveBeenCalledWith({
      attemptedAt: new Date(FIXED_NOW),
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
      prisma: expect.objectContaining({ kind: "prisma" }),
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram_event_runtime_denied",
      targetKind: "telegram_thread",
    });
    const [deliveryClaimOrder] =
      mocks.claimHostedAiUsageLimitNoticeDeliveryTx.mock.invocationCallOrder;
    expect(deliveryClaimOrder).toBeDefined();
    expect(mocks.markHostedLinqDeliveryProviderDispatchStartedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(FIXED_NOW),
      idempotencyKey: expectedIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
      startedAt: new Date(FIXED_NOW),
    });
    expect(mocks.readHostedExecutionControlClientIfConfigured)
      .toHaveBeenCalledWith(15_000);
    expect(mocks.sendTelegramUsageLimitNotice).toHaveBeenCalledWith(expect.objectContaining({
      request: {
        message: deniedDecision.userNotice.message,
        replyToMessageId: "7000",
        target: "telegram_chat_runtime_denied:business:biz-42:dm-topic:9",
      },
      onRequestAttempted: expect.any(Function),
      userId: MEMBER_ID,
    }));
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryAcceptedTx).toHaveBeenCalledWith({
      acceptedAt: new Date(FIXED_NOW),
      idempotencyKey: expectedIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
  });

  it("uses the delivery key selected by the usage-limit notice claim owner", async () => {
    const deniedDecision = buildDeniedUsageGateDecision();
    const legacyIdempotencyKey = "ai-usage-gate:legacy-telegram-notice";
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.claimHostedAiUsageLimitNoticeDeliveryTx.mockResolvedValueOnce({
      idempotencyKey: legacyIdempotencyKey,
      status: "claimed",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    expect(mocks.claimHostedAiUsageLimitNoticeDeliveryTx).toHaveBeenCalledOnce();
    expect(mocks.markHostedLinqDeliveryProviderDispatchStartedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(FIXED_NOW),
      idempotencyKey: legacyIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
      startedAt: new Date(FIXED_NOW),
    });
    expect(mocks.markHostedLinqDeliveryAcceptedTx).toHaveBeenCalledWith({
      acceptedAt: new Date(FIXED_NOW),
      idempotencyKey: legacyIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
  });

  it("does not send a Telegram notice for trial conversion denials", async () => {
    const deniedDecision = buildTrialConversionPendingUsageGateDecision();
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
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
      retryAt: "2026-05-20T12:15:00.000Z",
    });
    expect(mocks.readHostedMailboxLatestPendingConversationItem).toHaveBeenCalledWith({
      afterSeq: "2",
      prisma: expect.objectContaining({ kind: "prisma" }),
      userId: MEMBER_ID,
    });
    expect(mocks.claimHostedAiUsageLimitNoticeDeliveryTx).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
    expect(mocks.sendHostedTrialConversionNoticeToLinqChat).not.toHaveBeenCalled();
  });

  it("waits when the current Telegram usage-limit delivery remains in flight", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.claimHostedAiUsageLimitNoticeDeliveryTx.mockResolvedValueOnce({
      status: "in_flight",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-05-20T12:15:00.000Z",
    });
    expect(mocks.claimHostedAiUsageLimitNoticeDeliveryTx).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryProviderDispatchStartedTx).not.toHaveBeenCalled();
  });

  it("waits until a durable Telegram retry-after delivery row is claimable", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.claimHostedAiUsageLimitNoticeDeliveryTx.mockResolvedValueOnce({
      retryAt: new Date("2026-05-20T12:00:42.000Z"),
      status: "in_flight",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-05-20T12:00:42.000Z",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryProviderDispatchStartedTx).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("waits for an in-flight usage-limit notice claim before retrying", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.claimHostedAiUsageLimitNoticeDeliveryTx
      .mockResolvedValueOnce({ status: "in_flight" })
      .mockImplementationOnce(async (input: { memberId: string; periodStart: Date }) => ({
        idempotencyKey: buildHostedAiUsageGateNoticeIdempotencyKey(input),
        status: "claimed",
      }));

    const firstResponse = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const firstFacts = parseHostedRuntimeReconciliationFacts(
      await firstResponse.json(),
    );

    expect(firstFacts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-05-20T12:15:00.000Z",
    });
    expect(mocks.claimHostedAiUsageLimitNoticeDeliveryTx).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sendTelegramUsageLimitNotice).not.toHaveBeenCalled();

    const secondResponse = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const secondFacts = parseHostedRuntimeReconciliationFacts(
      await secondResponse.json(),
    );

    expect(secondFacts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    expect(mocks.claimHostedAiUsageLimitNoticeDeliveryTx).toHaveBeenCalledTimes(2);
    expect(mocks.sendTelegramUsageLimitNotice).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryAcceptedTx).toHaveBeenCalledOnce();
  });

  it("does not send when the usage-limit notice claim owner reports prior delivery", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.claimHostedAiUsageLimitNoticeDeliveryTx
      .mockResolvedValueOnce({ status: "already_notified" });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    expect(mocks.claimHostedAiUsageLimitNoticeDeliveryTx)
      .toHaveBeenCalledWith({
        attemptedAt: new Date(FIXED_NOW),
        memberId: MEMBER_ID,
        periodStart: deniedDecision.periodStart,
        prisma: expect.objectContaining({ kind: "prisma" }),
        source: "hosted_runtime_ai_usage_limit_notice",
        sourceRef: "telegram_event_runtime_denied",
        targetKind: "telegram_thread",
      });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sendTelegramUsageLimitNotice).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliverySendFailedTx).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("sends Telegram usage-limit notices even when an old period notice marker is fresh", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
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
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    expect(mocks.claimHostedAiUsageLimitNoticeDeliveryTx).toHaveBeenCalledOnce();
    expect(mocks.sendTelegramUsageLimitNotice).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryAcceptedTx).toHaveBeenCalledOnce();
  });

  it("marks the shared Telegram usage-limit delivery failed when hosted control returns a terminal provider failure", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.sendTelegramUsageLimitNotice.mockImplementationOnce(async (
      input: { onRequestAttempted?: () => Promise<void> | void },
    ) => {
      await input.onRequestAttempted?.();
      return {
        failureCode: "ASSISTANT_TELEGRAM_DELIVERY_FAILED",
        retryable: false,
        status: "failed",
      };
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
    });
    expect(mocks.markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(FIXED_NOW),
      failedAt: new Date(FIXED_NOW),
      failureCode: "ASSISTANT_TELEGRAM_DELIVERY_FAILED",
      idempotencyKey: expectedIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("treats hosted-control Telegram retry-after failures as in-flight until the provider not-before", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.sendTelegramUsageLimitNotice.mockImplementationOnce(async (
      input: { onRequestAttempted?: () => Promise<void> | void },
    ) => {
      await input.onRequestAttempted?.();
      return {
        failureCode: "ASSISTANT_TELEGRAM_RATE_LIMITED",
        retryAfterSeconds: 42,
        retryable: true,
        status: "failed",
      };
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-05-20T12:00:42.000Z",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
    });
    expect(mocks.sendTelegramUsageLimitNotice).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(FIXED_NOW),
      failedAt: new Date(FIXED_NOW),
      failureCode: "ASSISTANT_TELEGRAM_RATE_LIMITED",
      idempotencyKey: expectedIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
      retryAfterAt: new Date("2026-05-20T12:00:42.000Z"),
    });
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("records retryable hosted-control Telegram failures without provider not-before as retryable fallback rows", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.sendTelegramUsageLimitNotice.mockImplementationOnce(async (
      input: { onRequestAttempted?: () => Promise<void> | void },
    ) => {
      await input.onRequestAttempted?.();
      return {
        failureCode: "ASSISTANT_TELEGRAM_DELIVERY_FAILED",
        retryable: true,
        status: "failed",
      };
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-05-20T12:15:00.000Z",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
    });
    expect(mocks.markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(FIXED_NOW),
      failedAt: new Date(FIXED_NOW),
      failureCode: "ASSISTANT_TELEGRAM_DELIVERY_FAILED",
      idempotencyKey: expectedIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
      retryAfterAt: new Date("2026-05-20T12:15:00.000Z"),
    });
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("records generic hosted-control 503 failures after request attempt as terminal unknown rows", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.readCloudflareHostedControlHttpError.mockReturnValueOnce({
      code: undefined,
      status: 503,
    });
    mocks.sendTelegramUsageLimitNotice.mockImplementationOnce(
      async (input: { onRequestAttempted?: () => Promise<void> | void }) => {
        await input.onRequestAttempted?.();
        throw new Error("control unavailable");
      },
    );

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
    });
    expect(mocks.markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(FIXED_NOW),
      failedAt: new Date(FIXED_NOW),
      failureCode: "telegram_usage_limit_dispatch_unconfirmed",
      idempotencyKey: expectedIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.sendTelegramUsageLimitNotice).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryProviderDispatchStartedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(FIXED_NOW),
      idempotencyKey: expectedIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
      startedAt: new Date(FIXED_NOW),
    });
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("keeps dispatch-start claim failures on the retryable pre-provider side", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.markHostedLinqDeliveryProviderDispatchStartedTx.mockResolvedValueOnce(false);

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-05-20T12:15:00.000Z",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
    });
    expect(mocks.markHostedLinqDeliveryProviderDispatchStartedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(FIXED_NOW),
      idempotencyKey: expectedIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
      startedAt: new Date(FIXED_NOW),
    });
    expect(mocks.sendTelegramUsageLimitNotice).toHaveBeenCalledOnce();
    expect(mocks.markHostedLinqDeliverySendFailedTx).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it.each([
    {
      code: "invalid_request",
      name: "malformed requests",
      status: 400,
    },
    {
      code: undefined,
      name: "unauthorized requests",
      status: 401,
    },
    {
      code: undefined,
      name: "missing routes",
      status: 404,
    },
  ])("records $name as retryable pre-provider failures", async ({
    code,
    status,
  }) => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.readCloudflareHostedControlHttpError.mockReturnValueOnce({ code, status });
    mocks.sendTelegramUsageLimitNotice.mockImplementationOnce(
      async (input: { onRequestAttempted?: () => Promise<void> | void }) => {
        await input.onRequestAttempted?.();
        throw new Error("route unavailable");
      },
    );

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-05-20T12:15:00.000Z",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
    });
    expect(mocks.markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(FIXED_NOW),
      failedAt: new Date(FIXED_NOW),
      failureCode: code ?? "hosted_control_unavailable",
      idempotencyKey: expectedIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
      retryAfterAt: new Date("2026-05-20T12:15:00.000Z"),
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryProviderDispatchStartedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(FIXED_NOW),
      idempotencyKey: expectedIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
      startedAt: new Date(FIXED_NOW),
    });
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("records terminal hosted-control Telegram failures without period-sent projection", async () => {
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.sendTelegramUsageLimitNotice.mockImplementationOnce(async (
      input: { onRequestAttempted?: () => Promise<void> | void },
    ) => {
      await input.onRequestAttempted?.();
      return {
        failureCode: "ASSISTANT_TELEGRAM_DELIVERY_FAILED",
        retryable: false,
        status: "failed",
      };
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
    });
    expect(mocks.sendTelegramUsageLimitNotice).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(FIXED_NOW),
      failedAt: new Date(FIXED_NOW),
      failureCode: "ASSISTANT_TELEGRAM_DELIVERY_FAILED",
      idempotencyKey: expectedIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
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
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
  });

  it("claims a retryable Telegram usage-limit notice when Telegram delivery is unconfigured", async () => {
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValueOnce(null);
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
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
      retryAt: "2026-05-20T12:15:00.000Z",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
    });
    expect(mocks.claimHostedAiUsageLimitNoticeDeliveryTx).toHaveBeenCalledWith({
      attemptedAt: new Date(FIXED_NOW),
      memberId: MEMBER_ID,
      periodStart: deniedDecision.periodStart,
      prisma: expect.objectContaining({ kind: "prisma" }),
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram_event_runtime_denied",
      targetKind: "telegram_thread",
    });
    expect(mocks.markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(FIXED_NOW),
      failedAt: new Date(FIXED_NOW),
      failureCode: "hosted_control_unavailable",
      idempotencyKey: expectedIdempotencyKey,
      prisma: expect.objectContaining({ kind: "prisma" }),
      retryAfterAt: new Date("2026-05-20T12:15:00.000Z"),
    });
    expect(mocks.markHostedLinqDeliveryProviderDispatchStartedTx).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
    expect(mocks.sendTelegramUsageLimitNotice).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
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
    expect(mocks.readHostedMailboxLatestPendingConversationItem).not.toHaveBeenCalled();
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
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem({
        laneSeq: "251",
      }),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildLinqConversationWake());

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    expect(mocks.readHostedMailboxLatestPendingConversationItem).toHaveBeenCalledWith({
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
      retryAt: "2026-07-01T00:00:00.000Z",
    });
    expect(mocks.readHostedMailboxLatestPendingConversationItem).not.toHaveBeenCalled();
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
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

  it("does not pause due automation wakes for members without an established Linq route", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:59:59.000Z",
      nextWakeReason: "assistant_due",
    }));
    mocks.hasHostedMemberEstablishedLinqHomeRoute.mockResolvedValue(false);
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
    expect(mocks.hasHostedMemberEstablishedLinqHomeRoute).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.hasHostedMemberEstablishedLinqThreadRoute).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.hasHostedLinqInboundWithinDays).not.toHaveBeenCalled();
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "mutating",
      now: new Date(FIXED_NOW),
      userId: MEMBER_ID,
    });
  });

  it("pauses due automation wakes when a Linq thread-container route has no recent inbound day", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:59:59.000Z",
      nextWakeReason: "assistant_due",
    }));
    mocks.hasHostedMemberEstablishedLinqHomeRoute.mockResolvedValue(false);
    mocks.hasHostedMemberEstablishedLinqThreadRoute.mockResolvedValue(true);
    mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(false);

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "automation_engagement_paused",
      retryAt: "2026-05-21T12:00:00.000Z",
    });
    expect(mocks.hasHostedMemberEstablishedLinqHomeRoute).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.hasHostedMemberEstablishedLinqThreadRoute).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.hasHostedLinqInboundWithinDays).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      now: new Date(FIXED_NOW),
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
  });

  it("allows due automation wakes when a Linq thread-container route has a qualifying inbound day", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:59:59.000Z",
      nextWakeReason: "assistant_due",
    }));
    mocks.hasHostedMemberEstablishedLinqHomeRoute.mockResolvedValue(false);
    mocks.hasHostedMemberEstablishedLinqThreadRoute.mockResolvedValue(true);
    mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(true);
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
    expect(mocks.hasHostedMemberEstablishedLinqHomeRoute).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.hasHostedMemberEstablishedLinqThreadRoute).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.hasHostedLinqInboundWithinDays).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      now: new Date(FIXED_NOW),
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "mutating",
      now: new Date(FIXED_NOW),
      userId: MEMBER_ID,
    });
  });

  it("pauses due automation wakes when an established Linq home route has no recent inbound day", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:59:59.000Z",
      nextWakeReason: "assistant_due",
    }));
    mocks.hasHostedMemberEstablishedLinqHomeRoute.mockResolvedValue(true);
    mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(false);

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toEqual({
      reason: "automation_engagement_paused",
      retryAt: "2026-05-21T12:00:00.000Z",
    });
    expect(mocks.hasHostedMemberEstablishedLinqHomeRoute).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.hasHostedMemberEstablishedLinqThreadRoute).not.toHaveBeenCalled();
    expect(mocks.hasHostedLinqInboundWithinDays).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      now: new Date(FIXED_NOW),
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
  });

  it("allows due automation wakes when an established Linq home route has a qualifying inbound day", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:59:59.000Z",
      nextWakeReason: "assistant_due",
    }));
    mocks.hasHostedMemberEstablishedLinqHomeRoute.mockResolvedValue(true);
    mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(true);
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
    expect(mocks.hasHostedMemberEstablishedLinqHomeRoute).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
    expect(mocks.hasHostedMemberEstablishedLinqThreadRoute).not.toHaveBeenCalled();
    expect(mocks.hasHostedLinqInboundWithinDays).toHaveBeenCalled();
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "mutating",
      now: new Date(FIXED_NOW),
      userId: MEMBER_ID,
    });
  });

  it("never pauses fresh conversation mailbox lag for engagement", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:59:59.000Z",
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
    mocks.hasHostedMemberEstablishedLinqHomeRoute.mockResolvedValue(true);
    mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(false);
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
    expect(mocks.hasHostedMemberEstablishedLinqHomeRoute).not.toHaveBeenCalled();
    expect(mocks.hasHostedMemberEstablishedLinqThreadRoute).not.toHaveBeenCalled();
    expect(mocks.hasHostedLinqInboundWithinDays).not.toHaveBeenCalled();
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "mutating",
      now: new Date(FIXED_NOW),
      userId: MEMBER_ID,
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

function buildTrialConversionPendingUsageGateDecision() {
  return {
    allowed: false,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 4_500_000n,
    memberId: MEMBER_ID,
    periodEnd: new Date("2026-05-20T12:15:00.000Z"),
    periodStart: new Date("2026-05-20T12:00:00.000Z"),
    reason: "trial_expired_pending_billing",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-05-20T12:15:00.000Z"),
    spentUsdMicros: 4_500_000n,
    userNotice: {
      code: "trial_conversion_pending",
      message: "Your Murph trial needs billing before I can keep going.",
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
