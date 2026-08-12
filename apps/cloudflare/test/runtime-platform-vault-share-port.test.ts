import { hostedVaultShareProjectionKindToScope } from "@murphai/hosted-execution/vault-share";
import { describe, expect, it, vi } from "vitest";

import { createHostedWebVaultSharePort } from "../src/runtime-platform/vault-share-port.ts";

describe("createHostedWebVaultSharePort", () => {
  it("aborts an active projection delivery and preserves the foreground wake reason", async () => {
    const deliveryController = new AbortController();
    const wakeReason = new Error("Foreground runtime wake interrupted projection delivery.");
    let markFetchStarted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      expect(signal).toBeTruthy();
      markFetchStarted?.();
      return await new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(signal?.reason);
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener("abort", abort, { once: true });
      });
    });
    const vaultSharePort = createHostedWebVaultSharePort({
      boundUserId: "member_projection_abort",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 30_000,
      transport: { mode: "proxy" },
    });

    const deliveryResult = vaultSharePort.deliver({
      projectionKind: "profile-name.v0",
      projectionScope: hostedVaultShareProjectionKindToScope("profile-name.v0"),
      records: [],
      sourceWorkspaceVersion: "7",
    }, {
      signal: deliveryController.signal,
    });
    await fetchStarted;
    deliveryController.abort(wakeReason);

    await expect(deliveryResult).rejects.toBe(wakeReason);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
