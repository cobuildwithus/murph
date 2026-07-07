import "server-only";

import { HostedBillingStatus, type Prisma, type PrismaClient } from "@prisma/client";

import {
  HOSTED_FAMILY_SEAT_RECURRING_AMOUNT_USD_CENTS,
  HOSTED_PULSE_TRIAL_DAYS,
  getHostedBillingPlanDefinition,
  isHostedPulseTrialBillingState,
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { getPrisma } from "@/src/lib/prisma";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAILY_SERIES_DAYS = 30;
const WEEKLY_ROWS = 8;
const SNAPSHOT_COMPARE_TARGET_DAYS = 7;
const SNAPSHOT_COMPARE_MIN_DAYS = 6;
const SNAPSHOT_COMPARE_MAX_DAYS = 8;
const TRIAL_ENDING_SOON_DAYS = 3;

const CHURN_STATUS_KEYS = [
  HostedBillingStatus.past_due,
  HostedBillingStatus.canceled,
  HostedBillingStatus.paused,
  HostedBillingStatus.unpaid,
] as const;

const paidHostedFamilyGroupWhere = {
  billingRef: {
    is: {
      billedSeatCount: {
        gte: 1,
      },
      currentBillingPhase: "paid",
    },
  },
  billingStatus: HostedBillingStatus.active,
  suspendedAt: null,
} satisfies Prisma.HostedAccountGroupWhereInput;

function activePaidFamilyMembershipWhere(): Prisma.HostedAccountGroupMembershipWhereInput {
  return {
    group: paidHostedFamilyGroupWhere,
    status: "active",
  };
}

type HostedGrowthPrisma = Pick<
  PrismaClient,
  | "hostedAccountGroup"
  | "hostedGrowthDailySnapshot"
  | "hostedMember"
  | "hostedMemberBillingRef"
>;

export type HostedGrowthStatusKey = (typeof CHURN_STATUS_KEYS)[number];

export interface HostedGrowthPayingIndividualRow {
  id: string;
  billingRef: {
    currentBillingPhase: string | null;
    currentBillingPlanCode: string | null;
  } | null;
}

export interface HostedGrowthPayingFamilyGroupRow {
  id: string;
  billingRef: {
    billedSeatCount: number | null;
    currentBillingPhase: string | null;
  } | null;
  memberships: {
    memberId: string;
  }[];
}

export interface HostedGrowthTrialCandidateRow {
  billingStatus: HostedBillingStatus;
  billingRef: {
    currentBillingPhase: string | null;
    currentCheckoutOffer: string | null;
    currentTrialEndsAt: Date | null;
  } | null;
  suspendedAt: Date | null;
}

export interface HostedGrowthDateRow {
  createdAt: Date;
}

export interface HostedGrowthTrialStartRow {
  currentBillingPhase: string | null;
  member: {
    suspendedAt: Date | null;
  };
  paidViaFamily: boolean;
  pulseTrialRedeemedAt: Date | null;
}

export interface HostedGrowthSnapshotRow {
  capturedAt: Date;
  coveredMembers: number;
  mrrUsdCents: number;
  payingCustomers: number;
  payingFamilyGroups: number;
  payingFamilySeats: number;
  payingIndividuals: number;
  snapshotDate: Date;
  totalMembers: number;
  trialingMembers: number;
}

export interface HostedGrowthStatusCounts {
  canceled: number;
  past_due: number;
  paused: number;
  unpaid: number;
}

export interface HostedGrowthCurrentMetrics {
  coveredMembers: number;
  edgePaidIndividuals: number;
  edgeMrrUsdCents: number;
  familyMrrUsdCents: number;
  mrrUsdCents: number;
  payingCustomers: number;
  payingFamilyGroups: number;
  payingFamilySeats: number;
  payingIndividuals: number;
  pulsePaidIndividuals: number;
  pulseMrrUsdCents: number;
  statusCounts: HostedGrowthStatusCounts;
  totalMembers: number;
  trialingMembers: number;
  trialsEndingSoon: number;
  unpricedPaidMembers: number;
}

export interface HostedGrowthDailyPoint {
  date: string;
  newMembers: number;
  trialStarts: number;
}

export interface HostedGrowthSnapshotPoint {
  coveredMembers: number;
  date: string;
  mrrUsdCents: number;
  payingCustomers: number;
  trialingMembers: number;
}

export interface HostedGrowthWeeklyRow {
  endDate: string;
  newMembers: number;
  newMembersWowPercent: number | null;
  startDate: string;
  trialStarts: number;
  trialStartsWowPercent: number | null;
}

export interface HostedGrowthTrialCohortRow {
  conversionPercent: number | null;
  converted: number;
  endDate: string;
  startDate: string;
  started: number;
  stillTrialing: number;
}

export interface HostedGrowthDashboard {
  capturedAt: string;
  conversion: {
    converted: number;
    matureStarted: number;
    percent: number | null;
  };
  current: HostedGrowthCurrentMetrics;
  dailySeries: HostedGrowthDailyPoint[];
  mrrWowPercent: number | null;
  newMembers: {
    today: number;
    trailing7Days: number;
    wowPercent: number | null;
  };
  payingCustomersWowPercent: number | null;
  snapshotSeries: HostedGrowthSnapshotPoint[];
  trialCohorts: HostedGrowthTrialCohortRow[];
  trialStarts: {
    trailing7Days: number;
    wowPercent: number | null;
  };
  weeklyRows: HostedGrowthWeeklyRow[];
}

interface HostedGrowthCurrentMetricInput {
  payingFamilyGroups: HostedGrowthPayingFamilyGroupRow[];
  payingIndividuals: HostedGrowthPayingIndividualRow[];
  statusCounts: HostedGrowthStatusCounts;
  totalMembers: number;
  trialCandidates: HostedGrowthTrialCandidateRow[];
  windowEnd: Date;
}

export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}

