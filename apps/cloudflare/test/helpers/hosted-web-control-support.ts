import {
  createServer,
  type Server as HttpServer,
} from "node:http";

import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";

import type {
  HostedWebControlTransport,
} from "../../src/runtime-platform/web-control-transport.ts";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
} from "../hosted-execution-fixtures.js";
import {
  buildHostLoopbackStubBaseUrl,
  readRequestBody,
  stopHttpStubServer,
} from "./hosted-local-e2e-support.js";

export interface ObservedHostedWebControlRequest {
  body: string;
  keyId: string | null;
  method: string;
  nonce: string | null;
  signature: string | null;
  timestamp: string | null;
  url: string;
  userId: string | null;
}

export interface HostedWebControlStubResponse {
  body?: unknown;
  delayMs?: number;
  headers?: Readonly<Record<string, string>>;
  rawBody?: string;
  status?: number;
}

export interface HostedWebControlStub {
  baseUrl: string;
  observedRequests: ObservedHostedWebControlRequest[];
  stop(): Promise<void>;
  transport: HostedWebControlTransport;
}

export async function startHostedWebControlStub(input: {
  respond(
    request: ObservedHostedWebControlRequest,
  ): HostedWebControlStubResponse | Promise<HostedWebControlStubResponse>;
}): Promise<HostedWebControlStub> {
  const observedRequests: ObservedHostedWebControlRequest[] = [];
  const server: HttpServer = createServer(async (request, response) => {
    const observed = {
      body: await readRequestBody(request),
      keyId: readHeader(request.headers, HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER),
      method: request.method ?? "GET",
      nonce: readHeader(request.headers, HOSTED_EXECUTION_NONCE_HEADER),
      signature: readHeader(request.headers, HOSTED_EXECUTION_SIGNATURE_HEADER),
      timestamp: readHeader(request.headers, HOSTED_EXECUTION_TIMESTAMP_HEADER),
      url: request.url ?? "/",
      userId: readHeader(request.headers, HOSTED_EXECUTION_USER_ID_HEADER),
    } satisfies ObservedHostedWebControlRequest;
    observedRequests.push(observed);

    const reply = await input.respond(observed);
    if (reply.delayMs && reply.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
    }

    const status = reply.status ?? 200;
    const headers = new Headers(reply.headers);
    const responseBody = reply.rawBody !== undefined
      ? reply.rawBody
      : JSON.stringify(reply.body ?? null);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json; charset=utf-8");
    }
    response.writeHead(status, Object.fromEntries(headers.entries()));
    response.end(responseBody);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const baseUrl = buildHostLoopbackStubBaseUrl(server, "Hosted Web control stub");
  return {
    baseUrl,
    observedRequests,
    stop: async () => {
      await stopHttpStubServer(server);
    },
    transport: {
      callbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      mode: "direct",
      webControlBaseUrl: baseUrl,
      workspaceCheckpointBridge: null,
    },
  };
}

function readHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
