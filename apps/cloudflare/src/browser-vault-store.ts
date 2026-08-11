import { BROWSER_VAULT_REPLICA_SCHEMA } from "@murphai/contracts/browser-vault";
import {
  buildHostedStorageAad as buildRuntimeHostedStorageAad,
  createHostedDataKeyEnvelopeWithDomainRoot,
  deriveHostedStorageKey,
  parseHostedCipherEnvelope,
  unwrapHostedDataKeyWithDomainRoot,
  type HostedCipherEnvelope,
} from "@murphai/runtime-state";
import {
  HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";

import { writeEncryptedR2Payload, type EncryptedR2BucketLike } from "./crypto.js";
import {
  hostedBrowserVaultReplicaObjectKey,
  hostedBrowserVaultReplicaUserPrefix,
} from "./storage-paths.js";
import {
  encodeHostedBrowserVaultReplicaJson,
} from "./browser-vault-limits.ts";

const utf8Decoder = new TextDecoder();

type HostedBrowserVaultReplicaBucketLike = EncryptedR2BucketLike & {
  delete?(key: string): Promise<void>;
};

export const HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA =
  "murph.hosted-browser-vault-replica-orphan-candidate.v1";

export interface HostedBrowserVaultReplicaOrphanCandidate {
  createdAt: string;
  objectKey: string;
  schema: typeof HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA;
  userId: string;
}

export interface BrowserVaultReplicaAadFields {
  dataKeyId?: string;
  dataKeyRootKeyId?: string;
  dataVersion: string;
  objectKey: string;
  purpose: "browser-vault-replica";
  runtimeRootKeyId: string;
  schema: typeof BROWSER_VAULT_REPLICA_SCHEMA;
  sourceBundleHash: string;
  userId: string;
}

export interface HostedBrowserVaultReplicaStore {
  deleteBrowserVaultReplica(ref: HostedBrowserVaultReplicaRef | null): Promise<void>;
  deriveBrowserVaultReplicaKey(ref: HostedBrowserVaultReplicaRef): Promise<Uint8Array>;
  readBrowserVaultReplicaEnvelope(ref: HostedBrowserVaultReplicaRef): Promise<HostedCipherEnvelope | null>;
  writeBrowserVaultReplica(input: {
    beforeWrite?(ref: HostedBrowserVaultReplicaRef): Promise<void>;
    replica: unknown;
    userId: string;
  }): Promise<HostedBrowserVaultReplicaRef>;
}

export class HostedBrowserVaultReplicaOwnershipError extends Error {
  constructor(message = "Hosted browser vault replica is outside the bound user replica namespace.") {
    super(message);
    this.name = "HostedBrowserVaultReplicaOwnershipError";
  }
}

export class HostedBrowserVaultReplicaRootKeyUnavailableError extends Error {
  readonly runtimeRootKeyId: string | null;

  constructor(runtimeRootKeyId: string | null = null) {
    super("Hosted browser vault replica runtime root key is unavailable.");
    this.name = "HostedBrowserVaultReplicaRootKeyUnavailableError";
    this.runtimeRootKeyId = runtimeRootKeyId;
  }
}

export function createBrowserVaultReplicaAadFields(input: {
  ref: HostedBrowserVaultReplicaRef;
  userId: string;
}): BrowserVaultReplicaAadFields {
  assertHostedBrowserVaultReplicaDataKeyEnvelopeMatchesRef({
    ref: input.ref,
    userId: input.userId,
  });
  return {
    ...(input.ref.dataKeyEnvelope
      ? {
          dataKeyId: input.ref.dataKeyEnvelope.dataKeyId,
          dataKeyRootKeyId: input.ref.dataKeyEnvelope.rootKeyId,
        }
      : {}),
    dataVersion: input.ref.dataVersion,
    objectKey: input.ref.objectKey,
    purpose: "browser-vault-replica",
    runtimeRootKeyId: requireBrowserVaultReplicaRuntimeRootKeyId(input.ref),
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    sourceBundleHash: input.ref.sourceBundleHash,
    userId: input.userId,
  };
}

export function createHostedBrowserVaultReplicaStore(input: {
  bucket: HostedBrowserVaultReplicaBucketLike;
  rootKey: Uint8Array;
  rootKeyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  resolveRootKeyById?: (rootKeyId: string) => Promise<Uint8Array | null>;
  userId?: string | null;
}): HostedBrowserVaultReplicaStore {
  return {
    async deleteBrowserVaultReplica(ref) {
      if (!ref || !input.bucket.delete) {
        return;
      }

      await assertHostedBrowserVaultReplicaOwnedByUser(input, ref);

      await input.bucket.delete(ref.objectKey);
    },

    async deriveBrowserVaultReplicaKey(ref) {
      return deriveBrowserVaultReplicaKey(input, ref);
    },

    async readBrowserVaultReplicaEnvelope(ref) {
      await assertHostedBrowserVaultReplicaOwnedByUser(input, ref);

      const object = await input.bucket.get(ref.objectKey);

      if (!object) {
        return null;
      }

      const envelopeValue: unknown = JSON.parse(utf8Decoder.decode(await object.arrayBuffer()));
      return parseHostedCipherEnvelope(
        envelopeValue,
        "Hosted browser vault replica envelope",
      );
    },

    async writeBrowserVaultReplica({ beforeWrite, replica, userId }) {
      const parsed = parseBrowserVaultReplicaStorageInput(replica);

      const encodedReplica = encodeHostedBrowserVaultReplicaJson({ replica });
      const objectKey = await hostedBrowserVaultReplicaObjectKey({
        dataVersion: parsed.source.dataVersion,
        generatedAt: parsed.generatedAt,
        userId,
      });
      const ref: HostedBrowserVaultReplicaRef = {
        byteLength: encodedReplica.byteLength,
        dataVersion: parsed.source.dataVersion,
        generatedAt: parsed.generatedAt,
        ...(parsed.generation === undefined ? {} : { generation: parsed.generation }),
        keyId: createBrowserVaultReplicaKeyId(parsed.source.dataVersion),
        objectKey,
        replicaSchema: BROWSER_VAULT_REPLICA_SCHEMA,
        runtimeRootKeyId: requireBrowserVaultReplicaRootKeyId(input.rootKeyId),
        schema: HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA,
        sourceBundleHash: parsed.source.sourceBundleHash,
      };
      const { dataKey, envelope: dataKeyEnvelope } =
        await createHostedDataKeyEnvelopeWithDomainRoot({
          domain: "runtime",
          lane: "browser-vault-replica",
          resource: {
            objectKey,
            purpose: "browser-vault-replica",
            userId,
          },
          rootKey: input.rootKey,
          rootKeyId: ref.runtimeRootKeyId,
        });
      const persistedRef: HostedBrowserVaultReplicaRef = {
        ...ref,
        dataKeyEnvelope,
      };

      const aadFields = createBrowserVaultReplicaAadFields({ ref: persistedRef, userId });

      await beforeWrite?.(persistedRef);

      await writeEncryptedR2Payload({
        aad: buildRuntimeHostedStorageAad({
          dataKeyId: aadFields.dataKeyId,
          dataKeyRootKeyId: aadFields.dataKeyRootKeyId,
          dataVersion: aadFields.dataVersion,
          objectKey: aadFields.objectKey,
          purpose: aadFields.purpose,
          runtimeRootKeyId: aadFields.runtimeRootKeyId,
          schema: aadFields.schema,
          sourceBundleHash: aadFields.sourceBundleHash,
          userId: aadFields.userId,
        }),
        bucket: input.bucket,
        cryptoKey: dataKey,
        key: objectKey,
        keyId: dataKeyEnvelope.dataKeyId,
        plaintext: encodedReplica.bytes,
        scope: "browser-vault-replica",
      });

      return persistedRef;
    },
  };
}

export function parseHostedBrowserVaultReplicaOrphanCandidate(
  value: unknown,
  label = "Hosted browser vault replica orphan candidate",
): HostedBrowserVaultReplicaOrphanCandidate {
  const record = requireRecord(value, label);
  if (record.schema !== HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA) {
    throw new TypeError(`${label} schema is invalid.`);
  }
  return {
    createdAt: requireIsoTimestampString(record.createdAt, `${label} createdAt`),
    objectKey: requireString(record.objectKey, `${label} objectKey`),
    schema: HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA,
    userId: requireString(record.userId, `${label} userId`),
  };
}

async function assertHostedBrowserVaultReplicaOwnedByUser(
  input: {
    userId?: string | null;
  },
  ref: HostedBrowserVaultReplicaRef,
): Promise<void> {
  if (!input.userId) {
    throw new HostedBrowserVaultReplicaOwnershipError(
      "Hosted browser vault replica store requires a bound user for replica object access.",
    );
  }

  const expectedPrefix = await hostedBrowserVaultReplicaUserPrefix({
    userId: input.userId,
  });
  if (!ref.objectKey.startsWith(expectedPrefix)) {
    throw new HostedBrowserVaultReplicaOwnershipError();
  }
}

async function resolveBrowserVaultReplicaRootKey(
  input: {
    rootKey: Uint8Array;
    rootKeyId: string;
    keysById?: Readonly<Record<string, Uint8Array>>;
    resolveRootKeyById?: (rootKeyId: string) => Promise<Uint8Array | null>;
  },
  ref: HostedBrowserVaultReplicaRef,
): Promise<Uint8Array> {
  return resolveBrowserVaultReplicaRootKeyById(
    input,
    requireBrowserVaultReplicaRuntimeRootKeyId(ref),
  );
}

async function resolveBrowserVaultReplicaRootKeyById(
  input: {
    rootKey: Uint8Array;
    rootKeyId: string;
    keysById?: Readonly<Record<string, Uint8Array>>;
    resolveRootKeyById?: (rootKeyId: string) => Promise<Uint8Array | null>;
  },
  rootKeyId: string,
): Promise<Uint8Array> {
  const normalizedRootKeyId = requireBrowserVaultReplicaRootKeyId(rootKeyId);
  if (normalizedRootKeyId === requireBrowserVaultReplicaRootKeyId(input.rootKeyId)) {
    return input.rootKey;
  }

  const keyFromKeyring = input.keysById?.[normalizedRootKeyId];
  if (keyFromKeyring) {
    return keyFromKeyring;
  }

  const resolvedKey = await input.resolveRootKeyById?.(normalizedRootKeyId) ?? null;
  if (resolvedKey) {
    return resolvedKey;
  }

  throw new HostedBrowserVaultReplicaRootKeyUnavailableError(normalizedRootKeyId);
}

async function deriveBrowserVaultReplicaKey(
  input: {
    rootKey: Uint8Array;
    rootKeyId: string;
    keysById?: Readonly<Record<string, Uint8Array>>;
    resolveRootKeyById?: (rootKeyId: string) => Promise<Uint8Array | null>;
    userId?: string | null;
  },
  ref: HostedBrowserVaultReplicaRef,
): Promise<Uint8Array> {
  if (ref.dataKeyEnvelope) {
    assertHostedBrowserVaultReplicaDataKeyEnvelopeMatchesRef({
      ref,
      userId: input.userId ?? undefined,
    });
    const rootKey = await resolveBrowserVaultReplicaRootKeyById(
      input,
      ref.dataKeyEnvelope.rootKeyId,
    );
    return unwrapHostedDataKeyWithDomainRoot({
      envelope: ref.dataKeyEnvelope,
      rootKey,
      rootKeyId: ref.dataKeyEnvelope.rootKeyId,
    });
  }

  const runtimeRootKeyId = requireBrowserVaultReplicaRuntimeRootKeyId(ref);
  const rootKey = await resolveBrowserVaultReplicaRootKey(input, ref);
  return deriveHostedStorageKey(
    rootKey,
    `id:browser-vault-replica:${runtimeRootKeyId}:${ref.sourceBundleHash}:${ref.dataVersion}`,
  );
}

function assertHostedBrowserVaultReplicaDataKeyEnvelopeMatchesRef(input: {
  ref: HostedBrowserVaultReplicaRef;
  userId?: string;
}): void {
  const envelope = input.ref.dataKeyEnvelope;
  if (!envelope) {
    return;
  }

  if (envelope.domain !== "runtime") {
    throw new TypeError("Hosted browser vault replica dataKeyEnvelope.domain must be runtime.");
  }
  if (envelope.lane !== "browser-vault-replica") {
    throw new TypeError("Hosted browser vault replica dataKeyEnvelope.lane must be browser-vault-replica.");
  }
  if (envelope.rootKeyId !== requireBrowserVaultReplicaRuntimeRootKeyId(input.ref)) {
    throw new TypeError("Hosted browser vault replica dataKeyEnvelope.rootKeyId must match runtimeRootKeyId.");
  }
  if (envelope.resource.objectKey !== input.ref.objectKey) {
    throw new TypeError("Hosted browser vault replica dataKeyEnvelope.resource.objectKey must match objectKey.");
  }
  if (envelope.resource.purpose !== "browser-vault-replica") {
    throw new TypeError("Hosted browser vault replica dataKeyEnvelope.resource.purpose must be browser-vault-replica.");
  }
  if (input.userId && envelope.resource.userId !== input.userId) {
    throw new TypeError("Hosted browser vault replica dataKeyEnvelope.resource.userId must match userId.");
  }
}

function requireBrowserVaultReplicaRootKeyId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("Hosted browser vault replica rootKeyId must be a non-empty string.");
  }
  return normalized;
}

