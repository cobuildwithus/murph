import assert from "node:assert/strict";

import { test } from "vitest";

import {
  asErrorPayload,
  assertLocalDeviceSyncControlPlaneBaseUrl,
  createDeviceSyncJsonRequester,
  isDeviceSyncLocalControlPlaneError,
  isLoopbackDeviceSyncBaseUrl,
  parseJsonPayload,
  requestDeviceSyncJson,
  resolveDeviceSyncBaseUrl,
  resolveDeviceSyncControlPlane,
  resolveDeviceSyncControlToken,
  withControlPlaneAuth,
} from "../src/client.ts";

test("resolveDeviceSyncBaseUrl reads the unprefixed env var", () => {
  assert.equal(
    resolveDeviceSyncBaseUrl({
      env: {
        DEVICE_SYNC_BASE_URL: "http://127.0.0.1:9911/",
      },
    }),
    "http://127.0.0.1:9911",
  );
});

test("resolveDeviceSyncBaseUrl falls back to the default base URL when env is unset", () => {
  assert.equal(resolveDeviceSyncBaseUrl(), "http://localhost:8788");
});

test("resolveDeviceSyncBaseUrl rejects non-loopback base URLs when a control-plane bearer is configured", () => {
  assert.throws(
    () =>
      resolveDeviceSyncBaseUrl({
        value: "https://example.com/device-sync",
        controlToken: "control-token",
      }),
    (error) => isDeviceSyncLocalControlPlaneError(error),
  );
});

test("assertLocalDeviceSyncControlPlaneBaseUrl allows loopback control-plane targets", () => {
  assert.equal(isLoopbackDeviceSyncBaseUrl("http://127.0.0.1:8788"), true);
  assert.equal(isLoopbackDeviceSyncBaseUrl("http://localhost:8788"), true);
  assert.equal(isLoopbackDeviceSyncBaseUrl("http://[::1]:8788"), true);
  assert.equal(isLoopbackDeviceSyncBaseUrl("http://127.example.com:8788"), false);

  assert.doesNotThrow(() =>
    assertLocalDeviceSyncControlPlaneBaseUrl({
      baseUrl: "http://localhost:8788",
      controlToken: "control-token",
    }),
  );

  assert.throws(
    () =>
      assertLocalDeviceSyncControlPlaneBaseUrl({
        baseUrl: "http://127.example.com:8788",
        controlToken: "control-token",
      }),
    (error) => isDeviceSyncLocalControlPlaneError(error),
  );
});

test("resolveDeviceSyncControlToken reads the unprefixed control token", () => {
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        DEVICE_SYNC_CONTROL_TOKEN: "control-token",
      },
    }),
    "control-token",
  );
});

test("resolveDeviceSyncControlToken ignores DEVICE_SYNC_SECRET-only configuration", () => {
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        DEVICE_SYNC_SECRET: "secret-token",
      },
    }),
    null,
  );
});

test("resolveDeviceSyncControlToken returns null when no env is set", () => {
  assert.equal(resolveDeviceSyncControlToken(), null);
});

test("resolveDeviceSyncControlPlane resolves both base URL and token together", () => {
  assert.deepEqual(
    resolveDeviceSyncControlPlane({
      env: {
        DEVICE_SYNC_BASE_URL: "http://127.0.0.1:9911/",
        DEVICE_SYNC_CONTROL_TOKEN: "control-token",
      },
    }),
    {
      baseUrl: "http://127.0.0.1:9911",
      controlToken: "control-token",
    },
  );
});

test("client JSON helpers normalize payload parsing and auth headers", () => {
  assert.deepEqual(parseJsonPayload("   "), {});
  assert.equal(parseJsonPayload("{"), null);
  assert.deepEqual(
    asErrorPayload({
      error: {
        code: "DEVICE_SYNC_FAILED",
        message: "Request failed",
        retryable: true,
        details: {
          status: 503,
        },
      },
    }),
    {
      code: "DEVICE_SYNC_FAILED",
      message: "Request failed",
      retryable: true,
      details: {
        status: 503,
      },
    },
  );
  assert.deepEqual(asErrorPayload(["not-an-object"]), {});

  const headers = withControlPlaneAuth(
    {
      "x-murph": "device-sync",
    },
    "control-token",
  );
  assert.equal(new Headers(headers).get("authorization"), "Bearer control-token");
  assert.equal(new Headers(headers).get("x-murph"), "device-sync");
  assert.equal(withControlPlaneAuth(undefined, null), undefined);
});

