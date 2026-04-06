/**
 * Hosted email environment normalization is separate from route persistence and
 * outbound delivery so callers can depend on configuration without pulling in the
 * rest of the hosted email lifecycle.
 */

import { resolveHostedEmailSenderIdentity } from "@murphai/hosted-execution";

export interface HostedEmailConfig {
  apiBaseUrl: string;
  cloudflareAccountId: string | null;
  cloudflareApiToken: string | null;
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
    apiBaseUrl: normalizeHostedEmailApiBaseUrl(source.HOSTED_EMAIL_CLOUDFLARE_API_BASE_URL),
    cloudflareAccountId: normalizeOptionalString(source.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID),
    cloudflareApiToken: normalizeOptionalString(source.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN),
    defaultSubject: normalizeOptionalString(source.HOSTED_EMAIL_DEFAULT_SUBJECT) ?? "Murph update",
    domain,
    fromAddress,
    localPart,
    signingSecret: normalizeOptionalString(source.HOSTED_EMAIL_SIGNING_SECRET),
  };
}

function normalizeHostedEmailApiBaseUrl(value: string | undefined): string {
  return normalizeOptionalString(value)?.replace(/\/$/u, "") ?? "https://api.cloudflare.com/client/v4";
}

function normalizeOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
