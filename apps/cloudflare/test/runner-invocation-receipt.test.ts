import { describe, expect, it } from "vitest";
import { RunnerInvocationReceiptStore } from "../src/runner-invocation-receipt.ts";
import { createTestSqlStorage } from "./sql-storage.ts";

describe("native invocation receipts", () => {
  it("retains uncertain launches across eviction and forbids a successor", () => {
    const sql = createTestSqlStorage();
    const first = new RunnerInvocationReceiptStore(sql);
    expect(first.register({ attemptId: "attempt-1", generation: "1" })).toBe("new");
    const recovered = new RunnerInvocationReceiptStore(sql);
    expect(recovered.register({ attemptId: "attempt-1", generation: "1" })).toBe("existing");
    expect(() => recovered.register({ attemptId: "attempt-2", generation: "2" })).toThrow("unresolved");
    expect(recovered.read()?.state).toBe("registered");
  });

  it("allows warm reuse only after completion, fencing delayed launch and completion RPCs", () => {
    const sql = createTestSqlStorage();
    const receipt = new RunnerInvocationReceiptStore(sql);
    const first = { attemptId: "attempt-1", generation: "9007199254740993" };
    const second = { attemptId: "attempt-2", generation: "9007199254740994" };
    receipt.register(first);
    expect(receipt.complete(first, true)).toBe(true);
    const recovered = new RunnerInvocationReceiptStore(sql);
    expect(recovered.read()).toEqual({ ...first, state: "completed", immediateRecheckRequested: true });
    expect(recovered.register(first)).toBe("existing");
    expect(recovered.register(second)).toBe("new");
    expect(() => recovered.register(first)).toThrow("Stale");
    expect(() => recovered.register({ ...second, attemptId: "wrong-attempt" })).toThrow("Stale");
    expect(recovered.complete(first, true)).toBe(false);
    expect(recovered.read()).toEqual({ ...second, state: "registered", immediateRecheckRequested: false });
  });
  it("keeps uncertain usage settlement closed across eviction and clears only its exact receipt", () => {
    const sql = createTestSqlStorage();
    const runtime = { attemptId: "usage-attempt", generation: "1" };
    const receipt = new RunnerInvocationReceiptStore(sql);
    receipt.register(runtime);
    expect(receipt.usageSettlementAllowsProviders(runtime)).toBe(true);
    expect(receipt.beginUsageSettlement(runtime, "usage-a")).toBe(true);
    expect(receipt.beginUsageSettlement(runtime, "usage-b")).toBe(true);
    const recovered = new RunnerInvocationReceiptStore(sql);
    expect(recovered.usageSettlementAllowsProviders(runtime)).toBe(false);
    recovered.finishUsageSettlement(runtime, "usage-a", true);
    expect(recovered.usageSettlementAllowsProviders(runtime)).toBe(false);
    expect(recovered.beginUsageSettlement(runtime, "usage-b")).toBe(true);
    recovered.finishUsageSettlement(runtime, "usage-b", true);
    expect(recovered.usageSettlementAllowsProviders(runtime)).toBe(true);
    recovered.beginUsageSettlement(runtime, "usage-denied");
    recovered.finishUsageSettlement(runtime, "usage-denied", false);
    recovered.finishUsageSettlement(runtime, "usage-denied", true);
    expect(recovered.usageSettlementAllowsProviders(runtime)).toBe(false);
    recovered.complete(runtime, false);
    const next = { attemptId: "next-usage-attempt", generation: "2" };
    recovered.register(next);
    expect(recovered.beginUsageSettlement(runtime, "stale-report")).toBe(false);
    expect(recovered.usageSettlementAllowsProviders(next)).toBe(true);
  });

});
