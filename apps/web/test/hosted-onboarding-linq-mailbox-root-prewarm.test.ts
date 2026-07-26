import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ingress root unwrap reads an envelope and then calls KMS. If the first
 * unwrap happens inside the planning transaction, that network round trip is
 * made while a pooled connection is held. These tests pin the ordering: the
 * unwrap must complete before the transaction opens.
 */
const calls: string[] = [];

const issuedRootKeys: Uint8Array[] = [];

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  unwrapHostedDomainRootForWeb: vi.fn(async () => {
    calls.push("unwrap");
    const rootKey = new Uint8Array([1, 2, 3, 4]);
    issuedRootKeys.push(rootKey);
    return { envelope: { rootKeyId: "rk_1" }, rootKey };
  }),
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-routing/thread-route-store")
  >();
  return {
    ...actual,
    readHostedThreadRouteByThreadIdentity: vi.fn(async () => {
      calls.push("read-route");
      return { channel: "linq", containerMemberId: "member_prewarm_1" };
    }),
  };
});

// The remaining mocks exist so `handleHostedOnboardingLinqWebhook` itself can be
// driven end to end. The composition under test — the real planning-event
// resolver handing its route to the real warm hook, ahead of the real
// transaction helper — is left intact; only the request's outer edges
// (signature verification, the planner, KMS) are stood in for.
vi.mock("@/src/lib/hosted-onboarding/linq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/hosted-onboarding/linq")>();
  return {
    ...actual,
    verifyAndParseHostedLinqWebhookRequest: vi.fn((input: { rawBody: string }) =>
      actual.parseHostedLinqWebhookEvent(input.rawBody),
    ),
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-provider-events", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-provider-events")
  >();
  return {
    ...actual,
    parseHostedLinqProviderEvent: vi.fn(() => null),
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-first-contact-admission", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-first-contact-admission")
  >();
  return {
    ...actual,
    readHostedLinqFirstContactAdmissionMode: vi.fn(() => "off" as const),
  };
});

vi.mock("@/src/lib/hosted-onboarding/webhook-provider-linq", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/webhook-provider-linq")
  >();
  return {
    ...actual,
    planHostedOnboardingLinqWebhook: vi.fn(async () => {
      calls.push("plan");
      return {
        desiredSideEffects: [],
        response: { ok: true as const, reason: "prewarm-owner-boundary-plan" },
      };
    }),
  };
});

vi.mock("@/src/lib/hosted-onboarding/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/hosted-onboarding/logging")>();
  return {
    ...actual,
    logHostedOnboardingDiagnostic: vi.fn((name: string, details?: unknown) => {
      diagnostics.push(name);
      diagnosticDetails.push({ details, name });
    }),
    logHostedOnboardingTiming: vi.fn(),
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error(
      "Unexpected getPrisma call in hosted-onboarding-linq-mailbox-root-prewarm.test.ts",
    );
  }),
}));

const diagnostics: string[] = [];
const diagnosticDetails: Array<{ details: unknown; name: string }> = [];

/** Bytes of the warmed key copy observed at the instant `BEGIN` is issued. */
let rootKeyAtTransactionOpen: number[] | null = null;

function buildLinqMessageWebhookBody(input: { chatIsGroup?: boolean } = {}): string {
  return JSON.stringify({
    api_version: "v3",
    created_at: "2026-03-26T12:00:00.000Z",
    data: {
      chat: {
        id: "chat_prewarm_1",
        ...(input.chatIsGroup === undefined ? {} : { is_group: input.chatIsGroup }),
        owner_handle: {
          handle: "+15550000000",
          id: "handle_owner_prewarm",
          is_me: true,
          service: "sms",
        },
      },
      direction: "inbound",
      id: "msg_prewarm_1",
      parts: [{ type: "text", value: "hello" }],
      sender_handle: {
        handle: "+15555550123",
        id: "handle_sender_prewarm",
        service: "sms",
      },
      sent_at: "2026-03-26T12:00:00.000Z",
      service: "sms",
    },
    event_id: "evt_prewarm_1",
    event_type: "message.received",
    webhook_version: "2026-02-03",
  });
}

function buildPrewarmPrisma() {
  return {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      calls.push("begin");
      rootKeyAtTransactionOpen = issuedRootKeys[0] ? [...issuedRootKeys[0]] : null;
      const result = await callback({});
      calls.push("commit");
      return result;
    }),
  };
}

