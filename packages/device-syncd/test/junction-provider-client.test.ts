import {
  createAccount,
  createJob,
  createJunctionJobContext,
  createJunctionProvider,
  createStoredAccount,
  executeJunctionJob,
} from "./junction-provider.harness.ts";

import assert from "node:assert/strict";
import { JunctionError } from "@junction-api/sdk";
import { test, vi } from "vitest";
import { normalizeConfiguredDeviceSyncJobInput } from "../src/provider-job-definitions.ts";
import { DeviceSyncError } from "../src/errors.ts";
import {
  isAllowedJunctionLinkHost,
  JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS,
  JUNCTION_MAX_USER_PROVIDERS,
  JUNCTION_WORKOUT_STREAM_MAX_RESPONSE_BYTES,
  JunctionClient,
  parseJunctionHistoricalPullSnapshot,
} from "../src/providers/junction-client.ts";
import { createJsonResponse, makeTempDirectory, readUrl, requireValue } from "./helpers.ts";

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

test("Junction historical-pull introspection matches the exact user without SDK release metadata and preserves future states", () => {
  const snapshot = parseJunctionHistoricalPullSnapshot({
    data: [
      {
        user_id: "junction-user-other",
        provider: {
          garmin: {
            not_pulled: [],
            pulled: {
              activity: {
                days_with_data: 10,
                status: "failure",
              },
            },
          },
        },
      },
      {
        user_id: "junction-user-1",
        provider: {
          oura: {
            not_pulled: ["sleep", "sleep"],
            pulled: {
              activity: {
                days_with_data: 0,
                range_end: "2026-04-03T00:00:00+00:00",
                range_start: "2026-04-03T00:00:00+00:00",
                status: "success",
              },
              sleep_cycle: {
                daysWithData: 3,
                errorDetails: "Provider is preparing this resource.",
                rangeEnd: "2026-04-03T00:00:00+00:00",
                rangeStart: "2026-04-01T00:00:00+00:00",
                status: "paused_by_provider",
              },
            },
          },
        },
      },
    ],
  }, "junction-user-1");

  assert.deepEqual(snapshot, {
    matchedUser: true,
    sources: [{
      notPulledResources: ["sleep"],
      pulledResources: [
        {
          daysWithData: 0,
          errorDetails: null,
          rangeEnd: "2026-04-03T00:00:00+00:00",
          rangeStart: "2026-04-03T00:00:00+00:00",
          resource: "activity",
          status: "success",
        },
        {
          daysWithData: 3,
          errorDetails: "Provider is preparing this resource.",
          rangeEnd: "2026-04-03T00:00:00+00:00",
          rangeStart: "2026-04-01T00:00:00+00:00",
          resource: "sleep_cycle",
          status: "paused_by_provider",
        },
      ],
      sourceProviderSlug: "oura",
    }],
  });

  assert.deepEqual(
    parseJunctionHistoricalPullSnapshot({
      data: [{ user_id: "junction-user-other", provider: {} }],
    }, "junction-user-1"),
    { matchedUser: false, sources: [] },
  );
});

test("Junction historical-pull introspection applies the optional provider filter at both request and parse boundaries", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input) => {
      const url = new URL(readUrl(input));
      assert.equal(url.origin, "https://api.sandbox.us.junction.com");
      assert.equal(url.pathname, "/v2/introspect/historical_pull");
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        provider: "garmin",
        user_id: "junction-user-1",
        user_limit: "2",
      });
      return createJsonResponse({
        data: [{
          user_id: "junction-user-1",
          provider: {
            garmin: {
              not_pulled: ["sleep"],
              pulled: {
                activity: {
                  days_with_data: 0,
                  status: "success",
                },
              },
            },
            oura: {
              not_pulled: [],
              pulled: {
                activity: {
                  days_with_data: 1,
                  status: "success",
                },
              },
            },
          },
        }],
      });
    },
  });

  const snapshot = await client.introspectHistoricalPull({
    sourceProviderSlug: "Garmin",
    userId: "junction-user-1",
    userLimit: 2,
  });

  assert.deepEqual(snapshot, {
    matchedUser: true,
    sources: [{
      notPulledResources: ["sleep"],
      pulledResources: [{
        daysWithData: 0,
        errorDetails: null,
        rangeEnd: null,
        rangeStart: null,
        resource: "activity",
        status: "success",
      }],
      sourceProviderSlug: "garmin",
    }],
  });
});

