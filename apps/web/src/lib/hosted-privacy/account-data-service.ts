import type { Prisma, PrismaClient } from "@prisma/client";

import { createHostedDeviceSyncControlPlane } from "../device-sync/control-plane";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import {
  deleteHostedRunnerUserDataBestEffort,
  type HostedRunnerUserDataDeletionBestEffortResult,
} from "../hosted-runner/control";
import {
  HOSTED_ACCOUNT_DATA_DELETION_SCHEMA,
  HOSTED_ACCOUNT_DATA_EXPORT_SCHEMA,
  HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
} from "./account-data-shared";

export type HostedAccountStoreDeletionMode =
  | "live-delete"
  | "best-effort-delete"
  | "local-reference-delete"
  | "documented-retention";

export type HostedAccountStoreExportMode =
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
    slug: "prisma.hosted_member_identity",
    label: "Privy identity and encrypted contact hints",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Exports only masked/linked/verified status. Encrypted phone, wallet, and Privy identifiers are not emitted.",
  },
  {
    slug: "prisma.hosted_member_routing",
    label: "Linq, Telegram, reply-alias routing bindings",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes encrypted routing IDs and lookup keys used to route Linq/Telegram/email traffic.",
  },
  {
    slug: "prisma.hosted_member_email_authorization",
    label: "Email authorization state",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes encrypted verified-email and direct-public-sender authorization records.",
  },
  {
    slug: "prisma.hosted_member_billing_ref",
    label: "Local Stripe billing references",
    deletion: "local-reference-delete",
    export: "metadata-and-counts",
    note: "Deletes local encrypted Stripe customer/subscription references. Stripe records remain governed by Stripe/legal retention.",
  },
  {
    slug: "prisma.hosted_mailbox_item",
    label: "Hosted mailbox envelopes",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes lane items, inline ciphertext, payload refs, dedupe keys, and sequence counters.",
  },
  {
    slug: "prisma.hosted_mailbox_payload",
    label: "Hosted mailbox payload ciphertext",
    deletion: "live-delete",
    export: "not-exported-secret",
    note: "Deletes encrypted payload blobs. Export reports payload counts and schemas without returning ciphertext.",
  },
  {
    slug: "prisma.hosted_mailbox_lane_counter",
    label: "Hosted mailbox lane counters",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes per-lane sequence counters so deleted users cannot resume mailbox lanes.",
  },
  {
    slug: "prisma.hosted_vault_sync_session",
    label: "Hosted vault sync sessions and tokens",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes pairing-code hashes, agent-token hashes, status, and source-vault metadata.",
  },
  {
    slug: "prisma.hosted_vault_sync_payload",
    label: "Hosted vault sync encrypted payloads",
    deletion: "live-delete",
    export: "not-exported-secret",
    note: "Deletes encrypted local-vault import payloads. Export reports counts without returning ciphertext.",
  },
  {
    slug: "prisma.hosted_workspace",
    label: "Hosted workspace state",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes hosted workspace checkpoint refs, browser vault replica refs, next-wake state, and redacted status.",
  },
  {
    slug: "prisma.hosted_runtime_log",
    label: "Runtime logs",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes per-user hosted runtime logs and redacted runtime JSON.",
  },
  {
    slug: "prisma.hosted_ai_usage",
    label: "AI usage and metering rows",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Deletes member-scoped usage rows. Already-submitted external billing/metering data may remain under vendor retention.",
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
    slug: "prisma.device_connection",
    label: "Device provider connections and tokens",
    deletion: "live-delete",
    export: "metadata-and-counts",
    note: "Best-effort provider revocation runs first, then connection rows and encrypted tokens are deleted.",
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
    export: "metadata-and-counts",
    note: "Deletes webhook trace rows for provider accounts linked to the member's device connections.",
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
    label: "Cloudflare R2 user bundles, vault replicas, artifacts, runner secrets, and root-key envelope",
    deletion: "best-effort-delete",
    export: "documented-only",
    note: "Best-effort hosted execution control deletes opaque per-user R2 prefixes and the user root-key envelope when derivation keys are available.",
  },
  {
    slug: "providers.oura_whoop_garmin_strava",
    label: "Oura, WHOOP, Garmin, and Strava provider revocation",
    deletion: "best-effort-delete",
    export: "metadata-and-counts",
    note: "Uses the existing provider revokeAccess hook where configured before deleting local tokens. Provider-side retention remains provider-controlled.",
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
    label: "Stripe and Privy vendor records",
    deletion: "documented-retention",
    export: "documented-only",
    note: "Deletes local references only. Vendor records are retained or erased through Stripe/Privy/legal workflows outside this MVP endpoint.",
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
  acknowledgedIrreversibleDeletion: true;
  acknowledgedProviderAndBackupLimits: true;
  confirmationPhrase: typeof HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE;
  secondConfirmationAccepted: true;
}

