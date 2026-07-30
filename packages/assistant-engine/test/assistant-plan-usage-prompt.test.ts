import { describe, expect, it } from "vitest";

import {
  MURPH_FAMILY_PLAN_TOOL,
  MURPH_PLAN_USAGE_TOOL,
  MURPH_SUBSCRIPTION_TOOL,
} from "../src/assistant-codex/dynamic-tools.js";

describe("assistant plan usage call contracts", () => {
  it("keeps plan usage a concise private read contract", () => {
    const contract = MURPH_PLAN_USAGE_TOOL.description;

    expect(contract.length).toBeLessThanOrEqual(380);
    expect(contract).toContain("current private hosted plan");
    expect(contract).toContain("overall AI-usage projection");
    expect(contract).toContain(
      "Call only for an explicit plan, usage, billing request",
    );
    expect(contract).toContain("trusted low-usage context");
    expect(contract).toContain("This is read-only");
    expect(contract).toContain(
      "includeTopUpHistory",
    );
    expect(contract).toContain("beneficiary-scoped");
    expect(contract).toContain("added, used, adjusted, and remaining");
    expect(contract).toContain("a recommendation or quote is not consent");
    expect(contract).not.toContain("included-usage projection");
  });

  it("keeps subscription authorization and retry semantics in the call contract", () => {
    const contract = MURPH_SUBSCRIPTION_TOOL.description;

    expect(contract.length).toBeLessThanOrEqual(520);
    expect(contract).toContain("explicitly confirmed by the current user in this turn");
    expect(contract).toContain("require a current matching plan_usage quote");
    expect(contract).toContain("Exact replay of the same input and action is idempotent");
    expect(contract).toContain("a different action requires new eligible user input");
    expect(contract).toContain("Only payment_required includes paymentUrl");
    expect(contract).toContain("completed, pending, and no_action_required");
  });

  it("keeps Family operations and result truth in the call contract", () => {
    const contract = MURPH_FAMILY_PLAN_TOOL.description;

    expect(contract.length).toBeLessThanOrEqual(330);
    expect(MURPH_FAMILY_PLAN_TOOL.inputSchema.properties.action.enum).toEqual([
      "read_status",
      "start_checkout",
      "create_invite",
    ]);
    expect(contract).toContain(
      "Allow `read_status` for an explicit Family request",
    );
    expect(contract).toContain("trusted private low-usage Family context");
    expect(contract).toContain(
      "Checkout and invite actions require the current member's explicit request",
    );
    expect(contract).toContain("Treat results as exact");
    expect(contract).toContain("never claim activation, invitation, payment");
  });
});
