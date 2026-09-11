import {
  HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES,
  hasHostedCodexMemoryBillableUsage,
  parseHostedCodexMemoryClientFrame,
  parseHostedCodexMemoryServerFrame,
  type HostedCodexMemoryUsage,
  type HostedCodexMemoryProviderRequestOutcome,
  type HostedCodexMemoryRequestMetadata,
} from "./runner-egress-codex-memory.ts";

export type HostedOpenAiWebSocketMessage = ArrayBuffer | string;

export interface HostedOpenAiSocketPort {
  accept(): void;
  close(code?: number, reason?: string): void;
  onClose(listener: (event: { code: number; reason: string }) => void): void;
  onError(listener: () => void): void;
  onMessage(listener: (data: HostedOpenAiWebSocketMessage) => void): void;
  send(data: HostedOpenAiWebSocketMessage): void;
}

export interface HostedOpenAiWebSocketRelayController {
  drain(): Promise<void>;
}

export interface HostedCodexMemoryWebSocketCompletion {
  providerRequestOutcome: HostedCodexMemoryProviderRequestOutcome;
  requestMetadata: HostedCodexMemoryRequestMetadata;
  usage: HostedCodexMemoryUsage;
}

export type HostedOpenAiWebSocketFailurePhase =
  | "persistence"
  | "protocol"
  | "transport";

const RESPONSES_PROTOCOL_CLOSE_CODE = 1002;
const RESPONSES_INTERNAL_CLOSE_CODE = 1011;
const RESPONSES_TOO_LARGE_CLOSE_CODE = 1009;
const RESPONSES_PROTOCOL_CLOSE_REASON = "Responses WebSocket protocol error";
const RESPONSES_RELAY_CLOSE_REASON = "Responses WebSocket relay failed";
const RESPONSES_TOO_LARGE_CLOSE_REASON = "Responses WebSocket frame too large";

