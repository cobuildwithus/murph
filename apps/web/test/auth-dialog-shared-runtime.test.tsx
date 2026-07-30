import { createElement, useEffect, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  standalonePanelRender: vi.fn(),
  sharedPanelRender: vi.fn(),
  sharedPanelUnmount: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel-island", () => ({
  HostedAuthPanelIsland() {
    mocks.standalonePanelRender();
    return createElement("div", null, "Standalone auth panel");
  },
  HostedAuthPanelWithinPrivy() {
    return createElement("div", null, "Module shared auth panel");
  },
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog({ children }: { children: ReactNode; open: boolean }) {
    return createElement("div", null, children);
  },
  DialogContent({ children }: { children: ReactNode }) {
    return createElement("div", { "data-dialog-content": "true" }, children);
  },
  DialogDescription({ children }: { children: ReactNode }) {
    return createElement("p", null, children);
  },
  DialogHeader({ children }: { children: ReactNode }) {
    return createElement("div", null, children);
  },
  DialogTitle({ children }: { children: ReactNode }) {
    return createElement("h2", null, children);
  },
}));

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";

const SharedAuthPanel = (props: { privyAttempt: number }) => {
  mocks.sharedPanelRender(props);
  useEffect(() => () => {
    mocks.sharedPanelUnmount();
  }, []);
  return createElement("div", null, "Shared auth panel");
};

afterEach(() => {
  vi.clearAllMocks();
});

test("keeps the warmed provider's auth panel unmounted while the dialog is closed", async () => {
  const rendered = await renderClientComponent(
    createElement(AuthDialog, {
      onOpenChange: () => {},
      open: false,
      privyRuntime: {
        attempt: 2,
        AuthPanel: SharedAuthPanel,
        kind: "configured",
        restart: () => {},
      },
    }),
    { requireButton: false },
  );

  try {
    expect(rendered.container.textContent).not.toContain("Shared auth panel");
    expect(mocks.sharedPanelRender).not.toHaveBeenCalled();
    expect(mocks.standalonePanelRender).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("renders the panel supplied by the warm runtime without rendering a standalone provider island", async () => {
  const rendered = await renderClientComponent(
    createElement(AuthDialog, {
      onOpenChange: () => {},
      open: true,
      privyRuntime: {
        attempt: 3,
        AuthPanel: SharedAuthPanel,
        kind: "configured",
        restart: () => {},
      },
    }),
    { requireButton: false },
  );

  try {
    expect(rendered.container.textContent).toContain("Shared auth panel");
    expect(rendered.container.textContent).not.toContain("Standalone auth panel");
    expect(mocks.sharedPanelRender).toHaveBeenCalledWith(
      expect.objectContaining({ privyAttempt: 3 }),
    );
    expect(mocks.standalonePanelRender).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("drops queued panel-local state immediately on close and remounts it fresh on reopen", async () => {
  const renderDialog = (open: boolean) => createElement(AuthDialog, {
    onOpenChange: () => {},
    open,
    privyRuntime: {
      attempt: 4,
      AuthPanel: SharedAuthPanel,
      kind: "configured" as const,
      restart: () => {},
    },
  });
  const rendered = await renderClientComponent(renderDialog(true), {
    requireButton: false,
  });

  try {
    expect(rendered.container.textContent).toContain("Shared auth panel");

    await rendered.rerender(renderDialog(false));

    expect(rendered.container.textContent).not.toContain("Shared auth panel");
    expect(mocks.sharedPanelUnmount).toHaveBeenCalledTimes(1);

    await rendered.rerender(renderDialog(true));

    expect(rendered.container.textContent).toContain("Shared auth panel");
    expect(mocks.sharedPanelRender).toHaveBeenCalledTimes(2);
  } finally {
    await rendered.cleanup();
  }
});
