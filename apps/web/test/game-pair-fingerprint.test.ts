import { describe, expect, it } from "vitest";
import { gamePairLoreFingerprint } from "../src/lib/game/pair-fingerprint";

describe("game lore pair fingerprint", () => {
  it("uses one opaque order-independent namespace per exact pair", () => {
    expect(gamePairLoreFingerprint(["member-a", "member-b"]))
      .toBe(gamePairLoreFingerprint(["member-b", "member-a"]));
    expect(gamePairLoreFingerprint(["member-a", "member-b"]))
      .toMatch(/^[a-f0-9]{32}$/u);
    expect(gamePairLoreFingerprint(["member-a", "member-c"]))
      .not.toBe(gamePairLoreFingerprint(["member-a", "member-b"]));
  });

  it("rejects anything other than two distinct players", () => {
    expect(() => gamePairLoreFingerprint(["member-a"])).toThrow();
    expect(() => gamePairLoreFingerprint(["member-a", "member-a"])).toThrow();
  });
});
