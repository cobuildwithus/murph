import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleHostedOnboardingLinqWebhook,
  runHostedOnboardingWebhookTransaction,
  warmHostedLinqMailboxPayloadRoot,
} from "@/src/lib/hosted-onboarding/webhook-service";

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

vi.mock("@/src/lib/hosted-routing/thread-container-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-routing/thread-container-service")
  >();
  return {
    ...actual,
    prepareHostedThreadContainerCreation: vi.fn(async (input: {
      accountLookupKey: string;
      channel: "linq";
      threadId: string;
    }) => {
      calls.push("prepare-container");
      return {
        containerMemberId: "member_prepared_container",
        cryptoDomainRoots: new Map(),
        deliveryRoute: {
          accountLookupKey: input.accountLookupKey,
          channel: input.channel,
          schema: "murph.hosted-thread-delivery-route.v1" as const,
          threadId: input.threadId,
        },
        deliveryRouteEncrypted: "prepared-container-route",
      };
    }),
    prepareHostedThreadContainerDeliveryRoute: vi.fn(async (input: {
      accountLookupKey: string;
      channel: "linq";
      containerMemberId: string;
      threadId: string;
    }) => {
      calls.push("prepare-route");
      return {
        containerMemberId: input.containerMemberId,
        deliveryRoute: {
          accountLookupKey: input.accountLookupKey,
          channel: input.channel,
          schema: "murph.hosted-thread-delivery-route.v1" as const,
          threadId: input.threadId,
        },
        deliveryRouteEncrypted: "prepared-route",
      };
    }),
  };
});

