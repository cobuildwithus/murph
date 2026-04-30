import {
  act,
  createContext,
  createElement,
  useContext,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { afterEach, expect, test, vi } from "vitest";

import { AuthButton } from "@/src/components/ui/auth-button";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  usePrivy: vi.fn(() => ({ authenticated: false, ready: true })),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: mocks.usePrivy,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel", () => ({
  HostedAuthPanel(props: { requireLaunchConsentOnCompletion?: boolean }) {
    return createElement(
      "div",
      {
        "data-hosted-auth-launch-consent":
          props.requireLaunchConsentOnCompletion ? "required" : "not-required",
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
  mocks.usePrivy.mockReset();
  mocks.usePrivy.mockReturnValue({ authenticated: false, ready: true });
});

test("AuthButton opens hosted auth instead of calling onClick when signed out", async () => {
  const onClick = vi.fn();
  const onConnect = vi.fn();
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(
      AuthButton,
      {
        connectLabel: "Log in to continue",
        disabled: true,
        onClick,
        onConnect,
        variant: "outline",
      },
      "Continue",
    ),
  );
  cleanupRender = cleanup;

  expect(button.disabled).toBe(false);
  expect(button.getAttribute("data-slot")).toBe("auth-button");
  expect(button.getAttribute("type")).toBe("button");
  expect(button.textContent).toContain("Log in to continue");

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(onClick).not.toHaveBeenCalled();
  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Log in or sign up");
  expect(container.textContent).toContain("Hosted auth panel");
  expect(container.querySelector('[data-hosted-auth-launch-consent="required"]')).toBeTruthy();
});

test("AuthButton passes through to onClick when signed in", async () => {
  const onClick = vi.fn();
  const onConnect = vi.fn();
  mocks.usePrivy.mockReturnValue({ authenticated: true, ready: true });

  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(
      AuthButton,
      {
        connectLabel: "Log in to continue",
        onClick,
        onConnect,
      },
      "Continue",
    ),
  );
  cleanupRender = cleanup;

  expect(button.textContent).toContain("Continue");

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onConnect).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Hosted auth panel");
});

test("AuthButton blocks clicks without opening hosted auth while auth is not ready", async () => {
  const onClick = vi.fn();
  const onConnect = vi.fn();
  mocks.usePrivy.mockReturnValue({ authenticated: false, ready: false });

  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(
      AuthButton,
      {
        connectLabel: "Log in to continue",
        onClick,
        onConnect,
      },
      "Continue",
    ),
  );
  cleanupRender = cleanup;

  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.textContent).toContain("Log in to continue");

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(onClick).not.toHaveBeenCalled();
  expect(onConnect).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Hosted auth panel");
  expect(container.textContent).not.toContain("Log in or sign up");
});

test("AuthButton can gate a rendered link without replacing its styling", async () => {
  const onClick = vi.fn();
  const { cleanup, container, window } = await renderClientComponent(
    createElement(
      "div",
      null,
      createElement(
        AuthButton,
        {
          className: "custom-link-class",
          nativeButton: false,
          onClick,
          render: createElement("a", { href: "/connect" }),
          size: "unstyled",
          variant: "unstyled",
        },
        "Connect devices",
      ),
      createElement("button", { type: "button" }, "test sentinel"),
    ),
  );
  cleanupRender = cleanup;

  const link = container.querySelector("a");
  expect(link).toBeTruthy();
  expect(link?.getAttribute("href")).toBe("/connect");
  expect(link?.getAttribute("data-slot")).toBe("auth-button");
  expect(link?.className).toContain("custom-link-class");

  await act(async () => {
    link?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(onClick).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Log in or sign up");
  expect(container.textContent).toContain("Hosted auth panel");
});
