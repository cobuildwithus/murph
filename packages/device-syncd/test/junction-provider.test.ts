import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "vitest";

import { DeviceSyncError } from "../src/errors.ts";
import {
  buildJunctionClientUserId,
  createJunctionDeviceSyncProvider,
} from "../src/providers/junction.ts";
import {
  buildJunctionProviderSourceInstanceKey,
  JUNCTION_CONNECT_SOURCE_TARGETS,
  JUNCTION_DEFAULT_PROVIDER_FILTER,
  JUNCTION_LINK_PROVIDER_SLUGS,
  normalizeJunctionProviderFilter,
  resolveJunctionConnectSourceLabel,
  resolveJunctionConnectTargetForSourceId,
} from "../src/providers/junction-connect-sources.ts";
import {
  isAllowedJunctionLinkHost,
  JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS,
  JunctionClient,
} from "../src/providers/junction-client.ts";
import { createJsonResponse, readUrl, requireValue } from "./helpers.ts";

import type {
  DeviceConnectionSourceRecord,
  DeviceSyncAccount,
  DeviceSyncJobRecord,
  ProviderJobContext,
} from "../src/types.ts";

function createAccount(overrides: Partial<Omit<DeviceSyncAccount, "credential">> & {
  credential?: DeviceSyncAccount["credential"];
} = {}): DeviceSyncAccount {
  return {
    id: "acct-junction-1",
    provider: "junction",
    externalAccountId: "junction-user-1",
    disconnectGeneration: 0,
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
      credentialMetadata: {},
    },
    displayName: "Junction",
    status: "active",
    scopes: [],
    accessTokenExpiresAt: null,
    metadata: {},
    connectedAt: "2026-04-01T00:00:00.000Z",
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function createJob(kind: string, payload: Record<string, unknown>): DeviceSyncJobRecord {
  return {
    id: `job-${kind}`,
    provider: "junction",
    accountId: "acct-junction-1",
    kind,
    payload,
    priority: 50,
    availableAt: "2026-04-03T00:00:00.000Z",
    attempts: 0,
    maxAttempts: 5,
    dedupeKey: null,
    status: "queued",
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
  };
}

function createJunctionProvider(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createJunctionDeviceSyncProvider>[0]> = {},
) {
  return createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    timeseriesResources: ["heartrate"],
    fetchImpl,
    ...overrides,
  });
}

function executeJunctionJob(
  provider: ReturnType<typeof createJunctionProvider>,
  context: ProviderJobContext,
  job: DeviceSyncJobRecord,
) {
  const executor = provider.jobExecutor;
  assert.ok(executor, "Junction provider should expose a job executor.");
  return executor.executeJob(context, job);
}

function requireJunctionConnectionHandler(provider: ReturnType<typeof createJunctionProvider>) {
  return requireValue(provider.connectionHandler, "Junction provider should expose a connection handler.");
}

function requireJunctionWebhookHandler(provider: ReturnType<typeof createJunctionProvider>) {
  return requireValue(provider.webhookHandler, "Junction provider should expose a webhook handler.");
}

function createJunctionSvixWebhook(input: {
  body: Record<string, unknown>;
  messageId?: string;
  secret?: string;
  signatureHeader?: (signature: string) => string;
  timestamp?: string;
}): { headers: Headers; rawBody: Buffer } {
  const messageId = input.messageId ?? "msg_test_123";
  const timestamp = input.timestamp ?? "1775155200";
  const secret = input.secret ?? "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==";
  const rawBody = Buffer.from(JSON.stringify(input.body));
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(`${messageId}.${timestamp}.`), rawBody]))
    .digest("base64");

  return {
    headers: new Headers({
      "svix-id": messageId,
      "svix-timestamp": timestamp,
      "svix-signature": input.signatureHeader?.(signature) ?? `v1,${signature}`,
    }),
    rawBody,
  };
}

test("Junction client_user_id is deterministic, bounded, and owner-blinded", () => {
  const clientUserId = buildJunctionClientUserId(
    "junction-client-user-id-secret",
    "owner-internal-id-123",
  );

  assert.equal(clientUserId.length, 32);
  assert.ok(clientUserId.startsWith("murph_"));
  assert.doesNotMatch(clientUserId, /owner|internal|123/u);
  assert.equal(
    clientUserId,
    buildJunctionClientUserId("junction-client-user-id-secret", "owner-internal-id-123"),
  );
});

test("Junction provider exposes primitive handlers without OAuth compatibility methods", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  assert.ok(provider.connectionHandler);
  assert.ok(provider.webhookHandler);
  assert.ok(provider.jobExecutor);
  assert.equal("buildConnectUrl" in provider, false);
  assert.equal("exchangeAuthorizationCode" in provider, false);
  assert.equal("refreshTokens" in provider, false);
});

