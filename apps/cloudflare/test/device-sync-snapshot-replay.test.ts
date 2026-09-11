import { createServer } from "node:http";
import { brotliCompressSync, gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_BYTES_HEADER as bytesHeader,
} from "@murphai/device-syncd/hosted-runtime";
import {
  buildHostedExecutionStructuredLogRecord,
  type HostedExecutionStructuredLogInput,
} from "@murphai/hosted-execution";

import { HostedRuntimeInternalAuthorityRejectedError } from "../src/runtime-platform/authority-headers.ts";
import { createHostedWebDeviceSyncPort } from "../src/runtime-platform/device-sync-port.ts";
import {
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
} from "../src/runtime-platform/web-control-transport.ts";

const mocks = vi.hoisted(() => ({
  log: vi.fn<(input: HostedExecutionStructuredLogInput) => void>(),
}));
vi.mock("@murphai/hosted-execution", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/hosted-execution")>(),
  emitHostedExecutionStructuredLog: mocks.log,
}));

const snapshot = {
  connections: [],
  generatedAt: "2026-09-10T12:00:00.000Z",
  userId: "member-snapshot-replay",
};
const privateText = "synthetic-private-café-🧪-雪";
const json = JSON.stringify({ ...snapshot, diagnosticTestOnly: privateText });
const expectedBytes = new TextEncoder().encode(json).byteLength;
const incompleteError = {
  name: "HostedWebControlPlaneIncompleteSnapshotResponseError",
  code: "HOSTED_WEB_CONTROL_INCOMPLETE_SNAPSHOT_RESPONSE",
  message: "Hosted device-sync runtime snapshot returned an incomplete snapshot response.",
};

function response(body: BodyInit | null = json, marker: string | null = String(expectedBytes), status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json",
      ...(marker === null ? {} : { [bytesHeader]: marker }),
    },
  });
}

function port(fetchImpl: typeof fetch, timeoutMs = 10_000) {
  return createHostedWebDeviceSyncPort({
    boundUserId: snapshot.userId,
    fetchImpl,
    timeoutMs,
    transport: { mode: "proxy" },
  });
}

function splitBytes(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
}

function lostBody() {
  return new ReadableStream<Uint8Array>({
    start(controller) { controller.error(new TypeError("socket closed")); },
  });
}

function failures() {
  return mocks.log.mock.calls.map(([entry]) => entry).filter((entry) =>
    entry.details?.responseBodyShape !== undefined);
}

function expectSafeFailure(bytes: number, shape: "empty" | "invalid_json") {
  const entries = failures();
  expect(entries).toHaveLength(1);
  const entry = entries[0]!;
  expect(buildHostedExecutionStructuredLogRecord(entry).details).toMatchObject({
    responseBodyBytes: bytes,
    responseExpectedBodyBytes: expectedBytes,
    responseBodyShape: shape,
    responseByteCountComparison: "mismatch",
  });
  expect(entry).not.toHaveProperty("error");
  expect(entry.details).not.toHaveProperty("errorMessage");
  expect(entry.details).not.toHaveProperty("errorStack");
  expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(privateText);
  expect(mocks.log).toHaveBeenCalledTimes(5); // Two normal attempts, one existing failure event.
}

