import type { Prisma, PrismaClient } from "@prisma/client";

import { sanitizeHostedRuntimeErrorCode } from "@murphai/device-syncd/hosted-runtime";
import { formatDeviceSyncProviderLabel } from "@murphai/device-syncd/provider-label";
import { isDeviceSyncError } from "@murphai/device-syncd/public-ingress";

import { createHostedDeviceSyncControlPlane } from "../device-sync/control-plane";
import { ComputerUseService } from "../computer-use/service";
import { PrismaComputerUseStore } from "../computer-use/store";
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
  HOSTED_DATA_EXPORT_CONFIRMATION_TEXT,
  HOSTED_DATA_EXPORT_SCHEMA,
} from "./account-data-shared";

export type HostedAccountStoreDeletionMode =
  | "live-delete"
  | "best-effort-delete"
  | "local-reference-delete"
  | "documented-retention";

export type HostedAccountStoreExportMode =
  | "decoded-redacted-data"
  | "metadata-and-counts"
  | "not-exported-secret"
  | "documented-only";

export interface HostedAccountDataStoreCoverageEntry {
  readonly slug: string;
  readonly label: string;
  readonly deletion: HostedAccountStoreDeletionMode;
  readonly export: HostedAccountStoreExportMode;
  readonly note: string;
}

