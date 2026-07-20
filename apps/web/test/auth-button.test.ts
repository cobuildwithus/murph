import {
  act,
  createElement,
} from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { AuthButton } from "@/src/components/ui/auth-button";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  openAuthDialog: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: mocks.useAuth,
}));

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  mocks.openAuthDialog.mockReset();
  mocks.useAuth.mockReset();
  mocks.useAuth.mockReturnValue({
    authenticated: true,
    openAuthDialog: mocks.openAuthDialog,
  });
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("AuthButton opens the auth dialog for unauthenticated clicks", async () => {
  const onClick = vi.fn();
  const onConnect = vi.fn();
  const openAuthDialog = vi.fn();
  mocks.useAuth.mockReturnValue({
    authenticated: false,
    openAuthDialog,
  });
  const { button, cleanup, window } = await renderClientComponent(
    createElement(
      AuthButton,
      {
        connectLabel: "Log in to continue",
        onClick,
        onConnect,
        variant: "outline",
      },
      "Continue",
    ),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(openAuthDialog).toHaveBeenCalledTimes(1);
  expect(onConnect).not.toHaveBeenCalled();
  expect(onClick).not.toHaveBeenCalled();
});

test("AuthButton passes authenticated clicks through without loading Privy", async () => {
  const onClick = vi.fn();
  const onConnect = vi.fn();
  const { button, cleanup, window } = await renderClientComponent(
    createElement(
      AuthButton,
      {
        connectLabel: "Log in to continue",
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
  expect(button.textContent).toContain("Continue");

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(mocks.openAuthDialog).not.toHaveBeenCalled();
});

test("AuthButton can require a stronger caller-provided auth condition", async () => {
  const onClick = vi.fn();
  const onConnect = vi.fn();
  const { button, cleanup, window } = await renderClientComponent(
    createElement(
      AuthButton,
      {
        authSatisfied: false,
        onClick,
        onConnect,
        variant: "outline",
      },
      "Continue",
    ),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.openAuthDialog).toHaveBeenCalledTimes(1);
  expect(onConnect).not.toHaveBeenCalled();
  expect(onClick).not.toHaveBeenCalled();
});

test("AuthButton follows a stronger auth condition when it changes after render", async () => {
  const onClick = vi.fn();
  const onConnect = vi.fn();
  const rendered = await renderClientComponent(
    createElement(
      AuthButton,
      {
        authSatisfied: true,
        onClick,
        onConnect,
      },
      "Continue",
    ),
  );
  cleanupRender = rendered.cleanup;

  await rendered.rerender(
    createElement(
      AuthButton,
      {
        authSatisfied: false,
        onClick,
        onConnect,
      },
      "Continue",
    ),
  );

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(mocks.openAuthDialog).toHaveBeenCalledTimes(1);
  expect(onConnect).not.toHaveBeenCalled();
  expect(onClick).not.toHaveBeenCalled();
});

test("AuthButton lets callers handle auth-required clicks", async () => {
  const onAuthRequired = vi.fn();
  const onClick = vi.fn();
  const onConnect = vi.fn();
  const { button, cleanup, window } = await renderClientComponent(
    createElement(
      AuthButton,
      {
        authSatisfied: false,
        onAuthRequired,
        onClick,
        onConnect,
        variant: "outline",
      },
      "Continue",
    ),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(onAuthRequired).toHaveBeenCalledTimes(1);
  expect(mocks.openAuthDialog).not.toHaveBeenCalled();
  expect(onConnect).not.toHaveBeenCalled();
  expect(onClick).not.toHaveBeenCalled();
});

test("AuthButton can render a connect label when no children are supplied", async () => {
  const { button, cleanup } = await renderClientComponent(
    createElement(AuthButton, {
      connectLabel: "Start experiment",
    }),
  );
  cleanupRender = cleanup;

  expect(button.textContent).toContain("Start experiment");
});

test("AuthButton preserves disabled button behavior", async () => {
  const onClick = vi.fn();
  const onConnect = vi.fn();
  const { button, cleanup, window } = await renderClientComponent(
    createElement(
      AuthButton,
      {
        disabled: true,
        onClick,
        onConnect,
      },
      "Continue",
    ),
  );
  cleanupRender = cleanup;

  expect(button.disabled).toBe(true);

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(onClick).not.toHaveBeenCalled();
  expect(onConnect).not.toHaveBeenCalled();
});

test("AuthButton can pass through to a rendered link without replacing its styling", async () => {
  const onClick = vi.fn();
  const onConnect = vi.fn();
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
          onConnect,
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

  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(onClick).toHaveBeenCalledTimes(1);
});
