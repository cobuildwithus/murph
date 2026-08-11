import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  handleHostedRuntimeAssistantPersonalizationTool: vi.fn(),
  requireHostedCloudflareCallbackJsonRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest:
    mocks.requireHostedCloudflareCallbackJsonRequest,
}));
vi.mock("@/src/lib/hosted-execution/assistant-personalization-tool", () => ({
  handleHostedRuntimeAssistantPersonalizationTool:
    mocks.handleHostedRuntimeAssistantPersonalizationTool,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-execution/assistant-personalization/tool/route"
);

let route: RouteModule;

describe("hosted assistant personalization internal route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-execution/assistant-personalization/tool/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackJsonRequest.mockImplementation(
      async (request: Request) => ({
        payload: await request.json(),
        userId: "member_personalization_route",
      }),
    );
    mocks.handleHostedRuntimeAssistantPersonalizationTool.mockResolvedValue({
      action: "read",
      result: {
        mainPersona: "classic",
        model: "gpt-5.6-terra",
        solAvailable: false,
        supportingPersona: null,
        tone: "formal",
        voice: "warm",
      },
    });
  });

  it("binds the parsed operation to the signed callback member", async () => {
    const payload = JSON.stringify({ action: "read" });
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-personalization/tool",
      {
        body: payload,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 2_048 },
    );
    expect(mocks.handleHostedRuntimeAssistantPersonalizationTool).toHaveBeenCalledWith({
      memberId: "member_personalization_route",
      request: { action: "read" },
      scheduleMailboxWake: expect.any(Function),
    });

    const scheduleMailboxWake = mocks.handleHostedRuntimeAssistantPersonalizationTool
      .mock.calls[0]?.[0]?.scheduleMailboxWake;
    expect(scheduleMailboxWake).toEqual(expect.any(Function));
    scheduleMailboxWake?.({
      expectedUserId: "member_personalization_route",
      mailboxItemId: "mailbox_personalization_route",
    });
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));

    const task = mocks.after.mock.calls[0]?.[0];
    await task?.();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_personalization_route",
      mailboxItemId: "mailbox_personalization_route",
    });
  });

  it("binds a signed assistant input ID to an update without changing the request body", async () => {
    const payload = JSON.stringify({ action: "update", tone: "casual" });
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-personalization/tool?assistantInputId=ain_0123456789abcdef0123456789abcdef",
      {
        body: payload,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 2_048 },
    );
    expect(mocks.handleHostedRuntimeAssistantPersonalizationTool).toHaveBeenCalledWith({
      authority: {
        assistantInputId: "ain_0123456789abcdef0123456789abcdef",
      },
      memberId: "member_personalization_route",
      request: { action: "update", tone: "casual" },
      scheduleMailboxWake: expect.any(Function),
    });
  });

  it("binds an exact tool call identity to accepted-input authority", async () => {
    const payload = JSON.stringify({ action: "update", tone: "casual" });
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-personalization/tool?assistantInputId=ain_0123456789abcdef0123456789abcdef&toolCallId=call_style_one",
      {
        body: payload,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.handleHostedRuntimeAssistantPersonalizationTool).toHaveBeenCalledWith({
      authority: {
        assistantInputId: "ain_0123456789abcdef0123456789abcdef",
        toolCallId: "call_style_one",
      },
      memberId: "member_personalization_route",
      request: { action: "update", tone: "casual" },
      scheduleMailboxWake: expect.any(Function),
    });
  });

  it("binds an exact scheduled occurrence to an update without changing the request body", async () => {
    const payload = JSON.stringify({ action: "update", tone: "casual" });
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-personalization/tool?automationId=automation_daily_style&occurrenceAt=2026-08-06T14%3A30%3A00.000Z",
      {
        body: payload,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.handleHostedRuntimeAssistantPersonalizationTool)
      .toHaveBeenCalledWith({
        authority: {
          automationId: "automation_daily_style",
          occurrenceAt: "2026-08-06T14:30:00.000Z",
        },
        memberId: "member_personalization_route",
        request: { action: "update", tone: "casual" },
        scheduleMailboxWake: expect.any(Function),
      });
  });

  it("binds a signed assistant input ID to a sparse personality update", async () => {
    const payload = JSON.stringify({
      action: "update_personality",
      personality: { humor: 8, push: null },
    });
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-personalization/tool?assistantInputId=ain_abcdef0123456789abcdef0123456789",
      {
        body: payload,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 2_048 },
    );
    expect(mocks.handleHostedRuntimeAssistantPersonalizationTool).toHaveBeenCalledWith({
      authority: {
        assistantInputId: "ain_abcdef0123456789abcdef0123456789",
      },
      memberId: "member_personalization_route",
      request: {
        action: "update_personality",
        personality: { humor: 8, push: null },
      },
      scheduleMailboxWake: expect.any(Function),
    });
  });

  it("rejects personality updates without assistant input authority", async () => {
    const payload = JSON.stringify({
      action: "update_personality",
      personality: { detail: 7 },
    });
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-personalization/tool",
      {
        body: payload,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(400);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledOnce();
    expect(mocks.handleHostedRuntimeAssistantPersonalizationTool).not.toHaveBeenCalled();
  });

  it("rejects the retired direct-vault causal-sequence action", async () => {
    const payload = JSON.stringify({ action: "resolve_preference_causal_seq" });
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-personalization/tool?assistantInputId=ain_0123456789abcdef0123456789abcdef",
      {
        body: payload,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(400);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledOnce();
    expect(mocks.handleHostedRuntimeAssistantPersonalizationTool)
      .not.toHaveBeenCalled();
  });

  it("rejects malformed assistant input authority after callback authentication", async () => {
    const payload = JSON.stringify({ action: "update", tone: "casual" });
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-personalization/tool?assistantInputId=input_1",
      {
        body: payload,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(400);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledOnce();
    expect(mocks.handleHostedRuntimeAssistantPersonalizationTool).not.toHaveBeenCalled();
  });

  it("rejects legacy sequence query parameters instead of treating them as authority", async () => {
    const payload = JSON.stringify({ action: "update", tone: "casual" });
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-personalization/tool?preferenceCausalSeq=42",
      {
        body: payload,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(400);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledOnce();
    expect(mocks.handleHostedRuntimeAssistantPersonalizationTool).not.toHaveBeenCalled();
  });
});
