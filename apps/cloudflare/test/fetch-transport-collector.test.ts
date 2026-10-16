import { lookup } from "node:dns";
import { once } from "node:events";
import { createServer, type RequestListener, type Server } from "node:http";

import { Agent } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseHostedRuntimeRedactedJson } from "@murphai/hosted-execution/parsers";

import { createHostedRuntimeFetchTransportDiagnostics } from "../src/runtime-platform/fetch-transport-collector.ts";
import { createHostedWebMailboxPort } from "../src/runtime-platform/mailbox-port.ts";
import { createCloudflareHostedProviderFetch } from "../src/runtime-platform/provider-fetch.ts";

vi.mock("@murphai/hosted-execution", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/hosted-execution")>(),
  emitHostedExecutionStructuredLog: vi.fn(),
}));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function startServer(handler: RequestListener) {
  const server: Server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected local TCP server");
  // Every synthetic hostname resolves to loopback after a measurable lookup.
  const agent = new Agent({
    connections: 1,
    connect: { lookup: (_host, options, callback) => setTimeout(() => lookup("127.0.0.1", options, callback), 30) },
  });
  cleanups.push(async () => {
    await agent.destroy();
    server.close();
    await once(server, "close");
  });
  // Assigning first keeps the undici dispatcher option out of excess-property checks.
  const viaAgent = (input: RequestInfo | URL, init?: RequestInit) => {
    const options = { ...init, dispatcher: agent };
    return fetch(input, options);
  };
  return { port: address.port, viaAgent };
}