test("Junction default provider filter covers hosted Link connect routes", () => {
  assert.equal(JUNCTION_CONNECT_SOURCE_TARGETS.length, 32);

  assert.deepEqual(
    JUNCTION_LINK_PROVIDER_SLUGS,
    JUNCTION_CONNECT_SOURCE_TARGETS
      .filter((target) => target.connectMode === "junction_link")
      .map((target) => target.providerSlug),
  );
  assert.deepEqual(JUNCTION_DEFAULT_PROVIDER_FILTER, normalizeJunctionProviderFilter(undefined));
  assert.deepEqual(normalizeJunctionProviderFilter(undefined), JUNCTION_DEFAULT_PROVIDER_FILTER);
  assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes("map_my_fitness"), true);
  assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes("dexcom_v3"), true);
  for (const providerSlug of [
    "samsung_health",
    "freestyle_libre_ble",
    "accuchek_ble",
    "contour_ble",
    "onetouch_ble",
  ]) {
    assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes(providerSlug), false);
  }

  assert.equal(resolveJunctionTarget("samsung_health")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("freestyle_libre_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("accuchek_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("contour_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("onetouch_ble")?.connectMode, "junction_sdk");

  assert.equal(resolveJunctionConnectTargetForSourceId("dexcom-g6-and-older"), "dexcom");
  assert.equal(resolveJunctionConnectTargetForSourceId("dexcom"), "dexcom_v3");
  assert.equal(resolveJunctionConnectTargetForSourceId("mapmyfitness"), "map_my_fitness");
  assert.equal(resolveJunctionConnectTargetForSourceId("accuchek"), "accuchek_ble");
  assert.equal(resolveJunctionConnectTargetForSourceId("onetouch"), "onetouch_ble");
  assert.equal(resolveJunctionConnectSourceLabel("accuchek_ble"), "Accu-Chek");
});

test("Junction provider source keys are stable provider-level opaque ids", () => {
  const garminKey = buildJunctionProviderSourceInstanceKey({
    connectionId: "acct-junction-1",
    sourceProviderSlug: "Garmin",
  });
  const garminKeyAgain = buildJunctionProviderSourceInstanceKey({
    connectionId: "acct-junction-1",
    sourceProviderSlug: "garmin",
  });
  const pelotonKey = buildJunctionProviderSourceInstanceKey({
    connectionId: "acct-junction-1",
    sourceProviderSlug: "peloton",
  });

  assert.equal(garminKey, garminKeyAgain);
  assert.notEqual(garminKey, pelotonKey);
  assert.match(garminKey ?? "", /^jxn_src_[a-f0-9]{32}$/u);
  assert.doesNotMatch(garminKey ?? "", /acct|junction|garmin/u);
});

test("Junction provider rejects non-Link routes from hosted web Link", () => {
  assert.deepEqual(normalizeJunctionProviderFilter(["oura", "withings"]), ["oura", "withings"]);

  assert.throws(
    () => normalizeJunctionProviderFilter([
      "oura",
      "apple_health_kit",
      "apple_healthkit",
      "health_connect",
      "samsung_health",
      "accuchek_ble",
      "withings",
    ]),
    /unsupported Junction Link provider slugs: apple_health_kit, apple_healthkit, health_connect, samsung_health, accuchek_ble/u,
  );
});

test("Junction provider rejects explicit filters with no hosted Link providers", () => {
  assert.throws(
    () => createJunctionProvider(async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    }, {
      providerFilter: ["accuchek_ble", "health_connect"],
    }),
    /unsupported Junction Link provider slugs: accuchek_ble, health_connect/u,
  );
});

function resolveJunctionTarget(providerSlug: string) {
  return JUNCTION_CONNECT_SOURCE_TARGETS.find((target) => target.providerSlug === providerSlug);
}

test("Junction createLinkToken accepts documented Link web URL hosts", async () => {
  const linkWebUrl = "https://link.tryvital.io/?token=link-token-1&env=sandbox&region=us";
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      assert.equal(readUrl(input), "https://api.sandbox.us.junction.com/v2/link/token");
      assert.equal(new Headers(init?.headers).get("x-vital-api-key"), "sk_us_test_123");
      return createJsonResponse({ link_web_url: linkWebUrl });
    },
  });

  const token = await client.createLinkToken({
    userId: "junction-user-1",
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
  });

  assert.equal(token.linkWebUrl, linkWebUrl);
  assert.equal(
    isAllowedJunctionLinkHost(new URL(token.linkWebUrl).hostname, JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS),
    true,
  );
});

test("Junction client derives the API host from environment and region", async () => {
  const requests: string[] = [];
  const client = new JunctionClient({
    apiKey: "pk_eu_test_123",
    environment: "production",
    region: "eu",
    fetchImpl: async (input) => {
      requests.push(readUrl(input));
      return createJsonResponse({ user_id: "junction-user-1" });
    },
  });

  const user = await client.createUser("murph_test_client_user");

  assert.equal(user.userId, "junction-user-1");
  assert.deepEqual(requests, ["https://api.eu.junction.com/v2/user/"]);
});

