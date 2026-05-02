import {
  act,
  createElement,
} from "react";
import { afterEach, expect, test, vi } from "vitest";

import { AuthButton } from "@/src/components/ui/auth-button";

import { renderClientComponent } from "./render-client-component";

let cleanupRender: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("AuthButton passes clicks through without loading Privy", async () => {
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