export function startHostedOpenAiResponsesWebSocketRelay(input: {
  authorizeClientFrame?: (
    data: HostedOpenAiWebSocketMessage,
  ) => Promise<Response | null>;
  defer?: (promise: Promise<void>) => void;
  downstream: HostedOpenAiSocketPort;
  persistUsage?(
    completion: HostedCodexMemoryWebSocketCompletion,
  ): Promise<void>;
  reportFailure?: (failure: {
    phase: HostedOpenAiWebSocketFailurePhase;
  }) => void;
  upstream: HostedOpenAiSocketPort;
}): HostedOpenAiWebSocketRelayController {
  let activeRequest: HostedCodexMemoryRequestMetadata | null = null;
  let downstreamClosed = false;
  let upstreamClosed = false;
  let stopped = false;
  let queue = Promise.resolve();
  let pendingClientBytes = 0;

  const reportFailure = (
    phase: HostedOpenAiWebSocketFailurePhase,
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
    phase: HostedOpenAiWebSocketFailurePhase,
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
  ): Promise<void> => {
    const next = queue.then(async () => {
      if (runAfterStop || !stopped) {
        await work();
      }
    });
    queue = next.catch(() => {
      fail(
        "transport",
        RESPONSES_INTERNAL_CLOSE_CODE,
        RESPONSES_RELAY_CLOSE_REASON,
      );
    });
    return queue;
  };
  const forwardToUpstream = (
    data: HostedOpenAiWebSocketMessage,
  ): void => {
    if (!upstreamClosed) input.upstream.send(data);
  };
  const forwardToDownstream = (
    data: HostedOpenAiWebSocketMessage,
  ): void => {
    if (!downstreamClosed) input.downstream.send(data);
  };

  try {
    input.downstream.accept();
    input.upstream.accept();
  } catch {
    fail(
      "transport",
      RESPONSES_INTERNAL_CLOSE_CODE,
      RESPONSES_RELAY_CLOSE_REASON,
    );
  }

  input.downstream.onMessage((data) => {
    if (stopped) return;
    const bytes = frameByteLength(data);
    if (bytes + pendingClientBytes > HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES) {
      fail(
        "protocol",
        RESPONSES_TOO_LARGE_CLOSE_CODE,
        RESPONSES_TOO_LARGE_CLOSE_REASON,
      );
      return;
    }
    pendingClientBytes += bytes;
    void enqueue(async () => {
      if (input.authorizeClientFrame) {
        const denied = await input.authorizeClientFrame(data);
        if (stopped) return;
        if (denied) {
          forwardToDownstream(await readDeniedClientFrame(denied));
          fail("protocol", 1008, "Response request denied");
          return;
        }
      }
      if (input.persistUsage) {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        const frame = parseHostedCodexMemoryClientFrame(text);
        if (
          frame.kind === "invalid-response-create"
          || (frame.kind === "response-create" && activeRequest !== null)
        ) {
          fail(
            "protocol",
            RESPONSES_PROTOCOL_CLOSE_CODE,
            RESPONSES_PROTOCOL_CLOSE_REASON,
          );
          return;
        }
        if (frame.kind === "response-create") {
          activeRequest = frame.metadata;
        }
      }
      forwardToUpstream(data);
    }).then(() => {
      pendingClientBytes -= bytes;
    });
  });

  input.upstream.onMessage((data) => {
    if (stopped) return;
    enqueue(async () => {
      if (!hasAllowedFrameSize(data)) {
        fail(
          "protocol",
          RESPONSES_TOO_LARGE_CLOSE_CODE,
          RESPONSES_TOO_LARGE_CLOSE_REASON,
        );
        return;
      }
      if (!input.persistUsage || typeof data !== "string") {
        forwardToDownstream(data);
        return;
      }

      const frame = parseHostedCodexMemoryServerFrame(data);
      if (frame.kind === "invalid-response-terminal") {
        fail(
          "protocol",
          RESPONSES_PROTOCOL_CLOSE_CODE,
          RESPONSES_PROTOCOL_CLOSE_REASON,
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
          RESPONSES_PROTOCOL_CLOSE_CODE,
          RESPONSES_PROTOCOL_CLOSE_REASON,
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
            RESPONSES_PROTOCOL_CLOSE_CODE,
            RESPONSES_PROTOCOL_CLOSE_REASON,
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
          // The provider generation has already completed and may have been
          // billed. Turning an accounting-write failure into a retryable
          // provider failure would replay that irreversible work.
          reportFailure("persistence");
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
      RESPONSES_INTERNAL_CLOSE_CODE,
      RESPONSES_RELAY_CLOSE_REASON,
    );
  });
  input.upstream.onError(() => {
    enqueue(() => {
      fail(
        "transport",
        RESPONSES_INTERNAL_CLOSE_CODE,
        RESPONSES_RELAY_CLOSE_REASON,
      );
    });
  });

  return {
    drain: async () => {
      await queue;
    },
  };
}

export function relayHostedOpenAiResponsesWebSocketUpgrade(input: {
  authorizeClientFrame?: (
    data: HostedOpenAiWebSocketMessage,
  ) => Promise<Response | null>;
  defer?: (promise: Promise<void>) => void;
  persistUsage?(
    completion: HostedCodexMemoryWebSocketCompletion,
  ): Promise<void>;
  reportFailure?: (failure: {
    phase: HostedOpenAiWebSocketFailurePhase;
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
  startHostedOpenAiResponsesWebSocketRelay({
    ...(input.authorizeClientFrame
      ? { authorizeClientFrame: input.authorizeClientFrame }
      : {}),
    ...(input.defer ? { defer: input.defer } : {}),
    downstream: adaptCloudflareWebSocket(downstreamServer),
    ...(input.persistUsage ? { persistUsage: input.persistUsage } : {}),
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
): HostedOpenAiSocketPort {
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
        listener(event.data as HostedOpenAiWebSocketMessage);
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
  data: HostedOpenAiWebSocketMessage,
): boolean {
  return frameByteLength(data) <= HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES;
}

async function readDeniedClientFrame(response: Response): Promise<string> {
  const body: unknown = await response.json();
  if (body === null || typeof body !== "object" || !("error" in body)) {
    throw new TypeError("Invalid Responses denial.");
  }
  return JSON.stringify({ type: "error", error: body.error });
}

function frameByteLength(data: HostedOpenAiWebSocketMessage): number {
  if (typeof data !== "string") {
    return data.byteLength;
  }
  if (data.length > HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES) {
    return data.length;
  }
  return new TextEncoder().encode(data).byteLength;
}

function sanitizePeerClose(
  code: number,
  reason: string,
): { code: number; reason: string } {
  const safeCode = isForwardableCloseCode(code)
    ? code
    : RESPONSES_INTERNAL_CLOSE_CODE;
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
  socket: HostedOpenAiSocketPort,
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
