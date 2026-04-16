/**
 * Hosted email environment normalization is separate from route persistence and
 * outbound delivery so callers can depend on configuration without pulling in the
 * rest of the hosted email lifecycle.
 */

import { resolveHostedEmailSenderIdentity } from "@murphai/hosted-execution/hosted-email";

export interface HostedEmailConfig {
  defaultSubject: string;
  domain: string | null;
  fromAddress: string | null;
  localPart: string;
  signingSecret: string | null;
}

export function readHostedEmailConfig(
  source: Readonly<Record<string, string | undefined>> = process.env,
): HostedEmailConfig {
  const domain = normalizeOptionalString(source.HOSTED_EMAIL_DOMAIN);
  const localPart = normalizeOptionalString(source.HOSTED_EMAIL_LOCAL_PART) ?? "assistant";
  const fromAddress = resolveHostedEmailSenderIdentity(source);

  return {
    defaultSubject: normalizeOptionalString(source.HOSTED_EMAIL_DEFAULT_SUBJECT) ?? "Murph update",
    domain,
    fromAddress,
    localPart,
    signingSecret: normalizeOptionalString(source.HOSTED_EMAIL_SIGNING_SECRET),
  };
}

function normalizeOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
