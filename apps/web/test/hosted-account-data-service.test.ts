import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  connectedAppsClient: {
    deleteAccount: vi.fn(),
    disconnectAccount: vi.fn(),
    listAccounts: vi.fn(),
  },
  applyHostedFamilyStripeCheckoutCompletedTx: vi.fn(),
  createComposioConnectedAppsClient: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  createHostedDeviceSyncRegistry: vi.fn(),
  deleteHostedPrivyUser: vi.fn(),
  deleteHostedRunnerUserDataBestEffort: vi.fn(),
  getHostedOnboardingStripe: vi.fn(),
  readHostedConnectedAppsConfig: vi.fn(),
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx: vi.fn(),
  closeHostedUsageCreditPurchasesForAccountDeletion: vi.fn(),
  assertHostedPhoneCallsReadyForAccountDeletionTx: vi.fn(),
  deleteHostedPhoneCallsForAccountDeletion: vi.fn(),
  executeHostedCheckoutSubscriptionCleanup: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/family-plan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/family-plan")>()),
  applyHostedFamilyStripeCheckoutCompletedTx:
    serviceMocks.applyHostedFamilyStripeCheckoutCompletedTx,
}));

vi.mock(
  "@/src/lib/hosted-onboarding/stripe-checkout-subscription-cleanup",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/src/lib/hosted-onboarding/stripe-checkout-subscription-cleanup")
    >()),
    executeHostedCheckoutSubscriptionCleanup:
      serviceMocks.executeHostedCheckoutSubscriptionCleanup,
  }),
);

vi.mock("@/src/lib/hosted-onboarding/usage-credit-purchase-service", () => ({
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx:
    serviceMocks.assertHostedUsageCreditPurchasesReadyForAccountDeletionTx,
  closeHostedUsageCreditPurchasesForAccountDeletion:
    serviceMocks.closeHostedUsageCreditPurchasesForAccountDeletion,
}));

vi.mock("@/src/lib/hosted-execution/user-data-delete", () => ({
  deleteHostedRunnerUserDataBestEffort: serviceMocks.deleteHostedRunnerUserDataBestEffort,
}));

vi.mock("@/src/lib/hosted-orchestration/workflow-termination", () => ({
  terminateHostedUserRuntimeWorkflowBestEffort:
    serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort,
}));

