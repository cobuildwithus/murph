import {
  parseConfiguredDeviceSyncRuntimeConfig,
} from "@murphai/device-syncd/runtime-config";
import {
  parseHostedRuntimeDrainRequest,
  parseHostedExecutionRunnerRequest,
} from "@murphai/hosted-execution/parsers";

import type {
  HostedAssistantRuntimeDeviceSyncConfig,
  HostedAssistantRuntimeResolvedConfig,
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobRequest,
} from "./models.ts";

export function parseHostedAssistantRuntimeJobInput(
  value: unknown,
): HostedAssistantRuntimeJobInput {
  const record = requireObject(value, "Hosted assistant runtime job input");

  return {
    request: parseHostedAssistantRuntimeJobRequest(record.request),
    ...(record.runtime === undefined || record.runtime === null
      ? {}
      : { runtime: parseHostedAssistantRuntimeConfig(record.runtime) }),
  };
}

export function parseHostedAssistantRuntimeJobRequest(
  value: unknown,
): HostedAssistantRuntimeJobRequest {
  const record = requireObject(value, "Hosted assistant runtime job request");

  if (record.runDrain === undefined || record.runDrain === null) {
    throw new TypeError("Hosted assistant runtime job request.runDrain is required.");
  }

  if (record.wake !== undefined) {
    throw new TypeError(
      "Hosted assistant runtime job request.wake is no longer supported; use request.runDrain.",
    );
  }

  const runDrain = parseHostedRuntimeDrainRequest(record.runDrain);
  const request = parseHostedExecutionRunnerRequest({
    ...record,
    runDrain,
  });

  return {
    ...request,
    ...(record.runToken === undefined
      ? {}
      : {
          runToken: readNullableString(
            record.runToken,
            "Hosted assistant runtime job request runToken",
          ),
        }),
  };
}

export function parseHostedAssistantRuntimeConfig(
  value: unknown,
): HostedAssistantRuntimeConfig {
  const record = requireObject(value, "Hosted assistant runtime config");
  rejectRemovedHostedAssistantRuntimeField(record, "artifactsBaseUrl");
  rejectRemovedHostedAssistantRuntimeField(record, "commitBaseUrl");
  rejectRemovedHostedAssistantRuntimeField(record, "emailBaseUrl");
  rejectRemovedHostedAssistantRuntimeField(record, "resultsBaseUrl");
  rejectRemovedHostedAssistantRuntimeField(record, "sideEffectsBaseUrl");
  rejectRemovedHostedAssistantRuntimeField(record, "webControlPlane");

  return {
    ...(record.commitTimeoutMs === undefined
      ? {}
      : {
          commitTimeoutMs:
            record.commitTimeoutMs === null
              ? null
              : requireNumber(
                  record.commitTimeoutMs,
                  "Hosted assistant runtime config.commitTimeoutMs",
                ),
        }),
    ...(record.forwardedEnv === undefined
      ? {}
      : {
          forwardedEnv: parseStringRecord(
            record.forwardedEnv,
            "Hosted assistant runtime config.forwardedEnv",
          ),
        }),
    ...(record.resolvedConfig === undefined
      ? {}
      : {
          resolvedConfig: parseHostedAssistantRuntimeResolvedConfig(
            record.resolvedConfig,
            "Hosted assistant runtime config.resolvedConfig",
          ),
        }),
    ...(record.userEnv === undefined
      ? {}
      : {
          userEnv: parseStringRecord(
            record.userEnv,
            "Hosted assistant runtime config.userEnv",
          ),
        }),
  };
}

function parseHostedAssistantRuntimeResolvedConfig(
  value: unknown,
  label: string,
): HostedAssistantRuntimeResolvedConfig {
  const record = requireObject(value, label);

  return {
    channelCapabilities: parseHostedAssistantRuntimeChannelCapabilities(
      record.channelCapabilities,
      `${label}.channelCapabilities`,
    ),
    deviceSync:
      record.deviceSync === undefined || record.deviceSync === null
        ? null
        : parseHostedAssistantRuntimeDeviceSyncConfig(
            record.deviceSync,
            `${label}.deviceSync`,
          ),
  };
}

function parseHostedAssistantRuntimeChannelCapabilities(
  value: unknown,
  label: string,
): HostedAssistantRuntimeResolvedConfig["channelCapabilities"] {
  const record = requireObject(value, label);

  return {
    emailSendReady: requireBoolean(record.emailSendReady, `${label}.emailSendReady`),
    telegramBotConfigured: requireBoolean(
      record.telegramBotConfigured,
      `${label}.telegramBotConfigured`,
    ),
  };
}

function parseHostedAssistantRuntimeDeviceSyncConfig(
  value: unknown,
  label: string,
): HostedAssistantRuntimeDeviceSyncConfig {
  return parseConfiguredDeviceSyncRuntimeConfig(value, label);
}

function parseStringRecord(value: unknown, label: string): Record<string, string> {
  const record = requireObject(value, label);
  const parsed: Record<string, string> = {};

  for (const [key, entryValue] of Object.entries(record)) {
    if (typeof entryValue !== "string") {
      throw new TypeError(`${label}.${key} must be a string.`);
    }

    parsed[key] = entryValue;
  }

  return parsed;
}


function rejectRemovedHostedAssistantRuntimeField(
  record: Record<string, unknown>,
  field: string,
  label = "Hosted assistant runtime config",
): void {
  if (record[field] !== undefined) {
    throw new TypeError(`${label}.${field} is no longer supported.`);
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
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

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  return requireString(value, label);
}