test("Junction createLinkToken rejects unexpected Link web URL hosts", async () => {
  assert.equal(isAllowedJunctionLinkHost("link.tryvital.io"), true);
  assert.equal(isAllowedJunctionLinkHost("tryvital.io"), true);
  assert.equal(isAllowedJunctionLinkHost(".tryvital.io"), false);
  assert.equal(isAllowedJunctionLinkHost("link.tryvital.io.example.test"), false);

  for (const linkWebUrl of [
    "https://link.example.test/session/link-token-1",
    "https://.tryvital.io/session/link-token-1",
    "https://link.tryvital.io.example.test/session/link-token-1",
    "http://link.tryvital.io/session/link-token-1",
  ]) {
    const client = new JunctionClient({
      apiKey: "sk_us_test_123",
      environment: "sandbox",
      region: "us",
      fetchImpl: async () => createJsonResponse({ link_web_url: linkWebUrl }),
    });

    await assert.rejects(
      () => client.createLinkToken({
        userId: "junction-user-1",
        callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      }),
      (error) => error instanceof DeviceSyncError
        && error.code === "JUNCTION_LINK_TOKEN_INVALID",
    );
  }
});

test("Junction createLinkToken honors configured allowed Link hosts", async () => {
  const createClient = (allowedLinkHosts: readonly string[]) => new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    allowedLinkHosts,
    fetchImpl: async () => createJsonResponse({
      link_web_url: "https://link.tryvital.io/?token=link-token-1&env=sandbox&region=us",
    }),
  });

  await assert.doesNotReject(() =>
    createClient(["tryvital.io"]).createLinkToken({
      userId: "junction-user-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    }));

  await assert.rejects(
    () => createClient(["junction.com"]).createLinkToken({
      userId: "junction-user-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    }),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_LINK_TOKEN_INVALID",
  );

  assert.throws(
    () => createClient([]),
    /Junction allowedLinkHosts must include at least one host/u,
  );
});

test("Junction beginConnection resolves or creates a user, returns Link URL, and seeds provider-config credentials", async () => {
  const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null;
    requests.push({ body, headers, url });

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/user/resolve/")) {
      return createJsonResponse({ message: "missing" }, 404);
    }

    if (url === "https://api.sandbox.us.junction.com/v2/user/") {
      return createJsonResponse({ user_id: "junction-user-1" });
    }

    if (url === "https://api.sandbox.us.junction.com/v2/link/token") {
      return createJsonResponse({ link_web_url: "https://link.junction.com/session/link-token-1" });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  const started = await requireJunctionConnectionHandler(provider).beginConnection({
    state: "state-1",
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    publicBaseUrl: "https://sync.example.test/device-sync",
    now: "2026-04-03T00:00:00.000Z",
    scopes: [],
    ownerId: "owner-internal-id-123",
  });

  assert.equal(started.authorizationUrl, "https://link.junction.com/session/link-token-1");
  assert.equal(started.connectionSeed?.externalAccountId, "junction-user-1");
  assert.equal(started.connectionSeed?.credential.kind, "provider_config");
  assert.equal(
    started.connectionSeed?.credential.kind === "provider_config"
      ? started.connectionSeed.credential.providerConfigKey
      : null,
    "junction",
  );
  assert.equal(started.connectionSeed?.setupPhase, "pending_link");
  assert.equal(started.connectionSeed?.setupExpiresAt, "2026-04-03T00:30:00.000Z");
  assert.deepEqual(started.connectionSeed?.metadata, undefined);
  assert.deepEqual(started.stateMetadata, undefined);

  const createUserBody = requests.find((request) => request.url.endsWith("/v2/user/"))?.body;
  assert.equal(typeof createUserBody === "object" && createUserBody !== null && "client_user_id" in createUserBody, true);
  assert.doesNotMatch(JSON.stringify(createUserBody), /owner-internal-id-123/u);

  const linkBody = requests.find((request) => request.url.endsWith("/v2/link/token"))?.body;
  assert.equal(
    typeof linkBody === "object" && linkBody !== null && "redirect_url" in linkBody
      ? linkBody.redirect_url
      : null,
    "https://sync.example.test/device-sync/connect/junction/callback?murph_state=state-1",
  );
  assert.deepEqual(
    typeof linkBody === "object" && linkBody !== null && "filter_on_providers" in linkBody
      ? linkBody.filter_on_providers
      : null,
    JUNCTION_DEFAULT_PROVIDER_FILTER,
  );
  assert.doesNotMatch(JSON.stringify(linkBody), /apple|health_connect/u);
  assert.equal(requests.every((request) => request.headers.get("x-vital-api-key") === "sk_us_test_123"), true);
});

test("Junction beginConnection narrows Link to the requested source provider", async () => {
  const requests: Array<{ body: unknown; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null;
    requests.push({ body, url });

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/user/resolve/")) {
      return createJsonResponse({ id: "junction-user-1" });
    }

    if (url === "https://api.sandbox.us.junction.com/v2/link/token") {
      return createJsonResponse({ link_web_url: "https://link.junction.com/session/link-token-1" });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  await requireJunctionConnectionHandler(provider).beginConnection({
    state: "state-1",
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    publicBaseUrl: "https://sync.example.test/device-sync",
    now: "2026-04-03T00:00:00.000Z",
    scopes: [],
    ownerId: "owner-internal-id-123",
    sourceProviderSlug: "fitbit",
  });

  const linkBody = requests.find((request) => request.url.endsWith("/v2/link/token"))?.body;
  assert.deepEqual(
    typeof linkBody === "object" && linkBody !== null && "filter_on_providers" in linkBody
      ? linkBody.filter_on_providers
      : null,
    ["fitbit"],
  );
});

test("Junction beginConnection rejects disabled source providers before external calls", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  await assert.rejects(
    () => requireJunctionConnectionHandler(provider).beginConnection({
      state: "state-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      publicBaseUrl: "https://sync.example.test/device-sync",
      now: "2026-04-03T00:00:00.000Z",
      scopes: [],
      ownerId: "owner-internal-id-123",
      sourceProviderSlug: "apple_health_kit",
    }),
    /Junction source provider is not enabled/u,
  );
});

test("Junction beginConnection rejects SDK-only source providers before external calls", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  await assert.rejects(
    () => requireJunctionConnectionHandler(provider).beginConnection({
      state: "state-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      publicBaseUrl: "https://sync.example.test/device-sync",
      now: "2026-04-03T00:00:00.000Z",
      scopes: [],
      ownerId: "owner-internal-id-123",
      sourceProviderSlug: "accuchek_ble",
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_SOURCE_PROVIDER_NOT_CONFIGURED",
  );
});

test("Junction completeConnection treats Link callback as weak and enqueues scalar polling windows", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  const connection = await requireJunctionConnectionHandler(provider).completeConnection({
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    state: "state-1",
    seededExternalAccountId: "junction-user-1",
    query: new URLSearchParams({
      murph_state: "state-1",
      state: "success",
    }),
    now: "2026-04-03T00:00:00.000Z",
    grantedScopes: [],
  });

  assert.equal(connection.externalAccountId, "junction-user-1");
  assert.equal(connection.setupPhase, "link_returned");
  assert.deepEqual(connection.initialJobs?.map((job) => job.kind), ["backfill", "reconcile"]);
  assert.deepEqual(connection.initialJobs?.[0]?.payload, {
    windowStart: "2026-01-03T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  const payload = connection.initialJobs?.[0]?.payload as Record<string, unknown> | undefined;
  assert.equal(Array.isArray(payload?.resources), false);
});

test("Junction completeConnection falls back to the callback user_id when no seed is present", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  const connection = await requireJunctionConnectionHandler(provider).completeConnection({
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    state: "state-1",
    query: new URLSearchParams({
      murph_state: "state-1",
      state: "success",
      user_id: "junction-user-ignored",
    }),
    now: "2026-04-03T00:00:00.000Z",
    grantedScopes: [],
  });

  assert.equal(connection.externalAccountId, "junction-user-ignored");
  assert.equal(connection.setupPhase, "link_returned");
});

test("Junction completeConnection rejects a callback user_id that differs from the seeded account", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      seededExternalAccountId: "junction-user-seeded",
      query: new URLSearchParams({
        murph_state: "state-1",
        state: "success",
        user_id: "junction-user-other",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_LINK_USER_MISMATCH",
  );
});

test("Junction completeConnection rejects failed Link callbacks", async () => {
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        state: "failed",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_LINK_FAILED",
  );
});

test("Junction verifies Svix webhooks and maps data events to scalar resource jobs", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.activity.created",
      user_id: "junction-user-1",
      client_user_id: "murph_blinded",
      data: {
        id: "activity-1",
        date: "2026-04-02",
        resource: "activity",
        source: {
          provider: "oura",
        },
      },
    },
    messageId: "msg_activity_1",
    timestamp: "1775174400",
  });

  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.externalAccountId, "junction-user-1");
  assert.equal(parsed.eventType, "daily.data.activity.created");
  assert.equal(parsed.traceId, "msg_activity_1");
  assert.equal(parsed.resourceCategory, "summary");
  assert.equal(parsed.unknownAccountAction, "retry");
  assert.deepEqual(parsed.jobs, [
    {
      kind: "resource",
      payload: {
        eventType: "daily.data.activity.created",
        objectId: "activity-1",
        occurredAt: "2026-04-02T00:00:00.000Z",
        resource: "activity",
        resourceCategory: "summary",
        sourceProviderSlug: "oura",
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      },
      priority: 65,
      dedupeKey: parsed.jobs[0]?.dedupeKey,
    },
  ]);
  assert.equal(typeof parsed.jobs[0]?.dedupeKey, "string");
});

