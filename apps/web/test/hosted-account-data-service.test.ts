import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  deleteHostedRunnerUserDataBestEffort: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: serviceMocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  deleteHostedRunnerUserDataBestEffort: serviceMocks.deleteHostedRunnerUserDataBestEffort,
}));

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
  HOSTED_DATA_EXPORT_CONFIRMATION_TEXT,
} from "@/src/lib/hosted-privacy/account-data-shared";
import {
  buildHostedMemberBillingPrivateColumns,
  buildHostedMemberIdentityPrivateColumns,
  buildHostedMemberRoutingPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
import { encryptHostedMailboxPayloadString } from "@/src/lib/hosted-mailbox/encryption";
import {
  buildHostedDataExport,
  deleteHostedAccountData,
  HOSTED_ACCOUNT_DATA_STORE_COVERAGE,
  parseHostedAccountDeletionRequest,
  parseHostedDataExportRequest,
} from "@/src/lib/hosted-privacy/account-data-service";

type HostedAccountDataPrismaForTest = Parameters<typeof buildHostedDataExport>[0]["prisma"];

const REQUIRED_STORE_SLUGS = [
  "prisma.hosted_member",
  "prisma.hosted_member_identity",
  "prisma.hosted_member_routing",
  "prisma.hosted_member_email_authorization",
  "prisma.hosted_member_billing_ref",
  "prisma.hosted_mailbox_item",
  "prisma.hosted_mailbox_payload",
  "prisma.hosted_mailbox_lane_counter",
  "prisma.hosted_workspace",
  "prisma.hosted_runtime_log",
  "prisma.hosted_user_crypto_envelope",
  "prisma.hosted_user_crypto_audit",
  "prisma.hosted_ai_usage",
  "prisma.hosted_linq_daily_state",
  "prisma.hosted_invite",
  "prisma.hosted_consent_event",
  "prisma.hosted_consent_grant",
  "prisma.device_connection",
  "prisma.device_token_audit",
  "prisma.device_sync_signal",
  "prisma.device_oauth_session",
  "prisma.device_agent_session",
  "prisma.device_browser_assertion_nonce",
  "prisma.hosted_web_internal_request_nonce",
  "prisma.device_webhook_trace",
  "cloudflare.runner_durable_object",
  "cloudflare.r2_user_artifacts",
  "providers.oura_whoop_strava",
  "providers.linq_telegram_email_messages",
  "providers.stripe_privy",
  "backups",
] as const;

const VALID_DELETION_MODES = new Set([
  "best-effort-delete",
  "documented-retention",
  "live-delete",
  "local-reference-delete",
]);
const VALID_EXPORT_MODES = new Set([
  "decoded-redacted-data",
  "documented-only",
  "metadata-and-counts",
  "not-exported-secret",
]);

beforeEach(() => {
  serviceMocks.createHostedDeviceSyncControlPlane.mockReset();
  serviceMocks.deleteHostedRunnerUserDataBestEffort.mockReset();
  serviceMocks.deleteHostedRunnerUserDataBestEffort.mockResolvedValue(makeCloudflareDeletionResult());
});

describe("parseHostedAccountDeletionRequest", () => {
  it("requires the exact destructive action phrase and every acknowledgement", () => {
    expect(parseHostedAccountDeletionRequest({
      acknowledgedIrreversibleDeletion: true,
      acknowledgedProviderAndBackupLimits: true,
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
      secondConfirmationAccepted: true,
    })).toEqual({
      acknowledgedIrreversibleDeletion: true,
      acknowledgedProviderAndBackupLimits: true,
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
      secondConfirmationAccepted: true,
    });
  });

  it.each([
    ["lowercase phrase", {
      acknowledgedIrreversibleDeletion: true,
      acknowledgedProviderAndBackupLimits: true,
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE.toLowerCase(),
      secondConfirmationAccepted: true,
    }, "ACCOUNT_DELETION_CONFIRMATION_PHRASE_REQUIRED"],
    ["extra whitespace", {
      acknowledgedIrreversibleDeletion: true,
      acknowledgedProviderAndBackupLimits: true,
      confirmationPhrase: `${HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE} `,
      secondConfirmationAccepted: true,
    }, "ACCOUNT_DELETION_CONFIRMATION_PHRASE_REQUIRED"],
    ["missing second confirmation", {
      acknowledgedIrreversibleDeletion: true,
      acknowledgedProviderAndBackupLimits: true,
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
      secondConfirmationAccepted: false,
    }, "ACCOUNT_DELETION_SECOND_CONFIRMATION_REQUIRED"],
    ["missing irreversible acknowledgement", {
      acknowledgedIrreversibleDeletion: false,
      acknowledgedProviderAndBackupLimits: true,
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
      secondConfirmationAccepted: true,
    }, "ACCOUNT_DELETION_IRREVERSIBLE_ACK_REQUIRED"],
    ["missing provider and backup acknowledgement", {
      acknowledgedIrreversibleDeletion: true,
      acknowledgedProviderAndBackupLimits: false,
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
      secondConfirmationAccepted: true,
    }, "ACCOUNT_DELETION_PROVIDER_BACKUP_ACK_REQUIRED"],
  ])("rejects %s", (_label, body, expectedCode) => {
    let error: unknown;
    try {
      parseHostedAccountDeletionRequest(body);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HostedOnboardingError);
    expect((error as HostedOnboardingError).code).toBe(expectedCode);
    expect((error as HostedOnboardingError).httpStatus).toBe(400);
  });
});

describe("parseHostedDataExportRequest", () => {
  it("requires the exact export phrase and sensitive-download acknowledgement", () => {
    expect(parseHostedDataExportRequest({
      acknowledgedSensitiveDownload: true,
      confirmationText: HOSTED_DATA_EXPORT_CONFIRMATION_TEXT,
    })).toEqual({
      acknowledgedSensitiveDownload: true,
      confirmationText: HOSTED_DATA_EXPORT_CONFIRMATION_TEXT,
    });
  });

  it.each([
    ["lowercase phrase", {
      acknowledgedSensitiveDownload: true,
      confirmationText: HOSTED_DATA_EXPORT_CONFIRMATION_TEXT.toLowerCase(),
    }, "DATA_EXPORT_CONFIRMATION_REQUIRED"],
    ["extra whitespace", {
      acknowledgedSensitiveDownload: true,
      confirmationText: `${HOSTED_DATA_EXPORT_CONFIRMATION_TEXT} `,
    }, "DATA_EXPORT_CONFIRMATION_REQUIRED"],
    ["missing acknowledgement", {
      acknowledgedSensitiveDownload: false,
      confirmationText: HOSTED_DATA_EXPORT_CONFIRMATION_TEXT,
    }, "DATA_EXPORT_ACK_REQUIRED"],
  ])("rejects %s", (_label, body, expectedCode) => {
    let error: unknown;
    try {
      parseHostedDataExportRequest(body);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HostedOnboardingError);
    expect((error as HostedOnboardingError).code).toBe(expectedCode);
    expect((error as HostedOnboardingError).httpStatus).toBe(400);
  });
});

describe("HOSTED_ACCOUNT_DATA_STORE_COVERAGE", () => {
  it("documents every high-value store called out by the deletion/export workflow", () => {
    const slugs = HOSTED_ACCOUNT_DATA_STORE_COVERAGE.map((entry) => entry.slug);

    expect(new Set(slugs).size).toBe(HOSTED_ACCOUNT_DATA_STORE_COVERAGE.length);
    for (const requiredSlug of REQUIRED_STORE_SLUGS) {
      expect(slugs).toContain(requiredSlug);
    }
  });

  it("keeps each store entry actionable for both export and deletion reviews", () => {
    for (const entry of HOSTED_ACCOUNT_DATA_STORE_COVERAGE) {
      expect(entry.label.trim().length).toBeGreaterThan(0);
      expect(entry.note.trim().length).toBeGreaterThan(40);
      expect(VALID_DELETION_MODES.has(entry.deletion)).toBe(true);
      expect(VALID_EXPORT_MODES.has(entry.export)).toBe(true);
    }
  });

  it("marks ciphertext/token stores and external systems with the safest export/deletion modes", () => {
    const bySlug = new Map(HOSTED_ACCOUNT_DATA_STORE_COVERAGE.map((entry) => [entry.slug, entry]));

    expect(bySlug.get("prisma.hosted_mailbox_item")?.export).toBe("metadata-and-counts");
    expect(bySlug.get("prisma.hosted_mailbox_payload")?.export).toBe("not-exported-secret");
    expect(bySlug.get("cloudflare.runner_durable_object")?.deletion).toBe("best-effort-delete");
    expect(bySlug.get("cloudflare.r2_user_artifacts")?.deletion).toBe("best-effort-delete");
    expect(bySlug.get("providers.stripe_privy")?.deletion).toBe("documented-retention");
    expect(bySlug.get("backups")?.deletion).toBe("documented-retention");
  });

  it("documents that deletion-time provider revocation does not enqueue new device sync work", () => {
    const deviceSyncSignal = HOSTED_ACCOUNT_DATA_STORE_COVERAGE.find((entry) =>
      entry.slug === "prisma.device_sync_signal");

    expect(deviceSyncSignal?.note).toContain("pre-existing");
    expect(deviceSyncSignal?.note).toContain("does not enqueue new disconnect or wake work");
  });
});

describe("buildHostedDataExport", () => {
  it("exports high-value user data while omitting secrets and lookup material", async () => {
    const exported = await buildHostedDataExport({
      memberId: "member_123",
      prisma: await createHostedAccountDataExportPrismaForTest(),
    });
    const serialized = JSON.stringify(exported);

    expect(exported).toMatchObject({
      account: {
        billingRef: {
          stripeCustomerId: "cus_export_123",
          stripeSubscriptionId: "sub_export_123",
        },
        identity: {
          phoneNumber: "+15550100123",
          privyUserId: "privy-user-123",
          signupPhoneCodeSendAttemptPresent: true,
          walletAddress: "0xabc123",
        },
        routing: {
          linqChatId: "linq-chat-123",
          telegramUserId: "telegram-user-123",
        },
      },
      counts: {
        "prisma.hosted_mailbox_payload": 1,
        "prisma.hosted_user_crypto_audit": 1,
        "prisma.hosted_user_crypto_envelope": 1,
      },
      limits: {
        maxRowsPerStore: 250,
        stores: {
          aiUsage: {
            exportedRows: 1,
            maxRows: 250,
            truncated: false,
          },
          mailboxItems: {
            exportedRows: 3,
            maxRows: 250,
            truncated: false,
          },
        },
      },
      schema: "murph.hosted-data-export.v1",
      usage: {
        aiUsage: [
          {
            apiKeyEnvConfigured: true,
            baseUrlConfigured: true,
            gatewayTagsOmitted: true,
            idPresent: true,
            routeIdPresent: true,
            sessionIdPresent: true,
            stripeMeterErrorPresent: true,
            stripeMeterIdentifierPresent: true,
            turnIdPresent: true,
          },
        ],
      },
      consent: {
        events: [
          {
            action: "accepted",
            idPresent: true,
            metadataPresent: true,
            scope: "launch.legal",
            source: "settings",
          },
        ],
        grants: [
          {
            scope: "launch.legal",
            source: "settings",
            status: "granted",
            lastEventIdPresent: true,
          },
        ],
      },
      vault: {
        workspace: {
          browserVaultReplicaRefPresent: true,
          snapshotRefPresent: true,
        },
      },
      wearables: {
        deviceConnections: [
          {
            idPresent: true,
            keyVersionPresent: true,
            lastErrorMessagePresent: false,
            metadataPresent: true,
            providerAccountLinked: true,
            scopesPresent: true,
            tokenVersionPresent: true,
          },
        ],
        deviceSyncSignals: [
          {
            connectionIdPresent: true,
            idPresent: true,
            revokeWarningMessagePresent: false,
            traceIdPresent: true,
          },
        ],
        deviceTokenAudits: [
          {
            connectionIdPresent: true,
            expectedTokenVersionPresent: true,
            idPresent: true,
            keyVersionPresent: true,
            sessionIdPresent: true,
            tokenVersionPresent: true,
          },
        ],
      },
      diagnostics: {
        runtimeLogs: [
          {
            attemptIdPresent: true,
            checkpointVersionPresent: true,
            idPresent: true,
            leaseGenerationPresent: true,
            mailboxSeqEndPresent: true,
            mailboxSeqStartPresent: true,
            workspaceVersionPresent: true,
          },
        ],
      },
    });
    const consent = requireRecord(exported.consent);
    expect(requireArray(consent.events)[0]).not.toHaveProperty("metadataJson");
    expect(exported.messaging).toMatchObject({
      invites: [
        {
          idPresent: true,
          inviteCodeOmitted: true,
        },
      ],
      mailboxItems: expect.arrayContaining([
        expect.objectContaining({
          dedupeKeyPresent: true,
          idPresent: true,
          payload: {
            decodedPayloadOmitted: true,
            status: "present-omitted",
          },
          payloadRefPresent: false,
        }),
        expect.objectContaining({
          payload: {
            decodedPayloadOmitted: true,
            status: "present-omitted",
          },
        }),
        expect.objectContaining({
          payload: {
            decodedPayloadOmitted: true,
            status: "present-omitted",
          },
        }),
      ]),
    });
    expect(serialized).not.toContain("secret-provider-account-blind-index");
    expect(serialized).not.toContain("secret-agent-token-hash");
    expect(serialized).not.toContain("SECRET_API_KEY_ENV");
    expect(serialized).not.toContain("invite-code-raw");
    expect(serialized).not.toContain("oauth-state");
    expect(serialized).not.toContain("secret-privy");
    expect(serialized).not.toContain("secret-wallet");
    expect(serialized).not.toContain("secret-telegram");
    expect(serialized).not.toContain("hbpc_send_attempt_secret");
    expect(serialized).not.toContain("workspace-object-key");
    expect(serialized).not.toContain("workspace-bundle-hash");
    expect(serialized).not.toContain("secret-dedupe-key");
    expect(serialized).not.toContain("secret-phone-lookup-key");
    expect(serialized).not.toContain("secret-raw-message-key");
    expect(serialized).not.toContain("secret-delivery-dedupe-token");
    expect(serialized).not.toContain("secret-delivery-idempotency-key");
    expect(serialized).not.toContain("secret-route-identity");
    expect(serialized).not.toContain("secret-media-download-url");
    expect(serialized).not.toContain("secret-media-download-url-2");
    expect(serialized).not.toContain("secret-media-object-key");
    expect(serialized).not.toContain("secret-access-token-encrypted");
    expect(serialized).not.toContain("SECRET_MAILBOX_API_KEY_ENV");
    expect(serialized).not.toContain("secret-credential-id");
    expect(serialized).not.toContain("hello from mailbox");
    expect(serialized).not.toContain("https://gateway.example");
    expect(serialized).not.toContain("gatewayTagsJson");
    expect(serialized).not.toContain("secret-stripe-meter-error");
    expect(serialized).not.toContain("secret-stripe-meter-id");
    expect(serialized).not.toContain("shallow");
    expect(serialized).not.toContain("secret-runtime-diagnostic");
    expect(serialized).not.toContain("secret-outbox-intent-ref");
    expect(serialized).not.toContain("device-1");
    expect(serialized).not.toContain("agent-session-1");
    expect(serialized).not.toContain("usage-1");
    expect(serialized).not.toContain("route-a");
    expect(serialized).not.toContain("runtime-log-1");
    expect(serialized).not.toContain("attempt-1");
    expect(serialized).not.toContain("mailbox-1");
    expect(serialized).not.toContain("invite-1");
    expect(serialized).not.toContain("consent-event-1");
    expect(serialized).not.toContain("trace-1");
    expect(serialized).not.toContain("secret-consent-metadata");
  });

  it("bounds large stores and reports truncation metadata", async () => {
    const memberId = "member_123";
    const exported = await buildHostedDataExport({
      memberId,
      prisma: await createHostedAccountDataExportPrismaForTest({
        aiUsageRows: Array.from({ length: 251 }, (_unused, index) =>
          makeHostedAiUsageRowForTest({
            id: `usage-${index}`,
            memberId,
          })),
      }),
    });

    expect(exported).toMatchObject({
      limits: {
        stores: {
          aiUsage: {
            exportedRows: 250,
            maxRows: 250,
            truncated: true,
          },
        },
      },
    });
    const usage = requireRecord(exported.usage);
    expect(requireArray(usage.aiUsage)).toHaveLength(250);
  });
});

describe("deleteHostedAccountData", () => {
  it("runs Cloudflare cleanup before deleting Prisma rows that cascade crypto roots", async () => {
    const order: string[] = [];
    serviceMocks.deleteHostedRunnerUserDataBestEffort.mockImplementation(async () => {
      order.push("cloudflare");
      return makeCloudflareDeletionResult();
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => order.push("prisma"),
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(order).toEqual(["cloudflare", "prisma"]);
    expect(result.cloudflare.deleted).toBe(true);
    expect(serviceMocks.deleteHostedRunnerUserDataBestEffort).toHaveBeenCalledWith({
      context: "settings.account-data.delete",
      userId: "member_123",
    });
  });

  it("keeps Cloudflare cleanup before Prisma even when the later transaction fails", async () => {
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => {
        throw new Error("transaction failed");
      },
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toThrow("transaction failed");

    expect(serviceMocks.deleteHostedRunnerUserDataBestEffort).toHaveBeenCalledWith({
      context: "settings.account-data.delete",
      userId: "member_123",
    });
  });

  it("does not report provider-config device connections as provider-revoked without OAuth tokens", async () => {
    const order: string[] = [];
    const revokeAccess = vi.fn();
    const getStoredConnectionAccountForUser = vi.fn(async () => ({
      accessTokenExpiresAt: null,
      connectedAt: "2026-04-27T00:07:00.000Z",
      createdAt: "2026-04-27T00:07:00.000Z",
      credential: {
        kind: "provider_config" as const,
        credentialMetadata: {},
        providerConfigKey: "junction",
      },
      disconnectGeneration: 0,
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      id: "dsc_junction",
      keyVersion: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: null,
      metadata: {},
      nextReconcileAt: null,
      provider: "junction",
      scopes: [],
      setupExpiresAt: null,
      setupPhase: null,
      status: "active" as const,
      tokenVersion: null,
      updatedAt: "2026-04-27T00:07:00.000Z",
    }));
    serviceMocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      registry: {
        get: vi.fn(() => ({
          connectionHandler: {
            revokeAccess,
          },
        })),
      },
      store: {
        getStoredConnectionAccountForUser,
      },
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      deviceConnections: [
        {
          id: "dsc_junction",
          provider: "junction",
          providerAccountBlindIndex: "blind-index",
        },
      ],
      onTransaction: () => order.push("prisma"),
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(getStoredConnectionAccountForUser).toHaveBeenCalledWith("member_123", "dsc_junction");
    expect(revokeAccess).not.toHaveBeenCalled();
    expect(order).toEqual(["prisma"]);
    expect(result.providerRevocations).toEqual([
      {
        connectionId: "dsc_junction",
        errorCode: null,
        provider: "junction",
        status: "warning",
        warningCode: "CONNECTION_SECRET_MISSING",
      },
    ]);
  });
});

function makeHostedAiUsageRowForTest(input: {
  id?: string;
  memberId: string;
}) {
  return {
    apiKeyEnv: "SECRET_API_KEY_ENV",
    attemptCount: 1,
    baseUrl: "https://gateway.example",
    cacheWriteTokens: null,
    cachedInputTokens: null,
    createdAt: new Date("2026-04-27T00:24:00.000Z"),
    credentialSource: "member",
    featureKey: "assistant",
    gatewayTagsJson: { surface: "settings" },
    id: input.id ?? "usage-1",
    inputTokens: 10,
    memberId: input.memberId,
    occurredAt: new Date("2026-04-27T00:23:00.000Z"),
    outputTokens: 20,
    provider: "openai",
    providerName: "OpenAI",
    reasoningTokens: null,
    reportingUserId: input.memberId,
    requestedModel: "model-a",
    routeId: "route-a",
    servedModel: "model-b",
    sessionId: "session-1",
    stripeMeterAttemptCount: 0,
    stripeMeteredAt: null,
    stripeMeterError: "secret-stripe-meter-error",
    stripeMeterIdentifier: "secret-stripe-meter-id",
    stripeMeterLastAttemptedAt: null,
    stripeMeterNextAttemptAt: null,
    stripeMeterSource: "murph",
    stripeMeterStatus: "pending",
    surface: "assistant",
    totalTokens: 30,
    triggerKind: "manual",
    turnId: "turn-1",
    updatedAt: new Date("2026-04-27T00:24:00.000Z"),
  };
}

async function encryptHostedMailboxPayloadForFixture(input: {
  dedupeKey: string;
  itemId: string;
  kind: string;
  lane: string;
  laneSeq: bigint;
  occurredAt: string;
  userId: string;
  value: unknown;
}): Promise<string | null> {
  return encryptHostedMailboxPayloadString({
    dedupeKey: input.dedupeKey,
    itemId: input.itemId,
    kind: input.kind,
    lane: input.lane,
    laneSeq: input.laneSeq,
    occurredAt: input.occurredAt,
    payloadSchema: "murph.hosted-mailbox-item-payload.v1",
    payloadStorage: "inline",
    userId: input.userId,
    value: JSON.stringify(input.value),
  });
}

async function createHostedAccountDataExportPrisma(input: {
  aiUsageRows?: ReturnType<typeof makeHostedAiUsageRowForTest>[];
} = {}) {
  const count = async () => 1;
  const memberId = "member_123";
  const linqMailboxPayload = await encryptHostedMailboxPayloadForFixture({
    dedupeKey: "secret-dedupe-key-linq",
    itemId: "mailbox-1",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: 1n,
    occurredAt: "2026-04-27T00:24:30.000Z",
    userId: memberId,
    value: {
      eventId: "mailbox-event-linq",
      kind: "conversation.message",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "linq-chat-123",
          from: "+15550100123",
          isFromMe: false,
          messageId: "linq-message-1",
          parts: [
            {
              type: "text",
              value: "hello from mailbox",
            },
            {
              type: "media",
              downloadUrl: "secret-media-download-url-2",
              storageObjectKey: "secret-media-object-key",
              url: "secret-media-download-url",
            },
          ],
        },
        phoneLookupKey: "secret-phone-lookup-key",
      },
      occurredAt: "2026-04-27T00:24:30.000Z",
      authPayload: {
        accessTokenEncrypted: "secret-access-token-encrypted",
        apiKeyEnv: "SECRET_MAILBOX_API_KEY_ENV",
        credentialId: "secret-credential-id",
      },
      userId: memberId,
    },
  });
  const emailMailboxPayload = await encryptHostedMailboxPayloadForFixture({
    dedupeKey: "secret-dedupe-key-email",
    itemId: "mailbox-2",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: 2n,
    occurredAt: "2026-04-27T00:24:45.000Z",
    userId: memberId,
    value: {
      eventId: "mailbox-event-email",
      kind: "conversation.message",
      message: {
        channel: "email",
        identityId: "email-identity-1",
        rawMessageKey: "secret-raw-message-key",
        selfAddress: "member@example.test",
      },
      occurredAt: "2026-04-27T00:24:45.000Z",
      userId: memberId,
    },
  });
  const systemMailboxPayload = await encryptHostedMailboxPayloadForFixture({
    dedupeKey: "secret-dedupe-key-system",
    itemId: "mailbox-3",
    kind: "assistant.notification.requested",
    lane: "system",
    laneSeq: 1n,
    occurredAt: "2026-04-27T00:25:15.000Z",
    userId: memberId,
    value: {
      eventId: "mailbox-event-system",
      kind: "assistant.notification.requested",
      notification: {
        deliveryDedupeToken: "secret-delivery-dedupe-token",
        deliveryIdempotencyKey: "secret-delivery-idempotency-key",
        instructions: "welcome the member",
        route: {
          actorId: null,
          channel: "linq",
          delivery: {
            kind: "explicit",
            target: "+15550100123",
          },
          identityId: "secret-route-identity",
          threadId: "linq-chat-123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-27T00:25:15.000Z",
      userId: memberId,
    },
  });
  const billingPrivateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId,
    stripeCustomerId: "cus_export_123",
    stripeSubscriptionId: "sub_export_123",
  });
  const identityPrivateColumns = await buildHostedMemberIdentityPrivateColumns({
    memberId,
    phoneNumber: "+15550100123",
    privyUserId: "privy-user-123",
    signupPhoneCodeSendAttemptId: "hbpc_send_attempt_secret",
    signupPhoneCodeSendAttemptStartedAt: new Date("2026-04-27T00:01:30.000Z"),
    signupPhoneCodeSentAt: new Date("2026-04-27T00:01:45.000Z"),
    signupPhoneNumber: "+15550100123",
    walletAddress: "0xabc123",
  });
  const routingPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
    linqChatId: "linq-chat-123",
    linqRecipientPhone: "+15550100123",
    memberId,
    pendingLinqChatId: "pending-linq-chat-123",
    pendingLinqRecipientPhone: "+15550100124",
    telegramThreadId: "telegram-thread-123",
    telegramUserId: "telegram-user-123",
  });

  return {
    $queryRaw: async () => [{ count: 1n }],
    $transaction: async () => {
      throw new Error("Unexpected transaction during export proof.");
    },
    deviceBrowserAssertionNonce: { count },
    deviceConnection: {
      count,
      findMany: async () => [
        {
          connectedAt: new Date("2026-04-27T00:07:00.000Z"),
          createdAt: new Date("2026-04-27T00:07:00.000Z"),
          displayName: "WHOOP",
          id: "device-1",
          accessTokenExpiresAt: new Date("2026-04-27T00:07:30.000Z"),
          keyVersion: "v1",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: new Date("2026-04-27T00:08:00.000Z"),
          lastSyncErrorAt: null,
          lastSyncStartedAt: new Date("2026-04-27T00:07:45.000Z"),
          lastWebhookAt: new Date("2026-04-27T00:07:40.000Z"),
          metadataJson: { shallow: "metadata" },
          nextReconcileAt: new Date("2026-04-27T00:12:00.000Z"),
          provider: "whoop",
          providerAccountBlindIndex: "secret-provider-account-blind-index",
          scopesJson: ["read:profile"],
          status: "active",
          tokenVersion: 2,
          updatedAt: new Date("2026-04-27T00:09:00.000Z"),
          userId: memberId,
        },
      ],
    },
    deviceOauthSession: {
      count,
      findMany: async () => [{ state: "oauth-state" }],
    },
    deviceSyncSignal: {
      count,
      findMany: async () => [
        {
          connectionId: "device-1",
          createdAt: new Date("2026-04-27T00:15:00.000Z"),
          eventType: "webhook",
          id: 1,
          kind: "provider-webhook",
          nextReconcileAt: null,
          occurredAt: new Date("2026-04-27T00:14:00.000Z"),
          provider: "whoop",
          reason: "sync",
          resourceCategory: "sleep",
          revokeWarningCode: null,
          revokeWarningMessage: null,
          traceId: "trace-1",
          userId: memberId,
        },
      ],
    },
    deviceTokenAudit: {
      count,
      findMany: async () => [
        {
          action: "refresh",
          channel: "background",
          connectionId: "device-1",
          createdAt: new Date("2026-04-27T00:16:00.000Z"),
          expectedTokenVersion: 1,
          forceRefresh: false,
          id: 1,
          keyVersion: "v1",
          provider: "whoop",
          refreshOutcome: "success",
          sessionId: "session-1",
          tokenVersion: 2,
          tokenVersionChanged: true,
          userId: memberId,
        },
      ],
    },
    deviceWebhookTrace: { count },
    deviceAgentSession: {
      count,
      findMany: async () => [
        {
          createdAt: new Date("2026-04-27T00:18:00.000Z"),
          expiresAt: new Date("2026-04-28T00:18:00.000Z"),
          id: "agent-session-1",
          label: "Laptop",
          lastSeenAt: null,
          replacedBySessionId: null,
          revokedAt: null,
          revokeReason: null,
          tokenHash: "secret-agent-token-hash",
          updatedAt: new Date("2026-04-27T00:18:00.000Z"),
          userId: memberId,
        },
      ],
    },
    hostedAiUsage: {
      count,
      findMany: async () => input.aiUsageRows ?? [makeHostedAiUsageRowForTest({ memberId })],
    },
    hostedConsentEvent: {
      count,
      findMany: async () => [
        {
          action: "accepted",
          createdAt: new Date("2026-04-27T00:18:30.000Z"),
          documentVersionsJson: {
            privacy: "2026-04-24",
            terms: "2026-04-24",
          },
          id: "consent-event-1",
          memberId,
          metadataJson: {
            surface: "secret-consent-metadata",
          },
          scope: "launch.legal",
          source: "settings",
        },
      ],
    },
    hostedConsentGrant: {
      count,
      findMany: async () => [
        {
          createdAt: new Date("2026-04-27T00:18:30.000Z"),
          documentVersionsJson: {
            privacy: "2026-04-24",
            terms: "2026-04-24",
          },
          grantedAt: new Date("2026-04-27T00:18:30.000Z"),
          lastEventId: "consent-event-1",
          memberId,
          revokedAt: null,
          scope: "launch.legal",
          source: "settings",
          status: "granted",
          updatedAt: new Date("2026-04-27T00:18:31.000Z"),
        },
      ],
    },
    hostedInvite: {
      count,
      findMany: async () => [
        {
          channel: "linq",
          createdAt: new Date("2026-04-27T00:19:00.000Z"),
          expiresAt: new Date("2026-04-28T00:19:00.000Z"),
          id: "invite-1",
          inviteCode: "invite-code-raw",
          memberId,
          sentAt: new Date("2026-04-27T00:20:00.000Z"),
          updatedAt: new Date("2026-04-27T00:20:00.000Z"),
        },
      ],
    },
    hostedLinqDailyState: {
      count,
      findMany: async () => [
        {
          createdAt: new Date("2026-04-27T00:21:00.000Z"),
          dayUtc: new Date("2026-04-27T00:00:00.000Z"),
          firstSeenAt: new Date("2026-04-27T00:21:00.000Z"),
          inboundCount: 2,
          lastSeenAt: new Date("2026-04-27T00:22:00.000Z"),
          memberId,
          onboardingLinkSentAt: null,
          outboundCount: 1,
          quotaReplySentAt: null,
          updatedAt: new Date("2026-04-27T00:22:00.000Z"),
        },
      ],
    },
    hostedMailboxItem: {
      count,
      findMany: async () => [
        {
          createdAt: new Date("2026-04-27T00:25:00.000Z"),
          dedupeKey: "secret-dedupe-key-linq",
          expiresAt: null,
          id: "mailbox-1",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: 1n,
          occurredAt: new Date("2026-04-27T00:24:30.000Z"),
          payload: null,
          payloadBytes: 512,
          payloadInlineCiphertext: linqMailboxPayload,
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item-payload.v1",
          updatedAt: new Date("2026-04-27T00:25:00.000Z"),
          userId: memberId,
        },
        {
          createdAt: new Date("2026-04-27T00:25:10.000Z"),
          dedupeKey: "secret-dedupe-key-email",
          expiresAt: null,
          id: "mailbox-2",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: 2n,
          occurredAt: new Date("2026-04-27T00:24:45.000Z"),
          payload: null,
          payloadBytes: 384,
          payloadInlineCiphertext: emailMailboxPayload,
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item-payload.v1",
          updatedAt: new Date("2026-04-27T00:25:10.000Z"),
          userId: memberId,
        },
        {
          createdAt: new Date("2026-04-27T00:25:20.000Z"),
          dedupeKey: "secret-dedupe-key-system",
          expiresAt: null,
          id: "mailbox-3",
          kind: "assistant.notification.requested",
          lane: "system",
          laneSeq: 1n,
          occurredAt: new Date("2026-04-27T00:25:15.000Z"),
          payload: null,
          payloadBytes: 512,
          payloadInlineCiphertext: systemMailboxPayload,
          payloadRef: null,
          payloadSchema: "murph.hosted-mailbox-item-payload.v1",
          updatedAt: new Date("2026-04-27T00:25:20.000Z"),
          userId: memberId,
        },
      ],
    },
    hostedMailboxLaneCounter: {
      count,
      findMany: async () => [
        {
          lane: "conversation",
          nextSeq: 2n,
          updatedAt: new Date("2026-04-27T00:25:30.000Z"),
          userId: memberId,
        },
      ],
    },
    hostedMailboxPayload: { count },
    hostedMember: {
      count,
      findUnique: async () => ({
        billingRef: {
          createdAt: new Date("2026-04-27T00:00:00.000Z"),
          lastStripeEventCreatedAt: new Date("2026-04-27T00:00:30.000Z"),
          memberId,
          stripeCustomerLookupKey: "secret-stripe-customer",
          stripeSubscriptionLookupKey: "secret-stripe-subscription",
          updatedAt: new Date("2026-04-27T00:00:30.000Z"),
          ...billingPrivateColumns,
        },
        billingStatus: "active",
        createdAt: new Date("2026-04-27T00:00:00.000Z"),
        emailAuthorization: {
          directPublicSenderAuthorizedAt: null,
          directPublicSenderAddressEncrypted: null,
          directPublicSenderLookupKey: "secret-direct-public-sender",
          memberId,
          verifiedEmailAddressEncrypted: null,
          verifiedEmailLookupKey: "secret-verified-email",
          verifiedEmailVerifiedAt: new Date("2026-04-27T00:01:00.000Z"),
        },
        hostedWorkspace: {
          browserVaultReplicaRef: { opaque: true },
          checkpointedAt: new Date("2026-04-27T00:04:00.000Z"),
          nextWakeAt: new Date("2026-04-27T00:05:00.000Z"),
          nextWakeReason: "nudge",
          redactedStatusJson: { private: true },
          snapshotRef: { private: true },
          updatedAt: new Date("2026-04-27T00:06:00.000Z"),
          version: 9n,
        },
        id: "member_123",
        identity: {
          createdAt: new Date("2026-04-27T00:02:00.000Z"),
          maskedPhoneNumberHint: "+1 **** 1234",
          memberId,
          phoneLookupKey: "secret-phone",
          phoneNumberVerifiedAt: new Date("2026-04-27T00:02:00.000Z"),
          privyUserLookupKey: "secret-privy",
          updatedAt: new Date("2026-04-27T00:03:00.000Z"),
          walletAddressLookupKey: "secret-wallet",
          walletChainType: "ethereum",
          walletCreatedAt: new Date("2026-04-27T00:03:00.000Z"),
          walletProvider: "privy",
          ...identityPrivateColumns,
        },
        pendingActivationTimeZone: null,
        routing: {
          createdAt: new Date("2026-04-27T00:03:30.000Z"),
          linqChatLookupKey: "secret-linq-home",
          linqRecipientPhoneLookupKey: "secret-linq-recipient",
          memberId,
          pendingLinqChatLookupKey: "secret-pending-linq",
          pendingLinqRecipientPhoneLookupKey: "secret-pending-linq-recipient",
          replyAliasLookupKey: "secret-reply-alias",
          telegramUserLookupKey: "secret-telegram",
          updatedAt: new Date("2026-04-27T00:03:30.000Z"),
          ...routingPrivateColumns,
        },
        suspendedAt: null,
        updatedAt: new Date("2026-04-27T00:12:00.000Z"),
      }),
    },
    hostedMemberBillingRef: { count },
    hostedMemberEmailAuthorization: { count },
    hostedMemberIdentity: { count },
    hostedMemberRouting: { count },
    hostedRuntimeLog: {
      count,
      findMany: async () => [
        {
          at: new Date("2026-04-27T00:26:00.000Z"),
          attemptId: "attempt-1",
          checkpointVersion: 9n,
          component: "runtime",
          createdAt: new Date("2026-04-27T00:26:00.000Z"),
          errorCode: null,
          eventCode: "runtime.ok",
          id: "runtime-log-1",
          leaseGeneration: 3n,
          level: "info",
          mailboxLane: "conversation",
          mailboxSeqEnd: 1n,
          mailboxSeqStart: 1n,
          outboxIntentRef: "secret-outbox-intent-ref",
          phase: "assistant",
          redactedJson: { message: "secret-runtime-diagnostic" },
          userId: memberId,
          workspaceVersion: 9n,
        },
      ],
    },
    hostedWorkspace: {
      count,
      findUnique: async () => ({
        browserVaultReplicaRef: {
          objectKey: "workspace-object-key",
          sourceBundleHash: "workspace-bundle-hash",
        },
        checkpointedAt: new Date("2026-04-27T00:04:00.000Z"),
        createdAt: new Date("2026-04-27T00:04:00.000Z"),
        nextWakeAt: new Date("2026-04-27T00:05:00.000Z"),
        nextWakeReason: "nudge",
        redactedStatusJson: { private: true },
        snapshotRef: {
          hash: "workspace-bundle-hash",
          key: "workspace-object-key",
        },
        updatedAt: new Date("2026-04-27T00:06:00.000Z"),
        userId: memberId,
        version: 9n,
      }),
    },
    hostedWebInternalRequestNonce: { count },
  };
}

