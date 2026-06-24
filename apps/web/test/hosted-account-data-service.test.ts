import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  connectedAppsClient: {
    deleteAccount: vi.fn(),
    disconnectAccount: vi.fn(),
    listAccounts: vi.fn(),
  },
  createComposioConnectedAppsClient: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  deleteHostedPrivyUser: vi.fn(),
  deleteHostedRunnerUserDataBestEffort: vi.fn(),
  getHostedOnboardingStripe: vi.fn(),
  readHostedConnectedAppsConfig: vi.fn(),
  terminateHostedUserRuntimeWorkflowBestEffort: vi.fn(),
}));

vi.mock("@/src/lib/connected-apps/composio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/connected-apps/composio")>()),
  createComposioConnectedAppsClient: serviceMocks.createComposioConnectedAppsClient,
}));

vi.mock("@/src/lib/connected-apps/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/connected-apps/config")>()),
  readHostedConnectedAppsConfig: serviceMocks.readHostedConnectedAppsConfig,
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: serviceMocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/privy")>()),
  deleteHostedPrivyUser: serviceMocks.deleteHostedPrivyUser,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/runtime")>()),
  getHostedOnboardingStripe: serviceMocks.getHostedOnboardingStripe,
}));

vi.mock("@/src/lib/hosted-execution/user-data-delete", () => ({
  deleteHostedRunnerUserDataBestEffort: serviceMocks.deleteHostedRunnerUserDataBestEffort,
}));

vi.mock("@/src/lib/hosted-orchestration/workflow-termination", () => ({
  terminateHostedUserRuntimeWorkflowBestEffort:
    serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort,
}));

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { ComposioConnectedAppsRequestError } from "@/src/lib/connected-apps/composio";
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
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
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
  "prisma.hosted_web_session",
  "prisma.hosted_member_identity",
  "prisma.hosted_member_routing",
  "prisma.hosted_member_email_authorization",
  "prisma.hosted_member_billing_ref",
  "prisma.hosted_connected_app_connect_intent",
  "prisma.hosted_connected_apps_session",
  "prisma.hosted_mailbox_item",
  "prisma.hosted_mailbox_payload",
  "prisma.hosted_mailbox_lane_counter",
  "prisma.hosted_workspace",
  "prisma.hosted_computer_run",
  "prisma.hosted_computer_handoff",
  "prisma.hosted_runtime_log",
  "prisma.hosted_user_crypto_envelope",
  "prisma.hosted_user_crypto_audit",
  "prisma.hosted_ai_usage",
  "prisma.hosted_ai_usage_period",
  "prisma.hosted_product_feedback",
  "prisma.hosted_linq_daily_state",
  "prisma.hosted_invite",
  "prisma.hosted_consent_event",
  "prisma.hosted_consent_grant",
  "prisma.hosted_vault_share",
  "prisma.device_connection",
  "prisma.device_sync_dirty_connection",
  "prisma.device_sync_dirty_payload",
  "prisma.device_token_audit",
  "prisma.device_sync_signal",
  "prisma.device_oauth_session",
  "prisma.device_connect_intent",
  "prisma.device_agent_session",
  "prisma.device_browser_assertion_nonce",
  "prisma.hosted_web_internal_request_nonce",
  "prisma.device_webhook_trace",
  "cloudflare.runner_durable_object",
  "cloudflare.r2_user_artifacts",
  "temporal.per_user_runtime_workflow",
  "providers.oura_whoop_strava",
  "providers.composio_connected_apps",
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
  vi.stubEnv("KERNEL_API_KEY", "");
  serviceMocks.connectedAppsClient.deleteAccount.mockReset();
  serviceMocks.connectedAppsClient.deleteAccount.mockResolvedValue(undefined);
  serviceMocks.connectedAppsClient.disconnectAccount.mockReset();
  serviceMocks.connectedAppsClient.listAccounts.mockReset();
  serviceMocks.connectedAppsClient.listAccounts.mockResolvedValue([]);
  serviceMocks.createComposioConnectedAppsClient.mockReset();
  serviceMocks.createComposioConnectedAppsClient.mockReturnValue(serviceMocks.connectedAppsClient);
  serviceMocks.createHostedDeviceSyncControlPlane.mockReset();
  serviceMocks.deleteHostedPrivyUser.mockReset();
  serviceMocks.deleteHostedPrivyUser.mockResolvedValue(true);
  serviceMocks.deleteHostedRunnerUserDataBestEffort.mockReset();
  serviceMocks.deleteHostedRunnerUserDataBestEffort.mockResolvedValue(makeCloudflareDeletionResult());
  serviceMocks.getHostedOnboardingStripe.mockReset();
  serviceMocks.getHostedOnboardingStripe.mockReturnValue(null);
  serviceMocks.readHostedConnectedAppsConfig.mockReset();
  serviceMocks.readHostedConnectedAppsConfig.mockReturnValue({
    apiKey: "secret-test-key",
    baseUrl: "https://backend.composio.test",
    maxAccountsPerToolkit: 5,
    toolkits: ["gmail", "googlecalendar"],
  });
  serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort.mockReset();
  serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort.mockResolvedValue({
    configured: true,
    errorCode: null,
    notFound: false,
    terminated: true,
  });
});

