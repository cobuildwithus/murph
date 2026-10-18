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

async function startServer(handler: RequestListener, connections = 1) {
  const server: Server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected local TCP server");
  // Every synthetic hostname resolves to loopback after a measurable lookup.
  const agent = new Agent({
    connections,
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

  it("keeps the first-started typing start when a later start settles first", async () => {
    const { port, viaAgent } = await startServer((request, response) => {
      request.resume();
      const slow = request.url?.includes("synthetic-slow-chat") === true;
      setTimeout(() => response.writeHead(204).end(), slow ? 150 : 5);
    }, 2);
    const base = `http://linq.test:${port}/api/partner/v3`;
    const diagnostics = createHostedRuntimeFetchTransportDiagnostics();
    const transport = vi.fn<typeof fetch>(viaAgent);
    const runtimeFetch = createCloudflareHostedProviderFetch("synthetic-member", transport, {
      fetchTransportDiagnostics: diagnostics,
      providerFetchBaseUrlSource: { LINQ_API_BASE_URL: base },
      providerFetchBaseUrls: [base],
    });
    // Imports start typing without awaiting it, so a second chat can overlap.
    const settled: string[] = [];
    const slow = runtimeFetch(`${base}/chats/synthetic-slow-chat/typing`, { method: "POST" })
      .then((response) => { settled.push("slow"); return response; });
    const fast = runtimeFetch(`${base}/chats/synthetic-fast-chat/typing`, { method: "POST" })
      .then((response) => { settled.push("fast"); return response; });
    const [slowResponse, fastResponse] = await Promise.all([slow, fast]);
    expect(settled).toEqual(["fast", "slow"]);
    expect([slowResponse.status, fastResponse.status]).toEqual([204, 204]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(diagnostics.read().firstTypingFetchResponseWaitMs).toBeGreaterThanOrEqual(120);
  });

  it("keeps the first-started conversation mailbox fetch when a later fetch settles first", async () => {
    const mailbox = {
      consumedSeqByLane: [{ consumedSeq: "0", lane: "conversation" }],
      fetchedAt: "2026-10-16T00:00:00.000Z",
      items: [],
      maxSeqByLane: [{ lane: "conversation", maxSeq: "0" }],
      userId: "synthetic-member",
    };
    let requestCount = 0;
    const { port, viaAgent } = await startServer((request, response) => {
      request.resume();
      requestCount += 1;
      setTimeout(() => response.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(mailbox)), requestCount === 1 ? 150 : 5);
    }, 2);
    const diagnostics = createHostedRuntimeFetchTransportDiagnostics();
    const mailboxPort = createHostedWebMailboxPort({
      boundUserId: "synthetic-member",
      fetchImpl: (input, init) => viaAgent(
        `http://mailbox.test:${port}${new URL(new Request(input, init).url).pathname}`, init),
      fetchTransportDiagnostics: diagnostics,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });
    const request = { limitPerLane: 10, lanes: [{ lane: "conversation" as const, importedSeq: "0" }] };
    const settled: string[] = [];
    await Promise.all([
      mailboxPort.fetch({ ...request, requestId: "synthetic-first" }).then(() => settled.push("first")),
      new Promise((resolve) => setTimeout(resolve, 10))
        .then(() => mailboxPort.fetch({ ...request, requestId: "synthetic-second" }))
        .then(() => settled.push("second")),
    ]);
    expect(settled).toEqual(["second", "first"]);
    expect(requestCount).toBe(2);
    expect(diagnostics.read().firstMailboxFetchResponseWaitMs).toBeGreaterThanOrEqual(120);
  });

  describe("per-pass conversation read timing", () => {
    const emptyMailbox = JSON.stringify({
      consumedSeqByLane: [{ consumedSeq: "0", lane: "conversation" }],
      fetchedAt: "2026-10-16T00:00:00.000Z",
      items: [],
      maxSeqByLane: [{ lane: "conversation", maxSeq: "0" }],
      userId: "synthetic-member",
    });
    const conversation = { limitPerLane: 10, lanes: [{ lane: "conversation" as const, importedSeq: "0" }] };
    async function mailboxPortWith(
      delays: number[],
      options: { connections?: number; delayForBody?: (body: string) => number; destroyFirst?: boolean } = {},
    ) {
      let requestCount = 0;
      const { port, viaAgent } = await startServer((request, response) => {
        requestCount += 1;
        const ordinal = requestCount;
        if (options.destroyFirst && ordinal === 1) {
          request.socket.destroy();
          return;
        }
        let body = "";
        request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        request.on("end", () => {
          const delay = options.delayForBody?.(body) ?? delays[ordinal - 1] ?? 5;
          setTimeout(() => response.writeHead(200, { "content-type": "application/json" }).end(emptyMailbox), delay);
        });
      }, options.connections ?? 1);
      const diagnostics = createHostedRuntimeFetchTransportDiagnostics();
      const fetchImpl = vi.fn<typeof fetch>((input, init) => viaAgent(
        `http://mailbox.test:${port}${new URL(new Request(input, init).url).pathname}`, init));
      const mailboxPort = createHostedWebMailboxPort({ boundUserId: "synthetic-member", fetchImpl,
        fetchTransportDiagnostics: diagnostics, timeoutMs: 2_000, transport: { mode: "proxy" } });
      return { diagnostics, fetchImpl, mailboxPort, requests: () => requestCount };
    }

    it("gives a later read its own timing and keeps the invocation claim on the first read", async () => {
      const { diagnostics, fetchImpl, mailboxPort } = await mailboxPortWith([5, 150]);
      const first = await mailboxPort.fetch({ ...conversation, requestId: "synthetic-pass-1" });
      const second = await mailboxPort.fetch({ ...conversation, requestId: "synthetic-pass-2" });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(first.transportTiming).toMatchObject({ passMailboxFetchAttemptCount: 1,
        passMailboxFetchConnectionCount: 1, passMailboxFetchSocketPreviouslyWritten: false });
      expect(second.transportTiming).toMatchObject({ passMailboxFetchAttemptCount: 1,
        passMailboxFetchConnectionCount: 0, passMailboxFetchSocketPreviouslyWritten: true });
      expect(first.transportTiming?.passMailboxFetchResponseWaitMs).toBeLessThan(100);
      expect(second.transportTiming?.passMailboxFetchResponseWaitMs).toBeGreaterThanOrEqual(120);
      // The invocation-first fields stay scoped to the first read.
      expect(diagnostics.read().firstMailboxFetchResponseWaitMs)
        .toBe(first.transportTiming?.passMailboxFetchResponseWaitMs);
      expect(diagnostics.read().firstMailboxFetchStartedAtEpochMs)
        .toBe(first.transportTiming?.passMailboxFetchStartedAtEpochMs);
    });

    it("keeps overlapping reads' timings with the read that made them", async () => {
      const { mailboxPort } = await mailboxPortWith([150, 5], { connections: 2 });
      const settled: string[] = [];
      const [slow, fast] = await Promise.all([
        mailboxPort.fetch({ ...conversation, requestId: "synthetic-slow" }).then((result) => {
          settled.push("slow"); return result;
        }),
        new Promise((resolve) => setTimeout(resolve, 10))
          .then(() => mailboxPort.fetch({ ...conversation, requestId: "synthetic-fast" }))
          .then((result) => { settled.push("fast"); return result; }),
      ]);
      expect(settled).toEqual(["fast", "slow"]);
      expect(slow.transportTiming?.passMailboxFetchResponseWaitMs).toBeGreaterThanOrEqual(120);
      expect(fast.transportTiming?.passMailboxFetchResponseWaitMs).toBeLessThan(100);
    });

    it("reports the failed first attempt and the attempt count when a retry delivers the read", async () => {
      const { fetchImpl, mailboxPort, requests } = await mailboxPortWith([5, 5], { destroyFirst: true });
      const result = await mailboxPort.fetch({ ...conversation, requestId: "synthetic-retry" });
      expect(result.items).toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(requests()).toBe(2);
      expect(result.transportTiming).toMatchObject({
        passMailboxFetchAttemptCount: 2,
        passMailboxFetchResponseStatus: null,
      });
      expect(result.transportTiming?.passMailboxFetchLastStage).not.toBe("response_headers");
    });

    it("omits read timing for a system-only read and isolates a canceled read from the next one", async () => {
      const { mailboxPort } = await mailboxPortWith([], {
        connections: 2,
        delayForBody: (body) => body.includes("synthetic-canceled") ? 400 : 5,
      });
      const system = await mailboxPort.fetch({ limitPerLane: 10, requestId: "synthetic-system",
        lanes: [{ lane: "system", importedSeq: "0" }] });
      expect(system).not.toHaveProperty("transportTiming");
      const controller = new AbortController();
      const canceled = mailboxPort.fetch({ ...conversation, requestId: "synthetic-canceled" },
        { signal: controller.signal });
      setTimeout(() => controller.abort(new Error("synthetic cancel")), 30);
      await expect(canceled).rejects.toThrow();
      const next = await mailboxPort.fetch({ ...conversation, requestId: "synthetic-next" });
      expect(next.transportTiming).toMatchObject({ passMailboxFetchAttemptCount: 1,
        passMailboxFetchLastStage: "response_headers", passMailboxFetchResponseStatus: 200 });
      expect(next.transportTiming?.passMailboxFetchResponseWaitMs).toBeLessThan(100);
    });

    it("emits read timing keys the runtime log redaction parser accepts", async () => {
      const { mailboxPort } = await mailboxPortWith([5]);
      const result = await mailboxPort.fetch({ ...conversation, requestId: "synthetic-redaction" });
      const timing = result.transportTiming!;
      expect(Object.keys(timing)).toHaveLength(15);
      expect(parseHostedRuntimeRedactedJson(timing, "synthetic read timing")).toEqual(timing);
    });
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
    diagnostics.claimTypingStart()?.(timing, new Response(null, { status: 204 }));
    diagnostics.claimConversationMailboxFetch()?.(timing);
    expect(diagnostics.claimTypingStart()).toBeNull();
    expect(diagnostics.claimConversationMailboxFetch()).toBeNull();
    const recorded = diagnostics.read();
    expect(Object.keys(recorded)).toHaveLength(28);
    expect(recorded).toMatchObject({ firstTypingFetchDurationMs: 13, firstTypingFetchTlsHandshakeMs: 4,
      firstMailboxFetchResponseStatus: null });
    expect(parseHostedRuntimeRedactedJson(recorded, "synthetic diagnostics")).toEqual(recorded);
  });
});
