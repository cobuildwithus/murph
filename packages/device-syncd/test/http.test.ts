import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { afterEach, test, vi } from "vitest";

import { DeviceSyncError, formatDeviceSyncStartupError } from "../src/errors.ts";
import {
  assertDeviceSyncControlRequest,
  buildPublicDeviceSyncErrorPayload,
  createDeviceSyncHttpRequestHandler,
  renderCallbackHtml,
  startDeviceSyncHttpServer,
} from "../src/http.ts";
import { createOuraDeviceSyncProvider } from "../src/providers/oura.ts";

import type { DeviceSyncService } from "../src/service.ts";

const accountRecord = {
  id: "acct_demo_01",
  provider: "demo",
  externalAccountId: "demo-user-1",
  displayName: "Demo User",
  status: "active" as const,
  scopes: ["offline", "read:data"],
  metadata: {},
  connectedAt: "2026-03-17T12:00:00.000Z",
  lastWebhookAt: null,
  lastSyncStartedAt: null,
  lastSyncCompletedAt: null,
  lastSyncErrorAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  nextReconcileAt: null,
  createdAt: "2026-03-17T12:00:00.000Z",
  updatedAt: "2026-03-17T12:00:00.000Z",
};

type IncomingMessageLike = AsyncIterable<Buffer> & {
  method?: string;
  url?: string;
  headers: Record<string, string | string[]>;
  socket: {
    remoteAddress?: string;
  };
};

type ServerResponseLike = {
  statusCode: number;
  setHeader(name: string, value: number | string | ReadonlyArray<string>): void;
  end(chunk?: Buffer | string): void;
};

type MockHttpResponse = {
  response: ServerResponseLike;
  statusCode: number;
  headers: Record<string, string>;
  readText(): string;
  readJson(): unknown;
};