export const HOSTED_ACCOUNT_DATA_STORE_COVERAGE = [
  {
    slug: "prisma.hosted_member",
    label: "Prisma hosted member record",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes the member row after child stores are explicitly deleted; Prisma cascade remains a safety net.",
  },
  {
    slug: "prisma.hosted_web_session",
    label: "Hosted web app sessions",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes active and revoked hashed app-session tokens. Export reports counts only and omits token hashes.",
  },
  {
    slug: "prisma.hosted_member_identity",
    label: "Privy identity and encrypted contact hints",
    deletion: "live-delete",
    export: "decoded-redacted-data",
    note: "Confirmed export includes decrypted user-facing phone, Privy, and wallet identity fields while omitting lookup keys and active phone-code attempt IDs.",
  },
  {
    slug: "prisma.hosted_member_routing",
    label: "Linq, Telegram, reply-alias routing bindings",
    deletion: "live-delete",
    export: "decoded-redacted-data",
    note: "Confirmed export includes decrypted user-facing Linq and Telegram routing IDs and pending Linq participant contacts while omitting lookup keys used for inbound traffic matching.",
  },
  {
    slug: "prisma.hosted_member_email_authorization",
    label: "Email authorization state",
    deletion: "live-delete",
    export: "decoded-redacted-data",
    note: "Confirmed export includes verified-email and direct-public-sender addresses when available while omitting address lookup keys.",
  },
  {
    slug: "prisma.hosted_member_billing_ref",
    label: "Local Stripe billing references",
    deletion: "local-reference-delete",
    export: "decoded-redacted-data",
    note: "Confirmed export includes local Stripe customer/subscription references. The Stripe subscription and customer themselves are canceled/deleted by the vendor-account deletion step.",
  },
  {
    slug: "prisma.hosted_mailbox_item",
    label: "Hosted mailbox envelopes",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes lane items, inline ciphertext, payload refs, dedupe keys, and sequence counters. Export includes mailbox envelope metadata and omits decoded payload bodies.",
  },
  {
    slug: "prisma.hosted_mailbox_payload",
    label: "Hosted mailbox payload ciphertext",
    deletion: "live-delete",
    export: "not-exported-secret",
    note: "Deletes encrypted payload blobs. Export reports payload presence and bytes while omitting ciphertext and decoded arbitrary payload JSON.",
  },
  {
    slug: "prisma.hosted_mailbox_lane_counter",
    label: "Hosted mailbox lane counters",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes per-lane sequence counters so deleted users cannot resume mailbox lanes.",
  },
  {
    slug: "prisma.hosted_ingress_latency_trace",
    label: "Hosted ingress latency traces",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes hosted ingress timing rows. Export includes aggregate counts only and omits internal correlation identifiers.",
  },
  {
    slug: "prisma.hosted_workspace",
    label: "Hosted workspace state",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes hosted workspace checkpoint refs, browser vault replica refs, next-wake state, and redacted status.",
  },
  {
    slug: "prisma.hosted_computer_profile",
    label: "Hosted computer-use browser profiles",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes Kernel browser profiles before local profile rows. Export omits raw Kernel profile names.",
  },
  {
    slug: "prisma.hosted_computer_run",
    label: "Hosted computer-use runs",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes Kernel browser sessions before local run rows. Export includes redacted run/checkpoint metadata and omits live-view URLs and Kernel session ids.",
  },
  {
    slug: "prisma.hosted_computer_handoff",
    label: "Hosted computer-use handoffs",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes short-lived handoff rows and token hashes. Export includes handoff status metadata and omits token hashes.",
  },
  {
    slug: "prisma.hosted_runtime_log",
    label: "Runtime logs",
    deletion: "live-delete",
    export: "documented-only",
    note: "Deletes per-user hosted runtime logs and redacted runtime JSON. Export omits runtime log rows and counts.",
  },
  {
    slug: "prisma.hosted_user_crypto_envelope",
    label: "Hosted crypto domain root envelopes",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes signed per-user domain root envelopes. Export reports counts only and omits signed envelope JSON.",
  },
  {
    slug: "prisma.hosted_user_crypto_audit",
    label: "Hosted crypto audit rows",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes per-user hosted crypto provisioning audit rows. Export reports counts only and omits recipient and root-key audit payloads.",
  },
  {
    slug: "prisma.hosted_ai_usage",
    label: "AI usage and metering rows",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes member-scoped usage rows. Already-submitted external billing/metering data may remain under vendor retention.",
  },
  {
    slug: "prisma.hosted_ai_usage_period",
    label: "AI usage allowance period rows",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes member-scoped included-allowance spend aggregates used by the hosted AI usage gate.",
  },
  {
    slug: "prisma.hosted_linq_daily_state",
    label: "Linq daily message counters",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes member-scoped Linq daily inbound/outbound quota counters.",
  },
  {
    slug: "prisma.hosted_invite",
    label: "Hosted invite records",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes invite codes and channel metadata owned by the member.",
  },
  {
    slug: "prisma.hosted_consent_event",
    label: "Hosted consent event records",
    deletion: "live-delete",
    export: "decoded-redacted-data",
    note: "Deletes member-scoped consent audit events before the member row; export includes scope/action/version metadata without secrets.",
  },
  {
    slug: "prisma.hosted_consent_grant",
    label: "Hosted consent grant records",
    deletion: "live-delete",
    export: "decoded-redacted-data",
    note: "Deletes the member's current consent grants before the member row; export includes scope/status/version metadata.",
  },
  {
    slug: "prisma.hosted_vault_share",
    label: "Hosted vault share grants",
    deletion: "live-delete",
    export: "decoded-redacted-data",
    note: "Deleted in the same transaction by the hosted_member FK cascade when either the grantor or destination member row is removed; export includes share rows where the member is grantor or destination.",
  },
  {
    slug: "prisma.device_connection",
    label: "Device provider connections and tokens",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Best-effort provider revocation runs first, then connection rows and encrypted tokens are deleted.",
  },
  {
    slug: "prisma.device_sync_dirty_connection",
    label: "Device sync dirty state",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes pending per-connection dirty sync metadata before device connection rows so deletion does not rely on cascades.",
  },
  {
    slug: "prisma.device_sync_dirty_payload",
    label: "Device sync dirty payload rows",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes pending provider payload jobs before dirty-state and connection rows so raw provider payload retention is bounded.",
  },
  {
    slug: "prisma.device_token_audit",
    label: "Device token audit rows",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes token audit history by user before device connection rows are removed.",
  },
  {
    slug: "prisma.device_sync_signal",
    label: "Device sync signal rows",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes pre-existing per-user wake/sync signal history. Deletion-time provider revocation does not enqueue new disconnect or wake work.",
  },
  {
    slug: "prisma.device_oauth_session",
    label: "Device OAuth sessions",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes pending provider OAuth state rows for the member.",
  },
  {
    slug: "prisma.device_connect_intent",
    label: "Hosted device connect intents",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes short-lived hosted wearable connection claims for the member.",
  },
  {
    slug: "prisma.device_agent_session",
    label: "Local device agent sessions",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes agent bearer-token hashes and session metadata for local device sync agents.",
  },
  {
    slug: "prisma.device_browser_assertion_nonce",
    label: "Device browser assertion nonces",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes outstanding browser assertion nonces for the member.",
  },
  {
    slug: "prisma.hosted_web_internal_request_nonce",
    label: "Hosted web internal request nonces",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes per-user internal anti-replay nonces.",
  },
  {
    slug: "prisma.device_webhook_trace",
    label: "Provider webhook trace rows",
    deletion: "live-delete",
    export: "documented-only",
    note: "Deletes webhook trace rows for provider accounts linked to the member's device connections when linkage is available. User export omits trace rows and trace counts until the minimized webhook trace model has a safe user linkage.",
  },
  {
    slug: "cloudflare.runner_durable_object",
    label: "Cloudflare runner Durable Object state",
    deletion: "best-effort-delete",
    export: "documented-only",
    note: "Best-effort call to hosted execution control clears user runner SQL state and alarms when Cloudflare control is configured.",
  },
  {
    slug: "cloudflare.r2_user_artifacts",
    label: "Cloudflare R2 user bundles, vault replicas, artifacts, runner secrets, and raw email",
    deletion: "best-effort-delete",
    export: "documented-only",
    note: "Best-effort hosted execution control deletes opaque per-user runtime and ingress R2 objects when web-hosted domain root context is available. Root envelopes are canonical in web Postgres.",
  },
  {
    slug: "temporal.per_user_runtime_workflow",
    label: "Hosted per-user Temporal runtime workflow",
    deletion: "best-effort-delete",
    export: "documented-only",
    note: "Best-effort Temporal termination neutralizes sleeping per-user workflow flags and runtime-result wake state after account deletion commits.",
  },
  {
    slug: "providers.oura_whoop_strava",
    label: "Oura, WHOOP, and Strava provider revocation",
    deletion: "best-effort-delete",
    export: "metadata-and-counts",
    note: "Uses the existing provider revokeAccess hook where configured before deleting local tokens. Wearable sources without a provider-side revocation hook are deleted locally unless source-side revocation is implemented.",
  },
  {
    slug: "providers.linq_telegram_email_messages",
    label: "Linq, Telegram, and email message data",
    deletion: "local-reference-delete",
    export: "metadata-and-counts",
    note: "Deletes Murph-hosted mailbox/routing records. It does not delete copies already stored in external carrier, Telegram, Linq, or email provider systems.",
  },
  {
    slug: "providers.stripe_privy",
    label: "Stripe and Privy vendor accounts",
    deletion: "best-effort-delete",
    export: "documented-only",
    note: "Cancels the Stripe subscription before local deletion (fail-closed), then deletes the Stripe customer and Privy user after local rows are removed; results are reported in the deletion result.",
  },
  {
    slug: "backups",
    label: "Backups and restore media",
    deletion: "documented-retention",
    export: "documented-only",
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

export type HostedDataExportJsonValue =
  | string
  | number
  | boolean
  | null
  | HostedDataExportJsonValue[]
  | { [key: string]: HostedDataExportJsonValue };

export type HostedDataExportJsonRecord = {
  [key: string]: HostedDataExportJsonValue;
};

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

const HOSTED_DATA_EXPORT_REDACTIONS = [
  "OAuth access and refresh tokens",
  "agent session token hashes",
  "Privy, Stripe, contact, Telegram, and device blind-index lookup keys",
  "CSRF, browser assertion, internal request, and OAuth state nonces",
  "active invite codes and recovery-style codes",
  "arbitrary decoded mailbox payload bodies",
  "hosted workspace snapshot and browser-replica object keys and bundle hashes",
  "hosted computer-use live-view URLs, handoff token hashes, Kernel session ids, and Kernel profile names",
  "encrypted private columns already represented as decrypted user-facing fields",
  "API key environment variable names",
] as const;

const HOSTED_DATA_EXPORT_OMITTED_INTERNAL_TABLES = [
  "DeviceOauthSession",
  "DeviceBrowserAssertionNonce",
  "HostedWebInternalRequestNonce",
  "HostedStripeEvent",
  "HostedAssistantRuntimeIssue",
] as const;
const HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE = 250;

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

export function parseHostedDataExportRequest(
  body: Record<string, unknown>,
): {
  acknowledgedSensitiveDownload: true;
  confirmationText: typeof HOSTED_DATA_EXPORT_CONFIRMATION_TEXT;
} {
  if (body.acknowledgedSensitiveDownload !== true) {
    throw hostedOnboardingError({
      code: "DATA_EXPORT_ACK_REQUIRED",
      httpStatus: 400,
      message: "Acknowledge that the export may contain sensitive account and message data before downloading it.",
    });
  }

  if (body.confirmationText !== HOSTED_DATA_EXPORT_CONFIRMATION_TEXT) {
    throw hostedOnboardingError({
      code: "DATA_EXPORT_CONFIRMATION_REQUIRED",
      httpStatus: 400,
      message: `Type ${HOSTED_DATA_EXPORT_CONFIRMATION_TEXT} exactly to export your Murph data.`,
    });
  }

  return {
    acknowledgedSensitiveDownload: true,
    confirmationText: HOSTED_DATA_EXPORT_CONFIRMATION_TEXT,
  };
}

export async function buildHostedDataExport(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<HostedDataExportJsonRecord> {
  const prisma = input.prisma;
  const memberId = input.memberId;
  const generatedAt = new Date();

  const [
    memberSnapshot,
    counts,
    deviceConnections,
    deviceAgentSessions,
    deviceTokenAudits,
    deviceSyncSignals,
    mailboxItems,
    mailboxLaneCounters,
    workspace,
    computerProfiles,
    computerRuns,
    computerHandoffs,
    invites,
    consentEvents,
    consentGrants,
    vaultShares,
    aiUsage,
    aiUsagePeriods,
    linqDailyStates,
  ] = await Promise.all([
    readHostedMemberSnapshot({ memberId, prisma }),
    countHostedAccountData({ memberId, prisma }),
    prisma.deviceConnection.findMany({
      orderBy: { connectedAt: "desc" },
      select: {
        accessTokenExpiresAt: true,
        connectedAt: true,
        createdAt: true,
        displayName: true,
        id: true,
        keyVersion: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        lastSyncCompletedAt: true,
        lastSyncErrorAt: true,
        lastSyncStartedAt: true,
        lastWebhookAt: true,
        metadataJson: true,
        nextReconcileAt: true,
        provider: true,
        providerAccountBlindIndex: true,
        scopesJson: true,
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
        status: true,
        tokenVersion: true,
        updatedAt: true,
        userId: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { userId: memberId },
    }),
    prisma.deviceAgentSession.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        expiresAt: true,
        label: true,
        lastSeenAt: true,
        replacedBySessionId: true,
        revokedAt: true,
        revokeReason: true,
        updatedAt: true,
        userId: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { userId: memberId },
    }),
    prisma.deviceTokenAudit.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        action: true,
        channel: true,
        connectionId: true,
        createdAt: true,
        expectedTokenVersion: true,
        forceRefresh: true,
        keyVersion: true,
        provider: true,
        refreshOutcome: true,
        sessionId: true,
        tokenVersion: true,
        tokenVersionChanged: true,
        userId: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { userId: memberId },
    }),
    prisma.deviceSyncSignal.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        connectionId: true,
        createdAt: true,
        eventType: true,
        kind: true,
        nextReconcileAt: true,
        occurredAt: true,
        provider: true,
        reason: true,
        resourceCategory: true,
        revokeWarningCode: true,
        revokeWarningMessage: true,
        traceId: true,
        userId: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { userId: memberId },
    }),
    prisma.hostedMailboxItem.findMany({
      orderBy: [{ lane: "asc" }, { laneSeq: "asc" }],
      select: {
        createdAt: true,
        expiresAt: true,
        kind: true,
        lane: true,
        laneSeq: true,
        occurredAt: true,
        payload: {
          select: {
            payloadSchema: true,
          },
        },
        payloadBytes: true,
        payloadSchema: true,
        updatedAt: true,
        userId: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { userId: memberId },
    }),
    prisma.hostedMailboxLaneCounter.findMany({
      orderBy: { lane: "asc" },
      select: {
        lane: true,
        nextSeq: true,
        updatedAt: true,
        userId: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { userId: memberId },
    }),
    prisma.hostedWorkspace.findUnique({
      select: {
        browserVaultReplicaRef: true,
        checkpointedAt: true,
        createdAt: true,
        nextWakeAt: true,
        nextWakeReason: true,
        redactedStatusJson: true,
        snapshotRef: true,
        updatedAt: true,
        userId: true,
        version: true,
      },
      where: { userId: memberId },
    }),
    prisma.hostedComputerProfile.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        createdAt: true,
        lastAuthenticatedAt: true,
        lastCheckpointAt: true,
        memberId: true,
        profileKey: true,
        updatedAt: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { memberId },
    }),
    prisma.hostedComputerRun.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        awaitingMessage: true,
        awaitingReason: true,
        completedAt: true,
        createdAt: true,
        expiresAt: true,
        goal: true,
        kernelLiveViewUrlEncrypted: true,
        kernelSessionId: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        lastTitle: true,
        lastUrl: true,
        memberId: true,
        pausedAt: true,
        pendingHandoffId: true,
        profileId: true,
        resumedAt: true,
        status: true,
        suggestedReply: true,
        taskKind: true,
        updatedAt: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { memberId },
    }),
    prisma.hostedComputerHandoff.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        completedAt: true,
        createdAt: true,
        expiresAt: true,
        memberId: true,
        openedAt: true,
        purpose: true,
        runId: true,
        status: true,
        suggestedReply: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { memberId },
    }),
    prisma.hostedInvite.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        channel: true,
        createdAt: true,
        expiresAt: true,
        memberId: true,
        sentAt: true,
        updatedAt: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { memberId },
    }),
    prisma.hostedConsentEvent.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        action: true,
        createdAt: true,
        documentVersionsJson: true,
        memberId: true,
        metadataJson: true,
        scope: true,
        source: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { memberId },
    }),
    prisma.hostedConsentGrant.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        createdAt: true,
        documentVersionsJson: true,
        grantedAt: true,
        lastEventId: true,
        memberId: true,
        revokedAt: true,
        scope: true,
        source: true,
        status: true,
        updatedAt: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { memberId },
    }),
    prisma.hostedVaultShare.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        destinationMemberId: true,
        grantedAt: true,
        grantorMemberId: true,
        projectionKind: true,
        revokedAt: true,
        source: true,
        status: true,
        updatedAt: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { OR: [{ grantorMemberId: memberId }, { destinationMemberId: memberId }] },
    }),
    prisma.hostedAiUsage.findMany({
      orderBy: { occurredAt: "desc" },
      select: {
        apiKeyEnv: true,
        attemptCount: true,
        baseUrl: true,
        cacheWriteTokens: true,
        cachedInputTokens: true,
        createdAt: true,
        credentialSource: true,
        featureKey: true,
        gatewayTagsJson: true,
        inputTokens: true,
        memberId: true,
        occurredAt: true,
        outputTokens: true,
        provider: true,
        providerName: true,
        reasoningTokens: true,
        reportingUserId: true,
        requestedModel: true,
        routeId: true,
        servedModel: true,
        sessionId: true,
        stripeMeterAttemptCount: true,
        stripeMeteredAt: true,
        stripeMeterError: true,
        stripeMeterIdentifier: true,
        stripeMeterLastAttemptedAt: true,
        stripeMeterNextAttemptAt: true,
        stripeMeterSource: true,
        stripeMeterStatus: true,
        surface: true,
        totalTokens: true,
        triggerKind: true,
        turnId: true,
        updatedAt: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { memberId },
    }),
    prisma.hostedAiUsagePeriod.findMany({
      orderBy: { periodStart: "desc" },
      select: {
        billingPlanCode: true,
        blockedAt: true,
        createdAt: true,
        lastUsageAt: true,
        limitUsdMicros: true,
        memberId: true,
        periodEnd: true,
        periodStart: true,
        spentUsdMicros: true,
        updatedAt: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { memberId },
    }),
    prisma.hostedLinqDailyState.findMany({
      orderBy: { dayUtc: "desc" },
      select: {
        createdAt: true,
        dayUtc: true,
        firstSeenAt: true,
        inboundCount: true,
        lastSeenAt: true,
        memberId: true,
        onboardingLinkSentAt: true,
        outboundCount: true,
        quotaReplySentAt: true,
        updatedAt: true,
      },
      take: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE + 1,
      where: { memberId },
    }),
  ]);

  if (!memberSnapshot) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Your hosted member record was not found.",
    });
  }

  const limitedDeviceConnections = limitRowsForExport(deviceConnections);
  const limitedDeviceAgentSessions = limitRowsForExport(deviceAgentSessions);
  const limitedDeviceTokenAudits = limitRowsForExport(deviceTokenAudits);
  const limitedDeviceSyncSignals = limitRowsForExport(deviceSyncSignals);
  const limitedMailboxItems = limitRowsForExport(mailboxItems);
  const limitedMailboxLaneCounters = limitRowsForExport(mailboxLaneCounters);
  const limitedComputerProfiles = limitRowsForExport(computerProfiles);
  const limitedComputerRuns = limitRowsForExport(computerRuns);
  const limitedComputerHandoffs = limitRowsForExport(computerHandoffs);
  const limitedInvites = limitRowsForExport(invites);
  const limitedConsentEvents = limitRowsForExport(consentEvents);
  const limitedConsentGrants = limitRowsForExport(consentGrants);
  const limitedVaultShares = limitRowsForExport(vaultShares);
  const limitedAiUsage = limitRowsForExport(aiUsage);
  const limitedAiUsagePeriods = limitRowsForExport(aiUsagePeriods);
  const limitedLinqDailyStates = limitRowsForExport(linqDailyStates);
  const wearableProviderLabelByConnectionId = new Map(
    limitedDeviceConnections.rows.map((connection) => [
      connection.id,
      resolveDeviceConnectionProviderLabel(connection),
    ] as const),
  );

  return toExportRecord({
    schema: HOSTED_DATA_EXPORT_SCHEMA,
    generatedAt,
    memberId,
    counts,
    limits: {
      maxRowsPerStore: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE,
      stores: {
        consentEvents: limitedConsentEvents.meta,
        consentGrants: limitedConsentGrants.meta,
        deviceAgentSessions: limitedDeviceAgentSessions.meta,
        deviceConnections: limitedDeviceConnections.meta,
        deviceSyncSignals: limitedDeviceSyncSignals.meta,
        deviceTokenAudits: limitedDeviceTokenAudits.meta,
        computerHandoffs: limitedComputerHandoffs.meta,
        computerProfiles: limitedComputerProfiles.meta,
        computerRuns: limitedComputerRuns.meta,
        invites: limitedInvites.meta,
        linqDailyStates: limitedLinqDailyStates.meta,
        mailboxItems: limitedMailboxItems.meta,
        mailboxLaneCounters: limitedMailboxLaneCounters.meta,
        aiUsage: limitedAiUsage.meta,
        aiUsagePeriods: limitedAiUsagePeriods.meta,
        vaultShares: limitedVaultShares.meta,
      },
    },
    security: {
      confirmation: "server-verified typed confirmation phrase",
      delivery: "same-origin POST response as a no-store JSON attachment",
      omittedInternalTables: HOSTED_DATA_EXPORT_OMITTED_INTERNAL_TABLES,
      redactions: HOSTED_DATA_EXPORT_REDACTIONS,
    },
    account: projectAccountSnapshotForExport(memberSnapshot),
    consent: {
      events: limitedConsentEvents.rows.map((event) => ({
        action: event.action,
        createdAt: event.createdAt,
        documentVersionsJson: event.documentVersionsJson,
        idPresent: true,
        memberId: event.memberId,
        metadataPresent: event.metadataJson !== null,
        scope: event.scope,
        source: event.source,
      })),
      grants: limitedConsentGrants.rows.map((grant) => ({
        createdAt: grant.createdAt,
        documentVersionsJson: grant.documentVersionsJson,
        grantedAt: grant.grantedAt,
        lastEventIdPresent: Boolean(grant.lastEventId),
        memberId: grant.memberId,
        revokedAt: grant.revokedAt,
        scope: grant.scope,
        source: grant.source,
        status: grant.status,
        updatedAt: grant.updatedAt,
      })),
    },
    messaging: {
      invites: limitedInvites.rows.map((invite) => ({
        channel: invite.channel,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        idPresent: true,
        inviteCodeOmitted: true,
        memberId: invite.memberId,
        sentAt: invite.sentAt,
        updatedAt: invite.updatedAt,
      })),
      linqDailyStates: limitedLinqDailyStates.rows,
      mailboxItems: limitedMailboxItems.rows.map((item) => ({
        createdAt: item.createdAt,
        dedupeKeyPresent: true,
        expiresAt: item.expiresAt,
        idPresent: true,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
        occurredAt: item.occurredAt,
        payload: summarizeMailboxPayloadForExport({
          payloadBytes: item.payloadBytes,
        }),
        payloadBytes: item.payloadBytes,
        payloadRefPresent: item.payload !== null,
        payloadSchema: item.payload?.payloadSchema ?? item.payloadSchema,
        payloadStorage: item.payload !== null ? "ref" : item.payloadBytes !== null ? "inline" : "missing",
        updatedAt: item.updatedAt,
        userId: item.userId,
      })),
      mailboxLaneCounters: limitedMailboxLaneCounters.rows,
    },
    vault: {
      shares: limitedVaultShares.rows.map((share) => ({
        createdAt: share.createdAt,
        destinationMemberId: share.destinationMemberId,
        grantedAt: share.grantedAt,
        grantorMemberId: share.grantorMemberId,
        idPresent: true,
        projectionKind: share.projectionKind,
        revokedAt: share.revokedAt,
        source: share.source,
        status: share.status,
        updatedAt: share.updatedAt,
      })),
      workspace: projectHostedWorkspaceForExport(workspace),
    },
    computerUse: {
      handoffs: limitedComputerHandoffs.rows.map((handoff) => ({
        completedAt: handoff.completedAt,
        createdAt: handoff.createdAt,
        expiresAt: handoff.expiresAt,
        memberId: handoff.memberId,
        openedAt: handoff.openedAt,
        purpose: handoff.purpose,
        runIdPresent: Boolean(handoff.runId),
        status: handoff.status,
        suggestedReply: handoff.suggestedReply,
        tokenHashOmitted: true,
      })),
      profiles: limitedComputerProfiles.rows.map((profile) => ({
        createdAt: profile.createdAt,
        kernelProfileNameOmitted: true,
        lastAuthenticatedAt: profile.lastAuthenticatedAt,
        lastCheckpointAt: profile.lastCheckpointAt,
        memberId: profile.memberId,
        profileKey: profile.profileKey,
        updatedAt: profile.updatedAt,
      })),
      runs: limitedComputerRuns.rows.map((run) => ({
        awaitingMessage: redactComputerHandoffLinksForExport(run.awaitingMessage),
        awaitingReason: run.awaitingReason,
        completedAt: run.completedAt,
        createdAt: run.createdAt,
        expiresAt: run.expiresAt,
        goal: run.goal,
        kernelLiveViewUrlPresent: run.kernelLiveViewUrlEncrypted !== null,
        kernelSessionIdPresent: run.kernelSessionId !== null,
        lastErrorCode: run.lastErrorCode,
        lastErrorMessagePresent: run.lastErrorMessage !== null,
        lastTitle: run.lastTitle,
        lastUrlOrigin: readSafeUrlOrigin(run.lastUrl),
        lastUrlPresent: run.lastUrl !== null,
        memberId: run.memberId,
        pausedAt: run.pausedAt,
        pendingHandoffPresent: run.pendingHandoffId !== null,
        profileIdPresent: Boolean(run.profileId),
        resumedAt: run.resumedAt,
        status: run.status,
        suggestedReply: run.suggestedReply,
        taskKind: run.taskKind,
        updatedAt: run.updatedAt,
      })),
    },
    wearables: {
      deviceAgentSessions: limitedDeviceAgentSessions.rows.map((session) => ({
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        idPresent: true,
        label: session.label,
        lastSeenAt: session.lastSeenAt,
        replacedBySessionIdPresent: Boolean(session.replacedBySessionId),
        revokedAt: session.revokedAt,
        revokeReason: session.revokeReason,
        updatedAt: session.updatedAt,
        userId: session.userId,
      })),
      deviceConnections: limitedDeviceConnections.rows.map((connection) => {
        const providerLabel = resolveDeviceConnectionProviderLabel(connection);

        return {
          accessTokenExpiresAt: connection.accessTokenExpiresAt,
          connectedAt: connection.connectedAt,
          createdAt: connection.createdAt,
          displayName: normalizeDeviceConnectionDisplayNameForExport(connection.displayName, {
            provider: connection.provider,
            providerLabel,
          }),
          idPresent: true,
          lastErrorCode: connection.lastErrorCode,
          lastErrorMessagePresent: Boolean(connection.lastErrorMessage),
          lastSyncCompletedAt: connection.lastSyncCompletedAt,
          lastSyncErrorAt: connection.lastSyncErrorAt,
          lastSyncStartedAt: connection.lastSyncStartedAt,
          lastWebhookAt: connection.lastWebhookAt,
          metadataPresent: connection.metadataJson !== null,
          nextReconcileAt: connection.nextReconcileAt,
          providerAccountLinked: connection.providerAccountBlindIndex.length > 0,
          providerLabel,
          scopesPresent: connection.scopesJson !== null,
          status: connection.status,
          keyVersionPresent: Boolean(connection.keyVersion),
          tokenVersionPresent: connection.tokenVersion !== null,
          updatedAt: connection.updatedAt,
          userId: connection.userId,
        };
      }),
      deviceSyncSignals: limitedDeviceSyncSignals.rows.map((signal) => ({
        connectionIdPresent: Boolean(signal.connectionId),
        createdAt: signal.createdAt,
        eventType: signal.eventType,
        idPresent: true,
        kind: signal.kind,
        nextReconcileAt: signal.nextReconcileAt,
        occurredAt: signal.occurredAt,
        providerLabel: resolveDeviceRowProviderLabel({
          connectionId: signal.connectionId,
          provider: signal.provider,
          providerLabelByConnectionId: wearableProviderLabelByConnectionId,
        }),
        reason: signal.reason,
        resourceCategory: signal.resourceCategory,
        revokeWarningCode: signal.revokeWarningCode,
        revokeWarningMessagePresent: Boolean(signal.revokeWarningMessage),
        traceIdPresent: Boolean(signal.traceId),
        userId: signal.userId,
      })),
      deviceTokenAudits: limitedDeviceTokenAudits.rows.map((audit) => ({
        action: audit.action,
        channel: audit.channel,
        connectionIdPresent: true,
        createdAt: audit.createdAt,
        expectedTokenVersionPresent: audit.expectedTokenVersion !== null,
        forceRefresh: audit.forceRefresh,
        idPresent: true,
        keyVersionPresent: Boolean(audit.keyVersion),
        providerLabel: resolveDeviceRowProviderLabel({
          connectionId: audit.connectionId,
          provider: audit.provider,
          providerLabelByConnectionId: wearableProviderLabelByConnectionId,
        }),
        refreshOutcome: audit.refreshOutcome,
        sessionIdPresent: Boolean(audit.sessionId),
        tokenVersionChanged: audit.tokenVersionChanged,
        tokenVersionPresent: audit.tokenVersion !== null,
        userId: audit.userId,
      })),
    },
    usage: {
      aiUsagePeriods: limitedAiUsagePeriods.rows.map((period) => ({
        billingPlanCode: period.billingPlanCode,
        blockedAt: period.blockedAt,
        createdAt: period.createdAt,
        lastUsageAt: period.lastUsageAt,
        limitUsdMicros: period.limitUsdMicros.toString(),
        memberId: period.memberId,
        periodEnd: period.periodEnd,
        periodStart: period.periodStart,
        spentUsdMicros: period.spentUsdMicros.toString(),
        updatedAt: period.updatedAt,
      })),
      aiUsage: limitedAiUsage.rows.map((entry) => ({
        attemptCount: entry.attemptCount,
        apiKeyEnvConfigured: Boolean(entry.apiKeyEnv),
        baseUrlConfigured: Boolean(entry.baseUrl),
        cacheWriteTokens: entry.cacheWriteTokens,
        cachedInputTokens: entry.cachedInputTokens,
        createdAt: entry.createdAt,
        credentialSource: entry.credentialSource,
        featureKey: entry.featureKey,
        gatewayTagsOmitted: entry.gatewayTagsJson !== null,
        idPresent: true,
        inputTokens: entry.inputTokens,
        memberId: entry.memberId,
        occurredAt: entry.occurredAt,
        outputTokens: entry.outputTokens,
        provider: entry.provider,
        providerName: entry.providerName,
        reasoningTokens: entry.reasoningTokens,
        requestedModel: entry.requestedModel,
        routeIdPresent: Boolean(entry.routeId),
        servedModel: entry.servedModel,
        sessionIdPresent: Boolean(entry.sessionId),
        stripeMeterAttemptCount: entry.stripeMeterAttemptCount,
        stripeMeteredAt: entry.stripeMeteredAt,
        stripeMeterErrorPresent: Boolean(entry.stripeMeterError),
        stripeMeterIdentifierPresent: Boolean(entry.stripeMeterIdentifier),
        stripeMeterLastAttemptedAt: entry.stripeMeterLastAttemptedAt,
        stripeMeterNextAttemptAt: entry.stripeMeterNextAttemptAt,
        stripeMeterSource: entry.stripeMeterSource,
        stripeMeterStatus: entry.stripeMeterStatus,
        surface: entry.surface,
        totalTokens: entry.totalTokens,
        triggerKind: entry.triggerKind,
        turnIdPresent: Boolean(entry.turnId),
        updatedAt: entry.updatedAt,
      })),
    },
  });
}

