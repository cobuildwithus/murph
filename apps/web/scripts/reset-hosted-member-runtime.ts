import { createHash } from "node:crypto";

import {
  Client,
  Connection,
  type ConnectionOptions,
  WorkflowNotFoundError,
} from "@temporalio/client";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createCloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";
import {
  buildHostedExecutionMemberActivatedWake,
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
  type HostedExecutionMemberChannels,
} from "@murphai/hosted-execution";
import {
  parseHostedRuntimeSignal,
} from "@murphai/hosted-execution/parsers";
import {
  readHostedRuntimeTemporalEnvironment,
  readHostedRuntimeTemporalWorkflowOptions,
} from "@murphai/hosted-execution/temporal-env";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "../src/lib/hosted-execution/auth-adapter";
import {
  readHostedExecutionControlBaseUrl,
  readHostedExecutionControlEnvironment,
} from "../src/lib/hosted-execution/environment";
import {
  formatHostedExecutionSafeLogError,
} from "../src/lib/hosted-execution/logging";
import {
  provisionActiveHostedDomainRootEnvelopeForUserOnly,
} from "../src/lib/hosted-crypto/domain-root-store";
import {
  readHostedMemberIdentity,
} from "../src/lib/hosted-onboarding/hosted-member-identity-store";
import {
  readHostedMemberStripeBillingRef,
} from "../src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  readHostedMemberSnapshot,
} from "../src/lib/hosted-onboarding/hosted-member-store";
import {
  resolveHostedMemberChannelsForSnapshot,
  resolveHostedMemberEmailLinked,
} from "../src/lib/hosted-onboarding/member-channel-sync";
import {
  appendHostedMailboxEnvelopeTx,
} from "../src/lib/hosted-mailbox/store";
import { createPrismaClient } from "../src/lib/prisma";

type ResetMode = "dry-run" | "execute";

interface ResetOptions {
  confirmCloudflareCleaned: string | null;
  confirmEnvironment: string | null;
  confirmMemberId: string | null;
  confirmTargetFingerprint: string | null;
  confirmTemporalTerminated: string | null;
  confirmUnsuspendAfterReset: string | null;
  environmentLabel: string;
  execute: boolean;
  leaveSuspended: boolean;
  memberId: string;
  resumeSuspendedReset: boolean;
  skipCloudflareDelete: boolean;
  skipTemporalTerminate: boolean;
  unsuspendAfterReset: boolean;
}

export interface CountSnapshot {
  deviceAgentSession: number;
  deviceBrowserAssertionNonce: number;
  deviceConnectIntent: number;
  deviceConnection: number;
  deviceOauthSession: number;
  deviceSyncDirtyConnection: number;
  deviceSyncDirtyPayload: number;
  deviceSyncSignal: number;
  deviceTokenAudit: number;
  deviceWebhookTraceOwners: number;
  hostedAiUsage: number;
  hostedAiUsageNonSkipped: number;
  hostedAiUsagePeriod: number;
  hostedConsentEventNonLaunch: number;
  hostedConsentGrantNonLaunch: number;
  hostedIngressLatencyTrace: number;
  hostedInvite: number;
  hostedLinqDailyState: number;
  hostedMemberEmailAuthorization: number;
  hostedMemberIdentityPhoneFields: number;
  hostedMemberRouting: number;
  hostedMailboxItem: number;
  hostedMailboxLaneCounter: number;
  hostedMailboxPayload: number;
  hostedRuntimeLog: number;
  hostedUserCryptoAuditControl: number;
  hostedUserCryptoAuditResetDomains: number;
  hostedUserCryptoEnvelopeControl: number;
  hostedUserCryptoEnvelopeResetDomains: number;
  hostedWebInternalRequestNonce: number;
  hostedWebSession: number;
  hostedWorkspace: number;
}

interface DeleteCounts {
  deviceAgentSession: number;
  deviceBrowserAssertionNonce: number;
  deviceConnectIntent: number;
  deviceConnection: number;
  deviceOauthSession: number;
  deviceSyncDirtyConnection: number;
  deviceSyncDirtyPayload: number;
  deviceSyncSignal: number;
  deviceTokenAudit: number;
  deviceWebhookTraceOwners: number;
  hostedAiUsage: number;
  hostedAiUsagePeriod: number;
  hostedIngressLatencyTrace: number;
  hostedInvite: number;
  hostedLinqDailyState: number;
  hostedMailboxItem: number;
  hostedMailboxLaneCounter: number;
  hostedMailboxPayload: number;
  hostedRuntimeLog: number;
  hostedUserCryptoAuditResetDomains: number;
  hostedUserCryptoEnvelopeResetDomains: number;
  hostedWebInternalRequestNonce: number;
  hostedWebSession: number;
  hostedWorkspace: number;
}

interface DeviceConnectionProviderSummary {
  count: number;
  provider: string;
}

interface TemporalTerminateResult {
  configured: boolean;
  notFound: boolean | null;
  terminated: boolean;
}

interface TemporalSignalResult {
  signalAccepted: true;
  workflowId: string;
}

interface CloudflareDeleteResult {
  alarmCleared: boolean | null;
  configured: boolean;
  deleted: boolean;
  r2DeletedObjectCount: number | null;
  r2SkippedUserScopedPrefixes: boolean | null;
  runnerStateDeleted: boolean | null;
}

interface DeviceWebhookTraceOwner {
  provider: string;
  providerAccountBlindIndex: string;
}

interface ResetExecutionTargetSummary {
  cloudflareControlBaseUrlFingerprint: string | null;
  databaseUrlFingerprint: string;
  executionTargetFingerprint: string;
  temporalAddressFingerprint: string | null;
  temporalNamespaceFingerprint: string | null;
}

