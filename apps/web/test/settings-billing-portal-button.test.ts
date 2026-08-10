import { act, createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: (props: { children?: ReactNode; open?: boolean }) =>
    props.open ? createElement("div", null, props.children) : null,
  DialogContent: (props: { children?: ReactNode }) =>
    createElement("div", { "data-slot": "dialog-content" }, props.children),
  DialogDescription: (props: { children?: ReactNode }) =>
    createElement("p", null, props.children),
  DialogHeader: (props: { children?: ReactNode }) =>
    createElement("div", null, props.children),
  DialogTitle: (props: { children?: ReactNode }) =>
    createElement("h2", null, props.children),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("keeps a failed confirmed portal action visible inside the open dialog", async () => {
  const { BillingPortalButton } = await import(
    "@/src/components/settings/billing-portal-button"
  );
  mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
    new Error("Stripe is temporarily unavailable."),
  );
  const rendered = await renderClientComponent(createElement(BillingPortalButton, {
    confirmation: {
      confirmLabel: "Open Stripe",
      description: "Review billing in Stripe.",
      title: "Manage billing?",
    },
  }));

  await act(async () => {
    rendered.button.click();
  });
  const dialog = rendered.container.querySelector('[data-slot="dialog-content"]');
  expect(dialog).toBeTruthy();
  const confirmButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
    (button) => button.textContent === "Open Stripe",
  );

  await act(async () => {
    confirmButton?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  const alerts = rendered.container.querySelectorAll('[role="alert"]');
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.textContent).toContain(
    "Stripe is temporarily unavailable.",
  );
  expect(alerts[0]?.closest('[data-slot="dialog-content"]')).toBe(dialog);

  await rendered.cleanup();
});
