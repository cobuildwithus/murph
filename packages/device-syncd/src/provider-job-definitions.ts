import { deviceSyncError } from "./errors.ts";

import type { DeviceSyncJobInput, DeviceSyncJobRecord } from "./types.ts";
import type { ConfiguredDeviceSyncProviderKey } from "./config/provider-types.ts";

export type DeviceSyncJobPayloadFieldKind = "boolean" | "number" | "string" | "string[]";
export type HostedHintFieldKind = Exclude<DeviceSyncJobPayloadFieldKind, "string[]">;

export interface DeviceSyncJobPayloadFieldSpec {
  kind: DeviceSyncJobPayloadFieldKind;
  includeInHostedHint?: boolean;
  required?: boolean;
}

export interface DeviceSyncProviderJobDefinition {
  payload: Readonly<Record<string, DeviceSyncJobPayloadFieldSpec>>;
}

export type DeviceSyncProviderJobDefinitionMap =
  Readonly<Partial<Record<string, DeviceSyncProviderJobDefinition>>>;

export type HostedHintPayloadFieldMap = Readonly<Record<string, HostedHintFieldKind>>;

export const configuredDeviceSyncProviderJobDefinitions = Object.freeze({
  junction: freezeConfiguredDeviceSyncProviderJobDefinitions({
    backfill: {
      payload: {
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    reconcile: {
      payload: {
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    resource: {
      payload: {
        eventType: stringJobField({ includeInHostedHint: true }),
        objectId: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        resource: stringJobField({ includeInHostedHint: true }),
        resourceCategory: stringJobField({ includeInHostedHint: true }),
        sourceProviderSlug: stringJobField({ includeInHostedHint: true }),
        webhookDataJson: stringJobField({ includeInHostedHint: true }),
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
  }),
  oura: freezeConfiguredDeviceSyncProviderJobDefinitions({
    backfill: {
      payload: {
        includePersonalInfo: booleanJobField({ includeInHostedHint: true }),
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    reconcile: {
      payload: {
        includePersonalInfo: booleanJobField({ includeInHostedHint: true }),
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    resource: {
      payload: {
        dataType: stringJobField({ includeInHostedHint: true }),
        includePersonalInfo: booleanJobField({ includeInHostedHint: true }),
        objectId: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    delete: {
      payload: {
        dataType: stringJobField({ includeInHostedHint: true, required: true }),
        objectId: stringJobField({ includeInHostedHint: true, required: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        sourceEventType: stringJobField({ includeInHostedHint: true }),
      },
    },
  }),
  whoop: freezeConfiguredDeviceSyncProviderJobDefinitions({
    backfill: {
      payload: {
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    reconcile: {
      payload: {
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    resource: {
      payload: {
        eventType: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        resourceId: stringJobField({ includeInHostedHint: true, required: true }),
        resourceType: stringJobField({ includeInHostedHint: true, required: true }),
      },
    },
    delete: {
      payload: {
        eventType: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        resourceId: stringJobField({ includeInHostedHint: true, required: true }),
        resourceType: stringJobField({ includeInHostedHint: true, required: true }),
      },
    },
  }),
  strava: freezeConfiguredDeviceSyncProviderJobDefinitions({
    backfill: {
      payload: {
        includeAthlete: booleanJobField(),
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowKind: stringJobField(),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    reconcile: {
      payload: {
        includeAthlete: booleanJobField(),
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowKind: stringJobField(),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    resource: {
      payload: {
        eventType: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        resourceId: stringJobField({ includeInHostedHint: true, required: true }),
        resourceType: stringJobField({ includeInHostedHint: true, required: true }),
      },
    },
    delete: {
      payload: {
        eventType: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        resourceId: stringJobField({ includeInHostedHint: true, required: true }),
        resourceType: stringJobField({ includeInHostedHint: true }),
      },
    },
    deauthorize: {
      payload: {
        eventType: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        resourceId: stringJobField({ includeInHostedHint: true, required: true }),
        resourceType: stringJobField({ includeInHostedHint: true, required: true }),
      },
    },
  }),
} satisfies Record<ConfiguredDeviceSyncProviderKey, DeviceSyncProviderJobDefinitionMap>);

export function getConfiguredDeviceSyncProviderJobDefinition(
  provider: string,
  kind: string,
): DeviceSyncProviderJobDefinition | undefined {
  const key = normalizeConfiguredDeviceSyncProviderKey(provider);

  return key ? configuredDeviceSyncProviderJobDefinitions[key][kind] : undefined;
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

function booleanJobField(
  options: Pick<DeviceSyncJobPayloadFieldSpec, "includeInHostedHint" | "required"> = {},
): DeviceSyncJobPayloadFieldSpec {
  return {
    kind: "boolean",
    ...options,
  };
}

function stringJobField(
  options: Pick<DeviceSyncJobPayloadFieldSpec, "includeInHostedHint" | "required"> = {},
): DeviceSyncJobPayloadFieldSpec {
  return {
    kind: "string",
    ...options,
  };
}

function freezeConfiguredDeviceSyncProviderJobDefinitions(
  definitions: DeviceSyncProviderJobDefinitionMap,
): DeviceSyncProviderJobDefinitionMap {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definitions).flatMap(([kind, definition]) =>
        definition
          ? [
              [
                kind,
                Object.freeze({
                  payload: Object.freeze(
                    Object.fromEntries(
                      Object.entries(definition.payload).map(([field, spec]) => [
                        field,
                        Object.freeze({ ...spec }),
                      ]),
                    ),
                  ),
                }),
              ] as const,
            ]
          : [],
      ),
    ),
  );
}

function normalizeConfiguredDeviceSyncJobPayload(
  provider: string,
  kind: string,
  payload: Record<string, unknown> | undefined,
  context: string,
): Record<string, unknown> {
  const normalizedPayload = normalizeJobPayloadRecord(payload, `${provider} ${kind} ${context} payload`);
  const providerKey = normalizeConfiguredDeviceSyncProviderKey(provider);

  if (!providerKey) {
    return normalizedPayload;
  }

  const definition = configuredDeviceSyncProviderJobDefinitions[providerKey][kind];

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

function normalizeConfiguredDeviceSyncProviderKey(
  provider: string,
): ConfiguredDeviceSyncProviderKey | null {
  const key = typeof provider === "string" ? provider.trim().toLowerCase() : "";

  if (
    key === "junction"
    || key === "oura"
    || key === "whoop"
    || key === "strava"
  ) {
    return key;
  }

  return null;
}
