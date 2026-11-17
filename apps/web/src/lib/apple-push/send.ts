import "server-only";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect } from "node:http2";

import { getHostedWebCryptoConfig } from "../hosted-crypto/env";
import { normalizeNullableString } from "../primitives";

// Public bundle ids of the companion app. A route may only target these.
export const APPLE_PUSH_TOPICS = ["ai.withmurph.app", "ai.withmurph.app.dev"] as const;
export type ApplePushTopic = (typeof APPLE_PUSH_TOPICS)[number];
export type ApplePushEnvironment = "development" | "production";

export interface ApplePushTarget {
  environment: ApplePushEnvironment;
  token: string;
  topic: ApplePushTopic;
}

// Background pushes need no permission and show nothing, but Apple requires
// low priority and throttles them. Alerts are immediate, visible, and always
// play the default sound, so no alert kind can arrive silently by omission.
export type ApplePushMessage =
  | { kind: "background" }
  | { kind: "alert"; body: string; title?: string };

export type ApplePushResult = "sent" | "unregistered" | "failed";

export interface ApplePushRequest {
  /** Alerts only. Groups this alert with others, local or remote, on the same thread. */
  threadId?: string;
  /** Alerts only. The app needs the Time Sensitive entitlement, so send it only to a build known to hold it. */
  interruptionLevel?: "time-sensitive";
  collapseId: string;
  data: Record<string, string>;
  expiresAt: Date;
  message: ApplePushMessage;
  target: ApplePushTarget;
}

export type ApplePushCredentials = {
  keyId: string;
  teamId: string;
} & ({ kmsKeyVersion: string } | { privateKey: KeyObject });

export interface ApplePushProviderToken {
  issuedAt: number;
  value: string;
}

interface TokenDependencies {
  credentials?: ApplePushCredentials | null;
  now?: () => number;
}

export type ApplePushTransport = (input: {
  body: string;
  headers: Record<string, string>;
  origin: string;
  path: string;
  timeoutMs: number;
}) => Promise<{ reason: string | null; status: number }>;

const APPLE_PUSH_TIMEOUT_MS = 2_500;
// Apple accepts provider tokens for an hour and rejects refreshes within twenty minutes.
const PROVIDER_TOKEN_REUSE_MS = 40 * 60_000;
const UNREGISTERED_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

let cachedProviderToken: { identity: string; token: ApplePushProviderToken } | null = null;
let pendingProviderToken: { identity: string; promise: Promise<ApplePushProviderToken> } | null = null;

export function readApplePushCredentials(source: Readonly<Record<string, string | undefined>> = process.env): ApplePushCredentials | null {
  const teamId = normalizeNullableString(source.APNS_TEAM_ID);
  const keyId = normalizeNullableString(source.APNS_KEY_ID);
  if (!teamId || !keyId) return null;
  const kmsKeyVersion = normalizeNullableString(source.APNS_KMS_KEY_VERSION);
  if (kmsKeyVersion) return { keyId, kmsKeyVersion, teamId };
  const pem = normalizeNullableString(source.APNS_PRIVATE_KEY)?.replaceAll("\\n", "\n");
  if (!pem) return null;
  return { keyId, privateKey: createPrivateKey(pem), teamId };
}

/** Resolve signing before final delivery authorization, never inside a database transaction. */
export async function prepareApplePushProviderToken(dependencies: TokenDependencies = {}): Promise<ApplePushProviderToken | null> {
  try {
    const credentials = dependencies.credentials === undefined ? readApplePushCredentials() : dependencies.credentials;
    return credentials ? await providerToken(credentials, dependencies.now?.() ?? Date.now()) : null;
  } catch {
    return null;
  }
}

// Missing credentials are a configured kill switch, so they report `failed`.
export async function sendApplePush(
  request: ApplePushRequest,
  dependencies: TokenDependencies & {
    /** A prepared token (or failed preparation) prevents any signing after final authorization. */
    providerToken?: ApplePushProviderToken | null;
    transport?: ApplePushTransport;
  } = {},
): Promise<ApplePushResult> {
  const token = dependencies.providerToken === undefined
    ? await prepareApplePushProviderToken(dependencies)
    : dependencies.providerToken;
  const now = dependencies.now?.() ?? Date.now();
  if (!token || now < token.issuedAt || now - token.issuedAt >= 60 * 60_000) return "failed";
  const { message } = request;
  const alert = message.kind === "alert";
  try {
    const response = await (dependencies.transport ?? http2Transport)({
      body: JSON.stringify({ ...request.data, aps: buildAps(request) }),
      headers: {
        authorization: `bearer ${token.value}`,
        "apns-collapse-id": request.collapseId.slice(0, 64),
        "apns-expiration": String(Math.floor(request.expiresAt.getTime() / 1_000)),
        "apns-priority": alert ? "10" : "5",
        "apns-push-type": alert ? "alert" : "background",
        "apns-topic": request.target.topic,
      },
      origin: request.target.environment === "production"
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com",
      path: `/3/device/${request.target.token}`,
      timeoutMs: APPLE_PUSH_TIMEOUT_MS,
    });
    if (response.status === 200) return "sent";
    if (response.status === 410 || (response.status === 400 && UNREGISTERED_REASONS.has(response.reason ?? ""))) {
      return "unregistered";
    }
    return "failed";
  } catch {
    return "failed";
  }
}

