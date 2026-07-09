import assert from "node:assert/strict";

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedPulseTrialExtensionSummary } from "@/src/lib/hosted-ops/pulse-trial-extension";

import { renderClientComponent } from "./render-client-component";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getHostedDashboardPageAuthSnapshot: vi.fn(),
  requireActiveHostedAppSession: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSession: mocks.requireActiveHostedAppSession,
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedDashboardPageAuthSnapshot: mocks.getHostedDashboardPageAuthSnapshot,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  }),
}));

vi.mock("@/src/components/ui/dialog", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const DialogContext = React.createContext<{ open: boolean }>({ open: false });
  const passthrough = (tag: keyof HTMLElementTagNameMap) =>
    function Passthrough(props: { children?: React.ReactNode; className?: string }) {
      return React.createElement(tag, { className: props.className }, props.children);
    };

  return {
    Dialog(props: {
      children?: React.ReactNode;
      onOpenChange?: (open: boolean) => void;
      open?: boolean;
    }) {
      return React.createElement(
        DialogContext.Provider,
        { value: { open: props.open === true } },
        props.children,
      );
    },
    DialogContent(props: { children?: React.ReactNode; className?: string }) {
      const context = React.useContext(DialogContext);
      return context.open
        ? React.createElement("div", { role: "dialog" }, props.children)
        : null;
    },
    DialogDescription: passthrough("p"),
    DialogFooter: passthrough("div"),
    DialogHeader: passthrough("div"),
    DialogTitle: passthrough("h2"),
  };
});

type OpsIndexPageModule = typeof import("../app/(dashboard)/ops/page");
type PulseTrialExtensionPageModule =
  typeof import("../app/(dashboard)/ops/pulse-trial-extension/page");
type PulseTrialExtensionClientModule =
  typeof import("../app/(dashboard)/ops/pulse-trial-extension/pulse-trial-extension-client");

let opsIndexPage: OpsIndexPageModule;
let extensionPage: PulseTrialExtensionPageModule;
let extensionClient: PulseTrialExtensionClientModule;

const originalHostedOpsMemberIds = process.env.HOSTED_OPS_MEMBER_IDS;
const fetchMock = vi.fn();

