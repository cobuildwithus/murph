import { afterEach, expect, it } from "vitest";
import { HOSTED_PHONE_CALL_START_TRANSPORT_TIMEOUT_MS } from "@murphai/hosted-execution/phone-calls";
import {
  createHostedWebPhoneCallPort,
  resolveHostedPhoneCallTransportTimeoutMs,
} from "../src/runtime-platform/phone-calls-port.ts";
import { HOSTED_RUNNER_WEB_CONTROL_ROUTES } from "../src/runtime-platform/web-control-transport.ts";
import { startHostedWebControlStub, type HostedWebControlStub } from "./helpers/hosted-web-control-support.js";

let webControl: HostedWebControlStub | null = null;
afterEach(async () => { await webControl?.stop(); webControl = null; });

it("starts, reads and stops one call through signed HTTP while bounding sensitive replies", async () => {
  const phoneCallId = "hpc_synthetic";
  const start = {
    brief: {
      allowTransferToUser: false, goal: "Confirm office hours.", instructions: [],
      shareableFacts: {}, successCriteria: "The office states today's hours.",
      timeZone: "America/New_York", to: { label: "the office", phoneNumber: "+15550102020" },
    },
    resultNotificationChannel: "telegram" as const,
    originSessionId: "session_synthetic", requestKey: "request_synthetic",
  };
  const status = { calls: [{
    analyzedAt: null, createdAt: "2026-08-14T12:00:00.000Z", endedAt: null,
    phoneCallId, result: null, status: "calling", stopRequestedAt: null,
    updatedAt: "2026-08-14T12:01:00.000Z",
  }] };
  let replyMode: "valid" | "malformed" | "oversized" = "valid";
  webControl = await startHostedWebControlStub({ respond: (request) => {
    if (replyMode === "oversized") return { rawBody: "x".repeat(32 * 1024 + 1) };
    if (replyMode === "malformed") return { body: { phoneCallId, calls: [{ phoneCallId }], status: "invalid" } };
    if (request.url === HOSTED_RUNNER_WEB_CONTROL_ROUTES.phoneCallStart.path)
      return { body: { phoneCallId, status: "calling" } };
    if (request.url === HOSTED_RUNNER_WEB_CONTROL_ROUTES.phoneCallStatus.path) return { body: status };
    if (request.url === HOSTED_RUNNER_WEB_CONTROL_ROUTES.phoneCallStop.path)
      return { body: { phoneCallId, state: "stopped", status: "ended" } };
    return { status: 404 };
  } });
  const port = createHostedWebPhoneCallPort({
    boundUserId: "member_synthetic", fetchImpl: fetch, timeoutMs: 2_000, transport: webControl.transport,
  });
  await expect(port.start!(start)).resolves.toEqual({ phoneCallId, status: "calling" });
  await expect(port.status!({ phoneCallId })).resolves.toEqual(status);
  await expect(port.stop!({ phoneCallId })).resolves.toEqual({ phoneCallId, state: "stopped", status: "ended" });
  expect(webControl.observedRequests.map(({ url, body, userId, method }) => ({ url, body, userId, method })))
    .toEqual([
      { url: HOSTED_RUNNER_WEB_CONTROL_ROUTES.phoneCallStart.path, body: JSON.stringify(start), userId: "member_synthetic", method: "POST" },
      { url: HOSTED_RUNNER_WEB_CONTROL_ROUTES.phoneCallStatus.path, body: JSON.stringify({ phoneCallId }), userId: "member_synthetic", method: "POST" },
      { url: HOSTED_RUNNER_WEB_CONTROL_ROUTES.phoneCallStop.path, body: JSON.stringify({ phoneCallId }), userId: "member_synthetic", method: "POST" },
    ]);
  expect(webControl.observedRequests.every(({ signature }) => Boolean(signature))).toBe(true);

  replyMode = "malformed";
  await expect(port.status!({ phoneCallId })).rejects.toThrow();
  await expect(port.stop!({ phoneCallId })).rejects.toThrow();
  replyMode = "oversized";
  await expect(port.status!({ phoneCallId })).rejects.toThrow(/limit|large|exceed|bytes/i);
  const requestsBeforeAbort = webControl.observedRequests.length;
  const controller = new AbortController();
  controller.abort();
  for (const operation of [() => port.start!(start, { signal: controller.signal }),
    () => port.status!({ phoneCallId }, { signal: controller.signal }),
    () => port.stop!({ phoneCallId }, { signal: controller.signal })]) {
    await expect(operation()).rejects.toMatchObject({ cause: { name: "AbortError" } });
  }
  expect(webControl.observedRequests).toHaveLength(requestsBeforeAbort);
});

it("retains the start deadline floor and a larger caller budget", () => {
  expect(resolveHostedPhoneCallTransportTimeoutMs(30_000)).toBe(HOSTED_PHONE_CALL_START_TRANSPORT_TIMEOUT_MS);
  expect(resolveHostedPhoneCallTransportTimeoutMs(60_000)).toBe(60_000);
});
