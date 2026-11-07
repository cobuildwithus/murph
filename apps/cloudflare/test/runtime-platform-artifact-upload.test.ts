import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HostedRuntimeArtifactWriteError } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { HostedRuntimeInternalAuthorityRejectedError } from "../src/runtime-platform/authority-headers.ts";
import { HOSTED_RUNTIME_ARTIFACT_UPLOAD_DEADLINE_HEADER } from "../src/runner-outbound/headers.ts";

import { createCloudflareArtifactStore } from "../src/runtime-platform/artifact-store.ts";

const startedAt = Date.UTC(2026, 0, 1);
const lease = { attemptId: "attempt_1", leaseGeneration: "9", userId: "member_123", workspaceVersion: "4" };

function createArtifact() {
  const bytes = new Uint8Array([7, 11, 13]);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

describe("artifact upload transport recovery", () => {
  beforeEach(() => {
    // Bound admission deterministically, independent of a loaded test host.
    vi.spyOn(Date, "now").mockReturnValue(startedAt);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it("finishes the same immutable upload after one response-less transport failure", async () => {
    const bytes = new Uint8Array([7, 11, 13]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const store = createCloudflareArtifactStore({ fetchImpl, timeoutMs: 5_000 });

    await expect(store.put({ bytes, sha256 })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(new URL(String(url)).pathname).toBe(`/objects/${sha256}`);
      expect(init?.method).toBe("PUT");
      expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(bytes);
    }
    await store.put({ bytes, sha256 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    new Error("fetch failed"),
    new TypeError("Network connection lost"),
    new Error("socket hang up"),
    new Error("The RPC call destroy() was called"),
  ])("replays a classified transient transport failure: %s", async (failure) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(new Response(null, { status: 204 }));
    const store = createCloudflareArtifactStore({ fetchImpl, timeoutMs: 5_000 });
    await expect(store.put(createArtifact())).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("snapshots bytes before awaiting authority and does not restamp the fence", async () => {
    const artifact = createArtifact();
    const original = artifact.bytes.slice();
    const readCurrentLease = vi.fn(async () => {
      artifact.bytes.fill(99);
      return lease;
    });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const store = createCloudflareArtifactStore({
      fetchImpl, timeoutMs: 5_000, workspaceCheckpointBridge: { readCurrentLease },
    });
    await store.put(artifact);
    expect(readCurrentLease).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(fetchImpl.mock.calls[0]?.[1]?.body);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(original);
      expect(new Headers(init?.headers).get("x-hosted-runtime-attempt-id")).toBe(lease.attemptId);
    }
  });

  it("shares two failed attempts, retains the typed failure, and allows a later explicit upload", async () => {
    const first = new TypeError("fetch failed");
    const second = new Error("socket hang up");
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second)
      .mockResolvedValue(new Response(null, { status: 200 }));
    const store = createCloudflareArtifactStore({ fetchImpl, timeoutMs: 5_000 });
    const artifact = createArtifact();
    const failures = await Promise.all([
      store.put(artifact).catch((error: unknown) => error),
      store.put(artifact).catch((error: unknown) => error),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(failures[0]).toBeInstanceOf(HostedRuntimeArtifactWriteError);
    expect(failures[0]).toMatchObject({ retryable: true, cause: { cause: second } });
    expect(failures[1]).toBe(failures[0]);
    await store.put(artifact);
    await store.put(artifact);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("keeps one deadline and subtracts first-attempt and backoff time from the second timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        vi.mocked(Date.now).mockReturnValue(startedAt + 250);
        throw new TypeError("fetch failed");
      })
      .mockResolvedValue(new Response(null, { status: 200 }));
    const store = createCloudflareArtifactStore({ fetchImpl, timeoutMs: 5_000 });
    const upload = store.put(createArtifact());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
    vi.mocked(Date.now).mockReturnValue(startedAt + 350);
    await vi.advanceTimersByTimeAsync(99);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await upload;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(timeout.mock.calls).toEqual([[5_000], [4_650]]);
    expect(fetchImpl.mock.calls.map(([, init]) => new Headers(init?.headers)
      .get(HOSTED_RUNTIME_ARTIFACT_UPLOAD_DEADLINE_HEADER)))
      .toEqual([String(startedAt + 5_000), String(startedAt + 5_000)]);
  });

  it.each([
    { timeoutMs: 5_000, elapsedMs: 800 },
    { timeoutMs: 5_000, elapsedMs: 1_000 },
    { timeoutMs: 5_000, elapsedMs: 5_000 },
    { timeoutMs: 200, elapsedMs: 0 },
    { timeoutMs: 500, elapsedMs: 300 },
  ])("does not replay without a delay and margin: %j", async ({ timeoutMs, elapsedMs }) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      vi.mocked(Date.now).mockReturnValue(startedAt + elapsedMs);
      throw new TypeError("fetch failed");
    });
    const store = createCloudflareArtifactStore({ fetchImpl, timeoutMs });
    await expect(store.put(createArtifact())).rejects.toBeInstanceOf(HostedRuntimeArtifactWriteError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    { timeoutMs: 5_000, elapsedMs: 900 },
    { timeoutMs: 5_000, elapsedMs: 1_001 },
    { timeoutMs: 500, elapsedMs: 400 },
    { timeoutMs: 500, elapsedMs: 501 },
  ])("rechecks deadline/window after backoff: %j", async ({ timeoutMs, elapsedMs }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const failure = new TypeError("fetch failed");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(failure);
    const store = createCloudflareArtifactStore({ fetchImpl, timeoutMs });
    const rejected = store.put(createArtifact()).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(Date.now).mockReturnValue(startedAt + elapsedMs);
    await vi.advanceTimersByTimeAsync(100);
    expect(await rejected).toMatchObject({ retryable: true, cause: { cause: failure } });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    new DOMException("Synthetic cancellation", "AbortError"),
    new DOMException("Synthetic timeout", "TimeoutError"),
    new DOMException("The RPC call destroy() was called", "AbortError"),
    new DOMException("The RPC call destroy() was called", "TimeoutError"),
    new RangeError("Synthetic network failure"),
    Object.assign(new Error("fetch failed"), { code: "authorization_error" }),
    new TypeError("Invalid URL"),
    new TypeError("Request body is unusable"),
    new RangeError("Invalid range"),
    new Error("Synthetic unknown failure"),
    new Error("put: Synthetic network service failure (10001)"),
    new Error("put: Synthetic network service failure (10043)"),
    new Error("put: Synthetic network failure (10099)"),
    "fetch failed",
    Object.assign(new TypeError("fetch failed"), { status: 503 }),
    new Error("network lost", { cause: Object.assign(new Error("Synthetic response"), { statusCode: 401 }) }),
  ])("does not replay cancellation, timeout, deterministic, unknown or status failures: %s", async (failure) => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(failure);
    const store = createCloudflareArtifactStore({ fetchImpl, timeoutMs: 5_000 });
    await expect(store.put(createArtifact())).rejects.toBeInstanceOf(HostedRuntimeArtifactWriteError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not replay fetch_failed when the original request timeout signal is aborted", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      controller.abort(new DOMException("Synthetic timeout", "TimeoutError"));
      throw new TypeError("fetch failed");
    });
    const store = createCloudflareArtifactStore({ fetchImpl, timeoutMs: 5_000 });
    await expect(store.put(createArtifact())).rejects.toBeInstanceOf(HostedRuntimeArtifactWriteError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([401, 403, 408, 409, 422, 429, 500, 502, 503, 504])("does not replay HTTP %i", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    const store = createCloudflareArtifactStore({ fetchImpl, timeoutMs: 5_000 });
    await expect(store.put(createArtifact())).rejects.toMatchObject({
      retryable: status === 408 || status === 429 || status >= 500,
      cause: { status },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("preserves an authority rejection without a second fetch", async () => {
    const failure = new HostedRuntimeInternalAuthorityRejectedError({ description: "Synthetic authority", status: 401 });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(failure);
    const store = createCloudflareArtifactStore({ fetchImpl, timeoutMs: 5_000 });
    await expect(store.put(createArtifact())).rejects.toBe(failure);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not fetch or reread authority after a failed lease read", async () => {
    const failure = new Error("Synthetic lease rejection");
    const readCurrentLease = vi.fn().mockRejectedValue(failure);
    const fetchImpl = vi.fn<typeof fetch>();
    const store = createCloudflareArtifactStore({
      fetchImpl, timeoutMs: 5_000, workspaceCheckpointBridge: { readCurrentLease },
    });
    await expect(store.put(createArtifact())).rejects.toBe(failure);
    expect(readCurrentLease).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
