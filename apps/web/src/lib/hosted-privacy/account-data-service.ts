import { Prisma, type PrismaClient } from "@prisma/client";

import { sanitizeHostedRuntimeErrorCode } from "@murphai/device-syncd/hosted-runtime";
import { formatDeviceSyncProviderLabel } from "@murphai/device-syncd/provider-label";
import { isDeviceSyncError } from "@murphai/device-syncd/public-ingress";

import { createHostedDeviceSyncControlPlane } from "../device-sync/control-plane";
import { ComputerUseService } from "../computer-use/service";
import { PrismaComputerUseStore } from "../computer-use/store";
import {
  ComposioConnectedAppsRequestError,
  createComposioConnectedAppsClient,
  type ComposioConnectedAccount,
} from "../connected-apps/composio";
import {
  formatHostedConnectedAppToolkitLabel,
  readHostedConnectedAppsConfig,
} from "../connected-apps/config";
import {
  formatHostedDeviceSyncProviderLabel,
  resolveHostedDeviceSyncBrowserProviderLabel,
} from "../device-sync/provider-label";
import { acquireHostedWebhookTraceOwnerLockTx } from "../device-sync/webhook-trace-owner-lock";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  readHostedMemberSnapshot,
  type HostedMemberSnapshot,
} from "../hosted-onboarding/hosted-member-store";
import { readHostedMemberStripeBillingRef } from "../hosted-onboarding/hosted-member-billing-store";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { deleteHostedPrivyUser } from "../hosted-onboarding/privy";
import { getHostedOnboardingStripe } from "../hosted-onboarding/runtime";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import {
  deleteHostedRunnerUserDataBestEffort,
  type HostedRunnerUserDataDeletionBestEffortResult,
} from "../hosted-execution/user-data-delete";
import {
  terminateHostedUserRuntimeWorkflowBestEffort,
} from "../hosted-orchestration/workflow-termination";
import {
  HOSTED_ACCOUNT_DATA_DELETION_SCHEMA,
  HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
} from "./account-data-shared";

export type HostedAccountStoreDeletionMode =
  | "live-delete"
  | "best-effort-delete"
  | "local-reference-delete"
  | "documented-retention";

export interface HostedAccountDataStoreCoverageEntry {
  readonly slug: string;
  readonly label: string;
  readonly deletion: HostedAccountStoreDeletionMode;
  readonly note: string;
}

