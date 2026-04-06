import type { HostedEmailConfig } from "./config.ts";
import { isHostedEmailPublicSenderAddress } from "./route-addressing.ts";

export function shouldRejectHostedEmailIngressFailure(input: {
  config: HostedEmailConfig;
  to: string | null | undefined;
}): boolean {
  return !isHostedEmailPublicSenderAddress(input.to, input.config);
}