export interface HostedAccountDataExport {
  coverage: readonly HostedAccountDataStoreCoverageEntry[];
  generatedAt: string;
  member: {
    id: string;
    billingStatus: string;
    createdAt: string;
    pendingActivationTimeZone: string | null;
    suspendedAt: string | null;
    updatedAt: string;
  };
  counts: HostedAccountDataCounts;
  deviceConnections: HostedAccountExportDeviceConnection[];
  emailAuthorization: HostedAccountExportEmailAuthorization | null;
  identity: HostedAccountExportIdentity | null;
  retentionNotes: readonly string[];
  routing: HostedAccountExportRouting | null;
  schema: typeof HOSTED_ACCOUNT_DATA_EXPORT_SCHEMA;
  vaultSyncSessions: HostedAccountExportVaultSyncSession[];
  workspace: HostedAccountExportWorkspace | null;
}

export interface HostedAccountDataCounts {
  [key: string]: number;
}

export interface HostedAccountExportIdentity {
  maskedPhoneNumberHint: string | null;
  phoneNumberVerifiedAt: string | null;
  privyUserLinked: boolean;
  walletAddressLinked: boolean;
  walletChainType: string | null;
  walletCreatedAt: string | null;
  walletProvider: string | null;
}

export interface HostedAccountExportRouting {
  linqHomeThreadLinked: boolean;
  linqRecipientLinked: boolean;
  pendingLinqThreadLinked: boolean;
  replyAliasLinked: boolean;
  telegramLinked: boolean;
}

export interface HostedAccountExportEmailAuthorization {
  directPublicSenderAuthorizedAt: string | null;
  directPublicSenderLinked: boolean;
  verifiedEmailLinked: boolean;
  verifiedEmailVerifiedAt: string | null;
}

export interface HostedAccountExportDeviceConnection {
  connectedAt: string;
  createdAt: string;
  displayName: string | null;
  id: string;
  lastSyncCompletedAt: string | null;
  provider: string;
  status: string;
  updatedAt: string;
}

export interface HostedAccountExportVaultSyncSession {
  createdAt: string;
  direction: string;
  expiresAt: string;
  id: string;
  payloadPresent: boolean;
  sourceSchemaVersion: string | null;
  sourceVaultIdPresent: boolean;
  sourceVaultTitle: string | null;
  status: string;
  updatedAt: string;
}

export interface HostedAccountExportWorkspace {
  browserVaultReplicaRefPresent: boolean;
  checkpointedAt: string | null;
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  redactedStatusPresent: boolean;
  snapshotRefPresent: boolean;
  updatedAt: string;
  version: string;
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
  provider: string;
  status: HostedAccountProviderRevocationStatus;
  warningCode: string | null;
}

export interface HostedAccountDeletionResult {
  cloudflare: HostedRunnerUserDataDeletionBestEffortResult;
  deletedAt: string;
  deletedCounts: HostedAccountDataCounts;
  memberId: string;
  providerRevocations: HostedAccountProviderRevocationResult[];
  retentionNotes: readonly string[];
  schema: typeof HOSTED_ACCOUNT_DATA_DELETION_SCHEMA;
}

type HostedAccountDataPrisma = PrismaClient | Prisma.TransactionClient;

type DeviceConnectionIdentity = {
  id: string;
  provider: string;
  providerAccountBlindIndex: string;
};

