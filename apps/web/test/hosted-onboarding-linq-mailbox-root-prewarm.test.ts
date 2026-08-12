import {
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  type HostedCryptoDomain,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import type {
  UnwrappedHostedDomainRoot,
} from "@/src/lib/hosted-crypto/domain-root-store";
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";
import {
  encryptHostedWebNullableString,
} from "@/src/lib/hosted-web/encryption";
import {
  buildHostedMemberRoutingPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
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

function installLocalHostedSecureBoxTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt: ({ value }) => value.startsWith("test-encrypted:")
      ? value.slice("test-encrypted:".length)
      : value,
    encrypt: ({ value }) => `test-encrypted:${value}`,
  });
}

function buildTestUnwrappedHostedDomainRoot(input: {
  domain: HostedCryptoDomain;
  rootKey: Uint8Array;
  rootKeyId: string;
  userId: string;
}): UnwrappedHostedDomainRoot {
  const now = "2026-08-12T00:00:00.000Z";
  const envelope: HostedDomainRootKeyEnvelopeV1 = {
    authoritySignature: {
      alg: "GCP-KMS-EC-P256-SHA256",
      keyVersionName: "test-authority-key-version",
      signature: "test-authority-signature",
      signedAt: now,
    },
    createdAt: now,
    domain: input.domain,
    generation: 1,
    rootKeyId: input.rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: now,
    userId: input.userId,
    wraps: [],
  };

  return {
    envelope,
    rootKey: input.rootKey,
  };
}

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >();
  return {
    ...actual,
    unwrapHostedDomainRootForWeb: vi.fn(async (input: {
      domain: HostedCryptoDomain;
      userId: string;
    }) => {
      calls.push("unwrap");
      const master = buildTestUnwrappedHostedDomainRoot({
        domain: input.domain,
        rootKey: new Uint8Array([1, 2, 3, 4]),
        rootKeyId: "rk_1",
        userId: input.userId,
      });
      const pendingRoot = Promise.resolve(master);
      const cache = getHostedDomainRootUnwrapCache();
      cache?.set(`${input.userId}|${input.domain}|@active`, pendingRoot);
      cache?.set(`${input.userId}|${input.domain}|rk_1`, pendingRoot);
      const rootKey = Uint8Array.from(master.rootKey);
      issuedRootKeys.push(rootKey);
      return { envelope: master.envelope, rootKey };
    }),
    unwrapHostedDomainRootsForWebByRootKeyIds: vi.fn(async (input: {
      references: Array<{
        domain: HostedCryptoDomain;
        rootKeyId: string;
        userId: string;
      }>;
    }) => {
      calls.push("unwrap-exact-roots");
      return input.references.map((reference) => {
        const master = buildTestUnwrappedHostedDomainRoot({
          ...reference,
          rootKey: new Uint8Array(32),
        });
        getHostedDomainRootUnwrapCache()?.set(
          `${reference.userId}|${reference.domain}|${reference.rootKeyId}`,
          Promise.resolve(master),
        );
        return {
          ...reference,
          envelope: master.envelope,
          rootKey: Uint8Array.from(master.rootKey),
        };
      });
    }),
  };
});

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

vi.mock("@/src/lib/hosted-onboarding/linq-client", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-client")
  >();
  return {
    ...actual,
    getHostedLinqChatSummary: vi.fn(async () => ({
      handles: [],
      isGroup: false,
    })),
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

function buildWebhookRequest(rawBody: string): Request {
  return new Request(
    "https://join.example.test/api/hosted-onboarding/linq/webhook",
    {
      body: rawBody,
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": "sha256=test",
        "x-webhook-timestamp": "1774512000",
      },
      method: "POST",
    },
  );
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
    hostedMemberRouting: {
      findUnique: vi.fn<() => Promise<unknown>>(async () => null),
    },
  };
}

