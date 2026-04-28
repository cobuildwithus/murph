import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import { readHostedEmailCapabilities } from "@murphai/hosted-execution/hosted-email";
import {
  parseRawEmailMessage,
  readRawEmailHeaderValue,
} from "@murphai/inboxd/connectors/email/parsed";

import { readHostedExecutionEnvironment } from "../env.ts";
import type {
  HostedEmailWorkerRequest,
} from "../hosted-email.ts";
import { enqueueHostedRunnerWake } from "../runner-wake-queue.ts";
import {
  deleteHostedEmailRawMessage,
  readHostedEmailConfig,
  readHostedEmailMessageBytes,
  resolveHostedEmailRawMessageStorageRef,
  resolveHostedEmailIngressRoute,
  shouldRejectHostedEmailIngressFailure,
  writeHostedEmailRawMessage,
} from "../hosted-email.ts";
import {
  resolveHostedExecutionUserCryptoContext,
  resolveUserRunnerStub,
  type WorkerEnvironmentSource,
} from "../worker-routes/shared.ts";
import { asWorkerStringEnvironment } from "../worker-contracts.ts";
import { appendHostedEmailIngressWakeInWeb } from "../web-control-plane-email-ingress.ts";

export async function handleHostedEmailIngress(
  message: HostedEmailWorkerRequest,
  env: WorkerEnvironmentSource,
): Promise<void> {
  const stringEnv = asWorkerStringEnvironment(env);
  const environment = readHostedExecutionEnvironment(stringEnv);
  const capabilities = readHostedEmailCapabilities(stringEnv);
  if (!capabilities.ingressReady) {
    emitHostedExecutionStructuredLog({
      component: "hosted.email",
      details: buildHostedEmailIngressLogDetails({
        ingressReady: false,
        to: message.to,
      }),
      level: "warn",
      message: "Hosted email ingress rejected a message because ingress is not configured.",
      phase: "failed",
    });
    message.setReject?.("Hosted email ingress is not configured.");
    return;
  }

  const config = readHostedEmailConfig(stringEnv);
  let rawBytes: Uint8Array;

  try {
    rawBytes = await readHostedEmailMessageBytes(message.raw, {
      rawSize: typeof message.rawSize === "number" ? message.rawSize : null,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      emitHostedExecutionStructuredLog({
        component: "hosted.email",
        details: buildHostedEmailIngressLogDetails({
          rawSize: typeof message.rawSize === "number" ? String(message.rawSize) : null,
          reason: "raw-message-too-large",
          to: message.to,
        }),
        error,
        level: "warn",
        message: "Hosted email ingress rejected an oversized raw message.",
        phase: "failed",
      });
      message.setReject?.("Hosted email message exceeded the maximum accepted size.");
      return;
    }

    throw error;
  }

  const parsedMessage = parseRawEmailMessage(rawBytes);
  const headerFrom = readRawEmailHeaderValue(rawBytes, "from");
  const resolvedHeaderFrom = headerFrom.value ?? parsedMessage.from;
  const rejectReason = "Hosted email message was not accepted.";
  const shouldRejectOnIngressFailure = shouldRejectHostedEmailIngressFailure({
    config,
    to: message.to,
  });
  const rejectIngressFailure = () => {
    if (shouldRejectOnIngressFailure) {
      message.setReject?.(rejectReason);
    }
  };
  const route = await resolveHostedEmailIngressRoute({
    authenticatedSender: message.authenticatedSender ?? null,
    config,
    envelopeFrom: message.from,
    fetchImpl: fetch,
    hasRepeatedHeaderFrom: headerFrom.repeated,
    headerFrom: resolvedHeaderFrom,
    to: message.to,
    webCallbackSigning: environment.webCallbackSigning,
    webControlBaseUrl: environment.hostedWebBaseUrl,
  });

  if (!route) {
    emitHostedExecutionStructuredLog({
      component: "hosted.email",
      details: buildHostedEmailIngressLogDetails({
        from: message.from,
        headerFrom: resolvedHeaderFrom,
        reason: shouldRejectOnIngressFailure ? "ingress-route-miss-rejected" : "ingress-route-miss-accepted-drop",
        to: message.to,
      }),
      level: "warn",
      message: shouldRejectOnIngressFailure
        ? "Hosted email ingress rejected a message because no authorized ingress route matched."
        : "Hosted email ingress dropped a message because no authorized ingress route matched.",
      phase: "failed",
    });
    rejectIngressFailure();
    return;
  }

  const userCrypto = await resolveHostedExecutionUserCryptoContext({
    bucket: env.BUNDLES,
    environment,
    userId: route.userId,
  });
  const rawMessageStorageRef = await resolveHostedEmailRawMessageStorageRef({
    key: userCrypto.rootKey,
    plaintext: rawBytes,
    userId: route.userId,
  });
  const rawMessageObjectExistedBeforeWrite =
    (await env.BUNDLES.get(rawMessageStorageRef.objectKey)) !== null;

  const rawMessageKey = await writeHostedEmailRawMessage({
    bucket: env.BUNDLES,
    key: userCrypto.rootKey,
    keyId: userCrypto.rootKeyId,
    plaintext: rawBytes,
    storageRef: rawMessageStorageRef,
    userId: route.userId,
  });
  const eventId = `email:${rawMessageKey}`;
  const occurredAt = new Date().toISOString();

  try {
    await appendHostedEmailIngressWakeInWeb({
      baseUrl: environment.hostedWebBaseUrl,
      body: {
        eventId,
        identityId: route.identityId,
        occurredAt,
        rawMessageKey,
        selfAddress: route.routeAddress,
      },
      boundUserId: route.userId,
      callbackSigning: environment.webCallbackSigning,
      fetchImpl: fetch,
      timeoutMs: environment.webControlTimeoutMs,
    });
  } catch (error) {
    if (
      !rawMessageObjectExistedBeforeWrite
      && isDefinitiveHostedEmailIngressAppendFailure(error)
    ) {
      try {
        await deleteHostedEmailRawMessage({
          bucket: env.BUNDLES,
          key: userCrypto.rootKey,
          rawMessageKey,
          userId: route.userId,
        });
      } catch (cleanupError) {
        emitHostedExecutionStructuredLog({
          component: "hosted.email",
          details: buildHostedEmailIngressLogDetails({
            eventId,
            identityId: route.identityId,
            reason: "raw-message-append-cleanup-failed",
            routeAddress: route.routeAddress,
            to: message.to,
          }),
          error: cleanupError,
          level: "warn",
          message: "Hosted email append cleanup failed after the canonical ingress append was rejected.",
          phase: "failed",
          userId: route.userId,
        });
      }
    }

    throw error;
  }

  try {
    const stub = await resolveUserRunnerStub(env, route.userId);
    const nudge = await stub.nudgeHostedRunner();
    if (nudge.alreadyRunning) {
      return;
    }

    await enqueueHostedRunnerWake({
      component: "hosted.email",
      details: buildHostedEmailIngressLogDetails({
        eventId,
        identityId: route.identityId,
        reason: "runner-wake-queue",
        routeAddress: route.routeAddress,
        to: message.to,
      }),
      env,
      userId: route.userId,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "hosted.email",
      details: buildHostedEmailIngressLogDetails({
        eventId,
        identityId: route.identityId,
        reason: "runner-wake-queue-setup-failed",
        routeAddress: route.routeAddress,
        to: message.to,
      }),
      error,
      level: "warn",
      message: "Hosted email runner wake queue setup failed after appending the canonical ingress event.",
      phase: "wake.running",
      userId: route.userId,
    });
  }
}

function isDefinitiveHostedEmailIngressAppendFailure(
  error: unknown,
): error is Error & { status: number } {
  if (
    !(error instanceof Error)
    || !("status" in error)
    || typeof error.status !== "number"
    || !Number.isFinite(error.status)
  ) {
    return false;
  }

  return error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 409
    && error.status !== 429;
}

function buildHostedEmailIngressLogDetails(input: {
  eventId?: string | null;
  from?: string | null;
  headerFrom?: string | null;
  identityId?: string | null;
  ingressReady?: boolean | null;
  rawSize?: string | null;
  reason?: string | null;
  routeAddress?: string | null;
  to: string;
}): Record<string, string | boolean> {
  return {
    ...(input.eventId ? { hasEventId: true } : {}),
    ...(input.from ? { hasEnvelopeFrom: true } : {}),
    ...(input.headerFrom ? { hasHeaderFrom: true } : {}),
    ...(input.identityId ? { hasIdentityId: true } : {}),
    ...(input.ingressReady === null || input.ingressReady === undefined
      ? {}
      : { ingressReady: String(input.ingressReady) }),
    ...(input.rawSize ? { rawSize: input.rawSize } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.routeAddress ? { hasRouteAddress: true } : {}),
    hasRecipientAddress: input.to.trim().length > 0,
  };
}
