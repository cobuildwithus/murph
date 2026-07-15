import { act, createElement, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("lucide-react", () => ({
  CalendarPlusIcon: () => createElement("svg"),
  SearchIcon: () => createElement("svg"),
}));

vi.mock("@/src/components/ui/alert", () => ({
  Alert: ({ variant, ...props }: ComponentProps<"div"> & { variant?: string }) => {
    void variant;
    return createElement("div", { role: "alert", ...props });
  },
  AlertDescription: (props: ComponentProps<"div">) => createElement("div", props),
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

vi.mock("@/src/components/ui/input", () => ({
  Input: ({ onChange, ...props }: ComponentProps<"input">) =>
    createElement("input", { ...props, onInput: onChange }),
}));

vi.mock("@/src/components/ui/label", () => ({
  Label: (props: ComponentProps<"label">) => createElement("label", props),
}));

vi.mock("@/src/components/ui/table", () => ({
  Table: (props: ComponentProps<"table">) => createElement("table", props),
  TableBody: (props: ComponentProps<"tbody">) => createElement("tbody", props),
  TableCell: (props: ComponentProps<"td">) => createElement("td", props),
  TableHead: (props: ComponentProps<"th">) => createElement("th", props),
  TableHeader: (props: ComponentProps<"thead">) => createElement("thead", props),
  TableRow: (props: ComponentProps<"tr">) => createElement("tr", props),
}));

import { TrialExtensionClient } from "../app/(dashboard)/ops/trials/trial-extension-client";
import type {
  HostedPulseTrialExtensionResult,
} from "../src/lib/hosted-ops/pulse-trial-extension";
import { renderClientComponent } from "./render-client-component";

const fetchMock = vi.fn<typeof fetch>();
const MEMBER_ID = "hbm_target_1";
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

describe("TrialExtensionClient", () => {
  test("shows one member workflow and no campaign controls", async () => {
    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;

    expect(rendered.container.textContent).toContain("Extend one member");
    expect(rendered.container.textContent).toContain("Paid billing is never changed");
    expect(rendered.container.textContent).not.toContain("Fixed campaign cohort");
    expect(rendered.container.textContent).not.toContain("Batch 1");
    expect(rendered.container.querySelectorAll("table")).toHaveLength(1);
    expect(rendered.container.querySelectorAll("input")).toHaveLength(1);
  });

  test("previews the entered member and applies the same proof from its row", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makeResult()))
      .mockResolvedValueOnce(jsonResponse(makeResult({
        currentTrialEndsAt: "2026-07-21T16:00:00.000Z",
        localBillingPhase: "trial",
        localBillingStatus: "active",
        message: "The member's Pulse Trial now ends seven days later.",
        outcome: "extended",
        previewProof: null,
        providerStatus: "trialing",
      })));
    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const input = rendered.container.querySelector("input");
    if (!input) {
      throw new Error("Member input was not rendered.");
    }

    await changeInput(rendered.window, input, `  ${MEMBER_ID}  `);
    await clickButton(rendered.window, getButton(rendered.container, "Preview"));

    expect(readRequestBody(0)).toEqual({
      memberId: MEMBER_ID,
      mode: "preview",
    });
    expect(rendered.container.textContent).toContain("Ready");
    expect(rendered.container.textContent).toContain("paused");

    await clickButton(
      rendered.window,
      getButton(rendered.container, "Apply +7 days"),
    );

    expect(readRequestBody(1)).toEqual({
      memberId: MEMBER_ID,
      mode: "apply",
      previewProof: makeResult().previewProof,
    });
    expect(rendered.container.textContent).toContain("Extended");
    expect(rendered.container.textContent).toContain("active · trial");
    expect(rendered.container.textContent).not.toContain("Apply +7 days");
  });

  test("shows an ineligible paid member without an Apply action", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(makeResult({
      currentTrialEndsAt: null,
      eligibilityCode: "paid_billing",
      eligible: false,
      localBillingPhase: "paid",
      localBillingStatus: "active",
      message: "This member has paid billing, so the subscription was left unchanged.",
      previewProof: null,
      providerStatus: null,
      targetTrialEndsAt: null,
    })));
    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const input = rendered.container.querySelector("input");
    if (!input) {
      throw new Error("Member input was not rendered.");
    }

    await changeInput(rendered.window, input, MEMBER_ID);
    await clickButton(rendered.window, getButton(rendered.container, "Preview"));

    expect(rendered.container.textContent).toContain("No change");
    expect(rendered.container.textContent).toContain("paid billing");
    expect(rendered.container.textContent).toContain("Not checked");
    expect(rendered.container.textContent).not.toContain("Not found");
    expect(rendered.container.textContent).not.toContain("Apply +7 days");
  });

  test("locks the member input and announces progress while Preview is pending", async () => {
    const preview = createDeferred<Response>();
    fetchMock.mockReturnValueOnce(preview.promise);
    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const input = rendered.container.querySelector("input");
    if (!input) {
      throw new Error("Member input was not rendered.");
    }

    await changeInput(rendered.window, input, MEMBER_ID);
    await clickButtonWithoutWaiting(
      rendered.window,
      getButton(rendered.container, "Preview"),
    );

    expect(input.disabled).toBe(true);
    expect(
      rendered.container.querySelector("section")?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(rendered.container.textContent).toContain("Checking member trial...");

    await act(async () => {
      preview.resolve(jsonResponse(makeResult()));
      await preview.promise;
    });

    expect(input.disabled).toBe(false);
    expect(rendered.container.textContent).toContain("Preview complete.");
    expect(rendered.container.textContent).toContain("Apply +7 days");
  });

  test("clears a preview when the member ID changes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(makeResult()));
    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const input = rendered.container.querySelector("input");
    if (!input) {
      throw new Error("Member input was not rendered.");
    }

    await changeInput(rendered.window, input, MEMBER_ID);
    await clickButton(rendered.window, getButton(rendered.container, "Preview"));
    expect(rendered.container.textContent).toContain("Apply +7 days");

    await changeInput(rendered.window, input, "hbm_another");
    expect(rendered.container.textContent).not.toContain("Apply +7 days");
    expect(rendered.container.textContent).toContain(
      "Enter a member ID to preview the trial",
    );
  });

  test("shows a route error and removes stale preview state", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makeResult()))
      .mockResolvedValueOnce(jsonResponse({
        error: { message: "Billing changed since Preview. Preview this member again." },
      }, 409));
    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const input = rendered.container.querySelector("input");
    if (!input) {
      throw new Error("Member input was not rendered.");
    }

    await changeInput(rendered.window, input, MEMBER_ID);
    await clickButton(rendered.window, getButton(rendered.container, "Preview"));
    await clickButton(
      rendered.window,
      getButton(rendered.container, "Apply +7 days"),
    );

    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain(
      "Billing changed since Preview",
    );
    expect(rendered.container.textContent).not.toContain("Apply +7 days");
  });
});

