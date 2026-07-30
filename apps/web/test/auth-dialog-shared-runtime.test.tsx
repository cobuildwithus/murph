import { createElement, createContext, useContext, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  standalonePanelModuleLoad: vi.fn(),
  sharedPanelRender: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel-island", () => {
  mocks.standalonePanelModuleLoad();
  return {
    HostedAuthPanelIsland() {
      return createElement("div", null, "Standalone auth panel");
    },
    HostedAuthPanelWithinPrivy() {
      return createElement("div", null, "Module shared auth panel");
    },
  };
});

const DialogOpenContext = createContext(false);

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog({ children, open }: { children: ReactNode; open: boolean }) {
    return createElement(
      DialogOpenContext.Provider,
      { value: open },
      children,
    );
  },
  DialogContent({ children }: { children: ReactNode }) {
    return useContext(DialogOpenContext)
      ? createElement("div", { "data-dialog-content": "true" }, children)
      : null;
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
  return createElement("div", null, "Shared auth panel");
};

afterEach(() => {
  vi.clearAllMocks();
});

test("renders the panel supplied by the warm runtime without loading a standalone provider island", async () => {
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
    expect(mocks.standalonePanelModuleLoad).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});
