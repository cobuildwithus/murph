import { AsyncLocalStorage } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";
import { Socket } from "node:net";
import { performance } from "node:perf_hooks";
import { TLSSocket } from "node:tls";

import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";

import { buildHostedRuntimeSafeErrorMetadata } from "./diagnostics.ts";

type SocketTiming = {
  startedAt: number;
  lookupAt?: number;
  lookupFailed?: boolean;
  connectedAt?: number;
  secureAt?: number;
};

type FetchObservation = {
  active: boolean;
  requestCount: number;
  connectionCount: number;
  diagnosticError: boolean;
  requestCreatedAt?: number;
  requestSentAt?: number;
  headersAt?: number;
  socket?: SocketTiming;
  socketAssigned?: boolean;
  lastCreatedSocket?: SocketTiming;
  socketPreviouslyWritten?: boolean;
};

// Context identifies the exact fetch without retaining signed URLs. Pooled socket
// callbacks may use a different context, so request identity owns later events.
const fetchContext = new AsyncLocalStorage<FetchObservation>();

export async function observeHostedWorkspaceSnapshotFetch(
  run: () => Promise<Response>,
  input: { attempt: number; timeoutMs: number },
): Promise<Response> {
  const startedAt = performance.now();
  const cpuStarted = process.cpuUsage();
  const loopStarted = performance.eventLoopUtilization();
  const state: FetchObservation = {
    active: true,
    requestCount: 0,
    connectionCount: 0,
    diagnosticError: false,
  };
  const dispose = subscribeToSnapshotFetch(state);
  let response: Response | undefined;
  let failure: unknown;
  try {
    response = await fetchContext.run(state, run);
    return response;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    state.active = false;
    dispose();
    // Telemetry cannot turn a successful restore into a failed/retried download.
    try {
      const settledAt = performance.now();
      const cpu = process.cpuUsage(cpuStarted);
      const loop = performance.eventLoopUtilization(loopStarted);
      const socket = state.socket
        ?? (!state.socketAssigned && state.connectionCount === 1 ? state.lastCreatedSocket : undefined);
      const { startedAt: connectionStartedAt, lookupAt, connectedAt, secureAt } = socket ?? {};
      emitHostedExecutionStructuredLog({
        component: "hosted.runtime.workspace-snapshot",
        details: {
          workspaceSnapshotRestoreAttempt: input.attempt,
          workspaceSnapshotRestoreStep: "object_fetch",
          outcome: response ? "headers_received" : "fetch_failed",
          responseStatus: response?.status ?? null,
          fetchFailure: response ? null : buildHostedRuntimeSafeErrorMetadata(failure, {
            includeSafeErrorText: false,
          }),
          ...readHostedWorkspaceSnapshotResponseIds(response?.headers),
          timeoutMs: input.timeoutMs,
          durationMs: elapsed(startedAt, settledAt),
          transportObserved: state.requestCount > 0,
          diagnosticError: state.diagnosticError,
          requestCount: state.requestCount,
          connectionCount: state.connectionCount,
          connectionTimingObserved: socket !== undefined,
          socketPreviouslyWritten: state.socketPreviouslyWritten ?? null,
          requestCreatedMs: elapsed(startedAt, state.requestCreatedAt),
          connectionStartedMs: elapsed(startedAt, connectionStartedAt),
          dnsLookupMs: elapsed(connectionStartedAt, lookupAt),
          tcpConnectMs: elapsed(lookupAt ?? connectionStartedAt, connectedAt),
          tlsHandshakeMs: elapsed(connectedAt, secureAt),
          requestSentMs: elapsed(startedAt, state.requestSentAt),
          requestToSendMs: elapsed(state.requestCreatedAt, state.requestSentAt),
          waitingForHeadersMs: elapsed(state.requestSentAt, state.headersAt ?? settledAt),
          fetchResolveDelayMs: elapsed(state.headersAt, settledAt),
          lastObservedStage: lastObservedStage(state, socket),
          processCpuUserMs: cpu.user / 1_000,
          processCpuSystemMs: cpu.system / 1_000,
          processEventLoopActiveMs: loop.active,
          processEventLoopIdleMs: loop.idle,
        },
        level: response?.ok ? "info" : "warn",
        message: "Hosted workspace snapshot response headers settled.",
        phase: "runtime.starting",
        userId: null,
      });
    } catch {
      // The existing fetch result/error is the sole restore outcome.
    }
  }
}