function makeResult(
  overrides: Partial<HostedPulseTrialExtensionResult> = {},
): HostedPulseTrialExtensionResult {
  return {
    currentTrialEndsAt: "2026-07-12T16:00:00.000Z",
    eligibilityCode: "eligible",
    eligible: true,
    extensionDays: 7,
    localBillingPhase: null,
    localBillingStatus: "paused",
    memberId: MEMBER_ID,
    message: "This lapsed Pulse Trial can be restored for seven days.",
    outcome: "preview",
    previewProof: {
      previewedAt: "2026-07-14T16:00:00.000Z",
      targetTrialEndsAt: "2026-07-21T16:00:00.000Z",
      token: `pulse-member-preview-v1.v1.${"a".repeat(43)}`,
    },
    providerStatus: "paused",
    targetTrialEndsAt: "2026-07-21T16:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function readRequestBody(index: number): unknown {
  const init = fetchMock.mock.calls[index]?.[1];
  if (!init || typeof init.body !== "string") {
    throw new Error("Expected a JSON request body.");
  }
  return JSON.parse(init.body) as unknown;
}

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}

async function clickButton(
  window: Window & typeof globalThis,
  button: HTMLButtonElement,
): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function clickButtonWithoutWaiting(
  window: Window & typeof globalThis,
  button: HTMLButtonElement,
): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (!resolve) {
    throw new Error("Deferred promise was not initialized.");
  }
  return { promise, resolve };
}

async function changeInput(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}
