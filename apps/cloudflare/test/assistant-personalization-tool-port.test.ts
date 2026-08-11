import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostedWebControlPlaneJson: vi.fn(),
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", () => ({
  fetchHostedWebControlPlaneJson: mocks.fetchHostedWebControlPlaneJson,
}));

import {
  createHostedRuntimeAssistantPersonalizationToolPort,
} from "../src/runtime-platform/assistant-personalization-tool-port.ts";

describe("hosted assistant personalization tool port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      action: "update",
      result: {
        mainPersona: "classic",
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        solAvailable: true,
        status: "saved",
        supportingPersona: null,
        tone: "casual",
        voice: "warm",
      },
    });
  });

  it("keeps accepted-input authority backward compatible", async () => {
    const port = createHostedRuntimeAssistantPersonalizationToolPort({
      boundUserId: "member_style",
      fetchImpl: fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await port.request(
      { action: "update", tone: "casual" },
      {
        assistantInputId: "ain_0123456789abcdef0123456789abcdef",
        toolCallId: "call_style_one",
      },
    );

    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining(
          "?assistantInputId=ain_0123456789abcdef0123456789abcdef&toolCallId=call_style_one",
        ),
      }),
    );
  });

  it("projects scheduled occurrence authority into the additive query", async () => {
    const port = createHostedRuntimeAssistantPersonalizationToolPort({
      boundUserId: "member_style",
      fetchImpl: fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await port.request(
      { action: "update", tone: "casual" },
      {
        automationId: "automation_daily_style",
        occurrenceAt: "2026-08-06T14:30:00.000Z",
        toolCallId: "call_style_two",
      },
    );

    const request = mocks.fetchHostedWebControlPlaneJson.mock.calls[0]?.[0];
    expect(request?.path).toContain("automationId=automation_daily_style");
    expect(request?.path).toContain(
      "occurrenceAt=2026-08-06T14%3A30%3A00.000Z",
    );
    expect(request?.path).toContain("toolCallId=call_style_two");
    expect(request?.path).not.toContain("assistantInputId=");
  });
});
