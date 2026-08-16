import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedUserRecipientPublicKeyJwk,
  wrapHostedBrowserSessionKey,
  type HostedCipherEnvelope,
} from "@murphai/runtime-state";
import type {
  HostedBrowserVaultReplicaMetricBucketId,
  HostedBrowserVaultReplicaRef,
  HostedBrowserVaultReplicaShardKind,
} from "@murphai/hosted-execution/contracts";
import {
  getHostedBrowserVaultReplicaStorageKeyId,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import {
  CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";

import {
  createBrowserVaultReplicaAadFields,
  createBrowserVaultReplicaMetricBucketAadFields,
  createBrowserVaultReplicaShardAadFields,
  createHostedBrowserVaultReplicaStore,
  HostedBrowserVaultReplicaOwnershipError,
  HostedBrowserVaultReplicaRootKeyUnavailableError,
} from "../../browser-vault-store.ts";
import {
  json,
} from "../../json.ts";
import {
  readCachedRequestText,
  resolveHostedExecutionUserCryptoContext,
  type WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import {
  requireBoundInternalRouteUser,
} from "../auth.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";
import {
  buildWorkerRouteLogDetails,
} from "../route-utils/log-details.ts";
import {
  parseJsonValue,
  requireJsonRecord,
} from "../route-utils/json-body.ts";
import {
  decodeRouteParam,
} from "../route-utils/route-params.ts";

const BROWSER_VAULT_SESSION_R2_READ_CONCURRENCY = 4;

export const browserVaultRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "browser-vault-session");
    },
    async handle(context, params) {
      return handleBrowserVaultSessionRoute(context, params.userId);
    },
    match: (pathname) => matchCloudflareHostedControlUserRoutePath("browserVaultSession", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.browserVaultSession.method],
    name: "browser-vault-session",
    wrongMethodResponse: "method-not-allowed",
  },
];

export async function handleBrowserVaultSessionRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let body;
  try {
    body = parseBrowserVaultSessionRequest(parseJsonValue(await readCachedRequestText(context)));
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "browser-vault-session-request-invalid",
        routeName: "browser-vault-session",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker browser-vault session route rejected an invalid request body.",
      phase: "failed",
      userId,
    });
    throw error;
  }
  const crypto = await resolveHostedExecutionUserCryptoContext({
    bucket: context.env.BUNDLES,
    domain: "runtime",
    environment: context.environment,
    userId,
  });
  const replicaStore = createHostedBrowserVaultReplicaStore({
    bucket: context.env.BUNDLES,
    rootKey: crypto.rootKey,
    rootKeyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    resolveRootKeyById: crypto.resolveKeyById,
    userId,
  });
  const selectedCapabilityRequested = body.sessionPurpose === "export"
    || body.requestedMetricBuckets !== undefined
    || body.requestedShards !== undefined;
  const selectedPayloadAvailable = body.replicaRef.shards !== undefined
    && body.replicaRef.metricBuckets !== undefined;
  const selectedShards = body.sessionPurpose === "export"
    ? HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS
    : body.requestedShards ?? [];
  const selectedMetricBuckets = body.sessionPurpose === "export"
    ? HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS
    : body.requestedMetricBuckets ?? [];
  const selectedJobs: BrowserVaultSelectedReadJob[] = selectedCapabilityRequested
    && selectedPayloadAvailable
    ? [
        ...selectedShards.map((shard) => ({ kind: "shard" as const, shard })),
        ...selectedMetricBuckets.map((bucketId) => ({
          bucketId,
          kind: "metricBucket" as const,
        })),
      ]
    : [];
  const useSelectedPayload = selectedJobs.length > 0;
  let replicaEnvelopes: BrowserVaultSelectedReadResult[];
  try {
    replicaEnvelopes = useSelectedPayload
      ? await mapBrowserVaultReadsWithBoundedConcurrency(
          selectedJobs,
          BROWSER_VAULT_SESSION_R2_READ_CONCURRENCY,
          async (job): Promise<BrowserVaultSelectedReadResult> => job.kind === "shard"
            ? {
                ...job,
                envelope: await replicaStore.readBrowserVaultReplicaShardEnvelope(
                  body.replicaRef,
                  job.shard,
                ),
              }
            : {
                ...job,
                envelope: await replicaStore.readBrowserVaultReplicaMetricBucketEnvelope(
                  body.replicaRef,
                  job.bucketId,
                ),
              },
        )
      : [{
          envelope: await replicaStore.readBrowserVaultReplicaEnvelope(body.replicaRef),
          kind: "legacy",
        }];
  } catch (error) {
    if (error instanceof HostedBrowserVaultReplicaOwnershipError || error instanceof HostedBrowserVaultReplicaRootKeyUnavailableError) {
      replicaEnvelopes = [];
    } else {
      throw error;
    }
  }

  const replicaStorageKeyId = getHostedBrowserVaultReplicaStorageKeyId(body.replicaRef);
  if (
    replicaEnvelopes.length === 0
    || replicaEnvelopes.some(({ envelope }) =>
      !envelope
      || envelope.keyId !== replicaStorageKeyId
      || envelope.scope !== "browser-vault-replica")
  ) {
    return json({
      code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
      error: "Browser vault replica was not found.",
    }, 404);
  }

  let replicaKey;
  try {
    replicaKey = await replicaStore.deriveBrowserVaultReplicaKey(body.replicaRef);
  } catch (error) {
    if (error instanceof HostedBrowserVaultReplicaRootKeyUnavailableError) {
      return json({
        code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
        error: "Browser vault replica was not found.",
      }, 404);
    }

    throw error;
  }
  const replicaKeyEnvelope = await wrapHostedBrowserSessionKey({
    keyBytes: replicaKey,
    keyId: replicaStorageKeyId,
    publicKeyJwk: body.browserPublicKeyJwk,
    purpose: "browser-vault-replica",
    userId,
  });

  if (useSelectedPayload) {
    const shardEnvelopes = replicaEnvelopes.filter(
      (entry): entry is BrowserVaultSelectedShardReadResult => entry.kind === "shard",
    );
    const metricBucketEnvelopes = replicaEnvelopes.filter(
      (entry): entry is BrowserVaultSelectedMetricBucketReadResult =>
        entry.kind === "metricBucket",
    );
    return json({
      ...(metricBucketEnvelopes.length === 0
        ? {}
        : {
            metricBuckets: Object.fromEntries(metricBucketEnvelopes.map(({
              bucketId,
              envelope,
            }) => {
              if (!envelope) {
                throw new TypeError(
                  "Hosted browser vault metric bucket session state is invalid.",
                );
              }
              return [bucketId, {
                encryptedMetricBucket: envelope,
                metricBucketAad: createBrowserVaultReplicaMetricBucketAadFields({
                  bucketId,
                  ref: body.replicaRef,
                  userId,
                }),
              }];
            })),
          }),
      replicaKeyEnvelope,
      replicaRef: body.replicaRef,
      ...(shardEnvelopes.length === 0
        ? {}
        : {
            shards: Object.fromEntries(shardEnvelopes.map(({ envelope, shard }) => {
              if (!envelope) {
                throw new TypeError("Hosted browser vault shard session state is invalid.");
              }
              return [shard, {
                encryptedShard: envelope,
                shardAad: createBrowserVaultReplicaShardAadFields({
                  ref: body.replicaRef,
                  shard,
                  userId,
                }),
              }];
            })),
          }),
      state: "ready",
    });
  }

  const replicaEnvelope = replicaEnvelopes[0]?.envelope;
  if (!replicaEnvelope) {
    throw new TypeError("Hosted browser vault legacy session state is invalid.");
  }
  return json({
    encryptedReplica: replicaEnvelope,
    replicaAad: createBrowserVaultReplicaAadFields({
      ref: body.replicaRef,
      userId,
    }),
    replicaKeyEnvelope,
    replicaRef: body.replicaRef,
    state: "ready",
  });
}

