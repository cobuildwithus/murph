import type {
  HostedExecutionRunnerResult,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedAssistantDeliveryEffects,
} from "@murphai/hosted-execution/side-effects";
import {
  parseHostedExecutionBundleRef,
  parseHostedExecutionRunnerRequest,
} from "@murphai/hosted-execution/parsers";

import type {
  HostedAssistantRuntimeDeviceSyncConfig,
  HostedAssistantRuntimeResolvedConfig,
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobRequest,
  HostedExecutionCommitCallback,
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
  const request = parseHostedExecutionRunnerRequest(record);

  return {
    ...request,
    ...(record.commit === undefined
      ? {}
      : {
          commit: record.commit === null ? null : parseHostedExecutionCommitCallback(record.commit),
        }),
    ...(record.resume === undefined
      ? {}
      : {
          resume: record.resume === null ? null : parseHostedAssistantRuntimeResume(record.resume),
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

function parseHostedExecutionCommitCallback(
  value: unknown,
): HostedExecutionCommitCallback {
  const record = requireObject(value, "Hosted assistant runtime commit callback");

  return {
    bundleRef: parseHostedExecutionBundleRef(
      record.bundleRef,
      "Hosted assistant runtime commit callback.bundleRef",
    ),
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
  const record = requireObject(value, label);

  return {
    providerConfigs: parseConfiguredDeviceSyncProviderConfigs(
      record.providerConfigs,
      `${label}.providerConfigs`,
    ),
    publicBaseUrl: requireString(record.publicBaseUrl, `${label}.publicBaseUrl`),
    secret: requireString(record.secret, `${label}.secret`),
  };
}

function parseConfiguredDeviceSyncProviderConfigs(
  value: unknown,
  label: string,
): HostedAssistantRuntimeDeviceSyncConfig["providerConfigs"] {
  const record = requireObject(value, label);

  return {
    ...(record.garmin === undefined
      ? {}
      : {
          garmin: parseGarminDeviceSyncProviderConfig(record.garmin, `${label}.garmin`),
        }),
    ...(record.oura === undefined
      ? {}
      : {
          oura: parseOuraDeviceSyncProviderConfig(record.oura, `${label}.oura`),
        }),
    ...(record.whoop === undefined
      ? {}
      : {
          whoop: parseWhoopDeviceSyncProviderConfig(record.whoop, `${label}.whoop`),
        }),
  };
}

function parseGarminDeviceSyncProviderConfig(
  value: unknown,
  label: string,
): NonNullable<HostedAssistantRuntimeDeviceSyncConfig["providerConfigs"]["garmin"]> {
  const record = requireSerializableProviderConfigRecord(value, label);

  return {
    apiBaseUrl: parseOptionalString(record.apiBaseUrl, `${label}.apiBaseUrl`),
    authBaseUrl: parseOptionalString(record.authBaseUrl, `${label}.authBaseUrl`),
    backfillDays: parseOptionalNumber(record.backfillDays, `${label}.backfillDays`),
    clientId: requireString(record.clientId, `${label}.clientId`),
    clientSecret: requireString(record.clientSecret, `${label}.clientSecret`),
    reconcileDays: parseOptionalNumber(record.reconcileDays, `${label}.reconcileDays`),
    reconcileIntervalMs: parseOptionalNumber(
      record.reconcileIntervalMs,
      `${label}.reconcileIntervalMs`,
    ),
    requestTimeoutMs: parseOptionalNumber(record.requestTimeoutMs, `${label}.requestTimeoutMs`),
    tokenBaseUrl: parseOptionalString(record.tokenBaseUrl, `${label}.tokenBaseUrl`),
  };
}

function parseOuraDeviceSyncProviderConfig(
  value: unknown,
  label: string,
): NonNullable<HostedAssistantRuntimeDeviceSyncConfig["providerConfigs"]["oura"]> {
  const record = requireSerializableProviderConfigRecord(value, label);

  return {
    apiBaseUrl: parseOptionalString(record.apiBaseUrl, `${label}.apiBaseUrl`),
    authBaseUrl: parseOptionalString(record.authBaseUrl, `${label}.authBaseUrl`),
    backfillDays: parseOptionalNumber(record.backfillDays, `${label}.backfillDays`),
    clientId: requireString(record.clientId, `${label}.clientId`),
    clientSecret: requireString(record.clientSecret, `${label}.clientSecret`),
    reconcileDays: parseOptionalNumber(record.reconcileDays, `${label}.reconcileDays`),
    reconcileIntervalMs: parseOptionalNumber(
      record.reconcileIntervalMs,
      `${label}.reconcileIntervalMs`,
    ),
    requestTimeoutMs: parseOptionalNumber(record.requestTimeoutMs, `${label}.requestTimeoutMs`),
    scopes: parseOptionalStringArray(record.scopes, `${label}.scopes`),
    webhookTimestampToleranceMs: parseOptionalNumber(
      record.webhookTimestampToleranceMs,
      `${label}.webhookTimestampToleranceMs`,
    ),
  };
}

function parseWhoopDeviceSyncProviderConfig(
  value: unknown,
  label: string,
): NonNullable<HostedAssistantRuntimeDeviceSyncConfig["providerConfigs"]["whoop"]> {
  const record = requireSerializableProviderConfigRecord(value, label);

  return {
    backfillDays: parseOptionalNumber(record.backfillDays, `${label}.backfillDays`),
    baseUrl: parseOptionalString(record.baseUrl, `${label}.baseUrl`),
    clientId: requireString(record.clientId, `${label}.clientId`),
    clientSecret: requireString(record.clientSecret, `${label}.clientSecret`),
    reconcileDays: parseOptionalNumber(record.reconcileDays, `${label}.reconcileDays`),
    reconcileIntervalMs: parseOptionalNumber(
      record.reconcileIntervalMs,
      `${label}.reconcileIntervalMs`,
    ),
    requestTimeoutMs: parseOptionalNumber(record.requestTimeoutMs, `${label}.requestTimeoutMs`),
    scopes: parseOptionalStringArray(record.scopes, `${label}.scopes`),
    webhookTimestampToleranceMs: parseOptionalNumber(
      record.webhookTimestampToleranceMs,
      `${label}.webhookTimestampToleranceMs`,
    ),
  };
}

function parseHostedAssistantRuntimeResume(
  value: unknown,
): NonNullable<HostedAssistantRuntimeJobRequest["resume"]> {
  const record = requireObject(value, "Hosted assistant runtime resume state");
  const committedResult = requireObject(
    record.committedResult,
    "Hosted assistant runtime resume state.committedResult",
  );
  const assistantDeliveryEffects = parseHostedAssistantDeliveryEffects(
    committedResult.assistantDeliveryEffects ?? committedResult.sideEffects,
  );

  return {
    committedResult: {
      result: parseHostedExecutionRunnerSummary(
        committedResult.result,
        "Hosted assistant runtime resume state.committedResult.result",
      ),
      assistantDeliveryEffects,
      sideEffects: assistantDeliveryEffects,
    },
  };
}

function parseHostedExecutionRunnerSummary(
  value: unknown,
  label: string,
): HostedExecutionRunnerResult["result"] {
  const record = requireObject(value, label);

  return {
    eventsHandled: requireNumber(record.eventsHandled, `${label}.eventsHandled`),
    ...(record.nextWakeAt === undefined
      ? {}
      : {
          nextWakeAt: readNullableString(record.nextWakeAt, `${label}.nextWakeAt`),
        }),
    summary: requireString(record.summary, `${label}.summary`),
  };
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

function parseOptionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireString(value, label);
}

function parseOptionalNumber(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : requireNumber(value, label);
}

function parseOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of strings.`);
  }

  return value.map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireSerializableProviderConfigRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  const record = requireObject(value, label);

  if (record.fetchImpl !== undefined) {
    throw new TypeError(`${label}.fetchImpl is not supported in serialized runtime config.`);
  }

  return record;
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

function rejectRemovedHostedAssistantRuntimeField(
  record: Record<string, unknown>,
  field: string,
): void {
  if (record[field] !== undefined) {
    throw new TypeError(
      `Hosted assistant runtime config.${field} is no longer supported.`,
    );
  }
}
