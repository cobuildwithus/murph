import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedExecutionStructuredLogRecord,
  type HostedExecutionStructuredLogInput,
} from "@murphai/hosted-execution";
import {
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
} from "../src/runtime-platform/web-control-transport.ts";
import { TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON } from "./hosted-execution-fixtures.ts";

const mocks = vi.hoisted(() => ({
  log: vi.fn<(input: HostedExecutionStructuredLogInput) => void>(),
}));
vi.mock("@murphai/hosted-execution", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/hosted-execution")>(),
  emitHostedExecutionStructuredLog: mocks.log,
}));

const privateBody = "synthetic-private-body-café-🧪-雪";
const privateParameter = "synthetic-private-parameter";
const privateMime = "application/x-synthetic-private-mime";
const invalidJsonMessage = "Hosted runtime control-plane response returned invalid JSON.";
const mimeCases = [
  { mime: `application/json; charset=utf-8; private=${privateParameter}`, category: "json" },
  { mime: `${privateMime}+json; private=${privateParameter}`, category: "json" },
  { mime: `TeXt/HtMl; charset=UTF-8; private=${privateParameter}`, category: "html" },
  { mime: `text/plain; private=${privateParameter}`, category: "text" },
  { mime: null, category: "missing" },
  { mime: "", category: "other" },
  { mime: `${privateMime}; private=${privateParameter}`, category: "other" },
  { mime: "text/x-synthetic-private-mime+json", category: "other" },
];

// Keep the real signing, transport, decoder and retained-log sanitizer owners.
function harness(body: string | null, mime: string | null, sensitive: boolean) {
  const response = new Response(body, { status: 200 });
  // String bodies otherwise receive an implicit text/plain content-type.
  if (mime === null) response.headers.delete("content-type");
  else response.headers.set("content-type", mime);
  const responseHeaders = Array.from(response.headers.entries());
  const clone = vi.spyOn(response, "clone");
  const fetchImpl = vi.fn<typeof fetch>(async () => response);
  const bodyBytes = new TextEncoder().encode(body ?? "").byteLength;
  return {
    bodyBytes, clone, fetchImpl, response, responseHeaders,
    run: () => fetchHostedWebControlPlaneJson({
      boundUserId: "member_web_control_diagnostics",
      description: "Hosted workspace read",
      fetchImpl,
      route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.workspaceRead,
      replayOnceOnRetryableFailure: true,
      ...(sensitive ? { sensitiveResponseBody: { maxBytes: bodyBytes } } : {}),
      timeoutMs: 10_000,
      transport: {
        mode: "direct",
        callbackSigning: { keyId: "v1", privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON },
        webControlBaseUrl: "https://web.example.test",
        workspaceCheckpointBridge: null,
      },
    }),
  };
}

function expectObservations(h: ReturnType<typeof harness>, category: string | null) {
  expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  expect(h.clone).not.toHaveBeenCalled();
  expect(h.response.bodyUsed).toBe(h.response.body !== null);
  expect(Array.from(h.response.headers.entries())).toEqual(h.responseHeaders);
  const entries = mocks.log.mock.calls.map(([entry]) => entry);
  expect(entries.map((entry) => entry.message)).toEqual([
    "Hosted runtime control-plane request started.",
    "Hosted runtime control-plane response received.",
    ...(category === null ? [] : [invalidJsonMessage]),
  ]);
  const retained = entries.map((entry) => buildHostedExecutionStructuredLogRecord(entry));
  for (const entry of entries) {
    expect(entry).not.toHaveProperty("error");
    expect(entry.details).not.toHaveProperty("errorMessage");
    expect(entry.details).not.toHaveProperty("errorStack");
    if (entry.message === invalidJsonMessage) {
      expect(entry).toMatchObject({ component: "hosted.runtime.control-plane", level: "warn" });
    }
  }
  for (const entry of [...entries, ...retained]) {
    if (entry.message === invalidJsonMessage) {
      expect(entry.details).toMatchObject({
        responseBodyBytes: h.bodyBytes,
        responseMimeCategory: category,
        responseStatus: 200,
      });
    } else {
      expect(entry.details).not.toHaveProperty("responseMimeCategory");
    }
    for (const field of [
      "responseBodyShape", "responseExpectedBodyBytes", "responseByteCountComparison",
      "responseContentEncodingCategory", "responseContentLengthCategory",
    ]) {
      expect(entry.details).not.toHaveProperty(field);
    }
  }
  const logs = JSON.stringify({ entries, retained });
  for (const sentinel of ["synthetic-private-body", "x-synthetic-private-mime", privateParameter]) {
    expect(logs).not.toContain(sentinel);
  }
}

describe.each([false, true])("non-device MIME diagnostics (sensitive=%s)", (sensitive) => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each(mimeCases)("categorizes invalid JSON without replay (case %#)", async ({ mime, category }) => {
    const h = harness(`{${privateBody}`, mime, sensitive);
    const result = h.run();
    await expect(result).rejects.toBeInstanceOf(Error);
    await expect(result).rejects.toMatchObject(sensitive ? {
      name: "HostedWebControlPlaneSensitiveResponseInvalidJsonError",
      code: "HOSTED_WEB_CONTROL_SENSITIVE_RESPONSE_INVALID_JSON",
      message: "Hosted workspace read returned invalid JSON.",
    } : {
      name: "Error",
      message: "Hosted workspace read returned invalid JSON.",
      cause: expect.any(SyntaxError),
    });
    if (sensitive) await expect(result).rejects.not.toHaveProperty("cause");
    expectObservations(h, category);
  });

  it.each(mimeCases)("accepts valid JSON regardless of MIME with no new success metadata (case %#)", async ({ mime }) => {
    const payload = { diagnosticTestOnly: privateBody };
    const h = harness(JSON.stringify(payload), mime, sensitive);
    await expect(h.run()).resolves.toEqual(payload);
    expectObservations(h, null);
  });

  it.each([null, "", " \n\t", "null", "[]", "42"])("preserves empty and non-object JSON responses (case %#)", async (body) => {
    const h = harness(body, `${privateMime}; private=${privateParameter}`, sensitive);
    await expect(h.run()).resolves.toEqual(body?.trim() ? JSON.parse(body) : null);
    expectObservations(h, null);
  });
});
