import { describe, expect, it } from "vitest";
import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

import {
  MURPH_FAMILY_PLAN_TOOL,
  MURPH_PLAN_USAGE_TOOL,
  MURPH_SUBSCRIPTION_TOOL,
} from "../src/assistant-codex/dynamic-tools.js";

describe("assistant plan usage guidance", () => {
  it("keeps usage reads manual, honest, private, and non-coercive", () => {
    const guidance = MURPH_PLAN_USAGE_TOOL.description;

    expect(guidance).toContain("Never call it automatically during onboarding");
    expect(guidance).toContain("cost-weighted included usage");
    expect(guidance).toContain("not a literal token count or cash balance");
    expect(guidance).toContain(
      "When answering an explicit numerical usage question, communicate usage only through usedPercent and remainingPercent",
    );
    expect(guidance).toContain("never expose, infer, or format internal currency amounts as usage progress");
    expect(guidance).toContain("invent no estimate, precision, scarcity, or urgency");
    expect(guidance).toContain("Never plead, imply Murph will die, use existential guilt");
    expect(guidance).toContain("any thresholded recommendation");
    expect(guidance).toContain("an optional explicit-request subscription quote");
    expect(guidance).toContain("only when recommendedAction is non-null");
    expect(guidance).toContain("and relevant to the member's request");
    expect(guidance).toContain(
      "When recommendedAction.kind is add_usage",
    );
    expect(guidance).toContain(
      `${MURPH_PRODUCT_ORIGIN}/settings?addUsage=true#subscription`,
    );
    expect(guidance).toContain(
      "Do not select an amount, invoke murph.subscription, initiate Checkout, or claim that payment or credit completed",
    );
    expect(guidance).toContain(
      "subscriptionActionQuote is current server-owned terms for an explicit request, not a recommendation or consent",
    );
    expect(guidance).toContain(
      "require a subscriptionActionQuote whose action exactly matches",
    );
    expect(guidance).toContain(
      "If that quote is absent or null, do not invoke the action",
    );
    expect(guidance).toContain(
      "one short reply-oriented question and include no URL",
    );
    expect(guidance).toContain("should we part ways?");
    expect(guidance).toContain("say nothing");
    expect(guidance).toContain(
      "a less capable model that uses less of your included usage",
    );
    expect(guidance).toContain("Do not assume the member knows Luna, Terra, or Sol");
    expect(guidance).toContain("Never switch models automatically");
    expect(guidance).toContain("a bare “yes” after multiple choices is insufficient");
    expect(guidance).toContain(
      "continue_pulse as non-charging continuation only when this current read confirms an active trial",
    );
    expect(guidance).toContain(
      "trial_conversion_pending or an ended trial, treat recovery as start-now",
    );
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
    expect(guidance).toContain(
      "not a Family or group balance, Family or group funding, Checkout, or payment surface",
    );
  });

  it("requires current matching terms and exact consent before a subscription action", () => {
    const guidance = MURPH_SUBSCRIPTION_TOOL.description;

    expect(guidance).toContain(
      "require a current murph.plan_usage subscriptionActionQuote whose action exactly matches",
    );
    expect(guidance).toContain("A quote is not a recommendation or consent");
    expect(guidance).toContain(
      "receive an explicit current-turn confirmation of that exact action",
    );
    expect(guidance).toContain("should we part ways?");
    expect(guidance).toContain(
      "a less capable model that uses less of your included usage",
    );
    expect(guidance).toContain("Do not assume the member knows Luna, Terra, or Sol");
    expect(guidance).toContain("For no_action_required, stay silent");
    expect(guidance).toContain(
      "when directly acknowledging continue_pulse, keep it brief and include no explanation or link",
    );
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
    expect(guidance).toContain(`${MURPH_PRODUCT_ORIGIN}/settings#family`);
    expect(guidance).toContain("owner=true, billingActive=true");
    expect(guidance).toContain("matches exactly one members row with status=active");
    expect(guidance).toContain("navigation only");
    expect(MURPH_PLAN_USAGE_TOOL.description).toContain(
      "For Family member usage management, do not use this tool or the personal subscription link",
    );
  });
});
