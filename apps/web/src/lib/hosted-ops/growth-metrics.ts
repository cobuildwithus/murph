import "server-only";

import {
  HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
  isHostedEmailConversationMessageWake,
  isHostedExecutionGroupReactionEventId,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  readHostedLinqConversationMessageContact,
  type HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import {
  HostedBillingStatus,
  HostedUsageCreditPurchaseStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { decodeHostedMailboxStoredPayload } from "@/src/lib/hosted-mailbox/store";
import {
  HOSTED_FAMILY_PLAN_CODES,
  HOSTED_PULSE_TRIAL_DAYS,
  getHostedBillingPlanDefinition,
  getHostedFamilyBillingOfferDefinition,
  isHostedPulseTrialBillingState,
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  readHostedFamilyPlanCapacities,
  sumHostedFamilyPlanCapacities,
} from "@/src/lib/hosted-onboarding/family-plan-capacity";
import {
  createHostedTelegramUserLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  createHostedLinqParticipantContact,
  createHostedLinqParticipantContactLookupKeyReadCandidates,
  type HostedLinqParticipantContactKind,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";
import {
  parseHostedPulseTrialStartSource,
  type HostedPulseTrialStartSource,
} from "@/src/lib/hosted-onboarding/pulse-trial-start-source";
import {
  buildHostedGrowthMessageSeries,
  type HostedGrowthMessagePoint,
} from "@/src/lib/hosted-ops/growth-message-series";
import {
  MONTHLY_REVENUE_MONTHS,
  buildHostedGrowthMonthlyRevenueSeries,
  startOfUtcMonthsAgo,
  type HostedGrowthMonthlyRevenuePoint,
} from "@/src/lib/hosted-ops/growth-monthly-revenue-series";
import { HOSTED_MESSAGE_VOLUME_BASE } from "@/src/lib/message-volume";
import { getPrisma } from "@/src/lib/prisma";

export { buildHostedGrowthMessageSeries } from "@/src/lib/hosted-ops/growth-message-series";
export type { HostedGrowthMessagePoint } from "@/src/lib/hosted-ops/growth-message-series";
export { buildHostedGrowthMonthlyRevenueSeries } from "@/src/lib/hosted-ops/growth-monthly-revenue-series";
export type { HostedGrowthMonthlyRevenuePoint } from "@/src/lib/hosted-ops/growth-monthly-revenue-series";

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

const realHostedMemberWhere = {
  hostedGroupRuntime: null,
  threadContainer: null,
} satisfies Prisma.HostedMemberWhereInput;

function activePaidFamilyMembershipWhere(): Prisma.HostedAccountGroupMembershipWhereInput {
  return {
    group: paidHostedFamilyGroupWhere,
    status: "active",
  };
}

type HostedGrowthPrisma = PrismaClient;

const INBOUND_MESSAGE_MAILBOX_KIND = "conversation.message";
const HOSTED_GROWTH_AGGREGATE_ID = "global";
const OUTBOUND_LINQ_SENT_STATUSES = [
  "accepted",
  "delivered",
  "sent_no_receipt_expected",
] as const;

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
  planCapacities: {
    billedQuantity: number;
    planCode: string;
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

export type HostedGrowthTrialStartSource =
  | HostedPulseTrialStartSource
  | "unknown";

export interface HostedGrowthTrialStartSourceCounts {
  companion_onboarding: number;
  linq_instant_start: number;
  unknown: number;
  web_onboarding: number;
}

export interface HostedGrowthRecentTrialStart {
  memberCreatedAt: string;
  phoneHint: string | null;
  pulseTrialStartSource: HostedGrowthTrialStartSource;
  trialStartedAt: string;
}

interface HostedGrowthTrialStartAttributionRow {
  memberCreatedAt: Date;
  phoneHint: string | null;
  pulseTrialRedeemedAt: Date;
  pulseTrialStartSource: HostedPulseTrialStartSource | null;
}

export interface HostedGrowthSnapshotRow {
  activeUsersPriorDay: number | null;
  activeUsersTrailing7Days: number | null;
  capturedAt: Date;
  coveredMembers: number;
  familyMrrUsdCents: number | null;
  inboundMessagesPriorDay: number | null;
  individualMrrUsdCents: number | null;
  mrrUsdCents: number;
  outboundMessagesPriorDay: number | null;
  payingCustomers: number;
  payingFamilyGroups: number;
  payingFamilySeats: number;
  payingIndividuals: number;
  snapshotDate: Date;
  totalMembers: number;
  trialingMembers: number;
}

export interface HostedGrowthSnapshotCapture {
  activityAvailable: boolean;
  snapshot: HostedGrowthSnapshotRow;
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
  maxPaidIndividuals: number;
  maxMrrUsdCents: number;
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
  activeUsers: {
    today: number;
    todayComplete: boolean;
    trailing30Days: number;
    trailing30DaysComplete: boolean;
    trailing7Days: number;
    trailing7DaysComplete: boolean;
    wowComparisonComplete: boolean;
    wowPercent: number | null;
  };
  capturedAt: string;
  conversion: {
    converted: number;
    matureStarted: number;
    percent: number | null;
  };
  current: HostedGrowthCurrentMetrics;
  dailySeries: HostedGrowthDailyPoint[];
  messageSeries: HostedGrowthMessagePoint[];
  monthlyRevenueSeries: HostedGrowthMonthlyRevenuePoint[];
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
  trialStartAttribution: {
    counts: HostedGrowthTrialStartSourceCounts;
    recent: HostedGrowthRecentTrialStart[];
    windowStartDate: string;
  };
  usageTopUps: {
    trackedFulfilled: number;
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
  let maxMrrUsdCents = 0;
  let pulsePaidIndividuals = 0;
  let maxPaidIndividuals = 0;
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
    } else if (planCode === "launch_max_monthly") {
      maxPaidIndividuals += 1;
      maxMrrUsdCents += amountUsdCents;
    } else {
      pulsePaidIndividuals += 1;
      pulseMrrUsdCents += amountUsdCents;
    }
  }

  let payingFamilyGroups = 0;
  let payingFamilySeats = 0;
  let familyMrrUsdCents = 0;
  for (const group of input.payingFamilyGroups) {
    const billedSeatCount = group.billingRef?.billedSeatCount ?? 0;
    const capacities = readHostedFamilyPlanCapacities(
      group.planCapacities,
      billedSeatCount > 0 ? billedSeatCount : null,
    );
    if (group.billingRef?.currentBillingPhase !== "paid" || !capacities) {
      continue;
    }

    payingFamilyGroups += 1;
    payingFamilySeats += sumHostedFamilyPlanCapacities(capacities);
    familyMrrUsdCents += HOSTED_FAMILY_PLAN_CODES.reduce(
      (sum, planCode) => sum + capacities[planCode] *
        getHostedFamilyBillingOfferDefinition(planCode).recurringAmountUsdCents,
      0,
    );
    for (const membership of group.memberships) {
      coveredMemberIds.add(membership.memberId);
    }
  }

  const trialMetrics = calculateHostedTrialMetrics({
    rows: input.trialCandidates,
    windowEnd: input.windowEnd,
  });
  const payingIndividuals = paidMemberIds.size;

  return {
    coveredMembers: Math.min(input.totalMembers, coveredMemberIds.size),
    edgePaidIndividuals,
    edgeMrrUsdCents,
    familyMrrUsdCents,
    maxPaidIndividuals,
    maxMrrUsdCents,
    mrrUsdCents:
      pulseMrrUsdCents + edgeMrrUsdCents + maxMrrUsdCents + familyMrrUsdCents,
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

export function buildHostedGrowthTrialStartAttribution(input: {
  endExclusive: Date;
  limit?: number;
  rows: HostedGrowthTrialStartAttributionRow[];
  startInclusive: Date;
}): HostedGrowthDashboard["trialStartAttribution"] {
  const counts: HostedGrowthTrialStartSourceCounts = {
    companion_onboarding: 0,
    linq_instant_start: 0,
    unknown: 0,
    web_onboarding: 0,
  };
  const rows = input.rows
    .filter((row) =>
      row.pulseTrialRedeemedAt >= input.startInclusive
      && row.pulseTrialRedeemedAt < input.endExclusive
    )
    .sort(
      (left, right) =>
        right.pulseTrialRedeemedAt.getTime()
        - left.pulseTrialRedeemedAt.getTime(),
    );

  for (const row of rows) {
    counts[row.pulseTrialStartSource ?? "unknown"] += 1;
  }

  return {
    counts,
    recent: rows.slice(0, input.limit ?? 12).map((row) => ({
      memberCreatedAt: row.memberCreatedAt.toISOString(),
      phoneHint: row.phoneHint,
      pulseTrialStartSource: row.pulseTrialStartSource ?? "unknown",
      trialStartedAt: row.pulseTrialRedeemedAt.toISOString(),
    })),
    windowStartDate: formatUtcDateKey(input.startInclusive),
  };
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
    let converted = 0;
    let stillTrialing = 0;

    for (const row of cohortRows) {
      const isConverted = row.member.suspendedAt === null &&
        (row.currentBillingPhase === "paid" || row.paidViaFamily);

      if (isConverted) {
        converted += 1;
      } else if (
        row.pulseTrialRedeemedAt !== null &&
        row.pulseTrialRedeemedAt >= maturityCutoff
      ) {
        stillTrialing += 1;
      }
    }

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

interface HostedGrowthGroupMailboxRow {
  contentRetiredAt: Date | null;
  createdAt: Date;
  dedupeKey: string;
  id: string;
  kind: string;
  lane: string;
  laneSeq: bigint;
  occurredAt: Date;
  payload: {
    payloadCiphertext: string;
  } | null;
  payloadInlineCiphertext: string | null;
  payloadRef: string | null;
  payloadSchema: string;
  userId: string;
}

const hostedGrowthGroupMailboxSelect = {
  contentRetiredAt: true,
  createdAt: true,
  dedupeKey: true,
  id: true,
  kind: true,
  lane: true,
  laneSeq: true,
  occurredAt: true,
  payload: {
    select: {
      payloadCiphertext: true,
    },
  },
  payloadInlineCiphertext: true,
  payloadRef: true,
  payloadSchema: true,
  userId: true,
} satisfies Prisma.HostedMailboxItemSelect;

interface HostedGrowthLinqSenderEvidence {
  contactKind: HostedLinqParticipantContactKind;
  fallbackIdentity: string;
  identityKey: string;
  kind: "linq";
  registrationLookupKeys: string[];
  senderMemberId?: string;
}

interface HostedGrowthTelegramSenderEvidence {
  fallbackIdentity: string;
  identityKey: string;
  kind: "telegram";
  registrationLookupKeys: string[];
  senderMemberId?: string;
}

type HostedGrowthGroupSenderEvidence =
  | HostedGrowthLinqSenderEvidence
  | HostedGrowthTelegramSenderEvidence;

interface HostedGrowthAttributedGroupMessage {
  createdAt: Date;
  evidence: HostedGrowthGroupSenderEvidence;
}

interface HostedGrowthDecodedGroupMessages {
  messages: HostedGrowthAttributedGroupMessage[];
  retiredMessageCreatedAt: Date[];
}

interface HostedGrowthActiveUserCounts {
  previous7Days: number;
  previous7DaysComplete: boolean;
  today: number;
  todayComplete: boolean;
  trailing30Days: number;
  trailing30DaysComplete: boolean;
  trailing7Days: number;
  trailing7DaysComplete: boolean;
}

async function calculateHostedGrowthActiveUsers(input: {
  currentDirectRows: ReadonlyArray<{ userId: string }>;
  groupRows: readonly HostedGrowthGroupMailboxRow[];
  monthlyDirectRows: ReadonlyArray<{ userId: string }>;
  monthlyStart: Date;
  now: Date;
  previousDirectRows: ReadonlyArray<{ userId: string }>;
  previousStart: Date;
  prisma: HostedGrowthPrisma;
  todayDirectRows: ReadonlyArray<{ userId: string }>;
  todayStart: Date;
  trailing7DayStart: Date;
}): Promise<HostedGrowthActiveUserCounts> {
  const decodedGroupMessages = await decodeHostedGrowthGroupMessages(
    input.groupRows,
    input.prisma,
  );
  const groupMessages = decodedGroupMessages.messages;
  const senderIdentities = await resolveHostedGrowthGroupSenderIdentities(
    groupMessages.map((message) => message.evidence),
    input.prisma,
  );
  const trailing7DayIdentities = new Set(
    input.currentDirectRows.map((row) => hostedGrowthMemberIdentity(row.userId)),
  );
  const previous7DayIdentities = new Set(
    input.previousDirectRows.map((row) => hostedGrowthMemberIdentity(row.userId)),
  );
  const trailing30DayIdentities = new Set(
    input.monthlyDirectRows.map((row) => hostedGrowthMemberIdentity(row.userId)),
  );
  const todayIdentities = new Set(
    input.todayDirectRows.map((row) => hostedGrowthMemberIdentity(row.userId)),
  );

  for (const message of groupMessages) {
    const identity = senderIdentities.get(message.evidence.identityKey);
    if (!identity) {
      throw new Error("Hosted growth group sender identity was not resolved.");
    }
    if (
      message.createdAt.getTime() >= input.todayStart.getTime()
      && message.createdAt.getTime() < input.now.getTime()
    ) {
      todayIdentities.add(identity);
    }
    if (
      message.createdAt.getTime() >= input.monthlyStart.getTime()
      && message.createdAt.getTime() < input.now.getTime()
    ) {
      trailing30DayIdentities.add(identity);
    }
    if (
      message.createdAt.getTime() >= input.trailing7DayStart.getTime()
      && message.createdAt.getTime() < input.now.getTime()
    ) {
      trailing7DayIdentities.add(identity);
    } else if (
      message.createdAt.getTime() >= input.previousStart.getTime()
      && message.createdAt.getTime() < input.trailing7DayStart.getTime()
    ) {
      previous7DayIdentities.add(identity);
    }
  }

  return {
    previous7Days: previous7DayIdentities.size,
    previous7DaysComplete: !hasHostedGrowthRetiredMessageInWindow({
      end: input.trailing7DayStart,
      retiredMessageCreatedAt: decodedGroupMessages.retiredMessageCreatedAt,
      start: input.previousStart,
    }),
    today: todayIdentities.size,
    todayComplete: !hasHostedGrowthRetiredMessageInWindow({
      end: input.now,
      retiredMessageCreatedAt: decodedGroupMessages.retiredMessageCreatedAt,
      start: input.todayStart,
    }),
    trailing30Days: trailing30DayIdentities.size,
    trailing30DaysComplete: !hasHostedGrowthRetiredMessageInWindow({
      end: input.now,
      retiredMessageCreatedAt: decodedGroupMessages.retiredMessageCreatedAt,
      start: input.monthlyStart,
    }),
    trailing7Days: trailing7DayIdentities.size,
    trailing7DaysComplete: !hasHostedGrowthRetiredMessageInWindow({
      end: input.now,
      retiredMessageCreatedAt: decodedGroupMessages.retiredMessageCreatedAt,
      start: input.trailing7DayStart,
    }),
  };
}

async function decodeHostedGrowthGroupMessages(
  rows: readonly HostedGrowthGroupMailboxRow[],
  prisma: HostedGrowthPrisma,
): Promise<HostedGrowthDecodedGroupMessages> {
  return runWithHostedDomainRootUnwrapCache(async () => {
    // Retired reaction attestations were never sender evidence, so they must
    // not mark an active-user window incomplete.
    const retiredMessageCreatedAt = rows.flatMap((row) =>
      row.contentRetiredAt && !isHostedExecutionGroupReactionEventId(row.dedupeKey)
        ? [row.createdAt]
        : []
    );
    const retainedRows = rows.filter((row) => !row.contentRetiredAt);
    const messages = await Promise.all(retainedRows.map(async (row) => {
      if (row.payloadRef && !row.payload) {
        throw new Error("Hosted growth group message sidecar payload is unavailable.");
      }
      const decoded = await decodeHostedMailboxStoredPayload({
        dedupeKey: row.dedupeKey,
        kind: row.kind,
        lane: row.lane,
        laneSeq: row.laneSeq,
        mailboxItemId: row.id,
        occurredAt: row.occurredAt.toISOString(),
        payloadCiphertext: row.payload?.payloadCiphertext ?? null,
        payloadInlineCiphertext: row.payloadInlineCiphertext,
        payloadSchema: row.payloadSchema,
        prisma,
        userId: row.userId,
      });
      if (!decoded) {
        throw new Error("Hosted growth group message payload is unavailable.");
      }
      const wake = parseHostedExecutionWake(decoded);
      if (wake.kind !== INBOUND_MESSAGE_MAILBOX_KIND || wake.userId !== row.userId) {
        throw new Error("Hosted growth group message does not match its mailbox item.");
      }
      if (isHostedEmailConversationMessageWake(wake)) {
        return null;
      }
      const evidence = readHostedGrowthGroupSenderEvidence(wake);
      if (!evidence) {
        return null;
      }

      return {
        createdAt: row.createdAt,
        evidence,
      };
    }));
    return {
      messages: messages.filter(
        (message): message is HostedGrowthAttributedGroupMessage => message !== null,
      ),
      retiredMessageCreatedAt,
    };
  });
}

function hasHostedGrowthRetiredMessageInWindow(input: {
  end: Date;
  retiredMessageCreatedAt: readonly Date[];
  start: Date;
}): boolean {
  return input.retiredMessageCreatedAt.some((createdAt) =>
    createdAt.getTime() >= input.start.getTime()
    && createdAt.getTime() < input.end.getTime()
  );
}

function readHostedGrowthGroupSenderEvidence(
  wake: HostedExecutionConversationMessageWake,
): HostedGrowthGroupSenderEvidence | null {
  if (isHostedLinqConversationMessageWake(wake)) {
    if (wake.message.linqMessage.threadIsDirect !== false) {
      throw new Error("Hosted growth thread-container Linq message must be non-direct.");
    }
    if (
      isHostedExecutionGroupReactionEventId(wake.eventId)
      && wake.message.linqMessage.from
        === HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION
    ) {
      return null;
    }
    const storedContact = readHostedLinqConversationMessageContact(wake.message);
    const currentContact = createHostedLinqParticipantContact({
      kind: storedContact.kind,
      value: wake.message.linqMessage.from,
    });
    if (!currentContact) {
      throw new Error("Hosted growth Linq group sender contact is invalid.");
    }
    const registrationLookupKeys =
      createHostedLinqParticipantContactLookupKeyReadCandidates({
        kind: currentContact.kind,
        value: currentContact.value,
      });
    if (!registrationLookupKeys.includes(storedContact.lookupKey)) {
      throw new Error("Hosted growth Linq group sender contact does not match its blind index.");
    }
    const fallbackIdentity = hostedGrowthLinqEvidenceKey(
      currentContact.kind,
      currentContact.lookupKey,
    );
    const identityKey = wake.message.senderMemberId
      ? hostedGrowthMemberIdentity(wake.message.senderMemberId)
      : fallbackIdentity;
    return {
      contactKind: currentContact.kind,
      fallbackIdentity,
      identityKey,
      kind: "linq",
      registrationLookupKeys,
      ...(wake.message.senderMemberId
        ? { senderMemberId: wake.message.senderMemberId }
        : {}),
    };
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    if (wake.message.telegramMessage.threadIsDirect !== false) {
      throw new Error("Hosted growth thread-container Telegram message must be non-direct.");
    }
    if (
      isHostedExecutionGroupReactionEventId(wake.eventId)
      && wake.message.telegramMessage.from
        === HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION
    ) {
      return null;
    }
    if (wake.message.senderMemberId) {
      const identityKey = hostedGrowthMemberIdentity(wake.message.senderMemberId);
      return {
        fallbackIdentity: identityKey,
        identityKey,
        kind: "telegram",
        registrationLookupKeys: [],
        senderMemberId: wake.message.senderMemberId,
      };
    }
    const senderUserId = wake.message.telegramMessage.from?.trim() ?? "";
    const registrationLookupKeys =
      createHostedTelegramUserLookupKeyReadCandidates(senderUserId);
    if (registrationLookupKeys.length === 0) {
      return null;
    }
    const fallbackIdentity = `telegram:${registrationLookupKeys[0]}`;
    return {
      fallbackIdentity,
      identityKey: fallbackIdentity,
      kind: "telegram",
      registrationLookupKeys,
    };
  }

  throw new Error("Hosted growth thread-container message channel is not attributable.");
}

async function resolveHostedGrowthGroupSenderIdentities(
  evidenceRows: readonly HostedGrowthGroupSenderEvidence[],
  prisma: HostedGrowthPrisma,
): Promise<Map<string, string>> {
  const phoneLookupKeys = collectHostedGrowthLinqLookupKeys(evidenceRows, "phone");
  const emailLookupKeys = collectHostedGrowthLinqLookupKeys(evidenceRows, "email");
  const telegramLookupKeys = new Set(
    evidenceRows.flatMap((evidence) =>
      evidence.kind === "telegram" && !evidence.senderMemberId
        ? evidence.registrationLookupKeys
        : []
    ),
  );
  const [phoneMembers, emailMembers, telegramMembers] = await Promise.all([
    phoneLookupKeys.size === 0
      ? []
      : prisma.hostedMemberIdentity.findMany({
          select: {
            memberId: true,
            phoneLookupKey: true,
          },
          where: {
            phoneLookupKey: {
              in: [...phoneLookupKeys],
            },
          },
        }),
    emailLookupKeys.size === 0
      ? []
      : prisma.hostedMemberEmailAuthorization.findMany({
          select: {
            memberId: true,
            verifiedEmailLookupKey: true,
          },
          where: {
            verifiedEmailLookupKey: {
              in: [...emailLookupKeys],
            },
            verifiedEmailVerifiedAt: {
              not: null,
            },
          },
        }),
    telegramLookupKeys.size === 0
      ? []
      : prisma.hostedMemberRouting.findMany({
          select: {
            memberId: true,
            telegramUserLookupKey: true,
          },
          where: {
            telegramUserLookupKey: {
              in: [...telegramLookupKeys],
            },
          },
        }),
  ]);
  const memberIdsByLookupKey = new Map<string, Set<string>>();
  for (const row of phoneMembers) {
    addHostedGrowthLookupMember(memberIdsByLookupKey, row.phoneLookupKey, row.memberId);
  }
  for (const row of emailMembers) {
    addHostedGrowthLookupMember(
      memberIdsByLookupKey,
      row.verifiedEmailLookupKey,
      row.memberId,
    );
  }
  for (const row of telegramMembers) {
    addHostedGrowthLookupMember(
      memberIdsByLookupKey,
      row.telegramUserLookupKey,
      row.memberId,
    );
  }

  const identities = new Map<string, string>();
  for (const evidence of evidenceRows) {
    if (identities.has(evidence.identityKey)) {
      continue;
    }
    if (evidence.senderMemberId) {
      identities.set(
        evidence.identityKey,
        hostedGrowthMemberIdentity(evidence.senderMemberId),
      );
      continue;
    }
    const matchingMemberIds = new Set(
      evidence.registrationLookupKeys.flatMap((lookupKey) =>
        [...(memberIdsByLookupKey.get(lookupKey) ?? [])]
      ),
    );
    if (matchingMemberIds.size > 1) {
      throw new Error("Hosted growth group sender matched multiple registered members.");
    }
    const [memberId] = [...matchingMemberIds];
    if (memberId) {
      identities.set(evidence.identityKey, hostedGrowthMemberIdentity(memberId));
      continue;
    }
    identities.set(evidence.identityKey, evidence.fallbackIdentity);
  }
  return identities;
}

function collectHostedGrowthLinqLookupKeys(
  evidenceRows: readonly HostedGrowthGroupSenderEvidence[],
  kind: HostedLinqParticipantContactKind,
): Set<string> {
  return new Set(evidenceRows.flatMap((evidence) =>
    evidence.kind === "linq"
    && evidence.contactKind === kind
    && !evidence.senderMemberId
      ? evidence.registrationLookupKeys
      : []
  ));
}

function addHostedGrowthLookupMember(
  memberIdsByLookupKey: Map<string, Set<string>>,
  lookupKey: string | null,
  memberId: string,
): void {
  if (!lookupKey) {
    return;
  }
  const memberIds = memberIdsByLookupKey.get(lookupKey) ?? new Set<string>();
  memberIds.add(memberId);
  memberIdsByLookupKey.set(lookupKey, memberIds);
}

function hostedGrowthMemberIdentity(memberId: string): string {
  return `member:${memberId}`;
}

function hostedGrowthLinqEvidenceKey(
  kind: HostedLinqParticipantContactKind,
  lookupKey: string,
): string {
  return `linq:${kind}:${lookupKey}`;
}

export async function readHostedGrowthDashboard(
  now: Date,
  prisma: HostedGrowthPrisma = getPrisma(),
): Promise<HostedGrowthDashboard> {
  const todayStart = startOfUtcDay(now);
  const recentStart = addUtcDays(todayStart, -63);
  const dailyStart = addUtcDays(todayStart, -(DAILY_SERIES_DAYS - 1));
  const currentCalendarSevenDayStart = addUtcDays(todayStart, -6);
  const previousCalendarSevenDayStart = addUtcDays(todayStart, -13);
  const currentCalendarSevenDayEnd = addUtcDays(todayStart, 1);
  const activeUsersCurrentStart = addUtcDays(now, -7);
  const activeUsersPreviousStart = addUtcDays(now, -14);
  const activeUsersMonthlyStart = addUtcDays(now, -30);
  const monthlyRevenueStart = startOfUtcMonthsAgo(
    todayStart,
    MONTHLY_REVENUE_MONTHS - 1,
  );

  const [
    current,
    memberRows,
    rawTrialStartRows,
    snapshots,
    messagesBeforeSeries,
    matureStarted,
    matureConverted,
    growthAggregate,
    activeUsersTrailing7DayDirectRows,
    activeUsersPrevious7DayDirectRows,
    activeUsersTrailing30DayDirectRows,
    activeUsersGroupRows,
    activeUsersTodayDirectRows,
    monthlyRevenuePurchases,
  ] = await Promise.all([
    readCurrentHostedGrowthMetrics(now, prisma),
    prisma.hostedMember.findMany({
      select: {
        createdAt: true,
      },
      where: {
        ...realHostedMemberWhere,
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
            createdAt: true,
            identity: {
              select: {
                maskedPhoneNumberHint: true,
              },
            },
            suspendedAt: true,
          },
        },
        pulseTrialRedeemedAt: true,
        pulseTrialStartSource: true,
      },
      where: {
        pulseTrialRedeemedAt: {
          gte: recentStart,
          lte: now,
        },
      },
    }),
    // One snapshot read serves both the 30-day chart series and the
    // six-month revenue projection; the message-history aggregate below
    // still ends at dailyStart, so widening this window double-counts
    // nothing.
    prisma.hostedGrowthDailySnapshot.findMany({
      orderBy: {
        snapshotDate: "asc",
      },
      select: growthSnapshotSelect,
      where: {
        snapshotDate: {
          gte: monthlyRevenueStart,
          lte: todayStart,
        },
      },
    }),
    prisma.hostedGrowthDailySnapshot.aggregate({
      _count: {
        inboundMessagesPriorDay: true,
        outboundMessagesPriorDay: true,
      },
      _sum: {
        inboundMessagesPriorDay: true,
        outboundMessagesPriorDay: true,
      },
      where: {
        snapshotDate: {
          lt: dailyStart,
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
    prisma.hostedGrowthAggregate.findUniqueOrThrow({
      select: {
        trackedFulfilledUsageTopUps: true,
      },
      where: {
        id: HOSTED_GROWTH_AGGREGATE_ID,
      },
    }),
    prisma.hostedMailboxItem.groupBy({
      by: ["userId"],
      where: {
        kind: INBOUND_MESSAGE_MAILBOX_KIND,
        member: realHostedMemberWhere,
        createdAt: {
          gte: activeUsersCurrentStart,
          lt: now,
        },
      },
    }),
    prisma.hostedMailboxItem.groupBy({
      by: ["userId"],
      where: {
        kind: INBOUND_MESSAGE_MAILBOX_KIND,
        member: realHostedMemberWhere,
        createdAt: {
          gte: activeUsersPreviousStart,
          lt: activeUsersCurrentStart,
        },
      },
    }),
    prisma.hostedMailboxItem.groupBy({
      by: ["userId"],
      where: {
        kind: INBOUND_MESSAGE_MAILBOX_KIND,
        member: realHostedMemberWhere,
        createdAt: {
          gte: activeUsersMonthlyStart,
          lt: now,
        },
      },
    }),
    prisma.hostedMailboxItem.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: hostedGrowthGroupMailboxSelect,
      where: {
        kind: INBOUND_MESSAGE_MAILBOX_KIND,
        member: {
          threadContainer: {
            isNot: null,
          },
        },
        createdAt: {
          gte: activeUsersMonthlyStart,
          lt: now,
        },
      },
    }),
    prisma.hostedMailboxItem.groupBy({
      by: ["userId"],
      where: {
        kind: INBOUND_MESSAGE_MAILBOX_KIND,
        member: realHostedMemberWhere,
        createdAt: {
          gte: todayStart,
          lt: now,
        },
      },
    }),
    prisma.hostedUsageCreditPurchase.findMany({
      select: {
        cashAmountMinor: true,
        groupSponsorshipAuthorizationId: true,
        groupSponsorshipMoment: {
          select: {
            purchaseId: true,
          },
        },
        paidAt: true,
      },
      where: {
        paidAt: {
          gte: monthlyRevenueStart,
          lte: now,
        },
        status: HostedUsageCreditPurchaseStatus.fulfilled,
        stripeLiveMode: true,
      },
    }),
  ]);
  const activeUsers = await calculateHostedGrowthActiveUsers({
    currentDirectRows: activeUsersTrailing7DayDirectRows,
    groupRows: activeUsersGroupRows,
    monthlyDirectRows: activeUsersTrailing30DayDirectRows,
    monthlyStart: activeUsersMonthlyStart,
    now,
    previousDirectRows: activeUsersPrevious7DayDirectRows,
    previousStart: activeUsersPreviousStart,
    prisma,
    todayDirectRows: activeUsersTodayDirectRows,
    todayStart,
    trailing7DayStart: activeUsersCurrentStart,
  });
  const trialStartRows = rawTrialStartRows.map((row): HostedGrowthTrialStartRow => ({
    currentBillingPhase: row.currentBillingPhase,
    member: {
      suspendedAt: row.member.suspendedAt,
    },
    paidViaFamily: row.member.accountGroupMemberships.length > 0,
    pulseTrialRedeemedAt: row.pulseTrialRedeemedAt,
  }));
  const trialStartAttribution = buildHostedGrowthTrialStartAttribution({
    endExclusive: addUtcDays(todayStart, 1),
    rows: rawTrialStartRows.flatMap((row) => {
      if (row.pulseTrialRedeemedAt === null) {
        return [];
      }
      return [{
        memberCreatedAt: row.member.createdAt,
        phoneHint: row.member.identity?.maskedPhoneNumberHint ?? null,
        pulseTrialRedeemedAt: row.pulseTrialRedeemedAt,
        pulseTrialStartSource: parseHostedPulseTrialStartSource(
          row.pulseTrialStartSource,
        ),
      }];
    }),
    startInclusive: dailyStart,
  });

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
  const newMembersTrailing7Days = countCreatedRowsInRange(
    memberRows,
    currentCalendarSevenDayStart,
    currentCalendarSevenDayEnd,
  );
  const newMembersPrevious7Days = countCreatedRowsInRange(
    memberRows,
    previousCalendarSevenDayStart,
    currentCalendarSevenDayStart,
  );
  const trialStartsTrailing7Days = countTrialStartsInRange(
    trialStartRows,
    currentCalendarSevenDayStart,
    currentCalendarSevenDayEnd,
  );
  const trialStartsPrevious7Days = countTrialStartsInRange(
    trialStartRows,
    previousCalendarSevenDayStart,
    currentCalendarSevenDayStart,
  );

  return {
    activeUsers: {
      today: activeUsers.today,
      todayComplete: activeUsers.todayComplete,
      trailing30Days: activeUsers.trailing30Days,
      trailing30DaysComplete: activeUsers.trailing30DaysComplete,
      trailing7Days: activeUsers.trailing7Days,
      trailing7DaysComplete: activeUsers.trailing7DaysComplete,
      wowComparisonComplete:
        activeUsers.trailing7DaysComplete && activeUsers.previous7DaysComplete,
      wowPercent:
        activeUsers.trailing7DaysComplete && activeUsers.previous7DaysComplete
          ? calculatePercentChange(
              activeUsers.trailing7Days,
              activeUsers.previous7Days,
            )
          : null,
    },
    capturedAt: now.toISOString(),
    conversion: calculateTrialConversionSummary({
      matureConverted,
      matureStarted,
    }),
    current,
    dailySeries,
    messageSeries: buildHostedGrowthMessageSeries({
      messagesBeforeSeries: HOSTED_MESSAGE_VOLUME_BASE +
        (messagesBeforeSeries._sum.inboundMessagesPriorDay ?? 0) +
        (messagesBeforeSeries._sum.outboundMessagesPriorDay ?? 0),
      snapshots,
      trackingEstablishedBeforeSeries:
        messagesBeforeSeries._count.inboundMessagesPriorDay > 0
        && messagesBeforeSeries._count.outboundMessagesPriorDay > 0,
      windowEnd: now,
    }),
    monthlyRevenueSeries: buildHostedGrowthMonthlyRevenueSeries({
      monthCount: MONTHLY_REVENUE_MONTHS,
      purchases: monthlyRevenuePurchases.flatMap((purchase) =>
        purchase.paidAt === null ? [] : [{
          cashAmountMinor: purchase.cashAmountMinor,
          isGroupSponsorship:
            purchase.groupSponsorshipAuthorizationId !== null
            || purchase.groupSponsorshipMoment !== null,
          paidAt: purchase.paidAt,
        }]
      ),
      snapshots,
      windowEnd: now,
    }),
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
    snapshotSeries: snapshots
      .filter((row) => row.snapshotDate.getTime() >= dailyStart.getTime())
      .map(serializeSnapshotPoint),
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
    trialStartAttribution,
    usageTopUps: {
      trackedFulfilled: growthAggregate.trackedFulfilledUsageTopUps,
    },
    weeklyRows,
  };
}

/**
 * Paying metrics use paid billing phase, active billing status, and unsuspended
 * rows. Family paid groups also require at least one billed seat.
 *
 * Message counts cover the full UTC day before `snapshot_date`, so reruns on
 * the same date are deterministic. Inbound counts `conversation.message`
 * mailbox items across all channels; those rows expire, so the snapshot is
 * the durable record. Outbound counts sent rows in the Linq delivery ledger,
 * currently the only channel with a delivery ledger. Unique-sender counts use
 * durable mailbox receipt time and cover that completed day and the seven
 * completed days ending at the snapshot date. Incomplete sender evidence is
 * stored as null.
 */
export async function captureHostedGrowthDailySnapshot(
  now: Date,
  prisma: HostedGrowthPrisma = getPrisma(),
): Promise<HostedGrowthSnapshotCapture> {
  const snapshotDate = startOfUtcDay(now);
  const priorDayStart = addUtcDays(snapshotDate, -1);
  const trailing7DayStart = addUtcDays(snapshotDate, -7);
  const activityCountsPromise = (async () => {
    const [
      activeUsersPriorDayDirectRows,
      activeUsersTrailing7DayDirectRows,
      activeUsersGroupRows,
    ] = await Promise.all([
      prisma.hostedMailboxItem.groupBy({
        by: ["userId"],
        where: {
          kind: INBOUND_MESSAGE_MAILBOX_KIND,
          member: realHostedMemberWhere,
          createdAt: {
            gte: priorDayStart,
            lt: snapshotDate,
          },
        },
      }),
      prisma.hostedMailboxItem.groupBy({
        by: ["userId"],
        where: {
          kind: INBOUND_MESSAGE_MAILBOX_KIND,
          member: realHostedMemberWhere,
          createdAt: {
            gte: trailing7DayStart,
            lt: snapshotDate,
          },
        },
      }),
      prisma.hostedMailboxItem.findMany({
        orderBy: {
          createdAt: "asc",
        },
        select: hostedGrowthGroupMailboxSelect,
        where: {
          kind: INBOUND_MESSAGE_MAILBOX_KIND,
          member: {
            threadContainer: {
              isNot: null,
            },
          },
          createdAt: {
            gte: trailing7DayStart,
            lt: snapshotDate,
          },
        },
      }),
    ]);
    const activeUsers = await calculateHostedGrowthActiveUsers({
      currentDirectRows: activeUsersTrailing7DayDirectRows,
      groupRows: activeUsersGroupRows,
      monthlyDirectRows: activeUsersTrailing7DayDirectRows,
      monthlyStart: trailing7DayStart,
      now: snapshotDate,
      previousDirectRows: [],
      previousStart: trailing7DayStart,
      prisma,
      todayDirectRows: activeUsersPriorDayDirectRows,
      todayStart: priorDayStart,
      trailing7DayStart,
    });

    return {
      available: true as const,
      activeUsersPriorDay: activeUsers.todayComplete
        ? activeUsers.today
        : null,
      activeUsersTrailing7Days: activeUsers.trailing7DaysComplete
        ? activeUsers.trailing7Days
        : null,
    };
  })().catch(() => {
    console.error(
      "Hosted growth activity snapshot attribution failed; preserving existing activity aggregates when present.",
    );
    return {
      available: false as const,
    };
  });
  const [
    current,
    inboundMessagesPriorDay,
    outboundMessagesPriorDay,
    activityCounts,
  ] =
    await Promise.all([
      readCurrentHostedGrowthMetrics(now, prisma),
      prisma.hostedMailboxItem.count({
        where: {
          kind: INBOUND_MESSAGE_MAILBOX_KIND,
          occurredAt: {
            gte: priorDayStart,
            lt: snapshotDate,
          },
        },
      }),
      prisma.hostedLinqDelivery.count({
        where: {
          attemptedAt: {
            gte: priorDayStart,
            lt: snapshotDate,
          },
          status: {
            in: [...OUTBOUND_LINQ_SENT_STATUSES],
          },
        },
      }),
      activityCountsPromise,
    ]);
  const activityCreateCounts = activityCounts.available
    ? activityCounts
    : {
      activeUsersPriorDay: null,
      activeUsersTrailing7Days: null,
    };

  const snapshot = await prisma.hostedGrowthDailySnapshot.upsert({
    create: {
      activeUsersPriorDay: activityCreateCounts.activeUsersPriorDay,
      activeUsersTrailing7Days: activityCreateCounts.activeUsersTrailing7Days,
      capturedAt: now,
      coveredMembers: current.coveredMembers,
      familyMrrUsdCents: current.familyMrrUsdCents,
      inboundMessagesPriorDay,
      individualMrrUsdCents:
        current.pulseMrrUsdCents + current.edgeMrrUsdCents,
      mrrUsdCents: current.mrrUsdCents,
      outboundMessagesPriorDay,
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
      ...(activityCounts.available
        ? {
          activeUsersPriorDay: activityCounts.activeUsersPriorDay,
          activeUsersTrailing7Days: activityCounts.activeUsersTrailing7Days,
        }
        : {}),
      capturedAt: now,
      coveredMembers: current.coveredMembers,
      familyMrrUsdCents: current.familyMrrUsdCents,
      inboundMessagesPriorDay,
      individualMrrUsdCents:
        current.pulseMrrUsdCents + current.edgeMrrUsdCents,
      mrrUsdCents: current.mrrUsdCents,
      outboundMessagesPriorDay,
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

  return {
    activityAvailable: activityCounts.available,
    snapshot,
  };
}

/**
 * Lifetime message total for public marketing surfaces. Snapshot message
 * counts only exist from July 2026 onward, so the base stands in for the
 * untracked history and the snapshot sums accrue on top of it. Snapshot
 * coverage ends at the latest snapshot date, so the live counts start
 * there and use the cron's own filters, keeping the two ranges disjoint
 * even when today's snapshot has not been captured yet. The base alone is
 * the fallback when the read fails.
 */
export async function readHostedMessageVolumeTotal(
  now: Date,
  prisma: HostedGrowthPrisma = getPrisma(),
): Promise<number> {
  try {
    const snapshots = await prisma.hostedGrowthDailySnapshot.aggregate({
      _max: {
        snapshotDate: true,
      },
      _sum: {
        inboundMessagesPriorDay: true,
        outboundMessagesPriorDay: true,
      },
    });
    const liveStart = snapshots._max.snapshotDate ?? startOfUtcDay(now);
    const [liveInbound, liveOutbound] = await Promise.all([
      prisma.hostedMailboxItem.count({
        where: {
          kind: INBOUND_MESSAGE_MAILBOX_KIND,
          occurredAt: {
            gte: liveStart,
          },
        },
      }),
      prisma.hostedLinqDelivery.count({
        where: {
          attemptedAt: {
            gte: liveStart,
          },
          status: {
            in: [...OUTBOUND_LINQ_SENT_STATUSES],
          },
        },
      }),
    ]);

    return HOSTED_MESSAGE_VOLUME_BASE +
      (snapshots._sum.inboundMessagesPriorDay ?? 0) +
      (snapshots._sum.outboundMessagesPriorDay ?? 0) +
      liveInbound +
      liveOutbound;
  } catch {
    return HOSTED_MESSAGE_VOLUME_BASE;
  }
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
    prisma.hostedMember.count({
      where: realHostedMemberWhere,
    }),
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
        planCapacities: {
          select: {
            billedQuantity: true,
            planCode: true,
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
  activeUsersPriorDay: true,
  activeUsersTrailing7Days: true,
  capturedAt: true,
  coveredMembers: true,
  familyMrrUsdCents: true,
  inboundMessagesPriorDay: true,
  individualMrrUsdCents: true,
  mrrUsdCents: true,
  outboundMessagesPriorDay: true,
  payingCustomers: true,
  payingFamilyGroups: true,
  payingFamilySeats: true,
  payingIndividuals: true,
  snapshotDate: true,
  totalMembers: true,
  trialingMembers: true,
} satisfies Record<keyof HostedGrowthSnapshotRow, true>;
