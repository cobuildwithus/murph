import { channel } from "node:diagnostics_channel";
import { lookup } from "node:dns";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { TLSSocket } from "node:tls";

import { Agent } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emitHostedExecutionStructuredLog,
  sanitizeHostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  observeHostedWorkspaceSnapshotFetch,
  readHostedWorkspaceSnapshotResponseIds,
} from "../src/runtime-platform/workspace-snapshot-fetch-diagnostics.ts";
import { fetchHostedResponse } from "../src/runtime-platform/hosted-http.ts";

vi.mock("@murphai/hosted-execution", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/hosted-execution")>(),
  emitHostedExecutionStructuredLog: vi.fn(),
}));

const log = vi.mocked(emitHostedExecutionStructuredLog);
const diagnosticChannels = [
  "net.client.socket", "undici:request:create", "undici:client:sendHeaders",
  "undici:request:bodySent", "undici:request:headers",
];

afterEach(() => {
  vi.restoreAllMocks();
  log.mockClear();
});

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected local TCP server");
  return address.port;
}

function details(attempt: number) {
  const event = log.mock.calls.find(([event]) =>
    event.details?.workspaceSnapshotRestoreAttempt === attempt
  )?.[0];
  expect(event?.message).toBe("Hosted workspace snapshot response headers settled.");
  expect(event?.userId).toBeNull();
  return event!.details!;
}