const HOSTED_ACCOUNT_RETENTION_NOTES = [
  "Live Prisma, hosted mailbox, vault sync, device, runtime, and workspace rows are deleted immediately by this workflow.",
  "Cloudflare Durable Object/R2 cleanup is best effort and reported in the deletion result when hosted execution control is configured.",
  "Provider-side data deletion is limited to revocation hooks and external provider retention controls.",
  "Stripe, Privy, carrier/email/Telegram/Linq provider records, and infrastructure backups follow their documented retention/legal processes.",
] as const;

export function parseHostedAccountDeletionRequest(
  body: Record<string, unknown>,
): HostedAccountDeletionRequest {
  if (body.confirmationPhrase !== HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_CONFIRMATION_PHRASE_REQUIRED",
      httpStatus: 400,
      message: `Type ${HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE} exactly to delete your Murph data.`,
    });
  }

  if (body.secondConfirmationAccepted !== true) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_SECOND_CONFIRMATION_REQUIRED",
      httpStatus: 400,
      message: "Confirm the second deletion step before deleting your Murph data.",
    });
  }

  if (body.acknowledgedIrreversibleDeletion !== true) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_IRREVERSIBLE_ACK_REQUIRED",
      httpStatus: 400,
      message: "Acknowledge that live Murph data deletion is irreversible before continuing.",
    });
  }

  if (body.acknowledgedProviderAndBackupLimits !== true) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_PROVIDER_BACKUP_ACK_REQUIRED",
      httpStatus: 400,
      message: "Acknowledge provider and backup retention limits before deleting your Murph data.",
    });
  }

  return {
    acknowledgedIrreversibleDeletion: true,
    acknowledgedProviderAndBackupLimits: true,
    confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
    secondConfirmationAccepted: true,
  };
}