function projectHostedWorkspaceForExport(workspace: {
  browserVaultReplicaRef: Prisma.JsonValue | null;
  checkpointedAt: Date | null;
  createdAt: Date;
  nextWakeAt: Date | null;
  nextWakeReason: string | null;
  redactedStatusJson: Prisma.JsonValue | null;
  snapshotRef: Prisma.JsonValue | null;
  updatedAt: Date;
  userId: string;
  version: bigint;
} | null): HostedDataExportJsonRecord | null {
  if (!workspace) {
    return null;
  }

  return toExportRecord({
    browserVaultReplicaRefPresent: workspace.browserVaultReplicaRef !== null,
    checkpointedAt: workspace.checkpointedAt,
    createdAt: workspace.createdAt,
    nextWakeAt: workspace.nextWakeAt,
    nextWakeReason: workspace.nextWakeReason,
    redactedStatusPresent: workspace.redactedStatusJson !== null,
    snapshotRefPresent: workspace.snapshotRef !== null,
    updatedAt: workspace.updatedAt,
    userId: workspace.userId,
    version: workspace.version,
  });
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

function resolveDeviceRowProviderLabel(input: {
  connectionId: string | null;
  provider: string;
  providerLabelByConnectionId: ReadonlyMap<string, string>;
}): string {
  const connectionLabel = input.connectionId
    ? input.providerLabelByConnectionId.get(input.connectionId)
    : null;

  return connectionLabel ?? formatHostedDeviceSyncProviderLabel(input.provider);
}

function normalizeDeviceConnectionDisplayNameForExport(
  value: string | null,
  input: {
    provider: string;
    providerLabel: string;
  },
): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  const hiddenLabels = new Set([
    input.providerLabel.toLowerCase(),
    formatHostedDeviceSyncProviderLabel(input.provider).toLowerCase(),
    formatDeviceSyncProviderLabel(input.provider).toLowerCase(),
  ]);

  return hiddenLabels.has(normalized.toLowerCase()) ? null : normalized;
}

