import {
  parseHostedRuntimeReconciliationFacts,
} from "@murphai/hosted-execution/parsers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const FIXED_NOW = "2026-05-20T12:00:00.000Z";
const MEMBER_ID = "member_orch_1";
const UNSAFE_SENTINEL = "UNSAFE_STATUS_SENTINEL";

const mocks = vi.hoisted(() => ({
  decodeHostedMailboxStoredPayload: vi.fn(),
  getPrisma: vi.fn(),
  hasHostedMailboxMealPhotoCaptureSince: vi.fn(),
  hasHostedLinqInboundWithinDays: vi.fn(),
  hasHostedMemberEstablishedLinqThreadRoute: vi.fn(),
  hasHostedMemberEstablishedLinqHomeRoute: vi.fn(),
  hostedThreadContainerParticipantFindFirst: vi.fn(),
  hostedConsentGrantFindUnique: vi.fn(),
  hostedMemberFindUnique: vi.fn(),
  projectHostedAiUsageLimitNoticeForDelivery: vi.fn(),
  readHostedMailboxConsumedSeqByLane: vi.fn(),
  readHostedMailboxFirstLiveSystemItemAfterSeq: vi.fn(),
  readHostedMailboxLatestPendingConversationItem: vi.fn(),
  readHostedMailboxMaxSeqByLane: vi.fn(),
  readHostedMailboxPayload: vi.fn(),
  readHostedMailboxWakeByItemId: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readSelectedHostedInferenceConnectionOverride: vi.fn(),
  readHostedWorkspace: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  resolveHostedRuntimeAiUsageGate: vi.fn(),
  sendClaimedHostedAiUsageLimitNoticeToLinqChat: vi.fn(),
  sendClaimedHostedAiUsageLimitNoticeToTelegramThread: vi.fn(),
  tryMarkHostedMailboxConversationAiUsageDenied: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  decodeHostedMailboxStoredPayload: mocks.decodeHostedMailboxStoredPayload,
  hasHostedMailboxMealPhotoCaptureSince:
    mocks.hasHostedMailboxMealPhotoCaptureSince,
  readHostedMailboxConsumedSeqByLane: mocks.readHostedMailboxConsumedSeqByLane,
  readHostedMailboxFirstLiveSystemItemAfterSeq:
    mocks.readHostedMailboxFirstLiveSystemItemAfterSeq,
  readHostedMailboxLatestPendingConversationItem:
    mocks.readHostedMailboxLatestPendingConversationItem,
  readHostedMailboxMaxSeqByLane: mocks.readHostedMailboxMaxSeqByLane,
  readHostedMailboxPayload: mocks.readHostedMailboxPayload,
  readHostedMailboxWakeByItemId: mocks.readHostedMailboxWakeByItemId,
  tryMarkHostedMailboxConversationAiUsageDenied:
    mocks.tryMarkHostedMailboxConversationAiUsageDenied,
}));

vi.mock("@/src/lib/hosted-execution/usage-limit-notice", () => ({
  sendClaimedHostedAiUsageLimitNoticeToLinqChat:
    mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat,
  sendClaimedHostedAiUsageLimitNoticeToTelegramThread:
    mocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread,
}));

