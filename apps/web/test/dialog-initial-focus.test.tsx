import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

const popupInitialFocusHistory = vi.hoisted(() => [] as unknown[]);

vi.mock("@base-ui/react/dialog", () => ({
  Dialog: {
    Backdrop: () => null,
    Close: ({ children }: { children?: ReactNode }) =>
      createElement("button", null, children),
    Description: ({ children }: { children?: ReactNode }) =>
      createElement("p", null, children),
    Popup: ({
      children,
      initialFocus,
    }: {
      children?: ReactNode;
      initialFocus?: unknown;
    }) => {
      popupInitialFocusHistory.push(initialFocus);
      return createElement("div", null, children);
    },
    Portal: ({ children }: { children?: ReactNode }) => children,
    Root: ({ children }: { children?: ReactNode }) => children,
    Title: ({ children }: { children?: ReactNode }) =>
      createElement("h2", null, children),
    Trigger: ({ children }: { children?: ReactNode }) => children,
  },
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: ({ children }: { children?: ReactNode }) =>
    createElement("button", null, children),
}));

beforeEach(() => {
  popupInitialFocusHistory.length = 0;
});

test("DialogContent focuses its neutral container by default", async () => {
  const { DialogContent } = await import("@/src/components/ui/dialog");

  renderToStaticMarkup(
    createElement(DialogContent, null, createElement("a", { href: "/" }, "Link")),
  );

  assert.equal(popupInitialFocusHistory.length, 1);
  assert.deepEqual(popupInitialFocusHistory[0], { current: null });
});

test("DialogContent preserves an explicit initial focus target", async () => {
  const { DialogContent } = await import("@/src/components/ui/dialog");
  const initialFocus = { current: null };

  renderToStaticMarkup(
    createElement(
      DialogContent,
      { initialFocus },
      createElement("button", null, "Continue"),
    ),
  );

  assert.deepEqual(popupInitialFocusHistory, [initialFocus]);
});