function buildAps(request: ApplePushRequest): Record<string, unknown> {
  const { message } = request;
  if (message.kind !== "alert") return { "content-available": 1 };
  return {
    alert: message.title ? { body: message.body, title: message.title } : { body: message.body },
    "content-available": 1,
    sound: "default",
    ...(request.threadId ? { "thread-id": request.threadId } : {}),
    ...(request.interruptionLevel ? { "interruption-level": request.interruptionLevel } : {}),
  };
}

async function providerToken(credentials: ApplePushCredentials, now: number): Promise<ApplePushProviderToken> {
  // Key id separates Apple rotations; team and signer also fence configuration changes.
  const identity = JSON.stringify([credentials.keyId, credentials.teamId, "kmsKeyVersion" in credentials ? credentials.kmsKeyVersion : "pem"]);
  if (cachedProviderToken?.identity === identity && now >= cachedProviderToken.token.issuedAt
    && now - cachedProviderToken.token.issuedAt < PROVIDER_TOKEN_REUSE_MS) {
    return cachedProviderToken.token;
  }
  if (pendingProviderToken?.identity === identity) return pendingProviderToken.promise;
  const pending = { identity, promise: signProviderToken(credentials, now) };
  pendingProviderToken = pending;
  try {
    const token = await pending.promise;
    cachedProviderToken = { identity, token };
    return token;
  } finally {
    if (pendingProviderToken === pending) pendingProviderToken = null;
  }
}

async function signProviderToken(credentials: ApplePushCredentials, now: number): Promise<ApplePushProviderToken> {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "ES256", kid: credentials.keyId })}.${encode({ iat: Math.floor(now / 1_000), iss: credentials.teamId })}`;
  const signature = "kmsKeyVersion" in credentials
    ? p256DerSignatureToJose(Buffer.from((await getHostedWebCryptoConfig().gcpKms.asymmetricSign({
      keyVersionName: credentials.kmsKeyVersion, message: Buffer.from(unsigned),
    })).signature, "base64"))
    : sign("sha256", Buffer.from(unsigned), { dsaEncoding: "ieee-p1363", key: credentials.privateKey });
  return { issuedAt: now, value: `${unsigned}.${signature.toString("base64url")}` };
}

/** KMS returns DER INTEGERs; ES256 requires two unsigned, left-padded 32-byte scalars. */
export function p256DerSignatureToJose(der: Buffer): Buffer {
  const invalid = () => new Error("Invalid APNs P-256 signature.");
  if (der.length < 8 || der.length > 72 || der[0] !== 0x30 || der[1] !== der.length - 2) throw invalid();
  const jose = Buffer.alloc(64);
  let offset = 2;
  for (const end of [32, 64]) {
    if (der[offset++] !== 0x02) throw invalid();
    const length = der[offset++];
    if (!length || length > 33 || offset + length > der.length) throw invalid();
    let scalar = der.subarray(offset, offset + length);
    offset += length;
    if (scalar[0]! >= 0x80) throw invalid();
    if (scalar.length > 1 && scalar[0] === 0) {
      if (scalar[1]! < 0x80) throw invalid();
      scalar = scalar.subarray(1);
    }
    if (scalar.length > 32 || scalar.every(byte => byte === 0)) throw invalid();
    scalar.copy(jose, end - scalar.length);
  }
  if (offset !== der.length) throw invalid();
  return jose;
}

const http2Transport: ApplePushTransport = (input) => new Promise((resolve, reject) => {
  const session = connect(input.origin);
  const settle = () => {
    clearTimeout(timer);
    session.close();
  };
  const fail = (error: unknown) => {
    settle();
    session.destroy();
    reject(error);
  };
  const timer = setTimeout(() => fail(new Error("Apple push timed out.")), input.timeoutMs);
  session.on("error", fail);
  const stream = session.request({ ...input.headers, ":method": "POST", ":path": input.path, "content-type": "application/json" });
  let status = 0;
  let body = "";
  stream.setEncoding("utf8");
  stream.on("response", (headers) => { status = Number(headers[":status"]); });
  stream.on("data", (chunk: string) => { if (body.length < 1_024) body += chunk; });
  stream.on("end", () => {
    settle();
    resolve({ reason: readRejectionReason(body), status });
  });
  stream.on("error", fail);
  stream.end(input.body);
});

function readRejectionReason(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && "reason" in parsed && typeof parsed.reason === "string"
      ? parsed.reason
      : null;
  } catch {
    return null;
  }
}
