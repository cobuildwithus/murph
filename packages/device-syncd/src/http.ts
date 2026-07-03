import { createServer } from "node:http";

import {
  assertListenerPort,
  assertLoopbackListenerHost,
  assertUnbracketedListenerHost,
  getLoopbackControlRequestRejectionReason,
} from "@murphai/runtime-state";
import { hasMatchingLoopbackControlBearerToken } from "@murphai/runtime-state/node/loopback-control-plane-auth";

import {
  buildDeviceSyncCallbackErrorRedirectLocation,
  buildDeviceSyncCallbackReturnLocation,
  buildDeviceSyncCallbackSuccessRedirectLocation,
} from "./callback-redirect.ts";
import { buildPublicDeviceSyncErrorPayload, deviceSyncError, isDeviceSyncError } from "./errors.ts";
import { sanitizeHostedRuntimeErrorText } from "./hosted-runtime.ts";
import { DEFAULT_DEVICE_SYNC_HOST } from "./shared.ts";
import { resolveDeviceSyncWebhookPreflightResponse } from "./webhook-verification.ts";
import { DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES } from "./types.ts";

import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";
import type { DeviceSyncError } from "./errors.ts";
import type { DeviceSyncHttpConfig, DeviceSyncWebhookPreflightResponse, NodeServerHandle } from "./types.ts";
import type { DeviceSyncService } from "./service.ts";

export { buildPublicDeviceSyncErrorPayload };

const DEFAULT_BODY_LIMIT_BYTES = DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES;
const CONTROL_PLANE_WWW_AUTHENTICATE = 'Bearer realm="device-syncd-control-plane"';

export {
  buildDeviceSyncCallbackErrorRedirectLocation as buildCallbackErrorRedirectLocation,
  buildDeviceSyncCallbackSuccessRedirectLocation as buildCallbackSuccessRedirectLocation,
  DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS,
} from "./callback-redirect.ts";

type DeviceSyncHttpRouteKind = "control" | "public";
type DeviceSyncHttpListenerSurface = "combined" | "control" | "public";
type DeviceSyncHttpMethod = "GET" | "POST";

interface DeviceSyncHttpRouteParams {
  provider?: string;
  accountId?: string;
}

interface DeviceSyncHttpRouteHandlerInput {
  request: IncomingMessage;
  response: ServerResponse;
  service: DeviceSyncService;
  bodyLimitBytes: number;
  config?: DeviceSyncHttpConfig;
  url: URL;
  pathname: string;
  params: DeviceSyncHttpRouteParams;
}

interface DeviceSyncHttpRouteDescriptor {
  method: DeviceSyncHttpMethod;
  pattern: string | RegExp;
  surface: DeviceSyncHttpRouteKind;
  parseParams(pathname: string): DeviceSyncHttpRouteParams | null;
  handle(input: DeviceSyncHttpRouteHandlerInput): Promise<void>;
}

interface DeviceSyncHttpRouteMatch {
  route: DeviceSyncHttpRouteDescriptor;
  params: DeviceSyncHttpRouteParams;
}

type DeviceSyncHttpRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export interface CreateDeviceSyncHttpServerInput {
  service: DeviceSyncService;
  config?: DeviceSyncHttpConfig;
  bodyLimitBytes?: number;
}

interface StartedDeviceSyncHttpListener {
  server: Server;
  address: NodeServerHandle["control"];
}

