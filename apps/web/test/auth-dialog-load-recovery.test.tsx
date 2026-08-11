import {
  act,
  createElement,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  dialogInitialFocusHistory: [] as Array<null | { current: HTMLElement | null }>,
  dialogOnOpenChange: null as null | ((open: boolean) => void),
  loadAttempt: 0,
  panelProps: null as null | { phoneInputAutoFocus?: boolean },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel-island", async () => {
  mocks.loadAttempt += 1;
  if (mocks.loadAttempt === 1) {
    throw new Error("Chunk unavailable");
  }

  return {
    HostedAuthPanelIsland(props: { phoneInputAutoFocus?: boolean }) {
      mocks.panelProps = props;
      return createElement(
        "div",
        null,
        createElement(
          "button",
          { "aria-label": "Country or region", type: "button" },
          "United States +1",
        ),
        createElement("input", {
          "aria-label": "Phone number",
          autoFocus: props.phoneInputAutoFocus,
          type: "tel",
        }),
      );
    },
  };
});

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog({
    children,
    onOpenChange,
  }: {
    children: ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) {
    mocks.dialogOnOpenChange = onOpenChange ?? null;
    return createElement("div", null, children);
  },
  DialogContent(props: {
    children: ReactNode;
    initialFocus?: { current: HTMLElement | null };
    ref?: Ref<HTMLDivElement>;
    showCloseButton?: boolean;
  }) {
    mocks.dialogInitialFocusHistory.push(props.initialFocus ?? null);
    return createElement(
      "div",
      {
        "data-dialog-content": "shown",
        ref: props.ref,
        tabIndex: -1,
      },
      props.children,
      props.showCloseButton === false
        ? null
        : createElement(
            "button",
            { "data-slot": "dialog-close", type: "button" },
            "Close",
          ),
    );
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

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.dialogInitialFocusHistory = [];
  mocks.dialogOnOpenChange = null;
  mocks.loadAttempt = 0;
  mocks.panelProps = null;
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("reveals a successful closed-state preload after an earlier open failed", async () => {
  const {
    AuthDialog,
    preloadHostedAuthPanelIsland,
    readLoadedHostedAuthPanelIsland,
  } = await import(
    "@/src/components/hosted-onboarding/auth-dialog"
  );
  const authDialogProps = {
    onOpenChange: () => {},
  };
  const rendered = await renderClientComponent(
    createElement(AuthDialog, {
      ...authDialogProps,
      open: true,
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  await vi.waitFor(() => {
    expect(rendered.container.textContent).toContain(
      "Sign in did not load. Try again.",
    );
  });

  await act(async () => {
    mocks.dialogOnOpenChange?.(false);
  });
  await rendered.rerender(
    createElement(AuthDialog, {
      ...authDialogProps,
      open: false,
    }),
  );

  preloadHostedAuthPanelIsland();
  await vi.waitFor(() => {
    expect(readLoadedHostedAuthPanelIsland()).not.toBeNull();
  });
  const focus = installFocusTracking(rendered.window);
  mocks.dialogInitialFocusHistory = [];

  await rendered.rerender(
    createElement(AuthDialog, {
      ...authDialogProps,
      open: true,
    }),
  );

  const input = rendered.container.querySelector<HTMLInputElement>(
    'input[aria-label="Phone number"]',
  );
  expect(rendered.container.textContent).not.toContain(
    "Sign in did not load. Try again.",
  );
  expect(rendered.container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(input).toBeTruthy();
  expect(mocks.dialogInitialFocusHistory).toEqual([null]);
  expect(mocks.panelProps?.phoneInputAutoFocus).toBe(true);
  expect(focus.mock.instances).toContain(input);
  expect(rendered.window.document.activeElement).toBe(input);
});

function installFocusTracking(window: Window & typeof globalThis) {
  Object.defineProperty(window.document, "activeElement", {
    configurable: true,
    value: window.document.body,
  });
  return vi
    .spyOn(window.HTMLElement.prototype, "focus")
    .mockImplementation(function focus(this: HTMLElement) {
      Object.defineProperty(window.document, "activeElement", {
        configurable: true,
        value: this,
      });
    });
}