test("Junction webhook source-provider extraction covers documented payload shapes", async () => {
  const cases: Array<{
    label: string;
    eventType: string;
    data: Record<string, unknown>;
    expectedSourceProviderSlug: string;
    expectedResource: string;
  }> = [
    {
      label: "historical data.provider",
      eventType: "historical.data.workouts.created",
      data: {
        id: "workout-zwift-1",
        provider: "zwift",
      },
      expectedSourceProviderSlug: "zwift",
      expectedResource: "workouts",
    },
    {
      label: "daily data.source.provider",
      eventType: "daily.data.workouts.created",
      data: {
        id: "workout-zwift-2",
        source: {
          provider: "zwift",
        },
      },
      expectedSourceProviderSlug: "zwift",
      expectedResource: "workouts",
    },
    {
      label: "daily data.source.slug",
      eventType: "daily.data.steps.created",
      data: {
        id: "steps-fitbit-1",
        source: {
          slug: "fitbit",
        },
      },
      expectedSourceProviderSlug: "fitbit",
      expectedResource: "steps",
    },
    {
      label: "nested provider slug",
      eventType: "daily.data.workouts.created",
      data: {
        id: "workout-zwift-3",
        provider: {
          slug: "zwift",
        },
      },
      expectedSourceProviderSlug: "zwift",
      expectedResource: "workouts",
    },
    {
      label: "nested provider provider",
      eventType: "daily.data.workouts.created",
      data: {
        id: "workout-zwift-4",
        provider: {
          provider: "zwift",
        },
      },
      expectedSourceProviderSlug: "zwift",
      expectedResource: "workouts",
    },
    {
      label: "aggregator provider only",
      eventType: "daily.data.steps.created",
      data: {
        id: "steps-aggregator-1",
        provider: "junction",
      },
      expectedSourceProviderSlug: "",
      expectedResource: "steps",
    },
    {
      label: "nested source beats aggregator provider",
      eventType: "daily.data.steps.created",
      data: {
        id: "steps-fitbit-2",
        provider: "junction",
        source: {
          provider: "fitbit",
        },
      },
      expectedSourceProviderSlug: "fitbit",
      expectedResource: "steps",
    },
  ];

  for (const testCase of cases) {
    const provider = createJunctionProvider(
      async (input) => {
        throw new Error(`Unexpected request: ${readUrl(input)}`);
      },
      {
        webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
      },
    );
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: testCase.eventType,
        user_id: `junction-user-${testCase.label.replace(/[^a-z0-9]+/giu, "-")}`,
        data: testCase.data,
      },
      messageId: `msg_${testCase.label.replace(/[^a-z0-9]+/giu, "_")}`,
      timestamp: "1775174400",
    });

    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });

    const job = parsed.jobs[0];
    assert.ok(job, testCase.label);
    assert.equal(job.kind, "resource", testCase.label);
    const payload = job.payload;
    assert.ok(payload, testCase.label);
    assert.equal(payload.resource, testCase.expectedResource, testCase.label);
    assert.equal(
      payload.sourceProviderSlug,
      testCase.expectedSourceProviderSlug,
      testCase.label,
    );
  }
});