export const HOSTED_ACCOUNT_DATA_STORE_COVERAGE = [
  {
    slug: "prisma.hosted_member",
    label: "Prisma hosted member record",
    deletion: "live-delete",
    note: "Deletes the member row after child stores are explicitly deleted; Prisma cascade remains a safety net.",
  },
  {
    slug: "prisma.hosted_web_session",
    label: "Hosted web app sessions",
    deletion: "live-delete",
    note: "Deletes active and revoked hashed app-session tokens plus per-session computer handoff viewport hints. Export reports counts only and omits token hashes.",
  },
  {
    slug: "prisma.hosted_sensitive_action_challenge",
    label: "Short-lived sensitive-action challenges",
    deletion: "live-delete",
    note: "Deletes hashed sensitive-action challenges and durable Assistant approval decisions stored in the same member-scoped table. User exports omit these rows, token hashes, action hashes, signatures, and wallet authorization material.",
  },
  {
    slug: "prisma.hosted_member_identity",
    label: "Privy identity and encrypted contact hints",
    deletion: "live-delete",
    note: "Confirmed export includes decrypted user-facing phone, Privy, and wallet identity fields while omitting lookup keys and active phone-code attempt IDs.",
  },
  {
    slug: "prisma.hosted_member_routing",
    label: "Linq, Telegram, reply-alias routing bindings",
    deletion: "live-delete",
    note: "Confirmed export includes decrypted user-facing Linq and Telegram routing IDs and pending Linq participant contacts while omitting lookup keys used for inbound traffic matching.",
  },
  {
    slug: "prisma.hosted_member_email_authorization",
    label: "Email authorization state",
    deletion: "live-delete",
    note: "Confirmed export includes verified-email and direct-public-sender addresses when available while omitting address lookup keys.",
  },
  {
    slug: "prisma.hosted_member_billing_ref",
    label: "Local Stripe billing references",
    deletion: "local-reference-delete",
    note: "Confirmed export includes local Stripe customer/subscription references. The Stripe subscription and customer themselves are canceled/deleted by the vendor-account deletion step.",
  },
  {
    slug: "prisma.hosted_mailbox_item",
    label: "Hosted mailbox envelopes",
    deletion: "live-delete",
    note: "Deletes lane items, inline ciphertext, payload refs, dedupe keys, and sequence counters. Export includes mailbox envelope metadata and omits decoded payload bodies.",
  },
  {
    slug: "prisma.hosted_mailbox_payload",
    label: "Hosted mailbox payload ciphertext",
    deletion: "live-delete",
    note: "Deletes encrypted payload blobs. Export reports payload presence and bytes while omitting ciphertext and decoded arbitrary payload JSON.",
  },
  {
    slug: "prisma.hosted_mailbox_lane_counter",
    label: "Hosted mailbox lane counters",
    deletion: "live-delete",
    note: "Deletes per-lane sequence counters so deleted users cannot resume mailbox lanes.",
  },
  {
    slug: "prisma.hosted_ingress_latency_trace",
    label: "Hosted ingress latency traces",
    deletion: "live-delete",
    note: "Deletes hosted ingress timing rows. Export includes aggregate counts only and omits internal correlation identifiers.",
  },
  {
    slug: "prisma.hosted_workspace",
    label: "Hosted workspace state",
    deletion: "live-delete",
    note: "Deletes hosted workspace checkpoint refs, browser vault replica refs, next-wake state, inbox media-retention wake state, and redacted status.",
  },
  {
    slug: "prisma.hosted_computer_run",
    label: "Hosted computer-use runs",
    deletion: "live-delete",
    note: "Deletes Kernel browser sessions, Managed Auth connections, and profiles before local run rows. Export includes redacted run/checkpoint metadata and omits credentials, auth connection ids, live-view URLs, Kernel session ids, and Kernel profile names.",
  },
  {
    slug: "prisma.hosted_computer_handoff",
    label: "Hosted computer-use handoffs",
    deletion: "live-delete",
    note: "Deletes short-lived handoff rows and token hashes. Export includes handoff status metadata and omits token hashes.",
  },
  {
    slug: "prisma.hosted_runtime_log",
    label: "Runtime logs",
    deletion: "live-delete",
    note: "Deletes per-user hosted runtime logs and redacted runtime JSON. Export omits runtime log rows and counts.",
  },
  {
    slug: "prisma.hosted_user_crypto_envelope",
    label: "Hosted crypto domain root envelopes",
    deletion: "live-delete",
    note: "Deletes signed per-user domain root envelopes. Export reports counts only and omits signed envelope JSON.",
  },
  {
    slug: "prisma.hosted_user_crypto_audit",
    label: "Hosted crypto audit rows",
    deletion: "live-delete",
    note: "Deletes per-user hosted crypto provisioning audit rows. Export reports counts only and omits recipient and root-key audit payloads.",
  },
  {
    slug: "prisma.hosted_ai_usage",
    label: "AI usage and metering rows",
    deletion: "live-delete",
    note: "Deletes member-scoped usage rows. Already-submitted external billing/metering data may remain under vendor retention.",
  },
  {
    slug: "prisma.hosted_ai_usage_period",
    label: "AI usage allowance period rows",
    deletion: "live-delete",
    note: "Deletes member-scoped included-allowance spend aggregates used by the hosted AI usage gate.",
  },
  {
    slug: "prisma.hosted_product_feedback",
    label: "Hosted product feedback rows",
    deletion: "live-delete",
    note: "Deletes assistant-captured product feedback rows. Export includes safe kind/summary metadata and optional published changelog item ids while omitting the internal feedback id.",
  },
  {
    slug: "prisma.hosted_linq_daily_state",
    label: "Linq daily message counters",
    deletion: "live-delete",
    note: "Deletes member-scoped Linq daily inbound/outbound quota counters.",
  },
  {
    slug: "prisma.hosted_invite",
    label: "Hosted invite records",
    deletion: "live-delete",
    note: "Deletes invite codes and channel metadata owned by the member.",
  },
  {
    slug: "prisma.hosted_ops_onboarding_voice_memo_send",
    label: "Ops onboarding voice memo send claims",
    deletion: "live-delete",
    note: "Deletes member-scoped ops onboarding voice memo replay claims. Export reports counts only and omits Linq chat lookup keys.",
  },
  {
    slug: "prisma.hosted_consent_event",
    label: "Hosted consent event records",
    deletion: "live-delete",
    note: "Deletes member-scoped consent audit events before the member row; export includes scope/action/version metadata without secrets.",
  },
  {
    slug: "prisma.hosted_consent_grant",
    label: "Hosted consent grant records",
    deletion: "live-delete",
    note: "Deletes the member's current consent grants before the member row; export includes scope/status/version metadata.",
  },
  {
    slug: "prisma.hosted_vault_share",
    label: "Hosted vault share grants",
    deletion: "live-delete",
    note: "Deleted in the same transaction by the hosted_member FK cascade when either the grantor or destination member row is removed; export includes share rows where the member is grantor or destination.",
  },
  {
    slug: "prisma.hosted_thread_container",
    label: "Hosted external-thread container marker",
    deletion: "live-delete",
    note: "Deletes the marker, owner authority, and monthly usage allowance cap that allow an owned hosted runtime to receive explicit external-thread routes.",
  },
  {
    slug: "prisma.hosted_thread_route",
    label: "Hosted external-thread routes",
    deletion: "live-delete",
    note: "Deletes channel/thread blind-index routes for the member and owned thread-container runtimes. Export reports counts and omits raw external thread ids.",
  },
  {
    slug: "prisma.device_connection",
    label: "Device provider connections and tokens",
    deletion: "live-delete",
    note: "Best-effort provider revocation runs first, then connection rows and encrypted tokens are deleted.",
  },
  {
    slug: "prisma.hosted_connected_apps_session",
    label: "Connected-app Tool Router sessions",
    deletion: "live-delete",
    note: "Revokes provider access through Composio before local Tool Router session references are deleted.",
  },
  {
    slug: "prisma.hosted_connected_app_connect_intent",
    label: "Connected-app connection intents",
    deletion: "live-delete",
    note: "Deletes short-lived connected-app connection claims and account ids after provider revocation has been attempted.",
  },
  {
    slug: "prisma.device_sync_dirty_connection",
    label: "Device sync dirty state",
    deletion: "live-delete",
    note: "Deletes pending per-connection dirty sync metadata before device connection rows so deletion does not rely on cascades.",
  },
  {
    slug: "prisma.device_sync_dirty_payload",
    label: "Device sync dirty payload rows",
    deletion: "live-delete",
    note: "Deletes pending provider payload jobs before dirty-state and connection rows so raw provider payload retention is bounded.",
  },
  {
    slug: "prisma.device_token_audit",
    label: "Device token audit rows",
    deletion: "live-delete",
    note: "Deletes token audit history by user before device connection rows are removed.",
  },
  {
    slug: "prisma.device_sync_signal",
    label: "Device sync signal rows",
    deletion: "live-delete",
    note: "Deletes pre-existing per-user wake/sync signal history. Deletion-time provider revocation does not enqueue new disconnect or wake work.",
  },
  {
    slug: "prisma.device_oauth_session",
    label: "Device OAuth sessions",
    deletion: "live-delete",
    note: "Deletes pending provider OAuth state rows for the member.",
  },
  {
    slug: "prisma.device_connect_intent",
    label: "Hosted device connect intents",
    deletion: "live-delete",
    note: "Deletes short-lived hosted wearable connection claims for the member.",
  },
  {
    slug: "prisma.device_agent_session",
    label: "Local device agent sessions",
    deletion: "live-delete",
    note: "Deletes agent bearer-token hashes and session metadata for local device sync agents.",
  },
  {
    slug: "prisma.device_browser_assertion_nonce",
    label: "Device browser assertion nonces",
    deletion: "live-delete",
    note: "Deletes outstanding browser assertion nonces for the member.",
  },
  {
    slug: "prisma.hosted_web_internal_request_nonce",
    label: "Hosted web internal request nonces",
    deletion: "live-delete",
    note: "Deletes per-user internal anti-replay nonces.",
  },
  {
    slug: "prisma.device_webhook_trace",
    label: "Provider webhook trace rows",
    deletion: "live-delete",
    note: "Deletes webhook trace rows for provider accounts linked to the member's device connections when linkage is available. User export omits trace rows and trace counts until the minimized webhook trace model has a safe user linkage.",
  },
  {
    slug: "cloudflare.runner_durable_object",
    label: "Cloudflare runner Durable Object state",
    deletion: "best-effort-delete",
    note: "Best-effort call to hosted execution control clears user runner SQL state and alarms when Cloudflare control is configured.",
  },
  {
    slug: "cloudflare.r2_user_artifacts",
    label: "Cloudflare R2 user bundles, vault replicas, artifacts, runner secrets, and raw email",
    deletion: "best-effort-delete",
    note: "Best-effort hosted execution control deletes opaque per-user runtime and ingress R2 objects when web-hosted domain root context is available. Root envelopes are canonical in web Postgres.",
  },
  {
    slug: "temporal.per_user_runtime_workflow",
    label: "Hosted per-user Temporal runtime workflow",
    deletion: "best-effort-delete",
    note: "Best-effort Temporal termination neutralizes sleeping per-user workflow flags and runtime-result wake state after account deletion commits.",
  },
  {
    slug: "providers.oura_whoop_strava",
    label: "Oura, WHOOP, and Strava provider revocation",
    deletion: "best-effort-delete",
    note: "Uses the existing provider revokeAccess hook where configured before deleting local tokens. Wearable sources without a provider-side revocation hook are deleted locally unless source-side revocation is implemented.",
  },
  {
    slug: "providers.composio_connected_apps",
    label: "Composio connected-app provider revocation",
    deletion: "best-effort-delete",
    note: "Lists connected accounts owned by the hosted member and calls Composio provider revocation before local ownership state is deleted.",
  },
  {
    slug: "providers.linq_telegram_email_messages",
    label: "Linq, Telegram, and email message data",
    deletion: "local-reference-delete",
    note: "Deletes Murph-hosted mailbox/routing records. It does not delete copies already stored in external carrier, Telegram, Linq, or email provider systems.",
  },
  {
    slug: "providers.stripe_privy",
    label: "Stripe and Privy vendor accounts",
    deletion: "best-effort-delete",
    note: "Cancels the Stripe subscription before local deletion (fail-closed), then deletes the Stripe customer and Privy user after local rows are removed; results are reported in the deletion result.",
  },
  {
    slug: "backups",
    label: "Backups and restore media",
    deletion: "documented-retention",
    note: "Live data is deleted immediately. Backup copies age out under infrastructure retention and must not be restored except under documented recovery controls.",
  },
] as const satisfies readonly HostedAccountDataStoreCoverageEntry[];