function createMockHttpRequest(input: {
  method: string;
  url: string;
  headers?: Record<string, string | string[]>;
  remoteAddress?: string;
  body?: string;
}): IncomingMessageLike {
  const chunks = input.body ? [Buffer.from(input.body, "utf8")] : [];

  return {
    method: input.method,
    url: input.url,
    headers: input.headers ?? {},
    socket: {
      remoteAddress: input.remoteAddress ?? "127.0.0.1",
    },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function createMockHttpResponse(): MockHttpResponse {
  let body = Buffer.alloc(0);
  const headers: Record<string, string> = {};
  const response: ServerResponseLike = {
    statusCode: 200,
    setHeader(name, value) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
    },
    end(chunk) {
      if (!chunk) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      body = Buffer.concat([body, buffer]);
    },
  };

  return {
    response,
    get statusCode() {
      return response.statusCode;
    },
    headers,
    readText() {
      return body.toString("utf8");
    },
    readJson() {
      return JSON.parse(body.toString("utf8"));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("node:http");
});

async function invokeHandler(input: {
  service?: DeviceSyncService;
  method: string;
  url: string;
  headers?: Record<string, string | string[]>;
  remoteAddress?: string;
  body?: string;
  surface: "control" | "public" | "combined";
  config?: Parameters<typeof createDeviceSyncHttpRequestHandler>[0]["config"];
  controlToken?: string;
  bodyLimitBytes?: number;
}): Promise<MockHttpResponse> {
  const response = createMockHttpResponse();
  const handler = createDeviceSyncHttpRequestHandler({
    service: input.service ?? createStubService(),
    bodyLimitBytes: input.bodyLimitBytes,
    surface: input.surface,
    config: input.config,
    controlToken: input.controlToken ?? "control-token-for-tests",
  });

  await handler(
    createMockHttpRequest({
      method: input.method,
      url: input.url,
      headers: input.headers,
      remoteAddress: input.remoteAddress,
      body: input.body,
    }) as never,
    response.response as never,
  );

  return response;
}

test("assertDeviceSyncControlRequest rejects non-loopback callers", () => {
  assert.throws(
    () =>
      assertDeviceSyncControlRequest({
        headers: {
          authorization: "Bearer control-token-for-tests",
        },
        remoteAddress: "203.0.113.10",
        controlToken: "control-token-for-tests",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONTROL_PLANE_LOOPBACK_REQUIRED"
      && error.httpStatus === 403,
  );
});

test("device sync http handler routes control and public requests without sockets", async () => {
  const observedWebhooks: Array<{ provider: string; body: string }> = [];
  const service = createStubService({
    async handleWebhook(provider, _headers, rawBody) {
      observedWebhooks.push({
        provider,
        body: rawBody.toString("utf8"),
      });

      return {
        accepted: true,
        duplicate: false,
        provider,
        eventType: "demo.updated",
      };
    },
  });

  const unauthorized = await invokeHandler({
    service,
    method: "GET",
    url: "/device-sync/accounts",
    surface: "combined",
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.headers["www-authenticate"], 'Bearer realm="device-syncd-control-plane"');

  const rejectedRemote = await invokeHandler({
    service,
    method: "GET",
    url: "/device-sync/accounts",
    surface: "combined",
    remoteAddress: "203.0.113.10",
    headers: {
      authorization: "Bearer control-token-for-tests",
    },
  });
  assert.equal(rejectedRemote.statusCode, 403);
  assert.deepEqual(rejectedRemote.readJson(), {
    error: {
      code: "CONTROL_PLANE_LOOPBACK_REQUIRED",
      message: "Device sync control routes only accept loopback requests.",
      retryable: false,
    },
  });

  const root = await invokeHandler({
    service,
    method: "GET",
    url: "/device-sync/",
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
    },
  });
  assert.equal(root.statusCode, 200);
  assert.deepEqual(root.readJson(), {
    ok: true,
    providers: service.describeProviders(),
    summary: service.summarize(),
  });

  const health = await invokeHandler({
    service,
    method: "GET",
    url: "/device-sync/healthz",
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
    },
  });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.readJson(), {
    ok: true,
    summary: service.summarize(),
  });

  const providers = await invokeHandler({
    service,
    method: "GET",
    url: "/device-sync/providers",
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
    },
  });
  assert.equal(providers.statusCode, 200);
  assert.deepEqual(providers.readJson(), {
    providers: service.describeProviders(),
  });

  const connectRedirect = await invokeHandler({
    service,
    method: "GET",
    url: "/device-sync/connect/demo?returnTo=%2Fsettings%2Fdevices",
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
    },
  });
  assert.equal(connectRedirect.statusCode, 302);
  assert.equal(connectRedirect.headers.location, "https://provider.test/oauth?state=state_demo_01");

  const connectBody = await invokeHandler({
    service,
    method: "POST",
    url: "/device-sync/providers/demo/connect",
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      returnTo: "/settings/devices",
    }),
  });
  assert.equal(connectBody.statusCode, 200);
  assert.deepEqual(connectBody.readJson(), {
    provider: "demo",
    state: "state_demo_01",
    expiresAt: "2026-03-17T12:30:00.000Z",
    authorizationUrl: "https://provider.test/oauth?state=state_demo_01",
  });

  const accounts = await invokeHandler({
    service,
    method: "GET",
    url: "/device-sync/accounts",
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
    },
  });
  assert.equal(accounts.statusCode, 200);
  assert.deepEqual(accounts.readJson(), {
    accounts: [accountRecord],
  });

  const account = await invokeHandler({
    service,
    method: "GET",
    url: `/device-sync/accounts/${accountRecord.id}`,
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
    },
  });
  assert.equal(account.statusCode, 200);
  assert.deepEqual(account.readJson(), {
    account: accountRecord,
  });

  const callbackSuccess = await invokeHandler({
    service,
    method: "GET",
    url: "/device-sync/oauth/demo/callback?state=state_demo_01&code=code-1",
    surface: "public",
  });
  assert.equal(callbackSuccess.statusCode, 200);
  assert.equal(callbackSuccess.headers["content-type"], "text/html; charset=utf-8");
  assert.match(callbackSuccess.readText(), /Demo connected/u);
  assert.match(callbackSuccess.readText(), /acct_demo_01/u);

  const reconcile = await invokeHandler({
    service,
    method: "POST",
    url: `/device-sync/accounts/${accountRecord.id}/reconcile`,
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
    },
  });
  assert.equal(reconcile.statusCode, 202);
  assert.deepEqual(reconcile.readJson(), {
    account: accountRecord,
    job: {
      id: "job_demo_01",
      provider: "demo",
      accountId: accountRecord.id,
      kind: "reconcile",
      payload: {},
      priority: 80,
      availableAt: "2026-03-17T12:00:00.000Z",
      attempts: 0,
      maxAttempts: 5,
      dedupeKey: "manual-reconcile:demo",
      status: "queued",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: "2026-03-17T12:00:00.000Z",
      updatedAt: "2026-03-17T12:00:00.000Z",
      startedAt: null,
      finishedAt: null,
    },
    jobs: [],
  });

  const disconnect = await invokeHandler({
    service,
    method: "POST",
    url: `/device-sync/accounts/${accountRecord.id}/disconnect`,
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
    },
  });
  assert.equal(disconnect.statusCode, 200);
  assert.deepEqual(disconnect.readJson(), {
    account: {
      ...accountRecord,
      status: "disconnected",
    },
  });

  const publicControlRoute = await invokeHandler({
    service,
    method: "GET",
    url: "/device-sync/accounts",
    surface: "public",
  });
  assert.equal(publicControlRoute.statusCode, 404);
  assert.deepEqual(publicControlRoute.readJson(), {
    error: {
      code: "NOT_FOUND",
      message: "No route for GET /accounts",
    },
  });

  const wrongListener = await invokeHandler({
    service,
    method: "POST",
    url: "/device-sync/webhooks/demo",
    surface: "control",
    body: JSON.stringify({
      ok: true,
    }),
  });
  assert.equal(wrongListener.statusCode, 404);
  assert.deepEqual(wrongListener.readJson(), {
    error: {
      code: "NOT_FOUND",
      message: "No route for POST /webhooks/demo",
    },
  });

  const webhookResponse = await invokeHandler({
    service,
    method: "POST",
    url: "/device-sync/webhooks/demo",
    surface: "public",
    body: JSON.stringify({
      ok: true,
    }),
  });
  assert.equal(webhookResponse.statusCode, 202);
  assert.deepEqual(webhookResponse.readJson(), {
    accepted: true,
    duplicate: false,
    provider: "demo",
    eventType: "demo.updated",
  });
  assert.deepEqual(observedWebhooks, [
    {
      provider: "demo",
      body: "{\"ok\":true}",
    },
  ]);
});

