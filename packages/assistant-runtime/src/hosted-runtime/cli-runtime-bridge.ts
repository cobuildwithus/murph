import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH,
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
  const server = createServer((request, response) => {
    void handleHostedCliBridgeRequest({
      deviceSyncPort,
      request,
      response,
      token,
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
    await closeHostedCliBridgeServer(server);
    throw new TypeError("Hosted CLI bridge failed to bind a loopback TCP port.");
  }

  return {
    env: {
      [HOSTED_CLI_BRIDGE_TOKEN_ENV]: token,
      [HOSTED_CLI_BRIDGE_URL_ENV]: `http://127.0.0.1:${address.port}/`,
    },
    stop: () => closeHostedCliBridgeServer(server),
  };
}

async function handleHostedCliBridgeRequest(input: {
  deviceSyncPort: HostedRuntimeDeviceSyncPort;
  request: IncomingMessage;
  response: ServerResponse;
  token: string;
}): Promise<void> {
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
    writeHostedCliBridgeError(
      input.response,
      400,
      "HOSTED_CLI_BRIDGE_REQUEST_INVALID",
      error instanceof Error ? error.message : "Hosted CLI bridge request is invalid.",
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

function closeHostedCliBridgeServer(server: ReturnType<typeof createServer>): Promise<void> {
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
