import {
  readHostedEmailCapabilities,
} from "@murphai/hosted-execution";
import {
  isHostedEmailInboundSenderAuthorized,
  readHostedVerifiedEmailFromEnv,
} from "@murphai/runtime-state";
import {
  parseRawEmailMessage,
  readRawEmailHeaderValue,
} from "@murphai/inboxd/connectors/email/parsed";

import { createHostedUserEnvStore } from "../bundle-store.ts";
import { readHostedExecutionEnvironment } from "../env.ts";
import type {
  HostedEmailInboundRoute,
  HostedEmailWorkerRequest,
} from "../hosted-email.ts";
import {
  decodeHostedUserEnvPayload,
} from "../user-env.ts";
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
import { buildHostedExecutionEmailMessageReceivedDispatch } from "@murphai/hosted-execution";

export async function handleHostedEmailIngress(
  message: HostedEmailWorkerRequest,
  env: WorkerEnvironmentSource,
): Promise<void> {
  const environment = readHostedExecutionEnvironment(
    env as unknown as Readonly<Record<string, string | undefined>>,
  );
  const capabilities = readHostedEmailCapabilities(
    env as unknown as Readonly<Record<string, string | undefined>>,
  );
  if (!capabilities.ingressReady) {
    message.setReject?.("Hosted email ingress is not configured.");
    return;
  }

  const config = readHostedEmailConfig(
    env as unknown as Readonly<Record<string, string | undefined>>,
  );
  const rawBytes = await readHostedEmailMessageBytes(message.raw);
  const parsedMessage = parseRawEmailMessage(rawBytes);
  const headerFrom = readRawEmailHeaderValue(rawBytes, "from");
  const rejectReason = "Hosted email message was not accepted.";
  const route = await resolveHostedEmailIngressRoute({
    bucket: env.BUNDLES,
    config,
    envelopeFrom: message.from,
    hasRepeatedHeaderFrom: headerFrom.repeated,
    headerFrom: headerFrom.value ?? parsedMessage.from,
    key: environment.platformEnvelopeKey,
    keyId: environment.platformEnvelopeKeyId,
    keysById: environment.platformEnvelopeKeysById,
    to: message.to,
  });

  if (!route) {
    if (shouldRejectHostedEmailIngressFailure({ config, to: message.to })) {
      message.setReject?.(rejectReason);
    }
    return;
  }

  const stub = await resolveUserRunnerStub(env, route.userId);
  const userCrypto = await resolveHostedExecutionUserCryptoContext({
    bucket: env.BUNDLES,
    environment,
    userId: route.userId,
  });

  if (!await authorizeHostedEmailIngress({
    env,
    envelopeFrom: message.from,
    hasRepeatedHeaderFrom: headerFrom.repeated,
    headerFrom: headerFrom.value ?? parsedMessage.from,
    route,
    userCrypto,
  })) {
    if (shouldRejectHostedEmailIngressFailure({ config, to: message.to })) {
      message.setReject?.(rejectReason);
    }
    return;
  }

  const rawMessageKey = await writeHostedEmailRawMessage({
    bucket: env.BUNDLES,
    key: userCrypto.rootKey,
    keyId: userCrypto.rootKeyId,
    plaintext: rawBytes,
    userId: route.userId,
  });
  const eventId = `email:${rawMessageKey}`;
  await stub.dispatch(buildHostedExecutionEmailMessageReceivedDispatch({
    eventId,
    identityId: route.identityId,
    occurredAt: new Date().toISOString(),
    rawMessageKey,
    selfAddress: route.routeAddress,
    userId: route.userId,
  }));
}

async function authorizeHostedEmailIngress(input: {
  env: WorkerEnvironmentSource;
  envelopeFrom: string | null | undefined;
  hasRepeatedHeaderFrom: boolean;
  headerFrom: string | null | undefined;
  route: HostedEmailInboundRoute;
  userCrypto: Awaited<ReturnType<typeof resolveHostedExecutionUserCryptoContext>>;
}): Promise<boolean> {
  const userEnvPayload = await createHostedUserEnvStore({
    bucket: input.env.BUNDLES,
    key: input.userCrypto.rootKey,
    keyId: input.userCrypto.rootKeyId,
    keysById: input.userCrypto.keysById,
  }).readUserEnv(input.route.userId);
  const userEnv = decodeHostedUserEnvPayload(
    userEnvPayload,
    input.env as unknown as Readonly<Record<string, string | undefined>>,
  );
  const verifiedEmailAddress = readHostedVerifiedEmailFromEnv(userEnv)?.address ?? null;

  return isHostedEmailInboundSenderAuthorized({
    envelopeFrom: input.envelopeFrom,
    hasRepeatedHeaderFrom: input.hasRepeatedHeaderFrom,
    headerFrom: input.headerFrom,
    threadTarget: input.route.target,
    verifiedEmailAddress,
  });
}
