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
import {
  readHostedEmailConfig,
  readHostedEmailMessageBytes,
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
  runtime: {
    waitUntil?: (promise: Promise<unknown>) => void;
  } = {},
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

  const rawMessageKey = await writeHostedEmailRawMessage({
    bucket: env.BUNDLES,
    key: userCrypto.rootKey,
    keyId: userCrypto.rootKeyId,
    plaintext: rawBytes,
    userId: route.userId,
  });
  const eventId = `email:${rawMessageKey}`;
  const occurredAt = new Date().toISOString();

  const append = await appendHostedEmailIngressWakeInWeb({
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
    timeoutMs: environment.runnerTimeoutMs,
  });

  try {
    const stub = await resolveUserRunnerStub(env, route.userId);
    const drainPromise = stub.drainHostedRuns().catch(async (error) => {
      emitHostedExecutionStructuredLog({
        component: "hosted.email",
        details: buildHostedEmailIngressLogDetails({
          eventId,
          identityId: route.identityId,
          reason: "run-background-drain-failed",
          routeAddress: route.routeAddress,
          to: message.to,
        }),
        error,
        level: "warn",
        message: "Hosted email background drain failed after appending the canonical ingress event.",
        phase: "wake.running",
        userId: route.userId,
      });

      try {
        await stub.nudgeHostedRun();
      } catch (fallbackError) {
        emitHostedExecutionStructuredLog({
          component: "hosted.email",
          details: buildHostedEmailIngressLogDetails({
            eventId,
            identityId: route.identityId,
            reason: "run-retry-arm-fallback-failed",
            routeAddress: route.routeAddress,
            to: message.to,
          }),
          error: fallbackError,
          level: "error",
          message: "Hosted email retry-arm fallback failed after the direct drain call failed.",
          phase: "wake.running",
          userId: route.userId,
        });
        throw fallbackError;
      }
    });

    if (runtime.waitUntil) {
      runtime.waitUntil(drainPromise);
    } else {
      await drainPromise;
    }
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "hosted.email",
      details: buildHostedEmailIngressLogDetails({
        eventId,
        identityId: route.identityId,
        reason: "run-background-drain-setup-failed",
        routeAddress: route.routeAddress,
        to: message.to,
      }),
      error,
      level: "warn",
      message: "Hosted email background drain setup failed after appending the canonical ingress event.",
      phase: "wake.running",
      userId: route.userId,
    });
  }
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
}): Record<string, string> {
  return {
    ...(input.eventId ? { eventId: input.eventId } : {}),
    ...(input.from ? { envelopeFrom: input.from } : {}),
    ...(input.headerFrom ? { headerFrom: input.headerFrom } : {}),
    ...(input.identityId ? { identityId: input.identityId } : {}),
    ...(input.ingressReady === null || input.ingressReady === undefined
      ? {}
      : { ingressReady: String(input.ingressReady) }),
    ...(input.rawSize ? { rawSize: input.rawSize } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.routeAddress ? { routeAddress: input.routeAddress } : {}),
    to: input.to,
  };
}