describe("hosted Ops Pulse Trial extension page", () => {
  beforeAll(async () => {
    opsIndexPage = await import("../app/(dashboard)/ops/page");
    extensionPage = await import("../app/(dashboard)/ops/pulse-trial-extension/page");
    extensionClient = await import(
      "../app/(dashboard)/ops/pulse-trial-extension/pulse-trial-extension-client"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_OPS_MEMBER_IDS = "member_ops";
    mocks.getHostedDashboardPageAuthSnapshot.mockResolvedValue({
      member: { id: "member_ops" },
    });
    mocks.requireActiveHostedAppSession.mockResolvedValue({
      member: { id: "member_ops" },
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalHostedOpsMemberIds === undefined) {
      delete process.env.HOSTED_OPS_MEMBER_IDS;
    } else {
      process.env.HOSTED_OPS_MEMBER_IDS = originalHostedOpsMemberIds;
    }
  });

  it("fails closed when page ops access is missing", async () => {
    delete process.env.HOSTED_OPS_MEMBER_IDS;

    await expect(extensionPage.default()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders preview-first copy with apply locked and no identifier inputs", async () => {
    const markup = renderToStaticMarkup(await extensionPage.default());

    assert.match(markup, /Pulse Trial extension/);
    assert.match(markup, /Preview extension/);
    assert.match(markup, /Apply seven-day extension/);
    assert.doesNotMatch(markup, /<input/);

    const rendered = await renderClientComponent(
      createElement(extensionClient.PulseTrialExtensionClient),
    );
    const applyButton = findButtonByText(
      rendered.window.document,
      "Apply seven-day extension",
      rendered.window,
    );
    assert.equal(applyButton.hasAttribute("disabled"), true);
    await rendered.cleanup();
  });

  it("links the extension tool from the Ops index", async () => {
    const markup = renderToStaticMarkup(await opsIndexPage.default());

    assert.match(markup, /href="\/ops\/pulse-trial-extension"/);
    assert.match(markup, /Pulse Trial extension/);
    assert.match(markup, /one-time seven-day Pulse Trial beta extension/);
    assert.match(markup, /growth, billing, and runtime maintenance/);
  });

  it("previews with dry-run, shows counts, and unlocks apply behind the Stripe confirmation", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makeSummary({ wouldExtend: 3, wouldReconcile: 1 })))
      .mockResolvedValueOnce(jsonResponse(makeSummary({
        alreadyExtended: 0,
        localWindowsReconciled: 4,
        mode: "apply",
        skipped: NO_SKIPS,
        stripeTrialsExtended: 3,
        wouldExtend: 0,
        wouldReconcile: 0,
      })));

    const rendered = await renderClientComponent(
      createElement(extensionClient.PulseTrialExtensionClient),
    );
    const clickButton = async (text: string) => {
      const button = findButtonByText(rendered.window.document, text, rendered.window);
      await act(async () => {
        button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      });
    };

    await clickButton("Preview extension");

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(fetchMock.mock.calls[0]?.[0], "/api/ops/pulse-trial-extension");
    assert.deepEqual(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string), {
      mode: "dry-run",
    });

    const bodyText = () => rendered.window.document.body.textContent ?? "";
    assert.match(bodyText(), /Preview/);
    assert.match(bodyText(), /Candidates/);
    assert.match(bodyText(), /Would extend/);
    assert.match(bodyText(), /Would reconcile/);
    assert.match(bodyText(), /Already extended/);
    assert.match(bodyText(), /Skipped/);
    assert.match(bodyText(), /Failures/);
    assert.match(bodyText(), /Stripe extended/);
    assert.match(bodyText(), /Local windows reconciled/);

    assert.match(bodyText(), /Skip reasons/);
    assert.match(bodyText(), /Missing Stripe references/);
    assert.match(bodyText(), /Stripe subscription not trialing/);
    assert.doesNotMatch(bodyText(), /Stripe customer mismatch/);
    assert.doesNotMatch(bodyText(), /Failure reasons/);

    const applyButton = findButtonByText(
      rendered.window.document,
      "Apply seven-day extension",
      rendered.window,
    );
    assert.equal(applyButton.hasAttribute("disabled"), false);

    await clickButton("Apply seven-day extension");
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.match(bodyText(), /Apply seven-day extension\?/);
    assert.match(bodyText(), /updates Stripe trials and the matching local trial windows/);
    assert.match(bodyText(), /Original trial start dates and recorded usage are preserved/);
    assert.match(bodyText(), /campaign is one-time, so it is safe to retry/);

    await clickButton("Apply extension");

    assert.equal(fetchMock.mock.calls.length, 2);
    assert.deepEqual(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string), {
      mode: "apply",
    });
    assert.match(bodyText(), /Extension applied without failures or skips/);
    assert.match(bodyText(), /Apply result/);
    assert.doesNotMatch(bodyText(), /Apply finished with failures/);
    assert.doesNotMatch(bodyText(), /Applied, with skips to review/);
    const applyButtonAfter = findButtonByText(
      rendered.window.document,
      "Apply seven-day extension",
      rendered.window,
    );
    assert.equal(applyButtonAfter.hasAttribute("disabled"), true);

    await rendered.cleanup();
  });

  it("reports an apply with failures as failed and lists failure reason counts", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makeSummary({ wouldExtend: 3, wouldReconcile: 1 })))
      .mockResolvedValueOnce(jsonResponse(makeSummary({
        failures: {
          db_update_failed: 1,
          stripe_retrieve_failed: 0,
          stripe_update_failed: 2,
          stripe_update_result_invalid: 0,
        },
        localWindowsReconciled: 1,
        mode: "apply",
        stripeTrialsExtended: 1,
        wouldExtend: 0,
        wouldReconcile: 0,
      })));

    const rendered = await renderClientComponent(
      createElement(extensionClient.PulseTrialExtensionClient),
    );
    const clickButton = async (text: string) => {
      const button = findButtonByText(rendered.window.document, text, rendered.window);
      await act(async () => {
        button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      });
    };

    await clickButton("Preview extension");
    await clickButton("Apply seven-day extension");
    await clickButton("Apply extension");

    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Apply finished with failures/);
    assert.match(bodyText, /candidates were not fully applied or reconciled/);
    assert.match(bodyText, /preview again before reapplying/);
    assert.match(bodyText, /Reapplying is safe/);
    assert.match(bodyText, /Apply result/);
    assert.doesNotMatch(bodyText, /Extension applied/);
    assert.doesNotMatch(bodyText, /Applied, with skips to review/);

    assert.match(bodyText, /Failure reasons/);
    assert.match(bodyText, /Stripe update failed/);
    assert.match(bodyText, /Database update failed/);
    assert.doesNotMatch(bodyText, /Stripe retrieve failed/);

    await rendered.cleanup();
  });

  it("reports an apply with skips but no failures as needing review", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makeSummary({ wouldExtend: 3, wouldReconcile: 1 })))
      .mockResolvedValueOnce(jsonResponse(makeSummary({
        localWindowsReconciled: 1,
        mode: "apply",
        stripeTrialsExtended: 3,
        wouldExtend: 0,
        wouldReconcile: 0,
      })));

    const rendered = await renderClientComponent(
      createElement(extensionClient.PulseTrialExtensionClient),
    );
    const clickButton = async (text: string) => {
      const button = findButtonByText(rendered.window.document, text, rendered.window);
      await act(async () => {
        button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      });
    };

    await clickButton("Preview extension");
    await clickButton("Apply seven-day extension");
    await clickButton("Apply extension");

    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Applied, with skips to review/);
    assert.match(bodyText, /candidates were skipped and left unchanged/);
    assert.match(bodyText, /preview again before reapplying/);
    assert.doesNotMatch(bodyText, /Extension applied without failures or skips/);
    assert.doesNotMatch(bodyText, /Apply finished with failures/);

    await rendered.cleanup();
  });

  it("keeps apply locked after a preview that finds nothing to extend or reconcile", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(makeSummary({ wouldExtend: 0, wouldReconcile: 0 })),
    );

    const rendered = await renderClientComponent(
      createElement(extensionClient.PulseTrialExtensionClient),
    );
    const previewButton = findButtonByText(
      rendered.window.document,
      "Preview extension",
      rendered.window,
    );
    await act(async () => {
      previewButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    const applyButton = findButtonByText(
      rendered.window.document,
      "Apply seven-day extension",
      rendered.window,
    );
    assert.equal(applyButton.hasAttribute("disabled"), true);

    await rendered.cleanup();
  });

  it("invalidates the stale preview when a later preview fails, keeping apply locked", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makeSummary({ wouldExtend: 3, wouldReconcile: 1 })))
      .mockResolvedValueOnce(jsonResponse(
        { error: { message: "Stripe unavailable." } },
        502,
      ));

    const rendered = await renderClientComponent(
      createElement(extensionClient.PulseTrialExtensionClient),
    );
    const clickPreview = async () => {
      const button = findButtonByText(
        rendered.window.document,
        "Preview extension",
        rendered.window,
      );
      await act(async () => {
        button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      });
    };
    const applyButton = () => findButtonByText(
      rendered.window.document,
      "Apply seven-day extension",
      rendered.window,
    );

    await clickPreview();
    assert.equal(applyButton().hasAttribute("disabled"), false);

    await clickPreview();
    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Request failed/);
    assert.match(bodyText, /Stripe unavailable\./);
    assert.doesNotMatch(bodyText, /Extension counts/);
    assert.equal(applyButton().hasAttribute("disabled"), true);

    await rendered.cleanup();
  });

  it("warns that the outcome may be partial when the apply request fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makeSummary({ wouldExtend: 3, wouldReconcile: 1 })))
      .mockResolvedValueOnce(jsonResponse(
        { error: { message: "Stripe unavailable." } },
        502,
      ));

    const rendered = await renderClientComponent(
      createElement(extensionClient.PulseTrialExtensionClient),
    );
    const clickButton = async (text: string) => {
      const button = findButtonByText(rendered.window.document, text, rendered.window);
      await act(async () => {
        button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      });
    };

    await clickButton("Preview extension");
    await clickButton("Apply seven-day extension");
    await clickButton("Apply extension");

    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Apply request failed/);
    assert.match(bodyText, /Stripe unavailable\./);
    assert.match(bodyText, /outcome may be partial/);
    assert.match(bodyText, /Preview again to reconcile/);
    assert.match(bodyText, /Reapplying is safe/);
    assert.doesNotMatch(bodyText, /Extension counts/);

    const applyButton = findButtonByText(
      rendered.window.document,
      "Apply seven-day extension",
      rendered.window,
    );
    assert.equal(applyButton.hasAttribute("disabled"), true);

    await rendered.cleanup();
  });

  it("announces preview completion with counts in the polite status region", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(makeSummary({ wouldExtend: 3, wouldReconcile: 1 })),
    );

    const rendered = await renderClientComponent(
      createElement(extensionClient.PulseTrialExtensionClient),
    );
    const statusRegion = () => {
      const region = rendered.window.document.querySelector('[aria-live="polite"]');
      assert.ok(region);
      return region;
    };
    assert.equal(statusRegion().textContent?.trim(), "");

    const previewButton = findButtonByText(
      rendered.window.document,
      "Preview extension",
      rendered.window,
    );
    await act(async () => {
      previewButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(
      statusRegion().textContent,
      "Preview complete: 3 would extend, 1 would reconcile.",
    );

    await rendered.cleanup();
  });

  it("surfaces the API error message when a run fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(
      { error: { message: "Pulse Trial extension mode must be dry-run or apply." } },
      400,
    ));

    const rendered = await renderClientComponent(
      createElement(extensionClient.PulseTrialExtensionClient),
    );
    const previewButton = findButtonByText(
      rendered.window.document,
      "Preview extension",
      rendered.window,
    );
    await act(async () => {
      previewButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Request failed/);
    assert.match(bodyText, /Pulse Trial extension mode must be dry-run or apply\./);

    await rendered.cleanup();
  });
});

