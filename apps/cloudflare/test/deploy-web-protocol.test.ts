import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeHostedExecutionSignedRequestPayload, readHostedExecutionSignatureHeaders } from "@murphai/hosted-execution/auth";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import { assertHostedRuntimeWebProtocolAdmission, parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import { HOSTED_RUNTIME_LOG_EVENT_CODES, HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_MAX_BYTES } from "@murphai/hosted-execution/runtime-control";
import { buildRuntimeProcessingSummaryEntry } from "../src/user-runner/diagnostics";
import { syntheticHostedWebProtocolAdmission } from "./helpers/hosted-web-protocol";
import { assertHostedWebProtocolAdmission, HOSTED_WEB_PROTOCOL_PROBE_TIMEOUT_MS } from "../scripts/deploy-web-protocol";

let source: Record<string, string>;
let publicKey: CryptoKey;
beforeEach(async () => {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  publicKey = keys.publicKey;
  source = { HOSTED_WEB_BASE_URL: "https://web.example.test", HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey)) };
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const headers = { "cache-control": "no-store", "content-type": "application/json" };
const noSleep = async () => {};
const nonceFrom = (input: RequestInfo | URL) => new URL(input instanceof Request ? input.url : String(input)).searchParams.get("nonce")!;
const reply = (input: RequestInfo | URL) => Response.json(syntheticHostedWebProtocolAdmission(nonceFrom(input)), { headers });

it("signs fresh spaced samples using the public wire contract, without caching admission", async () => {
  const nonces = new Set<string>();
  const sleep = vi.fn(noSleep);
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    expect(init).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store", credentials: "omit" });
    const nonce = nonceFrom(input);
    expect(nonces.has(nonce)).toBe(false);
    nonces.add(nonce);
    const request = new Request(input, init);
    const url = new URL(request.url);
    const signed = readHostedExecutionSignatureHeaders(request.headers);
    expect(signed).toMatchObject({ keyId: "v1", nonce });
    expect(request.headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBeNull();
    if (!signed.signature || !signed.timestamp) throw new Error("Missing synthetic request signature.");
    expect(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, publicKey,
      Uint8Array.from(Buffer.from(signed.signature, "base64url")).buffer,
      encodeHostedExecutionSignedRequestPayload({
        method: request.method, path: url.pathname, search: url.search,
        nonce: signed.nonce, timestamp: signed.timestamp, payload: "", userId: null,
      }),
    )).toBe(true);
    return reply(input);
  });
  for (let attempt = 0; attempt < 2; attempt += 1) await assertHostedWebProtocolAdmission(source, { fetchImpl, sleep });
  expect(fetchImpl).toHaveBeenCalledTimes(6);
  expect(sleep.mock.calls).toEqual([[1000], [1000], [1000], [1000]]);
});

it("parses the actual processing-summary producer payload and rejects it with an older strict reader", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2000-01-01T00:00:00.000Z"));
  const entry = buildRuntimeProcessingSummaryEntry({ stage: "admission", details: {} }, undefined, Date.now());
  // The same synthetic wire shape is sent through Web's real log route in its
  // owner test. No application imports another application's private sources.
  expect(entry).toEqual({
    at: "2000-01-01T00:00:00.000Z", component: "runner", eventCode: "runner.processing_finished",
    level: "warn", phase: "invoke",
    redactedJson: { runtimeProcessingStage: "admission", runtimeProcessingOutcome: "threw", runtimeProcessingElapsedMs: 0 },
  });
  expect(parseHostedRuntimeLogRequest({ entries: [entry] }).entries).toEqual([entry]);
  const includes = HOSTED_RUNTIME_LOG_EVENT_CODES.includes.bind(HOSTED_RUNTIME_LOG_EVENT_CODES);
  vi.spyOn(HOSTED_RUNTIME_LOG_EVENT_CODES, "includes").mockImplementation(code => code !== entry.eventCode && includes(code));
  expect(() => parseHostedRuntimeLogRequest({ entries: [entry] })).toThrow();
});