describe("first-request fetch transport diagnostics", () => {
  it("records the first real typing start without changing its response, and ignores later and non-start calls", async () => {
    const { port, viaAgent } = await startServer((request, response) => {
      request.resume();
      setTimeout(() => response.writeHead(request.method === "POST" ? 204 : 200).end(), 60);
    });
    const base = `http://linq.test:${port}/api/partner/v3`;
    const transport = vi.fn<typeof fetch>(viaAgent);
    const diagnostics = createHostedRuntimeFetchTransportDiagnostics();
    const runtimeFetch = createCloudflareHostedProviderFetch("synthetic-member", transport, {
      fetchTransportDiagnostics: diagnostics,
      providerFetchBaseUrlSource: { LINQ_API_BASE_URL: base },
      providerFetchBaseUrls: [base],
    });

    const stop = await runtimeFetch(`${base}/chats/synthetic-private-chat/typing`, { method: "DELETE" });
    expect(stop.status).toBe(200);
    expect(diagnostics.read()).toEqual({});

    const first = await runtimeFetch(`${base}/chats/synthetic-private-chat/typing`, { method: "POST" });
    expect(first.status).toBe(204);
    expect(first.bodyUsed).toBe(false);
    const recorded = diagnostics.read();
    // The earlier stop request warmed the pooled socket, so this start reuses it.
    expect(recorded).toMatchObject({
      firstTypingFetchResponseStatus: 204,
      firstTypingFetchConnectionCount: 0,
      firstTypingFetchSocketPreviouslyWritten: true,
      firstTypingFetchDnsLookupMs: null,
      firstTypingFetchTlsHandshakeMs: null,
      firstTypingFetchLastStage: "response_headers",
    });
    expect(recorded.firstTypingFetchResponseWaitMs).toBeGreaterThanOrEqual(50);
    expect(recorded.firstTypingFetchDurationMs).toBeGreaterThanOrEqual(50);

    await runtimeFetch(`${base}/chats/synthetic-private-chat/typing`, { method: "POST" });
    expect(diagnostics.read()).toEqual(recorded);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(recorded)).not.toMatch(/synthetic-private-chat|linq\.test|127\.0\.0\.1|synthetic-member/);
  });

  it("observes a cold connection's lookup and preserves typing transport failure identity", async () => {
    const { port, viaAgent } = await startServer((request, response) => {
      request.resume();
      response.writeHead(204).end();
    });
    const base = `http://linq.test:${port}/api/partner/v3`;
    const coldDiagnostics = createHostedRuntimeFetchTransportDiagnostics();
    const coldFetch = createCloudflareHostedProviderFetch("synthetic-member", viaAgent, {
        fetchTransportDiagnostics: coldDiagnostics,
        providerFetchBaseUrlSource: { LINQ_API_BASE_URL: base },
        providerFetchBaseUrls: [base],
      });
    await coldFetch(`${base}/chats/synthetic-chat/typing`, { method: "POST" });
    expect(coldDiagnostics.read()).toMatchObject({
      firstTypingFetchConnectionCount: 1,
      firstTypingFetchSocketPreviouslyWritten: false,
      firstTypingFetchLastStage: "response_headers",
    });
    expect(coldDiagnostics.read().firstTypingFetchDnsLookupMs).toBeGreaterThanOrEqual(20);

    const failure = new Error("Synthetic transport failure");
    const failedDiagnostics = createHostedRuntimeFetchTransportDiagnostics();
    const failingFetch = createCloudflareHostedProviderFetch("synthetic-member",
      async () => { throw failure; }, { fetchTransportDiagnostics: failedDiagnostics });
    await expect(failingFetch("https://api.linqapp.com/api/partner/v3/chats/synthetic-chat/typing",
      { method: "POST" })).rejects.toBe(failure);
    expect(failedDiagnostics.read()).toMatchObject({
      firstTypingFetchResponseStatus: null,
      firstTypingFetchRequestSentMs: null,
      firstTypingFetchLastStage: "fetch_started",
    });
  });

  it("records only a conversation-lane mailbox fetch and keeps the response intact", async () => {
    const mailbox = {
      consumedSeqByLane: [{ consumedSeq: "0", lane: "conversation" }],
      fetchedAt: "2026-10-16T00:00:00.000Z",
      items: [],
      maxSeqByLane: [{ lane: "conversation", maxSeq: "0" }],
      userId: "synthetic-member",
    };
    const { port, viaAgent } = await startServer((request, response) => {
      request.resume();
      setTimeout(() => response.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(mailbox)), 40);
    });
    const diagnostics = createHostedRuntimeFetchTransportDiagnostics();
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const url = new URL(new Request(input, init).url);
      return viaAgent(`http://mailbox.test:${port}${url.pathname}`, init);
    });
    const port_ = createHostedWebMailboxPort({ boundUserId: "synthetic-member", fetchImpl,
      fetchTransportDiagnostics: diagnostics, timeoutMs: 2_000, transport: { mode: "proxy" } });

    await port_.fetch({ requestId: "synthetic-system", limitPerLane: 10, lanes: [{ lane: "system", importedSeq: "0" }] });
    expect(diagnostics.read()).toEqual({});

    const fetched = await port_.fetch({ requestId: "synthetic-conversation", limitPerLane: 10,
      lanes: [{ lane: "conversation", importedSeq: "0" }] });
    expect(fetched.items).toEqual([]);
    const recorded = diagnostics.read();
    expect(recorded).toMatchObject({
      firstMailboxFetchResponseStatus: 200,
      firstMailboxFetchConnectionCount: 0,
      firstMailboxFetchSocketPreviouslyWritten: true,
      firstMailboxFetchLastStage: "response_headers",
    });
    expect(recorded.firstMailboxFetchResponseWaitMs).toBeGreaterThanOrEqual(30);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("produces bounded scalars accepted by the runtime log redaction parser", () => {
    const diagnostics = createHostedRuntimeFetchTransportDiagnostics();
    const timing = {
      startedAtEpochMs: 1_000, durationMs: 12.6, transportObserved: true, diagnosticError: false,
      requestCount: 1, connectionCount: 1, connectionTimingObserved: true, socketPreviouslyWritten: false,
      requestCreatedMs: 0.2, connectionStartedMs: 0.3, dnsLookupMs: 1.4, tcpConnectMs: 2.5, tlsHandshakeMs: 3.6,
      requestSentMs: 8.1, requestToSendMs: 7.9, waitingForHeadersMs: 4.2, fetchResolveDelayMs: 0.4,
      lastObservedStage: "response_headers", processCpuUserMs: 1, processCpuSystemMs: 1,
      processEventLoopActiveMs: 5.5, processEventLoopIdleMs: 7.1,
    };
    diagnostics.recordTypingStart(timing, new Response(null, { status: 204 }));
    diagnostics.recordConversationMailboxFetch(timing);
    const recorded = diagnostics.read();
    expect(Object.keys(recorded)).toHaveLength(28);
    expect(recorded).toMatchObject({ firstTypingFetchDurationMs: 13, firstTypingFetchTlsHandshakeMs: 4,
      firstMailboxFetchResponseStatus: null });
    expect(parseHostedRuntimeRedactedJson(recorded, "synthetic diagnostics")).toEqual(recorded);
  });
});
