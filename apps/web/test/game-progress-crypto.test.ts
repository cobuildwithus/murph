import { beforeEach, describe, expect, it, vi } from "vitest";
import * as secureBox from "../src/lib/hosted-crypto/secure-box";
import { openProgress, progressLookup, sealProgress, type ProgressSealTarget } from "../src/lib/game/progress/crypto";

const target: ProgressSealTarget = { memberId: "member-ava", table: "game_progress_measure", rowId: "opaque-measure", field: "state" };

// Authenticate every adapter binding in the test codec; AES itself is the secure-box owner's proof.
beforeEach(() => {
  secureBox.setHostedSecureBoxStringTestCodecForTests({
    encrypt({ value, ...binding }) { return JSON.stringify({ value, binding }); },
    decrypt({ value, ...binding }) {
      const stored = JSON.parse(value) as { value: string; binding: object };
      if (JSON.stringify(stored.binding) !== JSON.stringify(binding)) throw new Error("Binding mismatch");
      return stored.value;
    },
  });
});

describe("Progress sealing and keyed lookup", () => {
  it("uses the owner key and Progress-specific AAD, and decodes its own JSON", async () => {
    const spy = vi.spyOn(secureBox, "sealHostedUserSecureBoxStrings");
    const state = { perDay: 40, goal: { rungId: "empire-state-building" } };
    const sealed = await sealProgress(target, state);
    expect(spy).toHaveBeenCalledWith({ userId: "member-ava", lane: "hosted-member-private-field", entries: [{ scope: "game-progress",
      aad: { purpose: "game-progress", table: "game_progress_measure", rowId: "opaque-measure", field: "state" }, value: JSON.stringify(state) }] });
    expect(await openProgress(target, sealed)).toEqual(state);
  });
  it.each([
    { memberId: "member-leo" }, { table: "game_progress_award" as const }, { rowId: "other" }, { field: "meta" as const },
  ])("rejects a transplanted envelope: %j", async change => {
    const sealed = await sealProgress(target, { perDay: 40 });
    await expect(openProgress({ ...target, ...change }, sealed)).rejects.toThrow("Binding mismatch");
  });
  it("does not turn missing or corrupt ciphertext into empty state", async () => {
    await expect(openProgress(target, "")).rejects.toThrow();
    await expect(openProgress(target, "broken")).rejects.toThrow();
  });
  it("separates owners, purposes, task check-in kinds and tuple boundaries", () => {
    const key = progressLookup("member-ava", "task", ["40 pushups", "photo"]);
    expect(progressLookup("member-ava", "task", ["40 pushups", "photo"])).toBe(key);
    expect(key).not.toContain("pushups");
    const others = [progressLookup("member-leo", "task", ["40 pushups", "photo"]),
      progressLookup("member-ava", "measure", ["40 pushups", "photo"]), progressLookup("member-ava", "task", ["40 pushups", "any"]),
      progressLookup("member-ava", "task", ["40 pushups:photo"]), progressLookup("member-ava", "task", [key])];
    expect(others.every(other => other !== key)).toBe(true);
  });
});
