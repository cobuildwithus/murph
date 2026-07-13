import { describe, expect, it } from "vitest";

import { MURPH_PLAN_USAGE_TOOL } from "../src/assistant-codex/dynamic-tools.js";

describe("assistant plan usage guidance", () => {
  it("keeps usage reads manual, honest, private, and non-coercive", () => {
    const guidance = MURPH_PLAN_USAGE_TOOL.description;

    expect(guidance).toContain("Never call it automatically during onboarding");
    expect(guidance).toContain("cost-weighted included usage");
    expect(guidance).toContain("not a literal token count or cash balance");
    expect(guidance).toContain("invent no estimate, precision, scarcity, or urgency");
    expect(guidance).toContain("Never plead, imply Murph will die, use existential guilt");
    expect(guidance).toContain("only when recommendedAction is non-null");
    expect(guidance).toContain("not a group balance or top-up surface");
  });
});
