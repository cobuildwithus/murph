import {
  buildHostedStorageAad as buildRuntimeHostedStorageAad,
  deriveHostedStorageKey,
  parseHostedCipherEnvelope,
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

const BROWSER_VAULT_REPLICA_SCHEMA = "murph.browser-vault-replica.v1";
const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

type HostedBrowserVaultReplicaBucketLike = EncryptedR2BucketLike & {
  delete?(key: string): Promise<void>;
};

export interface BrowserVaultReplicaAadFields {
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
  writeBrowserVaultReplica(input: { replica: unknown; userId: string }): Promise<HostedBrowserVaultReplicaRef>;
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
  return {
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
      return deriveBrowserVaultReplicaKey(await resolveBrowserVaultReplicaRootKey(input, ref), ref);
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

    async writeBrowserVaultReplica({ replica, userId }) {
      const parsed = parseBrowserVaultReplicaStorageInput(replica);
      const objectKey = await hostedBrowserVaultReplicaObjectKey({
        dataVersion: parsed.source.dataVersion,
        userId,
      });
      const ref: HostedBrowserVaultReplicaRef = {
        byteLength: utf8Encoder.encode(JSON.stringify(replica)).byteLength,
        dataVersion: parsed.source.dataVersion,
        generatedAt: parsed.generatedAt,
        keyId: createBrowserVaultReplicaKeyId(parsed.source.dataVersion),
        objectKey,
        replicaSchema: BROWSER_VAULT_REPLICA_SCHEMA,
        runtimeRootKeyId: requireBrowserVaultReplicaRootKeyId(input.rootKeyId),
        schema: HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA,
        sourceBundleHash: parsed.source.sourceBundleHash,
      };
      const replicaKey = await deriveBrowserVaultReplicaKey(input.rootKey, ref);

      const aadFields = createBrowserVaultReplicaAadFields({ ref, userId });

      await writeEncryptedR2Payload({
        aad: buildRuntimeHostedStorageAad({
          dataVersion: aadFields.dataVersion,
          objectKey: aadFields.objectKey,
          purpose: aadFields.purpose,
          runtimeRootKeyId: aadFields.runtimeRootKeyId,
          schema: aadFields.schema,
          sourceBundleHash: aadFields.sourceBundleHash,
          userId: aadFields.userId,
        }),
        bucket: input.bucket,
        cryptoKey: replicaKey,
        key: objectKey,
        keyId: ref.keyId,
        plaintext: utf8Encoder.encode(JSON.stringify(replica)),
        scope: "browser-vault-replica",
      });

      return ref;
    },
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
  const runtimeRootKeyId = requireBrowserVaultReplicaRuntimeRootKeyId(ref);
  if (runtimeRootKeyId === requireBrowserVaultReplicaRootKeyId(input.rootKeyId)) {
    return input.rootKey;
  }

  const keyFromKeyring = input.keysById?.[runtimeRootKeyId];
  if (keyFromKeyring) {
    return keyFromKeyring;
  }

  const resolvedKey = await input.resolveRootKeyById?.(runtimeRootKeyId) ?? null;
  if (resolvedKey) {
    return resolvedKey;
  }

  throw new HostedBrowserVaultReplicaRootKeyUnavailableError(runtimeRootKeyId);
}

async function deriveBrowserVaultReplicaKey(
  rootKey: Uint8Array,
  ref: HostedBrowserVaultReplicaRef,
): Promise<Uint8Array> {
  const runtimeRootKeyId = requireBrowserVaultReplicaRuntimeRootKeyId(ref);
  return deriveHostedStorageKey(
    rootKey,
    `id:browser-vault-replica:${runtimeRootKeyId}:${ref.sourceBundleHash}:${ref.dataVersion}`,
  );
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
    generatedAt: requireString(record.generatedAt, "Browser vault replica generatedAt"),
    source: {
      dataVersion: requireString(source.dataVersion, "Browser vault replica dataVersion"),
      sourceBundleHash: requireString(source.sourceBundleHash, "Browser vault replica sourceBundleHash"),
    },
  };
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
