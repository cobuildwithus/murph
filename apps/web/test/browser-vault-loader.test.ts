import assert from "node:assert/strict";

import { test, vi } from "vitest";

import {
  isBrowserVaultAbortError,
  isBrowserVaultUnauthorizedError,
  loadBrowserVaultReplica,
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

test.each(["empty", "not_modified"] as const)(
  "browser vault session parser rejects %s responses without member proof",
  (state) => {
    const replicaRef = state === "not_modified" ? createReplicaRef() : null;
    assert.throws(
      () => parseBrowserVaultSessionResponse({
        encryptedReplica: null,
        replicaAad: null,
        replicaKeyEnvelope: null,
        replicaRef,
        state,
      }),
      /Browser vault session response\.memberId must be a non-empty string\./u,
    );
  },
);

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
  assert.equal(
    browserVaultReplicaRefsMatch(ref, {
      ...ref,
      generation: ref.generation + 1,
    }),
    false,
  );
  assert.equal(
    browserVaultReplicaRefsMatch(ref, {
      ...ref,
      dataKeyEnvelope: {
        ...ref.dataKeyEnvelope,
        dataKeyId: "hdk:browser-vault-replica:other",
      },
    }),
    false,
  );
  assert.equal(browserVaultReplicaRefsMatch(ref, null), false);
});

test("browser vault session parser accepts freshness metadata and defaults optional fields safely", () => {
  assert.deepEqual(parseBrowserVaultSessionResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    state: "empty",
  }), {
    deviceSyncImportPending: false,
    encryptedReplica: null,
    freshness: "stale",
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    refreshPending: false,
    state: "empty",
    workspaceVersion: null,
  });

  assert.deepEqual(parseBrowserVaultSessionResponse({
    encryptedReplica: null,
    deviceSyncImportPending: true,
    freshness: "stale",
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: createReplicaRef(),
    refreshPending: true,
    state: "not_modified",
    workspaceVersion: "7",
  }), {
    encryptedReplica: null,
    deviceSyncImportPending: true,
    freshness: "stale",
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: createReplicaRef(),
    refreshPending: true,
    state: "not_modified",
    workspaceVersion: "7",
  });
});

test("browser vault abort detection accepts DOM-style abort errors", () => {
  const abortError = new Error("Browser vault load was aborted.");
  abortError.name = "AbortError";

  assert.equal(isBrowserVaultAbortError(abortError), true);
  assert.equal(isBrowserVaultAbortError({ name: "AbortError" }), true);
  assert.equal(isBrowserVaultAbortError(new Error("not aborted")), false);
  assert.equal(isBrowserVaultAbortError(null), false);
});

test("browser vault loader treats unauthorized responses as empty by default", async () => {
  const result = await loadBrowserVaultReplica({
    fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: "Sign in to continue.",
      },
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 401,
    })),
    knownReplicaRef: null,
  });

  assert.deepEqual(result, {
    deviceSyncImportPending: false,
    freshness: "stale",
    memberId: null,
    refreshPending: false,
    state: "empty",
    workspaceVersion: null,
  });
});

test("browser vault loader opts in to stale replicas explicitly", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    deviceSyncImportPending: true,
    encryptedReplica: null,
    freshness: "stale",
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    refreshPending: true,
    state: "empty",
    workspaceVersion: "7",
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  }));

  const result = await loadBrowserVaultReplica({
    fetchImpl,
    knownReplicaRef: createReplicaRef(),
  });

  assert.deepEqual(result, {
    deviceSyncImportPending: true,
    freshness: "stale",
    memberId: "member_123",
    refreshPending: true,
    state: "empty",
    workspaceVersion: "7",
  });
  assert.equal(fetchImpl.mock.calls.length, 1);
  const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
  assert.equal(body.acceptStaleReplica, true);
  assert.deepEqual(body.knownReplicaRef, createReplicaRef());
});

test("browser vault loader can request runtime-owned projection refresh", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: createReplicaRef(),
    refreshPending: true,
    state: "not_modified",
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  }));

  await loadBrowserVaultReplica({
    fetchImpl,
    knownReplicaRef: createReplicaRef(),
    requestRefresh: true,
  });

  const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
  assert.equal(body.requestRefresh, true);
});

test("browser vault loader can surface unauthorized responses for privacy export", async () => {
  await assert.rejects(
    loadBrowserVaultReplica({
      emptyOnUnauthorized: false,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        error: {
          message: "Accept the current Murph legal consent before continuing.",
        },
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 403,
      })),
      knownReplicaRef: null,
    }),
    (error: unknown) => {
      assert.equal(isBrowserVaultUnauthorizedError(error), true);
      assert.match(
        error instanceof Error ? error.message : "",
        /HTTP 403: Accept the current Murph legal consent before continuing\./u,
      );
      return true;
    },
  );
});

function createReplicaRef() {
  return {
    byteLength: 128,
    dataKeyEnvelope: {
      alg: "AES-256-GCM-HKDF-SHA256" as const,
      dataKeyId: "hdk:browser-vault-replica:d",
      domain: "runtime" as const,
      lane: "browser-vault-replica" as const,
      resource: {
        objectKey: "users/browser-vault-replicas/opaque/replica.json",
        purpose: "browser-vault-replica",
        userId: "user_123",
      },
      rootKeyId: "udrk:runtime:test-root",
      schema: "murph.hosted-data-key-envelope.v1" as const,
      wraps: [{
        ciphertext: "wrapped-data-key",
        iv: "wrap-iv",
        kind: "domain-root" as const,
        rootKeyId: "udrk:runtime:test-root",
      }],
    },
    dataVersion: "d".repeat(64),
    generatedAt: "2026-04-20T08:00:00.000Z",
    generation: 1,
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica" as const,
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
