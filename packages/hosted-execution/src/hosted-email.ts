import { normalizeHostedExecutionString } from "./env.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedEmailCapabilities {
  ingressReady: boolean;
  sendReady: boolean;
  senderIdentity: string | null;
}

export function readHostedEmailCapabilities(
  source: EnvSource = process.env,
): HostedEmailCapabilities {
  const domain = normalizeHostedExecutionString(source.HOSTED_EMAIL_DOMAIN)?.toLowerCase() ?? null;
  const senderIdentity = resolveHostedEmailSenderIdentity(source);
  const signingSecret = normalizeHostedExecutionString(source.HOSTED_EMAIL_SIGNING_SECRET);
  const cloudflareAccountId = normalizeHostedExecutionString(source.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID);
  const cloudflareApiToken = normalizeHostedExecutionString(source.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN);
  const inferredIngressReady = senderIdentity !== null && domain !== null && signingSecret !== null;
  const inferredSendReady = inferredIngressReady
    && cloudflareAccountId !== null
    && cloudflareApiToken !== null;
  const ingressReady = senderIdentity !== null
    && (parseHostedEmailCapabilityFlag(source.HOSTED_EMAIL_INGRESS_READY) ?? inferredIngressReady);
  const sendReady = senderIdentity !== null
    && (parseHostedEmailCapabilityFlag(source.HOSTED_EMAIL_SEND_READY) ?? inferredSendReady);

  return {
    ingressReady,
    sendReady,
    senderIdentity,
  };
}

export function resolveHostedEmailSenderIdentity(
  source: EnvSource = process.env,
): string | null {
  const explicit = normalizeHostedEmailAddress(source.HOSTED_EMAIL_FROM_ADDRESS);
  if (explicit) {
    return explicit;
  }

  const domain = normalizeHostedExecutionString(source.HOSTED_EMAIL_DOMAIN)?.toLowerCase() ?? null;
  if (!domain) {
    return null;
  }

  const localPart = normalizeHostedExecutionString(source.HOSTED_EMAIL_LOCAL_PART)?.toLowerCase()
    ?? "assistant";
  return `${localPart}@${domain}`;
}

export function resolveHostedEmailSelfAddresses(input: {
  envelopeTo?: string | null;
  extra?: ReadonlyArray<string | null | undefined> | null;
  senderIdentity?: string | null;
}): string[] {
  const seen = new Set<string>();
  const addresses: string[] = [];

  const append = (value: string | null | undefined) => {
    const normalized = normalizeHostedEmailAddress(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    addresses.push(normalized);
  };

  append(input.senderIdentity);
  append(input.envelopeTo);
  for (const value of input.extra ?? []) {
    append(value);
  }

  return addresses;
}

function normalizeHostedEmailAddress(value: string | null | undefined): string | null {
  const normalized = normalizeHostedExecutionString(value);
  if (!normalized) {
    return null;
  }

  const angleMatch = normalized.match(/<([^>]+)>/u);
  const candidate = angleMatch?.[1] ?? normalized;
  const trimmed = candidate.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function parseHostedEmailCapabilityFlag(value: string | null | undefined): boolean | null {
  const normalized = normalizeHostedExecutionString(value)?.toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "1" || normalized === "true") {
    return true;
  }

  if (normalized === "0" || normalized === "false") {
    return false;
  }

  return null;
}
