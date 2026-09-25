import { act, createElement, useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), reload: vi.fn(), pathname: "/approve/synthetic" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useSelectedLayoutSegment: () => "approve" }));
vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({ navigateHostedAuthRedirect: mocks.navigate, reloadCurrentHostedAuthDocument: mocks.reload }));
vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({ AuthDialog: (props: {
  open: boolean; reauthenticate: boolean; onReauthenticated: () => void; onOpenChange: (open: boolean) => void;
}) => props.open ? createElement("div", { "data-reauthenticate": props.reauthenticate },
  createElement("button", { onClick: props.onReauthenticated }, "Complete primary proof"),
  createElement("button", { onClick: () => props.onOpenChange(false) }, "Cancel sign-in")) : null }));
import { AuthProvider, useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
function Harness() {
  const { reauthenticate } = useAuth();
  const [state, setState] = useState("idle");
  return createElement("div", null, createElement("button", { onClick: () => {
    setState("waiting");
    void reauthenticate!().then(() => setState("continued")).catch(() => setState("canceled"));
  } }, "Approve"), createElement("p", { "data-result": true }, state));
}
beforeEach(() => { vi.clearAllMocks(); mocks.pathname = "/approve/synthetic"; });
test.each([true, false])("inline primary proof continues only on success (completed=%s)", async (completed) => {
  const view = await renderClientComponent(createElement(AuthProvider, { authenticated: true }, createElement(Harness)));
  async function click(label: string) {
    const button = [...view.container.querySelectorAll("button")].find((entry) => entry.textContent === label);
    if (!button) throw new Error("Missing test control");
    await act(async () => { button.dispatchEvent(new view.window.Event("click", { bubbles: true })); });
  }
  try {
    await click("Approve");
    expect(view.container.querySelector('[data-reauthenticate="true"]')).not.toBeNull();
    expect(view.container.querySelector("[data-result]")?.textContent).toBe("waiting");
    await click(completed ? "Complete primary proof" : "Cancel sign-in");
    expect(view.container.querySelector("[data-result]")?.textContent).toBe(completed ? "continued" : "canceled");
    expect(view.container.querySelector("[data-reauthenticate]")).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.reload).not.toHaveBeenCalled();
  } finally { await view.cleanup(); }
});


test("navigation cancels a continuation retained by the app shell", async () => {
  const element = () => createElement(AuthProvider, { authenticated: true }, createElement(Harness));
  const view = await renderClientComponent(element());
  try {
    const button = [...view.container.querySelectorAll("button")].find((entry) => entry.textContent === "Approve")!;
    await act(async () => { button.dispatchEvent(new view.window.Event("click", { bubbles: true })); });
    mocks.pathname = "/home";
    await view.rerender(element());
    expect(view.container.querySelector("[data-result]")?.textContent).toBe("canceled");
    expect(view.container.querySelector("[data-reauthenticate]")).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  } finally { await view.cleanup(); }
});
