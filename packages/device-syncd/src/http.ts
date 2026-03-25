import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { deviceSyncError, isDeviceSyncError } from "./errors.js";
import { resolveOuraWebhookVerificationChallenge } from "./providers/oura.js";
import { DEFAULT_DEVICE_SYNC_HOST } from "./shared.js";

import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";
import type { DeviceSyncError } from "./errors.js";
import type { DeviceSyncHttpConfig, NodeServerHandle } from "./types.js";
import type { DeviceSyncService } from "./service.js";

const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
const CONTROL_PLANE_WWW_AUTHENTICATE = 'Bearer realm="device-syncd-control-plane"';

type DeviceSyncHttpRouteKind = "control" | "public";
type DeviceSyncHttpListenerSurface = "combined" | "control" | "public";

export interface CreateDeviceSyncHttpServerInput {
  service: DeviceSyncService;
  config?: DeviceSyncHttpConfig;
  bodyLimitBytes?: number;
}

export function isLoopbackRemoteAddress(value: string | null | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "::1" || normalized.startsWith("127.") || normalized.startsWith("::ffff:127.");
}

export function assertDeviceSyncControlRequest(input: {
  headers: IncomingHttpHeaders;
  remoteAddress: string | null | undefined;
  controlToken: string;
}): void {
  if (!isLoopbackRemoteAddress(input.remoteAddress)) {
    throw deviceSyncError({
      code: "CONTROL_PLANE_LOOPBACK_REQUIRED",
      message: "Device sync control routes only accept loopback requests.",
      retryable: false,
      httpStatus: 403,
    });
  }

  if (!hasMatchingControlToken(input.headers, input.controlToken)) {
    throw deviceSyncError({
      code: "CONTROL_PLANE_AUTH_REQUIRED",
      message: "Device sync control routes require a valid bearer token.",
      retryable: false,
      httpStatus: 401,
    });
  }
}

export async function startDeviceSyncHttpServer(input: CreateDeviceSyncHttpServerInput): Promise<NodeServerHandle> {
  const service = input.service;
  const bodyLimitBytes = Math.max(1024, input.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES);
  const host = input.config?.host ?? DEFAULT_DEVICE_SYNC_HOST;
  const port = input.config?.port ?? 8788;
  const controlToken = requireControlToken(input.config?.controlToken);
  const publicListener = resolvePublicListener(input.config);

  const controlServer = await startListener({
    host,
    port,
    service,
    bodyLimitBytes,
    controlToken,
    surface: publicListener ? "control" : "combined",
    config: input.config,
  });
  const publicServer = publicListener
    ? await startListener({
        host: publicListener.host,
        port: publicListener.port,
        service,
        bodyLimitBytes,
        controlToken,
        surface: "public",
        config: input.config,
      })
    : null;

  return {
    control: controlServer.address,
    public: publicServer?.address ?? null,
    async close() {
      if (publicServer) {
        await closeServer(publicServer.server);
      }

      await closeServer(controlServer.server);
    },
  };
}

