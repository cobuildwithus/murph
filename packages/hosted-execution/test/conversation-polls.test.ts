import { describe, expect, it } from "vitest";
import { conversationPollRequestSchema } from "../src/conversation-polls.js";

const accepted = { assistantInputId: "ain_" + "a".repeat(32), request: { action: "list" } };
const scheduled = {
  origin: { kind: "automation_occurrence", automationId: "automation_weekly_poll", occurrenceAt: "2026-11-02T09:00:00.000-05:00" },
  route: { channel: "linq", target: "synthetic-chat" },
  request: { action: "create", question: "Which day?", options: ["Saturday", "Sunday"] },
};

describe("conversation poll envelopes", () => {
  it.each([accepted, scheduled, { ...scheduled, route: { channel: "telegram", target: "-100:topic:12" } }])("parses an authorized envelope", (input) => {
    expect(conversationPollRequestSchema.parse(input)).toEqual(input);
  });
  it.each([
    { ...accepted, route: scheduled.route },
    { ...accepted, origin: scheduled.origin },
    { ...accepted, extra: true },
    { ...scheduled, assistantInputId: accepted.assistantInputId },
    { ...scheduled, extra: true },
    { ...scheduled, origin: { ...scheduled.origin, sessionId: "synthetic-session" } },
    { ...scheduled, origin: { ...scheduled.origin, kind: "accepted_input" } },
    { ...scheduled, origin: { ...scheduled.origin, automationId: "" } },
    { ...scheduled, origin: { ...scheduled.origin, occurrenceAt: "tomorrow" } },
    { ...scheduled, route: { ...scheduled.route, threadIsDirect: true } },
    { ...scheduled, route: { ...scheduled.route, channel: "email" } },
    { ...scheduled, route: { ...scheduled.route, target: "" } },
    { origin: scheduled.origin, request: scheduled.request },
    { route: scheduled.route, request: scheduled.request },
    { ...scheduled, request: { ...scheduled.request, target: "other-chat" } },
    { ...accepted, request: { ...accepted.request, origin: scheduled.origin } },
  ])("rejects mixed, malformed or non-strict envelopes", (input) => {
    expect(conversationPollRequestSchema.safeParse(input).success).toBe(false);
  });
});
