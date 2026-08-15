import { readFile } from "node:fs/promises";

import { beforeEach, expect, test, vi } from "vitest";

import { BROWSER_VAULT_REPLICA_CURRENT_GENERATION } from "@murphai/contracts";

import {
  BROWSER_VAULT_METRIC_BUCKET_IDS,
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  parseBrowserVaultReplica,
  splitBrowserVaultReplica,
  type BrowserVaultReplica,
} from "@murphai/query/browser-replica-client";
import {
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
} from "@murphai/hosted-execution/browser-vault";

const runtimeMocks = vi.hoisted(() => ({
  decryptHostedStoragePayload: vi.fn(),
  generateHostedUserRecipientKeyPair: vi.fn(),
  unwrapHostedBrowserSessionKey: vi.fn(),
}));
const queryBucketLifetime = vi.hoisted(() => ({
  active: 0,
  parsed: 0,
  peak: 0,
  remainingByBucket: new WeakMap<object, { remaining: number }>(),
}));

vi.mock("@murphai/runtime-state", async () => {
  const actual = await vi.importActual<typeof import("@murphai/runtime-state")>(
    "@murphai/runtime-state",
  );
  return {
    ...actual,
    decryptHostedStoragePayload: runtimeMocks.decryptHostedStoragePayload,
    generateHostedUserRecipientKeyPair:
      runtimeMocks.generateHostedUserRecipientKeyPair,
    unwrapHostedBrowserSessionKey: runtimeMocks.unwrapHostedBrowserSessionKey,
  };
});

vi.mock("@murphai/query/browser-replica-client", async () => {
  const actual = await vi.importActual<
    typeof import("@murphai/query/browser-replica-client")
  >("@murphai/query/browser-replica-client");
  return {
    ...actual,
    assembleBrowserVaultLoadedMetricRows: (
      ...args: Parameters<typeof actual.assembleBrowserVaultLoadedMetricRows>
    ) => {
      const rows = actual.assembleBrowserVaultLoadedMetricRows(...args);
      for (const bucket of Object.values(args[1])) {
        if (!bucket) continue;
        const lifetime = queryBucketLifetime.remainingByBucket.get(bucket);
        if (lifetime?.remaining === 0) {
          queryBucketLifetime.active -= 1;
          queryBucketLifetime.remainingByBucket.delete(bucket);
        }
      }
      return rows;
    },
    parseBrowserVaultMetricBucketShard: async (
      ...args: Parameters<typeof actual.parseBrowserVaultMetricBucketShard>
    ) => {
      const bucket = await actual.parseBrowserVaultMetricBucketShard(...args);
      const bucketRows = bucket.series.flatMap((series) => series.rows);
      const lifetime = { remaining: bucketRows.length };
      queryBucketLifetime.active += 1;
      queryBucketLifetime.parsed += 1;
      queryBucketLifetime.peak = Math.max(
        queryBucketLifetime.peak,
        queryBucketLifetime.active,
      );
      queryBucketLifetime.remainingByBucket.set(bucket, lifetime);
      for (const row of bucketRows) {
        Object.defineProperty(row, "toJSON", {
          configurable: true,
          enumerable: true,
          value(this: Record<string, unknown>) {
            lifetime.remaining -= 1;
            if (lifetime.remaining === 0) {
              queryBucketLifetime.active -= 1;
              queryBucketLifetime.remainingByBucket.delete(bucket);
            }
            const copy = { ...this };
            delete copy.toJSON;
            return copy;
          },
        });
      }
      return bucket;
    },
  };
});

import {
  loadBrowserVaultExport,
} from "@/src/lib/browser-vault/export";

beforeEach(() => {
  vi.clearAllMocks();
  queryBucketLifetime.active = 0;
  queryBucketLifetime.parsed = 0;
  queryBucketLifetime.peak = 0;
  queryBucketLifetime.remainingByBucket = new WeakMap();
  runtimeMocks.generateHostedUserRecipientKeyPair.mockResolvedValue({
    privateKeyJwk: { kty: "EC" },
    publicKeyJwk: { kty: "EC" },
  });
  runtimeMocks.unwrapHostedBrowserSessionKey.mockResolvedValue(
    new Uint8Array([1, 2, 3]),
  );
});

