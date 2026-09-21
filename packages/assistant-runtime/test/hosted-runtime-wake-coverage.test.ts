import { describe, expect, it } from "vitest";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";

const covered = { mailboxWakeHighWater: { conversation: "4", system: "2" } };

describe("mailbox wake coverage", () => {
  it("coalesces lane maxima without losing sequence precision", () => {
    const signal = createCoalescingRuntimeWakeSignal();
    signal.notify(covered);
    signal.notify({ mailboxWakeHighWater: { conversation: "9007199254740993", system: "1" } });
    signal.notify({ mailboxWakeHighWater: { conversation: "5", system: "3" } });
    expect(signal.consumePending()?.mailboxWakeHighWater).toEqual({
      conversation: "9007199254740993", system: "3",
    });
    signal.notify(covered);
    expect(signal.consumePending()?.mailboxWakeHighWater).toEqual(covered.mailboxWakeHighWater);
  });

  it.each(["first", "middle", "last"])("unknown %s wake poisons the whole pending burst", (position) => {
    const signal = createCoalescingRuntimeWakeSignal();
    if (position === "first") signal.notify();
    signal.notify(covered);
    if (position === "middle") signal.notify();
    signal.notify(covered);
    if (position === "last") signal.notify();
    expect(signal.consumePending()?.mailboxWakeHighWater).toBeUndefined();
    signal.notify(covered);
    expect(signal.consumePending()?.mailboxWakeHighWater).toEqual(covered.mailboxWakeHighWater);
  });

  it("preserves unknown coverage through waiter burst coalescing", async () => {
    const signal = createCoalescingRuntimeWakeSignal();
    const wake = signal.wait();
    signal.notify(covered);
    signal.notify();
    signal.notify(covered);
    expect((await wake).mailboxWakeHighWater).toBeUndefined();
  });
});
