import assert from "node:assert/strict";

import { test } from "vitest";

import {
  hasForwardedLoopbackControlHeaders,
  hasLoopbackControlHostHeader,
  isLoopbackHostname,
  isLoopbackHttpBaseUrl,
  isLoopbackRemoteAddress,
} from "../src/loopback-control-plane.ts";

test("loopback host checks accept normalized localhost and literal loopback addresses only", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname(" LOCALHOST "), true);
  assert.equal(isLoopbackHostname("[::1]"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("[::ffff:127.0.0.1]"), true);
  assert.equal(isLoopbackHostname("[::ffff:7f00:1]"), true);
  assert.equal(isLoopbackHostname("128.0.0.1"), false);
  assert.equal(isLoopbackHostname("example.com"), false);
});

test("loopback base-url checks require plain http on a loopback host", () => {
  assert.equal(isLoopbackHttpBaseUrl("http://localhost:8788"), true);
  assert.equal(isLoopbackHttpBaseUrl("http://[::1]:8788"), true);
  assert.equal(isLoopbackHttpBaseUrl("http://[::ffff:127.0.0.1]:8788"), true);
  assert.equal(isLoopbackHttpBaseUrl("https://localhost:8788"), false);
  assert.equal(isLoopbackHttpBaseUrl("http://example.com:8788"), false);
});

test("loopback remote-address checks accept only literal loopback addresses", () => {
  assert.equal(isLoopbackRemoteAddress("127.0.0.1"), true);
  assert.equal(isLoopbackRemoteAddress("127.0.0.42"), true);
  assert.equal(isLoopbackRemoteAddress("::1"), true);
  assert.equal(isLoopbackRemoteAddress(" [::ffff:127.0.0.1] "), true);
  assert.equal(isLoopbackRemoteAddress("[::ffff:7f00:1]"), true);
  assert.equal(isLoopbackRemoteAddress("::ffff:128.0.0.1"), false);
  assert.equal(isLoopbackRemoteAddress("127.example.com"), false);
  assert.equal(isLoopbackRemoteAddress("::ffff:127.example.com"), false);
  assert.equal(isLoopbackRemoteAddress(null), false);
});

test("loopback control forwarded-header checks reject any populated proxy header", () => {
  assert.equal(
    hasForwardedLoopbackControlHeaders({
      forwarded: "",
      "x-forwarded-for": ["", "203.0.113.7"],
    }),
    true,
  );
  assert.equal(
    hasForwardedLoopbackControlHeaders({
      "x-forwarded-for": ["", " "],
      "x-real-ip": undefined,
    }),
    false,
  );
});

test("loopback control host checks accept mapped loopback hosts and reject malformed hosts", () => {
  assert.equal(hasLoopbackControlHostHeader("localhost:8788"), true);
  assert.equal(hasLoopbackControlHostHeader("[::ffff:127.0.0.1]:8788"), true);
  assert.equal(hasLoopbackControlHostHeader("[::ffff:7f00:1]:8788"), true);
  assert.equal(hasLoopbackControlHostHeader("foo@localhost:8788"), false);
  assert.equal(hasLoopbackControlHostHeader(["localhost:8788", "127.0.0.1:8788"]), false);
});
