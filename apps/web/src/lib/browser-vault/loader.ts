import {
  buildHostedStorageAad,
  decryptHostedStoragePayload,
  generateHostedUserRecipientKeyPair,
  parseHostedBrowserSessionKeyEnvelope,
  parseHostedCipherEnvelope,
  unwrapHostedBrowserSessionKey,
  type HostedBrowserSessionKeyEnvelope,
  type HostedCipherEnvelope,
} from "@murphai/runtime-state";
import {
  BROWSER_VAULT_CORE_SHARD_SCHEMA,
  BROWSER_VAULT_LABS_SHARD_SCHEMA,
  BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA,
  BROWSER_VAULT_METRICS_SHARD_SCHEMA,
  buildBrowserVaultExperimentRunCards,
  createBrowserVaultQueryClient,
  createBrowserVaultLoadedQueryClients,
  parseBrowserVaultCoreShard,
  parseBrowserVaultLabsShard,
  parseBrowserVaultMetricBucketShard,
  parseBrowserVaultMetricsShard,
  parseBrowserVaultReplica,
  splitBrowserVaultReplica,
  type BrowserVaultCoreCapableQueryClient,
  type BrowserVaultMetricBucketId,
  type BrowserVaultMetricSeriesCapableQueryClient,
  type BrowserVaultReplicaShardSelection,
} from "@murphai/query/browser-replica-client";
import { BROWSER_VAULT_REPLICA_CURRENT_GENERATION } from "@murphai/contracts/browser-vault";
import {
  getHostedBrowserVaultReplicaStorageKeyId,
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
  parseHostedBrowserVaultReplicaRef,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/browser-vault";

import type { SensitiveActionAuthorization } from "@/src/lib/sensitive-actions/shared";

import {
  browserVaultReplicaLegacyFieldsMatch,
  browserVaultReplicaRefsMatch,
} from "./ref";
import {
  BROWSER_VAULT_REPLICA_SHARDS,
  type BrowserVaultReplicaShard,
} from "./route-shards";

export type BrowserVaultFreshness = "fresh" | "stale";

export interface BrowserVaultSessionMetadata {
  deviceSyncImportPending: boolean;
  freshness: BrowserVaultFreshness;
  refreshPending: boolean;
  workspaceVersion: string | null;
}

export type BrowserVaultAnyQueryClient = BrowserVaultCoreCapableQueryClient;

export type BrowserVaultSessionLoadResult =
  | (BrowserVaultSessionMetadata & { memberId: string | null; state: "empty" })
  | (BrowserVaultSessionMetadata & {
      memberId: string;
      replicaRef: HostedBrowserVaultReplicaRef;
      state: "not_modified";
    })
  | (BrowserVaultSessionMetadata & {
      client: BrowserVaultAnyQueryClient;
      loadedMetricBuckets: readonly BrowserVaultMetricBucketId[];
      loadedShards: readonly BrowserVaultReplicaShard[];
      memberId: string;
      replicaRef: HostedBrowserVaultReplicaRef;
      shards: BrowserVaultReplicaShardSelection;
      state: "ready";
    })
  | { state: "identity_changed" };

export interface LoadBrowserVaultReplicaInput {
  authorization?: SensitiveActionAuthorization;
  emptyOnUnauthorized?: boolean;
  endpoint?: string;
  expectedMemberId?: string | null;
  fetchImpl?: typeof fetch;
  knownReplicaShards?: BrowserVaultReplicaShardSelection | null;
  knownMetricBuckets?: readonly BrowserVaultMetricBucketId[];
  knownShards?: readonly BrowserVaultReplicaShard[];
  knownReplicaRef: HostedBrowserVaultReplicaRef | null;
  preferLegacyTransport?: boolean;
  requestedShards?: readonly BrowserVaultReplicaShard[];
  requestedMetricBuckets?: readonly BrowserVaultMetricBucketId[];
  requestRefresh?: boolean;
  signal?: AbortSignal;
}

export class BrowserVaultUnauthorizedError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message: string) {
    super(`Browser vault session failed with HTTP ${status}: ${message}`);
    this.name = "BrowserVaultUnauthorizedError";
    this.status = status;
  }
}

const textDecoder = new TextDecoder();
const BROWSER_VAULT_INTERACTIVE_DECODE_CONCURRENCY = 4;

