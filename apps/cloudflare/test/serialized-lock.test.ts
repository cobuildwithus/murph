import { describe, expect, it } from "vitest";

import { withSerializedLock } from "../src/serialized-lock.ts";

function createLockSlot() {
  let current: Promise<void> | null = null;

  return {
    get current(): Promise<void> | null {
      return current;
    },
    slot: {
      get: () => current,
      set: (value: Promise<void> | null) => {
        current = value;
      },
    },
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });

  return {
    promise,
    resolve,
  };
}

describe("withSerializedLock", () => {
  it("serializes overlapping runs and clears the slot after completion", async () => {
    const lock = createLockSlot();
    const firstGate = createDeferred();
    const order: string[] = [];

    const first = withSerializedLock(lock.slot, async () => {
      order.push("first:start");
      await firstGate.promise;
      order.push("first:end");
      return "first";
    });

    await Promise.resolve();

    const second = withSerializedLock(lock.slot, async () => {
      order.push("second:start");
      order.push("second:end");
      return "second";
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    expect(lock.current).not.toBeNull();

    firstGate.resolve();

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
    expect(lock.current).toBeNull();
  });

  it("releases the slot after a rejected run so later callers can proceed", async () => {
    const lock = createLockSlot();
    const firstGate = createDeferred();
    const order: string[] = [];

    const first = withSerializedLock(lock.slot, async () => {
      order.push("first:start");
      await firstGate.promise;
      order.push("first:throw");
      throw new Error("boom");
    });

    await Promise.resolve();

    const second = withSerializedLock(lock.slot, async () => {
      order.push("second:start");
      order.push("second:end");
      return "second";
    });

    firstGate.resolve();

    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("second");
    expect(order).toEqual([
      "first:start",
      "first:throw",
      "second:start",
      "second:end",
    ]);
    expect(lock.current).toBeNull();
  });
});