test("requestDeviceSyncJson merges defaults, attaches auth, and returns parsed objects", async () => {
  let recordedUrl = "";
  let recordedHeaders: Headers | undefined;
  let recordedMethod = "";
  const requestJson = createDeviceSyncJsonRequester({
    baseUrl: "http://127.0.0.1:8788",
    controlToken: "control-token",
    requestDefaults: {
      headers: {
        accept: "application/json",
      },
      method: "POST",
    },
    fetchImpl: async (input, init) => {
      recordedUrl = typeof input === "string" ? input : input.toString();
      recordedHeaders = new Headers(init?.headers);
      recordedMethod = init?.method ?? "";
      return new Response(JSON.stringify({ ok: true, provider: "oura" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
    createUnavailableError(context) {
      return new Error(`unavailable:${context.path}`);
    },
    createHttpError(context) {
      return new Error(`http:${context.status}`);
    },
    createInvalidResponseError(context) {
      return new Error(`invalid:${context.status}`);
    },
  });

  const response = await requestJson<{ ok: boolean; provider: string }>("/providers", {
    headers: {
      "content-type": "application/json",
    },
  });

  assert.equal(recordedUrl, "http://127.0.0.1:8788/providers");
  assert.equal(recordedMethod, "POST");
  assert.ok(recordedHeaders);
  assert.equal(recordedHeaders.get("accept"), "application/json");
  assert.equal(recordedHeaders.get("content-type"), "application/json");
  assert.equal(recordedHeaders.get("authorization"), "Bearer control-token");
  assert.deepEqual(response, {
    ok: true,
    provider: "oura",
  });
});

test("requestDeviceSyncJson surfaces unavailable, HTTP, and invalid-payload errors through the caller hooks", async () => {
  await assert.rejects(
    () =>
      requestDeviceSyncJson({
        baseUrl: "http://127.0.0.1:8788",
        path: "/providers",
        fetchImpl: async () => {
          throw new Error("socket closed");
        },
        createUnavailableError(context) {
          return new Error(`unavailable:${context.baseUrl}:${context.path}`);
        },
        createHttpError(context) {
          return new Error(`http:${context.status}`);
        },
        createInvalidResponseError(context) {
          return new Error(`invalid:${String(context.payload)}`);
        },
      }),
    /unavailable:http:\/\/127\.0\.0\.1:8788:\/providers/u,
  );

  await assert.rejects(
    () =>
      requestDeviceSyncJson({
        baseUrl: "http://127.0.0.1:8788",
        path: "/providers",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "CONTROL_PLANE_AUTH_REQUIRED",
                message: "Missing bearer token",
                retryable: false,
              },
            }),
            { status: 401 },
          ),
        createUnavailableError(context) {
          return new Error(`unavailable:${context.path}`);
        },
        createHttpError(context) {
          return new Error(
            `http:${context.status}:${context.errorPayload.code}:${String(context.errorPayload.retryable)}`,
          );
        },
        createInvalidResponseError(context) {
          return new Error(`invalid:${String(context.payload)}`);
        },
      }),
    /http:401:CONTROL_PLANE_AUTH_REQUIRED:false/u,
  );

  await assert.rejects(
    () =>
      requestDeviceSyncJson({
        baseUrl: "http://127.0.0.1:8788",
        path: "/providers",
        fetchImpl: async () => new Response('"not-an-object"', { status: 200 }),
        createUnavailableError(context) {
          return new Error(`unavailable:${context.path}`);
        },
        createHttpError(context) {
          return new Error(`http:${context.status}`);
        },
        createInvalidResponseError(context) {
          return new Error(`invalid:${String(context.payload)}`);
        },
      }),
    /invalid:not-an-object/u,
  );
});
