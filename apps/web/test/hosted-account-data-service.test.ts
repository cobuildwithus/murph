import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  cancelHostedPulseTrialCheckoutLoserSubscription: vi.fn(),
  connectedAppsClient: {
    deleteAccount: vi.fn(),
    disconnectAccount: vi.fn(),
    listAccounts: vi.fn(),
  },
  createComposioConnectedAppsClient: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  createHostedDeviceSyncRegistry: vi.fn(),
  deleteHostedPrivyUser: vi.fn(),
  deleteHostedRunnerUserDataBestEffort: vi.fn(),
  getHostedOnboardingStripe: vi.fn(),
  readHostedConnectedAppsConfig: vi.fn(),
  revokeOutgoingHostedVaultSharesForMemberDeletionTx: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  assertHostedPhoneCallsReadyForAccountDeletionTx: vi.fn(),
  stopHostedPhoneCallsForAccountDeletion: vi.fn(),
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

vi.mock("@/src/lib/device-sync/providers", () => ({
  createHostedDeviceSyncRegistry: serviceMocks.createHostedDeviceSyncRegistry,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/privy")>()),
  deleteHostedPrivyUser: serviceMocks.deleteHostedPrivyUser,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/runtime")>()),
  getHostedOnboardingStripe: serviceMocks.getHostedOnboardingStripe,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/stripe-billing-events")>()),
  cancelHostedPulseTrialCheckoutLoserSubscription:
    serviceMocks.cancelHostedPulseTrialCheckoutLoserSubscription,
}));

vi.mock("@/src/lib/hosted-execution/user-data-delete", () => ({
  deleteHostedRunnerUserDataBestEffort: serviceMocks.deleteHostedRunnerUserDataBestEffort,
}));

vi.mock("@/src/lib/hosted-orchestration/workflow-termination", () => ({
  terminateHostedUserRuntimeWorkflowBestEffort:
    serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: serviceMocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/phone-calls/account-deletion", () => ({
  assertHostedPhoneCallsReadyForAccountDeletionTx:
    serviceMocks.assertHostedPhoneCallsReadyForAccountDeletionTx,
  stopHostedPhoneCallsForAccountDeletion:
    serviceMocks.stopHostedPhoneCallsForAccountDeletion,
}));