export function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * MS_PER_DAY);
}

export function formatUtcDateKey(value: Date): string {
  return startOfUtcDay(value).toISOString().slice(0, 10);
}

export function calculatePercentChange(current: number, previous: number): number | null {
  if (previous === 0) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}

export function calculateHostedGrowthCurrentMetrics(
  input: HostedGrowthCurrentMetricInput,
): HostedGrowthCurrentMetrics {
  const paidMemberIds = new Set<string>();
  const coveredMemberIds = new Set<string>();
  let edgePaidIndividuals = 0;
  let pulseMrrUsdCents = 0;
  let edgeMrrUsdCents = 0;
  let pulsePaidIndividuals = 0;
  let unpricedPaidMembers = 0;

  for (const member of input.payingIndividuals) {
    if (member.billingRef?.currentBillingPhase !== "paid") {
      continue;
    }

    paidMemberIds.add(member.id);
    coveredMemberIds.add(member.id);

    const planCode = parseHostedBillingPlanCode(member.billingRef.currentBillingPlanCode);
    if (planCode === null) {
      unpricedPaidMembers += 1;
      continue;
    }

    const amountUsdCents = getHostedBillingPlanDefinition(planCode).recurringAmountUsdCents;
    if (planCode === "launch_edge_monthly") {
      edgePaidIndividuals += 1;
      edgeMrrUsdCents += amountUsdCents;
    } else {
      pulsePaidIndividuals += 1;
      pulseMrrUsdCents += amountUsdCents;
    }
  }

  let payingFamilyGroups = 0;
  let payingFamilySeats = 0;
  for (const group of input.payingFamilyGroups) {
    const billedSeatCount = group.billingRef?.billedSeatCount ?? 0;
    if (group.billingRef?.currentBillingPhase !== "paid" || billedSeatCount < 1) {
      continue;
    }

    payingFamilyGroups += 1;
    payingFamilySeats += billedSeatCount;
    for (const membership of group.memberships) {
      coveredMemberIds.add(membership.memberId);
    }
  }

  const trialMetrics = calculateHostedTrialMetrics({
    rows: input.trialCandidates,
    windowEnd: input.windowEnd,
  });
  const familyMrrUsdCents =
    payingFamilySeats * HOSTED_FAMILY_SEAT_RECURRING_AMOUNT_USD_CENTS;
  const payingIndividuals = paidMemberIds.size;

  return {
    coveredMembers: Math.min(input.totalMembers, coveredMemberIds.size),
    edgePaidIndividuals,
    edgeMrrUsdCents,
    familyMrrUsdCents,
    mrrUsdCents: pulseMrrUsdCents + edgeMrrUsdCents + familyMrrUsdCents,
    payingCustomers: payingIndividuals + payingFamilyGroups,
    payingFamilyGroups,
    payingFamilySeats,
    payingIndividuals,
    pulsePaidIndividuals,
    pulseMrrUsdCents,
    statusCounts: input.statusCounts,
    totalMembers: input.totalMembers,
    trialingMembers: trialMetrics.trialingMembers,
    trialsEndingSoon: trialMetrics.trialsEndingSoon,
    unpricedPaidMembers,
  };
}

