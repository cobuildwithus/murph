import { describe, expect, it } from "vitest";
import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

import {
  MURPH_FAMILY_PLAN_TOOL,
  MURPH_PLAN_USAGE_TOOL,
} from "../src/assistant-codex/dynamic-tools.js";

describe("assistant plan usage guidance", () => {
  it("keeps usage reads manual, honest, private, and non-coercive", () => {
    const guidance = MURPH_PLAN_USAGE_TOOL.description;

    expect(guidance).toContain("Never call it automatically during onboarding");
    expect(guidance).toContain("cost-weighted included usage");
    expect(guidance).toContain("not a literal token count or cash balance");
    expect(guidance).toContain("Communicate usage only through usedPercent and remainingPercent");
    expect(guidance).toContain("never expose, infer, or format internal currency amounts as usage progress");
    expect(guidance).toContain("invent no estimate, precision, scarcity, or urgency");
    expect(guidance).toContain("Never plead, imply Murph will die, use existential guilt");
    expect(guidance).toContain("only when recommendedAction is non-null");
    expect(guidance).toContain("and relevant to the member's request");
    expect(guidance).toContain("explicit request to manage billing");
    expect(guidance).toContain(
      `${MURPH_PRODUCT_ORIGIN}/settings#subscription`,
    );
    expect(guidance).toContain("only read status and made no billing or Family change");
    expect(guidance).toContain(
      "status is active or exhausted, or whose reason is trial_conversion_pending",
    );
    expect(guidance).toContain(
      "neutral Settings browser handoff, not a plan recommendation or billing action",
    );
    expect(guidance).toContain(
      "Do not provide that private account-management link for group_not_supported or hosted_access_inactive",
    );
    expect(guidance).toContain("not a group balance or top-up surface");
  });

  it("routes unsupported Family mutations through the private management handoff", () => {
    const guidance = MURPH_FAMILY_PLAN_TOOL.description;

    expect(guidance).toContain(
      "The only supported actions are read_status, start_checkout, and create_invite",
    );
    expect(guidance).toContain(
      "For invite cancellation, member removal, member-tier changes, or Family seat/capacity changes",
    );
    expect(guidance).toContain("do not invent an action or claim a change");
    expect(guidance).toContain("murph.plan_usage's explicit private management handoff");
  });
});
