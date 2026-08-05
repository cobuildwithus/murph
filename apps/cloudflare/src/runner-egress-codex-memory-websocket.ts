import {
  HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES,
  hasHostedCodexMemoryBillableUsage,
  parseHostedCodexMemoryClientFrame,
  parseHostedCodexMemoryServerFrame,
  type HostedCodexMemoryUsage,
  type HostedCodexMemoryProviderRequestOutcome,
  type HostedCodexMemoryRequestMetadata,
} from "./runner-egress-codex-memory.ts";

export type HostedCodexMemoryWebSocketMessage = ArrayBuffer | string;

export interface HostedCodexMemorySocketPort {
  accept(): void;
  close(code?: number, reason?: string): void;
  onClose(listener: (event: { code: number; reason: string }) => void): void;
  onError(listener: () => void): void;
  onMessage(listener: (data: HostedCodexMemoryWebSocketMessage) => void): void;
  send(data: HostedCodexMemoryWebSocketMessage): void;
}

export interface HostedCodexMemoryWebSocketRelayController {
  drain(): Promise<void>;
}

export interface HostedCodexMemoryWebSocketCompletion {
  providerRequestOutcome: HostedCodexMemoryProviderRequestOutcome;
  requestMetadata: HostedCodexMemoryRequestMetadata;
  usage: HostedCodexMemoryUsage;
}

type HostedCodexMemoryWebSocketFailurePhase =
  | "persistence"
  | "protocol"
  | "transport";

const CODEX_MEMORY_PROTOCOL_CLOSE_CODE = 1002;
const CODEX_MEMORY_INTERNAL_CLOSE_CODE = 1011;
const CODEX_MEMORY_TOO_LARGE_CLOSE_CODE = 1009;
const CODEX_MEMORY_PROTOCOL_CLOSE_REASON = "Memory WebSocket protocol error";
const CODEX_MEMORY_PERSISTENCE_CLOSE_REASON = "Memory usage recording failed";
const CODEX_MEMORY_RELAY_CLOSE_REASON = "Memory WebSocket relay failed";
const CODEX_MEMORY_TOO_LARGE_CLOSE_REASON = "Memory WebSocket frame too large";

