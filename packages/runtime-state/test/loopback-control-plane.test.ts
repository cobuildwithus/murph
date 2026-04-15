import assert from "node:assert/strict";

import { test } from "vitest";

import {
  assertListenerPort,
  assertLoopbackListenerHost,
  assertUnbracketedListenerHost,
  getLoopbackControlRequestRejectionReason,
  hasForwardedLoopbackControlHeaders,
  hasLoopbackControlHostHeader,
  isBracketedListenerHost,
  isListenerPort,
  isLoopbackHostname,
  isLoopbackHttpBaseUrl,
  isLoopbackListenerHost,
  isLoopbackRemoteAddress,
  readLoopbackControlHeaderValue,
} from "../src/loopback-control-plane.ts";
import { hasMatchingLoopbackControlBearerToken } from "../src/node/loopback-control-plane-auth.ts";

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

test("assertLoopbackListenerHost accepts loopback listener hosts and rejects non-loopback values", () => {
  assert.doesNotThrow(() => assertLoopbackListenerHost("127.0.0.1"));
  assert.doesNotThrow(() => assertLoopbackListenerHost("localhost"));
  assert.doesNotThrow(() => assertLoopbackListenerHost("::1"));
  assert.equal(isLoopbackListenerHost("[::1]"), false);
  assert.throws(() => assertLoopbackListenerHost("[::1]"), TypeError);
  assert.throws(() => assertLoopbackListenerHost("0.0.0.0"), TypeError);
  assert.throws(() => assertLoopbackListenerHost("example.com"), TypeError);
});

test("loopback control host checks accept bracketed ipv6 loopback hosts", () => {
  assert.equal(hasLoopbackControlHostHeader("[::1]:50241"), true);
});

test("listener host helpers distinguish listener syntax from URL and Host-header syntax", () => {
  assert.equal(isBracketedListenerHost("[::1]"), true);
  assert.equal(isBracketedListenerHost("::1"), false);
  assert.doesNotThrow(() => assertUnbracketedListenerHost("::1"));
  assert.throws(() => assertUnbracketedListenerHost("[::1]"), TypeError);
  assert.equal(isLoopbackHttpBaseUrl("http://[::1]:50241"), true);
  assert.equal(hasLoopbackControlHostHeader("[::1]:50241"), true);
});

test("listener port helpers accept integer TCP ports and reject invalid values", () => {
  assert.equal(isListenerPort(0), false);
  assert.equal(isListenerPort(0, { allowZero: true }), true);
  assert.equal(isListenerPort(50241), true);
  assert.equal(isListenerPort(65_536), false);
  assert.equal(isListenerPort(50.5), false);
  assert.doesNotThrow(() =>
    assertListenerPort(0, "listener port", { allowZero: true }),
  );
  assert.throws(() => assertListenerPort(-1), TypeError);
});

test("readLoopbackControlHeaderValue trims single values and rejects duplicates or blanks", () => {
  assert.equal(readLoopbackControlHeaderValue("  Bearer secret  "), "Bearer secret");
  assert.equal(
    readLoopbackControlHeaderValue(["Bearer one", "Bearer two"]),
    null,
  );
  assert.equal(readLoopbackControlHeaderValue("   "), null);
});

test("getLoopbackControlRequestRejectionReason preserves remote-then-forwarded-then-host ordering", () => {
  assert.equal(
    getLoopbackControlRequestRejectionReason({
      headers: {
        forwarded: "for=127.0.0.1",
        host: "localhost",
      },
      remoteAddress: "10.0.0.8",
    }),
    "loopback-remote-address-required",
  );
  assert.equal(
    getLoopbackControlRequestRejectionReason({
      headers: {
        forwarded: "for=127.0.0.1",
        host: "localhost",
      },
      remoteAddress: "127.0.0.1",
    }),
    "forwarded-headers-rejected",
  );
  assert.equal(
    getLoopbackControlRequestRejectionReason({
      headers: {
        host: "example.com",
      },
      remoteAddress: "127.0.0.1",
    }),
    "loopback-host-required",
  );
  assert.equal(
    getLoopbackControlRequestRejectionReason({
      headers: {
        host: "[::1]:8788",
      },
      remoteAddress: "::ffff:127.0.0.1",
    }),
    null,
  );
});

test("hasMatchingLoopbackControlBearerToken accepts matching tokens and rejects duplicates or mismatches", () => {
  assert.equal(
    hasMatchingLoopbackControlBearerToken("Bearer control-token", "control-token"),
    true,
  );
  assert.equal(
    hasMatchingLoopbackControlBearerToken("Bearer wrong-token", "control-token"),
    false,
  );
  assert.equal(
    hasMatchingLoopbackControlBearerToken(
      ["Bearer control-token", "Bearer shadow-token"],
      "control-token",
    ),
    false,
  );
});