export async function loadBrowserVaultReplica({
  authorization,
  emptyOnUnauthorized = true,
  endpoint = "/api/browser-vault/session",
  expectedMemberId,
  fetchImpl = fetch,
  knownReplicaShards = null,
  knownMetricBuckets = [],
  knownShards = [],
  knownReplicaRef,
  preferLegacyTransport = false,
  requestedShards = BROWSER_VAULT_REPLICA_SHARDS,
  requestedMetricBuckets = [],
  requestRefresh = false,
  signal,
}: LoadBrowserVaultReplicaInput): Promise<BrowserVaultSessionLoadResult> {
  assertNotAborted(signal);
  assertValidBrowserVaultMetricBucketDemand(requestedMetricBuckets);
  if (
    requestedMetricBuckets.length > 0
    && !requestedShards.includes("metricsIndex")
  ) {
    throw new Error(
      "Browser vault metric bucket demand requires the metrics index shard.",
    );
  }

  const { privateKeyJwk, publicKeyJwk } = await generateHostedUserRecipientKeyPair();
  assertNotAborted(signal);
  const acceptsCompressedShards = !preferLegacyTransport
    && typeof DecompressionStream === "function";

  const response = await fetchImpl(endpoint, {
    body: JSON.stringify({
      acceptStaleReplica: true,
      ...(authorization ? { authorization } : {}),
      browserPublicKeyJwk: publicKeyJwk,
      knownReplicaRef,
      ...(acceptsCompressedShards ? { knownShards, requestedShards } : {}),
      ...(acceptsCompressedShards && requestedMetricBuckets.length > 0
        ? { knownMetricBuckets, requestedMetricBuckets }
        : {}),
      ...(requestRefresh ? { requestRefresh: true } : {}),
    }),
    credentials: "same-origin",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
    signal,
  });

  if (response.status === 401 || response.status === 403) {
    if (emptyOnUnauthorized) {
      return createEmptyLoadResult();
    }

    const status = response.status === 401 ? 401 : 403;
    throw new BrowserVaultUnauthorizedError(
      status,
      await readJsonErrorMessage(response),
    );
  }

  if (!response.ok) {
    throw new Error(await readJsonErrorMessage(response));
  }

  assertNotAborted(signal);
  const sessionValue: unknown = await response.json();
  assertNotAborted(signal);
  const session = parseBrowserVaultSessionResponse(sessionValue);
  const responseMemberId = session.state === "ready"
    ? getReadySessionMemberId(session)
    : session.memberId;

  if (
    expectedMemberId !== undefined
    && responseMemberId !== expectedMemberId
  ) {
    return { state: "identity_changed" };
  }

  if (session.state === "empty") {
    return {
      deviceSyncImportPending: session.deviceSyncImportPending,
      freshness: session.freshness,
      memberId: session.memberId,
      refreshPending: session.refreshPending,
      state: "empty",
      workspaceVersion: session.workspaceVersion,
    };
  }

  if (session.state === "not_modified") {
    if (!knownReplicaRef) {
      throw new Error("Browser vault unchanged session response did not have a known replica ref.");
    }

    const responseReplicaRef = session.replicaRef.generation === undefined
      && knownReplicaRef.generation !== undefined
      ? { ...session.replicaRef, generation: knownReplicaRef.generation }
      : session.replicaRef;
    const oldServerOmittedChildRefs = responseReplicaRef.shards === undefined
      && responseReplicaRef.metricBuckets === undefined
      && (
        knownReplicaRef.shards !== undefined
        || knownReplicaRef.metricBuckets !== undefined
      )
      && browserVaultReplicaLegacyFieldsMatch(responseReplicaRef, knownReplicaRef);
    if (
      !oldServerOmittedChildRefs
      && !browserVaultReplicaRefsMatch(responseReplicaRef, knownReplicaRef)
    ) {
      throw new Error("Browser vault unchanged session ref did not match the known ref.");
    }

    if (
      oldServerOmittedChildRefs
      && (
        !requestedShards.every((shard) => knownShards.includes(shard))
        || !requestedMetricBuckets.every((bucketId) =>
          knownMetricBuckets.includes(bucketId)
        )
      )
    ) {
      return loadBrowserVaultReplica({
        authorization,
        emptyOnUnauthorized,
        endpoint,
        expectedMemberId,
        fetchImpl,
        knownReplicaRef: null,
        preferLegacyTransport: true,
        requestedMetricBuckets,
        requestedShards,
        requestRefresh,
        signal,
      });
    }

    return {
      deviceSyncImportPending: session.deviceSyncImportPending,
      freshness: session.freshness,
      memberId: session.memberId,
      replicaRef: knownReplicaRef,
      refreshPending: session.refreshPending,
      state: "not_modified",
      workspaceVersion: session.workspaceVersion,
    };
  }

  const replicaKey = await unwrapHostedBrowserSessionKey({
    envelope: session.replicaKeyEnvelope,
    recipientPrivateKeyJwk: privateKeyJwk,
  });
  assertNotAborted(signal);

  const loaded = session.transport === "legacy"
    ? await loadLegacyBrowserVaultReplica({
        replicaKey,
        requestedMetricBuckets,
        requestedShards,
        session,
        signal,
      })
    : await loadShardedBrowserVaultReplica({
        knownReplicaRef,
        knownReplicaShards,
        replicaKey,
        requestedMetricBuckets,
        requestedShards,
        session,
        signal,
      });

  return {
    client: createBrowserVaultRouteQueryClient(
      loaded.shards,
      requestedShards,
      requestedMetricBuckets,
    ),
    deviceSyncImportPending: session.deviceSyncImportPending,
    freshness: session.freshness,
    loadedMetricBuckets: listLoadedBrowserVaultMetricBuckets(loaded.shards),
    loadedShards: listLoadedBrowserVaultShards(loaded.shards),
    memberId: responseMemberId,
    replicaRef: loaded.replicaRef,
    refreshPending: session.refreshPending,
    shards: loaded.shards,
    state: "ready",
    workspaceVersion: session.workspaceVersion,
  };
}

async function loadLegacyBrowserVaultReplica(input: {
  replicaKey: Uint8Array;
  requestedMetricBuckets: readonly BrowserVaultMetricBucketId[];
  requestedShards: readonly BrowserVaultReplicaShard[];
  session: Extract<BrowserVaultSessionResponse, { state: "ready"; transport: "legacy" }>;
  signal?: AbortSignal;
}): Promise<{
  replicaRef: HostedBrowserVaultReplicaRef;
  shards: BrowserVaultReplicaShardSelection;
}> {
  assertBrowserVaultReplicaAadMatchesRef({
    aad: input.session.replicaAad,
    ref: input.session.replicaRef,
  });
  const plaintext = await decryptHostedStoragePayload({
    aad: buildHostedStorageAad({
      dataKeyId: input.session.replicaAad.dataKeyId,
      dataKeyRootKeyId: input.session.replicaAad.dataKeyRootKeyId,
      dataVersion: input.session.replicaAad.dataVersion,
      objectKey: input.session.replicaAad.objectKey,
      purpose: input.session.replicaAad.purpose,
      runtimeRootKeyId: input.session.replicaAad.runtimeRootKeyId,
      schema: input.session.replicaAad.schema,
      sourceBundleHash: input.session.replicaAad.sourceBundleHash,
      userId: input.session.replicaAad.userId,
    }),
    envelope: input.session.encryptedReplica,
    expectedKeyId: getHostedBrowserVaultReplicaStorageKeyId(input.session.replicaRef),
    key: input.replicaKey,
    scope: "browser-vault-replica",
  });
  assertNotAborted(input.signal);
  if (
    input.session.replicaRef.byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES
    || plaintext.byteLength !== input.session.replicaRef.byteLength
  ) {
    throw new Error(
      "Browser vault legacy replica byte length did not match its bounded session ref.",
    );
  }
  const replica = parseBrowserVaultReplica(JSON.parse(textDecoder.decode(plaintext)));
  const replicaRef = normalizeBrowserVaultReplicaRefGeneration(
    input.session.replicaRef,
    replica.generation,
  );
  assertBrowserVaultReplicaIdentityMatchesRef({
    dataVersion: replica.source.dataVersion,
    generation: replica.generation,
    sourceBundleHash: replica.source.sourceBundleHash,
  }, replicaRef);
  const compatibilityReplica = (replica.generation ?? 0)
      < BROWSER_VAULT_REPLICA_CURRENT_GENERATION
    ? {
        ...replica,
        experimentRunCards: await buildBrowserVaultExperimentRunCards(
          createBrowserVaultQueryClient(replica),
        ),
      }
    : replica;
  const allShards = await splitBrowserVaultReplica(compatibilityReplica);
  return {
    replicaRef,
    shards: selectBrowserVaultReplicaDemand(
      allShards,
      input.requestedShards,
      input.requestedMetricBuckets,
    ),
  };
}

