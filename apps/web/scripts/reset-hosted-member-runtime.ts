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
  readHostedRuntimeTemporalEnvironment,
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
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../src/lib/hosted-onboarding/shared";
import { createPrismaClient } from "../src/lib/prisma";

type ResetMode = "dry-run" | "execute";

interface ResetOptions {
  confirmCloudflareCleaned: string | null;
  confirmMemberId: string | null;
  confirmTemporalTerminated: string | null;
  confirmUnsuspendAfterReset: string | null;
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
  hostedIngressLatencyTrace: number;
  hostedInvite: number;
  hostedLinqDailyState: number;
  hostedMailboxItem: number;
  hostedMailboxLaneCounter: number;
  hostedMailboxPayload: number;
  hostedRuntimeLog: number;
  hostedUserCryptoAuditControl: number;
  hostedUserCryptoAuditResetDomains: number;
  hostedUserCryptoEnvelopeControl: number;
  hostedUserCryptoEnvelopeResetDomains: number;
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

interface CloudflareDeleteResult {
  alarmCleared: boolean | null;
  configured: boolean;
  deleted: boolean;
  r2DeletedObjectCount: number | null;
  r2SkippedUserScopedPrefixes: boolean | null;
  runnerStateDeleted: boolean | null;
}

const RESET_DOMAINS = ["device", "ingress", "runtime"] as const;
const RESET_SCRIPT_SCHEMA = "murph.hosted-member-runtime-reset-script.v1";
const TEMPORAL_TERMINATION_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const options = parseResetOptions(process.argv.slice(2));
  const mode: ResetMode = options.execute ? "execute" : "dry-run";
  const memberFingerprint = fingerprintIdentifier(options.memberId);
  const prisma = createPrismaFromEnvironment();

