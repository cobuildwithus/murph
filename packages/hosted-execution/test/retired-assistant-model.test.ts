import { describe, expect, it } from "vitest";
import {
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  parseHostedAssistantModelOverride,
  parseHostedRuntimeAssistantConfigurationControlRequest,
  parseHostedRuntimeAssistantConfigurationToolResponse,
} from "../src/assistant-model.ts";
import {
  HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS,
  normalizeHostedAiUsageAllowancePricedModelId,
  normalizeHostedAiUsageLedgerModelId,
} from "../src/runtime-control.ts";

describe("retired model compatibility", () => {
  it("excludes retired Sol from selection and deployment but prices historical evidence", () => {
    expect(HOSTED_ASSISTANT_PRODUCT_MODELS).not.toContain("gpt-5.6-sol");
    expect(HOSTED_ASSISTANT_PRODUCT_MODELS).toContain("gpt-5.6-luna");
    expect(HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS).not.toContain("gpt-5.6-sol");
    expect(parseHostedAssistantModelOverride("gpt-5.6-sol")).toBeNull();
    for (const model of ["gpt-5.6-sol", "openai/gpt-5.6-sol-2026-07-08"]) {
      expect(normalizeHostedAiUsageAllowancePricedModelId(model)).toBeNull();
      expect(normalizeHostedAiUsageLedgerModelId(model)).toBe("gpt-5.6-sol");
    }
    expect(() => parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "update", assistantInputId: `ain_${"a".repeat(32)}`, model: "gpt-5.6-sol",
    })).toThrow("not supported");
  });

  it("reads an old Web catalog without advertising or selecting retired Sol", () => {
    const response = parseHostedRuntimeAssistantConfigurationToolResponse({ action: "read", result: {
      availableModels: [...HOSTED_ASSISTANT_PRODUCT_MODELS, "gpt-5.6-sol"],
      availableReasoningEfforts: ["low", "high"], configurationAvailable: true,
      dormantSolPreference: false, model: "gpt-5.6-sol", reasoningEffort: "high", solAvailable: true,
    } });
    expect(response.result.availableModels).toEqual(HOSTED_ASSISTANT_PRODUCT_MODELS);
    expect(response.result.model).toBe("gpt-6.1-sol");
    expect(response.result.reasoningEffort).toBe("high");
  });
});