test("Settings export decrypts all children sequentially and preserves semantic rows", async () => {
  const fixture = await createBucketedExportFixture();
  let activeDecrypts = 0;
  let maxActiveDecrypts = 0;
  const decryptOrder: string[] = [];
  runtimeMocks.decryptHostedStoragePayload.mockImplementation(async ({
    envelope,
  }: {
    envelope: { ciphertext: string };
  }) => {
    activeDecrypts += 1;
    maxActiveDecrypts = Math.max(maxActiveDecrypts, activeDecrypts);
    decryptOrder.push(envelope.ciphertext);
    await Promise.resolve();
    activeDecrypts -= 1;
    const bytes = fixture.plaintextByCiphertext.get(envelope.ciphertext);
    if (!bytes) {
      throw new Error("Unexpected encrypted export child.");
    }
    return bytes;
  });
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(fixture.response);

  const result = await loadBrowserVaultExport({
    authorization: createAuthorization(),
    fetchImpl,
  });

  expect(runtimeMocks.unwrapHostedBrowserSessionKey).toHaveBeenCalledTimes(1);
  expect(runtimeMocks.decryptHostedStoragePayload).toHaveBeenCalledTimes(35);
  expect(maxActiveDecrypts).toBe(1);
  expect(queryBucketLifetime.parsed).toBe(BROWSER_VAULT_METRIC_BUCKET_IDS.length);
  expect(queryBucketLifetime.peak).toBe(1);
  expect(queryBucketLifetime.active).toBe(0);
  expect(decryptOrder).toEqual([
    "shard:core",
    "shard:labs",
    "shard:metricsIndex",
    ...BROWSER_VAULT_METRIC_BUCKET_IDS.map((bucketId) => `bucket:${bucketId}`),
  ]);
  const requestBody = JSON.parse(
    String(fetchImpl.mock.calls[0]?.[1]?.body),
  ) as Record<string, unknown>;
  expect(requestBody).toMatchObject({
    authorization: createAuthorization(),
    browserPublicKeyJwk: { kty: "EC" },
    requestedMetricBuckets: BROWSER_VAULT_METRIC_BUCKET_IDS,
    requestedShards: ["core", "labs", "metricsIndex"],
  });
  expect(fetchImpl).toHaveBeenCalledWith(
    "/api/settings/vault-export/session",
    expect.objectContaining({ method: "POST" }),
  );
  const exportedReplica = JSON.parse(await result.blob.text()) as BrowserVaultReplica;
  expect(exportedReplica.metricRows).toEqual(fixture.replica.metricRows);
  expect(exportedReplica).toEqual(fixture.replica);
  expect(result.generatedAt).toBe(fixture.replica.generatedAt);
  expect(result.blob.type).toBe("application/json; charset=utf-8");
});

test.each([
  {
    mutate(response: Record<string, unknown>) {
      const buckets = response.metricBuckets as Record<string, unknown>;
      delete buckets["1f"];
    },
    pattern: /must contain exactly the complete export set/u,
  },
  {
    mutate(response: Record<string, unknown>) {
      const shards = response.shards as Record<string, {
        shardAad: Record<string, unknown>;
      }>;
      shards.core!.shardAad.objectKey = "replicas/different.core.json";
    },
    pattern: /AAD did not match its atomic session ref/u,
  },
])("rejects incomplete or mismatched children before unwrapping %#", async ({
  mutate,
  pattern,
}) => {
  const fixture = await createBucketedExportFixture();
  const responseValue = await fixture.response.json() as Record<string, unknown>;
  mutate(responseValue);

  await expect(loadBrowserVaultExport({
    authorization: createAuthorization(),
    fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(responseValue),
    ),
  })).rejects.toThrow(pattern);
  expect(runtimeMocks.unwrapHostedBrowserSessionKey).not.toHaveBeenCalled();
  expect(runtimeMocks.decryptHostedStoragePayload).not.toHaveBeenCalled();
});

