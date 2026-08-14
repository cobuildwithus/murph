import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";

import { beforeEach, test, vi } from "vitest";
import type { HostedBrowserVaultReplicaMetricBucketSetRef } from "@murphai/hosted-execution/browser-vault";
import {
  BROWSER_VAULT_EXPERIMENT_RUN_CARD_SCHEMA,
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  type BrowserVaultExperimentRunCard,
  type BrowserVaultMetricBucketId,
} from "@murphai/query/browser-replica-client";
import * as browserReplicaClient from "@murphai/query/browser-replica-client";

const runtimeMocks = vi.hoisted(() => ({
  decryptHostedStoragePayload: vi.fn(),
  generateHostedUserRecipientKeyPair: vi.fn(),
  unwrapHostedBrowserSessionKey: vi.fn(),
}));

vi.mock("@murphai/runtime-state", async () => {
  const actual = await vi.importActual<typeof import("@murphai/runtime-state")>(
    "@murphai/runtime-state",
  );
  return {
    ...actual,
    decryptHostedStoragePayload: runtimeMocks.decryptHostedStoragePayload,
    generateHostedUserRecipientKeyPair: runtimeMocks.generateHostedUserRecipientKeyPair,
    unwrapHostedBrowserSessionKey: runtimeMocks.unwrapHostedBrowserSessionKey,
  };
});

import {
  isBrowserVaultAbortError,
  isBrowserVaultUnauthorizedError,
  loadBrowserVaultReplica,
  parseBrowserVaultSessionResponse,
} from "@/src/lib/browser-vault/loader";
import { browserVaultReplicaRefsMatch } from "@/src/lib/browser-vault/ref";

beforeEach(() => {
  runtimeMocks.decryptHostedStoragePayload.mockReset();
  runtimeMocks.generateHostedUserRecipientKeyPair.mockReset();
  runtimeMocks.generateHostedUserRecipientKeyPair.mockResolvedValue({
    privateKeyJwk: { kty: "EC" },
    publicKeyJwk: { kty: "EC" },
  });
  runtimeMocks.unwrapHostedBrowserSessionKey.mockReset();
  runtimeMocks.unwrapHostedBrowserSessionKey.mockResolvedValue(new Uint8Array([1, 2, 3]));
});

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
      shards: {
        schema: "murph.hosted-browser-vault-replica-shards.v1",
        core: {
          byteLength: 512,
          contentEncoding: "gzip",
          encodedByteLength: 128,
          objectKey: "users/browser-vault-replicas/opaque/replica.core.json",
        },
        labs: {
          byteLength: 256,
          contentEncoding: "gzip",
          encodedByteLength: 64,
          objectKey: "users/browser-vault-replicas/opaque/replica.labs.json",
        },
        metricsIndex: {
          byteLength: 256,
          contentEncoding: "gzip",
          encodedByteLength: 64,
          objectKey: "users/browser-vault-replicas/opaque/replica.metrics-index.json",
        },
      },
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
  assert.deepEqual(body.knownShards, []);
  assert.deepEqual(body.requestedShards, ["core", "labs", "metricsIndex"]);
});

test("browser vault loader sends one complete route shard demand", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: createReplicaRef(),
    state: "not_modified",
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  }));

  await loadBrowserVaultReplica({
    fetchImpl,
    knownReplicaRef: createReplicaRef(),
    knownShards: ["core"],
    requestedShards: ["core", "metricsIndex"],
  });

  const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
  assert.deepEqual(body.knownShards, ["core"]);
  assert.deepEqual(body.requestedShards, ["core", "metricsIndex"]);
});

test("browser vault loader retries legacy when old Web omitted a missing requested shard", async () => {
  const knownReplicaRef = createShardedReplicaRef();
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: createReplicaRef(),
      state: "not_modified",
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      state: "empty",
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    }));

  const result = await loadBrowserVaultReplica({
    fetchImpl,
    knownReplicaRef,
    knownShards: ["core"],
    requestedShards: ["core", "metricsIndex"],
  });

  assert.equal(result.state, "empty");
  assert.equal(fetchImpl.mock.calls.length, 2);
  const retryBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
  assert.equal(retryBody.knownReplicaRef, null);
  assert.equal(retryBody.knownShards, undefined);
  assert.equal(retryBody.requestedShards, undefined);
});

