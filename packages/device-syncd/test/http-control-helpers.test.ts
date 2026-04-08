import assert from "node:assert/strict";

import { test } from "vitest";

import { DeviceSyncError } from "../src/errors.ts";
import {
  assertDeviceSyncControlRequest,
  buildPublicDeviceSyncErrorPayload,
  isLoopbackRemoteAddress,
  renderCallbackHtml,
} from "../src/http.ts";

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
      },
      remoteAddress: "::ffff:127.0.0.1",
      controlToken: "control-token-for-tests",
    }),
  );

  assert.throws(
    () =>
      assertDeviceSyncControlRequest({
        headers: {
          authorization: ["Bearer control-token-for-tests", "Bearer duplicate"],
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
