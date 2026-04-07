import {
  parseHostedExecutionBundleRef,
  parseHostedExecutionRunnerRequest,
  parseHostedExecutionSideEffects,
  type HostedExecutionRunnerResult,
} from "@murphai/hosted-execution";

import type {
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

function parseHostedAssistantRuntimeResume(
  value: unknown,
): NonNullable<HostedAssistantRuntimeJobRequest["resume"]> {
  const record = requireObject(value, "Hosted assistant runtime resume state");
  const committedResult = requireObject(
    record.committedResult,
    "Hosted assistant runtime resume state.committedResult",
  );

  return {
    committedResult: {
      result: parseHostedExecutionRunnerSummary(
        committedResult.result,
        "Hosted assistant runtime resume state.committedResult.result",
      ),
      sideEffects: parseHostedExecutionSideEffects(committedResult.sideEffects),
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
