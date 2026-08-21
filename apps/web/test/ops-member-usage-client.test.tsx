import {
  act,
  createElement,
  type ComponentProps,
  type InputHTMLAttributes,
} from "react";
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

vi.mock("@/src/components/ui/input", () => ({
  Input({ inputSize, onChange, ...props }:
    InputHTMLAttributes<HTMLInputElement> & { inputSize?: string }) {
    void inputSize;
    return createElement("input", { ...props, onInput: onChange });
  },
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
import {
  HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
} from "../src/lib/hosted-ops/member-usage-contract";
import { renderClientComponent } from "./render-client-component";

const fetchMock = vi.fn<typeof fetch>();
const RESET_ALL_OPERATION_ID = "12345678-1234-4abc-8def-1234567890ab";
const randomUuidMock = vi.fn(() => RESET_ALL_OPERATION_ID);
let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  fetchMock.mockReset();
  randomUuidMock.mockReset();
  randomUuidMock.mockReturnValue(RESET_ALL_OPERATION_ID);
  routerPush.mockReset();
  routerRefresh.mockReset();
  vi.stubGlobal("crypto", { randomUUID: randomUuidMock });
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

  test("keeps capped search URL-backed and removes ordinary page controls", async () => {
    const dashboard = makeDashboard();
    dashboard.pagination = {
      nextCursor: "hbm_050",
      pageSize: 25,
      previousCursor: "hbm_026",
    };
    dashboard.search = {
      cap: 100,
      capped: true,
      error: null,
      query: "0101",
      resultCount: 100,
    };
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard }),
    );
    cleanupRender = rendered.cleanup;

    expect(rendered.container.textContent).toContain(
      "Showing 100 ID-ordered matches (safety cap 100)",
    );
    expect(rendered.container.textContent).toContain(
      "More matches exist; narrow the search",
    );
    expect(
      rendered.container.querySelector(
        'nav[aria-label="Member usage pages"]',
      ),
    ).toBeNull();

    const searchInput = getInput(rendered.container, "ops-usage-search");
    await setInputValue(
      rendered.window,
      searchInput,
      "verified@example.invalid",
    );
    await submitForm(rendered.window, searchInput.closest("form"));

    expect(routerPush).toHaveBeenCalledWith(
      "/ops/usage?q=verified%40example.invalid",
    );

    const searchedDashboard = structuredClone(dashboard);
    searchedDashboard.capturedAt = "2026-07-22T18:00:01.000Z";
    searchedDashboard.search.query = "verified@example.invalid";
    await rendered.rerender(
      createElement(MemberUsageClient, { dashboard: searchedDashboard }),
    );

    expect(getInput(rendered.container, "ops-usage-search").value).toBe(
      "verified@example.invalid",
    );
    expect(getButton(rendered.container, "Search").disabled).toBe(false);
  });

  test("does not enter a loading state when the normalized search is unchanged", async () => {
    const dashboard = makeDashboard();
    dashboard.search = {
      cap: 100,
      capped: false,
      error: null,
      query: "0101",
      resultCount: 1,
    };
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard }),
    );
    cleanupRender = rendered.cleanup;

    const searchInput = getInput(rendered.container, "ops-usage-search");
    await submitForm(rendered.window, searchInput.closest("form"));

    expect(routerPush).not.toHaveBeenCalled();
    expect(getButton(rendered.container, "Search").disabled).toBe(false);
  });

  test("requires typed confirmation and continues bounded reset-everyone batches", async () => {
    const dashboard = makeDashboard();
    dashboard.search = {
      cap: 100,
      capped: false,
      error: null,
      query: "0101",
      resultCount: 1,
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        counts: {
          failed: 0,
          pendingWake: 0,
          processed: 2,
          reset: 1,
          skipped: 1,
          unchanged: 0,
        },
        done: false,
        failure: null,
        lastAcknowledgedCursor: "hbm_reset_002",
      }))
      .mockResolvedValueOnce(jsonResponse({
        counts: {
          failed: 0,
          pendingWake: 1,
          processed: 1,
          reset: 0,
          skipped: 0,
          unchanged: 1,
        },
        done: true,
        failure: null,
        lastAcknowledgedCursor: "hbm_reset_003",
      }));
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard }),
    );
    cleanupRender = rendered.cleanup;

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Reset everyone"),
    );

    expect(rendered.container.textContent).toContain(
      "The active search filter will be ignored.",
    );
    expect(getButton(rendered.container, "Reset").disabled).toBe(true);
    const confirmButton = getButtonByAriaLabel(
      rendered.container,
      "Confirm reset everyone",
    );
    expect(confirmButton.disabled).toBe(true);
    await setInputValue(
      rendered.window,
      getInput(rendered.container, "ops-usage-reset-all-confirmation"),
      HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
    );
    expect(getButtonByAriaLabel(
      rendered.container,
      "Confirm reset everyone",
    ).disabled).toBe(false);

    await clickButton(
      rendered.window,
      getButtonByAriaLabel(rendered.container, "Confirm reset everyone"),
    );
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Reset everyone complete",
      );
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/ops/usage-reset", {
      body: JSON.stringify({
        afterMemberId: null,
        confirmation: HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
        operation: "reset_all_batch",
        operationId: RESET_ALL_OPERATION_ID,
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/ops/usage-reset", {
      body: JSON.stringify({
        afterMemberId: "hbm_reset_002",
        confirmation: HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
        operation: "reset_all_batch",
        operationId: RESET_ALL_OPERATION_ID,
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(readMetric(rendered.container, "Processed")).toBe("3");
    expect(readMetric(rendered.container, "Reset")).toBe("1");
    expect(readMetric(rendered.container, "Unchanged")).toBe("1");
    expect(readMetric(rendered.container, "Skipped")).toBe("1");
    expect(readMetric(rendered.container, "Wake pending")).toBe("1");
    expect(readMetric(rendered.container, "Failed")).toBe("0");
    expect(rendered.container.textContent).toContain(
      "Last acknowledged cursor: hbm_reset_003",
    );
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  test("starts only one reset-everyone loop for rapid repeated confirmation", async () => {
    let resolveBatch!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => {
      resolveBatch = resolve;
    }));
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: makeDashboard() }),
    );
    cleanupRender = rendered.cleanup;

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Reset everyone"),
    );
    await setInputValue(
      rendered.window,
      getInput(rendered.container, "ops-usage-reset-all-confirmation"),
      HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
    );
    const confirmButton = getButtonByAriaLabel(
      rendered.container,
      "Confirm reset everyone",
    );
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      confirmButton.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveBatch(jsonResponse({
        counts: {
          failed: 0,
          pendingWake: 0,
          processed: 1,
          reset: 1,
          skipped: 0,
          unchanged: 0,
        },
        done: true,
        failure: null,
        lastAcknowledgedCursor: "hbm_reset_001",
      }));
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Reset everyone complete",
      );
    });
  });

  test("stops issuing batches after the page closes", async () => {
    let resolveBatch!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => {
      resolveBatch = resolve;
    }));
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: makeDashboard() }),
    );
    cleanupRender = rendered.cleanup;

    await openAndConfirmResetEveryone(rendered);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cleanup = rendered.cleanup;
    cleanupRender = null;
    await cleanup();
    resolveBatch(jsonResponse({
      counts: {
        failed: 0,
        pendingWake: 0,
        processed: 1,
        reset: 1,
        skipped: 0,
        unchanged: 0,
      },
      done: false,
      failure: null,
      lastAcknowledgedCursor: "hbm_reset_001",
    }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("pauses on a member failure and retries from the last acknowledged cursor", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        counts: {
          failed: 1,
          pendingWake: 0,
          processed: 1,
          reset: 1,
          skipped: 0,
          unchanged: 0,
        },
        done: false,
        failure: {
          code: "HOSTED_OPS_USAGE_RESET_NOTICE_IN_FLIGHT",
          memberId: "hbm_reset_002",
          message:
            "A usage-limit notice is currently being sent. Retry from the last acknowledged member after that dispatch settles.",
          retryable: true,
        },
        lastAcknowledgedCursor: "hbm_reset_001",
      }))
      .mockResolvedValueOnce(jsonResponse({
        counts: {
          failed: 0,
          pendingWake: 0,
          processed: 2,
          reset: 1,
          skipped: 0,
          unchanged: 1,
        },
        done: true,
        failure: null,
        lastAcknowledgedCursor: "hbm_reset_003",
      }));
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: makeDashboard() }),
    );
    cleanupRender = rendered.cleanup;

    await openAndConfirmResetEveryone(rendered);
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Reset everyone paused",
      );
    });

    expect(rendered.container.textContent).toContain(
      "The unacknowledged member is hbm_reset_002.",
    );
    expect(readMetric(rendered.container, "Processed")).toBe("1");
    expect(readMetric(rendered.container, "Failed")).toBe("1");
    expect(getButton(rendered.container, "Retry / continue").disabled)
      .toBe(false);
    expect(getButton(rendered.container, "Restart safely").disabled)
      .toBe(false);

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Retry / continue"),
    );
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Reset everyone complete",
      );
    });

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/ops/usage-reset", {
      body: JSON.stringify({
        afterMemberId: "hbm_reset_001",
        confirmation: HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
        operation: "reset_all_batch",
        operationId: RESET_ALL_OPERATION_ID,
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(readMetric(rendered.container, "Processed")).toBe("3");
    expect(readMetric(rendered.container, "Failed")).toBe("0");
  });

  test("offers a full safe restart after an ambiguous batch response", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("Connection closed"))
      .mockResolvedValueOnce(jsonResponse({
        counts: {
          failed: 0,
          pendingWake: 0,
          processed: 1,
          reset: 0,
          skipped: 0,
          unchanged: 1,
        },
        done: true,
        failure: null,
        lastAcknowledgedCursor: "hbm_reset_001",
      }));
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: makeDashboard() }),
    );
    cleanupRender = rendered.cleanup;

    await openAndConfirmResetEveryone(rendered);
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Reset everyone paused",
      );
    });

    expect(rendered.container.textContent).toContain(
      "No unacknowledged outcome was added to the totals below.",
    );
    expect(readMetric(rendered.container, "Processed")).toBe("0");
    await clickButton(
      rendered.window,
      getButton(rendered.container, "Restart safely"),
    );
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Reset everyone complete",
      );
    });

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/ops/usage-reset", {
      body: JSON.stringify({
        afterMemberId: null,
        confirmation: HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
        operation: "reset_all_batch",
        operationId: RESET_ALL_OPERATION_ID,
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(readMetric(rendered.container, "Processed")).toBe("1");
    expect(randomUuidMock).toHaveBeenCalledTimes(1);
  });

  test("does not count a batch without a forward acknowledged cursor", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      counts: {
        failed: 0,
        pendingWake: 0,
        processed: 1,
        reset: 1,
        skipped: 0,
        unchanged: 0,
      },
      done: true,
      failure: null,
      lastAcknowledgedCursor: null,
    }));
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: makeDashboard() }),
    );
    cleanupRender = rendered.cleanup;

    await openAndConfirmResetEveryone(rendered);
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Reset everyone paused",
      );
    });

    expect(rendered.container.textContent).toContain(
      "The server did not acknowledge forward progress.",
    );
    expect(readMetric(rendered.container, "Processed")).toBe("0");
    expect(readMetric(rendered.container, "Reset")).toBe("0");
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  test("accepts server-ordered cursors without assuming JavaScript collation", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        counts: {
          failed: 0,
          pendingWake: 0,
          processed: 1,
          reset: 1,
          skipped: 0,
          unchanged: 0,
        },
        done: false,
        failure: null,
        lastAcknowledgedCursor: "hbm_reset_z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        counts: {
          failed: 0,
          pendingWake: 0,
          processed: 1,
          reset: 0,
          skipped: 0,
          unchanged: 1,
        },
        done: true,
        failure: null,
        lastAcknowledgedCursor: "hbm_reset_a",
      }));
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: makeDashboard() }),
    );
    cleanupRender = rendered.cleanup;

    await openAndConfirmResetEveryone(rendered);
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Reset everyone complete",
      );
    });

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/ops/usage-reset", {
      body: JSON.stringify({
        afterMemberId: "hbm_reset_z",
        confirmation: HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
        operation: "reset_all_batch",
        operationId: RESET_ALL_OPERATION_ID,
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(readMetric(rendered.container, "Processed")).toBe("2");
  });

  test("rejects inconsistent reset-everyone outcome totals", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      counts: {
        failed: 0,
        pendingWake: 1,
        processed: 1,
        reset: 0,
        skipped: 1,
        unchanged: 0,
      },
      done: false,
      failure: null,
      lastAcknowledgedCursor: "hbm_reset_001",
    }));
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: makeDashboard() }),
    );
    cleanupRender = rendered.cleanup;

    await openAndConfirmResetEveryone(rendered);
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Reset everyone paused",
      );
    });

    expect(rendered.container.textContent).toContain(
      "Reset everyone returned an invalid response.",
    );
    expect(readMetric(rendered.container, "Processed")).toBe("0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
      resetMode: "included_usage",
      runtimeRecheckStatus: "accepted",
      updatedAt: "2026-07-22T18:00:00.000Z",
      usageCreditGrantedUsdMicros: "0",
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

  test("confirms and reports one fresh Starter allowance", async () => {
    const dashboard = makeDashboard();
    const row = dashboard.rows[0];
    if (!row?.currentPeriod) {
      throw new Error("Expected a usage fixture row.");
    }
    row.containerOwnerMemberId = null;
    row.memberKind = "member";
    row.participantCount = null;
    row.resetMode = "starter_allowance";
    row.currentPeriod.limitUsdMicros = "0";
    row.currentPeriod.spentUsdMicros = "0";
    fetchMock.mockResolvedValueOnce(jsonResponse({
      memberId: "hbm_container",
      noticeClaimReleased: true,
      outcome: "reset",
      periodStart: "2026-07-01T00:00:00.000Z",
      previousSpentUsdMicros: "0",
      resetAt: "2026-07-22T18:00:00.000Z",
      resetMode: "starter_allowance",
      runtimeRecheckStatus: "accepted",
      updatedAt: "2026-07-22T18:00:00.000Z",
      usageCreditGrantedUsdMicros: "4500000",
    }));
    const rendered = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard }),
    );
    cleanupRender = rendered.cleanup;

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Reset Starter"),
    );

    expect(rendered.container.textContent).toContain("Starter exhausted");
    expect(rendered.container.textContent).toContain("Reset Starter allowance?");
    expect(rendered.container.textContent).toContain(
      "one fresh $4.50 Starter allowance",
    );
    expect(rendered.container.textContent).toContain("Allowance added$4.50");

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Grant $4.50"),
    );

    expect(rendered.container.querySelector('[role="alert"]')?.textContent)
      .toContain("Starter allowance was reset to $4.50");
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(rendered.container.textContent).toContain("Committed · refreshing");
    expect(rendered.container.textContent).not.toContain("Starter exhausted");
    expect(rendered.container.textContent).not.toContain("Notice claimed");
    expect(rendered.container.textContent).not.toContain("Blocked");
    expect(() => getButton(rendered.container, "Reset Starter"))
      .toThrow("Button not found: Reset Starter");
    expect(getButton(rendered.container, "Refreshing").disabled).toBe(true);

    const refreshedDashboard = makeDashboard();
    const refreshedRow = refreshedDashboard.rows[0];
    if (!refreshedRow?.currentPeriod) {
      throw new Error("Expected a refreshed usage fixture row.");
    }
    refreshedDashboard.capturedAt = "2026-07-22T18:00:01.000Z";
    refreshedRow.containerOwnerMemberId = null;
    refreshedRow.memberKind = "member";
    refreshedRow.participantCount = null;
    refreshedRow.resetMode = null;
    refreshedRow.currentPeriod.blocked = false;
    refreshedRow.currentPeriod.idempotencyClaimStatus = null;
    refreshedRow.currentPeriod.limitUsdMicros = "0";
    refreshedRow.currentPeriod.remainingUsdMicros = "4500000";
    refreshedRow.currentPeriod.spentUsdMicros = "0";
    refreshedRow.currentPeriod.usageCreditBalanceUsdMicros = "4500000";
    refreshedRow.currentPeriod.usageCreditLedgerVersion = "5";

    await rendered.rerender(
      createElement(MemberUsageClient, { dashboard: refreshedDashboard }),
    );

    expect(rendered.container.textContent).not.toContain("Committed · refreshing");
    expect(rendered.container.textContent).toContain("Available");
    expect(rendered.container.textContent).toContain("$4.50");
    expect(getButton(rendered.container, "Reset").disabled).toBe(true);
  });

  test("preserves a pending Starter wake until canonical captures take over", async () => {
    const exhaustedDashboard = makeDashboard();
    const exhaustedRow = exhaustedDashboard.rows[0];
    if (!exhaustedRow?.currentPeriod) {
      throw new Error("Expected a usage fixture row.");
    }
    exhaustedRow.containerOwnerMemberId = null;
    exhaustedRow.memberKind = "member";
    exhaustedRow.participantCount = null;
    exhaustedRow.resetMode = "starter_allowance";
    exhaustedRow.currentPeriod.limitUsdMicros = "0";
    exhaustedRow.currentPeriod.spentUsdMicros = "0";
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        memberId: "hbm_container",
        noticeClaimReleased: true,
        outcome: "reset",
        periodStart: "2026-07-01T00:00:00.000Z",
        previousSpentUsdMicros: "0",
        resetAt: "2026-07-22T18:00:00.000Z",
        resetMode: "starter_allowance",
        runtimeRecheckStatus: "pending",
        updatedAt: "2026-07-22T18:00:00.000Z",
        usageCreditGrantedUsdMicros: "4500000",
      }, 202))
      .mockResolvedValueOnce(jsonResponse({
        memberId: "hbm_container",
        runtimeRecheckStatus: "accepted",
      }));
    const firstRender = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: exhaustedDashboard }),
    );

    await clickButton(
      firstRender.window,
      getButton(firstRender.container, "Reset Starter"),
    );
    await clickButton(
      firstRender.window,
      getButton(firstRender.container, "Grant $4.50"),
    );
    expect(firstRender.container.textContent).toContain(
      "Starter allowance was reset, but the runtime did not accept",
    );
    await clickButton(
      firstRender.window,
      getButton(firstRender.container, "Close"),
    );

    expect(firstRender.container.textContent).toContain(
      "Committed · Wake pending",
    );
    expect(firstRender.container.textContent).not.toContain("Starter exhausted");
    expect(firstRender.container.textContent).not.toContain("Notice claimed");
    expect(firstRender.container.textContent).not.toContain("Blocked");
    expect(() => getButton(firstRender.container, "Reset Starter"))
      .toThrow("Button not found: Reset Starter");
    expect(getButton(firstRender.container, "Recheck runtime").disabled)
      .toBe(false);

    // A delayed or failed refresh can rerender the old capture. The committed
    // result must still own this row and expose only the wake-safe action.
    await firstRender.rerender(
      createElement(MemberUsageClient, { dashboard: exhaustedDashboard }),
    );
    expect(firstRender.container.textContent).toContain(
      "Committed · Wake pending",
    );
    expect(getButton(firstRender.container, "Recheck runtime").disabled)
      .toBe(false);

    await firstRender.cleanup();

    const recoveredDashboard = makeDashboard();
    const recoveredRow = recoveredDashboard.rows[0];
    if (!recoveredRow?.currentPeriod) {
      throw new Error("Expected a recovered usage fixture row.");
    }
    recoveredRow.containerOwnerMemberId = null;
    recoveredRow.memberKind = "member";
    recoveredRow.participantCount = null;
    recoveredRow.resetMode = null;
    recoveredRow.runtimeRecheckAvailable = true;
    recoveredRow.currentPeriod.blocked = false;
    recoveredRow.currentPeriod.idempotencyClaimStatus = null;
    recoveredRow.currentPeriod.limitUsdMicros = "0";
    recoveredRow.currentPeriod.remainingUsdMicros = "4500000";
    recoveredRow.currentPeriod.spentUsdMicros = "0";
    recoveredRow.currentPeriod.usageCreditBalanceUsdMicros = "4500000";
    recoveredRow.currentPeriod.usageCreditLedgerVersion = "5";
    recoveredDashboard.capturedAt = "2026-07-22T18:00:01.000Z";
    const recoveredRender = await renderClientComponent(
      createElement(MemberUsageClient, { dashboard: recoveredDashboard }),
    );
    cleanupRender = recoveredRender.cleanup;

    expect(recoveredRender.container.textContent).toContain("Wake pending");
    await clickButton(
      recoveredRender.window,
      getButton(recoveredRender.container, "Recheck runtime"),
    );
    expect(recoveredRender.container.textContent).toContain(
      "The allowance reset is already committed.",
    );
    await clickButton(
      recoveredRender.window,
      getButton(recoveredRender.container, "Retry runtime wake"),
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recoveredRender.container.querySelector('[role="alert"]')?.textContent)
      .toContain("runtime recheck was accepted");
    expect(() => getButton(recoveredRender.container, "Recheck runtime"))
      .toThrow("Button not found: Recheck runtime");

    const stillPendingDashboard = structuredClone(recoveredDashboard);
    stillPendingDashboard.capturedAt = "2026-07-22T18:00:02.000Z";
    await recoveredRender.rerender(
      createElement(MemberUsageClient, { dashboard: stillPendingDashboard }),
    );
    expect(recoveredRender.container.textContent).toContain("Wake pending");
    expect(getButton(recoveredRender.container, "Recheck runtime").disabled)
      .toBe(false);

    const consumedDashboard = structuredClone(stillPendingDashboard);
    consumedDashboard.capturedAt = "2026-07-22T18:00:03.000Z";
    const consumedRow = consumedDashboard.rows[0];
    if (!consumedRow) {
      throw new Error("Expected a consumed recovery fixture row.");
    }
    consumedRow.runtimeRecheckAvailable = false;
    await recoveredRender.rerender(
      createElement(MemberUsageClient, { dashboard: consumedDashboard }),
    );
    expect(recoveredRender.container.textContent).not.toContain("Wake pending");
    expect(() => getButton(recoveredRender.container, "Recheck runtime"))
      .toThrow("Button not found: Recheck runtime");
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
        resetMode: "included_usage",
        runtimeRecheckStatus: "pending",
        updatedAt: "2026-07-22T18:00:00.000Z",
        usageCreditGrantedUsdMicros: "0",
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
    expect(rendered.container.textContent).toContain("Committed · refreshing");
    expect(rendered.container.textContent).not.toContain("Blocked");
    expect(rendered.container.textContent).not.toContain("Notice claimed");
    expect(getButton(rendered.container, "Refreshing").disabled).toBe(true);
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
      resetMode: "included_usage",
      runtimeRecheckAvailable: false,
      suspended: false,
    }],
    search: {
      cap: 100,
      capped: false,
      error: null,
      query: null,
      resultCount: 1,
    },
    summary: {
      activeEntitiesLast7Days: 1,
      groupContainers: 1,
      members: 0,
      totalAllTimeUsageUsdMicros: "7250000",
    },
  };
}

