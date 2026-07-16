import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  HOSTED_ASSISTANT_REASONING_EFFORTS,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
} from "@murphai/hosted-execution/assistant-model";
import {
  executeMurphDynamicToolRequest,
  MURPH_ASSISTANT_CONFIGURATION_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.js";
import type {
  AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.js";

describe("assistant configuration tool", () => {
  it("exposes the dynamic tool only when hosted configuration is available", () => {
    expect(resolveMurphDynamicTools({
      assistantConfigurationAvailable: true,
    })).toContain(MURPH_ASSISTANT_CONFIGURATION_TOOL);
    expect(resolveMurphDynamicTools({
      assistantConfigurationAvailable: false,
    })).not.toContain(MURPH_ASSISTANT_CONFIGURATION_TOOL);
  });

  it("reads the saved next-turn target without rewriting the current turn", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { action: "read" },
        namespace: "murph",
        tool: "assistant_configuration",
      },
    });
    expect(request).toEqual({
      kind: "assistant-configuration",
      request: { action: "read" },
    });
    if (!request) {
      throw new Error("Expected an assistant configuration dynamic tool request.");
    }

    const assistantConfigurationTool = {
      request: vi.fn(async () => ({
        action: "read" as const,
        result: createSavedConfiguration({
          model: HOSTED_ASSISTANT_TERRA_MODEL,
          reasoningEffort: "low",
        }),
      })),
    };
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantConfigurationTool,
        currentModel: HOSTED_ASSISTANT_SOL_MODEL,
        currentReasoningEffort: "high",
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(assistantConfigurationTool.request).toHaveBeenCalledWith({
      action: "read",
    });
    expect(result.rpcResult.success).toBe(true);
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_SOL_MODEL,
        reasoningEffort: "high",
      },
      savedForNextTurn: createSavedConfiguration({
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        reasoningEffort: "low",
      }),
    });
  });

  it("requires accepted user input before updating configuration", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { action: "update", model: HOSTED_ASSISTANT_LUNA_MODEL },
        namespace: "murph",
        tool: "assistant_configuration",
      },
    });
    if (!request) {
      throw new Error("Expected an assistant configuration dynamic tool request.");
    }
    const assistantConfigurationTool = {
      request: vi.fn(),
    };

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantConfigurationTool,
        currentModel: HOSTED_ASSISTANT_TERRA_MODEL,
        currentReasoningEffort: "low",
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(assistantConfigurationTool.request).not.toHaveBeenCalled();
  });

  it("saves an explicit model and reasoning change directly for the next turn", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "update",
          model: HOSTED_ASSISTANT_LUNA_MODEL,
          reasoningEffort: "medium",
        },
        namespace: "murph",
        tool: "assistant_configuration",
      },
    });
    expect(request).toEqual({
      kind: "assistant-configuration",
      request: {
        action: "update",
        model: HOSTED_ASSISTANT_LUNA_MODEL,
        reasoningEffort: "medium",
      },
    });
    if (!request) {
      throw new Error("Expected an assistant configuration dynamic tool request.");
    }

    const savedForNextTurn = createSavedConfiguration({
      model: HOSTED_ASSISTANT_TERRA_MODEL,
      reasoningEffort: "low",
    });
    const updatedSaved = {
      ...createSavedConfiguration({
        model: HOSTED_ASSISTANT_LUNA_MODEL,
        reasoningEffort: "medium",
      }),
      appliesAt: "next_turn" as const,
      requiredPlan: null,
      status: "updated" as const,
    };
    const assistantConfigurationTool = {
      request: vi.fn()
        .mockResolvedValueOnce({ action: "read", result: savedForNextTurn })
        .mockResolvedValueOnce({ action: "update", result: updatedSaved }),
    };
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantConfigurationTool,
        currentModel: HOSTED_ASSISTANT_TERRA_MODEL,
        currentReasoningEffort: "low",
        assistantInputId: `ain_${"a".repeat(32)}`,
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(assistantConfigurationTool.request).toHaveBeenNthCalledWith(1, {
      action: "read",
    });
    expect(assistantConfigurationTool.request).toHaveBeenNthCalledWith(2, {
      action: "update",
      assistantInputId: `ain_${"a".repeat(32)}`,
      model: HOSTED_ASSISTANT_LUNA_MODEL,
      reasoningEffort: "medium",
    });
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        reasoningEffort: "low",
      },
      savedForNextTurn: updatedSaved,
    });
  });

  it("confirms an unchanged target through the input-bound update", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "update",
          reasoningEffort: "low",
        },
        namespace: "murph",
        tool: "assistant_configuration",
      },
    });
    if (!request) {
      throw new Error("Expected an assistant configuration dynamic tool request.");
    }
    const savedForNextTurn = createSavedConfiguration({
      model: HOSTED_ASSISTANT_TERRA_MODEL,
      reasoningEffort: "low",
    });
    const unchangedSaved = {
      ...savedForNextTurn,
      appliesAt: "next_turn" as const,
      requiredPlan: null,
      status: "unchanged" as const,
    };
    const assistantConfigurationTool = {
      request: vi.fn()
        .mockResolvedValueOnce({ action: "read", result: savedForNextTurn })
        .mockResolvedValueOnce({ action: "update", result: unchangedSaved }),
    };

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantConfigurationTool,
        currentModel: HOSTED_ASSISTANT_TERRA_MODEL,
        currentReasoningEffort: "low",
        assistantInputId: `ain_${"d".repeat(32)}`,
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(assistantConfigurationTool.request).toHaveBeenNthCalledWith(1, {
      action: "read",
    });
    expect(assistantConfigurationTool.request).toHaveBeenNthCalledWith(2, {
      action: "update",
      assistantInputId: `ain_${"d".repeat(32)}`,
      reasoningEffort: "low",
    });
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        reasoningEffort: "low",
      },
      savedForNextTurn: unchangedSaved,
    });
  });

  it("returns the Edge upgrade requirement without sending a direct mutation", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "update",
          model: HOSTED_ASSISTANT_SOL_MODEL,
        },
        namespace: "murph",
        tool: "assistant_configuration",
      },
    });
    if (!request) {
      throw new Error("Expected an assistant configuration dynamic tool request.");
    }
    const savedForNextTurn = {
      ...createSavedConfiguration({
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        reasoningEffort: "low",
      }),
      solAvailable: false,
    };
    const assistantConfigurationTool = {
      request: vi.fn(async () => ({
        action: "read" as const,
        result: savedForNextTurn,
      })),
    };

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantConfigurationTool,
        currentModel: HOSTED_ASSISTANT_TERRA_MODEL,
        currentReasoningEffort: "low",
        assistantInputId: `ain_${"e".repeat(32)}`,
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(assistantConfigurationTool.request).toHaveBeenCalledOnce();
    expect(assistantConfigurationTool.request).toHaveBeenCalledWith({
      action: "read",
    });
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        reasoningEffort: "low",
      },
      savedForNextTurn: {
        ...savedForNextTurn,
        appliesAt: "next_turn",
        requiredPlan: "edge",
        status: "upgrade_required",
      },
    });
  });

  it("preserves the requested field mask", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "update",
          reasoningEffort: "medium",
        },
        namespace: "murph",
        tool: "assistant_configuration",
      },
    });
    if (!request) {
      throw new Error("Expected an assistant configuration dynamic tool request.");
    }
    const currentSaved = createSavedConfiguration({
      model: HOSTED_ASSISTANT_LUNA_MODEL,
      reasoningEffort: "low",
    });
    const updatedSaved = {
      ...createSavedConfiguration({
        model: HOSTED_ASSISTANT_LUNA_MODEL,
        reasoningEffort: "medium",
      }),
      appliesAt: "next_turn" as const,
      requiredPlan: null,
      status: "updated" as const,
    };
    const assistantConfigurationTool = {
      request: vi.fn()
        .mockResolvedValueOnce({ action: "read", result: currentSaved })
        .mockResolvedValueOnce({ action: "update", result: updatedSaved }),
    };
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantConfigurationTool,
        currentModel: HOSTED_ASSISTANT_TERRA_MODEL,
        currentReasoningEffort: "high",
        assistantInputId: `ain_${"b".repeat(32)}`,
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(assistantConfigurationTool.request).toHaveBeenNthCalledWith(1, {
      action: "read",
    });
    expect(assistantConfigurationTool.request).toHaveBeenNthCalledWith(2, {
      action: "update",
      assistantInputId: `ain_${"b".repeat(32)}`,
      reasoningEffort: "medium",
    });
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        reasoningEffort: "high",
      },
      savedForNextTurn: updatedSaved,
    });
  });

  it("clears dormant Sol intent when the member explicitly chooses Terra", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "update",
          model: HOSTED_ASSISTANT_TERRA_MODEL,
        },
        namespace: "murph",
        tool: "assistant_configuration",
      },
    });
    if (!request) {
      throw new Error("Expected an assistant configuration dynamic tool request.");
    }
    const currentSaved = {
      ...createSavedConfiguration({
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        reasoningEffort: "low",
      }),
      dormantSolPreference: true,
      solAvailable: false,
    };
    const updatedSaved = {
      ...currentSaved,
      appliesAt: "next_turn" as const,
      dormantSolPreference: false,
      requiredPlan: null,
      status: "updated" as const,
    };
    const assistantConfigurationTool = {
      request: vi.fn()
        .mockResolvedValueOnce({ action: "read", result: currentSaved })
        .mockResolvedValueOnce({ action: "update", result: updatedSaved }),
    };
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantConfigurationTool,
        currentModel: HOSTED_ASSISTANT_TERRA_MODEL,
        currentReasoningEffort: "low",
        assistantInputId: `ain_${"c".repeat(32)}`,
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult).toMatchObject({ success: true });
    expect(assistantConfigurationTool.request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "update",
      assistantInputId: `ain_${"c".repeat(32)}`,
      model: HOSTED_ASSISTANT_TERRA_MODEL,
    }));
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        reasoningEffort: "low",
      },
      savedForNextTurn: updatedSaved,
    });
  });

  it("rejects empty updates and unsupported reasoning effort", () => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { action: "update" },
        namespace: "murph",
        tool: "assistant_configuration",
      },
    })?.kind).toBe("invalid-assistant-configuration-arguments");
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "update",
          reasoningEffort: "none",
        },
        namespace: "murph",
        tool: "assistant_configuration",
      },
    })?.kind).toBe("invalid-assistant-configuration-arguments");
  });
});