export function parseBrowserVaultSessionRequest(value: unknown): {
  browserPublicKeyJwk: ReturnType<typeof parseHostedUserRecipientPublicKeyJwk>;
  replicaRef: HostedBrowserVaultReplicaRef;
  requestedMetricBuckets?: HostedBrowserVaultReplicaMetricBucketId[];
  requestedShards?: HostedBrowserVaultReplicaShardKind[];
  sessionPurpose?: "export";
} {
  const record = requireJsonRecord(value, "Browser vault session request");

  const replicaRef = parseHostedBrowserVaultReplicaRef(
    record.replicaRef,
    "Browser vault session request replicaRef",
  );

  if (!replicaRef) {
    throw new TypeError("Browser vault session request replicaRef must not be null.");
  }

  const requestedShards = record.requestedShards === undefined
    ? undefined
    : parseBrowserVaultRequestedShards(record.requestedShards);
  const requestedMetricBuckets = record.requestedMetricBuckets === undefined
    ? undefined
    : parseBrowserVaultRequestedMetricBuckets(record.requestedMetricBuckets);
  const sessionPurpose = record.sessionPurpose === undefined
    ? undefined
    : parseBrowserVaultSessionPurpose(record.sessionPurpose);
  if (
    sessionPurpose === "export"
    && (requestedMetricBuckets !== undefined || requestedShards !== undefined)
  ) {
    throw new TypeError(
      "Browser vault export session request must not include interactive selections.",
    );
  }

  return {
    browserPublicKeyJwk: parseHostedUserRecipientPublicKeyJwk(
      record.browserPublicKeyJwk,
      "Browser vault session request browserPublicKeyJwk",
    ),
    replicaRef,
    ...(requestedMetricBuckets === undefined ? {} : { requestedMetricBuckets }),
    ...(requestedShards === undefined ? {} : { requestedShards }),
    ...(sessionPurpose === undefined ? {} : { sessionPurpose }),
  };
}

function parseBrowserVaultRequestedMetricBuckets(
  value: unknown,
): HostedBrowserVaultReplicaMetricBucketId[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(
      "Browser vault session request requestedMetricBuckets must be a non-empty array.",
    );
  }
  const allowed = new Set<unknown>(HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS);
  const requestedMetricBuckets = value.map((bucketId, index) => {
    if (!allowed.has(bucketId)) {
      throw new TypeError(
        `Browser vault session request requestedMetricBuckets[${index}] must be a metric bucket id from 00 through 1f.`,
      );
    }
    return bucketId as HostedBrowserVaultReplicaMetricBucketId;
  });
  if (new Set(requestedMetricBuckets).size !== requestedMetricBuckets.length) {
    throw new TypeError(
      "Browser vault session request requestedMetricBuckets must not contain duplicates.",
    );
  }
  if (requestedMetricBuckets.length === HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT) {
    throw new TypeError(
      `Browser vault session request requestedMetricBuckets must not request all ${HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT} buckets from the interactive session route.`,
    );
  }
  return requestedMetricBuckets;
}

function parseBrowserVaultSessionPurpose(value: unknown): "export" {
  if (value !== "export") {
    throw new TypeError("Browser vault session request sessionPurpose must be export.");
  }
  return value;
}

function parseBrowserVaultRequestedShards(
  value: unknown,
): HostedBrowserVaultReplicaShardKind[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("Browser vault session request requestedShards must be a non-empty array.");
  }
  const allowed = new Set<unknown>(HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS);
  const requestedShards = value.map((shard, index) => {
    if (!allowed.has(shard)) {
      throw new TypeError(
        `Browser vault session request requestedShards[${index}] must be core, labs, or metricsIndex.`,
      );
    }
    return shard as HostedBrowserVaultReplicaShardKind;
  });
  if (new Set(requestedShards).size !== requestedShards.length) {
    throw new TypeError("Browser vault session request requestedShards must not contain duplicates.");
  }
  return requestedShards;
}

type BrowserVaultSelectedReadJob =
  | {
      kind: "shard";
      shard: HostedBrowserVaultReplicaShardKind;
    }
  | {
      bucketId: HostedBrowserVaultReplicaMetricBucketId;
      kind: "metricBucket";
    };

interface BrowserVaultSelectedShardReadResult {
  envelope: HostedCipherEnvelope | null;
  kind: "shard";
  shard: HostedBrowserVaultReplicaShardKind;
}

interface BrowserVaultSelectedMetricBucketReadResult {
  bucketId: HostedBrowserVaultReplicaMetricBucketId;
  envelope: HostedCipherEnvelope | null;
  kind: "metricBucket";
}

interface BrowserVaultLegacyReadResult {
  envelope: HostedCipherEnvelope | null;
  kind: "legacy";
}

type BrowserVaultSelectedReadResult =
  | BrowserVaultSelectedShardReadResult
  | BrowserVaultSelectedMetricBucketReadResult
  | BrowserVaultLegacyReadResult;

async function mapBrowserVaultReadsWithBoundedConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  concurrency: number,
  read: (input: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const outputs = new Array<TOutput>(inputs.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = inputs[index];
      if (input === undefined) {
        throw new TypeError("Hosted browser vault selected read input is missing.");
      }
      outputs[index] = await read(input);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, inputs.length) },
      () => worker(),
    ),
  );
  return outputs;
}
