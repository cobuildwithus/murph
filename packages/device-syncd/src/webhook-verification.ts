import type { DeviceSyncRegistry } from "./types.ts";

export type DeviceSyncWebhookVerificationResponse =
  | {
      challenge: string;
    }
  | {
      ok: true;
      provider: string;
    };

export function resolveDeviceSyncWebhookVerificationResponse(input: {
  provider: string;
  registry: DeviceSyncRegistry;
  url: URL;
  verificationToken: string | null;
}): DeviceSyncWebhookVerificationResponse {
  const challenge = input.registry.get(input.provider)?.webhookAdmin?.resolveVerificationChallenge?.({
    url: input.url,
    verificationToken: input.verificationToken,
  }) ?? null;

  if (challenge !== null) {
    return {
      challenge,
    };
  }

  return {
    ok: true,
    provider: input.provider,
  };
}
