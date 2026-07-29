import "server-only";

import type {
  HostedUsageReferralPolicyCode,
  HostedUsageReferralStatus,
  PrismaClient,
} from "@prisma/client";

import {
  buildHostedUsageReferralOutstandingWhere,
  getHostedUsageReferralPolicyDisplay,
  isHostedUsageReferralEnabled,
} from "../hosted-growth/usage-referral";
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

interface HostedUsageReferralActivityRecord {
  armedAt: Date;
  beneficiaryMemberId: string;
  expiresAt: Date;
  id: string;
  policyCode: HostedUsageReferralPolicyCode;
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
  };
}

function projectHostedUsageMissionActivity(input: {
  memberId: string;
  row: HostedUsageReferralActivityRecord;
}): HostedAiUsageMissionActivityRow {
  const policy = getHostedUsageReferralPolicyDisplay(input.row.policyCode);
  const status = projectHostedUsageMissionStatus(input.row);

  return {
    destinationLabel: input.row.beneficiaryMemberId === input.memberId
      ? "your Murph"
      : "the group",
    id: input.row.id,
    requirementsLabel: policy.requirementsLabel,
    rewardLabel: formatUsdMicros(input.row.rewardUsdMicros),
    selectedLabel: formatDate(input.row.armedAt),
    status,
    statusLabel: projectHostedUsageMissionStatusLabel(status),
    timingLabel: projectHostedUsageMissionTimingLabel(input.row),
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
): HostedAiUsageMissionActivityStatus {
  if (row.status === "rewarded") {
    return "completed";
  }
  if (row.status === "armed") {
    return "waiting_for_group";
  }
  if (row.status === "target_bound") {
    return row.qualifiedAt ? "reward_pending" : "in_progress";
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
  return "Waiting for a new group";
}

function projectHostedUsageMissionTimingLabel(
  row: HostedUsageReferralActivityRecord,
): string {
  if (row.status === "rewarded") {
    return row.rewardedAt
      ? `Earned ${formatDate(row.rewardedAt)}`
      : "Reward earned";
  }
  if (row.qualifiedAt) {
    return `Qualified ${formatDate(row.qualifiedAt)}`;
  }
  return row.status === "armed"
    ? `Start a new group by ${formatDate(row.expiresAt)}`
    : `Ends ${formatDate(row.expiresAt)}`;
}

function formatUsdMicros(value: bigint): string {
  const cents = (value + 5_000n) / 10_000n;
  return USD_FORMATTER.format(Number(cents) / 100);
}

function formatDate(value: Date): string {
  return DATE_FORMATTER.format(value);
}
