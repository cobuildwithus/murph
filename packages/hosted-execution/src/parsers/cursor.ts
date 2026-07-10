import {
  parseHostedDataKeyEnvelope,
  parseHostedExecutionBundleRef as parseRuntimeHostedExecutionBundleRef,
} from "@murphai/runtime-state";

import {
  HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA,
  type HostedBrowserVaultReplicaCursorRef,
  type HostedBrowserVaultReplicaRef,
} from "../contracts.ts";
import {
  HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
  type HostedExecutionBundlePayload,
  type HostedExecutionBundleRefState,
  type HostedExecutionLayeredSnapshotRef,
  type HostedExecutionSnapshotRefState,
  type HostedExecutionWorkingSnapshotRef,
} from "../bundles.ts";
import {
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  type HostedWorkspaceSnapshotV2Ref,
} from "../workspace-snapshot-v2.ts";
import {
  requireObject,
  requireNumber,
  requireString,
  readNullableStringValue,
} from "./assertions.ts";
import {
  parseHostedWorkspaceSnapshotV2Ref,
} from "./workspace-snapshot-v2.ts";

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
): HostedExecutionSnapshotRefState {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireObject(value, label);
  const schema = record.schema;
  if (schema === HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA) {
    requireHostedExecutionLayeredSnapshotField(record, "base", label);
    requireHostedExecutionLayeredSnapshotField(record, "hot", label);
    return {
      base: parseRuntimeHostedExecutionBundleRef(record.base, `${label}.base`),
      hot: parseRuntimeHostedExecutionBundleRef(record.hot, `${label}.hot`),
      schema,
    } satisfies HostedExecutionLayeredSnapshotRef;
  }

  if (schema === HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA) {
    requireHostedExecutionWorkingSnapshotField(record, "base", label);
    requireHostedExecutionWorkingSnapshotField(record, "delta", label);
    return {
      base: parseRequiredHostedExecutionBundleRef(record.base, `${label}.base`),
      delta: parseRequiredHostedExecutionBundleRef(record.delta, `${label}.delta`),
      schema,
    } satisfies HostedExecutionWorkingSnapshotRef;
  }

  if (schema === HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA) {
    return parseHostedWorkspaceSnapshotV2Ref(record, label);
  }

  return parseHostedExecutionBundleRef(value, label);
}

export function isHostedExecutionLayeredSnapshotRef(
  value: HostedExecutionSnapshotRefState,
): value is HostedExecutionLayeredSnapshotRef {
  return value !== null
    && "schema" in value
    && value.schema === HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA;
}

export function isHostedExecutionWorkingSnapshotRef(
  value: HostedExecutionSnapshotRefState,
): value is HostedExecutionWorkingSnapshotRef {
  return value !== null
    && "schema" in value
    && value.schema === HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA;
}

export function isHostedWorkspaceSnapshotV2Ref(
  value: HostedExecutionSnapshotRefState,
): value is HostedWorkspaceSnapshotV2Ref {
  return value !== null
    && "schema" in value
    && value.schema === HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA;
}

export function readHostedExecutionSnapshotBaseRef(
  value: HostedExecutionSnapshotRefState,
): HostedExecutionBundleRefState {
  if (!value) {
    return null;
  }

  if (isHostedExecutionLayeredSnapshotRef(value) || isHostedExecutionWorkingSnapshotRef(value)) {
    return value.base;
  }

  if (isHostedWorkspaceSnapshotV2Ref(value)) {
    return null;
  }

  return value;
}

export function readHostedExecutionSnapshotHotRef(
  value: HostedExecutionSnapshotRefState,
): HostedExecutionBundleRefState {
  return isHostedExecutionLayeredSnapshotRef(value) ? value.hot : null;
}

export function readHostedExecutionSnapshotDeltaRef(
  value: HostedExecutionSnapshotRefState,
): HostedExecutionBundleRefState {
  return isHostedExecutionWorkingSnapshotRef(value) ? value.delta : null;
}

export function buildHostedExecutionLayeredSnapshotRef(input: {
  base: HostedExecutionBundleRefState;
  hot: HostedExecutionBundleRefState;
}): HostedExecutionLayeredSnapshotRef {
  return {
    base: input.base,
    hot: input.hot,
    schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  };
}

export function buildHostedExecutionWorkingSnapshotRef(input: {
  base: NonNullable<HostedExecutionBundleRefState>;
  delta: NonNullable<HostedExecutionBundleRefState>;
}): HostedExecutionWorkingSnapshotRef {
  return {
    base: input.base,
    delta: input.delta,
    schema: HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
  };
}

function requireHostedExecutionLayeredSnapshotField(
  record: Record<string, unknown>,
  field: "base" | "hot",
  label: string,
): void {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    throw new TypeError(`${label}.${field} is required for layered snapshot refs.`);
  }
}

function requireHostedExecutionWorkingSnapshotField(
  record: Record<string, unknown>,
  field: "base" | "delta",
  label: string,
): void {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    throw new TypeError(`${label}.${field} is required for working snapshot refs.`);
  }
}

function parseRequiredHostedExecutionBundleRef(
  value: unknown,
  label: string,
): NonNullable<HostedExecutionBundleRefState> {
  const parsed = parseRuntimeHostedExecutionBundleRef(value, label);
  if (!parsed) {
    throw new TypeError(`${label} must be a hosted execution bundle ref.`);
  }
  return parsed;
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
  if (replicaSchema !== "murph.browser-vault-replica") {
    throw new TypeError(`${label}.replicaSchema must be murph.browser-vault-replica.`);
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
    generatedAt: requireIsoTimestampString(record.generatedAt, `${label}.generatedAt`),
    keyId: requireString(record.keyId, `${label}.keyId`),
    objectKey: requireString(record.objectKey, `${label}.objectKey`),
    replicaSchema,
    schema,
    runtimeRootKeyId: requireString(record.runtimeRootKeyId, `${label}.runtimeRootKeyId`),
    sourceBundleHash: requireString(record.sourceBundleHash, `${label}.sourceBundleHash`),
  } satisfies HostedBrowserVaultReplicaRef;
}

function requireIsoTimestampString(value: unknown, label: string): string {
  const text = requireString(value, label);
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== text) {
    throw new TypeError(`${label} must be a valid ISO-8601 timestamp in canonical UTC form.`);
  }

  return text;
}
