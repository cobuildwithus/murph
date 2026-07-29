import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drainHostedLinqSideEffectsDirect: vi.fn(),
  getPrisma: vi.fn(),
  planHostedLinqPermanentHomeRouteRecovery: vi.fn(),
  planHostedOnboardingLinqWebhook: vi.fn(),
  resolveHostedLinqPlanningEvent: vi.fn(),
  verifyAndParseHostedLinqWebhookRequest: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-onboarding/linq", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/linq")>(),
  requireHostedLinqMessageReceivedEvent: () => ({
    data: {
      chat: { is_group: false },
      chat_id: "chat_home",
      is_from_me: false,
      message: { id: "message_123" },
    },
    event_id: "linq:event:123",
    event_type: "message.received",
  }),
  verifyAndParseHostedLinqWebhookRequest:
    mocks.verifyAndParseHostedLinqWebhookRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/webhook-provider-linq", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/webhook-provider-linq")
  >(),
  planHostedOnboardingLinqWebhook: mocks.planHostedOnboardingLinqWebhook,
  resolveHostedLinqPlanningEvent: mocks.resolveHostedLinqPlanningEvent,
}));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/linq-client")>(),
  getHostedLinqChatSummary: async () => ({ isGroup: false }),
}));
vi.mock("@/src/lib/hosted-onboarding/linq-provider-events", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-provider-events")
  >(),
  parseHostedLinqProviderEvent: () => null,
}));
vi.mock("@/src/lib/hosted-onboarding/linq-home-route-recovery", () => ({
  planHostedLinqPermanentHomeRouteRecovery:
    mocks.planHostedLinqPermanentHomeRouteRecovery,
}));
vi.mock("@/src/lib/hosted-onboarding/webhook-transport", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/webhook-transport")
  >(),
  drainHostedLinqSideEffectsDirect: mocks.drainHostedLinqSideEffectsDirect,
}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  handleHostedOnboardingLinqWebhook,
} from "@/src/lib/hosted-onboarding/webhook-service";

// The canonical owner touches many unrelated models around the planner call.
// This stub answers any of them so the test can isolate the recovery boundary.
function buildPrismaStub(): never {
  const delegate = new Proxy({}, {
    get: () => async () => [],
  });

  return new Proxy({
    $transaction: async (run: (tx: unknown) => unknown) => run(delegate),
  }, {
    get: (target: Record<string, unknown>, property: string) =>
      property in target ? target[property] : delegate,
  }) as never;
}

const HOME_ROUTE_CHANGED = hostedOnboardingError({
  code: "HOSTED_LINQ_HOME_ROUTE_CHANGED",
  httpStatus: 503,
  message: "Hosted Linq home routing changed while the fallback route was resolving.",
  retryable: true,
});

describe("Linq home-route recovery inside the canonical webhook owner", () => {
  const event = {
    data: {
      chat: { id: "chat_home", is_group: false },
      message: {
        id: "message_123",
        parts: [{ text: "hi", type: "text" }],
      },
    },
    event_id: "linq:event:123",
    event_type: "message.received",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(buildPrismaStub());
    mocks.verifyAndParseHostedLinqWebhookRequest.mockReturnValue(event);
    mocks.resolveHostedLinqPlanningEvent.mockResolvedValue(event);
    mocks.planHostedOnboardingLinqWebhook.mockRejectedValue(HOME_ROUTE_CHANGED);
    mocks.drainHostedLinqSideEffectsDirect.mockResolvedValue({
      sentCount: 1,
      skipped: [],
    });
  });

  it("answers a recognized permanent home-route owner instead of retrying forever", async () => {
    const sideEffects = [{ effectId: "signup-effect" }];
    mocks.planHostedLinqPermanentHomeRouteRecovery.mockResolvedValue({
      desiredSideEffects: sideEffects,
      response: { ignored: false, ok: true, reason: "sent-signup-link" },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).resolves.toEqual(
      expect.objectContaining({ ok: true, reason: "sent-signup-link" }),
    );

    expect(mocks.planHostedLinqPermanentHomeRouteRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ event }),
    );
    expect(mocks.drainHostedLinqSideEffectsDirect).toHaveBeenCalledWith(
      expect.objectContaining({ sideEffects }),
    );
  });

  it("preserves the retryable failure when recovery declines", async () => {
    mocks.planHostedLinqPermanentHomeRouteRecovery.mockResolvedValue(null);

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).rejects.toThrow("Hosted Linq home routing changed");

    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
  });

  it("does not attempt recovery for an unrelated planner failure", async () => {
    mocks.planHostedOnboardingLinqWebhook.mockRejectedValue(
      new Error("planner exploded"),
    );

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).rejects.toThrow("planner exploded");

    expect(mocks.planHostedLinqPermanentHomeRouteRecovery).not.toHaveBeenCalled();
  });
});

describe("Linq group-line recovery inside the canonical webhook owner", () => {
  const event = {
    data: {
      chat: { id: "chat_group_recovery", is_group: true },
      message: {
        id: "message_group_recovery",
        parts: [{ text: "intro", type: "text" }],
      },
    },
    event_id: "linq:event:group-recovery",
    event_type: "message.received",
  };
  const sideEffect = {
    effectId: "linq-group-line-recovery:reclaimable",
    payload: {
      assignedRecipientPhone: "+15550100042",
      memberPhone: "+15551230000",
      template: "group_line_recovery",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(buildPrismaStub());
    mocks.verifyAndParseHostedLinqWebhookRequest.mockReturnValue(event);
    mocks.resolveHostedLinqPlanningEvent.mockResolvedValue(event);
    mocks.planHostedOnboardingLinqWebhook.mockResolvedValue({
      desiredSideEffects: [sideEffect],
      response: { ok: true, reason: "sent-group-line-recovery" },
    });
    mocks.planHostedLinqPermanentHomeRouteRecovery.mockResolvedValue(null);
    mocks.drainHostedLinqSideEffectsDirect.mockResolvedValue({
      sentCount: 1,
      skipped: [],
    });
  });

  it("fails retryably when the private recovery delivery is still in flight", async () => {
    const retryAt = new Date("2026-07-29T12:15:00.000Z");
    mocks.drainHostedLinqSideEffectsDirect.mockResolvedValue({
      sentCount: 0,
      skipped: [{
        effectId: sideEffect.effectId,
        reason: "notice_in_flight",
        retryAt,
        template: "group_line_recovery",
      }],
    });

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_GROUP_LINE_RECOVERY_IN_FLIGHT",
      httpStatus: 503,
      retryable: true,
    });
  });

  it("reports unavailable instead of sent when recovery target authorization is lost", async () => {
    mocks.drainHostedLinqSideEffectsDirect.mockResolvedValue({
      sentCount: 0,
      skipped: [{
        effectId: sideEffect.effectId,
        reason: "notice_target_unauthorized",
        template: "group_line_recovery",
      }],
    });

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat-line-unavailable",
    });
  });

  it("returns sent when the stale recovery claim is reclaimed and dispatched", async () => {
    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "sent-group-line-recovery",
    });

    expect(mocks.drainHostedLinqSideEffectsDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        sideEffects: [sideEffect],
      }),
    );
  });
});
