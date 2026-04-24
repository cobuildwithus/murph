import type {
  HostedIngressEnvelope,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRunAcquireResponse,
  HostedRunEventResult,
  HostedRunRecord,
  HostedRuntimeDrainEvent,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedIngressPayload,
} from "@murphai/hosted-execution/parsers";

import type { R2BucketLike } from "../bundle-store.js";
import type { HostedExecutionEnvironment } from "../env.js";
import {
  HostedEmailRawMessageMissingError,
  readHostedEmailRawMessage,
} from "../hosted-email.js";
import {
  decryptHostedIngressPayloadCiphertext,
} from "../hosted-ingress-encryption.ts";
import {
  isHostedRunSideInputNotFoundError,
  type RunnerUserStores,
} from "./runner-run-processor.js";
import type { RunnerRuntimeAlarmScheduler } from "./runner-runtime-alarm-scheduler.js";

const HOSTED_WAKE_NUDGE_RETRY_DELAY_MS = 5_000;
const HOSTED_WAKE_QUARANTINE_EMAIL_RAW_MESSAGE_MISSING = "email-raw-message-missing";
const HOSTED_WAKE_QUARANTINE_INVALID_PAYLOAD = "invalid-wake-payload";
const HOSTED_WAKE_QUARANTINE_SIDE_INPUT_UNAVAILABLE = "hosted-side-input-unavailable";
const HOSTED_WAKE_QUARANTINE_USER_MISMATCH = "wake-user-mismatch";

export interface HostedWakeInputContext {
  bucket: R2BucketLike;
  ensureManagedUserCryptoForActivationWakeIfNeeded(wake: HostedRuntimeEvent): Promise<void>;
  ensureRunnerStores(userId?: string): Promise<RunnerUserStores>;
  hostedIngressEncryption: HostedExecutionEnvironment["hostedIngressEncryption"];
  readRunDrainSharePack(
    wake: HostedIngressEnvelope,
  ): Promise<HostedRuntimeDrainEvent["sharePack"]>;
  readRunDrainVaultSyncImport(
    wake: HostedIngressEnvelope,
  ): Promise<HostedRuntimeDrainEvent["vaultSyncImport"]>;
}

export interface HostedWakeRetryAlarmContext {
  runtimeAlarmScheduler: Pick<RunnerRuntimeAlarmScheduler, "syncNextWake">;
}

export async function resolveHostedRunDrainInputs(
  context: HostedWakeInputContext,
  input: {
    acquired: HostedRunAcquireResponse;
    run: HostedRunRecord;
    userId: string;
  },
): Promise<{
  eventResults: HostedRunEventResult[];
  events: HostedRuntimeDrainEvent[];
  outputCommittedSeq: string;
  primaryWake: HostedRuntimeEvent | null;
}> {
  const eventResults: HostedRunEventResult[] = [];
  const events: HostedRuntimeDrainEvent[] = [];
  let outputCommittedSeq = BigInt(input.acquired.cursor.committedSeq);
  let primaryWake: HostedRuntimeEvent | null = null;

  for (const wake of input.acquired.events) {
    outputCommittedSeq = maxHostedCommittedSeqHint(outputCommittedSeq, BigInt(wake.seq))
      ?? outputCommittedSeq;
    let hostedWake: HostedIngressEnvelope;

    try {
      const decryptedPayload = await decryptHostedWakeExecutionPayload(context, wake, input.userId);
      hostedWake = parseHostedIngressPayload({
        decryptedPayload,
        kind: wake.kind,
        occurredAt: wake.occurredAt,
        payloadSchema: wake.payloadSchema,
        userId: input.userId,
      });
    } catch (error) {
      quarantineHostedRunWake({
        details: {
          wakeKind: wake.kind,
          wakePayloadSchema: wake.payloadSchema,
        },
        error,
        eventResults,
        message: `Hosted run event seq ${wake.seq} has an invalid payload and will be quarantined at run commit.`,
        quarantineCode: HOSTED_WAKE_QUARANTINE_INVALID_PAYLOAD,
        runId: input.run.id,
        userId: input.userId,
        wake,
      });
      continue;
    }

    if (hostedWake.userId !== input.userId) {
      quarantineHostedRunWake({
        details: {
          wakeUserId: hostedWake.userId,
        },
        eventResults,
        message: `Hosted run event seq ${wake.seq} is bound to ${hostedWake.userId}, not ${input.userId}.`,
        quarantineCode: HOSTED_WAKE_QUARANTINE_USER_MISMATCH,
        runId: input.run.id,
        userId: input.userId,
        wake,
      });
      continue;
    }

    await context.ensureManagedUserCryptoForActivationWakeIfNeeded(hostedWake);

    let sharePack: HostedRuntimeDrainEvent["sharePack"] = null;
    let vaultSyncImport: HostedRuntimeDrainEvent["vaultSyncImport"] = null;
    try {
      sharePack = await context.readRunDrainSharePack(hostedWake);
      vaultSyncImport = await context.readRunDrainVaultSyncImport(hostedWake);
    } catch (error) {
      if (!isHostedRunSideInputNotFoundError(error)) {
        throw error;
      }

      quarantineHostedRunWake({
        error,
        eventResults,
        message: `Hosted run event seq ${wake.seq} could not hydrate its side input payload and will be quarantined at run commit.`,
        quarantineCode: HOSTED_WAKE_QUARANTINE_SIDE_INPUT_UNAVAILABLE,
        runId: input.run.id,
        userId: input.userId,
        wake,
      });
      continue;
    }

    try {
      await assertHostedWakeRuntimeInputsAvailable(context, hostedWake);
    } catch (error) {
      if (!(error instanceof HostedEmailRawMessageMissingError)) {
        throw error;
      }

      quarantineHostedRunWake({
        error,
        eventResults,
        message: `Hosted run event seq ${wake.seq} is missing its raw email payload and will be quarantined at run commit.`,
        quarantineCode: HOSTED_WAKE_QUARANTINE_EMAIL_RAW_MESSAGE_MISSING,
        runId: input.run.id,
        userId: input.userId,
        wake,
      });
      continue;
    }

    events.push({
      ingressEventId: wake.id,
      seq: wake.seq,
      ...(sharePack ? { sharePack } : {}),
      ...(vaultSyncImport ? { vaultSyncImport } : {}),
      wake: hostedWake,
    });
    eventResults.push({
      ingressEventId: wake.id,
      state: "completed",
    });
    primaryWake ??= hostedWake;
  }

  return {
    eventResults,
    events,
    outputCommittedSeq: outputCommittedSeq.toString(),
    primaryWake,
  };
}