test("Junction historical-pull introspection rejects malformed envelopes as retryable", () => {
  assert.throws(
    () => parseJunctionHistoricalPullSnapshot({ data: {} }, "junction-user-1"),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_HISTORICAL_PULL_RESPONSE_INVALID");
      assert.equal(error.httpStatus, 502);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("Junction createLinkToken sends selected OAuth provider for direct Link dispatch", async () => {
  const requests: unknown[] = [];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      assert.equal(readUrl(input), "https://api.sandbox.us.junction.com/v2/link/token");
      requests.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      return createJsonResponse({
        link_web_url: "https://link.junction.com/session/link-token-1",
      });
    },
  });

  await client.createLinkToken({
    userId: "junction-user-1",
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    provider: "Map-My-Fitness",
    providerFilter: ["garmin", "fitbit"],
  });

  const body = requests[0];
  assert.equal(
    typeof body === "object" && body !== null && "provider" in body
      ? body.provider
      : null,
    "map_my_fitness",
  );
  assert.equal(
    typeof body === "object" && body !== null && "filter_on_providers" in body,
    false,
  );
});

test("Junction client includes safe provider diagnostics for failed API requests", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      assert.equal(readUrl(input), "https://api.sandbox.us.junction.com/v2/link/token");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-vital-api-key"), "sk_us_test_123");
      assert.equal(headers.get("x-fern-sdk-name"), "@junction-api/sdk");
      assert.equal(headers.get("x-fern-sdk-version"), "1.2.0");
      return createJsonResponse({
        code: "invalid_request",
        message: "The link token request is missing a provider selection.",
      }, 400);
    },
  });

  await assert.rejects(
    () => client.createLinkToken({
      userId: "junction-user-sensitive",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback?code=secret",
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.equal(error.httpStatus, 502);
      assert.equal(error.message, "Junction API request failed for junction_link_token_create.");
      assert.deepEqual(error.details, {
        accountStatus: null,
        requestAuthKind: "provider_config_api_key_header",
        requestAuthPlacement: "headers",
        requestBodyFieldCount: 2,
        requestBodyFieldNames: "redirect_url.user_id",
        requestBodyKind: "json_object",
        requestContentType: "application_json",
        requestCredentialPresent: true,
        requestEndpointKind: "junction_link_token_create",
        requestMethod: "POST",
        requestQueryParameterCount: 0,
        requestQueryParameterNames: null,
        responseErrorCode: "invalid_request",
        responseErrorDescription: "The link token request is missing a provider selection.",
        responseErrorDescriptionFieldPresent: true,
        responseErrorFieldPresent: true,
        responseShapeKind: "json_object",
        retryable: false,
        status: 400,
      });
      const serialized = JSON.stringify(error);
      assert.equal(serialized.includes("sk_us_test_123"), false);
      assert.equal(serialized.includes("junction-user-sensitive"), false);
      assert.equal(serialized.includes("code=secret"), false);
      return true;
    },
  );
});

test("Junction client treats request timeouts as terminal aborts", async () => {
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    requestTimeoutMs: 1,
    fetchImpl: async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      assert.ok(signal);
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1"),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.equal(error.cause instanceof DOMException, true);
      assert.equal((error.cause as DOMException).name, "TimeoutError");
      return true;
    },
  );
  assert.equal(requests, 1);
});

test("Junction client wraps generic abort errors caused by request timeouts", async () => {
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    requestTimeoutMs: 1,
    fetchImpl: async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      assert.ok(signal);
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1"),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.equal(error.cause instanceof DOMException, true);
      assert.equal((error.cause as DOMException).name, "AbortError");
      return true;
    },
  );
  assert.equal(requests, 1);
});

