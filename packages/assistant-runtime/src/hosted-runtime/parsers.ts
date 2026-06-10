import {
  parseConfiguredDeviceSyncRuntimeConfig,
} from "@murphai/device-syncd/runtime-config";
import {
  parseHostedWorkspaceState,
} from "@murphai/hosted-execution/parsers";

import type {
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedAssistantRuntimeDeviceSyncConfig,
  HostedAssistantRuntimeManagedAutoReplyChannel,
  HostedAssistantRuntimeParserToolchainConfig,
  HostedAssistantRuntimeParserToolConfig,
  HostedAssistantRuntimeParserToolName,
  HostedAssistantRuntimeResolvedConfig,
  HostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  createDefaultHostedManagedAutoReplyChannels,
} from "./managed-auto-reply.ts";

const hostedParserToolNames = [
  "ffmpeg",
  "pdfinfo",
  "pdftotext",
  "transcription",
  "whisper",
] as const satisfies readonly HostedAssistantRuntimeParserToolName[];

export function parseHostedAssistantWorkspaceRuntimeJobInput(
  value: unknown,
): HostedAssistantWorkspaceRuntimeJobInput {
  const record = requireObject(value, "Hosted assistant workspace runtime job input");

  return {
    request: parseHostedAssistantWorkspaceRuntimeJobRequest(record.request),
    ...(record.runtime === undefined || record.runtime === null
      ? {}
      : { runtime: parseHostedAssistantRuntimeConfig(record.runtime) }),
  };
}

