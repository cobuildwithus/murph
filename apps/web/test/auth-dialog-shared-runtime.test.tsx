import { act, createElement, useEffect, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock("@/src/components/hosted-onboarding/hosted-first-party-auth-panel", () => ({
  HostedFirstPartyAuthPanel(props: { autoSendPastedPhoneNumber?: boolean }) {
    mocks.render(props);
    useEffect(() => () => { mocks.unmount(); }, []);
    return createElement("button", null, "Sign in");
  },
}));
vi.mock("@/src/components/ui/dialog", () => {
  const wrap = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return { Dialog: wrap, DialogContent: wrap, DialogDescription: wrap, DialogHeader: wrap, DialogTitle: wrap };
});
import { AuthDialog, preloadHostedAuthPanelIsland, readLoadedHostedAuthPanelIsland } from "@/src/components/hosted-onboarding/auth-dialog";
afterEach(() => { vi.clearAllMocks(); });

test("warming code leaves authentication unmounted until the dialog opens", async () => {
  preloadHostedAuthPanelIsland();
  await vi.waitFor(() => expect(readLoadedHostedAuthPanelIsland()).not.toBeNull());
  const rendered = await renderClientComponent(createElement(AuthDialog, { open: false, onOpenChange: () => {} }), { requireButton: false });
  try {
    expect(mocks.render).not.toHaveBeenCalled();
    await rendered.rerender(createElement(AuthDialog, { autoSendPastedPhoneNumber: true, open: true, onOpenChange: () => {} }));
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ autoSendPastedPhoneNumber: true }));
    expect(rendered.container.textContent).toContain("Sign in");
  } finally { await rendered.cleanup(); }
});

test("closing drops pending panel state and reopening creates a fresh flow", async () => {
  const dialog = (open: boolean) => createElement(AuthDialog, { open, onOpenChange: () => {} });
  const rendered = await renderClientComponent(dialog(true), { requireButton: false });
  try {
    await act(async () => {});
    expect(rendered.container.textContent).toContain("Sign in");
    await rendered.rerender(dialog(false));
    expect(mocks.unmount).toHaveBeenCalledOnce();
    expect(rendered.container.textContent).not.toContain("Sign in");
    await rendered.rerender(dialog(true));
    expect(rendered.container.textContent).toContain("Sign in");
    expect(mocks.unmount).toHaveBeenCalledOnce();
  } finally { await rendered.cleanup(); }
});