test("Junction accepts nested webhook user ids and comma-delivered Svix signatures", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.heartrate.created",
      data: {
        id: "heart-rate-1",
        timestamp: "2026-04-02T12:00:00.000Z",
        sourceProvider: "fitbit",
        user: {
          id: "junction-user-nested",
        },
      },
    },
    messageId: "msg_heartrate_nested",
    signatureHeader: (signature) =>
      `v1,invalid,v1,${signature.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "")}`,
    timestamp: "1775174400",
  });

  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.externalAccountId, "junction-user-nested");
  assert.equal(parsed.resourceCategory, "timeseries");
  assert.equal(parsed.jobs[0]?.kind, "resource");
  assert.deepEqual(parsed.jobs[0]?.payload, {
    eventType: "daily.data.heartrate.created",
    objectId: "heart-rate-1",
    occurredAt: "2026-04-02T12:00:00.000Z",
    resource: "heartrate",
    resourceCategory: "timeseries",
    sourceProviderSlug: "fitbit",
    windowStart: "2026-04-01T12:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
});

test("Junction accepts user ids nested inside webhook envelopes", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const cases: Array<{ body: Record<string, unknown>; expectedUserId: string; messageId: string }> = [
    {
      body: {
        event_type: "provider.connection.created",
        data: {},
        payload: {
          user: {
            id: "junction-user-root-payload",
          },
        },
      },
      expectedUserId: "junction-user-root-payload",
      messageId: "msg_root_payload_user",
    },
    {
      body: {
        event_type: "provider.connection.created",
        data: {
          payload: {
            user: {
              id: "junction-user-data-payload",
            },
          },
        },
      },
      expectedUserId: "junction-user-data-payload",
      messageId: "msg_data_payload_user",
    },
    {
      body: {
        event_type: "provider.connection.created",
        data: {
          event: {
            message: {
              user: {
                id: "junction-user-event-message",
              },
            },
          },
        },
      },
      expectedUserId: "junction-user-event-message",
      messageId: "msg_event_message_user",
    },
  ];

  for (const { body, expectedUserId, messageId } of cases) {
    const webhook = createJunctionSvixWebhook({
      body,
      messageId,
      timestamp: "1775174400",
    });

    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });

    assert.equal(parsed.externalAccountId, expectedUserId);
    assert.deepEqual(parsed.jobs.map((job) => job.kind), ["backfill", "reconcile"]);
  }
});

test("Junction rejects webhooks with conflicting signed payload user ids", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-top",
      data: {
        event: {
          message: {
            user: {
              id: "junction-user-deep",
            },
          },
        },
      },
    },
    timestamp: "1775174400",
  });

  await assert.rejects(
    requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_WEBHOOK_USER_ID_CONFLICT",
  );
});

test("Junction rejects malformed whsec webhook secrets", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_not-base64!",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-1",
      data: {},
    },
    timestamp: "1775174400",
  });

  await assert.rejects(
    requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_WEBHOOK_SECRET_INVALID",
  );
});

