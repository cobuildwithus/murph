import assert from "node:assert/strict";

export function assertIdentityIndexMatchesLedger<T>(cached: T, rebuilt: T): void {
  assert.deepEqual(cached, rebuilt, "warm identity state must equal a fresh ledger reduction");
}