vi.mock("@/src/lib/hosted-execution/usage-limit-notice-message", () => ({
  projectHostedAiUsageLimitNoticeForDelivery:
    mocks.projectHostedAiUsageLimitNoticeForDelivery,
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

vi.mock("@/src/lib/hosted-inference/connection-store", () => ({
  readSelectedHostedInferenceConnectionOverride:
    mocks.readSelectedHostedInferenceConnectionOverride,
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
    mocks.hostedConsentGrantFindUnique.mockResolvedValue(null);
    mocks.hasHostedMemberEstablishedLinqHomeRoute.mockResolvedValue(false);
    mocks.hasHostedMemberEstablishedLinqThreadRoute.mockResolvedValue(false);
    mocks.hasHostedMailboxMealPhotoCaptureSince.mockResolvedValue(false);
    mocks.hasHostedLinqInboundWithinDays.mockImplementation(async () => {
      throw new Error("Configure Linq inbound evidence explicitly for engagement tests.");
    });
    mocks.hostedThreadContainerParticipantFindFirst.mockResolvedValue(null);
    mocks.projectHostedAiUsageLimitNoticeForDelivery.mockImplementation(
      async (input: { message: string }) => input.message,
    );
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord());
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue(noMailboxBacklog());
    mocks.readHostedMailboxConsumedSeqByLane.mockResolvedValue([
      {
        consumedSeq: "0",
        lane: "conversation",
      },
    ]);
    mocks.readHostedMailboxFirstLiveSystemItemAfterSeq.mockResolvedValue(null);
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(null);
    mocks.readHostedMailboxPayload.mockResolvedValue(null);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(null);
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(null);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({ status: "allowed" });
    mocks.readSelectedHostedInferenceConnectionOverride.mockResolvedValue(null);
    mocks.tryMarkHostedMailboxConversationAiUsageDenied.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("runtime owner release actionability", () => {
    it("preserves the owner horizon when no workspace exists", async () => {
      mocks.readHostedWorkspace.mockResolvedValue(null);

      await expect(readOwnerReleaseActionable()).resolves.toBe(false);
    });

    it("signals for visible mailbox lag without a deferred continuation", async () => {
      mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
        redactedStatusJson: {
          conversationImportedSeq: "1",
          systemImportedSeq: "0",
        },
      }));
      mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
        { lane: "conversation", maxSeq: "2" },
      ]);

      await expect(readOwnerReleaseActionable()).resolves.toBe(true);
    });

    it("preserves the owner horizon when no work is currently due", async () => {
      mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
        nextWakeAt: "2026-05-20T12:05:00.000Z",
        nextWakeReason: "assistant",
      }));

      await expect(readOwnerReleaseActionable()).resolves.toBe(false);
    });

    it("preserves the owner horizon for a due default wake without mailbox lag", async () => {
      mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
        nextWakeAt: FIXED_NOW,
        nextWakeReason: "assistant",
      }));

      await expect(readOwnerReleaseActionable()).resolves.toBe(false);
    });

    it("does not hot-loop lag with a future mailbox continuation", async () => {
      mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
        nextWakeAt: "2026-05-20T12:00:15.000Z",
        nextWakeReason: "mailbox",
        redactedStatusJson: {
          conversationImportedSeq: "1",
          systemImportedSeq: "0",
        },
      }));
      mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
        { lane: "conversation", maxSeq: "2" },
      ]);

      await expect(readOwnerReleaseActionable()).resolves.toBe(false);
    });

    it("does not let a due retention wake bypass deferred foreground lag", async () => {
      mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
        inboxMediaRetentionWakeAt: FIXED_NOW,
        nextWakeAt: "2026-05-20T12:00:15.000Z",
        nextWakeReason: "mailbox",
        redactedStatusJson: {
          conversationImportedSeq: "1",
          systemImportedSeq: "0",
        },
      }));
      mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
        { lane: "conversation", maxSeq: "2" },
      ]);

      await expect(readOwnerReleaseActionable()).resolves.toBe(false);
    });

    it("does not hot-loop a retryable block when an earlier future wake wins", async () => {
      mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
        nextWakeAt: "2026-05-20T12:00:05.000Z",
        nextWakeReason: "assistant",
        redactedStatusJson: {
          conversationImportedSeq: "1",
          hostedMailboxRetryableBlockedCount: 1,
          systemImportedSeq: "0",
        },
      }));
      mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
        { lane: "conversation", maxSeq: "2" },
      ]);

      await expect(readOwnerReleaseActionable()).resolves.toBe(false);
    });

    it("signals a due wake even when retryable mailbox lag remains", async () => {
      mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
        nextWakeAt: "2026-05-20T12:00:00.000Z",
        nextWakeReason: "assistant",
        redactedStatusJson: {
          conversationImportedSeq: "1",
          hostedMailboxRetryableBlockedCount: 1,
          systemImportedSeq: "0",
        },
      }));
      mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
        { lane: "conversation", maxSeq: "2" },
      ]);

      await expect(readOwnerReleaseActionable()).resolves.toBe(true);
    });

    it("preserves the owner horizon for a due retention wake without mailbox lag", async () => {
      mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
        inboxMediaRetentionWakeAt: "2026-05-20T12:00:00.000Z",
      }));

      await expect(readOwnerReleaseActionable()).resolves.toBe(false);
    });
  });

  it("returns source-less reconciliation facts for mailbox lag", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        hostedMailboxSystemHandledThroughSeq: "11",
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
        hostedMailboxSystemHandledThroughSeq: "11",
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: null,
        nextWakeReason: null,
        systemMailboxFrontier: null,
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

  it("imports pending system mailbox work before applying model gates", async () => {
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
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: buildUsageLimitExceededGateDecision(),
      status: "denied",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toBeNull();
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxLatestPendingConversationItem).not.toHaveBeenCalled();
  });

  it("blocks non-model runtime work after explicit health-data withdrawal", async () => {
    mocks.hostedConsentGrantFindUnique.mockResolvedValue({
      scope: "launch.health-data",
      status: "revoked",
    });
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: FIXED_NOW,
      nextWakeReason: "device-sync.reconcile",
    }));

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "health_data_consent_withdrawn",
      retryAt: null,
    });
    expect(mocks.readHostedMailboxMaxSeqByLane).not.toHaveBeenCalled();
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.readSelectedHostedInferenceConnectionOverride).not.toHaveBeenCalled();
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
  });

  it("imports pending system work before a due inbox media retention wake", async () => {
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
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: buildHostedAccessInactiveUsageGateDecision(),
      status: "denied",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toBeNull();
    expect(facts.workspace).toMatchObject({
      inboxMediaRetentionWakeAt: FIXED_NOW,
    });
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
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

  it("admits fresh conversation work without usage-accounting availability", async () => {
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
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({ status: "allowed" });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toBeNull();
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "mutating",
      now: new Date(FIXED_NOW),
      userId: MEMBER_ID,
    });
    expect(mocks.readHostedMailboxFirstLiveSystemItemAfterSeq).not.toHaveBeenCalled();
  });

  it.each([
    ["device-sync.wake", "model_free"],
    ["assistant.ask.completed", "default_owned"],
  ] as const)(
    "classifies the first live system mailbox item %s as %s",
    async (kind, expectedFrontier) => {
      mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
        redactedStatusJson: {
          conversationImportedSeq: "0",
          hostedMailboxSystemHandledThroughSeq: "4",
          systemImportedSeq: "4",
        },
      }));
      mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
        { lane: "conversation", maxSeq: "0" },
        { lane: "system", maxSeq: "7" },
      ]);
      mocks.readHostedMailboxFirstLiveSystemItemAfterSeq.mockResolvedValue({
        kind,
        laneSeq: "5",
      });

      const response = await reconciliationRoute.GET(
        requestForFacts(),
        routeContext(),
      );
      const facts = parseHostedRuntimeReconciliationFacts(await response.json());

      expect(response.status).toBe(200);
      expect(facts.workspace?.systemMailboxFrontier).toBe(expectedFrontier);
      expect(mocks.readHostedMailboxFirstLiveSystemItemAfterSeq).toHaveBeenCalledWith({
        afterSeq: "4",
        at: new Date(FIXED_NOW),
        prisma: expect.objectContaining({ kind: "prisma" }),
        userId: MEMBER_ID,
      });
    },
  );

  it("uses zero as the system handled frontier when no checkpoint exists", async () => {
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      { lane: "conversation", maxSeq: "0" },
      { lane: "system", maxSeq: "1" },
    ]);
    mocks.readHostedMailboxFirstLiveSystemItemAfterSeq.mockResolvedValue({
      kind: "runtime.maintenance-requested",
      laneSeq: "1",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.workspace?.systemMailboxFrontier).toBe("model_free");
    expect(mocks.readHostedMailboxFirstLiveSystemItemAfterSeq).toHaveBeenCalledWith(
      expect.objectContaining({ afterSeq: "0" }),
    );
  });

  it("authorizes fresh conversation work even while system import is pending", async () => {
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
        maxSeq: "1",
      },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({ status: "allowed" });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toBeNull();
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
      decision: buildHostedAccessInactiveUsageGateDecision(),
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
  });

  it("admits member-funded custom core inference when managed usage is denied", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: FIXED_NOW,
      nextWakeReason: "assistant_due",
    }));
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: buildUsageLimitExceededGateDecision(),
      status: "denied",
    });
    mocks.readSelectedHostedInferenceConnectionOverride.mockResolvedValue({
      contextWindowTokens: 131_072,
      modelAlias: "murph-custom-r3",
      protocol: "responses",
      revision: 3,
      supportsImages: false,
      verificationProfile:
        "murph-codex-0.147.0-portable-responses-v1",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toBeNull();
    expect(mocks.tryMarkHostedMailboxConversationAiUsageDenied)
      .not.toHaveBeenCalled();
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat)
      .not.toHaveBeenCalled();
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread)
      .not.toHaveBeenCalled();
  });

  it("retries the current capacity-epoch Linq usage-limit notice from the denied gate", async () => {
    const deniedDecision = buildUsageLimitExceededGateDecision();
    const linkedNotice =
      `${deniedDecision.userNotice.message}\n\nAdd usage: ` +
      "https://www.withmurph.ai/settings?addUsage=true#subscription";
    mocks.projectHostedAiUsageLimitNoticeForDelivery
      .mockRejectedValueOnce(new Error("mandatory recovery URL unavailable"))
      .mockResolvedValueOnce(linkedNotice);
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      { lane: "conversation", maxSeq: "3" },
      { lane: "system", maxSeq: "0" },
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
    mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat.mockResolvedValue({
      status: "sent",
    });

    const firstResponse = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const retryResponse = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );

    expect(firstResponse.status).toBe(500);
    expect(retryResponse.status).toBe(200);
    expect(
      mocks.tryMarkHostedMailboxConversationAiUsageDenied,
    ).toHaveBeenCalledTimes(2);
    expect(
      mocks.tryMarkHostedMailboxConversationAiUsageDenied.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat.mock
        .invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.projectHostedAiUsageLimitNoticeForDelivery).toHaveBeenCalledTimes(2);
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat)
      .toHaveBeenCalledExactlyOnceWith({
        chatId: "chat_runtime_denied",
        claimToken: {
          periodStart: deniedDecision.periodStart.toISOString(),
          planResetAt: null,
          sentAt: FIXED_NOW,
          usageCreditLedgerVersion: "3",
        },
        memberId: MEMBER_ID,
        message: linkedNotice,
        noticeCode: deniedDecision.userNotice.code,
        occurredAt: FIXED_NOW,
        prisma: expect.objectContaining({ kind: "prisma" }),
        replyToMessageId: "msg_runtime_denied",
        routeAuthority,
        sourceEventId: "linq_event_runtime_denied",
      });
    expect(mocks.projectHostedAiUsageLimitNoticeForDelivery)
      .toHaveBeenLastCalledWith({
      memberId: MEMBER_ID,
      message: deniedDecision.userNotice.message,
      noticeCode: deniedDecision.userNotice.code,
      prisma: expect.objectContaining({ kind: "prisma" }),
    });
  });

  it("retries the current capacity-epoch Telegram usage-limit notice from the denied gate", async () => {
    const deniedDecision = buildUsageLimitExceededGateDecision();
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      { lane: "conversation", maxSeq: "3" },
      { lane: "system", maxSeq: "0" },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: deniedDecision,
      status: "denied",
    });
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread.mockResolvedValue({
      status: "sent",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      message: deniedDecision.userNotice.message,
      noticeCode: deniedDecision.userNotice.code,
      periodStart: deniedDecision.periodStart,
      prisma: expect.objectContaining({ kind: "prisma" }),
      replyToMessageId: "7000",
      sentAt: new Date(FIXED_NOW),
      sourceEventId: "telegram_event_runtime_denied",
      target: "telegram_chat_runtime_denied:business:biz-42:dm-topic:9",
      usageCreditLedgerVersion: 3n,
    });
  });

  it("schedules the Telegram notice retry returned by the durable claim", async () => {
    const deniedDecision = buildUsageLimitExceededGateDecision();
    const retryAt = new Date("2026-05-20T12:05:00.000Z");
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      { lane: "conversation", maxSeq: "3" },
      { lane: "system", maxSeq: "0" },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: deniedDecision,
      status: "denied",
    });
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue(
      buildPendingConversationItem(),
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildTelegramConversationWake());
    mocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread.mockResolvedValue({
      retryAt,
      status: "in_flight",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: retryAt.toISOString(),
    });
  });

  it("selects the latest pending conversation row for the current Linq notice", async () => {
    const deniedDecision = buildUsageLimitExceededGateDecision();
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
    mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat.mockResolvedValue({
      status: "sent",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: deniedDecision.retryAfter.toISOString(),
    });
    expect(mocks.readHostedMailboxLatestPendingConversationItem).toHaveBeenNthCalledWith(1, {
      afterSeq: "2",
      prisma: expect.objectContaining({ kind: "prisma" }),
      userId: MEMBER_ID,
    });
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).toHaveBeenCalledTimes(1);
  });

  it("ignores a pending notice row that does not advance past the replay floor", async () => {
    const deniedDecision = buildUsageLimitExceededGateDecision();
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
      retryAt: deniedDecision.retryAfter.toISOString(),
    });
    expect(mocks.readHostedMailboxLatestPendingConversationItem).toHaveBeenCalledWith({
      afterSeq: "2",
      prisma: expect.objectContaining({ kind: "prisma" }),
      userId: MEMBER_ID,
    });
    expect(mocks.decodeHostedMailboxStoredPayload).not.toHaveBeenCalled();
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
      decision: buildHostedAccessInactiveUsageGateDecision(),
      status: "denied",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toBeNull();
    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxLatestPendingConversationItem).not.toHaveBeenCalled();
  });

  it("selects usage-limit notice conversations above the consumed replay floor", async () => {
    const deniedDecision = buildUsageLimitExceededGateDecision();
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
    mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat.mockResolvedValue({
      status: "sent",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toEqual({
      reason: "ai_usage_denied",
      retryAt: deniedDecision.retryAfter.toISOString(),
    });
    expect(mocks.readHostedMailboxLatestPendingConversationItem).toHaveBeenCalledWith({
      afterSeq: "250",
      prisma: expect.objectContaining({ kind: "prisma" }),
      userId: MEMBER_ID,
    });
  });

  it("does not retry usage-limit delivery for read-only status checks", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      { lane: "conversation", maxSeq: "3" },
      { lane: "system", maxSeq: "0" },
    ]);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: buildUsageLimitExceededGateDecision(),
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

    expect(facts.blocked?.reason).toBe("ai_usage_denied");
    expect(mocks.readHostedMailboxLatestPendingConversationItem).not.toHaveBeenCalled();
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
    expect(mocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread).not.toHaveBeenCalled();
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
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({ status: "allowed" });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toBeNull();
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
      redactedStatusJson: {
        conversationImportedSeq: "0",
        hostedMailboxSystemHandledThroughSeq: "4",
        systemImportedSeq: "4",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      { lane: "conversation", maxSeq: "0" },
      { lane: "system", maxSeq: "5" },
    ]);
    mocks.readHostedMailboxFirstLiveSystemItemAfterSeq.mockResolvedValue({
      kind: "assistant.ask.completed",
      laneSeq: "5",
    });
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
    expect(facts.workspace?.systemMailboxFrontier).toBe("default_owned");
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
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({ status: "allowed" });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(response.status).toBe(200);
    expect(facts.blocked).toBeNull();
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
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({ status: "allowed" });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toBeNull();
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

  it("uses an accepted meal capture as member-wide engagement for a generic due automation wake", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:59:59.000Z",
      nextWakeReason: "assistant_due",
    }));
    mocks.hasHostedMemberEstablishedLinqHomeRoute.mockResolvedValue(true);
    mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(false);
    mocks.hasHostedMailboxMealPhotoCaptureSince.mockResolvedValue(true);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({ status: "allowed" });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toBeNull();
    expect(mocks.hasHostedMailboxMealPhotoCaptureSince).toHaveBeenCalledWith({
      prisma: expect.objectContaining({ kind: "prisma" }),
      since: new Date("2026-04-22T12:00:00.000Z"),
      userId: MEMBER_ID,
    });
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "mutating",
      now: new Date(FIXED_NOW),
      userId: MEMBER_ID,
    });
  });

  it("keeps deterministic system import admissible while model work is denied", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:59:59.000Z",
      nextWakeReason: "assistant_due",
      redactedStatusJson: {
        conversationImportedSeq: "0",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "1",
      },
      {
        lane: "system",
        maxSeq: "1",
      },
    ]);
    mocks.hasHostedMemberEstablishedLinqHomeRoute.mockResolvedValue(true);
    mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(false);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      decision: buildUsageLimitExceededGateDecision(),
      status: "denied",
    });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked?.reason).toBe("ai_usage_denied");
    expect(facts.mailboxLag).toContainEqual({
      importedSeq: "0",
      lag: "1",
      lane: "system",
      maxSeq: "1",
    });
    expect(facts.mailboxLag).toContainEqual({
      importedSeq: "0",
      lag: "1",
      lane: "conversation",
      maxSeq: "1",
    });
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledOnce();
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
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({ status: "allowed" });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toBeNull();
    expect(mocks.hasHostedMemberEstablishedLinqHomeRoute).not.toHaveBeenCalled();
    expect(mocks.hasHostedMemberEstablishedLinqThreadRoute).not.toHaveBeenCalled();
    expect(mocks.hasHostedLinqInboundWithinDays).not.toHaveBeenCalled();
    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "mutating",
      now: new Date(FIXED_NOW),
      userId: MEMBER_ID,
    });
  });

  it("admits due model-capable workspace wakes for active access", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:59:59.000Z",
      nextWakeReason: "assistant_due",
    }));
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({ status: "allowed" });

    const response = await reconciliationRoute.GET(
      requestForFacts(),
      routeContext(),
    );
    const facts = parseHostedRuntimeReconciliationFacts(await response.json());

    expect(facts.blocked).toBeNull();
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

