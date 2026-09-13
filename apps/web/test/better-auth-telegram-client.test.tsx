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
async function render(purpose: "login" | "credential" = "login", onErrorChange?: (error: string | null) => void) {
  rendered = await renderClientComponent(createElement("button", null, "Mount"));
  rendered.window.Telegram = { Login: { auth: mocks.auth, close: mocks.close } };
  await rendered.rerender(createElement(HostedTelegramProofButton, { purpose, onProof: mocks.proof, onErrorChange }));
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
  const view = await render("credential");
  expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ url: "/api/settings/login-methods/telegram/start" }));
  await click("Continue with Telegram");
  await view.rerender(createElement("button", null, "Closed"));
  expect(mocks.close).toHaveBeenCalledOnce();
  await finish({ id_token: "late-synthetic-token" });
  expect(mocks.proof).not.toHaveBeenCalled();
  expect(mocks.request).toHaveBeenCalledOnce();
});

test("provider cancellation permits a fresh attempt and never claims login", async () => {
  await render();
  await click("Continue with Telegram");
  await finish({ error: "popup_closed" });
  expect(mocks.proof).not.toHaveBeenCalled();
  expect(rendered!.container.textContent).toContain("was canceled");
  await click("Try again");
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
  await click("Try again");
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
  await click("Try again");
  await click("Continue with Telegram");
  expect(mocks.auth).toHaveBeenCalledOnce();
});


test("prepares before the click and keeps the action label during a slow start", async () => {
  let resolve!: (value: unknown) => void;
  mocks.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await render();
  const button = rendered!.container.querySelector("button");
  expect(button!.textContent).toBe("Continue with Telegram");
  expect(button!.disabled).toBe(false);
  expect(button!.getAttribute("aria-busy")).toBe("false");
  expect(button!.querySelector(".animate-spin")).toBeNull();
  expect(mocks.auth).not.toHaveBeenCalled();
  await act(async () => { resolve({ ok: true, nonce: "n".repeat(43), clientId: "123456789" }); });
  await click("Continue with Telegram");
  expect(mocks.auth).toHaveBeenCalledOnce();
});


test("reports inline-button errors to its shared status region and clears them on unmount", async () => {
  const changed = vi.fn();
  const view = await render("login", changed);
  await click("Continue with Telegram");
  await finish({ error: "popup_closed" });
  expect(changed).toHaveBeenLastCalledWith(expect.stringContaining("was canceled"));
  expect(view.container.querySelector('[role="alert"]')).toBeNull();
  expect(view.container.textContent).toContain("Try again");
  await view.rerender(createElement("button", null, "Closed"));
  expect(changed).toHaveBeenLastCalledWith(null);
});


test("an early click reserves the provider window and continues once without a second click", async () => {
  let resolve!: (value: unknown) => void;
  mocks.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const view = await render();
  const popup = view.window;
  Object.defineProperty(popup, "close", { value: vi.fn(), configurable: true });
  Object.defineProperty(popup, "closed", { value: false, writable: true, configurable: true });
  const open = vi.spyOn(view.window, "open").mockReturnValue(popup);
  await click("Continue with Telegram");
  expect(open).toHaveBeenCalledWith("about:blank", "telegram_oidc_login", expect.any(String));
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(view.container.querySelector(".animate-spin")).toBeNull();
  await click("Continue with Telegram");
  expect(open).toHaveBeenCalledOnce();
  await act(async () => { resolve({ ok: true, nonce: "n".repeat(43), clientId: "123456789" }); });
  expect(mocks.auth).toHaveBeenCalledOnce();
  await finish({ id_token: "synthetic-id-token" });
  expect(mocks.proof).toHaveBeenCalledOnce();
  expect(popup.close).toHaveBeenCalledOnce();
});

test.each(["unmount", "close"])("%s during preparation cannot open a late provider window", async (action) => {
  let resolve!: (value: unknown) => void;
  mocks.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const view = await render();
  const popup = view.window;
  Object.defineProperty(popup, "close", { value: vi.fn(), configurable: true });
  Object.defineProperty(popup, "closed", { value: false, writable: true, configurable: true });
  vi.spyOn(view.window, "open").mockReturnValue(popup);
  await click("Continue with Telegram");
  if (action === "unmount") await view.rerender(createElement("button", null, "Closed"));
  if (action === "close") popup.closed = true;
  await act(async () => { resolve({ ok: true, nonce: "n".repeat(43), clientId: "123456789" }); });
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(popup.close).toHaveBeenCalledOnce();
  expect(mocks.proof).not.toHaveBeenCalled();
});

test("a blocked early popup gives immediate recovery without forwarding a late preparation", async () => {
  let resolve!: (value: unknown) => void;
  mocks.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const view = await render();
  vi.spyOn(view.window, "open").mockReturnValue(null);
  await click("Continue with Telegram");
  expect(view.container.textContent).toContain("Allow the Telegram sign-in window");
  await act(async () => { resolve({ ok: true, nonce: "n".repeat(43), clientId: "123456789" }); });
  expect(mocks.auth).not.toHaveBeenCalled();
});

test("expired preparation refreshes inside the same click", async () => {
  vi.useFakeTimers();
  const view = await render();
  await act(async () => { await vi.advanceTimersByTimeAsync(240_001); });
  Object.defineProperty(view.window, "close", { value: vi.fn(), configurable: true });
  Object.defineProperty(view.window, "closed", { value: false, writable: true, configurable: true });
  vi.spyOn(view.window, "open").mockReturnValue(view.window);
  await click("Continue with Telegram");
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.auth).toHaveBeenCalledOnce();
});
