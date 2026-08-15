import {
  HOSTED_PHONE_CALLS_PATH,
  HOSTED_PHONE_CALL_START_TRANSPORT_TIMEOUT_MS,
  HOSTED_PHONE_CALL_STATUS_PATH,
  HOSTED_PHONE_CALL_STOP_PATH,
} from "@murphai/hosted-execution/phone-calls";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostedWebControlPlaneJson: vi.fn(),
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", () => ({
  fetchHostedWebControlPlaneJson: mocks.fetchHostedWebControlPlaneJson,
}));

import {
  createHostedWebPhoneCallPort,
  resolveHostedPhoneCallTransportTimeoutMs,
} from "../src/runtime-platform/phone-calls-port.ts";

describe("hosted Web phone-call port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds bounded status reads to the configured member and sensitive response cap", async () => {
    const signal = new AbortController().signal;
    const response = {
      calls: [{
        analyzedAt: null,
        createdAt: "2026-08-14T12:00:00.000Z",
        endedAt: null,
        phoneCallId: "hpc_status_123",
        result: null,
        status: "calling" as const,
        stopRequestedAt: null,
        updatedAt: "2026-08-14T12:01:00.000Z",
      }],
    };
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValueOnce(response);
    const port = createHostedWebPhoneCallPort({
      boundUserId: "member_phone_calls",
      fetchImpl: fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.status?.({ phoneCallId: "hpc_status_123" }, { signal }))
      .resolves.toEqual(response);
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: { phoneCallId: "hpc_status_123" },
      boundUserId: "member_phone_calls",
      description: "Hosted phone-call status",
      fetchImpl: fetch,
      method: "POST",
      path: HOSTED_PHONE_CALL_STATUS_PATH,
      sensitiveResponseBody: { maxBytes: 32 * 1024 },
      signal,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });
  });

  it("forwards the authenticated direct-channel discriminator on start", async () => {
    const signal = new AbortController().signal;
    const request = {
      brief: {
        allowTransferToUser: false,
        goal: "Confirm office hours.",
        instructions: [],
        shareableFacts: {},
        successCriteria: "The office states today's hours.",
        timeZone: "America/New_York",
        to: {
          label: "the office",
          phoneNumber: "+15550102020",
        },
      },
      originDirectChannel: "telegram" as const,
      originSessionId: "session_phone_call_route",
      requestKey: "request_phone_call_route",
    };
    const response = {
      phoneCallId: "hpc_start_route",
      status: "calling" as const,
    };
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValueOnce(response);
    const port = createHostedWebPhoneCallPort({
      boundUserId: "member_phone_calls",
      fetchImpl: fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.start?.(request, { signal })).resolves.toEqual(response);
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: request,
      boundUserId: "member_phone_calls",
      description: "Hosted phone call",
      fetchImpl: fetch,
      method: "POST",
      path: HOSTED_PHONE_CALLS_PATH,
      signal,
      timeoutMs: HOSTED_PHONE_CALL_START_TRANSPORT_TIMEOUT_MS,
      transport: { mode: "proxy" },
    });
  });

  it("binds exact stop requests to the configured member and forwards cancellation", async () => {
    const signal = new AbortController().signal;
    const response = {
      phoneCallId: "hpc_stop_123",
      state: "stopped" as const,
      status: "ended" as const,
    };
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValueOnce(response);
    const port = createHostedWebPhoneCallPort({
      boundUserId: "member_phone_calls",
      fetchImpl: fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.stop?.({ phoneCallId: "hpc_stop_123" }, { signal }))
      .resolves.toEqual(response);
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: { phoneCallId: "hpc_stop_123" },
      boundUserId: "member_phone_calls",
      description: "Hosted phone-call termination",
      fetchImpl: fetch,
      method: "POST",
      path: HOSTED_PHONE_CALL_STOP_PATH,
      signal,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });
  });

  it("rejects malformed status data at the signed Web bridge", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValueOnce({
      calls: [{
        phoneCallId: "hpc_invalid",
        status: "calling",
      }],
    });
    const port = createHostedWebPhoneCallPort({
      boundUserId: "member_phone_calls",
      fetchImpl: fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.status?.({}, {})).rejects.toThrow();
  });

  it("rejects malformed stop data at the signed Web bridge", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValueOnce({
      phoneCallId: "hpc_invalid",
      state: "stopped",
      status: "stopping",
    });
    const port = createHostedWebPhoneCallPort({
      boundUserId: "member_phone_calls",
      fetchImpl: fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.stop?.({ phoneCallId: "hpc_invalid" }, {}))
      .rejects.toThrow();
  });
});

describe("resolveHostedPhoneCallTransportTimeoutMs", () => {
  it("lets the phone-call protocol deadline dominate the generic web-control timeout", () => {
    expect(resolveHostedPhoneCallTransportTimeoutMs(30_000)).toBe(
      HOSTED_PHONE_CALL_START_TRANSPORT_TIMEOUT_MS,
    );
    expect(resolveHostedPhoneCallTransportTimeoutMs(60_000)).toBe(60_000);
  });
});
