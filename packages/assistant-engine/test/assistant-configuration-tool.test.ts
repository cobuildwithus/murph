import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  HOSTED_ASSISTANT_PROVIDERS,
  HOSTED_ASSISTANT_REASONING_EFFORTS,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
} from "@murphai/hosted-execution/assistant-model";
import {
  executeMurphDynamicToolRequest,
  MURPH_ASSISTANT_CONFIGURATION_TOOL,
  MURPH_GROUP_ASSISTANT_CONFIGURATION_TOOL,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.js";
import type {
  AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.js";

describe("assistant configuration tool", () => {
  it("describes the usage-saving option against overall AI usage", () => {
    expect(MURPH_ASSISTANT_CONFIGURATION_TOOL.description).toContain(
      "a less capable model that uses less AI usage",
    );
    expect(MURPH_ASSISTANT_CONFIGURATION_TOOL.description).not.toContain(
      "less of your included usage",
    );
  });

  it("exposes the scope-specific dynamic tool only when configuration is available", () => {
    expect(resolveMurphDynamicTools({
      assistantConfigurationAvailable: true,
    })).toContain(MURPH_ASSISTANT_CONFIGURATION_TOOL);
    expect(resolveMurphDynamicTools({
      assistantConfigurationAvailable: false,
    })).not.toContain(MURPH_ASSISTANT_CONFIGURATION_TOOL);

    const groupTools = resolveMurphDynamicTools({
      assistantConfigurationAvailable: false,
      groupAssistantConfigurationAvailable: true,
    });
    expect(groupTools).toContain(MURPH_GROUP_ASSISTANT_CONFIGURATION_TOOL);
    expect(groupTools).not.toContain(MURPH_ASSISTANT_CONFIGURATION_TOOL);
    const groupSchema = JSON.stringify(
      MURPH_GROUP_ASSISTANT_CONFIGURATION_TOOL.inputSchema,
    );
    expect(groupSchema).toContain('"model"');
    expect(groupSchema).not.toContain('"provider"');
    expect(groupSchema).not.toContain('"reasoningEffort"');
  });

  it("saves an explicit group room model for the next turn", async () => {
    const request = readTestMurphDynamicToolRequest({
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
    const updatedSaved = {
      ...createGroupSavedConfiguration(HOSTED_ASSISTANT_TERRA_MODEL),
      appliesAt: "next_turn" as const,
      requiredPlan: null,
      status: "updated" as const,
    };
    const assistantConfigurationTool = {
      request: vi.fn().mockResolvedValue({
        action: "update",
        result: updatedSaved,
      }),
    };

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantConfigurationTool,
        assistantInputId: `ain_${"g".repeat(32)}`,
        conversationScope: "group",
        currentModel: HOSTED_ASSISTANT_SOL_MODEL,
        currentReasoningEffort: "low",
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(assistantConfigurationTool.request).toHaveBeenCalledOnce();
    expect(assistantConfigurationTool.request).toHaveBeenCalledWith({
      action: "update",
      assistantInputId: `ain_${"g".repeat(32)}`,
      model: HOSTED_ASSISTANT_TERRA_MODEL,
    });
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_SOL_MODEL,
        provider: "openai",
        reasoningEffort: "low",
      },
      savedForNextTurn: updatedSaved,
    });
  });

  it("rejects provider and reasoning mutations from a group room", async () => {
    const assistantConfigurationTool = {
      request: vi.fn(),
    };
    for (const change of [
      { provider: "venice" as const },
      { reasoningEffort: "high" as const },
    ]) {
      const request = readTestMurphDynamicToolRequest({
        method: "item/tool/call",
        params: {
          arguments: { action: "update", ...change },
          namespace: "murph",
          tool: "assistant_configuration",
        },
      });
      if (!request) {
        throw new Error("Expected an assistant configuration dynamic tool request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createHostedToolContext({
          assistantConfigurationTool,
          assistantInputId: `ain_${"h".repeat(32)}`,
          conversationScope: "group",
          currentModel: HOSTED_ASSISTANT_SOL_MODEL,
          currentReasoningEffort: "low",
        }),
        nextUsageOrdinal: () => 0,
        progressDelivery: null,
        request,
      });

      expect(result.rpcResult.success).toBe(false);
    }
    expect(assistantConfigurationTool.request).not.toHaveBeenCalled();
  });

  it("reads the saved next-turn target without rewriting the current turn", async () => {
    const request = readTestMurphDynamicToolRequest({
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
        provider: "openai",
        reasoningEffort: "high",
      },
      savedForNextTurn: createSavedConfiguration({
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        reasoningEffort: "low",
      }),
    });
  });

  it("requires accepted user input before updating configuration", async () => {
    const request = readTestMurphDynamicToolRequest({
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
    const request = readTestMurphDynamicToolRequest({
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
      request: vi.fn().mockResolvedValue({
        action: "update",
        result: updatedSaved,
      }),
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

    expect(assistantConfigurationTool.request).toHaveBeenCalledOnce();
    expect(assistantConfigurationTool.request).toHaveBeenCalledWith({
      action: "update",
      assistantInputId: `ain_${"a".repeat(32)}`,
      model: HOSTED_ASSISTANT_LUNA_MODEL,
      reasoningEffort: "medium",
    });
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        provider: "openai",
        reasoningEffort: "low",
      },
      savedForNextTurn: updatedSaved,
    });
  });

  it("confirms an unchanged target through the input-bound update", async () => {
    const request = readTestMurphDynamicToolRequest({
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
      request: vi.fn().mockResolvedValue({
        action: "update",
        result: unchangedSaved,
      }),
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

    expect(assistantConfigurationTool.request).toHaveBeenCalledOnce();
    expect(assistantConfigurationTool.request).toHaveBeenCalledWith({
      action: "update",
      assistantInputId: `ain_${"d".repeat(32)}`,
      reasoningEffort: "low",
    });
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        provider: "openai",
        reasoningEffort: "low",
      },
      savedForNextTurn: unchangedSaved,
    });
  });

  it("saves an explicit core-reply provider from normal conversation", async () => {
    const request = readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "update",
          provider: "venice",
        },
        namespace: "murph",
        tool: "assistant_configuration",
      },
    });
    expect(request).toEqual({
      kind: "assistant-configuration",
      request: {
        action: "update",
        provider: "venice",
      },
    });
    if (!request) {
      throw new Error("Expected an assistant configuration dynamic tool request.");
    }

    const updatedSaved = {
      ...createSavedConfiguration({
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        provider: "venice",
        reasoningEffort: "low",
      }),
      appliesAt: "next_turn" as const,
      requiredPlan: null,
      status: "updated" as const,
    };
    const assistantConfigurationTool = {
      request: vi.fn().mockResolvedValue({
        action: "update",
        result: updatedSaved,
      }),
    };

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantConfigurationTool,
        assistantInputId: `ain_${"f".repeat(32)}`,
        currentModel: HOSTED_ASSISTANT_TERRA_MODEL,
        currentReasoningEffort: "low",
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(assistantConfigurationTool.request).toHaveBeenCalledOnce();
    expect(assistantConfigurationTool.request).toHaveBeenCalledWith({
      action: "update",
      assistantInputId: `ain_${"f".repeat(32)}`,
      provider: "venice",
    });
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        provider: "openai",
        reasoningEffort: "low",
      },
      savedForNextTurn: updatedSaved,
    });
  });

  it("returns the authoritative Edge upgrade requirement from the update", async () => {
    const request = readTestMurphDynamicToolRequest({
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
    const upgradeRequired = {
      ...createSavedConfiguration({
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        reasoningEffort: "low",
      }),
      appliesAt: "next_turn" as const,
      requiredPlan: "edge" as const,
      solAvailable: false,
      status: "upgrade_required" as const,
    };
    const assistantConfigurationTool = {
      request: vi.fn(async () => ({
        action: "update" as const,
        result: upgradeRequired,
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
      action: "update",
      assistantInputId: `ain_${"e".repeat(32)}`,
      model: HOSTED_ASSISTANT_SOL_MODEL,
    });
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        provider: "openai",
        reasoningEffort: "low",
      },
      savedForNextTurn: upgradeRequired,
    });
  });

  it("preserves the requested field mask", async () => {
    const request = readTestMurphDynamicToolRequest({
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
      request: vi.fn().mockResolvedValue({
        action: "update",
        result: updatedSaved,
      }),
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

    expect(assistantConfigurationTool.request).toHaveBeenCalledOnce();
    expect(assistantConfigurationTool.request).toHaveBeenCalledWith({
      action: "update",
      assistantInputId: `ain_${"b".repeat(32)}`,
      reasoningEffort: "medium",
    });
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        provider: "openai",
        reasoningEffort: "high",
      },
      savedForNextTurn: updatedSaved,
    });
  });

  it("clears dormant Sol intent when the member explicitly chooses Terra", async () => {
    const request = readTestMurphDynamicToolRequest({
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
    const updatedSaved = {
      ...createSavedConfiguration({
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        reasoningEffort: "low",
      }),
      appliesAt: "next_turn" as const,
      requiredPlan: null,
      solAvailable: false,
      dormantSolPreference: false,
      status: "updated" as const,
    };
    const assistantConfigurationTool = {
      request: vi.fn().mockResolvedValue({
        action: "update",
        result: updatedSaved,
      }),
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
    expect(assistantConfigurationTool.request).toHaveBeenCalledOnce();
    expect(assistantConfigurationTool.request).toHaveBeenCalledWith(expect.objectContaining({
      action: "update",
      assistantInputId: `ain_${"c".repeat(32)}`,
      model: HOSTED_ASSISTANT_TERRA_MODEL,
    }));
    expect(readToolPayload(result)).toEqual({
      currentTurn: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        provider: "openai",
        reasoningEffort: "low",
      },
      savedForNextTurn: updatedSaved,
    });
  });

  it("rejects empty updates and unsupported reasoning effort", () => {
    expect(readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { action: "update" },
        namespace: "murph",
        tool: "assistant_configuration",
      },
    })?.kind).toBe("invalid-assistant-configuration-arguments");
    expect(readTestMurphDynamicToolRequest({
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
  provider?: "openai" | "venice";
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
}) {
  return {
    availableModels: [...HOSTED_ASSISTANT_PRODUCT_MODELS],
    availableProviders: [...HOSTED_ASSISTANT_PROVIDERS],
    availableReasoningEfforts: [...HOSTED_ASSISTANT_REASONING_EFFORTS],
    configurationAvailable: true,
    dormantSolPreference: false,
    model: input.model,
    provider: input.provider ?? "openai",
    reasoningEffort: input.reasoningEffort,
    solAvailable: true,
  };
}

function createGroupSavedConfiguration(
  model: typeof HOSTED_ASSISTANT_LUNA_MODEL
    | typeof HOSTED_ASSISTANT_TERRA_MODEL
    | typeof HOSTED_ASSISTANT_SOL_MODEL,
) {
  return {
    availableModels: [...HOSTED_ASSISTANT_PRODUCT_MODELS],
    availableProviders: ["openai"] as const,
    availableReasoningEfforts: ["low"] as const,
    configurationAvailable: true,
    dormantSolPreference: false,
    model,
    provider: "openai" as const,
    reasoningEffort: "low" as const,
    solAvailable: true,
  };
}

function createHostedToolContext(input: {
  assistantInputId?: string | null;
  assistantConfigurationTool: NonNullable<
    AssistantHostedToolContext["assistantConfigurationTool"]
  >;
  conversationScope?: "direct" | "group";
  currentModel: string;
  currentReasoningEffort: string;
}): AssistantHostedToolContext {
  return {
    actionApprovalPort: null,
    assistantConfigurationTool: input.assistantConfigurationTool,
    computerToolsAvailable: false,
    currentAssistantInputId: () => input.assistantInputId ?? null,
    currentAssistantTarget: () => ({
      model: input.currentModel,
      provider: "openai",
      reasoningEffort: input.currentReasoningEffort,
    }),
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentUserActionScope: () => input.conversationScope
      ? {
          acceptedInputIds: input.assistantInputId ? [input.assistantInputId] : [],
          conversationId: null,
          conversationScope: input.conversationScope,
          inboundMailboxItemIds: [],
          originSessionId: "session-test",
          recipientKey: null,
        }
      : null,
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
