import { act, createElement } from "react";
import { locks } from "node:worker_threads";
import { verifyHostedAppSession } from "@/src/components/hosted-onboarding/hosted-app-session-client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { HostedSessionRenewal } from "@/src/components/hosted-onboarding/hosted-session-renewal";
import { renderClientComponent } from "./render-client-component";

const request = vi.fn();
let rendered: Awaited<ReturnType<typeof renderClientComponent>> | null = null;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("fetch", request); request.mockReset().mockResolvedValue(new Response(null, { status: 204 })); });
afterEach(async () => { await rendered?.cleanup(); rendered = null; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(authenticated = true) {
  rendered = await renderClientComponent(createElement("div"), { requireButton: false });
  Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
  await rendered.rerender(createElement(HostedSessionRenewal, { authenticated }));
  return rendered;
}

test("signed-out pages make no renewal request", async () => {
  await render(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); });
  expect(request).not.toHaveBeenCalled();
});

test("visible browser activity renews through the fixed cookie endpoint at most hourly", async () => {
  const { window } = await render();
  expect(request).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({
    method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
  }));
  await act(async () => { window.dispatchEvent(new window.Event("focus")); await vi.advanceTimersByTimeAsync(3_599_999); });
  expect(request).toHaveBeenCalledOnce();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(request).toHaveBeenCalledTimes(2);
});

test("hidden tabs wait until visible before retrying", async () => {
  const { window } = await render();
  Object.defineProperty(window.document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => { await vi.advanceTimersByTimeAsync(7_200_000); });
  expect(request).toHaveBeenCalledOnce();
  Object.defineProperty(window.document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => { window.document.dispatchEvent(new window.Event("visibilitychange")); });
  expect(request).toHaveBeenCalledTimes(2);
});

test("offline renewal retries without logout, redirects or login fallback", async () => {
  request.mockRejectedValueOnce(new TypeError("offline"));
  const { assign } = await render();
  await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); });
  expect(request.mock.calls.map(([url]) => url)).toEqual(["/api/auth/session", "/api/auth/session"]);
  expect(assign).not.toHaveBeenCalled();
});

test("pending renewal is bounded and cleanup aborts the owned request", async () => {
  request.mockImplementation((_url: string, { signal }: RequestInit) => new Promise((_resolve, reject) => {
    signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
  }));
  const { window } = await render();
  const signal: AbortSignal = request.mock.calls[0][1].signal;
  await act(async () => { window.dispatchEvent(new window.Event("focus")); });
  expect(request).toHaveBeenCalledOnce();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(signal.aborted).toBe(true);
  await rendered!.cleanup(); rendered = null;
  await act(async () => { await vi.advanceTimersByTimeAsync(7_200_000); });
  expect(request).toHaveBeenCalledOnce();
});

for (const url of ["/api/auth/otp/verify", "/api/auth/telegram/verify"] as const) {
  test(`${url} waits for an older cookie renewal before replacing the member`, async () => {
    let cookie = "member-a";
    let release!: () => void;
    request.mockImplementation(async (path: string) => {
      if (path === "/api/auth/session") {
        const captured = cookie;
        await new Promise<void>((resolve) => { release = resolve; });
        cookie = captured;
        return new Response(null, { status: 204 });
      }
      cookie = "member-b";
      return Response.json({ ok: true, memberId: cookie });
    });
    await render();
    const verified = verifyHostedAppSession({ url, payload: {} });
    await act(async () => { await Promise.resolve(); });
    expect(request.mock.calls.map(([path]) => path)).toEqual(["/api/auth/session"]);
    release();
    await act(async () => { await verified; });
    expect(cookie).toBe("member-b");
    expect(request.mock.calls.map(([path]) => path)).toEqual(["/api/auth/session", url]);
  });
}

test("browsers without origin-wide locks retain their existing cookie lifetime and can still sign in", async () => {
  rendered = await renderClientComponent(createElement("div"), { requireButton: false });
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  await rendered.rerender(createElement(HostedSessionRenewal, { authenticated: true }));
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValue(Response.json({ ok: true, memberId: "member-b" }));
  await verifyHostedAppSession({ url: "/api/auth/otp/verify", payload: {} });
  expect(request).toHaveBeenCalledOnce();
});

test("failed verification releases cookie ownership and preserves ordinary renewal", async () => {
  await render();
  request.mockResolvedValueOnce(Response.json({ error: { message: "Invalid code" } }, { status: 400 }));
  await expect(verifyHostedAppSession({ url: "/api/auth/otp/verify", payload: {} })).rejects.toThrow("Invalid code");
  await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); });
  expect(request.mock.calls.map(([url]) => url)).toEqual(["/api/auth/session", "/api/auth/otp/verify", "/api/auth/session"]);
});
