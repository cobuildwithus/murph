import { describe, expect, it } from "vitest";
import { isHostedSystemMailboxModelFreeNotification } from "../src/orchestration-control.ts";

describe("model-free system mailbox notification identity", () => {
  it("admits only a nonempty canonical group-join notification identity", () => {
    expect(isHostedSystemMailboxModelFreeNotification({
      dedupeKey: "assistant.notification.requested:group-join:membership",
      kind: "assistant.notification.requested",
    })).toBe(true);
    expect(isHostedSystemMailboxModelFreeNotification({
      dedupeKey: "assistant.notification.requested:group-join:",
      kind: "assistant.notification.requested",
    })).toBe(false);
    expect(isHostedSystemMailboxModelFreeNotification({
      dedupeKey: "assistant.notification.requested:other",
      kind: "assistant.notification.requested",
    })).toBe(false);
    expect(isHostedSystemMailboxModelFreeNotification({
      dedupeKey: "assistant.notification.requested:group-join:membership",
      kind: "runtime.maintenance-requested",
    })).toBe(false);
  });
});
