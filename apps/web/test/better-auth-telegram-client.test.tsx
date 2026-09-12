import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({ request: vi.fn(), auth: vi.fn(), close: vi.fn(), proof: vi.fn() }));
vi.mock("@/src/components/hosted-onboarding/client-api", () => ({ requestHostedOnboardingJson: mocks.request }));
import { HostedTelegramProofButton } from "@/src/components/hosted-onboarding/hosted-telegram-proof-button";

let rendered: Awaited<ReturnType<typeof renderClientComponent>> | null = null;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.request.mockResolvedValue({ ok: true, nonce: "n".repeat(43), clientId: "123456789" });
  mocks.proof.mockResolvedValue(undefined);
});
afterEach(async () => { await rendered?.cleanup(); rendered = null; vi.useRealTimers(); });
async function render(purpose: "login" | "credential" = "login") {
  rendered = await renderClientComponent(createElement("button", null, "Mount"));
  rendered.window.Telegram = { Login: { auth: mocks.auth, close: mocks.close } };
  await rendered.rerender(createElement(HostedTelegramProofButton, { purpose, onProof: mocks.proof }));
  return rendered;
}
async function click(label: string) {
  const button = [...rendered!.container.querySelectorAll("button")].find((entry) => entry.textContent === label);
  expect(button).toBeDefined();
  await act(async () => { button!.dispatchEvent(new rendered!.window.Event("click", { bubbles: true })); });
}
async function finish(result: unknown, index = 0) {
  const callback = mocks.auth.mock.calls[index][1] as (value: unknown) => void;
  await act(async () => { callback(result); });
}

test("opens synchronously from a click with the server nonce and forwards only the opaque token", async () => {
  await render();
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ url: "/api/auth/telegram/start", method: "POST" }));
  await click("Continue with Telegram");
  expect(mocks.auth).toHaveBeenCalledWith({ client_id: 123456789, nonce: "n".repeat(43), scope: ["profile", "write"] }, expect.any(Function));
  await finish({ id_token: "synthetic-id-token", user: { id: 123 } });
  expect(mocks.proof).toHaveBeenCalledWith("synthetic-id-token", expect.any(AbortSignal));
  expect(mocks.close).toHaveBeenCalledOnce();
});

test("credential changes start a distinct purpose and cancellation cannot forward a late token", async () => {
  await render("credential");
  expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ url: "/api/settings/login-methods/telegram/start" }));
  await click("Continue with Telegram");
  await click("Cancel");
  expect(mocks.close).toHaveBeenCalledOnce();
  await finish({ id_token: "late-synthetic-token" });
  expect(mocks.proof).not.toHaveBeenCalled();
  expect(mocks.request).toHaveBeenCalledTimes(2);
});

test("provider cancellation permits a fresh attempt and never claims login", async () => {
  await render();
  await click("Continue with Telegram");
  await finish({ error: "popup_closed" });
  expect(mocks.proof).not.toHaveBeenCalled();
  expect(rendered!.container.textContent).toContain("was canceled");
  await click("Try Telegram again");
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(rendered!.container.textContent).toContain("Continue with Telegram");
});

test("a blocked popup has a bounded recovery state", async () => {
  vi.useFakeTimers();
  await render();
  await click("Continue with Telegram");
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(rendered!.container.textContent).toContain("allow the sign-in window to open");
  expect(mocks.close).toHaveBeenCalledOnce();
  await finish({ id_token: "late-synthetic-token" });
  expect(mocks.proof).not.toHaveBeenCalled();
  await click("Try Telegram again");
  expect(rendered!.container.textContent).toContain("Continue with Telegram");
});

test("unmount closes this flow and ignores provider callbacks", async () => {
  const view = await render();
  await click("Continue with Telegram");
  await view.rerender(createElement("button", null, "Closed"));
  expect(mocks.close).toHaveBeenCalledOnce();
  await finish({ id_token: "late-synthetic-token" });
  expect(mocks.proof).not.toHaveBeenCalled();
});

test("server preparation failure is retryable without opening the provider", async () => {
  mocks.request.mockRejectedValueOnce(new Error("Sign-in is temporarily unavailable."));
  await render();
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(rendered!.container.textContent).toContain("temporarily unavailable");
  await click("Try Telegram again");
  await click("Continue with Telegram");
  expect(mocks.auth).toHaveBeenCalledOnce();
});