test("Junction rejects webhooks with invalid Svix signatures", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-1",
      data: {},
    },
    timestamp: "1775174400",
  });

  await assert.rejects(
    requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: Buffer.from(JSON.stringify({
        event_type: "provider.connection.created",
        user_id: "junction-user-2",
        data: {},
      })),
      now: "2026-04-03T00:00:00.000Z",
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_WEBHOOK_SIGNATURE_INVALID",
  );
});

test("Junction polling updates source projection and imports bounded summary/timeseries snapshots", async () => {
  const requests: string[] = [];
  const groupedTimeseriesPayloads: Record<string, unknown> = {
    steps: {
      groups: {
        oura: [{
          data: [{
            accountId: "junction-account-timeseries-1",
            account: { id: "nested-account-timeseries-1" },
            app: { id: "nested-app-timeseries-1", name: "Nested Timeseries App" },
            device: { id: "nested-device-timeseries-1", name: "Nested Timeseries Device" },
            end: "2026-04-02T14:57:24+00:00",
            start: "2026-04-02T14:30:52+00:00",
            unit: "count",
            user_id: "junction-user-timeseries-1",
            value: 123,
          }],
          source: {
            provider: "oura",
            type: "ring",
            name: "Timeseries Oura Ring",
            device_id: "timeseries-device-oura-ring-1",
            app_id: "timeseries-app-oura-cloud-1",
          },
        }],
      },
    },
    distance: {
      groups: {
        oura: [{
          data: [{
            end: "2026-04-02T14:57:24+00:00",
            start: "2026-04-02T14:30:52+00:00",
            unit: "m",
            value: 5.6,
          }],
          source: { provider: "oura", type: "ring" },
        }],
      },
    },
    heartrate: {
      groups: {
        oura: [{
          data: [{
            timestamp: "2026-04-02T14:30:52+00:00",
            unit: "bpm",
            value: 70,
          }],
          source: { provider: "oura", type: "ring" },
        }],
      },
    },
    hrv: {
      groups: {
        oura: [{
          data: [{
            timestamp: "2026-04-02T14:30:52+00:00",
            unit: "rmssd",
            value: 48,
          }],
          source: { provider: "oura", type: "ring" },
        }],
      },
    },
  };
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-connection-oura-ring-1",
            name: "Oura Ring",
            status: "connected",
            source: {
              provider: "oura",
              device_id: "device-oura-ring-1",
              app_id: "app-oura-cloud-1",
            },
            resource_availability: {
              sleep: true,
              connectedSources: ["oura"],
              source: "Oura Ring",
              provider: "oura",
              provider_connection_id: "provider-connection-oura-ring-1",
              provider_name: "Oura Cloud",
              device_id: "device-oura-ring-1",
              deviceName: "Oura Ring",
              app_id: "app-oura-cloud-1",
              app_name: "Oura App",
              user_id: "blocked",
            },
          },
          {
            id: "provider-connection-oura-ring-2",
            slug: "oura",
            name: "Oura Ring 2",
            status: "connected",
            source: {
              device_id: "device-oura-ring-2",
              app_id: "app-oura-cloud-1",
            },
            resource_availability: {
              activity: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      const cursor = new URL(url).searchParams.get("cursor");
      if (cursor === "page-2") {
        return createJsonResponse({
          data: [{
            id: "summary-2",
            accountId: "junction-account-raw-2",
            providerConnectionId: "provider-connection-oura-ring-2",
            userId: "junction-user-raw-2",
            steps: 2000,
          }],
        });
      }

      return createJsonResponse({
        data: [{
          id: "summary-1",
          Source: { id: "nested-source-summary-1", name: "Nested Source Summary" },
          account_id: "junction-account-raw-1",
          account: { id: "nested-account-summary-1" },
          app: { id: "nested-app-summary-1", name: "Nested Summary App" },
          client_user_id: "client-user-raw-1",
          device: { id: "nested-device-summary-1", name: "Nested Summary Device" },
          provider_connection_id: "provider-connection-oura-ring-1",
          steps: 1000,
        }],
        next_cursor: "page-2",
      });
    }

    const timeseriesResource = new URL(url).pathname.match(/\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u)?.[1];
    if (timeseriesResource && timeseriesResource in groupedTimeseriesPayloads) {
      return createJsonResponse(groupedTimeseriesPayloads[timeseriesResource]);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["steps", "distance", "heartrate", "hrv"],
  });
  const sources: DeviceConnectionSourceRecord[] = [];
  const importedSnapshots: unknown[] = [];
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: (input) => {
      const source: DeviceConnectionSourceRecord = {
        id: `src-${sources.length + 1}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
      sources.push(source);
      return source;
    },
    refreshAccountTokens: async () => createAccount(),
    logger: {},
  };

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch, undefined);
  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.sourceProviderSlug, "oura");
  assert.equal(sources[0]?.status, "connected");
  assert.equal(
    sources[0]?.sourceInstanceKey,
    buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "oura",
    }),
  );
  assert.doesNotMatch(sources[0]?.sourceInstanceKey ?? "", /provider|device|oura|ring|app/u);
  assert.equal(sources[0]?.resourceAvailabilitySummary.sourceInstanceKeyFallback, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.sleep, true);
  assert.equal(sources[0]?.resourceAvailabilitySummary.activity, true);
  assert.equal(sources[0]?.resourceAvailabilitySummary.connectedSources, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.source, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.provider, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.provider_connection_id, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.provider_name, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.device_id, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.deviceName, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.app_id, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.app_name, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.user_id, undefined);
  assert.equal(importedSnapshots.length, 1);
  assert.match(JSON.stringify(importedSnapshots[0]), /"provider":"junction"/u);
  const snapshotJson = JSON.stringify(importedSnapshots[0]);
  assert.doesNotMatch(snapshotJson, /provider-connection-oura-ring|device-oura-ring|app-oura-cloud/u);
  assert.doesNotMatch(snapshotJson, /junction-user-1|junction-account-raw|junction-user-raw|client-user-raw|junction-account-timeseries|junction-user-timeseries/u);
  assert.doesNotMatch(snapshotJson, /nested-(source|account|device|app)-summary|Nested Summary|nested-(account|device|app)-timeseries|Nested Timeseries/u);
  const snapshot = importedSnapshots[0] as {
    accountId?: string;
    connections?: Array<Record<string, unknown>>;
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, Array<Record<string, unknown>>>;
  };
  assert.match(snapshot.accountId ?? "", /^jxn_acct_[a-f0-9]{32}$/u);
  const importedConnection = snapshot.connections?.[0] as
    | {
        provider?: unknown;
        source?: unknown;
        sourceInstanceId?: string;
        sourceProviderSlug?: string;
      }
    | undefined;
  assert.match(
    importedConnection?.sourceInstanceId ?? "",
    /^source-[a-f0-9]{24}$/u,
  );
  assert.deepEqual(Object.keys(importedConnection ?? {}).sort(), [
    "sourceInstanceId",
    "sourceProviderSlug",
  ]);
  assert.equal(importedConnection?.sourceProviderSlug, "oura");
  assert.equal((importedConnection as { source?: unknown } | undefined)?.source, undefined);
  assert.equal((importedConnection as { provider?: unknown } | undefined)?.provider, undefined);
  assert.equal(snapshot.summaries?.activity?.[0]?.account_id, undefined);
  assert.equal(snapshot.summaries?.activity?.[0]?.Source, undefined);
  assert.equal(snapshot.summaries?.activity?.[0]?.account, undefined);
  assert.equal(snapshot.summaries?.activity?.[0]?.app, undefined);
  assert.equal(snapshot.summaries?.activity?.[0]?.client_user_id, undefined);
  assert.equal(snapshot.summaries?.activity?.[0]?.device, undefined);
  assert.equal(snapshot.summaries?.activity?.[0]?.provider_connection_id, undefined);
  assert.equal(snapshot.summaries?.activity?.[1]?.accountId, undefined);
  assert.equal(snapshot.summaries?.activity?.[1]?.providerConnectionId, undefined);
  assert.equal(snapshot.summaries?.activity?.[1]?.userId, undefined);
  assert.deepEqual(Object.keys(snapshot.timeseries ?? {}).sort(), ["distance", "heartrate", "hrv", "steps"]);
  assert.equal(snapshot.timeseries?.steps?.length, 1);
  assert.equal(snapshot.timeseries?.distance?.length, 1);
  assert.equal(snapshot.timeseries?.heartrate?.length, 1);
  assert.equal(snapshot.timeseries?.hrv?.length, 1);
  const stepRecord = snapshot.timeseries?.steps?.[0];
  assert.equal(stepRecord?.accountId, undefined);
  assert.equal(stepRecord?.account, undefined);
  assert.equal(stepRecord?.app, undefined);
  assert.equal(stepRecord?.device, undefined);
  assert.equal(stepRecord?.sourceProviderSlug, "oura");
  assert.equal(stepRecord?.sourceType, "ring");
  assert.equal(stepRecord?.sourceName, undefined);
  assert.equal(stepRecord?.sourceDeviceId, undefined);
  assert.equal(stepRecord?.sourceAppId, undefined);
  assert.equal(stepRecord?.user_id, undefined);
  assert.equal((stepRecord as { source?: unknown } | undefined)?.source, undefined);
  assert.equal((stepRecord as { provider?: unknown } | undefined)?.provider, undefined);
  assert.equal(typeof stepRecord?.sourceInstanceId, "string");
  assert.match(String(stepRecord?.sourceInstanceId), /^source-[a-f0-9]{24}$/u);
  assert.equal(snapshot.timeseries?.distance?.[0]?.sourceType, "ring");
  assert.equal(snapshot.timeseries?.heartrate?.[0]?.junctionResource, "heartrate");
  assert.equal(snapshot.timeseries?.hrv?.[0]?.unit, "rmssd");
  assert.doesNotMatch(
    JSON.stringify(snapshot.timeseries),
    /Timeseries Oura Ring|timeseries-device-oura-ring-1|timeseries-app-oura-cloud-1/u,
  );
  assert.equal(requests.filter((url) => url.includes("/v2/summary/")).length, 2);
  assert.equal(requests.some((url) => url.includes("cursor=page-2")), true);
  const timeseriesRequests = requests.filter((url) => url.includes("/v2/timeseries/"));
  assert.equal(timeseriesRequests.length, 8);
  assert.equal(timeseriesRequests.every((url) => url.includes("/grouped?")), true);
  assert.equal(timeseriesRequests.some((url) => url.includes("/heartrate?")), false);
  assert.equal(requests.every((url) => !url.includes("glucose") && !url.includes("cgm")), true);
});

test("Junction source projection uses provider-level keys for slug-only sources", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "withings",
            name: "Withings",
            status: "connected",
            resource_availability: {
              body: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    if (url.includes("/v2/timeseries/junction-user-1/heartrate")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const sources: DeviceConnectionSourceRecord[] = [];
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async () => ({ imported: true }),
    upsertConnectionSource: (input) => {
      const source: DeviceConnectionSourceRecord = {
        id: `src-${sources.length + 1}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
      sources.push(source);
      return source;
    },
    refreshAccountTokens: async () => createAccount(),
    logger: {},
  };

  await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(sources.length, 1);
  assert.equal(
    sources[0]?.sourceInstanceKey,
    buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "withings",
    }),
  );
  assert.equal(sources[0]?.resourceAvailabilitySummary.body, true);
  assert.equal(sources[0]?.resourceAvailabilitySummary.sourceInstanceKeyFallback, undefined);
});