export function parseHostedAssistantWorkspaceRuntimeJobRequest(
  value: unknown,
): HostedAssistantWorkspaceRuntimeJobInput["request"] {
  const record = requireObject(value, "Hosted assistant workspace runtime job request");

  rejectRemovedHostedAssistantRuntimeField(
    record,
    "checkpointNextWakeAt",
    "Hosted assistant workspace runtime job request",
  );
  rejectRemovedHostedAssistantRuntimeField(
    record,
    "deadlineAt",
    "Hosted assistant workspace runtime job request",
  );
  rejectRemovedHostedAssistantRuntimeField(
    record,
    "reason",
    "Hosted assistant workspace runtime job request",
  );
  rejectRemovedHostedAssistantRuntimeField(
    record,
    "run",
    "Hosted assistant workspace runtime job request",
  );
  rejectRemovedHostedAssistantRuntimeField(
    record,
    "runDrain",
    "Hosted assistant workspace runtime job request",
  );
  rejectRemovedHostedAssistantRuntimeField(
    record,
    "runToken",
    "Hosted assistant workspace runtime job request",
  );
  rejectRemovedHostedAssistantRuntimeField(
    record,
    "source",
    "Hosted assistant workspace runtime job request",
  );
  rejectRemovedHostedAssistantRuntimeField(
    record,
    "targetCommittedSeqHint",
    "Hosted assistant workspace runtime job request",
  );
  rejectRemovedHostedAssistantRuntimeField(
    record,
    "wake",
    "Hosted assistant workspace runtime job request",
  );
  return {
    attemptId: requireString(
      record.attemptId,
      "Hosted assistant workspace runtime job request.attemptId",
    ),
    ...(record.budget === undefined || record.budget === null
      ? {}
      : {
          budget: parseHostedWorkspaceInvocationBudget(
            record.budget,
            "Hosted assistant workspace runtime job request.budget",
          ),
        }),
    ...(record.idleCheckpointDelayMs === undefined
      ? {}
      : {
          idleCheckpointDelayMs: record.idleCheckpointDelayMs === null
            ? null
            : requirePositiveInteger(
                record.idleCheckpointDelayMs,
                "Hosted assistant workspace runtime job request.idleCheckpointDelayMs",
              ),
        }),
    leaseGeneration: requireNonNegativeBigIntString(
      record.leaseGeneration,
      "Hosted assistant workspace runtime job request.leaseGeneration",
    ),
    ...(record.providerEgressToken === undefined
      ? {}
      : {
          providerEgressToken: readNullableString(
            record.providerEgressToken,
            "Hosted assistant workspace runtime job request.providerEgressToken",
          ),
        }),
    userId: requireString(
      record.userId,
      "Hosted assistant workspace runtime job request.userId",
    ),
    ...(record.workspace === undefined
      ? {}
      : {
          workspace: record.workspace === null
            ? null
            : parseHostedWorkspaceState(record.workspace),
        }),
    workspaceVersion: requireNonNegativeBigIntString(
      record.workspaceVersion,
      "Hosted assistant workspace runtime job request.workspaceVersion",
    ),
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

  if (record.parserToolchain === null) {
    throw new TypeError(
      "Hosted assistant runtime config.parserToolchain:null is not supported; omit parserToolchain to use the runner image toolchain.",
    );
  }

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
    ...(record.parserToolchain === undefined
      ? {}
      : {
          parserToolchain: parseHostedAssistantRuntimeParserToolchainConfig(
            record.parserToolchain,
            "Hosted assistant runtime config.parserToolchain",
          ),
        }),
    ...(record.platformEnv === undefined
      ? {}
      : {
          platformEnv: parseStringRecord(
            record.platformEnv,
            "Hosted assistant runtime config.platformEnv",
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

function parseHostedAssistantRuntimeParserToolchainConfig(
  value: unknown,
  label: string,
): HostedAssistantRuntimeParserToolchainConfig {
  const record = requireObject(value, label);
  const rawTools = requireObject(record.tools, `${label}.tools`);
  const tools: HostedAssistantRuntimeParserToolchainConfig["tools"] = {};

  for (const toolName of hostedParserToolNames) {
    if (rawTools[toolName] === undefined) {
      continue;
    }

    tools[toolName] = parseHostedAssistantRuntimeParserToolConfig(
      rawTools[toolName],
      `${label}.tools.${toolName}`,
    );
  }

  return { tools };
}

function parseHostedAssistantRuntimeParserToolConfig(
  value: unknown,
  label: string,
): HostedAssistantRuntimeParserToolConfig {
  const record = requireObject(value, label);
  const config: HostedAssistantRuntimeParserToolConfig = {};

  if (record.command !== undefined) {
    config.command = parseAbsoluteToolPath(record.command, `${label}.command`);
  }
  if (record.endpoint !== undefined) {
    config.endpoint = parseHttpToolEndpoint(record.endpoint, `${label}.endpoint`);
  }
  if (record.modelPath !== undefined) {
    config.modelPath = parseAbsoluteToolPath(record.modelPath, `${label}.modelPath`);
  }

  return config;
}

function parseAbsoluteToolPath(value: unknown, label: string): string {
  const parsed = requireString(value, label).trim();
  if (parsed.length === 0) {
    throw new TypeError(`${label} must be a non-empty absolute path.`);
  }
  if (!parsed.startsWith("/")) {
    throw new TypeError(`${label} must be an absolute path.`);
  }

  return parsed;
}

function parseHttpToolEndpoint(value: unknown, label: string): string {
  const parsed = requireString(value, label).trim();
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    throw new TypeError(`${label} must be an absolute http(s) URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${label} must be an absolute http(s) URL.`);
  }

  return parsed;
}

function parseHostedAssistantRuntimeResolvedConfig(
  value: unknown,
  label: string,
): HostedAssistantRuntimeResolvedConfig {
  const record = requireObject(value, label);
  const channelCapabilities = parseHostedAssistantRuntimeChannelCapabilities(
    record.channelCapabilities,
    `${label}.channelCapabilities`,
  );

  return {
    channelCapabilities,
    deviceSync:
      record.deviceSync === undefined || record.deviceSync === null
        ? null
        : parseHostedAssistantRuntimeDeviceSyncConfig(
            record.deviceSync,
            `${label}.deviceSync`,
          ),
    managedAutoReplyChannels: record.managedAutoReplyChannels === undefined
      ? createDefaultHostedManagedAutoReplyChannels(channelCapabilities)
      : requireArray(record.managedAutoReplyChannels, `${label}.managedAutoReplyChannels`)
          .map((entry, index) =>
            parseHostedAssistantRuntimeManagedAutoReplyChannel(
              entry,
              `${label}.managedAutoReplyChannels[${index}]`,
            )
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
    whatsappCloudApiConfigured: record.whatsappCloudApiConfigured === undefined
      ? false
      : requireBoolean(
          record.whatsappCloudApiConfigured,
          `${label}.whatsappCloudApiConfigured`,
        ),
  };
}

function parseHostedAssistantRuntimeDeviceSyncConfig(
  value: unknown,
  label: string,
): HostedAssistantRuntimeDeviceSyncConfig {
  return parseConfiguredDeviceSyncRuntimeConfig(value, label);
}

function parseHostedAssistantRuntimeManagedAutoReplyChannel(
  value: unknown,
  label: string,
): HostedAssistantRuntimeManagedAutoReplyChannel {
  const record = requireObject(value, label);

  return {
    capabilityReady: requireBoolean(record.capabilityReady, `${label}.capabilityReady`),
    channel: requireString(record.channel, `${label}.channel`),
    memberChannel: readOptionalNullableString(record.memberChannel, `${label}.memberChannel`),
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

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
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

function requirePositiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
  ) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  return value;
}

function requireNonNegativeBigIntString(value: unknown, label: string): string {
  const raw = requireString(value, label);
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) {
    throw new TypeError(`${label} must be a non-negative integer string.`);
  }

  return raw;
}

function parseHostedWorkspaceInvocationBudget(
  value: unknown,
  label: string,
): NonNullable<HostedAssistantWorkspaceRuntimeJobInput["request"]["budget"]> {
  const record = requireObject(value, label);

  return {
    ...(record.maxMailboxItems === undefined
      ? {}
      : {
          maxMailboxItems: record.maxMailboxItems === null
            ? null
            : requirePositiveInteger(record.maxMailboxItems, `${label}.maxMailboxItems`),
        }),
    ...(record.maxRuntimeMs === undefined
      ? {}
      : {
          maxRuntimeMs: record.maxRuntimeMs === null
            ? null
            : requirePositiveInteger(record.maxRuntimeMs, `${label}.maxRuntimeMs`),
        }),
  };
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  return requireString(value, label);
}

function readOptionalNullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireString(value, label);
}
