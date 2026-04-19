import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution/env";

import { readHostedExecutionEnvironment } from "../env.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_HOSTS } from "../internal-hosts.ts";
import { json } from "../json.ts";
import { createHostedUserKeyStore } from "../user-key-store.js";
import type {
  WorkerBootstrapUserRunnerStubLike,
  WorkerEnvironmentContract,
} from "../worker-contracts.ts";

type RunnerOutboundUserRunnerStubLike = WorkerBootstrapUserRunnerStubLike;

export interface RunnerOutboundEnvironmentSource
  extends WorkerEnvironmentContract<RunnerOutboundUserRunnerStubLike> {}

const RUNNER_INTERNAL_PROXY_HOSTNAMES = new Set<string>([
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane,
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
  const bootstrapUser = requireRunnerOutboundUserStubMethod(stub, "bootstrapUser");
  await bootstrapUser(userId);
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
