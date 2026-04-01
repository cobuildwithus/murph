import {
  parseHostedExecutionBundleRef,
  parseHostedExecutionRunnerRequest,
  parseHostedExecutionSideEffects,
  type HostedExecutionRunnerResult,
  type HostedExecutionWebControlPlaneEnvironment,
} from "@murph/hosted-execution";

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

  return {
    ...(record.artifactsBaseUrl === undefined
      ? {}
      : {
          artifactsBaseUrl: readNullableString(
            record.artifactsBaseUrl,
            "Hosted assistant runtime config.artifactsBaseUrl",
          ),
        }),
    ...(record.commitBaseUrl === undefined
      ? {}
      : {
          commitBaseUrl: readNullableString(
            record.commitBaseUrl,
            "Hosted assistant runtime config.commitBaseUrl",
          ),
        }),
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
    ...(record.emailBaseUrl === undefined
      ? {}
      : {
          emailBaseUrl: readNullableString(
            record.emailBaseUrl,
            "Hosted assistant runtime config.emailBaseUrl",
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
    ...(record.internalWorkerProxyToken === undefined
      ? {}
      : {
          internalWorkerProxyToken: readNullableString(
            record.internalWorkerProxyToken,
            "Hosted assistant runtime config.internalWorkerProxyToken",
          ),
        }),
    ...(record.sideEffectsBaseUrl === undefined
      ? {}
      : {
          sideEffectsBaseUrl: readNullableString(
            record.sideEffectsBaseUrl,
            "Hosted assistant runtime config.sideEffectsBaseUrl",
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
    ...(record.webControlPlane === undefined
      ? {}
      : {
          webControlPlane:
            record.webControlPlane === null
              ? null
              : parseHostedExecutionWebControlPlaneConfig(
                  record.webControlPlane,
                  "Hosted assistant runtime config.webControlPlane",
                ),
        }),
  };
}

function parseHostedExecutionCommitCallback(
  value: unknown,
): HostedExecutionCommitCallback {
  const record = requireObject(value, "Hosted assistant runtime commit callback");
  const bundleRefs = requireObject(
    record.bundleRefs,
    "Hosted assistant runtime commit callback.bundleRefs",
  );

  return {
    bundleRefs: {
      agentState: parseHostedExecutionBundleRef(bundleRefs.agentState),
      vault: parseHostedExecutionBundleRef(bundleRefs.vault),
    },
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

function parseHostedExecutionWebControlPlaneConfig(
  value: unknown,
  label: string,
): Partial<HostedExecutionWebControlPlaneEnvironment> {
  const record = requireObject(value, label);

  return {
    ...(record.deviceSyncRuntimeBaseUrl === undefined
      ? {}
      : {
          deviceSyncRuntimeBaseUrl: readNullableString(
            record.deviceSyncRuntimeBaseUrl,
            `${label}.deviceSyncRuntimeBaseUrl`,
          ),
        }),
    ...(record.internalToken === undefined
      ? {}
      : {
          internalToken: readNullableString(record.internalToken, `${label}.internalToken`),
        }),
    ...(record.schedulerToken === undefined
      ? {}
      : {
          schedulerToken: readNullableString(record.schedulerToken, `${label}.schedulerToken`),
        }),
    ...(record.shareBaseUrl === undefined
      ? {}
      : {
          shareBaseUrl: readNullableString(record.shareBaseUrl, `${label}.shareBaseUrl`),
        }),
    ...(record.shareToken === undefined
      ? {}
      : {
          shareToken: readNullableString(record.shareToken, `${label}.shareToken`),
        }),
    ...(record.usageBaseUrl === undefined
      ? {}
      : {
          usageBaseUrl: readNullableString(record.usageBaseUrl, `${label}.usageBaseUrl`),
        }),
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