test("Junction client rethrows caller aborts instead of wrapping them as provider failures", async () => {
  const abortController = new AbortController();
  const abortError = new Error("foreground yield");
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (_input, init) => {
      requests += 1;
      abortController.abort(abortError);
      const signal = init?.signal;
      assert.ok(signal);

      if (signal.aborted) {
        throw signal.reason;
      }

      throw new Error("request should have been aborted");
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1", {
      signal: abortController.signal,
    }),
    (error) => error === abortError,
  );
  assert.equal(requests, 1);
});

test("Junction client preserves caller abort reasons when fetch reports a generic AbortError", async () => {
  const abortController = new AbortController();
  const abortError = new Error("foreground yield");
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      assert.ok(signal);

      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
        abortController.abort(abortError);
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1", {
      signal: abortController.signal,
    }),
    (error) => error === abortError,
  );
  assert.equal(requests, 1);
});

test("Junction client does not misclassify request timeouts as late caller aborts", async () => {
  const abortController = new AbortController();
  const abortError = new Error("foreground yield");
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    requestTimeoutMs: 1,
    fetchImpl: async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      assert.ok(signal);

      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            abortController.abort(abortError);
            reject(new DOMException("The operation was aborted.", "AbortError"));
          },
          { once: true },
        );
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1", {
      signal: abortController.signal,
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.notEqual(error.cause, abortError);
      assert.equal(error.cause instanceof DOMException, true);
      assert.equal((error.cause as DOMException).name, "AbortError");
      return true;
    },
  );
  assert.equal(requests, 1);
});

test("Junction client keeps GET retries in Murph and never retries writes", async () => {
  let getRequests = 0;
  const getClient = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      getRequests += 1;
      return new Response(JSON.stringify({ code: "unavailable" }), {
        status: 503,
        headers: {
          "content-type": "application/json",
          "retry-after": "0",
        },
      });
    },
  });

  await assert.rejects(
    () => getClient.listUserProviders("junction-user-1"),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_REQUEST_FAILED"
      && error.retryable,
  );
  assert.equal(getRequests, 3);

  let postRequests = 0;
  const postClient = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      postRequests += 1;
      return new Response(JSON.stringify({ code: "unavailable" }), {
        status: 503,
        headers: {
          "content-type": "application/json",
          "retry-after": "0",
        },
      });
    },
  });

  await assert.rejects(
    () => postClient.createLinkToken({
      userId: "junction-user-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    }),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_REQUEST_FAILED"
      && !error.retryable,
  );
  assert.equal(postRequests, 1);
});

test("Junction client uses the SDK typed result for an official connected-provider response", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => createJsonResponse({
      garmin: [{
        created_on: "2026-04-03T12:00:00+00:00",
        error_details: {
          error_message: "Provider token expired.",
          error_type: "token_refresh_failed",
          errored_at: "2026-04-03T12:00:00+00:00",
        },
        logo: "https://cdn.example.test/garmin.svg",
        name: "Garmin",
        resource_availability: {
          activity: { status: "available" },
        },
        slug: "garmin",
        status: "error",
      }],
    }),
  });

  const providers = await client.listUserProviders("junction-user-1");
  assert.equal(providers.length, 1);
  assert.deepEqual(providers[0]?.errorDetails, {
    errorMessage: "Provider token expired.",
    errorType: "token_refresh_failed",
    erroredAt: "2026-04-03T12:00:00.000Z",
  });
  assert.deepEqual(providers[0]?.resourceAvailability, {
    activity: { status: "available" },
  });
});

test("Junction client falls back to a bounded raw success only for a legacy sparse response", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => createJsonResponse({
      providers: [{
        name: "Garmin",
        resource_availability: { activity: true },
        slug: "garmin",
        status: "connected",
      }],
    }),
  });

  const providers = await client.listUserProviders("junction-user-1");
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.slug, "garmin");
  assert.deepEqual(providers[0]?.resourceAvailability, { activity: true });
});

test("Junction client retries generic GET fetch failures but never retries generic write failures", async () => {
  let getRequests = 0;
  const getClient = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      getRequests += 1;
      throw new Error("temporary network failure");
    },
  });

  await assert.rejects(
    () => getClient.listUserProviders("junction-user-1"),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_REQUEST_FAILED"
      && error.retryable,
  );
  assert.equal(getRequests, 3);

  let postRequests = 0;
  const postClient = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      postRequests += 1;
      throw new Error("write network failure");
    },
  });

  await assert.rejects(
    () => postClient.createLinkToken({
      userId: "junction-user-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    }),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_REQUEST_FAILED"
      && !error.retryable,
  );
  assert.equal(postRequests, 1);
});