  try {
    console.log(JSON.stringify({
      member: memberFingerprint,
      mode,
      schema: RESET_SCRIPT_SCHEMA,
      step: "start",
    }));

    const preflight = await readResetPreflight({
      memberId: options.memberId,
      prisma,
    });

    printJson("preflight", memberFingerprint, {
      counts: preflight.counts,
      deviceConnectionProviders: preflight.deviceConnectionProviders,
      deviceResetBehavior: "device sync rows are deleted; users must reconnect wearables/devices after reset",
      member: {
        billingStatus: preflight.member.billingStatus,
        hasBillingRef: preflight.hasBillingRef,
        hasIdentity: preflight.hasIdentity,
        suspended: Boolean(preflight.member.suspendedAt),
      },
    });

    assertPreflightAllowsReset(preflight, options);
    await assertExternalExecutePreflight(options);

    if (!options.execute) {
      printJson("dry-run-complete", memberFingerprint, {
        note: "No rows were mutated. Re-run with --execute and --confirm-member-id to reset this member.",
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

    if (!options.skipCloudflareDelete) {
      printJson("cloudflare-delete-before-db-start", memberFingerprint, {});
      const cloudflare = await deleteCloudflareHostedUserData(options.memberId);
      if (!cloudflare.deleted) {
        throw new Error("Cloudflare user-data deletion before DB reset did not prove deletion.");
      }
      printJson("cloudflare-delete-before-db-complete", memberFingerprint, cloudflare);
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
      if (!cloudflare.deleted) {
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
    confirmMemberId: null,
    confirmTemporalTerminated: null,
    confirmUnsuspendAfterReset: null,
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
      case "--confirm-member-id":
        options.confirmMemberId = requireNextArg(args, index, arg);
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
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.memberId = options.memberId.trim();
  options.confirmCloudflareCleaned = options.confirmCloudflareCleaned?.trim() || null;
  options.confirmMemberId = options.confirmMemberId?.trim() || null;
  options.confirmTemporalTerminated = options.confirmTemporalTerminated?.trim() || null;
  options.confirmUnsuspendAfterReset = options.confirmUnsuspendAfterReset?.trim() || null;

  if (!options.memberId) {
    throw new Error("Missing required --member-id.");
  }

  if (options.execute && options.confirmMemberId !== options.memberId) {
    throw new Error("--execute requires --confirm-member-id with the exact same member id.");
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

function printUsageAndExit(code: number): never {
  console.log([
    "Usage:",
    "  pnpm --dir apps/web admin:reset-member -- --member-id <id> --dry-run",
    "  pnpm --dir apps/web admin:reset-member -- --member-id <id> --execute --confirm-member-id <id>",
    "",
    "Optional execute flags:",
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
    member,
  };
}

function assertPreflightAllowsReset(
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

  if (preflight.counts.hostedUserCryptoEnvelopeControl < 1) {
    throw new Error("Hosted member does not have a decryptable control crypto root to preserve.");
  }

  if (preflight.counts.hostedAiUsageNonSkipped > 0) {
    throw new Error("Hosted member has AI usage rows that are not stripe_meter_status=skipped.");
  }

  if (options.execute && !options.skipTemporalTerminate && !isTemporalConfigured()) {
    throw new Error("Temporal is not configured. Pass --skip-temporal-terminate only after manual termination.");
  }

  if (options.execute && !options.skipCloudflareDelete && !isCloudflareControlConfigured()) {
    throw new Error("Cloudflare control is not configured. Pass --skip-cloudflare-delete only after manual cleanup.");
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
    hostedLinqDailyState,
    hostedInvite,
    hostedWorkspace,
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
    input.prisma.hostedLinqDailyState.count({ where: { memberId: input.memberId } }),
    input.prisma.hostedInvite.count({ where: { memberId: input.memberId } }),
    input.prisma.hostedWorkspace.count({ where: { userId: input.memberId } }),
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
    hostedIngressLatencyTrace,
    hostedInvite,
    hostedLinqDailyState,
    hostedMailboxItem,
    hostedMailboxLaneCounter,
    hostedMailboxPayload,
    hostedRuntimeLog,
    hostedUserCryptoAuditControl,
    hostedUserCryptoAuditResetDomains,
    hostedUserCryptoEnvelopeControl,
    hostedUserCryptoEnvelopeResetDomains,
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
  freshWorkspaceVersion: string;
  postCounts: CountSnapshot;
}> {
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberForResetTx({
      memberId: input.memberId,
      tx,
    });

    const preCounts = await countResetRows({
      memberId: input.memberId,
      prisma: tx,
    });
    if (preCounts.hostedAiUsageNonSkipped > 0) {
      throw new Error("AI usage status changed after preflight.");
    }

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

    const postCounts = await countResetRows({
      memberId: input.memberId,
      prisma: tx,
    });

    assertPostResetCounts(postCounts);

    return {
      deletedCounts,
      freshWorkspaceVersion: freshWorkspaceVersion.toString(),
      postCounts,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
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
  expectZero("hostedMailboxItem");
  expectZero("hostedMailboxLaneCounter");
  expectZero("hostedMailboxPayload");
  expectZero("hostedRuntimeLog");
  expectZero("hostedWebSession");

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
    hostedWebSession: 0,
    hostedWorkspace: 0,
  };

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
  counts.hostedWebSession = (await input.tx.hostedWebSession.deleteMany({ where: { memberId: input.memberId } })).count;
  counts.deviceTokenAudit = (await input.tx.deviceTokenAudit.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceSyncDirtyPayload = (await input.tx.deviceSyncDirtyPayload.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceSyncDirtyConnection = (await input.tx.deviceSyncDirtyConnection.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceSyncSignal = (await input.tx.deviceSyncSignal.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceOauthSession = (await input.tx.deviceOauthSession.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceConnectIntent = (await input.tx.deviceConnectIntent.deleteMany({ where: { memberId: input.memberId } })).count;
  counts.deviceAgentSession = (await input.tx.deviceAgentSession.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceBrowserAssertionNonce = (await input.tx.deviceBrowserAssertionNonce.deleteMany({ where: { userId: input.memberId } })).count;
  counts.deviceConnection = (await input.tx.deviceConnection.deleteMany({ where: { userId: input.memberId } })).count;

  return counts;
}

async function lockHostedMemberForResetTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const rows = await input.tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_member
    WHERE id = ${input.memberId}
      AND suspended_at IS NOT NULL
    FOR UPDATE
  `;

  if (rows.length !== 1) {
    throw new Error("Hosted member reset requires the member to be suspended and locked.");
  }
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
  const deleted = result.durableObject.alarmCleared
    && result.r2.supported
    && !result.r2.skippedUserScopedPrefixes;

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

function fingerprintIdentifier(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({
      error: safeErrorMessage(error),
      schema: RESET_SCRIPT_SCHEMA,
      step: "failed",
    }));
    process.exitCode = 1;
  });
}

export function safeErrorMessage(error: unknown): string {
  return formatHostedExecutionSafeLogError(error)
    .replace(/hosted-user-runtime:[^\s"']+/gu, "hosted-user-runtime:<member-id>")
    .replace(/hbm_[A-Za-z0-9_-]+/gu, "<member-id>");
}
