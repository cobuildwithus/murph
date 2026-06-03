import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

import {
  HOSTED_CLI_BRIDGE_DEVICE_ACCOUNT_LIST_PATH,
  HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH,
  HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT_MS,
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  parseHostedCliDeviceAccountListRequest,
  parseHostedCliDeviceConnectLinkRequest,
} from "@murphai/hosted-execution/cli-runtime-bridge";

import type {
  HostedRuntimeDeviceSyncMessagingReturnTarget,
  HostedRuntimeDeviceSyncPort,
} from "./platform.ts";

const HOSTED_CLI_BRIDGE_BODY_LIMIT_BYTES = 8192;

export type HostedCliRuntimeBridgeMessagingReturnTargetSource =
  | HostedRuntimeDeviceSyncMessagingReturnTarget
  | null
  | undefined
  | (() => HostedRuntimeDeviceSyncMessagingReturnTarget | null | undefined);

export interface HostedCliRuntimeBridge {
  env: Record<typeof HOSTED_CLI_BRIDGE_URL_ENV | typeof HOSTED_CLI_BRIDGE_TOKEN_ENV, string>;
  runWithInvocation<T>(
    input: HostedCliRuntimeBridgeInvocationInput,
    operation: () => Promise<T>,
  ): Promise<T>;
  stop(): Promise<void>;
}

export interface HostedCliRuntimeBridgeInvocationInput {
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  messagingReturnTarget?: HostedCliRuntimeBridgeMessagingReturnTargetSource;
  signal?: AbortSignal | null;
}

interface HostedCliRuntimeBridgeActiveInvocation {
  deviceSyncPort: HostedRuntimeDeviceSyncPort | null;
  messagingReturnTarget: HostedCliRuntimeBridgeMessagingReturnTargetSource;
  signal: AbortSignal | null;
}

let hostedCliRuntimeBridgePromise: Promise<HostedCliRuntimeBridge> | null = null;

export async function getOrCreateHostedCliRuntimeBridge(): Promise<HostedCliRuntimeBridge> {
  hostedCliRuntimeBridgePromise ??= startHostedCliRuntimeBridgeServer();
  return await hostedCliRuntimeBridgePromise;
}

