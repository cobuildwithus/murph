import { describe, expect, it, vi } from "vitest";
import { assistantVoiceOptions } from "@murphai/contracts";
import {
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
} from "@murphai/hosted-execution/assistant-model";
import type {
  HostedRuntimeAssistantPersonalizationToolRequest,
} from "@murphai/hosted-execution/assistant-personalization";

import {
  executeMurphDynamicToolRequest,
  MURPH_ASSISTANT_PERSONALIZATION_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.js";
import type {
  AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.js";
import {
  normalizeAssistantExecutionContext,
  type AssistantHostedPersonalizationTool,
} from "../src/assistant/execution-context.js";

describe("assistant personalization dynamic tool", () => {
  it("is discoverable only when the hosted personalization port is present", () => {
    expect(resolveMurphDynamicTools({
      personalizationAvailable: true,
    })).toContain(MURPH_ASSISTANT_PERSONALIZATION_TOOL);
    expect(resolveMurphDynamicTools({
      personalizationAvailable: false,
    })).not.toContain(MURPH_ASSISTANT_PERSONALIZATION_TOOL);
  });

  it("preserves and binds the hosted personalization port through execution-context normalization", async () => {
    const assistantPersonalizationTool = {
      async request(request: HostedRuntimeAssistantPersonalizationToolRequest) {
        expect(this).toBe(assistantPersonalizationTool);
        expect(request).toEqual({ action: "read" });
        return {
          action: "read" as const,
          result: {
            model: HOSTED_ASSISTANT_TERRA_MODEL,
            solAvailable: false,
            tone: "formal" as const,
            voice: "upbeat" as const,
          },
        };
      },
    } satisfies AssistantHostedPersonalizationTool;
    const executionContext = normalizeAssistantExecutionContext({
      hosted: {
        assistantPersonalizationTool,
        memberId: "member_personalization_context",
        userEnvKeys: [],
      },
    });
    const normalizedTool = executionContext.hosted?.assistantPersonalizationTool;
    if (!normalizedTool) {
      throw new Error("Expected a normalized assistant personalization tool.");
    }

    await expect(normalizedTool.request({ action: "read" })).resolves.toEqual({
      action: "read",
      result: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        solAvailable: false,
        tone: "formal",
        voice: "upbeat",
      },
    });
  });

  it("publishes a strict discriminated read/update JSON Schema", () => {
    const [readSchema, updateSchema] =
      MURPH_ASSISTANT_PERSONALIZATION_TOOL.inputSchema.oneOf;

    expect(readSchema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", const: "read" },
      },
      required: ["action"],
    });
    expect(updateSchema.anyOf).toEqual([
      { required: ["model"] },
      { required: ["tone"] },
      { required: ["voice"] },
    ]);
    expect(updateSchema.additionalProperties).toBe(false);
    expect(updateSchema.properties.action).toEqual({
      type: "string",
      const: "update",
    });
    expect(updateSchema.properties.model.description).toBe(
      `Optional hosted model id for update. Canonical display label -> id mapping: Terra -> \`${HOSTED_ASSISTANT_TERRA_MODEL}\`; Sol -> \`${HOSTED_ASSISTANT_SOL_MODEL}\`. Translate the member's display-label choice with this mapping; Sol remains Edge-gated.`,
    );
    const exactVoiceMapping = assistantVoiceOptions
      .map((option) => `${JSON.stringify(option.label)} -> \`${option.id}\``)
      .join("; ");
    expect(updateSchema.properties.voice.description).toBe(
      `Optional saved voice id for update. Canonical display label -> id mapping: ${exactVoiceMapping}. Translate the member's display-label choice with this mapping; do not invent or guess voice ids.`,
    );
    expect(updateSchema.properties.voice.description).toContain(
      '"Classic Murph" -> `upbeat`',
    );
    expect(updateSchema.properties.voice.description).toContain(
      '"New York" -> `classic`',
    );
  });

  it.each([
    {
      accepted: true,
      arguments: { action: "read" },
      name: "read",
    },
    {
      accepted: true,
      arguments: { action: "update", tone: "formal" },
      name: "non-empty update",
    },
    {
      accepted: false,
      arguments: { action: "update" },
      name: "empty update",
    },
    {
      accepted: false,
      arguments: { action: "read", voice: "upbeat" },
      name: "read with an update field",
    },
    {
      accepted: false,
      arguments: { action: "update", tone: "formal", unexpected: true },
      name: "update with an extra field",
    },
  ])("keeps strict runtime parsing aligned with the exposed contract for $name", ({
    accepted,
    arguments: argumentsValue,
  }) => {
    const parsed = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: argumentsValue,
        namespace: "murph",
        tool: "personalization",
      },
    });

    expect(parsed?.kind === "assistant-personalization").toBe(accepted);
  });

  it("parses and executes a typed update with effective result truth", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "update",
          model: "gpt-5.6-sol",
          tone: "casual",
        },
        namespace: "murph",
        tool: "personalization",
      },
    });
    expect(request).toEqual({
      kind: "assistant-personalization",
      request: {
        action: "update",
        model: "gpt-5.6-sol",
        tone: "casual",
      },
    });
    if (!request) {
      throw new Error("Expected an assistant personalization request.");
    }

    const assistantPersonalizationTool = {
      request: vi.fn(async () => ({
        action: "update" as const,
        result: {
          model: "gpt-5.6-sol" as const,
          modelChangeAppliesNextRun: true,
          modelUpdated: true,
          rejectionReason: null,
          solAvailable: true,
          status: "saved" as const,
          styleUpdated: true,
          tone: "casual" as const,
          updated: true,
          voice: "warm" as const,
        },
      })),
    };
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext(assistantPersonalizationTool),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(assistantPersonalizationTool.request).toHaveBeenCalledWith({
      action: "update",
      model: "gpt-5.6-sol",
      tone: "casual",
    });
    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"modelChangeAppliesNextRun":true',
    );
    expect(result.rpcResult.contentItems[0]?.text).toContain('"status":"saved"');
  });

});

function createHostedToolContext(
  assistantPersonalizationTool: NonNullable<
    AssistantHostedToolContext["assistantPersonalizationTool"]
  >,
): AssistantHostedToolContext {
  return {
    assistantPersonalizationTool,
    computerToolsAvailable: false,
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
