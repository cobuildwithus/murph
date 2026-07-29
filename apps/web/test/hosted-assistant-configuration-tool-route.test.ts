import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleTool: vi.fn(),
  requireJsonCallback: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest: mocks.requireJsonCallback,
}));

vi.mock("@/src/lib/hosted-execution/assistant-configuration-tool", () => ({
  handleHostedRuntimeAssistantConfigurationTool: mocks.handleTool,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-execution/assistant-configuration/tool/route"
);

let route: RouteModule;

describe("hosted assistant configuration tool route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-execution/assistant-configuration/tool/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireJsonCallback.mockImplementation(async (request: Request) => ({
      payload: await request.json(),
      userId: "member_123",
    }));
    mocks.handleTool.mockResolvedValue({
      action: "read",
      result: {
        availableModels: ["gpt-5.6-luna", "gpt-5.6-terra"],
        availableProviders: ["openai", "venice"],
        availableReasoningEfforts: ["low", "medium", "high", "xhigh"],
        configurationAvailable: true,
        model: "gpt-5.6-terra",
        provider: "openai",
        reasoningEffort: "low",
        solAvailable: false,
      },
    });
  });

  it("authenticates the exact payload before handling a read", async () => {
    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-configuration/tool",
      {
        body: JSON.stringify({ action: "read" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.requireJsonCallback).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 8 * 1_024 },
    );
    expect(mocks.handleTool).toHaveBeenCalledWith({
      memberId: "member_123",
      request: { action: "read" },
    });
  });

  it("rejects an empty update before invoking the handler", async () => {
    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-configuration/tool",
      {
        body: JSON.stringify({ action: "update" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(400);
    expect(mocks.handleTool).not.toHaveBeenCalled();
  });

  it("accepts a direct update bound to live conversation input", async () => {
    const body = {
      action: "update",
      assistantInputId: `ain_${"c".repeat(32)}`,
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
    };

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-configuration/tool",
      {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.handleTool).toHaveBeenCalledWith({
      memberId: "member_123",
      request: body,
    });
  });

  it("rejects the removed approval-backed update shape", async () => {
    const body = {
      action: "update",
      approval: {},
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      target: {
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
      },
    };

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-configuration/tool",
      {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(400);
    expect(mocks.handleTool).not.toHaveBeenCalled();
  });
});