describe("hosted Linq mailbox payload root prewarm", () => {
  afterEach(() => {
    installLocalHostedSecureBoxTestCodec();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    installLocalHostedSecureBoxTestCodec();
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

    await expect(warmHostedLinqMailboxPayloadRoot({
      event: JSON.parse(buildLinqMessageWebhookBody()),
      prisma,
      threadRoute: { containerMemberId: "member_prewarm_1" } as never,
    })).resolves.toEqual({
      memberId: "member_prewarm_1",
      rootKeyId: "rk_1",
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

    await expect(warmHostedLinqMailboxPayloadRoot({
      event: JSON.parse(buildLinqMessageWebhookBody()),
      prisma,
      threadRoute: null,
    })).resolves.toEqual({
      memberId: "member_direct_prewarm",
      rootKeyId: "rk_1",
    });

    expect(unwrapHostedDomainRootForWeb).toHaveBeenCalledExactlyOnceWith({
      domain: "ingress",
      prisma,
      retainFailureInScopedCache: true,
      userId: "member_direct_prewarm",
    });
  });

  it("warms a historical direct routing root and projects its plaintext before BEGIN", async () => {
    const {
      unwrapHostedDomainRootForWeb,
      unwrapHostedDomainRootsForWebByRootKeyIds,
    } = await import("@/src/lib/hosted-crypto/domain-root-store");
    const {
      planHostedOnboardingLinqWebhook,
      resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
    } = await import("@/src/lib/hosted-onboarding/webhook-provider-linq");
    const { readHostedThreadRouteByThreadIdentity } = await import(
      "@/src/lib/hosted-routing/thread-route-store"
    );
    const unwrapActiveRoot = vi.mocked(unwrapHostedDomainRootForWeb);
    const unwrapExactRoots = vi.mocked(
      unwrapHostedDomainRootsForWebByRootKeyIds,
    );
    const readRoute = vi.mocked(readHostedThreadRouteByThreadIdentity);
    const resolver = vi.mocked(
      resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
    );
    const planner = vi.mocked(planHostedOnboardingLinqWebhook);
    const defaultUnwrapActiveRoot = unwrapActiveRoot.getMockImplementation();
    const defaultReadRoute = readRoute.getMockImplementation();
    const defaultResolver = resolver.getMockImplementation();
    const defaultPlanner = planner.getMockImplementation();
    if (
      !defaultUnwrapActiveRoot
      || !defaultReadRoute
      || !defaultResolver
      || !defaultPlanner
    ) {
      throw new Error("Expected the default direct routing preparation mocks.");
    }
    const memberId = "member_direct_historical_root";
    const historicalRootKeyId = "root_control_historical";
    const activeRootKeyIds = {
      control: "root_control_active",
      ingress: "root_ingress_active",
    } as const;
    setHostedSecureBoxStringTestCodecForTests(null);
    try {
      unwrapActiveRoot.mockImplementationOnce(async (input) => {
        const root = buildTestUnwrappedHostedDomainRoot({
          domain: input.domain,
          rootKey: new Uint8Array(32),
          rootKeyId: historicalRootKeyId,
          userId: input.userId,
        });
        return {
          envelope: root.envelope,
          rootKey: Uint8Array.from(root.rootKey),
        };
      });
      const linqChatIdEncrypted = await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-chat-id",
        memberId,
        value: "chat_historical_root",
      });
      if (!linqChatIdEncrypted) {
        throw new Error("Expected an encrypted Linq routing fixture.");
      }
      calls.length = 0;
      unwrapActiveRoot.mockImplementation(async (input) => {
        calls.push(`unwrap-active-${input.domain}`);
        const root = buildTestUnwrappedHostedDomainRoot({
          domain: input.domain,
          rootKey: new Uint8Array(32),
          rootKeyId: activeRootKeyIds[input.domain as "control" | "ingress"],
          userId: input.userId,
        });
        const pendingRoot = Promise.resolve(root);
        const cache = getHostedDomainRootUnwrapCache();
        cache?.set(`${input.userId}|${input.domain}|@active`, pendingRoot);
        cache?.set(
          `${input.userId}|${input.domain}|${root.envelope.rootKeyId}`,
          pendingRoot,
        );
        return {
          envelope: root.envelope,
          rootKey: Uint8Array.from(root.rootKey),
        };
      });
      readRoute.mockImplementation(async () => {
        calls.push("read-route");
        return null;
      });
      resolver.mockResolvedValue(memberId);
      planner.mockImplementationOnce(async (input) => {
        calls.push("plan");
        expect(input.preparedDirectMailboxPayloadRoot).toMatchObject({
          activeControlRootKeyId: activeRootKeyIds.control,
          memberId,
          rootKeyId: activeRootKeyIds.ingress,
          routingState: {
            linqChatId: "chat_historical_root",
            memberId,
          },
        });
        expect(getHostedDomainRootUnwrapCache()?.has(
          `${memberId}|control|${historicalRootKeyId}`,
        )).toBe(true);
        return {
          desiredSideEffects: [],
          response: {
            ok: true as const,
            reason: "historical-root-prepared",
          },
        };
      });
      const prisma = buildPrewarmPrisma();
      prisma.hostedMemberRouting.findUnique.mockResolvedValue({
        linqChatIdEncrypted,
        linqChatLookupKey: null,
        linqHomeLineAssignedAt: null,
        linqParticipantContactKind: null,
        linqParticipantContactLookupKey: null,
        linqRecipientPhoneEncrypted: null,
        linqRecipientPhoneLookupKey: null,
        memberId,
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
        replyAliasLookupKey: null,
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: null,
      });

      await expect(handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody({ chatIsGroup: false }),
        signature: null,
        timestamp: null,
      })).resolves.toMatchObject({
        ok: true,
        reason: "historical-root-prepared",
      });

      expect(unwrapExactRoots).toHaveBeenCalledTimes(2);
      expect(unwrapExactRoots).toHaveBeenNthCalledWith(1, {
        prisma,
        references: [{
          domain: "control",
          rootKeyId: historicalRootKeyId,
          userId: memberId,
        }],
        retainFailureInScopedCache: true,
        signal: undefined,
      });
      expect(unwrapExactRoots).toHaveBeenNthCalledWith(2, {
        prisma,
        references: [{
          domain: "control",
          rootKeyId: historicalRootKeyId,
          userId: memberId,
        }],
        retainFailureInScopedCache: true,
        signal: undefined,
      });
      expect(calls.indexOf("unwrap-exact-roots")).toBeLessThan(
        calls.indexOf("begin"),
      );
      expect(calls).toEqual([
        "read-route",
        "unwrap-active-ingress",
        "unwrap-active-control",
        "unwrap-exact-roots",
        "unwrap-exact-roots",
        "begin",
        "plan",
        "commit",
      ]);
    } finally {
      installLocalHostedSecureBoxTestCodec();
      unwrapActiveRoot.mockReset();
      unwrapActiveRoot.mockImplementation(defaultUnwrapActiveRoot);
      readRoute.mockReset();
      readRoute.mockImplementation(defaultReadRoute);
      resolver.mockReset();
      resolver.mockImplementation(defaultResolver);
      planner.mockReset();
      planner.mockImplementation(defaultPlanner);
    }
  });

  it("bounds six distinct historical routing roots to two concurrent KMS operations", async () => {
    const {
      unwrapHostedDomainRootForWeb,
      unwrapHostedDomainRootsForWebByRootKeyIds,
    } = await import("@/src/lib/hosted-crypto/domain-root-store");
    const {
      planHostedOnboardingLinqWebhook,
      resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
    } = await import("@/src/lib/hosted-onboarding/webhook-provider-linq");
    const { readHostedThreadRouteByThreadIdentity } = await import(
      "@/src/lib/hosted-routing/thread-route-store"
    );
    const unwrapActiveRoot = vi.mocked(unwrapHostedDomainRootForWeb);
    const unwrapExactRoots = vi.mocked(
      unwrapHostedDomainRootsForWebByRootKeyIds,
    );
    const readRoute = vi.mocked(readHostedThreadRouteByThreadIdentity);
    const resolver = vi.mocked(
      resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
    );
    const planner = vi.mocked(planHostedOnboardingLinqWebhook);
    const defaultUnwrapActiveRoot = unwrapActiveRoot.getMockImplementation();
    const defaultUnwrapExactRoots = unwrapExactRoots.getMockImplementation();
    const defaultReadRoute = readRoute.getMockImplementation();
    const defaultResolver = resolver.getMockImplementation();
    const defaultPlanner = planner.getMockImplementation();
    if (
      !defaultUnwrapActiveRoot
      || !defaultUnwrapExactRoots
      || !defaultReadRoute
      || !defaultResolver
      || !defaultPlanner
    ) {
      throw new Error("Expected the default direct routing preparation mocks.");
    }

    const memberId = "member_direct_six_historical_roots";
    const historicalRootKeyIds = [
      "root_control_historical_1",
      "root_control_historical_2",
      "root_control_historical_3",
      "root_control_historical_4",
      "root_control_historical_5",
      "root_control_historical_6",
    ] as const;
    const expectedHistoricalProviderOrder = [
      historicalRootKeyIds[0],
      historicalRootKeyIds[1],
      historicalRootKeyIds[2],
      historicalRootKeyIds[4],
      historicalRootKeyIds[3],
      historicalRootKeyIds[5],
    ];
    let releaseIngress: (() => void) | undefined;
    setHostedSecureBoxStringTestCodecForTests(null);
    try {
      let encryptionRootIndex = 0;
      unwrapActiveRoot.mockImplementation(async (input) => {
        const rootKeyId = historicalRootKeyIds[encryptionRootIndex];
        encryptionRootIndex += 1;
        if (!rootKeyId) {
          throw new Error("Unexpected historical routing fixture encryption.");
        }
        const root = buildTestUnwrappedHostedDomainRoot({
          domain: input.domain,
          rootKey: new Uint8Array(32),
          rootKeyId,
          userId: input.userId,
        });
        return {
          envelope: root.envelope,
          rootKey: Uint8Array.from(root.rootKey),
        };
      });
      const privateColumns = await buildHostedMemberRoutingPrivateColumns({
        linqChatId: "chat_six_roots",
        linqRecipientPhone: "+15550000000",
        memberId,
        pendingLinqChatId: "chat_pending_six_roots",
        pendingLinqParticipantContact: "+15555550123",
        pendingLinqRecipientPhone: "+15550000001",
        telegramThreadId: "telegram_thread_six_roots",
        telegramUserId: "telegram_user_six_roots",
      });
      expect(encryptionRootIndex).toBe(6);

      let providerInFlight = 0;
      let providerPeak = 0;
      let providerTotal = 0;
      const historicalProviderOrder: string[] = [];
      const ingressGate = new Promise<void>((resolve) => {
        releaseIngress = resolve;
      });
      const beginProviderOperation = () => {
        providerInFlight += 1;
        providerTotal += 1;
        providerPeak = Math.max(providerPeak, providerInFlight);
      };
      const finishProviderOperation = () => {
        providerInFlight -= 1;
      };
      const cacheRoot = (input: {
        domain: HostedCryptoDomain;
        rootKeyId: string;
        userId: string;
      }) => {
        const master = buildTestUnwrappedHostedDomainRoot({
          ...input,
          rootKey: new Uint8Array(32),
        });
        getHostedDomainRootUnwrapCache()?.set(
          `${input.userId}|${input.domain}|${input.rootKeyId}`,
          Promise.resolve(master),
        );
        return master;
      };

      calls.length = 0;
      unwrapActiveRoot.mockImplementation(async (input) => {
        beginProviderOperation();
        try {
          if (input.domain === "ingress") {
            calls.push("provider-ingress");
            await ingressGate;
          } else {
            calls.push("provider-control-active");
            await Promise.resolve();
          }
          const rootKeyId = input.domain === "ingress"
            ? "root_ingress_active"
            : "root_control_active";
          const master = cacheRoot({
            domain: input.domain,
            rootKeyId,
            userId: input.userId,
          });
          getHostedDomainRootUnwrapCache()?.set(
            `${input.userId}|${input.domain}|@active`,
            Promise.resolve(master),
          );
          return {
            envelope: master.envelope,
            rootKey: Uint8Array.from(master.rootKey),
          };
        } finally {
          finishProviderOperation();
        }
      });
      unwrapExactRoots.mockImplementation(async (input) => {
        const results = [];
        for (const reference of input.references) {
          const cacheKey =
            `${reference.userId}|${reference.domain}|${reference.rootKeyId}`;
          const cached = getHostedDomainRootUnwrapCache()?.get(cacheKey);
          let master: UnwrappedHostedDomainRoot;
          if (cached) {
            master = await cached;
          } else {
            beginProviderOperation();
            historicalProviderOrder.push(reference.rootKeyId);
            calls.push(`provider-historical-${reference.rootKeyId}`);
            if (historicalProviderOrder.length === 1) {
              releaseIngress?.();
            }
            await Promise.resolve();
            master = cacheRoot(reference);
            finishProviderOperation();
          }
          results.push({
            ...reference,
            envelope: master.envelope,
            rootKey: Uint8Array.from(master.rootKey),
          });
        }
        return results;
      });
      readRoute.mockImplementation(async () => {
        calls.push("read-route");
        return null;
      });
      resolver.mockResolvedValue(memberId);
      planner.mockImplementationOnce(async (input) => {
        calls.push("plan");
        expect(input.preparedDirectMailboxPayloadRoot).toMatchObject({
          activeControlRootKeyId: "root_control_active",
          memberId,
          rootKeyId: "root_ingress_active",
          routingState: {
            linqChatId: "chat_six_roots",
            memberId,
            pendingLinqChatId: "chat_pending_six_roots",
            telegramThreadId: "telegram_thread_six_roots",
            telegramUserId: "telegram_user_six_roots",
          },
        });
        return {
          desiredSideEffects: [],
          response: {
            ok: true as const,
            reason: "six-historical-roots-prepared",
          },
        };
      });
      const prisma = buildPrewarmPrisma();
      prisma.hostedMemberRouting.findUnique.mockResolvedValue({
        ...privateColumns,
        linqChatLookupKey: null,
        linqHomeLineAssignedAt: null,
        linqParticipantContactKind: null,
        linqParticipantContactLookupKey: null,
        linqRecipientPhoneLookupKey: null,
        memberId,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneLookupKey: null,
        replyAliasLookupKey: null,
        telegramUserLookupKey: null,
      });

      await expect(handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody({ chatIsGroup: false }),
        signature: null,
        timestamp: null,
      })).resolves.toMatchObject({
        ok: true,
        reason: "six-historical-roots-prepared",
      });

      expect(providerTotal).toBe(8);
      expect(providerPeak).toBe(2);
      expect(providerInFlight).toBe(0);
      expect(historicalProviderOrder).toEqual(
        expectedHistoricalProviderOrder,
      );
      expect(unwrapExactRoots).toHaveBeenCalledTimes(7);
      const lastProviderCallIndex = calls.reduce(
        (lastIndex, call, index) => call.startsWith("provider-")
          ? index
          : lastIndex,
        -1,
      );
      expect(calls.indexOf("begin")).toBeGreaterThan(
        lastProviderCallIndex,
      );
    } finally {
      releaseIngress?.();
      installLocalHostedSecureBoxTestCodec();
      unwrapActiveRoot.mockReset();
      unwrapActiveRoot.mockImplementation(defaultUnwrapActiveRoot);
      unwrapExactRoots.mockReset();
      unwrapExactRoots.mockImplementation(defaultUnwrapExactRoots);
      readRoute.mockReset();
      readRoute.mockImplementation(defaultReadRoute);
      resolver.mockReset();
      resolver.mockImplementation(defaultResolver);
      planner.mockReset();
      planner.mockImplementation(defaultPlanner);
    }
  });

  it("keeps direct ingress and control unwraps cache-only inside the transaction", async () => {
    const { unwrapHostedDomainRootForWeb } = await import(
      "@/src/lib/hosted-crypto/domain-root-store"
    );
    const unwrapRoot = vi.mocked(unwrapHostedDomainRootForWeb);
    const defaultUnwrap = unwrapRoot.getMockImplementation();
    if (!defaultUnwrap) {
      throw new Error("Expected the default domain-root unwrap mock.");
    }
    const providerKmsWork = vi.fn();
	    const providerResultsByScope = new WeakMap<
	      object,
	      Map<string, Promise<UnwrappedHostedDomainRoot>>
	    >();
    let transactionOpen = false;
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
        transactionOpen = true;
        try {
          return await callback({});
        } finally {
          transactionOpen = false;
        }
      }),
    };

	    try {
	      unwrapRoot.mockImplementation(async (input) => {
	        calls.push(
	          `${transactionOpen ? "unwrap-api-tx" : "unwrap-api-prepare"}-${input.domain}`,
	        );
	        const scope = getHostedDomainRootUnwrapCache();
	        const cacheKey = `${input.userId}|${input.domain}`;
	        let pending: Promise<UnwrappedHostedDomainRoot> | undefined;
	        if (scope) {
	          let scoped = providerResultsByScope.get(scope);
	          if (!scoped) {
	            scoped = new Map();
	            providerResultsByScope.set(scope, scoped);
          }
	          pending = scoped.get(cacheKey);
	          if (!pending) {
	            providerKmsWork({ transactionOpen });
	            pending = Promise.resolve(buildTestUnwrappedHostedDomainRoot({
	              domain: input.domain,
	              rootKey: new Uint8Array([5, 6, 7, 8]),
	              rootKeyId: "rk_cache_only",
	              userId: input.userId,
	            }));
	            scoped.set(cacheKey, pending);
	          }
	        } else {
	          providerKmsWork({ transactionOpen });
	          pending = Promise.resolve(buildTestUnwrappedHostedDomainRoot({
	            domain: input.domain,
	            rootKey: new Uint8Array([5, 6, 7, 8]),
	            rootKeyId: "rk_cache_only",
	            userId: input.userId,
	          }));
	        }
        const result = await pending;
        return {
          envelope: result.envelope,
          rootKey: Uint8Array.from(result.rootKey),
        };
      });

      await runHostedOnboardingWebhookTransaction(
        prisma as never,
        async (transaction) => {
          for (const domain of ["ingress", "control"] as const) {
            const root = await unwrapRoot({
              domain,
              prisma: transaction,
              userId: "member_direct_prewarm",
            } as never);
            root.rootKey.fill(0);
          }
        },
        async () => {
          for (const domain of ["ingress", "control"] as const) {
            const root = await unwrapRoot({
              domain,
              prisma,
              retainFailureInScopedCache: true,
              userId: "member_direct_prewarm",
            } as never);
            root.rootKey.fill(0);
          }
        },
      );

      expect(calls).toEqual([
        "unwrap-api-prepare-ingress",
        "unwrap-api-prepare-control",
        "unwrap-api-tx-ingress",
        "unwrap-api-tx-control",
      ]);
      expect(providerKmsWork).toHaveBeenCalledTimes(2);
      expect(providerKmsWork).toHaveBeenNthCalledWith(1, {
        transactionOpen: false,
      });
      expect(providerKmsWork).toHaveBeenNthCalledWith(2, {
        transactionOpen: false,
      });
    } finally {
      unwrapRoot.mockImplementation(defaultUnwrap);
    }
  });

  // The helper-level tests above pin each piece. These drive the real webhook
  // entry point so the composition is proven too: the resolver decides whether
  // a route exists, and that decision is what the warm hook acts on.
  describe("through handleHostedOnboardingLinqWebhook", () => {
    it("re-prepares a changed direct member outside one fresh transaction", async () => {
      const { hostedOnboardingError } = await import(
        "@/src/lib/hosted-onboarding/errors"
      );
      const {
        planHostedOnboardingLinqWebhook,
        resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
      } = await import("@/src/lib/hosted-onboarding/webhook-provider-linq");
      const { readHostedThreadRouteByThreadIdentity } = await import(
        "@/src/lib/hosted-routing/thread-route-store"
      );
      const readRoute = vi.mocked(readHostedThreadRouteByThreadIdentity);
      const resolver = vi.mocked(
        resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
      );
      const planner = vi.mocked(planHostedOnboardingLinqWebhook);
      const defaultReadRoute = readRoute.getMockImplementation();
      const defaultResolver = resolver.getMockImplementation();
      const defaultPlanner = planner.getMockImplementation();
      if (!defaultReadRoute || !defaultResolver || !defaultPlanner) {
        throw new Error("Expected the default direct preparation mocks.");
      }
      const prisma = buildPrewarmPrisma();

      try {
        readRoute.mockImplementation(async () => {
          calls.push("read-route");
          return null;
        });
        resolver
          .mockResolvedValueOnce("member_direct_a")
          .mockResolvedValueOnce("member_direct_b");
        planner
          .mockImplementationOnce(async (input) => {
            calls.push("plan-conflict");
            expect(input.preparedDirectMailboxPayloadRoot).toEqual({
              activeControlRootKeyId: "rk_1",
              memberId: "member_direct_a",
              routingRecord: null,
              routingState: null,
              rootKeyId: "rk_1",
            });
            throw hostedOnboardingError({
              code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
              details: {
                preparationTarget: "direct_linq_mailbox",
                reason: "member",
              },
              httpStatus: 503,
              message: "Direct member changed.",
              retryable: true,
            });
          })
          .mockImplementationOnce(async (input) => {
            calls.push("plan");
            expect(input.preparedDirectMailboxPayloadRoot).toEqual({
              activeControlRootKeyId: "rk_1",
              memberId: "member_direct_b",
              routingRecord: null,
              routingState: null,
              rootKeyId: "rk_1",
            });
            return {
              desiredSideEffects: [],
              response: {
                ok: true as const,
                reason: "direct-mailbox-reprepared",
              },
            };
          });

        await expect(handleHostedOnboardingLinqWebhook({
          prisma: prisma as never,
          rawBody: buildLinqMessageWebhookBody({ chatIsGroup: false }),
          signature: null,
          timestamp: null,
        })).resolves.toMatchObject({
          ok: true,
          reason: "direct-mailbox-reprepared",
        });

        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(resolver).toHaveBeenCalledTimes(2);
        expect(calls).toEqual([
          "read-route",
          "unwrap",
          "unwrap",
          "begin",
          "plan-conflict",
          "read-route",
          "unwrap",
          "unwrap",
          "begin",
          "plan",
          "commit",
        ]);
      } finally {
        readRoute.mockReset();
        readRoute.mockImplementation(defaultReadRoute);
        resolver.mockReset();
        resolver.mockImplementation(defaultResolver);
        planner.mockReset();
        planner.mockImplementation(defaultPlanner);
      }
    });

    it("fails closed after one direct mailbox preparation retry", async () => {
      const { hostedOnboardingError } = await import(
        "@/src/lib/hosted-onboarding/errors"
      );
      const {
        planHostedOnboardingLinqWebhook,
        resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
      } = await import("@/src/lib/hosted-onboarding/webhook-provider-linq");
      const { readHostedThreadRouteByThreadIdentity } = await import(
        "@/src/lib/hosted-routing/thread-route-store"
      );
      const readRoute = vi.mocked(readHostedThreadRouteByThreadIdentity);
      const resolver = vi.mocked(
        resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
      );
      const planner = vi.mocked(planHostedOnboardingLinqWebhook);
      const defaultReadRoute = readRoute.getMockImplementation();
      const defaultResolver = resolver.getMockImplementation();
      const defaultPlanner = planner.getMockImplementation();
      if (!defaultReadRoute || !defaultResolver || !defaultPlanner) {
        throw new Error("Expected the default direct preparation mocks.");
      }
      const prisma = buildPrewarmPrisma();
      const stalePreparation = () => hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
        details: {
          preparationTarget: "direct_linq_mailbox",
          reason: "ingress-root",
        },
        httpStatus: 503,
        message: "Direct mailbox root changed.",
        retryable: true,
      });

      try {
        readRoute.mockImplementation(async () => {
          calls.push("read-route");
          return null;
        });
        resolver.mockResolvedValue("member_direct_prewarm");
        planner.mockImplementation(async () => {
          calls.push("plan-conflict");
          throw stalePreparation();
        });

        await expect(handleHostedOnboardingLinqWebhook({
          prisma: prisma as never,
          rawBody: buildLinqMessageWebhookBody({ chatIsGroup: false }),
          signature: null,
          timestamp: null,
        })).rejects.toMatchObject({
          code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
          details: {
            preparationTarget: "direct_linq_mailbox",
            reason: "ingress-root",
          },
        });

        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(resolver).toHaveBeenCalledTimes(2);
        expect(planner).toHaveBeenCalledTimes(2);
      } finally {
        readRoute.mockReset();
        readRoute.mockImplementation(defaultReadRoute);
        resolver.mockReset();
        resolver.mockImplementation(defaultResolver);
        planner.mockReset();
        planner.mockImplementation(defaultPlanner);
      }
    });

    it("preserves the first direct root failure, drains its sibling, and limits the transaction to recovery planning", async () => {
      const { unwrapHostedDomainRootForWeb } = await import(
        "@/src/lib/hosted-crypto/domain-root-store"
      );
      const {
        planHostedOnboardingLinqWebhook,
        resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
      } = await import("@/src/lib/hosted-onboarding/webhook-provider-linq");
      const { readHostedThreadRouteByThreadIdentity } = await import(
        "@/src/lib/hosted-routing/thread-route-store"
      );
      const readRoute = vi.mocked(readHostedThreadRouteByThreadIdentity);
      const resolver = vi.mocked(
        resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
      );
      const planner = vi.mocked(planHostedOnboardingLinqWebhook);
      const unwrapRoot = vi.mocked(unwrapHostedDomainRootForWeb);
      const defaultReadRoute = readRoute.getMockImplementation();
      const defaultResolver = resolver.getMockImplementation();
      const defaultPlanner = planner.getMockImplementation();
      const defaultUnwrap = unwrapRoot.getMockImplementation();
      if (!defaultReadRoute || !defaultResolver || !defaultPlanner || !defaultUnwrap) {
        throw new Error("Expected the default direct preparation mocks.");
      }
      const ingressError = new Error("direct ingress KMS unavailable");
      const controlError = new Error("direct control KMS unavailable later");
      let releaseControlPreparation: (() => void) | undefined;
      const controlPreparationGate = new Promise<void>((resolve) => {
        releaseControlPreparation = resolve;
      });
      let controlPreparationSettled = false;
      const prisma = buildPrewarmPrisma();

      try {
        readRoute.mockImplementation(async () => {
          calls.push("read-route");
          return null;
        });
        resolver.mockResolvedValue("member_direct_prewarm");
        planner.mockImplementationOnce(async (input) => {
          calls.push("plan-recovery-only");
          expect(input.directMailboxPreparationFailure).toBe(ingressError);
          throw input.directMailboxPreparationFailure;
        });
        unwrapRoot.mockImplementation(async (input) => {
          if (input.domain === "ingress") {
            calls.push("ingress-failed");
            throw ingressError;
          }
          calls.push("control-started");
          await controlPreparationGate;
          controlPreparationSettled = true;
          calls.push("control-failed");
          throw controlError;
        });

        const outcome = handleHostedOnboardingLinqWebhook({
          prisma: prisma as never,
          rawBody: buildLinqMessageWebhookBody({ chatIsGroup: false }),
          signature: null,
          timestamp: null,
        }).then(
          (value) => ({ error: null, value }),
          (error: unknown) => ({ error, value: null }),
        );

        await vi.waitFor(() => expect(calls).toContain("ingress-failed"));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(controlPreparationSettled).toBe(false);
        if (!releaseControlPreparation) {
          throw new Error("Expected the direct control preparation gate.");
        }
        releaseControlPreparation();

        await expect(outcome).resolves.toEqual({
          error: ingressError,
          value: null,
        });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(planner).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([
          "read-route",
          "ingress-failed",
          "control-started",
          "control-failed",
          "begin",
          "plan-recovery-only",
        ]);
      } finally {
        readRoute.mockReset();
        readRoute.mockImplementation(defaultReadRoute);
        resolver.mockReset();
        resolver.mockImplementation(defaultResolver);
        planner.mockReset();
        planner.mockImplementation(defaultPlanner);
        unwrapRoot.mockReset();
        unwrapRoot.mockImplementation(defaultUnwrap);
      }
    });

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

    it("wraps the original pending-root failure as provider-retryable when the transaction proves it is required", async () => {
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

      const failure = await handleHostedOnboardingLinqWebhook({
        prisma: prisma as never,
        rawBody: buildLinqMessageWebhookBody({ chatIsGroup: true }),
        signature: null,
        timestamp: null,
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        cause: preparationError,
        code: "HOSTED_PENDING_GROUP_SETUP_PREPARATION_FAILED",
        details: {
          preparationTarget: "pending_group_setup_payload",
        },
        httpStatus: 503,
        retryable: true,
      });

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

    it.each([
      ["malformed secure-box JSON", () => new SyntaxError("malformed persisted secure-box JSON")],
      ["invalid secure-box schema", () => new TypeError("invalid persisted secure-box schema")],
    ])(
      "returns 503 for %s, preserves the setup, and consumes it exactly once on replay",
      async (_label, createPreparationError) => {
        const { getPrisma } = await import("@/src/lib/prisma");
        const { prepareHostedPendingGroupSetupClaimForParticipants } =
          await import("@/src/lib/hosted-groups/pending-group-setup");
        const { hostedOnboardingError } = await import(
          "@/src/lib/hosted-onboarding/errors"
        );
        const { planHostedOnboardingLinqWebhook } = await import(
          "@/src/lib/hosted-onboarding/webhook-provider-linq"
        );
        const { readHostedThreadRouteByThreadIdentity } = await import(
          "@/src/lib/hosted-routing/thread-route-store"
        );
        const route = await import(
          "../app/api/hosted-onboarding/linq/webhook/route"
        );
        const preparedClaim = {
          id: "hpgs_failed_preparation",
          ownerMemberId: "member_pending_owner",
          payloadEncrypted: "failed-pending-ciphertext",
          payloadRootKeyId: "root_pending_failed",
          recipientPhoneLookupKey: "hplk_pending_line",
        };
        const rawBody = buildLinqMessageWebhookBody({ chatIsGroup: true });
        const prisma = buildPrewarmPrisma();
        let pendingSetupPresent = true;
        let routeCreationCount = 0;
        let setupConsumptionCount = 0;

        vi.mocked(getPrisma).mockReturnValue(prisma as never);
        vi.mocked(readHostedThreadRouteByThreadIdentity)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null);
        vi.mocked(prepareHostedPendingGroupSetupClaimForParticipants)
          .mockImplementationOnce(async () => {
            calls.push("prepare-pending-failed");
            throw createPreparationError();
          })
          .mockImplementationOnce(async () => {
            calls.push("prepare-pending-replay");
            return preparedClaim;
          });
        vi.mocked(planHostedOnboardingLinqWebhook)
          .mockImplementationOnce(async (input) => {
            calls.push("plan-failed");
            expect(pendingSetupPresent).toBe(true);
            expect(input.failedPendingGroupSetupPreparationClaim).toEqual(
              preparedClaim,
            );
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
          })
          .mockImplementationOnce(async (input) => {
            calls.push("plan-replay");
            expect(pendingSetupPresent).toBe(true);
            expect(input.preparedPendingGroupSetupClaim).toEqual(preparedClaim);
            routeCreationCount += 1;
            setupConsumptionCount += 1;
            pendingSetupPresent = false;
            return {
              desiredSideEffects: [],
              response: {
                ok: true as const,
                reason: "pending-setup-replay-consumed",
              },
            };
          });

        const firstResponse = await route.POST(buildWebhookRequest(rawBody));
        expect(firstResponse.status).toBe(503);
        await expect(firstResponse.json()).resolves.toMatchObject({
          error: {
            code: "HOSTED_PENDING_GROUP_SETUP_PREPARATION_FAILED",
            retryable: true,
          },
        });
        expect(pendingSetupPresent).toBe(true);
        expect(routeCreationCount).toBe(0);
        expect(setupConsumptionCount).toBe(0);

        const replayResponse = await route.POST(buildWebhookRequest(rawBody));
        expect(replayResponse.status).toBe(202);
        await expect(replayResponse.json()).resolves.toMatchObject({
          ok: true,
          reason: "pending-setup-replay-consumed",
        });
        expect(pendingSetupPresent).toBe(false);
        expect(routeCreationCount).toBe(1);
        expect(setupConsumptionCount).toBe(1);
        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(calls).toEqual([
          "prepare-pending-failed",
          "prepare-container",
          "begin",
          "plan-failed",
          "prepare-pending-replay",
          "prepare-container",
          "begin",
          "plan-replay",
          "commit",
        ]);
      },
    );

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