test("device sync http handler validates request bodies and payload limits", async () => {
  const invalidJson = await invokeHandler({
    method: "POST",
    url: "/device-sync/providers/demo/connect",
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
      "content-type": "application/json; charset=utf-8",
    },
    body: "{",
  });
  assert.equal(invalidJson.statusCode, 400);
  assert.deepEqual(invalidJson.readJson(), {
    error: {
      code: "BAD_REQUEST",
      message: "Request body must be valid JSON.",
    },
  });

  const invalidShape = await invokeHandler({
    method: "POST",
    url: "/device-sync/providers/demo/connect",
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
      "content-type": "application/json; charset=utf-8",
    },
    body: "[]",
  });
  assert.equal(invalidShape.statusCode, 400);
  assert.deepEqual(invalidShape.readJson(), {
    error: {
      code: "BAD_REQUEST",
      message: "Request body must be a JSON object.",
    },
  });

  const tooLarge = await invokeHandler({
    method: "POST",
    url: "/device-sync/webhooks/demo",
    surface: "public",
    body: "x".repeat(1025),
    bodyLimitBytes: 1,
  });
  assert.equal(tooLarge.statusCode, 413);
  assert.deepEqual(tooLarge.readJson(), {
    error: {
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body exceeded 1024 bytes.",
    },
  });
});