test("browser vault loader falls back to the legacy transport without gzip support", async () => {
  const originalDecompressionStream = globalThis.DecompressionStream;
  vi.stubGlobal("DecompressionStream", undefined);
  try {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: createReplicaRef(),
      state: "not_modified",
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    }));

    await loadBrowserVaultReplica({
      fetchImpl,
      knownReplicaRef: createReplicaRef(),
      knownShards: ["core"],
      requestedShards: ["core", "metricsIndex"],
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    assert.equal(body.knownShards, undefined);
    assert.equal(body.requestedShards, undefined);
  } finally {
    vi.stubGlobal("DecompressionStream", originalDecompressionStream);
  }
});

test("browser vault loader rejects a decrypted shard whose generatedAt differs from its replica ref", async () => {
  const fixture = createShardedReadyFixture(["core"], {
    coreGeneratedAt: "2026-04-20T07:59:59.000Z",
  });
  runtimeMocks.decryptHostedStoragePayload.mockResolvedValue(fixture.encoded.core);

  await assert.rejects(
    loadBrowserVaultReplica({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(fixture.response),
      knownReplicaRef: null,
      requestedShards: ["core"],
    }),
    /Browser vault replica generatedAt did not match its session ref\./u,
  );
});

test("browser vault loader decrypts selected shards concurrently", async () => {
  const fixture = createShardedReadyFixture(["core", "metricsIndex"]);
  const core = createDeferred<Uint8Array>();
  const metricsIndex = createDeferred<Uint8Array>();
  const bothStarted = createDeferred<void>();
  runtimeMocks.decryptHostedStoragePayload.mockImplementation(
    ({ envelope }: { envelope: { ciphertext: string } }) => {
      if (runtimeMocks.decryptHostedStoragePayload.mock.calls.length === 2) {
        bothStarted.resolve();
      }
      if (envelope.ciphertext === "core") return core.promise;
      if (envelope.ciphertext === "metricsIndex") return metricsIndex.promise;
      throw new Error("Unexpected shard envelope.");
    },
  );

  const load = loadBrowserVaultReplica({
    fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(fixture.response),
    knownReplicaRef: null,
    requestedShards: ["core", "metricsIndex"],
  });
  await bothStarted.promise;
  assert.equal(runtimeMocks.decryptHostedStoragePayload.mock.calls.length, 2);

  core.resolve(fixture.encoded.core);
  metricsIndex.resolve(fixture.encoded.metricsIndex);
  const result = await load;
  assert.equal(result.state, "ready");
  if (result.state === "ready") {
    assert.deepEqual(result.loadedShards, ["core", "metricsIndex"]);
  }
});

test("browser vault loader bounds concurrent fixed and metric-bucket decrypts at four", async () => {
  const bucketIds = ["00", "01", "02", "03"] as const;
  const fixture = createShardedReadyFixture(["core", "metricsIndex"], {
    selectedMetricBuckets: bucketIds,
  });
  const release = createDeferred<void>();
  const fourStarted = createDeferred<void>();
  let active = 0;
  let maxActive = 0;
  runtimeMocks.decryptHostedStoragePayload.mockImplementation(
    async ({ envelope }: { envelope: { ciphertext: string } }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (runtimeMocks.decryptHostedStoragePayload.mock.calls.length === 4) {
        fourStarted.resolve();
      }
      await release.promise;
      active -= 1;
      return readFixtureEncodedPayload(fixture, envelope.ciphertext);
    },
  );

  const load = loadBrowserVaultReplica({
    fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(fixture.response),
    knownReplicaRef: null,
    requestedMetricBuckets: bucketIds,
    requestedShards: ["core", "metricsIndex"],
  });
  await fourStarted.promise;
  assert.equal(runtimeMocks.decryptHostedStoragePayload.mock.calls.length, 4);
  assert.equal(maxActive, 4);
  release.resolve();
  const result = await load;
  assert.equal(result.state, "ready");
  assert.equal(runtimeMocks.decryptHostedStoragePayload.mock.calls.length, 6);
  assert.equal(maxActive, 4);
});