export function assertDeviceSyncControlRequest(input: {
  headers: IncomingHttpHeaders;
  remoteAddress: string | null | undefined;
  controlToken: string;
}): void {
  const rejectionReason = getLoopbackControlRequestRejectionReason({
    headers: input.headers,
    remoteAddress: input.remoteAddress,
  });

  if (rejectionReason === "loopback-remote-address-required") {
    throw deviceSyncError({
      code: "CONTROL_PLANE_LOOPBACK_REQUIRED",
      message: "Device sync control routes only accept loopback requests.",
      retryable: false,
      httpStatus: 403,
    });
  }

  if (rejectionReason === "forwarded-headers-rejected") {
    throw deviceSyncError({
      code: "CONTROL_PLANE_PROXY_HEADERS_REJECTED",
      message: "Device sync control routes reject forwarded proxy headers.",
      retryable: false,
      httpStatus: 403,
    });
  }

  if (rejectionReason === "loopback-host-required") {
    throw deviceSyncError({
      code: "CONTROL_PLANE_LOOPBACK_HOST_REQUIRED",
      message: "Device sync control routes require a loopback Host header.",
      retryable: false,
      httpStatus: 403,
    });
  }

  if (
    !hasMatchingLoopbackControlBearerToken(input.headers.authorization, input.controlToken)
  ) {
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
  const configuredHost = input.config?.host?.trim();
  const host = configuredHost && configuredHost.length > 0 ? configuredHost : DEFAULT_DEVICE_SYNC_HOST;
  assertLoopbackListenerHost(
    host,
    "Device sync control listener host must be a loopback hostname or address. Use publicHost/publicPort for externally reachable callback and webhook routes.",
  );
  const port = input.config?.port ?? 8788;
  assertListenerPort(
    port,
    "Device sync control listener port must be an integer between 0 and 65535.",
    { allowZero: true },
  );
  const controlToken = requireControlToken(input.config?.controlToken);
  const publicListener = resolvePublicListener(input.config);
  const controlHandler = createDeviceSyncHttpRequestHandler({
    service,
    bodyLimitBytes,
    controlToken,
    surface: publicListener ? "control" : "combined",
    config: input.config,
  });
  const publicHandler = publicListener
    ? createDeviceSyncHttpRequestHandler({
        service,
        bodyLimitBytes,
        controlToken,
        surface: "public",
        config: input.config,
      })
    : null;

  const controlServer = await startListener({
    host,
    port,
    handler: controlHandler,
  });

  let publicServer: StartedDeviceSyncHttpListener | null = null;
  try {
    publicServer = publicListener
      ? await startListener({
          host: publicListener.host,
          port: publicListener.port,
          handler: publicHandler!,
        })
      : null;
  } catch (error) {
    try {
      await closeStartedListeners([controlServer]);
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        "Device sync HTTP startup failed and could not fully roll back the control listener.",
      );
    }

    throw error;
  }

  return {
    control: controlServer.address,
    public: publicServer?.address ?? null,
    async close() {
      await closeStartedListeners([publicServer, controlServer]);
    },
  };
}

