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
    expect(contract).toContain("AI-usage");
    expect(contract).toContain("explicit plan, usage, billing");
    expect(contract).toContain("trusted low-usage context");
    expect(contract).toContain("exact user-named plan");
    expect(contract).toContain("matching quote");
    expect(contract).toContain("availablePlans is only the trial list");
    expect(contract).toContain("Read-only");
    expect(contract).toContain(
      "percentages and forecasts cover all available usage",
    );
    expect(contract).toContain("without credit-source splits");
    expect(contract).not.toContain("included/purchased");
    expect(contract).not.toContain("included-usage projection");
  });

  it("keeps subscription authorization and retry semantics in the call contract", () => {
    const contract = MURPH_SUBSCRIPTION_TOOL.description;

    expect(contract.length).toBeLessThanOrEqual(520);
    expect(contract).toContain("explicitly confirmed by the current user in this turn");
    expect(contract).toContain("current matching plan_usage quote");
    expect(MURPH_SUBSCRIPTION_TOOL.inputSchema.properties.action.enum)
      .toEqual(["change_plan"]);
    expect(MURPH_SUBSCRIPTION_TOOL.inputSchema.required).toEqual([
      "action",
      "targetPlanCode",
      "quoteId",
    ]);
    expect(contract).toContain("Exact replay of the same input and action is idempotent");
    expect(contract).toContain("a different target requires new eligible user input");
    expect(contract).toContain("Only payment_required includes paymentUrl");
    expect(contract).toContain("other results do not prove a payment method");
  });

  it("keeps Family operations and result truth in the call contract", () => {
    const contract = MURPH_FAMILY_PLAN_TOOL.description;
    const actionSchemas = MURPH_FAMILY_PLAN_TOOL.inputSchema.oneOf;

    expect(contract.length).toBeLessThanOrEqual(330);
    expect(actionSchemas.map((schema) => schema.properties.action.enum[0])).toEqual([
      "read_status",
      "start_checkout",
      "create_invite",
    ]);
    expect(actionSchemas[1]?.properties).not.toHaveProperty("invite");
    expect(actionSchemas[2]?.required).toEqual(["action", "invite"]);
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
