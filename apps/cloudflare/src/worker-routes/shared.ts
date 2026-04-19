import type {
  HostedExecutionWakeDrainResult,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution/contracts";

import { readHostedExecutionEnvironment } from "../env.ts";
import type { HostedExecutionContainerNamespaceLike } from "../runner-container.js";
import {
  createHostedUserKeyStore,
} from "../user-key-store.js";
import type {
  WorkerEnvironmentContract,
  WorkerUserRunnerStubLike,
} from "../worker-contracts.ts";

export interface UserRunnerDurableObjectStubLike extends WorkerUserRunnerStubLike {
  bootstrapUser(userId: string): Promise<{ userId: string }>;
  status(): Promise<HostedExecutionUserStatus>;
  wakeHostedWakes(input?: {
    targetSeqHint?: string | null;
  }): Promise<HostedExecutionWakeDrainResult>;
}

export interface WorkerEnvironmentSource
  extends WorkerEnvironmentContract<UserRunnerDurableObjectStubLike> {
  RUNNER_CONTAINER: HostedExecutionContainerNamespaceLike;
}

export interface WorkerRouteContext {
  env: WorkerEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  requestText?: Promise<string>;
  url: URL;
}

export async function resolveUserRunnerStub(
  env: WorkerEnvironmentSource,
  userId: string,
): Promise<UserRunnerDurableObjectStubLike> {
  const stub = env.USER_RUNNER.getByName(userId);
  await stub.bootstrapUser(userId);
  return stub;
}

export async function resolveHostedExecutionUserCryptoContext(input: {
  bucket: WorkerEnvironmentSource["BUNDLES"];
  environment: WorkerRouteContext["environment"];
  userId: string;
}) {
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
    reason: "worker-route-access",
  });
}

export function decodeRouteParam(value: string): string {
  return decodeURIComponent(value);
}

export async function readCachedRequestText(
  context: Pick<WorkerRouteContext, "request" | "requestText">,
): Promise<string> {
  context.requestText ??= context.request.text();
  return context.requestText;
}
