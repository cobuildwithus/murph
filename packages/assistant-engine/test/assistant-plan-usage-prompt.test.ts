import { describe, expect, it } from "vitest";

import {
  MURPH_FAMILY_PLAN_TOOL,
  MURPH_SUBSCRIPTION_TOOL,
} from "../src/assistant-codex/dynamic-tools.js";

describe("assistant plan and Family tool schemas", () => {
  it("offers one subscription action that requires a plan and a quote", () => {
    expect(MURPH_SUBSCRIPTION_TOOL.inputSchema.properties.action.enum)
      .toEqual(["change_plan"]);
    expect(MURPH_SUBSCRIPTION_TOOL.inputSchema.required).toEqual([
      "action",
      "targetPlanCode",
      "quoteId",
    ]);
  });

  it("offers three Family actions and takes an invite only on create_invite", () => {
    const actionSchemas = MURPH_FAMILY_PLAN_TOOL.inputSchema.oneOf;

    expect(actionSchemas.map((schema) => schema.properties.action.enum[0])).toEqual([
      "read_status",
      "start_checkout",
      "create_invite",
    ]);
    expect(actionSchemas[1]?.properties).not.toHaveProperty("invite");
    expect(actionSchemas[2]?.required).toEqual(["action", "invite"]);
  });
});
