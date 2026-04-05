import {
  createHostedExecutionControlClient,
  readHostedExecutionControlEnvironment,
  type HostedExecutionControlClient,
  type HostedExecutionDispatchRequest,
  type HostedExecutionOutboxPayload,
} from "@murphai/hosted-execution";
import type { SharePack } from "@murphai/contracts";
import { createHostedVerifiedEmailUserEnv } from "@murphai/runtime-state";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "./vercel-oidc";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export interface HostedVerifiedEmailSyncResult {
  emailAddress: string;
  runTriggered: boolean;
  verifiedAt: string;
}

export function readHostedExecutionControlClientIfConfigured(): HostedExecutionControlClient | null {
  const environment = readHostedExecutionControlEnvironment();

  if (!environment.baseUrl) {
    return null;
  }

  return createHostedExecutionControlClient({
    baseUrl: environment.baseUrl,
    getBearerToken: createHostedExecutionVercelOidcBearerTokenProvider(),
  });
}

export function requireHostedExecutionControlClient(): HostedExecutionControlClient {
  const client = readHostedExecutionControlClientIfConfigured();

  if (!client) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
      message: "Hosted execution control is not configured yet. Contact support to finish setup.",
      httpStatus: 500,
    });
  }

  return client;
}

export async function maybeStageHostedExecutionDispatchPayload(
  dispatch: HostedExecutionDispatchRequest,
): Promise<HostedExecutionOutboxPayload | null> {
  const client = readHostedExecutionControlClientIfConfigured();
  return client ? client.storeDispatchPayload(dispatch) : null;
}

export async function deleteHostedStoredDispatchPayloadBestEffort(
  payload: HostedExecutionOutboxPayload,
): Promise<void> {
  const client = readHostedExecutionControlClientIfConfigured();

  if (!client) {
    return;
  }

  try {
    await client.deleteStoredDispatchPayload(payload);
  } catch (error) {
    console.error(
      "Hosted stored dispatch payload cleanup failed.",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function syncHostedVerifiedEmailToHostedExecution(input: {
  userId: string;
  emailAddress: string;
  verifiedAt: string;
}): Promise<HostedVerifiedEmailSyncResult> {
  const client = requireHostedExecutionControlClient();

  await client.updateUserEnv(input.userId, {
    env: createHostedVerifiedEmailUserEnv({
      address: input.emailAddress,
      verifiedAt: input.verifiedAt,
    }),
    mode: "merge",
  });

  try {
    await client.run(input.userId);

    return {
      emailAddress: input.emailAddress,
      runTriggered: true,
      verifiedAt: input.verifiedAt,
    };
  } catch (error) {
    console.error(
      `Hosted verified email sync saved user env but could not trigger a hosted run for ${input.userId}.`,
      error instanceof Error ? error.message : String(error),
    );

    return {
      emailAddress: input.emailAddress,
      runTriggered: false,
      verifiedAt: input.verifiedAt,
    };
  }
}

export async function writeHostedSharePackToHostedExecution(input: {
  pack: SharePack;
  shareId: string;
}): Promise<SharePack> {
  return requireHostedExecutionControlClient().putSharePack(input.shareId, input.pack);
}

export async function readHostedSharePackFromHostedExecution(
  shareId: string,
): Promise<SharePack | null> {
  return requireHostedExecutionControlClient().getSharePack(shareId);
}

export async function deleteHostedSharePackFromHostedExecution(
  shareId: string,
): Promise<void> {
  await requireHostedExecutionControlClient().deleteSharePack(shareId);
}