test("Junction client rejects malformed successful JSON without treating it as an empty response", async () => {
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      requests += 1;
      return new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await assert.rejects(
    () => client.createLinkToken({
      userId: "junction-user-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    }),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_INVALID_JSON"
      && !error.retryable,
  );
  assert.equal(requests, 1);
});

test("Junction client rejects a declared response above the transport byte limit before reading it", async () => {
  let bodyCancelled = false;
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      requests += 1;
      return new Response(new ReadableStream<Uint8Array>({
        cancel() {
          bodyCancelled = true;
        },
      }), {
        status: 200,
        headers: {
          "content-length": String(32 * 1_024 * 1_024 + 1),
          "content-type": "application/json",
        },
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1"),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_RESPONSE_TOO_LARGE"
      && !error.retryable,
  );
  assert.equal(requests, 1);
  assert.equal(bodyCancelled, true);
});

test("Junction client errors and cancels a chunked response that crosses the transport byte limit", async () => {
  let bodyCancelled = false;
  let requests = 0;
  let chunkIndex = 0;
  const chunks = [
    new Uint8Array(32 * 1_024 * 1_024),
    new Uint8Array([0x20]),
  ];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      requests += 1;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[chunkIndex];
          chunkIndex += 1;
          if (chunk) {
            controller.enqueue(chunk);
          }
        },
        cancel() {
          bodyCancelled = true;
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1"),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_RESPONSE_TOO_LARGE"
      && !error.retryable,
  );
  assert.equal(requests, 1);
  assert.equal(bodyCancelled, true);
});

test("Junction workout streams enforce their narrower response cap before SDK parsing", async () => {
  let bodyCancelled = false;
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      requests += 1;
      return new Response(new ReadableStream<Uint8Array>({
        cancel() {
          bodyCancelled = true;
        },
      }), {
        status: 200,
        headers: {
          "content-length": String(JUNCTION_WORKOUT_STREAM_MAX_RESPONSE_BYTES + 1),
          "content-type": "application/json",
        },
      });
    },
  });

  await assert.rejects(
    () => client.getWorkoutStream({ workoutId: "workout-over-limit" }),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_RESPONSE_TOO_LARGE"
      && !error.retryable,
  );
  assert.equal(requests, 1);
  assert.equal(bodyCancelled, true);
});

test("Junction workout streams enforce their narrower response cap for chunked bodies", async () => {
  let bodyCancelled = false;
  let requests = 0;
  let chunkIndex = 0;
  const chunks = [
    new Uint8Array(JUNCTION_WORKOUT_STREAM_MAX_RESPONSE_BYTES),
    new Uint8Array([0x20]),
  ];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      requests += 1;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[chunkIndex];
          chunkIndex += 1;
          if (chunk) {
            controller.enqueue(chunk);
          }
        },
        cancel() {
          bodyCancelled = true;
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await assert.rejects(
    () => client.getWorkoutStream({ workoutId: "workout-chunked-over-limit" }),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_RESPONSE_TOO_LARGE"
      && !error.retryable,
  );
  assert.equal(requests, 1);
  assert.equal(bodyCancelled, true);
});

test("Junction optional user lookup cancels unread 404 response bodies", async () => {
  let bodyCancelled = false;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("provider detail that Murph must not read"));
      },
      cancel() {
        bodyCancelled = true;
      },
    }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  });

  assert.equal(await client.resolveUser("missing-client-user"), null);
  assert.equal(bodyCancelled, true);
});