test("browser vault loader rejects an aggregate route demand above the replica byte cap", async () => {
  const fixture = createShardedReadyFixture(["core", "metricsIndex"], {
    inflateAggregateBudget: true,
  });
  await assert.rejects(
    loadBrowserVaultReplica({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(fixture.response),
      knownReplicaRef: null,
      requestedShards: ["core", "metricsIndex"],
    }),
    /aggregate byte limit/u,
  );
  assert.equal(runtimeMocks.decryptHostedStoragePayload.mock.calls.length, 0);
});

test("browser vault loader binds child identity to the key envelope before decrypt", async () => {
  const fixture = createShardedReadyFixture(["core"], {
    envelopeMemberId: "different_member",
  });
  await assert.rejects(
    loadBrowserVaultReplica({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(fixture.response),
      knownReplicaRef: null,
      requestedShards: ["core"],
    }),
    /envelope identity did not match/u,
  );
  assert.equal(runtimeMocks.unwrapHostedBrowserSessionKey.mock.calls.length, 0);
  assert.equal(runtimeMocks.decryptHostedStoragePayload.mock.calls.length, 0);
});

test("browser vault loader rejects a legacy plaintext length mismatch before parsing", async () => {
  const ref = createReplicaRef();
  runtimeMocks.decryptHostedStoragePayload.mockResolvedValue(new Uint8Array([123]));
  const response = new Response(JSON.stringify({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: {
      dataKeyId: ref.dataKeyEnvelope.dataKeyId,
      dataKeyRootKeyId: ref.dataKeyEnvelope.rootKeyId,
      dataVersion: ref.dataVersion,
      objectKey: ref.objectKey,
      purpose: "browser-vault-replica",
      runtimeRootKeyId: ref.runtimeRootKeyId,
      schema: "murph.browser-vault-replica",
      sourceBundleHash: ref.sourceBundleHash,
      userId: "member_123",
    },
    replicaKeyEnvelope: createReplicaKeyEnvelope(ref.dataKeyEnvelope.dataKeyId),
    replicaRef: ref,
    state: "ready",
  }), { status: 200 });
  await assert.rejects(
    loadBrowserVaultReplica({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response),
      knownReplicaRef: null,
      requestedShards: ["core"],
    }),
    /legacy replica byte length/u,
  );
});

