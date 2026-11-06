import { describe, expect, it } from "vitest";
import { parseHostedExecutionResolvedLinqDeliveryRoute } from "../src/routes.ts";

const direct = {
  conversationThreadId: "opaque-thread",
  directRecipientPhoneNumber: "+15550100001",
  fromPhoneNumber: "+15550100002",
  target: "chat-current",
  targetKind: "thread",
  threadIsDirect: true,
};

describe("canonical Linq delivery route parser", () => {
  it.each([
    direct,
    { ...direct, targetKind: "participant", target: direct.directRecipientPhoneNumber },
    { ...direct, threadIsDirect: false, directRecipientPhoneNumber: null },
    { ...direct, conversationThreadId: null, fromPhoneNumber: null, directRecipientPhoneNumber: null },
  ])("preserves a complete authorized route %#", (route) => {
    expect(parseHostedExecutionResolvedLinqDeliveryRoute(route)).toEqual(route);
  });

  it("normalizes route coordinates without changing their audience", () => {
    expect(parseHostedExecutionResolvedLinqDeliveryRoute({
      ...direct, target: " chat-current ", fromPhoneNumber: " +15550100002 ",
    })).toEqual(direct);
  });

  it.each([
    null, undefined, [], "route", {},
    { ...direct, target: " " },
    { ...direct, target: 123 },
    { ...direct, targetKind: "explicit" },
    { ...direct, threadIsDirect: "true" },
    { ...direct, conversationThreadId: undefined },
    { ...direct, conversationThreadId: " " },
    { ...direct, directRecipientPhoneNumber: undefined },
    { ...direct, directRecipientPhoneNumber: "member@example.test" },
    { ...direct, fromPhoneNumber: undefined },
    { ...direct, fromPhoneNumber: 123 },
    { ...direct, fromPhoneNumber: "15550100002" },
    { ...direct, targetKind: "participant" },
    { ...direct, targetKind: "participant", target: direct.directRecipientPhoneNumber, threadIsDirect: false },
    { ...direct, targetKind: "participant", target: direct.directRecipientPhoneNumber, directRecipientPhoneNumber: null },
    { ...direct, threadIsDirect: false },
  ])("rejects incomplete or contradictory route %#", (route) => {
    expect(parseHostedExecutionResolvedLinqDeliveryRoute(route)).toBeNull();
  });
});
