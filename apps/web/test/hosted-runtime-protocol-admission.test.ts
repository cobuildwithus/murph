import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertHostedRuntimeWebProtocolAdmission,
  parseHostedExternalThreadRouteAuthorityResponse,
} from "@murphai/hosted-execution/parsers";
import {
  buildHostedRuntimeLogProtocolProbe,
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_PATH,
  type HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import { encodeHostedExecutionSignedRequestPayload } from "@murphai/hosted-execution/auth";

const edges = vi.hoisted(() => ({ consume: vi.fn(), write: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/hosted-execution/internal-request-nonces", () => ({
  PrismaHostedCallbackRequestNonceStore: class {
    consumeHostedCallbackRequestNonce = edges.consume;
  },
}));
vi.mock("@/src/lib/hosted-runtime-log/write", () => ({ writeHostedRuntimeLogs: edges.write }));
vi.mock("@/src/lib/hosted-workspace/store", () => ({ claimHostedAcceptedAttemptFailureRecheck: async () => false }));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedRuntimeRecheckRuntime: vi.fn() }));
vi.mock("@/src/lib/hosted-runtime-log/personal-patterns-run-alert", () => ({
  hasHostedPersonalPatternsRunAlert: () => false, reportHostedPersonalPatternsRunAlerts: vi.fn(),
}));

import { GET } from "../app/api/internal/hosted-runtime/protocol-admission/route";
import { POST as log } from "../app/api/internal/hosted-runtime/log/route";

// Synthetic boundary payload; the Cloudflare owner test checks the actual
// processing-summary producer against this shape using the public log parser.
const processingSummary = { entries: [{
  at: "2000-01-01T00:00:00.000Z", component: "runner", eventCode: "runner.processing_finished",
  level: "warn", phase: "invoke",
  redactedJson: { runtimeProcessingStage: "admission", runtimeProcessingOutcome: "threw", runtimeProcessingElapsedMs: 0 },
}] } satisfies HostedRuntimeLogRequest;