const DEVICE_SYNC_HTTP_ROUTES = [
  createStaticRoute({
    method: "GET",
    pattern: "/",
    surface: "control",
    handle({ response, service }) {
      sendJson(response, 200, {
        ok: true,
        providers: service.describeProviders(),
        summary: service.summarize(),
      });
    },
  }),
  createStaticRoute({
    method: "GET",
    pattern: "/healthz",
    surface: "control",
    handle({ response, service }) {
      sendJson(response, 200, {
        ok: true,
        summary: service.summarize(),
      });
    },
  }),
  createStaticRoute({
    method: "GET",
    pattern: "/providers",
    surface: "control",
    handle({ response, service }) {
      sendJson(response, 200, {
        providers: service.describeProviders(),
      });
    },
  }),
  createParameterizedRoute({
    method: "GET",
    pattern: /^\/connect\/([^/]+)$/u,
    paramNames: ["provider"],
    surface: "control",
    async handle({ response, service, url, params }) {
      const result = await service.startConnection({
        provider: params.provider ?? "",
        returnTo: url.searchParams.get("returnTo"),
      });
      redirect(response, result.authorizationUrl);
    },
  }),
  createParameterizedRoute({
    method: "POST",
    pattern: /^\/providers\/([^/]+)\/connect$/u,
    paramNames: ["provider"],
    surface: "control",
    async handle({ request, response, service, bodyLimitBytes, params }) {
      const body = await maybeReadJsonBody(request, bodyLimitBytes);
      const result = await service.startConnection({
        provider: params.provider ?? "",
        returnTo: readStringField(body, "returnTo"),
        ownerId: readStringField(body, "ownerId"),
        sourceProviderSlug: readStringField(body, "sourceProviderSlug"),
      });
      sendJson(response, 200, result);
    },
  }),
  createParameterizedRoute({
    method: "GET",
    pattern: /^\/connect\/([^/]+)\/callback$/u,
    paramNames: ["provider"],
    surface: "public",
    async handle(input) {
      await handleDeviceConnectionCallback(input);
    },
  }),
  createParameterizedRoute({
    method: "GET",
    pattern: /^\/oauth\/([^/]+)\/callback$/u,
    paramNames: ["provider"],
    surface: "public",
    async handle(input) {
      await handleDeviceConnectionCallback(input);
    },
  }),
  createParameterizedRoute({
    method: "GET",
    pattern: /^\/webhooks\/([^/]+)$/u,
    paramNames: ["provider"],
    surface: "public",
    async handle({ request, response, service, url, params }) {
      const provider = params.provider ?? "";
      const preflight = await resolveDeviceSyncWebhookPreflightResponse({
        provider,
        registry: service.registry,
        method: request.method ?? "GET",
        url,
        headers: toFetchHeaders(request),
        rawBody: Buffer.alloc(0),
      });

      if (preflight) {
        sendWebhookPreflightResponse(response, preflight);
        return;
      }

      sendJson(response, 200, {
        ok: true,
        provider,
      });
    },
  }),
  createParameterizedRoute({
    method: "POST",
    pattern: /^\/webhooks\/([^/]+)$/u,
    paramNames: ["provider"],
    surface: "public",
    async handle({ request, response, service, bodyLimitBytes, params, url }) {
      const rawBody = await readRequestBody(request, bodyLimitBytes);
      const provider = params.provider ?? "";
      const headers = toFetchHeaders(request);
      const preflight = await resolveDeviceSyncWebhookPreflightResponse({
        provider,
        registry: service.registry,
        method: request.method ?? "POST",
        url,
        headers,
        rawBody,
      });

      if (preflight) {
        sendWebhookPreflightResponse(response, preflight);
        return;
      }

      const result = await service.handleWebhook(provider, headers, rawBody);
      sendJson(response, 200, result);
    },
  }),
  createStaticRoute({
    method: "GET",
    pattern: "/accounts",
    surface: "control",
    handle({ response, service, url }) {
      sendJson(response, 200, {
        accounts: service.listAccounts({
          provider: url.searchParams.get("provider") ?? undefined,
          sourceProviderSlug: url.searchParams.get("sourceProvider") ?? undefined,
        }),
      });
    },
  }),
  createParameterizedRoute({
    method: "GET",
    pattern: /^\/accounts\/([^/]+)$/u,
    paramNames: ["accountId"],
    surface: "control",
    handle({ response, service, params }) {
      const account = service.getAccount(params.accountId ?? "");

      if (!account) {
        sendJson(response, 404, {
          error: {
            code: "ACCOUNT_NOT_FOUND",
            message: "Device sync account was not found.",
          },
        });
        return;
      }

      sendJson(response, 200, { account });
    },
  }),
  createParameterizedRoute({
    method: "POST",
    pattern: /^\/accounts\/([^/]+)\/reconcile$/u,
    paramNames: ["accountId"],
    surface: "control",
    handle({ response, service, params }) {
      const result = service.queueManualReconcile(params.accountId ?? "");
      sendJson(response, 202, result);
    },
  }),
  createParameterizedRoute({
    method: "POST",
    pattern: /^\/accounts\/([^/]+)\/disconnect$/u,
    paramNames: ["accountId"],
    surface: "control",
    async handle({ response, service, params }) {
      const result = await service.disconnectAccount(params.accountId ?? "");
      sendJson(response, 200, result);
    },
  }),
] satisfies readonly DeviceSyncHttpRouteDescriptor[];

