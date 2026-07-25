import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("hosted Linq mailbox payload root prewarm", () => {
  beforeEach(() => {
    calls.length = 0;
    issuedRootKeys.length = 0;
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

    // Warming only moves work earlier, so a failed warm-up must not drop
    // inbound delivery; the planner still runs and unwraps on its own.
    expect(result).toBe("planned");
    expect(calls).toEqual(["warm-failed", "begin", "plan"]);
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
});