function buildHostedAccessInactiveUsageGateDecision() {
  return {
    allowed: false,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER_ID,
    periodEnd: new Date("2026-07-01T00:00:00.000Z"),
    periodStart: new Date("2026-06-01T00:00:00.000Z"),
    reason: "hosted_access_inactive",
    remainingUsdMicros: 10_000_000n,
    retryAfter: new Date("2026-07-01T00:00:00.000Z"),
    spentUsdMicros: 0n,
    userNotice: null,
  };
}

function buildUsageLimitExceededGateDecision() {
  return {
    allowed: false,
    allowanceSource: "direct_paid_member_plan" as const,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER_ID,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded" as const,
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 3n,
    userNotice: {
      code: "pulse_upgrade_edge" as const,
      message: "You've reached your Murph usage limit. Add more usage in Settings.",
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

async function readOwnerReleaseActionable(): Promise<boolean> {
  const {
    readHostedRuntimeOwnerReleaseMailboxLagActionable,
  } = await import("../src/lib/hosted-orchestration/runtime-reconciliation-facts");

  return await readHostedRuntimeOwnerReleaseMailboxLagActionable({
    userId: MEMBER_ID,
  });
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
    hostedConsentGrant: {
      findUnique: mocks.hostedConsentGrantFindUnique,
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