test("Junction first-time SDK connection survives minified SDK error names", async () => {
  const originalName = Object.getOwnPropertyDescriptor(JunctionError, "name");
  const requests: Array<{ method: string; pathname: string }> = [];
  Object.defineProperty(JunctionError, "name", {
    configurable: true,
    value: "r",
  });

  try {
    const provider = createJunctionProvider(async (input, init) => {
      const pathname = new URL(readUrl(input)).pathname;
      requests.push({
        method: String(init?.method ?? "GET"),
        pathname: pathname.startsWith("/v2/user/resolve/")
          ? "/v2/user/resolve/:clientUserId"
          : pathname,
      });

      if (pathname.startsWith("/v2/user/resolve/")) {
        return new Response(null, { status: 404 });
      }
      if (pathname === "/v2/user") {
        return createJsonResponse({ user_id: "junction-user-1" });
      }
      if (pathname === "/v2/user/junction-user-1/sign_in_token") {
        return createJsonResponse({ sign_in_token: "junction-sign-in-token" });
      }
      throw new Error(`Unexpected request: ${pathname}`);
    });
    const handler = requireValue(
      provider.sdkConnectionHandler,
      "Junction provider should expose an SDK connection handler.",
    );

    const connection = await handler.ensureConnection({
      ownerId: "owner-internal-id-123",
      now: "2026-08-14T00:00:00.000Z",
    });
    const token = await handler.createSignInToken({
      externalAccountId: connection.externalAccountId,
    });

    assert.equal(connection.externalAccountId, "junction-user-1");
    assert.equal(token.signInToken, "junction-sign-in-token");
    assert.equal(token.environment, "sandbox");
    assert.deepEqual(requests, [
      { method: "GET", pathname: "/v2/user/resolve/:clientUserId" },
      { method: "POST", pathname: "/v2/user" },
      { method: "POST", pathname: "/v2/user/junction-user-1/sign_in_token" },
    ]);
  } finally {
    if (originalName) {
      Object.defineProperty(JunctionError, "name", originalName);
    }
  }
});

test("Junction optional user lookup keeps caller cancellation ahead of a minified 404", async () => {
  const originalName = Object.getOwnPropertyDescriptor(JunctionError, "name");
  const abortController = new AbortController();
  const abortReason = new Error("foreground yield");
  let bodyCancelled = false;
  let requests = 0;
  Object.defineProperty(JunctionError, "name", {
    configurable: true,
    value: "r",
  });

  try {
    const client = new JunctionClient({
      apiKey: "sk_us_test_123",
      environment: "sandbox",
      region: "us",
      fetchImpl: async () => {
        requests += 1;
        return new Response(new ReadableStream<Uint8Array>({
          cancel() {
            bodyCancelled = true;
            abortController.abort(abortReason);
          },
        }), { status: 404 });
      },
    });

    await assert.rejects(
      () => client.resolveUser("missing-client-user", {
        signal: abortController.signal,
      }),
      (error) => error === abortReason,
    );
    assert.equal(requests, 1);
    assert.equal(bodyCancelled, true);
  } finally {
    if (originalName) {
      Object.defineProperty(JunctionError, "name", originalName);
    }
  }
});

test("Junction client deregisters provider connections by normalized provider slug", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      requests.push({
        method: String(init?.method ?? "GET"),
        url: readUrl(input),
      });
      assert.equal(new Headers(init?.headers).get("x-vital-api-key"), "sk_us_test_123");
      return createJsonResponse({ success: true });
    },
  });

  await client.deregisterProvider({
    providerSlug: "Apple Health",
    userId: "junction-user-1",
  });

  assert.deepEqual(requests, [
    {
      method: "DELETE",
      url: "https://api.sandbox.us.junction.com/v2/user/junction-user-1/apple_health_kit",
    },
  ]);
});

test("Junction client rejects provider deregistration without a Junction user id", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      throw new Error("deregisterProvider should not send a request without a user id");
    },
  });

  await assert.rejects(
    () => client.deregisterProvider({
      providerSlug: "garmin",
      userId: "  ",
    }),
    /requires a Junction user id/u,
  );
});

test("automatic recovery stays inert until it is explicitly enabled", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`No request should be made while recovery is disabled: ${readUrl(input)}`);
  }, {
    // The vendor enables the trigger endpoint per team, so shipping the code and
    // switching it on are separate steps. Default-off is what lets this merge
    // before that request lands.
    pushSourceRecoveryEnabled: false,
  });
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );
  const stalledAccount = createStoredAccount({
    sources: [{
      displayName: "Garmin",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastDataAt: "2026-07-18T00:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-07-20T00:00:00.000Z",
      resourceCount: 20,
      sourceProviderSlug: "garmin",
      status: "connected",
    }],
  });

  assert.equal(
    executor.createScheduledJobs?.(stalledAccount, "2026-07-20T00:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );
});

