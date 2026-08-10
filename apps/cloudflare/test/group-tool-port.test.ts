import { afterEach, expect, it, vi } from "vitest";

import {
  createHostedRuntimeGroupToolPort,
  HOSTED_GROUP_TOOL_RESPONSE_SCHEMA_INVALID,
} from "../src/runtime-platform/group-tool-port.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

it("categorizes a malformed group usage response without retaining its payload", async () => {
  const privatePayloadKey = "privateAccountingDetail";
  const privatePayloadValue = "private-accounting-value";
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
    action: "read_usage",
    result: {
      status: "ok",
      usage: {
        fundingNeeded: false,
        fundingUrl: null,
        [privatePayloadKey]: privatePayloadValue,
      },
    },
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  }));
  const groupToolPort = createHostedRuntimeGroupToolPort({
    boundUserId: "member_group_usage_schema",
    fetchImpl: fetchImpl as typeof fetch,
    timeoutMs: 45_000,
    transport: { mode: "proxy" },
  });

  const error = await groupToolPort.request({ action: "read_usage" })
    .then(() => null, (caught: unknown) => caught);

  expect(error).toMatchObject({
    code: HOSTED_GROUP_TOOL_RESPONSE_SCHEMA_INVALID,
    name: "HostedGroupToolResponseSchemaError",
  });
  expect(error).not.toHaveProperty("cause");
  expect(JSON.stringify(error)).not.toContain(privatePayloadKey);
  expect(JSON.stringify(error)).not.toContain(privatePayloadValue);
  expect(String(error)).not.toContain(privatePayloadKey);
  expect(String(error)).not.toContain(privatePayloadValue);
});

it("accepts and preserves the group usage progress field", async () => {
  const currentResponse = {
    action: "read_usage" as const,
    result: {
      status: "ok" as const,
      usage: {
        fundingNeeded: false,
        fundingUrl: null,
      },
    },
  };
  const usageProgressResponse = {
    ...currentResponse,
    result: {
      ...currentResponse.result,
      usage: {
        ...currentResponse.result.usage,
        includedUsageUsedPercent: 64,
      },
    },
  };
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(usageProgressResponse), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  }));
  const groupToolPort = createHostedRuntimeGroupToolPort({
    boundUserId: "member_group_usage_progress",
    fetchImpl: fetchImpl as typeof fetch,
    timeoutMs: 45_000,
    transport: { mode: "proxy" },
  });

  await expect(groupToolPort.request({ action: "read_usage" }))
    .resolves.toEqual(usageProgressResponse);
});

it("aborts participant display-name reads at the short soft deadline and ignores late responses", async () => {
  const timeoutControllers: Array<{ controller: AbortController; timeoutMs: number }> = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((timeoutMs) => {
    const controller = new AbortController();
    timeoutControllers.push({ controller, timeoutMs });
    return controller.signal;
  });

  let resolveFetch!: (response: Response) => void;
  const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      resolveFetch = resolve;
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("expected hosted group-tool request signal"));
        return;
      }
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })
  );
  const groupToolPort = createHostedRuntimeGroupToolPort({
    boundUserId: "member_display_name_timeout",
    fetchImpl: fetchImpl as typeof fetch,
    timeoutMs: 45_000,
    transport: { mode: "proxy" },
  });

  const request = groupToolPort.request({
    action: "read_participant_display_names",
    linqSenderHandles: ["+15551110000"],
  });
  const outcome = vi.fn();
  void request.then(
    () => outcome("resolved"),
    () => outcome("rejected"),
  );

  await vi.waitFor(() => {
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  expect(timeoutControllers[0]?.timeoutMs).toBe(1_000);
  const timeoutController = timeoutControllers[0]?.controller;
  if (!timeoutController) {
    throw new Error("expected participant display-name timeout controller");
  }
  timeoutController.abort(
    new DOMException("The operation timed out.", "TimeoutError"),
  );

  await expect(request).rejects.toBeInstanceOf(Error);
  expect(outcome).toHaveBeenCalledExactlyOnceWith("rejected");

  resolveFetch(new Response(JSON.stringify({
    action: "read_participant_display_names",
    result: {
      participants: [{
        displayName: "Late Name",
        senderHandle: "+15551110000",
      }],
      status: "ok",
    },
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  }));
  await Promise.resolve();
  await Promise.resolve();

  expect(outcome).toHaveBeenCalledExactlyOnceWith("rejected");
});

it("bounds the display-name soft deadline by the configured control timeout", async () => {
  const timeoutMsValues: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((timeoutMs) => {
    timeoutMsValues.push(timeoutMs);
    return new AbortController().signal;
  });
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
    action: "read_participant_display_names",
    result: {
      nameMissSenderHandles: ["+15551110000"],
      participants: [],
      status: "ok",
    },
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  }));
  const groupToolPort = createHostedRuntimeGroupToolPort({
    boundUserId: "member_display_name_bounded_timeout",
    fetchImpl: fetchImpl as typeof fetch,
    timeoutMs: 250,
    transport: { mode: "proxy" },
  });

  await expect(groupToolPort.request({
    action: "read_participant_display_names",
    linqSenderHandles: ["+15551110000"],
  })).resolves.toEqual({
    action: "read_participant_display_names",
    result: {
      nameMissSenderHandles: ["+15551110000"],
      participants: [],
      status: "ok",
    },
  });

  expect(timeoutMsValues).not.toContain(1_000);
  expect(timeoutMsValues.every((timeoutMs) => timeoutMs === 250)).toBe(true);
});

it("preserves the configured control timeout for required group-tool actions", async () => {
  const timeoutMsValues: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((timeoutMs) => {
    timeoutMsValues.push(timeoutMs);
    return new AbortController().signal;
  });
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
    action: "read_current",
    result: {
      group: null,
      status: "none",
    },
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  }));
  const groupToolPort = createHostedRuntimeGroupToolPort({
    boundUserId: "member_group_tool_control_timeout",
    fetchImpl: fetchImpl as typeof fetch,
    timeoutMs: 45_000,
    transport: { mode: "proxy" },
  });

  await expect(groupToolPort.request({ action: "read_current" })).resolves.toEqual({
    action: "read_current",
    result: {
      group: null,
      status: "none",
    },
  });

  expect(timeoutMsValues.length).toBeGreaterThan(0);
  expect(timeoutMsValues.every((timeoutMs) => timeoutMs === 45_000)).toBe(true);
});
