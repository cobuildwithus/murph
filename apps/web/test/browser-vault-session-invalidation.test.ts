import { afterEach, expect, test, vi } from "vitest";

class FakeBroadcastChannel extends EventTarget {
  static instances = new Set<FakeBroadcastChannel>();
  static postedMessages: unknown[] = [];

  constructor(readonly name: string) {
    super();
    FakeBroadcastChannel.instances.add(this);
  }

  postMessage(data: unknown): void {
    FakeBroadcastChannel.postedMessages.push(data);
    for (const channel of FakeBroadcastChannel.instances) {
      if (channel !== this && channel.name === this.name) {
        const event = new Event("message");
        Object.defineProperty(event, "data", { value: data });
        channel.dispatchEvent(event);
      }
    }
  }

  close(): void {
    FakeBroadcastChannel.instances.delete(this);
  }
}

afterEach(() => {
  FakeBroadcastChannel.instances.clear();
  FakeBroadcastChannel.postedMessages = [];
  vi.useRealTimers();
  vi.resetModules();
  vi.unstubAllGlobals();
});

test("cross-tab app-session invalidation reaches the browser-vault subscriber", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  const { subscribeBrowserVaultSessionInvalidation } = await import(
    "@/src/lib/browser-vault/session-invalidation"
  );

  const onInvalidate = vi.fn();
  const unsubscribe = subscribeBrowserVaultSessionInvalidation(onInvalidate);
  const subscriber = [...FakeBroadcastChannel.instances][0];
  expect(subscriber).toBeDefined();

  const otherTab = new FakeBroadcastChannel(subscriber?.name ?? "missing");
  otherTab.postMessage("invalidate");

  expect(onInvalidate).toHaveBeenCalledWith("cross-document");

  unsubscribe();
  otherTab.close();
});

test("a session-ending publication clears other tabs without asking them to reload yet", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  const {
    isBrowserVaultSessionEnding,
    publishBrowserVaultSessionEnding,
    publishBrowserVaultSessionInvalidation,
    subscribeBrowserVaultSessionInvalidation,
  } = await import("@/src/lib/browser-vault/session-invalidation");

  const onInvalidate = vi.fn();
  const unsubscribe = subscribeBrowserVaultSessionInvalidation(onInvalidate);
  const subscriber = [...FakeBroadcastChannel.instances][0];
  expect(subscriber).toBeDefined();

  const otherTabListener = vi.fn();
  const otherTab = new FakeBroadcastChannel(subscriber?.name ?? "missing");
  otherTab.addEventListener("message", otherTabListener);

  publishBrowserVaultSessionEnding();

  expect(FakeBroadcastChannel.postedMessages).toEqual(["clear"]);
  expect(onInvalidate.mock.calls).toEqual([["same-document-clear"]]);
  expect(isBrowserVaultSessionEnding()).toBe(true);
  expect(otherTabListener).toHaveBeenCalledTimes(1);
  expect((otherTabListener.mock.calls[0]?.[0] as MessageEvent).data).toBe("clear");

  publishBrowserVaultSessionInvalidation();
  expect(isBrowserVaultSessionEnding()).toBe(false);

  unsubscribe();
  otherTab.close();
});

test("a clear-only cross-tab signal is classified separately from revalidation", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  const {
    isBrowserVaultSessionEnding,
    subscribeBrowserVaultSessionInvalidation,
  } = await import(
    "@/src/lib/browser-vault/session-invalidation"
  );

  const onInvalidate = vi.fn();
  const unsubscribe = subscribeBrowserVaultSessionInvalidation(onInvalidate);
  const subscriber = [...FakeBroadcastChannel.instances][0];
  expect(subscriber).toBeDefined();

  const otherTab = new FakeBroadcastChannel(subscriber?.name ?? "missing");
  otherTab.postMessage("clear");

  expect(onInvalidate).toHaveBeenCalledWith("cross-document-clear");
  expect(isBrowserVaultSessionEnding()).toBe(true);

  otherTab.postMessage("invalidate");
  expect(onInvalidate).toHaveBeenCalledWith("cross-document");
  expect(isBrowserVaultSessionEnding()).toBe(false);

  unsubscribe();
  otherTab.close();
});

test("a cross-tab clear lease expires into data-free authority revalidation", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  const {
    BROWSER_VAULT_SESSION_ENDING_LEASE_MS,
    isBrowserVaultSessionEnding,
    subscribeBrowserVaultSessionInvalidation,
  } = await import("@/src/lib/browser-vault/session-invalidation");

  const onInvalidate = vi.fn();
  const unsubscribe = subscribeBrowserVaultSessionInvalidation(onInvalidate);
  const subscriber = [...FakeBroadcastChannel.instances][0];
  expect(subscriber).toBeDefined();

  const otherTab = new FakeBroadcastChannel(subscriber?.name ?? "missing");
  otherTab.postMessage("clear");
  expect(onInvalidate).toHaveBeenCalledWith("cross-document-clear");
  expect(isBrowserVaultSessionEnding()).toBe(true);

  await vi.advanceTimersByTimeAsync(BROWSER_VAULT_SESSION_ENDING_LEASE_MS);

  expect(isBrowserVaultSessionEnding()).toBe(false);
  expect(onInvalidate.mock.calls).toEqual([
    ["cross-document-clear"],
    ["same-document"],
  ]);
  expect(FakeBroadcastChannel.postedMessages).toEqual(["clear", "invalidate"]);

  unsubscribe();
  otherTab.close();
});

test("a local publication reaches each subscriber exactly once without a cross-document echo", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  const {
    publishBrowserVaultSessionInvalidation,
    subscribeBrowserVaultSessionInvalidation,
  } = await import("@/src/lib/browser-vault/session-invalidation");

  const onInvalidate = vi.fn();
  const secondOnInvalidate = vi.fn();
  const unsubscribe = subscribeBrowserVaultSessionInvalidation(onInvalidate);
  const secondUnsubscribe = subscribeBrowserVaultSessionInvalidation(
    secondOnInvalidate,
  );

  publishBrowserVaultSessionInvalidation();

  expect(FakeBroadcastChannel.postedMessages).toEqual(["invalidate"]);
  expect(onInvalidate.mock.calls).toEqual([["same-document"]]);
  expect(secondOnInvalidate.mock.calls).toEqual([["same-document"]]);

  unsubscribe();
  secondUnsubscribe();
});
