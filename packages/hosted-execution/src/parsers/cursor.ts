import { parseHostedExecutionBundleRef as parseRuntimeHostedExecutionBundleRef } from "@murphai/runtime-state";

import {
  HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA,
  type HostedBrowserVaultReplicaCursorRef,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionCursorState,
} from "../contracts.ts";
import type {
  HostedExecutionBundlePayload,
  HostedExecutionBundleRefState,
} from "../bundles.ts";
import {
  requireBigIntString,
  requireObject,
  requireNumber,
  requireString,
  readNullableString,
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

export function parseHostedExecutionCursorSnapshotRef(
  value: unknown,
  label = "Hosted execution cursor snapshotRef",
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

  return {
    byteLength: requireNumber(record.byteLength, `${label}.byteLength`),
    dataVersion: requireString(record.dataVersion, `${label}.dataVersion`),
    generatedAt: requireString(record.generatedAt, `${label}.generatedAt`),
    keyId: requireString(record.keyId, `${label}.keyId`),
    objectKey: requireString(record.objectKey, `${label}.objectKey`),
    replicaSchema,
    schema,
    sourceBundleHash: requireString(record.sourceBundleHash, `${label}.sourceBundleHash`),
  } satisfies HostedBrowserVaultReplicaRef;
}

export function parseHostedExecutionCursorState(
  value: unknown,
): HostedExecutionCursorState {
  const record = requireObject(value, "Hosted execution cursor state");

  return {
    committedSeq: requireBigIntString(
      record.committedSeq,
      "Hosted execution cursor state committedSeq",
    ),
    createdAt: requireString(record.createdAt, "Hosted execution cursor state createdAt"),
    nextSeq: requireBigIntString(record.nextSeq, "Hosted execution cursor state nextSeq"),
    ...(record.nextRuntimeWakeAt === undefined
      ? {}
      : {
          nextRuntimeWakeAt: readNullableString(
            record.nextRuntimeWakeAt,
            "Hosted execution cursor state nextRuntimeWakeAt",
          ),
        }),
    ...(record.nextRuntimeWakeReason === undefined
      ? {}
      : {
          nextRuntimeWakeReason: readNullableString(
            record.nextRuntimeWakeReason,
            "Hosted execution cursor state nextRuntimeWakeReason",
          ),
        }),
    ...(record.browserVaultReplicaRef === undefined
      ? {}
      : {
          browserVaultReplicaRef: parseHostedBrowserVaultReplicaRef(
            record.browserVaultReplicaRef,
            "Hosted execution cursor state browserVaultReplicaRef",
          ),
        }),
    snapshotRef: parseHostedExecutionCursorSnapshotRef(
      record.snapshotRef,
      "Hosted execution cursor state snapshotRef",
    ),
    updatedAt: requireString(record.updatedAt, "Hosted execution cursor state updatedAt"),
    userId: requireString(record.userId, "Hosted execution cursor state userId"),
    version: requireBigIntString(record.version, "Hosted execution cursor state version"),
  };
}
