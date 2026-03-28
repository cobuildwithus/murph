import {
  createHostedExecutionControlClient,
  readHostedExecutionControlEnvironment,
} from "@murph/hosted-execution";
import { createHostedVerifiedEmailUserEnv } from "@murph/runtime-state";

import { hostedOnboardingError } from "../hosted-onboarding/errors";

export interface HostedVerifiedEmailSyncResult {
  emailAddress: string;
  runTriggered: boolean;
  verifiedAt: string;
}

export async function syncHostedVerifiedEmailToHostedExecution(input: {
  userId: string;
  emailAddress: string;
  verifiedAt: string;
}): Promise<HostedVerifiedEmailSyncResult> {
  const environment = readHostedExecutionControlEnvironment();

  if (!environment.baseUrl || !environment.controlToken) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
      message: "Hosted email sync is not configured yet. Contact support to finish setup.",
      httpStatus: 500,
    });
  }

  const client = createHostedExecutionControlClient({
    baseUrl: environment.baseUrl,
    controlToken: environment.controlToken,
  });

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