vi.mock("@/src/lib/hosted-groups/pending-group-setup", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-groups/pending-group-setup")
  >();
  return {
    ...actual,
    prepareHostedPendingGroupSetupClaimForParticipants: vi.fn(async () => {
      calls.push("prepare-pending");
      return {
        id: "hpgs_prepared",
        ownerMemberId: "member_pending_owner",
        payloadEncrypted: "prepared-pending-ciphertext",
        payloadRootKeyId: "root_pending",
        recipientPhoneLookupKey: "hplk_pending_line",
      };
    }),
    readHostedPendingGroupSetupPreparationFailure: vi.fn((error: unknown) => ({
      error,
      preparedClaim: {
        id: "hpgs_failed_preparation",
        ownerMemberId: "member_pending_owner",
        payloadEncrypted: "failed-pending-ciphertext",
        payloadRootKeyId: "root_pending_failed",
        recipientPhoneLookupKey: "hplk_pending_line",
      },
    })),
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
    claimHostedLinqFirstContactAdmissionBudget: vi.fn(async () => ({
      attemptCount: 1,
      kind: "claimed" as const,
    })),
    classifyHostedLinqFirstContactAdmission: vi.fn(async () => ({
      confidence: 1,
      kind: "allow" as const,
      source: "model" as const,
    })),
    readRecordedHostedLinqFirstContactAdmissionDecision: vi.fn(async () => null),
    readHostedLinqFirstContactAdmissionMode: vi.fn(() => "off" as const),
    recordHostedLinqFirstContactAdmissionDecision: vi.fn(
      async ({ decision }: { decision: unknown }) => decision,
    ),
    tryHostedLinqFirstContactAdmissionDeterministicDecision: vi.fn(() => null),
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
    resolveHostedLinqMailboxPayloadRootPrewarmMemberId: vi.fn(
      async ({ threadRoute }: {
        threadRoute: { containerMemberId: string } | null;
      }) => threadRoute?.containerMemberId ?? "member_direct_prewarm",
    ),
    resolveHostedLinqThreadContainerCryptoPreparationTarget: vi.fn(async () => ({
      occurredAt: new Date("2026-03-26T12:00:00.000Z"),
      participantMemberIds: ["member_pending_owner"],
      recipientPhoneLookupKeys: ["hplk_pending_line"],
      requiredPendingSetupCandidateId: null,
      senderMemberId: "member_pending_owner",
    })),
    shouldPrepareHostedLinqThreadContainerCrypto: vi.fn(async () => true),
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
const rootKeysAtTransactionOpen: Array<number[] | null> = [];

function buildLinqMessageWebhookBody(input: {
  chatIsGroup?: boolean;
  isFromMe?: boolean;
} = {}): string {
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
      direction: input.isFromMe ? "outbound" : "inbound",
      id: "msg_prewarm_1",
      is_from_me: input.isFromMe ?? false,
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
      rootKeysAtTransactionOpen.push(rootKeyAtTransactionOpen);
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
    rootKeysAtTransactionOpen.length = 0;
    vi.clearAllMocks();
  });

  it("unwraps the ingress root before the planning transaction opens", async () => {
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
    const { unwrapHostedDomainRootForWeb } = await import(
      "@/src/lib/hosted-crypto/domain-root-store"
    );
    const prisma = {} as never;

    await warmHostedLinqMailboxPayloadRoot({
      event: JSON.parse(buildLinqMessageWebhookBody()),
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

  it("unwraps the resolver's direct member when no route is established", async () => {
    const { unwrapHostedDomainRootForWeb } = await import(
      "@/src/lib/hosted-crypto/domain-root-store"
    );
    const prisma = {} as never;

    await warmHostedLinqMailboxPayloadRoot({
      event: JSON.parse(buildLinqMessageWebhookBody()),
      prisma,
      threadRoute: null,
    });

    expect(unwrapHostedDomainRootForWeb).toHaveBeenCalledExactlyOnceWith({
      domain: "ingress",
      prisma,
      retainFailureInScopedCache: true,
      userId: "member_direct_prewarm",
    });
  });

  // The helper-level tests above pin each piece. These drive the real webhook
  // entry point so the composition is proven too: the resolver decides whether
  // a route exists, and that decision is what the warm hook acts on.
  describe("through handleHostedOnboardingLinqWebhook", () => {
    it("warms the routed member's root and wipes the copy before the transaction opens", async () => {
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
      // The resolver's route snapshot is reused by crypto preparation, and the
      // unwrap finishes before `BEGIN`, which is the whole point of the change.
      expect(calls).toEqual([
        "read-route",
        "prepare-route",
        "unwrap",
        "begin",
        "plan",
        "commit",
      ]);
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

    it.each([
      { failingOperation: "mailbox" as const },
      { failingOperation: "route" as const },
    ])("drains a slow route/mailbox sibling before BEGIN when $failingOperation preparation fails", async ({
      failingOperation,
    }) => {
      const { unwrapHostedDomainRootForWeb } = await import(
        "@/src/lib/hosted-crypto/domain-root-store"
      );
      const { prepareHostedThreadContainerDeliveryRoute } = await import(
        "@/src/lib/hosted-routing/thread-container-service"
      );
      const routePreparation = vi.mocked(prepareHostedThreadContainerDeliveryRoute);
      const mailboxPreparation = vi.mocked(unwrapHostedDomainRootForWeb);
      const defaultRoutePreparation = routePreparation.getMockImplementation();
      const defaultMailboxPreparation = mailboxPreparation.getMockImplementation();
      if (!defaultRoutePreparation || !defaultMailboxPreparation) {
        throw new Error("Expected the default route and mailbox preparation mocks.");
      }
      const preparationError = new Error(`${failingOperation} preparation failed`);
      let releaseSlowSibling: (() => void) | undefined;
      const slowSibling = new Promise<void>((resolve) => {
        releaseSlowSibling = resolve;
      });

      if (failingOperation === "mailbox") {
        routePreparation.mockImplementationOnce(async (input) => {
          calls.push("route-started");
          await slowSibling;
          calls.push("route-settled");
          return defaultRoutePreparation(input);
        });
        mailboxPreparation.mockImplementationOnce(async () => {
          calls.push("mailbox-failed");
          throw preparationError;
        });
      } else {
        routePreparation.mockImplementationOnce(async () => {
          calls.push("route-failed");
          throw preparationError;
        });
        mailboxPreparation.mockImplementationOnce(async (input) => {
          calls.push("mailbox-started");
          await slowSibling;
          calls.push("mailbox-settled");
          return defaultMailboxPreparation(input);
        });
      }
      const prisma = buildPrewarmPrisma();
      const outcome = handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody({ chatIsGroup: true }),
        signature: null,
        timestamp: null,
      }).then(
        (value) => ({ error: null, value }),
        (error: unknown) => ({ error, value: null }),
      );

      await vi.waitFor(() => expect(calls).toContain(
        failingOperation === "mailbox" ? "mailbox-failed" : "route-failed",
      ));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(prisma.$transaction).not.toHaveBeenCalled();
      if (!releaseSlowSibling) {
        throw new Error("Expected the slow preparation sibling gate.");
      }
      releaseSlowSibling();

      const result = await outcome;
      expect(result.error).toBeNull();
      expect(result.value).toMatchObject({
        ok: true,
        reason: "prewarm-owner-boundary-plan",
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(calls.indexOf("begin")).toBeGreaterThan(calls.indexOf(
        failingOperation === "mailbox" ? "route-settled" : "mailbox-settled",
      ));
    });

    it("warms an established route when webhook metadata says the chat is a group", async () => {
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

      expect(readHostedThreadRouteByThreadIdentity).toHaveBeenCalledTimes(1);
      expect(unwrapHostedDomainRootForWeb).toHaveBeenCalledExactlyOnceWith({
        domain: "ingress",
        prisma,
        retainFailureInScopedCache: true,
        userId: "member_prewarm_1",
      });
      expect(calls).toEqual([
        "read-route",
        "prepare-route",
        "unwrap",
        "begin",
        "plan",
        "commit",
      ]);
    });

    it.each([
      { chatIsGroup: true, description: "explicit group metadata" },
      { chatIsGroup: undefined, description: "omitted group metadata" },
    ])("prepares an established self-authored route once with $description", async ({
      chatIsGroup,
    }) => {
      const { hostedOnboardingError } = await import(
        "@/src/lib/hosted-onboarding/errors"
      );
      const {
        planHostedOnboardingLinqWebhook,
        shouldPrepareHostedLinqThreadContainerCrypto,
      } = await import("@/src/lib/hosted-onboarding/webhook-provider-linq");
      const { prepareHostedThreadContainerCreation } = await import(
        "@/src/lib/hosted-routing/thread-container-service"
      );
      const { readHostedThreadRouteByThreadIdentity } = await import(
        "@/src/lib/hosted-routing/thread-route-store"
      );
      const planner = vi.mocked(planHostedOnboardingLinqWebhook);
      const defaultPlanner = planner.getMockImplementation();
      const shouldPrepareContainer = vi.mocked(
        shouldPrepareHostedLinqThreadContainerCrypto,
      );
      const defaultShouldPrepareContainer =
        shouldPrepareContainer.getMockImplementation();
      if (!defaultPlanner || !defaultShouldPrepareContainer) {
        throw new Error("Expected default Linq planning mocks.");
      }
      const prisma = buildPrewarmPrisma();

      try {
        shouldPrepareContainer.mockResolvedValue(false);
        planner.mockImplementation(async (input) => {
          calls.push("plan");
          if (!input.preparedThreadDeliveryRoute) {
            throw hostedOnboardingError({
              code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
              httpStatus: 503,
              message: "Prepared route required.",
              retryable: true,
            });
          }
          return {
            desiredSideEffects: [],
            response: { ignored: true, ok: true, reason: "own-message" },
          };
        });

        const response = await handleHostedOnboardingLinqWebhook({
          prisma: prisma as never,
          rawBody: buildLinqMessageWebhookBody({
            ...(chatIsGroup === undefined ? {} : { chatIsGroup }),
            isFromMe: true,
          }),
          signature: null,
          timestamp: null,
        });

        expect(response).toMatchObject({
          ignored: true,
          ok: true,
          reason: "own-message",
        });
        expect(readHostedThreadRouteByThreadIdentity).toHaveBeenCalledTimes(1);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prepareHostedThreadContainerCreation).not.toHaveBeenCalled();
        expect(shouldPrepareContainer).not.toHaveBeenCalled();
        expect(calls).toEqual([
          "read-route",
          "prepare-route",
          "unwrap",
          "begin",
          "plan",
          "commit",
        ]);
      } finally {
        planner.mockImplementation(defaultPlanner);
        shouldPrepareContainer.mockImplementation(defaultShouldPrepareContainer);
      }
    });

    it("prepares a new group container before the planning transaction opens", async () => {
      const { planHostedOnboardingLinqWebhook } = await import(
        "@/src/lib/hosted-onboarding/webhook-provider-linq"
      );
      const { readHostedThreadRouteByThreadIdentity } = await import(
        "@/src/lib/hosted-routing/thread-route-store"
      );
      vi.mocked(readHostedThreadRouteByThreadIdentity)
        .mockResolvedValueOnce(null);
      const prisma = buildPrewarmPrisma();

      await handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody({ chatIsGroup: true }),
        signature: null,
        timestamp: null,
      });

      expect(calls).toEqual([
        "prepare-pending",
        "prepare-container",
        "begin",
        "plan",
        "commit",
      ]);
      const { prepareHostedPendingGroupSetupClaimForParticipants } = await import(
        "@/src/lib/hosted-groups/pending-group-setup"
      );
      expect(prepareHostedPendingGroupSetupClaimForParticipants)
        .toHaveBeenCalledExactlyOnceWith({
          occurredAt: new Date("2026-03-26T12:00:00.000Z"),
          participantMemberIds: ["member_pending_owner"],
          prisma,
          recipientPhoneLookupKeys: ["hplk_pending_line"],
          requiredCandidateId: null,
          senderMemberId: "member_pending_owner",
        });
      expect(planHostedOnboardingLinqWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          preparedThreadContainerCreation: expect.objectContaining({
            containerMemberId: "member_prepared_container",
          }),
          preparedPendingGroupSetupClaim: expect.objectContaining({
            id: "hpgs_prepared",
          }),
        }),
      );
    });

    it("suppresses a pending-setup warm failure when the transaction does not need it", async () => {
      const { prepareHostedPendingGroupSetupClaimForParticipants } = await import(
        "@/src/lib/hosted-groups/pending-group-setup"
      );
      const { readHostedThreadRouteByThreadIdentity } = await import(
        "@/src/lib/hosted-routing/thread-route-store"
      );
      const preparePending = vi.mocked(
        prepareHostedPendingGroupSetupClaimForParticipants,
      );
      const preparationError = new Error("pending root unavailable");
      vi.mocked(readHostedThreadRouteByThreadIdentity).mockResolvedValueOnce(null);
      preparePending.mockImplementationOnce(async () => {
        calls.push("prepare-pending");
        throw preparationError;
      });
      const prisma = buildPrewarmPrisma();

      await expect(handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody({ chatIsGroup: true }),
        signature: null,
        timestamp: null,
      })).resolves.toMatchObject({ ok: true });

      expect(calls).toEqual([
        "prepare-pending",
        "prepare-container",
        "begin",
        "plan",
        "commit",
      ]);
    });

    it("preserves the original pending-root failure when the transaction proves it is required", async () => {
      const { prepareHostedPendingGroupSetupClaimForParticipants } = await import(
        "@/src/lib/hosted-groups/pending-group-setup"
      );
      const { hostedOnboardingError } = await import(
        "@/src/lib/hosted-onboarding/errors"
      );
      const { planHostedOnboardingLinqWebhook } = await import(
        "@/src/lib/hosted-onboarding/webhook-provider-linq"
      );
      const { prepareHostedThreadContainerCreation } = await import(
        "@/src/lib/hosted-routing/thread-container-service"
      );
      const { readHostedThreadRouteByThreadIdentity } = await import(
        "@/src/lib/hosted-routing/thread-route-store"
      );
      const preparationError = new Error("pending kms unavailable");
      const unrelatedContainerError = new Error("container kms unavailable");
      vi.mocked(readHostedThreadRouteByThreadIdentity).mockResolvedValueOnce(null);
      vi.mocked(prepareHostedPendingGroupSetupClaimForParticipants)
        .mockImplementationOnce(async () => {
          calls.push("prepare-pending");
          throw preparationError;
        });
      vi.mocked(prepareHostedThreadContainerCreation)
        .mockImplementationOnce(async () => {
          calls.push("prepare-container");
          throw unrelatedContainerError;
        });
      vi.mocked(planHostedOnboardingLinqWebhook).mockImplementationOnce(
        async (input) => {
          calls.push("plan");
          if (!input.preparedPendingGroupSetupClaim) {
            throw hostedOnboardingError({
              code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
              details: {
                preparationFailureMatched: true,
                preparationTarget: "pending_group_setup_payload",
              },
              httpStatus: 503,
              message: "Pending setup preparation required.",
              retryable: true,
            });
          }
          throw new Error("Unexpected prepared pending claim.");
        },
      );
      const prisma = buildPrewarmPrisma();

      await expect(handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody({ chatIsGroup: true }),
        signature: null,
        timestamp: null,
      })).rejects.toBe(preparationError);

      expect(prepareHostedPendingGroupSetupClaimForParticipants)
        .toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([
        "prepare-pending",
        "prepare-container",
        "begin",
        "plan",
      ]);
    });

    it("re-prepares instead of surfacing a stale pending-root failure for a changed winner", async () => {
      const { prepareHostedPendingGroupSetupClaimForParticipants } = await import(
        "@/src/lib/hosted-groups/pending-group-setup"
      );
      const { hostedOnboardingError } = await import(
        "@/src/lib/hosted-onboarding/errors"
      );
      const { planHostedOnboardingLinqWebhook } = await import(
        "@/src/lib/hosted-onboarding/webhook-provider-linq"
      );
      const { prepareHostedThreadContainerCreation } = await import(
        "@/src/lib/hosted-routing/thread-container-service"
      );
      const { readHostedThreadRouteByThreadIdentity } = await import(
        "@/src/lib/hosted-routing/thread-route-store"
      );
      const stalePreparationError = new Error("old winner kms unavailable");
      const unrelatedContainerError = new Error("container kms unavailable");
      vi.mocked(readHostedThreadRouteByThreadIdentity)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      vi.mocked(prepareHostedPendingGroupSetupClaimForParticipants)
        .mockImplementationOnce(async () => {
          calls.push("prepare-pending-stale");
          throw stalePreparationError;
        });
      vi.mocked(prepareHostedThreadContainerCreation)
        .mockImplementationOnce(async () => {
          calls.push("prepare-container");
          throw unrelatedContainerError;
        });
      vi.mocked(planHostedOnboardingLinqWebhook)
        .mockImplementationOnce(async (input) => {
          calls.push("plan-changed-winner");
          expect(input.failedPendingGroupSetupPreparationClaim)
            .toMatchObject({ id: "hpgs_failed_preparation" });
          throw hostedOnboardingError({
            code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
            details: { preparationTarget: "pending_group_setup_payload" },
            httpStatus: 503,
            message: "Changed winner needs fresh pending preparation.",
            retryable: true,
          });
        })
        .mockImplementationOnce(async (input) => {
          calls.push("plan");
          expect(input.preparedPendingGroupSetupClaim)
            .toMatchObject({ id: "hpgs_prepared" });
          return {
            desiredSideEffects: [],
            response: { ok: true, reason: "changed-winner-reprepared" },
          };
        });
      const prisma = buildPrewarmPrisma();

      await expect(handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody({ chatIsGroup: true }),
        signature: null,
        timestamp: null,
      })).resolves.toMatchObject({
        ok: true,
        reason: "changed-winner-reprepared",
      });

      expect(prepareHostedPendingGroupSetupClaimForParticipants)
        .toHaveBeenCalledTimes(2);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(calls).toEqual([
        "prepare-pending-stale",
        "prepare-container",
        "begin",
        "plan-changed-winner",
        "prepare-pending",
        "prepare-container",
        "begin",
        "plan",
        "commit",
      ]);
    });

    it("re-prepares a changed pending winner before retrying the transaction", async () => {
      const { prepareHostedPendingGroupSetupClaimForParticipants } = await import(
        "@/src/lib/hosted-groups/pending-group-setup"
      );
      const { hostedOnboardingError } = await import(
        "@/src/lib/hosted-onboarding/errors"
      );
      const { planHostedOnboardingLinqWebhook } = await import(
        "@/src/lib/hosted-onboarding/webhook-provider-linq"
      );
      const { readHostedThreadRouteByThreadIdentity } = await import(
        "@/src/lib/hosted-routing/thread-route-store"
      );
      const readRoute = vi.mocked(readHostedThreadRouteByThreadIdentity);
      const defaultReadRoute = readRoute.getMockImplementation();
      const preparePending = vi.mocked(
        prepareHostedPendingGroupSetupClaimForParticipants,
      );
      const defaultPreparePending = preparePending.getMockImplementation();
      const planner = vi.mocked(planHostedOnboardingLinqWebhook);
      const defaultPlanner = planner.getMockImplementation();
      if (!defaultReadRoute || !defaultPreparePending || !defaultPlanner) {
        throw new Error("Expected default pending preparation mocks.");
      }
      const firstClaim = {
        id: "hpgs_first",
        ownerMemberId: "member_first",
        payloadEncrypted: "ciphertext_first",
        payloadRootKeyId: "root_first",
        recipientPhoneLookupKey: "hplk_pending_line",
      };
      const secondClaim = {
        ...firstClaim,
        id: "hpgs_second",
        ownerMemberId: "member_second",
        payloadEncrypted: "ciphertext_second",
        payloadRootKeyId: "root_second",
      };
      const prisma = buildPrewarmPrisma();

      try {
        readRoute.mockImplementation(async () => {
          calls.push("read-route");
          return null;
        });
        preparePending
          .mockImplementationOnce(async () => {
            calls.push("prepare-pending-first");
            return firstClaim;
          })
          .mockImplementationOnce(async () => {
            calls.push("prepare-pending-second");
            return secondClaim;
          });
        planner
          .mockImplementationOnce(async (input) => {
            calls.push("plan-conflict");
            expect(input.preparedPendingGroupSetupClaim).toEqual(firstClaim);
            throw hostedOnboardingError({
              code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
              details: { preparationTarget: "pending_group_setup_payload" },
              httpStatus: 503,
              message: "Fresh pending setup preparation required.",
              retryable: true,
            });
          })
          .mockImplementationOnce(async (input) => {
            calls.push("plan");
            expect(input.preparedPendingGroupSetupClaim).toEqual(secondClaim);
            return {
              desiredSideEffects: [],
              response: { ok: true, reason: "pending-prepared-retry" },
            };
          });

        await expect(handleHostedOnboardingLinqWebhook({
          prisma: prisma as never,
          rawBody: buildLinqMessageWebhookBody({ chatIsGroup: true }),
          signature: null,
          timestamp: null,
        })).resolves.toMatchObject({
          ok: true,
          reason: "pending-prepared-retry",
        });

        expect(preparePending).toHaveBeenCalledTimes(2);
        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(calls).toEqual([
          "read-route",
          "prepare-pending-first",
          "prepare-container",
          "begin",
          "plan-conflict",
          "read-route",
          "prepare-pending-second",
          "prepare-container",
          "begin",
          "plan",
          "commit",
        ]);
      } finally {
        readRoute.mockImplementation(defaultReadRoute);
        preparePending.mockImplementation(defaultPreparePending);
        planner.mockImplementation(defaultPlanner);
      }
    });

    it("re-prepares outside a fresh transaction after a late route winner", async () => {
      const { hostedOnboardingError } = await import(
        "@/src/lib/hosted-onboarding/errors"
      );
      const { planHostedOnboardingLinqWebhook } = await import(
        "@/src/lib/hosted-onboarding/webhook-provider-linq"
      );
      const prisma = buildPrewarmPrisma();
      vi.mocked(planHostedOnboardingLinqWebhook)
        .mockImplementationOnce(async () => {
          calls.push("plan-conflict");
          throw hostedOnboardingError({
            code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
            httpStatus: 503,
            message: "Fresh route preparation required.",
            retryable: true,
          });
        })
        .mockImplementationOnce(async () => {
          calls.push("plan");
          return {
            desiredSideEffects: [],
            response: { ok: true, reason: "prepared-retry-plan" },
          };
        });

      const response = await handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      });

      expect(response).toMatchObject({ ok: true, reason: "prepared-retry-plan" });
      expect(calls).toEqual([
        "read-route",
        "prepare-route",
        "unwrap",
        "begin",
        "plan-conflict",
        "read-route",
        "prepare-route",
        "unwrap",
        "begin",
        "plan",
        "commit",
      ]);
      expect(rootKeysAtTransactionOpen).toEqual([
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]);
    });

    it("does not retry a failed Linq crypto preparation as a route race", async () => {
      const { hostedOnboardingError } = await import(
        "@/src/lib/hosted-onboarding/errors"
      );
      const { planHostedOnboardingLinqWebhook } = await import(
        "@/src/lib/hosted-onboarding/webhook-provider-linq"
      );
      const { prepareHostedThreadContainerDeliveryRoute } = await import(
        "@/src/lib/hosted-routing/thread-container-service"
      );
      const prepareRoute = vi.mocked(prepareHostedThreadContainerDeliveryRoute);
      const defaultPrepareRoute = prepareRoute.getMockImplementation();
      if (!defaultPrepareRoute) {
        throw new Error("Expected the default Linq route preparation mock.");
      }
      const preparationError = new Error("kms preparation unavailable");
      const prisma = buildPrewarmPrisma();

      try {
        prepareRoute.mockImplementation(async () => {
          calls.push("prepare-route");
          throw preparationError;
        });
        vi.mocked(planHostedOnboardingLinqWebhook).mockImplementation(
          async (input) => {
            calls.push("plan");
            if (!input.preparedThreadDeliveryRoute) {
              throw hostedOnboardingError({
                code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
                httpStatus: 503,
                message: "Prepared route required.",
                retryable: true,
              });
            }
            return {
              desiredSideEffects: [],
              response: { ok: true, reason: "unexpected-prepared-plan" },
            };
          },
        );

        await expect(handleHostedOnboardingLinqWebhook({
          prisma: prisma as never,
          rawBody: buildLinqMessageWebhookBody(),
          signature: null,
          timestamp: null,
        })).rejects.toBe(preparationError);

        expect(prepareRoute).toHaveBeenCalledTimes(1);
        expect(planHostedOnboardingLinqWebhook).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([
          "read-route",
          "prepare-route",
          "unwrap",
          "begin",
          "plan",
        ]);
      } finally {
        prepareRoute.mockImplementation(defaultPrepareRoute);
      }
    });

    it("warms before the classifier-allow replan transaction", async () => {
      const {
        claimHostedLinqFirstContactAdmissionBudget,
        classifyHostedLinqFirstContactAdmission,
        readHostedLinqFirstContactAdmissionMode,
        recordHostedLinqFirstContactAdmissionDecision,
      } = await import("@/src/lib/hosted-onboarding/linq-first-contact-admission");
      const {
        planHostedOnboardingLinqWebhook,
        resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
      } = await import("@/src/lib/hosted-onboarding/webhook-provider-linq");
      const prisma = buildPrewarmPrisma();

      vi.mocked(readHostedLinqFirstContactAdmissionMode).mockReturnValue("enforce");
      vi.mocked(resolveHostedLinqMailboxPayloadRootPrewarmMemberId)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("member_replan");
      vi.mocked(planHostedOnboardingLinqWebhook)
        .mockImplementationOnce(async () => {
          calls.push("plan");
          return {
            desiredSideEffects: [],
            firstContactAdmissionParticipantContact: {
              kind: "phone",
              lookupKey: "phone_lookup_replan",
              value: "+15555550123",
            },
            firstContactAdmissionRequest: {
              eventId: "evt_prewarm_1",
              participantContactKind: "phone",
              partTypes: ["text"],
              service: "sms",
              text: "hello",
            },
            response: {
              ignored: true,
              ok: true,
              reason: "first-contact-admission-required",
            },
          };
        })
        .mockImplementationOnce(async () => {
          calls.push("plan");
          return {
            desiredSideEffects: [],
            response: {
              ok: true,
              reason: "classifier-allow-replan",
            },
          };
        });

      const response = await handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      });

      expect(response).toMatchObject({ ok: true, reason: "classifier-allow-replan" });
      expect(claimHostedLinqFirstContactAdmissionBudget).toHaveBeenCalledTimes(1);
      expect(classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
      expect(recordHostedLinqFirstContactAdmissionDecision).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([
        "read-route",
        "prepare-route",
        "begin",
        "plan",
        "commit",
        "begin",
        "commit",
        "prepare-route",
        "unwrap",
        "begin",
        "plan",
        "commit",
      ]);
      expect(rootKeysAtTransactionOpen).toEqual([
        null,
        null,
        [0, 0, 0, 0],
      ]);
    });

    it("warms before a deterministic decision loses to a recorded allow replan", async () => {
      const {
        classifyHostedLinqFirstContactAdmission,
        readHostedLinqFirstContactAdmissionMode,
        recordHostedLinqFirstContactAdmissionDecision,
        tryHostedLinqFirstContactAdmissionDeterministicDecision,
      } = await import("@/src/lib/hosted-onboarding/linq-first-contact-admission");
      const {
        planHostedOnboardingLinqWebhook,
        resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
      } = await import("@/src/lib/hosted-onboarding/webhook-provider-linq");
      const prisma = buildPrewarmPrisma();

      vi.mocked(readHostedLinqFirstContactAdmissionMode).mockReturnValue("enforce");
      vi.mocked(tryHostedLinqFirstContactAdmissionDeterministicDecision).mockReturnValue({
        confidence: 1,
        kind: "block",
        source: "deterministic",
      });
      vi.mocked(recordHostedLinqFirstContactAdmissionDecision).mockResolvedValue({
        confidence: 1,
        kind: "allow",
        source: "model",
      });
      vi.mocked(resolveHostedLinqMailboxPayloadRootPrewarmMemberId)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("member_replan");
      vi.mocked(planHostedOnboardingLinqWebhook)
        .mockImplementationOnce(async () => {
          calls.push("plan");
          return {
            desiredSideEffects: [],
            firstContactAdmissionParticipantContact: {
              kind: "phone",
              lookupKey: "phone_lookup_replan",
              value: "+15555550123",
            },
            firstContactAdmissionRequest: {
              eventId: "evt_prewarm_1",
              participantContactKind: "phone",
              partTypes: [],
              service: "sms",
              text: null,
            },
            response: {
              ignored: true,
              ok: true,
              reason: "first-contact-admission-required",
            },
          };
        })
        .mockImplementationOnce(async () => {
          calls.push("plan");
          return {
            desiredSideEffects: [],
            response: {
              ok: true,
              reason: "recorded-allow-replan",
            },
          };
        });

      const response = await handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      });

      expect(response).toMatchObject({ ok: true, reason: "recorded-allow-replan" });
      expect(recordHostedLinqFirstContactAdmissionDecision).toHaveBeenCalledWith({
        decision: {
          confidence: 1,
          kind: "block",
          source: "deterministic",
        },
        eventId: "evt_prewarm_1",
        prisma,
      });
      expect(classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
      expect(calls).toEqual([
        "read-route",
        "prepare-route",
        "begin",
        "plan",
        "commit",
        "prepare-route",
        "unwrap",
        "begin",
        "plan",
        "commit",
      ]);
      expect(rootKeysAtTransactionOpen).toEqual([
        null,
        [0, 0, 0, 0],
      ]);
    });
  });
});