test("Settings export retains the legacy monolith fallback", async () => {
  const originalDecompressionStream = globalThis.DecompressionStream;
  vi.stubGlobal("DecompressionStream", undefined);
  try {
    const replica = parseBrowserVaultReplica(createReplica());
    const plaintext = new TextEncoder().encode(JSON.stringify(replica));
    const ref = {
      ...createBaseReplicaRef(),
      byteLength: plaintext.byteLength,
    };
    runtimeMocks.decryptHostedStoragePayload.mockResolvedValue(plaintext);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      encryptedReplica: createCipherEnvelope("legacy"),
      replicaAad: createBaseAad(ref, ref.objectKey, false),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }));

    const result = await loadBrowserVaultExport({
      authorization: createAuthorization(),
      fetchImpl,
    });

    const requestBody = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(requestBody.requestedShards).toBeUndefined();
    expect(requestBody.requestedMetricBuckets).toBeUndefined();
    expect(runtimeMocks.unwrapHostedBrowserSessionKey).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.decryptHostedStoragePayload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await result.blob.text())).toEqual(replica);
  } finally {
    vi.stubGlobal("DecompressionStream", originalDecompressionStream);
  }
});

test("Settings export rejects a legacy plaintext length mismatch", async () => {
  const originalDecompressionStream = globalThis.DecompressionStream;
  vi.stubGlobal("DecompressionStream", undefined);
  try {
    const replica = parseBrowserVaultReplica(createReplica());
    const plaintext = new TextEncoder().encode(JSON.stringify(replica));
    const ref = {
      ...createBaseReplicaRef(),
      byteLength: plaintext.byteLength + 1,
    };
    runtimeMocks.decryptHostedStoragePayload.mockResolvedValue(plaintext);

    await expect(loadBrowserVaultExport({
      authorization: createAuthorization(),
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        encryptedReplica: createCipherEnvelope("legacy"),
        replicaAad: createBaseAad(ref, ref.objectKey, false),
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef: ref,
        state: "ready",
      })),
    })).rejects.toThrow(/length did not match its session ref/u);

    expect(runtimeMocks.unwrapHostedBrowserSessionKey).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.decryptHostedStoragePayload).toHaveBeenCalledTimes(1);
  } finally {
    vi.stubGlobal("DecompressionStream", originalDecompressionStream);
  }
});

test("Settings export stays independent of interactive query-client construction", async () => {
  const source = await readFile(
    new URL("../src/lib/browser-vault/export.ts", import.meta.url),
    "utf8",
  );

  expect(source).not.toMatch(
    /createBrowserVault(?:Loaded|Route)?QueryClient|loadBrowserVaultReplica/u,
  );
  expect(source).not.toMatch(
    /assembleBrowserVaultReplicaShards|BrowserVaultMetricBucketShards/u,
  );
});

async function createBucketedExportFixture() {
  const replica = parseBrowserVaultReplica(createReplica());
  const shardSet = await splitBrowserVaultReplica(replica);
  const ref = createBucketedReplicaRef(shardSet);
  const plaintextByCiphertext = new Map<string, Uint8Array>();
  const shards = {
    core: createEncryptedShard(
      "core",
      shardSet.core,
      ref,
      plaintextByCiphertext,
    ),
    labs: createEncryptedShard(
      "labs",
      shardSet.labs,
      ref,
      plaintextByCiphertext,
    ),
    metricsIndex: createEncryptedShard(
      "metricsIndex",
      shardSet.metrics,
      ref,
      plaintextByCiphertext,
    ),
  };
  const metricBuckets = Object.fromEntries(
    BROWSER_VAULT_METRIC_BUCKET_IDS.map((bucketId) => [
      bucketId,
      createEncryptedMetricBucket(
        bucketId,
        shardSet.metricBuckets[bucketId],
        ref,
        plaintextByCiphertext,
      ),
    ]),
  );

  return {
    plaintextByCiphertext,
    replica,
    response: jsonResponse({
      deviceSyncImportPending: true,
      freshness: "stale",
      metricBuckets,
      refreshPending: true,
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      shards,
      state: "ready",
      workspaceVersion: "7",
    }),
  };
}

