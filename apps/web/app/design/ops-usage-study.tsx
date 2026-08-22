import type { ReactNode } from "react";

import {
  MemberUsageClient,
  type MemberUsageClientDesignState,
} from "../(dashboard)/ops/usage/member-usage-client";
import type { HostedOpsMemberUsageDashboard } from "@/src/lib/hosted-ops/member-usage";

const DESIGN_OPS_USAGE_DASHBOARD: HostedOpsMemberUsageDashboard = {
  capturedAt: "2026-07-22T18:00:00.000Z",
  messageRetentionDays: 30,
  pagination: {
    nextCursor: "hbm_design_next",
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
    maskedPhoneNumberHint: "*** 0101",
    memberId: "hbm_design_starter_member",
    memberKind: "member",
    messagesDailyAverage7Days: 1.7,
    messagesLast7Days: 12,
    messagesRetained: 42,
    participantCount: null,
    resetMode: "starter_allowance",
    runtimeRecheckAvailable: false,
    suspended: false,
  }, {
    allowanceStatus: "available",
    allTimeUsageUsdMicros: "4500000",
    billingStatus: "active",
    containerOwnerMemberId: null,
    createdAt: "2026-07-09T00:00:00.000Z",
    currentPeriod: {
      blocked: false,
      idempotencyClaimStatus: null,
      limitUsdMicros: "0",
      periodEnd: "2099-12-31T23:59:59.999Z",
      periodStart: "1970-01-01T00:00:00.000Z",
      remainingUsdMicros: "4500000",
      spentUsdMicros: "0",
      updatedAt: "2026-07-22T17:45:00.000Z",
      usageCreditBalanceUsdMicros: "4500000",
      usageCreditLedgerVersion: "44",
    },
    maskedPhoneNumberHint: "*** 0202",
    memberId: "hbm_design_starter_wake_pending",
    memberKind: "member",
    messagesDailyAverage7Days: 0.4,
    messagesLast7Days: 3,
    messagesRetained: 8,
    participantCount: null,
    resetMode: null,
    runtimeRecheckAvailable: true,
    suspended: false,
  }, {
    allowanceStatus: "available",
    allTimeUsageUsdMicros: "7250000",
    billingStatus: "active",
    containerOwnerMemberId: "hbm_design_owner",
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
    memberId: "hbm_design_group_container",
    memberKind: "group_container",
    messagesDailyAverage7Days: 1,
    messagesLast7Days: 7,
    messagesRetained: 18,
    participantCount: 2,
    resetMode: "included_usage",
    runtimeRecheckAvailable: false,
    suspended: false,
  }],
  search: {
    cap: 100,
    capped: false,
    error: null,
    kind: null,
    query: null,
    resultCount: 3,
  },
  summary: {
    activeEntitiesLast7Days: 2,
    groupContainers: 1,
    members: 2,
    totalAllTimeUsageUsdMicros: "16250000",
  },
};

const DESIGN_OPS_USAGE_SEARCH_DASHBOARD: HostedOpsMemberUsageDashboard = {
  ...DESIGN_OPS_USAGE_DASHBOARD,
  pagination: {
    ...DESIGN_OPS_USAGE_DASHBOARD.pagination,
    nextCursor: null,
    previousCursor: null,
  },
  search: {
    cap: 100,
    capped: true,
    error: null,
    kind: "phone_last_four",
    query: "0101",
    resultCount: 100,
  },
};

const DESIGN_OPS_USAGE_EMPTY_SEARCH_DASHBOARD: HostedOpsMemberUsageDashboard = {
  ...DESIGN_OPS_USAGE_SEARCH_DASHBOARD,
  rows: [],
  search: {
    cap: 100,
    capped: false,
    error: null,
    kind: "member_id",
    query: "hbm_design_missing",
    resultCount: 0,
  },
};

