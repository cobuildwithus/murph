import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  acquireHostedPrivyPhoneTransferPhoneLocksTx: vi.fn(),
  assertHostedPrivyPhoneTransferSourceRetirementFenceTx: vi.fn(),
  buildHostedPrivySessionState: vi.fn(),
  connectedAppsClient: {
    deleteAccount: vi.fn(),
    disconnectAccount: vi.fn(),
    listAccounts: vi.fn(),
  },
  createComposioConnectedAppsClient: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  createHostedDeviceSyncRegistry: vi.fn(),
  createHostedDeviceSyncRegistryWithProviderConfigs: vi.fn(),
  deleteHostedPrivyUser: vi.fn(),
  deleteHostedRunnerUserDataBestEffort: vi.fn(),
  deleteMemberOwnedProviderSetupExternalStateForAccountDeletion: vi.fn(),
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx: vi.fn(),
  getHostedOnboardingStripe: vi.fn(),
  isHostedPulseTrialSubscriptionForKnownPolicy: vi.fn(),
  pendingHostedAccountDeletionCleanupResult: vi.fn(),
  persistHostedAccountDeletionCleanupTx: vi.fn(),
  prepareHostedAccountDeletionCleanup: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
  retrieveHostedPulseTrialCleanupTarget: vi.fn(),
  readHostedConnectedAppsConfig: vi.fn(),
  readHostedPrivyUserById: vi.fn(),
  reconcileHostedPrivyIdentityOnMemberTx: vi.fn(),
  runHostedAccountDeletionCleanup: vi.fn(),
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx: vi.fn(),
  closeHostedUsageCreditPurchasesForAccountDeletion: vi.fn(),
  assertHostedPhoneCallsReadyForAccountDeletionTx: vi.fn(),
  deleteHostedPhoneCallsForAccountDeletion: vi.fn(),
  terminateHostedUserRuntimeWorkflowBestEffort: vi.fn(),
  prepareHostedPrivyPhoneTransferSourceRetirementTx: vi.fn(),
  resolveDeviceProviderApplicationForConnection: vi.fn(),
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
  createHostedDeviceSyncRegistryWithProviderConfigs:
    serviceMocks.createHostedDeviceSyncRegistryWithProviderConfigs,
}));

vi.mock("@/src/lib/device-sync/provider-applications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/device-sync/provider-applications")>()),
  resolveDeviceProviderApplicationForConnection:
    serviceMocks.resolveDeviceProviderApplicationForConnection,
}));

vi.mock("@/src/lib/device-sync/provider-setup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/device-sync/provider-setup")>()),
  deleteMemberOwnedProviderSetupExternalStateForAccountDeletion:
    serviceMocks.deleteMemberOwnedProviderSetupExternalStateForAccountDeletion,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/privy")>()),
  deleteHostedPrivyUser: serviceMocks.deleteHostedPrivyUser,
  readHostedPrivyUserById: serviceMocks.readHostedPrivyUserById,
}));

vi.mock("@/src/lib/hosted-onboarding/privy-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/privy-user")>()),
  buildHostedPrivySessionState: serviceMocks.buildHostedPrivySessionState,
}));

vi.mock("@/src/lib/hosted-onboarding/member-channel-sync", () => ({
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx:
    serviceMocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  reconcileHostedPrivyIdentityOnMemberTx:
    serviceMocks.reconcileHostedPrivyIdentityOnMemberTx,
}));

vi.mock("@/src/lib/hosted-onboarding/privy-phone-transfer-retirement", () => ({
  HOSTED_PRIVY_PHONE_TRANSFER_RETIREMENT_TRANSACTION_OPTIONS: {
    maxWait: 5_000,
    timeout: 30_000,
  },
  acquireHostedPrivyPhoneTransferPhoneLocksTx:
    serviceMocks.acquireHostedPrivyPhoneTransferPhoneLocksTx,
  assertHostedPrivyPhoneTransferSourceRetirementFenceTx:
    serviceMocks.assertHostedPrivyPhoneTransferSourceRetirementFenceTx,
  prepareHostedPrivyPhoneTransferSourceRetirementTx:
    serviceMocks.prepareHostedPrivyPhoneTransferSourceRetirementTx,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/runtime")>()),
  getHostedOnboardingStripe: serviceMocks.getHostedOnboardingStripe,
  requireHostedStripeBillingPlanConfig:
    serviceMocks.requireHostedStripeBillingPlanConfig,
}));

vi.mock(
  "@/src/lib/hosted-onboarding/pulse-trial-subscription-cleanup",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/src/lib/hosted-onboarding/pulse-trial-subscription-cleanup")
    >()),
    isHostedPulseTrialSubscriptionForKnownPolicy:
      serviceMocks.isHostedPulseTrialSubscriptionForKnownPolicy,
    retrieveHostedPulseTrialCleanupTarget:
      serviceMocks.retrieveHostedPulseTrialCleanupTarget,
  }),
);

vi.mock("@/src/lib/hosted-onboarding/usage-credit-purchase-service", () => ({
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx:
    serviceMocks.assertHostedUsageCreditPurchasesReadyForAccountDeletionTx,
  closeHostedUsageCreditPurchasesForAccountDeletion:
    serviceMocks.closeHostedUsageCreditPurchasesForAccountDeletion,
}));