test("browser vault loader rebuilds pre-bucket legacy run-card demand before cold detail selection", async () => {
  const persistedRunCard: Omit<BrowserVaultExperimentRunCard, "requiredMetricBuckets"> = {
    id: "run_legacy",
    lookupKeys: {
      experimentIds: ["run_legacy"],
      protocolKeys: ["protocol_legacy"],
      slugs: ["legacy-protocol"],
    },
    runSummary: { metrics: [] },
    schema: BROWSER_VAULT_EXPERIMENT_RUN_CARD_SCHEMA,
    slug: "legacy-protocol",
    startedOn: "2026-04-01",
    status: "active",
    statusLabel: "Active",
    summary: null,
    summaryDetail: null,
    tags: [],
    title: "Legacy protocol",
  };
  const derivedRunCard: BrowserVaultExperimentRunCard = {
    ...persistedRunCard,
    requiredMetricBuckets: ["00" as const],
  };
  const buildRunCards = vi.spyOn(
    browserReplicaClient,
    "buildBrowserVaultExperimentRunCards",
  ).mockResolvedValue([derivedRunCard]);
  const legacyReplica = {
    assistantSummary: { highlights: [], latestDate: null },
    entities: [],
    experimentRunCards: [persistedRunCard],
    generatedAt: createReplicaRef().generatedAt,
    generation: createReplicaRef().generation,
    labResultRows: [],
    metricGoalProgressRows: [],
    metricRows: [],
    metricSelectionRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: [],
      id: BROWSER_VAULT_REPLICA_POLICY_ID,
      includedFamilies: [],
      metricLookbackDays: 365,
    },
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: [],
    source: {
      dataVersion: createReplicaRef().dataVersion,
      sourceBundleHash: createReplicaRef().sourceBundleHash,
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(legacyReplica));
  const ref = {
    ...createReplicaRef(),
    byteLength: plaintext.byteLength,
  };
  runtimeMocks.decryptHostedStoragePayload.mockResolvedValue(plaintext);
  const response = new Response(JSON.stringify({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: {
      dataKeyId: ref.dataKeyEnvelope.dataKeyId,
      dataKeyRootKeyId: ref.dataKeyEnvelope.rootKeyId,
      dataVersion: ref.dataVersion,
      objectKey: ref.objectKey,
      purpose: "browser-vault-replica",
      runtimeRootKeyId: ref.runtimeRootKeyId,
      schema: BROWSER_VAULT_REPLICA_SCHEMA,
      sourceBundleHash: ref.sourceBundleHash,
      userId: "member_123",
    },
    replicaKeyEnvelope: createReplicaKeyEnvelope(ref.dataKeyEnvelope.dataKeyId),
    replicaRef: ref,
    state: "ready",
  }), { status: 200 });

  try {
    const result = await loadBrowserVaultReplica({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response),
      knownReplicaRef: null,
      requestedMetricBuckets: ["00"],
      requestedShards: ["core", "metricsIndex"],
    });

    assert.equal(result.state, "ready");
    if (result.state !== "ready") return;
    assert.deepEqual(
      result.client.experimentRunCards.get("run_legacy")?.requiredMetricBuckets,
      ["00"],
    );
    assert.deepEqual(result.loadedMetricBuckets, ["00"]);
    assert.equal(result.client.capability, "core+metrics-partial");
    assert.equal(buildRunCards.mock.calls.length, 1);
  } finally {
    buildRunCards.mockRestore();
  }
});

