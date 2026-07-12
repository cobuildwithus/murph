import { afterEach, expect, test, vi } from "vitest";

import {
  publishBrowserVaultSessionInvalidation,
  subscribeBrowserVaultSessionInvalidation,
} from "@/src/lib/browser-vault/session-invalidation";

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
  vi.unstubAllGlobals();
});

test("cross-tab app-session invalidation reaches the browser-vault subscriber", () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);

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

test("app-session invalidation publishes only the data-free cross-tab token", () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);

  const onInvalidate = vi.fn();
  const unsubscribe = subscribeBrowserVaultSessionInvalidation(onInvalidate);

  publishBrowserVaultSessionInvalidation();

  expect(FakeBroadcastChannel.postedMessages).toEqual(["invalidate"]);
  expect(onInvalidate).toHaveBeenCalledWith("same-document");

  unsubscribe();
});