describe("snapshot fetch transport diagnostics", () => {
  it("separates real delayed DNS and headers, preserves streaming, and observes connection reuse", async () => {
    const server = createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, {
          "cf-ray": "abcdef0123456789-IAD",
          "x-amz-request-id": "0123456789ABCDEF",
        });
        response.flushHeaders();
        setTimeout(() => response.end("synthetic snapshot"), 60);
      }, 70);
    });
    const port = await listen(server);
    const agent = new Agent({
      connections: 1,
      connect: {
        lookup: (_hostname, options, callback) => {
          setTimeout(() => lookup("127.0.0.1", options, callback), 50);
        },
      },
    });
    const requestInit = { method: "GET", dispatcher: agent };
    const url = `http://snapshot.test:${port}/private-object?X-Amz-Signature=synthetic-secret`;
    try {
      const first = await observeHostedWorkspaceSnapshotFetch(
        () => fetch(url, requestInit),
        { attempt: 1, timeoutMs: 2_000 },
      );
      const firstDetails = details(1);
      expect(first.bodyUsed).toBe(false);
      expect(firstDetails).toMatchObject({
        outcome: "headers_received",
        responseStatus: 200,
        transportObserved: true,
        diagnosticError: false,
        requestCount: 1,
        connectionCount: 1,
        connectionTimingObserved: true,
        socketPreviouslyWritten: false,
        tlsHandshakeMs: null,
        lastObservedStage: "response_headers",
        cfRay: "abcdef0123456789-IAD",
        r2RequestId: "0123456789ABCDEF",
      });
      expect(firstDetails.dnsLookupMs).toBeGreaterThanOrEqual(40);
      expect(firstDetails.tcpConnectMs).toBeGreaterThanOrEqual(0);
      expect(firstDetails.waitingForHeadersMs).toBeGreaterThanOrEqual(60);
      expect(firstDetails.processEventLoopIdleMs).toBeGreaterThan(0);
      expect(firstDetails.processCpuUserMs).toBeGreaterThanOrEqual(0);
      await expect(first.text()).resolves.toBe("synthetic snapshot");
      const second = await observeHostedWorkspaceSnapshotFetch(
        () => fetch(url, requestInit),
        { attempt: 2, timeoutMs: 2_000 },
      );
      expect(details(2)).toMatchObject({
        requestCount: 1,
        connectionCount: 0,
        socketPreviouslyWritten: true,
        connectionTimingObserved: false,
        dnsLookupMs: null,
        tcpConnectMs: null,
        tlsHandshakeMs: null,
      });
      await second.text();
      expect(log).toHaveBeenCalledTimes(2);
      const serialized = JSON.stringify(log.mock.calls);
      for (const privateValue of [url, "snapshot.test", "private-object", "synthetic-secret", "synthetic snapshot", "127.0.0.1"]) {
        expect(serialized).not.toContain(privateValue);
      }
      // Prove the established log sanitizer retains the new operational fields.
      expect(sanitizeHostedExecutionStructuredLogDetails(firstDetails)).toMatchObject({
        cfRay: "abcdef0123456789-IAD",
        r2RequestId: "0123456789ABCDEF",
        dnsLookupMs: firstDetails.dnsLookupMs,
        processEventLoopIdleMs: firstDetails.processEventLoopIdleMs,
      });
    } finally {
      await agent.destroy();
      server.close();
      await once(server, "close");
    }
  });

  it("isolates overlapping requests and leaves unrelated fetches unobserved", async () => {
    const server = createServer((request, response) => {
      setTimeout(() => response.writeHead(request.url === "/slow" ? 201 : 202).end(), request.url === "/slow" ? 100 : 10);
    });
    const port = await listen(server);
    const agent = new Agent();
    const requestInit = { method: "GET", dispatcher: agent };
    try {
      const responses = await Promise.all([
        observeHostedWorkspaceSnapshotFetch(() => fetch(`http://127.0.0.1:${port}/slow`, requestInit), { attempt: 1, timeoutMs: 2_000 }),
        observeHostedWorkspaceSnapshotFetch(() => fetch(`http://127.0.0.1:${port}/fast`, requestInit), { attempt: 2, timeoutMs: 2_000 }),
        fetch(`http://127.0.0.1:${port}/unrelated`, requestInit),
      ]);
      await Promise.all(responses.map((response) => response.text()));
      expect(log).toHaveBeenCalledTimes(2);
      expect(details(1)).toMatchObject({ requestCount: 1, responseStatus: 201 });
      expect(details(2)).toMatchObject({ requestCount: 1, responseStatus: 202 });
      expect(details(1).waitingForHeadersMs).toBeGreaterThanOrEqual(90);
      expect(details(2).waitingForHeadersMs).toBeLessThan(Number(details(1).waitingForHeadersMs));
    } finally {
      await agent.destroy();
      server.close();
      await once(server, "close");
    }
  });

  it("reports cancellation while waiting for headers and releases subscriptions", async () => {
    let received!: () => void;
    const requestReceived = new Promise<void>((resolve) => { received = resolve; });
    const server = createServer(() => received());
    const port = await listen(server);
    const agent = new Agent();
    const abort = new AbortController();
    const reason = new Error("synthetic cancellation");
    const requestInit = { method: "GET", dispatcher: agent, signal: abort.signal };
    const unsubscribes = diagnosticChannels.map((name) => vi.spyOn(channel(name), "unsubscribe"));
    try {
      const pending = observeHostedWorkspaceSnapshotFetch(
        () => fetch(`http://127.0.0.1:${port}`, requestInit),
        { attempt: 1, timeoutMs: 2_000 },
      );
      const rejected = expect(pending).rejects.toBe(reason);
      await requestReceived;
      await delay(30);
      abort.abort(reason);
      await rejected;
      expect(details(1)).toMatchObject({
        outcome: "fetch_failed", responseStatus: null, lastObservedStage: "request_sent",
        requestCount: 1, cfRay: null, r2RequestId: null,
      });
      expect(details(1).waitingForHeadersMs).toBeGreaterThanOrEqual(25);
      expect(unsubscribes.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
    } finally {
      await agent.destroy();
      server.close();
      await once(server, "close");
    }
  });

  it("reports failed DNS without calling it a resolved lookup or exposing error payloads", async () => {
    const agent = new Agent({
      connect: {
        lookup: (_hostname, _options, callback) => callback(
          Object.assign(new Error("synthetic-private-dns-detail"), { code: "ENOTFOUND" }),
          [],
        ),
      },
    });
    try {
      await expect(observeHostedWorkspaceSnapshotFetch(
        () => fetchHostedResponse({
          description: "Hosted workspace snapshot fetch",
          fetchImpl: (request, init) => {
            const requestInit = { ...init, method: "GET", dispatcher: agent };
            return fetch(request, requestInit);
          },
          redactedLogPath: "/workspace-snapshot-object",
          redactedResponseOrigin: "workspace_snapshot_object",
          timeoutMs: 2_000,
          url: new URL("http://snapshot.invalid/private-key?signature=synthetic-secret"),
        }),
        { attempt: 1, timeoutMs: 2_000 },
      )).rejects.toThrow("Hosted workspace snapshot fetch");
      expect(details(1)).toMatchObject({
        outcome: "fetch_failed",
        lastObservedStage: "dns_failed",
        tcpConnectMs: null,
        requestSentMs: null,
        fetchFailure: { fetchNetworkErrorCode: "ENOTFOUND" },
      });
      expect(JSON.stringify(details(1))).not.toContain("synthetic-private-dns-detail");
      expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-secret");
    } finally {
      await agent.destroy();
    }
  });

  it("captures TLS socket milestones and cleans listeners without consuming socket data", async () => {
    const socket = new TLSSocket(new Socket());
    // TLSSocket installs its own underlying-socket listener on the next tick.
    await delay(0);
    const baseline = ["lookup", "connect", "secureConnect"].map((event) => socket.listenerCount(event));
    try {
      await observeHostedWorkspaceSnapshotFetch(async () => {
        const request = {};
        channel("undici:request:create").publish({ request });
        channel("net.client.socket").publish({ socket });
        await delay(10);
        socket.emit("lookup");
        await delay(10);
        socket.emit("connect");
        await delay(20);
        socket.emit("secureConnect");
        channel("undici:client:sendHeaders").publish({ request, socket });
        channel("undici:request:bodySent").publish({ request });
        channel("undici:request:headers").publish({ request });
        return new Response();
      }, { attempt: 1, timeoutMs: 2_000 });
      expect(details(1).tlsHandshakeMs).toBeGreaterThanOrEqual(15);
      expect(["lookup", "connect", "secureConnect"].map((event) => socket.listenerCount(event))).toEqual(baseline);
      expect(socket.listenerCount("data")).toBe(0);
    } finally {
      socket.destroy();
    }
  });

  it("marks unavailable transport data and excludes malformed correlation headers", async () => {
    const response = new Response("synthetic-private-body", {
      status: 503,
      headers: {
        "cf-ray": "https://private.invalid/object?secret=value",
        "x-amz-request-id": "x".repeat(129),
      },
    });
    await expect(observeHostedWorkspaceSnapshotFetch(
      async () => response, { attempt: 1, timeoutMs: 100 },
    )).resolves.toBe(response);
    expect(details(1)).toMatchObject({
      responseStatus: 503, transportObserved: false, connectionTimingObserved: false,
      dnsLookupMs: null, tcpConnectMs: null, tlsHandshakeMs: null,
      requestSentMs: null, waitingForHeadersMs: null, cfRay: null, r2RequestId: null,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-private-body");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret=value");
    expect(readHostedWorkspaceSnapshotResponseIds()).toEqual({ cfRay: null, r2RequestId: null });
  });

  it("preserves fetch outcomes even if the telemetry sink fails", async () => {
    log.mockImplementation(() => { throw new Error("synthetic telemetry failure"); });
    const response = new Response();
    await expect(observeHostedWorkspaceSnapshotFetch(
      async () => response, { attempt: 1, timeoutMs: 100 },
    )).resolves.toBe(response);
    const failure = new TypeError("synthetic network failure");
    await expect(observeHostedWorkspaceSnapshotFetch(
      async () => { throw failure; }, { attempt: 2, timeoutMs: 100 },
    )).rejects.toBe(failure);
  });
});
