import {
  createHostedExecutionControlClient,
  readHostedExecutionControlEnvironment,
  type HostedExecutionUserRootKeyRecipientUpsert,
} from "@murphai/hosted-execution";
import type {
  HostedUserRootKeyEnvelope,
  HostedUserRootKeyRecipientKind,
} from "@murphai/runtime-state";

import { hostedOnboardingError } from "../hosted-onboarding/errors";

function requireHostedExecutionKeyControlClient() {
  const environment = readHostedExecutionControlEnvironment();

  if (!environment.baseUrl || !environment.signingSecret) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
      message: "Hosted execution control is not configured yet. Contact support to finish setup.",
      httpStatus: 500,
    });
  }

  return createHostedExecutionControlClient({
    baseUrl: environment.baseUrl,
    signingSecret: environment.signingSecret,
  });
}

export async function readHostedUserRootKeyEnvelope(
  userId: string,
): Promise<HostedUserRootKeyEnvelope> {
  return requireHostedExecutionKeyControlClient().getUserKeyEnvelope(userId);
}

export async function upsertHostedUserRootKeyRecipient(input: {
  kind: HostedUserRootKeyRecipientKind;
  recipient: HostedExecutionUserRootKeyRecipientUpsert;
  userId: string;
}): Promise<HostedUserRootKeyEnvelope> {
  return requireHostedExecutionKeyControlClient().upsertUserKeyRecipient(
    input.userId,
    input.kind,
    input.recipient,
  );
}