vi.mock("@/src/lib/hosted-vault-share/share-grant-store", () => ({
  revokeOutgoingHostedVaultSharesForMemberDeletionTx:
    serviceMocks.revokeOutgoingHostedVaultSharesForMemberDeletionTx,
}));

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { ComposioConnectedAppsRequestError } from "@/src/lib/connected-apps/composio";
import {
  HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
} from "@/src/lib/hosted-privacy/account-data-shared";
import {
  buildHostedMemberBillingPrivateColumns,
  buildHostedMemberIdentityPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
import {
  createHostedStripeInvoiceLookupKey,
  createHostedStripeSubscriptionLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { sealHostedUserSecureBoxString } from "@/src/lib/hosted-crypto/secure-box";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import {
  deleteHostedAccountData,
  HOSTED_ACCOUNT_DATA_STORE_COVERAGE,
  parseHostedAccountDeletionRequest,
} from "@/src/lib/hosted-privacy/account-data-service";

const REQUIRED_STORE_SLUGS = [
  "prisma.hosted_member",
  "prisma.hosted_web_session",
  "prisma.hosted_sensitive_action_challenge",
  "prisma.hosted_member_identity",
  "prisma.hosted_member_routing",
  "prisma.hosted_member_email_authorization",
  "prisma.hosted_member_billing_ref",
  "prisma.hosted_connected_app_connect_intent",
  "prisma.hosted_connected_apps_session",
  "prisma.hosted_account_group",
  "prisma.hosted_account_group_membership",
  "prisma.hosted_account_group_invite",
  "prisma.hosted_account_group_billing_ref",
  "prisma.hosted_stripe_event_family_compensation",
  "prisma.hosted_stripe_event_pulse_trial_cleanup",
  "prisma.hosted_mailbox_item",
  "prisma.hosted_mailbox_payload",
  "prisma.hosted_mailbox_lane_counter",
  "prisma.hosted_workspace",
  "prisma.hosted_computer_run",
  "prisma.hosted_computer_handoff",
  "prisma.hosted_phone_call",
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
  "prisma.device_sync_companion_capture_receipt",
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

beforeEach(() => {
  vi.stubEnv("KERNEL_API_KEY", "");
  serviceMocks.connectedAppsClient.deleteAccount.mockReset();
  serviceMocks.connectedAppsClient.deleteAccount.mockResolvedValue(undefined);
  serviceMocks.connectedAppsClient.disconnectAccount.mockReset();
  serviceMocks.connectedAppsClient.listAccounts.mockReset();
  serviceMocks.connectedAppsClient.listAccounts.mockResolvedValue([]);
  serviceMocks.cancelHostedPulseTrialCheckoutLoserSubscription.mockReset();
  serviceMocks.cancelHostedPulseTrialCheckoutLoserSubscription.mockResolvedValue(undefined);
  serviceMocks.createComposioConnectedAppsClient.mockReset();
  serviceMocks.createComposioConnectedAppsClient.mockReturnValue(serviceMocks.connectedAppsClient);
  serviceMocks.createHostedDeviceSyncControlPlane.mockReset();
  serviceMocks.createHostedDeviceSyncRegistry.mockReset();
  serviceMocks.createHostedDeviceSyncRegistry.mockReturnValue({
    get: vi.fn(() => null),
  });
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
  serviceMocks.revokeOutgoingHostedVaultSharesForMemberDeletionTx.mockReset();
  serviceMocks.revokeOutgoingHostedVaultSharesForMemberDeletionTx.mockResolvedValue({
    cleanupSignals: [],
    revokedCount: 0,
  });
  serviceMocks.signalHostedMailboxAppendRuntime.mockReset();
  serviceMocks.signalHostedMailboxAppendRuntime.mockResolvedValue(undefined);
  serviceMocks.assertHostedPhoneCallsReadyForAccountDeletionTx.mockReset();
  serviceMocks.assertHostedPhoneCallsReadyForAccountDeletionTx.mockResolvedValue(undefined);
  serviceMocks.stopHostedPhoneCallsForAccountDeletion.mockReset();
  serviceMocks.stopHostedPhoneCallsForAccountDeletion.mockResolvedValue(undefined);
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

describe("HOSTED_ACCOUNT_DATA_STORE_COVERAGE", () => {
  it("documents every high-value store called out by the deletion workflow", () => {
    const slugs = HOSTED_ACCOUNT_DATA_STORE_COVERAGE.map((entry) => entry.slug);

    expect(new Set(slugs).size).toBe(HOSTED_ACCOUNT_DATA_STORE_COVERAGE.length);
    for (const requiredSlug of REQUIRED_STORE_SLUGS) {
      expect(slugs).toContain(requiredSlug);
    }
  });

  it("keeps each store entry actionable for deletion reviews", () => {
    for (const entry of HOSTED_ACCOUNT_DATA_STORE_COVERAGE) {
      expect(entry.label.trim().length).toBeGreaterThan(0);
      expect(entry.note.trim().length).toBeGreaterThan(40);
      expect(VALID_DELETION_MODES.has(entry.deletion)).toBe(true);
    }
  });

  it("marks ciphertext/token stores and external systems with the safest deletion modes", () => {
    const bySlug = new Map(HOSTED_ACCOUNT_DATA_STORE_COVERAGE.map((entry) => [entry.slug, entry]));

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


describe("deleteHostedAccountData", () => {
  it("suspends before Temporal cleanup and terminates around local and Cloudflare cleanup", async () => {
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

    expect(order).toEqual(["prisma", "temporal", "prisma", "temporal", "cloudflare", "temporal"]);
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
    expect(serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort).toHaveBeenNthCalledWith(
      3,
      {
        reason: "account-deleted",
        userId: "member_123",
      },
    );
  });

  it("deletes owned external-thread container runtimes with the account owner", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => {},
      ownedThreadContainerMemberIds: ["member_thread_container_123"],
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(result.cloudflare.deleted).toBe(true);
    expect(serviceMocks.deleteHostedRunnerUserDataBestEffort).toHaveBeenCalledWith({
      context: "settings.account-data.delete",
      userId: "member_123",
    });
    expect(serviceMocks.deleteHostedRunnerUserDataBestEffort).toHaveBeenCalledWith({
      context: "settings.account-data.delete",
      userId: "member_thread_container_123",
    });
    expect(serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort).toHaveBeenCalledWith({
      reason: "account-deleted",
      userId: "member_thread_container_123",
    });
    expect(deleteCalls).toEqual(expect.arrayContaining([
      {
        model: "hostedThreadRoute",
        where: {
          OR: [
            {
              containerMemberId: {
                in: ["member_123", "member_thread_container_123"],
              },
            },
            {
              container: {
                ownerMemberId: {
                  in: ["member_123", "member_thread_container_123"],
                },
              },
            },
          ],
        },
      },
      {
        model: "hostedThreadContainer",
        where: {
          OR: [
            {
              memberId: {
                in: ["member_123", "member_thread_container_123"],
              },
            },
            {
              ownerMemberId: {
                in: ["member_123", "member_thread_container_123"],
              },
            },
          ],
        },
      },
      {
        model: "hostedMember",
        where: {
          id: {
            in: ["member_123", "member_thread_container_123"],
          },
        },
      },
    ]));
  });

  it("deletes delivery-time consume stamps with hosted mailbox item rows", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => {},
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(result.deletedCounts["prisma.hosted_mailbox_item"]).toBe(1);
    expect(deleteCalls).toEqual(expect.arrayContaining([
      {
        model: "hostedMailboxItem",
        where: {
          userId: "member_123",
        },
      },
    ]));
    expect(deleteCalls.map((call) => call.model)).not.toContain("hostedMailboxItemConsume");
  });

  it("revokes outgoing vault shares before member rows cascade and wakes surviving destinations", async () => {
    const operationOrder: string[] = [];
    serviceMocks.revokeOutgoingHostedVaultSharesForMemberDeletionTx.mockImplementation(
      async () => {
        operationOrder.push("vault-share:revoke");
        return {
          cleanupSignals: [{
            mailboxItemId: "mailbox_item_revoke_1",
            memberId: "member_surviving_destination",
          }],
          revokedCount: 1,
        };
      },
    );
    serviceMocks.signalHostedMailboxAppendRuntime.mockImplementation(async () => {
      operationOrder.push("vault-share:signal");
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => operationOrder.push("transaction"),
      operationOrder,
      ownedThreadContainerMemberIds: ["member_thread_container_123"],
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(serviceMocks.revokeOutgoingHostedVaultSharesForMemberDeletionTx)
      .toHaveBeenCalledWith({
        grantorMemberIds: ["member_123", "member_thread_container_123"],
        now: expect.any(Date),
        tx: expect.any(Object),
      });
    expect(serviceMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_surviving_destination",
      mailboxItemId: "mailbox_item_revoke_1",
    });
    expect(result.deletedCounts["prisma.hosted_vault_share"]).toBe(1);
    expect(operationOrder.indexOf("vault-share:revoke")).toBeLessThan(
      operationOrder.indexOf("count:hostedVaultShare"),
    );
    expect(operationOrder.indexOf("count:hostedVaultShare")).toBeLessThan(
      operationOrder.indexOf("delete:hostedMember"),
    );
    expect(operationOrder.indexOf("vault-share:signal")).toBeGreaterThan(
      operationOrder.lastIndexOf("transaction"),
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
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
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

  it("expires a persisted open Checkout session before subscription and local deletion", async () => {
    const order: string[] = [];
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(async () => {
            order.push("stripe:checkout-expire");
            return { id: "cs_delete_123", status: "expired" };
          }),
          retrieve: vi.fn(async () => {
            order.push("stripe:checkout-retrieve");
            return { id: "cs_delete_123", status: "open" };
          }),
        },
      },
      customers: {
        del: vi.fn(async () => ({ deleted: true })),
      },
      subscriptions: {
        cancel: vi.fn(async () => {
          order.push("stripe:subscription-cancel");
          return { status: "canceled" };
        }),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeCheckoutSessionId: "cs_delete_123",
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => order.push("prisma"),
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_delete_123");
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_delete_123");
    expect(order.indexOf("stripe:checkout-expire")).toBeLessThan(
      order.indexOf("stripe:subscription-cancel"),
    );
    expect(order.indexOf("stripe:subscription-cancel")).toBeLessThan(
      order.lastIndexOf("prisma"),
    );
  });

  it("discovers and expires a pre-migration open Checkout session", async () => {
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(async () => ({
            id: "cs_legacy_open_123",
            status: "expired",
          })),
          list: vi.fn(async (args: { status: string }) => args.status === "open"
            ? {
                data: [{
                  client_reference_id: "member_123",
                  id: "cs_legacy_open_123",
                  metadata: { memberId: "member_123" },
                  status: "open",
                }],
                has_more: false,
              }
            : { data: [], has_more: false }),
          retrieve: vi.fn(async () => ({
            id: "cs_legacy_open_123",
            status: "open",
          })),
        },
      },
      customers: {
        del: vi.fn(async () => ({ deleted: true })),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => undefined,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({
      limit: 100,
      status: "open",
    });
    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({
      created: {
        gte: 1_782_864_000,
        lte: 1_785_542_399,
      },
      limit: 100,
      status: "complete",
    });
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_legacy_open_123",
    );
  });

  it("discovers a completed pre-migration Checkout and cancels its subscription", async () => {
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(),
          list: vi.fn(async (args: { status: string }) => args.status === "complete"
            ? {
                data: [{
                  client_reference_id: "member_123",
                  id: "cs_legacy_complete_123",
                  metadata: { memberId: "member_123" },
                  status: "complete",
                }],
                has_more: false,
              }
            : { data: [], has_more: false }),
          retrieve: vi.fn(async () => ({
            customer: "cus_legacy_complete_123",
            id: "cs_legacy_complete_123",
            status: "complete",
            subscription: "sub_legacy_complete_123",
          })),
        },
      },
      customers: {
        del: vi.fn(async () => ({ deleted: true })),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => undefined,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_legacy_complete_123",
    );
    expect(stripe.customers.del).toHaveBeenCalledWith(
      "cus_legacy_complete_123",
    );
  });

  it("discovers a completed Checkout subscription when the session omits it", async () => {
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(),
          list: vi.fn(async (args: { status: string }) => args.status === "complete"
            ? {
                data: [{
                  client_reference_id: "member_123",
                  id: "cs_legacy_complete_unexpanded",
                  metadata: { memberId: "member_123" },
                  status: "complete",
                }],
                has_more: false,
              }
            : { data: [], has_more: false }),
          retrieve: vi.fn(async () => ({
            customer: "cus_legacy_complete_unexpanded",
            id: "cs_legacy_complete_unexpanded",
            status: "complete",
            subscription: null,
          })),
        },
      },
      customers: {
        del: vi.fn(async () => ({ deleted: true })),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        list: vi.fn(async () => ({
          data: [{ id: "sub_legacy_complete_unexpanded" }],
          has_more: false,
        })),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => undefined,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: "cus_legacy_complete_unexpanded",
      limit: 100,
      status: "all",
    });
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_legacy_complete_unexpanded",
    );
  });

  it("pages legacy Checkout discovery and expires only sessions owned by the deleting account", async () => {
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(async (sessionId: string) => ({
            id: sessionId,
            status: "expired",
          })),
          list: vi.fn(async (args: { starting_after?: string; status: string }) => {
            if (args.status === "complete") {
              return { data: [], has_more: false };
            }
            return args.starting_after
              ? {
                  data: [{
                    client_reference_id: "member_123",
                    id: "cs_legacy_owned_123",
                    metadata: { memberId: "member_123" },
                    status: "open",
                  }],
                  has_more: false,
                }
              : {
                  data: [{
                    client_reference_id: "member_unrelated",
                    id: "cs_legacy_unrelated_123",
                    metadata: { memberId: "member_unrelated" },
                    status: "open",
                  }],
                  has_more: true,
                };
          }),
          retrieve: vi.fn(async (sessionId: string) => ({
            id: sessionId,
            status: "open",
          })),
        },
      },
      customers: {
        del: vi.fn(async () => ({ deleted: true })),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => undefined,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.checkout.sessions.list).toHaveBeenNthCalledWith(1, {
      limit: 100,
      status: "open",
    });
    expect(stripe.checkout.sessions.list).toHaveBeenNthCalledWith(2, {
      limit: 100,
      starting_after: "cs_legacy_unrelated_123",
      status: "open",
    });
    expect(stripe.checkout.sessions.list).toHaveBeenNthCalledWith(3, {
      created: {
        gte: 1_782_864_000,
        lte: 1_785_542_399,
      },
      limit: 100,
      status: "complete",
    });
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(
      "cs_legacy_owned_123",
    );
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_legacy_owned_123",
    );
  });

  it("expires an owned Family Checkout session before local deletion", async () => {
    const order: string[] = [];
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(async () => {
            order.push("stripe:checkout-expire");
            return { id: "cs_family_delete_123", status: "expired" };
          }),
          retrieve: vi.fn(async () => ({
            id: "cs_family_delete_123",
            status: "open",
          })),
        },
      },
      customers: {
        del: vi.fn(async () => ({ deleted: true })),
      },
      subscriptions: {
        cancel: vi.fn(async () => {
          order.push("stripe:subscription-cancel");
          return { status: "canceled" };
        }),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const familyBillingRefRecord = await makeFamilyBillingRefRowForTest({
      groupId: "family_group_123",
      ownerMemberId: "member_thread_container_123",
      stripeCheckoutSessionId: "cs_family_delete_123",
      stripeCustomerId: "cus_family_123",
      stripeSubscriptionId: "sub_family_123",
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      familyBillingRefRecords: [familyBillingRefRecord],
      familyGroups: [{
        id: "family_group_123",
        ownerMemberId: "member_thread_container_123",
      }],
      onTransaction: () => order.push("prisma"),
      ownedThreadContainerMemberIds: ["member_thread_container_123"],
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(
      "cs_family_delete_123",
    );
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_family_delete_123",
    );
    expect(order.indexOf("stripe:checkout-expire")).toBeLessThan(
      order.indexOf("stripe:subscription-cancel"),
    );
    expect(order.indexOf("stripe:subscription-cancel")).toBeLessThan(
      order.lastIndexOf("prisma"),
    );
  });

  it("settles a Checkout completion race before removing local billing state", async () => {
    const order: string[] = [];
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(async () => {
            throw new Error("Checkout completed while expiration was in flight");
          }),
          retrieve: vi.fn()
            .mockResolvedValueOnce({ id: "cs_delete_123", status: "open" })
            .mockResolvedValueOnce({
              customer: "cus_checkout_race",
              id: "cs_delete_123",
              status: "complete",
              subscription: "sub_checkout_race",
            }),
        },
      },
      customers: {
        del: vi.fn(async () => {
          order.push("stripe:customer-delete");
          return { deleted: true };
        }),
      },
      subscriptions: {
        cancel: vi.fn(async () => {
          order.push("stripe:subscription-cancel");
          return { status: "canceled" };
        }),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeCheckoutSessionId: "cs_delete_123",
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => order.push("prisma"),
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(2);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_checkout_race");
    expect(stripe.customers.del).toHaveBeenCalledWith("cus_checkout_race");
    expect(order.indexOf("stripe:subscription-cancel")).toBeLessThan(
      order.lastIndexOf("prisma"),
    );
  });

  it("deletes direct and owned-runtime Family Stripe customers during account deletion", async () => {
    const stripe = {
      customers: {
        del: vi.fn(async () => ({ deleted: true })),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
    serviceMocks.deleteHostedPrivyUser.mockImplementation(async () => true);
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const familyBillingRefRecord = await makeFamilyBillingRefRowForTest({
      groupId: "family_group_123",
      ownerMemberId: "member_thread_container_123",
      stripeCustomerId: "cus_family_123",
      stripeSubscriptionId: "sub_family_123",
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      familyBillingRefRecords: [familyBillingRefRecord],
      familyGroups: [{
        id: "family_group_123",
        ownerMemberId: "member_thread_container_123",
      }],
      onTransaction: () => undefined,
      ownedThreadContainerMemberIds: ["member_thread_container_123"],
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_delete_123");
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_family_123");
    expect(stripe.customers.del).toHaveBeenCalledWith("cus_delete_123");
    expect(stripe.customers.del).toHaveBeenCalledWith("cus_family_123");
    expect(result.vendorAccounts.stripeCustomer).toEqual({
      errorCode: null,
      status: "completed",
    });
  });

  it("pages additional subscriptions even when the owned customer has a known local subscription", async () => {
    const stripe = {
      customers: {
        del: vi.fn(async () => ({ deleted: true })),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        list: vi.fn(async (args: { starting_after?: string }) =>
          args.starting_after
            ? {
                data: [{ id: "sub_orphan_page_2" }],
                has_more: false,
              }
            : {
                data: [
                  { id: "sub_delete_123" },
                  { id: "sub_orphan_page_1" },
                ],
                has_more: true,
              }
        ),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => undefined,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.subscriptions.list).toHaveBeenNthCalledWith(1, {
      customer: "cus_delete_123",
      limit: 100,
      status: "all",
    });
    expect(stripe.subscriptions.list).toHaveBeenNthCalledWith(2, {
      customer: "cus_delete_123",
      limit: 100,
      starting_after: "sub_orphan_page_1",
      status: "all",
    });
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(3);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_delete_123");
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_orphan_page_1");
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_orphan_page_2");
  });

  it("discovers an unfinalized auto-trial subscription from its reserved customer", async () => {
    const stripe = {
      customers: {
        del: vi.fn(async () => ({ deleted: true })),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        list: vi.fn(async () => ({
          data: [{ id: "sub_unfinalized_trial_123" }],
          has_more: false,
        })),
        retrieve: vi.fn(async () => ({ status: "trialing" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => undefined,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: "cus_delete_123",
      limit: 100,
      status: "all",
    });
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_unfinalized_trial_123",
    );
  });

  it("settles and scrubs a cancel-only Family compensation without guessing an invoice", async () => {
    const operationOrder: string[] = [];
    const receipt = await makeHostedFamilyCompensationReceiptForDeletionTest({
      effectId: "evt_family_delete_compensation",
      encryptionMemberId: "member_thread_container_123",
      invoiceId: null,
      subscriptionId: "sub_family_delete_compensation",
    });
    const stripe = {
      customers: { del: vi.fn() },
      invoices: {
        list: vi.fn(async () => ({ data: [], has_more: false })),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => undefined,
      operationOrder,
      ownedThreadContainerMemberIds: ["member_thread_container_123"],
      stripeEventRows: [receipt],
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_family_delete_compensation",
      {},
      {
        idempotencyKey:
          "hosted-family-payment-conflict-cancel:evt_family_delete_compensation",
      },
    );
    expect(stripe.invoices.list).toHaveBeenCalledWith({
      limit: 100,
      subscription: "sub_family_delete_compensation",
    });
    expect(receipt).toMatchObject({
      familyPaymentConflictCompensationAcceptedAt: null,
      familyPaymentConflictCompensationCandidateSubscriptionLookupKey: null,
      familyPaymentConflictCompensationEncryptionMemberId: null,
      familyPaymentConflictCompensationInvoiceIdEncrypted: null,
      familyPaymentConflictCompensationInvoiceLookupKey: null,
      familyPaymentConflictCompensationSubscriptionIdEncrypted: null,
      familyPaymentConflictCompensationSubscriptionLookupKey: null,
      status: "completed",
    });
    expect(result.deletedCounts["prisma.hosted_stripe_event_family_compensation"])
      .toBe(1);
    expect(operationOrder.indexOf("update:hostedStripeEvent"))
      .toBeLessThan(operationOrder.indexOf("executeRaw"));
  });

  it.each(["paid", "void", "uncollectible"] as const)(
    "settles cancel-only Family compensation with a zero-paid terminal %s invoice",
    async (invoiceStatus) => {
      const receipt = await makeHostedFamilyCompensationReceiptForDeletionTest({
        effectId: `evt_family_delete_zero_paid_${invoiceStatus}`,
        encryptionMemberId: "member_123",
        invoiceId: null,
        subscriptionId: `sub_family_delete_zero_paid_${invoiceStatus}`,
      });
      const stripe = {
        customers: { del: vi.fn() },
        invoices: {
          list: vi.fn(async () => ({
            data: [{
              amount_paid: 0,
              id: `in_family_delete_zero_paid_${invoiceStatus}`,
              status: invoiceStatus,
            }],
            has_more: false,
          })),
        },
        subscriptions: {
          cancel: vi.fn(async () => ({ status: "canceled" })),
          retrieve: vi.fn(async () => ({ status: "active" })),
        },
      };
      serviceMocks.getHostedOnboardingStripe.mockReturnValue(
        withStripeDeletionDiscovery(stripe),
      );
      const prisma = createHostedAccountDeletionPrismaForTest({
        onTransaction: () => undefined,
        stripeEventRows: [receipt],
      });

      const result = await deleteHostedAccountData({
        memberId: "member_123",
        prisma,
        request: new Request("https://join.example.test/settings"),
      });

      expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
        `sub_family_delete_zero_paid_${invoiceStatus}`,
        {},
        {
          idempotencyKey:
            `hosted-family-payment-conflict-cancel:evt_family_delete_zero_paid_${invoiceStatus}`,
        },
      );
      expect(receipt).toMatchObject({
        familyPaymentConflictCompensationAcceptedAt: null,
        familyPaymentConflictCompensationSubscriptionIdEncrypted: null,
        familyPaymentConflictCompensationSubscriptionLookupKey: null,
        status: "completed",
      });
      expect(result.deletedCounts["prisma.hosted_stripe_event_family_compensation"])
        .toBe(1);
    },
  );

  it("preserves local rows when accepted Family compensation settlement fails", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const receipt = await makeHostedFamilyCompensationReceiptForDeletionTest({
      effectId: "evt_family_delete_compensation",
      encryptionMemberId: "member_123",
      invoiceId: "in_family_delete_compensation",
      subscriptionId: "sub_family_delete_compensation",
    });
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(withStripeDeletionDiscovery({
      invoices: {
        list: vi.fn(async () => ({ data: [], has_more: false })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => {
          throw new Error("Stripe unavailable");
        }),
      },
    }));
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
      stripeEventRows: [receipt],
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_FAMILY_COMPENSATION_FAILED",
      retryable: true,
    });

    expect(deleteCalls).toEqual([]);
    expect(receipt.familyPaymentConflictCompensationAcceptedAt).toEqual(expect.any(Date));
    expect(receipt.familyPaymentConflictCompensationEncryptionMemberId).toBe("member_123");
  });

  it("keeps a null-invoice Family receipt until the exact paid invoice event promotes it", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const receipt = await makeHostedFamilyCompensationReceiptForDeletionTest({
      effectId: "evt_family_delete_waiting_invoice",
      encryptionMemberId: "member_123",
      invoiceId: null,
      subscriptionId: "sub_family_delete_waiting_invoice",
    });
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(withStripeDeletionDiscovery({
      invoices: {
        list: vi.fn(async () => ({
          data: [{
            amount_paid: 5_000,
            id: "in_family_delete_waiting_invoice",
            status: "paid",
          }],
          has_more: false,
        })),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    }));
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
      stripeEventRows: [receipt],
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_FAMILY_COMPENSATION_FAILED",
      retryable: true,
    });

    expect(deleteCalls).toEqual([]);
    expect(receipt.familyPaymentConflictCompensationAcceptedAt).toEqual(expect.any(Date));
    expect(receipt.familyPaymentConflictCompensationInvoiceIdEncrypted).toBeNull();
  });

  it("settles and scrubs accepted Pulse Trial cleanup before deleting crypto roots", async () => {
    const operationOrder: string[] = [];
    const receipt = await makeHostedPulseTrialCleanupReceiptForDeletionTest({
      effectId: "evt_pulse_trial_delete_cleanup",
      memberId: "member_123",
      subscriptionId: "sub_pulse_trial_delete_cleanup",
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => undefined,
      operationOrder,
      stripeEventRows: [receipt],
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(serviceMocks.cancelHostedPulseTrialCheckoutLoserSubscription)
      .toHaveBeenCalledWith({
        memberId: "member_123",
        prisma,
        subscriptionId: "sub_pulse_trial_delete_cleanup",
      });
    expect(receipt).toMatchObject({
      pulseTrialCleanupAcceptedAt: null,
      pulseTrialCleanupEncryptionMemberId: null,
      pulseTrialCleanupSubscriptionIdEncrypted: null,
      status: "completed",
    });
    expect(result.deletedCounts["prisma.hosted_stripe_event_pulse_trial_cleanup"])
      .toBe(1);
    expect(operationOrder.indexOf("update:hostedStripeEvent"))
      .toBeLessThan(operationOrder.indexOf("executeRaw"));
  });

  it("aborts local deletion when a Family compensation changes before the lock recheck", async () => {
    const initialReceipt = await makeHostedFamilyCompensationReceiptForDeletionTest({
      effectId: "evt_family_delete_compensation",
      encryptionMemberId: "member_123",
      invoiceId: null,
      subscriptionId: "sub_family_delete_compensation",
    });
    const promotedReceipt = await makeHostedFamilyCompensationReceiptForDeletionTest({
      effectId: "evt_family_delete_compensation",
      encryptionMemberId: "member_123",
      invoiceId: "in_family_delete_compensation",
      subscriptionId: "sub_family_delete_compensation",
    });
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(withStripeDeletionDiscovery({
      invoices: {
        list: vi.fn(async () => ({ data: [], has_more: false })),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    }));
    let transactionCount = 0;
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => {
        transactionCount += 1;
        if (transactionCount === 2) {
          Object.assign(initialReceipt, promotedReceipt);
        }
      },
      stripeEventRows: [initialReceipt],
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_STATE_CHANGED",
      retryable: true,
    });
    expect(initialReceipt.familyPaymentConflictCompensationAcceptedAt)
      .toEqual(expect.any(Date));
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
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
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
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
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
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(
      withStripeDeletionDiscovery(stripe),
    );
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
      stripeCustomerId: null,
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
      stripeCustomer: { errorCode: null, status: "skipped_no_record" },
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

  it("deletes sensitive-action challenges explicitly with account data", async () => {
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

    expect(result.deletedCounts["prisma.hosted_sensitive_action_challenge"]).toBe(1);
    expect(deleteCalls).toContainEqual({
      model: "hostedSensitiveActionChallenge",
      where: { memberId: "member_123" },
    });
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

  it("deletes hosted phone-call rows explicitly with account data", async () => {
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

    expect(result.deletedCounts["prisma.hosted_phone_call"]).toBe(1);
    expect(deleteCalls).toContainEqual({
      model: "hostedPhoneCall",
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

  it("suspends call creation, ends provider calls, and rechecks authority before local deletion", async () => {
    const operationOrder: string[] = [];
    serviceMocks.stopHostedPhoneCallsForAccountDeletion.mockImplementation(async () => {
      operationOrder.push("phone-call:stop");
    });
    serviceMocks.assertHostedPhoneCallsReadyForAccountDeletionTx.mockImplementation(async () => {
      operationOrder.push("phone-call:assert-ready");
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => operationOrder.push("transaction"),
      operationOrder,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(operationOrder.indexOf("phone-call:stop")).toBeGreaterThan(
      operationOrder.indexOf("update:hostedMember"),
    );
    expect(operationOrder.indexOf("phone-call:assert-ready")).toBeGreaterThan(
      operationOrder.indexOf("transaction"),
    );
    expect(operationOrder.indexOf("phone-call:assert-ready")).toBeLessThan(
      operationOrder.indexOf("delete:hostedPhoneCall"),
    );
  });

  it("preserves local rows when active provider calls cannot be ended", async () => {
    const onTransaction = vi.fn();
    serviceMocks.stopHostedPhoneCallsForAccountDeletion.mockRejectedValue(
      new HostedOnboardingError({
        code: "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED",
        httpStatus: 502,
        message: "Retry account deletion.",
        retryable: true,
      }),
    );
    const prisma = createHostedAccountDeletionPrismaForTest({ onTransaction });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED",
      retryable: true,
    });
    expect(onTransaction).toHaveBeenCalledTimes(1);
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
    const captureReceiptIndex = deletedModels.indexOf("deviceSyncCompanionCaptureReceipt");
    const dirtyPayloadIndex = deletedModels.indexOf("deviceSyncDirtyPayload");
    const dirtyStateIndex = deletedModels.indexOf("deviceSyncDirtyConnection");
    const signalIndex = deletedModels.indexOf("deviceSyncSignal");
    const connectionIndex = deletedModels.indexOf("deviceConnection");

    expect(result.deletedCounts["prisma.device_sync_companion_capture_receipt"]).toBe(1);
    expect(result.deletedCounts["prisma.device_sync_dirty_payload"]).toBe(1);
    expect(result.deletedCounts["prisma.device_sync_dirty_connection"]).toBe(1);
    expect(captureReceiptIndex).toBeGreaterThanOrEqual(0);
    expect(dirtyPayloadIndex).toBeGreaterThanOrEqual(0);
    expect(dirtyStateIndex).toBeGreaterThanOrEqual(0);
    expect(dirtyStateIndex).toBeGreaterThan(captureReceiptIndex);
    expect(dirtyStateIndex).toBeGreaterThan(dirtyPayloadIndex);
    expect(signalIndex).toBeGreaterThan(dirtyStateIndex);
    expect(connectionIndex).toBeGreaterThan(signalIndex);
  });

  it("deletes webhook traces for device connections visible inside the deletion transaction", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const operationOrder: string[] = [];
    serviceMocks.createHostedDeviceSyncControlPlane.mockReturnValueOnce({
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
    serviceMocks.createHostedDeviceSyncRegistry.mockReturnValue({
      get: vi.fn(() => ({
        connectionHandler: {
          revokeAccess,
        },
      })),
    });
    serviceMocks.createHostedDeviceSyncControlPlane.mockReturnValue({
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

  it("reports provider registry failures through the account-deletion revocation policy", async () => {
    const order: string[] = [];
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
    serviceMocks.createHostedDeviceSyncRegistry.mockImplementation(() => {
      throw Object.assign(new Error("invalid provider config"), {
        name: "ProviderConfigError",
      });
    });
    serviceMocks.createHostedDeviceSyncControlPlane.mockReturnValue({
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
    expect((error as HostedOnboardingError).code).toBe("ACCOUNT_DELETION_PROVIDER_REVOKE_FAILED");
    expect((error as HostedOnboardingError).details).toEqual({
      providerRevocations: [
        {
          errorCode: "ProviderConfigError",
          providerLabel: "Garmin",
        },
      ],
    });
    expect(getStoredConnectionAccountForUser).toHaveBeenCalledWith("member_123", "dsc_junction");
    expect(serviceMocks.createHostedDeviceSyncRegistry).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["prisma"]);
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
    expect(result.deletedCounts["prisma.hosted_codex_auth_connection"]).toBe(1);
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
    serviceMocks.createHostedDeviceSyncRegistry.mockReturnValue({
      get: vi.fn(() => ({
        connectionHandler: {
          revokeAccess,
        },
      })),
    });
    serviceMocks.createHostedDeviceSyncControlPlane.mockReturnValue({
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


function createHostedAccountDeletionPrismaForTest(input: {
  billingRefRecord?: Record<string, unknown> | null;
  connectedAppConnectIntentRows?: HostedAccountDeletionConnectedAppIntentRow[];
  connectedAppsSession?: boolean;
  countResults?: Record<string, number>;
  deleteCalls?: HostedAccountDeletionPrismaDeleteCall[];
  deviceConnections?: Array<{
    id: string;
    provider: string;
    providerAccountBlindIndex: string;
    sources?: { sourceProviderSlug: string; status: string }[];
  }>;
  hostedComputerRunRows?: Record<string, unknown>[];
  familyBillingRefRecords?: Record<string, unknown>[];
  familyGroups?: Array<{ id: string; ownerMemberId?: string }>;
  ownedThreadContainerMemberIds?: string[];
  identityRecord?: Record<string, unknown> | null;
  onTransaction: () => void;
  operationOrder?: string[];
  stripeEventRows?: HostedAccountDeletionStripeEventRow[];
  transactionConnectedAppConnectIntentRows?: HostedAccountDeletionConnectedAppIntentRow[];
  transactionDeviceConnections?: Array<{
    id: string;
    provider: string;
    providerAccountBlindIndex: string;
    sources?: { sourceProviderSlug: string; status: string }[];
  }>;
}): Parameters<typeof deleteHostedAccountData>[0]["prisma"] {
  const stripeEventRows = input.stripeEventRows ?? [];
  const makeDeleteDelegate = (model: string): HostedAccountDeletionPrismaDeleteDelegate => ({
    count: async () => {
      input.operationOrder?.push(`count:${model}`);
      return input.countResults?.[model] ?? 1;
    },
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
    hostedAccountGroup: {
      ...makeDeleteDelegate("hostedAccountGroup"),
      findMany: async (args) => filterHostedAccountDeletionFamilyGroups(
        input.familyGroups ?? [],
        args?.where?.ownerMemberId,
      ),
    },
    hostedStripeEvent: createHostedAccountDeletionStripeEventDelegate({
      operationOrder: input.operationOrder,
      rows: stripeEventRows,
    }),
    hostedThreadContainer: {
      ...makeDeleteDelegate("hostedThreadContainer"),
      findMany: async () => (input.ownedThreadContainerMemberIds ?? []).map((memberId) => ({
        memberId,
      })),
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
    hostedAccountGroup: {
      findMany: async (args: { where?: { ownerMemberId?: unknown } }) =>
        filterHostedAccountDeletionFamilyGroups(
          input.familyGroups ?? [],
          args?.where?.ownerMemberId,
        ),
    },
    hostedAccountGroupBillingRef: {
      findUnique: async (args: { where: { groupId: string } }) =>
        input.familyBillingRefRecords?.find((record) => record.groupId === args.where.groupId) ?? null,
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
    hostedStripeEvent: createHostedAccountDeletionStripeEventDelegate({
      operationOrder: input.operationOrder,
      rows: stripeEventRows,
    }),
    hostedThreadContainer: {
      findMany: async () => (input.ownedThreadContainerMemberIds ?? []).map((memberId) => ({
        memberId,
      })),
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
  stripeCheckoutSessionId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<{
  billingRefRecord: Record<string, unknown>;
  identityRecord: Record<string, unknown>;
}> {
  const billingPrivateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId,
    stripeCheckoutSessionId: overrides?.stripeCheckoutSessionId ?? null,
    stripeCustomerId: overrides?.stripeCustomerId === undefined
      ? "cus_delete_123"
      : overrides.stripeCustomerId,
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

async function makeFamilyBillingRefRowForTest(input: {
  groupId: string;
  ownerMemberId: string;
  stripeCheckoutSessionId?: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}): Promise<Record<string, unknown>> {
  const [
    stripeCheckoutSessionIdEncrypted,
    stripeCustomerIdEncrypted,
    stripeSubscriptionIdEncrypted,
  ] = await Promise.all([
    encryptHostedWebNullableString({
      field: "hosted-account-group-billing-ref.stripe-checkout-session-id",
      memberId: input.ownerMemberId,
      value: input.stripeCheckoutSessionId ?? null,
    }),
    encryptHostedWebNullableString({
      field: "hosted-account-group-billing-ref.stripe-customer-id",
      memberId: input.ownerMemberId,
      value: input.stripeCustomerId,
    }),
    encryptHostedWebNullableString({
      field: "hosted-account-group-billing-ref.stripe-subscription-id",
      memberId: input.ownerMemberId,
      value: input.stripeSubscriptionId,
    }),
  ]);

  return {
    currentBillingPhase: "paid",
    currentBillingPlanCode: "launch_family_monthly",
    currentPeriodEnd: new Date("2026-05-23T00:00:00.000Z"),
    currentPeriodStart: new Date("2026-04-23T00:00:00.000Z"),
    group: {
      billingStatus: "active",
      id: input.groupId,
      ownerMemberId: input.ownerMemberId,
      suspendedAt: null,
    },
    groupId: input.groupId,
    lastStripeEventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
    stripeCheckoutSessionIdEncrypted,
    stripeCustomerIdEncrypted,
    stripeSubscriptionIdEncrypted,
  };
}

function withStripeDeletionDiscovery<T extends object>(stripe: T) {
  const checkoutValue = Reflect.get(stripe, "checkout");
  const checkout = typeof checkoutValue === "object" && checkoutValue !== null
    ? checkoutValue
    : {};
  const sessionsValue = Reflect.get(checkout, "sessions");
  const sessions = typeof sessionsValue === "object" && sessionsValue !== null
    ? sessionsValue
    : {};
  const subscriptionsValue = Reflect.get(stripe, "subscriptions");
  const subscriptions = typeof subscriptionsValue === "object" && subscriptionsValue !== null
    ? subscriptionsValue
    : {};
  return {
    ...stripe,
    checkout: {
      ...checkout,
      sessions: {
        list: vi.fn(async () => ({ data: [], has_more: false })),
        ...sessions,
      },
    },
    subscriptions: {
      list: vi.fn(async () => ({ data: [], has_more: false })),
      ...subscriptions,
    },
  };
}

async function makeHostedFamilyCompensationReceiptForDeletionTest(input: {
  effectId: string;
  encryptionMemberId: string;
  invoiceId: string | null;
  subscriptionId: string;
}): Promise<HostedAccountDeletionStripeEventRow> {
  const [invoiceIdEncrypted, subscriptionIdEncrypted] = await Promise.all([
    sealHostedUserSecureBoxString({
      aad: {
        field: "hosted-family-payment-conflict-compensation.invoice-id",
        purpose: "hosted-stripe-event-family-compensation",
        rowId: input.effectId,
        table: "hosted_stripe_event",
      },
      lane: "hosted-member-private-field",
      scope: "hosted-stripe-event-family-compensation:hosted-family-payment-conflict-compensation.invoice-id",
      userId: input.encryptionMemberId,
      value: input.invoiceId,
    }),
    sealHostedUserSecureBoxString({
      aad: {
        field: "hosted-family-payment-conflict-compensation.subscription-id",
        purpose: "hosted-stripe-event-family-compensation",
        rowId: input.effectId,
        table: "hosted_stripe_event",
      },
      lane: "hosted-member-private-field",
      scope: "hosted-stripe-event-family-compensation:hosted-family-payment-conflict-compensation.subscription-id",
      userId: input.encryptionMemberId,
      value: input.subscriptionId,
    }),
  ]);
  return {
    eventId: input.effectId,
    familyPaymentConflictCompensationAcceptedAt: new Date("2026-07-13T12:00:00.000Z"),
    familyPaymentConflictCompensationCandidateSubscriptionLookupKey:
      createHostedStripeSubscriptionLookupKey(input.subscriptionId),
    familyPaymentConflictCompensationEncryptionMemberId: input.encryptionMemberId,
    familyPaymentConflictCompensationInvoiceIdEncrypted: invoiceIdEncrypted,
    familyPaymentConflictCompensationInvoiceLookupKey:
      createHostedStripeInvoiceLookupKey(input.invoiceId),
    familyPaymentConflictCompensationSubscriptionIdEncrypted: subscriptionIdEncrypted,
    familyPaymentConflictCompensationSubscriptionLookupKey:
      createHostedStripeSubscriptionLookupKey(input.subscriptionId),
  };
}

async function makeHostedPulseTrialCleanupReceiptForDeletionTest(input: {
  effectId: string;
  memberId: string;
  subscriptionId: string;
}): Promise<HostedAccountDeletionStripeEventRow> {
  const subscriptionIdEncrypted = await sealHostedUserSecureBoxString({
    aad: {
      field: "hosted-pulse-trial-cleanup.subscription-id",
      purpose: "hosted-stripe-event-pulse-trial-cleanup",
      rowId: input.effectId,
      table: "hosted_stripe_event",
    },
    lane: "hosted-member-private-field",
    scope: "hosted-stripe-event-pulse-trial-cleanup:hosted-pulse-trial-cleanup.subscription-id",
    userId: input.memberId,
    value: input.subscriptionId,
  });
  return {
    eventId: input.effectId,
    familyPaymentConflictCompensationAcceptedAt: null,
    familyPaymentConflictCompensationCandidateSubscriptionLookupKey: null,
    familyPaymentConflictCompensationEncryptionMemberId: null,
    familyPaymentConflictCompensationInvoiceIdEncrypted: null,
    familyPaymentConflictCompensationInvoiceLookupKey: null,
    familyPaymentConflictCompensationSubscriptionIdEncrypted: null,
    familyPaymentConflictCompensationSubscriptionLookupKey: null,
    pulseTrialCleanupAcceptedAt: new Date("2026-07-13T12:00:00.000Z"),
    pulseTrialCleanupEncryptionMemberId: input.memberId,
    pulseTrialCleanupSubscriptionIdEncrypted: subscriptionIdEncrypted,
  };
}

function createHostedAccountDeletionStripeEventDelegate(input: {
  operationOrder?: string[];
  rows: HostedAccountDeletionStripeEventRow[];
}) {
  return {
    count: async (args?: { where?: Record<string, unknown> }) =>
      input.rows.filter((row) =>
        matchesHostedAccountDeletionStripeEventWhere(row, args?.where)
      ).length,
    findMany: async (args?: { where?: Record<string, unknown> }) => {
      input.operationOrder?.push("find:hostedStripeEvent");
      return input.rows
        .filter((row) =>
          matchesHostedAccountDeletionStripeEventWhere(row, args?.where)
        )
        .map((row) => ({ ...row }));
    },
    findUnique: async (args: { where: { eventId: string } }) => {
      const row = input.rows.find((candidate) =>
        candidate.eventId === args.where.eventId
      );
      return row ? { ...row } : null;
    },
    updateMany: async (args: {
      data: Record<string, unknown>;
      where?: Record<string, unknown>;
    }) => {
      input.operationOrder?.push("update:hostedStripeEvent");
      const matches = input.rows.filter((row) =>
        matchesHostedAccountDeletionStripeEventWhere(row, args.where)
      );
      for (const row of matches) {
        Object.assign(row, args.data);
      }
      return { count: matches.length };
    },
  };
}

function matchesHostedAccountDeletionStripeEventWhere(
  row: HostedAccountDeletionStripeEventRow,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) {
    return true;
  }
  if (typeof where.eventId === "string" && row.eventId !== where.eventId) {
    return false;
  }
  if (!matchesHostedAccountDeletionNullableField(
    row.familyPaymentConflictCompensationEncryptionMemberId,
    where.familyPaymentConflictCompensationEncryptionMemberId,
  )) {
    return false;
  }
  if (!matchesHostedAccountDeletionNullableField(
    row.pulseTrialCleanupEncryptionMemberId ?? null,
    where.pulseTrialCleanupEncryptionMemberId,
  )) {
    return false;
  }
  if (!matchesHostedAccountDeletionNullableField(
    row.familyPaymentConflictCompensationCandidateSubscriptionLookupKey,
    where.familyPaymentConflictCompensationCandidateSubscriptionLookupKey,
  )) {
    return false;
  }
  if (!matchesHostedAccountDeletionNullableField(
    row.familyPaymentConflictCompensationSubscriptionLookupKey,
    where.familyPaymentConflictCompensationSubscriptionLookupKey,
  )) {
    return false;
  }
  for (const field of [
    "familyPaymentConflictCompensationAcceptedAt",
    "familyPaymentConflictCompensationInvoiceIdEncrypted",
    "familyPaymentConflictCompensationInvoiceLookupKey",
    "pulseTrialCleanupAcceptedAt",
  ] as const) {
    const expected = where[field];
    if (expected === null && row[field] !== null) {
      return false;
    }
    if (
      expected instanceof Date &&
      (!(row[field] instanceof Date) || row[field]?.getTime() !== expected.getTime())
    ) {
      return false;
    }
    if (
      typeof expected === "object" &&
      expected !== null &&
      "not" in expected &&
      Reflect.get(expected, "not") === null &&
      row[field] === null
    ) {
      return false;
    }
  }
  return true;
}

function matchesHostedAccountDeletionNullableField(
  actual: string | null,
  expected: unknown,
): boolean {
  if (expected === undefined) {
    return true;
  }
  if (typeof expected === "string" || expected === null) {
    return actual === expected;
  }
  if (typeof expected === "object" && expected !== null) {
    const values = Reflect.get(expected, "in");
    return Array.isArray(values) && actual !== null && values.includes(actual);
  }
  return false;
}

function filterHostedAccountDeletionFamilyGroups(
  groups: Array<{ id: string; ownerMemberId?: string }>,
  ownerFilter: unknown,
): Array<{ id: string }> {
  return groups
    .filter((group) => matchesHostedAccountDeletionNullableField(
      group.ownerMemberId ?? "member_123",
      ownerFilter,
    ))
    .map((group) => ({ id: group.id }));
}

type HostedAccountDeletionStripeEventRow = {
  eventId: string;
  familyPaymentConflictCompensationAcceptedAt: Date | null;
  familyPaymentConflictCompensationCandidateSubscriptionLookupKey: string | null;
  familyPaymentConflictCompensationEncryptionMemberId: string | null;
  familyPaymentConflictCompensationInvoiceIdEncrypted: string | null;
  familyPaymentConflictCompensationInvoiceLookupKey: string | null;
  familyPaymentConflictCompensationSubscriptionIdEncrypted: string | null;
  familyPaymentConflictCompensationSubscriptionLookupKey: string | null;
  pulseTrialCleanupAcceptedAt?: Date | null;
  pulseTrialCleanupEncryptionMemberId?: string | null;
  pulseTrialCleanupSubscriptionIdEncrypted?: string | null;
  [key: string]: unknown;
};

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
  count(args: { where: unknown }): Promise<number>;
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
  hostedAccountGroup: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: (args?: {
      where?: { ownerMemberId?: unknown };
    }) => Promise<Array<{ id: string }>>;
  };
  hostedConnectedAppConnectIntent: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: () => Promise<unknown[]>;
  };
  hostedThreadContainer: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: () => Promise<Array<{ memberId: string }>>;
  };
  hostedMember: HostedAccountDeletionPrismaDeleteDelegate & {
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  hostedStripeEvent: ReturnType<typeof createHostedAccountDeletionStripeEventDelegate>;
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
