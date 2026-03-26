import assert from "node:assert/strict";

import { test } from "vitest";

import { DeviceSyncError } from "../src/errors.js";
import {
  assertDeviceSyncControlRequest,
  renderCallbackHtml,
  startDeviceSyncHttpServer,
} from "../src/http.js";

import type { DeviceSyncService } from "../src/service.js";

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
      error instanceof DeviceSyncError &&
      error.code === "CONTROL_PLANE_LOOPBACK_REQUIRED" &&
      error.httpStatus === 403,
  );
});

test("device sync http server protects control routes and keeps webhooks on the public listener", async () => {
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
  const server = await startDeviceSyncHttpServer({
    service,
    config: {
      host: "127.0.0.1",
      port: 0,
      controlToken: "control-token-for-tests",
      publicHost: "127.0.0.1",
      publicPort: 0,
    },
  });

  try {
    const controlBaseUrl = `http://127.0.0.1:${server.control.port}`;
    const publicBaseUrl = `http://127.0.0.1:${server.public?.port}`;

    const unauthorized = await fetch(`${controlBaseUrl}/accounts`);
    assert.equal(unauthorized.status, 401);
    assert.equal(
      unauthorized.headers.get("www-authenticate"),
      'Bearer realm="device-syncd-control-plane"',
    );

    const authorized = await fetch(`${controlBaseUrl}/accounts`, {
      headers: {
        Authorization: "Bearer control-token-for-tests",
      },
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), {
      accounts: [accountRecord],
    });

    const publicControlRoute = await fetch(`${publicBaseUrl}/accounts`);
    assert.equal(publicControlRoute.status, 404);
    assert.deepEqual(await publicControlRoute.json(), {
      error: {
        code: "NOT_FOUND",
        message: "No route for GET /accounts",
      },
    });

    const wrongListener = await fetch(`${controlBaseUrl}/webhooks/demo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        ok: true,
      }),
    });
    assert.equal(wrongListener.status, 404);
    assert.deepEqual(await wrongListener.json(), {
      error: {
        code: "NOT_FOUND",
        message: "No route for POST /webhooks/demo",
      },
    });

    const webhookResponse = await fetch(`${publicBaseUrl}/webhooks/demo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        ok: true,
      }),
    });
    assert.equal(webhookResponse.status, 202);
    assert.deepEqual(await webhookResponse.json(), {
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
  } finally {
    await server.close();
  }
});

test("renderCallbackHtml escapes plain-text body content", () => {
  const html = renderCallbackHtml({
    title: `Demo connected`,
    body: `Connected Demo<script>alert(1)</script> account acct_<tag>&"' successfully.`,
  });

  assert.match(
    html,
    /<p>Connected Demo&lt;script&gt;alert\(1\)&lt;\/script&gt; account acct_&lt;tag&gt;&amp;&quot;&#39; successfully\.<\/p>/u,
  );
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
  assert.doesNotMatch(html, /acct_<tag>&"'/u);
  assert.doesNotMatch(
    html,
    /Demo&amp;lt;script&amp;gt;alert\(1\)&amp;lt;\/script&amp;gt;/u,
  );
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

function createStubService(
  overrides: Partial<DeviceSyncService> = {},
): DeviceSyncService {
  return {
    publicBaseUrl: "https://device-sync.healthybob.test/device-sync",
    describeProviders() {
      return [
        {
          provider: "demo",
          callbackPath: "/oauth/demo/callback",
          callbackUrl: "https://device-sync.healthybob.test/device-sync/oauth/demo/callback",
          webhookPath: "/webhooks/demo",
          webhookUrl: "https://device-sync.healthybob.test/device-sync/webhooks/demo",
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

test("device sync http server redirects OAuth callback errors back to the original returnTo", async () => {
  const service = createStubService({
    async handleOAuthCallback() {
      throw new DeviceSyncError({
        code: "OAUTH_CALLBACK_REJECTED",
        message: "The user canceled the OAuth flow.",
        retryable: false,
        httpStatus: 400,
        details: {
          provider: "demo",
          returnTo: "https://app.healthybob.test/settings/devices?tab=wearables",
        },
      });
    },
  });
  const server = await startDeviceSyncHttpServer({
    service,
    config: {
      host: "127.0.0.1",
      port: 0,
      controlToken: "control-token-for-tests",
      publicHost: "127.0.0.1",
      publicPort: 0,
    },
  });

  try {
    const publicBaseUrl = `http://127.0.0.1:${server.public?.port}`;
    const response = await fetch(`${publicBaseUrl}/oauth/demo/callback?state=state-1&error=access_denied`, {
      redirect: "manual",
    });

    assert.equal(response.status, 302);

    const location = response.headers.get("location");

    if (!location) {
      throw new Error("OAuth callback error response did not include a redirect location.");
    }

    const destination = new URL(location);
    assert.equal(destination.origin, "https://app.healthybob.test");
    assert.equal(destination.pathname, "/settings/devices");
    assert.equal(destination.searchParams.get("tab"), "wearables");
    assert.equal(destination.searchParams.get("deviceSyncStatus"), "error");
    assert.equal(destination.searchParams.get("deviceSyncProvider"), "demo");
    assert.equal(destination.searchParams.get("deviceSyncError"), "OAUTH_CALLBACK_REJECTED");
    assert.equal(destination.searchParams.get("deviceSyncErrorMessage"), "The user canceled the OAuth flow.");
  } finally {
    await server.close();
  }
});

test("device sync http server serves the Oura webhook verification challenge on the public listener", async () => {
  const server = await startDeviceSyncHttpServer({
    service: createStubService(),
    config: {
      host: "127.0.0.1",
      port: 0,
      controlToken: "control-token-for-tests",
      publicHost: "127.0.0.1",
      publicPort: 0,
      ouraWebhookVerificationToken: "verify-token-for-tests",
    },
  });

  try {
    const publicBaseUrl = `http://127.0.0.1:${server.public?.port}`;
    const response = await fetch(
      `${publicBaseUrl}/webhooks/oura?verification_token=verify-token-for-tests&challenge=random-challenge`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await response.text(), "random-challenge");
  } finally {
    await server.close();
  }
});
