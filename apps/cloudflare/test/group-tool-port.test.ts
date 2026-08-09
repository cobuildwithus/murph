import { afterEach, expect, it, vi } from "vitest";

import { createHostedRuntimeGroupToolPort } from "../src/runtime-platform/group-tool-port.ts";

afterEach(() => {
  vi.restoreAllMocks();
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

const PERSONALIZED_CONTACT_CARD_IMAGE_URL =
  `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;

function createContactCardGroupToolPort(fetchImpl: typeof fetch) {
  return createHostedRuntimeGroupToolPort({
    boundUserId: "member_contact_card_transport",
    fetchImpl,
    timeoutMs: 30_000,
    transport: { mode: "proxy" },
  });
}

it("reports a personalized contact card as unconfirmed when no answer comes back", async () => {
  // Web finishes an irreversible card send even after this hop gives up on
  // it, so the card may be in the conversation. The turn has to be able to say
  // that rather than report a generic tool failure.
  const fetchImpl = vi.fn(async () => {
    throw new TypeError("fetch failed");
  });
  const groupToolPort = createContactCardGroupToolPort(fetchImpl as typeof fetch);

  await expect(groupToolPort.request({
    action: "share_contact_card",
    contactCardImageUrl: PERSONALIZED_CONTACT_CARD_IMAGE_URL,
    contactCardShareKey: `ain_${"c".repeat(32)}`,
    directLinqChatId: "chat_direct_1",
  })).resolves.toEqual({
    action: "share_contact_card",
    result: { status: "unconfirmed" },
  });
});

it("keeps an answered personalized contact card a failure", async () => {
  // Web answered. A real answer, even an error one, is not the ambiguity the
  // unconfirmed state exists for.
  const fetchImpl = vi.fn(async () => new Response(
    JSON.stringify({ error: "internal error" }),
    { headers: { "content-type": "application/json" }, status: 500 },
  ));
  const groupToolPort = createContactCardGroupToolPort(fetchImpl as typeof fetch);

  await expect(groupToolPort.request({
    action: "share_contact_card",
    contactCardImageUrl: PERSONALIZED_CONTACT_CARD_IMAGE_URL,
    contactCardShareKey: `ain_${"c".repeat(32)}`,
    directLinqChatId: "chat_direct_1",
  })).rejects.toThrow();
});

it("leaves every other group-tool transport failure unchanged", async () => {
  const fetchImpl = vi.fn(async () => {
    throw new TypeError("fetch failed");
  });
  const groupToolPort = createContactCardGroupToolPort(fetchImpl as typeof fetch);

  // A canonical card carries no per-request identity, so it has no single
  // member request to report as unresolved.
  await expect(groupToolPort.request({
    action: "share_contact_card",
    linqThread: {
      authority: {
        channel: "linq",
        containerMemberId: "member_container",
        threadId: "thread_group_1",
      },
      chatId: "chat_group_1",
    },
  })).rejects.toThrow();

  await expect(groupToolPort.request({ action: "read_current" })).rejects.toThrow();
});