export type HostedAccountDataStoreSlug = typeof HOSTED_ACCOUNT_DATA_STORE_COVERAGE[number]["slug"];

export interface HostedAccountDeletionRequest {
  confirmationPhrase: typeof HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE;
}

export interface HostedAccountDataCounts {
  [key: string]: number;
}

export type HostedAccountProviderRevocationStatus =
  | "not_needed"
  | "revoked"
  | "warning"
  | "failed"
  | "skipped_not_configured";

export interface HostedAccountProviderRevocationResult {
  connectionId: string;
  errorCode: string | null;
  providerLabel: string;
  status: HostedAccountProviderRevocationStatus;
  warningCode: string | null;
}

export type HostedAccountVendorDeletionStatus =
  | "completed"
  | "failed"
  | "skipped_no_record"
  | "skipped_not_configured";

export interface HostedAccountVendorDeletionResult {
  errorCode: string | null;
  status: HostedAccountVendorDeletionStatus;
}

export interface HostedAccountVendorAccountDeletions {
  privyUser: HostedAccountVendorDeletionResult;
  stripeCustomer: HostedAccountVendorDeletionResult;
  stripeSubscription: HostedAccountVendorDeletionResult;
}

export interface HostedAccountDeletionResult {
  cloudflare: HostedRunnerUserDataDeletionBestEffortResult;
  deletedAt: string;
  deletedCounts: HostedAccountDataCounts;
  memberId: string;
  providerRevocations: HostedAccountProviderRevocationResult[];
  retentionNotes: readonly string[];
  schema: typeof HOSTED_ACCOUNT_DATA_DELETION_SCHEMA;
  vendorAccounts: HostedAccountVendorAccountDeletions;
}

type HostedAccountDataPrisma = PrismaClient | Prisma.TransactionClient;

type DeviceConnectionIdentity = {
  id: string;
  provider: string;
  providerAccountBlindIndex: string;
  sources: readonly {
    sourceProviderSlug: string;
    status: string;
  }[];
};

type HostedAccountDeletionDatabaseResult = {
  deletedCounts: HostedAccountDataCounts;
  deletedRuntimeMemberIds: readonly string[];
};

const HOSTED_ACCOUNT_RETENTION_NOTES = [
  "Messages already delivered to external carrier, Telegram, email, or Linq systems are not recalled from those services.",
  "Stripe retains records it is legally required to keep, such as invoices, under its documented processes.",
  "Infrastructure backups age out automatically under documented retention and are never restored into live systems.",
] as const;

export function parseHostedAccountDeletionRequest(
  body: Record<string, unknown>,
): HostedAccountDeletionRequest {
  if (body.confirmationPhrase !== HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_CONFIRMATION_PHRASE_REQUIRED",
      httpStatus: 400,
      message: `Type ${HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE} exactly to delete your account.`,
    });
  }

  return {
    confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
  };
}

