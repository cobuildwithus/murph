import assert from "node:assert/strict";
import { test } from "vitest";

import { DeviceSyncError } from "../src/errors.ts";
import {
  buildJunctionClientUserId,
  createJunctionDeviceSyncProvider,
} from "../src/providers/junction.ts";
import { JunctionClient } from "../src/providers/junction-client.ts";
import { readJunctionWebhookResourceName } from "../src/public-ingress.ts";
import { createJsonResponse, readUrl, requireValue } from "./helpers.ts";

const CLIENT_USER_ID_SECRET = "junction-client-user-id-secret";

function createSdkJunctionProvider(
  fetchImpl: typeof fetch,
  clientUserIdNamespace?: string,
) {
  return createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    ...(clientUserIdNamespace ? { clientUserIdNamespace } : {}),
    clientUserIdSecret: CLIENT_USER_ID_SECRET,
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    timeseriesResources: [],
    fetchImpl,
  });
}

test("junction SDK ensureConnection resolves the same deterministic client_user_id as the Link flow", async () => {
  const requestedUrls: string[] = [];
  const expectedClientUserId = buildJunctionClientUserId(CLIENT_USER_ID_SECRET, "member-1");
  const fetchImpl: typeof fetch = async (input) => {
    const url = readUrl(input);
    requestedUrls.push(url);
    assert.ok(
      url.includes(`/v2/user/resolve/${encodeURIComponent(expectedClientUserId)}`),
      "ensureConnection should resolve the secret-derived client_user_id",
    );
    return createJsonResponse({ user_id: "junction-user-1" });
  };

  const provider = createSdkJunctionProvider(fetchImpl);
  const handler = requireValue(provider.sdkConnectionHandler);
  const connection = await handler.ensureConnection({
    ownerId: "member-1",
    now: "2026-06-11T00:00:00.000Z",
  });

  assert.equal(requestedUrls.length, 1);
  assert.equal(connection.externalAccountId, "junction-user-1");
  assert.equal(connection.setupPhase, "source_confirmed");
  assert.deepEqual(connection.credential, {
    kind: "provider_config",
    providerConfigKey: "junction",
  });
  assert.ok((connection.initialJobs?.length ?? 0) > 0, "ensure should seed initial jobs");
  assert.ok(connection.nextReconcileAt, "ensure should schedule the reconcile floor");
});

test("junction SDK ensureConnection applies the configured client user namespace", async () => {
  const expectedClientUserId = buildJunctionClientUserId(
    CLIENT_USER_ID_SECRET,
    "member-1",
    "e2e",
  );
  const provider = createSdkJunctionProvider(async (input) => {
    const url = readUrl(input);
    assert.ok(url.includes(`/v2/user/resolve/${encodeURIComponent(expectedClientUserId)}`));
    return createJsonResponse({ user_id: "junction-user-1" });
  }, "e2e");

  const handler = requireValue(provider.sdkConnectionHandler);
  const connection = await handler.ensureConnection({
    ownerId: "member-1",
    now: "2026-06-11T00:00:00.000Z",
  });

  assert.equal(connection.externalAccountId, "junction-user-1");
});

test("junction SDK ensureConnection rejects a missing owner id", async () => {
  const provider = createSdkJunctionProvider(async () => {
    throw new Error("ensureConnection must not reach Junction without an owner id");
  });
  const handler = requireValue(provider.sdkConnectionHandler);

  await assert.rejects(
    () => handler.ensureConnection({ ownerId: "  ", now: "2026-06-11T00:00:00.000Z" }),
    (error: unknown) =>
      error instanceof DeviceSyncError && error.code === "JUNCTION_OWNER_ID_REQUIRED",
  );
});

test("junction SDK createSignInToken mints through POST /v2/user/{id}/sign_in_token and surfaces the configured environment", async () => {
  const requests: Array<{ url: string; method: string | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: readUrl(input), method: init?.method });
    return createJsonResponse({
      user_id: "junction-user-1",
      sign_in_token: "junction-sdk-sign-in-token",
    });
  };

  const provider = createSdkJunctionProvider(fetchImpl);
  const handler = requireValue(provider.sdkConnectionHandler);
  const token = await handler.createSignInToken({ externalAccountId: "junction-user-1" });

  assert.equal(token.signInToken, "junction-sdk-sign-in-token");
  assert.equal(token.environment, "sandbox");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "POST");
  assert.ok(requests[0]?.url.includes("/v2/user/junction-user-1/sign_in_token"));
});

test("junction SDK createSignInToken fails closed without a stored Junction user id", async () => {
  const provider = createSdkJunctionProvider(async () => {
    throw new Error("createSignInToken must not reach Junction without a user id");
  });
  const handler = requireValue(provider.sdkConnectionHandler);

  await assert.rejects(
    () => handler.createSignInToken({ externalAccountId: "" }),
    (error: unknown) =>
      error instanceof DeviceSyncError && error.code === "JUNCTION_USER_ID_MISSING",
  );
});

test("JunctionClient.createSignInToken rejects responses without a sign_in_token", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => createJsonResponse({ user_id: "junction-user-1" }),
  });

  await assert.rejects(
    () => client.createSignInToken("junction-user-1"),
    (error: unknown) =>
      error instanceof DeviceSyncError && error.code === "JUNCTION_SIGN_IN_TOKEN_INVALID",
  );
});

test("readJunctionWebhookResourceName maps data events to normalized resources and lifecycle events to null", () => {
  assert.equal(readJunctionWebhookResourceName("daily.data.sleep.created"), "sleep");
  assert.equal(readJunctionWebhookResourceName("daily.data.heart_rate.updated"), "heartrate");
  assert.equal(readJunctionWebhookResourceName("historical.data.workouts.created"), "workouts");
  assert.equal(readJunctionWebhookResourceName("provider.connection.created"), null);
});