test("device sync http handler returns not found for unknown accounts", async () => {
  const response = await invokeHandler({
    service: createStubService({
      getAccount() {
        return null;
      },
    }),
    method: "GET",
    url: "/device-sync/accounts/acct_missing",
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
    },
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.readJson(), {
    error: {
      code: "ACCOUNT_NOT_FOUND",
      message: "Device sync account was not found.",
    },
  });
});

test("device sync http server rejects non-loopback control listener hosts", async () => {
  await assert.rejects(
    () =>
      startDeviceSyncHttpServer({
        service: createStubService(),
        config: {
          host: "0.0.0.0",
          port: 0,
          controlToken: "control-token-for-tests",
        },
      }),
    /Device sync control listener host must be a loopback hostname or address/u,
  );
});

test("device sync http server wires control and public listeners to the correct handler surfaces", async () => {
  vi.resetModules();

  class MockServer extends EventEmitter {
    private readonly host: string;
    private readonly port: number;

    constructor(port: number, host: string) {
      super();
      this.port = port;
      this.host = host;
    }

    listen(_port: number, _host: string, callback: () => void) {
      callback();
      return this;
    }

    address() {
      return {
        address: this.host,
        family: "IPv4",
        port: this.port,
      };
    }

    close(callback: (error?: Error | null) => void) {
      callback(null);
      return this;
    }
  }

  const servers: Array<{
    handler: (request: IncomingMessageLike, response: ServerResponseLike) => Promise<void>;
    server: MockServer;
  }> = [];

  let nextPort = 43100;
  vi.doMock("node:http", async () => {
    const actual = await vi.importActual<typeof import("node:http")>("node:http");
    return {
      ...actual,
      createServer(handler: (request: IncomingMessageLike, response: ServerResponseLike) => Promise<void>) {
        const server = new MockServer(nextPort, "127.0.0.1");
        nextPort += 1;
        servers.push({
          handler,
          server,
        });
        return server as unknown as import("node:http").Server;
      },
    };
  });

  const { startDeviceSyncHttpServer: startServer } = await import("../src/http.ts");
  const service = createStubService();
  const handle = await startServer({
    service,
    config: {
      host: "127.0.0.1",
      port: 8788,
      controlToken: "control-token-for-tests",
      publicHost: "127.0.0.1",
      publicPort: 9797,
    },
  });

  assert.equal(servers.length, 2);
  assert.deepEqual(handle.control, {
    host: "127.0.0.1",
    port: 43100,
  });
  assert.deepEqual(handle.public, {
    host: "127.0.0.1",
    port: 43101,
  });

  const controlResponse = createMockHttpResponse();
  await servers[0]!.handler(
    createMockHttpRequest({
      method: "GET",
      url: "/device-sync/accounts",
      headers: {
        authorization: "Bearer control-token-for-tests",
      },
    }),
    controlResponse.response,
  );
  assert.equal(controlResponse.statusCode, 200);

  const publicRejectsControl = createMockHttpResponse();
  await servers[1]!.handler(
    createMockHttpRequest({
      method: "GET",
      url: "/device-sync/accounts",
    }),
    publicRejectsControl.response,
  );
  assert.equal(publicRejectsControl.statusCode, 404);

  const controlRejectsWebhook = createMockHttpResponse();
  await servers[0]!.handler(
    createMockHttpRequest({
      method: "POST",
      url: "/device-sync/webhooks/demo",
      body: JSON.stringify({
        ok: true,
      }),
    }),
    controlRejectsWebhook.response,
  );
  assert.equal(controlRejectsWebhook.statusCode, 404);

  const publicWebhook = createMockHttpResponse();
  await servers[1]!.handler(
    createMockHttpRequest({
      method: "POST",
      url: "/device-sync/webhooks/demo",
      body: JSON.stringify({
        ok: true,
      }),
    }),
    publicWebhook.response,
  );
  assert.equal(publicWebhook.statusCode, 202);

  await handle.close();
});