vi.mock("@/src/lib/hosted-privacy/account-deletion-cleanup", () => ({
  HOSTED_ACCOUNT_DELETION_IMMEDIATE_ATTEMPT_TIMEOUT_MS: 5_000,
  pendingHostedAccountDeletionCleanupResult:
    serviceMocks.pendingHostedAccountDeletionCleanupResult,
  persistHostedAccountDeletionCleanupTx:
    serviceMocks.persistHostedAccountDeletionCleanupTx,
  prepareHostedAccountDeletionCleanup:
    serviceMocks.prepareHostedAccountDeletionCleanup,
  runHostedAccountDeletionCleanup:
    serviceMocks.runHostedAccountDeletionCleanup,
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
import { DeviceProviderApplicationError } from "@/src/lib/device-sync/provider-applications";
import {
  HOSTED_PRODUCT_SUPPORT_ESCALATION_RECORD_SUMMARY,
} from "@/src/lib/hosted-execution/product-feedback";
import {
  buildHostedLinqInviteSignupEffectId,
  buildHostedLinqInviteSignupEffectIdMemberPrefix,
} from "@/src/lib/hosted-onboarding/linq-invite-signup-effect-id";
import { createHostedPrivyUserLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
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
  deleteHostedPrivyPhoneTransferSourceAccountData,
  HOSTED_ACCOUNT_DATA_STORE_COVERAGE,
  parseHostedAccountDeletionRequest,
} from "@/src/lib/hosted-privacy/account-data-service";

const REQUIRED_STORE_SLUGS = [
  "prisma.hosted_member",
  "prisma.hosted_inference_connection",
  "prisma.hosted_web_session",
  "prisma.hosted_sensitive_action_challenge",
  "prisma.hosted_member_identity",
  "prisma.hosted_address_book_projection",
  "prisma.hosted_address_book_contact",
  "prisma.hosted_member_routing",
  "prisma.hosted_pending_group_setup",
  "prisma.hosted_member_email_authorization",
  "prisma.hosted_member_billing_ref",
  "prisma.hosted_member_subscription_checkout",
  "prisma.hosted_account_deletion_cleanup",
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
  "postgres.hosted_runtime_log",
  "prisma.hosted_computer_run",
  "prisma.hosted_computer_handoff",
  "prisma.hosted_phone_call",
  "prisma.hosted_physical_note",
  "prisma.hosted_user_crypto_envelope",
  "prisma.hosted_user_crypto_audit",
  "prisma.hosted_ai_usage",
  "prisma.hosted_ai_usage_period",
  "prisma.hosted_growth_aggregate",
  "prisma.hosted_usage_credit_entry",
  "prisma.hosted_usage_credit_grant",
  "prisma.hosted_usage_referral",
  "prisma.hosted_usage_credit_purchase",
  "prisma.hosted_product_feedback",
  "prisma.hosted_linq_daily_state",
  "prisma.hosted_linq_invite_delivery",
  "prisma.hosted_invite",
  "prisma.hosted_consent_event",
  "prisma.hosted_consent_grant",
  "prisma.hosted_vault_share",
  "prisma.device_connection",
  "prisma.device_provider_application",
  "prisma.device_provider_setup",
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
  serviceMocks.acquireHostedPrivyPhoneTransferPhoneLocksTx.mockReset();
  serviceMocks.acquireHostedPrivyPhoneTransferPhoneLocksTx.mockResolvedValue(
    undefined,
  );
  serviceMocks.assertHostedPrivyPhoneTransferSourceRetirementFenceTx.mockReset();
  serviceMocks.assertHostedPrivyPhoneTransferSourceRetirementFenceTx.mockResolvedValue(
    undefined,
  );
  serviceMocks.buildHostedPrivySessionState.mockReset();
  serviceMocks.buildHostedPrivySessionState.mockReturnValue({
    identity: {
      phone: {
        number: "+15551234567",
        verifiedAt: new Date("2026-07-30T12:00:00.000Z"),
      },
      telegram: null,
      userId: "did:privy:target",
    },
    linkedAccounts: [{
      phoneNumber: "+15551234567",
      type: "phone",
      verifiedAt: "2026-07-30T12:00:00.000Z",
    }],
    verifiedPrivyUser: {
      id: "did:privy:target",
    },
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
  serviceMocks.createHostedDeviceSyncRegistryWithProviderConfigs.mockReset();
  serviceMocks.createHostedDeviceSyncRegistryWithProviderConfigs.mockReturnValue({
    get: vi.fn(() => null),
  });
  serviceMocks.resolveDeviceProviderApplicationForConnection.mockReset();
  serviceMocks.resolveDeviceProviderApplicationForConnection.mockResolvedValue(null);
  serviceMocks.deleteHostedPrivyUser.mockReset();
  serviceMocks.deleteHostedPrivyUser.mockResolvedValue(true);
  serviceMocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mockReset();
  serviceMocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mockResolvedValue({
    mailboxItemId: "mailbox_target",
  });
  serviceMocks.deleteHostedRunnerUserDataBestEffort.mockReset();
  serviceMocks.deleteHostedRunnerUserDataBestEffort.mockResolvedValue(makeCloudflareDeletionResult());
  serviceMocks.deleteMemberOwnedProviderSetupExternalStateForAccountDeletion.mockReset();
  serviceMocks.deleteMemberOwnedProviderSetupExternalStateForAccountDeletion.mockResolvedValue(
    undefined,
  );
  serviceMocks.getHostedOnboardingStripe.mockReset();
  serviceMocks.getHostedOnboardingStripe.mockReturnValue(null);
  serviceMocks.isHostedPulseTrialSubscriptionForKnownPolicy.mockReset();
  serviceMocks.isHostedPulseTrialSubscriptionForKnownPolicy.mockReturnValue(
    true,
  );
  serviceMocks.requireHostedStripeBillingPlanConfig.mockReset();
  serviceMocks.retrieveHostedPulseTrialCleanupTarget.mockReset();
  serviceMocks.pendingHostedAccountDeletionCleanupResult.mockReset();
  serviceMocks.pendingHostedAccountDeletionCleanupResult.mockImplementation(
    (errorCode = "ACCOUNT_DELETION_CLEANUP_PENDING") => makeCleanupRunResult({
      cleanupPending: true,
      cloudflare: {
        ...makeCloudflareDeletionResult(),
        alarmCleared: null,
        configured: false,
        deleteAllCompleted: null,
        deleted: false,
        errorCode,
        r2DeletedObjectCount: null,
        r2SkippedUserScopedPrefixes: null,
        r2Supported: null,
        runnerStateDeleted: null,
      },
      privyUser: { errorCode, status: "failed" },
      stripeCustomer: { errorCode, status: "failed" },
    }),
  );
  serviceMocks.persistHostedAccountDeletionCleanupTx.mockReset();
  serviceMocks.persistHostedAccountDeletionCleanupTx.mockResolvedValue(undefined);
  serviceMocks.prepareHostedAccountDeletionCleanup.mockReset();
  serviceMocks.prepareHostedAccountDeletionCleanup.mockImplementation(async (input) => ({
    cloudflareCompletedAt: null,
    environment: "test",
    id: "cleanup_123",
    kmsKeyName: "test-key",
    nextAttemptAt: input.now,
    payloadCiphertext: "encrypted",
    privyCompletedAt: null,
    privyUserLookupKey: createHostedPrivyUserLookupKey(input.privyUserId),
    runtimeMemberIds: [...input.runtimeMemberIds],
    stripeCustomerIds: [...input.stripeCustomerIds],
    stripeCompletedAt: null,
    stripeSubscriptionIds: [...(input.stripeSubscriptionIds ?? [])],
  }));
  serviceMocks.runHostedAccountDeletionCleanup.mockReset();
  serviceMocks.runHostedAccountDeletionCleanup.mockResolvedValue(makeCleanupRunResult());
  serviceMocks.readHostedConnectedAppsConfig.mockReset();
  serviceMocks.readHostedConnectedAppsConfig.mockReturnValue({
    apiKey: "secret-test-key",
    baseUrl: "https://backend.composio.test",
    maxAccountsPerToolkit: 5,
    toolkits: ["gmail", "googlecalendar"],
  });
  serviceMocks.readHostedPrivyUserById.mockReset();
  serviceMocks.readHostedPrivyUserById.mockResolvedValue({
    id: "did:privy:target",
  });
  serviceMocks.reconcileHostedPrivyIdentityOnMemberTx.mockReset();
  serviceMocks.reconcileHostedPrivyIdentityOnMemberTx.mockResolvedValue(undefined);
  serviceMocks.prepareHostedPrivyPhoneTransferSourceRetirementTx.mockReset();
  serviceMocks.prepareHostedPrivyPhoneTransferSourceRetirementTx.mockResolvedValue({
    autoTrialBilling: null,
    sourceMemberId: "member_123",
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
    const aggregate = bySlug.get("prisma.hosted_growth_aggregate");
    const entry = bySlug.get("prisma.hosted_usage_credit_entry");
    const purchase = bySlug.get("prisma.hosted_usage_credit_purchase");

    expect(aggregate?.deletion).toBe("documented-retention");
    expect(aggregate?.note).toContain("unjoinable");
    expect(aggregate?.note).toContain("tracker cutover");
    expect(aggregate?.note).toContain("account deletion");
    expect(entry?.note).toContain("browser-vault export omits");
    expect(entry?.note).toContain("semantic source keys");
    expect(purchase?.note).toContain("browser-vault export omits");
    expect(purchase?.note).toContain("payment identifiers");
    expect(purchase?.note).toContain("Stripe retains records it is legally required to keep");
  });
});

function makeExactPhoneTransferStripeSubscription(
  overrides: Record<string, unknown> = {},
) {
  return {
    cancel_at: null,
    cancel_at_period_end: false,
    collection_method: "charge_automatically",
    customer: {
      default_source: null,
      deleted: false,
      id: "cus_delete_123",
      invoice_settings: {
        default_payment_method: null,
      },
      object: "customer",
    },
    default_payment_method: null,
    default_source: null,
    ended_at: null,
    id: "sub_delete_123",
    pause_collection: null,
    pending_invoice_item_interval: null,
    pending_setup_intent: null,
    pending_update: null,
    schedule: null,
    status: "trialing",
    trial_end: 2_000_000_000,
    trial_settings: {
      end_behavior: {
        missing_payment_method: "pause",
      },
    },
    ...overrides,
  };
}


describe("deleteHostedAccountData", () => {
  it("atomically retires the transfer source after cleanup-owned billing changes", async () => {
    const order: string[] = [];
    let billingCleanupCompleted = false;
    serviceMocks.readHostedPrivyUserById.mockImplementation(async () => {
      order.push("privy:read");
      return { id: "did:privy:target" };
    });
    serviceMocks.prepareHostedPrivyPhoneTransferSourceRetirementTx.mockImplementation(
      async () => {
        expect(billingCleanupCompleted).toBe(false);
        order.push("transfer:recheck");
        return {
          autoTrialBilling: {
            stripeCustomerId: "cus_delete_123",
            stripeSubscriptionId: "sub_delete_123",
          },
          sourceMemberId: "member_123",
        };
      },
    );
    serviceMocks.assertHostedPrivyPhoneTransferSourceRetirementFenceTx.mockImplementation(
      async () => {
        expect(billingCleanupCompleted).toBe(true);
        order.push("transfer:fence");
      },
    );
    serviceMocks.acquireHostedPrivyPhoneTransferPhoneLocksTx.mockImplementation(
      async () => {
        order.push("transfer:phone-locks");
      },
    );
    const stripe = {
      subscriptions: {
        cancel: vi.fn(async () => {
          billingCleanupCompleted = true;
          order.push("stripe:subscription-cancel");
          return makeExactPhoneTransferStripeSubscription({
            ended_at: 1_900_000_000,
            pending_setup_intent: "seti_trial_123",
            status: "canceled",
          });
        }),
      },
    };
    serviceMocks.requireHostedStripeBillingPlanConfig.mockReturnValue({
      priceId: "price_launch_monthly",
      stripe,
    });
    // Stripe attaches a pending SetupIntent to every automatic-collection
    // trial without a payment method; the unused-surface check must accept it.
    serviceMocks.retrieveHostedPulseTrialCleanupTarget.mockResolvedValue(
      makeExactPhoneTransferStripeSubscription({
        pending_setup_intent: "seti_trial_123",
      }),
    );
    serviceMocks.persistHostedAccountDeletionCleanupTx.mockImplementation(async () => {
      order.push("persist:cleanup");
    });
    serviceMocks.reconcileHostedPrivyIdentityOnMemberTx.mockImplementation(async () => {
      order.push("target:reconcile");
    });
    serviceMocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mockImplementation(
      async () => {
        order.push("target:enqueue");
        return { mailboxItemId: "mailbox_target" };
      },
    );
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => order.push("prisma"),
      operationOrder: order,
    });

    const result = await deleteHostedPrivyPhoneTransferSourceAccountData({
      prisma,
      request: new Request("https://join.example.test/settings"),
      retirement: {
        autoTrialBilling: {
          stripeCustomerId: "cus_delete_123",
          stripeSubscriptionId: "sub_delete_123",
        },
        sourceMemberId: "member_123",
      },
      targetMember: {
        billingStatus: "active",
        createdAt: new Date("2026-07-30T12:00:00.000Z"),
        id: "member_target",
        suspendedAt: null,
        updatedAt: new Date("2026-07-30T12:00:00.000Z"),
      },
      targetPhoneNumberBeforeTransfer: null,
      targetPrivyUserId: "did:privy:target",
      transfer: {
        phoneNumber: "+15551234567",
        sourceMemberId: "member_123",
        sourcePrivyUserId: "did:privy:source",
      },
    });

    const finalTransactionStart = order.lastIndexOf("prisma");
    const finalTransactionOrder = order.slice(finalTransactionStart + 1);
    expect(order.indexOf("privy:read")).toBeGreaterThan(order.indexOf("prisma"));
    expect(order.lastIndexOf("privy:read")).toBeLessThan(finalTransactionStart);
    expect(order.indexOf("transfer:recheck")).toBeLessThan(
      order.indexOf("stripe:subscription-cancel"),
    );
    expect(
      serviceMocks.retrieveHostedPulseTrialCleanupTarget,
    ).toHaveBeenCalledWith({
      expandCustomer: true,
      expectedCustomerId: "cus_delete_123",
      memberId: "member_123",
      priceId: "price_launch_monthly",
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
      stripe,
      subscriptionId: "sub_delete_123",
    });
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_delete_123",
      { expand: ["customer"] },
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(order.indexOf("stripe:subscription-cancel")).toBeLessThan(
      finalTransactionStart,
    );
    expect(finalTransactionOrder.slice(0, 5)).toEqual([
      "transfer:phone-locks",
      "queryRaw",
      "queryRaw:member_123",
      "queryRaw",
      "queryRaw:member_target",
    ]);
    expect(finalTransactionOrder.indexOf("transfer:fence")).toBeGreaterThan(
      finalTransactionOrder.indexOf("queryRaw:member_target"),
    );
    expect(finalTransactionOrder.indexOf("persist:cleanup")).toBeLessThan(
      finalTransactionOrder.indexOf("delete:hostedMember"),
    );
    expect(finalTransactionOrder.indexOf("delete:hostedMember")).toBeLessThan(
      finalTransactionOrder.indexOf("target:reconcile"),
    );
    expect(finalTransactionOrder.indexOf("target:reconcile")).toBeLessThan(
      finalTransactionOrder.indexOf("target:enqueue"),
    );
    expect(result.channelSyncDispatch).toEqual({
      mailboxItemId: "mailbox_target",
    });
  });

  it.each([
    [
      "active",
      makeExactPhoneTransferStripeSubscription({ status: "active" }),
      undefined,
    ],
    [
      "past due",
      makeExactPhoneTransferStripeSubscription({ status: "past_due" }),
      undefined,
    ],
    [
      "unpaid",
      makeExactPhoneTransferStripeSubscription({ status: "unpaid" }),
      undefined,
    ],
    [
      "paused",
      makeExactPhoneTransferStripeSubscription({ status: "paused" }),
      undefined,
    ],
    [
      "incomplete",
      makeExactPhoneTransferStripeSubscription({ status: "incomplete" }),
      undefined,
    ],
    [
      "trialing without an end",
      makeExactPhoneTransferStripeSubscription({ trial_end: null }),
      undefined,
    ],
    [
      "trialing at the cancellation boundary",
      makeExactPhoneTransferStripeSubscription({
        trial_end: Math.floor(Date.now() / 1_000) + 10,
      }),
      undefined,
    ],
    [
      "card-backed",
      makeExactPhoneTransferStripeSubscription({
        default_payment_method: "pm_continue_123",
      }),
      undefined,
    ],
    [
      "configured for manual invoicing",
      makeExactPhoneTransferStripeSubscription({
        collection_method: "send_invoice",
      }),
      undefined,
    ],
    [
      "scheduled for another mutation",
      makeExactPhoneTransferStripeSubscription({
        schedule: "sub_sched_123",
      }),
      undefined,
    ],
    [
      "canceled after the trial",
      makeExactPhoneTransferStripeSubscription({
        ended_at: 2_000_000_000,
        status: "canceled",
        trial_end: 1_900_000_000,
      }),
      undefined,
    ],
    ["mismatched provider authority", null, undefined],
    [
      "missing local subscription authority",
      makeExactPhoneTransferStripeSubscription(),
      null,
    ],
    [
      "different local subscription authority",
      makeExactPhoneTransferStripeSubscription(),
      "sub_other",
    ],
  ] as const)(
    "does not cancel or retire a transfer source that is %s",
    async (_label, subscription, localSubscriptionId) => {
      const operationOrder: string[] = [];
      const cancel = vi.fn();
      const stripe = {
        subscriptions: {
          cancel,
        },
      };
      serviceMocks.prepareHostedPrivyPhoneTransferSourceRetirementTx.mockResolvedValue({
        autoTrialBilling: {
          stripeCustomerId: "cus_delete_123",
          stripeSubscriptionId: "sub_delete_123",
        },
        sourceMemberId: "member_123",
      });
      serviceMocks.requireHostedStripeBillingPlanConfig.mockReturnValue({
        priceId: "price_launch_monthly",
        stripe,
      });
      if (subscription === null) {
        serviceMocks.retrieveHostedPulseTrialCleanupTarget.mockRejectedValue(
          new HostedOnboardingError({
            code: "HOSTED_PULSE_TRIAL_CLEANUP_TARGET_CHANGED",
            httpStatus: 409,
            message: "Trial authority changed.",
            retryable: true,
          }),
        );
      } else {
        serviceMocks.retrieveHostedPulseTrialCleanupTarget.mockResolvedValue(
          subscription,
        );
      }
      const vendorRows = await makeVendorAccountRowsForTest(
        "member_123",
        localSubscriptionId === undefined
          ? undefined
          : { stripeSubscriptionId: localSubscriptionId },
      );
      const prisma = createHostedAccountDeletionPrismaForTest({
        ...vendorRows,
        onTransaction: () => undefined,
        operationOrder,
      });

      await expect(deleteHostedPrivyPhoneTransferSourceAccountData({
        prisma,
        request: new Request("https://join.example.test/settings"),
        retirement: {
          autoTrialBilling: {
            stripeCustomerId: "cus_delete_123",
            stripeSubscriptionId: "sub_delete_123",
          },
          sourceMemberId: "member_123",
        },
        targetMember: {
          billingStatus: "active",
          createdAt: new Date("2026-07-30T12:00:00.000Z"),
          id: "member_target",
          suspendedAt: null,
          updatedAt: new Date("2026-07-30T12:00:00.000Z"),
        },
        targetPhoneNumberBeforeTransfer: null,
        targetPrivyUserId: "did:privy:target",
        transfer: {
          phoneNumber: "+15551234567",
          sourceMemberId: "member_123",
          sourcePrivyUserId: "did:privy:source",
        },
      })).rejects.toMatchObject({
        code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
      });

      expect(cancel).not.toHaveBeenCalled();
      expect(operationOrder).not.toContain("delete:hostedMember");
      expect(
        serviceMocks.reconcileHostedPrivyIdentityOnMemberTx,
      ).not.toHaveBeenCalled();
      expect(
        serviceMocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
      ).not.toHaveBeenCalled();
      if (localSubscriptionId !== undefined) {
        expect(
          serviceMocks.retrieveHostedPulseTrialCleanupTarget,
        ).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    [
      "a different subscription",
      makeExactPhoneTransferStripeSubscription({
        ended_at: 1_900_000_000,
        id: "sub_changed_123",
        status: "canceled",
      }),
    ],
    [
      "new payment authority",
      makeExactPhoneTransferStripeSubscription({
        default_payment_method: "pm_changed_123",
        ended_at: 1_900_000_000,
        status: "canceled",
      }),
    ],
    [
      "manual invoice authority",
      makeExactPhoneTransferStripeSubscription({
        collection_method: "send_invoice",
        ended_at: 1_900_000_000,
        status: "canceled",
      }),
    ],
    [
      "a cancellation after the trial",
      makeExactPhoneTransferStripeSubscription({
        ended_at: 2_000_000_000,
        status: "canceled",
        trial_end: 1_900_000_000,
      }),
    ],
  ] as const)(
    "does not retire the source when cancellation returns %s",
    async (_label, canceledSubscription) => {
      const operationOrder: string[] = [];
      const cancel = vi.fn().mockResolvedValue(canceledSubscription);
      const stripe = {
        subscriptions: {
          cancel,
        },
      };
      serviceMocks.prepareHostedPrivyPhoneTransferSourceRetirementTx.mockResolvedValue({
        autoTrialBilling: {
          stripeCustomerId: "cus_delete_123",
          stripeSubscriptionId: "sub_delete_123",
        },
        sourceMemberId: "member_123",
      });
      serviceMocks.requireHostedStripeBillingPlanConfig.mockReturnValue({
        priceId: "price_launch_monthly",
        stripe,
      });
      serviceMocks.retrieveHostedPulseTrialCleanupTarget.mockResolvedValue(
        makeExactPhoneTransferStripeSubscription(),
      );
      const vendorRows = await makeVendorAccountRowsForTest("member_123");
      const prisma = createHostedAccountDeletionPrismaForTest({
        ...vendorRows,
        onTransaction: () => undefined,
        operationOrder,
      });

      await expect(deleteHostedPrivyPhoneTransferSourceAccountData({
        prisma,
        request: new Request("https://join.example.test/settings"),
        retirement: {
          autoTrialBilling: {
            stripeCustomerId: "cus_delete_123",
            stripeSubscriptionId: "sub_delete_123",
          },
          sourceMemberId: "member_123",
        },
        targetMember: {
          billingStatus: "active",
          createdAt: new Date("2026-07-30T12:00:00.000Z"),
          id: "member_target",
          suspendedAt: null,
          updatedAt: new Date("2026-07-30T12:00:00.000Z"),
        },
        targetPhoneNumberBeforeTransfer: null,
        targetPrivyUserId: "did:privy:target",
        transfer: {
          phoneNumber: "+15551234567",
          sourceMemberId: "member_123",
          sourcePrivyUserId: "did:privy:source",
        },
      })).rejects.toMatchObject({
        code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
      });

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(operationOrder).not.toContain("delete:hostedMember");
      expect(
        serviceMocks.reconcileHostedPrivyIdentityOnMemberTx,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "canceled",
      makeExactPhoneTransferStripeSubscription({
        ended_at: 1_900_000_000,
        status: "canceled",
      }),
    ],
    [
      "incomplete_expired",
      makeExactPhoneTransferStripeSubscription({
        status: "incomplete_expired",
      }),
    ],
  ] as const)(
    "retires an exact transfer source whose trial is already %s without recanceling",
    async (_status, subscription) => {
      const operationOrder: string[] = [];
      const cancel = vi.fn();
      const stripe = {
        subscriptions: {
          cancel,
        },
      };
      serviceMocks.prepareHostedPrivyPhoneTransferSourceRetirementTx.mockResolvedValue({
        autoTrialBilling: {
          stripeCustomerId: "cus_delete_123",
          stripeSubscriptionId: "sub_delete_123",
        },
        sourceMemberId: "member_123",
      });
      serviceMocks.requireHostedStripeBillingPlanConfig.mockReturnValue({
        priceId: "price_launch_monthly",
        stripe,
      });
      serviceMocks.retrieveHostedPulseTrialCleanupTarget.mockResolvedValue(
        subscription,
      );
      const vendorRows = await makeVendorAccountRowsForTest("member_123");
      const prisma = createHostedAccountDeletionPrismaForTest({
        ...vendorRows,
        onTransaction: () => undefined,
        operationOrder,
      });

      const result = await deleteHostedPrivyPhoneTransferSourceAccountData({
        prisma,
        request: new Request("https://join.example.test/settings"),
        retirement: {
          autoTrialBilling: {
            stripeCustomerId: "cus_delete_123",
            stripeSubscriptionId: "sub_delete_123",
          },
          sourceMemberId: "member_123",
        },
        targetMember: {
          billingStatus: "active",
          createdAt: new Date("2026-07-30T12:00:00.000Z"),
          id: "member_target",
          suspendedAt: null,
          updatedAt: new Date("2026-07-30T12:00:00.000Z"),
        },
        targetPhoneNumberBeforeTransfer: null,
        targetPrivyUserId: "did:privy:target",
        transfer: {
          phoneNumber: "+15551234567",
          sourceMemberId: "member_123",
          sourcePrivyUserId: "did:privy:source",
        },
      });

      expect(cancel).not.toHaveBeenCalled();
      expect(operationOrder).toContain("delete:hostedMember");
      expect(
        serviceMocks.reconcileHostedPrivyIdentityOnMemberTx,
      ).toHaveBeenCalledTimes(1);
      expect(result.channelSyncDispatch).toEqual({
        mailboxItemId: "mailbox_target",
      });
    },
  );

  it("retries local retirement without recanceling an already canceled trial", async () => {
    const operationOrder: string[] = [];
    const cancel = vi.fn(async () => ({
      ...makeExactPhoneTransferStripeSubscription({
        ended_at: 1_900_000_000,
        status: "canceled",
      }),
    }));
    const stripe = {
      subscriptions: {
        cancel,
      },
    };
    serviceMocks.prepareHostedPrivyPhoneTransferSourceRetirementTx.mockResolvedValue({
      // The classifier preserves these exact identifiers when Stripe reports
      // canceled and the local billing phase has converged to null.
      autoTrialBilling: {
        stripeCustomerId: "cus_delete_123",
        stripeSubscriptionId: "sub_delete_123",
      },
      sourceMemberId: "member_123",
    });
    serviceMocks.requireHostedStripeBillingPlanConfig.mockReturnValue({
      priceId: "price_launch_monthly",
      stripe,
    });
    serviceMocks.retrieveHostedPulseTrialCleanupTarget
      .mockResolvedValueOnce(makeExactPhoneTransferStripeSubscription())
      .mockResolvedValueOnce(makeExactPhoneTransferStripeSubscription({
        ended_at: 1_900_000_000,
        status: "canceled",
      }));
    serviceMocks.closeHostedUsageCreditPurchasesForAccountDeletion
      .mockRejectedValueOnce(new Error("local cleanup failed"))
      .mockResolvedValue(undefined);
    const vendorRows = await makeVendorAccountRowsForTest("member_123");
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => undefined,
      operationOrder,
    });
    const input = {
      prisma,
      request: new Request("https://join.example.test/settings"),
      retirement: {
        autoTrialBilling: {
          stripeCustomerId: "cus_delete_123",
          stripeSubscriptionId: "sub_delete_123",
        },
        sourceMemberId: "member_123",
      },
      targetMember: {
        billingStatus: "active" as const,
        createdAt: new Date("2026-07-30T12:00:00.000Z"),
        id: "member_target",
        suspendedAt: null,
        updatedAt: new Date("2026-07-30T12:00:00.000Z"),
      },
      targetPhoneNumberBeforeTransfer: null,
      targetPrivyUserId: "did:privy:target",
      transfer: {
        phoneNumber: "+15551234567",
        sourceMemberId: "member_123",
        sourcePrivyUserId: "did:privy:source",
      },
    };

    await expect(
      deleteHostedPrivyPhoneTransferSourceAccountData(input),
    ).rejects.toThrow("local cleanup failed");

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(operationOrder).not.toContain("delete:hostedMember");
    expect(
      serviceMocks.reconcileHostedPrivyIdentityOnMemberTx,
    ).not.toHaveBeenCalled();

    const retryVendorRows = await makeVendorAccountRowsForTest("member_123");
    const retryPrisma = createHostedAccountDeletionPrismaForTest({
      ...retryVendorRows,
      onTransaction: () => undefined,
      operationOrder,
    });
    const result = await deleteHostedPrivyPhoneTransferSourceAccountData({
      ...input,
      prisma: retryPrisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(
      serviceMocks.retrieveHostedPulseTrialCleanupTarget,
    ).toHaveBeenCalledTimes(2);
    expect(operationOrder).toContain("delete:hostedMember");
    expect(
      serviceMocks.reconcileHostedPrivyIdentityOnMemberTx,
    ).toHaveBeenCalledTimes(1);
    expect(result.channelSyncDispatch).toEqual({
      mailboxItemId: "mailbox_target",
    });
  });

  it("keeps the deletion fence when durable cleanup ownership cannot be prepared", async () => {
    const onTransaction = vi.fn();
    const hostedMemberUpdateCalls: unknown[] = [];
    serviceMocks.prepareHostedAccountDeletionCleanup.mockRejectedValue(
      new Error("kms unavailable"),
    );
    const prisma = createHostedAccountDeletionPrismaForTest({
      hostedMemberUpdateCalls,
      onTransaction,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_CLEANUP_OWNER_CREATE_FAILED",
      retryable: true,
    });

    expect(onTransaction).toHaveBeenCalledTimes(1);
    expect(hostedMemberUpdateCalls).toEqual([{
      data: {
        suspendedAt: expect.any(Date),
      },
      where: {
        id: "member_123",
      },
    }]);
    expect(serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort).not.toHaveBeenCalled();
  });

  it("persists cleanup ownership in the canonical deletion transaction before member removal", async () => {
    const order: string[] = [];
    serviceMocks.persistHostedAccountDeletionCleanupTx.mockImplementation(async () => {
      order.push("persist:cleanup");
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => undefined,
      operationOrder: order,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(order.indexOf("persist:cleanup")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("persist:cleanup")).toBeLessThan(
      order.indexOf("delete:hostedMember"),
    );
  });

  it("deletes the linked support marker while retaining its anonymous issue", async () => {
    const retainedIssue =
      "a relative named Rowan says their glucose sensor stopped syncing after a metformin change at the downtown clinic.";
    const productFeedbackRows = [
      {
        id: "product_feedback_linked",
        memberId: "member_123",
        summary: HOSTED_PRODUCT_SUPPORT_ESCALATION_RECORD_SUMMARY,
      },
      {
        id: "product_feedback_detail",
        memberId: null,
        summary: retainedIssue,
      },
    ];
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
      productFeedbackRows,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(deleteCalls).toContainEqual({
      model: "hostedProductFeedback",
      where: {
        memberId: "member_123",
      },
    });
    expect(productFeedbackRows).toEqual([{
      id: "product_feedback_detail",
      memberId: null,
      summary: retainedIssue,
    }]);
  });

  it("commits the suspension fence before member-owned provider cleanup and terminates around local and Cloudflare cleanup", async () => {
    const order: string[] = [];
    const databaseOrder: string[] = [];
    serviceMocks.deleteMemberOwnedProviderSetupExternalStateForAccountDeletion.mockImplementation(
      async () => {
        order.push("provider-setup");
      },
    );
    serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort.mockImplementation(async () => {
      order.push("temporal");
      return {
        configured: true,
        errorCode: null,
        notFound: false,
        terminated: true,
      };
    });
    serviceMocks.runHostedAccountDeletionCleanup.mockImplementation(async () => {
      order.push("cloudflare");
      return makeCleanupRunResult();
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => order.push("prisma"),
      operationOrder: databaseOrder,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(order).toEqual([
      "prisma",
      "temporal",
      "provider-setup",
      "prisma",
      "temporal",
      "cloudflare",
      "temporal",
    ]);
    expect(databaseOrder.indexOf("findUnique:deviceProviderApplication")).toBeLessThan(
      databaseOrder.indexOf("update:hostedMember"),
    );
    expect(result.cloudflare.deleted).toBe(true);
    expect(
      serviceMocks.deleteMemberOwnedProviderSetupExternalStateForAccountDeletion,
    ).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
    expect(serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort).toHaveBeenNthCalledWith(
      1,
      {
        reason: "account-deleted",
        userId: "member_123",
      },
    );
    expect(serviceMocks.runHostedAccountDeletionCleanup).toHaveBeenCalledWith({
      attemptTimeoutMs: 5_000,
      cleanupId: "cleanup_123",
      prisma,
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

  it("preserves retryable local provider setup state when fenced external cleanup fails", async () => {
    const order: string[] = [];
    serviceMocks.deleteMemberOwnedProviderSetupExternalStateForAccountDeletion.mockImplementation(
      async () => {
        order.push("provider-setup");
        throw Object.assign(new Error("provider dashboard unavailable"), {
          code: "MEMBER_OWNED_PROVIDER_SETUP_DELETE_FAILED",
        });
      },
    );
    serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort.mockImplementation(async () => {
      order.push("temporal");
      return {
        configured: true,
        errorCode: null,
        notFound: false,
        terminated: true,
      };
    });
    const operationOrder: string[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => order.push("prisma"),
      operationOrder,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "MEMBER_OWNED_PROVIDER_SETUP_DELETE_FAILED",
    });

    expect(order.slice(0, 3)).toEqual(["prisma", "temporal", "provider-setup"]);
    expect(operationOrder).not.toContain("delete:deviceProviderSetup");
    expect(operationOrder).not.toContain("delete:deviceProviderApplication");
    expect(operationOrder).not.toContain("delete:hostedMember");
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

  it("deletes pending next-group setup before member routing", async () => {
    const operationOrder: string[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => undefined,
      operationOrder,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(operationOrder.indexOf("delete:hostedPendingGroupSetup"))
      .toBeLessThan(operationOrder.indexOf("delete:hostedMemberRouting"));
    expect(result.deletedCounts["prisma.hosted_pending_group_setup"]).toBe(1);
  });

  it("preempts a pending dispatch instead of stranding the deletion", async () => {
    // In-flight provider ownership is represented by delivery rows and crossed
    // by the shared drain. The outreach row itself must not strand deletion.
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      groupJoinOutreachPhoneLookupKeys: ["hbidx:phone:v1:participant"],
      groupJoinOutreachRows: [{
        id: "hgrpjoa_inflight",
      }],
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).resolves.toBeDefined();

    expect(deleteCalls.map((call) => call.model))
      .toContain("hostedGroupJoinOutreach");
  });

  it("deletes an owned group's outreach correlation before the group cascade hides it", async () => {
    // The delivery correlation is reachable only through the outreach id. If the
    // group cascade removed the outreach row first, the correlation would survive
    // both the group's deletion and the participant's later account deletion.
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      groupJoinOutreachOwnedGroupIds: ["hgrp_owned"],
      groupJoinOutreachRows: [{
        id: "hgrpjoa_owned",
      }],
      onTransaction: () => undefined,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(deleteCalls).toEqual(expect.arrayContaining([
      {
        model: "hostedLinqDelivery",
        where: {
          groupJoinOutreachId: { in: ["hgrpjoa_owned"] },
        },
      },
      {
        model: "hostedGroupJoinOutreach",
        where: { id: { in: ["hgrpjoa_owned"] } },
      },
    ]));

    const models = deleteCalls.map((call) => call.model);
    const outreachDeliveryIndex = deleteCalls.findIndex((call) =>
      call.model === "hostedLinqDelivery"
      && typeof call.where === "object"
      && call.where !== null
      && "groupJoinOutreachId" in call.where
    );
    expect(outreachDeliveryIndex)
      .toBeLessThan(models.indexOf("hostedGroupJoinOutreach"));
    expect(models.indexOf("hostedGroupJoinOutreach"))
      .toBeLessThan(models.indexOf("hostedGroup"));
  });

  it("locks an affected participant before the drain and reprojects its daily signup marker", async () => {
    const participantMemberId = "member_group_participant";
    const occurredAt = new Date("2026-07-27T14:00:00.000Z");
    const outreachId = "hgrpjoa_owned_projection";
    const sourceRef = buildHostedLinqInviteSignupEffectId({
      memberId: participantMemberId,
      occurredAt,
      sourceEventDigest: "a".repeat(32),
    });
    const dailyStateUpdates: unknown[] = [];
    const operationOrder: string[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      dailyStateUpdates,
      groupJoinDeliveryRows: [{ sourceRef }],
      groupJoinOutreachOwnedGroupIds: ["hgrp_owned_projection"],
      groupJoinOutreachRows: [{
        id: outreachId,
      }],
      liveSignupDeliveryRows: [],
      onTransaction: () => operationOrder.push("transaction"),
      operationOrder,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(operationOrder.indexOf(`queryRaw:${participantMemberId}`))
      .toBeGreaterThanOrEqual(0);
    expect(operationOrder.indexOf(`queryRaw:${participantMemberId}`))
      .toBeLessThan(operationOrder.lastIndexOf("executeRaw"));
    expect(dailyStateUpdates).toContainEqual({
      data: { onboardingLinkSentAt: null },
      where: {
        dayUtc: new Date("2026-07-27T00:00:00.000Z"),
        memberId: participantMemberId,
        onboardingLinkSentAt: { not: null },
      },
    });
  });

  it("deletes pre-member group-join outreach and its provider correlation", async () => {
    // The account is keyed by member id but this outreach is keyed by the
    // participant's phone blind index, so the deletion promise is only true if it
    // resolves that identity before removing the identity rows.
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      groupJoinOutreachPhoneLookupKeys: ["hbidx:phone:v1:participant"],
      groupJoinOutreachRows: [{
        id: "hgrpjoa_opaque",
      }],
      onTransaction: () => undefined,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(deleteCalls).toEqual(expect.arrayContaining([
      {
        model: "hostedGroupJoinOutreach",
        where: { id: { in: ["hgrpjoa_opaque"] } },
      },
      {
        model: "hostedLinqDelivery",
        where: {
          groupJoinOutreachId: { in: ["hgrpjoa_opaque"] },
        },
      },
    ]));

    const models = deleteCalls.map((call) => call.model);
    expect(models.indexOf("hostedGroupJoinOutreach"))
      .toBeLessThan(models.indexOf("hostedMemberIdentity"));
    // The registry must also declare the store, or the deletion report and the
    // Settings promise would omit data that was in fact removed.
    expect(HOSTED_ACCOUNT_DATA_STORE_COVERAGE.map((store) => store.slug))
      .toEqual(expect.arrayContaining([
        "prisma.hosted_group_join_outreach",
        "prisma.hosted_group_join_outreach_delivery",
      ]));
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

  it("deletes usage-credit entries and grants before source and member rows", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const updateCalls: HostedAccountDeletionPrismaUpdateCall[] = [];
    const operationOrder: string[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => operationOrder.push("transaction"),
      operationOrder,
      updateCalls,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(result.deletedCounts).toMatchObject({
      "prisma.hosted_usage_credit_entry": 1,
      "prisma.hosted_usage_credit_grant": 1,
      "prisma.hosted_usage_referral": 2,
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
        model: "hostedUsageCreditGrant",
        where: {
          entry: {
            OR: [
              { beneficiaryMemberId: "member_123" },
              {
                purchase: {
                  beneficiaryMemberId: "member_123",
                },
              },
            ],
          },
        },
      },
      {
        model: "hostedUsageReferral",
        where: {
          OR: [
            { beneficiaryMemberId: "member_123" },
            {
              AND: [
                {
                  OR: [
                    { beneficiaryMemberId: "member_123" },
                    { introducedMemberId: "member_123" },
                    { referrerMemberId: "member_123" },
                    { targetContainerMemberId: "member_123" },
                  ],
                },
                { status: { not: "rewarded" } },
              ],
            },
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
    expect(updateCalls).toContainEqual({
      data: {
        firstHumanMessageAt: null,
        humanMessageCount: 0,
        introducedMemberId: null,
        lastHumanMessageAt: null,
        nonReferrerMessageCount: 0,
        observedEventKeysJson: expect.anything(),
        observedSpeakerKeysJson: expect.anything(),
        referrerMemberId: null,
        referrerSubjectKey: null,
        sourceConversationJson: expect.anything(),
        targetContainerMemberId: null,
      },
      model: "hostedUsageReferral",
      where: {
        AND: [
          {
            OR: [
              { beneficiaryMemberId: "member_123" },
              { introducedMemberId: "member_123" },
              { referrerMemberId: "member_123" },
              { targetContainerMemberId: "member_123" },
            ],
          },
          { NOT: { beneficiaryMemberId: "member_123" } },
        ],
        status: "rewarded",
      },
    });
    expect(operationOrder.indexOf("delete:hostedUsageCreditGrant")).toBeLessThan(
      operationOrder.indexOf("delete:hostedUsageCreditEntry"),
    );
    expect(operationOrder.indexOf("delete:hostedUsageCreditEntry")).toBeLessThan(
      operationOrder.indexOf("delete:hostedUsageReferral"),
    );
    expect(operationOrder.indexOf("delete:hostedUsageReferral")).toBeLessThan(
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
    expect(serviceMocks.prepareHostedAccountDeletionCleanup).toHaveBeenCalledWith({
      now: expect.any(Date),
      privyUserId: null,
      runtimeMemberIds: ["member_123", "member_thread_container_123"],
      stripeCustomerIds: [],
      stripeSubscriptionIds: [],
    });
    expect(serviceMocks.terminateHostedUserRuntimeWorkflowBestEffort).toHaveBeenCalledWith({
      reason: "account-deleted",
      userId: "member_thread_container_123",
    });
    expect(deleteCalls).toEqual(expect.arrayContaining([
      {
        model: "hostedLinqDelivery",
        where: {
          groupJoinOutreachId: null,
          OR: [
            {
              sourceRef: {
                startsWith: buildHostedLinqInviteSignupEffectIdMemberPrefix(
                  "member_123",
                ),
              },
            },
            {
              sourceRef: {
                startsWith: buildHostedLinqInviteSignupEffectIdMemberPrefix(
                  "member_thread_container_123",
                ),
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

  it("aborts before the receipt when a thread container appears after the deletion fence", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
      transactionOwnedThreadContainerMemberIds: ["member_thread_container_late"],
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_RUNTIME_SET_CHANGED",
      retryable: true,
    });

    expect(serviceMocks.persistHostedAccountDeletionCleanupTx).not.toHaveBeenCalled();
    expect(deleteCalls).not.toContainEqual(expect.objectContaining({
      model: "hostedMember",
    }));
  });

  it("aborts before the receipt when provider ownership changes after preparation", async () => {
    serviceMocks.getHostedOnboardingStripe.mockReturnValue({
      subscriptions: {
        cancel: vi.fn(),
        retrieve: vi.fn().mockResolvedValue({ status: "canceled" }),
      },
    });
    const initialVendorRows = await makeVendorAccountRowsForTest("member_123");
    const changedVendorRows = await makeVendorAccountRowsForTest("member_123", {
      privyUserId: "privy-user-late",
      stripeCustomerId: "cus_late",
      stripeSubscriptionId: "sub_late",
    });
    const initialFamilyBillingRef = await makeFamilyBillingRefRowForTest({
      groupId: "family_group_123",
      ownerMemberId: "member_123",
      stripeCustomerId: "cus_family_initial",
      stripeSubscriptionId: "sub_family_initial",
    });
    const changedFamilyBillingRef = await makeFamilyBillingRefRowForTest({
      groupId: "family_group_123",
      ownerMemberId: "member_123",
      stripeCustomerId: "cus_family_late",
      stripeSubscriptionId: "sub_family_late",
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...initialVendorRows,
      familyBillingRefRecords: [initialFamilyBillingRef],
      familyGroups: [{ id: "family_group_123" }],
      onTransaction: () => undefined,
      transactionBillingRefRecord: changedVendorRows.billingRefRecord,
      transactionFamilyBillingRefRecords: [changedFamilyBillingRef],
      transactionIdentityRecord: changedVendorRows.identityRecord,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_EXTERNAL_TARGET_SET_CHANGED",
      retryable: true,
    });

    expect(serviceMocks.persistHostedAccountDeletionCleanupTx).not.toHaveBeenCalled();
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

  it("deletes referral invite claims owned by the introduced member", async () => {
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

    expect(result.deletedCounts["prisma.hosted_invite"]).toBe(1);
    expect(deleteCalls).toEqual(expect.arrayContaining([
      {
        model: "hostedInvite",
        where: {
          memberId: "member_123",
        },
      },
    ]));
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

  it("cancels subscriptions before local deletion and persists cleanup ownership before member deletion", async () => {
    const order: string[] = [];
    const stripe = {
      customers: { del: vi.fn() },
      subscriptions: {
        cancel: vi.fn(async () => {
          order.push("stripe:subscription-cancel");
          return { id: "sub_delete_123", status: "canceled" };
        }),
        retrieve: vi.fn(async () => ({ id: "sub_delete_123", status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    serviceMocks.closeHostedUsageCreditPurchasesForAccountDeletion.mockImplementation(
      async () => {
        order.push("usage-credit:close");
      },
    );
    serviceMocks.persistHostedAccountDeletionCleanupTx.mockImplementation(async () => {
      order.push("receipt:persist");
    });
    serviceMocks.runHostedAccountDeletionCleanup.mockImplementation(async () => {
      order.push("external-cleanup");
      return makeCleanupRunResult();
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
      "usage-credit:close",
      "prisma",
      "receipt:persist",
      "external-cleanup",
    ]);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_delete_123");
    expect(serviceMocks.prepareHostedAccountDeletionCleanup).toHaveBeenCalledWith({
      now: expect.any(Date),
      privyUserId: "privy-user-delete-123",
      runtimeMemberIds: ["member_123"],
      stripeCustomerIds: ["cus_delete_123"],
      stripeSubscriptionIds: ["sub_delete_123"],
    });
    expect(stripe.customers.del).not.toHaveBeenCalled();
    expect(result.vendorAccounts).toEqual({
      privyUser: { errorCode: null, status: "completed" },
      stripeCustomer: { errorCode: null, status: "completed" },
      stripeSubscription: { errorCode: null, status: "completed" },
    });
  });

  it("expires every open direct and Family subscription Checkout before canonical deletion", async () => {
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(async () => ({
            customer: "cus_delete_123",
            status: "expired",
            subscription: null,
          })),
          retrieve: vi.fn(async () => ({
            customer: "cus_delete_123",
            status: "open",
            subscription: null,
          })),
        },
      },
      customers: { del: vi.fn() },
      subscriptions: {
        cancel: vi.fn(),
        retrieve: vi.fn(),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeCheckoutSessionId: "cs_delete_123",
      stripeSubscriptionId: null,
    });
    const secondSessionIdEncrypted = await encryptHostedWebNullableString({
      field: "hosted-member-subscription-checkout.stripe-session-id",
      memberId: "member_123",
      value: "cs_delete_456",
    });
    if (!secondSessionIdEncrypted) {
      throw new TypeError("Expected encrypted Checkout session fixture.");
    }
    vendorRows.checkoutSessionRecords.push({
      memberId: "member_123",
      stripeCheckoutSessionIdEncrypted: secondSessionIdEncrypted,
    });
    const familyBillingRefRecord = await makeFamilyBillingRefRowForTest({
      groupId: "family_group_123",
      ownerMemberId: "member_123",
      stripeCheckoutSessionId: "cs_family_delete_789",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      familyBillingRefRecords: [familyBillingRefRecord],
      familyGroups: [{ id: "family_group_123" }],
      onTransaction: () => undefined,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_delete_123");
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_delete_456");
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_family_delete_789",
    );
    expect(serviceMocks.prepareHostedAccountDeletionCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeCustomerIds: ["cus_delete_123"],
      }),
    );
  });

  it("captures and cancels direct and Family subscriptions that complete while deletion fences Checkout", async () => {
    const stripe = {
      checkout: {
        sessions: {
          expire: vi.fn(),
          retrieve: vi.fn(async (sessionId: string) => sessionId === "cs_family_checkout_456"
            ? {
                customer: "cus_family_checkout_456",
                status: "complete",
                subscription: "sub_family_checkout_456",
              }
            : {
                customer: "cus_checkout_123",
                status: "complete",
                subscription: "sub_checkout_123",
              }),
        },
      },
      customers: { del: vi.fn() },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeCheckoutSessionId: "cs_delete_123",
      stripeSubscriptionId: null,
    });
    const familyBillingRefRecord = await makeFamilyBillingRefRowForTest({
      groupId: "family_group_123",
      ownerMemberId: "member_123",
      stripeCheckoutSessionId: "cs_family_checkout_456",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      familyBillingRefRecords: [familyBillingRefRecord],
      familyGroups: [{ id: "family_group_123" }],
      onTransaction: () => undefined,
    });

    await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_checkout_123");
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_family_checkout_456",
    );
    expect(serviceMocks.prepareHostedAccountDeletionCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeCustomerIds: [
          "cus_delete_123",
          "cus_checkout_123",
          "cus_family_checkout_456",
        ],
        stripeSubscriptionIds: [
          "sub_checkout_123",
          "sub_family_checkout_456",
        ],
      }),
    );
  });

  it("treats a confirmed-missing subscription Checkout as terminal", async () => {
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
      customers: { del: vi.fn() },
      subscriptions: {
        cancel: vi.fn(),
        retrieve: vi.fn(),
      },
    };
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(stripe);
    const vendorRows = await makeVendorAccountRowsForTest("member_123", {
      stripeCheckoutSessionId: "cs_missing_123",
      stripeSubscriptionId: null,
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      ...vendorRows,
      onTransaction: () => undefined,
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).resolves.toMatchObject({
      cleanupPending: false,
    });

    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
  });

  it("captures direct and owned Family customer IDs in one cleanup receipt", async () => {
    const stripe = {
      customers: {
        del: vi.fn(async () => ({ deleted: true })),
      },
      subscriptions: {
        cancel: vi.fn(async () => ({ status: "canceled" })),
        retrieve: vi.fn(async () => ({ status: "active" })),
      },
    };
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
    expect(serviceMocks.prepareHostedAccountDeletionCleanup).toHaveBeenCalledWith({
      now: expect.any(Date),
      privyUserId: "privy-user-delete-123",
      runtimeMemberIds: ["member_123"],
      stripeCustomerIds: ["cus_delete_123", "cus_family_123"],
      stripeSubscriptionIds: ["sub_delete_123", "sub_family_123"],
    });
    expect(stripe.customers.del).not.toHaveBeenCalled();
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
    serviceMocks.runHostedAccountDeletionCleanup.mockResolvedValue(
      makeCleanupRunResult({
        privyUser: { errorCode: null, status: "skipped_no_record" },
        stripeCustomer: { errorCode: null, status: "skipped_no_record" },
      }),
    );
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

  it("reports durable vendor cleanup as pending without failing committed deletion", async () => {
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
    serviceMocks.runHostedAccountDeletionCleanup.mockResolvedValue(
      makeCleanupRunResult({
        cleanupPending: true,
        privyUser: { errorCode: "PRIVY_UNAVAILABLE", status: "failed" },
        stripeCustomer: { errorCode: "STRIPE_UNAVAILABLE", status: "failed" },
      }),
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

    expect(result.vendorAccounts.stripeSubscription).toEqual({ errorCode: null, status: "completed" });
    expect(result.vendorAccounts.stripeCustomer.status).toBe("failed");
    expect(result.vendorAccounts.privyUser.status).toBe("failed");
    expect(result.cleanupPending).toBe(true);
  });

  it("degrades an immediate cleanup exception to durable pending after local deletion commits", async () => {
    const operationOrder: string[] = [];
    const cleanupError = Object.assign(new Error("kms unavailable"), {
      name: "KmsUnavailableError",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    serviceMocks.runHostedAccountDeletionCleanup.mockImplementation(async () => {
      operationOrder.push("cleanup");
      throw cleanupError;
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => operationOrder.push("transaction"),
      operationOrder,
    });

    try {
      const result = await deleteHostedAccountData({
        memberId: "member_123",
        prisma,
        request: new Request("https://join.example.test/settings"),
      });

      expect(operationOrder).toContain("delete:hostedMember");
      expect(operationOrder).toContain("cleanup");
      expect(operationOrder.indexOf("delete:hostedMember")).toBeLessThan(
        operationOrder.indexOf("cleanup"),
      );
      expect(serviceMocks.persistHostedAccountDeletionCleanupTx).toHaveBeenCalledTimes(1);
      expect(serviceMocks.pendingHostedAccountDeletionCleanupResult).toHaveBeenCalledWith(
        "KmsUnavailableError",
      );
      expect(result.cleanupPending).toBe(true);
      expect(result.vendorAccounts).toMatchObject({
        privyUser: { errorCode: "KmsUnavailableError", status: "failed" },
        stripeCustomer: { errorCode: "KmsUnavailableError", status: "failed" },
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("reports vendor deletions as not configured when the vendor clients are absent", async () => {
    serviceMocks.getHostedOnboardingStripe.mockReturnValue(null);
    serviceMocks.runHostedAccountDeletionCleanup.mockResolvedValue(
      makeCleanupRunResult({
        cleanupPending: true,
        privyUser: { errorCode: null, status: "skipped_not_configured" },
        stripeCustomer: { errorCode: null, status: "skipped_not_configured" },
      }),
    );
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

  it("records hosted physical-note rows before member deletion cascades them", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const operationOrder: string[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      countResults: { hostedPhysicalNote: 2 },
      deleteCalls,
      onTransaction: () => undefined,
      operationOrder,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(result.deletedCounts["prisma.hosted_physical_note"]).toBe(2);
    expect(operationOrder.indexOf("count:hostedPhysicalNote")).toBeLessThan(
      operationOrder.indexOf("delete:hostedMember"),
    );
    expect(deleteCalls).not.toContainEqual({
      model: "hostedPhysicalNote",
      where: expect.anything(),
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
    const suspensionDrainIndex = operationOrder.indexOf("executeRaw");
    const runCleanupIndex = operationOrder.indexOf("find:hostedComputerRun");
    const finalLockIndex = operationOrder.lastIndexOf("queryRaw");
    const runDeleteIndex = operationOrder.indexOf("delete:hostedComputerRun");
    expect(firstLockIndex).toBeGreaterThanOrEqual(0);
    expect(suspensionIndex).toBeGreaterThan(firstLockIndex);
    expect(suspensionDrainIndex).toBeGreaterThan(suspensionIndex);
    expect(runCleanupIndex).toBeGreaterThan(suspensionDrainIndex);
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
    const providerSetupIndex = deletedModels.indexOf("deviceProviderSetup");
    const providerApplicationIndex = deletedModels.indexOf("deviceProviderApplication");

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
    expect(providerSetupIndex).toBeGreaterThanOrEqual(0);
    expect(providerSetupIndex).toBeLessThan(connectionIndex);
    expect(providerApplicationIndex).toBeGreaterThan(connectionIndex);
    expect(result.deletedCounts["prisma.device_provider_setup"]).toBe(1);
    expect(result.deletedCounts["prisma.device_provider_application"]).toBe(1);
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
    serviceMocks.runHostedAccountDeletionCleanup.mockResolvedValue(
      makeCleanupRunResult({
        cleanupPending: true,
        cloudflare: {
          ...makeCloudflareDeletionResult(),
          deleted: false,
          r2SkippedUserScopedPrefixes: true,
          r2UserScopedSkipReason: "HostedUserCryptoRepairNeededError",
        },
      }),
    );
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
    expect(serviceMocks.runHostedAccountDeletionCleanup).toHaveBeenCalledWith({
      attemptTimeoutMs: 5_000,
      cleanupId: "cleanup_123",
      prisma,
    });
    expect(result.cleanupPending).toBe(true);
  });

  it("reports unconfigured Cloudflare cleanup after Prisma deletion commits", async () => {
    const order: string[] = [];
    serviceMocks.runHostedAccountDeletionCleanup.mockResolvedValue(
      makeCleanupRunResult({
        cleanupPending: true,
        cloudflare: {
          ...makeCloudflareDeletionResult(),
          alarmCleared: null,
          configured: false,
          deleteAllCompleted: null,
          deleted: false,
          r2DeletedObjectCount: null,
          r2SkippedUserScopedPrefixes: null,
          r2Supported: null,
          runnerStateDeleted: null,
        },
      }),
    );
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
    expect(result.cleanupPending).toBe(true);
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
    expect(serviceMocks.runHostedAccountDeletionCleanup).not.toHaveBeenCalled();
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

  it("revokes app-bound connections through their exact member-owned provider application", async () => {
    const revokeAccess = vi.fn();
    const providerConfigs = {
      strava: {
        clientId: "synthetic-member-strava-client-not-a-credential",
        clientSecret: "synthetic-member-strava-secret-not-a-credential",
      },
    };
    const storedAccount = {
      accessTokenExpiresAt: "2026-04-27T01:07:00.000Z",
      connectedAt: "2026-04-27T00:07:00.000Z",
      createdAt: "2026-04-27T00:07:00.000Z",
      credential: {
        kind: "oauth_tokens" as const,
        tokens: {
          accessToken: "access-token",
          accessTokenExpiresAt: "2026-04-27T01:07:00.000Z",
          refreshToken: "refresh-token",
        },
      },
      disconnectGeneration: 0,
      displayName: "Strava",
      externalAccountId: "strava-athlete-123",
      id: "dsc_strava",
      keyVersion: "key-v1",
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: null,
      metadata: {},
      nextReconcileAt: null,
      provider: "strava",
      scopes: ["read", "activity:read_all"],
      setupExpiresAt: null,
      setupPhase: null,
      status: "active" as const,
      tokenVersion: 1,
      updatedAt: "2026-04-27T00:07:00.000Z",
    };
    const prisma = createHostedAccountDeletionPrismaForTest({
      deviceConnections: [{
        id: "dsc_strava",
        provider: "strava",
        providerAccountBlindIndex: "blind-index",
      }],
      onTransaction: () => undefined,
    });
    serviceMocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      store: {
        getStoredConnectionAccountForUser: vi.fn(async () => storedAccount),
        prisma,
      },
    });
    serviceMocks.resolveDeviceProviderApplicationForConnection.mockResolvedValue({
      applicationId: "dpa_strava",
      provider: "strava",
      providerConfigs,
      revision: 3,
    });
    serviceMocks.createHostedDeviceSyncRegistryWithProviderConfigs.mockReturnValue({
      get: vi.fn(() => ({ connectionHandler: { revokeAccess } })),
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(serviceMocks.resolveDeviceProviderApplicationForConnection).toHaveBeenCalledWith({
      connectionId: "dsc_strava",
      memberId: "member_123",
      prisma,
    });
    expect(serviceMocks.createHostedDeviceSyncRegistryWithProviderConfigs).toHaveBeenCalledWith({
      providerConfigs,
    });
    expect(serviceMocks.createHostedDeviceSyncRegistry).not.toHaveBeenCalled();
    expect(revokeAccess).toHaveBeenCalledWith(storedAccount);
    expect(result.providerRevocations).toEqual([{
      connectionId: "dsc_strava",
      errorCode: null,
      providerLabel: "Strava",
      status: "revoked",
      warningCode: null,
    }]);
  });

  it("records a non-blocking repair warning when exact Strava application credentials are permanently invalid", async () => {
    const storedAccount = {
      accessTokenExpiresAt: "2026-04-27T01:07:00.000Z",
      connectedAt: "2026-04-27T00:07:00.000Z",
      createdAt: "2026-04-27T00:07:00.000Z",
      credential: {
        kind: "oauth_tokens" as const,
        tokens: {
          accessToken: "cleanup-access-token",
          accessTokenExpiresAt: "2026-04-27T01:07:00.000Z",
          refreshToken: "cleanup-refresh-token",
        },
      },
      disconnectGeneration: 0,
      displayName: "Strava",
      externalAccountId: "strava-athlete-123",
      id: "dsc_strava",
      keyVersion: "key-v1",
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: null,
      metadata: {},
      nextReconcileAt: null,
      provider: "strava",
      scopes: ["read", "activity:read_all"],
      setupExpiresAt: null,
      setupPhase: null,
      status: "active" as const,
      tokenVersion: 1,
      updatedAt: "2026-04-27T00:07:00.000Z",
    };
    const prisma = createHostedAccountDeletionPrismaForTest({
      deviceConnections: [{
        id: "dsc_strava",
        provider: "strava",
        providerAccountBlindIndex: "blind-index",
      }],
      onTransaction: () => undefined,
    });
    serviceMocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      store: {
        getStoredConnectionAccountForUser: vi.fn(async () => storedAccount),
        prisma,
      },
    });
    serviceMocks.resolveDeviceProviderApplicationForConnection.mockRejectedValue(
      new DeviceProviderApplicationError(
        "DEVICE_PROVIDER_APPLICATION_INVALID",
        "Private provider application credentials are invalid.",
      ),
    );

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(serviceMocks.resolveDeviceProviderApplicationForConnection).toHaveBeenCalledWith({
      connectionId: "dsc_strava",
      memberId: "member_123",
      prisma,
    });
    expect(serviceMocks.createHostedDeviceSyncRegistry).not.toHaveBeenCalled();
    expect(serviceMocks.createHostedDeviceSyncRegistryWithProviderConfigs).not.toHaveBeenCalled();
    expect(result.providerRevocations).toEqual([{
      connectionId: "dsc_strava",
      errorCode: null,
      providerLabel: "Strava",
      status: "warning",
      warningCode: "DEVICE_PROVIDER_APPLICATION_REPAIR_REQUIRED",
    }]);
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
  checkoutSessionRecords?: Array<{
    memberId: string;
    stripeCheckoutSessionIdEncrypted: string;
  }>;
  connectedAppConnectIntentRows?: HostedAccountDeletionConnectedAppIntentRow[];
  connectedAppsSession?: boolean;
  countResults?: Record<string, number>;
  dailyStateUpdates?: unknown[];
  deleteCalls?: HostedAccountDeletionPrismaDeleteCall[];
  deviceConnections?: Array<{
    id: string;
    provider: string;
    providerAccountBlindIndex: string;
    sources?: { sourceProviderSlug: string; status: string }[];
  }>;
  hostedComputerRunRows?: Record<string, unknown>[];
  hostedMemberUpdateCalls?: unknown[];
  familyBillingRefRecords?: Record<string, unknown>[];
  familyGroups?: Array<{ id: string }>;
  ownedThreadContainerMemberIds?: string[];
  identityRecord?: Record<string, unknown> | null;
  groupJoinOutreachOwnedGroupIds?: readonly string[];
  groupJoinOutreachPhoneLookupKeys?: readonly string[];
  groupJoinDeliveryRows?: readonly { sourceRef: string | null }[];
  groupJoinOutreachRows?: readonly {
    id: string;
  }[];
  liveSignupDeliveryRows?: readonly { sourceRef: string | null }[];
  onTransaction: () => void;
  operationOrder?: string[];
  productFeedbackRows?: Array<{
    id: string;
    memberId: string | null;
    summary: string;
  }>;
  transactionConnectedAppConnectIntentRows?: HostedAccountDeletionConnectedAppIntentRow[];
  transactionBillingRefRecord?: Record<string, unknown> | null;
  transactionCheckoutSessionRecords?: Array<{
    memberId: string;
    stripeCheckoutSessionIdEncrypted: string;
  }>;
  transactionDeviceConnections?: Array<{
    id: string;
    provider: string;
    providerAccountBlindIndex: string;
    sources?: { sourceProviderSlug: string; status: string }[];
  }>;
  updateCalls?: HostedAccountDeletionPrismaUpdateCall[];
  transactionFamilyBillingRefRecords?: Record<string, unknown>[];
  transactionFamilyGroups?: Array<{ id: string }>;
  transactionIdentityRecord?: Record<string, unknown> | null;
  transactionOwnedThreadContainerMemberIds?: string[];
}): Parameters<typeof deleteHostedAccountData>[0]["prisma"] {
  let transactionCallCount = 0;
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
    findMany: async (args) => (
      model === "hostedMemberIdentity"
        ? (input.groupJoinOutreachPhoneLookupKeys ?? []).map((phoneLookupKey) => ({
            phoneLookupKey,
          }))
        : model === "hostedGroup"
          ? (input.groupJoinOutreachOwnedGroupIds ?? []).map((id) => ({ id }))
          : model === "hostedGroupJoinOutreach"
            ? input.groupJoinOutreachRows ?? []
            : model === "hostedLinqDelivery"
              ? (
                  args.where
                  && typeof args.where === "object"
                  && "status" in args.where
                )
                ? input.liveSignupDeliveryRows ?? []
                : input.groupJoinDeliveryRows ?? []
            : []
    ),
    findUnique: async () => {
      input.operationOrder?.push(`findUnique:${model}`);
      return null;
    },
    updateMany: async (args) => {
      input.operationOrder?.push(`update:${model}`);
      input.updateCalls?.push({
        data: args.data,
        model,
        where: args.where,
      });
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
    $queryRaw: async (...args: unknown[]) => {
      input.operationOrder?.push("queryRaw");
      const memberId = args.slice(1).find((value): value is string =>
        typeof value === "string" && value.startsWith("member_")
      );
      if (memberId) {
        input.operationOrder?.push(`queryRaw:${memberId}`);
      }
      return [{ id: "member_123" }];
    },
    deviceConnection: {
      ...makeDeleteDelegate("deviceConnection"),
      findMany: async () => {
        input.operationOrder?.push("find:deviceConnection");
        return input.transactionDeviceConnections ?? input.deviceConnections ?? [];
      },
    },
    deviceProviderApplication: makeDeleteDelegate("deviceProviderApplication"),
    deviceProviderSetup: {
      ...makeDeleteDelegate("deviceProviderSetup"),
      findMany: async () => [],
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
    hostedThreadContainer: {
      ...makeDeleteDelegate("hostedThreadContainer"),
      findMany: async () => {
        const memberIds = transactionCallCount >= 2
          ? input.transactionOwnedThreadContainerMemberIds
            ?? input.ownedThreadContainerMemberIds
            ?? []
          : input.ownedThreadContainerMemberIds ?? [];
        return memberIds.map((memberId) => ({ memberId }));
      },
    },
    hostedAccountGroup: {
      ...makeDeleteDelegate("hostedAccountGroup"),
      findMany: async () => input.transactionFamilyGroups ?? input.familyGroups ?? [],
    },
    hostedAccountGroupBillingRef: {
      ...makeDeleteDelegate("hostedAccountGroupBillingRef"),
      findUnique: async (args: { where: { groupId: string } }) =>
        (input.transactionFamilyBillingRefRecords ?? input.familyBillingRefRecords)?.find(
          (record) => record.groupId === args.where.groupId,
        ) ?? null,
    },
    hostedMember: {
      ...makeDeleteDelegate("hostedMember"),
      updateMany: async (args: unknown) => {
        input.operationOrder?.push("update:hostedMember");
        input.hostedMemberUpdateCalls?.push(args);
        return { count: 1 };
      },
    },
    hostedLinqDailyState: {
      ...makeDeleteDelegate("hostedLinqDailyState"),
      updateMany: async (args: unknown) => {
        input.dailyStateUpdates?.push(args);
        return { count: 1 };
      },
    },
    hostedMemberBillingRef: {
      ...makeDeleteDelegate("hostedMemberBillingRef"),
      findUnique: async () => input.transactionBillingRefRecord
        ?? input.billingRefRecord
        ?? null,
    },
    hostedMemberSubscriptionCheckout: {
      ...makeDeleteDelegate("hostedMemberSubscriptionCheckout"),
      findMany: async () =>
        input.transactionCheckoutSessionRecords
        ?? input.checkoutSessionRecords
        ?? [],
    },
    hostedMemberIdentity: {
      ...makeDeleteDelegate("hostedMemberIdentity"),
      findUnique: async () => input.transactionIdentityRecord
        ?? input.identityRecord
        ?? null,
    },
    hostedProductFeedback: {
      ...makeDeleteDelegate("hostedProductFeedback"),
      deleteMany: async (args) => {
        input.operationOrder?.push("delete:hostedProductFeedback");
        input.deleteCalls?.push({
          model: "hostedProductFeedback",
          where: args.where,
        });
        if (!input.productFeedbackRows) {
          return { count: 1 };
        }
        const memberIdFilter = (
          args.where as {
            memberId?: string | { in?: readonly string[] };
          }
        ).memberId;
        const memberIds = typeof memberIdFilter === "string"
          ? [memberIdFilter]
          : memberIdFilter?.in ?? [];
        const retainedRows = input.productFeedbackRows.filter(
          (row) => row.memberId === null || !memberIds.includes(row.memberId),
        );
        const deletedCount = input.productFeedbackRows.length - retainedRows.length;
        input.productFeedbackRows.splice(
          0,
          input.productFeedbackRows.length,
          ...retainedRows,
        );
        return { count: deletedCount };
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
    deviceProviderApplication: makeDeleteDelegate("deviceProviderApplication"),
    hostedAccountGroup: {
      findMany: async () => input.familyGroups ?? [],
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
    hostedMemberSubscriptionCheckout: {
      findMany: async () => input.checkoutSessionRecords ?? [],
    },
    hostedMemberIdentity: {
      findUnique: async () => input.identityRecord ?? null,
      // Pre-member group-join outreach is resolved from the member's phone blind
      // index before the identity rows are deleted.
      findMany: async () => input.groupJoinOutreachPhoneLookupKeys
        ? input.groupJoinOutreachPhoneLookupKeys.map((phoneLookupKey) => ({
            phoneLookupKey,
          }))
        : [],
    },
    hostedGroupJoinOutreach: {
      findMany: async () => input.groupJoinOutreachRows ?? [],
    },
    hostedGroup: {
      findMany: async () => input.groupJoinOutreachOwnedGroupIds
        ? input.groupJoinOutreachOwnedGroupIds.map((id) => ({ id }))
        : [],
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
      transactionCallCount += 1;
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
  privyUserId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<{
  billingRefRecord: Record<string, unknown>;
  checkoutSessionRecords: Array<{
    memberId: string;
    stripeCheckoutSessionIdEncrypted: string;
  }>;
  identityRecord: Record<string, unknown>;
}> {
  const billingPrivateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId,
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
    privyUserId: overrides?.privyUserId === undefined
      ? "privy-user-delete-123"
      : overrides.privyUserId,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
  });
  const stripeCheckoutSessionId = overrides?.stripeCheckoutSessionId ?? null;
  const stripeCheckoutSessionIdEncrypted = stripeCheckoutSessionId
    ? await encryptHostedWebNullableString({
        field: "hosted-member-subscription-checkout.stripe-session-id",
        memberId,
        value: stripeCheckoutSessionId,
      })
    : null;

  return {
    billingRefRecord: { memberId, ...billingPrivateColumns },
    checkoutSessionRecords: stripeCheckoutSessionIdEncrypted
      ? [{
          memberId,
          stripeCheckoutSessionIdEncrypted,
        }]
      : [],
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

type HostedAccountDeletionPrismaDeleteCall = {
  model: string;
  where: unknown;
};

type HostedAccountDeletionPrismaUpdateCall = {
  data: unknown;
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
  // Some deletion owners must read rows before removing them, such as resolving
  // pre-member outreach from the member's phone blind index. Reading empty keeps
  // those paths inert unless a test supplies rows.
  findMany(args: { where?: unknown; select?: unknown }): Promise<readonly unknown[]>;
  findUnique(args: { where?: unknown; select?: unknown }): Promise<unknown>;
  updateMany(args: { data?: unknown; where?: unknown }): Promise<{ count: number }>;
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
  deviceProviderApplication: HostedAccountDeletionPrismaDeleteDelegate;
  deviceProviderSetup: HostedAccountDeletionPrismaDeleteDelegate;
  hostedComputerRun: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: () => Promise<unknown[]>;
  };
  hostedConnectedAppConnectIntent: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: () => Promise<unknown[]>;
  };
  hostedLinqDailyState: HostedAccountDeletionPrismaDeleteDelegate & {
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  hostedThreadContainer: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: () => Promise<Array<{ memberId: string }>>;
  };
  hostedAccountGroup: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: () => Promise<Array<{ id: string }>>;
  };
  hostedAccountGroupBillingRef: HostedAccountDeletionPrismaDeleteDelegate & {
    findUnique: (args: { where: { groupId: string } }) => Promise<unknown>;
  };
  hostedMember: HostedAccountDeletionPrismaDeleteDelegate & {
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  hostedMemberBillingRef: HostedAccountDeletionPrismaDeleteDelegate & {
    findUnique: () => Promise<unknown>;
  };
  hostedMemberSubscriptionCheckout: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: () => Promise<Array<{
      memberId: string;
      stripeCheckoutSessionIdEncrypted: string;
    }>>;
  };
  hostedMemberIdentity: HostedAccountDeletionPrismaDeleteDelegate & {
    findUnique: () => Promise<unknown>;
  };
  hostedProductFeedback: HostedAccountDeletionPrismaDeleteDelegate;
};

function makeCloudflareDeletionResult(): {
  alarmCleared: boolean | null;
  configured: boolean;
  deleteAllCompleted: boolean | null;
  deleted: boolean;
  errorCode: string | null;
  r2DeletedObjectCount: number | null;
  r2SkippedUserScopedPrefixes: boolean | null;
  r2Supported: boolean | null;
  r2UserScopedSkipReason: string | null;
  runnerStateDeleted: boolean | null;
} {
  return {
    alarmCleared: true,
    configured: true,
    deleteAllCompleted: true,
    deleted: true,
    errorCode: null,
    r2DeletedObjectCount: 0,
    r2SkippedUserScopedPrefixes: false,
    r2Supported: true,
    r2UserScopedSkipReason: null,
    runnerStateDeleted: true,
  };
}

function makeCleanupRunResult(input: {
  cleanupPending?: boolean;
  cloudflare?: ReturnType<typeof makeCloudflareDeletionResult>;
  privyUser?: { errorCode: string | null; status: string };
  stripeCustomer?: { errorCode: string | null; status: string };
} = {}) {
  return {
    cleanupPending: input.cleanupPending ?? false,
    cloudflare: input.cloudflare ?? makeCloudflareDeletionResult(),
    vendorAccounts: {
      privyUser: input.privyUser ?? { errorCode: null, status: "completed" },
      stripeCustomer:
        input.stripeCustomer ?? { errorCode: null, status: "completed" },
    },
  };
}