test("Junction resource jobs fetch only the hinted resource window", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              activity: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", steps: 1200 }] });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const importedSnapshots: unknown[] = [];
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: () => ({
      id: "src-1",
      connectionId: "acct-junction-1",
      sourceInstanceKey: "src-key",
      sourceProviderSlug: "oura",
      displayName: "Oura Ring",
      status: "connected",
      resourceAvailabilitySummary: {},
      lastErrorCode: null,
      lastErrorMessage: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    }),
    refreshAccountTokens: async () => createAccount(),
    logger: {},
  };

  await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "activity-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "oura",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(requests.filter((url) => url.includes("/v2/summary/activity/")).length, 1);
  assert.equal(requests.some((url) => url.includes("/v2/timeseries/")), false);
  assert.equal(importedSnapshots.length, 1);
  assert.match(JSON.stringify(importedSnapshots[0]), /"activity"/u);
});

test("Junction resource jobs skip opt-in glucose when it is not configured", async () => {
  const requests: string[] = [];
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "dexcom_v3",
            name: "Dexcom",
            status: "connected",
            resource_availability: {
              glucose: true,
            },
          },
        ],
      });
    }

    if (url.includes("glucose")) {
      throw new Error(`Unexpected glucose request: ${url}`);
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const importedSnapshots: unknown[] = [];
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: () => ({
      id: "src-1",
      connectionId: "acct-junction-1",
      sourceInstanceKey: "src-key",
      sourceProviderSlug: "dexcom_v3",
      displayName: null,
      status: "connected",
      resourceAvailabilitySummary: {},
      lastErrorCode: null,
      lastErrorMessage: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    }),
    refreshAccountTokens: async () => createAccount(),
    logger: {
      warn(_message, context) {
        warnings.push(context ?? {});
      },
    },
  };

  await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      eventType: "daily.data.glucose.created",
      objectId: "glucose-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "glucose",
      sourceProviderSlug: "dexcom_v3",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(requests.filter((url) => url.includes("glucose")).length, 0);
  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual((importedSnapshots[0] as { timeseries?: Record<string, unknown[]> }).timeseries, {});
  assert.equal(warnings[0]?.resource, "glucose");
  assert.equal(warnings[0]?.resourceCategory, "timeseries");
});