async function handleDeviceConnectionCallback({
  response,
  service,
  url,
  params,
}: DeviceSyncHttpRouteHandlerInput): Promise<void> {
  const provider = params.provider ?? "";

  try {
    const handleConnectionCallback = typeof Reflect.get(service, "handleConnectionCallback") === "function"
      ? service.handleConnectionCallback.bind(service)
      : service.handleOAuthCallback.bind(service);
    const result = await handleConnectionCallback({
      provider,
      query: url.searchParams,
      code: url.searchParams.get("code"),
      state: url.searchParams.get("murph_state") ?? url.searchParams.get("state"),
      scope: url.searchParams.get("scope"),
      error: url.searchParams.get("error"),
      errorDescription: url.searchParams.get("error_description"),
    });

    const redirectLocation = buildDeviceSyncCallbackSuccessRedirectLocation({
      returnTo: result.returnTo,
      provider: result.account.provider,
    });

    if (redirectLocation) {
      redirect(response, redirectLocation);
      return;
    }

    sendHtml(
      response,
      200,
      renderCallbackHtml({
        title: `${formatProviderLabel(result.account.provider)} connected`,
        body: `Connected ${formatProviderLabel(result.account.provider)} successfully.`,
      }),
    );
  } catch (error) {
    if (isDeviceSyncError(error)) {
      sendCallbackErrorResponse(response, provider, error);
      return;
    }

    throw error;
  }
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
  const routeMatch = matchDeviceSyncHttpRoute(method, pathname);

  if (!routeMatch || !surfaceAllowsRoute(input.surface, routeMatch.route)) {
    sendJson(input.response, 404, {
      error: {
        code: "NOT_FOUND",
        message: `No route for ${method} ${pathname}`,
      },
    });
    return;
  }

  if (routeMatch.route.surface === "control") {
    assertDeviceSyncControlRequest({
      headers: input.request.headers,
      remoteAddress: input.request.socket.remoteAddress,
      controlToken: input.controlToken,
    });
  }

  await routeMatch.route.handle({
    request: input.request,
    response: input.response,
    service: input.service,
    bodyLimitBytes: input.bodyLimitBytes,
    config: input.config,
    url,
    pathname,
    params: routeMatch.params,
  });
}

function createDeviceSyncHttpRequestHandler(input: {
  service: DeviceSyncService;
  bodyLimitBytes?: number;
  controlToken: string;
  surface: DeviceSyncHttpListenerSurface;
  config?: DeviceSyncHttpConfig;
}): DeviceSyncHttpRequestHandler {
  const bodyLimitBytes = Math.max(1024, input.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES);

  return async (request, response) => {
    try {
      await routeRequest({
        request,
        response,
        service: input.service,
        bodyLimitBytes,
        controlToken: input.controlToken,
        surface: input.surface,
        config: input.config,
      });
    } catch (error) {
      sendError(response, error);
    }
  };
}

