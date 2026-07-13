import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedAssistantConfigurationApprovalConsumerId,
  buildHostedAssistantConfigurationApprovalRequest,
} from "@murphai/hosted-execution/assistant-configuration-approval";

const mocks = vi.hoisted(() => ({
  handleTool: vi.fn(),
  requireCallback: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireCallback,
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
    mocks.requireCallback.mockResolvedValue("member_123");
    mocks.handleTool.mockResolvedValue({
      action: "read",
      result: {
        availableModels: ["gpt-5.6-luna", "gpt-5.6-terra"],
        availableReasoningEfforts: ["low", "medium", "high", "xhigh"],
        configurationAvailable: true,
        model: "gpt-5.6-terra",
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
    expect(mocks.requireCallback).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        maxBodyBytes: 8 * 1_024,
        payloadText: JSON.stringify({ action: "read" }),
      }),
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

  it("accepts a fully resolved update with exact approval proof", async () => {
    const approvalRequest = buildHostedAssistantConfigurationApprovalRequest({
      changes: {
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
      },
      returnContactKind: "text",
      target: {
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
      },
    });
    const body = {
      action: "update",
      approval: {
        approvalGeneration: "b".repeat(64),
        consumerId: buildHostedAssistantConfigurationApprovalConsumerId(
          approvalRequest,
        ),
        request: approvalRequest,
      },
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

    expect(response.status).toBe(200);
    expect(mocks.handleTool).toHaveBeenCalledWith({
      memberId: "member_123",
      request: body,
    });
  });
});
