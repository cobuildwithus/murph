import {
  requireObject,
  readNullableStringValue,
} from "./parsers/assertions.ts";
import { normalizeHostedExecutionString } from "./env.ts";
import { isHostedRuntimeGroupEmailAuthorizationProof } from "./runtime-control.ts";

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
export const HOSTED_EMAIL_GROUP_RECIPIENTS_CALLBACK_PATH =
  "/api/internal/hosted-execution/email/group-recipients";

const CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH = 32;
const CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH = 25;
const CURRENT_HOSTED_EMAIL_GROUP_ID_RANDOM_HEX_LENGTH = 24;
const CURRENT_HOSTED_EMAIL_GROUP_ID_BASE36_LENGTH = 19;
const CURRENT_HOSTED_EMAIL_GROUP_ID_SUFFIX_BYTES = 12;
const CURRENT_HOSTED_EMAIL_GROUP_ID_PREFIX = "hgrp_";
const CURRENT_HOSTED_EMAIL_RAW_GROUP_ID_MAX_LENGTH = 23;
const BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CURRENT_HOSTED_EMAIL_ALIAS_KEY_PATTERN = new RegExp(
  `^[0-9a-f]{${CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH}}$`,
  "u",
);
const HOSTED_EMAIL_BASE36_SEGMENT_PATTERN = /^[0-9a-z]+$/u;
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
const CURRENT_HOSTED_EMAIL_GROUP_ROUTE_TOKEN_PATTERN = new RegExp(
  [
    "^g2-",
    `(?<groupToken>h[0-9a-z]{${CURRENT_HOSTED_EMAIL_GROUP_ID_BASE36_LENGTH}}|r[a-z0-9_]{1,${CURRENT_HOSTED_EMAIL_RAW_GROUP_ID_MAX_LENGTH}})`,
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
  groupId: string | null;
  hasRepeatedHeaderFrom: boolean;
  headerFrom: string | null;
}

export interface HostedEmailRouteResolutionCallbackResponse {
  userId: string | null;
}

export interface HostedEmailGroupRecipientsCallbackRequest {
  expectedGroupEmailAuthorizationProof?: string | null;
  groupId: string;
}

export interface HostedEmailGroupRecipient {
  address: string;
  memberId: string;
}

export interface HostedEmailGroupRecipientsCallbackResponse {
  recipients: HostedEmailGroupRecipient[];
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

export interface HostedEmailGroupReplyAliasRoute {
  address: string;
  groupId: string;
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

export async function createHostedEmailGroupReplyAliasRoute(input: {
  domain: string;
  groupId: string;
  localPart?: string | null;
  signingSecret: string;
}): Promise<HostedEmailGroupReplyAliasRoute> {
  const groupId = requireHostedEmailGroupReplyAliasGroupId(input.groupId);
  const token = await createHostedEmailGroupRouteToken({
    groupId,
    secret: input.signingSecret,
  });

  return {
    address: formatHostedEmailReplyAliasAddress({
      domain: input.domain,
      localPart: input.localPart,
      token,
    }),
    groupId,
    token,
  };
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

export async function createHostedEmailGroupRouteToken(input: {
  groupId: string;
  secret: string;
}): Promise<string> {
  const groupId = requireHostedEmailGroupReplyAliasGroupId(input.groupId);
  const groupToken = encodeHostedEmailGroupIdForRouteToken(groupId);
  if (!groupToken) {
    throw new TypeError("Hosted email group reply alias group id is not encodable.");
  }
  const signature = await createHostedEmailGroupRouteSignature({
    groupId,
    secret: input.secret,
  });
  return `g2-${groupToken}-${signature}`;
}

export async function parseHostedEmailRouteToken(input: {
  secret: string;
  token: string;
}): Promise<
  | { aliasKey: string; groupId?: undefined }
  | { aliasKey: null; groupId: string }
  | null
> {
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

  const groupMatch = CURRENT_HOSTED_EMAIL_GROUP_ROUTE_TOKEN_PATTERN.exec(token);
  if (groupMatch?.groups) {
    const groupId = decodeHostedEmailGroupIdFromRouteToken(groupMatch.groups.groupToken);
    if (!groupId) {
      return null;
    }
    const expected = await createHostedEmailGroupRouteSignature({
      groupId,
      secret: input.secret,
    });
    if (!constantTimeStringEqual(
      expected,
      groupMatch.groups.signature,
      CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH,
    )) {
      return null;
    }

    return {
      aliasKey: null,
      groupId,
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
    groupId: normalizeHostedEmailCallbackString(record.groupId),
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

export function parseHostedEmailGroupRecipientsCallbackRequest(
  value: unknown,
): HostedEmailGroupRecipientsCallbackRequest {
  const record = requireObject(value, "Hosted email group recipients callback request");
  const groupId = normalizeHostedEmailCallbackString(record.groupId);
  if (!groupId) {
    throw new TypeError("Hosted email group recipients callback request groupId must be present.");
  }

  const expectedGroupEmailAuthorizationProof =
    record.expectedGroupEmailAuthorizationProof
      ?? record.expectedNewsletterAuthorizationProof
      ?? null;
  if (
    record.expectedGroupEmailAuthorizationProof != null
    && record.expectedNewsletterAuthorizationProof != null
    && record.expectedGroupEmailAuthorizationProof
      !== record.expectedNewsletterAuthorizationProof
  ) {
    throw new TypeError(
      "Hosted email group recipients callback authorization proofs must match.",
    );
  }
  if (
    expectedGroupEmailAuthorizationProof !== null
    && !isHostedRuntimeGroupEmailAuthorizationProof(expectedGroupEmailAuthorizationProof)
  ) {
    throw new TypeError(
      "Hosted email group recipients callback request expectedGroupEmailAuthorizationProof must be a SHA-256 hex digest.",
    );
  }

  return {
    ...(expectedGroupEmailAuthorizationProof === null
      ? {}
      : { expectedGroupEmailAuthorizationProof }),
    groupId,
  };
}

export function parseHostedEmailGroupRecipientsCallbackResponse(
  value: unknown,
): HostedEmailGroupRecipientsCallbackResponse {
  const record = requireObject(value, "Hosted email group recipients callback response");
  const entries = Array.isArray(record.recipients) ? record.recipients : null;
  if (!entries) {
    throw new TypeError("Hosted email group recipients callback response recipients must be an array.");
  }

  return {
    recipients: entries.map((entry) => {
      const recipient = requireObject(entry, "Hosted email group recipients callback response recipient");
      const memberId = normalizeHostedEmailCallbackString(recipient.memberId);
      const address = normalizeHostedEmailAddress(
        normalizeHostedEmailCallbackString(recipient.address),
      );
      if (!memberId || !address) {
        throw new TypeError("Hosted email group recipient must include a memberId and address.");
      }
      return { address, memberId };
    }),
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

function requireHostedEmailGroupReplyAliasGroupId(value: string): string {
  const groupId = normalizeHostedEmailGroupReplyAliasGroupId(value);
  if (!groupId) {
    throw new TypeError(
      "Hosted email group reply alias group id must be a supported hosted group id.",
    );
  }

  return groupId;
}

function normalizeHostedEmailGroupReplyAliasGroupId(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeHostedExecutionString(value);
  return normalized && encodeHostedEmailGroupIdForRouteToken(normalized)
    ? normalized
    : null;
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

async function createHostedEmailGroupRouteSignature(input: {
  groupId: string;
  secret: string;
}): Promise<string> {
  const groupId = requireHostedEmailGroupReplyAliasGroupId(input.groupId);
  const signatureHex = (await createHostedEmailRouteHash({
    payload: `g2:${groupId}`,
    secret: input.secret,
  })).slice(0, CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH);

  return encodeFixedBase36Hex(signatureHex);
}

function encodeHostedEmailGroupIdForRouteToken(groupId: string): string | null {
  const productionSuffix = readHostedEmailProductionGroupIdSuffix(groupId);
  if (productionSuffix) {
    const bytes = decodeBase64UrlBytes(productionSuffix);
    if (bytes?.length !== CURRENT_HOSTED_EMAIL_GROUP_ID_SUFFIX_BYTES) {
      return null;
    }
    return `h${encodeFixedBase36HexSegment(
      bytesToHex(bytes),
      CURRENT_HOSTED_EMAIL_GROUP_ID_RANDOM_HEX_LENGTH,
      CURRENT_HOSTED_EMAIL_GROUP_ID_BASE36_LENGTH,
    )}`;
  }

  if (
    groupId.length > 0
    && groupId.length <= CURRENT_HOSTED_EMAIL_RAW_GROUP_ID_MAX_LENGTH
    && /^[a-z0-9_]+$/u.test(groupId)
  ) {
    return `r${groupId}`;
  }

  return null;
}

function decodeHostedEmailGroupIdFromRouteToken(groupToken: string): string | null {
  if (groupToken.startsWith("h")) {
    const hex = decodeFixedBase36HexSegment(
      groupToken.slice(1),
      CURRENT_HOSTED_EMAIL_GROUP_ID_RANDOM_HEX_LENGTH,
      CURRENT_HOSTED_EMAIL_GROUP_ID_BASE36_LENGTH,
    );
    if (!hex) {
      return null;
    }
    return `${CURRENT_HOSTED_EMAIL_GROUP_ID_PREFIX}${encodeBase64UrlBytes(hexToBytes(hex))}`;
  }

  if (groupToken.startsWith("r")) {
    const groupId = groupToken.slice(1);
    return /^[a-z0-9_]+$/u.test(groupId) ? groupId : null;
  }

  return null;
}

function readHostedEmailProductionGroupIdSuffix(groupId: string): string | null {
  if (!groupId.startsWith(CURRENT_HOSTED_EMAIL_GROUP_ID_PREFIX)) {
    return null;
  }
  const suffix = groupId.slice(CURRENT_HOSTED_EMAIL_GROUP_ID_PREFIX.length);
  return /^[A-Za-z0-9_-]{16}$/u.test(suffix) ? suffix : null;
}

function encodeFixedBase36Hex(hex: string): string {
  return encodeFixedBase36HexSegment(
    hex,
    CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH,
    CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH,
  );
}

function encodeFixedBase36HexSegment(
  hex: string,
  hexLength: number,
  base36Length: number,
): string {
  const normalized = normalizeFixedHexSegment(hex, hexLength);
  if (!normalized) {
    throw new TypeError("Hosted email fixed-width hex segment is invalid.");
  }

  return BigInt(`0x${normalized}`)
    .toString(36)
    .padStart(base36Length, "0");
}

function decodeFixedBase36Hex(value: string): string | null {
  return decodeFixedBase36HexSegment(
    value,
    CURRENT_HOSTED_EMAIL_ROUTE_ALIAS_KEY_HEX_LENGTH,
    CURRENT_HOSTED_EMAIL_ROUTE_BASE36_LENGTH,
  );
}

function decodeFixedBase36HexSegment(
  value: string,
  hexLength: number,
  base36Length: number,
): string | null {
  if (
    value.length !== base36Length
    || !HOSTED_EMAIL_BASE36_SEGMENT_PATTERN.test(value)
  ) {
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

  if (parsed >= 2n ** BigInt((hexLength / 2) * 8)) {
    return null;
  }

  return parsed
    .toString(16)
    .padStart(hexLength, "0");
}

function normalizeFixedHexSegment(value: string, hexLength: number): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length === hexLength && /^[0-9a-f]+$/u.test(normalized)
    ? normalized
    : null;
}

function decodeBase64UrlBytes(value: string): Uint8Array | null {
  let buffer = 0;
  let bitCount = 0;
  const bytes: number[] = [];

  for (const character of value) {
    const digit = BASE64URL_ALPHABET.indexOf(character);
    if (digit < 0) {
      return null;
    }
    buffer = (buffer << 6) | digit;
    bitCount += 6;
    while (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((buffer >> bitCount) & 0xff);
      buffer &= (1 << bitCount) - 1;
    }
  }

  if (bitCount > 0 && buffer !== 0) {
    return null;
  }

  return new Uint8Array(bytes);
}

function encodeBase64UrlBytes(bytes: Uint8Array): string {
  let buffer = 0;
  let bitCount = 0;
  let output = "";

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 6) {
      bitCount -= 6;
      output += BASE64URL_ALPHABET[(buffer >> bitCount) & 0x3f];
      buffer &= (1 << bitCount) - 1;
    }
  }

  if (bitCount > 0) {
    output += BASE64URL_ALPHABET[(buffer << (6 - bitCount)) & 0x3f];
  }

  return output;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return new Uint8Array(bytes);
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
