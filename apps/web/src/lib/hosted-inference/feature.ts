import "server-only";

import type {
  HostedInferenceProtocol,
} from "@murphai/hosted-execution/assistant-inference";

import { hostedOnboardingError } from "../hosted-onboarding/errors";

type EnvSource = Readonly<Record<string, string | undefined>>;

export function isHostedCustomInferenceEnabled(
  source: EnvSource = process.env,
): boolean {
  return source.HOSTED_CUSTOM_INFERENCE_ENABLED === "1";
}

export function isHostedCustomChatCompletionsEnabled(
  source: EnvSource = process.env,
): boolean {
  return isHostedCustomInferenceEnabled(source)
    && source.HOSTED_CUSTOM_CHAT_COMPLETIONS_ENABLED === "1";
}

export function requireHostedCustomInferenceEnabled(
  source: EnvSource = process.env,
): void {
  if (!isHostedCustomInferenceEnabled(source)) {
    throw hostedOnboardingError({
      code: "HOSTED_CUSTOM_INFERENCE_UNAVAILABLE",
      httpStatus: 404,
      message: "Custom inference is not available for this Murph deployment.",
    });
  }
}

export function requireHostedInferenceProtocolEnabled(
  protocol: HostedInferenceProtocol,
  source: EnvSource = process.env,
): void {
  requireHostedCustomInferenceEnabled(source);
  if (
    protocol === "chat_completions"
    && !isHostedCustomChatCompletionsEnabled(source)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_CUSTOM_CHAT_COMPLETIONS_UNAVAILABLE",
      httpStatus: 403,
      message:
        "Chat Completions custom inference is not available for this Murph deployment.",
    });
  }
}
