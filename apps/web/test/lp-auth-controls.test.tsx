import {
  act,
  createElement,
  createContext,
  useContext,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { afterEach, expect, test, vi } from "vitest";

import { LandingAuthActions } from "@/app/auth-controls";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel", () => ({
  HostedAuthPanel(props: { showLegalNotice?: boolean }) {
    return createElement(
      "div",
      {
        "data-hosted-auth-legal-notice":
          props.showLegalNotice ? "shown" : "hidden",
      },
      "Hosted auth panel",
    );
  },
}));

const DialogOpenContext = createContext(false);

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog(props: { children: ReactNode; open?: boolean }) {
    return createElement(
      DialogOpenContext.Provider,
      { value: Boolean(props.open) },
      props.children,
    );
  },
  DialogContent(props: { children: ReactNode }) {
    const open = useContext(DialogOpenContext);
    return open
      ? createElement("div", { "data-dialog-content": "shown" }, props.children)
      : null;
  },
  DialogDescription(props: HTMLAttributes<HTMLParagraphElement>) {
    return createElement("p", props);
  },
  DialogHeader(props: HTMLAttributes<HTMLDivElement>) {
    return createElement("div", props);
  },
  DialogTitle(props: HTMLAttributes<HTMLHeadingElement>) {
    return createElement("h2", props);
  },
}));

let cleanupRender: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("LandingAuthActions opens the unified homepage auth flow", async () => {
  const { button, cleanup, window } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "hero",
      authLabel: "See what works for your body",
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  const authPanel = window.document.querySelector(
    '[data-hosted-auth-legal-notice="shown"]',
  );
  expect(authPanel).toBeTruthy();
  expect(authPanel?.getAttribute("data-hosted-auth-legal-notice")).toBe(
    "shown",
  );
  expect(window.document.body.textContent).toContain("Log in or sign up");
});

test("LandingAuthActions does not render a separate sign-in action", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "nav",
      authLabel: "Log in or sign up",
    }),
  );
  cleanupRender = cleanup;

  const buttons = Array.from(
    container.querySelectorAll("button"),
  ) as HTMLButtonElement[];
  expect(buttons).toHaveLength(1);
  expect(buttons[0]?.textContent).toContain("Log in or sign up");
});

test("LandingAuthActions shows only an Open settings link for authenticated users", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(
      "div",
      null,
      createElement("button", { type: "button" }, "sentinel"),
      createElement(LandingAuthActions, {
        authenticated: true,
        context: "footer",
        authLabel: "Start your first experiment",
      }),
    ),
  );
  cleanupRender = cleanup;

  const links = Array.from(container.querySelectorAll("a"));
  expect(links).toHaveLength(1);
  expect(links[0]?.getAttribute("href")).toBe("/settings");
  expect(links[0]?.textContent).toContain("Your account");
  expect(container.textContent).not.toContain("Log in or sign up");
});
