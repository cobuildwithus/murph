import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postHostedDeviceSyncSnapshotForTest } from "#hosted-web-testing";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_BYTES_HEADER as bytesHeader,
} from "@murphai/device-syncd/hosted-runtime";
import {
  buildHostedExecutionStructuredLogRecord,
  type HostedExecutionStructuredLogInput,
} from "@murphai/hosted-execution";
import { HOSTED_EXECUTION_SIGNATURE_HEADER } from "@murphai/hosted-execution/contracts";
import { createHostedWebDeviceSyncPort } from "../src/runtime-platform/device-sync-port.ts";
import {
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
} from "../src/runtime-platform/web-control-transport.ts";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON,
} from "./hosted-execution-fixtures.ts";

const mocks = vi.hoisted(() => ({
  consumeNonce: vi.fn(),
  readState: vi.fn(),
  log: vi.fn<(input: HostedExecutionStructuredLogInput) => void>(),
}));
vi.mock("@murphai/hosted-execution", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/hosted-execution")>(),
  emitHostedExecutionStructuredLog: mocks.log,
}));
// Only persistence is fake: both callback signing/verification and response owners are real.
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/hosted-execution/internal-request-nonces", () => ({
  PrismaHostedCallbackRequestNonceStore: class {
    consumeHostedCallbackRequestNonce = mocks.consumeNonce;
  },
}));
vi.mock("@/src/lib/device-sync/hosted-runtime-authority", () => ({
  readHostedDeviceSyncRuntimeState: mocks.readState,
}));

const privateBody = "synthetic-private-body-café-🧪-雪";
const privateMime = "application/x-synthetic-private-mime; private=synthetic-private-parameter";
const privateMarker = "synthetic-private-marker";
const snapshot = {
  connections: [],
  generatedAt: "2026-09-08T16:00:00.000Z",
  userId: "member_snapshot_123",
  diagnosticTestOnly: privateBody,
};
const expectedSnapshot = {
  connections: [],
  generatedAt: snapshot.generatedAt,
  userId: snapshot.userId,
};
const invalidJsonMessage = "Hosted runtime control-plane response returned invalid JSON.";
const invalidShapeMessage = "Hosted runtime device-sync snapshot response returned invalid top-level shape.";

function harness(transform: (response: Response) => Response | Promise<Response> = (r) => r) {
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) =>
    transform(await postHostedDeviceSyncSnapshotForTest(new Request(input, init))));
  const input = {
    boundUserId: snapshot.userId,
    fetchImpl,
    timeoutMs: 10_000,
    transport: {
      mode: "direct" as const,
      callbackSigning: { keyId: "v1", privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON },
      webControlBaseUrl: "https://web.example.test",
      workspaceCheckpointBridge: null,
    },
  };
  return { input, fetchImpl, port: createHostedWebDeviceSyncPort(input) };
}

function failureLogs() {
  return mocks.log.mock.calls.map(([entry]) => entry).filter((entry) =>
    entry.message === invalidJsonMessage || entry.message === invalidShapeMessage);
}

function expectFailureMetadata(details: Record<string, unknown>, attempts = 1) {
  details = {
    responseContentEncodingCategory: "missing", responseContentLengthCategory: "missing", ...details,
  };
  expect(mocks.log).toHaveBeenCalledTimes(3 * attempts);
  const entries = failureLogs();
  expect(entries).toHaveLength(attempts);
  for (const entry of entries) {
    expect(entry).toMatchObject({ level: "warn", details });
    // Exercise the real retained-log sanitizer and its existing 32-key cap too.
    expect(buildHostedExecutionStructuredLogRecord(entry).details).toMatchObject(details);
    expect(entry).not.toHaveProperty("error");
    expect(entry.details).not.toHaveProperty("errorMessage");
    expect(entry.details).not.toHaveProperty("errorStack");
  }
  const logs = JSON.stringify(mocks.log.mock.calls);
  for (const sentinel of [privateBody, privateMime, privateMarker, "synthetic-private-parameter"]) {
    expect(logs).not.toContain(sentinel);
  }
}

function chunkedResponse(bytes: Uint8Array, headers: Headers): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      // Every multibyte code point is split; byte lengths cannot be JS string lengths.
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  }), { headers });
}

