import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION,
  parseHostedRuntimeAssistantPreferenceCausalSeqRequest,
  parseHostedRuntimeAssistantPreferenceCausalSeqResponse,
  parseHostedRuntimeAssistantPersonalizationToolAuthority,
  parseHostedRuntimeAssistantPersonalizationToolRequest,
  parseHostedRuntimeAssistantPersonalizationToolResponse,
} from "../src/assistant-personalization.ts";

describe("hosted assistant personalization contract", () => {
  it("accepts only canonical assistant input authority", () => {
    expect(parseHostedRuntimeAssistantPersonalizationToolAuthority({
      assistantInputId: "ain_0123456789abcdef0123456789abcdef",
    })).toEqual({
      assistantInputId: "ain_0123456789abcdef0123456789abcdef",
    });

    for (const authority of [
      { assistantInputId: "input_1" },
      { assistantInputId: "ain_0123456789ABCDEF0123456789ABCDEF" },
      { preferenceCausalSeq: "42" },
      {
        assistantInputId: "ain_0123456789abcdef0123456789abcdef",
        preferenceCausalSeq: "42",
      },
    ]) {
      expect(() => parseHostedRuntimeAssistantPersonalizationToolAuthority(
        authority,
      )).toThrow();
    }
  });

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

  it("keeps causal-sequence resolution private to its strict transport contract", () => {
    const request = {
      action: HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION,
    } as const;
    expect(parseHostedRuntimeAssistantPreferenceCausalSeqRequest(request))
      .toEqual(request);
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest(request))
      .toThrow();
    expect(() => parseHostedRuntimeAssistantPreferenceCausalSeqRequest({
      ...request,
      causalSeq: "42",
    })).toThrow();

    expect(parseHostedRuntimeAssistantPreferenceCausalSeqResponse({
      action: HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION,
      result: { causalSeq: "42" },
    })).toEqual({
      action: HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION,
      result: { causalSeq: "42" },
    });
    expect(() => parseHostedRuntimeAssistantPreferenceCausalSeqResponse({
      action: HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION,
      result: { causalSeq: "not-a-sequence" },
    })).toThrow();
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
