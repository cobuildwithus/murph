import { describe, expect, it } from "vitest";

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
} from "@/src/lib/hosted-privacy/account-data-shared";
import {
  buildHostedAccountDataExport,
  HOSTED_ACCOUNT_DATA_STORE_COVERAGE,
  parseHostedAccountDeletionRequest,
} from "@/src/lib/hosted-privacy/account-data-service";

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

    expect(bySlug.get("prisma.hosted_mailbox_payload")?.export).toBe("not-exported-secret");
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
      prisma: createHostedAccountDataExportPrisma() as never,
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

function createHostedAccountDataExportPrisma() {
  const count = async () => 1;

  return {
    $transaction: async () => {
      throw new Error("Unexpected transaction during export proof.");
    },
    deviceAgentSession: { count },
    deviceBrowserAssertionNonce: { count },
    deviceConnection: {
      count,
      findMany: async () => [
        {
          connectedAt: new Date("2026-04-27T00:07:00.000Z"),
          createdAt: new Date("2026-04-27T00:07:00.000Z"),
          displayName: "WHOOP",
          id: "device-1",
          lastSyncCompletedAt: new Date("2026-04-27T00:08:00.000Z"),
          provider: "whoop",
          providerAccountBlindIndex: "secret-provider-account-blind-index",
          status: "active",
          updatedAt: new Date("2026-04-27T00:09:00.000Z"),
        },
      ],
    },
    deviceOauthSession: { count },
    deviceSyncSignal: { count },
    deviceTokenAudit: { count },
    deviceWebhookTrace: { count },
    hostedAiUsage: { count },
    hostedInvite: { count },
    hostedLinqDailyState: { count },
    hostedMailboxItem: { count },
    hostedMailboxLaneCounter: { count },
    hostedMailboxPayload: { count },
    hostedMember: {
      count,
      findUnique: async () => ({
        billingStatus: "active",
        createdAt: new Date("2026-04-27T00:00:00.000Z"),
        emailAuthorization: {
          directPublicSenderAuthorizedAt: null,
          directPublicSenderLookupKey: "secret-direct-public-sender",
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
          maskedPhoneNumberHint: "+1 **** 1234",
          phoneNumberVerifiedAt: new Date("2026-04-27T00:02:00.000Z"),
          privyUserLookupKey: "secret-privy",
          walletAddressLookupKey: "secret-wallet",
          walletChainType: "ethereum",
          walletCreatedAt: new Date("2026-04-27T00:03:00.000Z"),
          walletProvider: "privy",
        },
        pendingActivationTimeZone: null,
        routing: {
          linqChatLookupKey: "secret-linq-home",
          linqRecipientPhoneLookupKey: "secret-linq-recipient",
          pendingLinqChatLookupKey: "secret-pending-linq",
          replyAliasLookupKey: "secret-reply-alias",
          telegramUserLookupKey: "secret-telegram",
        },
        suspendedAt: null,
        updatedAt: new Date("2026-04-27T00:12:00.000Z"),
      }),
    },
    hostedMemberBillingRef: { count },
    hostedMemberEmailAuthorization: { count },
    hostedMemberIdentity: { count },
    hostedMemberRouting: { count },
    hostedRuntimeLog: { count },
    hostedVaultSyncPayload: { count },
    hostedVaultSyncSession: {
      count,
      findMany: async () => [
        {
          createdAt: new Date("2026-04-27T00:10:00.000Z"),
          direction: "import",
          expiresAt: new Date("2026-04-27T01:10:00.000Z"),
          id: "vault-sync-1",
          payload: { sessionId: "payload-secret" },
          sourceSchemaVersion: "3",
          sourceVaultId: "vault-secret",
          sourceVaultTitle: "Source Vault",
          status: "ready",
          updatedAt: new Date("2026-04-27T00:11:00.000Z"),
        },
      ],
    },
    hostedWorkspace: { count },
    hostedWebInternalRequestNonce: { count },
  };
}