describe("device-sync snapshot producer/decoder diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeNonce.mockResolvedValue(true);
    mocks.readState.mockResolvedValue(snapshot);
    vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_KEY_ID", "v1");
    vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK", TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON);
    vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON", "");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("decodes the actual signed Web response with split UTF-8 and no clone or success diagnostics", async () => {
    const { input, fetchImpl } = harness(async (response) => {
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(response.headers.get(bytesHeader)).toBe(String(bytes.byteLength));
      expect(response.headers.get("cache-control")).toBe("no-store");
      const delivered = chunkedResponse(bytes, response.headers);
      vi.spyOn(delivered, "clone").mockImplementation(() => { throw new Error("Unexpected clone"); });
      return delivered;
    });
    await expect(fetchHostedWebControlPlaneJson({
      ...input,
      body: { userId: snapshot.userId },
      description: "Hosted device-sync runtime snapshot",
      route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.deviceSyncRuntimeSnapshot,
    })).resolves.toEqual(snapshot);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mocks.consumeNonce).toHaveBeenCalledTimes(1);
    expect(failureLogs()).toEqual([]);
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(privateBody);
  });

  it.each(["empty", "invalid_json"] as const)("recovers a transient %s with a newly signed exact read", async (kind) => {
    let attempts = 0;
    const { port, fetchImpl } = harness(async (response) => {
      attempts += 1;
      if (attempts !== 1) return response;
      const text = await response.text();
      return new Response(kind === "empty" ? "" : text.slice(0, -1), { headers: response.headers });
    });
    await expect(port.fetchSnapshot({ includeCredentialMaterial: false })).resolves.toEqual(expectedSnapshot);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(mocks.consumeNonce).toHaveBeenCalledTimes(2);
    const nonces = mocks.consumeNonce.mock.calls.map(([input]) => input.nonceHash);
    expect(new Set(nonces).size).toBe(2);
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(mocks.readState).toHaveBeenCalledTimes(2);
    expect(failureLogs()).toHaveLength(1);
    expect(mocks.log).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(privateBody);
  });

  it.each(["shortened", "equal_length_corruption"] as const)("classifies %s at the existing decoder", async (kind) => {
    let producerBytes = 0;
    let deliveredBytes = 0;
    const { port, fetchImpl } = harness(async (response) => {
      const bytes = new Uint8Array(await response.arrayBuffer());
      producerBytes = bytes.byteLength;
      if (kind === "equal_length_corruption") bytes[0] = 93; // ']' instead of '{'
      const delivered = kind === "shortened" ? bytes.subarray(0, -1) : bytes;
      deliveredBytes = delivered.byteLength;
      return chunkedResponse(delivered, response.headers);
    });
    const attempts = kind === "shortened" ? 2 : 1;
    await expect(port.fetchSnapshot()).rejects.toMatchObject(kind === "shortened" ? {
      code: "HOSTED_WEB_CONTROL_INCOMPLETE_SNAPSHOT_RESPONSE",
      message: "Hosted device-sync runtime snapshot returned an incomplete snapshot response.",
    } : {
      message: "Hosted device-sync runtime snapshot returned invalid JSON.",
      cause: expect.any(SyntaxError),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(attempts);
    expectFailureMetadata({
      responseBodyShape: "invalid_json", responseMimeCategory: "json",
      responseBodyBytes: deliveredBytes, responseExpectedBodyBytes: producerBytes,
      responseByteCountComparison: kind === "shortened" ? "mismatch" : "match",
    }, attempts);
  });

  it.each([
    { body: "{", encoding: "GZIP", length: "01", encodingCategory: "gzip", lengthCategory: "invalid" },
    { body: "", encoding: "identity", length: "0", encodingCategory: "identity", lengthCategory: "valid" },
    { body: "null", encoding: "br", length: "9007199254740991", encodingCategory: "br", lengthCategory: "valid" },
    { body: "[]", encoding: "deflate", length: "2", encodingCategory: "deflate", lengthCategory: "valid" },
    { body: "42", encoding: "synthetic-private-header", length: "synthetic-private-header", encodingCategory: "other", lengthCategory: "invalid" },
    { body: "{", encoding: "x".repeat(4096), length: "9".repeat(4096), encodingCategory: "other", lengthCategory: "invalid" },
  ])("enriches existing snapshot failures with finite header categories (case %#)", async ({
    body, encoding, length, encodingCategory, lengthCategory,
  }) => {
    const { port, fetchImpl } = harness((response) => {
      response.headers.set("content-encoding", encoding);
      response.headers.set("content-length", length);
      return new Response(body, { headers: response.headers });
    });
    const result = port.fetchSnapshot();
    const incomplete = body === "{" || body === "";
    if (incomplete) await expect(result).rejects.toMatchObject({
      code: "HOSTED_WEB_CONTROL_INCOMPLETE_SNAPSHOT_RESPONSE",
    });
    else await expect(result).rejects.toThrow("Hosted device-sync runtime snapshot response must be an object.");
    const attempts = incomplete ? 2 : 1;
    expect(fetchImpl).toHaveBeenCalledTimes(attempts);
    expectFailureMetadata({
      responseContentEncodingCategory: encodingCategory, responseContentLengthCategory: lengthCategory,
      responseBodyBytes: new TextEncoder().encode(body).byteLength,
    }, attempts);
    const logs = JSON.stringify(mocks.log.mock.calls);
    for (const sentinel of ["synthetic-private-header", "x".repeat(64), "9".repeat(64), "9007199254740991"]) {
      expect(logs).not.toContain(sentinel);
    }
  });

  it("counts original bytes even when TextDecoder strips a BOM and replaces incomplete UTF-8", async () => {
    const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0xc3);
    const { port } = harness((response) => {
      response.headers.set(bytesHeader, "5");
      return chunkedResponse(bytes, response.headers);
    });
    await expect(port.fetchSnapshot()).rejects.toThrow("returned invalid JSON.");
    expectFailureMetadata({ responseBodyBytes: 5, responseExpectedBodyBytes: 5, responseByteCountComparison: "match" });
  });

  it.each([
    { body: null, shape: "empty" },
    { body: "", shape: "empty" },
    { body: " \n\t", shape: "empty" },
    { body: "null", shape: "null" },
    { body: "[]", shape: "array" },
    { body: JSON.stringify(privateBody), shape: "scalar" },
    { body: "42", shape: "scalar" },
    { body: "true", shape: "scalar" },
  ])("keeps bounded warnings and the appropriate failure for $shape ($body)", async ({ body, shape }) => {
    const bytes = new TextEncoder().encode(body ?? "").byteLength;
    const { port, fetchImpl } = harness((response) => new Response(body, { headers: response.headers }));
    const result = port.fetchSnapshot();
    if (shape === "empty") {
      await expect(result).rejects.toMatchObject({ code: "HOSTED_WEB_CONTROL_INCOMPLETE_SNAPSHOT_RESPONSE" });
    } else {
      await expect(result).rejects.toBeInstanceOf(TypeError);
      await expect(result).rejects.toThrow("Hosted device-sync runtime snapshot response must be an object.");
    }
    const attempts = shape === "empty" ? 2 : 1;
    expect(fetchImpl).toHaveBeenCalledTimes(attempts);
    expect(failureLogs()[0]?.message).toBe(invalidShapeMessage);
    expectFailureMetadata({ responseBodyShape: shape, responseBodyBytes: bytes, responseByteCountComparison: "mismatch" }, attempts);
  });

  it.each([null, "", "-1", "01", "1e3", "1.5", "9007199254740992", "10, 10", privateMarker, "9".repeat(128), "0"])(
    "classifies an absent, malformed or spoofed marker (%s) without logging its text", async (marker) => {
      const { port } = harness((response) => {
        if (marker === null) response.headers.delete(bytesHeader);
        else response.headers.set(bytesHeader, marker);
        response.headers.set("content-type", privateMime);
        return new Response(`{${privateBody}`, { headers: response.headers });
      });
      await expect(port.fetchSnapshot()).rejects.toThrow("returned invalid JSON.");
      expectFailureMetadata({
        responseBodyShape: "invalid_json", responseMimeCategory: "other",
        responseByteCountComparison: marker === null ? "missing" : marker === "0" ? "mismatch" : "invalid",
      });
      if (marker !== "0") expect(failureLogs()[0]?.details).not.toHaveProperty("responseExpectedBodyBytes");
    },
  );

  it.each([null, "", privateMarker, "0", "9007199254740991"])(
    "accepts valid snapshots with a missing, malformed or false expected count (%s)", async (marker) => {
      const { port, fetchImpl } = harness((response) => {
        if (marker === null) response.headers.delete(bytesHeader);
        else response.headers.set(bytesHeader, marker);
        response.headers.set("content-encoding", "GZIP");
        response.headers.set("content-length", privateMarker);
        return response;
      });
      await expect(port.fetchSnapshot()).resolves.toEqual(expectedSnapshot);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(failureLogs()).toEqual([]);
      expect(mocks.log).toHaveBeenCalledTimes(2);
      for (const [entry] of mocks.log.mock.calls) {
        expect(entry.details).not.toHaveProperty("responseContentEncodingCategory");
        expect(entry.details).not.toHaveProperty("responseContentLengthCategory");
      }
    },
  );

  it.each([
    [null, "missing"], ["", "other"], ["Application/JSON; private=synthetic-private-parameter", "json"],
    ["application/x-synthetic-private-mime+json", "json"], ["text/html; private=synthetic-private-parameter", "html"],
    ["text/plain; private=synthetic-private-parameter", "text"], [privateMime, "other"],
  ])("reduces MIME %s to a finite category", async (mime, category) => {
    const { port } = harness((response) => {
      const delivered = new Response(privateBody, { headers: response.headers });
      delivered.headers.set(bytesHeader, String(new TextEncoder().encode(privateBody).byteLength));
      if (mime === null) delivered.headers.delete("content-type");
      else delivered.headers.set("content-type", mime);
      return delivered;
    });
    await expect(port.fetchSnapshot()).rejects.toThrow("returned invalid JSON.");
    expectFailureMetadata({ responseMimeCategory: category });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("x-synthetic-private-mime");
  });

  it.each(["unsigned", "changed_signed_body", "replayed"] as const)("preserves real callback auth rejection: %s", async (kind) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { input } = harness();
    const fetchImpl = vi.fn<typeof fetch>(async (value, init) => {
      let request = new Request(value, init);
      if (kind === "unsigned") request.headers.delete(HOSTED_EXECUTION_SIGNATURE_HEADER);
      if (kind === "changed_signed_body") request = new Request(request, { body: "{}" });
      if (kind === "replayed") mocks.consumeNonce.mockResolvedValueOnce(false);
      const response = await postHostedDeviceSyncSnapshotForTest(request);
      expect(response.status).toBe(401);
      expect(response.headers.has(bytesHeader)).toBe(false);
      return response;
    });
    const port = createHostedWebDeviceSyncPort({ ...input, fetchImpl });
    await expect(port.fetchSnapshot()).rejects.toMatchObject({
      name: "HostedWebControlPlaneResponseError", status: 401, retryable: false,
      code: kind === "replayed" ? "HOSTED_CLOUDFLARE_CALLBACK_REPLAYED" : "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mocks.readState).not.toHaveBeenCalled();
    expect(failureLogs()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("preserves caller cancellation identity and cancels the pending body without a decoding event", async () => {
    let signalReading!: () => void;
    const reading = new Promise<void>((resolve) => { signalReading = resolve; });
    const cancel = vi.fn();
    const controller = new AbortController();
    const reason = new DOMException("synthetic cancellation", "AbortError");
    const { port, fetchImpl } = harness((response) => new Response(new ReadableStream<Uint8Array>({
      pull() { signalReading(); }, cancel,
    }), { headers: response.headers }));
    const result = port.fetchSnapshot({ signal: controller.signal });
    await reading;
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(failureLogs()).toEqual([]);
  });

  it("does not reset an exhausted response-body deadline", async () => {
    const cancel = vi.fn();
    const { port, fetchImpl } = harness((response) => {
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_001);
      return new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: response.headers });
    });
    await expect(port.fetchSnapshot()).rejects.toMatchObject({ name: "TimeoutError" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(failureLogs()).toEqual([]);
  });

  it("keeps known non-OK status and retryability authoritative, not the marker or body shape", async () => {
    const { port, fetchImpl } = harness((response) => new Response(JSON.stringify({
      error: { code: "SYNTHETIC_UNAVAILABLE", message: "Synthetic unavailable.", retryable: true },
    }), { status: 503, headers: response.headers }));
    await expect(port.fetchSnapshot()).rejects.toMatchObject({
      name: "HostedWebControlPlaneResponseError", status: 503,
      code: "SYNTHETIC_UNAVAILABLE", retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(failureLogs()).toEqual([]);
  });

  it.each([false, true])("does not enrich non-OK snapshot diagnostics (accepted=%s)", async (accepted) => {
    const { input } = harness();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{", { status: 503, headers: {
      "content-encoding": "gzip", "content-length": "1", [bytesHeader]: "1",
    } }));
    const result = fetchHostedWebControlPlaneJson({ ...input, fetchImpl,
      ...(accepted ? { acceptedStatuses: [503] } : {}),
      description: "Hosted device-sync runtime snapshot", route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.deviceSyncRuntimeSnapshot,
    });
    if (accepted) await expect(result).rejects.toMatchObject({ cause: expect.any(SyntaxError) });
    else await expect(result).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledTimes(3);
    for (const [entry] of mocks.log.mock.calls) {
      expect(entry.details).not.toHaveProperty("responseContentEncodingCategory");
      expect(entry.details).not.toHaveProperty("responseContentLengthCategory");
    }
  });

  it.each(["", "null", "[]", "invalid"])("does not add snapshot metadata or shape rejection on unrelated reads: %s", async (body) => {
    const { input } = harness();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, { headers: { [bytesHeader]: "0" } }));
    const result = fetchHostedWebControlPlaneJson({ ...input, fetchImpl,
      description: "Hosted workspace read", route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.workspaceRead });
    if (body === "invalid") await expect(result).rejects.toThrow("Hosted workspace read returned invalid JSON.");
    else await expect(result).resolves.toEqual(body === "[]" ? [] : null);
    expect(failureLogs()).toHaveLength(body === "invalid" ? 1 : 0);
    for (const [entry] of mocks.log.mock.calls) {
      expect(entry.details).not.toHaveProperty("responseByteCountComparison");
      expect(entry.details).not.toHaveProperty("responseBodyShape");
      expect(entry.details).not.toHaveProperty("responseMimeCategory");
      expect(entry.details).not.toHaveProperty("responseContentEncodingCategory");
      expect(entry.details).not.toHaveProperty("responseContentLengthCategory");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
