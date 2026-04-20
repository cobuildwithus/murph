import { parseHostedExecutionBundleRef as parseRuntimeHostedExecutionBundleRef } from "@murphai/runtime-state";

import type { HostedExecutionCursorState } from "../contracts.ts";
import type {
  HostedExecutionBundlePayload,
  HostedExecutionBundleRefState,
} from "../bundles.ts";
import {
  requireBigIntString,
  requireObject,
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
    snapshotRef: parseHostedExecutionCursorSnapshotRef(
      record.snapshotRef,
      "Hosted execution cursor state snapshotRef",
    ),
    updatedAt: requireString(record.updatedAt, "Hosted execution cursor state updatedAt"),
    userId: requireString(record.userId, "Hosted execution cursor state userId"),
    version: requireBigIntString(record.version, "Hosted execution cursor state version"),
  };
}
