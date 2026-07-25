import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ingress root unwrap reads an envelope and then calls KMS. If the first
 * unwrap happens inside the planning transaction, that network round trip is
 * made while a pooled connection is held. These tests pin the ordering: the
 * unwrap must complete before the transaction opens.
 */
const calls: string[] = [];

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  unwrapHostedDomainRootForWeb: vi.fn(async () => {
    calls.push("unwrap");
    return { envelope: { rootKeyId: "rk_1" }, rootKey: new Uint8Array([1, 2, 3]) };
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
});