export function startHostedCodexMemoryWebSocketRelay(input: {
  defer?: (promise: Promise<void>) => void;
  downstream: HostedCodexMemorySocketPort;
  persistUsage(
    completion: HostedCodexMemoryWebSocketCompletion,
  ): Promise<void>;
  reportFailure?: (failure: {
    phase: HostedCodexMemoryWebSocketFailurePhase;
  }) => void;
  upstream: HostedCodexMemorySocketPort;
}): HostedCodexMemoryWebSocketRelayController {
  let activeRequest: HostedCodexMemoryRequestMetadata | null = null;
  let downstreamClosed = false;
  let upstreamClosed = false;
  let stopped = false;
  let queue = Promise.resolve();

  const reportFailure = (
    phase: HostedCodexMemoryWebSocketFailurePhase,
  ): void => {
    try {
      input.reportFailure?.({ phase });
    } catch {
      // Diagnostics must never interfere with relay shutdown.
    }
  };

  const closeDownstream = (code: number, reason: string): void => {
    if (downstreamClosed) return;
    downstreamClosed = true;
    safeClose(input.downstream, code, reason);
  };
  const closeUpstream = (code: number, reason: string): void => {
    if (upstreamClosed) return;
    upstreamClosed = true;
    safeClose(input.upstream, code, reason);
  };
  const fail = (
    phase: HostedCodexMemoryWebSocketFailurePhase,
    code: number,
    reason: string,
  ): void => {
    if (stopped) return;
    stopped = true;
    reportFailure(phase);
    closeDownstream(code, reason);
    closeUpstream(code, reason);
  };
  const enqueue = (
    work: () => Promise<void> | void,
    runAfterStop = false,
  ): void => {
    const next = queue.then(async () => {
      if (runAfterStop || !stopped) {
        await work();
      }
    });
    queue = next.catch(() => {
      fail(
        "transport",
        CODEX_MEMORY_INTERNAL_CLOSE_CODE,
        CODEX_MEMORY_RELAY_CLOSE_REASON,
      );
    });
  };
  const forwardToUpstream = (
    data: HostedCodexMemoryWebSocketMessage,
  ): void => {
    if (!upstreamClosed) input.upstream.send(data);
  };
  const forwardToDownstream = (
    data: HostedCodexMemoryWebSocketMessage,
  ): void => {
    if (!downstreamClosed) input.downstream.send(data);
  };

  try {
    input.downstream.accept();
    input.upstream.accept();
  } catch {
    fail(
      "transport",
      CODEX_MEMORY_INTERNAL_CLOSE_CODE,
      CODEX_MEMORY_RELAY_CLOSE_REASON,
    );
  }

  input.downstream.onMessage((data) => {
    enqueue(() => {
      if (!hasAllowedFrameSize(data)) {
        fail(
          "protocol",
          CODEX_MEMORY_TOO_LARGE_CLOSE_CODE,
          CODEX_MEMORY_TOO_LARGE_CLOSE_REASON,
        );
        return;
      }
      if (typeof data === "string") {
        const frame = parseHostedCodexMemoryClientFrame(data);
        if (
          frame.kind === "invalid-response-create"
          || (frame.kind === "response-create" && activeRequest !== null)
        ) {
          fail(
            "protocol",
            CODEX_MEMORY_PROTOCOL_CLOSE_CODE,
            CODEX_MEMORY_PROTOCOL_CLOSE_REASON,
          );
          return;
        }
        if (frame.kind === "response-create") {
          activeRequest = frame.metadata;
        }
      }
      forwardToUpstream(data);
    });
  });

  input.upstream.onMessage((data) => {
    if (stopped) return;
    enqueue(async () => {
      if (!hasAllowedFrameSize(data)) {
        fail(
          "protocol",
          CODEX_MEMORY_TOO_LARGE_CLOSE_CODE,
          CODEX_MEMORY_TOO_LARGE_CLOSE_REASON,
        );
        return;
      }
      if (typeof data !== "string") {
        forwardToDownstream(data);
        return;
      }

      const frame = parseHostedCodexMemoryServerFrame(data);
      if (frame.kind === "invalid-response-terminal") {
        fail(
          "protocol",
          CODEX_MEMORY_PROTOCOL_CLOSE_CODE,
          CODEX_MEMORY_PROTOCOL_CLOSE_REASON,
        );
        return;
      }
      if (frame.kind === "terminal-error") {
        activeRequest = null;
        forwardToDownstream(data);
        return;
      }
      if (frame.kind !== "response-terminal") {
        forwardToDownstream(data);
        return;
      }
      if (activeRequest === null) {
        fail(
          "protocol",
          CODEX_MEMORY_PROTOCOL_CLOSE_CODE,
          CODEX_MEMORY_PROTOCOL_CLOSE_REASON,
        );
        return;
      }

      const requestMetadata = activeRequest;
      activeRequest = null;
      const { providerRequestOutcome, usage } = frame.terminal;
      if (usage === null) {
        if (
          providerRequestOutcome === "succeeded"
          && requestMetadata.usageRequired
        ) {
          fail(
            "protocol",
            CODEX_MEMORY_PROTOCOL_CLOSE_CODE,
            CODEX_MEMORY_PROTOCOL_CLOSE_REASON,
          );
          return;
        }
        forwardToDownstream(data);
        return;
      }

      if (hasHostedCodexMemoryBillableUsage(usage)) {
        const persistence = input.persistUsage({
          providerRequestOutcome,
          requestMetadata,
          usage,
        });
        try {
          input.defer?.(persistence.catch(() => undefined));
        } catch {
          // Lifecycle ownership must not change accounting behavior.
        }
        try {
          await persistence;
        } catch {
          if (stopped) {
            reportFailure("persistence");
          } else {
            fail(
              "persistence",
              CODEX_MEMORY_INTERNAL_CLOSE_CODE,
              CODEX_MEMORY_PERSISTENCE_CLOSE_REASON,
            );
          }
          return;
        }
      }
      if (!stopped) {
        forwardToDownstream(data);
      }
    }, true);
  });

  input.downstream.onClose(({ code, reason }) => {
    if (downstreamClosed) return;
    downstreamClosed = true;
    stopped = true;
    const close = sanitizePeerClose(code, reason);
    closeUpstream(close.code, close.reason);
    safeClose(input.downstream, close.code, close.reason);
  });
  input.upstream.onClose(({ code, reason }) => {
    if (upstreamClosed) return;
    upstreamClosed = true;
    const close = sanitizePeerClose(code, reason);
    // Finish the provider-facing handshake immediately, then preserve message
    // ordering by closing Codex only after queued terminal accounting completes.
    safeClose(input.upstream, close.code, close.reason);
    enqueue(() => {
      stopped = true;
      closeDownstream(close.code, close.reason);
    });
  });
  input.downstream.onError(() => {
    fail(
      "transport",
      CODEX_MEMORY_INTERNAL_CLOSE_CODE,
      CODEX_MEMORY_RELAY_CLOSE_REASON,
    );
  });
  input.upstream.onError(() => {
    enqueue(() => {
      fail(
        "transport",
        CODEX_MEMORY_INTERNAL_CLOSE_CODE,
        CODEX_MEMORY_RELAY_CLOSE_REASON,
      );
    });
  });

  return {
    drain: async () => {
      await queue;
    },
  };
}

