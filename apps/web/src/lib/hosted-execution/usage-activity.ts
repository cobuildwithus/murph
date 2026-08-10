import "server-only";

import type {
  HostedUsageReferralPolicyCode,
  HostedUsageReferralStatus,
  PrismaClient,
} from "@prisma/client";

import {
  HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY,
  isHostedSignupReferralPolicyVersion,
} from "../hosted-growth/signup-referral-policy";
import {
  formatHostedReferralRewardUsageDays,
} from "../hosted-growth/referral-reward-days";
import {
  buildHostedUsageReferralOutstandingWhere,
  getHostedUsageReferralPolicyDisplay,
} from "../hosted-growth/usage-referral";
import {
  isHostedUsageReferralEnabled,
} from "../hosted-growth/usage-referral-policy";
import { getPrisma } from "../prisma";
import type {
  HostedAiUsageActivitySnapshot,
  HostedAiUsageMissionActivityRow,
  HostedAiUsageMissionActivityStatus,
} from "./usage-activity-types";

const MAX_USAGE_CREDIT_ROWS = 50;
const MAX_USAGE_MISSION_ROWS = 50;

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});
const MONTH_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

interface HostedUsageReferralActivityRecord {
  armedAt: Date;
  beneficiaryMemberId: string;
  expiresAt: Date;
  id: string;
  policyCode: HostedUsageReferralPolicyCode;
  policyVersion: string;
  qualifiedAt: Date | null;
  rewardedAt: Date | null;
  rewardUsdMicros: bigint;
  status: HostedUsageReferralStatus;
}