test("a stalled Garmin source automatically triggers a bounded historical pull", async () => {
  const requests: { body: unknown; url: string }[] = [];
  const provider = createJunctionProvider(async (input, init) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      url: readUrl(input),
    });
    return createJsonResponse({ success: true }, 202);
  });
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );
  const stalledAccount = createStoredAccount({
    sources: [
      {
        displayName: "Garmin",
        firstSeenAt: "2026-07-01T00:00:00.000Z",
        // Junction still lists the source and every resource as available; only
        // the arrival gap shows the carrier is dead.
        lastDataAt: "2026-07-18T00:00:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-07-20T00:00:00.000Z",
        resourceCount: 20,
        sourceProviderSlug: "garmin",
        status: "connected",
      },
    ],
  });

  // Detection alone restores nothing, so the scheduled pass must derive the
  // recovery attempt without any operator action.
  const scheduled = executor.createScheduledJobs?.(stalledAccount, "2026-07-20T00:00:00.000Z");
  const recoveryJob = scheduled?.jobs.find((job) => job.kind === "push_source_recovery");
  assert.ok(recoveryJob, "a stalled push-primary source must schedule its own recovery");
  assert.deepEqual(recoveryJob.payload, {
    silentSinceAt: "2026-07-18T00:00:00.000Z",
    sourceProviderSlug: "garmin",
  });

  // Every scheduled job crosses the configured-manifest enqueue boundary before
  // it is queued. An undeclared kind or payload field throws there, which would
  // discard the whole scheduled pass before any recovery ran.
  assert.deepEqual(
    normalizeConfiguredDeviceSyncJobInput("junction", {
      kind: recoveryJob.kind,
      payload: recoveryJob.payload ?? {},
    }, "scheduler"),
    {
      kind: "push_source_recovery",
      payload: {
        silentSinceAt: "2026-07-18T00:00:00.000Z",
        sourceProviderSlug: "garmin",
      },
    },
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: stalledAccount.sources }),
      now: "2026-07-20T00:00:00.000Z",
    }),
    createJob("push_source_recovery", recoveryJob.payload ?? {}),
  );

  assert.deepEqual(requests, [
    {
      body: { provider: "garmin", user_ids: ["junction-user-1"] },
      url: "https://api.sandbox.us.junction.com/v2/link/bulk_trigger_historical_pull",
    },
  ]);
  assert.deepEqual(result.metadataPatch, {
    junctionPushSourceRecoveryAttempts: 1,
    junctionPushSourceRecoveryLastAttemptAt: "2026-07-20T00:00:00.000Z",
    junctionPushSourceRecoveryLastFailureCode: null,
    junctionPushSourceRecoverySilentSinceAt: "2026-07-18T00:00:00.000Z",
    junctionPushSourceRecoverySourceProviderSlug: "garmin",
    junctionPushSourceRecoveryStatus: "triggered",
  });

  // A healthy source schedules nothing, and the recorded attempt keeps the
  // ladder from re-firing on the very next hourly pass.
  const healthyAccount = createStoredAccount({
    sources: [{
      displayName: "Garmin",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastDataAt: "2026-07-19T23:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-07-20T00:00:00.000Z",
      resourceCount: 20,
      sourceProviderSlug: "garmin",
      status: "connected",
    }],
  });
  assert.equal(
    executor.createScheduledJobs?.(healthyAccount, "2026-07-20T00:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );

  const afterAttempt = createStoredAccount({
    metadata: result.metadataPatch as Record<string, unknown>,
    sources: stalledAccount.sources,
  });
  assert.equal(
    executor.createScheduledJobs?.(afterAttempt, "2026-07-20T01:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );
});

test("the executor carries prior attempts through to exhaustion", async () => {
  let triggerCalls = 0;
  const provider = createJunctionProvider(async () => {
    triggerCalls += 1;
    return createJsonResponse({ success: true }, 202);
  });
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );
  const staleSources = [{
    displayName: "Garmin",
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastDataAt: "2026-07-18T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-07-22T00:00:00.000Z",
    resourceCount: 20,
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }];
  // Three attempts already spent on this episode.
  const priorMetadata = {
    junctionPushSourceRecoveryAttempts: 3,
    junctionPushSourceRecoveryLastAttemptAt: "2026-07-20T16:00:00.000Z",
    junctionPushSourceRecoverySilentSinceAt: "2026-07-18T00:00:00.000Z",
    junctionPushSourceRecoverySourceProviderSlug: "garmin",
    junctionPushSourceRecoveryStatus: "triggered",
  };

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ metadata: priorMetadata, sources: staleSources }),
      now: "2026-07-22T16:00:00.000Z",
    }),
    createJob("push_source_recovery", {
      silentSinceAt: "2026-07-18T00:00:00.000Z",
      sourceProviderSlug: "garmin",
    }),
  );

  // Losing the prior count would leave every mutation at "attempt 1", so a
  // persistently silent source would trigger provider work forever.
  assert.equal(triggerCalls, 1);
  assert.equal(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryAttempts,
    4,
  );
  assert.equal(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryStatus,
    "exhausted",
  );

  const exhausted = createStoredAccount({
    metadata: { ...priorMetadata, ...(result.metadataPatch as Record<string, unknown>) },
    sources: staleSources,
  });
  assert.equal(
    executor.createScheduledJobs?.(exhausted, "2026-07-30T00:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );
});

