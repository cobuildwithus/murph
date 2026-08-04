import "server-only";

import {
  readCloudflareHostedControlHttpError,
  type CloudflareHostedControlClient,
} from "@murphai/cloudflare-hosted-control/client";

import {
  readHostedExecutionControlClientIfConfigured,
} from "../hosted-execution/control";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import type {
  HostedInferenceConnectionCandidate,
} from "./types";

const HOSTED_INFERENCE_VERIFICATION_CONTROL_TIMEOUT_MS = 75_000;

export async function verifyHostedInferenceConnectionCandidate(input: {
  candidate: HostedInferenceConnectionCandidate;
  client?: CloudflareHostedControlClient | null;
  memberId: string;
}): Promise<void> {
  const client = input.client
    ?? readHostedExecutionControlClientIfConfigured(
      HOSTED_INFERENCE_VERIFICATION_CONTROL_TIMEOUT_MS,
    );
  if (!client) {
    throw hostedOnboardingError({
      code: "HOSTED_INFERENCE_VERIFICATION_UNAVAILABLE",
      httpStatus: 503,
      message: "Custom inference verification is temporarily unavailable.",
      retryable: true,
    });
  }

  try {
    await client.verifyInferenceConnection({
      request: input.candidate,
      userId: input.memberId,
    });
  } catch (error) {
    const upstream = readCloudflareHostedControlHttpError(error);
    throw hostedOnboardingError({
      cause: error,
      code: "HOSTED_INFERENCE_VERIFICATION_FAILED",
      httpStatus: upstream?.status === 422 ? 422 : 503,
      message: upstream?.status === 422
        ? "The endpoint did not complete Murph’s synthetic compatibility check."
        : "Custom inference verification is temporarily unavailable.",
      retryable: upstream?.status !== 422,
    });
  }
}
