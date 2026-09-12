import { setTimeout as sleep } from "node:timers/promises";

import { normalizeHostedExecutionBaseUrl } from "@murphai/hosted-execution/env";
import { assertHostedRuntimeWebProtocolAdmission } from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_MAX_BYTES,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_PATH,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION,
} from "@murphai/hosted-execution/runtime-control";
import {
  createHostedWebCallbackSignatureHeaders,
  readHostedWebCallbackSigningEnvironment,
} from "../src/web-callback-auth.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;
export const HOSTED_WEB_PROTOCOL_PROBE_TIMEOUT_MS = 10_000;
const SAMPLE_COUNT = 3;
const SAMPLE_INTERVAL_MS = 1_000;

// Every boundary gets fresh, spaced observations. A failing sample stops this
// attempt; we never retry an incompatible response until a lucky replica passes.
export async function assertHostedWebProtocolAdmission(
  source: EnvSource,
  options: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<unknown>;
  } = {},
): Promise<void> {
  let origin: string | null;
  try {
    origin = normalizeHostedExecutionBaseUrl(source.HOSTED_WEB_BASE_URL, { requireOriginOnly: true });
  } catch {
    throw admissionFailure("web_origin");
  }
  if (!origin) throw admissionFailure("web_origin");
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    if (sample > 0) await (options.sleep ?? sleep)(SAMPLE_INTERVAL_MS);
    await probeWithDeadline(new URL(HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_PATH, origin), source, options);
  }
}

async function probeWithDeadline(
  url: URL,
  source: EnvSource,
  options: { fetchImpl?: typeof fetch },
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(admissionFailure("timeout"));
    }, HOSTED_WEB_PROTOCOL_PROBE_TIMEOUT_MS);
  });
  try {
    await Promise.race([probe(url, source, options, controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function probe(
  url: URL,
  source: EnvSource,
  options: { fetchImpl?: typeof fetch },
  signal: AbortSignal,
): Promise<void> {
  const nonce = crypto.randomUUID();
  url.searchParams.set("schemaVersion", String(HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION));
  url.searchParams.set("nonce", nonce);
  let headers: Record<string, string>;
  try {
    headers = await createHostedWebCallbackSignatureHeaders({
      environment: readHostedWebCallbackSigningEnvironment(source),
      method: "GET", path: url.pathname, search: url.search, nonce, payload: "",
    });
  } catch {
    throw admissionFailure("signing_configuration");
  }
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET", redirect: "manual", cache: "no-store", credentials: "omit", signal,
      headers: { ...headers, accept: "application/json", "cache-control": "no-store", pragma: "no-cache" },
    });
  } catch {
    throw admissionFailure("unavailable");
  }
  try {
    if (response.status !== 200 || response.redirected) throw admissionFailure(`http_${response.status}`);
    if (!/(?:^|,)\s*no-store\s*(?:,|$)/iu.test(response.headers.get("cache-control") ?? "")
      || (response.headers.has("age") && response.headers.get("age") !== "0")
      || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      throw admissionFailure("uncached_json_required");
    }
    const value = await readBoundedJson(response, signal);
    assertHostedRuntimeWebProtocolAdmission(value, nonce);
  } finally {
    // Do not await cancellation: a broken remote stream must not extend the deadline.
    if (!response.body?.locked) void response.body?.cancel().catch(() => {});
  }
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_MAX_BYTES)) {
    throw admissionFailure("response_size");
  }
  if (!response.body) throw admissionFailure("response_body");
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read().catch(() => {
        throw admissionFailure("response_read");
      });
      if (done) break;
      size += value.byteLength;
      if (size > HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_MAX_BYTES) throw admissionFailure("response_size");
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw admissionFailure("invalid_json");
  }
}

function admissionFailure(reason: string): Error {
  return new Error(`Hosted Web protocol admission failed: ${reason}. No further activation is permitted; finish the compatible Web rollout and retry.`);
}