async function createHostedAccountDataExportPrismaForTest(
  input?: Parameters<typeof createHostedAccountDataExportPrisma>[0],
): Promise<HostedAccountDataPrismaForTest> {
  // This fake implements the Prisma delegates exercised by this focused unit test.
  const fakePrisma: unknown = await createHostedAccountDataExportPrisma(input);
  return fakePrisma as HostedAccountDataPrismaForTest;
}

function createHostedAccountDeletionPrismaForTest(input: {
  deviceConnections?: Array<{
    id: string;
    provider: string;
    providerAccountBlindIndex: string;
  }>;
  onTransaction: () => void;
}): Parameters<typeof deleteHostedAccountData>[0]["prisma"] {
  const fakePrisma: unknown = {
    deviceConnection: {
      findMany: async () => input.deviceConnections ?? [],
    },
    hostedMember: {
      findUnique: async () => ({ id: "member_123" }),
    },
    $transaction: async () => {
      input.onTransaction();
      return {
        "prisma.hosted_member": 1,
      };
    },
  };
  return fakePrisma as Parameters<typeof deleteHostedAccountData>[0]["prisma"];
}

function makeCloudflareDeletionResult() {
  return {
    alarmCleared: true,
    configured: true,
    deleted: true,
    errorCode: null,
    r2DeletedObjectCount: 0,
    r2SkippedUserScopedPrefixes: false,
    r2Supported: true,
    r2UserScopedSkipReason: null,
    runnerStateDeleted: true,
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected a record.");
  }

  return value as Record<string, unknown>;
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Expected an array.");
  }

  return value;
}
