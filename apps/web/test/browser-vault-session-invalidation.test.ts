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