function createBucketedReplicaRef(
  shardSet: Awaited<ReturnType<typeof splitBrowserVaultReplica>>,
) {
  const ref = createBaseReplicaRef();
  const childRef = (objectKey: string, value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return {
      byteLength: bytes.byteLength,
      contentEncoding: "identity" as const,
      encodedByteLength: bytes.byteLength,
      objectKey,
    };
  };
  return {
    ...ref,
    metricBuckets: {
      bucketCount: HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT,
      buckets: Object.fromEntries(BROWSER_VAULT_METRIC_BUCKET_IDS.map((bucketId) => [
        bucketId,
        childRef(
          `replicas/export.metric.${bucketId}.json`,
          shardSet.metricBuckets[bucketId],
        ),
      ])),
      schema: HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
    },
    shards: {
      core: childRef("replicas/export.core.json", shardSet.core),
      labs: childRef("replicas/export.labs.json", shardSet.labs),
      metricsIndex: childRef(
        "replicas/export.metrics-index.json",
        shardSet.metrics,
      ),
      schema: HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
    },
  };
}

function createEncryptedShard(
  shard: "core" | "labs" | "metricsIndex",
  value: unknown,
  ref: ReturnType<typeof createBucketedReplicaRef>,
  plaintextByCiphertext: Map<string, Uint8Array>,
) {
  const ciphertext = `shard:${shard}`;
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  plaintextByCiphertext.set(ciphertext, plaintext);
  const childRef = ref.shards[shard];
  return {
    encryptedShard: createCipherEnvelope(ciphertext),
    shardAad: {
      ...createBaseAad(ref, childRef.objectKey, true),
      byteLength: childRef.byteLength,
      contentEncoding: childRef.contentEncoding,
      encodedByteLength: childRef.encodedByteLength,
      shard,
      shardSchema: shard === "core"
        ? "murph.browser-vault-replica.core.v1"
        : shard === "labs"
          ? "murph.browser-vault-replica.labs.v1"
          : "murph.browser-vault-replica.metrics-index.v1",
      shardSetRefSchema: HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
    },
  };
}

function createEncryptedMetricBucket(
  bucketId: (typeof BROWSER_VAULT_METRIC_BUCKET_IDS)[number],
  value: unknown,
  ref: ReturnType<typeof createBucketedReplicaRef>,
  plaintextByCiphertext: Map<string, Uint8Array>,
) {
  const ciphertext = `bucket:${bucketId}`;
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  plaintextByCiphertext.set(ciphertext, plaintext);
  const childRef = ref.metricBuckets.buckets[bucketId];
  return {
    encryptedMetricBucket: createCipherEnvelope(ciphertext),
    metricBucketAad: {
      ...createBaseAad(ref, childRef.objectKey, true),
      byteLength: childRef.byteLength,
      contentEncoding: childRef.contentEncoding,
      encodedByteLength: childRef.encodedByteLength,
      metricBucketCount: HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT,
      metricBucketId: bucketId,
      metricBucketSchema: "murph.browser-vault-replica.metric-bucket.v1",
      metricBucketSetRefSchema:
        HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
    },
  };
}

function createBaseReplicaRef() {
  return {
    byteLength: 1024,
    dataVersion: "data-version",
    generatedAt: "2026-08-13T12:00:00.000Z",
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
    keyId: "browser-vault-replica:test",
    objectKey: "replicas/export.json",
    replicaSchema: BROWSER_VAULT_REPLICA_SCHEMA,
    runtimeRootKeyId: "runtime-root-key:test",
    schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
    sourceBundleHash: "source-bundle-hash",
  };
}

function createBaseAad(
  ref: ReturnType<typeof createBaseReplicaRef>,
  objectKey: string,
  includeReplicaTime: boolean,
) {
  return {
    dataVersion: ref.dataVersion,
    ...(includeReplicaTime
      ? { generatedAt: ref.generatedAt, generation: ref.generation }
      : {}),
    objectKey,
    purpose: "browser-vault-replica",
    runtimeRootKeyId: ref.runtimeRootKeyId,
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    sourceBundleHash: ref.sourceBundleHash,
    userId: "member_123",
  };
}