let privateKey: CryptoKey;
beforeEach(async () => {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  privateKey = keys.privateKey;
  vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_KEY_ID", "v1");
  vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK", JSON.stringify(publicJwk));
  vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON", JSON.stringify({ v1: publicJwk }));
  const seen = new Set<string>();
  edges.consume.mockReset().mockImplementation(async ({ nonceHash }: { nonceHash: string }) => {
    if (seen.has(nonceHash)) return false;
    seen.add(nonceHash);
    return true;
  });
  edges.write.mockReset().mockImplementation(async ({ entries }: { entries: unknown[] }) => entries.length);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function request(options: { version?: string; payload?: unknown; userId?: string } = {}) {
  const nonce = crypto.randomUUID();
  const method = options.payload === undefined ? "GET" : "POST";
  const url = new URL(method === "GET" ? HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_PATH : "/api/internal/hosted-runtime/log", "https://web.example.test");
  if (method === "GET") {
    url.searchParams.set("schemaVersion", options.version ?? "1");
    url.searchParams.set("nonce", nonce);
  }
  const payload = options.payload === undefined ? "" : JSON.stringify(options.payload);
  // Same public payload encoder and WebCrypto signer pattern as Web's auth tests.
  const timestamp = new Date().toISOString();
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateKey,
    encodeHostedExecutionSignedRequestPayload({
      method, path: url.pathname, search: url.search, nonce, payload, timestamp, userId: options.userId,
    }),
  );
  const headers = new Headers({
    "content-type": "application/json",
    [HOSTED_EXECUTION_NONCE_HEADER]: nonce,
    [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: "v1",
    [HOSTED_EXECUTION_SIGNATURE_HEADER]: Buffer.from(signature).toString("base64url"),
    [HOSTED_EXECUTION_TIMESTAMP_HEADER]: timestamp,
  });
  if (options.userId) headers.set(HOSTED_EXECUTION_USER_ID_HEADER, options.userId);
  return new Request(url, { method, headers, ...(method === "POST" ? { body: payload } : {}) });
}

describe("served Web protocol admission", () => {
  it("composes a signed wire request, real GET authentication, live parser evidence and public candidate validator", async () => {
    const probe = await request();
    const response = await GET(probe);
    expect(response.status).toBe(200);
    const evidence = await response.json();
    expect(() => assertHostedRuntimeWebProtocolAdmission(evidence, probe.headers.get(HOSTED_EXECUTION_NONCE_HEADER)!)).not.toThrow();
    expect(edges.consume).toHaveBeenCalledOnce();
    expect(edges.consume).toHaveBeenCalledWith(expect.objectContaining({ userId: "system:hosted-runtime-protocol-admission" }));
    expect(edges.write).not.toHaveBeenCalled();
  });

  it("binds evidence to a signed nonce, disallows member identity, and rejects replay and version changes", async () => {
    const probe = await request();
    const response = await GET(probe.clone());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const evidence = await response.json();
    expect(() => assertHostedRuntimeWebProtocolAdmission(evidence, probe.headers.get(HOSTED_EXECUTION_NONCE_HEADER)!)).not.toThrow();
    expect((await GET(probe.clone())).status).toBe(401);
    expect((await GET(await request({ userId: "synthetic-member" }))).status).toBe(401);
    expect((await GET(await request({ version: "2" }))).status).toBe(400);
    const tampered = await request();
    const url = new URL(tampered.url);
    url.searchParams.set("nonce", crypto.randomUUID());
    expect((await GET(new Request(url, tampered))).status).toBe(401);
    const unsigned = await GET(new Request(probe.url));
    expect(unsigned.status).toBe(401);
    expect(unsigned.headers.get("cache-control")).toBe("no-store");
  });

  it("passes every advertised event through the actual Web log handler before persistence", async () => {
    const evidence = await (await GET(await request())).json();
    expect(evidence.runtimeLogEventCodes).toEqual(HOSTED_RUNTIME_LOG_EVENT_CODES);
    for (let start = 0; start < HOSTED_RUNTIME_LOG_EVENT_CODES.length; start += HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES) {
      const entries = HOSTED_RUNTIME_LOG_EVENT_CODES.slice(start, start + HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES)
        .flatMap(code => buildHostedRuntimeLogProtocolProbe(code).entries);
      const response = await log(await request({ payload: { entries }, userId: "synthetic-member" }));
      expect(response.status).toBe(200);
      expect(edges.write).toHaveBeenLastCalledWith({ entries, userId: "synthetic-member" });
    }
    expect((await log(await request({ payload: processingSummary, userId: "synthetic-member" }))).status).toBe(200);
    expect(edges.write).toHaveBeenLastCalledWith({ entries: processingSummary.entries, userId: "synthetic-member" });
  });

  it("cannot advertise a newly produced event when the real strict reader still rejects it", async () => {
    // Synthetic older enum membership, not a mocked parser or handler. Keep the
    // advertised source enum unchanged to prove the witness cannot silently drift.
    const includes = HOSTED_RUNTIME_LOG_EVENT_CODES.includes.bind(HOSTED_RUNTIME_LOG_EVENT_CODES);
    vi.spyOn(HOSTED_RUNTIME_LOG_EVENT_CODES, "includes").mockImplementation(code => code !== "runner.processing_finished" && includes(code));
    expect((await log(await request({ payload: processingSummary, userId: "synthetic-member" }))).status).toBe(400);
    expect((await GET(await request())).status).not.toBe(200);
    expect(edges.write).not.toHaveBeenCalled();
    const oldEntry = buildHostedRuntimeLogProtocolProbe("runner.started");
    expect((await log(await request({ payload: oldEntry, userId: "synthetic-member" }))).status).toBe(200);
  });

  it("retains legacy authority semantics without manufacturing audience", () => {
    expect(parseHostedExternalThreadRouteAuthorityResponse({ authorized: true })).toBeUndefined();
    for (const threadIsDirect of [true, false]) {
      expect(parseHostedExternalThreadRouteAuthorityResponse({ authorized: true, threadIsDirect })).toEqual({ threadIsDirect });
    }
    for (const value of [{ authorized: false }, { authorized: true, threadIsDirect: null }, { authorized: true, assistantAskFallbackRequired: "yes" }]) {
      expect(() => parseHostedExternalThreadRouteAuthorityResponse(value)).toThrow();
    }
  });
});