export function calculateHostedTrialMetrics(input: {
  rows: HostedGrowthTrialCandidateRow[];
  windowEnd: Date;
}): {
  trialingMembers: number;
  trialsEndingSoon: number;
} {
  const endingSoonCutoff = addUtcDays(input.windowEnd, TRIAL_ENDING_SOON_DAYS);
  let trialingMembers = 0;
  let trialsEndingSoon = 0;

  for (const row of input.rows) {
    if (row.suspendedAt !== null || row.billingRef === null) {
      continue;
    }

    if (
      row.billingStatus !== HostedBillingStatus.active &&
      row.billingStatus !== HostedBillingStatus.paused
    ) {
      continue;
    }

    if (!isHostedPulseTrialBillingState(row.billingRef)) {
      continue;
    }

    if (
      row.billingRef.currentTrialEndsAt !== null &&
      row.billingRef.currentTrialEndsAt <= input.windowEnd
    ) {
      continue;
    }

    trialingMembers += 1;
    if (
      row.billingRef.currentTrialEndsAt !== null &&
      row.billingRef.currentTrialEndsAt > input.windowEnd &&
      row.billingRef.currentTrialEndsAt <= endingSoonCutoff
    ) {
      trialsEndingSoon += 1;
    }
  }

  return {
    trialingMembers,
    trialsEndingSoon,
  };
}

export function buildDailyGrowthSeries(input: {
  dayCount: number;
  memberRows: HostedGrowthDateRow[];
  trialStartRows: HostedGrowthTrialStartRow[];
  windowEnd: Date;
}): HostedGrowthDailyPoint[] {
  const todayStart = startOfUtcDay(input.windowEnd);
  const firstDay = addUtcDays(todayStart, -(input.dayCount - 1));
  const counts = new Map<string, HostedGrowthDailyPoint>();

  for (let dayIndex = 0; dayIndex < input.dayCount; dayIndex += 1) {
    const date = addUtcDays(firstDay, dayIndex);
    const key = formatUtcDateKey(date);
    counts.set(key, {
      date: key,
      newMembers: 0,
      trialStarts: 0,
    });
  }

  for (const row of input.memberRows) {
    const key = keyIfInWindow(row.createdAt, firstDay, addUtcDays(todayStart, 1));
    const point = key === null ? null : counts.get(key);
    if (point !== null && point !== undefined) {
      point.newMembers += 1;
    }
  }

  for (const row of input.trialStartRows) {
    if (row.pulseTrialRedeemedAt === null) {
      continue;
    }

    const key = keyIfInWindow(
      row.pulseTrialRedeemedAt,
      firstDay,
      addUtcDays(todayStart, 1),
    );
    const point = key === null ? null : counts.get(key);
    if (point !== null && point !== undefined) {
      point.trialStarts += 1;
    }
  }

  return Array.from(counts.values());
}