test("a failed recovery trigger still burns its attempt instead of retrying forever", async () => {
  const staleGarminSources = [{
    displayName: "Garmin",
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastDataAt: "2026-07-18T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    resourceCount: 20,
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }];
  let triggerCalls = 0;
  const provider = createJunctionProvider(async () => {
    triggerCalls += 1;
    return createJsonResponse({ detail: "boom" }, 500);
  });
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: staleGarminSources }),
      now: "2026-07-20T00:00:00.000Z",
    }),
    createJob("push_source_recovery", {
      silentSinceAt: "2026-07-18T00:00:00.000Z",
      sourceProviderSlug: "garmin",
    }),
  );

  // Letting the failure escape would leave the episode at zero attempts, so the
  // next scheduled pass would derive the identical attempt again, forever.
  assert.equal(triggerCalls, 1);
  assert.equal(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryAttempts,
    1,
  );
  assert.equal(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryStatus,
    "triggered",
  );
  // The burned attempt stays diagnosable.
  assert.ok(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryLastFailureCode,
  );

  const afterFailure = createStoredAccount({
    metadata: result.metadataPatch as Record<string, unknown>,
    sources: [{
      displayName: "Garmin",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastDataAt: "2026-07-18T00:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-07-20T00:00:00.000Z",
      resourceCount: 20,
      sourceProviderSlug: "garmin",
      status: "connected",
    }],
  });

  // The next hourly pass must respect the ladder delay, not re-fire.
  assert.equal(
    executor.createScheduledJobs?.(afterFailure, "2026-07-20T01:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );
  assert.ok(
    executor.createScheduledJobs?.(afterFailure, "2026-07-20T06:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
  );
});

test("a recovery job whose episode already ended makes no provider call", async () => {
  let triggerCalls = 0;
  const provider = createJunctionProvider(async () => {
    triggerCalls += 1;
    return createJsonResponse({ success: true }, 202);
  });
  const recoveredSources = [{
    displayName: "Garmin",
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    // A webhook landed between scheduling and execution.
    lastDataAt: "2026-07-20T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    resourceCount: 20,
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: recoveredSources }),
      now: "2026-07-20T00:00:00.000Z",
    }),
    createJob("push_source_recovery", {
      silentSinceAt: "2026-07-18T00:00:00.000Z",
      sourceProviderSlug: "garmin",
    }),
  );

  // Triggering for an ended episode is an avoidable provider mutation, and
  // recording it would let the scheduler immediately fire again for the newer
  // episode.
  assert.equal(triggerCalls, 0);
  assert.deepEqual(result, {});
});

