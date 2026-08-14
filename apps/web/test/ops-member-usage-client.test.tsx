import { act, createElement, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const routerRefresh = vi.fn();
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

vi.mock("lucide-react", () => ({
  RotateCcwIcon: () => createElement("svg"),
}));

vi.mock("@/src/components/ui/alert", () => ({
  Alert: ({ variant, ...props }: ComponentProps<"div"> & { variant?: string }) => {
    void variant;
    return createElement("div", { role: "alert", ...props });
  },
  AlertDescription: (props: ComponentProps<"div">) =>
    createElement("div", props),
}));

vi.mock("@/src/components/ui/badge", () => ({
  Badge: ({ variant, ...props }: ComponentProps<"span"> & { variant?: string }) => {
    void variant;
    return createElement("span", props);
  },
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: ({ size, variant, ...props }: ComponentProps<"button"> & {
    size?: string;
    variant?: string;
  }) => {
    void size;
    void variant;
    return createElement("button", props);
  },
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({ children, open }: ComponentProps<"div"> & { open?: boolean }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: ({ showCloseButton, ...props }: ComponentProps<"div"> & {
    showCloseButton?: boolean;
  }) => {
    void showCloseButton;
    return createElement("div", props);
  },
  DialogDescription: (props: ComponentProps<"p">) => createElement("p", props),
  DialogFooter: (props: ComponentProps<"div">) => createElement("div", props),
  DialogHeader: (props: ComponentProps<"div">) => createElement("div", props),
  DialogTitle: (props: ComponentProps<"h2">) => createElement("h2", props),
}));

vi.mock("@/src/components/ui/spinner", () => ({
  Spinner: (props: ComponentProps<"span">) => createElement("span", props),
}));

vi.mock("@/src/components/ui/table", () => ({
  Table: (props: ComponentProps<"table">) => createElement("table", props),
  TableBody: (props: ComponentProps<"tbody">) => createElement("tbody", props),
  TableCell: (props: ComponentProps<"td">) => createElement("td", props),
  TableHead: (props: ComponentProps<"th">) => createElement("th", props),
  TableHeader: (props: ComponentProps<"thead">) => createElement("thead", props),
  TableRow: (props: ComponentProps<"tr">) => createElement("tr", props),
}));

import { MemberUsageClient } from "../app/(dashboard)/ops/usage/member-usage-client";
import type { HostedOpsMemberUsageDashboard } from "../src/lib/hosted-ops/member-usage";
import { renderClientComponent } from "./render-client-component";

const fetchMock = vi.fn<typeof fetch>();
let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  fetchMock.mockReset();
  routerPush.mockReset();
  routerRefresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  vi.unstubAllGlobals();
});

