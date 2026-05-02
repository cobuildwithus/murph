import assert from "node:assert/strict";

import { test } from "vitest";

import {
  isBrowserVaultAbortError,
  parseBrowserVaultSessionResponse,
} from "@/src/lib/browser-vault/loader";
import { browserVaultReplicaRefsMatch } from "@/src/lib/browser-vault/ref";

test("browser vault session parser rejects encrypted payloads on not_modified responses", () => {
  assert.throws(
    () => parseBrowserVaultSessionResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: createReplicaRef(),
      state: "not_modified",
    }),
    /Browser vault session response\.encryptedReplica must be null\./u,
  );
});

test("browser vault session parser requires empty responses to carry only null payload fields", () => {
  assert.throws(
    () => parseBrowserVaultSessionResponse({
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: createReplicaRef(),
      state: "empty",
    }),
    /Browser vault session response\.replicaRef must be null\./u,
  );
});

test("browser vault replica ref matching is exact across immutable object fields", () => {
  const ref = createReplicaRef();

  assert.equal(browserVaultReplicaRefsMatch(ref, { ...ref }), true);
  assert.equal(
    browserVaultReplicaRefsMatch(ref, {
      ...ref,
      objectKey: "users/browser-vault-replicas/opaque/other-replica.json",
    }),
    false,
  );
  assert.equal(browserVaultReplicaRefsMatch(ref, null), false);
});

test("browser vault abort detection accepts DOM-style abort errors", () => {
  const abortError = new Error("Browser vault load was aborted.");
  abortError.name = "AbortError";

  assert.equal(isBrowserVaultAbortError(abortError), true);
  assert.equal(isBrowserVaultAbortError({ name: "AbortError" }), true);
  assert.equal(isBrowserVaultAbortError(new Error("not aborted")), false);
  assert.equal(isBrowserVaultAbortError(null), false);
});

function createReplicaRef() {
  return {
    byteLength: 128,
    dataVersion: "d".repeat(64),
    generatedAt: "2026-04-20T08:00:00.000Z",
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica.v1" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
    sourceBundleHash: "a".repeat(64),
  };
}

function createReplicaEnvelope() {
  return {
    algorithm: "AES-GCM" as const,
    ciphertext: "ciphertext",
    iv: "iv",
    keyId: "browser-vault-replica:d",
    schema: "murph.hosted-cipher.v1" as const,
    scope: "browser-vault-replica" as const,
  };
}
