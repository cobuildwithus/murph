import { expect, it } from "vitest";
import { buildAssistantSystemPrompt } from "../src/assistant/system-prompt.js";
it.each([false, true])("composes canonical demographic persistence without gender inference (onboarding=%s)", onboardingGuidance => {
  const prompt = buildAssistantSystemPrompt({ assistantCliContract: null,
    channel: "linq", cliAccess: { rawCommand: "vault-cli" }, conversationScope: "direct",
    currentLocalDate: "2026-01-01", currentTimeZone: "UTC", hostedRuntime: true,
    onboardingGuidance, ordinaryInboundTurn: true,
  });
  // The route lives in every chat; the option rules (--as-of, clearing) stay in
  // the command's own help.
  expect(prompt).toContain("Save stated birth year, age or biological sex only with `vault-cli memory set-demographics`");
  expect(prompt).toContain("never infer sex from gender");
  expect(prompt).not.toContain("Identity or Context memory for optional demographics");
});
