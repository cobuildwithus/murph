import { describe, expect, it } from "vitest";

import {
  parseHostedRuntimeAssistantPersonalizationToolRequest,
  parseHostedRuntimeAssistantPersonalizationToolResponse,
} from "../src/assistant-personalization.ts";

describe("hosted assistant personalization contract", () => {
  it("accepts strict read and non-empty update requests", () => {
    expect(parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "read",
    })).toEqual({ action: "read" });
    expect(parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "update",
      tone: "casual",
      voice: "warm",
    })).toEqual({
      action: "update",
      tone: "casual",
      voice: "warm",
    });
  });

  it("rejects empty, unknown, and out-of-domain updates", () => {
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "update",
    })).toThrow("requires a tone or voice");
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "read",
      tone: "casual",
    })).toThrow();
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "update",
      model: "gpt-5.6-sol",
    })).toThrow();
  });

  it("parses saved and unchanged tone/voice results with read-only model context", () => {
    expect(parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "update",
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        solAvailable: false,
        status: "saved",
        tone: "formal",
        voice: "warm",
      },
    })).toEqual({
      action: "update",
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        solAvailable: false,
        status: "saved",
        tone: "formal",
        voice: "warm",
      },
    });
    expect(parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "update",
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        solAvailable: true,
        status: "unchanged",
        tone: "formal",
        voice: "warm",
      },
    })).toMatchObject({
      result: {
        status: "unchanged",
      },
    });
  });

  it("requires effective non-null tone and voice values in tool responses", () => {
    expect(() => parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "read",
      result: {
        model: "gpt-5.6-terra",
        solAvailable: false,
        tone: null,
        voice: "upbeat",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "read",
      result: {
        model: "gpt-5.6-terra",
        solAvailable: false,
        tone: "formal",
        voice: null,
      },
    })).toThrow();
  });

  it("rejects impossible model, rejection, and duplicate update states", () => {
    const validResult = {
      model: "gpt-5.6-terra",
      modelChangeAppliesNextRun: false,
      modelUpdated: false,
      solAvailable: true,
      status: "saved",
      tone: "formal",
      voice: "warm",
    } as const;

    for (const result of [
      { ...validResult, modelUpdated: true },
      { ...validResult, modelChangeAppliesNextRun: true },
      { ...validResult, rejectionReason: "sol_requires_edge" },
      { ...validResult, status: "rejected" },
      { ...validResult, styleUpdated: true },
      { ...validResult, updated: true },
    ]) {
      expect(() => parseHostedRuntimeAssistantPersonalizationToolResponse({
        action: "update",
        result,
      })).toThrow();
    }
  });
});
