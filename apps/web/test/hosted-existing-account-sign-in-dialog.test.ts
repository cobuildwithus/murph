import { act, createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { HostedExistingAccountSignInDialog } from "@/src/components/hosted-onboarding/hosted-existing-account-sign-in-dialog";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  hostedAuthPanel: vi.fn(),
}));

vi.mock("@/src/components/ui/dialog", async () => {
  const React = await import("react");
  const DialogOpenContext = React.createContext(false);

  return {
    Dialog({
      children,
      open,
    }: {
      children: ReactNode;
      onOpenChange?: (open: boolean) => void;
      open: boolean;
    }) {
      return createElement(DialogOpenContext.Provider, { value: open }, children);
    },
    DialogContent({
      children,
      className,
    }: {
      children: ReactNode;
      className?: string;
    }) {
      const open = React.useContext(DialogOpenContext);
      if (!open) {
        return null;
      }

      return createElement("div", { className }, children);
    },
    DialogDescription(props: React.ComponentProps<"p">) {
      return createElement("p", props);
    },
    DialogHeader(props: React.ComponentProps<"div">) {
      return createElement("div", props);
    },
    DialogTitle(props: React.ComponentProps<"h2">) {
      return createElement("h2", props);
    },
  };
});

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel", () => ({
  HostedAuthPanel(input: { intent?: string; methods?: readonly string[] }) {
    mocks.hostedAuthPanel(input);

    return createElement(
      "div",
      {
        "data-hosted-auth-panel-intent": input.intent ?? "signup",
        "data-hosted-auth-panel-methods": (input.methods ?? []).join(","),
      },
      "Hosted auth panel",
    );
  },
}));

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("HostedExistingAccountSignInDialog opens the shared sign-in panel with phone, Telegram, and email methods", async () => {
  const { button, cleanup, container } = await renderClientComponent(
    createElement(HostedExistingAccountSignInDialog),
  );
  cleanupRender = cleanup;

  expect(container.textContent).toContain("Already murph'n? Sign in.");
  expect(container.textContent).not.toContain("Hosted auth panel");

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.textContent).toContain("Sign in to Murph");
  expect(container.textContent).toContain(
    "Use your previously linked phone number, email address, or Telegram account to sign in.",
  );
  expect(container.querySelector('[data-hosted-auth-panel-intent="signin"]')).toBeTruthy();
  expect(container.querySelector('[data-hosted-auth-panel-methods="phone,telegram,email"]')).toBeTruthy();
  expect(mocks.hostedAuthPanel).toHaveBeenCalledWith({
    intent: "signin",
    methods: ["phone", "telegram", "email"],
  });
});