async function loadShardedBrowserVaultReplica(input: {
  knownReplicaRef: HostedBrowserVaultReplicaRef | null;
  knownReplicaShards: BrowserVaultReplicaShardSelection | null;
  replicaKey: Uint8Array;
  requestedMetricBuckets: readonly BrowserVaultMetricBucketId[];
  requestedShards: readonly BrowserVaultReplicaShard[];
  session: Extract<BrowserVaultSessionResponse, { state: "ready"; transport: "sharded" }>;
  signal?: AbortSignal;
}): Promise<{
  replicaRef: HostedBrowserVaultReplicaRef;
  shards: BrowserVaultReplicaShardSelection;
}> {
  assertBrowserVaultDemandByteBudget(
    input.session.replicaRef,
    input.requestedShards,
    input.requestedMetricBuckets,
  );
  const canReuseKnownShards = input.knownReplicaRef
    && input.knownReplicaShards
    && browserVaultReplicaRefsMatch(input.knownReplicaRef, input.session.replicaRef);
  const shards: Partial<BrowserVaultReplicaShardSelection> = canReuseKnownShards
    ? selectBrowserVaultReplicaDemand(
        input.knownReplicaShards!,
        input.requestedShards,
        input.requestedMetricBuckets,
      )
    : {};

  const encryptedShards = BROWSER_VAULT_REPLICA_SHARDS.flatMap((shard) => {
    const encrypted = input.session.shards[shard];
    return encrypted ? [{ encrypted, shard }] : [];
  });
  for (const { encrypted, shard } of encryptedShards) {
    if (!input.requestedShards.includes(shard)) {
      throw new Error(`Browser vault session returned an unrequested ${shard} shard.`);
    }
    assertBrowserVaultReplicaShardAadMatchesRef({
      aad: encrypted.shardAad,
      ref: input.session.replicaRef,
      shard,
    });
  }

  const encryptedMetricBuckets = HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS
    .flatMap((bucketId) => {
      const encrypted = input.session.metricBuckets[bucketId];
      return encrypted ? [{ bucketId, encrypted }] : [];
    });
  for (const { bucketId, encrypted } of encryptedMetricBuckets) {
    if (!input.requestedMetricBuckets.includes(bucketId)) {
      throw new Error(
        `Browser vault session returned an unrequested ${bucketId} metric bucket.`,
      );
    }
    assertBrowserVaultReplicaMetricBucketAadMatchesRef({
      aad: encrypted.metricBucketAad,
      bucketId,
      ref: input.session.replicaRef,
    });
  }

  type EncryptedPayload =
    | { encrypted: BrowserVaultEncryptedShard; kind: "shard"; shard: BrowserVaultReplicaShard }
    | {
        bucketId: BrowserVaultMetricBucketId;
        encrypted: BrowserVaultEncryptedMetricBucket;
        kind: "metricBucket";
      };
  const encryptedPayloads: EncryptedPayload[] = [
    ...encryptedShards.map(({ encrypted, shard }) => ({
      encrypted,
      kind: "shard" as const,
      shard,
    })),
    ...encryptedMetricBuckets.map(({ bucketId, encrypted }) => ({
      bucketId,
      encrypted,
      kind: "metricBucket" as const,
    })),
  ];
  const parsedPayloads = await mapBrowserVaultPayloadsBounded(
    encryptedPayloads,
    async (payload) => {
      if (payload.kind === "metricBucket") {
        const { bucketId, encrypted } = payload;
        const encoded = await decryptHostedStoragePayload({
          aad: buildHostedStorageAad({ ...encrypted.metricBucketAad }),
          envelope: encrypted.encryptedMetricBucket,
          expectedKeyId: getHostedBrowserVaultReplicaStorageKeyId(input.session.replicaRef),
          key: input.replicaKey,
          scope: "browser-vault-replica",
        });
        assertNotAborted(input.signal);
        const plaintext = await decodeBrowserVaultChild({
          byteLength: encrypted.metricBucketAad.byteLength,
          bytes: encoded,
          contentEncoding: encrypted.metricBucketAad.contentEncoding,
          encodedByteLength: encrypted.metricBucketAad.encodedByteLength,
          signal: input.signal,
        });
        const value: unknown = JSON.parse(textDecoder.decode(plaintext));
        return {
          bucketId,
          kind: "metricBucket" as const,
          value: await parseBrowserVaultMetricBucketShard(value, bucketId),
        };
      }

      const { encrypted, shard } = payload;
      const encoded = await decryptHostedStoragePayload({
        aad: buildHostedStorageAad({ ...encrypted.shardAad }),
        envelope: encrypted.encryptedShard,
        expectedKeyId: getHostedBrowserVaultReplicaStorageKeyId(input.session.replicaRef),
        key: input.replicaKey,
        scope: "browser-vault-replica",
      });
      assertNotAborted(input.signal);
      const plaintext = await decodeBrowserVaultChild({
        byteLength: encrypted.shardAad.byteLength,
        bytes: encoded,
        contentEncoding: encrypted.shardAad.contentEncoding,
        encodedByteLength: encrypted.shardAad.encodedByteLength,
        signal: input.signal,
      });
      assertNotAborted(input.signal);
      const value: unknown = JSON.parse(textDecoder.decode(plaintext));
      if (shard === "core") {
        return { shard, value: parseBrowserVaultCoreShard(value) };
      }
      if (shard === "metricsIndex") {
        return { shard, value: parseBrowserVaultMetricsShard(value) };
      }
      return { shard, value: parseBrowserVaultLabsShard(value) };
    },
  );
  for (const parsed of parsedPayloads) {
    if (parsed.kind === "metricBucket") {
      shards.metricBuckets = {
        ...shards.metricBuckets,
        [parsed.bucketId]: parsed.value,
      };
    } else if (parsed.shard === "core") {
      shards.core = parsed.value;
    } else if (parsed.shard === "metricsIndex") {
      shards.metrics = parsed.value;
    } else {
      shards.labs = parsed.value;
    }
  }

  if (!shards.core) {
    throw new Error("Browser vault shard session did not provide the required core shard.");
  }
  for (const shard of input.requestedShards) {
    const selectionKey = shard === "metricsIndex" ? "metrics" : shard;
    if (!shards[selectionKey]) {
      throw new Error(`Browser vault shard session did not provide the requested ${shard} shard.`);
    }
  }
  for (const bucketId of input.requestedMetricBuckets) {
    if (!shards.metricBuckets?.[bucketId]) {
      throw new Error(
        `Browser vault shard session did not provide requested metric bucket ${bucketId}.`,
      );
    }
  }
  const replicaRef = normalizeBrowserVaultReplicaRefGeneration(
    input.session.replicaRef,
    shards.core.identity.generation,
  );
  for (const shard of listLoadedBrowserVaultShards(shards as BrowserVaultReplicaShardSelection)) {
    const selectionKey = shard === "metricsIndex" ? "metrics" : shard;
    assertBrowserVaultReplicaIdentityMatchesRef(shards[selectionKey]!.identity, replicaRef);
  }
  for (const bucketId of listLoadedBrowserVaultMetricBuckets(
    shards as BrowserVaultReplicaShardSelection,
  )) {
    assertBrowserVaultReplicaIdentityMatchesRef(
      shards.metricBuckets![bucketId]!.identity,
      replicaRef,
    );
  }
  return {
    replicaRef,
    shards: shards as BrowserVaultReplicaShardSelection,
  };
}

