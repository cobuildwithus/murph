import { act, createElement, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
  Button: ({ variant, ...props }: ComponentProps<"button"> & {
    variant?: string;
  }) => {
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

import {
  LegacyTrialRetirementControl,
} from "@/src/components/hosted-ops/legacy-trial-retirement-control";
import type {
  HostedLegacyPulseTrialRetirementReport,
} from "@/src/lib/hosted-onboarding/legacy-pulse-trial-retirement";
import { renderClientComponent } from "./render-client-component";

const fetchMock = vi.fn<typeof fetch>();
let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  vi.unstubAllGlobals();
});

describe("LegacyTrialRetirementControl", () => {
  test("shows aggregate dry-run state and gates apply behind exact confirmation", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      operation: "dry-run",
      report: buildReport({ candidateCount: 2 }),
    }));
    const rendered = await renderClientComponent(
      createElement(LegacyTrialRetirementControl),
    );
    cleanupRender = rendered.cleanup;

    expect(rendered.container.textContent).toContain(
      "No provider or database changes occur",
    );
    await clickButton(
      rendered.window,
      getButton(rendered.container, "Run dry-run"),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ops/legacy-trial-retirement",
      {
        body: JSON.stringify({ operation: "dry-run" }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(rendered.container.textContent).toContain("2 candidates");
    expect(rendered.container.textContent).toContain("trialing: 2");
    expect(rendered.container.textContent).toContain(
      "Aggregate counts only, no member identities",
    );

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Retire 2"),
    );
    expect(rendered.container.textContent).toContain("Exact candidate count");
    expect(rendered.container.textContent).toContain("Paid or ambiguous state");
  });

  test("submits the displayed count and renders the automatic zero verification", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      converged: true,
      operation: "apply",
      report: buildReport({
        candidateCount: 2,
        mode: "apply",
        retiredCount: 2,
      }),
      verification: buildReport({ candidateCount: 0 }),
    }));
    const rendered = await renderClientComponent(
      createElement(LegacyTrialRetirementControl, {
        initialReport: buildReport({ candidateCount: 2 }),
      }),
    );
    cleanupRender = rendered.cleanup;

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Retire 2"),
    );
    await clickButton(
      rendered.window,
      getButton(rendered.container, "Apply and verify zero"),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ops/legacy-trial-retirement",
      {
        body: JSON.stringify({
          expectedCandidates: 2,
          operation: "apply",
        }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(rendered.container.textContent).toContain("0 candidates");
    expect(rendered.container.querySelector('[role="alert"]')?.textContent)
      .toContain("automatic verification found zero remaining candidates");
    expect([...rendered.container.querySelectorAll("button")]
      .some((button) => button.textContent?.trim() === "Retire 2"))
      .toBe(false);
  });

  test("discards a stale report after an uncertain apply failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        message: "Provider confirmation was interrupted. Run a fresh dry-run.",
      },
    }, 503));
    const rendered = await renderClientComponent(
      createElement(LegacyTrialRetirementControl, {
        initialReport: buildReport({ candidateCount: 1 }),
      }),
    );
    cleanupRender = rendered.cleanup;

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Retire 1"),
    );
    await clickButton(
      rendered.window,
      getButton(rendered.container, "Apply and verify zero"),
    );

    expect(rendered.container.querySelector('[role="alert"]')?.textContent)
      .toContain("Run a fresh dry-run");
    expect(rendered.container.textContent).toContain(
      "No provider or database changes occur",
    );
    expect([...rendered.container.querySelectorAll("button")]
      .some((button) => button.textContent?.trim() === "Retire 1"))
      .toBe(false);
  });

  test("keeps a new guarded action when automatic verification is non-zero", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      converged: false,
      operation: "apply",
      report: buildReport({
        candidateCount: 2,
        mode: "apply",
        retiredCount: 1,
      }),
      verification: buildReport({ candidateCount: 1 }),
    }));
    const rendered = await renderClientComponent(
      createElement(LegacyTrialRetirementControl, {
        initialReport: buildReport({ candidateCount: 2 }),
      }),
    );
    cleanupRender = rendered.cleanup;

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Retire 2"),
    );
    await clickButton(
      rendered.window,
      getButton(rendered.container, "Apply and verify zero"),
    );

    expect(rendered.container.querySelector('[role="alert"]')?.textContent)
      .toContain("verification found 1 remaining candidate");
    expect(getButton(rendered.container, "Retire 1")).toBeTruthy();
  });

  test("removes the apply action when a fresh dry-run cannot complete", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        message: "Stripe could not be checked.",
      },
    }, 503));
    const rendered = await renderClientComponent(
      createElement(LegacyTrialRetirementControl, {
        initialReport: buildReport({ candidateCount: 1 }),
      }),
    );
    cleanupRender = rendered.cleanup;

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Run dry-run"),
    );

    expect(rendered.container.querySelector('[role="alert"]')?.textContent)
      .toContain("Stripe could not be checked");
    expect(rendered.container.textContent).toContain(
      "No provider or database changes occur",
    );
    expect([...rendered.container.querySelectorAll("button")]
      .some((button) => button.textContent?.trim() === "Retire 1"))
      .toBe(false);
  });
});

function buildReport(input: {
  candidateCount: number;
  mode?: "apply" | "dry-run";
  retiredCount?: number;
}): HostedLegacyPulseTrialRetirementReport {
  const subscriptionStatusCounts: Record<string, number> =
    input.candidateCount === 0
      ? {}
      : { trialing: input.candidateCount };
  return {
    alreadyRetiredCount: 0,
    candidateCount: input.candidateCount,
    missingProviderCount: 0,
    mode: input.mode ?? "dry-run" as const,
    retiredCount: input.retiredCount ?? 0,
    stripeMode: "live" as const,
    subscriptionStatusCounts,
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