async function startListener(input: {
  host: string;
  port: number;
  handler: DeviceSyncHttpRequestHandler;
}): Promise<StartedDeviceSyncHttpListener> {
  const server = createServer(input.handler);
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

async function closeStartedListeners(
  listeners: readonly (StartedDeviceSyncHttpListener | null | undefined)[],
): Promise<void> {
  let firstError: unknown = null;

  for (const listener of listeners) {
    if (!listener) {
      continue;
    }

    try {
      await closeServer(listener.server);
    } catch (error) {
      firstError ??= error;
    }
  }

  if (firstError) {
    throw firstError;
  }
}

function requireControlToken(controlToken: string | undefined): string {
  if (typeof controlToken === "string" && controlToken.trim()) {
    return controlToken.trim();
  }

  throw new TypeError(
    "Device sync control routes require DEVICE_SYNC_CONTROL_TOKEN.",
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

  assertUnbracketedListenerHost(
    publicHost,
    "Device sync public listener host must be a hostname or address without URL bracket syntax. Use ::1, not [::1].",
  );
  assertListenerPort(
    publicPort,
    "Device sync public listener port must be an integer between 0 and 65535.",
    { allowZero: true },
  );

  return {
    host: publicHost,
    port: publicPort,
  };
}

function createStaticRoute(input: {
  method: DeviceSyncHttpMethod;
  pattern: string;
  surface: DeviceSyncHttpRouteKind;
  handle(input: DeviceSyncHttpRouteHandlerInput): Promise<void> | void;
}): DeviceSyncHttpRouteDescriptor {
  return {
    method: input.method,
    pattern: input.pattern,
    surface: input.surface,
    parseParams(pathname) {
      return pathname === input.pattern ? {} : null;
    },
    async handle(routeInput) {
      await input.handle(routeInput);
    },
  };
}

function surfaceAllowsRoute(
  surface: DeviceSyncHttpListenerSurface,
  route: DeviceSyncHttpRouteDescriptor,
): boolean {
  return surface === "combined" || surface === route.surface;
}

function createParameterizedRoute(input: {
  method: DeviceSyncHttpMethod;
  pattern: RegExp;
  paramNames: ReadonlyArray<keyof DeviceSyncHttpRouteParams>;
  surface: DeviceSyncHttpRouteKind;
  handle(input: DeviceSyncHttpRouteHandlerInput): Promise<void> | void;
}): DeviceSyncHttpRouteDescriptor {
  return {
    method: input.method,
    pattern: input.pattern,
    surface: input.surface,
    parseParams(pathname) {
      return parseRouteParams(pathname, input.pattern, input.paramNames);
    },
    async handle(routeInput) {
      await input.handle(routeInput);
    },
  };
}

function matchDeviceSyncHttpRoute(method: string, pathname: string): DeviceSyncHttpRouteMatch | null {
  for (const route of DEVICE_SYNC_HTTP_ROUTES) {
    if (route.method !== method) {
      continue;
    }

    const params = route.parseParams(pathname);

    if (params) {
      return {
        route,
        params,
      };
    }
  }

  return null;
}

function parseRouteParams(
  pathname: string,
  pattern: RegExp,
  paramNames: ReadonlyArray<keyof DeviceSyncHttpRouteParams>,
): DeviceSyncHttpRouteParams | null {
  const match = pathname.match(pattern);

  if (!match) {
    return null;
  }

  const params: DeviceSyncHttpRouteParams = {};

  for (const [index, paramName] of paramNames.entries()) {
    params[paramName] = decodeURIComponent(match[index + 1] ?? "");
  }

  return params;
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

function sendWebhookPreflightResponse(
  response: ServerResponse,
  preflight: DeviceSyncWebhookPreflightResponse,
): void {
  for (const [key, value] of Object.entries(preflight.headers ?? {})) {
    response.setHeader(key, value);
  }

  if (typeof preflight.body === "string") {
    response.statusCode = preflight.status;
    response.setHeader(
      "Content-Type",
      preflight.headers?.["content-type"] ?? preflight.headers?.["Content-Type"] ?? "text/plain; charset=utf-8",
    );
    response.setHeader("Content-Length", Buffer.byteLength(preflight.body));
    response.end(preflight.body);
    return;
  }

  sendJson(response, preflight.status, preflight.body);
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

function sendCallbackErrorResponse(response: ServerResponse, fallbackProvider: string, error: DeviceSyncError): void {
  const provider = error.details ? readStringField(error.details, "provider") ?? fallbackProvider : fallbackProvider;
  const returnTo = error.details ? readStringField(error.details, "returnTo") : null;

  if (error.code === "OAUTH_STATE_REPLAYED") {
    // An earlier delivery of this callback already owns the outcome; send the
    // user back without asserting a status, matching the hosted route.
    const replayLocation = buildDeviceSyncCallbackReturnLocation(returnTo);
    if (replayLocation) {
      redirect(response, replayLocation);
      return;
    }
  }

  const redirectLocation = buildDeviceSyncCallbackErrorRedirectLocation({
    returnTo,
    provider,
    errorCode: error.code,
  });

  if (redirectLocation) {
    redirect(response, redirectLocation);
    return;
  }

  sendHtml(
    response,
    error.httpStatus,
    renderCallbackHtml({
      title: `${formatProviderLabel(provider)} connection failed`,
      body: sanitizeHostedRuntimeErrorText(error.message) ?? "Request failed.",
    }),
  );
}

function sendError(response: ServerResponse, error: unknown): void {
  if (isDeviceSyncError(error)) {
    if (error.code === "CONTROL_PLANE_AUTH_REQUIRED") {
      response.setHeader("WWW-Authenticate", CONTROL_PLANE_WWW_AUTHENTICATE);
    }

    sendJson(response, error.httpStatus, buildPublicDeviceSyncErrorPayload(error));
    return;
  }

  if (error instanceof RangeError) {
    sendJson(response, 413, {
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: sanitizeHostedRuntimeErrorText(error.message) ?? "Request failed.",
      },
    });
    return;
  }

  if (error instanceof TypeError || error instanceof URIError) {
    sendJson(response, 400, {
      error: {
        code: "BAD_REQUEST",
        message: sanitizeHostedRuntimeErrorText(error.message) ?? "Request failed.",
      },
    });
    return;
  }

  sendJson(response, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error.",
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

export function renderCallbackHtml(input: { title: string; body: string }): string {
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
    <p>${escapeHtml(input.body)}</p>
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