export function readHostedWorkspaceSnapshotResponseIds(headers?: Headers) {
  return {
    cfRay: boundedHeader(headers, "cf-ray", /^[a-f0-9]{16,32}(?:-[A-Z]{3})?$/i),
    r2RequestId: boundedHeader(headers, "x-amz-request-id", /^[a-z0-9-]{1,128}$/i),
  };
}

function boundedHeader(headers: Headers | undefined, name: string, pattern: RegExp): string | null {
  const value = headers?.get(name);
  return value && value.length <= 128 && pattern.test(value) ? value : null;
}

function elapsed(start: number | undefined, end: number | undefined): number | null {
  return start === undefined || end === undefined ? null : Math.max(0, end - start);
}

function lastObservedStage(state: FetchObservation, socket?: SocketTiming): string {
  if (state.headersAt !== undefined) return "response_headers";
  if (state.requestSentAt !== undefined) return "request_sent";
  if (socket?.secureAt !== undefined) return "tls_connected";
  if (socket?.connectedAt !== undefined) return "tcp_connected";
  if (socket?.lookupFailed) return "dns_failed";
  if (socket?.lookupAt !== undefined) return "dns_resolved";
  if (socket) return "connection_started";
  return state.requestCount > 0 ? "request_created" : "fetch_started";
}

function subscribeToSnapshotFetch(state: FetchObservation): () => void {
  const requests = new WeakSet<object>();
  const sockets = new WeakMap<object, SocketTiming>();
  const cleanups: Array<() => void> = [];
  const subscribe = (name: string, observe: (event: Record<string, unknown>) => void) => {
    const diagnosticChannel = channel(name);
    const listener = (event: unknown) => {
      if (!state.active || !event || typeof event !== "object") return;
      try {
        observe(event as Record<string, unknown>);
      } catch {
        // Diagnostic subscribers otherwise propagate exceptions into the runtime.
        state.diagnosticError = true;
      }
    };
    diagnosticChannel.subscribe(listener);
    cleanups.push(() => diagnosticChannel.unsubscribe(listener));
  };
  subscribe("undici:request:create", ({ request }) => {
    if (fetchContext.getStore() !== state || !request || typeof request !== "object") return;
    requests.add(request);
    state.requestCount += 1;
    state.requestCreatedAt = performance.now();
    state.requestSentAt = undefined;
    state.headersAt = undefined;
    state.socket = undefined;
    state.socketAssigned = false;
    state.socketPreviouslyWritten = undefined;
  });
  subscribe("net.client.socket", ({ socket }) => {
    if (fetchContext.getStore() !== state || !(socket instanceof Socket)) return;
    state.connectionCount += 1;
    // Bound listeners even for a custom dispatcher that opens many sockets.
    if (state.connectionCount > 4) return;
    const timing: SocketTiming = { startedAt: performance.now() };
    state.lastCreatedSocket = timing;
    sockets.set(socket, timing);
    const lookup = (error?: Error | null) => {
      timing.lookupAt ??= performance.now();
      timing.lookupFailed = !!error;
    };
    const connected = () => { timing.connectedAt = performance.now(); };
    const secure = () => { timing.secureAt = performance.now(); };
    socket.once("lookup", lookup);
    socket.once("connect", connected);
    if (socket instanceof TLSSocket) socket.once("secureConnect", secure);
    cleanups.push(() => {
      socket.off("lookup", lookup);
      socket.off("connect", connected);
      socket.off("secureConnect", secure);
    });
  });
  subscribe("undici:client:sendHeaders", ({ request, socket }) => {
    if (!request || typeof request !== "object" || !requests.has(request)) return;
    if (socket instanceof Socket) {
      state.socketAssigned = true;
      state.socket = sockets.get(socket);
      state.socketPreviouslyWritten = socket.bytesWritten > 0;
    }
  });
  subscribe("undici:request:bodySent", ({ request }) => {
    if (request && typeof request === "object" && requests.has(request)) {
      state.requestSentAt = performance.now();
    }
  });
  subscribe("undici:request:headers", ({ request }) => {
    if (request && typeof request === "object" && requests.has(request)) {
      state.headersAt = performance.now();
    }
  });
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