export function buildWeeklyGrowthRows(input: {
  memberRows: HostedGrowthDateRow[];
  trialStartRows: HostedGrowthTrialStartRow[];
  weekCount: number;
  windowEnd: Date;
}): HostedGrowthWeeklyRow[] {
  const exclusiveCurrentEnd = addUtcDays(startOfUtcDay(input.windowEnd), 1);
  const rows: HostedGrowthWeeklyRow[] = [];

  for (let weekIndex = 0; weekIndex < input.weekCount; weekIndex += 1) {
    const end = addUtcDays(exclusiveCurrentEnd, -weekIndex * 7);
    const start = addUtcDays(end, -7);
    const previousStart = addUtcDays(start, -7);

    const newMembers = countCreatedRowsInRange(input.memberRows, start, end);
    const previousNewMembers = countCreatedRowsInRange(
      input.memberRows,
      previousStart,
      start,
    );
    const trialStarts = countTrialStartsInRange(input.trialStartRows, start, end);
    const previousTrialStarts = countTrialStartsInRange(
      input.trialStartRows,
      previousStart,
      start,
    );

    rows.push({
      endDate: formatUtcDateKey(addUtcDays(end, -1)),
      newMembers,
      newMembersWowPercent: calculatePercentChange(newMembers, previousNewMembers),
      startDate: formatUtcDateKey(start),
      trialStarts,
      trialStartsWowPercent: calculatePercentChange(trialStarts, previousTrialStarts),
    });
  }

  return rows;
}

export function buildTrialCohortRows(input: {
  rowCount: number;
  trialStartRows: HostedGrowthTrialStartRow[];
  windowEnd: Date;
}): HostedGrowthTrialCohortRow[] {
  const exclusiveCurrentEnd = addUtcDays(startOfUtcDay(input.windowEnd), 1);
  const maturityCutoff = getTrialMaturityCutoff(input.windowEnd);
  const rows: HostedGrowthTrialCohortRow[] = [];

  for (let weekIndex = 0; weekIndex < input.rowCount; weekIndex += 1) {
    const end = addUtcDays(exclusiveCurrentEnd, -weekIndex * 7);
    const start = addUtcDays(end, -7);
    const cohortRows = input.trialStartRows.filter((row) =>
      row.pulseTrialRedeemedAt !== null &&
      row.pulseTrialRedeemedAt >= start &&
      row.pulseTrialRedeemedAt < end
    );
    const converted = cohortRows.filter((row) =>
      row.member.suspendedAt === null &&
      (row.currentBillingPhase === "paid" || row.paidViaFamily)
    ).length;
    const stillTrialing = cohortRows.filter((row) =>
      row.currentBillingPhase !== "paid" &&
      row.pulseTrialRedeemedAt !== null &&
      row.pulseTrialRedeemedAt >= maturityCutoff
    ).length;
    const matureStarted = cohortRows.length - stillTrialing;

    rows.push({
      conversionPercent: matureStarted > 0
        ? (converted / matureStarted) * 100
        : null,
      converted,
      endDate: formatUtcDateKey(addUtcDays(end, -1)),
      startDate: formatUtcDateKey(start),
      started: cohortRows.length,
      stillTrialing,
    });
  }

  return rows;
}

export function calculateTrialConversionSummary(input: {
  matureStarted: number;
  matureConverted: number;
}): HostedGrowthDashboard["conversion"] {
  return {
    converted: input.matureConverted,
    matureStarted: input.matureStarted,
    percent: input.matureStarted > 0
      ? (input.matureConverted / input.matureStarted) * 100
      : null,
  };
}

