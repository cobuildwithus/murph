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
): Promise<void> {
  const stringEnv = asWorkerStringEnvironment(env);
  const environment = readHostedExecutionEnvironment(stringEnv);
  const capabilities = readHostedEmailCapabilities(stringEnv);
  if (!capabilities.ingressReady) {
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
    await stub.wakeHostedWakes({
      targetSeqHint: append.wake.seq,
    });
  } catch (error) {
    console.error("Hosted email wake nudge failed after appending the canonical wake.", {
      error,
      eventId,
      userId: route.userId,
      wakeSeq: append.wake.seq,
    });
  }
}