function createReplicaKeyEnvelope() {
  return {
    createdAt: "2026-08-13T12:00:00.000Z",
    keyId: "browser-vault-replica:test",
    purpose: "browser-vault-replica",
    recipients: [{
      ciphertext: "wrapped-replica-key",
      ephemeralPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "ephemeral-x",
        y: "ephemeral-y",
      },
      iv: "recipient-iv",
      keyId: "browser-vault-replica:test",
      kind: "browser-session",
    }],
    schema: "murph.hosted-browser-session-key-envelope.v1",
    userId: "member_123",
  };
}

function createCipherEnvelope(ciphertext: string) {
  return {
    algorithm: "AES-GCM",
    ciphertext,
    iv: "cipher-iv",
    keyId: "browser-vault-replica:test",
    schema: "murph.hosted-cipher.v1",
    scope: "browser-vault-replica",
  };
}

function createAuthorization() {
  return {
    signature: `0x${"11".repeat(65)}` as `0x${string}`,
    token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  });
}

function createReplica(): BrowserVaultReplica {
  return {
    assistantSummary: {
      highlights: ["A compact core summary."],
      latestDate: "2026-08-12",
    },
    entities: [],
    experimentOutcomes: [createExportOutcome()],
    experimentRunCards: [],
    generatedAt: "2026-08-13T12:00:00.000Z",
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
    hasLabBiomarkers: false,
    labResultRows: [],
    metricGoalProgressRows: [],
    metricRows: [
      createMetricRow("estimated-vo2-max", 1),
      createMetricRow("lowest-spo2", 2),
      createMetricRow("resting-heart-rate", 3),
      createMetricRow("spo2", 4),
    ],
    metricSelectionRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: ["audit"],
      id: BROWSER_VAULT_REPLICA_POLICY_ID,
      includedFamilies: ["journal"],
      metricLookbackDays: 365,
    },
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: [],
    source: {
      dataVersion: "data-version",
      sourceBundleHash: "source-bundle-hash",
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
}

function createMetricRow(
  metricKey: string,
  sequence: number,
): BrowserVaultReplica["metricRows"][number] {
  return {
    biomarkerKey: null,
    comparator: null,
    confidence: "high",
    context: { preserved: true, sequence },
    date: `2026-08-${String(8 + sequence).padStart(2, "0")}`,
    grain: "day",
    id: `metric-row-${sequence}`,
    metricKey,
    observedAt: `2026-08-${String(8 + sequence).padStart(2, "0")}T09:00:00.000Z`,
    pointIds: [`point-${sequence}`],
    recordIds: [`record-${sequence}`],
    rowSchema: "murph.browser-vault.metric-row.v1",
    sourceFamily: "sample",
    sourceKind: "activity-summary",
    sourceLabel: "Device",
    statistic: "value",
    unit: "count",
    value: sequence,
    valueLabel: null,
  };
}

function createExportOutcome(): NonNullable<BrowserVaultReplica["experimentOutcomes"]>[number] {
  return {
    adherenceSummary: {
      completedSessions: 1,
      minimumUsefulSessions: 1,
      status: "met_target",
      targetSessions: 1,
    },
    asOf: "2026-08-12",
    commonsProtocolRef: null,
    conclusion: {
      caveats: [],
      headline: "Saved export result",
      plainLanguage: "The complete export preserves the saved result.",
    },
    confidence: { level: "medium", reasons: ["Saved evidence."] },
    confounders: [],
    experiment: {
      id: "exp_01ARZ3NDEKTSV4RRFFQ69G5FA6",
      slug: "saved-export-result",
      status: "completed",
      title: "Saved export result",
    },
    generatedAt: "2026-08-13T12:00:00.000Z",
    metricResults: [],
    outcomeId: "outcome-export-result",
    protocolRef: null,
    schemaVersion: "murph.experiment-outcome.v1",
    windows: {
      baselineEnd: "2026-08-11",
      baselineStart: "2026-08-11",
      interventionEnd: "2026-08-12",
      interventionStart: "2026-08-12",
    },
  };
}