async function openAndConfirmResetEveryone(rendered: {
  container: HTMLElement;
  window: Window & typeof globalThis;
}): Promise<void> {
  await clickButton(
    rendered.window,
    getButton(rendered.container, "Reset everyone"),
  );
  await setInputValue(
    rendered.window,
    getInput(rendered.container, "ops-usage-reset-all-confirmation"),
    HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
  );
  await clickButton(
    rendered.window,
    getButtonByAriaLabel(rendered.container, "Confirm reset everyone"),
  );
}

function getInput(container: HTMLElement, id: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) {
    throw new Error(`Input not found: ${id}`);
  }
  return input;
}

function getButtonByAriaLabel(
  container: HTMLElement,
  label: string,
): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!button) {
    throw new Error(`Button not found by aria-label: ${label}`);
  }
  return button;
}

function readMetric(container: HTMLElement, label: string): string | null {
  const term = [...container.querySelectorAll("dt")]
    .find((candidate) => candidate.textContent?.trim() === label);
  return term?.parentElement?.querySelector("dd")?.textContent?.trim() ?? null;
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
    await Promise.resolve();
  });
}

async function setInputValue(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    );
    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

async function submitForm(
  window: Window & typeof globalThis,
  form: HTMLFormElement | null,
): Promise<void> {
  if (!form) {
    throw new Error("Form not found.");
  }
  await act(async () => {
    form.dispatchEvent(new window.Event("submit", {
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