function assertBrowserVaultDemandByteBudget(
  ref: HostedBrowserVaultReplicaRef,
  requestedShards: readonly BrowserVaultReplicaShard[],
  requestedMetricBuckets: readonly BrowserVaultMetricBucketId[],
): void {
  let decodedBytes = 0;
  let encodedBytes = 0;
  for (const shard of requestedShards) {
    const child = ref.shards?.[shard];
    if (!child) continue;
    decodedBytes += child.byteLength;
    encodedBytes += child.encodedByteLength;
  }
  for (const bucketId of requestedMetricBuckets) {
    const child = ref.metricBuckets?.buckets[bucketId];
    if (!child) continue;
    decodedBytes += child.byteLength;
    encodedBytes += child.encodedByteLength;
  }
  if (
    decodedBytes > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES
    || encodedBytes > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES
  ) {
    throw new Error("Browser vault route demand exceeded the aggregate byte limit.");
  }
}

async function mapBrowserVaultPayloadsBounded<T, Result>(
  values: readonly T[],
  mapValue: (value: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let nextIndex = 0;
  let failure: unknown;
  let hasFailure = false;
  const workerCount = Math.min(
    values.length,
    BROWSER_VAULT_INTERACTIVE_DECODE_CONCURRENCY,
  );
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!hasFailure && nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapValue(values[index]!, index);
      } catch (error) {
        hasFailure = true;
        failure = error;
      }
    }
  }));
  if (hasFailure) {
    throw failure;
  }
  return results;
}

export function createBrowserVaultRouteQueryClient(
  shards: BrowserVaultReplicaShardSelection,
  requestedShards: readonly BrowserVaultReplicaShard[],
  requestedMetricBuckets: readonly BrowserVaultMetricBucketId[] = [],
): BrowserVaultAnyQueryClient {
  const clients = createBrowserVaultLoadedQueryClients(shards);
  if (requestedShards.includes("metricsIndex") && requestedShards.includes("labs")) {
    if (!clients.interactive) {
      throw new Error("Browser vault session did not provide all requested shards.");
    }
    assertBrowserVaultClientCoversMetricBuckets(clients.interactive, requestedMetricBuckets);
    return clients.interactive;
  }
  if (requestedShards.includes("metricsIndex")) {
    if (!clients.interactiveMetrics) {
      throw new Error("Browser vault session did not provide the requested metrics index shard.");
    }
    assertBrowserVaultClientCoversMetricBuckets(
      clients.interactiveMetrics,
      requestedMetricBuckets,
    );
    return clients.interactiveMetrics;
  }
  if (requestedShards.includes("labs")) {
    if (!clients.labs) {
      throw new Error("Browser vault session did not provide the requested labs shard.");
    }
    return clients.labs;
  }
  return clients.core;
}

function listLoadedBrowserVaultShards(
  shards: BrowserVaultReplicaShardSelection,
): BrowserVaultReplicaShard[] {
  return BROWSER_VAULT_REPLICA_SHARDS.filter((shard) => {
    const selectionKey = shard === "metricsIndex" ? "metrics" : shard;
    return shards[selectionKey] !== undefined;
  });
}

function listLoadedBrowserVaultMetricBuckets(
  shards: BrowserVaultReplicaShardSelection,
): BrowserVaultMetricBucketId[] {
  return HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.filter(
    (bucketId) => shards.metricBuckets?.[bucketId] !== undefined,
  );
}

function assertBrowserVaultClientCoversMetricBuckets(
  client: BrowserVaultMetricSeriesCapableQueryClient,
  requestedMetricBuckets: readonly BrowserVaultMetricBucketId[],
): void {
  const loaded = "loadedMetricBuckets" in client
    ? client.loadedMetricBuckets
    : HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS;
  if (!requestedMetricBuckets.every((bucketId) => loaded.includes(bucketId))) {
    throw new Error("Browser vault session did not provide all requested metric buckets.");
  }
}

export function selectBrowserVaultReplicaDemand(
  shards: BrowserVaultReplicaShardSelection,
  requestedShards: readonly BrowserVaultReplicaShard[],
  requestedMetricBuckets: readonly BrowserVaultMetricBucketId[],
): BrowserVaultReplicaShardSelection {
  const selected: BrowserVaultReplicaShardSelection = { core: shards.core };
  if (requestedShards.includes("metricsIndex") && shards.metrics) {
    selected.metrics = shards.metrics;
  }
  if (requestedShards.includes("labs") && shards.labs) {
    selected.labs = shards.labs;
  }
  for (const bucketId of HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS) {
    const bucket = requestedMetricBuckets.includes(bucketId)
      ? shards.metricBuckets?.[bucketId]
      : undefined;
    if (bucket) {
      selected.metricBuckets = { ...selected.metricBuckets, [bucketId]: bucket };
    }
  }
  return selected;
}

function assertValidBrowserVaultMetricBucketDemand(
  bucketIds: readonly BrowserVaultMetricBucketId[],
): void {
  const allowed = new Set<string>(HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS);
  if (bucketIds.some((bucketId) => !allowed.has(bucketId))) {
    throw new TypeError("Browser vault metric bucket demand contains an unsupported bucket.");
  }
  if (new Set(bucketIds).size !== bucketIds.length) {
    throw new TypeError("Browser vault metric bucket demand must not contain duplicates.");
  }
  if (bucketIds.length >= HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT) {
    throw new TypeError("Interactive Browser Vault requests cannot load every metric bucket.");
  }
}

function normalizeBrowserVaultReplicaRefGeneration(
  ref: HostedBrowserVaultReplicaRef,
  generation: number | undefined,
): HostedBrowserVaultReplicaRef {
  return ref.generation === undefined && generation !== undefined
    ? { ...ref, generation }
    : ref;
}