async function routeRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  service: DeviceSyncService;
  bodyLimitBytes: number;
  controlToken: string;
  surface: DeviceSyncHttpListenerSurface;
  config?: DeviceSyncHttpConfig;
}): Promise<void> {
  const method = input.request.method ?? "GET";
  const url = new URL(input.request.url ?? "/", `${input.service.publicBaseUrl}/`);
  const basePath = new URL(`${input.service.publicBaseUrl}/`).pathname.replace(/\/+$/u, "");
  const pathname = stripBasePath(url.pathname, basePath);
  const routeKind = classifyDeviceSyncHttpRoute(method, pathname);

  if (!routeKind || !surfaceAllowsRoute(input.surface, routeKind)) {
    sendJson(input.response, 404, {
      error: {
        code: "NOT_FOUND",
        message: `No route for ${method} ${pathname}`,
      },
    });
    return;
  }

  if (routeKind === "control") {
    assertDeviceSyncControlRequest({
      headers: input.request.headers,
      remoteAddress: input.request.socket.remoteAddress,
      controlToken: input.controlToken,
    });
  }

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
    const result = await input.service.startConnection({
      provider: decodeURIComponent(connectMatch[1] ?? ""),
      returnTo: url.searchParams.get("returnTo"),
    });
    redirect(input.response, result.authorizationUrl);
    return;
  }

  const connectApiMatch = pathname.match(/^\/providers\/([^/]+)\/connect$/u);

  if (method === "POST" && connectApiMatch) {
    const body = await maybeReadJsonBody(input.request, input.bodyLimitBytes);
    const result = await input.service.startConnection({
      provider: decodeURIComponent(connectApiMatch[1] ?? ""),
      returnTo: readStringField(body, "returnTo"),
    });
    sendJson(input.response, 200, result);
    return;
  }

  const callbackMatch = pathname.match(/^\/oauth\/([^/]+)\/callback$/u);

  if (method === "GET" && callbackMatch) {
    const provider = decodeURIComponent(callbackMatch[1] ?? "");

    try {
      const result = await input.service.handleOAuthCallback({
        provider,
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
    } catch (error) {
      if (isDeviceSyncError(error)) {
        sendCallbackErrorResponse(input.response, provider, error);
        return;
      }

      throw error;
    }
  }

  const webhookMatch = pathname.match(/^\/webhooks\/([^/]+)$/u);

  if (webhookMatch) {
    const provider = decodeURIComponent(webhookMatch[1] ?? "");

    if (method === "GET") {
      const challenge = resolveWebhookVerificationChallenge(provider, url, input.config);

      if (challenge !== null) {
        sendText(input.response, 200, challenge);
        return;
      }

      sendJson(input.response, 200, {
        ok: true,
        provider,
      });
      return;
    }

    if (method === "POST") {
      const rawBody = await readRequestBody(input.request, input.bodyLimitBytes);
      const result = await input.service.handleWebhook(provider, toFetchHeaders(input.request), rawBody);
      sendJson(input.response, 202, result);
      return;
    }
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
}

async function startListener(input: {
  host: string;
  port: number;
  service: DeviceSyncService;
  bodyLimitBytes: number;
  controlToken: string;
  surface: DeviceSyncHttpListenerSurface;
  config?: DeviceSyncHttpConfig;
}): Promise<{
  server: Server;
  address: NodeServerHandle["control"];
}> {
  const server = createServer(async (request, response) => {
    try {
      await routeRequest({
        request,
        response,
        service: input.service,
        bodyLimitBytes: input.bodyLimitBytes,
        controlToken: input.controlToken,
        surface: input.surface,
        config: input.config,
      });
    } catch (error) {
      sendError(response, error);
    }
  });
  const address = await listenServer(server, input.host, input.port);
  return {
    server,
    address,
  };
}

async function listenServer(server: Server, host: string, port: number): Promise<NodeServerHandle["control"]> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new TypeError("Device sync HTTP server did not expose a TCP listener address.");
  }

  return {
    host,
    port: address.port,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function requireControlToken(controlToken: string | undefined): string {
  if (typeof controlToken === "string" && controlToken.trim()) {
    return controlToken.trim();
  }

  throw new TypeError(
    "Device sync control routes require DEVICE_SYNC_CONTROL_TOKEN or DEVICE_SYNC_SECRET.",
  );
}

function resolvePublicListener(
  config: DeviceSyncHttpConfig | undefined,
): { host: string; port: number } | null {
  const publicHost = typeof config?.publicHost === "string" ? config.publicHost.trim() : "";
  const publicPort = config?.publicPort;

  if (!publicHost && publicPort === undefined) {
    return null;
  }

  if (!publicHost || publicPort === undefined) {
    throw new TypeError(
      "Set both publicHost and publicPort to expose a separate public callback/webhook listener.",
    );
  }

  return {
    host: publicHost,
    port: publicPort,
  };
}

function classifyDeviceSyncHttpRoute(method: string, pathname: string): DeviceSyncHttpRouteKind | null {
  if (
    (method === "GET" &&
      (pathname === "/" ||
        pathname === "/healthz" ||
        pathname === "/providers" ||
        pathname === "/accounts" ||
        /^\/connect\/[^/]+$/u.test(pathname) ||
        /^\/accounts\/[^/]+$/u.test(pathname))) ||
    (method === "POST" &&
      (/^\/providers\/[^/]+\/connect$/u.test(pathname) ||
        /^\/accounts\/[^/]+\/reconcile$/u.test(pathname) ||
        /^\/accounts\/[^/]+\/disconnect$/u.test(pathname)))
  ) {
    return "control";
  }

  if (
    (method === "GET" && (/^\/oauth\/[^/]+\/callback$/u.test(pathname) || /^\/webhooks\/[^/]+$/u.test(pathname))) ||
    (method === "POST" && /^\/webhooks\/[^/]+$/u.test(pathname))
  ) {
    return "public";
  }

  return null;
}

function surfaceAllowsRoute(
  surface: DeviceSyncHttpListenerSurface,
  routeKind: DeviceSyncHttpRouteKind,
): boolean {
  return surface === "combined" || surface === routeKind;
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

function sendText(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function redirect(response: ServerResponse, location: string): void {
  response.statusCode = 302;
  response.setHeader("Location", location);
  response.end();
}

function resolveWebhookVerificationChallenge(
  provider: string,
  url: URL,
  config: DeviceSyncHttpConfig | undefined,
): string | null {
  if (provider !== "oura") {
    return null;
  }

  return resolveOuraWebhookVerificationChallenge({
    url,
    verificationToken: config?.ouraWebhookVerificationToken ?? null,
  });
}

export function buildCallbackErrorRedirectLocation(input: {
  returnTo: string | null;
  provider: string;
  errorCode: string;
}): string | null {
  if (!input.returnTo) {
    return null;
  }

  const destination = new URL(input.returnTo);
  destination.searchParams.set("deviceSyncStatus", "error");
  destination.searchParams.set("deviceSyncProvider", input.provider);
  destination.searchParams.set("deviceSyncError", input.errorCode);
  return destination.toString();
}

function sendCallbackErrorResponse(response: ServerResponse, fallbackProvider: string, error: DeviceSyncError): void {
  const provider = error.details ? readStringField(error.details, "provider") ?? fallbackProvider : fallbackProvider;
  const returnTo = error.details ? readStringField(error.details, "returnTo") : null;
  const destination = buildCallbackErrorRedirectLocation({
    returnTo,
    provider,
    errorCode: error.code,
  });

  if (destination) {
    redirect(response, destination);
    return;
  }

  sendHtml(
    response,
    error.httpStatus,
    renderCallbackHtml({
      title: `${formatProviderLabel(provider)} connection failed`,
      body: escapeHtml(error.message),
    }),
  );
}

function sendError(response: ServerResponse, error: unknown): void {
  if (isDeviceSyncError(error)) {
    if (error.code === "CONTROL_PLANE_AUTH_REQUIRED") {
      response.setHeader("WWW-Authenticate", CONTROL_PLANE_WWW_AUTHENTICATE);
    }

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

function hasMatchingControlToken(headers: IncomingHttpHeaders, expectedToken: string): boolean {
  const providedToken = readBearerToken(headers.authorization);

  if (!providedToken) {
    return false;
  }

  const expected = Buffer.from(expectedToken, "utf8");
  const provided = Buffer.from(providedToken, "utf8");

  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function readBearerToken(value: string | string[] | undefined): string | null {
  const header = readHeaderValue(value);

  if (!header) {
    return null;
  }

  const match = header.match(/^bearer\s+(.+)$/iu);
  return match?.[1]?.trim() || null;
}

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value.length === 1 ? readHeaderValue(value[0]) : null;
  }

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