function projectAccountSnapshotForExport(
  snapshot: HostedMemberSnapshot | null,
): HostedDataExportJsonRecord | null {
  if (!snapshot) {
    return null;
  }

  return toExportRecord({
    billingRef: snapshot.billingRef,
    core: snapshot.core,
    emailAuthorization: snapshot.emailAuthorization
      ? {
          directPublicSender: snapshot.emailAuthorization.directPublicSender
            ? {
                address: snapshot.emailAuthorization.directPublicSender.address,
                authorizedAt: snapshot.emailAuthorization.directPublicSender.authorizedAt,
              }
            : null,
          memberId: snapshot.emailAuthorization.memberId,
          stripeCheckoutEmail: snapshot.emailAuthorization.stripeCheckoutEmail
            ? {
                address: snapshot.emailAuthorization.stripeCheckoutEmail.address,
                collectedAt: snapshot.emailAuthorization.stripeCheckoutEmail.collectedAt,
              }
            : null,
          verifiedEmail: snapshot.emailAuthorization.verifiedEmail
            ? {
                address: snapshot.emailAuthorization.verifiedEmail.address,
                verifiedAt: snapshot.emailAuthorization.verifiedEmail.verifiedAt,
              }
            : null,
        }
      : null,
    identity: snapshot.identity
      ? {
          maskedPhoneNumberHint: snapshot.identity.maskedPhoneNumberHint,
          memberId: snapshot.identity.memberId,
          phoneNumber: snapshot.identity.phoneNumber,
          phoneNumberVerifiedAt: snapshot.identity.phoneNumberVerifiedAt,
          privyUserId: snapshot.identity.privyUserId,
          signupPhoneCodeSendAttemptPresent: snapshot.identity.signupPhoneCodeSendAttemptId !== null,
          signupPhoneCodeSendAttemptStartedAt: snapshot.identity.signupPhoneCodeSendAttemptStartedAt,
          signupPhoneCodeSentAt: snapshot.identity.signupPhoneCodeSentAt,
          signupPhoneNumber: snapshot.identity.signupPhoneNumber,
          walletAddress: snapshot.identity.walletAddress,
          walletChainType: snapshot.identity.walletChainType,
          walletCreatedAt: snapshot.identity.walletCreatedAt,
          walletProvider: snapshot.identity.walletProvider,
        }
      : null,
    routing: snapshot.routing
      ? {
          linqChatId: snapshot.routing.linqChatId,
          linqRecipientPhone: snapshot.routing.linqRecipientPhone,
          memberId: snapshot.routing.memberId,
          pendingLinqChatId: snapshot.routing.pendingLinqChatId,
          pendingLinqParticipantContact: snapshot.routing.pendingLinqParticipantContact
            ? {
                kind: snapshot.routing.pendingLinqParticipantContact.kind,
                observedAt: snapshot.routing.pendingLinqParticipantContact.observedAt,
                value: snapshot.routing.pendingLinqParticipantContact.value,
              }
            : null,
          pendingLinqRecipientPhone: snapshot.routing.pendingLinqRecipientPhone,
          telegramThreadId: snapshot.routing.telegramThreadId,
          telegramUserId: snapshot.routing.telegramUserId,
        }
      : null,
  });
}

