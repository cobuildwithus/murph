import {
  act,
  createElement,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => {
  const state = {
    moduleGate: Promise.resolve(),
    panelRender: vi.fn(),
    releaseModule: () => {},
    resetModuleGate() {
      state.moduleGate = new Promise<void>((resolve) => {
        state.releaseModule = resolve;
      });
    },
  };
  state.resetModuleGate();
  return state;
});

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel-island", async () => {
  await mocks.moduleGate;
  return {
    HostedAuthPanelIsland() {
      mocks.panelRender();
      return createElement("input", {
        "aria-label": "Phone number",
        type: "tel",
      });
    },
  };
});

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog({ children }: { children: ReactNode }) {
    return createElement("div", null, children);
  },
  DialogContent(props: {
    children: ReactNode;
    ref?: Ref<HTMLDivElement>;
    showCloseButton?: boolean;
  }) {
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
  mocks.resetModuleGate();
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("announces cold auth loading and restores focus when the panel becomes usable", async () => {
  const rendered = await renderPendingAuthDialog();
  const status = rendered.container.querySelector<HTMLElement>(
    '[role="status"][aria-busy="true"]',
  );
  const content = rendered.container.querySelector<HTMLElement>(
    '[data-dialog-content="shown"]',
  );
  expect(status).toBeTruthy();
  expect(status?.getAttribute("aria-live")).toBe("polite");
  expect(status?.textContent).toContain("Loading secure sign in…");
  expect(status?.querySelector('[aria-hidden="true"]')?.className).toContain(
    "motion-reduce:animate-none",
  );
  expect(content).toBeTruthy();

  const focus = installFocusTracking(rendered.window);
  content?.focus();
  expect(rendered.window.document.activeElement).toBe(content);
  focus.mockClear();

  await releaseAuthPanelModule();

  const input = rendered.container.querySelector<HTMLInputElement>(
    'input[aria-label="Phone number"]',
  );
  expect(input).toBeTruthy();
  expect(focus.mock.instances).toContain(input);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(rendered.window.document.activeElement).toBe(input);
  expect(rendered.container.querySelector('[aria-busy="true"]')).toBeNull();
});

test("does not steal focus from the surviving close control", async () => {
  const rendered = await renderPendingAuthDialog();
  const close = rendered.container.querySelector<HTMLButtonElement>(
    '[data-slot="dialog-close"]',
  );
  expect(close).toBeTruthy();
  const focus = installFocusTracking(rendered.window);
  close?.focus();
  expect(rendered.window.document.activeElement).toBe(close);
  focus.mockClear();

  await releaseAuthPanelModule();

  expect(rendered.container.querySelector('input[aria-label="Phone number"]')).toBeTruthy();
  expect(focus).not.toHaveBeenCalled();
  expect(rendered.window.document.activeElement).toBe(close);
});

async function renderPendingAuthDialog() {
  const { AuthDialog } = await import(
    "@/src/components/hosted-onboarding/auth-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(AuthDialog, {
      onOpenChange: () => {},
      open: true,
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;
  return rendered;
}

async function releaseAuthPanelModule() {
  await act(async () => {
    mocks.releaseModule();
    await mocks.moduleGate;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

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