describe("parseHostedAccountDeletionRequest", () => {
  it("requires the exact destructive action phrase", () => {
    expect(parseHostedAccountDeletionRequest({
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
    })).toEqual({
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
    });
  });

  it.each([
    ["lowercase phrase", {
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE.toLowerCase(),
    }, "ACCOUNT_DELETION_CONFIRMATION_PHRASE_REQUIRED"],
    ["extra whitespace", {
      confirmationPhrase: `${HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE} `,
    }, "ACCOUNT_DELETION_CONFIRMATION_PHRASE_REQUIRED"],
    ["missing phrase", {}, "ACCOUNT_DELETION_CONFIRMATION_PHRASE_REQUIRED"],
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
    expect(bySlug.get("prisma.hosted_runtime_log")?.export).toBe("documented-only");
    expect(bySlug.get("prisma.hosted_runtime_log")?.note).toContain("Export omits");
    expect(bySlug.get("cloudflare.runner_durable_object")?.deletion).toBe("best-effort-delete");
    expect(bySlug.get("cloudflare.r2_user_artifacts")?.deletion).toBe("best-effort-delete");
    expect(bySlug.get("providers.stripe_privy")?.deletion).toBe("best-effort-delete");
    expect(bySlug.get("backups")?.deletion).toBe("documented-retention");
  });

  it("documents that deletion-time provider revocation does not enqueue new device sync work", () => {
    const deviceSyncSignal = HOSTED_ACCOUNT_DATA_STORE_COVERAGE.find((entry) =>
      entry.slug === "prisma.device_sync_signal");

    expect(deviceSyncSignal?.note).toContain("pre-existing");
    expect(deviceSyncSignal?.note).toContain("does not enqueue new disconnect or wake work");
  });

  it("documents explicit dirty-state deletion before connection row cascades", () => {
    const dirtyState = HOSTED_ACCOUNT_DATA_STORE_COVERAGE.find((entry) =>
      entry.slug === "prisma.device_sync_dirty_connection");
    const dirtyPayload = HOSTED_ACCOUNT_DATA_STORE_COVERAGE.find((entry) =>
      entry.slug === "prisma.device_sync_dirty_payload");

    expect(dirtyState?.note).toContain("before device connection rows");
    expect(dirtyState?.note).toContain("does not rely on cascades");
    expect(dirtyPayload?.note).toContain("before dirty-state and connection rows");
    expect(dirtyPayload?.note).toContain("raw provider payload retention is bounded");
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
        "prisma.hosted_connected_app_connect_intent": 1,
        "prisma.hosted_connected_apps_session": 1,
        "prisma.hosted_computer_handoff": 1,
        "prisma.hosted_computer_run": 1,
        "prisma.hosted_mailbox_payload": 1,
        "prisma.hosted_product_feedback": 1,
        "prisma.hosted_vault_share": 1,
        "prisma.hosted_web_session": 1,
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
          aiUsagePeriods: {
            exportedRows: 1,
            maxRows: 250,
            truncated: false,
          },
          productFeedback: {
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
        aiUsagePeriods: [
          {
            billingPlanCode: "launch_monthly",
            limitUsdMicros: "10000000",
            spentUsdMicros: "2500000",
          },
        ],
        aiUsage: [
          {
            allowanceCostUsdMicros: "2500000",
            allowanceCounted: true,
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
      connectedApps: {
        connectIntents: [
          {
            alias: "work",
            claimHashOmitted: true,
            connectedAccountIdPresent: true,
            toolkit: "gmail",
          },
        ],
        providerAccounts: {
          exportMode: "documented-only",
        },
        sessions: [
          {
            policyRevision: 12345,
            remoteSessionIdOmitted: true,
          },
        ],
      },
      vault: {
        shares: [
          {
            destinationMemberId: "member_destination_123",
            grantorMemberId: "member_123",
            idPresent: true,
            projectionKind: "sleep-times.v0",
            status: "granted",
          },
        ],
        workspace: {
          browserVaultReplicaRefPresent: true,
          inboxMediaRetentionWakeAt: "2026-04-27T00:07:00.000Z",
          snapshotRefPresent: true,
        },
      },
      productFeedback: {
        entries: [
          {
            idPresent: true,
            kind: "feature_interest",
            relatedChangelogItemIds: ["native-message-formatting"],
            summary: "Interested in native message formatting.",
          },
        ],
      },
      wearables: {
        deviceConnections: [
          {
            idPresent: true,
            keyVersionPresent: true,
            lastErrorMessagePresent: false,
            metadataPresent: true,
            providerAccountLinked: true,
            providerLabel: "WHOOP",
            scopesPresent: true,
            tokenVersionPresent: true,
          },
        ],
        deviceSyncSignals: [
          {
            connectionIdPresent: true,
            idPresent: true,
            providerLabel: "WHOOP",
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
            providerLabel: "WHOOP",
            sessionIdPresent: true,
            tokenVersionPresent: true,
          },
        ],
      },
    });
    expect(exported.counts).not.toHaveProperty("prisma.hosted_runtime_log");
    expect(exported.computerUse).toMatchObject({
      handoffs: [
        {
          purpose: "login",
          runIdPresent: true,
          status: "open",
          tokenHashOmitted: true,
        },
      ],
      runs: [
        {
          awaitingMessage: "Can you log in here?\n\n[computer handoff link omitted]",
          awaitingReason: "login_needed",
          kernelLiveViewUrlPresent: true,
          kernelProfileNameOmitted: true,
          kernelSessionIdPresent: true,
          lastTitle: "Scheduler",
          lastUrlOrigin: "https://dentist.example.test",
          pendingHandoffPresent: true,
          status: "awaiting_user",
        },
      ],
    });
    expect(requireRecord(requireRecord(exported.limits).stores)).not.toHaveProperty("runtimeLogs");
    expect(exported).not.toHaveProperty("diagnostics");
    const wearables = requireRecord(exported.wearables);
    expect(requireRecord(requireArray(wearables.deviceConnections)[0])).not.toHaveProperty("provider");
    expect(requireRecord(requireArray(wearables.deviceSyncSignals)[0])).not.toHaveProperty("provider");
    expect(requireRecord(requireArray(wearables.deviceTokenAudits)[0])).not.toHaveProperty("provider");
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
    expect(serialized).not.toContain("feedback-secret-id");
    expect(serialized).not.toContain("route-a");
    expect(serialized).not.toContain("runtime-log-1");
    expect(serialized).not.toContain("attempt-1");
    expect(serialized).not.toContain("mailbox-1");
    expect(serialized).not.toContain("invite-1");
    expect(serialized).not.toContain("consent-event-1");
    expect(serialized).not.toContain("trace-1");
    expect(serialized).not.toContain("secret-consent-metadata");
    expect(serialized).not.toContain("secret-kernel-profile-name");
    expect(serialized).not.toContain("secret-kernel-session");
    expect(serialized).not.toContain("secret-live-view-url");
    expect(serialized).not.toContain("secret-handoff-token-hash");
    expect(serialized).not.toContain("secret-handoff-token");
    expect(serialized).not.toContain("/computer/handoff/secret-handoff-token");
    expect(serialized).not.toContain("secret-connected-app-claim-hash");
    expect(serialized).not.toContain("ca_secret_account_id");
    expect(serialized).not.toContain("secret-tool-router-session");
  });

  it("uses wearable source labels instead of intermediary provider ids in export data", async () => {
    const exported = await buildHostedDataExport({
      memberId: "member_123",
      prisma: await createHostedAccountDataExportPrismaForTest({
        deviceConnectionRows: [
          makeDeviceConnectionExportRowForTest({
            displayName: "Junction",
            provider: "junction",
            sources: [{ sourceProviderSlug: "garmin", status: "connected" }],
          }),
        ],
        deviceSyncSignalRows: [
          makeDeviceSyncSignalRowForTest({ provider: "junction" }),
        ],
        deviceTokenAuditRows: [
          makeDeviceTokenAuditRowForTest({ provider: "junction" }),
        ],
      }),
    });
    const wearables = requireRecord(exported.wearables);
    const deviceConnection = requireRecord(requireArray(wearables.deviceConnections)[0]);
    const deviceSyncSignal = requireRecord(requireArray(wearables.deviceSyncSignals)[0]);
    const deviceTokenAudit = requireRecord(requireArray(wearables.deviceTokenAudits)[0]);
    const serializedWearables = JSON.stringify(wearables);

    expect(deviceConnection.providerLabel).toBe("Garmin");
    expect(deviceConnection.displayName).toBeNull();
    expect(deviceSyncSignal.providerLabel).toBe("Garmin");
    expect(deviceTokenAudit.providerLabel).toBe("Garmin");
    expect(serializedWearables).not.toContain("junction");
    expect(serializedWearables).not.toContain("Junction");
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
  it("suspends before Temporal cleanup and terminates again after Cloudflare cleanup", async () => {
    const order: string[] = [];
    serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort.mockImplementation(async () => {
      order.push("temporal");
      return {
        configured: true,
        errorCode: null,
        notFound: false,
        terminated: true,
      };
    });
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

    expect(order).toEqual(["prisma", "temporal", "prisma", "cloudflare", "temporal"]);
    expect(result.cloudflare.deleted).toBe(true);
    expect(serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort).toHaveBeenNthCalledWith(
      1,
      {
        reason: "account-deleted",
        userId: "member_123",
      },
    );
    expect(serviceMocks.deleteHostedRunnerUserDataBestEffort).toHaveBeenCalledWith({
      context: "settings.account-data.delete",
      userId: "member_123",
    });
    expect(serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort).toHaveBeenNthCalledWith(
      2,
      {
        reason: "account-deleted",
        userId: "member_123",
      },
    );
  });

  it("cancels the Stripe subscription before local deletion and deletes vendor accounts after it", async () => {
    const order: string[] = [];
    const stripe = {
      customers: {
        del: vi.fn(async () => {
          order.push("stripe:customer-delete");
          return { deleted: true, id: "cus_delete_123" };
        }),
      },
      subscriptions: {
        cancel: vi.fn(async () => {
          order.push("stripe:subscription-cancel");
          return { id: "sub_delete_123", status: "canceled" };
        }),
        retrieve: vi.fn(async () => ({ id: "sub_delete_123", status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    serviceMocks.deleteHostedPrivyUser.mockImplementation(async () => {
      order.push("privy:user-delete");
      return true;
    });
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => order.push("prisma"),
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(order).toEqual([
      "prisma",
      "stripe:subscription-cancel",
      "prisma",
      "stripe:customer-delete",
      "privy:user-delete",
    ]);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_delete_123");
    expect(stripe.customers.del).toHaveBeenCalledWith("cus_delete_123");
    expect(serviceMocks.deleteHostedPrivyUser).toHaveBeenCalledWith("privy-user-delete-123");
    expect(result.vendorAccounts).toEqual({
      privyUser: { errorCode: null, status: "completed" },
      stripeCustomer: { errorCode: null, status: "completed" },
      stripeSubscription: { errorCode: null, status: "completed" },
    });
  });

  it("aborts before local deletion when the Stripe subscription cancel fails", async () => {
    const stripe = {
      customers: { del: vi.fn() },
      subscriptions: {
        cancel: vi.fn(async () => {
          throw new Error("stripe unavailable");
        }),
        retrieve: vi.fn(async () => ({ id: "sub_delete_123", status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const onTransaction = vi.fn();
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction,
    });

    let error: unknown;
    try {
      await deleteHostedAccountData({
        memberId: "member_123",
        prisma,
        request: new Request("https://join.example.test/settings"),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HostedOnboardingError);
    expect((error as HostedOnboardingError).code).toBe("ACCOUNT_DELETION_STRIPE_SUBSCRIPTION_CANCEL_FAILED");
    expect(onTransaction).toHaveBeenCalledTimes(1);
    expect(stripe.customers.del).not.toHaveBeenCalled();
    expect(serviceMocks.deleteHostedPrivyUser).not.toHaveBeenCalled();
  });

  it("skips the cancel call when the Stripe subscription is already canceled", async () => {
    const stripe = {
      customers: {
        del: vi.fn(async () => ({ deleted: true, id: "cus_delete_123" })),
      },
      subscriptions: {
        cancel: vi.fn(),
        retrieve: vi.fn(async () => ({ id: "sub_delete_123", status: "canceled" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(result.vendorAccounts.stripeSubscription).toEqual({ errorCode: null, status: "completed" });
  });

  it("reports skipped vendor deletions when no vendor records exist", async () => {
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(result.vendorAccounts).toEqual({
      privyUser: { errorCode: null, status: "skipped_no_record" },
      stripeCustomer: { errorCode: null, status: "skipped_no_record" },
      stripeSubscription: { errorCode: null, status: "skipped_no_record" },
    });
    expect(serviceMocks.deleteHostedPrivyUser).not.toHaveBeenCalled();
  });

  it("reports failed best-effort vendor deletions without failing the request", async () => {
    const stripe = {
      customers: {
        del: vi.fn(async () => {
          throw new Error("stripe customer delete unavailable");
        }),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ id: "sub_delete_123", status: "canceled" })),
        retrieve: vi.fn(async () => ({ id: "sub_delete_123", status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    serviceMocks.deleteHostedPrivyUser.mockRejectedValue(new Error("privy unavailable"));
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(result.vendorAccounts.stripeSubscription).toEqual({ errorCode: null, status: "completed" });
    expect(result.vendorAccounts.stripeCustomer.status).toBe("failed");
    expect(result.vendorAccounts.privyUser.status).toBe("failed");
  });

  it("reports vendor deletions as not configured when the vendor clients are absent", async () => {
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(null);
    serviceMocks.deleteHostedPrivyUser.mockResolvedValue(false);
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(result.vendorAccounts).toEqual({
      privyUser: { errorCode: null, status: "skipped_not_configured" },
      stripeCustomer: { errorCode: null, status: "skipped_not_configured" },
      stripeSubscription: { errorCode: null, status: "skipped_no_record" },
    });
  });

  it("fails closed when a subscription reference exists but Stripe is not configured", async () => {
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(null);
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const onTransaction = vi.fn();
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction,
    });

    let error: unknown;
    try {
      await deleteHostedAccountData({
        memberId: "member_123",
        prisma,
        request: new Request("https://join.example.test/settings"),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HostedOnboardingError);
    expect((error as HostedOnboardingError).code).toBe("ACCOUNT_DELETION_STRIPE_NOT_CONFIGURED");
    expect(onTransaction).toHaveBeenCalledTimes(1);
    expect(serviceMocks.deleteHostedPrivyUser).not.toHaveBeenCalled();
  });

  it("deletes short-lived hosted device connect intents with account data", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(result.deletedCounts["prisma.device_connect_intent"]).toBe(1);
    expect(deleteCalls).toContainEqual({
      model: "deviceConnectIntent",
      where: { memberId: "member_123" },
    });
  });

  it("deletes hosted computer-use rows explicitly with account data", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(result.deletedCounts["prisma.hosted_computer_handoff"]).toBe(1);
    expect(result.deletedCounts["prisma.hosted_computer_run"]).toBe(1);
    expect(deleteCalls).toContainEqual({
      model: "hostedComputerHandoff",
      where: { memberId: "member_123" },
    });
    expect(deleteCalls).toContainEqual({
      model: "hostedComputerRun",
      where: { memberId: "member_123" },
    });
  });

  it("deletes computer-use handoffs before runs", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    const deletedModels = deleteCalls.map((call) => call.model);
    expect(deletedModels.indexOf("hostedComputerHandoff")).toBeLessThan(
      deletedModels.indexOf("hostedComputerRun"),
    );
  });

  it("fences computer-use creation before external cleanup and deletes rows in a short transaction", async () => {
    const operationOrder: string[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => operationOrder.push("transaction"),
      operationOrder,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    const firstLockIndex = operationOrder.indexOf("queryRaw");
    const suspensionIndex = operationOrder.indexOf("update:hostedMember");
    const runCleanupIndex = operationOrder.indexOf("find:hostedComputerRun");
    const finalLockIndex = operationOrder.lastIndexOf("queryRaw");
    const runDeleteIndex = operationOrder.indexOf("delete:hostedComputerRun");
    expect(firstLockIndex).toBeGreaterThanOrEqual(0);
    expect(suspensionIndex).toBeGreaterThan(firstLockIndex);
    expect(runCleanupIndex).toBeGreaterThan(suspensionIndex);
    expect(runCleanupIndex).toBeLessThan(finalLockIndex);
    expect(runDeleteIndex).toBeGreaterThan(finalLockIndex);
  });

  it("aborts before local deletion while computer-use browser provisioning is in flight", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const onTransaction = vi.fn();
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      hostedComputerRunRows: [
        makeHostedComputerRunRowForDeletionTest({
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          kernelLiveViewUrlEncrypted: null,
          kernelSessionId: null,
          status: "running",
          updatedAt: new Date(),
        }),
      ],
      onTransaction,
    });

    let error: unknown;
    try {
      await deleteHostedAccountData({
        memberId: "member_123",
        prisma,
        request: new Request("https://join.example.test/settings"),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HostedOnboardingError);
    expect((error as HostedOnboardingError).code).toBe(
      "ACCOUNT_DELETION_COMPUTER_USE_CLEANUP_FAILED",
    );
    expect(onTransaction).toHaveBeenCalledTimes(1);
    expect(deleteCalls).toEqual([]);
  });

  it("deletes device dirty state before signals and connection rows to avoid cascade lock inversion", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    const deletedModels = deleteCalls.map((call) => call.model);
    const dirtyPayloadIndex = deletedModels.indexOf("deviceSyncDirtyPayload");
    const dirtyStateIndex = deletedModels.indexOf("deviceSyncDirtyConnection");
    const signalIndex = deletedModels.indexOf("deviceSyncSignal");
    const connectionIndex = deletedModels.indexOf("deviceConnection");

    expect(result.deletedCounts["prisma.device_sync_dirty_payload"]).toBe(1);
    expect(result.deletedCounts["prisma.device_sync_dirty_connection"]).toBe(1);
    expect(dirtyPayloadIndex).toBeGreaterThanOrEqual(0);
    expect(dirtyStateIndex).toBeGreaterThanOrEqual(0);
    expect(dirtyStateIndex).toBeGreaterThan(dirtyPayloadIndex);
    expect(signalIndex).toBeGreaterThan(dirtyStateIndex);
    expect(connectionIndex).toBeGreaterThan(signalIndex);
  });

  it("deletes webhook traces for device connections visible inside the deletion transaction", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const operationOrder: string[] = [];
    serviceMocks.createHostedDeviceSyncControlPlane.mockReturnValueOnce({
      registry: {
        get: vi.fn(() => null),
      },
      store: {
        getStoredConnectionAccountForUser: vi.fn(async () => null),
      },
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      deviceConnections: [
        {
          id: "dsc_before",
          provider: "oura",
          providerAccountBlindIndex: "hbdi_before",
        },
      ],
      onTransaction: () => undefined,
      operationOrder,
      transactionDeviceConnections: [
        {
          id: "dsc_current",
          provider: "oura",
          providerAccountBlindIndex: "hbdi_current",
        },
      ],
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(result.deletedCounts["prisma.device_webhook_trace"]).toBe(1);
    expect(deleteCalls).toContainEqual({
      model: "deviceWebhookTrace",
      where: {
        OR: [
          {
            provider: "oura",
            providerAccountBlindIndex: "hbdi_current",
          },
        ],
      },
    });
    expect(operationOrder.indexOf("executeRaw")).toBeGreaterThanOrEqual(0);
    expect(operationOrder.indexOf("executeRaw")).toBeLessThan(
      operationOrder.indexOf("delete:deviceWebhookTrace"),
    );
  });

  it("locks webhook trace owners in deterministic unique order before account deletion", async () => {
    const operationOrder: string[] = [];
    serviceMocks.createHostedDeviceSyncControlPlane.mockReturnValueOnce({
      registry: {
        get: vi.fn(() => null),
      },
      store: {
        getStoredConnectionAccountForUser: vi.fn(async () => null),
      },
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => undefined,
      operationOrder,
      transactionDeviceConnections: [
        {
          id: "dsc_whoop",
          provider: "whoop",
          providerAccountBlindIndex: "hbdi_c",
        },
        {
          id: "dsc_oura_b",
          provider: "oura",
          providerAccountBlindIndex: "hbdi_b",
        },
        {
          id: "dsc_oura_a",
          provider: "oura",
          providerAccountBlindIndex: "hbdi_a",
        },
        {
          id: "dsc_oura_a_duplicate",
          provider: "oura",
          providerAccountBlindIndex: "hbdi_a",
        },
      ],
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(operationOrder.filter((entry) => entry.startsWith("executeRaw:"))).toEqual([
      "executeRaw:oura:hbdi_a",
      "executeRaw:oura:hbdi_b",
      "executeRaw:whoop:hbdi_c",
    ]);
  });

  it("reports incomplete configured Cloudflare cleanup after Prisma deletion commits", async () => {
    const order: string[] = [];
    serviceMocks.deleteHostedRunnerUserDataBestEffort.mockResolvedValue({
      ...makeCloudflareDeletionResult(),
      deleted: false,
      r2SkippedUserScopedPrefixes: true,
      r2UserScopedSkipReason: "HostedUserCryptoRepairNeededError",
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => order.push("prisma"),
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(order).toEqual(["prisma", "prisma"]);
    expect(result.cloudflare.deleted).toBe(false);
    expect(result.cloudflare.r2SkippedUserScopedPrefixes).toBe(true);
  });

  it("reports unconfigured Cloudflare cleanup after Prisma deletion commits", async () => {
    const order: string[] = [];
    serviceMocks.deleteHostedRunnerUserDataBestEffort.mockResolvedValue({
      ...makeCloudflareDeletionResult(),
      alarmCleared: null,
      configured: false,
      deleted: false,
      r2DeletedObjectCount: null,
      r2SkippedUserScopedPrefixes: null,
      r2Supported: null,
      runnerStateDeleted: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => order.push("prisma"),
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(order).toEqual(["prisma", "prisma"]);
    expect(result.cloudflare.configured).toBe(false);
    expect(result.cloudflare.deleted).toBe(false);
  });

  it("skips external cleanup when the suspension transaction fails", async () => {
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

    expect(serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort).not.toHaveBeenCalled();
    expect(serviceMocks.deleteHostedRunnerUserDataBestEffort).not.toHaveBeenCalled();
  });

  it("revokes provider-config device connections during hosted account deletion", async () => {
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
          sources: [{ sourceProviderSlug: "garmin", status: "connected" }],
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
    expect(revokeAccess).toHaveBeenCalledTimes(1);
    expect(revokeAccess).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({
        kind: "provider_config",
        providerConfigKey: "junction",
      }),
      externalAccountId: "junction-user-123",
      provider: "junction",
    }));
    expect(order).toEqual(["prisma", "prisma"]);
    expect(result.providerRevocations).toEqual([
      {
        connectionId: "dsc_junction",
        errorCode: null,
        providerLabel: "Garmin",
        status: "revoked",
        warningCode: null,
      },
    ]);
  });

  it("revokes connected apps before local account deletion removes ownership rows", async () => {
    const order: string[] = [];
    serviceMocks.connectedAppsClient.listAccounts.mockResolvedValue([
      {
        alias: "work",
        id: "ca_gmail",
        isDisabled: false,
        status: "ACTIVE",
        toolkit: { name: "Gmail", slug: "gmail" },
        wordId: "bright-river",
      },
    ]);
    serviceMocks.connectedAppsClient.disconnectAccount.mockImplementation(async (accountId: string) => {
      order.push(`revoke:${accountId}`);
    });
    serviceMocks.connectedAppsClient.deleteAccount.mockImplementation(async (accountId: string) => {
      order.push(`composio-delete:${accountId}`);
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      connectedAppsSession: true,
      onTransaction: () => order.push("transaction"),
      operationOrder: order,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(serviceMocks.connectedAppsClient.listAccounts).toHaveBeenCalledWith({
      statuses: null,
      toolkits: null,
      userId: "member_123",
    });
    expect(serviceMocks.connectedAppsClient.disconnectAccount).toHaveBeenCalledWith("ca_gmail");
    expect(serviceMocks.connectedAppsClient.deleteAccount).toHaveBeenCalledWith("ca_gmail");
    const suspensionIndex = order.indexOf("update:hostedMember");
    const revokeIndex = order.indexOf("revoke:ca_gmail");
    const providerDeleteIndex = order.indexOf("composio-delete:ca_gmail");
    const localDeleteTransactionIndex = order.lastIndexOf("transaction");
    expect(suspensionIndex).toBeGreaterThanOrEqual(0);
    expect(suspensionIndex).toBeLessThan(revokeIndex);
    expect(revokeIndex).toBeLessThan(providerDeleteIndex);
    expect(providerDeleteIndex).toBeLessThan(localDeleteTransactionIndex);
    expect(result.providerRevocations).toEqual([
      {
        connectionId: "ca_gmail",
        errorCode: null,
        providerLabel: "Gmail (work)",
        status: "revoked",
        warningCode: null,
      },
    ]);
    expect(result.deletedCounts["prisma.hosted_connected_app_connect_intent"]).toBe(1);
    expect(result.deletedCounts["prisma.hosted_connected_apps_session"]).toBe(1);
  });

  it("blocks hosted account deletion when connected-app revocation fails", async () => {
    const order: string[] = [];
    serviceMocks.connectedAppsClient.listAccounts.mockResolvedValue([
      {
        alias: "work",
        id: "ca_gmail",
        isDisabled: false,
        status: "ACTIVE",
        toolkit: { name: "Gmail", slug: "gmail" },
        wordId: "bright-river",
      },
    ]);
    serviceMocks.connectedAppsClient.disconnectAccount.mockRejectedValue(
      Object.assign(new Error("provider secret should not leak"), {
        name: "ComposioRevokeFailed",
      }),
    );
    const prisma = createHostedAccountDeletionPrismaForTest({
      connectedAppsSession: true,
      onTransaction: () => order.push("transaction"),
      operationOrder: order,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PROVIDER_REVOKE_FAILED",
      httpStatus: 503,
      retryable: true,
    });

    expect(serviceMocks.connectedAppsClient.disconnectAccount).toHaveBeenCalledWith("ca_gmail");
    expect(serviceMocks.connectedAppsClient.deleteAccount).not.toHaveBeenCalled();
    expect(order).toContain("update:hostedMember");
    expect(order).not.toContain("delete:hostedMember");
  });

  it("deletes abandoned connected-app records without provider revoke before local account deletion", async () => {
    const order: string[] = [];
    serviceMocks.connectedAppsClient.listAccounts.mockResolvedValue([
      {
        alias: "work",
        id: "ca_pending",
        isDisabled: false,
        status: "INITIATED",
        toolkit: { name: "Gmail", slug: "gmail" },
        wordId: "bright-river",
      },
    ]);
    serviceMocks.connectedAppsClient.deleteAccount.mockImplementation(async (accountId: string) => {
      order.push(`composio-delete:${accountId}`);
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      connectedAppsSession: true,
      onTransaction: () => order.push("transaction"),
      operationOrder: order,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(serviceMocks.connectedAppsClient.disconnectAccount).not.toHaveBeenCalled();
    expect(serviceMocks.connectedAppsClient.deleteAccount).toHaveBeenCalledWith("ca_pending");
    expect(order.indexOf("update:hostedMember")).toBeLessThan(
      order.indexOf("composio-delete:ca_pending"),
    );
    expect(order.indexOf("composio-delete:ca_pending")).toBeLessThan(
      order.lastIndexOf("transaction"),
    );
    expect(result.providerRevocations).toEqual([
      {
        connectionId: "ca_pending",
        errorCode: null,
        providerLabel: "Gmail (work)",
        status: "not_needed",
        warningCode: null,
      },
    ]);
  });

  it("blocks local account deletion while a connected-app link is being created", async () => {
    const order: string[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      connectedAppConnectIntentRows: [
        {
          alias: "work",
          connectedAccountId: null,
          toolkit: "gmail",
        },
      ],
      connectedAppsSession: true,
      onTransaction: () => order.push("transaction"),
      operationOrder: order,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PROVIDER_REVOKE_FAILED",
      httpStatus: 503,
      retryable: true,
    });

    expect(serviceMocks.connectedAppsClient.listAccounts).not.toHaveBeenCalled();
    expect(serviceMocks.connectedAppsClient.deleteAccount).not.toHaveBeenCalled();
    expect(order).toContain("update:hostedMember");
    expect(order).not.toContain("delete:hostedMember");
  });

  it("deletes in-flight connected-app provider accounts not returned by the account list", async () => {
    const order: string[] = [];
    serviceMocks.connectedAppsClient.listAccounts.mockResolvedValue([]);
    serviceMocks.connectedAppsClient.deleteAccount.mockImplementation(async (accountId: string) => {
      order.push(`composio-delete:${accountId}`);
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      connectedAppConnectIntentRows: [
        {
          alias: "work",
          connectedAccountId: "ca_started",
          toolkit: "gmail",
        },
      ],
      connectedAppsSession: true,
      onTransaction: () => order.push("transaction"),
      operationOrder: order,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(serviceMocks.connectedAppsClient.listAccounts).toHaveBeenCalledWith({
      statuses: null,
      toolkits: null,
      userId: "member_123",
    });
    expect(serviceMocks.connectedAppsClient.deleteAccount).toHaveBeenCalledWith("ca_started");
    expect(order.indexOf("update:hostedMember")).toBeLessThan(
      order.indexOf("composio-delete:ca_started"),
    );
    expect(order.indexOf("composio-delete:ca_started")).toBeLessThan(
      order.lastIndexOf("transaction"),
    );
    expect(result.providerRevocations).toEqual([
      {
        connectionId: "ca_started",
        errorCode: null,
        providerLabel: "Gmail (work)",
        status: "not_needed",
        warningCode: null,
      },
    ]);
  });

  it("re-fences before local deletion and aborts if a connected-app write starts after provider cleanup", async () => {
    const order: string[] = [];
    serviceMocks.connectedAppsClient.listAccounts.mockResolvedValue([]);
    const prisma = createHostedAccountDeletionPrismaForTest({
      connectedAppsSession: true,
      onTransaction: () => order.push("transaction"),
      operationOrder: order,
      transactionConnectedAppConnectIntentRows: [
        {
          alias: "work",
          claimHash: "late_claim_hash",
          connectedAccountId: null,
          toolkit: "gmail",
        },
      ],
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_CONNECTED_APP_WRITE_IN_PROGRESS",
      httpStatus: 503,
      retryable: true,
    });

    expect(serviceMocks.connectedAppsClient.listAccounts).toHaveBeenCalledWith({
      statuses: null,
      toolkits: null,
      userId: "member_123",
    });
    expect(order.filter((entry) => entry === "update:hostedMember")).toHaveLength(2);
    expect(order).not.toContain("delete:hostedMember");
  });

  it("allows account deletion when Composio rejects revoke but provider record deletion succeeds", async () => {
    serviceMocks.connectedAppsClient.listAccounts.mockResolvedValue([
      {
        alias: "work",
        id: "ca_gmail",
        isDisabled: false,
        status: "ACTIVE",
        toolkit: { name: "Gmail", slug: "gmail" },
        wordId: "bright-river",
      },
    ]);
    serviceMocks.connectedAppsClient.disconnectAccount.mockRejectedValue(
      new ComposioConnectedAppsRequestError("Connection is not revokable.", 409),
    );
    const prisma = createHostedAccountDeletionPrismaForTest({
      connectedAppsSession: true,
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(serviceMocks.connectedAppsClient.disconnectAccount).toHaveBeenCalledWith("ca_gmail");
    expect(serviceMocks.connectedAppsClient.deleteAccount).toHaveBeenCalledWith("ca_gmail");
    expect(result.providerRevocations).toEqual([
      {
        connectionId: "ca_gmail",
        errorCode: null,
        providerLabel: "Gmail (work)",
        status: "warning",
        warningCode: expect.any(String),
      },
    ]);
  });

  it("blocks hosted account deletion when provider-config revocation fails", async () => {
    const order: string[] = [];
    const revokeAccess = vi.fn(async () => {
      throw Object.assign(new Error("provider secret should not leak"), {
        name: "ProviderRevokeFailed",
      });
    });
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
          sources: [{ sourceProviderSlug: "garmin", status: "connected" }],
        },
      ],
      onTransaction: () => order.push("prisma"),
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PROVIDER_REVOKE_FAILED",
      httpStatus: 503,
      retryable: true,
    });

    expect(getStoredConnectionAccountForUser).toHaveBeenCalledWith("member_123", "dsc_junction");
    expect(revokeAccess).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["prisma"]);
  });
});

function makeHostedAiUsageRowForTest(input: {
  allowanceAccountedAt?: Date | null;
  allowanceCostUsdMicros?: bigint;
  allowanceCounted?: boolean;
  id?: string;
  memberId: string;
  occurredAt?: Date;
}) {
  const occurredAt = input.occurredAt ?? new Date("2026-04-27T00:23:00.000Z");

  return {
    allowanceAccountedAt: input.allowanceAccountedAt === undefined
      ? new Date("2026-04-27T00:24:30.000Z")
      : input.allowanceAccountedAt,
    allowanceCostUsdMicros: input.allowanceCostUsdMicros ?? 2_500_000n,
    allowanceCounted: input.allowanceCounted ?? true,
    allowancePeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
    allowancePeriodStart: new Date("2026-04-01T00:00:00.000Z"),
    allowancePricingSnapshotJson: { model: "model-b" },
    allowancePricingVersion: "hosted-ai-token-pricing-test-v1",
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
    occurredAt,
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

function makeHostedAiUsagePeriodRowForTest(input: {
  memberId: string;
}) {
  return {
    billingPlanCode: "launch_monthly",
    blockedAt: null,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    lastUsageAt: new Date("2026-04-27T00:23:00.000Z"),
    limitUsdMicros: 10_000_000n,
    memberId: input.memberId,
    periodEnd: new Date("2026-05-01T00:00:00.000Z"),
    periodStart: new Date("2026-04-01T00:00:00.000Z"),
    spentUsdMicros: 0n,
    updatedAt: new Date("2026-04-27T00:24:00.000Z"),
  };
}

function makeHostedProductFeedbackRowForTest(input: {
  memberId: string;
}) {
  return {
    createdAt: new Date("2026-06-22T12:00:00.000Z"),
    id: "feedback-secret-id",
    kind: "feature_interest",
    memberId: input.memberId,
    relatedChangelogItemIdsJson: ["native-message-formatting"],
    summary: "Interested in native message formatting.",
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

function makeDeviceConnectionExportRowForTest(input: {
  displayName?: string | null;
  memberId?: string;
  metadataJson?: Record<string, unknown> | null;
  provider?: string;
  sources?: { sourceProviderSlug: string; status: string }[];
} = {}) {
  const memberId = input.memberId ?? "member_123";

  return {
    connectedAt: new Date("2026-04-27T00:07:00.000Z"),
    createdAt: new Date("2026-04-27T00:07:00.000Z"),
    displayName: input.displayName ?? "WHOOP",
    id: "device-1",
    accessTokenExpiresAt: new Date("2026-04-27T00:07:30.000Z"),
    keyVersion: "v1",
    lastSyncCompletedAt: new Date("2026-04-27T00:08:00.000Z"),
    lastSyncErrorAt: null,
    lastSyncStartedAt: new Date("2026-04-27T00:07:45.000Z"),
    lastWebhookAt: new Date("2026-04-27T00:07:40.000Z"),
    metadataJson: input.metadataJson ?? { shallow: "metadata" },
    nextReconcileAt: new Date("2026-04-27T00:12:00.000Z"),
    provider: input.provider ?? "whoop",
    providerAccountBlindIndex: "secret-provider-account-blind-index",
    scopesJson: ["read:profile"],
    sources: input.sources ?? [{ sourceProviderSlug: "whoop", status: "connected" }],
    status: "active",
    tokenVersion: 2,
    updatedAt: new Date("2026-04-27T00:09:00.000Z"),
    userId: memberId,
  };
}

function makeDeviceSyncSignalRowForTest(input: {
  connectionId?: string | null;
  memberId?: string;
  provider?: string;
} = {}) {
  const memberId = input.memberId ?? "member_123";

  return {
    connectionId: input.connectionId ?? "device-1",
    createdAt: new Date("2026-04-27T00:15:00.000Z"),
    eventType: "webhook",
    id: 1,
    kind: "provider-webhook",
    nextReconcileAt: null,
    occurredAt: new Date("2026-04-27T00:14:00.000Z"),
    provider: input.provider ?? "whoop",
    reason: "sync",
    resourceCategory: "sleep",
    revokeWarningCode: null,
    revokeWarningMessage: null,
    traceId: "trace-1",
    userId: memberId,
  };
}

function makeDeviceTokenAuditRowForTest(input: {
  connectionId?: string;
  memberId?: string;
  provider?: string;
} = {}) {
  const memberId = input.memberId ?? "member_123";

  return {
    action: "refresh",
    channel: "background",
    connectionId: input.connectionId ?? "device-1",
    createdAt: new Date("2026-04-27T00:16:00.000Z"),
    expectedTokenVersion: 1,
    forceRefresh: false,
    id: 1,
    keyVersion: "v1",
    provider: input.provider ?? "whoop",
    refreshOutcome: "success",
    sessionId: "session-1",
    tokenVersion: 2,
    tokenVersionChanged: true,
    userId: memberId,
  };
}

async function createHostedAccountDataExportPrisma(input: {
  aiUsageRows?: ReturnType<typeof makeHostedAiUsageRowForTest>[];
  aiUsagePeriodRows?: ReturnType<typeof makeHostedAiUsagePeriodRowForTest>[];
  productFeedbackRows?: ReturnType<typeof makeHostedProductFeedbackRowForTest>[];
  deviceConnectionRows?: ReturnType<typeof makeDeviceConnectionExportRowForTest>[];
  deviceSyncSignalRows?: ReturnType<typeof makeDeviceSyncSignalRowForTest>[];
  deviceTokenAuditRows?: ReturnType<typeof makeDeviceTokenAuditRowForTest>[];
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
      findMany: async () =>
        input.deviceConnectionRows ?? [makeDeviceConnectionExportRowForTest({ memberId })],
    },
    deviceSyncDirtyConnection: { count },
    deviceSyncDirtyPayload: { count },
    deviceOauthSession: {
      count,
      findMany: async () => [{ state: "oauth-state" }],
    },
    deviceConnectIntent: {
      count,
      findMany: async () => [{ claimHash: "connect-claim-hash" }],
    },
    deviceSyncSignal: {
      count,
      findMany: async () =>
        input.deviceSyncSignalRows ?? [makeDeviceSyncSignalRowForTest({ memberId })],
    },
    deviceTokenAudit: {
      count,
      findMany: async () =>
        input.deviceTokenAuditRows ?? [makeDeviceTokenAuditRowForTest({ memberId })],
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
      aggregate: async (args: {
        where?: {
          allowanceAccountedAt?: { not: null };
          allowanceCounted?: boolean;
          memberId?: string;
          occurredAt?: {
            gte?: Date;
            lt?: Date;
          };
        };
      }) => {
        const rows = input.aiUsageRows ?? [makeHostedAiUsageRowForTest({ memberId })];
        const matchedRows = rows.filter((row) => {
          const where = args.where;
          if (!where) {
            return true;
          }
          if (where.allowanceAccountedAt && row.allowanceAccountedAt === null) {
            return false;
          }
          if (
            typeof where.allowanceCounted === "boolean" &&
            row.allowanceCounted !== where.allowanceCounted
          ) {
            return false;
          }
          if (where.memberId && row.memberId !== where.memberId) {
            return false;
          }
          if (
            where.occurredAt?.gte &&
            row.occurredAt.getTime() < where.occurredAt.gte.getTime()
          ) {
            return false;
          }
          if (
            where.occurredAt?.lt &&
            row.occurredAt.getTime() >= where.occurredAt.lt.getTime()
          ) {
            return false;
          }

          return true;
        });
        const lastUsageAt = matchedRows
          .map((row) => row.occurredAt)
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
        const spentUsdMicros = matchedRows
          .reduce((total, row) => total + row.allowanceCostUsdMicros, 0n);

        return {
          _max: {
            occurredAt: lastUsageAt,
          },
          _sum: {
            allowanceCostUsdMicros: spentUsdMicros,
          },
        };
      },
      count,
      findMany: async () => input.aiUsageRows ?? [makeHostedAiUsageRowForTest({ memberId })],
    },
    hostedAiUsagePeriod: {
      count,
      findMany: async () =>
        input.aiUsagePeriodRows ?? [makeHostedAiUsagePeriodRowForTest({ memberId })],
    },
    hostedConnectedAppConnectIntent: {
      count,
      findMany: async () => [
        {
          alias: "work",
          claimHash: "secret-connected-app-claim-hash",
          completedAt: null,
          connectedAccountId: "ca_secret_account_id",
          createdAt: new Date("2026-04-27T00:17:00.000Z"),
          expiresAt: new Date("2026-04-27T00:32:00.000Z"),
          memberId,
          startedAt: new Date("2026-04-27T00:17:30.000Z"),
          toolkit: "gmail",
        },
      ],
    },
    hostedConnectedAppsSession: {
      count,
      findMany: async () => [
        {
          createdAt: new Date("2026-04-27T00:16:00.000Z"),
          memberId,
          policyRevision: 12345,
          remoteSessionId: "secret-tool-router-session",
          updatedAt: new Date("2026-04-27T00:16:30.000Z"),
        },
      ],
    },
    hostedProductFeedback: {
      count,
      findMany: async () =>
        input.productFeedbackRows ?? [makeHostedProductFeedbackRowForTest({ memberId })],
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
    hostedComputerRun: {
      count,
      findMany: async () => [
        {
          awaitingMessage:
            "Can you log in here?\n\nhttps://app.example.test/computer/handoff/secret-handoff-token",
          awaitingReason: "login_needed",
          completedAt: null,
          createdAt: new Date("2026-06-17T12:00:00.000Z"),
          expiresAt: new Date("2026-06-17T13:00:00.000Z"),
          id: "computer-run-1",
          kernelLiveViewUrlEncrypted: "secret-live-view-url",
          kernelProfileName: "secret-kernel-profile-name",
          kernelSessionId: "secret-kernel-session",
          lastTitle: "Scheduler",
          lastUrl: "https://dentist.example.test/checkout?token=secret",
          memberId,
          pausedAt: new Date("2026-06-17T12:03:00.000Z"),
          pendingHandoffId: "computer-handoff-1",
          status: "awaiting_user",
          suggestedReply: "done",
          updatedAt: new Date("2026-06-17T12:03:00.000Z"),
        },
      ],
    },
    hostedComputerHandoff: {
      count,
      findMany: async () => [
        {
          completedAt: null,
          createdAt: new Date("2026-06-17T12:03:00.000Z"),
          expiresAt: new Date("2026-06-17T12:23:00.000Z"),
          id: "computer-handoff-1",
          memberId,
          purpose: "login",
          runId: "computer-run-1",
          status: "open",
          suggestedReply: "done",
          tokenHash: "secret-handoff-token-hash",
        },
      ],
    },
    hostedVaultShare: {
      count,
      findMany: async () => [
        {
          createdAt: new Date("2026-06-09T00:30:00.000Z"),
          destinationMemberId: "member_destination_123",
          grantedAt: new Date("2026-06-09T00:30:00.000Z"),
          grantorMemberId: memberId,
          projectionKind: "sleep-times.v0",
          revokedAt: null,
          source: "assistant",
          status: "granted",
          updatedAt: new Date("2026-06-09T00:30:00.000Z"),
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
    hostedIngressLatencyTrace: {
      count,
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
          inboxMediaRetentionWakeAt: new Date("2026-04-27T00:07:00.000Z"),
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
          walletAddressEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-identity.wallet-address",
            memberId,
            value: "0xabc123",
          }),
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
    hostedWebSession: { count },
    hostedMemberBillingRef: { count },
    hostedMemberEmailAuthorization: { count },
    hostedMemberIdentity: { count },
    hostedMemberRouting: { count },
    hostedRuntimeLog: {
      count: async () => {
        throw new Error("runtime log counts should not be exported");
      },
      findMany: async () => {
        throw new Error("runtime log rows should not be exported");
      },
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
        inboxMediaRetentionWakeAt: new Date("2026-04-27T00:07:00.000Z"),
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
  billingRefRecord?: Record<string, unknown> | null;
  connectedAppConnectIntentRows?: HostedAccountDeletionConnectedAppIntentRow[];
  connectedAppsSession?: boolean;
  deleteCalls?: HostedAccountDeletionPrismaDeleteCall[];
  deviceConnections?: Array<{
    id: string;
    provider: string;
    providerAccountBlindIndex: string;
    sources?: { sourceProviderSlug: string; status: string }[];
  }>;
  hostedComputerRunRows?: Record<string, unknown>[];
  identityRecord?: Record<string, unknown> | null;
  onTransaction: () => void;
  operationOrder?: string[];
  transactionConnectedAppConnectIntentRows?: HostedAccountDeletionConnectedAppIntentRow[];
  transactionDeviceConnections?: Array<{
    id: string;
    provider: string;
    providerAccountBlindIndex: string;
    sources?: { sourceProviderSlug: string; status: string }[];
  }>;
}): Parameters<typeof deleteHostedAccountData>[0]["prisma"] {
  const makeDeleteDelegate = (model: string): HostedAccountDeletionPrismaDeleteDelegate => ({
    deleteMany: async (args) => {
      input.operationOrder?.push(`delete:${model}`);
      input.deleteCalls?.push({ model, where: args.where });
      return { count: 1 };
    },
  });
  const transactionPrisma = new Proxy<HostedAccountDeletionPrismaTransactionFake>({
    $executeRaw: async (...args: unknown[]) => {
      input.operationOrder?.push("executeRaw");
      const lockOwner = args.slice(1).find((value): value is string =>
        typeof value === "string" && value.includes(":")
      );
      if (lockOwner) {
        input.operationOrder?.push(`executeRaw:${lockOwner}`);
      }
      return 1;
    },
    $queryRaw: async () => {
      input.operationOrder?.push("queryRaw");
      return [{ id: "member_123" }];
    },
    deviceConnection: {
      ...makeDeleteDelegate("deviceConnection"),
      findMany: async () => {
        input.operationOrder?.push("find:deviceConnection");
        return input.transactionDeviceConnections ?? input.deviceConnections ?? [];
      },
    },
    hostedComputerRun: {
      ...makeDeleteDelegate("hostedComputerRun"),
      findMany: async () => {
        input.operationOrder?.push("find:hostedComputerRun");
        return [];
      },
    },
    hostedConnectedAppConnectIntent: {
      ...makeDeleteDelegate("hostedConnectedAppConnectIntent"),
      findMany: async () => input.transactionConnectedAppConnectIntentRows ?? [],
    },
    hostedMember: {
      ...makeDeleteDelegate("hostedMember"),
      updateMany: async () => {
        input.operationOrder?.push("update:hostedMember");
        return { count: 1 };
      },
    },
  }, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof HostedAccountDeletionPrismaTransactionFake];
      }
      if (typeof property === "string") {
        return makeDeleteDelegate(property);
      }
      return undefined;
    },
  });
  const fakePrisma: unknown = {
    deviceConnection: {
      findMany: async () => input.deviceConnections ?? [],
    },
    hostedMember: {
      findUnique: async () => ({ id: "member_123" }),
    },
    hostedMemberBillingRef: {
      findUnique: async () => input.billingRefRecord ?? null,
    },
    hostedMemberIdentity: {
      findUnique: async () => input.identityRecord ?? null,
    },
    hostedConnectedAppsSession: {
      findUnique: async () => input.connectedAppsSession
        ? { memberId: "member_123" }
        : null,
    },
    hostedConnectedAppConnectIntent: {
      findMany: async () => input.connectedAppConnectIntentRows ?? [],
    },
    hostedComputerRun: {
      findMany: async () => {
        input.operationOrder?.push("find:hostedComputerRun");
        return input.hostedComputerRunRows ?? [];
      },
    },
    $transaction: async (callback: (prisma: typeof transactionPrisma) => Promise<unknown>) => {
      input.onTransaction();
      return callback(transactionPrisma);
    },
  };
  return fakePrisma as Parameters<typeof deleteHostedAccountData>[0]["prisma"];
}

function makeHostedComputerRunRowForDeletionTest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    awaitingMessage: null,
    awaitingReason: null,
    completedAt: null,
    expiresAt: new Date("2026-06-17T13:00:00.000Z"),
    id: "hcr_delete_test",
    kernelLiveViewUrlEncrypted: "secret-live-view",
    kernelProfileName: "kernel-profile-member",
    kernelSessionId: "kernel-session-1",
    lastTitle: "Scheduler",
    lastUrl: "https://dentist.example.test",
    memberId: "member_123",
    metadataJson: null,
    pausedAt: null,
    pendingHandoffId: null,
    status: "running",
    suggestedReply: null,
    updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    ...overrides,
  };
}

async function makeVendorAccountRowsForTest(memberId: string, overrides?: {
  stripeSubscriptionId?: string | null;
}): Promise<{
  billingRefRecord: Record<string, unknown>;
  identityRecord: Record<string, unknown>;
}> {
  const billingPrivateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId,
    stripeCustomerId: "cus_delete_123",
    stripeSubscriptionId: overrides?.stripeSubscriptionId === undefined
      ? "sub_delete_123"
      : overrides.stripeSubscriptionId,
  });
  const identityPrivateColumns = await buildHostedMemberIdentityPrivateColumns({
    memberId,
    phoneNumber: null,
    privyUserId: "privy-user-delete-123",
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
  });

  return {
    billingRefRecord: { memberId, ...billingPrivateColumns },
    identityRecord: {
      memberId,
      walletAddressEncrypted: null,
      walletAddressLookupKey: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
      ...identityPrivateColumns,
    },
  };
}

type HostedAccountDeletionPrismaDeleteCall = {
  model: string;
  where: unknown;
};

type HostedAccountDeletionConnectedAppIntentRow = {
  alias: string | null;
  claimHash?: string;
  connectedAccountId: string | null;
  toolkit: string;
};

type HostedAccountDeletionPrismaDeleteDelegate = {
  deleteMany(args: { where: unknown }): Promise<{ count: number }>;
};

type HostedAccountDeletionPrismaTransactionFake = {
  $executeRaw: (...args: unknown[]) => Promise<number>;
  $queryRaw: (...args: unknown[]) => Promise<Array<{ id: string }>>;
  deviceConnection: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: () => Promise<Array<{
      id: string;
      provider: string;
      providerAccountBlindIndex: string;
      sources?: { sourceProviderSlug: string; status: string }[];
    }>>;
  };
  hostedComputerRun: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: () => Promise<unknown[]>;
  };
  hostedConnectedAppConnectIntent: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: () => Promise<unknown[]>;
  };
  hostedMember: HostedAccountDeletionPrismaDeleteDelegate & {
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
};

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
