import assert from "node:assert/strict";
import { generateUlid } from "@murphai/runtime-state";
import { afterEach, beforeEach, test, vi } from "vitest";

import {
  computeRetryDelayMs,
  defaultStateDatabasePath,
  generatePrefixedId,
  generateStateCode,
  joinUrl,
  normalizeIdentifier,
  normalizeOriginList,
  normalizeString,
  normalizeStringList,
  parseJsonObject,
  sanitizeStoredDeviceSyncMetadata,
  sha256Text,
  scopeWebhookTraceId,
  stringifyJson,
  toIsoTimestamp,
  resolveRelativeOrAllowedOriginUrl,
  sanitizeKey,
} from "../src/shared.ts";

beforeEach(() => {
  vi.stubGlobal("crypto", {
    getRandomValues(target: Uint8Array) {
      target.set(Uint8Array.from(Array.from({ length: target.length }, (_, index) => index)));
      return target;
    },
  } as Crypto);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("device-syncd id helpers preserve dash sanitation and state-code format", () => {
  assert.equal(generateUlid(0), "00000000000123456789ABCDEF");
  assert.equal(generatePrefixedId("Worker Name", 0), "worker-name_00000000000123456789ABCDEF");
  assert.equal(generatePrefixedId("___", 0), "rec_00000000000123456789ABCDEF");
  assert.equal(generateStateCode(24), "0123456789ABCDEFGHJKMNPQ");
  assert.equal(normalizeString("Worker Name"), "Worker Name");
  assert.equal(normalizeString("   "), undefined);
  assert.equal(sanitizeKey("Worker Name"), "worker-name");
  assert.equal(sanitizeKey("___"), "item");
});

test("device-syncd URL helpers normalize allowed origins and reject unsafe return targets", () => {
  const publicBaseUrl = "https://sync.example.test/device-sync";

  assert.deepEqual(
    normalizeOriginList([
      "https://app.example.test/settings",
      "https://app.example.test/profile",
      "http://127.0.0.1:3000/app",
    ]),
    ["https://app.example.test", "http://127.0.0.1:3000"],
  );
  assert.equal(
    resolveRelativeOrAllowedOriginUrl("/settings/devices?tab=wearables", publicBaseUrl),
    "https://sync.example.test/settings/devices?tab=wearables",
  );
  assert.equal(
    resolveRelativeOrAllowedOriginUrl("https://app.example.test/devices#section", publicBaseUrl, [
      "https://app.example.test/profile",
    ]),
    "https://app.example.test/devices",
  );
  assert.equal(
    resolveRelativeOrAllowedOriginUrl("https://user:pass@app.example.test/devices", publicBaseUrl, [
      "https://app.example.test",
    ]),
    null,
  );
  assert.equal(resolveRelativeOrAllowedOriginUrl("//evil.example/steal", publicBaseUrl), null);
});

test("device-syncd shared helpers normalize metadata, timestamps, and JSON payloads", () => {
  assert.equal(toIsoTimestamp("2026-04-07T00:00:00+00:00"), "2026-04-07T00:00:00.000Z");
  assert.throws(() => toIsoTimestamp("not-a-date"), /Invalid timestamp/u);
  assert.equal(sha256Text("murph"), "7fa8398c9888bd7abca8fa94f2b0b813aa8a50bca1dd965281741afda32a0db4");
  assert.equal(normalizeIdentifier(42), "42");
  assert.equal(normalizeIdentifier("   "), undefined);
  assert.deepEqual(normalizeStringList([" a ", "", 7, "b"]), ["a", "b"]);
  assert.deepEqual(
    sanitizeStoredDeviceSyncMetadata({
      " key ": "value",
      "__proto__": "blocked",
      constructor: "blocked",
      bool: true,
      nil: null,
      nested: {
        secret: "discarded",
      },
      number: 7,
      long: "x".repeat(257),
    }),
    {
      bool: true,
      key: "value",
      nil: null,
      number: 7,
    },
  );
  assert.deepEqual(parseJsonObject('{"ok":true}', "payload"), {
    ok: true,
  });
  assert.throws(() => parseJsonObject("[1,2,3]", "payload"), /must be a JSON object/u);
  assert.equal(stringifyJson(undefined), "null");
  assert.equal(computeRetryDelayMs(0), 15_000);
  assert.equal(computeRetryDelayMs(99), 7_200_000);
  assert.equal(joinUrl("https://sync.example.test/device-sync/", "/oauth/demo/callback"), "https://sync.example.test/device-sync/oauth/demo/callback");
  assert.match(defaultStateDatabasePath("./vault"), /state\.sqlite$/u);
});

test("device-syncd webhook trace scoping is unambiguous when tuple members contain delimiters", () => {
  assert.notEqual(
    scopeWebhookTraceId("demo", "acct:1", "evt"),
    scopeWebhookTraceId("demo", "acct", "1:evt"),
  );
});
