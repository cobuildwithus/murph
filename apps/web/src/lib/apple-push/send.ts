import "server-only";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect } from "node:http2";

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
// low priority and throttles them. Alerts are immediate but visible.
export type ApplePushMessage =
  | { kind: "background" }
  | { kind: "alert"; body: string; title: string };

export type ApplePushResult = "sent" | "unregistered" | "failed";

export interface ApplePushRequest {
  collapseId: string;
  data: Record<string, string>;
  expiresAt: Date;
  message: ApplePushMessage;
  target: ApplePushTarget;
}

export interface ApplePushCredentials {
  keyId: string;
  privateKey: KeyObject;
  teamId: string;
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

let cachedProviderToken: { issuedAt: number; keyId: string; value: string } | null = null;

export function readApplePushCredentials(source: Readonly<Record<string, string | undefined>> = process.env): ApplePushCredentials | null {
  const teamId = normalizeNullableString(source.APNS_TEAM_ID);
  const keyId = normalizeNullableString(source.APNS_KEY_ID);
  const pem = normalizeNullableString(source.APNS_PRIVATE_KEY)?.replaceAll("\\n", "\n");
  if (!teamId || !keyId || !pem) return null;
  return { keyId, privateKey: createPrivateKey(pem), teamId };
}

// Missing credentials are a configured kill switch, so they report `failed`.
export async function sendApplePush(
  request: ApplePushRequest,
  dependencies: {
    credentials?: ApplePushCredentials | null;
    now?: () => number;
    transport?: ApplePushTransport;
  } = {},
): Promise<ApplePushResult> {
  const credentials = dependencies.credentials === undefined ? readApplePushCredentials() : dependencies.credentials;
  if (!credentials) return "failed";
  const now = dependencies.now?.() ?? Date.now();
  const { message } = request;
  const alert = message.kind === "alert";
  try {
    const response = await (dependencies.transport ?? http2Transport)({
      body: JSON.stringify({
        ...request.data,
        aps: message.kind === "alert"
          ? { alert: { body: message.body, title: message.title }, "content-available": 1 }
          : { "content-available": 1 },
      }),
      headers: {
        authorization: `bearer ${providerToken(credentials, now)}`,
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

function providerToken(credentials: ApplePushCredentials, now: number): string {
  if (cachedProviderToken?.keyId === credentials.keyId && now - cachedProviderToken.issuedAt < PROVIDER_TOKEN_REUSE_MS) {
    return cachedProviderToken.value;
  }
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "ES256", kid: credentials.keyId })}.${encode({ iat: Math.floor(now / 1_000), iss: credentials.teamId })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { dsaEncoding: "ieee-p1363", key: credentials.privateKey });
  cachedProviderToken = { issuedAt: now, keyId: credentials.keyId, value: `${unsigned}.${signature.toString("base64url")}` };
  return cachedProviderToken.value;
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
