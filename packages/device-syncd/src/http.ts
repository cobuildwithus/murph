import { Buffer } from "node:buffer";
import { createServer } from "node:http";

import { isDeviceSyncError } from "./errors.js";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { DeviceSyncHttpConfig, NodeServerHandle } from "./types.js";
import type { DeviceSyncService } from "./service.js";

const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;

export interface CreateDeviceSyncHttpServerInput {
  service: DeviceSyncService;
  config?: DeviceSyncHttpConfig;
  bodyLimitBytes?: number;
}

export async function startDeviceSyncHttpServer(input: CreateDeviceSyncHttpServerInput): Promise<NodeServerHandle> {
  const service = input.service;
  const bodyLimitBytes = Math.max(1024, input.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES);
  const host = input.config?.host ?? "0.0.0.0";
  const port = input.config?.port ?? 8788;

  const server = createServer(async (request, response) => {
    try {
      await routeRequest({
        request,
        response,
        service,
        bodyLimitBytes,
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function routeRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  service: DeviceSyncService;
  bodyLimitBytes: number;
}): Promise<void> {
  const method = input.request.method ?? "GET";
  const url = new URL(input.request.url ?? "/", `${input.service.publicBaseUrl}/`);
  const basePath = new URL(`${input.service.publicBaseUrl}/`).pathname.replace(/\/+$/u, "");
  const pathname = stripBasePath(url.pathname, basePath);

  if (method === "GET" && pathname === "/") {
    sendJson(input.response, 200, {
      ok: true,
      providers: input.service.describeProviders(),
      summary: input.service.summarize(),
    });
    return;
  }

  if (method === "GET" && pathname === "/healthz") {
    sendJson(input.response, 200, {
      ok: true,
      summary: input.service.summarize(),
    });
    return;
  }

  if (method === "GET" && pathname === "/providers") {
    sendJson(input.response, 200, {
      providers: input.service.describeProviders(),
    });
    return;
  }

  const connectMatch = pathname.match(/^\/connect\/([^/]+)$/u);

  if (method === "GET" && connectMatch) {
    const result = input.service.startConnection({
      provider: decodeURIComponent(connectMatch[1] ?? ""),
      returnTo: url.searchParams.get("returnTo"),
    });
    redirect(input.response, result.authorizationUrl);
    return;
  }

  const connectApiMatch = pathname.match(/^\/providers\/([^/]+)\/connect$/u);

  if (method === "POST" && connectApiMatch) {
    const body = await maybeReadJsonBody(input.request, input.bodyLimitBytes);
    const result = input.service.startConnection({
      provider: decodeURIComponent(connectApiMatch[1] ?? ""),
      returnTo: readStringField(body, "returnTo"),
    });
    sendJson(input.response, 200, result);
    return;
  }

  const callbackMatch = pathname.match(/^\/oauth\/([^/]+)\/callback$/u);

  if (method === "GET" && callbackMatch) {
    const result = await input.service.handleOAuthCallback({
      provider: decodeURIComponent(callbackMatch[1] ?? ""),
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      scope: url.searchParams.get("scope"),
      error: url.searchParams.get("error"),
      errorDescription: url.searchParams.get("error_description"),
    });

    if (result.returnTo) {
      const destination = new URL(result.returnTo);
      destination.searchParams.set("deviceSyncStatus", "connected");
      destination.searchParams.set("deviceSyncProvider", result.account.provider);
      destination.searchParams.set("deviceSyncAccountId", result.account.id);
      redirect(input.response, destination.toString());
      return;
    }

    sendHtml(
      input.response,
      200,
      renderCallbackHtml({
        title: `${formatProviderLabel(result.account.provider)} connected`,
        body: `Connected ${escapeHtml(formatProviderLabel(result.account.provider))} account ${escapeHtml(result.account.id)} successfully.`,
      }),
    );
    return;
  }

  const webhookMatch = pathname.match(/^\/webhooks\/([^/]+)$/u);

  if (method === "POST" && webhookMatch) {
    const rawBody = await readRequestBody(input.request, input.bodyLimitBytes);
    const result = await input.service.handleWebhook(
      decodeURIComponent(webhookMatch[1] ?? ""),
      toFetchHeaders(input.request),
      rawBody,
    );
    sendJson(input.response, 202, result);
    return;
  }

  if (method === "GET" && pathname === "/accounts") {
    sendJson(input.response, 200, {
      accounts: input.service.listAccounts(url.searchParams.get("provider") ?? undefined),
    });
    return;
  }

  const accountMatch = pathname.match(/^\/accounts\/([^/]+)$/u);

  if (method === "GET" && accountMatch) {
    const account = input.service.getAccount(decodeURIComponent(accountMatch[1] ?? ""));

    if (!account) {
      sendJson(input.response, 404, {
        error: {
          code: "ACCOUNT_NOT_FOUND",
          message: "Device sync account was not found.",
        },
      });
      return;
    }

    sendJson(input.response, 200, { account });
    return;
  }

  const reconcileMatch = pathname.match(/^\/accounts\/([^/]+)\/reconcile$/u);

  if (method === "POST" && reconcileMatch) {
    const result = input.service.queueManualReconcile(decodeURIComponent(reconcileMatch[1] ?? ""));
    sendJson(input.response, 202, result);
    return;
  }

  const disconnectMatch = pathname.match(/^\/accounts\/([^/]+)\/disconnect$/u);

  if (method === "POST" && disconnectMatch) {
    const result = await input.service.disconnectAccount(decodeURIComponent(disconnectMatch[1] ?? ""));
    sendJson(input.response, 200, result);
    return;
  }

  sendJson(input.response, 404, {
    error: {
      code: "NOT_FOUND",
      message: `No route for ${method} ${pathname}`,
    },
  });
}

async function maybeReadJsonBody(request: IncomingMessage, limitBytes: number): Promise<Record<string, unknown>> {
  const rawBody = await readRequestBody(request, limitBytes);

  if (rawBody.length === 0) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    throw new TypeError("Request body must be valid JSON.", { cause: error });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Request body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

async function readRequestBody(request: IncomingMessage, limitBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > limitBytes) {
      throw new RangeError(`Request body exceeded ${limitBytes} bytes.`);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function toFetchHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }

    if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  return headers;
}

function stripBasePath(pathname: string, basePath: string): string {
  if (!basePath || basePath === "/") {
    return pathname || "/";
  }

  if (pathname === basePath) {
    return "/";
  }

  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }

  return pathname || "/";
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function sendHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function redirect(response: ServerResponse, location: string): void {
  response.statusCode = 302;
  response.setHeader("Location", location);
  response.end();
}

function sendError(response: ServerResponse, error: unknown): void {
  if (isDeviceSyncError(error)) {
    sendJson(response, error.httpStatus, {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        details: error.details,
      },
    });
    return;
  }

  if (error instanceof RangeError) {
    sendJson(response, 413, {
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: error.message,
      },
    });
    return;
  }

  if (error instanceof TypeError) {
    sendJson(response, 400, {
      error: {
        code: "BAD_REQUEST",
        message: error.message,
      },
    });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  sendJson(response, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message,
    },
  });
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatProviderLabel(provider: string): string {
  return (
    provider
      .split(/[-_\s]+/u)
      .filter(Boolean)
      .map((token) => token[0]?.toUpperCase() + token.slice(1))
      .join(" ") || provider
  );
}

function renderCallbackHtml(input: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(input.title)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 16px; }
      h1 { font-size: 24px; }
      p { line-height: 1.5; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(input.title)}</h1>
    <p>${input.body}</p>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