export function relayHostedCodexMemoryWebSocketUpgrade(input: {
  defer?: (promise: Promise<void>) => void;
  persistUsage(
    completion: HostedCodexMemoryWebSocketCompletion,
  ): Promise<void>;
  reportFailure?: (failure: {
    phase: HostedCodexMemoryWebSocketFailurePhase;
  }) => void;
  upstreamResponse: Response;
}): Response {
  const upstreamSocket = input.upstreamResponse.webSocket;
  if (input.upstreamResponse.status !== 101 || !upstreamSocket) {
    return input.upstreamResponse;
  }

  const pair = new WebSocketPair();
  const downstreamClient = pair[0];
  const downstreamServer = pair[1];
  startHostedCodexMemoryWebSocketRelay({
    ...(input.defer ? { defer: input.defer } : {}),
    downstream: adaptCloudflareWebSocket(downstreamServer),
    persistUsage: input.persistUsage,
    ...(input.reportFailure ? { reportFailure: input.reportFailure } : {}),
    upstream: adaptCloudflareWebSocket(upstreamSocket),
  });

  return new Response(null, {
    headers: copyWebSocketApplicationHeaders(input.upstreamResponse.headers),
    status: 101,
    webSocket: downstreamClient,
  });
}

function adaptCloudflareWebSocket(
  socket: WebSocket,
): HostedCodexMemorySocketPort {
  socket.binaryType = "arraybuffer";
  return {
    accept: () => {
      socket.accept({ allowHalfOpen: true });
    },
    close: (code, reason) => {
      socket.close(code, reason);
    },
    onClose: (listener) => {
      socket.addEventListener("close", (event) => {
        listener({ code: event.code, reason: event.reason });
      });
    },
    onError: (listener) => {
      socket.addEventListener("error", listener);
    },
    onMessage: (listener) => {
      socket.addEventListener("message", (event) => {
        listener(event.data as HostedCodexMemoryWebSocketMessage);
      });
    },
    send: (data) => {
      socket.send(data);
    },
  };
}

function copyWebSocketApplicationHeaders(headers: Headers): Headers {
  const copied = new Headers(headers);
  for (const name of [
    "connection",
    "content-encoding",
    "content-length",
    "sec-websocket-accept",
    "sec-websocket-extensions",
    "upgrade",
  ]) {
    copied.delete(name);
  }
  return copied;
}

function hasAllowedFrameSize(
  data: HostedCodexMemoryWebSocketMessage,
): boolean {
  if (typeof data !== "string") {
    return data.byteLength <= HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES;
  }
  if (data.length > HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES) {
    return false;
  }
  return new TextEncoder().encode(data).byteLength
    <= HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES;
}

function sanitizePeerClose(
  code: number,
  reason: string,
): { code: number; reason: string } {
  const safeCode = isForwardableCloseCode(code)
    ? code
    : CODEX_MEMORY_INTERNAL_CLOSE_CODE;
  const safeReason = truncateUtf8(reason, 123);
  return { code: safeCode, reason: safeReason };
}

function isForwardableCloseCode(code: number): boolean {
  return (
    (code >= 1_000
      && code <= 1_014
      && code !== 1_004
      && code !== 1_005
      && code !== 1_006)
    || (code >= 3_000 && code <= 4_999)
  ) && code !== 1_015;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) {
    return value;
  }

  let result = "";
  for (const character of value) {
    if (encoder.encode(result + character).byteLength > maxBytes) {
      break;
    }
    result += character;
  }
  return result;
}

function safeClose(
  socket: HostedCodexMemorySocketPort,
  code: number,
  reason: string,
): void {
  try {
    socket.close(code, reason);
  } catch {
    try {
      socket.close();
    } catch {
      // Closing is best effort after the relay has entered a terminal state.
    }
  }
}