describe("device-sync snapshot single exact replay", () => {
  beforeEach(() => { mocks.log.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([null, "", " \n\t", json.slice(0, -1)])("recovers one short rejected body (case %#)", async (body) => {
    const first = response(body);
    const second = response();
    for (const delivered of [first, second]) {
      for (const method of ["clone", "text", "json", "arrayBuffer"] as const) {
        vi.spyOn(delivered, method).mockImplementation(() => { throw new Error("Unexpected full-body access"); });
      }
    }
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const input = { connectionId: "synthetic-connection", includeCredentialMaterial: false, limit: 1 };
    await expect(port(fetchImpl).fetchSnapshot(input)).resolves.toEqual(snapshot);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = fetchImpl.mock.calls;
    expect(String(secondCall![0])).toBe(String(firstCall![0]));
    expect(secondCall![1]?.method).toBe("POST");
    expect(secondCall![1]?.body).toBe(firstCall![1]?.body);
    expect(JSON.parse(String(firstCall![1]?.body))).toEqual({ ...input, userId: snapshot.userId });
    expectSafeFailure(new TextEncoder().encode(body ?? "").byteLength, body?.trim() ? "invalid_json" : "empty");
  });

  it.each(["", json.slice(0, -1)])("stops permanent short failures at two attempts (case %#)", async (body) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(body));
    const result = port(fetchImpl).fetchSnapshot();
    await expect(result).rejects.toMatchObject(incompleteError);
    await expect(result).rejects.not.toHaveProperty("cause");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(failures()).toHaveLength(2);
    expect(mocks.log).toHaveBeenCalledTimes(6);
  });

  it.each([null, "", "-1", "01", "+2", "1e3", "1.5", "9007199254740992", "2, 2", "invalid", "9".repeat(128)]
    .flatMap((marker) => ["", "{"].map((body) => ({ marker, body }))))(
    "does not recover missing/invalid marker $marker with body '$body'", async ({ marker, body }) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => response(body, marker));
      await expect(port(fetchImpl).fetchSnapshot()).rejects.toThrow(body
        ? "returned invalid JSON." : "response must be an object.");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(failures()[0]?.details).not.toHaveProperty("responseExpectedBodyBytes");
    },
  );

  it.each(["equal", "overlong", "utf16_length"] as const)("does not retry %s malformed multibyte JSON", async (kind) => {
    const body = json.slice(0, -1);
    const bytes = new TextEncoder().encode(body);
    const marker = kind === "equal" ? bytes.byteLength : kind === "overlong" ? bytes.byteLength - 1 : body.length;
    const fetchImpl = vi.fn<typeof fetch>(async () => response(splitBytes(bytes), String(marker)));
    const result = port(fetchImpl).fetchSnapshot();
    await expect(result).rejects.toMatchObject({ cause: expect.any(SyntaxError) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(failures()[0]?.details).toMatchObject({ responseBodyBytes: bytes.byteLength });
  });

  it("does not treat a zero-byte marker and zero-byte body as incomplete", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(null, "0"));
    await expect(port(fetchImpl).fetchSnapshot()).rejects.toThrow("response must be an object.");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(failures()[0]?.details?.responseByteCountComparison).toBe("match");
  });

  it.each([5, 6])("compares original streamed BOM/incomplete UTF-8 bytes against marker %s", async (marker) => {
    const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0xc3);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(splitBytes(bytes), String(marker)))
      .mockResolvedValueOnce(response());
    const result = port(fetchImpl).fetchSnapshot();
    if (marker === 6) await expect(result).resolves.toEqual(snapshot);
    else await expect(result).rejects.toMatchObject({ cause: expect.any(SyntaxError) });
    expect(fetchImpl).toHaveBeenCalledTimes(marker === 6 ? 2 : 1);
    expect(failures()[0]?.details).toMatchObject({ responseBodyBytes: 5, responseExpectedBodyBytes: marker });
  });

  it.each([null, "invalid", "", "0", String(expectedBytes), String(expectedBytes + 1), "9007199254740991"])(
    "accepts a complete valid snapshot with diagnostic marker %s", async (marker) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => response(splitBytes(new TextEncoder().encode(json)), marker));
      await expect(port(fetchImpl).fetchSnapshot()).resolves.toEqual(snapshot);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(failures()).toEqual([]);
      expect(mocks.log).toHaveBeenCalledTimes(2);
      for (const [entry] of mocks.log.mock.calls) {
        expect(entry.details).not.toHaveProperty("responseBodyBytes");
        expect(entry.details).not.toHaveProperty("responseExpectedBodyBytes");
      }
    },
  );

  it.each([null, [], 42, true, "synthetic scalar", {}, { ...snapshot, connections: null }].map((body) => ({ body })))(
    "leaves complete valid-JSON schema rejection outside replay (case %#)", async ({ body }) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => response(JSON.stringify(body), "9007199254740991"));
      await expect(port(fetchImpl).fetchSnapshot()).rejects.toBeInstanceOf(TypeError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([400, 401, 403, 408, 429].flatMap((status) => ["empty", "invalid", "socket"].map((body) => ({ status, body }))))(
    "does not replay known HTTP $status with a $body diagnostic body", async ({ status, body }) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => response(
        body === "socket" ? lostBody() : body === "empty" ? null : "{", String(expectedBytes), status,
      ));
      await expect(port(fetchImpl).fetchSnapshot()).rejects.toMatchObject({ name: "HostedWebControlPlaneResponseError", status });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(failures()).toEqual([]);
    },
  );

  it.each([401, 403, 503])("does not reclassify an explicitly accepted non-OK HTTP %s", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response("{", String(expectedBytes), status));
    await expect(fetchHostedWebControlPlaneJson({
      acceptedStatuses: [status], boundUserId: snapshot.userId, description: "Synthetic accepted status",
      fetchImpl, replayOnceOnRetryableFailure: true,
      route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.deviceSyncRuntimeSnapshot,
      timeoutMs: 10_000, transport: { mode: "proxy" },
    })).rejects.toMatchObject({ cause: expect.any(SyntaxError) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves internal authority rejection without replay", async () => {
    const error = new HostedRuntimeInternalAuthorityRejectedError({ description: "Synthetic authority", status: 403 });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(error);
    await expect(port(fetchImpl).fetchSnapshot()).rejects.toBe(error);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["request", "body", "503"] as const)("reuses existing %s recovery without a marker", async (kind) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    if (kind === "request") fetchImpl.mockRejectedValueOnce(new TypeError("fetch failed"));
    else fetchImpl.mockResolvedValueOnce(response(kind === "body" ? lostBody() : null, null, kind === "503" ? 503 : 200));
    await expect(port(fetchImpl).fetchSnapshot()).resolves.toEqual(snapshot);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(failures()).toEqual([]);
  });

  it("does not give a replayed socket failure another retry", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response(""))
      .mockRejectedValue(new TypeError("fetch failed"));
    await expect(port(fetchImpl).fetchSnapshot()).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not reclassify unrelated stream errors even with a larger marker", async () => {
    const error = new Error("Synthetic unrelated reader failure");
    const fetchImpl = vi.fn<typeof fetch>(async () => response(new ReadableStream({
      start(controller) { controller.error(error); },
    })));
    await expect(port(fetchImpl).fetchSnapshot()).rejects.toBe(error);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(failures()).toEqual([]);
  });

  it.each(["", "{"])("does not broaden non-snapshot decoding with opt-in and a marker: '%s'", async (body) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(body));
    const result = fetchHostedWebControlPlaneJson({
      boundUserId: snapshot.userId, description: "Synthetic workspace read", fetchImpl,
      replayOnceOnRetryableFailure: true, route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.workspaceRead,
      timeoutMs: 10_000, transport: { mode: "proxy" },
    });
    if (body) await expect(result).rejects.toMatchObject({ cause: expect.any(SyntaxError) });
    else await expect(result).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(failures()).toEqual([]);
  });

  it("does not opt other device-sync routes into transport retry", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    await expect(port(fetchImpl).applyUpdates({ updates: [] })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("shares one deadline across request headers and bodies on both attempts", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => { now += 6_000; return response(""); })
      .mockImplementationOnce(async () => { now += 3_900; return response(); });
    await expect(port(fetchImpl).fetchSnapshot()).resolves.toEqual(snapshot);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([10_000, 4_000, 4_000, 100]);
  });

  it("does not reset the deadline for the replayed body", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const cancel = vi.fn();
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => { now += 6_000; return response(""); })
      .mockImplementationOnce(async () => {
        now += 4_000;
        return response(new ReadableStream<Uint8Array>({ cancel }));
      });
    await expect(port(fetchImpl).fetchSnapshot()).rejects.toMatchObject({ name: "TimeoutError" });
    expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([10_000, 4_000, 4_000]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rechecks the total budget after a short response is decoded", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.log.mockImplementation((entry) => { if (entry.details?.responseBodyShape) now += 10_000; });
    const fetchImpl = vi.fn<typeof fetch>(async () => response(""));
    await expect(port(fetchImpl).fetchSnapshot()).rejects.toMatchObject(incompleteError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["request", "body"] as const)("does not retry an exhausted %s timeout", async (phase) => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      if (phase === "body") return response(new ReadableStream<Uint8Array>({ cancel }));
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        if (signal.aborted) reject(signal.reason);
      });
    });
    await expect(port(fetchImpl, 25).fetchSnapshot()).rejects.toMatchObject(phase === "request"
      ? { code: "timeout", hostedRuntimeFetchTimeoutSignalAborted: true }
      : { name: "TimeoutError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(phase === "body" ? 1 : 0);
    expect(failures()).toEqual([]);
  });

  it.each([1, 2])("preserves caller abort while reading attempt %s", async (attempt) => {
    const controller = new AbortController();
    const reason = new DOMException("Synthetic cancellation", "AbortError");
    let signalReading!: () => void;
    const reading = new Promise<void>((resolve) => { signalReading = resolve; });
    const cancel = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => response(new ReadableStream<Uint8Array>({
      pull() { signalReading(); }, cancel,
    })));
    if (attempt === 2) fetchImpl.mockResolvedValueOnce(response(""));
    const result = port(fetchImpl).fetchSnapshot({ signal: controller.signal });
    await reading;
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(fetchImpl).toHaveBeenCalledTimes(attempt);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rechecks caller abort between failed decoding and exact replay", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Synthetic cancellation", "AbortError");
    mocks.log.mockImplementation((entry) => { if (entry.details?.responseBodyShape) controller.abort(reason); });
    const fetchImpl = vi.fn<typeof fetch>(async () => response(""));
    await expect(port(fetchImpl).fetchSnapshot({ signal: controller.signal })).rejects.toThrow();
    expect(controller.signal.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["gzip", "br"] as const)("counts decompressed UTF-8, not %s wire length", async (encoding) => {
    const short = json.slice(0, -1);
    let requests = 0;
    // Real HTTP content decoding; this is not a workerd framing/recompression proof.
    const server = createServer(async (request, reply) => {
      for await (const _chunk of request) { /* Drain the synthetic read-only POST. */ }
      requests += 1;
      const bytes = Buffer.from(requests === 1 ? short : json);
      const compressed = encoding === "gzip" ? gzipSync(bytes) : brotliCompressSync(bytes);
      reply.writeHead(200, {
        "content-type": "application/json", "content-encoding": encoding,
        "content-length": compressed.byteLength, [bytesHeader]: String(expectedBytes),
      });
      reply.end(compressed);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing synthetic HTTP listener");
      const fetchImpl = vi.fn<typeof fetch>(async (url, init) =>
        fetch(new URL(new URL(String(url)).pathname, `http://127.0.0.1:${address.port}`), init));
      await expect(port(fetchImpl).fetchSnapshot()).resolves.toEqual(snapshot);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(requests).toBe(2);
      expectSafeFailure(Buffer.byteLength(short), "invalid_json");
      expect(failures()[0]?.details).toMatchObject({
        responseContentEncodingCategory: encoding, responseContentLengthCategory: "valid",
      });
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