describe("MemberUsageClient", () => {
  test("shows members, containers, retained-message scope, and usage totals", async () => {
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: makeDashboard() }),
    );
    cleanupRender = rendered.cleanup;

    expect(rendered.container.textContent).toContain("Members and containers");
    expect(rendered.container.textContent).not.toContain("Legacy Pulse trials");
    expect(rendered.container.textContent).toContain("30-day mailbox window");
    expect(rendered.container.textContent).toContain("hbm_container");
    expect(rendered.container.textContent).toContain("2 participants");
    expect(rendered.container.textContent).toContain("$7.25");
    expect(rendered.container.textContent).toContain("Notice claimed");
    expect(rendered.container.textContent).toContain("25 rows per page");
    expect(rendered.container.querySelectorAll("table")).toHaveLength(1);
  });

  test("navigates through deterministic previous and next cursors", async () => {
    const dashboard = makeDashboard();
    dashboard.pagination = {
      nextCursor: "hbm_050",
      pageSize: 25,
      previousCursor: "hbm_026",
    };
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard }),
    );
    cleanupRender = rendered.cleanup;

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Previous"),
    );
    await clickButton(rendered.window, getButton(rendered.container, "Next"));

    expect(routerPush).toHaveBeenNthCalledWith(
      1,
      "/ops/usage?before=hbm_026",
    );
    expect(routerPush).toHaveBeenNthCalledWith(
      2,
      "/ops/usage?after=hbm_050",
    );
    expect(
      rendered.container.querySelector(
        'nav[aria-label="Member usage pages"]',
      ),
    ).not.toBeNull();
  });

  test("labels a row without a current period without calling it available", async () => {
    const dashboard = makeDashboard();
    const row = dashboard.rows[0];
    if (!row) {
      throw new Error("Expected a usage fixture row.");
    }
    row.currentPeriod = null;
    row.allowanceStatus = "unavailable";
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard }),
    );
    cleanupRender = rendered.cleanup;

    expect(rendered.container.textContent).toContain("Unavailable");
    expect(rendered.container.textContent).not.toContain("Available");
    const resetButton = getButton(rendered.container, "Reset");
    expect(resetButton.getAttribute("aria-label")).toBe(
      "Reset usage for hbm_container",
    );
    expect(resetButton.disabled).toBe(true);
  });

  test("keeps a synthetic available period visible but not resettable", async () => {
    const dashboard = makeDashboard();
    const period = dashboard.rows[0]?.currentPeriod;
    if (!period) {
      throw new Error("Expected a usage fixture period.");
    }
    period.blocked = false;
    period.idempotencyClaimStatus = null;
    period.remainingUsdMicros = "4500000";
    period.spentUsdMicros = "0";
    period.updatedAt = null;
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard }),
    );
    cleanupRender = rendered.cleanup;

    expect(rendered.container.textContent).toContain("Available");
    expect(rendered.container.textContent).toContain("$0.00 / $4.50");
    expect(getButton(rendered.container, "Reset").disabled).toBe(true);
  });

  test("shows canonical availability independently from a notice claim", async () => {
    const dashboard = makeDashboard();
    const period = dashboard.rows[0]?.currentPeriod;
    if (!period) {
      throw new Error("Expected a usage fixture period.");
    }
    period.blocked = false;
    period.limitUsdMicros = "25000000";
    period.remainingUsdMicros = "15000000";
    period.spentUsdMicros = "10000000";
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard }),
    );
    cleanupRender = rendered.cleanup;

    expect(rendered.container.textContent).toContain("Notice claimed");
    expect(rendered.container.textContent).toContain("Available");
    expect(rendered.container.textContent).not.toContain("Blocked");
  });

  test("keeps a clear persisted period actionable for a later runtime wake", async () => {
    const dashboard = makeDashboard();
    const period = dashboard.rows[0]?.currentPeriod;
    if (!period) {
      throw new Error("Expected a usage fixture period.");
    }
    period.blocked = false;
    period.idempotencyClaimStatus = null;
    period.spentUsdMicros = "0";
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard }),
    );
    cleanupRender = rendered.cleanup;

    expect(getButton(rendered.container, "Reset").disabled).toBe(false);
  });

  test("shows an explicit empty state", async () => {
    const dashboard = makeDashboard();
    dashboard.rows = [];
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard }),
      { requireButton: false },
    );
    cleanupRender = rendered.cleanup;

    expect(rendered.container.textContent).toContain(
      "No hosted members or group containers were found on this page.",
    );
  });

  test("confirms and submits the exact period version before refreshing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      memberId: "hbm_container",
      noticeClaimReleased: true,
      outcome: "reset",
      periodStart: "2026-07-01T00:00:00.000Z",
      previousSpentUsdMicros: "4522964",
      resetAt: "2026-07-22T18:00:00.000Z",
      runtimeRecheckStatus: "accepted",
      updatedAt: "2026-07-22T18:00:00.000Z",
    }));
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: makeDashboard() }),
    );
    cleanupRender = rendered.cleanup;

    await clickButton(rendered.window, getButton(rendered.container, "Reset"));
    expect(rendered.container.textContent).toContain(
      "Reset current included usage?",
    );
    expect(rendered.container.textContent).toContain("Will be released");

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Reset usage"),
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/ops/usage-reset", {
      body: JSON.stringify({
        expectedPeriodUpdatedAt: "2026-07-22T17:30:00.000Z",
        expectedUsageCreditLedgerVersion: "4",
        memberId: "hbm_container",
        periodStart: "2026-07-01T00:00:00.000Z",
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(rendered.container.querySelector('[role="alert"]')?.textContent)
      .toContain("runtime recheck was accepted");
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  test("keeps a committed reset open and retries only the runtime wake", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        memberId: "hbm_container",
        noticeClaimReleased: true,
        outcome: "reset",
        periodStart: "2026-07-01T00:00:00.000Z",
        previousSpentUsdMicros: "4522964",
        resetAt: "2026-07-22T18:00:00.000Z",
        runtimeRecheckStatus: "pending",
        updatedAt: "2026-07-22T18:00:00.000Z",
      }, 202))
      .mockResolvedValueOnce(jsonResponse({
        memberId: "hbm_container",
        runtimeRecheckStatus: "accepted",
      }));
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: makeDashboard() }),
    );
    cleanupRender = rendered.cleanup;

    await clickButton(rendered.window, getButton(rendered.container, "Reset"));
    await clickButton(rendered.window, getButton(rendered.container, "Reset usage"));

    expect(rendered.container.textContent).toContain(
      "Usage was reset, but the runtime did not accept its recheck yet.",
    );
    expect(rendered.container.textContent).toContain("Retry runtime wake?");
    expect(rendered.container.textContent).toContain("Target");
    expect(rendered.container.textContent).not.toContain("Current spend");
    expect(rendered.container.textContent).not.toContain("Will be released");
    expect(getButton(rendered.container, "Close").disabled).toBe(false);
    expect(getButton(rendered.container, "Retry runtime wake").disabled).toBe(false);

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Retry runtime wake"),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/ops/usage-reset", {
      body: JSON.stringify({
        memberId: "hbm_container",
        operation: "runtime_recheck",
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(rendered.container.querySelector('[role="alert"]')?.textContent)
      .toContain("runtime recheck was accepted");
  });

  test("surfaces a stale reset without claiming success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        code: "HOSTED_OPS_USAGE_RESET_STALE",
        message: "Usage changed after this table loaded.",
      },
    }, 409));
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: makeDashboard() }),
    );
    cleanupRender = rendered.cleanup;

    await clickButton(rendered.window, getButton(rendered.container, "Reset"));
    await clickButton(
      rendered.window,
      getButton(rendered.container, "Reset usage"),
    );

    expect(rendered.container.querySelector('[role="alert"]')?.textContent)
      .toContain("Usage changed after this table loaded");
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });
});

function makeDashboard(): HostedOpsMemberUsageDashboard {
  return {
    capturedAt: "2026-07-22T18:00:00.000Z",
    messageRetentionDays: 30,
    pagination: {
      nextCursor: null,
      pageSize: 25,
      previousCursor: null,
    },
    rows: [{
      allowanceStatus: "available",
      allTimeUsageUsdMicros: "7250000",
      billingStatus: "active",
      containerOwnerMemberId: "hbm_owner",
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
      memberId: "hbm_container",
      memberKind: "group_container",
      messagesDailyAverage7Days: 1,
      messagesLast7Days: 7,
      messagesRetained: 18,
      participantCount: 2,
      suspended: false,
    }],
    summary: {
      activeEntitiesLast7Days: 1,
      groupContainers: 1,
      members: 0,
      totalAllTimeUsageUsdMicros: "7250000",
    },
  };
}

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}

async function clickButton(
  window: Window,
  button: HTMLButtonElement,
): Promise<void> {
  await act(async () => {
    const event = window.document.createEvent("Event");
    event.initEvent("click", true, true);
    button.dispatchEvent(event);
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
