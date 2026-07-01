import { createHash } from "node:crypto";

import {
  listHostedFamilyBillingPeriodRepairCandidates,
  repairHostedFamilyBillingPeriodForGroup,
  type HostedFamilyBillingPeriodRepairReason,
} from "../src/lib/hosted-onboarding/family-plan";
import { requireHostedStripeApi } from "../src/lib/hosted-onboarding/runtime";
import { describeErrorForLog } from "../src/lib/http";
import { getPrisma } from "../src/lib/prisma";

const REPAIR_OPERATION = "hosted-family-billing-period-repair";

const USAGE = `Usage:
  pnpm --dir apps/web hosted:repair-family-billing-periods -- [--dry-run] [--limit 100]
  pnpm --dir apps/web hosted:repair-family-billing-periods -- --group-id <group-id>

Options:
  --dry-run        Count repair candidates without contacting Stripe or writing rows.
  --group-id <id>  Repair one hosted account group billing ref.
  --limit <n>      Maximum candidate rows to repair when --group-id is omitted. Default 100.
`;

interface RepairCliArgs {
  dryRun: boolean;
  groupId: string | null;
  help: boolean;
  limit: number | undefined;
}

async function main(): Promise<void> {
  const args = parseHostedFamilyBillingPeriodRepairArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE.trim());
    return;
  }

  const prisma = getPrisma();
  const now = new Date();
  const candidates = args.groupId
    ? [{ groupId: args.groupId }]
    : await listHostedFamilyBillingPeriodRepairCandidates({
        limit: args.limit,
        now,
        prisma,
      });

  if (args.dryRun) {
    console.log(JSON.stringify({
      candidateCount: candidates.length,
      dryRun: true,
    }, null, 2));
    return;
  }

  const stripe = requireHostedStripeApi();
  const summary: {
    candidateCount: number;
    failed: number;
    repaired: number;
    reasons: Record<HostedFamilyBillingPeriodRepairReason | "exception", number>;
    skipped: number;
  } = {
    candidateCount: candidates.length,
    failed: 0,
    repaired: 0,
    reasons: createHostedFamilyBillingPeriodRepairReasonCounts(),
    skipped: 0,
  };

  for (const candidate of candidates) {
    try {
      const result = await repairHostedFamilyBillingPeriodForGroup({
        groupId: candidate.groupId,
        now,
        prisma,
        stripe,
      });
      summary.reasons[result.reason] += 1;
      if (result.repaired) {
        summary.repaired += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      summary.failed += 1;
      summary.reasons.exception += 1;
      console.error(
        "Failed to repair a hosted Family billing period.",
        describeHostedFamilyBillingPeriodRepairError({
          error,
          groupId: candidate.groupId,
          operation: REPAIR_OPERATION,
        }),
      );
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

function parseHostedFamilyBillingPeriodRepairArgs(argv: readonly string[]): RepairCliArgs {
  const args: RepairCliArgs = {
    dryRun: false,
    groupId: null,
    help: false,
    limit: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--group-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new TypeError("--group-id requires a value.");
      }
      args.groupId = value;
      index += 1;
      continue;
    }
    if (token === "--limit") {
      const value = argv[index + 1];
      if (!value) {
        throw new TypeError("--limit requires a value.");
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new TypeError("--limit must be a positive integer.");
      }
      args.limit = parsed;
      index += 1;
      continue;
    }

    throw new TypeError(`Unknown option: ${token}`);
  }

  return args;
}

function createHostedFamilyBillingPeriodRepairReasonCounts(): Record<
  HostedFamilyBillingPeriodRepairReason | "exception",
  number
> {
  return {
    billing_period_current: 0,
    billing_ref_not_found: 0,
    billing_ref_not_repairable: 0,
    exception: 0,
    reconciled_current_period: 0,
    reconciled_without_current_period: 0,
    stripe_subscription_missing: 0,
    stripe_subscription_not_family: 0,
  };
}

function describeHostedFamilyBillingPeriodRepairError(input: {
  error: unknown;
  groupId?: string;
  operation: string;
}): Record<string, unknown> {
  const retryable = readHostedFamilyBillingPeriodRepairRetryable(input.error);

  return {
    ...(describeErrorForLog(input.error) ?? {
      errorType: input.error === null ? "null" : typeof input.error,
    }),
    ...(input.groupId
      ? { groupIdHash: hashHostedFamilyBillingPeriodRepairGroupId(input.groupId) }
      : {}),
    operation: input.operation,
    ...(retryable === null ? {} : { retryable }),
  };
}

function readHostedFamilyBillingPeriodRepairRetryable(error: unknown): boolean | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const retryable = Reflect.get(error, "retryable");
  return typeof retryable === "boolean" ? retryable : null;
}

function hashHostedFamilyBillingPeriodRepairGroupId(groupId: string): string {
  return createHash("sha256").update(groupId).digest("hex").slice(0, 16);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    console.error(
      "Hosted Family billing period repair command failed.",
      describeHostedFamilyBillingPeriodRepairError({
        error,
        operation: `${REPAIR_OPERATION}-cli`,
      }),
    );
    process.exitCode = 1;
  });
}
