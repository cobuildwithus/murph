import {
  isHostedProviderEgressCredential,
} from "./hosted-provider-egress-credential.ts";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "./runner-injected-credential.ts";

export type HostedProviderCredentialDiagnosticKind =
  | "absent"
  | "other"
  | "provider_egress"
  | "sentinel";

export function readHostedProviderCredentialDiagnosticKind(
  value: unknown,
): HostedProviderCredentialDiagnosticKind {
  if (typeof value !== "string") {
    return "absent";
  }
  const credential = value.trim();
  if (!credential) {
    return "absent";
  }
  if (credential === HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL) {
    return "sentinel";
  }
  if (isHostedProviderEgressCredential(credential)) {
    return "provider_egress";
  }
  return "other";
}