test("device sync http handler redacts provider response bodies from control-plane JSON errors", async () => {
  const sensitiveBodySnippet =
    "account_id=acct_fake_sensitive_123 access_token=tok_fake_sensitive_456 scope=heartrate";
  const response = await invokeHandler({
    service: createStubService({
      listAccounts() {
        throw new DeviceSyncError({
          code: "OURA_API_REQUEST_FAILED",
          message: "Oura API request failed for /v2/usercollection/daily_sleep.",
          retryable: true,
          httpStatus: 502,
          details: {
            status: 502,
            bodySnippet: sensitiveBodySnippet,
          },
        });
      },
    }),
    method: "GET",
    url: "/device-sync/accounts",
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
    },
  });

  assert.equal(response.statusCode, 502);
  const body = response.readText();
  assert.doesNotMatch(body, /acct_fake_sensitive_123/u);
  assert.doesNotMatch(body, /tok_fake_sensitive_456/u);
  assert.doesNotMatch(body, /scope=heartrate/u);
  assert.doesNotMatch(body, /bodySnippet/u);
  assert.deepEqual(JSON.parse(body), {
    error: {
      code: "OURA_API_REQUEST_FAILED",
      message: "Oura API request failed for /v2/usercollection/daily_sleep.",
      retryable: true,
      details: {
        status: 502,
      },
    },
  });
});

test("device sync http handler does not expose raw unexpected error text to control-plane clients", async () => {
  const response = await invokeHandler({
    service: createStubService({
      describeProviders() {
        throw new Error("sensitive control-plane failure: provider token leaked");
      },
    }),
    method: "GET",
    url: "/device-sync/providers",
    surface: "combined",
    headers: {
      authorization: "Bearer control-token-for-tests",
    },
  });

  assert.equal(response.statusCode, 500);
  const body = response.readText();
  assert.deepEqual(JSON.parse(body), {
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error.",
    },
  });
  assert.doesNotMatch(body, /provider token leaked/u);
  assert.doesNotMatch(body, /sensitive control-plane failure/u);
});

test("device sync public error payload keeps only sanitized provider status details", () => {
  const sensitiveBodySnippet =
    "account_id=acct_fake_sensitive_123 access_token=tok_fake_sensitive_456 scope=heartrate";
  const payload = buildPublicDeviceSyncErrorPayload(
    new DeviceSyncError({
      code: "OURA_API_REQUEST_FAILED",
      message: "Oura API request failed for /v2/usercollection/daily_sleep.",
      retryable: true,
      httpStatus: 502,
      details: {
        status: 502,
        bodySnippet: sensitiveBodySnippet,
        provider: "oura",
      },
    }),
  );
  const body = JSON.stringify(payload);

  assert.doesNotMatch(body, /acct_fake_sensitive_123/u);
  assert.doesNotMatch(body, /tok_fake_sensitive_456/u);
  assert.doesNotMatch(body, /scope=heartrate/u);
  assert.doesNotMatch(body, /bodySnippet/u);
  assert.doesNotMatch(body, /provider/u);
  assert.deepEqual(payload, {
    error: {
      code: "OURA_API_REQUEST_FAILED",
      message: "Oura API request failed for /v2/usercollection/daily_sleep.",
      retryable: true,
      details: {
        status: 502,
      },
    },
  });
});

test("device sync startup error formatting omits sensitive provider response details", () => {
  const formatted = formatDeviceSyncStartupError(
    new DeviceSyncError({
      code: "WHOOP_API_REQUEST_FAILED",
      message: "Whoop API request failed for /developer/v1/cycle.",
      retryable: true,
      httpStatus: 502,
      details: {
        accountId: "acct_fake_sensitive_123",
        bodySnippet: "access_token=tok_fake_sensitive_456",
        status: 502,
      },
    }),
  );

  assert.equal(formatted, "DeviceSyncError WHOOP_API_REQUEST_FAILED: Whoop API request failed for /developer/v1/cycle.");
  assert.doesNotMatch(formatted, /acct_fake_sensitive_123/u);
  assert.doesNotMatch(formatted, /tok_fake_sensitive_456/u);
  assert.doesNotMatch(formatted, /bodySnippet/u);
});