vi.mock("@/src/lib/phone-calls/account-deletion", () => ({
  assertHostedPhoneCallsReadyForAccountDeletionTx:
    serviceMocks.assertHostedPhoneCallsReadyForAccountDeletionTx,
  deleteHostedPhoneCallsForAccountDeletion:
    serviceMocks.deleteHostedPhoneCallsForAccountDeletion,
}));

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { ComposioConnectedAppsRequestError } from "@/src/lib/connected-apps/composio";
import {
  HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
  HOSTED_ACCOUNT_EXIT_NOTE_MAX_LENGTH,
} from "@/src/lib/hosted-privacy/account-data-shared";
import {
  buildHostedMemberBillingPrivateColumns,
  buildHostedMemberIdentityPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
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
  "prisma.clinical_record_connect_intent",
  "prisma.clinical_record_oauth_session",
  "prisma.clinical_record_connection",
  "prisma.clinical_record_retrieval_run",
  "prisma.clinical_record_retrieval_request",
  "prisma.hosted_account_group",
  "prisma.hosted_account_group_membership",
  "prisma.hosted_account_group_invite",
  "prisma.hosted_account_group_billing_ref",
  "prisma.hosted_account_group_plan_capacity",
  "prisma.hosted_group",
  "prisma.hosted_group_member",
  "prisma.hosted_group_disclosure_permission",
  "prisma.hosted_group_disclosure_grant",
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
  "prisma.hosted_usage_credit_entry",
  "prisma.hosted_usage_credit_purchase",
  "prisma.hosted_product_feedback",
  "prisma.hosted_linq_daily_state",
  "prisma.hosted_linq_invite_delivery",
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
  serviceMocks.applyHostedFamilyStripeCheckoutCompletedTx.mockReset();
  serviceMocks.applyHostedFamilyStripeCheckoutCompletedTx.mockResolvedValue({
    groupId: "family_group_123",
  });
  serviceMocks.connectedAppsClient.deleteAccount.mockReset();
  serviceMocks.connectedAppsClient.deleteAccount.mockResolvedValue(undefined);
  serviceMocks.connectedAppsClient.disconnectAccount.mockReset();
  serviceMocks.connectedAppsClient.listAccounts.mockReset();
  serviceMocks.connectedAppsClient.listAccounts.mockResolvedValue([]);
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
  serviceMocks.assertHostedUsageCreditPurchasesReadyForAccountDeletionTx.mockReset();
  serviceMocks.assertHostedUsageCreditPurchasesReadyForAccountDeletionTx.mockResolvedValue(
    undefined,
  );
  serviceMocks.closeHostedUsageCreditPurchasesForAccountDeletion.mockReset();
  serviceMocks.closeHostedUsageCreditPurchasesForAccountDeletion.mockResolvedValue(undefined);
  serviceMocks.assertHostedPhoneCallsReadyForAccountDeletionTx.mockReset();
  serviceMocks.assertHostedPhoneCallsReadyForAccountDeletionTx.mockResolvedValue(undefined);
  serviceMocks.deleteHostedPhoneCallsForAccountDeletion.mockReset();
  serviceMocks.deleteHostedPhoneCallsForAccountDeletion.mockResolvedValue(undefined);
  serviceMocks.executeHostedCheckoutSubscriptionCleanup.mockReset();
  serviceMocks.executeHostedCheckoutSubscriptionCleanup.mockResolvedValue(undefined);
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
      exitFeedback: null,
    });
  });

  it("carries an answered exit reason and note", () => {
    expect(parseHostedAccountDeletionRequest({
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
      exitNote: "  Too many texts on weekends.  ",
      exitReason: "too_many_texts",
    })).toEqual({
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
      exitFeedback: {
        note: "Too many texts on weekends.",
        reason: "too_many_texts",
      },
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

  // The exit survey is optional telemetry attached to an irreversible privacy
  // action, so a malformed answer must degrade to "skipped" rather than block
  // someone from deleting their own account.
  it.each([
    ["an unknown reason code", { exitReason: "because_i_said_so" }],
    ["a non-string reason", { exitReason: 12 }],
    ["a note with no reason", { exitNote: "orphaned note" }],
    ["an empty reason", { exitReason: "" }],
  ])("still deletes, recording no reason, given %s", (_label, extra) => {
    expect(parseHostedAccountDeletionRequest({
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
      ...extra,
    })).toEqual({
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
      exitFeedback: null,
    });
  });

  it("drops a whitespace-only note and truncates an oversized one", () => {
    expect(parseHostedAccountDeletionRequest({
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
      exitNote: "   ",
      exitReason: "privacy_concerns",
    }).exitFeedback).toEqual({ note: null, reason: "privacy_concerns" });

    const oversized = parseHostedAccountDeletionRequest({
      confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
      exitNote: "n".repeat(HOSTED_ACCOUNT_EXIT_NOTE_MAX_LENGTH + 50),
      exitReason: "not_useful_enough",
    }).exitFeedback;
    expect(oversized?.note).toHaveLength(HOSTED_ACCOUNT_EXIT_NOTE_MAX_LENGTH);
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

  it("keeps usage-credit payment and ledger internals out of browser-vault export", () => {
    const bySlug = new Map(HOSTED_ACCOUNT_DATA_STORE_COVERAGE.map((entry) => [entry.slug, entry]));
    const entry = bySlug.get("prisma.hosted_usage_credit_entry");
    const purchase = bySlug.get("prisma.hosted_usage_credit_purchase");

    expect(entry?.note).toContain("browser-vault export omits");
    expect(entry?.note).toContain("semantic source keys");
    expect(purchase?.note).toContain("browser-vault export omits");
    expect(purchase?.note).toContain("payment identifiers");
    expect(purchase?.note).toContain("Stripe retains records it is legally required to keep");
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

  it("deletes every Clinical Records control-plane row before its connection owner", async () => {
    const operationOrder: string[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => {},
      operationOrder,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(operationOrder.filter((operation) => operation.startsWith("delete:clinicalRecord")))
      .toEqual([
        "delete:clinicalRecordRetrievalRequest",
        "delete:clinicalRecordRetrievalRun",
        "delete:clinicalRecordOauthSession",
        "delete:clinicalRecordConnectIntent",
        "delete:clinicalRecordConnection",
      ]);
    expect(result.deletedCounts).toMatchObject({
      "prisma.clinical_record_connect_intent": 1,
      "prisma.clinical_record_connection": 1,
      "prisma.clinical_record_oauth_session": 1,
      "prisma.clinical_record_retrieval_request": 1,
      "prisma.clinical_record_retrieval_run": 1,
    });
  });

  it("deletes disclosure grants and owned policies before their membership and group owners", async () => {
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

    expect(deleteCalls).toEqual(expect.arrayContaining([
      {
        model: "hostedGroupDisclosureGrant",
        where: { OR: [
          { membership: { memberId: "member_123" } },
          { membership: { group: { ownerMemberId: "member_123" } } },
          { membership: { group: { runtimeMemberId: "member_123" } } },
        ] },
      },
      {
        model: "hostedGroupDisclosurePermission",
        where: { group: { OR: [
          { ownerMemberId: "member_123" },
          { runtimeMemberId: "member_123" },
        ] } },
      },
    ]));
    const deletedModels = deleteCalls.map((call) => call.model);
    expect(deletedModels.indexOf("hostedGroupDisclosureGrant")).toBeLessThan(
      deletedModels.indexOf("hostedGroupDisclosurePermission"),
    );
    for (const owner of ["hostedGroupMember", "hostedGroup"]) {
      expect(deletedModels.indexOf("hostedGroupDisclosurePermission"))
        .toBeLessThan(deletedModels.indexOf(owner));
    }
    expect(result.deletedCounts).toMatchObject({
      "prisma.hosted_group_disclosure_grant": 1,
      "prisma.hosted_group_disclosure_permission": 1,
    });
  });

  it("deletes usage-credit entries before purchases and member rows", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const operationOrder: string[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => operationOrder.push("transaction"),
      operationOrder,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(result.deletedCounts).toMatchObject({
      "prisma.hosted_usage_credit_entry": 1,
      "prisma.hosted_usage_credit_purchase": 1,
    });
    expect(deleteCalls).toEqual(expect.arrayContaining([
      {
        model: "hostedUsageCreditEntry",
        where: {
          OR: [
            { beneficiaryMemberId: "member_123" },
            { purchase: { beneficiaryMemberId: "member_123" } },
          ],
        },
      },
      {
        model: "hostedUsageCreditPurchase",
        where: {
          beneficiaryMemberId: "member_123",
        },
      },
    ]));
    expect(operationOrder.indexOf("delete:hostedUsageCreditEntry")).toBeLessThan(
      operationOrder.indexOf("delete:hostedUsageCreditPurchase"),
    );
    expect(operationOrder.indexOf("delete:hostedUsageCreditPurchase")).toBeLessThan(
      operationOrder.indexOf("delete:hostedMember"),
    );
  });

  it("closes usage-credit provider attempts after suspension and rechecks them before local deletion", async () => {
    const operationOrder: string[] = [];
    serviceMocks.closeHostedUsageCreditPurchasesForAccountDeletion.mockImplementation(
      async () => {
        operationOrder.push("usage-credit:close");
      },
    );
    serviceMocks.assertHostedUsageCreditPurchasesReadyForAccountDeletionTx.mockImplementation(
      async () => {
        operationOrder.push("usage-credit:assert");
      },
    );
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => operationOrder.push("transaction"),
      operationOrder,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(operationOrder.indexOf("usage-credit:close")).toBeGreaterThan(
      operationOrder.indexOf("update:hostedMember"),
    );
    expect(operationOrder.indexOf("usage-credit:assert")).toBeGreaterThan(
      operationOrder.lastIndexOf("update:hostedMember"),
    );
    expect(operationOrder.indexOf("usage-credit:assert")).toBeLessThan(
      operationOrder.indexOf("delete:hostedUsageCreditEntry"),
    );
    expect(operationOrder.indexOf("usage-credit:assert")).toBeLessThan(
      operationOrder.indexOf("delete:hostedUsageCreditPurchase"),
    );
  });

  it("keeps local purchase ownership when provider convergence cannot be proven", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const onTransaction = vi.fn();
    serviceMocks.closeHostedUsageCreditPurchasesForAccountDeletion.mockRejectedValue(
      Object.assign(new Error("Stripe checkout could not be verified"), {
        code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
        retryable: true,
      }),
    );
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
      retryable: true,
    });

    expect(onTransaction).toHaveBeenCalledTimes(1);
    expect(deleteCalls).toEqual([]);
    expect(
      serviceMocks.assertHostedUsageCreditPurchasesReadyForAccountDeletionTx,
    ).not.toHaveBeenCalled();
  });

  it("keeps local purchase ownership when the final locked readiness fence fails", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const onTransaction = vi.fn();
    serviceMocks.assertHostedUsageCreditPurchasesReadyForAccountDeletionTx.mockRejectedValue(
      Object.assign(new Error("Usage-credit purchase remained unresolved"), {
        code: "ACCOUNT_DELETION_USAGE_CREDIT_UNRESOLVED",
        retryable: true,
      }),
    );
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_USAGE_CREDIT_UNRESOLVED",
      retryable: true,
    });

    expect(onTransaction).toHaveBeenCalledTimes(2);
    expect(deleteCalls).toEqual([]);
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
        model: "hostedLinqDelivery",
        where: {
          OR: [
            {
              sourceRef: {
                startsWith: "linq-invite-signup:member_123:",
              },
            },
            {
              sourceRef: {
                startsWith: "linq-invite-signup:member_thread_container_123:",
              },
            },
          ],
          template: {
            in: ["invite_signup", "invite_signup_fallback"],
          },
        },
      },
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
    expect(result.deletedCounts["prisma.hosted_linq_invite_delivery"]).toBe(1);
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

  it("reports vault-share rows before member-row FK cascades delete them", async () => {
    const operationOrder: string[] = [];
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

    expect(result.deletedCounts["prisma.hosted_vault_share"]).toBe(1);
    expect(operationOrder.indexOf("count:hostedVaultShare")).toBeLessThan(
      operationOrder.indexOf("delete:hostedMember"),
    );
  });

  it("reads and expires an exact open standard Checkout only after the suspension fence", async () => {
    const operationOrder: string[] = [];
    const billingRefRecord = await makeCheckoutAttemptBillingRefRowForTest({
      attemptId: "checkout_attempt_delete_open",
      intentHash: "intent_hash_delete_open",
      memberId: "member_123",
      sessionId: "cs_test_delete_open",
    });
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(async () => {
            operationOrder.push("stripe:checkout-expire");
            return {
              id: "cs_test_delete_open",
              status: "expired",
            };
          }),
          retrieve: vi.fn(async () => {
            operationOrder.push("stripe:checkout-retrieve");
            return makeStandardCheckoutSessionForAccountDeletionTest({
              attemptId: "checkout_attempt_delete_open",
              intentHash: "intent_hash_delete_open",
              sessionId: "cs_test_delete_open",
              status: "open",
            });
          }),
        },
      },
    };
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecord,
      onTransaction: () => operationOrder.push("transaction"),
      operationOrder,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(operationOrder.indexOf("update:hostedMember")).toBeLessThan(
      operationOrder.indexOf("find:hostedMemberBillingRef"),
    );
    expect(operationOrder.indexOf("find:hostedMemberBillingRef")).toBeLessThan(
      operationOrder.indexOf("stripe:checkout-retrieve"),
    );
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(
      "cs_test_delete_open",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_test_delete_open",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(serviceMocks.executeHostedCheckoutSubscriptionCleanup).not
      .toHaveBeenCalled();
  });

  it("treats an already-expired standard Checkout as idempotently cleaned up", async () => {
    const billingRefRecord = await makeCheckoutAttemptBillingRefRowForTest({
      attemptId: "checkout_attempt_delete_expired",
      intentHash: "intent_hash_delete_expired",
      memberId: "member_123",
      sessionId: "cs_test_delete_expired",
    });
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(),
          retrieve: vi.fn(async () =>
            makeStandardCheckoutSessionForAccountDeletionTest({
              attemptId: "checkout_attempt_delete_expired",
              intentHash: "intent_hash_delete_expired",
              sessionId: "cs_test_delete_expired",
              status: "expired",
            })),
        },
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecord,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).resolves.toMatchObject({
      memberId: "member_123",
    });

    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
  });

  it("treats a resource-missing standard Checkout as idempotently cleaned up", async () => {
    const billingRefRecord = await makeCheckoutAttemptBillingRefRowForTest({
      attemptId: "checkout_attempt_delete_missing",
      intentHash: "intent_hash_delete_missing",
      memberId: "member_123",
      sessionId: "cs_test_delete_missing",
    });
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(),
          retrieve: vi.fn(async () => {
            throw Object.assign(new Error("No such checkout session"), {
              code: "resource_missing",
              type: "StripeInvalidRequestError",
            });
          }),
        },
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecord,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).resolves.toMatchObject({
      memberId: "member_123",
    });

    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
  });

  it.each([
    [
      "member owner",
      {
        client_reference_id: "member_other",
      },
    ],
    [
      "attempt",
      {
        metadata: {
          checkoutAttemptId: "checkout_attempt_other",
        },
      },
    ],
    [
      "intent hash",
      {
        metadata: {
          checkoutIntentHash: "intent_hash_other",
        },
      },
    ],
  ])("fails closed when the stored Checkout %s does not match", async (
    _label,
    override,
  ) => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const billingRefRecord = await makeCheckoutAttemptBillingRefRowForTest({
      attemptId: "checkout_attempt_delete_mismatch",
      intentHash: "intent_hash_delete_mismatch",
      memberId: "member_123",
      sessionId: "cs_test_delete_mismatch",
    });
    const baseSession = makeStandardCheckoutSessionForAccountDeletionTest({
      attemptId: "checkout_attempt_delete_mismatch",
      intentHash: "intent_hash_delete_mismatch",
      sessionId: "cs_test_delete_mismatch",
      status: "open",
    });
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(),
          retrieve: vi.fn(async () => ({
            ...baseSession,
            ...override,
            metadata: {
              ...baseSession.metadata,
              ...("metadata" in override ? override.metadata : {}),
            },
          })),
        },
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecord,
      deleteCalls,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_STRIPE_CHECKOUT_MISMATCH",
      retryable: false,
    });

    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(deleteCalls).toEqual([]);
  });

  it.each([
    [
      "a deterministic invalid request",
      Object.assign(new Error("Invalid parameter"), {
        code: "parameter_invalid_integer",
        statusCode: 400,
        type: "StripeInvalidRequestError",
      }),
      "ACCOUNT_DELETION_STRIPE_CHECKOUT_PROVIDER_REJECTED",
      false,
    ],
    [
      "an ambiguous connection failure",
      Object.assign(new Error("Connection ended"), {
        code: "ETIMEDOUT",
        type: "StripeConnectionError",
      }),
      "ACCOUNT_DELETION_STRIPE_CHECKOUT_PROVIDER_UNAVAILABLE",
      true,
    ],
  ])("classifies %s without deleting local ownership", async (
    _label,
    providerError,
    expectedCode,
    expectedRetryable,
  ) => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const billingRefRecord = await makeCheckoutAttemptBillingRefRowForTest({
      attemptId: "checkout_attempt_delete_provider_error",
      intentHash: "intent_hash_delete_provider_error",
      memberId: "member_123",
      sessionId: "cs_test_delete_provider_error",
    });
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(),
          retrieve: vi.fn(async () => {
            throw providerError;
          }),
        },
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecord,
      deleteCalls,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: expectedCode,
      retryable: expectedRetryable,
    });

    expect(deleteCalls).toEqual([]);
  });

  it.each([
    "standard",
    "pulse_trial_7d",
  ] as const)(
    "cleans a completed missing-webhook %s Checkout after the deletion fence",
    async (checkoutOffer) => {
    const operationOrder: string[] = [];
    const attemptBillingRef = await makeCheckoutAttemptBillingRefRowForTest({
      attemptId: "checkout_attempt_delete_complete",
      intentHash: "intent_hash_delete_complete",
      memberId: "member_123",
      sessionId: "cs_test_delete_complete",
    });
    const session = makeStandardCheckoutSessionForAccountDeletionTest({
      attemptId: "checkout_attempt_delete_complete",
      checkoutOffer,
      customerId: "cus_delete_complete",
      intentHash: "intent_hash_delete_complete",
      sessionId: "cs_test_delete_complete",
      status: "complete",
      subscriptionId: "sub_delete_complete",
    });
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(),
          retrieve: vi.fn(async () => session),
        },
      },
      customers: {
        del: vi.fn(async (customerId: string) => {
          operationOrder.push("stripe:customer-delete");
          return { deleted: true, id: customerId };
        }),
        retrieve: vi.fn(async (customerId: string) =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId)),
      },
    };
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
    serviceMocks.executeHostedCheckoutSubscriptionCleanup.mockImplementation(
      async () => {
        operationOrder.push("stripe-checkout:cancel-refund");
      },
    );
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecord: attemptBillingRef,
      onTransaction: () => operationOrder.push("transaction"),
      operationOrder,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(serviceMocks.executeHostedCheckoutSubscriptionCleanup)
      .toHaveBeenCalledWith({
        candidate: {
          checkoutAttemptId: "checkout_attempt_delete_complete",
          checkoutIntentHash: "intent_hash_delete_complete",
          checkoutSessionId: "cs_test_delete_complete",
          familyBillingClaim: null,
          memberId: "member_123",
          reason: "superseded",
          stripeSubscriptionId: "sub_delete_complete",
        },
        prisma,
        stripe,
      });
    expect(stripe.customers.del).toHaveBeenCalledWith(
      "cus_delete_complete",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(operationOrder.indexOf("stripe-checkout:cancel-refund")).toBeLessThan(
      operationOrder.indexOf("delete:hostedMember"),
    );
    },
  );

  it("cleans a standard Checkout that completes after the deletion fence races expiration", async () => {
    const operationOrder: string[] = [];
    const billingRefRecord = await makeCheckoutAttemptBillingRefRowForTest({
      attemptId: "checkout_attempt_delete_race",
      intentHash: "intent_hash_delete_race",
      memberId: "member_123",
      sessionId: "cs_test_delete_race",
    });
    const openSession = makeStandardCheckoutSessionForAccountDeletionTest({
      attemptId: "checkout_attempt_delete_race",
      customerId: "cus_delete_race",
      intentHash: "intent_hash_delete_race",
      sessionId: "cs_test_delete_race",
      status: "open",
    });
    const completeSession = makeStandardCheckoutSessionForAccountDeletionTest({
      attemptId: "checkout_attempt_delete_race",
      customerId: "cus_delete_race",
      intentHash: "intent_hash_delete_race",
      sessionId: "cs_test_delete_race",
      status: "complete",
      subscriptionId: "sub_delete_race",
    });
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(async () => {
            operationOrder.push("stripe:checkout-expire-raced");
            throw Object.assign(new Error("Checkout is no longer open"), {
              code: "checkout_session_not_open",
              statusCode: 400,
              type: "StripeInvalidRequestError",
            });
          }),
          retrieve: vi.fn()
            .mockResolvedValueOnce(openSession)
            .mockResolvedValueOnce(completeSession),
        },
      },
      customers: {
        del: vi.fn(async (customerId: string) => ({
          deleted: true,
          id: customerId,
        })),
        retrieve: vi.fn(async (customerId: string) =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId)),
      },
    };
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
    serviceMocks.executeHostedCheckoutSubscriptionCleanup.mockImplementation(
      async () => {
        operationOrder.push("stripe-checkout:cancel-refund");
      },
    );
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecord,
      onTransaction: () => undefined,
      operationOrder,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(2);
    expect(serviceMocks.executeHostedCheckoutSubscriptionCleanup)
      .toHaveBeenCalledWith({
        candidate: {
          checkoutAttemptId: "checkout_attempt_delete_race",
          checkoutIntentHash: "intent_hash_delete_race",
          checkoutSessionId: "cs_test_delete_race",
          familyBillingClaim: null,
          memberId: "member_123",
          reason: "superseded",
          stripeSubscriptionId: "sub_delete_race",
        },
        prisma,
        stripe,
      });
    expect(operationOrder.indexOf("stripe:checkout-expire-raced")).toBeLessThan(
      operationOrder.indexOf("stripe-checkout:cancel-refund"),
    );
    expect(operationOrder.indexOf("stripe-checkout:cancel-refund")).toBeLessThan(
      operationOrder.indexOf("delete:hostedMember"),
    );
  });

  it("cleans a completed superseded Checkout loser before deleting the accepted subscription", async () => {
    const operationOrder: string[] = [];
    const attemptBillingRef = await makeCheckoutAttemptBillingRefRowForTest({
      attemptId: "checkout_attempt_delete_loser",
      intentHash: "intent_hash_delete_loser",
      memberId: "member_123",
      sessionId: "cs_test_delete_loser",
    });
    const acceptedBillingRef = await makeCheckoutAttemptBillingRefRowForTest({
      customerId: "cus_delete_authoritative",
      memberId: "member_123",
      subscriptionId: "sub_delete_authoritative",
    });
    const session = makeStandardCheckoutSessionForAccountDeletionTest({
      attemptId: "checkout_attempt_delete_loser",
      customerId: "cus_delete_loser",
      intentHash: "intent_hash_delete_loser",
      sessionId: "cs_test_delete_loser",
      status: "complete",
      subscriptionId: "sub_delete_loser",
    });
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(),
          retrieve: vi.fn(async () => session),
        },
      },
      customers: {
        del: vi.fn(async (customerId: string) => ({
          deleted: true,
          id: customerId,
        })),
        retrieve: vi.fn(async (customerId: string) =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId)),
      },
      subscriptions: {
        cancel: vi.fn(async () => {
          operationOrder.push("stripe:authoritative-subscription-cancel");
          return { id: "sub_delete_authoritative", status: "canceled" };
        }),
        retrieve: vi.fn(async () => ({
          id: "sub_delete_authoritative",
          status: "active",
        })),
      },
    };
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
    serviceMocks.executeHostedCheckoutSubscriptionCleanup.mockImplementation(
      async () => {
        operationOrder.push("stripe-checkout:loser-cleanup");
      },
    );
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecords: [attemptBillingRef, acceptedBillingRef],
      onTransaction: () => undefined,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(serviceMocks.executeHostedCheckoutSubscriptionCleanup)
      .toHaveBeenCalledWith({
        candidate: {
          checkoutAttemptId: "checkout_attempt_delete_loser",
          checkoutIntentHash: "intent_hash_delete_loser",
          checkoutSessionId: "cs_test_delete_loser",
          familyBillingClaim: null,
          memberId: "member_123",
          reason: "superseded",
          stripeSubscriptionId: "sub_delete_loser",
        },
        prisma,
        stripe,
      });
    expect(stripe.customers.del).toHaveBeenCalledWith(
      "cus_delete_authoritative",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(stripe.customers.del).toHaveBeenCalledWith(
      "cus_delete_loser",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(operationOrder.indexOf("stripe-checkout:loser-cleanup")).toBeLessThan(
      operationOrder.indexOf("stripe:authoritative-subscription-cancel"),
    );
  });

  it("clears an exact unbound direct Checkout reservation after the deletion fence", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const billingRefRecord = await makeCheckoutAttemptBillingRefRowForTest({
      attemptId: "checkout_attempt_binding_pending",
      intentHash: "intent_hash_binding_pending",
      memberId: "member_123",
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecord,
      deleteCalls,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).resolves.toMatchObject({
      memberId: "member_123",
    });

    expect(deleteCalls.length).toBeGreaterThan(0);
    expect(serviceMocks.getHostedOnboardingStripe).not.toHaveBeenCalled();
  });

  it("replays a fresh exact Customer reservation and deletes the recovered Customer with all known Customers", async () => {
    const reservationId = "hbscr_account_delete_recovery";
    const billingRefRecord = {
      ...await makeCheckoutAttemptBillingRefRowForTest({
        memberId: "member_123",
      }),
      stripeCustomerReservationCreatedAt: new Date(Date.now() - 60_000),
      stripeCustomerReservationId: reservationId,
    };
    const familyBillingRefRecord = await makeFamilyBillingRefRowForTest({
      groupId: "family_group_123",
      ownerMemberId: "member_123",
      stripeCustomerId: "cus_family_123",
      stripeSubscriptionId: null,
    });
    const stripe = {
      customers: {
        create: vi.fn(async () =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(
            "cus_recovered_reservation",
            {
              customerReservationId: reservationId,
              memberId: "member_123",
              source: "hosted.auto_pulse_trial",
            },
          )),
        del: vi.fn(async (customerId: string) => ({
          deleted: true,
          id: customerId,
        })),
        retrieve: vi.fn(async (customerId: string) =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(
            customerId,
            customerId === "cus_recovered_reservation"
              ? {
                  customerReservationId: reservationId,
                  memberId: "member_123",
                  source: "hosted.auto_pulse_trial",
                }
              : {},
          )),
      },
    };
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecord,
      familyBillingRefRecords: [familyBillingRefRecord],
      familyGroups: [{ id: "family_group_123" }],
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.customers.create).toHaveBeenCalledWith(
      {
        metadata: {
          customerReservationId: reservationId,
          memberId: "member_123",
          source: "hosted.auto_pulse_trial",
        },
      },
      {
        idempotencyKey:
          "hosted-auto-pulse-trial-customer:hbscr_account_delete_recovery",
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(stripe.customers.retrieve).toHaveBeenCalledWith(
      "cus_recovered_reservation",
      {
        expand: ["cash_balance", "invoice_credit_balance"],
      },
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(stripe.customers.del).toHaveBeenCalledWith(
      "cus_recovered_reservation",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(stripe.customers.del).toHaveBeenCalledWith(
      "cus_family_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(result.vendorAccounts.stripeCustomer).toEqual({
      errorCode: null,
      status: "completed",
    });
  });

  it.each([
    [
      "partial",
      {
        stripeCustomerReservationCreatedAt: null,
        stripeCustomerReservationId: "hbscr_partial_delete",
      },
      "HOSTED_STRIPE_CUSTOMER_RESERVATION_INCONSISTENT",
    ],
    [
      "expired",
      {
        stripeCustomerReservationCreatedAt:
          new Date(Date.now() - (24 * 60 * 60 * 1_000)),
        stripeCustomerReservationId: "hbscr_expired_delete",
      },
      "HOSTED_STRIPE_CUSTOMER_RESERVATION_RECOVERY_REQUIRED",
    ],
  ] as const)(
    "fails closed without recreating a Customer for a %s reservation marker",
    async (_label, marker, expectedCode) => {
      const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
      const billingRefRecord = {
        ...await makeCheckoutAttemptBillingRefRowForTest({
          memberId: "member_123",
        }),
        ...marker,
      };
      const stripe = {
        customers: {
          create: vi.fn(),
        },
      };
      serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
      const prisma = createHostedAccountDeletionPrismaForTest({
        billingRefRecord,
        deleteCalls,
        onTransaction: () => undefined,
      });

      await expect(deleteHostedAccountData({
        memberId: "member_123",
        prisma,
        request: new Request("https://join.example.test/settings"),
      })).rejects.toMatchObject({
        code: expectedCode,
        retryable: false,
      });

      expect(serviceMocks.getHostedOnboardingStripe).not.toHaveBeenCalled();
      expect(stripe.customers.create).not.toHaveBeenCalled();
      expect(deleteCalls).toEqual([]);
    },
  );

  it("fails closed when a recovered reservation Customer has mismatched metadata", async () => {
    const reservationId = "hbscr_metadata_mismatch";
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const billingRefRecord = {
      ...await makeCheckoutAttemptBillingRefRowForTest({
        memberId: "member_123",
      }),
      stripeCustomerReservationCreatedAt: new Date(Date.now() - 60_000),
      stripeCustomerReservationId: reservationId,
    };
    const stripe = {
      customers: {
        create: vi.fn(async () => ({ id: "cus_wrong_metadata" })),
        del: vi.fn(),
        retrieve: vi.fn(async () =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(
            "cus_wrong_metadata",
            {
              customerReservationId: "hbscr_other",
              memberId: "member_123",
              source: "hosted.auto_pulse_trial",
            },
          )),
      },
    };
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecord,
      deleteCalls,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_STRIPE_CUSTOMER_STATE_INCONSISTENT",
      retryable: false,
    });

    expect(deleteCalls).toEqual([]);
    expect(stripe.customers.del).not.toHaveBeenCalled();
  });

  it("classifies a provider failure while replaying a fresh Customer reservation", async () => {
    const reservationId = "hbscr_provider_failure";
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const billingRefRecord = {
      ...await makeCheckoutAttemptBillingRefRowForTest({
        memberId: "member_123",
      }),
      stripeCustomerReservationCreatedAt: new Date(Date.now() - 60_000),
      stripeCustomerReservationId: reservationId,
    };
    const stripe = {
      customers: {
        create: vi.fn(async () => {
          throw Object.assign(new Error("Connection ended"), {
            code: "ETIMEDOUT",
            type: "StripeConnectionError",
          });
        }),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecord,
      deleteCalls,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_STRIPE_CUSTOMER_PROVIDER_UNAVAILABLE",
      retryable: true,
    });

    expect(stripe.customers.create).toHaveBeenCalledOnce();
    expect(deleteCalls).toEqual([]);
  });

  it("aborts final deletion when a new direct subscription binds after provider cleanup", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const initialBillingRef = await makeCheckoutAttemptBillingRefRowForTest({
      memberId: "member_123",
    });
    const driftedBillingRef = await makeCheckoutAttemptBillingRefRowForTest({
      customerId: "cus_bound_after_cleanup",
      memberId: "member_123",
      subscriptionId: "sub_bound_after_cleanup",
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      billingRefRecords: [
        initialBillingRef,
        initialBillingRef,
        driftedBillingRef,
      ],
      deleteCalls,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_STRIPE_BILLING_OWNERSHIP_CHANGED",
      retryable: true,
    });

    expect(deleteCalls).toEqual([]);
  });

  it("expires an exact open owned Family Checkout before deleting its group", async () => {
    const operationOrder: string[] = [];
    const familyBillingRefRecord = await makeFamilyBillingRefRowForTest({
      checkoutAttemptId: "family_checkout_attempt_open",
      checkoutSessionId: "cs_test_family_delete_open",
      groupId: "family_group_123",
      ownerMemberId: "member_123",
      stripeCustomerId: "cus_family_delete_open",
      stripeSubscriptionId: null,
    });
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(async () => {
            operationOrder.push("stripe:family-checkout-expire");
            return {
              id: "cs_test_family_delete_open",
              status: "expired",
            };
          }),
          retrieve: vi.fn(async () => {
            operationOrder.push("stripe:family-checkout-retrieve");
            return makeFamilyCheckoutSessionForAccountDeletionTest({
              attemptId: "family_checkout_attempt_open",
              customerId: "cus_family_delete_open",
              sessionId: "cs_test_family_delete_open",
              status: "open",
            });
          }),
        },
      },
      customers: {
        del: vi.fn(async (customerId: string) => ({
          deleted: true,
          id: customerId,
        })),
        retrieve: vi.fn(async (customerId: string) =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId)),
      },
    };
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      familyBillingRefRecords: [familyBillingRefRecord],
      familyGroups: [{ id: "family_group_123" }],
      onTransaction: () => operationOrder.push("transaction"),
      operationOrder,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(operationOrder.indexOf("update:hostedMember")).toBeLessThan(
      operationOrder.indexOf("stripe:family-checkout-retrieve"),
    );
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_test_family_delete_open",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(serviceMocks.applyHostedFamilyStripeCheckoutCompletedTx).not
      .toHaveBeenCalled();
    expect(serviceMocks.executeHostedCheckoutSubscriptionCleanup).not
      .toHaveBeenCalled();
    expect(stripe.customers.del).toHaveBeenCalledWith(
      "cus_family_delete_open",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
  });

  it("recovers a Family Checkout that completes while expiration races, then refunds before group deletion", async () => {
    const operationOrder: string[] = [];
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const familyAttemptBillingRef = await makeFamilyBillingRefRowForTest({
      checkoutAttemptId: "family_checkout_attempt_race",
      checkoutSessionId: "cs_test_family_delete_race",
      groupId: "family_group_123",
      ownerMemberId: "member_123",
      stripeCustomerId: "cus_family_delete_race",
      stripeSubscriptionId: null,
    });
    const familyAcceptedBillingRef = await makeFamilyBillingRefRowForTest({
      groupId: "family_group_123",
      ownerMemberId: "member_123",
      stripeCustomerId: "cus_family_delete_race",
      stripeSubscriptionId: "sub_family_delete_race",
    });
    const openSession = makeFamilyCheckoutSessionForAccountDeletionTest({
      attemptId: "family_checkout_attempt_race",
      customerId: "cus_family_delete_race",
      sessionId: "cs_test_family_delete_race",
      status: "open",
    });
    const completeSession = makeFamilyCheckoutSessionForAccountDeletionTest({
      attemptId: "family_checkout_attempt_race",
      customerId: "cus_family_delete_race",
      sessionId: "cs_test_family_delete_race",
      status: "complete",
      subscriptionId: "sub_family_delete_race",
    });
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(async () => {
            operationOrder.push("stripe:family-checkout-expire-raced");
            throw Object.assign(new Error("Checkout is no longer open"), {
              code: "checkout_session_not_open",
              statusCode: 400,
              type: "StripeInvalidRequestError",
            });
          }),
          retrieve: vi.fn()
            .mockResolvedValueOnce(openSession)
            .mockResolvedValueOnce(completeSession),
        },
      },
      customers: {
        del: vi.fn(async (customerId: string) => ({
          deleted: true,
          id: customerId,
        })),
        retrieve: vi.fn(async (customerId: string) =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId)),
      },
      subscriptions: {
        cancel: vi.fn(),
        retrieve: vi.fn(async () => ({
          id: "sub_family_delete_race",
          status: "canceled",
        })),
      },
    };
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
    serviceMocks.applyHostedFamilyStripeCheckoutCompletedTx.mockImplementation(
      async () => {
        operationOrder.push("family-checkout:canonical-bind");
        return { groupId: "family_group_123" };
      },
    );
    serviceMocks.executeHostedCheckoutSubscriptionCleanup.mockImplementation(
      async () => {
        operationOrder.push("family-checkout:cancel-refund");
      },
    );
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      familyBillingRefRecordReads: [
        familyAttemptBillingRef,
        familyAcceptedBillingRef,
      ],
      familyGroups: [{ id: "family_group_123" }],
      onTransaction: () => operationOrder.push("transaction"),
      operationOrder,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(2);
    expect(serviceMocks.applyHostedFamilyStripeCheckoutCompletedTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        dispatchContext: {
          eventCreatedAt: new Date(completeSession.created * 1_000),
        },
        session: completeSession,
      }));
    expect(serviceMocks.executeHostedCheckoutSubscriptionCleanup)
      .toHaveBeenCalledWith({
        candidate: {
          checkoutAttemptId: "family_checkout_attempt_race",
          checkoutIntentHash: null,
          checkoutSessionId: "cs_test_family_delete_race",
          familyBillingClaim: null,
          familyGroupId: "family_group_123",
          memberId: "member_123",
          reason: "family_account_deletion",
          stripeSubscriptionId: "sub_family_delete_race",
        },
        prisma,
        stripe,
      });
    expect(operationOrder.indexOf("family-checkout:canonical-bind"))
      .toBeLessThan(operationOrder.indexOf("family-checkout:cancel-refund"));
    expect(operationOrder.indexOf("family-checkout:cancel-refund"))
      .toBeLessThan(operationOrder.indexOf("delete:hostedAccountGroup"));
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(stripe.customers.del).toHaveBeenCalledWith(
      "cus_family_delete_race",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
  });

  it("clears an exact unbound owned Family Checkout after the deletion fence", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const familyBillingRefRecord = await makeFamilyBillingRefRowForTest({
      checkoutAttemptId: "family_checkout_attempt_binding_pending",
      groupId: "family_group_123",
      ownerMemberId: "member_123",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      familyBillingRefRecords: [familyBillingRefRecord],
      familyGroups: [{ id: "family_group_123" }],
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).resolves.toMatchObject({
      memberId: "member_123",
    });

    expect(deleteCalls.length).toBeGreaterThan(0);
    expect(serviceMocks.getHostedOnboardingStripe).not.toHaveBeenCalled();
  });

  it("cancels the Stripe subscription before local deletion and deletes vendor accounts after it", async () => {
    const order: string[] = [];
    const stripe = {
      customers: {
        del: vi.fn(async () => {
          order.push("stripe:customer-delete");
          return { deleted: true, id: "cus_delete_123" };
        }),
        retrieve: vi.fn(async (customerId: string) => {
          order.push("stripe:customer-balance-read");
          return makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId);
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
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    serviceMocks.closeHostedUsageCreditPurchasesForAccountDeletion.mockImplementation(
      async () => {
        order.push("usage-credit:close");
      },
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
      "stripe:customer-balance-read",
      "usage-credit:close",
      "prisma",
      "stripe:customer-balance-read",
      "stripe:customer-delete",
      "privy:user-delete",
    ]);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_delete_123");
    expect(stripe.customers.retrieve).toHaveBeenCalledWith(
      "cus_delete_123",
      {
        expand: ["cash_balance", "invoice_credit_balance"],
      },
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(stripe.customers.del).toHaveBeenCalledWith(
      "cus_delete_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(serviceMocks.deleteHostedPrivyUser).toHaveBeenCalledWith("privy-user-delete-123");
    expect(result.vendorAccounts).toEqual({
      privyUser: { errorCode: null, status: "completed" },
      stripeCustomer: { errorCode: null, status: "completed" },
      stripeSubscription: { errorCode: null, status: "completed" },
    });
  });

  it.each([
    ["credit", { balance: -500 }],
    ["debit", { balance: 500 }],
    ["currency credit", { invoice_credit_balance: { usd: -500 } }],
  ] as const)(
    "fails closed before local deletion when a Stripe Customer has a %s balance",
    async (_label, customerBalance) => {
      const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
      const operationOrder: string[] = [];
      const stripe = {
        customers: {
          del: vi.fn(),
          retrieve: vi.fn(async (customerId: string) => {
            operationOrder.push("stripe:customer-balance-read");
            return {
              ...makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId),
              ...customerBalance,
            };
          }),
        },
        subscriptions: {
          cancel: vi.fn(async () => {
            operationOrder.push("stripe:subscription-cancel");
            return { id: "sub_delete_123", status: "canceled" };
          }),
          retrieve: vi.fn(async () => ({
            id: "sub_delete_123",
            status: "active",
          })),
        },
      };
      serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
      const vendorRows = await makeVendorAccountRowsForTest("member_123");
      const prisma = createHostedAccountDeletionPrismaForTest({
        ...vendorRows,
        deleteCalls,
        onTransaction: () => undefined,
      });

      await expect(deleteHostedAccountData({
        memberId: "member_123",
        prisma,
        request: new Request("https://join.example.test/settings"),
      })).rejects.toMatchObject({
        code: "ACCOUNT_DELETION_STRIPE_CUSTOMER_BALANCE_REMAINS",
        retryable: false,
      });

      expect(stripe.customers.retrieve).toHaveBeenCalledWith(
        "cus_delete_123",
        {
          expand: ["cash_balance", "invoice_credit_balance"],
        },
        {
          maxNetworkRetries: 0,
          timeout: 5_000,
        },
      );
      expect(operationOrder).toEqual([
        "stripe:subscription-cancel",
        "stripe:customer-balance-read",
      ]);
      expect(deleteCalls).toEqual([]);
      expect(stripe.customers.del).not.toHaveBeenCalled();
      expect(
        serviceMocks.closeHostedUsageCreditPurchasesForAccountDeletion,
      ).not.toHaveBeenCalled();
      expect(serviceMocks.deleteHostedPrivyUser).not.toHaveBeenCalled();
    },
  );

  it("fails closed before local deletion when Stripe has created a Customer Cash Balance", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const stripe = {
      customers: {
        del: vi.fn(),
        retrieve: vi.fn(async (customerId: string) => ({
          ...makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId),
          cash_balance: {
            object: "cash_balance",
          },
        })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      deleteCalls,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_STRIPE_CUSTOMER_BALANCE_REMAINS",
      retryable: false,
    });

    expect(stripe.customers.retrieve).toHaveBeenCalledWith(
      "cus_delete_123",
      {
        expand: ["cash_balance", "invoice_credit_balance"],
      },
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(deleteCalls).toEqual([]);
    expect(stripe.customers.del).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", "ACCOUNT_DELETION_STRIPE_CUSTOMER_STATE_INCONSISTENT"],
    ["unexpanded", "ACCOUNT_DELETION_STRIPE_CUSTOMER_BALANCE_REMAINS"],
  ] as const)(
    "fails closed when Stripe returns a %s requested Customer Cash Balance expansion",
    async (cashBalanceState, expectedCode) => {
      const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
      const customer: Record<string, unknown> = {
        ...makeZeroBalanceStripeCustomerForAccountDeletionTest(
          "cus_delete_123",
        ),
      };
      delete customer.cash_balance;
      if (cashBalanceState === "unexpanded") {
        customer.cash_balance = "cb_unexpanded";
      }
      const stripe = {
        customers: {
          del: vi.fn(),
          retrieve: vi.fn(async () => customer),
        },
      };
      serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
      const vendorRows = await makeVendorAccountRowsForTest("member_123", {
        stripeSubscriptionId: null,
      });
      const prisma = createHostedAccountDeletionPrismaForTest({
        ...vendorRows,
        deleteCalls,
        onTransaction: () => undefined,
      });

      await expect(deleteHostedAccountData({
        memberId: "member_123",
        prisma,
        request: new Request("https://join.example.test/settings"),
      })).rejects.toMatchObject({
        code: expectedCode,
        retryable: false,
      });

      expect(deleteCalls).toEqual([]);
      expect(stripe.customers.del).not.toHaveBeenCalled();
    },
  );

  it("fails closed before local deletion when a Stripe Customer still has a live subscription", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const stripe = {
      customers: {
        del: vi.fn(),
        retrieve: vi.fn(async (customerId: string) =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId)),
      },
      subscriptions: {
        list: vi.fn(async () => ({
          data: [{
            customer: "cus_delete_123",
            id: "sub_unexpected_live",
            status: "active",
          }],
          has_more: false,
          object: "list",
          url: "/v1/subscriptions",
        })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      deleteCalls,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_STRIPE_CUSTOMER_HAS_LIVE_BILLING",
      retryable: false,
    });

    expect(stripe.subscriptions.list).toHaveBeenCalledWith(
      {
        customer: "cus_delete_123",
        limit: 100,
        status: "all",
      },
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(deleteCalls).toEqual([]);
    expect(stripe.customers.del).not.toHaveBeenCalled();
    expect(
      serviceMocks.closeHostedUsageCreditPurchasesForAccountDeletion,
    ).not.toHaveBeenCalled();
  });

  it("fails closed when a Stripe Customer subscription listing exceeds the bounded page budget", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    let pageIndex = 0;
    const stripe = {
      customers: {
        del: vi.fn(),
        retrieve: vi.fn(async (customerId: string) =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId)),
      },
      subscriptions: {
        list: vi.fn(async () => {
          pageIndex += 1;
          return {
            data: [{
              customer: "cus_delete_123",
              id: `sub_canceled_${pageIndex}`,
              status: "canceled",
            }],
            has_more: true,
            object: "list",
            url: "/v1/subscriptions",
          };
        }),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      deleteCalls,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_STRIPE_CUSTOMER_SUBSCRIPTIONS_INCOMPLETE",
      retryable: true,
    });

    expect(stripe.subscriptions.list).toHaveBeenCalledTimes(10);
    expect(deleteCalls).toEqual([]);
    expect(stripe.customers.del).not.toHaveBeenCalled();
  });

  it("does not delete a Stripe Customer whose balance drifts after local deletion", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const stripe = {
      customers: {
        del: vi.fn(),
        retrieve: vi.fn()
          .mockResolvedValueOnce(
            makeZeroBalanceStripeCustomerForAccountDeletionTest(
              "cus_delete_123",
            ),
          )
          .mockResolvedValueOnce({
            ...makeZeroBalanceStripeCustomerForAccountDeletionTest(
              "cus_delete_123",
            ),
            balance: -500,
          }),
      },
      subscriptions: {
        list: vi.fn(async () => ({
          data: [],
          has_more: false,
          object: "list",
          url: "/v1/subscriptions",
        })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      deleteCalls,
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(deleteCalls.length).toBeGreaterThan(0);
    expect(stripe.customers.retrieve).toHaveBeenCalledTimes(2);
    expect(stripe.customers.del).not.toHaveBeenCalled();
    expect(result.vendorAccounts.stripeCustomer.status).toBe("failed");
  });

  it("does not delete a Stripe Customer whose Cash Balance appears after local deletion", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const stripe = {
      customers: {
        del: vi.fn(),
        retrieve: vi.fn()
          .mockResolvedValueOnce(
            makeZeroBalanceStripeCustomerForAccountDeletionTest(
              "cus_delete_123",
            ),
          )
          .mockResolvedValueOnce({
            ...makeZeroBalanceStripeCustomerForAccountDeletionTest(
              "cus_delete_123",
            ),
            cash_balance: {
              object: "cash_balance",
            },
          }),
      },
      subscriptions: {
        list: vi.fn(async () => ({
          data: [],
          has_more: false,
          object: "list",
          url: "/v1/subscriptions",
        })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      deleteCalls,
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(deleteCalls.length).toBeGreaterThan(0);
    expect(stripe.customers.retrieve).toHaveBeenNthCalledWith(
      1,
      "cus_delete_123",
      {
        expand: ["cash_balance", "invoice_credit_balance"],
      },
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(stripe.customers.retrieve).toHaveBeenNthCalledWith(
      2,
      "cus_delete_123",
      {
        expand: ["cash_balance", "invoice_credit_balance"],
      },
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(stripe.customers.del).not.toHaveBeenCalled();
    expect(result.vendorAccounts.stripeCustomer.status).toBe("failed");
  });

  it("does not delete a Stripe Customer whose subscription state drifts after local deletion", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const stripe = {
      customers: {
        del: vi.fn(),
        retrieve: vi.fn(async (customerId: string) =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId)),
      },
      subscriptions: {
        list: vi.fn()
          .mockResolvedValueOnce({
            data: [],
            has_more: false,
            object: "list",
            url: "/v1/subscriptions",
          })
          .mockResolvedValueOnce({
            data: [{
              customer: "cus_delete_123",
              id: "sub_late_live",
              status: "active",
            }],
            has_more: false,
            object: "list",
            url: "/v1/subscriptions",
          }),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      deleteCalls,
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(deleteCalls.length).toBeGreaterThan(0);
    expect(stripe.subscriptions.list).toHaveBeenCalledTimes(2);
    expect(stripe.customers.del).not.toHaveBeenCalled();
    expect(result.vendorAccounts.stripeCustomer.status).toBe("failed");
  });

  it.each([
    [
      "a different Customer",
      {
        cash_balance: null,
        balance: 0,
        id: "cus_delete_other",
        invoice_credit_balance: {},
      },
    ],
    [
      "an invalid balance",
      {
        cash_balance: null,
        balance: Number.NaN,
        id: "cus_delete_123",
        invoice_credit_balance: {},
      },
    ],
  ])("fails closed when Stripe returns %s during Customer balance validation", async (
    _label,
    customer,
  ) => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const stripe = {
      customers: {
        del: vi.fn(),
        retrieve: vi.fn(async () => customer),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      deleteCalls,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_STRIPE_CUSTOMER_STATE_INCONSISTENT",
      retryable: false,
    });

    expect(deleteCalls).toEqual([]);
    expect(stripe.customers.del).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a deterministic invalid request",
      Object.assign(new Error("Invalid Customer"), {
        code: "parameter_invalid_string",
        statusCode: 400,
        type: "StripeInvalidRequestError",
      }),
      "ACCOUNT_DELETION_STRIPE_CUSTOMER_PROVIDER_REJECTED",
      false,
    ],
    [
      "an ambiguous connection failure",
      Object.assign(new Error("Connection ended"), {
        code: "ETIMEDOUT",
        type: "StripeConnectionError",
      }),
      "ACCOUNT_DELETION_STRIPE_CUSTOMER_PROVIDER_UNAVAILABLE",
      true,
    ],
  ] as const)(
    "classifies %s while validating Stripe Customer balances",
    async (_label, providerError, expectedCode, expectedRetryable) => {
      const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
      const stripe = {
        customers: {
          del: vi.fn(),
          retrieve: vi.fn(async () => {
            throw providerError;
          }),
        },
      };
      serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
      const vendorRows = await makeVendorAccountRowsForTest("member_123", {
        stripeSubscriptionId: null,
      });
      const prisma = createHostedAccountDeletionPrismaForTest({
        ...vendorRows,
        deleteCalls,
        onTransaction: () => undefined,
      });

      await expect(deleteHostedAccountData({
        memberId: "member_123",
        prisma,
        request: new Request("https://join.example.test/settings"),
      })).rejects.toMatchObject({
        code: expectedCode,
        retryable: expectedRetryable,
      });

      expect(stripe.customers.retrieve).toHaveBeenCalledWith(
        "cus_delete_123",
        {
          expand: ["cash_balance", "invoice_credit_balance"],
        },
        {
          maxNetworkRetries: 0,
          timeout: 5_000,
        },
      );
      expect(deleteCalls).toEqual([]);
      expect(stripe.customers.del).not.toHaveBeenCalled();
    },
  );

  it("deletes direct and owned Family Stripe customers during account deletion", async () => {
    const stripe = {
      customers: {
        del: vi.fn(async (customerId: string) => ({
          deleted: true,
          id: customerId,
        })),
        retrieve: vi.fn(async (customerId: string) =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId)),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    serviceMocks.deleteHostedPrivyUser.mockImplementation(async () => true);
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const familyBillingRefRecord = await makeFamilyBillingRefRowForTest({
      groupId: "family_group_123",
      ownerMemberId: "member_123",
      stripeCustomerId: "cus_family_123",
      stripeSubscriptionId: "sub_family_123",
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      familyBillingRefRecords: [familyBillingRefRecord],
      familyGroups: [{ id: "family_group_123" }],
      onTransaction: () => undefined,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_delete_123");
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_family_123");
    expect(stripe.customers.retrieve).toHaveBeenCalledWith(
      "cus_delete_123",
      {
          expand: ["cash_balance", "invoice_credit_balance"],
      },
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(stripe.customers.retrieve).toHaveBeenCalledWith(
      "cus_family_123",
      {
          expand: ["cash_balance", "invoice_credit_balance"],
      },
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(stripe.customers.del).toHaveBeenCalledWith(
      "cus_delete_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(stripe.customers.del).toHaveBeenCalledWith(
      "cus_family_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(result.vendorAccounts.stripeCustomer).toEqual({
      errorCode: null,
      status: "completed",
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
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
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
    expect(
      serviceMocks.closeHostedUsageCreditPurchasesForAccountDeletion,
    ).not.toHaveBeenCalled();
    expect(stripe.customers.del).not.toHaveBeenCalled();
    expect(serviceMocks.deleteHostedPrivyUser).not.toHaveBeenCalled();
  });

  it("skips the cancel call when the Stripe subscription is already canceled", async () => {
    const stripe = {
      customers: {
        del: vi.fn(async () => ({ deleted: true, id: "cus_delete_123" })),
        retrieve: vi.fn(async (customerId: string) =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId)),
      },
      subscriptions: {
        cancel: vi.fn(),
        retrieve: vi.fn(async () => ({ id: "sub_delete_123", status: "canceled" })),
      },
    };
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
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
        retrieve: vi.fn(async (customerId: string) =>
          makeZeroBalanceStripeCustomerForAccountDeletionTest(customerId)),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ id: "sub_delete_123", status: "canceled" })),
        retrieve: vi.fn(async () => ({ id: "sub_delete_123", status: "active" })),
      },
    };
    installHostedAccountDeletionCustomerGateTestDouble(stripe);
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

  it("fails closed when a Customer reference exists but Stripe is not configured", async () => {
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(null);
    serviceMocks.deleteHostedPrivyUser.mockResolvedValue(false);
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeSubscriptionId: null,
    });
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      deleteCalls,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_STRIPE_NOT_CONFIGURED",
      retryable: false,
    });
    expect(deleteCalls).toEqual([]);
    expect(serviceMocks.deleteHostedPrivyUser).not.toHaveBeenCalled();
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

  it("suspends call creation, deletes provider calls, and rechecks authority before local deletion", async () => {
    const operationOrder: string[] = [];
    serviceMocks.deleteHostedPhoneCallsForAccountDeletion.mockImplementation(async () => {
      operationOrder.push("phone-call:delete-provider-data");
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

    expect(operationOrder.indexOf("phone-call:delete-provider-data")).toBeGreaterThan(
      operationOrder.indexOf("update:hostedMember"),
    );
    expect(operationOrder.indexOf("phone-call:assert-ready")).toBeGreaterThan(
      operationOrder.indexOf("transaction"),
    );
    expect(operationOrder.indexOf("phone-call:assert-ready")).toBeLessThan(
      operationOrder.indexOf("delete:hostedPhoneCall"),
    );
  });

  it("preserves local rows when provider call data cannot be deleted", async () => {
    const onTransaction = vi.fn();
    serviceMocks.deleteHostedPhoneCallsForAccountDeletion.mockRejectedValue(
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
  billingRefRecords?: readonly (Record<string, unknown> | null)[];
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
  familyBillingRefRecordReads?: readonly (Record<string, unknown> | null)[];
  familyGroups?: Array<{ id: string }>;
  ownedThreadContainerMemberIds?: string[];
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
  let billingRefReadIndex = 0;
  let familyBillingRefReadIndex = 0;
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
    hostedAccountGroupBillingRef: {
      ...makeDeleteDelegate("hostedAccountGroupBillingRef"),
      findUnique: async (args: { where: { groupId: string } }) =>
        input.familyBillingRefRecords?.find((record) =>
          record.groupId === args.where.groupId
        )
        ?? input.familyBillingRefRecordReads?.at(-1)
        ?? null,
      updateMany: async () => {
        input.operationOrder?.push("update:hostedAccountGroupBillingRef");
        return { count: 1 };
      },
    },
    hostedAccountGroup: {
      ...makeDeleteDelegate("hostedAccountGroup"),
      findMany: async () => input.familyGroups ?? [],
    },
    hostedConnectedAppConnectIntent: {
      ...makeDeleteDelegate("hostedConnectedAppConnectIntent"),
      findMany: async () => input.transactionConnectedAppConnectIntentRows ?? [],
    },
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
    hostedMemberBillingRef: {
      ...makeDeleteDelegate("hostedMemberBillingRef"),
      findUnique: async () =>
        input.billingRefRecords?.at(-1) ?? input.billingRefRecord ?? null,
      updateMany: async () => {
        input.operationOrder?.push("update:hostedMemberBillingRef");
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
      findMany: async () => input.familyGroups ?? [],
    },
    hostedAccountGroupBillingRef: {
      findUnique: async (args: { where: { groupId: string } }) => {
        if (
          input.familyBillingRefRecordReads
          && input.familyBillingRefRecordReads.length > 0
        ) {
          const index = Math.min(
            familyBillingRefReadIndex,
            input.familyBillingRefRecordReads.length - 1,
          );
          familyBillingRefReadIndex += 1;
          return input.familyBillingRefRecordReads[index] ?? null;
        }
        return input.familyBillingRefRecords?.find((record) =>
          record.groupId === args.where.groupId
        ) ?? null;
      },
    },
    hostedMember: {
      findUnique: async () => ({ id: "member_123" }),
    },
    hostedMemberBillingRef: {
      findUnique: async () => {
        input.operationOrder?.push("find:hostedMemberBillingRef");
        if (input.billingRefRecords && input.billingRefRecords.length > 0) {
          const index = Math.min(
            billingRefReadIndex,
            input.billingRefRecords.length - 1,
          );
          billingRefReadIndex += 1;
          return input.billingRefRecords[index] ?? null;
        }
        return input.billingRefRecord ?? null;
      },
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

function makeZeroBalanceStripeCustomerForAccountDeletionTest(
  id: string,
  metadata: Record<string, string> = {},
) {
  return {
    balance: 0,
    cash_balance: null,
    id,
    invoice_credit_balance: {},
    metadata,
  };
}

function installHostedAccountDeletionCustomerGateTestDouble(
  stripe: Record<string, unknown>,
): void {
  const subscriptions =
    typeof stripe.subscriptions === "object" && stripe.subscriptions !== null
      ? stripe.subscriptions as Record<string, unknown>
      : {};
  subscriptions.list ??= vi.fn(async () => ({
    data: [],
    has_more: false,
    object: "list",
    url: "/v1/subscriptions",
  }));
  stripe.subscriptions = subscriptions;
}

async function makeCheckoutAttemptBillingRefRowForTest(input: {
  attemptId?: string | null;
  customerId?: string | null;
  intentHash?: string | null;
  memberId: string;
  sessionId?: string | null;
  subscriptionId?: string | null;
}): Promise<Record<string, unknown>> {
  const privateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId: input.memberId,
    stripeCheckoutSessionId: input.sessionId ?? null,
    stripeCustomerId: input.customerId ?? null,
    stripeSubscriptionId: input.subscriptionId ?? null,
  });

  return {
    checkoutAttemptId: input.attemptId ?? null,
    checkoutCreatedAt: input.attemptId
      ? new Date("2026-07-25T20:00:00.000Z")
      : null,
    checkoutIntentHash: input.intentHash ?? null,
    currentBillingPhase: null,
    currentBillingPlanCode: null,
    currentCheckoutOffer: null,
    currentPeriodEnd: null,
    currentPeriodStart: null,
    currentTrialEndsAt: null,
    currentTrialStartedAt: null,
    lastStripeEventCreatedAt: null,
    memberId: input.memberId,
    pulseTrialPolicyVersion: null,
    pulseTrialRedeemedAt: null,
    scheduledBillingEffectiveAt: null,
    scheduledBillingPlanCode: null,
    ...privateColumns,
  };
}

function makeStandardCheckoutSessionForAccountDeletionTest(input: {
  attemptId: string;
  checkoutOffer?: "pulse_trial_7d" | "standard";
  customerId?: string | null;
  intentHash: string;
  sessionId: string;
  status: "complete" | "expired" | "open";
  subscriptionId?: string | null;
}) {
  return {
    client_reference_id: "member_123",
    created: 1_785_000_000,
    customer: input.customerId ?? null,
    id: input.sessionId,
    metadata: {
      checkoutAttemptId: input.attemptId,
      checkoutIntentHash: input.intentHash,
      checkoutOffer: input.checkoutOffer ?? "standard",
      memberId: "member_123",
    },
    mode: "subscription",
    status: input.status,
    subscription: input.subscriptionId ?? null,
  };
}

function makeFamilyCheckoutSessionForAccountDeletionTest(input: {
  attemptId: string;
  customerId?: string | null;
  groupId?: string;
  sessionId: string;
  status: "complete" | "expired" | "open";
  subscriptionId?: string | null;
}) {
  const groupId = input.groupId ?? "family_group_123";
  return {
    client_reference_id: groupId,
    created: 1_785_000_000,
    customer: input.customerId ?? null,
    id: input.sessionId,
    metadata: {
      accountGroupId: groupId,
      billingPlanCode: "launch_family_monthly",
      checkoutAttemptId: input.attemptId,
      kind: "hosted_family_plan",
      ownerMemberId: "member_123",
    },
    mode: "subscription",
    status: input.status,
    subscription: input.subscriptionId ?? null,
  };
}

async function makeFamilyBillingRefRowForTest(input: {
  checkoutAttemptId?: string | null;
  checkoutSessionId?: string | null;
  groupId: string;
  ownerMemberId: string;
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
      value: input.checkoutSessionId ?? null,
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
    checkoutAttemptId: input.checkoutAttemptId ?? null,
    checkoutCreatedAt: input.checkoutAttemptId
      ? new Date("2026-07-25T20:00:00.000Z")
      : null,
    checkoutSeatCount: input.checkoutAttemptId ? 3 : null,
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
    findMany: () => Promise<Array<{ id: string }>>;
  };
  hostedAccountGroupBillingRef: HostedAccountDeletionPrismaDeleteDelegate & {
    findUnique: (args: {
      where: { groupId: string };
    }) => Promise<Record<string, unknown> | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
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
  hostedMemberBillingRef: HostedAccountDeletionPrismaDeleteDelegate & {
    findUnique: () => Promise<Record<string, unknown> | null>;
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
