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

const CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH = 32;
const CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH = 25;
const BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const CURRENT_HOSTED_EMAIL_ALIAS_KEY_PATTERN = new RegExp(
  `^[0-9a-f]{${CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH}}$`,
  "u",
);
const CURRENT_HOSTED_EMAIL_BASE36_SEGMENT_PATTERN = new RegExp(
  `^[0-9a-z]{${CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH}}$`,
  "u",
);
const CURRENT_HOSTED_EMAIL_ROUTE_TOKEN_PATTERN = new RegExp(
  [
    "^u2-",
    `(?<aliasKey>[0-9a-z]{${CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH}})`,
    "-",
    `(?<signature>[0-9a-z]{${CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH}})`,
    "$",
  ].join(""),
  "u",
);

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

export interface HostedEmailReplyAliasRoute {
  address: string;
  aliasKey: string;
  token: string;
}

export async function createHostedEmailUserReplyAliasRoute(input: {
  domain: string;
  localPart?: string | null;
  signingSecret: string;
  userId: string;
}): Promise<HostedEmailReplyAliasRoute> {
  const aliasKey = await deriveHostedEmailUserReplyAliasKey({
    signingSecret: input.signingSecret,
    userId: input.userId,
  });

  return createHostedEmailReplyAliasRoute({
    aliasKey,
    domain: input.domain,
    localPart: input.localPart,
    signingSecret: input.signingSecret,
  });
}

export async function createHostedEmailReplyAliasRoute(input: {
  aliasKey: string;
  domain: string;
  localPart?: string | null;
  signingSecret: string;
}): Promise<HostedEmailReplyAliasRoute> {
  const aliasKey = requireHostedEmailReplyAliasLookupKey(input.aliasKey);
  const token = await createHostedEmailRouteToken({
    aliasKey,
    secret: input.signingSecret,
  });

  return {
    address: formatHostedEmailReplyAliasAddress({
      domain: input.domain,
      localPart: input.localPart,
      token,
    }),
    aliasKey,
    token,
  };
}

export function formatHostedEmailReplyAliasAddress(input: {
  domain: string;
  localPart?: string | null;
  token: string;
}): string {
  const domain = normalizeHostedEmailRouteDomain(input.domain);
  if (!domain) {
    throw new TypeError("Hosted email reply alias domain must be configured.");
  }

  const localPart = normalizeHostedEmailRouteLocalPart(input.localPart) ?? "assistant";
  const token = normalizeHostedEmailRouteToken(input.token);
  if (!token) {
    throw new TypeError("Hosted email reply alias token must be configured.");
  }

  return `${localPart}+${token}@${domain}`;
}

export async function deriveHostedEmailUserReplyAliasKey(input: {
  signingSecret: string;
  userId: string;
}): Promise<string> {
  const userId = normalizeHostedExecutionString(input.userId);
  if (!userId) {
    throw new TypeError("Hosted email reply alias user id must be configured.");
  }

  return deriveStableHostedEmailKey(input.signingSecret, `user:${userId}`);
}

export async function createHostedEmailRouteToken(input: {
  aliasKey: string;
  secret: string;
}): Promise<string> {
  const aliasKey = requireHostedEmailReplyAliasLookupKey(input.aliasKey);
  const encodedAliasKey = encodeFixedBase36Hex(aliasKey);
  const signature = await createHostedEmailRouteSignature({
    aliasKey,
    secret: input.secret,
  });
  return `u2-${encodedAliasKey}-${signature}`;
}

export async function parseHostedEmailRouteToken(input: {
  secret: string;
  token: string;
}): Promise<{ aliasKey: string } | null> {
  const token = input.token.trim().toLowerCase();
  const currentMatch = CURRENT_HOSTED_EMAIL_ROUTE_TOKEN_PATTERN.exec(token);
  if (currentMatch?.groups) {
    const aliasKey = decodeFixedBase36Hex(currentMatch.groups.aliasKey);
    if (!aliasKey) {
      return null;
    }

    const expected = await createHostedEmailRouteSignature({
      aliasKey,
      secret: input.secret,
    });
    if (!constantTimeStringEqual(
      expected,
      currentMatch.groups.signature,
      CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH,
    )) {
      return null;
    }

    return {
      aliasKey,
    };
  }
  return null;
}

export async function deriveStableHostedEmailKey(secret: string, payload: string): Promise<string> {
  return (await createHostedEmailRouteHash({ payload, secret })).slice(
    0,
    CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH,
  );
}

export function normalizeHostedEmailReplyAliasLookupKey(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeHostedExecutionString(value)?.toLowerCase() ?? null;
  return normalized && CURRENT_HOSTED_EMAIL_ALIAS_KEY_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function isHostedEmailReplyAliasLookupKey(
  value: string | null | undefined,
): boolean {
  return normalizeHostedEmailReplyAliasLookupKey(value) !== null;
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
  // Send capability tracks ingress: once email is configured (domain, sender,
  // signing secret) the statically declared HOSTED_EMAIL send binding is always
  // present. We deliberately do not gate on the live binding object — capabilities
  // are recomputed in the runner from a stringified env where the binding object
  // does not survive, which would otherwise leave send permanently unavailable.
  const sendReady = ingressReady;

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

function requireHostedEmailReplyAliasLookupKey(value: string): string {
  const aliasKey = normalizeHostedEmailReplyAliasLookupKey(value);
  if (!aliasKey) {
    throw new TypeError("Hosted email reply alias lookup key must be 128-bit lowercase hex.");
  }

  return aliasKey;
}

async function createHostedEmailRouteHash(input: {
  payload: string;
  secret: string;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    {
      hash: "SHA-256",
      name: "HMAC",
    },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input.payload)),
  );
  return [...signature]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createHostedEmailRouteSignature(input: {
  aliasKey: string;
  secret: string;
}): Promise<string> {
  const signatureHex = (await createHostedEmailRouteHash({
    payload: `u2:${input.aliasKey}`,
    secret: input.secret,
  })).slice(0, CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH);

  return encodeFixedBase36Hex(signatureHex);
}

function encodeFixedBase36Hex(hex: string): string {
  const normalized = requireHostedEmailReplyAliasLookupKey(hex);

  return BigInt(`0x${normalized}`)
    .toString(36)
    .padStart(CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH, "0");
}

function decodeFixedBase36Hex(value: string): string | null {
  if (!CURRENT_HOSTED_EMAIL_BASE36_SEGMENT_PATTERN.test(value)) {
    return null;
  }

  let parsed = 0n;
  for (const character of value) {
    const digit = BASE36_ALPHABET.indexOf(character);
    if (digit < 0) {
      return null;
    }
    parsed = parsed * 36n + BigInt(digit);
  }

  if (parsed >= 2n ** BigInt((CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH / 2) * 8)) {
    return null;
  }

  return parsed
    .toString(16)
    .padStart(CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH, "0");
}

function constantTimeStringEqual(left: string, right: string, expectedLength: number): boolean {
  if (left.length !== expectedLength || right.length !== expectedLength) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < expectedLength; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function normalizeHostedEmailRouteDomain(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeHostedEmailRouteLocalPart(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeHostedEmailRouteToken(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
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
