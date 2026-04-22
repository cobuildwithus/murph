import type {
  HostedIngressEvent,
  HostedIngressEnvelope,
  HostedRuntimeDrainEvent,
} from "@murphai/hosted-execution/contracts";
import {
  emitHostedExecutionStructuredLog,
  isHostedConversationMessageWake,
  isHostedEmailConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  parseHostedIngressPayload,
} from "@murphai/hosted-execution/parsers";

import { readHostedExecutionEnvironment } from "../env.ts";
import {
  HostedEmailRawMessageMissingError,
  readHostedEmailRawMessage,
} from "../hosted-email.ts";
import {
  decryptHostedIngressPayloadCiphertext,
} from "../hosted-ingress-encryption.ts";
import { json, readJsonObject } from "../json.ts";
import {
  adoptHostedRunTurnInputInWeb,
  peekHostedRunTurnInputFromWeb,
} from "../web-control-plane.ts";
import {
  resolveRunnerOutboundUserCryptoContext,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";

const DEFAULT_HOSTED_TURN_INPUT_PEEK_LIMIT = 32;
const MAX_HOSTED_TURN_INPUT_PEEK_LIMIT = 64;

export async function handleRunnerTurnInputRefreshRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  userId: string;
}): Promise<Response> {
  const body = parseRunnerTurnInputRefreshRequest(await readJsonObject(input.request));
  const peek = await peekHostedRunTurnInputFromWeb({
    baseUrl: input.environment.hostedWebBaseUrl,
    body: {
      ...(body.afterSeq === undefined ? {} : { afterSeq: body.afterSeq }),
      limit: body.limit,
      runId: body.runId,
      runToken: body.runToken,
    },
    boundUserId: input.userId,
    callbackSigning: input.environment.webCallbackSigning,
    timeoutMs: input.environment.runnerTimeoutMs,
  });

  const prefix = await resolveAdoptableHostedTurnInputPrefix({
    bucket: input.bucket,
    env: input.env,
    environment: input.environment,
    events: peek.events,
    userId: input.userId,
  });

  if (prefix.length === 0) {
    return json({ events: [] });
  }

  const adopted = await adoptHostedRunTurnInputInWeb({
    baseUrl: input.environment.hostedWebBaseUrl,
    body: {
      ...(body.afterSeq === undefined ? {} : { afterSeq: body.afterSeq }),
      ingressEventIds: prefix.map((entry) => entry.ingressEventId),
      runId: body.runId,
      runToken: body.runToken,
    },
    boundUserId: input.userId,
    callbackSigning: input.environment.webCallbackSigning,
    timeoutMs: input.environment.runnerTimeoutMs,
  });

  if (!adopted.adopted) {
    return json({ events: [] });
  }

  const prefixByIngressEventId = new Map(
    prefix.map((entry) => [entry.ingressEventId, entry]),
  );

  return json({
    events: adopted.events
      .map((event) => prefixByIngressEventId.get(event.id))
      .filter((event): event is HostedRuntimeDrainEvent => event !== undefined),
  });
}

async function resolveAdoptableHostedTurnInputPrefix(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  events: readonly HostedIngressEvent[];
  userId: string;
}): Promise<HostedRuntimeDrainEvent[]> {
  const prefix: HostedRuntimeDrainEvent[] = [];
  let expectedSeq: bigint | null = null;

  for (const event of input.events) {
    const seq = BigInt(event.seq);
    if (expectedSeq !== null && seq !== expectedSeq) {
      break;
    }
    expectedSeq = seq + 1n;

    if (event.kind !== "conversation.message") {
      break;
    }

    const wake = await tryDecryptHostedTurnInputConversationWake({
      event,
      environment: input.environment,
      userId: input.userId,
    });
    if (!wake) {
      break;
    }

    try {
      await assertHostedConversationWakeInputsAvailable({
        bucket: input.bucket,
        env: input.env,
        environment: input.environment,
        userId: input.userId,
        wake,
      });
    } catch (error) {
      if (!(error instanceof HostedEmailRawMessageMissingError)) {
        throw error;
      }

      emitHostedExecutionStructuredLog({
        component: "runner.turn-input",
        details: {
          ingressEventId: event.id,
          wakeSeq: event.seq,
        },
        error,
        level: "warn",
        message: "Hosted turn-input candidate is missing its raw email payload; leaving it pending.",
        phase: "wake.running",
        userId: input.userId,
      });
      break;
    }

    prefix.push({
      ingressEventId: event.id,
      seq: event.seq,
      wake,
    });
  }

  return prefix;
}

async function tryDecryptHostedTurnInputConversationWake(input: {
  event: HostedIngressEvent;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  userId: string;
}): Promise<HostedIngressEnvelope | null> {
  const payloadCiphertext = input.event.payloadCiphertext;
  if (!payloadCiphertext) {
    return null;
  }

  try {
    const decryptedPayload = await decryptHostedIngressPayloadCiphertext({
      ciphertext: payloadCiphertext,
      environment: input.environment.hostedIngressEncryption,
      userId: input.userId,
    });
    const wake = parseHostedIngressPayload({
      decryptedPayload,
      kind: input.event.kind,
      occurredAt: input.event.occurredAt,
      payloadSchema: input.event.payloadSchema,
      userId: input.userId,
    });

    if (
      wake.userId !== input.userId
      || !isHostedConversationMessageWake(wake)
    ) {
      return null;
    }

    return wake;
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runner.turn-input",
      details: {
        ingressEventId: input.event.id,
        wakeKind: input.event.kind,
        wakeSeq: input.event.seq,
      },
      error,
      level: "warn",
      message: "Hosted turn-input candidate has an invalid payload; leaving it pending.",
      phase: "wake.running",
      userId: input.userId,
    });
    return null;
  }
}

async function assertHostedConversationWakeInputsAvailable(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  userId: string;
  wake: HostedIngressEnvelope;
}): Promise<void> {
  if (!isHostedEmailConversationMessageWake(input.wake)) {
    return;
  }

  const crypto = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    env: input.env,
    environment: input.environment,
    userId: input.userId,
  });
  const rawMessage = await readHostedEmailRawMessage({
    bucket: input.bucket,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    rawMessageKey: input.wake.message.rawMessageKey,
    userId: input.userId,
  });

  if (!rawMessage) {
    throw new HostedEmailRawMessageMissingError({
      rawMessageKey: input.wake.message.rawMessageKey,
      userId: input.userId,
    });
  }
}

function parseRunnerTurnInputRefreshRequest(
  value: Record<string, unknown>,
): {
  afterSeq?: string | null;
  limit: number;
  runId: string;
  runToken: string;
} {
  return {
    ...(value.afterSeq === undefined
      ? {}
      : { afterSeq: readNullableBigIntString(value.afterSeq, "Hosted turn-input refresh afterSeq") }),
    limit: readHostedTurnInputLimit(value.limit),
    runId: readRequiredString(value.runId, "Hosted turn-input refresh runId"),
    runToken: readRequiredString(value.runToken, "Hosted turn-input refresh runToken"),
  };
}

function readHostedTurnInputLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_HOSTED_TURN_INPUT_PEEK_LIMIT;
  }

  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_HOSTED_TURN_INPUT_PEEK_LIMIT
  ) {
    throw new TypeError(
      `Hosted turn-input refresh limit must be between 1 and ${MAX_HOSTED_TURN_INPUT_PEEK_LIMIT}.`,
    );
  }

  return value;
}

function readNullableBigIntString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  const text = readRequiredString(value, label);
  try {
    BigInt(text);
  } catch {
    throw new TypeError(`${label} must be a base-10 integer string.`);
  }
  return text;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}