const DESIGN_OPS_USAGE_ERROR_SEARCH_DASHBOARD: HostedOpsMemberUsageDashboard = {
  ...DESIGN_OPS_USAGE_EMPTY_SEARCH_DASHBOARD,
  search: {
    cap: 100,
    capped: false,
    error:
      "Enter a complete hosted member/container ID, an exact verified email, or exactly four phone digits.",
    kind: null,
    query: "12",
    resultCount: 0,
  },
};

const DESIGN_OPS_USAGE_RESET_DASHBOARD: HostedOpsMemberUsageDashboard = {
  ...DESIGN_OPS_USAGE_DASHBOARD,
  summary: {
    ...DESIGN_OPS_USAGE_DASHBOARD.summary,
    groupContainers: 1,
    members: 46,
  },
};

export const OPS_USAGE_DIALOG_STATES = [
  "abandonment",
  "progress",
  "partial-failure",
] as const;

export type OpsUsageDialogState = (typeof OPS_USAGE_DIALOG_STATES)[number];

const OPS_USAGE_DIALOG_DESIGN_STATES: Record<
  OpsUsageDialogState,
  MemberUsageClientDesignState
> = {
  abandonment: "reset_all_abandonment",
  "partial-failure": "reset_all_partial_failure",
  progress: "reset_all_progress",
};

const RESET_STATES: Array<{
  state: MemberUsageClientDesignState;
  title: string;
}> = [{
  state: "reset_all_confirmation",
  title: "Destructive confirmation",
}, {
  state: "reset_all_abandonment",
  title: "Explicit operation abandonment",
}, {
  state: "reset_all_progress",
  title: "Bounded progress",
}, {
  state: "reset_all_complete",
  title: "Completion",
}, {
  state: "reset_all_wake_recovery",
  title: "Population complete with runtime recovery remaining",
}, {
  state: "reset_all_partial_failure",
  title: "Partial failure and recovery",
}];

export function OpsUsageStudy() {
  return (
    <div
      className="grid scroll-mt-24 gap-16"
      data-design-section="ops-usage-dashboard"
      id="ops-usage-dashboard"
      inert
    >
      <StudyFrame title="Search loading">
        <MemberUsageClient
          dashboard={DESIGN_OPS_USAGE_DASHBOARD}
          designState="search_loading"
          operatorMemberId={null}
        />
      </StudyFrame>
      <StudyFrame title="Capped search">
        <MemberUsageClient
          dashboard={DESIGN_OPS_USAGE_SEARCH_DASHBOARD}
          operatorMemberId={null}
        />
      </StudyFrame>
      <StudyFrame title="Empty search">
        <MemberUsageClient
          dashboard={DESIGN_OPS_USAGE_EMPTY_SEARCH_DASHBOARD}
          operatorMemberId={null}
        />
      </StudyFrame>
      <StudyFrame title="Invalid search">
        <MemberUsageClient
          dashboard={DESIGN_OPS_USAGE_ERROR_SEARCH_DASHBOARD}
          operatorMemberId={null}
        />
      </StudyFrame>
      <StudyFrame title="Stale row error and recovery">
        <MemberUsageClient
          dashboard={DESIGN_OPS_USAGE_DASHBOARD}
          designState="row_stale_error"
          operatorMemberId={null}
        />
      </StudyFrame>
      {RESET_STATES.map(({ state, title }) => (
        <StudyFrame key={state} title={title}>
          <MemberUsageClient
            dashboard={DESIGN_OPS_USAGE_RESET_DASHBOARD}
            designResetAllInline
            designState={state}
            operatorMemberId={null}
          />
        </StudyFrame>
      ))}
    </div>
  );
}

export function OpsUsageDialogStudy(input: {
  state: OpsUsageDialogState;
}) {
  return (
    <div inert>
      <MemberUsageClient
        dashboard={DESIGN_OPS_USAGE_RESET_DASHBOARD}
        designResetAllDialogInert
        designState={OPS_USAGE_DIALOG_DESIGN_STATES[input.state]}
        operatorMemberId={null}
      />
    </div>
  );
}

function StudyFrame(input: { children: ReactNode; title: string }) {
  return (
    <section className="grid gap-4">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {input.title}
      </p>
      {input.children}
    </section>
  );
}