function createSavedConfiguration(input: {
  model: typeof HOSTED_ASSISTANT_LUNA_MODEL
    | typeof HOSTED_ASSISTANT_TERRA_MODEL
    | typeof HOSTED_ASSISTANT_SOL_MODEL;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
}) {
  return {
    availableModels: [...HOSTED_ASSISTANT_PRODUCT_MODELS],
    availableReasoningEfforts: [...HOSTED_ASSISTANT_REASONING_EFFORTS],
    configurationAvailable: true,
    dormantSolPreference: false,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    solAvailable: true,
  };
}

function createHostedToolContext(input: {
  assistantInputId?: string | null;
  assistantConfigurationTool: NonNullable<
    AssistantHostedToolContext["assistantConfigurationTool"]
  >;
  currentModel: string;
  currentReasoningEffort: string;
}): AssistantHostedToolContext {
  return {
    actionApprovalPort: null,
    assistantConfigurationTool: input.assistantConfigurationTool,
    computerToolsAvailable: false,
    currentAssistantPreferenceInputId: () => input.assistantInputId ?? null,
    currentAssistantTarget: () => ({
      model: input.currentModel,
      reasoningEffort: input.currentReasoningEffort,
    }),
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    sendVaultFile: vi.fn(async () => ({
      approvalUrl: "https://murph.test/approve/unused",
      filename: "unused.pdf",
      status: "pending" as const,
    })),
    vaultFileSendAvailable: false,
  };
}

function readToolPayload(
  result: Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>,
): unknown {
  const text = result.rpcResult.contentItems[0]?.text;
  if (typeof text !== "string") {
    throw new Error("Expected assistant configuration tool text output.");
  }
  return JSON.parse(text) as unknown;
}
