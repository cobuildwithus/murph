import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { HostedSessionRenewal } from "@/src/components/hosted-onboarding/hosted-session-renewal";
import { renderClientComponent } from "./render-client-component";

const request = vi.fn();
let rendered: Awaited<ReturnType<typeof renderClientComponent>> | null = null;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("fetch", request); request.mockReset().mockResolvedValue(new Response(null, { status: 204 })); });
afterEach(async () => { await rendered?.cleanup(); rendered = null; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(authenticated = true) {
  rendered = await renderClientComponent(createElement(HostedSessionRenewal, { authenticated }), { requireButton: false });
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
  request.mockImplementation(() => new Promise(() => {}));
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