function assertBrowserVaultReplicaIdentityMatchesRef(
  identity: {
    dataVersion: string;
    generatedAt?: string;
    generation?: number;
    sourceBundleHash: string;
  },
  ref: HostedBrowserVaultReplicaRef,
): void {
  if (identity.dataVersion !== ref.dataVersion) {
    throw new Error("Browser vault replica dataVersion did not match its session ref.");
  }
  if (identity.generation !== ref.generation) {
    throw new Error("Browser vault replica generation did not match its session ref.");
  }
  if (identity.generatedAt !== undefined && identity.generatedAt !== ref.generatedAt) {
    throw new Error("Browser vault replica generatedAt did not match its session ref.");
  }
  if (identity.sourceBundleHash !== ref.sourceBundleHash) {
    throw new Error("Browser vault replica sourceBundleHash did not match its session ref.");
  }
}

async function decodeBrowserVaultChild(input: {
  byteLength: number;
  bytes: Uint8Array;
  contentEncoding: "gzip" | "identity";
  encodedByteLength: number;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  if (input.bytes.byteLength !== input.encodedByteLength) {
    throw new Error("Browser vault shard encoded byte length did not match its AAD.");
  }
  if (
    input.byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES
    || input.encodedByteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES
  ) {
    throw new Error("Browser vault shard exceeded the supported byte limit.");
  }
  if (input.contentEncoding === "identity") {
    if (input.byteLength !== input.encodedByteLength) {
      throw new Error("Browser vault identity child lengths did not match.");
    }
    return Uint8Array.from(input.bytes);
  }
  if (typeof DecompressionStream !== "function") {
    throw new Error("Browser vault shard decompression is not supported by this browser.");
  }

  const encodedBuffer = Uint8Array.from(input.bytes).buffer;
  const stream = new Blob([encodedBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    if (input.signal?.aborted) {
      await reader.cancel();
      assertNotAborted(input.signal);
    }
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    byteLength += value.byteLength;
    if (byteLength > input.byteLength) {
      await reader.cancel();
      throw new Error("Browser vault shard decoded beyond its declared byte length.");
    }
    chunks.push(value);
  }
  if (byteLength !== input.byteLength) {
    throw new Error("Browser vault shard decoded byte length did not match its AAD.");
  }
  const decoded = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    decoded.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoded;
}

export function normalizeBrowserVaultError(error: unknown): string {
  if (isBrowserVaultAbortError(error)) {
    return "Your dashboard data is not available right now.";
  }

  const message = error instanceof Error ? error.message : "";

  if (/HTTP 401|HTTP 403/u.test(message)) {
    return "Your dashboard session expired. Refresh and try again.";
  }

  if (/HTTP 404/u.test(message)) {
    return "Your dashboard data is not available yet.";
  }

  return "Your dashboard data is not available right now.";
}

export function isBrowserVaultAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return Reflect.get(error, "name") === "AbortError";
}

export function isBrowserVaultUnauthorizedError(
  error: unknown,
): error is BrowserVaultUnauthorizedError {
  return error instanceof BrowserVaultUnauthorizedError;
}

export type BrowserVaultSessionResponse =
  | {
      encryptedReplica: null;
      deviceSyncImportPending: boolean;
      freshness: BrowserVaultFreshness;
      memberId: string;
      replicaAad: null;
      replicaKeyEnvelope: null;
      replicaRef: null;
      refreshPending: boolean;
      state: "empty";
      workspaceVersion: string | null;
    }
  | {
      encryptedReplica: null;
      deviceSyncImportPending: boolean;
      freshness: BrowserVaultFreshness;
      memberId: string;
      replicaAad: null;
      replicaKeyEnvelope: null;
      replicaRef: HostedBrowserVaultReplicaRef;
      refreshPending: boolean;
      state: "not_modified";
      workspaceVersion: string | null;
    }
  | {
      encryptedReplica: HostedCipherEnvelope;
      deviceSyncImportPending: boolean;
      freshness: BrowserVaultFreshness;
      replicaAad: BrowserVaultReplicaAad;
      replicaKeyEnvelope: HostedBrowserSessionKeyEnvelope;
      replicaRef: HostedBrowserVaultReplicaRef;
      refreshPending: boolean;
      state: "ready";
      transport: "legacy";
      workspaceVersion: string | null;
    }
  | {
      deviceSyncImportPending: boolean;
      freshness: BrowserVaultFreshness;
      metricBuckets: Partial<Record<
        BrowserVaultMetricBucketId,
        BrowserVaultEncryptedMetricBucket
      >>;
      replicaKeyEnvelope: HostedBrowserSessionKeyEnvelope;
      replicaRef: HostedBrowserVaultReplicaRef;
      refreshPending: boolean;
      shards: Partial<Record<BrowserVaultReplicaShard, BrowserVaultEncryptedShard>>;
      state: "ready";
      transport: "sharded";
      workspaceVersion: string | null;
    };

export interface BrowserVaultEncryptedShard {
  encryptedShard: HostedCipherEnvelope;
  shardAad: BrowserVaultReplicaShardAad;
}

export interface BrowserVaultEncryptedMetricBucket {
  encryptedMetricBucket: HostedCipherEnvelope;
  metricBucketAad: BrowserVaultReplicaMetricBucketAad;
}

export function parseBrowserVaultSessionResponse(value: unknown): BrowserVaultSessionResponse {
  const record = requireRecord(value, "Browser vault session response");
  const state = requireNonEmptyString(record.state, "Browser vault session response state");

  if (state === "empty") {
    assertBrowserVaultSessionPayloadFieldsNull(record, "Browser vault session response");
    requireNull(record.replicaRef, "Browser vault session response.replicaRef");

    return {
      encryptedReplica: null,
      deviceSyncImportPending: readOptionalBoolean(
        record.deviceSyncImportPending,
        false,
        "deviceSyncImportPending",
      ),
      freshness: parseBrowserVaultFreshness(record.freshness, "stale"),
      memberId: requireNonEmptyString(
        record.memberId,
        "Browser vault session response.memberId",
      ),
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      refreshPending: readOptionalBoolean(record.refreshPending, false, "refreshPending"),
      state,
      workspaceVersion: readOptionalNullableString(record.workspaceVersion, "Browser vault session response.workspaceVersion"),
    };
  }

  if (state === "not_modified") {
    assertBrowserVaultSessionPayloadFieldsNull(record, "Browser vault session response");

    return {
      encryptedReplica: null,
      deviceSyncImportPending: readOptionalBoolean(
        record.deviceSyncImportPending,
        false,
        "deviceSyncImportPending",
      ),
      freshness: parseBrowserVaultFreshness(record.freshness, "fresh"),
      memberId: requireNonEmptyString(
        record.memberId,
        "Browser vault session response.memberId",
      ),
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: parseRequiredReplicaRef(record.replicaRef, "Browser vault session response replicaRef"),
      refreshPending: readOptionalBoolean(record.refreshPending, false, "refreshPending"),
      state,
      workspaceVersion: readOptionalNullableString(record.workspaceVersion, "Browser vault session response.workspaceVersion"),
    };
  }

  if (state !== "ready") {
    throw new TypeError("Browser vault session response state must be empty, not_modified, or ready.");
  }

  const shared = {
    deviceSyncImportPending: readOptionalBoolean(
      record.deviceSyncImportPending,
      false,
      "deviceSyncImportPending",
    ),
    freshness: parseBrowserVaultFreshness(record.freshness, "fresh"),
    replicaKeyEnvelope: parseHostedBrowserSessionKeyEnvelope(
      record.replicaKeyEnvelope,
      "Browser vault session response replicaKeyEnvelope",
    ),
    replicaRef: parseRequiredReplicaRef(record.replicaRef, "Browser vault session response replicaRef"),
    refreshPending: readOptionalBoolean(record.refreshPending, false, "refreshPending"),
    state: "ready" as const,
    workspaceVersion: readOptionalNullableString(record.workspaceVersion, "Browser vault session response.workspaceVersion"),
  };

  if (record.shards !== undefined || record.metricBuckets !== undefined) {
    if (record.encryptedReplica !== undefined && record.encryptedReplica !== null) {
      throw new TypeError(
        "Browser vault sharded session response.encryptedReplica must be null or omitted.",
      );
    }
    if (record.replicaAad !== undefined && record.replicaAad !== null) {
      throw new TypeError(
        "Browser vault sharded session response.replicaAad must be null or omitted.",
      );
    }
    return {
      ...shared,
      metricBuckets: record.metricBuckets === undefined
        ? {}
        : parseBrowserVaultEncryptedMetricBuckets(record.metricBuckets),
      shards: record.shards === undefined
        ? {}
        : parseBrowserVaultEncryptedShards(record.shards),
      transport: "sharded",
    };
  }

  return {
    ...shared,
    encryptedReplica: parseHostedCipherEnvelope(
      record.encryptedReplica,
      "Browser vault session response encryptedReplica",
    ),
    replicaAad: parseBrowserVaultReplicaAad(
      record.replicaAad,
      "Browser vault session response replicaAad",
    ),
    transport: "legacy",
  };
}

export interface BrowserVaultReplicaAad {
  dataKeyId?: string;
  dataKeyRootKeyId?: string;
  dataVersion: string;
  generatedAt?: string;
  generation?: number;
  objectKey: string;
  purpose: "browser-vault-replica";
  runtimeRootKeyId: string;
  schema: "murph.browser-vault-replica";
  sourceBundleHash: string;
  userId: string;
}

export interface BrowserVaultReplicaShardAad extends BrowserVaultReplicaAad {
  byteLength: number;
  contentEncoding: "gzip" | "identity";
  encodedByteLength: number;
  generatedAt: string;
  shard: BrowserVaultReplicaShard;
  shardSchema: string;
  shardSetRefSchema: typeof HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA;
}

export interface BrowserVaultReplicaMetricBucketAad extends BrowserVaultReplicaAad {
  byteLength: number;
  contentEncoding: "gzip" | "identity";
  encodedByteLength: number;
  generatedAt: string;
  metricBucketCount: typeof HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT;
  metricBucketId: BrowserVaultMetricBucketId;
  metricBucketSchema: typeof BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA;
  metricBucketSetRefSchema:
    typeof HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA;
}

function assertBrowserVaultReplicaAadMatchesRef(input: {
  aad: BrowserVaultReplicaAad;
  ref: HostedBrowserVaultReplicaRef;
}): void {
  if (input.aad.dataVersion !== input.ref.dataVersion) {
    throw new Error("Browser vault replica AAD dataVersion did not match its session ref.");
  }

  if (input.aad.objectKey !== input.ref.objectKey) {
    throw new Error("Browser vault replica AAD objectKey did not match its session ref.");
  }

  if (input.aad.sourceBundleHash !== input.ref.sourceBundleHash) {
    throw new Error("Browser vault replica AAD sourceBundleHash did not match its session ref.");
  }

  if (!input.ref.runtimeRootKeyId) {
    throw new Error("Browser vault replica ref is missing runtimeRootKeyId.");
  }

  if (input.aad.runtimeRootKeyId !== input.ref.runtimeRootKeyId) {
    throw new Error("Browser vault replica AAD runtimeRootKeyId did not match its session ref.");
  }

  const dataKeyEnvelope = input.ref.dataKeyEnvelope;
  if (!dataKeyEnvelope) {
    return;
  }

  if (input.aad.dataKeyId !== dataKeyEnvelope.dataKeyId) {
    throw new Error("Browser vault replica AAD dataKeyId did not match its session ref.");
  }

  if (input.aad.dataKeyRootKeyId !== dataKeyEnvelope.rootKeyId) {
    throw new Error("Browser vault replica AAD dataKeyRootKeyId did not match its session ref.");
  }
}

function assertBrowserVaultReplicaShardAadMatchesRef(input: {
  aad: BrowserVaultReplicaShardAad;
  ref: HostedBrowserVaultReplicaRef;
  shard: BrowserVaultReplicaShard;
}): void {
  const shardRef = input.ref.shards?.[input.shard];
  if (!shardRef) {
    throw new Error(`Browser vault replica ref is missing shards.${input.shard}.`);
  }
  assertBrowserVaultReplicaAadMatchesRef({
    aad: input.aad,
    ref: { ...input.ref, objectKey: shardRef.objectKey },
  });
  if (
    input.aad.byteLength !== shardRef.byteLength
    || input.aad.contentEncoding !== shardRef.contentEncoding
    || input.aad.encodedByteLength !== shardRef.encodedByteLength
    || input.aad.generatedAt !== input.ref.generatedAt
    || input.aad.generation !== input.ref.generation
    || input.aad.shard !== input.shard
    || input.aad.shardSchema !== getBrowserVaultShardSchema(input.shard)
    || input.aad.shardSetRefSchema !== HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA
  ) {
    throw new Error(`Browser vault ${input.shard} shard AAD did not match its session ref.`);
  }
}

function assertBrowserVaultReplicaMetricBucketAadMatchesRef(input: {
  aad: BrowserVaultReplicaMetricBucketAad;
  bucketId: BrowserVaultMetricBucketId;
  ref: HostedBrowserVaultReplicaRef;
}): void {
  const bucketRef = input.ref.metricBuckets?.buckets[input.bucketId];
  if (!bucketRef) {
    throw new Error(
      `Browser vault replica ref is missing metricBuckets.buckets.${input.bucketId}.`,
    );
  }
  assertBrowserVaultReplicaAadMatchesRef({
    aad: input.aad,
    ref: { ...input.ref, objectKey: bucketRef.objectKey },
  });
  if (
    input.aad.byteLength !== bucketRef.byteLength
    || input.aad.contentEncoding !== bucketRef.contentEncoding
    || input.aad.encodedByteLength !== bucketRef.encodedByteLength
    || input.aad.generatedAt !== input.ref.generatedAt
    || input.aad.generation !== input.ref.generation
    || input.aad.metricBucketCount !== HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT
    || input.aad.metricBucketId !== input.bucketId
    || input.aad.metricBucketSchema !== BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA
    || input.aad.metricBucketSetRefSchema
      !== HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA
  ) {
    throw new Error(
      `Browser vault ${input.bucketId} metric bucket AAD did not match its session ref.`,
    );
  }
}

function getReadySessionMemberId(
  session: Extract<BrowserVaultSessionResponse, { state: "ready" }>,
): string {
  if (session.transport === "legacy") {
    if (session.replicaAad.userId !== session.replicaKeyEnvelope.userId) {
      throw new Error("Browser vault session envelope identity did not match its payload.");
    }
    return session.replicaAad.userId;
  }
  const memberIds = new Set(
    [
      ...Object.values(session.shards).map((entry) => entry.shardAad.userId),
      ...Object.values(session.metricBuckets).map(
        (entry) => entry.metricBucketAad.userId,
      ),
    ],
  );
  if (memberIds.size !== 1) {
    throw new Error("Browser vault session shards did not share one member identity.");
  }
  const memberId = [...memberIds][0]!;
  if (memberId !== session.replicaKeyEnvelope.userId) {
    throw new Error("Browser vault session envelope identity did not match its payload.");
  }
  return memberId;
}

function parseBrowserVaultReplicaAad(value: unknown, label: string): BrowserVaultReplicaAad {
  const record = requireRecord(value, label);
  const purpose = requireNonEmptyString(record.purpose, `${label}.purpose`);
  const schema = requireNonEmptyString(record.schema, `${label}.schema`);

  if (purpose !== "browser-vault-replica") {
    throw new TypeError(`${label}.purpose must be browser-vault-replica.`);
  }
  if (schema !== "murph.browser-vault-replica") {
    throw new TypeError(`${label}.schema must be murph.browser-vault-replica.`);
  }

  return {
    ...(record.dataKeyId === undefined
      ? {}
      : { dataKeyId: requireNonEmptyString(record.dataKeyId, `${label}.dataKeyId`) }),
    ...(record.dataKeyRootKeyId === undefined
      ? {}
      : {
          dataKeyRootKeyId: requireNonEmptyString(
            record.dataKeyRootKeyId,
            `${label}.dataKeyRootKeyId`,
          ),
        }),
    dataVersion: requireNonEmptyString(record.dataVersion, `${label}.dataVersion`),
    ...(record.generatedAt === undefined
      ? {}
      : { generatedAt: requireNonEmptyString(record.generatedAt, `${label}.generatedAt`) }),
    ...(record.generation === undefined
      ? {}
      : { generation: requireNonNegativeSafeInteger(record.generation, `${label}.generation`) }),
    objectKey: requireNonEmptyString(record.objectKey, `${label}.objectKey`),
    purpose,
    runtimeRootKeyId: requireNonEmptyString(record.runtimeRootKeyId, `${label}.runtimeRootKeyId`),
    schema,
    sourceBundleHash: requireNonEmptyString(record.sourceBundleHash, `${label}.sourceBundleHash`),
    userId: requireNonEmptyString(record.userId, `${label}.userId`),
  };
}

function parseBrowserVaultEncryptedShards(
  value: unknown,
): Partial<Record<BrowserVaultReplicaShard, BrowserVaultEncryptedShard>> {
  const record = requireRecord(value, "Browser vault session response.shards");
  const supportedShards = new Set<string>(BROWSER_VAULT_REPLICA_SHARDS);
  if (Object.keys(record).some((shard) => !supportedShards.has(shard))) {
    throw new TypeError(
      "Browser vault session response.shards contains an unsupported shard.",
    );
  }

  const parsed: Partial<
    Record<BrowserVaultReplicaShard, BrowserVaultEncryptedShard>
  > = {};
  for (const shard of BROWSER_VAULT_REPLICA_SHARDS) {
    if (record[shard] === undefined) {
      continue;
    }
    const entry = requireRecord(
      record[shard],
      `Browser vault session response.shards.${shard}`,
    );
    const shardAad = parseBrowserVaultReplicaShardAad(
      entry.shardAad,
      `Browser vault session response.shards.${shard}.shardAad`,
    );
    if (shardAad.shard !== shard) {
      throw new TypeError(
        `Browser vault session response.shards.${shard}.shardAad.shard must be ${shard}.`,
      );
    }
    parsed[shard] = {
      encryptedShard: parseHostedCipherEnvelope(
        entry.encryptedShard,
        `Browser vault session response.shards.${shard}.encryptedShard`,
      ),
      shardAad,
    };
  }

  return parsed;
}

function parseBrowserVaultEncryptedMetricBuckets(
  value: unknown,
): Partial<Record<BrowserVaultMetricBucketId, BrowserVaultEncryptedMetricBucket>> {
  const record = requireRecord(value, "Browser vault session response.metricBuckets");
  const supported = new Set<string>(HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS);
  if (Object.keys(record).some((bucketId) => !supported.has(bucketId))) {
    throw new TypeError(
      "Browser vault session response.metricBuckets contains an unsupported bucket.",
    );
  }
  const parsed: Partial<Record<
    BrowserVaultMetricBucketId,
    BrowserVaultEncryptedMetricBucket
  >> = {};
  for (const bucketId of HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS) {
    if (record[bucketId] === undefined) continue;
    const label = `Browser vault session response.metricBuckets.${bucketId}`;
    const entry = requireRecord(record[bucketId], label);
    const metricBucketAad = parseBrowserVaultReplicaMetricBucketAad(
      entry.metricBucketAad,
      `${label}.metricBucketAad`,
    );
    if (metricBucketAad.metricBucketId !== bucketId) {
      throw new TypeError(`${label}.metricBucketAad.metricBucketId must be ${bucketId}.`);
    }
    parsed[bucketId] = {
      encryptedMetricBucket: parseHostedCipherEnvelope(
        entry.encryptedMetricBucket,
        `${label}.encryptedMetricBucket`,
      ),
      metricBucketAad,
    };
  }
  return parsed;
}

function parseBrowserVaultReplicaShardAad(
  value: unknown,
  label: string,
): BrowserVaultReplicaShardAad {
  const record = requireRecord(value, label);
  const base = parseBrowserVaultReplicaAad(record, label);
  const shard = parseBrowserVaultReplicaShard(record.shard, `${label}.shard`);
  const contentEncoding = requireNonEmptyString(
    record.contentEncoding,
    `${label}.contentEncoding`,
  );
  if (contentEncoding !== "gzip" && contentEncoding !== "identity") {
    throw new TypeError(`${label}.contentEncoding must be gzip or identity.`);
  }
  const shardSchema = requireNonEmptyString(
    record.shardSchema,
    `${label}.shardSchema`,
  );
  const expectedShardSchema = getBrowserVaultShardSchema(shard);
  if (shardSchema !== expectedShardSchema) {
    throw new TypeError(`${label}.shardSchema must be ${expectedShardSchema}.`);
  }
  return {
    ...base,
    byteLength: requirePositiveSafeInteger(record.byteLength, `${label}.byteLength`),
    contentEncoding,
    encodedByteLength: requirePositiveSafeInteger(
      record.encodedByteLength,
      `${label}.encodedByteLength`,
    ),
    generatedAt: requireNonEmptyString(record.generatedAt, `${label}.generatedAt`),
    shard,
    shardSchema,
    shardSetRefSchema: requireExactString(
      record.shardSetRefSchema,
      HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
      `${label}.shardSetRefSchema`,
    ),
  };
}

function parseBrowserVaultReplicaMetricBucketAad(
  value: unknown,
  label: string,
): BrowserVaultReplicaMetricBucketAad {
  const record = requireRecord(value, label);
  const base = parseBrowserVaultReplicaAad(record, label);
  const metricBucketId = parseBrowserVaultMetricBucketId(
    record.metricBucketId,
    `${label}.metricBucketId`,
  );
  const contentEncoding = requireNonEmptyString(
    record.contentEncoding,
    `${label}.contentEncoding`,
  );
  if (contentEncoding !== "gzip" && contentEncoding !== "identity") {
    throw new TypeError(`${label}.contentEncoding must be gzip or identity.`);
  }
  if (record.metricBucketCount !== HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT) {
    throw new TypeError(
      `${label}.metricBucketCount must be ${HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT}.`,
    );
  }
  return {
    ...base,
    byteLength: requirePositiveSafeInteger(record.byteLength, `${label}.byteLength`),
    contentEncoding,
    encodedByteLength: requirePositiveSafeInteger(
      record.encodedByteLength,
      `${label}.encodedByteLength`,
    ),
    generatedAt: requireNonEmptyString(record.generatedAt, `${label}.generatedAt`),
    metricBucketCount: HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT,
    metricBucketId,
    metricBucketSchema: requireExactString(
      record.metricBucketSchema,
      BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA,
      `${label}.metricBucketSchema`,
    ),
    metricBucketSetRefSchema: requireExactString(
      record.metricBucketSetRefSchema,
      HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
      `${label}.metricBucketSetRefSchema`,
    ),
  };
}

function parseRequiredReplicaRef(value: unknown, label: string): HostedBrowserVaultReplicaRef {
  const ref = parseHostedBrowserVaultReplicaRef(value, label);

  if (!ref) {
    throw new TypeError(`${label} must not be null.`);
  }

  return ref;
}

async function readJsonErrorMessage(response: Response): Promise<string> {
  try {
    const value = await response.json();
    const record = requireRecord(value, "Browser vault error response");
    const message = record.error;
    const nestedMessage = message && typeof message === "object" && !Array.isArray(message)
      ? (message as Record<string, unknown>).message
      : null;

    return typeof message === "string" && message.trim().length > 0
      ? message
      : typeof nestedMessage === "string" && nestedMessage.trim().length > 0
        ? nestedMessage
      : `Browser vault session failed with HTTP ${response.status}.`;
  } catch {
    return `Browser vault session failed with HTTP ${response.status}.`;
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("Browser vault load was aborted.");
  error.name = "AbortError";
  throw error;
}

function assertBrowserVaultSessionPayloadFieldsNull(
  record: Record<string, unknown>,
  label: string,
): void {
  requireNull(record.encryptedReplica, `${label}.encryptedReplica`);
  requireNull(record.replicaAad, `${label}.replicaAad`);
  requireNull(record.replicaKeyEnvelope, `${label}.replicaKeyEnvelope`);
}

function requireNull(value: unknown, label: string): null {
  if (value !== null) {
    throw new TypeError(`${label} must be null.`);
  }

  return null;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function requireExactString<const Expected extends string>(
  value: unknown,
  expected: Expected,
  label: string,
): Expected {
  if (value !== expected) {
    throw new TypeError(`${label} must be ${expected}.`);
  }
  return expected;
}

function parseBrowserVaultMetricBucketId(
  value: unknown,
  label: string,
): BrowserVaultMetricBucketId {
  if (!HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.includes(
    value as BrowserVaultMetricBucketId,
  )) {
    throw new TypeError(`${label} must be a metric bucket id from 00 through 1f.`);
  }
  return value as BrowserVaultMetricBucketId;
}

function parseBrowserVaultReplicaShard(
  value: unknown,
  label: string,
): BrowserVaultReplicaShard {
  if (!BROWSER_VAULT_REPLICA_SHARDS.includes(value as BrowserVaultReplicaShard)) {
    throw new TypeError(`${label} must be core, labs, or metricsIndex.`);
  }
  return value as BrowserVaultReplicaShard;
}

function getBrowserVaultShardSchema(shard: BrowserVaultReplicaShard): string {
  if (shard === "core") return BROWSER_VAULT_CORE_SHARD_SCHEMA;
  if (shard === "metricsIndex") return BROWSER_VAULT_METRICS_SHARD_SCHEMA;
  return BROWSER_VAULT_LABS_SHARD_SCHEMA;
}

function createEmptyLoadResult(): Extract<BrowserVaultSessionLoadResult, { state: "empty" }> {
  return {
    deviceSyncImportPending: false,
    freshness: "stale",
    memberId: null,
    refreshPending: false,
    state: "empty",
    workspaceVersion: null,
  };
}

function parseBrowserVaultFreshness(
  value: unknown,
  fallback: BrowserVaultFreshness,
): BrowserVaultFreshness {
  if (value === undefined) {
    return fallback;
  }

  if (value === "fresh" || value === "stale") {
    return value;
  }

  throw new TypeError("Browser vault session response freshness must be fresh or stale.");
}

function readOptionalBoolean(value: unknown, fallback: boolean, fieldName: string): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new TypeError(`Browser vault session response ${fieldName} must be a boolean.`);
  }

  return value;
}

function readOptionalNullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireNonEmptyString(value, label);
}
