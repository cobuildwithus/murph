import type {
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchResult,
  HostedExecutionOutboxPayload,
  HostedExecutionUserEnvStatus,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";

import { readHostedExecutionEnvironment } from "../env.ts";
import type { HostedExecutionCommittedResult } from "../execution-journal.js";
import { requireJsonObject } from "../json.ts";
import type { HostedExecutionContainerNamespaceLike } from "../runner-container.js";
import {
  createHostedUserKeyStore,
} from "../user-key-store.js";
import type { HostedUserEnvUpdate } from "../user-env.ts";
import type {
  WorkerEnvironmentContract,
  WorkerUserRunnerCommitInput,
  WorkerUserRunnerStubLike,
} from "../worker-contracts.ts";

export interface UserRunnerDurableObjectStubLike extends WorkerUserRunnerStubLike {
  bootstrapUser(userId: string): Promise<{ userId: string }>;
  provisionManagedUserCrypto(userId: string): Promise<{ recipientKinds: string[]; rootKeyId: string; userId: string }>;
  clearUserEnv(): Promise<HostedExecutionUserEnvStatus>;
  dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus>;
  dispatchWithOutcome(input: HostedExecutionDispatchRequest): Promise<HostedExecutionDispatchResult>;
  getUserEnvStatus(): Promise<HostedExecutionUserEnvStatus>;
  getDeviceSyncRuntimeSnapshot(input: {
    request: HostedExecutionDeviceSyncRuntimeSnapshotRequest;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
  applyDeviceSyncRuntimeUpdates(input: {
    request: HostedExecutionDeviceSyncRuntimeApplyRequest;
  }): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse>;
  putPendingUsage(input: {
    usage: readonly Record<string, unknown>[];
  }): Promise<{ recorded: number; usageIds: string[] }>;
  readPendingUsage(input?: { limit?: number | null }): Promise<Record<string, unknown>[]>;
  deleteStoredDispatchPayload(input: { payload: HostedExecutionOutboxPayload }): Promise<void>;
  dispatchStoredPayload(input: { payload: HostedExecutionOutboxPayload }): Promise<HostedExecutionDispatchResult>;
  status(): Promise<HostedExecutionUserStatus>;
  storeDispatchPayload(input: { dispatch: HostedExecutionDispatchRequest }): Promise<HostedExecutionOutboxPayload>;
  updateUserEnv(update: HostedUserEnvUpdate): Promise<HostedExecutionUserEnvStatus>;
  deletePendingUsage(input: { usageIds: readonly string[] }): Promise<void>;
  commit(input: WorkerUserRunnerCommitInput): Promise<HostedExecutionCommittedResult>;
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

export function requireUserRunnerStubMethod<TKey extends keyof UserRunnerDurableObjectStubLike>(
  stub: UserRunnerDurableObjectStubLike,
  key: TKey,
): Exclude<UserRunnerDurableObjectStubLike[TKey], undefined> {
  const method = stub[key];
  if (typeof method !== "function") {
    throw new TypeError(`User runner stub does not implement ${String(key)}.`);
  }
  return method as Exclude<UserRunnerDurableObjectStubLike[TKey], undefined>;
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

export async function readCachedJsonObject(
  context: Pick<WorkerRouteContext, "request" | "requestText">,
): Promise<Record<string, unknown>> {
  return requireJsonObject(JSON.parse(await readCachedRequestText(context)) as unknown);
}

export async function readCachedOptionalJsonObject(
  context: Pick<WorkerRouteContext, "request" | "requestText">,
): Promise<Record<string, unknown>> {
  const payload = await readCachedRequestText(context);

  if (!payload.trim()) {
    return {};
  }

  return requireJsonObject(JSON.parse(payload) as unknown);
}