export async function assertHostedWakeRuntimeInputsAvailable(
  context: HostedWakeInputContext,
  wake: HostedIngressEnvelope,
): Promise<void> {
  if (wake.kind !== "conversation.message" || wake.message.channel !== "email") {
    return;
  }

  const { crypto } = await context.ensureRunnerStores(wake.userId);
  const rawMessage = await readHostedEmailRawMessage({
    bucket: context.bucket,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    rawMessageKey: wake.message.rawMessageKey,
    userId: wake.userId,
  });

  if (!rawMessage) {
    throw new HostedEmailRawMessageMissingError({
      rawMessageKey: wake.message.rawMessageKey,
      userId: wake.userId,
    });
  }
}

export async function decryptHostedWakeExecutionPayload(
  context: Pick<HostedWakeInputContext, "hostedIngressEncryption">,
  wake: HostedRunAcquireResponse["events"][number],
  userId: string,
): Promise<unknown> {
  const payloadCiphertext = "payloadCiphertext" in wake ? wake.payloadCiphertext : null;

  if (typeof payloadCiphertext !== "string" || payloadCiphertext.length === 0) {
    throw new TypeError("Hosted wake payload ciphertext is required.");
  }

  return await decryptHostedIngressPayloadCiphertext({
    ciphertext: payloadCiphertext,
    environment: context.hostedIngressEncryption,
    userId,
  });
}

export function quarantineHostedRunWake(input: {
  details?: Record<string, unknown>;
  error?: unknown;
  eventResults: HostedRunEventResult[];
  message: string;
  quarantineCode: string;
  runId: string;
  userId: string;
  wake: HostedRunAcquireResponse["events"][number];
}): void {
  emitHostedExecutionStructuredLog({
    component: "hosted.runner",
    details: {
      hostedRunId: input.runId,
      quarantineCode: input.quarantineCode,
      ingressEventId: input.wake.id,
      wakeSeq: input.wake.seq,
      ...(input.details ?? {}),
    },
    ...(input.error === undefined ? {} : { error: input.error }),
    level: "warn",
    message: input.message,
    phase: "wake.running",
    userId: input.userId,
  });
  input.eventResults.push({
    ingressEventId: input.wake.id,
    quarantineCode: input.quarantineCode,
    state: "quarantined",
  });
}

export async function scheduleHostedWakeRetryAlarm(
  context: HostedWakeRetryAlarmContext,
): Promise<void> {
  await context.runtimeAlarmScheduler.syncNextWake({
    preferredWakeAt: new Date(Date.now() + HOSTED_WAKE_NUDGE_RETRY_DELAY_MS).toISOString(),
  });
}

function maxHostedCommittedSeqHint(left: bigint | null, right: bigint | null): bigint | null {
  if (left === null) {
    return right;
  }

  if (right === null) {
    return left;
  }

  return left > right ? left : right;
}