function findButtonByText(
  document: Document,
  text: string,
  window: Window & typeof globalThis,
): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.includes(text));
  assert.ok(button instanceof window.HTMLButtonElement);
  return button;
}

function jsonResponse(payload: unknown, status = 200): {
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
} {
  return {
    json: () => Promise.resolve(payload),
    ok: status >= 200 && status < 300,
    status,
  };
}

const NO_SKIPS: HostedPulseTrialExtensionSummary["skipped"] = {
  local_trial_window_invalid: 0,
  local_usage_period_missing: 0,
  missing_stripe_refs: 0,
  stripe_billing_plan_mismatch: 0,
  stripe_campaign_marker_conflict: 0,
  stripe_checkout_offer_mismatch: 0,
  stripe_customer_mismatch: 0,
  stripe_subscription_id_mismatch: 0,
  stripe_subscription_not_trialing: 0,
  stripe_trial_end_invalid: 0,
};

function makeSummary(
  overrides: Partial<HostedPulseTrialExtensionSummary> = {},
): HostedPulseTrialExtensionSummary {
  return {
    alreadyExtended: 2,
    campaign: "pulse-beta-extension-2026-07",
    candidates: 8,
    extensionDays: 7,
    failures: {
      db_update_failed: 0,
      stripe_retrieve_failed: 0,
      stripe_update_failed: 0,
      stripe_update_result_invalid: 0,
    },
    localWindowsReconciled: 0,
    mode: "dry-run",
    skipped: {
      local_trial_window_invalid: 0,
      local_usage_period_missing: 0,
      missing_stripe_refs: 1,
      stripe_billing_plan_mismatch: 0,
      stripe_campaign_marker_conflict: 0,
      stripe_checkout_offer_mismatch: 0,
      stripe_customer_mismatch: 0,
      stripe_subscription_id_mismatch: 0,
      stripe_subscription_not_trialing: 1,
      stripe_trial_end_invalid: 0,
    },
    stripeTrialsExtended: 0,
    wouldExtend: 3,
    wouldReconcile: 1,
    ...overrides,
  };
}