export function findComparableSnapshot(
  snapshots: HostedGrowthSnapshotRow[],
  now: Date,
): HostedGrowthSnapshotRow | null {
  const today = startOfUtcDay(now);
  let best: HostedGrowthSnapshotRow | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const snapshot of snapshots) {
    const ageDays = Math.round(
      (today.getTime() - startOfUtcDay(snapshot.snapshotDate).getTime()) / MS_PER_DAY,
    );

    if (ageDays < SNAPSHOT_COMPARE_MIN_DAYS || ageDays > SNAPSHOT_COMPARE_MAX_DAYS) {
      continue;
    }

    const distance = Math.abs(ageDays - SNAPSHOT_COMPARE_TARGET_DAYS);
    if (distance < bestDistance) {
      best = snapshot;
      bestDistance = distance;
    }
  }

  return best;
}

export function getTrialMaturityCutoff(now: Date): Date {
  return addUtcDays(now, -HOSTED_PULSE_TRIAL_DAYS);
}

export async function readHostedGrowthDashboard(
  now: Date,
  prisma: HostedGrowthPrisma = getPrisma(),
): Promise<HostedGrowthDashboard> {
  const todayStart = startOfUtcDay(now);
  const recentStart = addUtcDays(todayStart, -63);
  const dailyStart = addUtcDays(todayStart, -(DAILY_SERIES_DAYS - 1));

  const [
    current,
    memberRows,
    rawTrialStartRows,
    snapshots,
    matureStarted,
    matureConverted,
  ] = await Promise.all([
    readCurrentHostedGrowthMetrics(now, prisma),
    prisma.hostedMember.findMany({
      select: {
        createdAt: true,
      },
      where: {
        createdAt: {
          gte: recentStart,
          lte: now,
        },
      },
    }),
    prisma.hostedMemberBillingRef.findMany({
      select: {
        currentBillingPhase: true,
        member: {
          select: {
            accountGroupMemberships: {
              select: {
                id: true,
              },
              take: 1,
              where: activePaidFamilyMembershipWhere(),
            },
            suspendedAt: true,
          },
        },
        pulseTrialRedeemedAt: true,
      },
      where: {
        pulseTrialRedeemedAt: {
          gte: recentStart,
          lte: now,
        },
      },
    }),
    prisma.hostedGrowthDailySnapshot.findMany({
      orderBy: {
        snapshotDate: "asc",
      },
      select: growthSnapshotSelect,
      where: {
        snapshotDate: {
          gte: dailyStart,
          lte: todayStart,
        },
      },
    }),
    prisma.hostedMemberBillingRef.count({
      where: {
        pulseTrialRedeemedAt: {
          lt: getTrialMaturityCutoff(now),
        },
      },
    }),
    prisma.hostedMemberBillingRef.count({
      where: {
        member: {
          OR: [
            {
              billingRef: {
                is: {
                  currentBillingPhase: "paid",
                },
              },
            },
            {
              accountGroupMemberships: {
                some: activePaidFamilyMembershipWhere(),
              },
            },
          ],
          suspendedAt: null,
        },
        pulseTrialRedeemedAt: {
          lt: getTrialMaturityCutoff(now),
        },
      },
    }),
  ]);
  const trialStartRows = rawTrialStartRows.map((row): HostedGrowthTrialStartRow => ({
    currentBillingPhase: row.currentBillingPhase,
    member: {
      suspendedAt: row.member.suspendedAt,
    },
    paidViaFamily: row.member.accountGroupMemberships.length > 0,
    pulseTrialRedeemedAt: row.pulseTrialRedeemedAt,
  }));

  const dailySeries = buildDailyGrowthSeries({
    dayCount: DAILY_SERIES_DAYS,
    memberRows,
    trialStartRows,
    windowEnd: now,
  });
  const weeklyRows = buildWeeklyGrowthRows({
    memberRows,
    trialStartRows,
    weekCount: WEEKLY_ROWS,
    windowEnd: now,
  });
  const comparableSnapshot = findComparableSnapshot(snapshots, now);
  const todayNewMembers = countCreatedRowsInRange(
    memberRows,
    todayStart,
    addUtcDays(todayStart, 1),
  );
  const currentSevenDayStart = addUtcDays(todayStart, -6);
  const previousSevenDayStart = addUtcDays(todayStart, -13);
  const newMembersTrailing7Days = countCreatedRowsInRange(
    memberRows,
    currentSevenDayStart,
    addUtcDays(todayStart, 1),
  );
  const newMembersPrevious7Days = countCreatedRowsInRange(
    memberRows,
    previousSevenDayStart,
    currentSevenDayStart,
  );
  const trialStartsTrailing7Days = countTrialStartsInRange(
    trialStartRows,
    currentSevenDayStart,
    addUtcDays(todayStart, 1),
  );
  const trialStartsPrevious7Days = countTrialStartsInRange(
    trialStartRows,
    previousSevenDayStart,
    currentSevenDayStart,
  );

  return {
    capturedAt: now.toISOString(),
    conversion: calculateTrialConversionSummary({
      matureConverted,
      matureStarted,
    }),
    current,
    dailySeries,
    mrrWowPercent: comparableSnapshot === null
      ? null
      : calculatePercentChange(current.mrrUsdCents, comparableSnapshot.mrrUsdCents),
    newMembers: {
      today: todayNewMembers,
      trailing7Days: newMembersTrailing7Days,
      wowPercent: calculatePercentChange(newMembersTrailing7Days, newMembersPrevious7Days),
    },
    payingCustomersWowPercent: comparableSnapshot === null
      ? null
      : calculatePercentChange(
          current.payingCustomers,
          comparableSnapshot.payingCustomers,
        ),
    snapshotSeries: snapshots.map(serializeSnapshotPoint),
    trialCohorts: buildTrialCohortRows({
      rowCount: WEEKLY_ROWS,
      trialStartRows,
      windowEnd: now,
    }),
    trialStarts: {
      trailing7Days: trialStartsTrailing7Days,
      wowPercent: calculatePercentChange(
        trialStartsTrailing7Days,
        trialStartsPrevious7Days,
      ),
    },
    weeklyRows,
  };
}