export async function buildHostedAccountDataExport(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<HostedAccountDataExport> {
  const member = await input.prisma.hostedMember.findUnique({
    where: { id: input.memberId },
    include: {
      emailAuthorization: true,
      hostedWorkspace: true,
      identity: true,
      routing: true,
    },
  });

  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Your hosted member record was not found.",
    });
  }

  const [counts, deviceConnections, vaultSyncSessions] = await Promise.all([
    countHostedAccountData({ memberId: input.memberId, prisma: input.prisma }),
    input.prisma.deviceConnection.findMany({
      orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
      select: {
        connectedAt: true,
        createdAt: true,
        displayName: true,
        id: true,
        lastSyncCompletedAt: true,
        provider: true,
        status: true,
        updatedAt: true,
      },
      where: { userId: input.memberId },
    }),
    input.prisma.hostedVaultSyncSession.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        direction: true,
        expiresAt: true,
        id: true,
        payload: { select: { sessionId: true } },
        sourceSchemaVersion: true,
        sourceVaultId: true,
        sourceVaultTitle: true,
        status: true,
        updatedAt: true,
      },
      where: { memberId: input.memberId },
    }),
  ]);

  return {
    coverage: HOSTED_ACCOUNT_DATA_STORE_COVERAGE,
    generatedAt: new Date().toISOString(),
    member: {
      id: member.id,
      billingStatus: member.billingStatus,
      createdAt: toIso(member.createdAt),
      pendingActivationTimeZone: member.pendingActivationTimeZone,
      suspendedAt: toIsoNullable(member.suspendedAt),
      updatedAt: toIso(member.updatedAt),
    },
    counts,
    deviceConnections: deviceConnections.map((connection) => ({
      connectedAt: toIso(connection.connectedAt),
      createdAt: toIso(connection.createdAt),
      displayName: connection.displayName,
      id: connection.id,
      lastSyncCompletedAt: toIsoNullable(connection.lastSyncCompletedAt),
      provider: connection.provider,
      status: connection.status,
      updatedAt: toIso(connection.updatedAt),
    })),
    emailAuthorization: member.emailAuthorization
      ? {
        directPublicSenderAuthorizedAt: toIsoNullable(member.emailAuthorization.directPublicSenderAuthorizedAt),
        directPublicSenderLinked: Boolean(member.emailAuthorization.directPublicSenderLookupKey),
        verifiedEmailLinked: Boolean(member.emailAuthorization.verifiedEmailLookupKey),
        verifiedEmailVerifiedAt: toIsoNullable(member.emailAuthorization.verifiedEmailVerifiedAt),
      }
      : null,
    identity: member.identity
      ? {
        maskedPhoneNumberHint: member.identity.maskedPhoneNumberHint,
        phoneNumberVerifiedAt: toIsoNullable(member.identity.phoneNumberVerifiedAt),
        privyUserLinked: Boolean(member.identity.privyUserLookupKey),
        walletAddressLinked: Boolean(member.identity.walletAddressLookupKey),
        walletChainType: member.identity.walletChainType,
        walletCreatedAt: toIsoNullable(member.identity.walletCreatedAt),
        walletProvider: member.identity.walletProvider,
      }
      : null,
    retentionNotes: HOSTED_ACCOUNT_RETENTION_NOTES,
    routing: member.routing
      ? {
        linqHomeThreadLinked: Boolean(member.routing.linqChatLookupKey),
        linqRecipientLinked: Boolean(member.routing.linqRecipientPhoneLookupKey),
        pendingLinqThreadLinked: Boolean(member.routing.pendingLinqChatLookupKey),
        replyAliasLinked: Boolean(member.routing.replyAliasLookupKey),
        telegramLinked: Boolean(member.routing.telegramUserLookupKey),
      }
      : null,
    schema: HOSTED_ACCOUNT_DATA_EXPORT_SCHEMA,
    vaultSyncSessions: vaultSyncSessions.map((session) => ({
      createdAt: toIso(session.createdAt),
      direction: session.direction,
      expiresAt: toIso(session.expiresAt),
      id: session.id,
      payloadPresent: session.payload !== null,
      sourceSchemaVersion: session.sourceSchemaVersion,
      sourceVaultIdPresent: Boolean(session.sourceVaultId),
      sourceVaultTitle: session.sourceVaultTitle,
      status: session.status,
      updatedAt: toIso(session.updatedAt),
    })),
    workspace: member.hostedWorkspace
      ? {
        browserVaultReplicaRefPresent: member.hostedWorkspace.browserVaultReplicaRef !== null,
        checkpointedAt: toIsoNullable(member.hostedWorkspace.checkpointedAt),
        nextWakeAt: toIsoNullable(member.hostedWorkspace.nextWakeAt),
        nextWakeReason: member.hostedWorkspace.nextWakeReason,
        redactedStatusPresent: member.hostedWorkspace.redactedStatusJson !== null,
        snapshotRefPresent: member.hostedWorkspace.snapshotRef !== null,
        updatedAt: toIso(member.hostedWorkspace.updatedAt),
        version: member.hostedWorkspace.version.toString(),
      }
      : null,
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

  const deviceConnectionIdentities = await listDeviceConnectionIdentities({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const providerRevocations = await revokeDeviceProvidersBestEffort({
    connections: deviceConnectionIdentities,
    memberId: input.memberId,
    request: input.request,
  });
  const cloudflare = await deleteHostedRunnerUserDataBestEffort({
    context: "settings.account-data.delete",
    userId: input.memberId,
  });
  const deletedCounts = await input.prisma.$transaction(async (tx) => {
    return deleteHostedAccountPrismaRows({
      connectionIdentities: deviceConnectionIdentities,
      memberId: input.memberId,
      prisma: tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return {
    cloudflare,
    deletedAt: new Date().toISOString(),
    deletedCounts,
    memberId: input.memberId,
    providerRevocations,
    retentionNotes: HOSTED_ACCOUNT_RETENTION_NOTES,
    schema: HOSTED_ACCOUNT_DATA_DELETION_SCHEMA,
  };
}

async function countHostedAccountData(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<HostedAccountDataCounts> {
  const memberId = input.memberId;
  const connectionIdentities = await listDeviceConnectionIdentities({ memberId, prisma: input.prisma });
  const webhookTraceWhere = buildDeviceWebhookTraceWhere(connectionIdentities);
  const [
    hostedMember,
    hostedMemberIdentity,
    hostedMemberRouting,
    hostedMemberBillingRef,
    hostedMemberEmailAuthorization,
    hostedMailboxItem,
    hostedMailboxPayload,
    hostedMailboxLaneCounter,
    hostedWorkspace,
    hostedRuntimeLog,
    hostedInvite,
    hostedVaultSyncSession,
    hostedVaultSyncPayload,
    hostedAiUsage,
    hostedLinqDailyState,
    deviceConnection,
    deviceTokenAudit,
    deviceOauthSession,
    deviceWebhookTrace,
    deviceSyncSignal,
    deviceAgentSession,
    deviceBrowserAssertionNonce,
    hostedWebInternalRequestNonce,
  ] = await Promise.all([
    input.prisma.hostedMember.count({ where: { id: memberId } }),
    input.prisma.hostedMemberIdentity.count({ where: { memberId } }),
    input.prisma.hostedMemberRouting.count({ where: { memberId } }),
    input.prisma.hostedMemberBillingRef.count({ where: { memberId } }),
    input.prisma.hostedMemberEmailAuthorization.count({ where: { memberId } }),
    input.prisma.hostedMailboxItem.count({ where: { userId: memberId } }),
    input.prisma.hostedMailboxPayload.count({ where: { userId: memberId } }),
    input.prisma.hostedMailboxLaneCounter.count({ where: { userId: memberId } }),
    input.prisma.hostedWorkspace.count({ where: { userId: memberId } }),
    input.prisma.hostedRuntimeLog.count({ where: { userId: memberId } }),
    input.prisma.hostedInvite.count({ where: { memberId } }),
    input.prisma.hostedVaultSyncSession.count({ where: { memberId } }),
    input.prisma.hostedVaultSyncPayload.count({ where: { memberId } }),
    input.prisma.hostedAiUsage.count({ where: { memberId } }),
    input.prisma.hostedLinqDailyState.count({ where: { memberId } }),
    input.prisma.deviceConnection.count({ where: { userId: memberId } }),
    input.prisma.deviceTokenAudit.count({ where: { userId: memberId } }),
    input.prisma.deviceOauthSession.count({ where: { userId: memberId } }),
    webhookTraceWhere ? input.prisma.deviceWebhookTrace.count({ where: webhookTraceWhere }) : 0,
    input.prisma.deviceSyncSignal.count({ where: { userId: memberId } }),
    input.prisma.deviceAgentSession.count({ where: { userId: memberId } }),
    input.prisma.deviceBrowserAssertionNonce.count({ where: { userId: memberId } }),
    input.prisma.hostedWebInternalRequestNonce.count({ where: { userId: memberId } }),
  ]);

  return {
    "prisma.device_agent_session": deviceAgentSession,
    "prisma.device_browser_assertion_nonce": deviceBrowserAssertionNonce,
    "prisma.device_connection": deviceConnection,
    "prisma.device_oauth_session": deviceOauthSession,
    "prisma.device_sync_signal": deviceSyncSignal,
    "prisma.device_token_audit": deviceTokenAudit,
    "prisma.device_webhook_trace": deviceWebhookTrace,
    "prisma.hosted_ai_usage": hostedAiUsage,
    "prisma.hosted_invite": hostedInvite,
    "prisma.hosted_linq_daily_state": hostedLinqDailyState,
    "prisma.hosted_mailbox_item": hostedMailboxItem,
    "prisma.hosted_mailbox_lane_counter": hostedMailboxLaneCounter,
    "prisma.hosted_mailbox_payload": hostedMailboxPayload,
    "prisma.hosted_member": hostedMember,
    "prisma.hosted_member_billing_ref": hostedMemberBillingRef,
    "prisma.hosted_member_email_authorization": hostedMemberEmailAuthorization,
    "prisma.hosted_member_identity": hostedMemberIdentity,
    "prisma.hosted_member_routing": hostedMemberRouting,
    "prisma.hosted_runtime_log": hostedRuntimeLog,
    "prisma.hosted_vault_sync_payload": hostedVaultSyncPayload,
    "prisma.hosted_vault_sync_session": hostedVaultSyncSession,
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
  record("prisma.hosted_mailbox_item", await input.prisma.hostedMailboxItem.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_mailbox_lane_counter", await input.prisma.hostedMailboxLaneCounter.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_vault_sync_payload", await input.prisma.hostedVaultSyncPayload.deleteMany({ where: { memberId } }));
  record("prisma.hosted_vault_sync_session", await input.prisma.hostedVaultSyncSession.deleteMany({ where: { memberId } }));
  record("prisma.hosted_runtime_log", await input.prisma.hostedRuntimeLog.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_ai_usage", await input.prisma.hostedAiUsage.deleteMany({ where: { memberId } }));
  record("prisma.hosted_linq_daily_state", await input.prisma.hostedLinqDailyState.deleteMany({ where: { memberId } }));
  record("prisma.hosted_invite", await input.prisma.hostedInvite.deleteMany({ where: { memberId } }));
  record("prisma.hosted_workspace", await input.prisma.hostedWorkspace.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_member_email_authorization", await input.prisma.hostedMemberEmailAuthorization.deleteMany({ where: { memberId } }));
  record("prisma.hosted_member_billing_ref", await input.prisma.hostedMemberBillingRef.deleteMany({ where: { memberId } }));
  record("prisma.hosted_member_routing", await input.prisma.hostedMemberRouting.deleteMany({ where: { memberId } }));
  record("prisma.hosted_member_identity", await input.prisma.hostedMemberIdentity.deleteMany({ where: { memberId } }));

  const webhookTraceWhere = buildDeviceWebhookTraceWhere(input.connectionIdentities);
  counts["prisma.device_webhook_trace"] = webhookTraceWhere
    ? (await input.prisma.deviceWebhookTrace.deleteMany({ where: webhookTraceWhere })).count
    : 0;
  record("prisma.device_token_audit", await input.prisma.deviceTokenAudit.deleteMany({ where: { userId: memberId } }));
  record("prisma.device_sync_signal", await input.prisma.deviceSyncSignal.deleteMany({ where: { userId: memberId } }));
  record("prisma.device_oauth_session", await input.prisma.deviceOauthSession.deleteMany({ where: { userId: memberId } }));
  record("prisma.device_agent_session", await input.prisma.deviceAgentSession.deleteMany({ where: { userId: memberId } }));
  record("prisma.device_browser_assertion_nonce", await input.prisma.deviceBrowserAssertionNonce.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_web_internal_request_nonce", await input.prisma.hostedWebInternalRequestNonce.deleteMany({ where: { userId: memberId } }));
  record("prisma.device_connection", await input.prisma.deviceConnection.deleteMany({ where: { userId: memberId } }));
  record("prisma.hosted_member", await input.prisma.hostedMember.deleteMany({ where: { id: memberId } }));

  return counts;
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
    },
    where: { userId: input.memberId },
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
      provider: connection.provider,
      status: "skipped_not_configured",
      warningCode: null,
    }));
  }

  const results: HostedAccountProviderRevocationResult[] = [];
  for (const connection of input.connections) {
    const provider = controlPlane.registry.get(connection.provider);

    if (!provider?.revokeAccess) {
      results.push({
        connectionId: connection.id,
        errorCode: null,
        provider: connection.provider,
        status: "not_needed",
        warningCode: null,
      });
      continue;
    }

    try {
      const storedAccount = await controlPlane.store.getStoredConnectionAccountForUser(
        input.memberId,
        connection.id,
      );

      if (!storedAccount) {
        results.push({
          connectionId: connection.id,
          errorCode: null,
          provider: connection.provider,
          status: "warning",
          warningCode: "CONNECTION_SECRET_MISSING",
        });
        continue;
      }

      await provider.revokeAccess(storedAccount);
      results.push({
        connectionId: connection.id,
        errorCode: null,
        provider: connection.provider,
        status: "revoked",
        warningCode: null,
      });
    } catch (error) {
      results.push({
        connectionId: connection.id,
        errorCode: safeErrorCode(error),
        provider: connection.provider,
        status: "failed",
        warningCode: null,
      });
    }
  }

  return results;
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
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function toIso(value: Date): string {
  return value.toISOString();
}

function toIsoNullable(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
