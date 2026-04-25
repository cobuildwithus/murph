import {
  requireObject,
  readNullableStringValue,
} from "./parsers/assertions.ts";
import { normalizeHostedExecutionString } from "./env.ts";

type EnvSource = Readonly<Record<string, unknown>>;

export interface HostedEmailCapabilities {
  ingressReady: boolean;
  sendReady: boolean;
  senderIdentity: string | null;
}

export const HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID = "hosted-email-route-resolution";
export const HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH =
  "/api/internal/hosted-execution/email/register-reply-alias";
export const HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH =
  "/api/internal/hosted-execution/email/resolve-route";

export interface HostedEmailReplyAliasRegistrationCallbackRequest {
  aliasKey: string | null;
}

export interface HostedEmailRouteResolutionCallbackRequest {
  aliasKey: string | null;
  authenticatedSender: HostedEmailAuthenticatedSenderVerdict | null;
  envelopeFrom: string | null;
  hasRepeatedHeaderFrom: boolean;
  headerFrom: string | null;
}

export interface HostedEmailRouteResolutionCallbackResponse {
  userId: string | null;
}

export interface HostedEmailAuthenticatedSenderVerdict {
  dkimAligned: boolean;
  dmarcPass: boolean;
  spfAligned: boolean;
}

export function readHostedEmailCapabilities(
  source: EnvSource = process.env,
): HostedEmailCapabilities {
  const domain = readHostedEmailEnvString(source, "HOSTED_EMAIL_DOMAIN")?.toLowerCase() ?? null;
  const senderIdentity = resolveHostedEmailSenderIdentity(source);
  const signingSecret = readHostedEmailEnvString(source, "HOSTED_EMAIL_SIGNING_SECRET");
  const inferredIngressReady = senderIdentity !== null && domain !== null && signingSecret !== null;
  const ingressReady = senderIdentity !== null
    && (
      parseHostedEmailCapabilityFlag(readHostedEmailEnvString(source, "HOSTED_EMAIL_INGRESS_READY"))
      ?? inferredIngressReady
    );
  const inferredSendReady = inferredIngressReady && hasHostedEmailSendBindingValue(source.HOSTED_EMAIL);
  const sendReady = ingressReady
    && (
      parseHostedEmailCapabilityFlag(readHostedEmailEnvString(source, "HOSTED_EMAIL_SEND_READY"))
      ?? inferredSendReady
    );

  return {
    ingressReady,
    sendReady,
    senderIdentity,
  };
}

export function resolveHostedEmailSenderIdentity(
  source: EnvSource = process.env,
): string | null {
  const explicit = normalizeHostedEmailAddress(
    readHostedEmailEnvString(source, "HOSTED_EMAIL_FROM_ADDRESS"),
  );
  if (explicit) {
    return explicit;
  }

  const domain = readHostedEmailEnvString(source, "HOSTED_EMAIL_DOMAIN")?.toLowerCase() ?? null;
  if (!domain) {
    return null;
  }

  const localPart = readHostedEmailEnvString(source, "HOSTED_EMAIL_LOCAL_PART")?.toLowerCase()
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

export function parseHostedEmailReplyAliasRegistrationCallbackRequest(
  value: unknown,
): HostedEmailReplyAliasRegistrationCallbackRequest {
  const record = requireObject(value, "Hosted email reply alias registration callback request");

  return {
    aliasKey: normalizeHostedEmailCallbackString(record.aliasKey),
  };
}

export function parseHostedEmailRouteResolutionCallbackRequest(
  value: unknown,
): HostedEmailRouteResolutionCallbackRequest {
  const record = requireObject(value, "Hosted email route resolution callback request");

  return {
    aliasKey: normalizeHostedEmailCallbackString(record.aliasKey),
    authenticatedSender: parseHostedEmailAuthenticatedSenderVerdict(record.authenticatedSender),
    envelopeFrom: normalizeHostedEmailCallbackString(record.envelopeFrom),
    hasRepeatedHeaderFrom: readHostedEmailCallbackBoolean(
      record.hasRepeatedHeaderFrom,
      "Hosted email route resolution callback request hasRepeatedHeaderFrom",
    ) ?? false,
    headerFrom: normalizeHostedEmailCallbackString(record.headerFrom),
  };
}

export function parseHostedEmailRouteResolutionCallbackResponse(
  value: unknown,
): HostedEmailRouteResolutionCallbackResponse {
  const record = requireObject(value, "Hosted email route resolution callback response");
  if (!("userId" in record)) {
    throw new TypeError("Hosted email route resolution callback response userId must be present.");
  }

  return {
    userId: readNullableStringValue(
      record.userId,
      "Hosted email route resolution callback response userId",
    ),
  };
}

function hasHostedEmailSendBindingValue(value: unknown): boolean {
  return Boolean(
    value
      && typeof value === "object"
      && "send" in value
      && typeof (value as { send?: unknown }).send === "function",
  );
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

function readHostedEmailEnvString(source: EnvSource, key: string): string | null {
  const value = source[key];
  return normalizeHostedExecutionString(typeof value === "string" ? value : null);
}

function normalizeHostedEmailCallbackString(value: unknown): string | null {
  return normalizeHostedExecutionString(typeof value === "string" ? value : null);
}

function parseHostedEmailAuthenticatedSenderVerdict(
  value: unknown,
): HostedEmailAuthenticatedSenderVerdict | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireObject(value, "Hosted email authenticated sender verdict");

  return {
    dkimAligned: readHostedEmailCallbackBoolean(
      record.dkimAligned,
      "Hosted email authenticated sender verdict dkimAligned",
    ) ?? false,
    dmarcPass: readHostedEmailCallbackBoolean(
      record.dmarcPass,
      "Hosted email authenticated sender verdict dmarcPass",
    ) ?? false,
    spfAligned: readHostedEmailCallbackBoolean(
      record.spfAligned,
      "Hosted email authenticated sender verdict spfAligned",
    ) ?? false,
  };
}

function readHostedEmailCallbackBoolean(
  value: unknown,
  label: string,
): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}
