import { describe, expect, it } from "vitest";
import { classifyHostedFirstLiveSystemItemOwnership } from "@/src/lib/hosted-orchestration/runtime-reconciliation-facts";

describe("first live system mailbox ownership", () => {
  it("keeps generic notifications default-owned while admitting canonical group joins", () => {
    expect(classifyHostedFirstLiveSystemItemOwnership({
      dedupeKey: "assistant.notification.requested:group-join:membership",
      kind: "assistant.notification.requested",
    })).toBe("model_free");
    expect(classifyHostedFirstLiveSystemItemOwnership({
      dedupeKey: "assistant.notification.requested:generic",
      kind: "assistant.notification.requested",
    })).toBe("default_owned");
    expect(classifyHostedFirstLiveSystemItemOwnership({
      dedupeKey: "runtime.maintenance-requested:item",
      kind: "runtime.maintenance-requested",
    })).toBe("model_free");
  });
});