describe("hosted Linq mailbox payload root prewarm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    calls.length = 0;
    issuedRootKeys.length = 0;
    diagnostics.length = 0;
    diagnosticDetails.length = 0;
    rootKeyAtTransactionOpen = null;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("unwraps the ingress root before the planning transaction opens", async () => {
    const { runHostedOnboardingWebhookTransaction } = await import(
      "@/src/lib/hosted-onboarding/webhook-service"
    );
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
        calls.push("begin");
        const result = await callback({});
        calls.push("commit");
        return result;
      }),
    };

    const result = await runHostedOnboardingWebhookTransaction(
      prisma as never,
      async () => {
        calls.push("plan");
        return "planned";
      },
      async () => {
        calls.push("warm");
      },
    );

    expect(result).toBe("planned");
    expect(calls).toEqual(["warm", "begin", "plan", "commit"]);
  });

  it("still opens the transaction when no warm-up is supplied", async () => {
    const { runHostedOnboardingWebhookTransaction } = await import(
      "@/src/lib/hosted-onboarding/webhook-service"
    );
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
        calls.push("begin");
        return callback({});
      }),
    };

    await runHostedOnboardingWebhookTransaction(
      prisma as never,
      async () => {
        calls.push("plan");
        return "planned";
      },
    );

    expect(calls).toEqual(["begin", "plan"]);
  });

  it("does not fail the transaction when the warm-up throws", async () => {
    const { runHostedOnboardingWebhookTransaction } = await import(
      "@/src/lib/hosted-onboarding/webhook-service"
    );
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
        calls.push("begin");
        return callback({});
      }),
    };

    const result = await runHostedOnboardingWebhookTransaction(
      prisma as never,
      async () => {
        calls.push("plan");
        return "planned";
      },
      async () => {
        calls.push("warm-failed");
        throw new Error("kms unavailable");
      },
    );

    // A failed preflight must not drop branches that do not need the root.
    expect(result).toBe("planned");
    expect(calls).toEqual(["warm-failed", "begin", "plan"]);
  });

  it("reports preflight wait separately from the connection-held duration", async () => {
    let nowMs = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    const { runHostedOnboardingWebhookTransaction } = await import(
      "@/src/lib/hosted-onboarding/webhook-service"
    );
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
        nowMs += 20;
        return callback({});
      }),
    };

    await runHostedOnboardingWebhookTransaction(
      prisma as never,
      async () => "planned",
      async () => {
        nowMs += 80;
      },
    );

    expect(diagnosticDetails).toContainEqual({
      details: expect.objectContaining({
        transactionMs: 20,
        warmUnwrapMs: 80,
      }),
      name: "hosted-onboarding.webhook.plan-db",
    });
  });

  it("unwraps the ingress root for the routed member and wipes its key copy", async () => {
    const { warmHostedLinqMailboxPayloadRoot } = await import(
      "@/src/lib/hosted-onboarding/webhook-service"
    );
    const { unwrapHostedDomainRootForWeb } = await import(
      "@/src/lib/hosted-crypto/domain-root-store"
    );
    const prisma = {} as never;

    await warmHostedLinqMailboxPayloadRoot({
      prisma,
      threadRoute: { containerMemberId: "member_prewarm_1" } as never,
    });

    expect(unwrapHostedDomainRootForWeb).toHaveBeenCalledExactlyOnceWith({
      domain: "ingress",
      prisma,
      retainFailureInScopedCache: true,
      userId: "member_prewarm_1",
    });
    // The scoped cache hands out a private copy and expects it wiped; warming
    // needs the unwrap, not the plaintext.
    expect(issuedRootKeys).toHaveLength(1);
    expect([...(issuedRootKeys[0] ?? [])]).toEqual([0, 0, 0, 0]);
  });

  it("does not unwrap when no route is established", async () => {
    const { warmHostedLinqMailboxPayloadRoot } = await import(
      "@/src/lib/hosted-onboarding/webhook-service"
    );
    const { unwrapHostedDomainRootForWeb } = await import(
      "@/src/lib/hosted-crypto/domain-root-store"
    );

    await warmHostedLinqMailboxPayloadRoot({
      prisma: {} as never,
      threadRoute: null,
    });

    expect(unwrapHostedDomainRootForWeb).not.toHaveBeenCalled();
  });

  // The helper-level tests above pin each piece. These drive the real webhook
  // entry point so the composition is proven too: the resolver decides whether
  // a route exists, and that decision is what the warm hook acts on.
  describe("through handleHostedOnboardingLinqWebhook", () => {
    it("warms the routed member's root and wipes the copy before the transaction opens", async () => {
      const { handleHostedOnboardingLinqWebhook } = await import(
        "@/src/lib/hosted-onboarding/webhook-service"
      );
      const { unwrapHostedDomainRootForWeb } = await import(
        "@/src/lib/hosted-crypto/domain-root-store"
      );
      const prisma = buildPrewarmPrisma();

      const response = await handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      });

      expect(response).toMatchObject({ ok: true, reason: "prewarm-owner-boundary-plan" });
      // The route read is the resolver's; the unwrap is the warm hook's. Both
      // finish before `BEGIN`, which is the whole point of the change.
      expect(calls).toEqual(["read-route", "unwrap", "begin", "plan", "commit"]);
      expect(unwrapHostedDomainRootForWeb).toHaveBeenCalledExactlyOnceWith({
        domain: "ingress",
        prisma,
        retainFailureInScopedCache: true,
        userId: "member_prewarm_1",
      });
      // Observed at the instant the transaction opened, so the plaintext copy
      // cannot survive into the connection-held window.
      expect(rootKeyAtTransactionOpen).toEqual([0, 0, 0, 0]);
      expect(diagnostics).not.toContain("hosted-onboarding.webhook.warm-failed");
    });

    it("does not warm when webhook metadata already says the chat is a group", async () => {
      const { handleHostedOnboardingLinqWebhook } = await import(
        "@/src/lib/hosted-onboarding/webhook-service"
      );
      const { unwrapHostedDomainRootForWeb } = await import(
        "@/src/lib/hosted-crypto/domain-root-store"
      );
      const { readHostedThreadRouteByThreadIdentity } = await import(
        "@/src/lib/hosted-routing/thread-route-store"
      );
      const prisma = buildPrewarmPrisma();

      await handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody({ chatIsGroup: true }),
        signature: null,
        timestamp: null,
      });

      // Pinning the known gap so it cannot close or widen silently: the
      // resolver returns before reading a route, so there is nothing to warm
      // and this branch still takes its first unwrap inside the transaction.
      expect(readHostedThreadRouteByThreadIdentity).not.toHaveBeenCalled();
      expect(unwrapHostedDomainRootForWeb).not.toHaveBeenCalled();
      expect(calls).toEqual(["begin", "plan", "commit"]);
    });
  });
});