export async function readHostedAiUsageActivity(input: {
  memberId: string;
  missionsEnabled?: boolean;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedAiUsageActivitySnapshot> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();

  // Settings intentionally keeps database-backed reads sequential. This helper
  // owns two bounded projections and does not fan out pool checkouts.
  const creditEntries = await prisma.hostedUsageCreditEntry.findMany({
    orderBy: [
      { beneficiarySequence: "desc" },
      { id: "desc" },
    ],
    select: {
      amountUsdMicros: true,
      effectiveAt: true,
      id: true,
      purchase: {
        select: {
          payerMemberId: true,
        },
      },
    },
    take: MAX_USAGE_CREDIT_ROWS,
    where: {
      beneficiaryMemberId: input.memberId,
      kind: "purchase_grant",
    },
  });

  const outstandingReferralRows = await prisma.hostedUsageReferral.findMany({
    orderBy: [
      { armedAt: "desc" },
      { id: "desc" },
    ],
    select: {
      armedAt: true,
      beneficiaryMemberId: true,
      expiresAt: true,
      id: true,
      policyCode: true,
      policyVersion: true,
      qualifiedAt: true,
      rewardedAt: true,
      rewardUsdMicros: true,
      status: true,
    },
    take: MAX_USAGE_MISSION_ROWS,
    where: {
      OR: buildHostedUsageReferralOutstandingWhere(now),
      referrerMemberId: input.memberId,
    },
  });
  const remainingMissionRows =
    MAX_USAGE_MISSION_ROWS - outstandingReferralRows.length;
  const rewardedReferralRows = remainingMissionRows > 0
    ? await prisma.hostedUsageReferral.findMany({
        orderBy: [
          { armedAt: "desc" },
          { id: "desc" },
        ],
        select: {
          armedAt: true,
          beneficiaryMemberId: true,
          expiresAt: true,
          id: true,
          policyCode: true,
          policyVersion: true,
          qualifiedAt: true,
          rewardedAt: true,
          rewardUsdMicros: true,
          status: true,
        },
        take: remainingMissionRows,
        where: {
          referrerMemberId: input.memberId,
          status: "rewarded",
        },
      })
    : [];

  const missions = [...outstandingReferralRows, ...rewardedReferralRows]
    .sort(compareHostedUsageReferralActivity)
    .map((row) => projectHostedUsageMissionActivity({
      memberId: input.memberId,
      now,
      row,
    }));

  return {
    credits: creditEntries.map((entry) => ({
      addedLabel: formatUsdMicros(entry.amountUsdMicros),
      dateLabel: formatDate(entry.effectiveAt),
      id: entry.id,
      sourceLabel: entry.purchase?.payerMemberId === input.memberId
        ? "Purchased by you"
        : "Added for you",
    })),
    missions,
    missionsEnabled:
      input.missionsEnabled ?? isHostedUsageReferralEnabled(),
    referralIdentityKey: input.memberId,
  };
}

function projectHostedUsageMissionActivity(input: {
  memberId: string;
  now: Date;
  row: HostedUsageReferralActivityRecord;
}): HostedAiUsageMissionActivityRow {
  const policy = isHostedSignupReferralPolicyVersion(input.row.policyVersion)
    ? HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY
    : getHostedUsageReferralPolicyDisplay(input.row.policyCode);
  const status = projectHostedUsageMissionStatus(input.row, input.now);
  return {
    destinationLabel: input.row.beneficiaryMemberId === input.memberId
      ? "your Murph"
      : "the group",
    id: input.row.id,
    requirementsLabel: policy.requirementsLabel,
    rewardLabel: formatHostedReferralRewardUsageDays({
      policyCode: input.row.policyCode,
      policyVersion: input.row.policyVersion,
      rewardUsdMicros: input.row.rewardUsdMicros,
      sentenceCase: true,
    }),
    selectedLabel: formatDate(input.row.armedAt),
    status,
    statusLabel: projectHostedUsageMissionStatusLabel(status),
    timingLabel: projectHostedUsageMissionTimingLabel(
      input.row,
      status,
      input.now,
    ),
    title: policy.title,
  };
}

function compareHostedUsageReferralActivity(
  left: HostedUsageReferralActivityRecord,
  right: HostedUsageReferralActivityRecord,
): number {
  const statusDifference = hostedUsageMissionStatusRank(left)
    - hostedUsageMissionStatusRank(right);
  if (statusDifference !== 0) {
    return statusDifference;
  }
  return right.armedAt.getTime() - left.armedAt.getTime();
}

function hostedUsageMissionStatusRank(
  row: HostedUsageReferralActivityRecord,
): number {
  if (row.status === "target_bound" && row.qualifiedAt) {
    return 0;
  }
  if (row.status === "target_bound") {
    return 1;
  }
  if (row.status === "armed") {
    return 2;
  }
  if (row.status === "rewarded") {
    return 3;
  }
  return 4;
}

function projectHostedUsageMissionStatus(
  row: HostedUsageReferralActivityRecord,
  now: Date,
): HostedAiUsageMissionActivityStatus {
  if (row.status === "rewarded") {
    return "completed";
  }
  if (row.status === "armed") {
    return "waiting_for_group";
  }
  if (row.status === "target_bound") {
    if (row.qualifiedAt) {
      return "reward_pending";
    }
    return now.getTime() >= row.expiresAt.getTime()
      ? "checking_final_activity"
      : "in_progress";
  }
  throw new TypeError(`Unsupported usage mission status: ${row.status}`);
}

function projectHostedUsageMissionStatusLabel(
  status: HostedAiUsageMissionActivityStatus,
): string {
  if (status === "completed") {
    return "Completed";
  }
  if (status === "reward_pending") {
    return "Reward pending";
  }
  if (status === "in_progress") {
    return "In progress";
  }
  if (status === "checking_final_activity") {
    return "Checking final activity";
  }
  return "Waiting for a new group";
}

function projectHostedUsageMissionTimingLabel(
  row: HostedUsageReferralActivityRecord,
  status: HostedAiUsageMissionActivityStatus,
  now: Date,
): string {
  if (row.status === "rewarded") {
    return row.rewardedAt
      ? `Earned ${formatMissionDate(row.rewardedAt, now)}`
      : "Reward earned";
  }
  if (row.qualifiedAt) {
    return `Qualified ${formatMissionDate(row.qualifiedAt, now)}`;
  }
  if (status === "checking_final_activity") {
    return `Closed ${formatMissionDateTime(row.expiresAt, now)}`;
  }
  return row.status === "armed"
    ? `Start by ${formatMissionDateTime(row.expiresAt, now)}`
    : `Ends ${formatMissionDateTime(row.expiresAt, now)}`;
}

function formatUsdMicros(value: bigint): string {
  const cents = (value + 5_000n) / 10_000n;
  return USD_FORMATTER.format(Number(cents) / 100);
}

function formatDate(value: Date): string {
  return DATE_FORMATTER.format(value);
}

function formatMissionDate(value: Date, now: Date): string {
  return value.getUTCFullYear() === now.getUTCFullYear()
    ? MONTH_DAY_FORMATTER.format(value)
    : formatDate(value);
}

function formatMissionDateTime(value: Date, now: Date): string {
  return `${formatMissionDate(value, now)} at ${TIME_FORMATTER.format(value)}`;
}
