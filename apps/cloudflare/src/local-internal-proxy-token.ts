import { timingSafeEquals } from "./runner-outbound/shared.ts";

const LOCAL_INTERNAL_PROXY_TOKEN_VERSION = "v1";

export async function createLocalInternalProxyUserToken(input: {
  boundUserId: string;
  proxyTokenSecret: string;
}): Promise<string> {
  const payload = encodeLocalInternalProxyTokenPayload({
    nonce: crypto.randomUUID(),
    userId: input.boundUserId,
    version: LOCAL_INTERNAL_PROXY_TOKEN_VERSION,
  });
  const signature = await signLocalInternalProxyTokenPayload(payload, input.proxyTokenSecret);
  return `${payload}.${signature}`;
}

export async function verifyLocalInternalProxyUserToken(input: {
  boundUserId: string;
  proxyTokenSecret: string;
  token: string;
}): Promise<boolean> {
  const separatorIndex = input.token.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex >= input.token.length - 1) {
    return false;
  }

  const payload = input.token.slice(0, separatorIndex);
  const providedSignature = input.token.slice(separatorIndex + 1);
  const expectedSignature = await signLocalInternalProxyTokenPayload(payload, input.proxyTokenSecret);
  if (!timingSafeEquals(providedSignature, expectedSignature)) {
    return false;
  }

  const parsedPayload = decodeLocalInternalProxyTokenPayload(payload);
  return parsedPayload?.version === LOCAL_INTERNAL_PROXY_TOKEN_VERSION
    && parsedPayload.userId === input.boundUserId;
}

export function buildLocalInternalProxyRouteBaseUrl(input: {
  baseUrl: string;
  loopbackToken: string;
}): string {
  const normalizedBaseUrl = ensureTrailingSlash(new URL(input.baseUrl));
  const routeBaseUrl = new URL(
    `__murph/local-internal-proxy/${encodeURIComponent(input.loopbackToken)}/`,
    normalizedBaseUrl,
  );
  return routeBaseUrl.toString();
}

function encodeLocalInternalProxyTokenPayload(input: {
  nonce: string;
  userId: string;
  version: string;
}): string {
  return encodeBase64Url(JSON.stringify(input));
}

function decodeLocalInternalProxyTokenPayload(
  encodedPayload: string,
): { nonce: string; userId: string; version: string } | null {
  try {
    const decoded = JSON.parse(decodeBase64Url(encodedPayload)) as Record<string, unknown>;
    return (
      typeof decoded.nonce === "string"
      && typeof decoded.userId === "string"
      && typeof decoded.version === "string"
    )
      ? {
          nonce: decoded.nonce,
          userId: decoded.userId,
          version: decoded.version,
        }
      : null;
  } catch {
    return null;
  }
}

async function signLocalInternalProxyTokenPayload(
  payload: string,
  secret: string,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      hash: "SHA-256",
      name: "HMAC",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(payload),
  );
  return encodeBytesBase64Url(new Uint8Array(signature));
}

function ensureTrailingSlash(url: URL): URL {
  return new URL(url.toString().replace(/\/?$/u, "/"));
}

function encodeBase64Url(value: string): string {
  return encodeBytesBase64Url(new TextEncoder().encode(value));
}

function encodeBytesBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