/**
 * Paying metrics use paid billing phase, active billing status, and unsuspended
 * rows. Family paid groups also require at least one billed seat.
 */
export async function captureHostedGrowthDailySnapshot(
  now: Date,
  prisma: HostedGrowthPrisma = getPrisma(),
): Promise<HostedGrowthSnapshotRow> {
  const current = await readCurrentHostedGrowthMetrics(now, prisma);
  const snapshotDate = startOfUtcDay(now);

  return prisma.hostedGrowthDailySnapshot.upsert({
    create: {
      capturedAt: now,
      coveredMembers: current.coveredMembers,
      mrrUsdCents: current.mrrUsdCents,
      payingCustomers: current.payingCustomers,
      payingFamilyGroups: current.payingFamilyGroups,
      payingFamilySeats: current.payingFamilySeats,
      payingIndividuals: current.payingIndividuals,
      snapshotDate,
      totalMembers: current.totalMembers,
      trialingMembers: current.trialingMembers,
    },
    select: growthSnapshotSelect,
    update: {
      capturedAt: now,
      coveredMembers: current.coveredMembers,
      mrrUsdCents: current.mrrUsdCents,
      payingCustomers: current.payingCustomers,
      payingFamilyGroups: current.payingFamilyGroups,
      payingFamilySeats: current.payingFamilySeats,
      payingIndividuals: current.payingIndividuals,
      totalMembers: current.totalMembers,
      trialingMembers: current.trialingMembers,
    },
    where: {
      snapshotDate,
    },
  });
}

