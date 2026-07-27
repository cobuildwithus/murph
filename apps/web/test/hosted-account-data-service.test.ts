import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY,
} from "@murphai/device-syncd/types";

const serviceMocks = vi.hoisted(() => ({
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
  pendingHostedAccountDeletionCleanupResult: vi.fn(),
  persistHostedAccountDeletionCleanupTx: vi.fn(),
  prepareHostedAccountDeletionCleanup: vi.fn(),
  readHostedConnectedAppsConfig: vi.fn(),
  runHostedAccountDeletionCleanup: vi.fn(),
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx: vi.fn(),
  closeHostedUsageCreditPurchasesForAccountDeletion: vi.fn(),
  assertHostedPhoneCallsReadyForAccountDeletionTx: vi.fn(),
  deleteHostedPhoneCallsForAccountDeletion: vi.fn(),
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
  HOSTED_ACCOUNT_DATA_STORE_COVERAGE,
  parseHostedAccountDeletionRequest,
} from "@/src/lib/hosted-privacy/account-data-service";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

if (runPostgresConcurrencyProof && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))) {
  throw new Error("The hosted account-deletion device-start proof requires a local DATABASE_URL.");
}

const REQUIRED_STORE_SLUGS = [
  "prisma.hosted_member",
  "prisma.hosted_web_session",
  "prisma.hosted_sensitive_action_challenge",
  "prisma.hosted_member_identity",
  "prisma.hosted_address_book_projection",
  "prisma.hosted_address_book_contact",
  "prisma.hosted_member_routing",
  "prisma.hosted_member_email_authorization",
  "prisma.hosted_member_billing_ref",
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
  "prisma.hosted_computer_run",
  "prisma.hosted_computer_handoff",
  "prisma.hosted_phone_call",
  "prisma.hosted_runtime_log",
  "prisma.hosted_user_crypto_envelope",
  "prisma.hosted_user_crypto_audit",
  "prisma.hosted_ai_usage",
  "prisma.hosted_ai_usage_period",
  "prisma.hosted_growth_aggregate",
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
  serviceMocks.pendingHostedAccountDeletionCleanupResult.mockReset();
  serviceMocks.pendingHostedAccountDeletionCleanupResult.mockImplementation(
    (errorCode: string) => makeCleanupRunResult({
      cleanupPending: true,
      cloudflare: {
        ...makeCloudflareDeletionResult(),
        deleted: false,
        errorCode,
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


describe("deleteHostedAccountData", () => {
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
    serviceMocks.runHostedAccountDeletionCleanup.mockImplementation(async () => {
      order.push("cloudflare");
      return makeCleanupRunResult();
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

  it("deletes upstream provider-config accounts during hosted account deletion", async () => {
    const order: string[] = [];
    const deleteAccount = vi.fn();
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
          deleteAccount,
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
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(deleteAccount).toHaveBeenCalledWith(expect.objectContaining({
      externalAccountId: "junction-user-123",
    }));
    expect(revokeAccess).not.toHaveBeenCalled();
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

  it("falls back to provider revocation when destructive account deletion is unavailable", async () => {
    const order: string[] = [];
    const revokeAccess = vi.fn();
    const storedAccount = {
      accessTokenExpiresAt: null,
      connectedAt: "2026-04-27T00:07:00.000Z",
      createdAt: "2026-04-27T00:07:00.000Z",
      credential: {
        kind: "oauth_tokens" as const,
        tokens: {
          accessToken: "<REDACTED_ACCESS_TOKEN>",
          accessTokenExpiresAt: null,
          refreshToken: "<REDACTED_REFRESH_TOKEN>",
        },
      },
      disconnectGeneration: 0,
      displayName: "Oura",
      externalAccountId: "oura-account-123",
      id: "dsc_oura",
      keyVersion: "test:v1",
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: null,
      metadata: {},
      nextReconcileAt: null,
      provider: "oura",
      scopes: ["daily"],
      setupExpiresAt: null,
      setupPhase: null,
      status: "active" as const,
      tokenVersion: 1,
      updatedAt: "2026-04-27T00:07:00.000Z",
    };
    const getStoredConnectionAccountForUser = vi.fn(async () => storedAccount);
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
          id: "dsc_oura",
          provider: "oura",
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

    expect(revokeAccess).toHaveBeenCalledWith(storedAccount);
    expect(order).toEqual(["prisma", "prisma"]);
    expect(result.providerRevocations).toEqual([
      {
        connectionId: "dsc_oura",
        errorCode: null,
        providerLabel: "Oura",
        status: "revoked",
        warningCode: null,
      },
    ]);
  });

  it("blocks deletion without provider cleanup while an unexpired start may still be running", async () => {
    const deleteOwnerAccount = vi.fn(async () => "absent" as const);
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const operationOrder: string[] = [];
    serviceMocks.createHostedDeviceSyncRegistry.mockReturnValue({
      get: vi.fn(() => ({
        connectionHandler: {
          deleteOwnerAccount,
        },
        descriptor: {
          connection: {
            kind: "external_link",
          },
        },
      })),
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
      operationOrder,
      pendingDeviceConnectionStarts: [
        {
          createdAt: new Date("2026-07-26T12:00:00.000Z"),
          expiresAt: new Date("2099-07-26T12:30:00.000Z"),
          provider: "junction",
          state: "pending-junction-start",
          userId: "member_123",
        },
      ],
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_DEVICE_CONNECTION_START_IN_PROGRESS",
      httpStatus: 409,
      retryable: true,
    });

    expect(deleteOwnerAccount).not.toHaveBeenCalled();
    expect(deleteCalls).not.toContainEqual(expect.objectContaining({
      model: "deviceOauthSession",
    }));
    expect(operationOrder).not.toContain("update:hostedMember");
  });

  it("rejects a live sibling before cleaning an older expired owner-creating start", async () => {
    const deleteOwnerAccount = vi.fn(async () => "deleted" as const);
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    const operationOrder: string[] = [];
    serviceMocks.createHostedDeviceSyncRegistry.mockReturnValue({
      get: vi.fn(() => ({
        connectionHandler: {
          deleteOwnerAccount,
        },
      })),
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
      operationOrder,
      pendingDeviceConnectionStarts: [
        {
          createdAt: new Date("2026-07-26T11:00:00.000Z"),
          expiresAt: new Date("2020-07-26T11:30:00.000Z"),
          provider: "junction",
          state: "expired-junction-start",
          userId: "member_123",
        },
        {
          createdAt: new Date("2026-07-26T12:00:00.000Z"),
          expiresAt: new Date("2099-07-26T12:30:00.000Z"),
          provider: "junction",
          state: "live-junction-start",
          userId: "member_123",
        },
      ],
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_DEVICE_CONNECTION_START_IN_PROGRESS",
      httpStatus: 409,
      retryable: true,
    });

    expect(serviceMocks.createHostedDeviceSyncRegistry).not.toHaveBeenCalled();
    expect(deleteOwnerAccount).not.toHaveBeenCalled();
    expect(deleteCalls).not.toContainEqual(expect.objectContaining({
      model: "deviceOauthSession",
    }));
    expect(operationOrder).not.toContain("update:hostedMember");
  });

  it("retains pending start ownership until retried provider cleanup succeeds", async () => {
    const operationOrder: string[] = [];
    let cleanupAttempt = 0;
    const deleteOwnerAccount = vi.fn(async () => {
      operationOrder.push("delete:providerOwner");
      cleanupAttempt += 1;
      if (cleanupAttempt === 1) {
        throw new Error("temporary Junction cleanup failure");
      }
      return "deleted" as const;
    });
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    serviceMocks.createHostedDeviceSyncRegistry.mockReturnValue({
      get: vi.fn(() => ({
        connectionHandler: {
          deleteOwnerAccount,
        },
        descriptor: {
          connection: {
            kind: "external_link",
          },
        },
      })),
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
      operationOrder,
      pendingDeviceConnectionStarts: [
        {
          createdAt: new Date("2026-07-26T12:00:00.000Z"),
          expiresAt: new Date("2020-07-26T12:30:00.000Z"),
          provider: "junction",
          state: "pending-junction-start",
          userId: "member_123",
        },
      ],
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
    expect(deleteCalls).not.toContainEqual(expect.objectContaining({
      model: "deviceOauthSession",
    }));
    expect(operationOrder.indexOf("update:hostedMember")).toBeLessThan(
      operationOrder.indexOf("delete:providerOwner"),
    );

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).resolves.toMatchObject({
      memberId: "member_123",
    });
    expect(deleteOwnerAccount).toHaveBeenCalledTimes(2);
    expect(deleteCalls).toContainEqual(expect.objectContaining({
      model: "deviceOauthSession",
    }));
  });

  it.each([
    {
      name: "provider registry entry",
      registryValue: null,
    },
    {
      name: "owner cleanup handler",
      registryValue: {
        connectionHandler: {},
        descriptor: {
          connection: {
            kind: "external_link",
          },
        },
      },
    },
  ])("fails closed when an expired start has no $name", async ({ registryValue }) => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    serviceMocks.createHostedDeviceSyncRegistry.mockReturnValue({
      get: vi.fn(() => registryValue),
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
      pendingDeviceConnectionStarts: [
        {
          createdAt: new Date("2026-07-26T12:00:00.000Z"),
          expiresAt: new Date("2020-07-26T12:30:00.000Z"),
          provider: "junction",
          state: "pending-junction-start",
          userId: "member_123",
        },
      ],
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
    expect(deleteCalls).not.toContainEqual(expect.objectContaining({
      model: "deviceOauthSession",
    }));
  });

  it("fails closed for an expired start from an unknown provider", async () => {
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    serviceMocks.createHostedDeviceSyncRegistry.mockImplementation(() => {
      throw new Error("Unknown providers must fail before configured registry lookup.");
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
      pendingDeviceConnectionStarts: [
        {
          createdAt: new Date("2026-07-26T12:00:00.000Z"),
          expiresAt: new Date("2020-07-26T12:30:00.000Z"),
          provider: "unknown-provider",
          state: "pending-unknown-start",
          userId: "member_123",
        },
      ],
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
    expect(serviceMocks.createHostedDeviceSyncRegistry).not.toHaveBeenCalled();
    expect(deleteCalls).not.toContainEqual(expect.objectContaining({
      model: "deviceOauthSession",
    }));
  });

  it("clears an expired start after the provider proves the owner is absent", async () => {
    const deleteOwnerAccount = vi.fn(async () => "absent" as const);
    const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
    serviceMocks.createHostedDeviceSyncRegistry.mockReturnValue({
      get: vi.fn(() => ({
        connectionHandler: {
          deleteOwnerAccount,
        },
        descriptor: {
          connection: {
            kind: "external_link",
          },
        },
      })),
    });
    const prisma = createHostedAccountDeletionPrismaForTest({
      deleteCalls,
      onTransaction: () => undefined,
      pendingDeviceConnectionStarts: [
        {
          createdAt: new Date("2026-07-26T12:00:00.000Z"),
          expiresAt: new Date("2020-07-26T12:30:00.000Z"),
          provider: "junction",
          state: "pending-junction-start",
          userId: "member_123",
        },
      ],
    });

    await expect(deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    })).resolves.toMatchObject({
      memberId: "member_123",
    });
    expect(deleteOwnerAccount).toHaveBeenCalledWith({ ownerId: "member_123" });
    expect(deleteCalls).toContainEqual(expect.objectContaining({
      model: "deviceOauthSession",
    }));
  });

  it.each(["oura", "strava", "whoop"])(
    "clears an expired URL-only %s OAuth start without current provider configuration",
    async (provider) => {
      const deleteCalls: HostedAccountDeletionPrismaDeleteCall[] = [];
      serviceMocks.createHostedDeviceSyncRegistry.mockImplementation(() => {
        throw new Error("URL-only OAuth expiry must not read configured providers.");
      });
      const prisma = createHostedAccountDeletionPrismaForTest({
        deleteCalls,
        onTransaction: () => undefined,
        pendingDeviceConnectionStarts: [
          {
            createdAt: new Date("2026-07-26T12:00:00.000Z"),
            expiresAt: new Date("2020-07-26T12:30:00.000Z"),
            provider,
            state: `pending-${provider}-start`,
            userId: "member_123",
          },
        ],
      });

      await expect(deleteHostedAccountData({
        memberId: "member_123",
        prisma,
        request: new Request("https://join.example.test/settings"),
      })).resolves.toMatchObject({
        memberId: "member_123",
      });
      expect(deleteCalls).toContainEqual(expect.objectContaining({
        model: "deviceOauthSession",
      }));
      expect(serviceMocks.createHostedDeviceSyncRegistry).not.toHaveBeenCalled();
    },
  );

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

  it("blocks hosted account deletion when provider account cleanup fails", async () => {
    const order: string[] = [];
    const deleteAccount = vi.fn(async () => {
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
          deleteAccount,
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
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["prisma"]);
  });
});

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted account-deletion device-start PostgreSQL lifecycle",
  () => {
    it("rejects a live pending start before persisting account suspension", async () => {
      const fixture = await createPostgresAccountDeletionFixture();

      try {
        await fixture.store.stageConnectionStart({
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          metadata: {
            [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
          },
          ownerId: fixture.memberId,
          provider: "junction",
          returnTo: null,
          state: fixture.state,
        });

        await expect(deleteHostedAccountData({
          memberId: fixture.memberId,
          prisma: fixture.prisma,
          request: new Request("https://join.example.test/settings"),
        })).rejects.toMatchObject({
          code: "ACCOUNT_DELETION_DEVICE_CONNECTION_START_IN_PROGRESS",
          httpStatus: 409,
          retryable: true,
        });
        await expect(fixture.prisma.hostedMember.findUnique({
          select: { suspendedAt: true },
          where: { id: fixture.memberId },
        })).resolves.toEqual({ suspendedAt: null });
      } finally {
        await cleanupPostgresAccountDeletionFixture(fixture);
      }
    });

    it("rejects an expired Junction marker plus live sibling before provider cleanup", async () => {
      const fixture = await createPostgresAccountDeletionFixture();
      const expiredState = `${fixture.state}-expired`;
      const liveState = `${fixture.state}-live`;
      const deleteOwnerAccount = vi.fn(async () => "deleted" as const);
      serviceMocks.createHostedDeviceSyncRegistry.mockReturnValue({
        get: vi.fn(() => ({
          connectionHandler: {
            deleteOwnerAccount,
          },
        })),
      });

      try {
        for (const state of [expiredState, liveState]) {
          await fixture.store.stageConnectionStart({
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            metadata: {
              [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
            },
            ownerId: fixture.memberId,
            provider: "junction",
            returnTo: null,
            state,
          });
        }
        await fixture.prisma.deviceOauthSession.update({
          data: { expiresAt: new Date(Date.now() - 1) },
          where: { state: expiredState },
        });

        await expect(deleteHostedAccountData({
          memberId: fixture.memberId,
          prisma: fixture.prisma,
          request: new Request("https://join.example.test/settings"),
        })).rejects.toMatchObject({
          code: "ACCOUNT_DELETION_DEVICE_CONNECTION_START_IN_PROGRESS",
          httpStatus: 409,
          retryable: true,
        });

        expect(serviceMocks.createHostedDeviceSyncRegistry).not.toHaveBeenCalled();
        expect(deleteOwnerAccount).not.toHaveBeenCalled();
        await expect(fixture.prisma.hostedMember.findUnique({
          select: { suspendedAt: true },
          where: { id: fixture.memberId },
        })).resolves.toEqual({ suspendedAt: null });
        await expect(fixture.prisma.deviceOauthSession.findMany({
          orderBy: { state: "asc" },
          select: { state: true },
          where: { userId: fixture.memberId },
        })).resolves.toEqual([
          { state: expiredState },
          { state: liveState },
        ]);
      } finally {
        await cleanupPostgresAccountDeletionFixture(fixture);
      }
    });

    it("rechecks a live marker staged after the read-only preflight", async () => {
      const fixture = await createPostgresAccountDeletionFixture();
      const preflightRead = deferred();
      const releasePreflight = deferred();
      const deletionPrisma = pauseFirstPendingStartCount({
        allow: releasePreflight,
        entered: preflightRead,
        prisma: fixture.prisma,
      });
      const deletion = deleteHostedAccountData({
        memberId: fixture.memberId,
        prisma: deletionPrisma,
        request: new Request("https://join.example.test/settings"),
      });

      try {
        await preflightRead.promise;
        await fixture.store.stageConnectionStart({
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          metadata: {
            [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
          },
          ownerId: fixture.memberId,
          provider: "junction",
          returnTo: null,
          state: fixture.state,
        });
        releasePreflight.resolve();

        await expect(deletion).rejects.toMatchObject({
          code: "ACCOUNT_DELETION_DEVICE_CONNECTION_START_IN_PROGRESS",
          httpStatus: 409,
          retryable: true,
        });
        expect(serviceMocks.createHostedDeviceSyncRegistry).not.toHaveBeenCalled();
        await expect(fixture.prisma.hostedMember.findUnique({
          select: { suspendedAt: true },
          where: { id: fixture.memberId },
        })).resolves.toEqual({ suspendedAt: null });
        await expect(fixture.prisma.deviceOauthSession.findUnique({
          select: { state: true },
          where: { state: fixture.state },
        })).resolves.toEqual({ state: fixture.state });
      } finally {
        releasePreflight.resolve();
        await Promise.allSettled([deletion]);
        await cleanupPostgresAccountDeletionFixture(fixture);
      }
    });

    it("commits suspension before cleaning an expired Junction owner", async () => {
      const fixture = await createPostgresAccountDeletionFixture();
      const cleanupEntered = deferred();
      const releaseCleanup = deferred<"absent">();
      const deleteOwnerAccount = vi.fn(async () => {
        cleanupEntered.resolve();
        return releaseCleanup.promise;
      });
      serviceMocks.createHostedDeviceSyncRegistry.mockReturnValue({
        get: vi.fn(() => ({
          connectionHandler: {
            deleteOwnerAccount,
          },
        })),
      });

      await fixture.store.stageConnectionStart({
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        metadata: {
          [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
        },
        ownerId: fixture.memberId,
        provider: "junction",
        returnTo: null,
        state: fixture.state,
      });
      await fixture.prisma.deviceOauthSession.update({
        data: { expiresAt: new Date(Date.now() - 1) },
        where: { state: fixture.state },
      });
      const deletion = deleteHostedAccountData({
        memberId: fixture.memberId,
        prisma: fixture.prisma,
        request: new Request("https://join.example.test/settings"),
      });

      try {
        await cleanupEntered.promise;
        await expect(fixture.prisma.hostedMember.findUnique({
          select: { suspendedAt: true },
          where: { id: fixture.memberId },
        })).resolves.toEqual({
          suspendedAt: expect.any(Date),
        });
        releaseCleanup.resolve("absent");
        await expect(deletion).resolves.toMatchObject({
          memberId: fixture.memberId,
        });
      } finally {
        releaseCleanup.resolve("absent");
        await Promise.allSettled([deletion]);
        await cleanupPostgresAccountDeletionFixture(fixture);
      }
    });

    it.each(["oura", "strava", "whoop"])(
      "deletes an account after an abandoned URL-only %s start expires without current config",
      async (provider) => {
        const fixture = await createPostgresAccountDeletionFixture();
        const createdAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        serviceMocks.createHostedDeviceSyncRegistry.mockImplementation(() => {
          throw new Error("URL-only OAuth expiry must not read configured providers.");
        });

        try {
          await fixture.store.stageConnectionStart({
            createdAt,
            expiresAt,
            metadata: {
              [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
            },
            ownerId: fixture.memberId,
            provider,
            returnTo: null,
            state: fixture.state,
          });
          await fixture.prisma.hostedMember.update({
            data: { suspendedAt: new Date() },
            where: { id: fixture.memberId },
          });
          await expect(fixture.store.commitConnectionStart({
            connectionSeed: null,
            oauthState: {
              createdAt,
              expiresAt,
              ownerId: fixture.memberId,
              provider,
              returnTo: null,
              state: fixture.state,
            },
          })).rejects.toMatchObject({
            code: "CONNECTION_OWNER_UNAVAILABLE",
            httpStatus: 403,
          });
          await fixture.prisma.deviceOauthSession.update({
            data: { expiresAt: new Date(Date.now() - 1) },
            where: { state: fixture.state },
          });

          await expect(deleteHostedAccountData({
            memberId: fixture.memberId,
            prisma: fixture.prisma,
            request: new Request("https://join.example.test/settings"),
          })).resolves.toMatchObject({
            memberId: fixture.memberId,
          });
          await expect(fixture.prisma.hostedMember.findUnique({
            where: { id: fixture.memberId },
          })).resolves.toBeNull();
          await expect(fixture.prisma.deviceOauthSession.findUnique({
            where: { state: fixture.state },
          })).resolves.toBeNull();
          expect(serviceMocks.createHostedDeviceSyncRegistry).not.toHaveBeenCalled();
        } finally {
          await cleanupPostgresAccountDeletionFixture(fixture);
        }
      },
    );
  },
);

function pauseFirstPendingStartCount(input: {
  allow: Deferred<void>;
  entered: Deferred<void>;
  prisma: PrismaClient;
}): PrismaClient {
  let paused = false;
  const deviceOauthSession = new Proxy(input.prisma.deviceOauthSession, {
    get(target, property) {
      if (property === "count") {
        return async (args: Prisma.DeviceOauthSessionCountArgs) => {
          const count = await target.count(args);
          if (!paused) {
            paused = true;
            input.entered.resolve();
            await input.allow.promise;
          }
          return count;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(input.prisma, {
    get(target, property) {
      if (property === "deviceOauthSession") {
        return deviceOauthSession;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

type PostgresAccountDeletionFixture = {
  memberId: string;
  prisma: PrismaClient;
  state: string;
  store: PrismaDeviceSyncControlPlaneStore;
};

async function createPostgresAccountDeletionFixture(): Promise<PostgresAccountDeletionFixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL account-deletion proof.");
  }
  const id = randomUUID();
  const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const memberId = `member_account_delete_start_${id}`;
  await prisma.hostedMember.create({ data: { id: memberId } });
  return {
    memberId,
    prisma,
    state: `account-delete-start-${id}`,
    store: new PrismaDeviceSyncControlPlaneStore({
      codec: {
        keyVersion: "test:v1",
        decrypt: (value: string) => value.replace(/^encrypted:/u, ""),
        encrypt: (value: string) => `encrypted:${value}`,
      },
      prisma,
      providerAccountBlindIndexKey: Buffer.alloc(32, 19),
    }),
  };
}

async function cleanupPostgresAccountDeletionFixture(
  fixture: PostgresAccountDeletionFixture,
): Promise<void> {
  await fixture.prisma.deviceOauthSession.deleteMany({
    where: { userId: fixture.memberId },
  });
  await fixture.prisma.deviceConnection.deleteMany({
    where: { userId: fixture.memberId },
  });
  await fixture.prisma.hostedMember.deleteMany({
    where: { id: fixture.memberId },
  });
  await fixture.prisma.$disconnect();
}


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
  hostedMemberUpdateCalls?: unknown[];
  familyBillingRefRecords?: Record<string, unknown>[];
  familyGroups?: Array<{ id: string }>;
  ownedThreadContainerMemberIds?: string[];
  identityRecord?: Record<string, unknown> | null;
  onTransaction: () => void;
  operationOrder?: string[];
  pendingDeviceConnectionStarts?: Array<{
    createdAt: Date;
    expiresAt: Date;
    provider: string;
    state: string;
    userId: string | null;
  }>;
  transactionConnectedAppConnectIntentRows?: HostedAccountDeletionConnectedAppIntentRow[];
  transactionBillingRefRecord?: Record<string, unknown> | null;
  transactionDeviceConnections?: Array<{
    id: string;
    provider: string;
    providerAccountBlindIndex: string;
    sources?: { sourceProviderSlug: string; status: string }[];
  }>;
  transactionFamilyBillingRefRecords?: Record<string, unknown>[];
  transactionFamilyGroups?: Array<{ id: string }>;
  transactionIdentityRecord?: Record<string, unknown> | null;
  transactionOwnedThreadContainerMemberIds?: string[];
}): Parameters<typeof deleteHostedAccountData>[0]["prisma"] {
  let pendingDeviceConnectionStarts = [...(input.pendingDeviceConnectionStarts ?? [])];
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
    deviceOauthSession: {
      count: async (args) =>
        pendingDeviceConnectionStarts.filter((record) =>
          matchesPendingDeviceConnectionStartWhere(record, args.where)
        ).length,
      deleteMany: async (args) => {
        input.operationOrder?.push("delete:deviceOauthSession");
        input.deleteCalls?.push({ model: "deviceOauthSession", where: args.where });
        const where = args.where as { state?: string; userId?: string };
        const previousCount = pendingDeviceConnectionStarts.length;
        pendingDeviceConnectionStarts = pendingDeviceConnectionStarts.filter((record) =>
          record.state !== where.state || record.userId !== where.userId
        );
        return { count: previousCount - pendingDeviceConnectionStarts.length };
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
    hostedMemberBillingRef: {
      ...makeDeleteDelegate("hostedMemberBillingRef"),
      findUnique: async () => input.transactionBillingRefRecord
        ?? input.billingRefRecord
        ?? null,
    },
    hostedMemberIdentity: {
      ...makeDeleteDelegate("hostedMemberIdentity"),
      findUnique: async () => input.transactionIdentityRecord
        ?? input.identityRecord
        ?? null,
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
    deviceOauthSession: {
      count: async (args: { where: unknown }) => {
        input.operationOrder?.push("count:deviceOauthSession");
        return pendingDeviceConnectionStarts.filter((record) =>
          matchesPendingDeviceConnectionStartWhere(record, args.where)
        ).length;
      },
      deleteMany: async (args: { where: unknown }) => {
        input.operationOrder?.push("delete:deviceOauthSession");
        input.deleteCalls?.push({ model: "deviceOauthSession", where: args.where });
        const where = args.where as { state?: string; userId?: string };
        const previousCount = pendingDeviceConnectionStarts.length;
        pendingDeviceConnectionStarts = pendingDeviceConnectionStarts.filter((record) =>
          record.state !== where.state || record.userId !== where.userId
        );
        return { count: previousCount - pendingDeviceConnectionStarts.length };
      },
      findMany: async (args: { where: unknown }) =>
        pendingDeviceConnectionStarts.filter((record) =>
          matchesPendingDeviceConnectionStartWhere(record, args.where)
        ),
    },
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
      transactionCallCount += 1;
      input.onTransaction();
      return callback(transactionPrisma);
    },
  };
  return fakePrisma as Parameters<typeof deleteHostedAccountData>[0]["prisma"];
}

function matchesPendingDeviceConnectionStartWhere(
  record: {
    expiresAt: Date;
    userId: string | null;
  },
  where: unknown,
): boolean {
  if (typeof where !== "object" || where === null) {
    return true;
  }

  const expiresAt = Reflect.get(where, "expiresAt");
  if (typeof expiresAt === "object" && expiresAt !== null) {
    const gt = Reflect.get(expiresAt, "gt");
    if (gt instanceof Date && record.expiresAt <= gt) {
      return false;
    }
    const lte = Reflect.get(expiresAt, "lte");
    if (lte instanceof Date && record.expiresAt > lte) {
      return false;
    }
  }

  const userId = Reflect.get(where, "userId");
  if (typeof userId === "object" && userId !== null) {
    const includedIds = Reflect.get(userId, "in");
    if (Array.isArray(includedIds) && !includedIds.includes(record.userId)) {
      return false;
    }
  }
  return true;
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
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<{
  billingRefRecord: Record<string, unknown>;
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
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}): Promise<Record<string, unknown>> {
  const [stripeCustomerIdEncrypted, stripeSubscriptionIdEncrypted] = await Promise.all([
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
  deviceOauthSession: HostedAccountDeletionPrismaDeleteDelegate;
  hostedComputerRun: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: () => Promise<unknown[]>;
  };
  hostedConnectedAppConnectIntent: HostedAccountDeletionPrismaDeleteDelegate & {
    findMany: () => Promise<unknown[]>;
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
  hostedMemberIdentity: HostedAccountDeletionPrismaDeleteDelegate & {
    findUnique: () => Promise<unknown>;
  };
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

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
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
