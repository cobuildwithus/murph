import { deviceSyncError } from "./errors.ts";
import { resolveConfiguredDeviceSyncProviderManifest } from "./config/provider-manifests.ts";

import type { DeviceSyncJobInput, DeviceSyncJobRecord } from "./types.ts";
import type {
  DeviceSyncJobPayloadFieldKind,
  DeviceSyncProviderJobDefinition,
} from "./config/provider-manifests.ts";

export function getConfiguredDeviceSyncProviderJobDefinition(
  provider: string,
  kind: string,
): DeviceSyncProviderJobDefinition | undefined {
  return resolveConfiguredDeviceSyncProviderManifest(provider)?.jobs[kind];
}

export function normalizeConfiguredDeviceSyncJobInput(
  provider: string,
  job: DeviceSyncJobInput,
  context: string,
): DeviceSyncJobInput {
  return {
    ...job,
    payload: normalizeConfiguredDeviceSyncJobPayload(provider, job.kind, job.payload, context),
  };
}

export function normalizeConfiguredDeviceSyncJobRecord(
  provider: string,
  job: DeviceSyncJobRecord,
  context: string,
): DeviceSyncJobRecord {
  return {
    ...job,
    payload: normalizeConfiguredDeviceSyncJobPayload(provider, job.kind, job.payload, context),
  };
}

export function shapeConfiguredDeviceSyncHostedHintPayload(
  provider: string,
  job: Pick<DeviceSyncJobInput, "kind" | "payload">,
): Record<string, unknown> {
  const definition = getConfiguredDeviceSyncProviderJobDefinition(provider, job.kind);

  if (!definition) {
    return {};
  }

  return pickConfiguredDeviceSyncHostedHintPayload(
    normalizeJobPayloadRecord(job.payload, `${provider} ${job.kind} hosted hint payload`),
    definition,
  );
}

function normalizeConfiguredDeviceSyncJobPayload(
  provider: string,
  kind: string,
  payload: Record<string, unknown> | undefined,
  context: string,
): Record<string, unknown> {
  const normalizedPayload = normalizeJobPayloadRecord(payload, `${provider} ${kind} ${context} payload`);
  const manifest = resolveConfiguredDeviceSyncProviderManifest(provider);

  if (!manifest) {
    return normalizedPayload;
  }

  const definition = manifest.jobs[kind];

  if (!definition) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
      message: `Device sync provider ${provider} job kind ${kind} is not declared in the provider manifest.`,
      retryable: false,
    });
  }

  const output: Record<string, unknown> = {};

  for (const key of Object.keys(normalizedPayload)) {
    if (!Object.prototype.hasOwnProperty.call(definition.payload, key)) {
      throw deviceSyncError({
        code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
        message: `Device sync provider ${provider} job ${kind} ${context} payload field ${key} is not declared in the provider manifest.`,
        retryable: false,
      });
    }
  }

  for (const [field, spec] of Object.entries(definition.payload)) {
    const value = normalizedPayload[field];

    if (value === undefined) {
      if (spec.required) {
        throw deviceSyncError({
          code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
          message: `Device sync provider ${provider} job ${kind} ${context} payload field ${field} is required.`,
          retryable: false,
        });
      }

      continue;
    }

    if (!matchesConfiguredDeviceSyncJobFieldKind(value, spec.kind)) {
      throw deviceSyncError({
        code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
        message:
          `Device sync provider ${provider} job ${kind} ${context} payload field ${field} must be ${describeConfiguredDeviceSyncJobFieldKind(spec.kind)}.`,
        retryable: false,
      });
    }

    output[field] = spec.kind === "string[]" && Array.isArray(value) ? [...value] : value;
  }

  return output;
}

function normalizeJobPayloadRecord(
  payload: Record<string, unknown> | undefined,
  context: string,
): Record<string, unknown> {
  if (payload === undefined) {
    return {};
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
      message: `Device sync ${context} must be an object payload.`,
      retryable: false,
    });
  }

  return { ...payload };
}

function matchesConfiguredDeviceSyncJobFieldKind(
  value: unknown,
  kind: DeviceSyncJobPayloadFieldKind,
): value is boolean | number | string | string[] {
  switch (kind) {
    case "boolean":
      return value === true || value === false;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "string[]":
      return Array.isArray(value) && value.every((entry) => typeof entry === "string");
  }
}

function describeConfiguredDeviceSyncJobFieldKind(kind: DeviceSyncJobPayloadFieldKind): string {
  return kind === "string[]" ? "an array of strings" : `a ${kind}`;
}

function pickConfiguredDeviceSyncHostedHintPayload(
  payload: Record<string, unknown>,
  definition: DeviceSyncProviderJobDefinition,
): Record<string, unknown> {
  const shaped: Record<string, unknown> = {};

  for (const [field, spec] of Object.entries(definition.payload)) {
    if (!spec.includeInHostedHint || spec.kind === "string[]") {
      continue;
    }

    const value = payload[field];

    if (spec.kind === "string" && value === "") {
      continue;
    }

    if (matchesConfiguredDeviceSyncJobFieldKind(value, spec.kind)) {
      shaped[field] = value;
    }
  }

  return shaped;
}
