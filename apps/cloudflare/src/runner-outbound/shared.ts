import {
  HOSTED_EXECUTION_CALLBACK_HOSTS,
  HOSTED_EXECUTION_PROXY_HOSTS,
} from "@murphai/hosted-execution/callback-hosts";
import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution/env";

import { readHostedExecutionEnvironment } from "../env.ts";
import { json } from "../json.ts";
import { createHostedUserKeyStore } from "../user-key-store.js";
import type {
  WorkerEnvironmentContract,
  WorkerUserRunnerStubLike,
} from "../worker-contracts.ts";

type RunnerOutboundUserRunnerStubLike = WorkerUserRunnerStubLike;

export interface RunnerOutboundEnvironmentSource extends WorkerEnvironmentContract {}

const RUNNER_INTERNAL_PROXY_HOSTNAMES = new Set<string>([
  HOSTED_EXECUTION_CALLBACK_HOSTS.artifacts,
  HOSTED_EXECUTION_CALLBACK_HOSTS.results,
  HOSTED_EXECUTION_PROXY_HOSTS.deviceSync,
  HOSTED_EXECUTION_PROXY_HOSTS.usage,
]);

export async function resolveRunnerOutboundUserCryptoContext(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  userId: string;
}) {
  await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);

  return createHostedUserKeyStore({
    automationRecipientKeyId: input.environment.automationRecipientKeyId,
    automationRecipientPrivateKey: input.environment.automationRecipientPrivateKey,
    automationRecipientPrivateKeysById: input.environment.automationRecipientPrivateKeysById,
    automationRecipientPublicKey: input.environment.automationRecipientPublicKey,
    bucket: input.bucket,
    envelopeEncryptionKey: input.environment.platformEnvelopeKey,
    envelopeEncryptionKeyId: input.environment.platformEnvelopeKeyId,
    envelopeEncryptionKeysById: input.environment.platformEnvelopeKeysById,
    recoveryRecipientKeyId: input.environment.recoveryRecipientKeyId,
    recoveryRecipientPublicKey: input.environment.recoveryRecipientPublicKey,
    teeAutomationRecipientKeyId: input.environment.teeAutomationRecipientKeyId,
    teeAutomationRecipientPublicKey: input.environment.teeAutomationRecipientPublicKey,
  }).requireUserCryptoContext(input.userId, {
    reason: "runner-outbound-access",
  });
}

export async function resolveRunnerOutboundUserRunnerStub(
  env: RunnerOutboundEnvironmentSource,
  userId: string,
): Promise<RunnerOutboundUserRunnerStubLike> {
  const stub = env.USER_RUNNER.getByName(userId);
  try {
    await stub.bootstrapUser?.(userId);
  } catch (error) {
    if (
      !(error instanceof TypeError)
      || !error.message.includes('does not implement "bootstrapUser"')
    ) {
      throw error;
    }
  }

  return stub;
}

export function requireRunnerOutboundUserStubMethod<TKey extends keyof RunnerOutboundUserRunnerStubLike>(
  stub: RunnerOutboundUserRunnerStubLike,
  key: TKey,
): Exclude<RunnerOutboundUserRunnerStubLike[TKey], undefined> {
  const method = stub[key];

  if (typeof method !== "function") {
    throw new TypeError(`User runner stub does not implement ${String(key)}.`);
  }

  return method as Exclude<RunnerOutboundUserRunnerStubLike[TKey], undefined>;
}

export function requireRunnerOutboundHostedWebControlConfig(
  env: RunnerOutboundEnvironmentSource,
): { baseUrl: string } {
  const baseUrl = normalizeHostedExecutionBaseUrl(
    typeof env.HOSTED_WEB_BASE_URL === "string" ? env.HOSTED_WEB_BASE_URL : null,
  );

  if (!baseUrl) {
    throw new TypeError("HOSTED_WEB_BASE_URL must be configured for hosted device connect-link proxying.");
  }

  return {
    baseUrl,
  };
}

export function decodeRouteParam(value: string): string {
  return decodeURIComponent(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value;
}

export function readOptionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  return value;
}

export function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

export function readNullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireString(value, label).trim() || null;
}

export function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`));
}

export function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return value;
}

export function readNullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requirePositiveInteger(value, label);
}

export function readNullableIsoTimestamp(value: unknown, label: string): string | null {
  const normalized = readNullableString(value, label);
  if (normalized === null) {
    return null;
  }

  if (!Number.isFinite(Date.parse(normalized))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }

  return normalized;
}

export function readNullableIsoOrStringField(value: unknown, label: string): string | null {
  const normalized = readNullableString(value, label);
  if (normalized === null) {
    return null;
  }

  if (label.endsWith("At") && !Number.isFinite(Date.parse(normalized))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }

  return normalized;
}

export function timingSafeEquals(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

export function requireRunnerInternalProxyAuthorization(
  request: Request,
  hostname: string,
  expectedToken: string | null,
): Response | null {
  if (!RUNNER_INTERNAL_PROXY_HOSTNAMES.has(hostname)) {
    return null;
  }

  if (!expectedToken) {
    return json({
      error: "Hosted runner outbound proxy token is not configured.",
    }, 503);
  }

  const providedToken = request.headers.get(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER);
  if (!providedToken || !timingSafeEquals(providedToken, expectedToken)) {
    return json({
      error: "Unauthorized",
    }, 401);
  }

  return null;
}
