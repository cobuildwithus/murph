import {
  HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID,
  readHostedEmailCapabilities,
} from "@murphai/hosted-execution/hosted-email";
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
import { buildHostedExecutionEmailConversationMessageWake } from "@murphai/hosted-execution";
import {
  appendHostedWakeInWeb,
  fetchHostedExecutionWebControlPlaneResponse,
} from "../web-control-plane.ts";
import type { HostedWebCallbackSigningEnvironment } from "../web-callback-auth.ts";

const HOSTED_WEB_EMAIL_AUTHORIZATION_PATH = "/api/internal/hosted-execution/email/authorization";
const HOSTED_WEB_EMAIL_AUTHORIZATION_TIMEOUT_MS = 1_500;

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
    bucket: env.BUNDLES,
    config,
    envelopeFrom: message.from,
    fetchImpl: fetch,
    hasRepeatedHeaderFrom: headerFrom.repeated,
    headerFrom: resolvedHeaderFrom,
    key: environment.platformEnvelopeKey,
    keyId: environment.platformEnvelopeKeyId,
    keysById: environment.platformEnvelopeKeysById,
    to: message.to,
    webCallbackSigning: environment.webCallbackSigning,
    webControlBaseUrl: environment.hostedWebBaseUrl,
  });

  if (!route) {
    rejectIngressFailure();
    return;
  }

  if (
    route.authorization === "verified-email"
    && !await authorizeHostedEmailIngress({
      callbackSigning: environment.webCallbackSigning,
      envelopeFrom: message.from,
      hasRepeatedHeaderFrom: headerFrom.repeated,
      headerFrom: resolvedHeaderFrom,
      routeUserId: route.userId,
      webControlBaseUrl: environment.hostedWebBaseUrl,
    })
  ) {
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
  const wake = buildHostedExecutionEmailConversationMessageWake({
    eventId,
    identityId: route.identityId,
    occurredAt: new Date().toISOString(),
    rawMessageKey,
    selfAddress: route.routeAddress,
    userId: route.userId,
  });

  const append = await appendHostedWakeInWeb({
    baseUrl: environment.hostedWebBaseUrl,
    boundUserId: route.userId,
    callbackSigning: environment.webCallbackSigning,
    wake,
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

async function authorizeHostedEmailIngress(input: {
  callbackSigning: HostedWebCallbackSigningEnvironment;
  envelopeFrom: string | null | undefined;
  hasRepeatedHeaderFrom: boolean;
  headerFrom: string | null | undefined;
  routeUserId: string;
  webControlBaseUrl: string;
}): Promise<boolean> {
  if (input.routeUserId === HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID) {
    return false;
  }

  try {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.webControlBaseUrl,
      body: JSON.stringify({
        envelopeFrom: input.envelopeFrom ?? null,
        hasRepeatedHeaderFrom: input.hasRepeatedHeaderFrom,
        headerFrom: input.headerFrom ?? null,
      }),
      boundUserId: input.routeUserId,
      callbackSigning: input.callbackSigning,
      fetchImpl: fetch,
      method: "POST",
      path: HOSTED_WEB_EMAIL_AUTHORIZATION_PATH,
      timeoutMs: HOSTED_WEB_EMAIL_AUTHORIZATION_TIMEOUT_MS,
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json() as { authorized?: unknown };
    return payload.authorized === true;
  } catch {
    return false;
  }
}