async function readCurrentHostedGrowthMetrics(
  now: Date,
  prisma: HostedGrowthPrisma,
): Promise<HostedGrowthCurrentMetrics> {
  const [
    totalMembers,
    payingIndividuals,
    payingFamilyGroups,
    trialCandidates,
    statusCounts,
  ] = await Promise.all([
    prisma.hostedMember.count(),
    prisma.hostedMember.findMany({
      select: {
        billingRef: {
          select: {
            currentBillingPhase: true,
            currentBillingPlanCode: true,
          },
        },
        id: true,
      },
      where: {
        billingRef: {
          is: {
            currentBillingPhase: "paid",
          },
        },
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      },
    }),
    prisma.hostedAccountGroup.findMany({
      select: {
        billingRef: {
          select: {
            billedSeatCount: true,
            currentBillingPhase: true,
          },
        },
        id: true,
        memberships: {
          select: {
            memberId: true,
          },
          where: {
            member: {
              suspendedAt: null,
            },
            status: "active",
          },
        },
      },
      where: {
        ...paidHostedFamilyGroupWhere,
      },
    }),
    prisma.hostedMember.findMany({
      select: {
        billingRef: {
          select: {
            currentBillingPhase: true,
            currentCheckoutOffer: true,
            currentTrialEndsAt: true,
          },
        },
        billingStatus: true,
        suspendedAt: true,
      },
      where: {
        billingRef: {
          isNot: null,
        },
        billingStatus: {
          in: [
            HostedBillingStatus.active,
            HostedBillingStatus.paused,
          ],
        },
        suspendedAt: null,
      },
    }),
    readStatusCounts(prisma),
  ]);

  return calculateHostedGrowthCurrentMetrics({
    payingFamilyGroups,
    payingIndividuals,
    statusCounts,
    totalMembers,
    trialCandidates,
    windowEnd: now,
  });
}

async function readStatusCounts(
  prisma: HostedGrowthPrisma,
): Promise<HostedGrowthStatusCounts> {
  const counts = await Promise.all(
    CHURN_STATUS_KEYS.map((status) =>
      prisma.hostedMember.count({
        where: {
          billingStatus: status,
        },
      })
    ),
  );

  return {
    canceled: counts[1] ?? 0,
    past_due: counts[0] ?? 0,
    paused: counts[2] ?? 0,
    unpaid: counts[3] ?? 0,
  };
}

function serializeSnapshotPoint(row: HostedGrowthSnapshotRow): HostedGrowthSnapshotPoint {
  return {
    coveredMembers: row.coveredMembers,
    date: formatUtcDateKey(row.snapshotDate),
    mrrUsdCents: row.mrrUsdCents,
    payingCustomers: row.payingCustomers,
    trialingMembers: row.trialingMembers,
  };
}

function countCreatedRowsInRange(
  rows: HostedGrowthDateRow[],
  startInclusive: Date,
  endExclusive: Date,
): number {
  return rows.filter((row) =>
    row.createdAt >= startInclusive &&
    row.createdAt < endExclusive
  ).length;
}

function countTrialStartsInRange(
  rows: HostedGrowthTrialStartRow[],
  startInclusive: Date,
  endExclusive: Date,
): number {
  return rows.filter((row) =>
    row.pulseTrialRedeemedAt !== null &&
    row.pulseTrialRedeemedAt >= startInclusive &&
    row.pulseTrialRedeemedAt < endExclusive
  ).length;
}

function keyIfInWindow(
  value: Date,
  startInclusive: Date,
  endExclusive: Date,
): string | null {
  if (value < startInclusive || value >= endExclusive) {
    return null;
  }

  return formatUtcDateKey(value);
}

const growthSnapshotSelect = {
  capturedAt: true,
  coveredMembers: true,
  mrrUsdCents: true,
  payingCustomers: true,
  payingFamilyGroups: true,
  payingFamilySeats: true,
  payingIndividuals: true,
  snapshotDate: true,
  totalMembers: true,
  trialingMembers: true,
} satisfies Record<keyof HostedGrowthSnapshotRow, true>;
