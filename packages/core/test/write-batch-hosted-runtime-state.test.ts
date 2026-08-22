import { describe, expect, it } from "vitest";
import {
  persistHostedRuntimeStateAtCanonicalBoundary,
  withHostedCanonicalWritePort,
} from "../src/operations/write-batch.ts";

describe("hosted runtime-state canonical persistence", () => {
  it("uses exactly one ambient checkpoint owner", async () => {
    let calls = 0;
    await withHostedCanonicalWritePort(
      {
        persistCanonicalWrite: async () => undefined,
        persistRuntimeState: async () => { calls += 1; },
      },
      async () => persistHostedRuntimeStateAtCanonicalBoundary(),
    );
    expect(calls).toBe(1);
  });

  it("fails closed outside the canonical workspace boundary", async () => {
    await expect(persistHostedRuntimeStateAtCanonicalBoundary()).rejects.toThrow(/canonical write boundary/);
  });
});
