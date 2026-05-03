import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

import {
  HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH,
  HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT_MS,
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  parseHostedCliDeviceConnectLinkRequest,
} from "@murphai/hosted-execution/cli-runtime-bridge";

import type {
  HostedRuntimeDeviceSyncPort,
} from "./platform.ts";

const HOSTED_CLI_BRIDGE_BODY_LIMIT_BYTES = 8192;

export interface HostedCliRuntimeBridge {
  env: Record<typeof HOSTED_CLI_BRIDGE_URL_ENV | typeof HOSTED_CLI_BRIDGE_TOKEN_ENV, string>;
  stop(): Promise<void>;
}

export async function startHostedCliRuntimeBridge(input: {
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
}): Promise<HostedCliRuntimeBridge | null> {
  const deviceSyncPort = input.deviceSyncPort ?? null;
  if (!deviceSyncPort) {
    return null;
  }

  const token = randomBytes(32).toString("base64url");
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    void handleHostedCliBridgeRequest({
      deviceSyncPort,
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
    stop: () => closeHostedCliBridgeServer(server, sockets),
  };
}

async function handleHostedCliBridgeRequest(input: {
  deviceSyncPort: HostedRuntimeDeviceSyncPort;
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

    if (input.request.url !== HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH) {
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

    const request = parseHostedCliDeviceConnectLinkRequest(
      await readHostedCliBridgeJsonBody(input.request),
    );

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
      const result = await input.deviceSyncPort.createConnectLink({
        connectTarget: request.connectTarget,
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

function isHostedCliBridgeAuthorized(request: IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization ?? "";
  return authorization === `Bearer ${token}`;
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
