import assert from "node:assert/strict";

import { test } from "vitest";

import {
  compactRecord,
  sanitizeRawMetadata,
  toIsoTimestamp,
} from "../src/internal.ts";

test("sanitizeRawMetadata redacts sensitive keys, secret-like values, and user paths", () => {
  const result = sanitizeRawMetadata({
    "---": "keep-symbol-key",
    array: [undefined, new Uint8Array([1, 2, 3])],
    "access-token-extra": "keep-extra-part",
    authToken: "secret-value",
    "client-key-id": "rotate-me",
    nested: {
      "api secret": "top-secret",
      bearer: "Bearer secret-token",
      cookie: "session=secret",
      embeddedHomePath: "Replying to: /home/example/project",
      homePath: "/home/example/project",
      keep: "ok",
      placeholderHomePath: "<HOME_DIR>/private/waba",
      placeholderWindowsHomePath: "<HOME_DIR>\\AppData\\Local\\murph",
      singleRootTmpPath: "/tmp",
      spacedFinalHomePath: "/Users/example/My Project/read me.txt",
      spacedHomePath: "/Users/example/My Project/file.txt",
      rootPath: "See /root/private/config.json for details",
      tmpPath: "Saved in /tmp/murph/cache.db",
      url: "https://example.test/tmp/murph/cache.db",
      userPath: "/Users/example/project",
      windowsRootPath: "C:\\temp",
      windowsEmbeddedPath: "Open C:\\temp\\murph\\reply.txt before retrying",
      windowsSpacedFinalPath: "C:\\Users\\Example\\My Documents\\read me.txt",
      windowsSpacedPath: "C:\\Users\\Example\\My Documents\\file.txt",
      windowsPath: "C:\\Users\\Example\\project",
    },
    "set-cookie-value": "redact-by-substring",
    session_token: "redact-me",
    "token-holder": "keep-me",
  });

  assert.deepEqual(result, {
    "---": "keep-symbol-key",
    array: [null, "<3 bytes>"],
    "access-token-extra": "<REDACTED_SECRET>",
    authToken: "<REDACTED_SECRET>",
    "client-key-id": "<REDACTED_SECRET>",
    nested: {
      "api secret": "<REDACTED_SECRET>",
      bearer: "<REDACTED_SECRET>",
      cookie: "<REDACTED_SECRET>",
      embeddedHomePath: "Replying to: <REDACTED_PATH>",
      homePath: "<REDACTED_PATH>",
      keep: "ok",
      placeholderHomePath: "<REDACTED_PATH>",
      placeholderWindowsHomePath: "<REDACTED_PATH>",
      singleRootTmpPath: "<REDACTED_PATH>",
      spacedFinalHomePath: "<REDACTED_PATH>",
      spacedHomePath: "<REDACTED_PATH>",
      rootPath: "See <REDACTED_PATH> for details",
      tmpPath: "Saved in <REDACTED_PATH>",
      url: "https://example.test/tmp/murph/cache.db",
      userPath: "<REDACTED_PATH>",
      windowsRootPath: "<REDACTED_PATH>",
      windowsEmbeddedPath: "Open <REDACTED_PATH> before retrying",
      windowsSpacedFinalPath: "<REDACTED_PATH>",
      windowsSpacedPath: "<REDACTED_PATH>",
      windowsPath: "<REDACTED_PATH>",
    },
    "set-cookie-value": "<REDACTED_SECRET>",
    session_token: "<REDACTED_SECRET>",
    "token-holder": "keep-me",
  });
});

test("compactRecord removes undefined values and toIsoTimestamp rejects invalid input", () => {
  assert.deepEqual(
    compactRecord({
      keepFalse: false,
      keepNull: null,
      keepZero: 0,
      remove: undefined,
    }),
    {
      keepFalse: false,
      keepNull: null,
      keepZero: 0,
    },
  );

  assert.equal(toIsoTimestamp("2026-04-08T00:00:00.000Z"), "2026-04-08T00:00:00.000Z");
  assert.equal(toIsoTimestamp("2026-04-08T00:00:00+00:00"), "2026-04-08T00:00:00.000Z");
  assert.equal(toIsoTimestamp("2026-04-08T05:00:00-05:00"), "2026-04-08T10:00:00.000Z");
  assert.throws(
    () => toIsoTimestamp("not-a-date"),
    /Invalid ISO timestamp: not-a-date \(missing time zone\)/u,
  );
  assert.throws(
    () => toIsoTimestamp("2026-04-08T00:00:00"),
    /Invalid ISO timestamp: 2026-04-08T00:00:00 \(missing time zone\)/u,
  );
  assert.throws(
    () => toIsoTimestamp("2026-04-08"),
    /Invalid ISO timestamp: 2026-04-08 \(missing time zone\)/u,
  );
});

test("sanitizeRawMetadata stringifies non-JSON primitives and drops undefined object fields", () => {
  const tokenSymbol = Symbol("token");
  function namedValue() {
    return "ok";
  }

  const result = sanitizeRawMetadata({
    functionValue: namedValue,
    keepCombo: "keep",
    nested: {
      dropMe: undefined,
    },
    numberLikeKey: "keep",
    symbolValue: tokenSymbol,
    token_api_extra: "keep",
    weirdBigInt: 42n,
  });

  assert.deepEqual(result, {
    functionValue: String(namedValue),
    keepCombo: "keep",
    nested: {},
    numberLikeKey: "keep",
    symbolValue: "Symbol(token)",
    token_api_extra: "keep",
    weirdBigInt: "42",
  });
});