function requireBrowserVaultReplicaRuntimeRootKeyId(ref: HostedBrowserVaultReplicaRef): string {
  const runtimeRootKeyId = ref.runtimeRootKeyId?.trim() ?? "";
  if (!runtimeRootKeyId) {
    throw new HostedBrowserVaultReplicaRootKeyUnavailableError(null);
  }
  return runtimeRootKeyId;
}

function createBrowserVaultReplicaKeyId(dataVersion: string): string {
  return `browser-vault-replica:${dataVersion.slice(0, 32)}`;
}

function parseBrowserVaultReplicaStorageInput(value: unknown): {
  generatedAt: string;
  generation?: number;
  source: {
    dataVersion: string;
    sourceBundleHash: string;
  };
} {
  const record = requireRecord(value, "Browser vault replica");
  const schema = requireString(record.schema, "Browser vault replica schema");

  if (schema !== BROWSER_VAULT_REPLICA_SCHEMA) {
    throw new TypeError(`Browser vault replica schema must be ${BROWSER_VAULT_REPLICA_SCHEMA}.`);
  }

  const source = requireRecord(record.source, "Browser vault replica source");

  return {
    generatedAt: requireIsoTimestampString(record.generatedAt, "Browser vault replica generatedAt"),
    ...(record.generation === undefined
      ? {}
      : { generation: requirePositiveSafeInteger(record.generation, "Browser vault replica generation") }),
    source: {
      dataVersion: requireString(source.dataVersion, "Browser vault replica dataVersion"),
      sourceBundleHash: requireString(source.sourceBundleHash, "Browser vault replica sourceBundleHash"),
    },
  };
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireIsoTimestampString(value: unknown, label: string): string {
  const text = requireString(value, label);
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== text) {
    throw new TypeError(`${label} must be a valid ISO-8601 timestamp.`);
  }

  return text;
}
