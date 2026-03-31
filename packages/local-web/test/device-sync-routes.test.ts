import assert from "node:assert/strict";

import { beforeEach, test as baseTest, vi } from "vitest";

const test = baseTest.sequential;

vi.mock("../src/lib/device-sync", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/device-sync")>(
    "../src/lib/device-sync",
  );

  return {
    ...actual,
    beginDeviceConnection: vi.fn(),
    reconcileDeviceAccount: vi.fn(),
    disconnectDeviceAccount: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test("connect route redirects to the provider authorization URL", async () => {
  const { GET } = await import("../app/devices/connect/[provider]/route");
  const { beginDeviceConnection } = await import("../src/lib/device-sync");
  const mockedBeginDeviceConnection = vi.mocked(beginDeviceConnection);

  mockedBeginDeviceConnection.mockResolvedValue({
    provider: "whoop",
    state: "state_01",
    expiresAt: "2026-03-17T13:00:00.000Z",
    authorizationUrl: "https://whoop.test/oauth?state=state_01",
  });

  const response = await GET(
    new Request("http://127.0.0.1:3000/devices/connect/whoop"),
    {
      params: Promise.resolve({ provider: "whoop" }),
    },
  );

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("Location"),
    "https://whoop.test/oauth?state=state_01",
  );
  assert.equal(mockedBeginDeviceConnection.mock.calls[0]?.[0]?.provider, "whoop");
});

test("connect route retries without returnTo when the daemon rejects cross-origin return targets", async () => {
  const { GET } = await import("../app/devices/connect/[provider]/route");
  const {
    DeviceSyncWebError,
    beginDeviceConnection,
  } = await import("../src/lib/device-sync");
  const mockedBeginDeviceConnection = vi.mocked(beginDeviceConnection);

  mockedBeginDeviceConnection
    .mockRejectedValueOnce(
      new DeviceSyncWebError({
        code: "RETURN_TO_INVALID",
        message: "returnTo must be a relative path or an allowed origin URL.",
        status: 400,
      }),
    )
    .mockResolvedValueOnce({
      provider: "whoop",
      state: "state_02",
      expiresAt: "2026-03-17T13:05:00.000Z",
      authorizationUrl: "https://whoop.test/oauth?state=state_02",
    });

  const response = await GET(
    new Request("http://127.0.0.1:3000/devices/connect/whoop?returnTo=/settings/devices"),
    {
      params: Promise.resolve({ provider: "whoop" }),
    },
  );

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("Location"),
    "https://whoop.test/oauth?state=state_02",
  );
  assert.equal(mockedBeginDeviceConnection.mock.calls.length, 2);
  assert.equal(mockedBeginDeviceConnection.mock.calls[1]?.[0]?.returnTo, undefined);
});

test("account action routes redirect back to the requested page", async () => {
  const { POST: reconcile } = await import(
    "../app/devices/accounts/[accountId]/reconcile/route"
  );
  const { POST: disconnect } = await import(
    "../app/devices/accounts/[accountId]/disconnect/route"
  );
  const {
    reconcileDeviceAccount,
    disconnectDeviceAccount,
  } = await import("../src/lib/device-sync");

  vi.mocked(reconcileDeviceAccount).mockResolvedValue({
    account: {
      id: "acct_whoop_01",
      provider: "whoop",
      externalAccountId: "whoop-user-1",
      displayName: "WHOOP Tester",
      status: "active",
      scopes: [],
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
    },
  });
  vi.mocked(disconnectDeviceAccount).mockResolvedValue({
    account: {
      id: "acct_whoop_01",
      provider: "whoop",
      externalAccountId: "whoop-user-1",
      displayName: "WHOOP Tester",
      status: "disconnected",
      scopes: [],
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
      updatedAt: "2026-03-17T12:05:00.000Z",
    },
  });

  const reconcileResponse = await reconcile(
    new Request("http://127.0.0.1:3000/devices/accounts/acct_whoop_01/reconcile?returnTo=/"),
    {
      params: Promise.resolve({ accountId: "acct_whoop_01" }),
    },
  );
  const disconnectResponse = await disconnect(
    new Request("http://127.0.0.1:3000/devices/accounts/acct_whoop_01/disconnect?returnTo=/settings"),
    {
      params: Promise.resolve({ accountId: "acct_whoop_01" }),
    },
  );

  assert.equal(reconcileResponse.status, 307);
  assert.equal(reconcileResponse.headers.get("Location"), "http://127.0.0.1:3000/");
  assert.equal(disconnectResponse.status, 307);
  assert.equal(
    disconnectResponse.headers.get("Location"),
    "http://127.0.0.1:3000/settings",
  );
});

test("account action routes fall back to root for invalid returnTo values", async () => {
  const { POST: reconcile } = await import(
    "../app/devices/accounts/[accountId]/reconcile/route"
  );
  const { POST: disconnect } = await import(
    "../app/devices/accounts/[accountId]/disconnect/route"
  );
  const {
    reconcileDeviceAccount,
    disconnectDeviceAccount,
  } = await import("../src/lib/device-sync");

  const account = {
    id: "acct_whoop_01",
    provider: "whoop",
    externalAccountId: "whoop-user-1",
    displayName: "WHOOP Tester",
    status: "active" as const,
    scopes: [],
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

  vi.mocked(reconcileDeviceAccount).mockResolvedValue({
    account,
  });
  vi.mocked(disconnectDeviceAccount).mockResolvedValue({
    account: {
      ...account,
      status: "disconnected",
      updatedAt: "2026-03-17T12:05:00.000Z",
    },
  });

  const reconcileResponse = await reconcile(
    new Request(
      "http://127.0.0.1:3000/devices/accounts/acct_whoop_01/reconcile?returnTo=https://example.com/settings",
    ),
    {
      params: Promise.resolve({ accountId: "acct_whoop_01" }),
    },
  );
  const disconnectResponse = await disconnect(
    new Request(
      "http://127.0.0.1:3000/devices/accounts/acct_whoop_01/disconnect?returnTo=settings",
    ),
    {
      params: Promise.resolve({ accountId: "acct_whoop_01" }),
    },
  );

  assert.equal(reconcileResponse.status, 307);
  assert.equal(reconcileResponse.headers.get("Location"), "http://127.0.0.1:3000/");
  assert.equal(disconnectResponse.status, 307);
  assert.equal(disconnectResponse.headers.get("Location"), "http://127.0.0.1:3000/");
});
