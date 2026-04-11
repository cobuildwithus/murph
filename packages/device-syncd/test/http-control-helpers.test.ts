import assert from "node:assert/strict";

import { test } from "vitest";
import { isLoopbackRemoteAddress } from "@murphai/runtime-state/node";

import { DeviceSyncError } from "../src/errors.ts";
import {
  assertDeviceSyncControlRequest,
  buildPublicDeviceSyncErrorPayload,
  renderCallbackHtml,
} from "../src/http.ts";
import { withIncomingHeader } from "./helpers.ts";

test("isLoopbackRemoteAddress accepts localhost forms and rejects non-loopback values", () => {
  assert.equal(isLoopbackRemoteAddress("127.0.0.1"), true);
  assert.equal(isLoopbackRemoteAddress(" ::1 "), true);
  assert.equal(isLoopbackRemoteAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackRemoteAddress("::ffff:10.0.0.1"), false);
  assert.equal(isLoopbackRemoteAddress("203.0.113.10"), false);
  assert.equal(isLoopbackRemoteAddress(null), false);
});

test("assertDeviceSyncControlRequest accepts valid loopback bearer auth and rejects malformed authorization headers", () => {
  assert.doesNotThrow(() =>
    assertDeviceSyncControlRequest({
      headers: {
        authorization: "  bearer control-token-for-tests  ",
        host: "127.0.0.1:8788",
      },
      remoteAddress: "::ffff:127.0.0.1",
      controlToken: "control-token-for-tests",
    }),
  );

  assert.throws(
    () =>
      assertDeviceSyncControlRequest({
        headers: {
          ...withIncomingHeader("authorization", ["Bearer control-token-for-tests", "Bearer duplicate"]),
          host: "127.0.0.1:8788",
        },
        remoteAddress: "127.0.0.1",
        controlToken: "control-token-for-tests",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "CONTROL_PLANE_AUTH_REQUIRED" &&
      error.httpStatus === 401,
  );
});

test("assertDeviceSyncControlRequest rejects forwarded proxy headers with the specific control-plane error", () => {
  assert.throws(
    () =>
      assertDeviceSyncControlRequest({
        headers: {
          authorization: "Bearer control-token",
          forwarded: "for=127.0.0.1",
          host: "localhost",
        },
        remoteAddress: "127.0.0.1",
        controlToken: "control-token",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "CONTROL_PLANE_PROXY_HEADERS_REJECTED" &&
      error.httpStatus === 403,
  );
});

test("assertDeviceSyncControlRequest rejects non-loopback host headers with the mapped control-plane error", () => {
  assert.throws(
    () =>
      assertDeviceSyncControlRequest({
        headers: {
          authorization: "Bearer control-token",
          host: "device-sync.example",
        },
        remoteAddress: "127.0.0.1",
        controlToken: "control-token",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "CONTROL_PLANE_LOOPBACK_HOST_REQUIRED" &&
      error.httpStatus === 403,
  );
});

test("assertDeviceSyncControlRequest accepts ipv6 loopback hosts after shared loopback validation", () => {
  assert.doesNotThrow(() =>
    assertDeviceSyncControlRequest({
      headers: {
        authorization: "Bearer control-token",
        host: "[::1]:8788",
      },
      remoteAddress: "::ffff:127.0.0.1",
      controlToken: "control-token",
    }),
  );
});

test("buildPublicDeviceSyncErrorPayload exposes only safe numeric status details", () => {
  const withNumericStatus = buildPublicDeviceSyncErrorPayload(
    new DeviceSyncError({
      code: "OURA_API_REQUEST_FAILED",
      message: "Provider request failed.",
      retryable: true,
      httpStatus: 502,
      details: {
        status: "502",
        bodySnippet: "access_token=secret",
      },
    }),
  );
  const withInvalidStatus = buildPublicDeviceSyncErrorPayload(
    new DeviceSyncError({
      code: "OURA_API_REQUEST_FAILED",
      message: "Provider request failed.",
      retryable: true,
      httpStatus: 502,
      details: {
        status: "not-a-status",
        bodySnippet: "access_token=secret",
      },
    }),
  );

  assert.deepEqual(withNumericStatus, {
    error: {
      code: "OURA_API_REQUEST_FAILED",
      message: "Provider request failed.",
      retryable: true,
      details: {
        status: 502,
      },
    },
  });
  assert.deepEqual(withInvalidStatus, {
    error: {
      code: "OURA_API_REQUEST_FAILED",
      message: "Provider request failed.",
      retryable: true,
      details: undefined,
    },
  });
});

test("renderCallbackHtml escapes title and body content", () => {
  const html = renderCallbackHtml({
    title: `Connected <script>alert("x")</script>`,
    body: `Use 'safe' & "trusted" text only.`,
  });

  assert.match(html, /Connected &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/u);
  assert.match(html, /Use &#39;safe&#39; &amp; &quot;trusted&quot; text only\./u);
  assert.doesNotMatch(html, /<script>alert/u);
});
