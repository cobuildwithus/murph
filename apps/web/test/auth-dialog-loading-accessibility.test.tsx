import {
  act,
  createElement,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  useState,
} from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => {
  const state = {
    dialogInitialFocus: null as null | { current: HTMLElement | null },
    dialogInitialFocusHistory: [] as Array<null | { current: HTMLElement | null }>,
    initialPanelState: "phone-entry" as
      | "phone-entry"
      | "phone-recovery"
      | "resume",
    moduleGate: Promise.resolve(),
    panelAutoFocusHistory: [] as Array<boolean | undefined>,
    panelRender: vi.fn(),
    panelProps: null as null | { phoneInputAutoFocus?: boolean },
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
    HostedAuthPanelIsland(props: { phoneInputAutoFocus?: boolean }) {
      const [panelState, setPanelState] = useState(mocks.initialPanelState);
      mocks.panelRender();
      mocks.panelAutoFocusHistory.push(props.phoneInputAutoFocus);
      mocks.panelProps = props;

      if (panelState === "resume") {
        return createElement(
          "button",
          {
            "data-use-phone": "true",
            onClick: () => setPanelState("phone-entry"),
            type: "button",
          },
          "Use phone",
        );
      }

      if (panelState === "phone-recovery") {
        return createElement(
          "button",
          {
            "data-use-different-number": "true",
            onClick: () => setPanelState("phone-entry"),
            type: "button",
          },
          "Use a different number",
        );
      }

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
        createElement(
          "button",
          {
            "data-continue": "true",
            onClick: () => setPanelState("phone-recovery"),
            type: "button",
          },
          "Continue",
        ),
      );
    },
  };
});

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog({ children }: { children: ReactNode }) {
    return createElement("div", null, children);
  },
  DialogContent(props: {
    children: ReactNode;
    initialFocus?: { current: HTMLElement | null };
    ref?: Ref<HTMLDivElement>;
    showCloseButton?: boolean;
  }) {
    mocks.dialogInitialFocus = props.initialFocus ?? null;
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
  mocks.dialogInitialFocus = null;
  mocks.dialogInitialFocusHistory = [];
  mocks.initialPanelState = "phone-entry";
  mocks.panelAutoFocusHistory = [];
  mocks.panelProps = null;
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
  expect(mocks.dialogInitialFocus?.current).toBe(content);

  const focus = installFocusTracking(rendered.window);
  content?.focus();
  expect(rendered.window.document.activeElement).toBe(content);
  focus.mockClear();

  await releaseAuthPanelModule();

  const country = rendered.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Country or region"]',
  );
  expect(country).toBeTruthy();
  expect(mocks.panelAutoFocusHistory).toContain(false);
  expect(mocks.panelProps?.phoneInputAutoFocus).toBe(true);
  expect(focus.mock.instances).toContain(country);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(rendered.window.document.activeElement).toBe(country);
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
  expect(mocks.panelAutoFocusHistory).toContain(false);
  expect(mocks.panelProps?.phoneInputAutoFocus).toBe(true);
  expect(focus).not.toHaveBeenCalled();
  expect(rendered.window.document.activeElement).toBe(close);

  const continueButton = rendered.container.querySelector<HTMLButtonElement>(
    '[data-continue="true"]',
  );
  continueButton?.focus();
  await act(async () => {
    continueButton?.click();
  });

  const useDifferentNumber = rendered.container.querySelector<HTMLButtonElement>(
    '[data-use-different-number="true"]',
  );
  expect(useDifferentNumber?.textContent).toBe("Use a different number");
  useDifferentNumber?.focus();
  focus.mockClear();
  await act(async () => {
    useDifferentNumber?.click();
  });

  const remountedInput = rendered.container.querySelector<HTMLInputElement>(
    'input[aria-label="Phone number"]',
  );
  expect(remountedInput).toBeTruthy();
  expect(focus.mock.instances).toContain(remountedInput);
  expect(rendered.window.document.activeElement).toBe(remountedInput);
});

test("restores phone autofocus after a delayed resumable state", async () => {
  mocks.initialPanelState = "resume";
  const rendered = await renderPendingAuthDialog();
  const close = rendered.container.querySelector<HTMLButtonElement>(
    '[data-slot="dialog-close"]',
  );
  expect(close).toBeTruthy();
  const focus = installFocusTracking(rendered.window);
  close?.focus();
  focus.mockClear();

  await releaseAuthPanelModule();

  const usePhone = rendered.container.querySelector<HTMLButtonElement>(
    '[data-use-phone="true"]',
  );
  expect(usePhone?.textContent).toBe("Use phone");
  expect(rendered.container.querySelector('input[type="tel"]')).toBeNull();
  expect(mocks.panelAutoFocusHistory).toContain(false);
  expect(mocks.panelProps?.phoneInputAutoFocus).toBe(true);
  expect(focus).not.toHaveBeenCalled();
  expect(rendered.window.document.activeElement).toBe(close);

  usePhone?.focus();
  focus.mockClear();
  await act(async () => {
    usePhone?.click();
  });

  const input = rendered.container.querySelector<HTMLInputElement>(
    'input[aria-label="Phone number"]',
  );
  expect(input).toBeTruthy();
  expect(focus.mock.instances).toContain(input);
  expect(rendered.window.document.activeElement).toBe(input);
});

test("preserves phone autofocus when the auth panel is ready before open", async () => {
  mocks.releaseModule();
  await mocks.moduleGate;
  const {
    AuthDialog,
    preloadHostedAuthPanelIsland,
    readLoadedHostedAuthPanelIsland,
  } = await import(
    "@/src/components/hosted-onboarding/auth-dialog"
  );
  preloadHostedAuthPanelIsland();
  await vi.waitFor(() => {
    expect(readLoadedHostedAuthPanelIsland()).not.toBeNull();
  });
  const rendered = await renderClientComponent(
    createElement(AuthDialog, {
      onOpenChange: () => {},
      open: true,
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  expect(mocks.dialogInitialFocus).toBeNull();
  expect(mocks.panelProps?.phoneInputAutoFocus).toBe(true);
  expect(rendered.container.querySelector('input[aria-label="Phone number"]')).toBeTruthy();
});

test("uses a panel preloaded after a closed dialog mounts without suppressing phone autofocus", async () => {
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
      open: false,
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;
  const focus = installFocusTracking(rendered.window);

  preloadHostedAuthPanelIsland();
  await releaseAuthPanelModule();
  await vi.waitFor(() => {
    expect(readLoadedHostedAuthPanelIsland()).not.toBeNull();
  });
  mocks.dialogInitialFocusHistory = [];
  focus.mockClear();

  await rendered.rerender(
    createElement(AuthDialog, {
      ...authDialogProps,
      open: true,
    }),
  );

  const input = rendered.container.querySelector<HTMLInputElement>(
    'input[aria-label="Phone number"]',
  );
  expect(input).toBeTruthy();
  expect(mocks.dialogInitialFocusHistory).toEqual([null]);
  expect(mocks.panelProps?.phoneInputAutoFocus).toBe(true);
  expect(focus.mock.instances).toContain(input);
  expect(rendered.window.document.activeElement).toBe(input);
  expect(rendered.container.querySelector('[aria-busy="true"]')).toBeNull();
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
