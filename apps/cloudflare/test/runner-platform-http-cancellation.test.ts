import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import { fetchHostedResponse } from "../src/runtime-platform/hosted-http.ts";
import { createCloudflareHostedTrustedInternalFetch } from "../src/runtime-platform/provider-fetch.ts";

vi.mock("@murphai/hosted-execution", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/hosted-execution")>(),
  emitHostedExecutionStructuredLog: vi.fn(),
}));

describe("hosted HTTP cancellation logging", () => {
  beforeEach(() => vi.clearAllMocks());

  const url = new URL("http://web-control.worker/api/internal/device-sync/runtime/snapshot");
  const fetchUntilAborted: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    return new Promise<Response>((_resolve, reject) => {
      request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
    });
  };
  const request = (signal: AbortSignal, fetchImpl = fetchUntilAborted, timeoutMs = 1_000) =>
    fetchHostedResponse({
      description: "Hosted device-sync runtime snapshot",
      fetchImpl: createCloudflareHostedTrustedInternalFetch("synthetic-member", fetchImpl),
      signal,
      timeoutMs,
      url,
    });

  it.each([
    new DOMException("Background work yielded.", "AbortError"),
    new DOMException("Background budget elapsed.", "TimeoutError"),
    new Error("Checkpoint interrupted by foreground work."),
  ])("keeps caller cancellation informational and propagates its cause: %s", async (reason) => {
    const controller = new AbortController();
    const pending = request(controller.signal);
    controller.abort(reason);

    await expect(pending).rejects.toMatchObject({ cause: reason });
    const logs = vi.mocked(emitHostedExecutionStructuredLog).mock.calls.map(([log]) => log);
    expect(logs.map(({ message, level }) => ({ message, level }))).toEqual([
      { message: "Hosted runtime internal request failed.", level: "info" },
      { message: "Hosted runtime upstream request failed.", level: "info" },
    ]);
    expect(logs[0]?.error).toBe(reason);
  });

  it("retains the upstream warning when its own HTTP deadline expires", async () => {
    await expect(request(new AbortController().signal, fetchUntilAborted, 10))
      .rejects.toMatchObject({ cause: { name: "TimeoutError" } });
    expect(emitHostedExecutionStructuredLog).toHaveBeenCalledWith(expect.objectContaining({
      message: "Hosted runtime upstream request failed.",
      level: "warn",
      details: expect.objectContaining({
        fetchCallerSignalAborted: false,
        fetchTimeoutSignalAborted: true,
      }),
    }));
  });

  it("does not hide a different transport error when the caller also cancels", async () => {
    const controller = new AbortController();
    const failure = new TypeError("fetch failed");
    const transport: typeof fetch = async () => {
      controller.abort();
      throw failure;
    };
    await expect(request(controller.signal, transport)).rejects.toMatchObject({ cause: failure });
    const logs = vi.mocked(emitHostedExecutionStructuredLog).mock.calls.map(([log]) => log);
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.level === "warn")).toBe(true);
  });
});
