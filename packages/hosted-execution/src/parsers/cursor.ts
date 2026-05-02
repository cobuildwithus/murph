import {
  parseHostedDataKeyEnvelope,
  parseHostedExecutionBundleRef as parseRuntimeHostedExecutionBundleRef,
} from "@murphai/runtime-state";

import {
  HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA,
  type HostedBrowserVaultReplicaCursorRef,
  type HostedBrowserVaultReplicaRef,
} from "../contracts.ts";
import type {
  HostedExecutionBundlePayload,
  HostedExecutionBundleRefState,
} from "../bundles.ts";
import {
  requireObject,
  requireNumber,
  requireString,
  readNullableStringValue,
} from "./assertions.ts";

export function parseHostedExecutionBundlePayload(
  value: unknown,
  label = "Hosted execution bundle",
): HostedExecutionBundlePayload {
  return readNullableStringValue(value, label);
}

export function parseHostedExecutionBundleRef(
  value: unknown,
  label = "Hosted execution bundle ref",
): HostedExecutionBundleRefState {
  return parseRuntimeHostedExecutionBundleRef(value, label);
}

export function parseHostedExecutionSnapshotRef(
  value: unknown,
  label = "Hosted execution snapshot ref",
): HostedExecutionBundleRefState {
  return parseHostedExecutionBundleRef(value === undefined ? null : value, label);
}


export function parseHostedBrowserVaultReplicaRef(
  value: unknown,
  label = "Hosted browser vault replica ref",
): HostedBrowserVaultReplicaCursorRef {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireObject(value, label);
  const schema = requireString(record.schema, `${label}.schema`);
  const replicaSchema = requireString(record.replicaSchema, `${label}.replicaSchema`);

  if (schema !== HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA}.`);
  }
  if (replicaSchema !== "murph.browser-vault-replica.v1") {
    throw new TypeError(`${label}.replicaSchema must be murph.browser-vault-replica.v1.`);
  }
  const dataKeyEnvelope = record.dataKeyEnvelope === undefined
    ? undefined
    : parseHostedDataKeyEnvelope(
        record.dataKeyEnvelope,
        `${label}.dataKeyEnvelope`,
      );

  return {
    byteLength: requireNumber(record.byteLength, `${label}.byteLength`),
    ...(dataKeyEnvelope === undefined ? {} : { dataKeyEnvelope }),
    dataVersion: requireString(record.dataVersion, `${label}.dataVersion`),
    generatedAt: requireString(record.generatedAt, `${label}.generatedAt`),
    keyId: requireString(record.keyId, `${label}.keyId`),
    objectKey: requireString(record.objectKey, `${label}.objectKey`),
    replicaSchema,
    schema,
    runtimeRootKeyId: requireString(record.runtimeRootKeyId, `${label}.runtimeRootKeyId`),
    sourceBundleHash: requireString(record.sourceBundleHash, `${label}.sourceBundleHash`),
  } satisfies HostedBrowserVaultReplicaRef;
}