it("accepts reader supersets, but not missing audience or emitted log codes", () => {
  const evidence = syntheticHostedWebProtocolAdmission("synthetic-nonce");
  expect(() => assertHostedRuntimeWebProtocolAdmission({ ...evidence, runtimeLogEventCodes: [...evidence.runtimeLogEventCodes, "future.synthetic"] }, evidence.nonce)).not.toThrow();
  const legacy = { ...evidence, threadRouteAuthority: { direct: { authorized: true }, group: { authorized: true } } };
  expect(() => assertHostedRuntimeWebProtocolAdmission(legacy, evidence.nonce)).toThrow("thread_route_audience");
  const olderReader = { ...evidence, runtimeLogEventCodes: evidence.runtimeLogEventCodes.filter(code => code !== "runner.processing_finished") };
  expect(() => assertHostedRuntimeWebProtocolAdmission(olderReader, evidence.nonce)).toThrow("runtime_log_event:runner.processing_finished");
});

it.each([
  { schemaVersion: 2 }, { nonce: "stale" }, { kind: "unrelated" }, { runtimeLogEventCodes: [42] },
  { threadRouteAuthority: { direct: { authorized: false }, group: { authorized: true } } },
  { threadRouteAuthority: { direct: { authorized: true, threadIsDirect: false }, group: { authorized: true, threadIsDirect: true } } },
  { threadRouteAuthority: { direct: { authorized: true, threadIsDirect: "true" }, group: { authorized: true } } },
])("fails malformed, denied or unknown evidence closed: %j", change => {
  const evidence = { ...syntheticHostedWebProtocolAdmission("synthetic-nonce"), ...change };
  expect(() => assertHostedRuntimeWebProtocolAdmission(evidence, "synthetic-nonce")).toThrow();
});

it("stops on an incompatible sample during propagation instead of retrying until lucky", async () => {
  let calls = 0;
  await expect(assertHostedWebProtocolAdmission(source, { sleep: noSleep, fetchImpl: async input => {
    calls += 1;
    return calls === 2 ? new Response(null, { status: 404 }) : reply(input);
  } })).rejects.toThrow("http_404");
  expect(calls).toBe(2);
});

it.each([301, 302, 307, 308, 401, 403, 404, 500, 503])("rejects status %s without reading or forwarding credentials", async status => {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response("synthetic remote detail", { status, headers: { location: "https://other.example.test" } }));
  await expect(assertHostedWebProtocolAdmission(source, { sleep: noSleep, fetchImpl })).rejects.toThrow(`http_${status}`);
  expect(fetchImpl).toHaveBeenCalledOnce();
});

const invalidResponseHeaders: ReadonlyArray<Record<string, string>> = [
  { "cache-control": "public, max-age=60" }, { age: "1" }, { "content-type": "text/html" },
  { "content-length": String(HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_MAX_BYTES + 1) },
];
it.each(invalidResponseHeaders)("rejects cached, wrong MIME or oversize metadata %j", overrides => {
  return expect(assertHostedWebProtocolAdmission(source, { sleep: noSleep,
    fetchImpl: async input => Response.json(syntheticHostedWebProtocolAdmission(nonceFrom(input)), { headers: { ...headers, ...overrides } }),
  })).rejects.toThrow("Hosted Web protocol admission failed");
});

it("bounds streamed bytes and redacts transport and body read failures", async () => {
  const factories: Array<() => Promise<Response>> = [
    async () => new Response("x".repeat(HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_MAX_BYTES + 1), { headers }),
    async () => new Response("not JSON: synthetic remote detail", { headers }),
    async () => { throw new Error("synthetic remote detail"); },
    async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("synthetic remote detail")); } }), { headers }),
  ];
  for (const fetchImpl of factories) {
    const failure = await assertHostedWebProtocolAdmission(source, { sleep: noSleep, fetchImpl }).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("Hosted Web protocol admission failed");
    expect(failure.message).not.toContain("synthetic remote detail");
  }
});

it.each(["fetch", "body"])("bounds a stalled %s, including fetch implementations that ignore cancellation", async phase => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const fetchImpl = vi.fn<typeof fetch>(async () => phase === "fetch" ? new Promise<Response>(() => {})
    : new Response(new ReadableStream({ cancel }), { headers }));
  const failure = assertHostedWebProtocolAdmission(source, { fetchImpl, sleep: noSleep }).catch(error => error);
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(HOSTED_WEB_PROTOCOL_PROBE_TIMEOUT_MS);
  expect((await failure).message).toContain("timeout");
  if (phase === "body") expect(cancel).toHaveBeenCalledOnce();
});