test("renderCallbackHtml escapes plain-text body content", () => {
  const html = renderCallbackHtml({
    title: "Demo connected",
    body: `Connected Demo<script>alert(1)</script> account acct_<tag>&"' successfully.`,
  });

  assert.match(
    html,
    /<p>Connected Demo&lt;script&gt;alert\(1\)&lt;\/script&gt; account acct_&lt;tag&gt;&amp;&quot;&#39; successfully\.<\/p>/u,
  );
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
  assert.doesNotMatch(html, /acct_<tag>&"'/u);
  assert.doesNotMatch(html, /Demo&amp;lt;script&amp;gt;alert\(1\)&amp;lt;\/script&amp;gt;/u);
});

test("renderCallbackHtml escapes callback errors once without requiring pre-escaped text", () => {
  const html = renderCallbackHtml({
    title: "Demo connection failed",
    body: `OAuth failed because <bad>&"' details`,
  });

  assert.match(html, /<p>OAuth failed because &lt;bad&gt;&amp;&quot;&#39; details<\/p>/u);
  assert.doesNotMatch(html, /OAuth failed because <bad>&"'/u);
  assert.doesNotMatch(html, /OAuth failed because &amp;lt;bad&amp;gt;/u);
});

test("device sync http handler redirects OAuth callback errors back to the original returnTo", async () => {
  const response = await invokeHandler({
    service: createStubService({
      async handleOAuthCallback() {
        throw new DeviceSyncError({
          code: "OAUTH_CALLBACK_REJECTED",
          message: "The user canceled the OAuth flow.",
          retryable: false,
          httpStatus: 400,
          details: {
            provider: "demo",
            returnTo: "https://app.example.test/settings/devices?tab=wearables",
          },
        });
      },
    }),
    method: "GET",
    url: "/device-sync/oauth/demo/callback?state=state-1&error=access_denied",
    surface: "public",
  });

  assert.equal(response.statusCode, 302);
  const location = response.headers.location;

  if (!location) {
    throw new Error("OAuth callback error response did not include a redirect location.");
  }

  const destination = new URL(location);
  assert.equal(destination.origin, "https://app.example.test");
  assert.equal(destination.pathname, "/settings/devices");
  assert.equal(destination.searchParams.get("tab"), "wearables");
  assert.equal(destination.searchParams.get("deviceSyncStatus"), "error");
  assert.equal(destination.searchParams.get("deviceSyncProvider"), "demo");
  assert.equal(destination.searchParams.get("deviceSyncError"), "OAUTH_CALLBACK_REJECTED");
  assert.equal(destination.searchParams.get("deviceSyncErrorMessage"), null);
});

test("device sync http handler renders callback errors when no returnTo is available", async () => {
  const response = await invokeHandler({
    service: createStubService({
      async handleOAuthCallback() {
        throw new DeviceSyncError({
          code: "OAUTH_CALLBACK_REJECTED",
          message: "The user canceled the OAuth flow.",
          retryable: false,
          httpStatus: 400,
          details: {
            provider: "demo",
          },
        });
      },
    }),
    method: "GET",
    url: "/device-sync/oauth/demo/callback?state=state-1&error=access_denied",
    surface: "public",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
  const body = response.readText();
  assert.match(body, /Demo connection failed/u);
  assert.match(body, /The user canceled the OAuth flow\./u);
});

test("device sync http handler serves the Oura webhook verification challenge on the public listener", async () => {
  const response = await invokeHandler({
    service: createStubService({
      registry: {
        get(provider) {
          if (provider !== "oura") {
            return undefined;
          }

          return createOuraDeviceSyncProvider({
            clientId: "oura-client-id",
            clientSecret: "oura-client-secret",
          });
        },
      },
    }),
    method: "GET",
    url: "/device-sync/webhooks/oura?verification_token=verify-token-for-tests&challenge=random-challenge",
    surface: "public",
    config: {
      controlToken: "control-token-for-tests",
      ouraWebhookVerificationToken: "verify-token-for-tests",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.readJson(), {
    challenge: "random-challenge",
  });
});

test("device sync http handler returns the shared Oura mismatch error on the public verification route", async () => {
  const response = await invokeHandler({
    service: createStubService({
      registry: {
        get(provider) {
          return provider === "oura"
            ? createOuraDeviceSyncProvider({
                clientId: "oura-client-id",
                clientSecret: "oura-client-secret",
              })
            : undefined;
        },
      },
    }),
    method: "GET",
    url: "/device-sync/webhooks/oura?verification_token=wrong-token&challenge=random-challenge",
    surface: "public",
    config: {
      controlToken: "control-token-for-tests",
      ouraWebhookVerificationToken: "verify-token-for-tests",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.readJson(), {
    error: {
      code: "OURA_WEBHOOK_VERIFICATION_FAILED",
      message: "Oura webhook verification token did not match the configured verification token.",
      retryable: false,
    },
  });
});

test("device sync http handler returns the shared Oura missing-token error on the public verification route", async () => {
  const response = await invokeHandler({
    service: createStubService({
      registry: {
        get(provider) {
          return provider === "oura"
            ? createOuraDeviceSyncProvider({
                clientId: "oura-client-id",
                clientSecret: "oura-client-secret",
              })
            : undefined;
        },
      },
    }),
    method: "GET",
    url: "/device-sync/webhooks/oura?verification_token=verify-token-for-tests&challenge=random-challenge",
    surface: "public",
    config: {
      controlToken: "control-token-for-tests",
    },
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.readJson(), {
    error: {
      code: "OURA_WEBHOOK_VERIFICATION_TOKEN_MISSING",
      message: "Oura webhook verification requires OURA_WEBHOOK_VERIFICATION_TOKEN.",
      retryable: false,
    },
  });
});

function createStubService(overrides: Partial<DeviceSyncService> = {}): DeviceSyncService {
  return {
    publicBaseUrl: "https://sync.example.test/device-sync",
    describeProviders() {
      return [
        {
          provider: "demo",
          callbackPath: "/oauth/demo/callback",
          callbackUrl: "https://sync.example.test/device-sync/oauth/demo/callback",
          webhookPath: "/webhooks/demo",
          webhookUrl: "https://sync.example.test/device-sync/webhooks/demo",
          supportsWebhooks: true,
          defaultScopes: ["offline", "read:data"],
        },
      ];
    },
    summarize() {
      return {
        accountsTotal: 1,
        accountsActive: 1,
        jobsQueued: 0,
        jobsRunning: 0,
        jobsDead: 0,
        oauthStates: 0,
        webhookTraces: 0,
      };
    },
    async startConnection() {
      return {
        provider: "demo",
        state: "state_demo_01",
        expiresAt: "2026-03-17T12:30:00.000Z",
        authorizationUrl: "https://provider.test/oauth?state=state_demo_01",
      };
    },
    async handleOAuthCallback() {
      return {
        account: accountRecord,
        returnTo: null,
      };
    },
    async handleWebhook() {
      return {
        accepted: true,
        duplicate: false,
        provider: "demo",
        eventType: "demo.updated",
      };
    },
    listAccounts() {
      return [accountRecord];
    },
    getAccount() {
      return accountRecord;
    },
    queueManualReconcile() {
      return {
        account: accountRecord,
        job: {
          id: "job_demo_01",
          provider: "demo",
          accountId: accountRecord.id,
          kind: "reconcile",
          payload: {},
          priority: 80,
          availableAt: "2026-03-17T12:00:00.000Z",
          attempts: 0,
          maxAttempts: 5,
          dedupeKey: "manual-reconcile:demo",
          status: "queued" as const,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          createdAt: "2026-03-17T12:00:00.000Z",
          updatedAt: "2026-03-17T12:00:00.000Z",
          startedAt: null,
          finishedAt: null,
        },
        jobs: [],
      };
    },
    async disconnectAccount() {
      return {
        account: {
          ...accountRecord,
          status: "disconnected" as const,
        },
      };
    },
    ...overrides,
  } as DeviceSyncService;
}
