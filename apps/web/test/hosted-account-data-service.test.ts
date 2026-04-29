import { describe, expect, it } from "vitest";

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
import { encryptHostedMailboxNullableString } from "@/src/lib/hosted-mailbox/encryption";
import {
  buildHostedAccountDataExport,
  buildHostedDataExport,
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
  "prisma.hosted_vault_sync_session",
  "prisma.hosted_vault_sync_payload",
  "prisma.hosted_workspace",
  "prisma.hosted_runtime_log",
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
  "providers.oura_whoop_garmin_strava",
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

    expect(bySlug.get("prisma.hosted_mailbox_payload")?.export).toBe("decoded-redacted-data");
    expect(bySlug.get("prisma.hosted_vault_sync_payload")?.export).toBe("not-exported-secret");
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

describe("buildHostedAccountDataExport", () => {
  it("returns metadata and counts without resurfacing lookup secrets or ciphertext", async () => {
    const exported = await buildHostedAccountDataExport({
      memberId: "member_123",
      prisma: createHostedAccountDataExportPrismaForTest(),
    });

    expect(exported.schema).toBe("murph.hosted-account-data-export.v1");
    expect(exported.counts["prisma.hosted_mailbox_payload"]).toBe(1);
    expect(exported.counts["prisma.hosted_vault_sync_payload"]).toBe(1);
    expect(exported.identity).toEqual({
      maskedPhoneNumberHint: "+1 **** 1234",
      phoneNumberVerifiedAt: "2026-04-27T00:02:00.000Z",
      privyUserLinked: true,
      walletAddressLinked: true,
      walletChainType: "ethereum",
      walletCreatedAt: "2026-04-27T00:03:00.000Z",
      walletProvider: "privy",
    });
    expect(Object.keys(exported.identity ?? {}).sort()).toEqual([
      "maskedPhoneNumberHint",
      "phoneNumberVerifiedAt",
      "privyUserLinked",
      "walletAddressLinked",
      "walletChainType",
      "walletCreatedAt",
      "walletProvider",
    ]);
    expect(exported.routing).toEqual({
      linqHomeThreadLinked: true,
      linqRecipientLinked: true,
      pendingLinqThreadLinked: true,
      replyAliasLinked: true,
      telegramLinked: true,
    });
    expect(exported.workspace).toEqual({
      browserVaultReplicaRefPresent: true,
      checkpointedAt: "2026-04-27T00:04:00.000Z",
      nextWakeAt: "2026-04-27T00:05:00.000Z",
      nextWakeReason: "nudge",
      redactedStatusPresent: true,
      snapshotRefPresent: true,
      updatedAt: "2026-04-27T00:06:00.000Z",
      version: "9",
    });
    expect(exported.deviceConnections).toEqual([
      {
        connectedAt: "2026-04-27T00:07:00.000Z",
        createdAt: "2026-04-27T00:07:00.000Z",
        displayName: "WHOOP",
        id: "device-1",
        lastSyncCompletedAt: "2026-04-27T00:08:00.000Z",
        provider: "whoop",
        status: "active",
        updatedAt: "2026-04-27T00:09:00.000Z",
      },
    ]);
    expect(Object.keys(exported.deviceConnections[0] ?? {}).sort()).toEqual([
      "connectedAt",
      "createdAt",
      "displayName",
      "id",
      "lastSyncCompletedAt",
      "provider",
      "status",
      "updatedAt",
    ]);
    expect(exported.vaultSyncSessions).toEqual([
      {
        createdAt: "2026-04-27T00:10:00.000Z",
        direction: "import",
        expiresAt: "2026-04-27T01:10:00.000Z",
        id: "vault-sync-1",
        payloadPresent: true,
        sourceSchemaVersion: "3",
        sourceVaultIdPresent: true,
        sourceVaultTitle: "Source Vault",
        status: "ready",
        updatedAt: "2026-04-27T00:11:00.000Z",
      },
    ]);
    expect(Object.keys(exported.vaultSyncSessions[0] ?? {}).sort()).toEqual([
      "createdAt",
      "direction",
      "expiresAt",
      "id",
      "payloadPresent",
      "sourceSchemaVersion",
      "sourceVaultIdPresent",
      "sourceVaultTitle",
      "status",
      "updatedAt",
    ]);
    expect(exported.retentionNotes).toEqual([
      "Live Prisma, hosted mailbox, vault sync, device, runtime, and workspace rows are deleted immediately by this workflow.",
      "Cloudflare Durable Object/R2 cleanup is best effort and reported in the deletion result when hosted execution control is configured.",
      "Provider-side data deletion is limited to revocation hooks and external provider retention controls.",
      "Stripe, Privy, carrier/email/Telegram/Linq provider records, and infrastructure backups follow their documented retention/legal processes.",
    ]);
    expect(Object.keys(exported).sort()).toEqual([
      "coverage",
      "counts",
      "deviceConnections",
      "emailAuthorization",
      "generatedAt",
      "identity",
      "member",
      "retentionNotes",
      "routing",
      "schema",
      "vaultSyncSessions",
      "workspace",
    ].sort());
    expect(exported).not.toHaveProperty("mailboxPayloads");
    expect(exported).not.toHaveProperty("providerTokens");
    expect(exported).not.toHaveProperty("ciphertext");
  });
});

describe("buildHostedDataExport", () => {
  it("exports high-value user data while omitting secrets and lookup material", async () => {
    const exported = await buildHostedDataExport({
      memberId: "member_123",
      prisma: createHostedAccountDataExportPrismaForTest(),
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
      schema: "murph.hosted-data-export.v1",
      usage: {
        aiUsage: [
          {
            apiKeyEnvConfigured: true,
          },
        ],
      },
      consent: {
        events: [
          {
            action: "accepted",
            scope: "launch.required",
            source: "settings",
          },
        ],
        grants: [
          {
            scope: "launch.required",
            source: "settings",
            status: "granted",
          },
        ],
      },
      vault: {
        workspace: {
          browserVaultReplicaRefPresent: true,
          snapshotRefPresent: true,
        },
        vaultSyncSessions: [
          {
            payload: {
              payloadOmitted: true,
              payloadSchema: "murph.hosted-vault-sync-payload.v1",
            },
          },
        ],
      },
    });
    expect(exported.messaging).toMatchObject({
      mailboxItems: expect.arrayContaining([
        expect.objectContaining({
          dedupeKeyPresent: true,
          payload: {
            status: "decoded",
            value: expect.objectContaining({
              message: expect.objectContaining({
                channel: "linq",
                linqMessage: expect.objectContaining({
                  parts: [
                    {
                      type: "text",
                      value: "hello from mailbox",
                    },
                    {
                      type: "media",
                      downloadUrlOmitted: true,
                      storageObjectKeyOmitted: true,
                      urlOmitted: true,
                    },
                  ],
                }),
                phoneLookupKeyOmitted: true,
              }),
              authPayload: expect.objectContaining({
                accessTokenEncryptedOmitted: true,
                apiKeyEnvOmitted: true,
                credentialIdOmitted: true,
              }),
            }),
          },
          payloadRefPresent: false,
        }),
        expect.objectContaining({
          payload: {
            status: "decoded",
            value: expect.objectContaining({
              message: expect.objectContaining({
                channel: "email",
                rawMessageKeyOmitted: true,
              }),
            }),
          },
        }),
        expect.objectContaining({
          payload: {
            status: "decoded",
            value: expect.objectContaining({
              notification: expect.objectContaining({
                deliveryDedupeTokenOmitted: true,
                deliveryIdempotencyKeyOmitted: true,
                route: expect.objectContaining({
                  identityIdOmitted: true,
                }),
              }),
            }),
          },
        }),
      ]),
    });
    expect(serialized).not.toContain("secret-provider-account-blind-index");
    expect(serialized).not.toContain("secret-agent-token-hash");
    expect(serialized).not.toContain("SECRET_API_KEY_ENV");
    expect(serialized).not.toContain("invite-code-raw");
    expect(serialized).not.toContain("encrypted-vault-payload");
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
  });
});

function createHostedAccountDataExportPrisma() {
  const count = async () => 1;
  const memberId = "member_123";
  const linqMailboxPayload = encryptHostedMailboxNullableString({
    field: "hosted-mailbox-inline-payload",
    userId: memberId,
    value: JSON.stringify({
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
    }),
  });
  const emailMailboxPayload = encryptHostedMailboxNullableString({
    field: "hosted-mailbox-inline-payload",
    userId: memberId,
    value: JSON.stringify({
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
    }),
  });
  const systemMailboxPayload = encryptHostedMailboxNullableString({
    field: "hosted-mailbox-inline-payload",
    userId: memberId,
    value: JSON.stringify({
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
    }),
  });
  const billingPrivateColumns = buildHostedMemberBillingPrivateColumns({
    memberId,
    stripeCustomerId: "cus_export_123",
    stripeSubscriptionId: "sub_export_123",
  });
  const identityPrivateColumns = buildHostedMemberIdentityPrivateColumns({
    memberId,
    phoneNumber: "+15550100123",
    privyUserId: "privy-user-123",
    signupPhoneCodeSendAttemptId: "hbpc_send_attempt_secret",
    signupPhoneCodeSendAttemptStartedAt: new Date("2026-04-27T00:01:30.000Z"),
    signupPhoneCodeSentAt: new Date("2026-04-27T00:01:45.000Z"),
    signupPhoneNumber: "+15550100123",
    walletAddress: "0xabc123",
  });
  const routingPrivateColumns = buildHostedMemberRoutingPrivateColumns({
    linqChatId: "linq-chat-123",
    linqRecipientPhone: "+15550100123",
    memberId,
    pendingLinqChatId: "pending-linq-chat-123",
    pendingLinqRecipientPhone: "+15550100124",
    telegramThreadId: "telegram-thread-123",
    telegramUserId: "telegram-user-123",
  });

  return {
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
      findMany: async () => [
        {
          apiKeyEnv: "SECRET_API_KEY_ENV",
          attemptCount: 1,
          baseUrl: "https://gateway.example",
          cacheWriteTokens: null,
          cachedInputTokens: null,
          createdAt: new Date("2026-04-27T00:24:00.000Z"),
          credentialSource: "member",
          featureKey: "assistant",
          gatewayTagsJson: { surface: "settings" },
          id: "usage-1",
          inputTokens: 10,
          memberId,
          occurredAt: new Date("2026-04-27T00:23:00.000Z"),
          outputTokens: 20,
          provider: "openai",
          providerName: "OpenAI",
          reasoningTokens: null,
          reportingUserId: memberId,
          requestedModel: "model-a",
          routeId: "route-a",
          servedModel: "model-b",
          sessionId: "session-1",
          stripeMeterAttemptCount: 0,
          stripeMeteredAt: null,
          stripeMeterError: null,
          stripeMeterIdentifier: null,
          stripeMeterLastAttemptedAt: null,
          stripeMeterNextAttemptAt: null,
          stripeMeterSource: "murph",
          stripeMeterStatus: "pending",
          surface: "assistant",
          totalTokens: 30,
          triggerKind: "manual",
          turnId: "turn-1",
          updatedAt: new Date("2026-04-27T00:24:00.000Z"),
        },
      ],
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
            surface: "settings",
          },
          scope: "launch.required",
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
          scope: "launch.required",
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
          outboxIntentRef: null,
          phase: "assistant",
          redactedJson: { message: "redacted" },
          userId: memberId,
          workspaceVersion: 9n,
        },
      ],
    },
    hostedVaultSyncPayload: { count },
    hostedVaultSyncSession: {
      count,
      findMany: async () => [
        {
          createdAt: new Date("2026-04-27T00:10:00.000Z"),
          direction: "import",
          expiresAt: new Date("2026-04-27T01:10:00.000Z"),
          id: "vault-sync-1",
          localManifestHash: "manifest-hash",
          memberId,
          payload: {
            createdAt: new Date("2026-04-27T00:10:30.000Z"),
            payloadEncrypted: "encrypted-vault-payload",
            payloadSchema: "murph.hosted-vault-sync-payload.v1",
            sessionId: "payload-secret",
            updatedAt: new Date("2026-04-27T00:10:45.000Z"),
          },
          queuedAt: new Date("2026-04-27T00:10:45.000Z"),
          revokedAt: null,
          sourceSchemaVersion: "3",
          sourceVaultId: "vault-secret",
          sourceVaultTitle: "Source Vault",
          status: "ready",
          updatedAt: new Date("2026-04-27T00:11:00.000Z"),
          uploadedAt: new Date("2026-04-27T00:10:40.000Z"),
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

function createHostedAccountDataExportPrismaForTest(): HostedAccountDataPrismaForTest {
  // This fake implements the Prisma delegates exercised by this focused unit test.
  const fakePrisma: unknown = createHostedAccountDataExportPrisma();
  return fakePrisma as HostedAccountDataPrismaForTest;
}