function summarizeMailboxPayloadForExport(input: {
  payloadBytes: number | null;
}): HostedDataExportJsonRecord {
  if (input.payloadBytes !== null) {
    return {
      decodedPayloadOmitted: true,
      status: "present-omitted",
    };
  }

  return {
    decodedPayloadOmitted: false,
    status: "missing",
  };
}

function readSafeUrlOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function redactComputerHandoffLinksForExport(value: string | null): string | null {
  if (!value) {
    return value;
  }

  return value
    .replace(
      /https?:\/\/[^\s<>"']+\/computer\/handoff\/[A-Za-z0-9._~-]+(?:[?#][^\s<>"']*)?/gu,
      "[computer handoff link omitted]",
    )
    .replace(
      /\/computer\/handoff\/[A-Za-z0-9._~-]+(?:[?#][^\s<>"']*)?/gu,
      "/computer/handoff/[omitted]",
    );
}

function limitRowsForExport<T>(rows: readonly T[]): {
  meta: HostedDataExportJsonRecord;
  rows: T[];
} {
  const exportedRows = rows.slice(0, HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE);
  return {
    meta: {
      exportedRows: exportedRows.length,
      maxRows: HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE,
      truncated: rows.length > HOSTED_DATA_EXPORT_MAX_ROWS_PER_STORE,
    },
    rows: exportedRows,
  };
}

function toExportRecord(value: object): HostedDataExportJsonRecord {
  const result: HostedDataExportJsonRecord = {};

  for (const [key, entryValue] of Object.entries(value)) {
    if (entryValue === undefined) {
      continue;
    }

    result[key] = toExportJsonValue(entryValue);
  }

  return result;
}

function toExportJsonValue(value: unknown): HostedDataExportJsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toExportJsonValue(entry));
  }

  if (typeof value === "object") {
    const result: HostedDataExportJsonRecord = {};

    for (const [key, entryValue] of Object.entries(value)) {
      if (entryValue !== undefined) {
        result[key] = toExportJsonValue(entryValue);
      }
    }

    return result;
  }

  return String(value);
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

  await terminateHostedUserRuntimeWorkflowBestEffort({
    reason: "account-deleted",
    userId: input.memberId,
  });
  const providerRevocationConnectionIdentities = await listDeviceConnectionIdentities({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const providerRevocations = await revokeDeviceProvidersBestEffort({
    connections: providerRevocationConnectionIdentities,
    memberId: input.memberId,
    request: input.request,
  });
  assertProviderRevocationsAllowDeletion(providerRevocations);
  // Cancel the subscription before local rows are deleted and fail closed:
  // a deleted account must never keep an active Stripe subscription billing it.
  const stripeSubscription = await cancelHostedStripeSubscriptionForAccountDeletion({
    memberId: input.memberId,
    stripeSubscriptionId,
  });
  const deletedCounts = await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberForAccountDeletionTx({
      memberId: input.memberId,
      prisma: tx,
    });
    await lockHostedComputerUseRowsForAccountDeletionTx({
      memberId: input.memberId,
      prisma: tx,
    });
    await deleteHostedComputerUseExternalStateForAccountDeletion({
      memberId: input.memberId,
      prisma: tx,
    });
    const deviceConnectionIdentities = await listDeviceConnectionIdentities({
      memberId: input.memberId,
      prisma: tx,
    });
    await lockDeviceWebhookTraceOwnersForAccountDeletionTx({
      connectionIdentities: deviceConnectionIdentities,
      prisma: tx,
    });
    return deleteHostedAccountPrismaRows({
      connectionIdentities: deviceConnectionIdentities,
      memberId: input.memberId,
      prisma: tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  const cloudflare = await deleteHostedRunnerUserDataBestEffort({
    context: "settings.account-data.delete",
    userId: input.memberId,
  });
  await terminateHostedUserRuntimeWorkflowBestEffort({
    reason: "account-deleted",
    userId: input.memberId,
  });
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
  prisma: PrismaClient | Prisma.TransactionClient;
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
  const [
    hostedMember,
    hostedWebSession,
    hostedMemberIdentity,
    hostedMemberRouting,
    hostedMemberBillingRef,
    hostedMemberEmailAuthorization,
    hostedMailboxItem,
    hostedMailboxPayload,
    hostedMailboxLaneCounter,
    hostedIngressLatencyTrace,
    hostedWorkspace,
    hostedComputerProfile,
    hostedComputerRun,
    hostedComputerHandoff,
    hostedUserCryptoEnvelope,
    hostedUserCryptoAudit,
    hostedInvite,
    hostedConsentEvent,
    hostedConsentGrant,
    hostedVaultShare,
    hostedAiUsage,
    hostedAiUsagePeriod,
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
    input.prisma.hostedMember.count({ where: { id: memberId } }),
    input.prisma.hostedWebSession.count({ where: { memberId } }),
    input.prisma.hostedMemberIdentity.count({ where: { memberId } }),
    input.prisma.hostedMemberRouting.count({ where: { memberId } }),
    input.prisma.hostedMemberBillingRef.count({ where: { memberId } }),
    input.prisma.hostedMemberEmailAuthorization.count({ where: { memberId } }),
    input.prisma.hostedMailboxItem.count({ where: { userId: memberId } }),
    input.prisma.hostedMailboxPayload.count({ where: { userId: memberId } }),
    input.prisma.hostedMailboxLaneCounter.count({ where: { userId: memberId } }),
    input.prisma.hostedIngressLatencyTrace.count({ where: { userId: memberId } }),
    input.prisma.hostedWorkspace.count({ where: { userId: memberId } }),
    input.prisma.hostedComputerProfile.count({ where: { memberId } }),
    input.prisma.hostedComputerRun.count({ where: { memberId } }),
    input.prisma.hostedComputerHandoff.count({ where: { memberId } }),
    countHostedUserCryptoEnvelopeRows(input.prisma, memberId),
    countHostedUserCryptoAuditRows(input.prisma, memberId),
    input.prisma.hostedInvite.count({ where: { memberId } }),
    input.prisma.hostedConsentEvent.count({ where: { memberId } }),
    input.prisma.hostedConsentGrant.count({ where: { memberId } }),
    input.prisma.hostedVaultShare.count({
      where: { OR: [{ grantorMemberId: memberId }, { destinationMemberId: memberId }] },
    }),
    input.prisma.hostedAiUsage.count({ where: { memberId } }),
    input.prisma.hostedAiUsagePeriod.count({ where: { memberId } }),
    input.prisma.hostedLinqDailyState.count({ where: { memberId } }),
    input.prisma.deviceConnection.count({ where: { userId: memberId } }),
    input.prisma.deviceSyncDirtyConnection.count({ where: { userId: memberId } }),
    input.prisma.deviceSyncDirtyPayload.count({ where: { userId: memberId } }),
    input.prisma.deviceTokenAudit.count({ where: { userId: memberId } }),
    input.prisma.deviceOauthSession.count({ where: { userId: memberId } }),
    input.prisma.deviceConnectIntent.count({ where: { memberId } }),
    input.prisma.deviceSyncSignal.count({ where: { userId: memberId } }),
    input.prisma.deviceAgentSession.count({ where: { userId: memberId } }),
    input.prisma.deviceBrowserAssertionNonce.count({ where: { userId: memberId } }),
    input.prisma.hostedWebInternalRequestNonce.count({ where: { userId: memberId } }),
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
    "prisma.hosted_consent_event": hostedConsentEvent,
    "prisma.hosted_consent_grant": hostedConsentGrant,
    "prisma.hosted_computer_handoff": hostedComputerHandoff,
    "prisma.hosted_computer_profile": hostedComputerProfile,
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
    "prisma.hosted_user_crypto_audit": hostedUserCryptoAudit,
    "prisma.hosted_user_crypto_envelope": hostedUserCryptoEnvelope,
    "prisma.hosted_vault_share": hostedVaultShare,
    "prisma.hosted_web_internal_request_nonce": hostedWebInternalRequestNonce,
    "prisma.hosted_workspace": hostedWorkspace,
  };
}

async function deleteHostedAccountPrismaRows(input: {
  connectionIdentities: readonly DeviceConnectionIdentity[];
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedAccountDataCounts> {
  const memberId = input.memberId;
  const counts: HostedAccountDataCounts = {};
  const record = (key: string, result: { count: number }) => {
    counts[key] = result.count;
  };

  record("prisma.hosted_mailbox_payload", await input.prisma.hostedMailboxPayload.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_ingress_latency_trace", await input.prisma.hostedIngressLatencyTrace.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_mailbox_item", await input.prisma.hostedMailboxItem.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_mailbox_lane_counter", await input.prisma.hostedMailboxLaneCounter.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_runtime_log", await input.prisma.hostedRuntimeLog.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_user_crypto_audit", await deleteHostedUserCryptoAuditRows(input.prisma, memberId));
  record("prisma.hosted_user_crypto_envelope", await deleteHostedUserCryptoEnvelopeRows(input.prisma, memberId));
  record("prisma.hosted_ai_usage", await input.prisma.hostedAiUsage.deleteMany({ where: { memberId } }));
  record("prisma.hosted_ai_usage_period", await input.prisma.hostedAiUsagePeriod.deleteMany({ where: { memberId } }));
  record("prisma.hosted_linq_daily_state", await input.prisma.hostedLinqDailyState.deleteMany({ where: { memberId } }));
  record("prisma.hosted_invite", await input.prisma.hostedInvite.deleteMany({ where: { memberId } }));
  record("prisma.hosted_consent_event", await input.prisma.hostedConsentEvent.deleteMany({ where: { memberId } }));
  record("prisma.hosted_consent_grant", await input.prisma.hostedConsentGrant.deleteMany({ where: { memberId } }));
  record("prisma.hosted_workspace", await input.prisma.hostedWorkspace.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_computer_handoff", await input.prisma.hostedComputerHandoff.deleteMany({ where: { memberId } }));
  record("prisma.hosted_computer_run", await input.prisma.hostedComputerRun.deleteMany({ where: { memberId } }));
  record("prisma.hosted_computer_profile", await input.prisma.hostedComputerProfile.deleteMany({ where: { memberId } }));
  record("prisma.hosted_member_email_authorization", await input.prisma.hostedMemberEmailAuthorization.deleteMany({ where: { memberId } }));
  record("prisma.hosted_member_billing_ref", await input.prisma.hostedMemberBillingRef.deleteMany({ where: { memberId } }));
  record("prisma.hosted_member_routing", await input.prisma.hostedMemberRouting.deleteMany({ where: { memberId } }));
  record("prisma.hosted_web_session", await input.prisma.hostedWebSession.deleteMany({ where: { memberId } }));
  record("prisma.hosted_member_identity", await input.prisma.hostedMemberIdentity.deleteMany({ where: { memberId } }));

  const webhookTraceWhere = buildDeviceWebhookTraceWhere(input.connectionIdentities);
  counts["prisma.device_webhook_trace"] = webhookTraceWhere
    ? (await input.prisma.deviceWebhookTrace.deleteMany({ where: webhookTraceWhere })).count
    : 0;
  record("prisma.device_token_audit", await input.prisma.deviceTokenAudit.deleteMany({ where: { userId: memberId } }));
  record("prisma.device_sync_dirty_payload", await input.prisma.deviceSyncDirtyPayload.deleteMany({ where: { userId: memberId } }));
  record("prisma.device_sync_dirty_connection", await input.prisma.deviceSyncDirtyConnection.deleteMany({ where: { userId: memberId } }));
  record("prisma.device_sync_signal", await input.prisma.deviceSyncSignal.deleteMany({ where: { userId: memberId } }));
  record("prisma.device_oauth_session", await input.prisma.deviceOauthSession.deleteMany({ where: { userId: memberId } }));
  record("prisma.device_connect_intent", await input.prisma.deviceConnectIntent.deleteMany({ where: { memberId } }));
  record("prisma.device_agent_session", await input.prisma.deviceAgentSession.deleteMany({ where: { userId: memberId } }));
  record("prisma.device_browser_assertion_nonce", await input.prisma.deviceBrowserAssertionNonce.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_web_internal_request_nonce", await input.prisma.hostedWebInternalRequestNonce.deleteMany({ where: { userId: memberId } }));
  record("prisma.device_connection", await input.prisma.deviceConnection.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_member", await input.prisma.hostedMember.deleteMany({ where: { id: memberId } }));

  return counts;
}

async function countHostedUserCryptoEnvelopeRows(
  prisma: HostedAccountDataPrisma,
  memberId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<RawCountRow[]>`
    SELECT COUNT(*)::bigint AS count
    FROM hosted_user_crypto_envelope
    WHERE user_id = ${memberId}
  `;
  return normalizeRawCount(rows[0]?.count);
}

async function countHostedUserCryptoAuditRows(
  prisma: HostedAccountDataPrisma,
  memberId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<RawCountRow[]>`
    SELECT COUNT(*)::bigint AS count
    FROM hosted_user_crypto_audit
    WHERE user_id = ${memberId}
  `;
  return normalizeRawCount(rows[0]?.count);
}

async function deleteHostedUserCryptoEnvelopeRows(
  prisma: Prisma.TransactionClient,
  memberId: string,
): Promise<{ count: number }> {
  const count = await prisma.$executeRaw`
    DELETE FROM hosted_user_crypto_envelope
    WHERE user_id = ${memberId}
  `;
  return { count };
}

async function deleteHostedUserCryptoAuditRows(
  prisma: Prisma.TransactionClient,
  memberId: string,
): Promise<{ count: number }> {
  const count = await prisma.$executeRaw`
    DELETE FROM hosted_user_crypto_audit
    WHERE user_id = ${memberId}
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
    FROM hosted_computer_profile
    WHERE member_id = ${input.memberId}
    ORDER BY id ASC
    FOR UPDATE
  `;
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
