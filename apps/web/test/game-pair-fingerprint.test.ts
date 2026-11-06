import { describe, expect, it } from "vitest";
import { gameGroupLoreFingerprint, gamePairLoreFingerprint } from "../src/lib/game/audience";

describe("game lore pair fingerprint", () => {
  it("uses one opaque order-independent namespace per exact pair", () => {
    expect(gamePairLoreFingerprint(["member-a", "member-b"]))
      .toBe(gamePairLoreFingerprint(["member-b", "member-a"]));
    expect(gamePairLoreFingerprint(["member-a", "member-b"]))
      .toBe("78886ef1c33c23273f9cdab32323e051");
    expect(gamePairLoreFingerprint(["member-a", "member-c"]))
      .not.toBe(gamePairLoreFingerprint(["member-a", "member-b"]));
  });

  it("rejects anything other than two distinct players", () => {
    expect(() => gamePairLoreFingerprint(["member-a"])).toThrow();
    expect(() => gamePairLoreFingerprint(["member-a", "member-a"])).toThrow();
  });
});

it("keys group lore by the stored original audience in a separate namespace", () => {
  const key = gameGroupLoreFingerprint("synthetic-audience-key");
  expect(key).toBe("1e3a9379ac8cc23ec5a556d1c6d287f6");
  expect(gameGroupLoreFingerprint("synthetic-audience-key")).toBe(key);
  expect(gameGroupLoreFingerprint("other-audience-key")).not.toBe(key);
  expect(gamePairLoreFingerprint(["member-a", "member-b"])).not.toBe(key);
});
