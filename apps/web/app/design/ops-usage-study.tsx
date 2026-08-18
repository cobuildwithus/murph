import { MemberUsageClient } from "../(dashboard)/ops/usage/member-usage-client";
import type { HostedOpsMemberUsageDashboard } from "@/src/lib/hosted-ops/member-usage";

const DESIGN_OPS_USAGE_DASHBOARD: HostedOpsMemberUsageDashboard = {
  capturedAt: "2026-07-22T18:00:00.000Z",
  messageRetentionDays: 30,
  pagination: {
    nextCursor: "design_member_next",
    pageSize: 25,
    previousCursor: null,
  },
  rows: [{
    allowanceStatus: "available",
    allTimeUsageUsdMicros: "4500000",
    billingStatus: "active",
    containerOwnerMemberId: null,
    createdAt: "2026-07-08T00:00:00.000Z",
    currentPeriod: {
      blocked: true,
      idempotencyClaimStatus: "accepted",
      limitUsdMicros: "0",
      periodEnd: "2099-12-31T23:59:59.999Z",
      periodStart: "1970-01-01T00:00:00.000Z",
      remainingUsdMicros: "0",
      spentUsdMicros: "0",
      updatedAt: "2026-07-22T17:30:00.000Z",
      usageCreditBalanceUsdMicros: "0",
      usageCreditLedgerVersion: "43",
    },
    maskedPhoneNumberHint: "••• 0101",
    memberId: "design_starter_member",
    memberKind: "member",
    messagesDailyAverage7Days: 1.7,
    messagesLast7Days: 12,
    messagesRetained: 42,
    participantCount: null,
    resetMode: "starter_allowance",
    suspended: false,
  }, {
    allowanceStatus: "available",
    allTimeUsageUsdMicros: "7250000",
    billingStatus: "active",
    containerOwnerMemberId: "design_owner",
    createdAt: "2026-06-01T00:00:00.000Z",
    currentPeriod: {
      blocked: true,
      idempotencyClaimStatus: "accepted",
      limitUsdMicros: "4500000",
      periodEnd: "2026-08-01T00:00:00.000Z",
      periodStart: "2026-07-01T00:00:00.000Z",
      remainingUsdMicros: "0",
      spentUsdMicros: "4522964",
      updatedAt: "2026-07-22T17:30:00.000Z",
      usageCreditBalanceUsdMicros: "0",
      usageCreditLedgerVersion: "4",
    },
    maskedPhoneNumberHint: null,
    memberId: "design_group_container",
    memberKind: "group_container",
    messagesDailyAverage7Days: 1,
    messagesLast7Days: 7,
    messagesRetained: 18,
    participantCount: 2,
    resetMode: "included_usage",
    suspended: false,
  }],
  summary: {
    activeEntitiesLast7Days: 1,
    groupContainers: 1,
    members: 1,
    totalAllTimeUsageUsdMicros: "11750000",
  },
};

export function OpsUsageStudy() {
  return (
    <div
      className="scroll-mt-24"
      data-design-section="ops-usage-dashboard"
      id="ops-usage-dashboard"
      inert
    >
      <MemberUsageClient dashboard={DESIGN_OPS_USAGE_DASHBOARD} />
    </div>
  );
}
