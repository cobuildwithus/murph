import { Buffer } from "node:buffer";
import { readHostedProviderEgressCredentialSigningSecret, verifyHostedProviderEgressCredential } from "./hosted-provider-egress-credential.ts";
import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";
import type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";

export const HOSTED_OPENAI_LIVE_PATH = "/v1/live/sessions";
export const HOSTED_OPENAI_LIVE_BODY_LIMIT = 128 * 1024;
export interface HostedLiveResourceOwner {
  userId: string;
  attemptId: string;
  leaseGeneration: string;
}
const CLIENT_EVENTS = new Set(["session.input_audio.mute", "session.input_audio.unmute", "session.close"]);
const SERVER_EVENTS = new Set([
  "session.started", "session.closed", "session.input_audio.muted", "session.input_audio.unmuted",
  "session.input_transcript.delta", "session.output_transcript.delta", "session.usage.updated", "error", "info",
]);

export function readHostedLiveAttachReference(pathname: string): string | null {
  return /^\/v1\/live\/sessions\/([A-Za-z0-9_.-]{1,4096})\/attach$/u.exec(pathname)?.[1] ?? null;
}

/** Restrict the paid frontend to native client delegation and browser media/control. */
export function isHostedLiveCreationBody(body: ArrayBuffer): boolean {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch { return false; }
  if (!record(value) || !onlyKeys(value, ["session", "transport"])) return false;
  const { session, transport } = value;
  if (!record(session) || !onlyKeys(session, ["model", "instructions", "audio", "delegation", "client", "input"])) return false;
  if (session.model !== "gpt-live-1" || typeof session.instructions !== "string") return false;
  if (!record(session.delegation) || !onlyKeys(session.delegation, ["type"]) || session.delegation.type !== "client") return false;
  if (!record(transport) || !onlyKeys(transport, ["type", "sdp"]) || transport.type !== "webrtc"
    || typeof transport.sdp !== "string" || !transport.sdp.startsWith("v=0")) return false;
  return validBrowserPermissions(session.client);
}

function validBrowserPermissions(client: unknown): boolean {
  if (!record(client) || !onlyKeys(client, ["data_channel"]) || !record(client.data_channel)) return false;
  const channel = client.data_channel;
  if (!onlyKeys(channel, ["allowed_client_events", "allowed_server_events"])) return false;
  return Array.isArray(channel.allowed_client_events)
    && channel.allowed_client_events.every((event) => typeof event === "string" && CLIENT_EVENTS.has(event))
    && Array.isArray(channel.allowed_server_events)
    && channel.allowed_server_events.every((event) => record(event) && onlyKeys(event, ["type"])
      && typeof event.type === "string" && SERVER_EVENTS.has(event.type));
}

/** Bind an opaque provider resource without introducing another durable call owner. */
export async function createHostedLiveSessionReference(
  sessionId: string, owner: HostedLiveResourceOwner, source: Readonly<Record<string, unknown>>,
): Promise<string> {
  const payload = Buffer.from(sessionId).toString("base64url");
  const signature = await crypto.subtle.sign("HMAC", await signingKey(source), signedBytes(payload, owner));
  return `ml1.${payload}.${Buffer.from(signature).toString("base64url")}`;
}

export async function openHostedLiveSessionReference(
  reference: string, owner: HostedLiveResourceOwner, source: Readonly<Record<string, unknown>>,
): Promise<string | null> {
  const match = /^ml1\.([A-Za-z0-9_-]{1,2048})\.([A-Za-z0-9_-]{43})$/u.exec(reference);
  if (!match) return null;
  const [, payload, signature] = match;
  if (!await crypto.subtle.verify("HMAC", await signingKey(source), Buffer.from(signature!, "base64url"), signedBytes(payload!, owner))) return null;
  return Buffer.from(payload!, "base64url").toString("utf8");
}

/** An already-created resource remains attachable while its exact owner retires,
 * so native cancellation can join and close it after allowance revocation. */
export async function authorizeHostedLiveAttachment(input: {
  credential: string; reference: string; source: RunnerOutboundEnvironmentSource;
}): Promise<{ sessionId: string; owner: HostedLiveResourceOwner } | null> {
  const credential = await verifyHostedProviderEgressCredential({ credential: input.credential, source: input.source });
  if (!credential.ok || credential.claims.providerKind !== "openai") return null;
  const { claims } = credential;
  const result = await commandHostedRuntimeOwner({ source: input.source, userId: claims.userId, command: { operation: "reconcile" } });
  const current = result.owner;
  if (result.cutover !== "postgres" || !current?.attemptId || current.phase === "idle"
    || current.runnerContainerName !== claims.runnerContainerName) return null;
  const owner = { userId: claims.userId, attemptId: current.attemptId, leaseGeneration: current.generation };
  const sessionId = await openHostedLiveSessionReference(input.reference, owner, input.source);
  return sessionId ? { sessionId, owner } : null;
}

async function signingKey(source: Readonly<Record<string, unknown>>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(readHostedProviderEgressCredentialSigningSecret(source)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function signedBytes(payload: string, owner: HostedLiveResourceOwner): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(["murph:live-session:v1", owner.userId, owner.attemptId, owner.leaseGeneration, payload]));
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