test("a gated recovery trigger pauses the episode and resumes after enablement", async () => {
  const provider = createJunctionProvider(async () =>
    createJsonResponse({ detail: "not enabled" }, 403)
  );
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );
  const staleSources = [{
    displayName: "Garmin",
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastDataAt: "2026-07-18T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    resourceCount: 20,
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: staleSources }),
      now: "2026-07-20T00:00:00.000Z",
    }),
    createJob("push_source_recovery", {
      silentSinceAt: "2026-07-18T00:00:00.000Z",
      sourceProviderSlug: "garmin",
    }),
  );

  // A gated call never reached the recovery mechanism, so it spends no attempt.
  assert.deepEqual(result.metadataPatch, {
    junctionPushSourceRecoveryAttempts: 0,
    junctionPushSourceRecoveryLastAttemptAt: "2026-07-20T00:00:00.000Z",
    junctionPushSourceRecoveryLastFailureCode: null,
    junctionPushSourceRecoverySilentSinceAt: "2026-07-18T00:00:00.000Z",
    junctionPushSourceRecoverySourceProviderSlug: "garmin",
    junctionPushSourceRecoveryStatus: "unavailable",
  });

  const gatedAccount = createStoredAccount({
    metadata: result.metadataPatch as Record<string, unknown>,
    sources: staleSources,
  });

  // Not re-probed immediately...
  assert.equal(
    executor.createScheduledJobs?.(gatedAccount, "2026-07-20T06:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );

  // ...but enablement is a vendor-side change we cannot observe, so a stall
  // seen before enablement must not be abandoned for the rest of its episode.
  assert.ok(
    executor.createScheduledJobs?.(gatedAccount, "2026-07-21T00:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
  );
});

test("Junction client triggers a historical pull for one source", async () => {
  const requests: { body: unknown; method: string; url: string }[] = [];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: String(init?.method ?? "GET"),
        url: readUrl(input),
      });
      return createJsonResponse({ success: true }, 202);
    },
  });

  const result = await client.bulkTriggerHistoricalPull({
    sourceProviderSlug: "Garmin",
    userIds: ["junction-user-1", "junction-user-1", "  "],
  });

  assert.deepEqual(result, { accepted: true, endpointUnavailable: false });
  assert.deepEqual(requests, [
    {
      body: { provider: "garmin", user_ids: ["junction-user-1"] },
      method: "POST",
      url: "https://api.sandbox.us.junction.com/v2/link/bulk_trigger_historical_pull",
    },
  ]);
});

test("Junction client reports a gated historical pull trigger as unavailable rather than failing", async () => {
  for (const status of [403, 404]) {
    const client = new JunctionClient({
      apiKey: "sk_us_test_123",
      environment: "sandbox",
      region: "us",
      fetchImpl: async () => createJsonResponse({ detail: "not enabled" }, status),
    });

    // Link Migration endpoints are disabled per team by default. That is a
    // "ask support to enable it" answer, not a transport failure to retry.
    assert.deepEqual(
      await client.bulkTriggerHistoricalPull({
        sourceProviderSlug: "garmin",
        userIds: ["junction-user-1"],
      }),
      { accepted: false, endpointUnavailable: true },
    );
  }
});

test("Junction client surfaces real historical pull trigger failures", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => createJsonResponse({ detail: "boom" }, 500),
  });

  await assert.rejects(() => client.bulkTriggerHistoricalPull({
    sourceProviderSlug: "garmin",
    userIds: ["junction-user-1"],
  }));
});

test("Junction client rejects historical pull triggers without a source or user", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      throw new Error("bulkTriggerHistoricalPull should not send an invalid request");
    },
  });

  await assert.rejects(
    () => client.bulkTriggerHistoricalPull({ sourceProviderSlug: " ", userIds: ["u"] }),
    /require a provider slug/u,
  );
  await assert.rejects(
    () => client.bulkTriggerHistoricalPull({ sourceProviderSlug: "garmin", userIds: ["  "] }),
    /require at least one user id/u,
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
  assert.deepEqual(requests, ["https://api.eu.junction.com/v2/user"]);
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