test("Junction resource jobs infer opt-in glucose as timeseries", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "dexcom_v3",
            name: "Dexcom",
            status: "connected",
            resource_availability: {
              glucose: true,
            },
          },
        ],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/glucose/grouped")) {
      return createJsonResponse({
        groups: {
          dexcom_v3: [{
            data: [{ timestamp: "2026-04-02T00:00:00Z", value: 101 }],
            source: { provider: "dexcom_v3", type: "cgm" },
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["glucose"],
  });
  const importedSnapshots: unknown[] = [];
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: () => ({
      id: "src-1",
      connectionId: "acct-junction-1",
      sourceInstanceKey: "src-key",
      sourceProviderSlug: "dexcom_v3",
      displayName: null,
      status: "connected",
      resourceAvailabilitySummary: {},
      lastErrorCode: null,
      lastErrorMessage: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    }),
    refreshAccountTokens: async () => createAccount(),
    logger: {},
  };

  await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      eventType: "daily.data.glucose.created",
      objectId: "glucose-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "glucose",
      sourceProviderSlug: "dexcom_v3",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(requests.filter((url) => url.includes("/v2/timeseries/junction-user-1/glucose/grouped")).length, 2);
  assert.equal(requests.some((url) => url.includes("/v2/summary/glucose/")), false);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as { timeseries?: Record<string, unknown[]> };
  assert.equal(snapshot.timeseries?.glucose?.length, 1);
  assert.match(JSON.stringify(snapshot), /"glucose"/u);
});
