import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { createCloudflareMediaStore } from "../src/runtime-platform/media-store.ts";
import type { HostedRuntimeBridgeCheckpointLease } from "@murphai/assistant-runtime/hosted-checkpoint-bridge";

const bytes = new Uint8Array([1, 2, 3]);
const descriptor = { bytes, byteSize: bytes.length, mediaKind: "image" as const,
  sha256: createHash("sha256").update(bytes).digest("hex"), mediaId: "a".repeat(64), expiresAt: null };
const lease: HostedRuntimeBridgeCheckpointLease = { attemptId: "synthetic-attempt", leaseGeneration: "1", userId: "synthetic-member", workspaceVersion: "1" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test.each(["record", "put", "delete"] as const)("cancels %s while authority is pending and forbids its later fetch", async operation => {
  const authority = deferred<HostedRuntimeBridgeCheckpointLease>();
  const reached = deferred<void>(); const cancel = new AbortController();
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const store = createCloudflareMediaStore({ fetchImpl, timeoutMs: 60_000, workspaceCheckpointBridge: {
    readCurrentLease() { reached.resolve(); return authority.promise; },
  } });
  const running = store[operation]!(descriptor, { signal: cancel.signal });
  await reached.promise; cancel.abort(new Error("Foreground wake"));
  await expect(running).rejects.toThrow("Foreground wake");
  authority.resolve(lease); await turn();
  expect(fetchImpl).not.toHaveBeenCalled();
});

test.each(["record", "put", "delete"] as const)("cancels a non-cooperating %s transport before its late response", async operation => {
  const response = deferred<Response>(); const reached = deferred<void>(); const cancel = new AbortController();
  const fetchImpl = vi.fn<typeof fetch>(async () => { reached.resolve(); return response.promise; });
  const store = createCloudflareMediaStore({ fetchImpl, timeoutMs: 60_000 });
  const running = store[operation]!(descriptor, { signal: cancel.signal });
  await reached.promise; cancel.abort(new Error("Foreground wake"));
  await expect(running).rejects.toThrow("Foreground wake");
  response.resolve(new Response(null, { status: 204 })); await turn();
  expect(fetchImpl).toHaveBeenCalledOnce();
  if (operation === "put") {
    // The canceled completion must neither cache success nor strand inFlight.
    await store.put(descriptor);
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(["PUT", "PUT"]);
  }
});

test("a canceled shared-upload waiter never registers after its original upload finishes", async () => {
  const response = deferred<Response>(); const reached = deferred<void>(); const cancel = new AbortController();
  const fetchImpl = vi.fn<typeof fetch>(async () => { reached.resolve(); return response.promise; });
  const store = createCloudflareMediaStore({ fetchImpl, timeoutMs: 60_000 });
  const original = store.put(descriptor); await reached.promise;
  const waiter = store.put(descriptor, { signal: cancel.signal }); await turn();
  cancel.abort(new Error("Foreground wake")); await expect(waiter).rejects.toThrow("Foreground wake");
  response.resolve(new Response(null, { status: 204 })); await original; await turn();
  expect(fetchImpl).toHaveBeenCalledOnce();
});

test("cached upload registration is cancellable before authority and never starts POST afterward", async () => {
  const authority = deferred<HostedRuntimeBridgeCheckpointLease>(); const reached = deferred<void>();
  let cached = false;
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const store = createCloudflareMediaStore({ fetchImpl, timeoutMs: 60_000, workspaceCheckpointBridge: {
    readCurrentLease() { if (!cached) return lease; reached.resolve(); return authority.promise; },
  } });
  await store.put(descriptor); cached = true;
  const cancel = new AbortController(); const running = store.put(descriptor, { signal: cancel.signal });
  await reached.promise; cancel.abort(new Error("Foreground wake"));
  await expect(running).rejects.toThrow("Foreground wake");
  authority.resolve(lease); await turn(); expect(fetchImpl).toHaveBeenCalledOnce();
});

test.each(["record", "put", "delete"] as const)("already canceled %s makes no request or unhandled continuation", async operation => {
  const fetchImpl = vi.fn<typeof fetch>();
  const store = createCloudflareMediaStore({ fetchImpl, timeoutMs: 60_000 });
  await expect(store[operation]!(descriptor, { signal: AbortSignal.abort(new Error("Already canceled")) })).rejects.toThrow("Already canceled");
  await turn(); expect(fetchImpl).not.toHaveBeenCalled();
});