test("browser vault loader reuses only the active same-ref bucket intersection and resets on a new ref", async () => {
  const firstFixture = createShardedReadyFixture(["core", "metricsIndex"], {
    selectedMetricBuckets: ["00"],
  });
  const secondFixture = createShardedReadyFixture([], {
    selectedMetricBuckets: ["01"],
  });
  runtimeMocks.decryptHostedStoragePayload.mockImplementation(
    ({ envelope }: { envelope: { ciphertext: string } }) => Promise.resolve(
      readFixtureEncodedPayload(
        envelope.ciphertext === "bucket:01" ? secondFixture : firstFixture,
        envelope.ciphertext,
      ),
    ),
  );
  const first = await loadBrowserVaultReplica({
    fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(firstFixture.response),
    knownReplicaRef: null,
    requestedMetricBuckets: ["00"],
    requestedShards: ["core", "metricsIndex"],
  });
  assert.equal(first.state, "ready");
  if (first.state !== "ready") return;

  const accumulated = await loadBrowserVaultReplica({
    fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(secondFixture.response),
    knownMetricBuckets: first.loadedMetricBuckets,
    knownReplicaRef: first.replicaRef,
    knownReplicaShards: first.shards,
    knownShards: first.loadedShards,
    requestedMetricBuckets: ["00", "01"],
    requestedShards: ["core", "metricsIndex"],
  });
  assert.equal(accumulated.state, "ready");
  if (accumulated.state !== "ready") return;
  assert.deepEqual(accumulated.loadedMetricBuckets, ["00", "01"]);

  const activeOnlyFixture = createShardedReadyFixture([], {
    selectedMetricBuckets: ["01"],
  });
  runtimeMocks.decryptHostedStoragePayload.mockImplementation(
    ({ envelope }: { envelope: { ciphertext: string } }) => Promise.resolve(
      readFixtureEncodedPayload(activeOnlyFixture, envelope.ciphertext),
    ),
  );
  const activeOnly = await loadBrowserVaultReplica({
    fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(activeOnlyFixture.response),
    knownMetricBuckets: accumulated.loadedMetricBuckets,
    knownReplicaRef: accumulated.replicaRef,
    knownReplicaShards: accumulated.shards,
    knownShards: accumulated.loadedShards,
    requestedMetricBuckets: ["01"],
    requestedShards: ["core", "metricsIndex"],
  });
  assert.equal(activeOnly.state, "ready");
  if (activeOnly.state !== "ready") return;
  assert.deepEqual(activeOnly.loadedMetricBuckets, ["01"]);
  assert.equal(activeOnly.shards.metricBuckets?.["00"], undefined);

  const replacementFixture = createShardedReadyFixture(["core", "metricsIndex"], {
    generatedAt: "2026-05-01T08:00:00.000Z",
    selectedMetricBuckets: ["01"],
  });
  runtimeMocks.decryptHostedStoragePayload.mockImplementation(
    ({ envelope }: { envelope: { ciphertext: string } }) => Promise.resolve(
      readFixtureEncodedPayload(replacementFixture, envelope.ciphertext),
    ),
  );
  const replacement = await loadBrowserVaultReplica({
    fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(replacementFixture.response),
    knownMetricBuckets: activeOnly.loadedMetricBuckets,
    knownReplicaRef: activeOnly.replicaRef,
    knownReplicaShards: activeOnly.shards,
    knownShards: activeOnly.loadedShards,
    requestedMetricBuckets: ["01"],
    requestedShards: ["core", "metricsIndex"],
  });
  assert.equal(replacement.state, "ready");
  if (replacement.state === "ready") {
    assert.deepEqual(replacement.loadedMetricBuckets, ["01"]);
    assert.equal(replacement.replicaRef.generatedAt, "2026-05-01T08:00:00.000Z");
  }
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

function createShardedReplicaRef() {
  const ref = createReplicaRef();
  return {
    ...ref,
    shards: {
      schema: "murph.hosted-browser-vault-replica-shards.v1" as const,
      core: createShardRef("core", 32),
      labs: createShardRef("labs", 34),
      metricsIndex: createShardRef("metricsIndex", 36),
    },
    metricBuckets: createMetricBucketRefs(),
  };
}

function createShardRef(shard: "core" | "labs" | "metricsIndex", encodedByteLength: number) {
  return {
    byteLength: encodedByteLength + 64,
    contentEncoding: "gzip" as const,
    encodedByteLength,
    objectKey: `users/browser-vault-replicas/opaque/replica.${shard}.json`,
  };
}

function createShardedReadyFixture(
  selectedShards: readonly ("core" | "labs" | "metricsIndex")[],
  options: {
    coreGeneratedAt?: string;
    envelopeMemberId?: string;
    inflateAggregateBudget?: boolean;
    generatedAt?: string;
    selectedMetricBuckets?: readonly BrowserVaultMetricBucketId[];
  } = {},
) {
  const baseRef = {
    ...createReplicaRef(),
    generatedAt: options.generatedAt ?? createReplicaRef().generatedAt,
  };
  const identity = {
    dataVersion: baseRef.dataVersion,
    generatedAt: baseRef.generatedAt,
    generation: baseRef.generation,
    replicaSchema: "murph.browser-vault-replica" as const,
    sourceBundleHash: baseRef.sourceBundleHash,
  };
  const values = {
    core: {
      assistantSummary: { highlights: [], latestDate: null },
      entities: [],
      experimentRunCards: [],
      hasLabBiomarkers: false,
      identity: {
        ...identity,
        generatedAt: options.coreGeneratedAt ?? identity.generatedAt,
      },
      policy: {
        bodyPreviewChars: 280,
        excludedFamilies: [],
        id: "health-vault-browser",
        includedFamilies: [],
        metricLookbackDays: 365,
      },
      schema: "murph.browser-vault-replica.core.v1",
      timelineRows: [],
      weeklySampleSummaries: [],
    },
    labs: {
      identity,
      labResultRows: [],
      schema: "murph.browser-vault-replica.labs.v1",
    },
    metricsIndex: {
      experimentOutcomes: [],
      identity,
      metricGoalProgressRows: [],
      metricDirectory: [],
      metricRowCount: 0,
      metricSelectionRows: [],
      schema: "murph.browser-vault-replica.metrics-index.v1",
      sourceHealthRows: [],
    },
  };
  const plaintext = {
    core: new TextEncoder().encode(JSON.stringify(values.core)),
    labs: new TextEncoder().encode(JSON.stringify(values.labs)),
    metricsIndex: new TextEncoder().encode(JSON.stringify(values.metricsIndex)),
  };
  const encoded = {
    core: Uint8Array.from(gzipSync(plaintext.core)),
    labs: Uint8Array.from(gzipSync(plaintext.labs)),
    metricsIndex: Uint8Array.from(gzipSync(plaintext.metricsIndex)),
    metricBuckets: {} as Partial<Record<BrowserVaultMetricBucketId, Uint8Array>>,
  };
  const metricBucketPlaintext: Partial<Record<BrowserVaultMetricBucketId, Uint8Array>> = {};
  const allMetricBucketIds = Array.from(
    { length: 32 },
    (_, index) => index.toString(16).padStart(2, "0") as BrowserVaultMetricBucketId,
  );
  for (const bucketId of allMetricBucketIds) {
    const bytes = new TextEncoder().encode(JSON.stringify({
      bucketId,
      identity,
      schema: "murph.browser-vault-replica.metric-bucket.v1",
      series: [],
    }));
    metricBucketPlaintext[bucketId] = bytes;
    encoded.metricBuckets[bucketId] = Uint8Array.from(gzipSync(bytes));
  }
  const ref = {
    ...baseRef,
    shards: {
      schema: "murph.hosted-browser-vault-replica-shards.v1" as const,
      core: createExactShardRef(
        "core",
        options.inflateAggregateBudget ? 30 * 1024 * 1024 : plaintext.core.byteLength,
        encoded.core.byteLength,
      ),
      labs: createExactShardRef("labs", plaintext.labs.byteLength, encoded.labs.byteLength),
      metricsIndex: createExactShardRef(
        "metricsIndex",
        options.inflateAggregateBudget
          ? 30 * 1024 * 1024
          : plaintext.metricsIndex.byteLength,
        encoded.metricsIndex.byteLength,
      ),
    },
    metricBuckets: createMetricBucketRefs(metricBucketPlaintext, encoded.metricBuckets),
  };
  const shards = Object.fromEntries(selectedShards.map((shard) => {
    const shardRef = ref.shards[shard];
    const shardSchema = values[shard].schema;
    return [shard, {
      encryptedShard: {
        ...createReplicaEnvelope(),
        ciphertext: shard,
        keyId: ref.dataKeyEnvelope.dataKeyId,
      },
      shardAad: {
        byteLength: shardRef.byteLength,
        contentEncoding: shardRef.contentEncoding,
        dataKeyId: ref.dataKeyEnvelope.dataKeyId,
        dataKeyRootKeyId: ref.dataKeyEnvelope.rootKeyId,
        dataVersion: ref.dataVersion,
        encodedByteLength: shardRef.encodedByteLength,
        generatedAt: ref.generatedAt,
        generation: ref.generation,
        objectKey: shardRef.objectKey,
        purpose: "browser-vault-replica",
        runtimeRootKeyId: ref.runtimeRootKeyId,
        schema: "murph.browser-vault-replica",
        shard,
        shardSchema,
        shardSetRefSchema: ref.shards.schema,
        sourceBundleHash: ref.sourceBundleHash,
        userId: "member_123",
      },
    }];
  }));
  const metricBuckets = Object.fromEntries(
    (options.selectedMetricBuckets ?? []).map((bucketId) => {
      const bucketRef = ref.metricBuckets.buckets[bucketId];
      return [bucketId, {
        encryptedMetricBucket: {
          ...createReplicaEnvelope(),
          ciphertext: `bucket:${bucketId}`,
          keyId: ref.dataKeyEnvelope.dataKeyId,
        },
        metricBucketAad: {
          byteLength: bucketRef.byteLength,
          contentEncoding: bucketRef.contentEncoding,
          dataKeyId: ref.dataKeyEnvelope.dataKeyId,
          dataKeyRootKeyId: ref.dataKeyEnvelope.rootKeyId,
          dataVersion: ref.dataVersion,
          encodedByteLength: bucketRef.encodedByteLength,
          generatedAt: ref.generatedAt,
          generation: ref.generation,
          metricBucketCount: 32,
          metricBucketId: bucketId,
          metricBucketSchema: "murph.browser-vault-replica.metric-bucket.v1",
          metricBucketSetRefSchema: ref.metricBuckets.schema,
          objectKey: bucketRef.objectKey,
          purpose: "browser-vault-replica",
          runtimeRootKeyId: ref.runtimeRootKeyId,
          schema: "murph.browser-vault-replica",
          sourceBundleHash: ref.sourceBundleHash,
          userId: "member_123",
        },
      }];
    }),
  );

  return {
    encoded,
    response: new Response(JSON.stringify({
      replicaKeyEnvelope: createReplicaKeyEnvelope(
        ref.dataKeyEnvelope.dataKeyId,
        options.envelopeMemberId,
      ),
      replicaRef: ref,
      ...(Object.keys(metricBuckets).length === 0 ? {} : { metricBuckets }),
      shards,
      state: "ready",
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    }),
  };
}

function createExactShardRef(
  shard: "core" | "labs" | "metricsIndex",
  byteLength: number,
  encodedByteLength: number,
) {
  return {
    byteLength,
    contentEncoding: "gzip" as const,
    encodedByteLength,
    objectKey: `users/browser-vault-replicas/opaque/replica.${shard}.json`,
  };
}

function createMetricBucketRefs(
  plaintext: Partial<Record<BrowserVaultMetricBucketId, Uint8Array>> = {},
  encoded: Partial<Record<BrowserVaultMetricBucketId, Uint8Array>> = {},
): HostedBrowserVaultReplicaMetricBucketSetRef {
  const buckets = Object.fromEntries(
    Array.from({ length: 32 }, (_, index) => {
      const bucketId = index.toString(16).padStart(2, "0");
      const plaintextBytes = plaintext[bucketId as BrowserVaultMetricBucketId];
      const encodedBytes = encoded[bucketId as BrowserVaultMetricBucketId];
      return [bucketId, {
        byteLength: plaintextBytes?.byteLength ?? 1,
        contentEncoding: plaintextBytes ? "gzip" as const : "identity" as const,
        encodedByteLength: encodedBytes?.byteLength ?? 1,
        objectKey: `users/browser-vault-replicas/opaque/replica.metric-${bucketId}.json`,
      }];
    }),
  );
  return {
    bucketCount: 32 as const,
    buckets: buckets as HostedBrowserVaultReplicaMetricBucketSetRef["buckets"],
    schema: "murph.hosted-browser-vault-replica-metric-buckets.v1" as const,
  };
}

function createReplicaKeyEnvelope(keyId: string, userId = "member_123") {
  return {
    createdAt: "2026-04-20T08:00:00.000Z",
    keyId,
    purpose: "browser-vault-replica",
    recipients: [{
      ciphertext: "ciphertext",
      ephemeralPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "ephemeral-x",
        y: "ephemeral-y",
      },
      iv: "iv",
      keyId,
      kind: "browser-session",
    }],
    schema: "murph.hosted-browser-session-key-envelope.v1",
    userId,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function readFixtureEncodedPayload(
  fixture: ReturnType<typeof createShardedReadyFixture>,
  ciphertext: string,
): Uint8Array {
  if (ciphertext === "core") return fixture.encoded.core;
  if (ciphertext === "labs") return fixture.encoded.labs;
  if (ciphertext === "metricsIndex") return fixture.encoded.metricsIndex;
  if (ciphertext.startsWith("bucket:")) {
    const bucketId = ciphertext.slice("bucket:".length) as BrowserVaultMetricBucketId;
    const bytes = fixture.encoded.metricBuckets[bucketId];
    if (bytes) return bytes;
  }
  throw new Error(`Unexpected encrypted test payload ${ciphertext}.`);
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
