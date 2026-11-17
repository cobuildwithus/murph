import { RequestBodyTooLargeError } from "@murphai/hosted-execution/request-input";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJsonErrorResponse, readRawBodyBuffer } from "../src/lib/http";
import { jsonError, readHostedOnboardingJsonObject, readHostedOnboardingRawBodyText } from "../src/lib/hosted-onboarding/http";

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-onboarding/webhook-service", () => ({ handleHostedOnboardingLinqWebhook: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/visible-secondary-webhooks", () => ({ withHostedVisibleSecondaryLinqOutcomes: (handler: unknown) => handler }));
vi.mock("@/src/lib/device-sync/agent-session-service", () => ({ createHostedDeviceSyncAgentSessionContext: () => ({ env: {}, store: {} }) }));
vi.mock("@/src/lib/device-sync/auth", () => ({ assertBrowserMutationOrigin: vi.fn(), requireAuthenticatedHostedUser: vi.fn().mockResolvedValue({}) }));

import { POST as bootstrap } from "../app/api/internal/hosted-execution/email/bootstrap/route";
import { POST as replyAlias } from "../app/api/internal/hosted-execution/email/register-reply-alias/route";
import { POST as emailIngress } from "../app/api/internal/hosted-mailbox/email-ingress/route";
import { POST as linq } from "../app/api/hosted-onboarding/linq/webhook/route";
import { POST as pair } from "../app/api/device-sync/agents/pair/route";

const routes = [
  { name: "bootstrap", handle: bootstrap, limit: 2048, code: "HOSTED_EMAIL_PUBLIC_BOOTSTRAP_BODY_TOO_LARGE", message: "Hosted email public bootstrap body is too large." },
  { name: "reply alias", handle: replyAlias, limit: 2048, code: "HOSTED_EMAIL_REPLY_ALIAS_BODY_TOO_LARGE", message: "Hosted email reply alias registration body is too large." },
  { name: "email ingress", handle: emailIngress, limit: 65536, code: "HOSTED_EMAIL_INGRESS_CALLBACK_BODY_TOO_LARGE", message: "Hosted email ingress callback body is too large." },
  { name: "Linq", handle: linq, limit: 262144, code: "LINQ_WEBHOOK_BODY_TOO_LARGE", message: "Linq webhook body is too large." },
  { name: "agent pair", handle: pair, limit: 1024, code: "AGENT_PAIR_BODY_TOO_LARGE", message: "Hosted device-sync agent pair request body is too large." },
];
const modes = ["declared", "streamed", "under-reported"] as const;
type Mode = typeof modes[number];

function oversizedRequest(limit: number, mode: Mode): Request {
  const headers = new Headers();
  if (mode !== "streamed") headers.set("content-length", String(mode === "declared" ? limit + 1 : 1));
  const request = new Request("https://example.test/body", { method: "POST", headers });
  Object.defineProperty(request, "body", { configurable: true, value: new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(limit));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  }) });
  return request;
}

async function expectResponse(response: Response, error: object) {
  expect(response.status).toBe(413);
  expect(Object.fromEntries(response.headers)).toEqual({ "cache-control": "no-store", "content-type": "application/json" });
  await expect(response.json()).resolves.toEqual({ error });
}

describe("request body limit response parity", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  describe.each(routes)("$name", ({ name, handle, limit, code, message }) => {
    it.each(["Invalid array length", "Request body exceeded 8 bytes."])("does not mislabel an unrelated RangeError: %s", async message => {
      const request = oversizedRequest(0, "streamed");
      Object.defineProperty(request, "body", { value: new ReadableStream({ start(controller) { controller.error(new RangeError(message)); } }) });
      const response = await handle(request);
      expect(response.status).toBe(500);
      expect(Object.fromEntries(response.headers)).toEqual({ "cache-control": "no-store", "content-type": "application/json" });
      await expect(response.json()).resolves.toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal error." } });
    });
    it.each(modes)("preserves the complete response for %s overflow", async (mode) => {
      await expectResponse(await handle(oversizedRequest(limit, mode)), {
        code, message, retryable: false,
      });
    });
  });

  it("accepts exactly the byte limit", async () => {
    const request = new Request("https://example.test/body", { method: "POST", body: "é".repeat(4) });
    expect(await readRawBodyBuffer(request, { limitBytes: 8 })).toEqual(Buffer.from("é".repeat(4)));
  });

  it("recognizes the explicit limit even when its message changes", async () => {
    const error = new RequestBodyTooLargeError(8);
    error.message = "Different diagnostic wording.";
    expect(error).toBeInstanceOf(RequestBodyTooLargeError);
    await expectResponse(createJsonErrorResponse(error, {
      defaultHeaders: { "cache-control": "no-store" }, internalMessage: "test", logMessage: "test",
    }), { code: "REQUEST_BODY_TOO_LARGE", message: "Request body too large." });
  });

  it("does not use the old message prefix to classify a native RangeError", async () => {
    const response = createJsonErrorResponse(new RangeError("Request body exceeded 8 bytes."), { internalMessage: "test", logMessage: "test" });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal error." } });
  });

  it.each(modes)("preserves the global Web response for %s overflow", async (mode) => {
    const error = await readRawBodyBuffer(oversizedRequest(8, mode), { limitBytes: 8 }).catch(error => error);
    expect(error).toBeInstanceOf(RequestBodyTooLargeError);
    await expectResponse(createJsonErrorResponse(error, {
      defaultHeaders: { "cache-control": "no-store" }, internalMessage: "test", logMessage: "test",
    }), { code: "REQUEST_BODY_TOO_LARGE", message: "Request body too large." });
  });

  describe.each([readHostedOnboardingJsonObject, readHostedOnboardingRawBodyText])("onboarding reader %s", (read) => {
    it("rethrows an unrelated RangeError unchanged", async () => {
      const error = new RangeError("Invalid array length");
      const request = oversizedRequest(0, "streamed");
      Object.defineProperty(request, "body", { value: new ReadableStream({ start(controller) { controller.error(error); } }) });
      await expect(read(request, { limitBytes: 8, tooLargeErrorCode: "SYNTHETIC_TOO_LARGE", tooLargeErrorMessage: "Synthetic limit." })).rejects.toBe(error);
    });
    it.each(modes)("preserves the caller's code and message for %s overflow", async mode => {
      const error = await read(oversizedRequest(8, mode), {
        limitBytes: 8, tooLargeErrorCode: "SYNTHETIC_TOO_LARGE", tooLargeErrorMessage: "Synthetic limit.",
      }).catch(error => error);
      await expectResponse(jsonError(error), { code: "SYNTHETIC_TOO_LARGE", message: "Synthetic limit.", retryable: false });
    });
  });
});