async function startHostedCliRuntimeBridgeServer(): Promise<HostedCliRuntimeBridge> {
  const token = randomBytes(32).toString("base64url");
  const sockets = new Set<Socket>();
  let active: HostedCliRuntimeBridgeActiveInvocation | null = null;
  const server = createServer((request, response) => {
    void handleHostedCliBridgeRequest({
      getActive: () => active,
      request,
      response,
      token,
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.setTimeout(HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT_MS, () => {
      socket.destroy();
    });
    socket.once("close", () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeHostedCliBridgeServer(server, sockets);
    throw new TypeError("Hosted CLI bridge failed to bind a loopback TCP port.");
  }

  return {
    env: {
      [HOSTED_CLI_BRIDGE_TOKEN_ENV]: token,
      [HOSTED_CLI_BRIDGE_URL_ENV]: `http://127.0.0.1:${address.port}/`,
    },
    async runWithInvocation<T>(
      input: HostedCliRuntimeBridgeInvocationInput,
      operation: () => Promise<T>,
    ): Promise<T> {
      if (active) {
        throw new TypeError("Hosted CLI bridge already has an active invocation.");
      }
      const invocation: HostedCliRuntimeBridgeActiveInvocation = {
        deviceSyncPort: input.deviceSyncPort ?? null,
        messagingReturnTarget: input.messagingReturnTarget,
        signal: input.signal ?? null,
      };
      active = invocation;
      try {
        return await operation();
      } finally {
        if (active === invocation) {
          active = null;
        }
      }
    },
    async stop() {
      active = null;
      if (hostedCliRuntimeBridgePromise) {
        hostedCliRuntimeBridgePromise = null;
      }
      await closeHostedCliBridgeServer(server, sockets);
    },
  };
}

async function handleHostedCliBridgeRequest(input: {
  getActive: () => HostedCliRuntimeBridgeActiveInvocation | null;
  request: IncomingMessage;
  response: ServerResponse;
  token: string;
}): Promise<void> {
  let requestTimedOut = false;
  input.request.setTimeout(HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT_MS, () => {
    requestTimedOut = true;
    writeHostedCliBridgeError(
      input.response,
      408,
      "HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT",
      "Hosted CLI bridge request timed out.",
    );
    input.request.destroy();
  });

  try {
    if (input.request.method !== "POST") {
      writeHostedCliBridgeError(
        input.response,
        405,
        "HOSTED_CLI_BRIDGE_METHOD_UNSUPPORTED",
        "Hosted CLI bridge method is unsupported.",
      );
      return;
    }

    const path = input.request.url ?? "";
    if (
      path !== HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH
      && path !== HOSTED_CLI_BRIDGE_DEVICE_ACCOUNT_LIST_PATH
    ) {
      writeHostedCliBridgeError(
        input.response,
        404,
        "HOSTED_CLI_BRIDGE_PATH_UNSUPPORTED",
        "Hosted CLI bridge path is unsupported.",
      );
      return;
    }

    if (!isHostedCliBridgeAuthorized(input.request, input.token)) {
      writeHostedCliBridgeError(
        input.response,
        401,
        "HOSTED_CLI_BRIDGE_UNAUTHORIZED",
        "Hosted CLI bridge token is invalid.",
      );
      return;
    }

    const active = input.getActive();
    if (!active || active.signal?.aborted) {
      writeHostedCliBridgeError(
        input.response,
        503,
        "HOSTED_CLI_BRIDGE_UNAVAILABLE",
        "Hosted CLI bridge has no active invocation.",
      );
      return;
    }
    if (!active.deviceSyncPort) {
      writeHostedCliBridgeError(
        input.response,
        503,
        "HOSTED_CLI_BRIDGE_DEVICE_SYNC_UNAVAILABLE",
        "Hosted CLI bridge device sync is unavailable.",
      );
      return;
    }

    const body = await readHostedCliBridgeJsonBody(input.request);

    if (path === HOSTED_CLI_BRIDGE_DEVICE_ACCOUNT_LIST_PATH) {
      const request = parseHostedCliDeviceAccountListRequest(body);
      try {
        const snapshot = await active.deviceSyncPort.fetchSnapshot({
          ...(request.provider ? { provider: request.provider } : {}),
          ...(request.sourceProvider ? { sourceProviderSlug: request.sourceProvider } : {}),
        });
        writeHostedCliBridgeJson(input.response, 200, {
          accounts: snapshot.connections.map(hostedDeviceSyncSnapshotToAccount),
          provider: request.provider ?? null,
          sourceProvider: request.sourceProvider ?? null,
        });
      } catch {
        writeHostedCliBridgeError(
          input.response,
          502,
          "HOSTED_DEVICE_ACCOUNT_LIST_FAILED",
          "Hosted device account list failed.",
        );
      }
      return;
    }

    const request = parseHostedCliDeviceConnectLinkRequest(body);

    if (request.returnTo) {
      writeHostedCliBridgeError(
        input.response,
        400,
        "HOSTED_DEVICE_CONNECT_RETURN_TO_UNSUPPORTED",
        "Hosted device connect does not support returnTo yet.",
      );
      return;
    }

    try {
      const messagingReturnTarget = resolveHostedCliBridgeMessagingReturnTarget(
        active.messagingReturnTarget,
      );
      const result = await active.deviceSyncPort.createConnectLink({
        connectTarget: request.connectTarget,
        ...(messagingReturnTarget ? { messagingReturnTarget } : {}),
      });
      writeHostedCliBridgeJson(input.response, 200, result);
    } catch {
      writeHostedCliBridgeError(
        input.response,
        502,
        "HOSTED_DEVICE_CONNECT_LINK_FAILED",
        "Hosted device connect link creation failed.",
      );
    }
  } catch (error) {
    if (requestTimedOut || input.response.writableEnded) {
      return;
    }
    writeHostedCliBridgeError(
      input.response,
      400,
      "HOSTED_CLI_BRIDGE_REQUEST_INVALID",
      "Hosted CLI bridge request is invalid.",
    );
  }
}

type HostedDeviceSyncSnapshotEntry =
  Awaited<ReturnType<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>>["connections"][number];

function hostedDeviceSyncSnapshotToAccount(entry: HostedDeviceSyncSnapshotEntry) {
  return {
    accessTokenExpiresAt: entry.connection.accessTokenExpiresAt,
    connectedAt: entry.connection.connectedAt,
    createdAt: entry.connection.createdAt,
    displayName: entry.connection.displayName,
    externalAccountId: entry.connection.externalAccountId,
    id: entry.connection.id,
    lastErrorCode: entry.localState.lastErrorCode,
    lastErrorMessage: entry.localState.lastErrorMessage,
    lastSyncCompletedAt: entry.localState.lastSyncCompletedAt,
    lastSyncErrorAt: entry.localState.lastSyncErrorAt,
    lastSyncStartedAt: entry.localState.lastSyncStartedAt,
    lastWebhookAt: entry.localState.lastWebhookAt,
    metadata: {},
    nextReconcileAt: entry.localState.nextReconcileAt,
    provider: entry.connection.provider,
    scopes: entry.connection.scopes,
    sources: (entry.sources ?? []).map((source) => ({
      displayName: source.displayName,
      firstSeenAt: source.firstSeenAt,
      lastErrorCode: source.lastErrorCode,
      lastErrorMessage: source.lastErrorMessage,
      lastSeenAt: source.lastSeenAt,
      resourceCount: source.resourceCount,
      sourceProviderSlug: source.sourceProviderSlug,
      status: source.status,
    })),
    setupExpiresAt: entry.connection.setupExpiresAt ?? null,
    setupPhase: entry.connection.setupPhase ?? null,
    status: entry.connection.status,
    updatedAt: entry.connection.updatedAt ?? entry.connection.createdAt,
  };
}

function isHostedCliBridgeAuthorized(request: IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization ?? "";
  return authorization === `Bearer ${token}`;
}

function resolveHostedCliBridgeMessagingReturnTarget(
  source: HostedCliRuntimeBridgeMessagingReturnTargetSource,
): HostedRuntimeDeviceSyncMessagingReturnTarget | null {
  const value = typeof source === "function" ? source() : source;
  return value === "imessage" || value === "telegram" ? value : null;
}

async function readHostedCliBridgeJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let byteLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > HOSTED_CLI_BRIDGE_BODY_LIMIT_BYTES) {
      throw new Error("Hosted CLI bridge request body is too large.");
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    throw new Error("Hosted CLI bridge request body must be JSON.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Hosted CLI bridge request body must be valid JSON.");
  }
}

function writeHostedCliBridgeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  if (response.writableEnded) {
    return;
  }

  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function writeHostedCliBridgeError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
): void {
  writeHostedCliBridgeJson(response, statusCode, {
    error: {
      code,
      message,
    },
  });
}

function closeHostedCliBridgeServer(
  server: ReturnType<typeof createServer>,
  sockets: Set<Socket>,
): Promise<void> {
  for (const socket of sockets) {
    socket.destroy();
  }

  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