export async function deleteHostedAccountData(input: {
  memberId: string;
  prisma: PrismaClient;
  request: Request;
}): Promise<HostedAccountDeletionResult> {
  const member = await input.prisma.hostedMember.findUnique({
    select: { id: true },
    where: { id: input.memberId },
  });

  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Your hosted member record was not found.",
    });
  }

  // Decrypt vendor account ids before their rows are deleted below.
  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const identity = await readHostedMemberIdentity({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const stripeCustomerId = billingRef?.stripeCustomerId ?? null;
  const stripeSubscriptionId = billingRef?.stripeSubscriptionId ?? null;
  const privyUserId = identity?.privyUserId ?? null;
  const ownedThreadContainerMemberIds = await listOwnedHostedThreadContainerMemberIds({
    ownerMemberId: input.memberId,
    prisma: input.prisma,
  });
  const deletionMemberIds = uniqueStrings([
    input.memberId,
    ...ownedThreadContainerMemberIds,
  ]);

  const deletionStartedAt = new Date();
  await markHostedMembersSuspendedForAccountDeletion({
    memberIds: deletionMemberIds,
    now: deletionStartedAt,
    prisma: input.prisma,
  });
  await Promise.all(deletionMemberIds.map((memberId) =>
    terminateHostedUserRuntimeWorkflowBestEffort({
      reason: "account-deleted",
      userId: memberId,
    }),
  ));
  const providerRevocationConnectionIdentities = await listDeviceConnectionIdentities({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const deviceProviderRevocations = await revokeDeviceProvidersBestEffort({
    connections: providerRevocationConnectionIdentities,
    memberId: input.memberId,
    request: input.request,
  });
  const connectedAppProviderCleanupStartedAt = new Date();
  const connectedAppRevocations = await revokeConnectedAppsBestEffort({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const providerRevocations = [
    ...deviceProviderRevocations,
    ...connectedAppRevocations,
  ];
  assertProviderRevocationsAllowDeletion(providerRevocations);
  // Cancel the subscription before local rows are deleted and fail closed:
  // a deleted account must never keep an active Stripe subscription billing it.
  const stripeSubscription = await cancelHostedStripeSubscriptionForAccountDeletion({
    memberId: input.memberId,
    stripeSubscriptionId,
  });
  for (const memberId of deletionMemberIds) {
    await deleteHostedComputerUseExternalStateForAccountDeletion({
      memberId,
      prisma: input.prisma,
    });
  }
  const databaseDeletion: HostedAccountDeletionDatabaseResult = await input.prisma.$transaction(async (tx) => {
    const transactionDeletionMemberIds = uniqueStrings([
      input.memberId,
      ...await listOwnedHostedThreadContainerMemberIds({
        ownerMemberId: input.memberId,
        prisma: tx,
      }),
    ]);

    for (const memberId of transactionDeletionMemberIds) {
      await lockHostedMemberForAccountDeletionTx({
        memberId,
        prisma: tx,
      });
    }
    await refreshHostedMembersAccountDeletionFenceTx({
      memberIds: transactionDeletionMemberIds,
      now: deletionStartedAt,
      prisma: tx,
    });
    await assertNoConnectedAppWritesAfterProviderCleanupTx({
      memberId: input.memberId,
      providerCleanupStartedAt: connectedAppProviderCleanupStartedAt,
      prisma: tx,
    });
    for (const memberId of transactionDeletionMemberIds) {
      await lockHostedComputerUseRowsForAccountDeletionTx({
        memberId,
        prisma: tx,
      });
    }
    const deviceConnectionIdentities = await listDeviceConnectionIdentities({
      memberId: input.memberId,
      prisma: tx,
    });
    await lockDeviceWebhookTraceOwnersForAccountDeletionTx({
      connectionIdentities: deviceConnectionIdentities,
      prisma: tx,
    });
    const deletedCounts = await deleteHostedAccountPrismaRows({
      connectionIdentities: deviceConnectionIdentities,
      memberIds: transactionDeletionMemberIds,
      prisma: tx,
    });

    return {
      deletedCounts,
      deletedRuntimeMemberIds: transactionDeletionMemberIds,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  const deletedCounts = databaseDeletion.deletedCounts;
  const deletedRuntimeMemberIds = databaseDeletion.deletedRuntimeMemberIds.length > 0
    ? databaseDeletion.deletedRuntimeMemberIds
    : deletionMemberIds;
  const cloudflare = await deleteHostedRunnerUserDataForAccountDeletion({
    memberIds: deletedRuntimeMemberIds,
  });
  await Promise.all(deletedRuntimeMemberIds.map((memberId) =>
    terminateHostedUserRuntimeWorkflowBestEffort({
      reason: "account-deleted",
      userId: memberId,
    }),
  ));
  // Local rows are gone and the subscription is already canceled, so vendor
  // account deletion is best effort and reported instead of fail-closed.
  const stripeCustomer = await deleteHostedStripeCustomerBestEffort({
    memberId: input.memberId,
    stripeCustomerId,
  });
  const privyUser = await deleteHostedPrivyUserBestEffort({
    memberId: input.memberId,
    privyUserId,
  });

  return {
    cloudflare,
    deletedAt: new Date().toISOString(),
    deletedCounts,
    memberId: input.memberId,
    providerRevocations,
    retentionNotes: HOSTED_ACCOUNT_RETENTION_NOTES,
    schema: HOSTED_ACCOUNT_DATA_DELETION_SCHEMA,
    vendorAccounts: {
      privyUser,
      stripeCustomer,
      stripeSubscription,
    },
  };
}

async function deleteHostedComputerUseExternalStateForAccountDeletion(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  try {
    await new ComputerUseService({
      store: new PrismaComputerUseStore(input.prisma),
    }).deleteMemberExternalStateForAccountDeletion({
      memberId: input.memberId,
    });
  } catch (error) {
    const cleanupErrorCode = safeErrorCode(error);
    const memberId = input.memberId;
    console.error(
      `[hosted-privacy] Computer-use cleanup failed during account deletion (memberId=${memberId}, errorCode=${cleanupErrorCode}).`,
    );
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_COMPUTER_USE_CLEANUP_FAILED",
      httpStatus: 502,
      message: "We could not delete your active browser automation sessions. Retry account deletion, or contact support if it keeps failing.",
      retryable: true,
    });
  }
}

async function listOwnedHostedThreadContainerMemberIds(input: {
  ownerMemberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<string[]> {
  const rows = await input.prisma.hostedThreadContainer.findMany({
    orderBy: { memberId: "asc" },
    select: { memberId: true },
    where: { ownerMemberId: input.ownerMemberId },
  });

  return rows.map((row) => row.memberId);
}

async function deleteHostedRunnerUserDataForAccountDeletion(input: {
  memberIds: readonly string[];
}): Promise<HostedRunnerUserDataDeletionBestEffortResult> {
  const results = await Promise.all(input.memberIds.map((memberId) =>
    deleteHostedRunnerUserDataBestEffort({
      context: "settings.account-data.delete",
      userId: memberId,
    }),
  ));

  return mergeHostedRunnerUserDataDeletionResults(results);
}

function mergeHostedRunnerUserDataDeletionResults(
  results: readonly HostedRunnerUserDataDeletionBestEffortResult[],
): HostedRunnerUserDataDeletionBestEffortResult {
  if (results.length === 0) {
    return {
      alarmCleared: null,
      configured: false,
      deleted: false,
      errorCode: null,
      r2DeletedObjectCount: null,
      r2SkippedUserScopedPrefixes: null,
      r2Supported: null,
      r2UserScopedSkipReason: null,
      runnerStateDeleted: null,
    };
  }

  return {
    alarmCleared: mergeNullableBooleans(results.map((result) => result.alarmCleared)),
    configured: results.some((result) => result.configured),
    deleted: results.every((result) => result.deleted),
    errorCode: results.find((result) => result.errorCode)?.errorCode ?? null,
    r2DeletedObjectCount: sumNullableNumbers(
      results.map((result) => result.r2DeletedObjectCount),
    ),
    r2SkippedUserScopedPrefixes: mergeNullableAnyBooleans(
      results.map((result) => result.r2SkippedUserScopedPrefixes),
    ),
    r2Supported: mergeNullableBooleans(results.map((result) => result.r2Supported)),
    r2UserScopedSkipReason: results.find((result) => result.r2UserScopedSkipReason)
      ?.r2UserScopedSkipReason ?? null,
    runnerStateDeleted: mergeNullableBooleans(
      results.map((result) => result.runnerStateDeleted),
    ),
  };
}

function mergeNullableBooleans(values: readonly (boolean | null)[]): boolean | null {
  const present = values.filter((value): value is boolean => value !== null);
  return present.length === 0 ? null : present.every(Boolean);
}

function mergeNullableAnyBooleans(values: readonly (boolean | null)[]): boolean | null {
  const present = values.filter((value): value is boolean => value !== null);
  return present.length === 0 ? null : present.some(Boolean);
}

function sumNullableNumbers(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0
    ? null
    : present.reduce((sum, value) => sum + value, 0);
}

async function markHostedMembersSuspendedForAccountDeletion(input: {
  memberIds: readonly string[];
  now: Date;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.$transaction(async (tx) => {
    for (const memberId of input.memberIds) {
      await lockHostedMemberForAccountDeletionTx({
        memberId,
        prisma: tx,
      });
    }
    await tx.hostedMember.updateMany({
      data: {
        suspendedAt: input.now,
      },
      where: {
        id: buildStringInFilter(input.memberIds),
        suspendedAt: null,
      },
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function refreshHostedMembersAccountDeletionFenceTx(input: {
  memberIds: readonly string[];
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await input.prisma.hostedMember.updateMany({
    data: {
      suspendedAt: input.now,
    },
    where: {
      id: buildStringInFilter(input.memberIds),
    },
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function buildStringInFilter(values: readonly string[]): string | { in: string[] } {
  const uniqueValues = uniqueStrings(values);
  if (uniqueValues.length === 1) {
    return uniqueValues[0]!;
  }
  return { in: uniqueValues };
}

async function assertNoConnectedAppWritesAfterProviderCleanupTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  providerCleanupStartedAt: Date;
}): Promise<void> {
  const writes = await input.prisma.hostedConnectedAppConnectIntent.findMany({
    select: { claimHash: true },
    take: 1,
    where: {
      expiresAt: { gt: new Date() },
      memberId: input.memberId,
      startedAt: { gte: input.providerCleanupStartedAt },
    },
  });
  if (writes.length === 0) {
    return;
  }

  throw hostedOnboardingError({
    code: "ACCOUNT_DELETION_CONNECTED_APP_WRITE_IN_PROGRESS",
    httpStatus: 503,
    message: "A connected-app connection changed during account deletion. Retry account deletion before local account records are removed.",
    retryable: true,
  });
}

async function cancelHostedStripeSubscriptionForAccountDeletion(input: {
  memberId: string;
  stripeSubscriptionId: string | null;
}): Promise<HostedAccountVendorDeletionResult> {
  if (!input.stripeSubscriptionId) {
    return { errorCode: null, status: "skipped_no_record" };
  }

  const stripe = getHostedOnboardingStripe();
  if (!stripe) {
    // Fail closed: a subscription reference exists, so proceeding without a
    // Stripe client could leave a deleted account with an active subscription.
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_STRIPE_NOT_CONFIGURED",
      httpStatus: 500,
      message: "Billing is not configured, so your subscription could not be canceled. Contact support to delete your account.",
    });
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(input.stripeSubscriptionId);
    // canceled and incomplete_expired are terminal states Stripe refuses to cancel again.
    if (subscription.status !== "canceled" && subscription.status !== "incomplete_expired") {
      await stripe.subscriptions.cancel(input.stripeSubscriptionId);
    }
    return { errorCode: null, status: "completed" };
  } catch (error) {
    if (isStripeResourceMissingError(error)) {
      return { errorCode: null, status: "skipped_no_record" };
    }

    const cancelErrorCode = safeErrorCode(error);
    const memberId = input.memberId;
    console.error(
      `[hosted-privacy] Stripe subscription cancel failed during account deletion (memberId=${memberId}, errorCode=${cancelErrorCode}).`,
    );
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_STRIPE_SUBSCRIPTION_CANCEL_FAILED",
      httpStatus: 502,
      message: "We could not cancel your subscription. Retry account deletion, or contact support if it keeps failing.",
      retryable: true,
    });
  }
}

async function deleteHostedStripeCustomerBestEffort(input: {
  memberId: string;
  stripeCustomerId: string | null;
}): Promise<HostedAccountVendorDeletionResult> {
  if (!input.stripeCustomerId) {
    return { errorCode: null, status: "skipped_no_record" };
  }

  const stripe = getHostedOnboardingStripe();
  if (!stripe) {
    return { errorCode: null, status: "skipped_not_configured" };
  }

  try {
    await stripe.customers.del(input.stripeCustomerId);
    return { errorCode: null, status: "completed" };
  } catch (error) {
    if (isStripeResourceMissingError(error)) {
      return { errorCode: null, status: "skipped_no_record" };
    }

    const stripeErrorCode = safeErrorCode(error);
    const memberId = input.memberId;
    console.error(
      `[hosted-privacy] Stripe customer deletion failed after account deletion (memberId=${memberId}, errorCode=${stripeErrorCode}).`,
    );
    return { errorCode: stripeErrorCode, status: "failed" };
  }
}

async function deleteHostedPrivyUserBestEffort(input: {
  memberId: string;
  privyUserId: string | null;
}): Promise<HostedAccountVendorDeletionResult> {
  if (!input.privyUserId) {
    return { errorCode: null, status: "skipped_no_record" };
  }

  try {
    const deleted = await deleteHostedPrivyUser(input.privyUserId);
    return deleted
      ? { errorCode: null, status: "completed" }
      : { errorCode: null, status: "skipped_not_configured" };
  } catch (error) {
    const privyErrorCode = safeErrorCode(error);
    const memberId = input.memberId;
    console.error(
      `[hosted-privacy] Privy user deletion failed after account deletion (memberId=${memberId}, errorCode=${privyErrorCode}).`,
    );
    return { errorCode: privyErrorCode, status: "failed" };
  }
}

function isStripeResourceMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const type = Reflect.get(error, "type");
  return Reflect.get(error, "code") === "resource_missing"
    && typeof type === "string"
    && type.startsWith("Stripe");
}

async function countHostedAccountData(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<HostedAccountDataCounts> {
  const memberId = input.memberId;
  const memberIds = uniqueStrings([
    memberId,
    ...await listOwnedHostedThreadContainerMemberIds({
      ownerMemberId: memberId,
      prisma: input.prisma,
    }),
  ]);
  const memberIdFilter = buildStringInFilter(memberIds);
  const [
    hostedMember,
    hostedWebSession,
    hostedMemberIdentity,
    hostedMemberRouting,
    hostedMemberBillingRef,
    hostedMemberEmailAuthorization,
    hostedConnectedAppsSession,
    hostedConnectedAppConnectIntent,
    hostedMailboxItem,
    hostedMailboxPayload,
    hostedMailboxLaneCounter,
    hostedIngressLatencyTrace,
    hostedWorkspace,
    hostedComputerRun,
    hostedComputerHandoff,
    hostedUserCryptoEnvelope,
    hostedUserCryptoAudit,
    hostedInvite,
    hostedOpsOnboardingVoiceMemoSend,
    hostedConsentEvent,
    hostedConsentGrant,
    hostedVaultShare,
    hostedThreadContainer,
    hostedThreadRoute,
    hostedAiUsage,
    hostedAiUsagePeriod,
    hostedProductFeedback,
    hostedLinqDailyState,
    deviceConnection,
    deviceSyncDirtyConnection,
    deviceSyncDirtyPayload,
    deviceTokenAudit,
    deviceOauthSession,
    deviceConnectIntent,
    deviceSyncSignal,
    deviceAgentSession,
    deviceBrowserAssertionNonce,
    hostedWebInternalRequestNonce,
  ] = await Promise.all([
    input.prisma.hostedMember.count({ where: { id: memberIdFilter } }),
    input.prisma.hostedWebSession.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedMemberIdentity.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedMemberRouting.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedMemberBillingRef.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedMemberEmailAuthorization.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedConnectedAppsSession.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedConnectedAppConnectIntent.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedMailboxItem.count({ where: { userId: memberIdFilter } }),
    input.prisma.hostedMailboxPayload.count({ where: { userId: memberIdFilter } }),
    input.prisma.hostedMailboxLaneCounter.count({ where: { userId: memberIdFilter } }),
    input.prisma.hostedIngressLatencyTrace.count({ where: { userId: memberIdFilter } }),
    input.prisma.hostedWorkspace.count({ where: { userId: memberIdFilter } }),
    input.prisma.hostedComputerRun.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedComputerHandoff.count({ where: { memberId: memberIdFilter } }),
    countHostedUserCryptoEnvelopeRows(input.prisma, memberIds),
    countHostedUserCryptoAuditRows(input.prisma, memberIds),
    input.prisma.hostedInvite.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedOpsOnboardingVoiceMemoSend.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedConsentEvent.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedConsentGrant.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedVaultShare.count({
      where: {
        OR: [
          { grantorMemberId: memberIdFilter },
          { destinationMemberId: memberIdFilter },
        ],
      },
    }),
    input.prisma.hostedThreadContainer.count({
      where: {
        OR: [
          { memberId: memberIdFilter },
          { ownerMemberId: memberIdFilter },
        ],
      },
    }),
    input.prisma.hostedThreadRoute.count({
      where: {
        OR: [
          { containerMemberId: memberIdFilter },
          { container: { ownerMemberId: memberIdFilter } },
        ],
      },
    }),
    input.prisma.hostedAiUsage.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedAiUsagePeriod.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedProductFeedback.count({ where: { memberId: memberIdFilter } }),
    input.prisma.hostedLinqDailyState.count({ where: { memberId: memberIdFilter } }),
    input.prisma.deviceConnection.count({ where: { userId: memberIdFilter } }),
    input.prisma.deviceSyncDirtyConnection.count({ where: { userId: memberIdFilter } }),
    input.prisma.deviceSyncDirtyPayload.count({ where: { userId: memberIdFilter } }),
    input.prisma.deviceTokenAudit.count({ where: { userId: memberIdFilter } }),
    input.prisma.deviceOauthSession.count({ where: { userId: memberIdFilter } }),
    input.prisma.deviceConnectIntent.count({ where: { memberId: memberIdFilter } }),
    input.prisma.deviceSyncSignal.count({ where: { userId: memberIdFilter } }),
    input.prisma.deviceAgentSession.count({ where: { userId: memberIdFilter } }),
    input.prisma.deviceBrowserAssertionNonce.count({ where: { userId: memberIdFilter } }),
    input.prisma.hostedWebInternalRequestNonce.count({ where: { userId: memberIdFilter } }),
  ]);

  return {
    "prisma.device_agent_session": deviceAgentSession,
    "prisma.device_browser_assertion_nonce": deviceBrowserAssertionNonce,
    "prisma.device_connection": deviceConnection,
    "prisma.device_connect_intent": deviceConnectIntent,
    "prisma.device_oauth_session": deviceOauthSession,
    "prisma.device_sync_dirty_connection": deviceSyncDirtyConnection,
    "prisma.device_sync_dirty_payload": deviceSyncDirtyPayload,
    "prisma.device_sync_signal": deviceSyncSignal,
    "prisma.device_token_audit": deviceTokenAudit,
    "prisma.hosted_ai_usage": hostedAiUsage,
    "prisma.hosted_ai_usage_period": hostedAiUsagePeriod,
    "prisma.hosted_product_feedback": hostedProductFeedback,
    "prisma.hosted_consent_event": hostedConsentEvent,
    "prisma.hosted_consent_grant": hostedConsentGrant,
    "prisma.hosted_connected_app_connect_intent": hostedConnectedAppConnectIntent,
    "prisma.hosted_connected_apps_session": hostedConnectedAppsSession,
    "prisma.hosted_computer_handoff": hostedComputerHandoff,
    "prisma.hosted_computer_run": hostedComputerRun,
    "prisma.hosted_invite": hostedInvite,
    "prisma.hosted_ingress_latency_trace": hostedIngressLatencyTrace,
    "prisma.hosted_linq_daily_state": hostedLinqDailyState,
    "prisma.hosted_mailbox_item": hostedMailboxItem,
    "prisma.hosted_mailbox_lane_counter": hostedMailboxLaneCounter,
    "prisma.hosted_mailbox_payload": hostedMailboxPayload,
    "prisma.hosted_member": hostedMember,
    "prisma.hosted_web_session": hostedWebSession,
    "prisma.hosted_member_billing_ref": hostedMemberBillingRef,
    "prisma.hosted_member_email_authorization": hostedMemberEmailAuthorization,
    "prisma.hosted_member_identity": hostedMemberIdentity,
    "prisma.hosted_member_routing": hostedMemberRouting,
    "prisma.hosted_ops_onboarding_voice_memo_send": hostedOpsOnboardingVoiceMemoSend,
    "prisma.hosted_thread_container": hostedThreadContainer,
    "prisma.hosted_thread_route": hostedThreadRoute,
    "prisma.hosted_user_crypto_audit": hostedUserCryptoAudit,
    "prisma.hosted_user_crypto_envelope": hostedUserCryptoEnvelope,
    "prisma.hosted_vault_share": hostedVaultShare,
    "prisma.hosted_web_internal_request_nonce": hostedWebInternalRequestNonce,
    "prisma.hosted_workspace": hostedWorkspace,
  };
}

async function deleteHostedAccountPrismaRows(input: {
  connectionIdentities: readonly DeviceConnectionIdentity[];
  memberIds: readonly string[];
  prisma: Prisma.TransactionClient;
}): Promise<HostedAccountDataCounts> {
  const memberIdFilter = buildStringInFilter(input.memberIds);
  const counts: HostedAccountDataCounts = {};
  const record = (key: string, result: { count: number }) => {
    counts[key] = result.count;
  };

  record("prisma.hosted_mailbox_payload", await input.prisma.hostedMailboxPayload.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_ingress_latency_trace", await input.prisma.hostedIngressLatencyTrace.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_mailbox_item", await input.prisma.hostedMailboxItem.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_mailbox_lane_counter", await input.prisma.hostedMailboxLaneCounter.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_runtime_log", await input.prisma.hostedRuntimeLog.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_user_crypto_audit", await deleteHostedUserCryptoAuditRows(input.prisma, input.memberIds));
  record("prisma.hosted_user_crypto_envelope", await deleteHostedUserCryptoEnvelopeRows(input.prisma, input.memberIds));
  record("prisma.hosted_ai_usage", await input.prisma.hostedAiUsage.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_ai_usage_period", await input.prisma.hostedAiUsagePeriod.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_product_feedback", await input.prisma.hostedProductFeedback.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_codex_auth_connection", await input.prisma.hostedCodexAuthConnection.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_linq_daily_state", await input.prisma.hostedLinqDailyState.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_invite", await input.prisma.hostedInvite.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_ops_onboarding_voice_memo_send", await input.prisma.hostedOpsOnboardingVoiceMemoSend.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_consent_event", await input.prisma.hostedConsentEvent.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_consent_grant", await input.prisma.hostedConsentGrant.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_workspace", await input.prisma.hostedWorkspace.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_computer_handoff", await input.prisma.hostedComputerHandoff.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_computer_run", await input.prisma.hostedComputerRun.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_member_email_authorization", await input.prisma.hostedMemberEmailAuthorization.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_member_billing_ref", await input.prisma.hostedMemberBillingRef.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_member_routing", await input.prisma.hostedMemberRouting.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_sensitive_action_challenge", await input.prisma.hostedSensitiveActionChallenge.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_web_session", await input.prisma.hostedWebSession.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_member_identity", await input.prisma.hostedMemberIdentity.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_thread_route", await input.prisma.hostedThreadRoute.deleteMany({
    where: {
      OR: [
        { containerMemberId: memberIdFilter },
        { container: { ownerMemberId: memberIdFilter } },
      ],
    },
  }));
  record("prisma.hosted_thread_container", await input.prisma.hostedThreadContainer.deleteMany({
    where: {
      OR: [
        { memberId: memberIdFilter },
        { ownerMemberId: memberIdFilter },
      ],
    },
  }));
  record("prisma.hosted_connected_app_connect_intent", await input.prisma.hostedConnectedAppConnectIntent.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_connected_apps_session", await input.prisma.hostedConnectedAppsSession.deleteMany({ where: { memberId: memberIdFilter } }));

  const webhookTraceWhere = buildDeviceWebhookTraceWhere(input.connectionIdentities);
  counts["prisma.device_webhook_trace"] = webhookTraceWhere
    ? (await input.prisma.deviceWebhookTrace.deleteMany({ where: webhookTraceWhere })).count
    : 0;
  record("prisma.device_token_audit", await input.prisma.deviceTokenAudit.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_sync_dirty_payload", await input.prisma.deviceSyncDirtyPayload.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_sync_dirty_connection", await input.prisma.deviceSyncDirtyConnection.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_sync_signal", await input.prisma.deviceSyncSignal.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_oauth_session", await input.prisma.deviceOauthSession.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_connect_intent", await input.prisma.deviceConnectIntent.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.device_agent_session", await input.prisma.deviceAgentSession.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_browser_assertion_nonce", await input.prisma.deviceBrowserAssertionNonce.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_web_internal_request_nonce", await input.prisma.hostedWebInternalRequestNonce.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_connection", await input.prisma.deviceConnection.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_member", await input.prisma.hostedMember.deleteMany({ where: { id: memberIdFilter } }));

  return counts;
}

async function countHostedUserCryptoEnvelopeRows(
  prisma: HostedAccountDataPrisma,
  memberIds: readonly string[],
): Promise<number> {
  const rows = await prisma.$queryRaw<RawCountRow[]>`
    SELECT COUNT(*)::bigint AS count
    FROM hosted_user_crypto_envelope
    WHERE user_id IN (${Prisma.join(memberIds)})
  `;
  return normalizeRawCount(rows[0]?.count);
}

async function countHostedUserCryptoAuditRows(
  prisma: HostedAccountDataPrisma,
  memberIds: readonly string[],
): Promise<number> {
  const rows = await prisma.$queryRaw<RawCountRow[]>`
    SELECT COUNT(*)::bigint AS count
    FROM hosted_user_crypto_audit
    WHERE user_id IN (${Prisma.join(memberIds)})
  `;
  return normalizeRawCount(rows[0]?.count);
}

async function deleteHostedUserCryptoEnvelopeRows(
  prisma: Prisma.TransactionClient,
  memberIds: readonly string[],
): Promise<{ count: number }> {
  const count = await prisma.$executeRaw`
    DELETE FROM hosted_user_crypto_envelope
    WHERE user_id IN (${Prisma.join(memberIds)})
  `;
  return { count };
}

async function deleteHostedUserCryptoAuditRows(
  prisma: Prisma.TransactionClient,
  memberIds: readonly string[],
): Promise<{ count: number }> {
  const count = await prisma.$executeRaw`
    DELETE FROM hosted_user_crypto_audit
    WHERE user_id IN (${Prisma.join(memberIds)})
  `;
  return { count };
}

type RawCountRow = {
  count: bigint | number | string | null;
};

function normalizeRawCount(value: RawCountRow["count"] | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    return Number(value);
  }
  return 0;
}

async function listDeviceConnectionIdentities(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<DeviceConnectionIdentity[]> {
  return input.prisma.deviceConnection.findMany({
    select: {
      id: true,
      provider: true,
      providerAccountBlindIndex: true,
      sources: {
        orderBy: [
          { status: "asc" },
          { sourceProviderSlug: "asc" },
        ],
        select: {
          sourceProviderSlug: true,
          status: true,
        },
      },
    },
    where: { userId: input.memberId },
  });
}

async function lockHostedMemberForAccountDeletionTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const rows = await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_member
    WHERE id = ${input.memberId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Your hosted member record was not found.",
    });
  }
}

async function lockHostedComputerUseRowsForAccountDeletionTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_computer_run
    WHERE member_id = ${input.memberId}
    ORDER BY id ASC
    FOR UPDATE
  `;
  await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_computer_handoff
    WHERE member_id = ${input.memberId}
    ORDER BY id ASC
    FOR UPDATE
  `;
}

async function lockDeviceWebhookTraceOwnersForAccountDeletionTx(input: {
  connectionIdentities: readonly DeviceConnectionIdentity[];
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const seenTraceOwners = new Set<string>();
  const traceOwners = input.connectionIdentities
    .filter((connection) => connection.providerAccountBlindIndex.length > 0)
    .map((connection) => ({
      provider: connection.provider,
      providerAccountBlindIndex: connection.providerAccountBlindIndex,
    }))
    .filter((traceOwner) => {
      const key = `${traceOwner.provider}:${traceOwner.providerAccountBlindIndex}`;
      if (seenTraceOwners.has(key)) {
        return false;
      }
      seenTraceOwners.add(key);
      return true;
    })
    .sort((left, right) =>
      `${left.provider}:${left.providerAccountBlindIndex}`
        .localeCompare(`${right.provider}:${right.providerAccountBlindIndex}`)
    );

  for (const traceOwner of traceOwners) {
    await acquireHostedWebhookTraceOwnerLockTx({
      prisma: input.prisma,
      provider: traceOwner.provider,
      providerAccountBlindIndex: traceOwner.providerAccountBlindIndex,
    });
  }
}

function resolveDeviceConnectionProviderLabel(connection: {
  metadataJson?: Prisma.JsonValue | null;
  provider: string;
  sources?: readonly {
    sourceProviderSlug: string;
    status: string;
  }[];
}): string {
  return resolveHostedDeviceSyncBrowserProviderLabel({
    metadata: connection.metadataJson,
    provider: connection.provider,
    upstreamSources: connection.sources ?? [],
  });
}

async function revokeDeviceProvidersBestEffort(input: {
  connections: readonly DeviceConnectionIdentity[];
  memberId: string;
  request: Request;
}): Promise<HostedAccountProviderRevocationResult[]> {
  if (input.connections.length === 0) {
    return [];
  }

  let controlPlane: ReturnType<typeof createHostedDeviceSyncControlPlane>;
  try {
    controlPlane = createHostedDeviceSyncControlPlane(input.request);
  } catch (error) {
    return input.connections.map((connection) => ({
      connectionId: connection.id,
      errorCode: safeErrorCode(error),
      providerLabel: resolveDeviceConnectionProviderLabel(connection),
      status: "skipped_not_configured",
      warningCode: null,
    }));
  }

  const results: HostedAccountProviderRevocationResult[] = [];
  for (const connection of input.connections) {
    try {
      const storedAccount = await controlPlane.store.getStoredConnectionAccountForUser(
        input.memberId,
        connection.id,
      );

      if (!storedAccount) {
        results.push({
          connectionId: connection.id,
          errorCode: null,
          providerLabel: resolveDeviceConnectionProviderLabel(connection),
          status: "warning",
          warningCode: "CONNECTION_SECRET_MISSING",
        });
        continue;
      }

      const provider = controlPlane.registry.get(connection.provider);
      const revokeAccess = provider?.connectionHandler?.revokeAccess;

      if (!revokeAccess) {
        results.push({
          connectionId: connection.id,
          errorCode: storedAccount.credential.kind === "provider_config"
            ? "PROVIDER_REVOKE_NOT_CONFIGURED"
            : null,
          providerLabel: resolveDeviceConnectionProviderLabel(connection),
          status: storedAccount.credential.kind === "provider_config" ? "failed" : "not_needed",
          warningCode: null,
        });
        continue;
      }

      await revokeAccess(storedAccount);
      results.push({
        connectionId: connection.id,
        errorCode: null,
        providerLabel: resolveDeviceConnectionProviderLabel(connection),
        status: "revoked",
        warningCode: null,
      });
    } catch (error) {
      results.push({
        connectionId: connection.id,
        errorCode: safeErrorCode(error),
        providerLabel: resolveDeviceConnectionProviderLabel(connection),
        status: "failed",
        warningCode: null,
      });
    }
  }

  return results;
}

async function revokeConnectedAppsBestEffort(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<HostedAccountProviderRevocationResult[]> {
  const inFlightIntents = await listInFlightConnectedAppIntentsForDeletion(input);
  if (inFlightIntents.some((intent) => !intent.connectedAccountId)) {
    return [{
      connectionId: "composio_connected_app_connection_in_progress",
      errorCode: "CONNECTED_APP_CONNECTION_IN_PROGRESS",
      providerLabel: "Connected apps",
      status: "failed",
      warningCode: null,
    }];
  }

  const session = await input.prisma.hostedConnectedAppsSession.findUnique({
    select: { memberId: true },
    where: { memberId: input.memberId },
  });
  const inFlightAccountIds = inFlightIntents
    .map((intent) => intent.connectedAccountId)
    .filter((accountId): accountId is string => !!accountId);
  if (!session && inFlightAccountIds.length === 0) {
    return [];
  }

  let accounts: ComposioConnectedAccount[];
  let client: ReturnType<typeof createComposioConnectedAppsClient>;
  try {
    const config = readHostedConnectedAppsConfig();
    client = createComposioConnectedAppsClient({ config });
    accounts = await client.listAccounts({
      statuses: null,
      toolkits: null,
      userId: input.memberId,
    });
  } catch (error) {
    return [{
      connectionId: "composio_connected_apps",
      errorCode: safeErrorCode(error),
      providerLabel: "Connected apps",
      status: "failed",
      warningCode: null,
    }];
  }

  const results: HostedAccountProviderRevocationResult[] = [];
  const listedAccountIds = new Set(accounts.map((account) => account.id));
  for (const account of accounts.filter(isComposioAccountDeletable)) {
    let status: HostedAccountProviderRevocationStatus = "not_needed";
    let warningCode: string | null = null;

    try {
      if (isComposioAccountRevokable(account)) {
        try {
          await client.disconnectAccount(account.id);
          status = "revoked";
        } catch (error) {
          if (!isNonBlockingComposioRevokeError(error)) {
            results.push({
              connectionId: account.id,
              errorCode: safeErrorCode(error),
              providerLabel: formatConnectedAppProviderLabel(account),
              status: "failed",
              warningCode: null,
            });
            continue;
          }
          status = "warning";
          warningCode = safeErrorCode(error);
        }
      }

      await client.deleteAccount(account.id);
      results.push({
        connectionId: account.id,
        errorCode: null,
        providerLabel: formatConnectedAppProviderLabel(account),
        status,
        warningCode,
      });
    } catch (error) {
      results.push({
        connectionId: account.id,
        errorCode: safeErrorCode(error),
        providerLabel: formatConnectedAppProviderLabel(account),
        status: "failed",
        warningCode: null,
      });
    }
  }

  for (const intent of inFlightIntents) {
    if (!intent.connectedAccountId || listedAccountIds.has(intent.connectedAccountId)) {
      continue;
    }
    try {
      await client.deleteAccount(intent.connectedAccountId);
      results.push({
        connectionId: intent.connectedAccountId,
        errorCode: null,
        providerLabel: formatConnectedAppIntentProviderLabel(intent),
        status: "not_needed",
        warningCode: null,
      });
    } catch (error) {
      results.push({
        connectionId: intent.connectedAccountId,
        errorCode: safeErrorCode(error),
        providerLabel: formatConnectedAppIntentProviderLabel(intent),
        status: "failed",
        warningCode: null,
      });
    }
  }

  return results;
}

async function listInFlightConnectedAppIntentsForDeletion(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<Array<{
  alias: string | null;
  connectedAccountId: string | null;
  toolkit: string;
}>> {
  const now = new Date();
  return await input.prisma.hostedConnectedAppConnectIntent.findMany({
    select: {
      alias: true,
      connectedAccountId: true,
      toolkit: true,
    },
    where: {
      completedAt: null,
      expiresAt: { gt: now },
      memberId: input.memberId,
      startedAt: { not: null },
    },
  });
}

function isComposioAccountDeletable(account: ComposioConnectedAccount): boolean {
  return account.status.toUpperCase() !== "DELETED";
}

function isComposioAccountRevokable(account: ComposioConnectedAccount): boolean {
  return account.status.toUpperCase() === "ACTIVE";
}

function isNonBlockingComposioRevokeError(error: unknown): boolean {
  return error instanceof ComposioConnectedAppsRequestError
    && (error.status === 400 || error.status === 409);
}

function formatConnectedAppProviderLabel(account: ComposioConnectedAccount): string {
  const label = account.toolkit.name
    || formatHostedConnectedAppToolkitLabel(account.toolkit.slug);
  const qualifier = account.alias ?? account.wordId;
  return qualifier ? `${label} (${qualifier})` : label;
}

function formatConnectedAppIntentProviderLabel(input: {
  alias: string | null;
  toolkit: string;
}): string {
  const label = formatHostedConnectedAppToolkitLabel(input.toolkit);
  return input.alias ? `${label} (${input.alias})` : label;
}

function assertProviderRevocationsAllowDeletion(
  providerRevocations: readonly HostedAccountProviderRevocationResult[],
): void {
  const failures = providerRevocations.filter((revocation) => revocation.status === "failed");

  if (failures.length === 0) {
    return;
  }

  throw hostedOnboardingError({
    code: "ACCOUNT_DELETION_PROVIDER_REVOKE_FAILED",
    httpStatus: 503,
    message: "Provider access could not be revoked. Retry account deletion before local device records are removed.",
    retryable: true,
    details: {
      providerRevocations: failures.map((failure) => ({
        errorCode: failure.errorCode,
        providerLabel: failure.providerLabel,
      })),
    },
  });
}

function buildDeviceWebhookTraceWhere(
  connections: readonly DeviceConnectionIdentity[],
): Prisma.DeviceWebhookTraceWhereInput | null {
  const traceOwners = connections
    .filter((connection) => connection.providerAccountBlindIndex.length > 0)
    .map((connection) => ({
      provider: connection.provider,
      providerAccountBlindIndex: connection.providerAccountBlindIndex,
    }));

  return traceOwners.length > 0 ? { OR: traceOwners } : null;
}

function safeErrorCode(error: unknown): string {
  if (isDeviceSyncError(error)) {
    return sanitizeHostedRuntimeErrorCode(error.code) ?? "DEVICE_SYNC_ERROR";
  }

  if (error instanceof Error) {
    return sanitizeHostedRuntimeErrorCode(error.name) ?? "ERROR";
  }

  return "UNKNOWN_ERROR";
}