const RESET_DOMAINS = ["device", "ingress", "runtime"] as const;
const RESET_SCRIPT_SCHEMA = "murph.hosted-member-runtime-reset-script.v1";
const DEFAULT_RESET_ENVIRONMENT = "production";
const LAUNCH_CONSENT_SCOPES = ["launch.legal", "launch.health-data"] as const;
export const RESET_TRANSACTION_OPTIONS = {
  maxWait: 30_000,
  timeout: 120_000,
} as const;
const TEMPORAL_TERMINATION_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const options = parseResetOptions(process.argv.slice(2));
  const mode: ResetMode = options.execute ? "execute" : "dry-run";
  const memberFingerprint = fingerprintIdentifier(options.memberId);
  const targets = readResetExecutionTargetSummary();
  assertResetExecutionTargetConfirmed(options, targets);
  const prisma = createPrismaFromEnvironment();

  try {
    console.log(JSON.stringify({
      environment: options.environmentLabel,
      member: memberFingerprint,
      mode,
      schema: RESET_SCRIPT_SCHEMA,
      step: "start",
      targets,
    }));

    const preflight = await readResetPreflight({
      memberId: options.memberId,
      prisma,
    });

    printJson("preflight", memberFingerprint, {
      counts: preflight.counts,
      deviceConnectionProviders: preflight.deviceConnectionProviders,
      deviceResetBehavior: "device sync rows are deleted; users must reconnect wearables/devices after reset",
      environment: options.environmentLabel,
      member: {
        billingStatus: preflight.member.billingStatus,
        hasBillingRef: preflight.hasBillingRef,
        hasIdentity: preflight.hasIdentity,
        hasPhoneIdentity: preflight.hasPhoneIdentity,
        suspended: Boolean(preflight.member.suspendedAt),
      },
    });

    assertPreflightAllowsReset(preflight, options);
    await assertExternalExecutePreflight(options);

    if (!options.execute) {
      printJson("dry-run-complete", memberFingerprint, {
        note: "No rows were mutated. Re-run with --execute, --confirm-member-id, --confirm-environment, and --confirm-target-fingerprint to reset this member.",
      });
      return;
    }

    if (options.resumeSuspendedReset) {
      printJson("member-suspension-resumed", memberFingerprint, {});
    } else {
      await suspendMemberForReset({
        memberId: options.memberId,
        prisma,
      });
      printJson("member-suspended", memberFingerprint, {});
    }

    if (!options.skipTemporalTerminate) {
      printJson("temporal-terminate-start", memberFingerprint, {});
      const temporal = await terminateHostedUserRuntimeWorkflow(options.memberId);
      if (!temporal.terminated) {
        throw new Error("Temporal workflow termination did not complete.");
      }
      printJson("temporal-terminate-complete", memberFingerprint, temporal);
    } else {
      printJson("temporal-terminate-skipped", memberFingerprint, {});
    }

    let cloudflareBeforeDb: CloudflareDeleteResult | null = null;
    if (!options.skipCloudflareDelete) {
      printJson("cloudflare-delete-before-db-start", memberFingerprint, {});
      cloudflareBeforeDb = await deleteCloudflareHostedUserData(options.memberId);
      if (!isCloudflareHostedUserDataPreDbDeleteProven({
        deleteResult: cloudflareBeforeDb,
        resumeSuspendedReset: options.resumeSuspendedReset,
      })) {
        throw new Error("Cloudflare user-data deletion before DB reset did not prove deletion.");
      }
      printJson("cloudflare-delete-before-db-complete", memberFingerprint, cloudflareBeforeDb);
    } else {
      printJson("cloudflare-delete-before-db-skipped", memberFingerprint, {});
    }

    const resetResult = await resetHostedMemberDatabaseState({
      memberId: options.memberId,
      prisma,
    });
    printJson("db-reset-complete", memberFingerprint, resetResult);

    if (!options.skipCloudflareDelete) {
      printJson("cloudflare-delete-after-db-start", memberFingerprint, {});
      const cloudflare = await deleteCloudflareHostedUserData(options.memberId);
      if (!isCloudflareHostedUserDataPostDbDeleteProven({
        beforeDbDelete: cloudflareBeforeDb,
        afterDbDelete: cloudflare,
      })) {
        throw new Error("Cloudflare user-data deletion after DB reset did not prove deletion.");
      }
      printJson("cloudflare-delete-after-db-complete", memberFingerprint, cloudflare);
    } else {
      printJson("cloudflare-delete-after-db-skipped", memberFingerprint, {});
    }

    if (!options.skipTemporalTerminate) {
      printJson("temporal-final-terminate-start", memberFingerprint, {});
      const temporal = await terminateHostedUserRuntimeWorkflow(options.memberId);
      if (!temporal.terminated) {
        throw new Error("Final Temporal workflow termination did not complete.");
      }
      printJson("temporal-final-terminate-complete", memberFingerprint, temporal);
    }

    if (options.unsuspendAfterReset) {
      await unsuspendMemberAfterReset({
        memberId: options.memberId,
        prisma,
      });
      printJson("member-unsuspended", memberFingerprint, {});
      if (!options.skipTemporalTerminate) {
        try {
          const bootstrapSignal = await signalResetBootstrapMailboxItem({
            memberId: options.memberId,
            mailboxItemId: resetResult.freshBootstrap.mailboxItemId,
            prisma,
          });
          printJson("bootstrap-signal-complete", memberFingerprint, {
            workflowIdFingerprint: fingerprintIdentifier(bootstrapSignal.workflowId),
          });
        } catch (error) {
          await suspendMemberForReset({
            memberId: options.memberId,
            prisma,
          }).catch(() => {});
          printJson("member-resuspended-after-bootstrap-signal-failure", memberFingerprint, {});
          throw error;
        }
      } else {
        printJson("bootstrap-signal-skipped", memberFingerprint, {
          note: "Temporal termination was skipped; operator must manually verify the fresh runtime wake path before clearing reset risk.",
        });
      }
    } else {
      printJson("member-left-suspended", memberFingerprint, {
        note: "Default execute behavior. Rerun with --resume-suspended-reset or explicitly unsuspend after the operator is ready.",
      });
    }

    const verification = await readResetPreflight({
      memberId: options.memberId,
      prisma,
    });
    printJson("verification", memberFingerprint, {
      counts: verification.counts,
      member: {
        billingStatus: verification.member.billingStatus,
        hasBillingRef: verification.hasBillingRef,
        hasIdentity: verification.hasIdentity,
        hasPhoneIdentity: verification.hasPhoneIdentity,
        suspended: Boolean(verification.member.suspendedAt),
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

export function parseResetOptions(args: readonly string[]): ResetOptions {
  const options: ResetOptions = {
    confirmCloudflareCleaned: null,
    confirmEnvironment: null,
    confirmMemberId: null,
    confirmTargetFingerprint: null,
    confirmTemporalTerminated: null,
    confirmUnsuspendAfterReset: null,
    environmentLabel: DEFAULT_RESET_ENVIRONMENT,
    execute: false,
    leaveSuspended: false,
    memberId: "",
    resumeSuspendedReset: false,
    skipCloudflareDelete: false,
    skipTemporalTerminate: false,
    unsuspendAfterReset: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--":
        break;
      case "--member-id":
        options.memberId = requireNextArg(args, index, arg);
        index += 1;
        break;
      case "--environment":
        options.environmentLabel = requireNextArg(args, index, arg);
        index += 1;
        break;
      case "--confirm-environment":
        options.confirmEnvironment = requireNextArg(args, index, arg);
        index += 1;
        break;
      case "--confirm-member-id":
        options.confirmMemberId = requireNextArg(args, index, arg);
        index += 1;
        break;
      case "--confirm-target-fingerprint":
        options.confirmTargetFingerprint = requireNextArg(args, index, arg);
        index += 1;
        break;
      case "--confirm-cloudflare-cleaned":
        options.confirmCloudflareCleaned = requireNextArg(args, index, arg);
        index += 1;
        break;
      case "--confirm-temporal-terminated":
        options.confirmTemporalTerminated = requireNextArg(args, index, arg);
        index += 1;
        break;
      case "--confirm-unsuspend-after-reset":
        options.confirmUnsuspendAfterReset = requireNextArg(args, index, arg);
        index += 1;
        break;
      case "--dry-run":
        options.execute = false;
        break;
      case "--execute":
        options.execute = true;
        break;
      case "--leave-suspended":
        options.leaveSuspended = true;
        break;
      case "--resume-suspended-reset":
        options.resumeSuspendedReset = true;
        break;
      case "--unsuspend-after-reset":
        options.unsuspendAfterReset = true;
        break;
      case "--skip-cloudflare-delete":
        options.skipCloudflareDelete = true;
        break;
      case "--skip-temporal-terminate":
        options.skipTemporalTerminate = true;
        break;
      case "--help":
      case "-h":
        printUsageAndExit(0);
        break;
      default:
        throw new Error("Unknown argument.");
    }
  }

  options.environmentLabel = normalizeResetEnvironmentLabel(options.environmentLabel);
  options.memberId = options.memberId.trim();
  options.confirmCloudflareCleaned = options.confirmCloudflareCleaned?.trim() || null;
  options.confirmEnvironment = options.confirmEnvironment?.trim() || null;
  options.confirmMemberId = options.confirmMemberId?.trim() || null;
  options.confirmTargetFingerprint = options.confirmTargetFingerprint?.trim() || null;
  options.confirmTemporalTerminated = options.confirmTemporalTerminated?.trim() || null;
  options.confirmUnsuspendAfterReset = options.confirmUnsuspendAfterReset?.trim() || null;

  if (!options.memberId) {
    throw new Error("Missing required --member-id.");
  }

  if (options.execute && options.confirmMemberId !== options.memberId) {
    throw new Error("--execute requires --confirm-member-id with the exact same member id.");
  }

  if (options.execute && options.confirmEnvironment !== options.environmentLabel) {
    throw new Error("--execute requires --confirm-environment with the exact same environment label.");
  }

  if (options.resumeSuspendedReset && !options.execute) {
    throw new Error("--resume-suspended-reset can only be used with --execute.");
  }

  if (options.leaveSuspended && options.unsuspendAfterReset) {
    throw new Error("--leave-suspended cannot be combined with --unsuspend-after-reset.");
  }

  if (options.execute && options.skipCloudflareDelete && options.confirmCloudflareCleaned !== options.memberId) {
    throw new Error("--skip-cloudflare-delete requires --confirm-cloudflare-cleaned with the exact same member id.");
  }

  if (options.execute && options.skipTemporalTerminate && options.confirmTemporalTerminated !== options.memberId) {
    throw new Error("--skip-temporal-terminate requires --confirm-temporal-terminated with the exact same member id.");
  }

  if (options.execute && options.unsuspendAfterReset && options.confirmUnsuspendAfterReset !== options.memberId) {
    throw new Error("--unsuspend-after-reset requires --confirm-unsuspend-after-reset with the exact same member id.");
  }

  return options;
}

function requireNextArg(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function normalizeResetEnvironmentLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("--environment requires a non-empty label.");
  }
  if (!/^[A-Za-z0-9_.:-]+$/u.test(normalized)) {
    throw new Error("--environment may only contain letters, numbers, dots, colons, underscores, or hyphens.");
  }
  return normalized;
}

function printUsageAndExit(code: number): never {
  console.log([
    "Usage:",
    "  pnpm --dir apps/web admin:reset-member -- --member-id <id> --dry-run --environment production",
    "  pnpm --dir apps/web admin:reset-member -- --member-id <id> --execute --confirm-member-id <id> --environment production --confirm-environment production --confirm-target-fingerprint <fingerprint>",
    "",
    "Optional execute flags:",
    "  --environment <label>        Target label for operator confirmation; defaults to production.",
    "  --confirm-environment <label>",
    "  --confirm-target-fingerprint <fingerprint>",
    "  --resume-suspended-reset       Continue a failed reset while the member is already suspended.",
    "  --unsuspend-after-reset        Clear suspension after all reset barriers pass.",
    "  --confirm-unsuspend-after-reset <id>",
    "  --leave-suspended              Default execute behavior; accepted for explicitness.",
    "  --skip-cloudflare-delete        Explicitly skip Cloudflare user-data deletion.",
    "  --confirm-cloudflare-cleaned <id>",
    "  --skip-temporal-terminate       Explicitly skip Temporal workflow termination.",
    "  --confirm-temporal-terminated <id>",
  ].join("\n"));
  process.exit(code);
}

function createPrismaFromEnvironment(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be configured before running hosted member reset.");
  }

  return createPrismaClient({
    databaseUrl,
    poolMax: 1,
  });
}

async function readResetPreflight(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<{
  counts: CountSnapshot;
  deviceConnectionProviders: DeviceConnectionProviderSummary[];
  hasBillingRef: boolean;
  hasIdentity: boolean;
  hasPhoneIdentity: boolean;
  member: {
    billingStatus: string;
    suspendedAt: Date | null;
  };
}> {
  const member = await input.prisma.hostedMember.findUnique({
    select: {
      billingStatus: true,
      suspendedAt: true,
    },
    where: {
      id: input.memberId,
    },
  });

  if (!member) {
    throw new Error("Hosted member was not found.");
  }

  const [identity, billingRef, counts, deviceConnectionProviders] = await Promise.all([
    readHostedMemberIdentity({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
    readHostedMemberStripeBillingRef({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
    countResetRows({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
    summarizeDeviceConnectionProviders({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
  ]);

  return {
    counts,
    deviceConnectionProviders,
    hasBillingRef: Boolean(billingRef?.stripeCustomerId || billingRef?.stripeSubscriptionId),
    hasIdentity: Boolean(identity?.privyUserId || identity?.walletAddress),
    hasPhoneIdentity: Boolean(identity?.phoneLookupKey || identity?.phoneNumber),
    member,
  };
}

export function assertPreflightAllowsReset(
  preflight: Awaited<ReturnType<typeof readResetPreflight>>,
  options: ResetOptions,
): void {
  if (preflight.member.billingStatus !== "active") {
    throw new Error("Hosted member must have active billing status before reset.");
  }

  if (preflight.member.suspendedAt && !options.resumeSuspendedReset) {
    throw new Error("Hosted member is already suspended. Refusing to reset without a clean starting gate.");
  }

  if (!preflight.member.suspendedAt && options.resumeSuspendedReset) {
    throw new Error("--resume-suspended-reset requires the hosted member to already be suspended.");
  }

  if (!preflight.hasBillingRef) {
    throw new Error("Hosted member billing ref is missing or undecryptable.");
  }

  if (!preflight.hasIdentity) {
    throw new Error("Hosted member Privy/wallet identity is missing or undecryptable.");
  }

  if (!preflight.hasPhoneIdentity) {
    throw new Error("Hosted member phone identity is missing or undecryptable; sparse post-reset SMS/Linq routing cannot reconnect automatically.");
  }

  if (preflight.counts.hostedUserCryptoEnvelopeControl < 1) {
    throw new Error("Hosted member does not have a decryptable control crypto root to preserve.");
  }

  if (options.execute && !options.skipTemporalTerminate && !isTemporalConfigured()) {
    throw new Error("Temporal is not configured. Pass --skip-temporal-terminate only after manual termination.");
  }

  if (options.execute && !options.skipCloudflareDelete && !isCloudflareControlConfigured()) {
    throw new Error("Cloudflare control is not configured. Pass --skip-cloudflare-delete only after manual cleanup.");
  }
}

export function assertResetExecutionTargetConfirmed(
  options: Pick<ResetOptions, "confirmTargetFingerprint" | "execute">,
  targets: Pick<ResetExecutionTargetSummary, "executionTargetFingerprint">,
): void {
  if (!options.execute) {
    return;
  }

  if (options.confirmTargetFingerprint !== targets.executionTargetFingerprint) {
    throw new Error("--execute requires --confirm-target-fingerprint matching the printed executionTargetFingerprint.");
  }
}

async function assertExternalExecutePreflight(options: ResetOptions): Promise<void> {
  if (!options.execute) {
    return;
  }

  if (!options.skipTemporalTerminate) {
    await assertTemporalConnectable();
  }

  if (!options.skipCloudflareDelete) {
    await createHostedExecutionVercelOidcBearerTokenProvider()();
  }
}

async function countResetRows(input: {
  memberId: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<CountSnapshot> {
  const [
    hostedMailboxPayload,
    hostedIngressLatencyTrace,
    hostedMailboxItem,
    hostedMailboxLaneCounter,
    hostedRuntimeLog,
    hostedUserCryptoAuditResetDomains,
    hostedUserCryptoAuditControl,
    hostedUserCryptoEnvelopeResetDomains,
    hostedUserCryptoEnvelopeControl,
    hostedAiUsage,
    hostedAiUsageNonSkipped,
    hostedAiUsagePeriod,
    hostedConsentEventNonLaunch,
    hostedConsentGrantNonLaunch,
    hostedLinqDailyState,
    hostedInvite,
    hostedMemberRouting,
    hostedMemberEmailAuthorization,
    hostedMemberIdentityPhoneFields,
    hostedWorkspace,
    hostedWebInternalRequestNonce,
    hostedWebSession,
    deviceTokenAudit,
    deviceSyncDirtyPayload,
    deviceSyncDirtyConnection,
    deviceSyncSignal,
    deviceOauthSession,
    deviceConnectIntent,
    deviceAgentSession,
    deviceBrowserAssertionNonce,
    deviceConnection,
    deviceWebhookTraceOwners,
  ] = await Promise.all([
    input.prisma.hostedMailboxPayload.count({ where: { userId: input.memberId } }),
    input.prisma.hostedIngressLatencyTrace.count({ where: { userId: input.memberId } }),
    input.prisma.hostedMailboxItem.count({ where: { userId: input.memberId } }),
    input.prisma.hostedMailboxLaneCounter.count({ where: { userId: input.memberId } }),
    input.prisma.hostedRuntimeLog.count({ where: { userId: input.memberId } }),
    countHostedCryptoAuditRows(input.prisma, input.memberId, RESET_DOMAINS),
    countHostedCryptoAuditRows(input.prisma, input.memberId, ["control"]),
    countHostedCryptoEnvelopeRows(input.prisma, input.memberId, RESET_DOMAINS),
    countHostedCryptoEnvelopeRows(input.prisma, input.memberId, ["control"]),
    input.prisma.hostedAiUsage.count({ where: { memberId: input.memberId } }),
    input.prisma.hostedAiUsage.count({
      where: {
        memberId: input.memberId,
        NOT: {
          stripeMeterStatus: "skipped",
        },
      },
    }),
    input.prisma.hostedAiUsagePeriod.count({ where: { memberId: input.memberId } }),
    input.prisma.hostedConsentEvent.count({
      where: hostedConsentEventNonLaunchWhere(input.memberId),
    }),
    input.prisma.hostedConsentGrant.count({
      where: hostedConsentGrantNonLaunchWhere(input.memberId),
    }),
    input.prisma.hostedLinqDailyState.count({ where: { memberId: input.memberId } }),
    input.prisma.hostedInvite.count({ where: { memberId: input.memberId } }),
    input.prisma.hostedMemberRouting.count({ where: { memberId: input.memberId } }),
    input.prisma.hostedMemberEmailAuthorization.count({ where: { memberId: input.memberId } }),
    input.prisma.hostedMemberIdentity.count({
      where: hostedMemberIdentityPhoneFieldsWhere(input.memberId),
    }),
    input.prisma.hostedWorkspace.count({ where: { userId: input.memberId } }),
    input.prisma.hostedWebInternalRequestNonce.count({ where: { userId: input.memberId } }),
    input.prisma.hostedWebSession.count({ where: { memberId: input.memberId } }),
    input.prisma.deviceTokenAudit.count({ where: { userId: input.memberId } }),
    input.prisma.deviceSyncDirtyPayload.count({ where: { userId: input.memberId } }),
    input.prisma.deviceSyncDirtyConnection.count({ where: { userId: input.memberId } }),
    input.prisma.deviceSyncSignal.count({ where: { userId: input.memberId } }),
    input.prisma.deviceOauthSession.count({ where: { userId: input.memberId } }),
    input.prisma.deviceConnectIntent.count({ where: { memberId: input.memberId } }),
    input.prisma.deviceAgentSession.count({ where: { userId: input.memberId } }),
    input.prisma.deviceBrowserAssertionNonce.count({ where: { userId: input.memberId } }),
    input.prisma.deviceConnection.count({ where: { userId: input.memberId } }),
    countDeviceWebhookTraceOwners(input.prisma, input.memberId),
  ]);

  return {
    deviceAgentSession,
    deviceBrowserAssertionNonce,
    deviceConnectIntent,
    deviceConnection,
    deviceOauthSession,
    deviceSyncDirtyConnection,
    deviceSyncDirtyPayload,
    deviceSyncSignal,
    deviceTokenAudit,
    deviceWebhookTraceOwners,
    hostedAiUsage,
    hostedAiUsageNonSkipped,
    hostedAiUsagePeriod,
    hostedConsentEventNonLaunch,
    hostedConsentGrantNonLaunch,
    hostedIngressLatencyTrace,
    hostedInvite,
    hostedLinqDailyState,
    hostedMemberEmailAuthorization,
    hostedMemberIdentityPhoneFields,
    hostedMemberRouting,
    hostedMailboxItem,
    hostedMailboxLaneCounter,
    hostedMailboxPayload,
    hostedRuntimeLog,
    hostedUserCryptoAuditControl,
    hostedUserCryptoAuditResetDomains,
    hostedUserCryptoEnvelopeControl,
    hostedUserCryptoEnvelopeResetDomains,
    hostedWebInternalRequestNonce,
    hostedWebSession,
    hostedWorkspace,
  };
}

async function suspendMemberForReset(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  const updated = await input.prisma.hostedMember.updateMany({
    data: {
      suspendedAt: new Date(),
    },
    where: {
      id: input.memberId,
      suspendedAt: null,
    },
  });

  if (updated.count !== 1) {
    throw new Error("Failed to enter reset suspension gate.");
  }
}

async function unsuspendMemberAfterReset(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  const updated = await input.prisma.hostedMember.updateMany({
    data: {
      suspendedAt: null,
    },
    where: {
      id: input.memberId,
      suspendedAt: {
        not: null,
      },
    },
  });

  if (updated.count !== 1) {
    throw new Error("Failed to clear reset suspension gate.");
  }
}

async function resetHostedMemberDatabaseState(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<{
  deletedCounts: DeleteCounts;
  freshBootstrap: {
    inserted: boolean;
    kind: string;
    lane: string;
    laneSeq: string;
    mailboxItemId: string;
    memberChannels: HostedExecutionMemberChannels;
  };
  freshWorkspaceVersion: string;
  postCounts: CountSnapshot;
}> {
  return input.prisma.$transaction(async (tx) => {
    const lockedMember = await lockHostedMemberForResetTx({
      memberId: input.memberId,
      tx,
    });

    const preCounts = await countResetRows({
      memberId: input.memberId,
      prisma: tx,
    });
    const existingWorkspace = await tx.hostedWorkspace.findUnique({
      select: {
        version: true,
      },
      where: {
        userId: input.memberId,
      },
    });
    const freshWorkspaceVersion = (existingWorkspace?.version ?? 0n) + 1n;
    const deletedCounts = await deleteResetRowsTx({
      memberId: input.memberId,
      tx,
    });

    await tx.hostedWorkspace.create({
      data: {
        userId: input.memberId,
        version: freshWorkspaceVersion,
      },
    });

    for (const domain of RESET_DOMAINS) {
      await provisionActiveHostedDomainRootEnvelopeForUserOnly({
        domain,
        prisma: tx,
        reason: "hosted-member-runtime-reset",
        userId: input.memberId,
      });
    }

    const memberChannels = await readResetBootstrapMemberChannelsTx({
      memberId: input.memberId,
      tx,
    });
    const freshBootstrap = await appendResetMemberActivatedMailboxItemTx({
      memberChannels,
      memberId: input.memberId,
      timeZone: lockedMember.pendingActivationTimeZone,
      tx,
    });

    const postCounts = await countResetRows({
      memberId: input.memberId,
      prisma: tx,
    });

    assertPostResetCounts(postCounts);

    return {
      deletedCounts,
      freshBootstrap,
      freshWorkspaceVersion: freshWorkspaceVersion.toString(),
      postCounts,
    };
  }, RESET_TRANSACTION_OPTIONS);
}

async function appendResetMemberActivatedMailboxItemTx(input: {
  memberChannels: HostedExecutionMemberChannels;
  memberId: string;
  timeZone: string | null;
  tx: Prisma.TransactionClient;
}): Promise<{
  inserted: boolean;
  kind: string;
  lane: string;
  laneSeq: string;
  mailboxItemId: string;
  memberChannels: HostedExecutionMemberChannels;
}> {
  const append = await appendHostedMailboxEnvelopeTx({
    envelope: buildResetMemberActivatedWake({
      memberChannels: input.memberChannels,
      memberId: input.memberId,
      occurredAt: new Date().toISOString(),
      timeZone: input.timeZone,
    }),
    tx: input.tx,
  });

  if (!append.inserted || append.dedupeConflict) {
    throw new Error("Fresh member activation bootstrap mailbox item was not inserted cleanly.");
  }
  if (append.item.kind !== "member.activated" || append.item.lane !== "system") {
    throw new Error("Fresh member activation bootstrap mailbox item was routed incorrectly.");
  }

  return {
    inserted: append.inserted,
    kind: append.item.kind,
    lane: append.item.lane,
    laneSeq: String(append.item.laneSeq),
    mailboxItemId: append.item.id,
    memberChannels: input.memberChannels,
  };
}

export function buildResetMemberActivatedWake(input: {
  memberChannels: HostedExecutionMemberChannels;
  memberId: string;
  occurredAt: string;
  timeZone?: string | null;
}) {
  const eventFingerprint = createHash("sha256")
    .update(`${input.memberId}:${input.occurredAt}`)
    .digest("hex")
    .slice(0, 32);
  const timeZone = input.timeZone?.trim();

  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:runtime-reset:${eventFingerprint}`,
    memberChannels: input.memberChannels,
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    ...(timeZone ? { timeZone } : {}),
  });
}

async function readResetBootstrapMemberChannelsTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedExecutionMemberChannels> {
  const member = await readHostedMemberSnapshot({
    memberId: input.memberId,
    prisma: input.tx,
  });

  if (!member) {
    throw new Error("Hosted member reset could not read preserved contact channel state.");
  }

  const emailLinked = await resolveHostedMemberEmailLinked({
    memberId: input.memberId,
    prisma: input.tx,
  });

  return resolveHostedMemberChannelsForSnapshot({
    emailLinked,
    member,
  });
}

export function assertPostResetCounts(counts: CountSnapshot): void {
  const failures: string[] = [];
  const expectZero = (key: keyof CountSnapshot) => {
    if (counts[key] !== 0) {
      failures.push(`${key}=${counts[key]}`);
    }
  };

  expectZero("deviceAgentSession");
  expectZero("deviceBrowserAssertionNonce");
  expectZero("deviceConnectIntent");
  expectZero("deviceConnection");
  expectZero("deviceOauthSession");
  expectZero("deviceSyncDirtyConnection");
  expectZero("deviceSyncDirtyPayload");
  expectZero("deviceSyncSignal");
  expectZero("deviceTokenAudit");
  expectZero("deviceWebhookTraceOwners");
  expectZero("hostedAiUsage");
  expectZero("hostedAiUsageNonSkipped");
  expectZero("hostedAiUsagePeriod");
  expectZero("hostedIngressLatencyTrace");
  expectZero("hostedInvite");
  expectZero("hostedLinqDailyState");
  expectZero("hostedMailboxPayload");
  expectZero("hostedWebInternalRequestNonce");
  expectZero("hostedWebSession");

  if (counts.hostedMailboxItem !== 1) {
    failures.push(`hostedMailboxItem=${counts.hostedMailboxItem}`);
  }
  if (counts.hostedMailboxLaneCounter !== 1) {
    failures.push(`hostedMailboxLaneCounter=${counts.hostedMailboxLaneCounter}`);
  }
  if (counts.hostedRuntimeLog !== 1) {
    failures.push(`hostedRuntimeLog=${counts.hostedRuntimeLog}`);
  }
  if (counts.hostedUserCryptoEnvelopeControl < 1) {
    failures.push("hostedUserCryptoEnvelopeControl<1");
  }
  if (counts.hostedUserCryptoEnvelopeResetDomains !== RESET_DOMAINS.length) {
    failures.push(`hostedUserCryptoEnvelopeResetDomains=${counts.hostedUserCryptoEnvelopeResetDomains}`);
  }
  if (counts.hostedUserCryptoAuditResetDomains !== RESET_DOMAINS.length) {
    failures.push(`hostedUserCryptoAuditResetDomains=${counts.hostedUserCryptoAuditResetDomains}`);
  }
  if (counts.hostedWorkspace !== 1) {
    failures.push(`hostedWorkspace=${counts.hostedWorkspace}`);
  }

  if (failures.length > 0) {
    throw new Error(`Post-reset verification failed: ${failures.join(", ")}`);
  }
}

async function deleteResetRowsTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<DeleteCounts> {
  const counts: DeleteCounts = {
    deviceAgentSession: 0,
    deviceBrowserAssertionNonce: 0,
    deviceConnectIntent: 0,
    deviceConnection: 0,
    deviceOauthSession: 0,
    deviceSyncDirtyConnection: 0,
    deviceSyncDirtyPayload: 0,
    deviceSyncSignal: 0,
    deviceTokenAudit: 0,
    deviceWebhookTraceOwners: 0,
    hostedAiUsage: 0,
    hostedAiUsagePeriod: 0,
    hostedIngressLatencyTrace: 0,
    hostedInvite: 0,
    hostedLinqDailyState: 0,
    hostedMailboxItem: 0,
    hostedMailboxLaneCounter: 0,
    hostedMailboxPayload: 0,
    hostedRuntimeLog: 0,
    hostedUserCryptoAuditResetDomains: 0,
    hostedUserCryptoEnvelopeResetDomains: 0,
    hostedWebInternalRequestNonce: 0,
    hostedWebSession: 0,
    hostedWorkspace: 0,
  };
  const deviceWebhookTraceWhere = await buildDeviceWebhookTraceWhereForMemberTx({
    memberId: input.memberId,
    tx: input.tx,
  });

  await input.tx.hostedMemberRouting.updateMany({
    data: {
      linqChatIdEncrypted: null,
      linqChatLookupKey: null,
      pendingLinqChatIdEncrypted: null,
      pendingLinqChatLookupKey: null,
      pendingLinqParticipantContactEncrypted: null,
      pendingLinqParticipantContactKind: null,
      pendingLinqParticipantContactLookupKey: null,
      pendingLinqParticipantContactObservedAt: null,
      pendingLinqRecipientPhoneEncrypted: null,
      pendingLinqRecipientPhoneLookupKey: null,
    },
    where: {
      memberId: input.memberId,
    },
  });
  counts.hostedMailboxPayload = (await input.tx.hostedMailboxPayload.deleteMany({ where: { userId: input.memberId } })).count;
  counts.hostedIngressLatencyTrace = (await input.tx.hostedIngressLatencyTrace.deleteMany({ where: { userId: input.memberId } })).count;
  counts.hostedMailboxItem = (await input.tx.hostedMailboxItem.deleteMany({ where: { userId: input.memberId } })).count;
  counts.hostedMailboxLaneCounter = (await input.tx.hostedMailboxLaneCounter.deleteMany({ where: { userId: input.memberId } })).count;
  counts.hostedRuntimeLog = (await input.tx.hostedRuntimeLog.deleteMany({ where: { userId: input.memberId } })).count;
  counts.hostedUserCryptoAuditResetDomains = await deleteHostedCryptoAuditRows(input.tx, input.memberId, RESET_DOMAINS);
  counts.hostedUserCryptoEnvelopeResetDomains = await deleteHostedCryptoEnvelopeRows(input.tx, input.memberId, RESET_DOMAINS);
  counts.hostedAiUsage = (await input.tx.hostedAiUsage.deleteMany({ where: { memberId: input.memberId } })).count;
  counts.hostedAiUsagePeriod = (await input.tx.hostedAiUsagePeriod.deleteMany({ where: { memberId: input.memberId } })).count;
  counts.hostedLinqDailyState = (await input.tx.hostedLinqDailyState.deleteMany({ where: { memberId: input.memberId } })).count;
  counts.hostedInvite = (await input.tx.hostedInvite.deleteMany({ where: { memberId: input.memberId } })).count;
  counts.hostedWorkspace = (await input.tx.hostedWorkspace.deleteMany({ where: { userId: input.memberId } })).count;
  counts.hostedWebInternalRequestNonce = (await input.tx.hostedWebInternalRequestNonce.deleteMany({
    where: { userId: input.memberId },
  })).count;
  counts.hostedWebSession = (await input.tx.hostedWebSession.deleteMany({ where: { memberId: input.memberId } })).count;
  counts.deviceTokenAudit = (await input.tx.deviceTokenAudit.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceSyncDirtyPayload = (await input.tx.deviceSyncDirtyPayload.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceSyncDirtyConnection = (await input.tx.deviceSyncDirtyConnection.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceSyncSignal = (await input.tx.deviceSyncSignal.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceOauthSession = (await input.tx.deviceOauthSession.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceConnectIntent = (await input.tx.deviceConnectIntent.deleteMany({ where: { memberId: input.memberId } })).count;
  counts.deviceAgentSession = (await input.tx.deviceAgentSession.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceBrowserAssertionNonce = (await input.tx.deviceBrowserAssertionNonce.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceWebhookTraceOwners = deviceWebhookTraceWhere
    ? (await input.tx.deviceWebhookTrace.deleteMany({ where: deviceWebhookTraceWhere })).count
    : 0;
  counts.deviceConnection = (await input.tx.deviceConnection.deleteMany({ where: { userId: input.memberId } })).count;

  return counts;
}

async function lockHostedMemberForResetTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<{ pendingActivationTimeZone: string | null }> {
  const rows = await input.tx.$queryRaw<Array<{
    id: string;
    pendingActivationTimeZone: string | null;
  }>>`
    SELECT
      id,
      pending_activation_time_zone AS "pendingActivationTimeZone"
    FROM hosted_member
    WHERE id = ${input.memberId}
      AND suspended_at IS NOT NULL
    FOR UPDATE
  `;

  if (rows.length !== 1) {
    throw new Error("Hosted member reset requires the member to be suspended and locked.");
  }

  return {
    pendingActivationTimeZone: rows[0]?.pendingActivationTimeZone ?? null,
  };
}

async function summarizeDeviceConnectionProviders(input: {
  memberId: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<DeviceConnectionProviderSummary[]> {
  const connections = await input.prisma.deviceConnection.findMany({
    orderBy: [
      { provider: "asc" },
      { id: "asc" },
    ],
    select: {
      provider: true,
    },
    where: {
      userId: input.memberId,
    },
  });

  const counts = new Map<string, number>();
  for (const connection of connections) {
    counts.set(connection.provider, (counts.get(connection.provider) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([provider, count]) => ({ count, provider }))
    .sort((left, right) => left.provider.localeCompare(right.provider));
}

async function buildDeviceWebhookTraceWhereForMemberTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<Prisma.DeviceWebhookTraceWhereInput | null> {
  const traceOwners = await readDeviceWebhookTraceOwnersForMember({
    memberId: input.memberId,
    prisma: input.tx,
  });

  return traceOwners.length > 0 ? { OR: traceOwners } : null;
}

async function readDeviceWebhookTraceOwnersForMember(input: {
  memberId: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<DeviceWebhookTraceOwner[]> {
  const connections = await input.prisma.deviceConnection.findMany({
    orderBy: [
      { provider: "asc" },
      { id: "asc" },
    ],
    select: {
      provider: true,
      providerAccountBlindIndex: true,
    },
    where: {
      userId: input.memberId,
    },
  });

  const seenTraceOwners = new Set<string>();
  const traceOwners: DeviceWebhookTraceOwner[] = [];
  for (const connection of connections) {
    const providerAccountBlindIndex = connection.providerAccountBlindIndex.trim();
    if (!providerAccountBlindIndex) {
      continue;
    }

    const key = `${connection.provider}:${providerAccountBlindIndex}`;
    if (seenTraceOwners.has(key)) {
      continue;
    }
    seenTraceOwners.add(key);
    traceOwners.push({
      provider: connection.provider,
      providerAccountBlindIndex,
    });
  }

  return traceOwners.sort((left, right) =>
    `${left.provider}:${left.providerAccountBlindIndex}`
      .localeCompare(`${right.provider}:${right.providerAccountBlindIndex}`)
  );
}

async function countHostedCryptoEnvelopeRows(
  prisma: PrismaClient | Prisma.TransactionClient,
  memberId: string,
  domains: readonly string[],
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM hosted_user_crypto_envelope
    WHERE user_id = ${memberId}
      AND domain IN (${Prisma.join(domains.map((domain) => Prisma.sql`${domain}::hosted_crypto_domain`))})
  `;
  return Number(rows[0]?.count ?? 0n);
}

async function countHostedCryptoAuditRows(
  prisma: PrismaClient | Prisma.TransactionClient,
  memberId: string,
  domains: readonly string[],
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM hosted_user_crypto_audit
    WHERE user_id = ${memberId}
      AND domain IN (${Prisma.join(domains.map((domain) => Prisma.sql`${domain}::hosted_crypto_domain`))})
  `;
  return Number(rows[0]?.count ?? 0n);
}

async function countDeviceWebhookTraceOwners(
  prisma: PrismaClient | Prisma.TransactionClient,
  memberId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM device_webhook_trace trace
    WHERE EXISTS (
      SELECT 1
      FROM device_connection connection
      WHERE connection.user_id = ${memberId}
        AND connection.provider = trace.provider
        AND connection.provider_account_blind_index = trace.provider_account_blind_index
    )
  `;
  return Number(rows[0]?.count ?? 0n);
}

function hostedMemberIdentityPhoneFieldsWhere(memberId: string): Prisma.HostedMemberIdentityWhereInput {
  return {
    memberId,
    OR: [
      { maskedPhoneNumberHint: { not: null } },
      { phoneLookupKey: { not: null } },
      { phoneNumberEncrypted: { not: null } },
      { phoneNumberVerifiedAt: { not: null } },
      { signupPhoneNumberEncrypted: { not: null } },
      { signupPhoneCodeSentAt: { not: null } },
      { signupPhoneCodeSendAttemptId: { not: null } },
      { signupPhoneCodeSendAttemptStartedAt: { not: null } },
    ],
  };
}

function hostedConsentEventNonLaunchWhere(memberId: string): Prisma.HostedConsentEventWhereInput {
  return {
    memberId,
    scope: {
      notIn: Array.from(LAUNCH_CONSENT_SCOPES),
    },
  };
}

function hostedConsentGrantNonLaunchWhere(memberId: string): Prisma.HostedConsentGrantWhereInput {
  return {
    memberId,
    scope: {
      notIn: Array.from(LAUNCH_CONSENT_SCOPES),
    },
  };
}

async function deleteHostedCryptoEnvelopeRows(
  prisma: Prisma.TransactionClient,
  memberId: string,
  domains: readonly string[],
): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM hosted_user_crypto_envelope
    WHERE user_id = ${memberId}
      AND domain IN (${Prisma.join(domains.map((domain) => Prisma.sql`${domain}::hosted_crypto_domain`))})
  `;
}

async function deleteHostedCryptoAuditRows(
  prisma: Prisma.TransactionClient,
  memberId: string,
  domains: readonly string[],
): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM hosted_user_crypto_audit
    WHERE user_id = ${memberId}
      AND domain IN (${Prisma.join(domains.map((domain) => Prisma.sql`${domain}::hosted_crypto_domain`))})
  `;
}

async function terminateHostedUserRuntimeWorkflow(userId: string): Promise<TemporalTerminateResult> {
  const environment = readHostedRuntimeTemporalEnvironment(process.env, {
    defaultAddress: null,
  });
  if (!environment.address) {
    return {
      configured: false,
      notFound: null,
      terminated: false,
    };
  }

  const connection = await Connection.connect(buildTemporalConnectionOptions(environment));
  try {
    const client = new Client({
      connection,
      namespace: environment.namespace,
    });
    try {
      await withTimeout(
        client.workflow.getHandle(hostedUserRuntimeWorkflowId(userId)).terminate("hosted-member-runtime-reset"),
        TEMPORAL_TERMINATION_TIMEOUT_MS,
        "Temporal workflow termination timed out.",
      );
      return {
        configured: true,
        notFound: false,
        terminated: true,
      };
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return {
          configured: true,
          notFound: true,
          terminated: true,
        };
      }
      throw error;
    }
  } finally {
    await connection.close();
  }
}

function isTemporalConfigured(): boolean {
  const environment = readHostedRuntimeTemporalEnvironment(process.env, {
    defaultAddress: null,
  });
  return Boolean(environment.address);
}

async function assertTemporalConnectable(): Promise<void> {
  const environment = readHostedRuntimeTemporalEnvironment(process.env, {
    defaultAddress: null,
  });
  if (!environment.address) {
    throw new Error("Temporal is not configured.");
  }

  const connection = await Connection.connect(buildTemporalConnectionOptions(environment));
  await connection.close();
}

async function signalResetBootstrapMailboxItem(input: {
  mailboxItemId: string;
  memberId: string;
  prisma: PrismaClient;
}): Promise<TemporalSignalResult> {
  const mailboxItem = await input.prisma.hostedMailboxItem.findUnique({
    select: {
      id: true,
      lane: true,
      laneSeq: true,
      userId: true,
    },
    where: {
      id: input.mailboxItemId,
    },
  });

  if (!mailboxItem) {
    throw new Error("Fresh reset bootstrap mailbox item is missing.");
  }
  if (mailboxItem.userId !== input.memberId) {
    throw new Error("Fresh reset bootstrap mailbox item belongs to a different member.");
  }

  const environment = readHostedRuntimeTemporalEnvironment(process.env, {
    defaultAddress: null,
  });
  if (!environment.address) {
    throw new Error("Temporal is not configured for reset bootstrap signal.");
  }

  const workflowId = hostedUserRuntimeWorkflowId(input.memberId);
  const signal = parseHostedRuntimeSignal({
    kind: "mailbox_appended",
    lane: mailboxItem.lane,
    laneSeq: String(mailboxItem.laneSeq),
    mailboxItemId: mailboxItem.id,
    source: "hosted-member-runtime-reset",
  });

  const connection = await Connection.connect(buildTemporalConnectionOptions(environment));
  try {
    const client = new Client({
      connection,
      namespace: environment.namespace,
    });

    await withTimeout(
      client.workflow.signalWithStart(HOSTED_USER_RUNTIME_WORKFLOW_TYPE, {
        args: [{
          options: readHostedRuntimeTemporalWorkflowOptions(process.env),
          userId: input.memberId,
        }],
        signal: HOSTED_USER_RUNTIME_SIGNAL_NAME,
        signalArgs: [signal],
        taskQueue: environment.taskQueue,
        workflowId,
      }),
      TEMPORAL_TERMINATION_TIMEOUT_MS,
      "Temporal reset bootstrap signal timed out.",
    );

    return {
      signalAccepted: true,
      workflowId,
    };
  } finally {
    await connection.close();
  }
}

function buildTemporalConnectionOptions(
  environment: ReturnType<typeof readHostedRuntimeTemporalEnvironment>,
): ConnectionOptions {
  if (!environment.address) {
    throw new Error("HOSTED_TEMPORAL_ADDRESS is required.");
  }
  return {
    address: environment.address,
    ...(environment.apiKey ? { apiKey: environment.apiKey } : {}),
    connectTimeout: TEMPORAL_TERMINATION_TIMEOUT_MS,
    tls: environment.tls,
  };
}

async function deleteCloudflareHostedUserData(userId: string): Promise<CloudflareDeleteResult> {
  const { controlTimeoutMs } = readHostedExecutionControlEnvironment();
  const baseUrl = readHostedExecutionControlBaseUrl();
  if (!baseUrl) {
    return {
      alarmCleared: null,
      configured: false,
      deleted: false,
      r2DeletedObjectCount: null,
      r2SkippedUserScopedPrefixes: null,
      runnerStateDeleted: null,
    };
  }

  const client = createCloudflareHostedControlClient({
    allowHttpLocalhost: true,
    baseUrl,
    getBearerToken: createHostedExecutionVercelOidcBearerTokenProvider(),
    timeoutMs: controlTimeoutMs,
  });
  const result = await client.deleteUserData(userId);
  const deleted = isCloudflareHostedUserDataDeleteProven({
    alarmCleared: result.durableObject.alarmCleared,
    r2SkippedUserScopedPrefixes: result.r2.skippedUserScopedPrefixes,
    r2Supported: result.r2.supported,
    runnerStateDeleted: result.durableObject.stateDeleted,
  });

  return {
    alarmCleared: result.durableObject.alarmCleared,
    configured: true,
    deleted,
    r2DeletedObjectCount: result.r2.deletedObjectCount,
    r2SkippedUserScopedPrefixes: result.r2.skippedUserScopedPrefixes,
    runnerStateDeleted: result.durableObject.stateDeleted,
  };
}

function isCloudflareControlConfigured(): boolean {
  return Boolean(readHostedExecutionControlBaseUrl());
}

export function isCloudflareHostedUserDataDeleteProven(input: {
  alarmCleared: boolean | null;
  r2SkippedUserScopedPrefixes: boolean | null;
  r2Supported: boolean;
  runnerStateDeleted: boolean | null;
}): boolean {
  return input.alarmCleared === true
    && input.runnerStateDeleted === true
    && input.r2Supported
    && input.r2SkippedUserScopedPrefixes === false;
}

export function isCloudflareHostedUserDataPreDbDeleteProven(input: {
  deleteResult: CloudflareDeleteResult;
  resumeSuspendedReset: boolean;
}): boolean {
  if (input.deleteResult.deleted) {
    return true;
  }

  return input.resumeSuspendedReset
    && input.deleteResult.configured === true
    && input.deleteResult.alarmCleared === true
    && input.deleteResult.runnerStateDeleted === false
    && input.deleteResult.r2SkippedUserScopedPrefixes === false;
}

export function isCloudflareHostedUserDataPostDbDeleteProven(input: {
  afterDbDelete: CloudflareDeleteResult;
  beforeDbDelete: CloudflareDeleteResult | null;
}): boolean {
  return input.afterDbDelete.configured === true
    && input.afterDbDelete.alarmCleared === true
    && input.afterDbDelete.r2SkippedUserScopedPrefixes === false
    && (
      input.afterDbDelete.runnerStateDeleted === true
      || input.beforeDbDelete?.deleted === true
    );
}

function hostedUserRuntimeWorkflowId(userId: string): string {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Hosted runtime workflow userId is required.");
  }

  return `hosted-user-runtime:${normalizedUserId}`;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function printJson(step: string, memberFingerprint: string, extra: object): void {
  console.log(JSON.stringify({
    member: memberFingerprint,
    schema: RESET_SCRIPT_SCHEMA,
    step,
    ...extra,
  }));
}

function readResetExecutionTargetSummary(): ResetExecutionTargetSummary {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be configured before running hosted member reset.");
  }

  const temporal = readHostedRuntimeTemporalEnvironment(process.env, {
    defaultAddress: null,
  });

  return buildResetExecutionTargetSummary({
    cloudflareControlBaseUrlFingerprint: fingerprintOptionalValue(readHostedExecutionControlBaseUrl()),
    databaseUrlFingerprint: fingerprintIdentifier(databaseUrl),
    temporalAddressFingerprint: fingerprintOptionalValue(temporal.address),
    temporalNamespaceFingerprint: fingerprintOptionalValue(temporal.namespace),
  });
}

export function buildResetExecutionTargetSummary(input: {
  cloudflareControlBaseUrlFingerprint: string | null;
  databaseUrlFingerprint: string;
  temporalAddressFingerprint: string | null;
  temporalNamespaceFingerprint: string | null;
}): ResetExecutionTargetSummary {
  const executionTargetFingerprint = fingerprintIdentifier(JSON.stringify({
    cloudflareControlBaseUrlFingerprint: input.cloudflareControlBaseUrlFingerprint,
    databaseUrlFingerprint: input.databaseUrlFingerprint,
    temporalAddressFingerprint: input.temporalAddressFingerprint,
    temporalNamespaceFingerprint: input.temporalNamespaceFingerprint,
  }));

  return {
    ...input,
    executionTargetFingerprint,
  };
}

function fingerprintOptionalValue(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? fingerprintIdentifier(normalized) : null;
}

function fingerprintIdentifier(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({
      error: safeErrorMessage(error, readMemberIdArgForRedaction(process.argv.slice(2))),
      schema: RESET_SCRIPT_SCHEMA,
      step: "failed",
    }));
    process.exitCode = 1;
  });
}

export function safeErrorMessage(error: unknown, memberId?: string | null): string {
  let message = formatHostedExecutionSafeLogError(error)
    .replace(/hosted-user-runtime:[^\s"']+/gu, "hosted-user-runtime:<member-id>")
    .replace(/hbm_[A-Za-z0-9_-]+/gu, "<member-id>");

  const normalizedMemberId = memberId?.trim();
  if (normalizedMemberId) {
    message = message.replace(new RegExp(escapeRegExp(normalizedMemberId), "gu"), "<member-id>");
  }

  return message;
}

function readMemberIdArgForRedaction(args: readonly string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--member-id") {
      const next = args[index + 1];
      return next && !next.startsWith("--") ? next : null;
    }
    if (arg.startsWith("--member-id=")) {
      return arg.slice("--member-id=".length);
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
