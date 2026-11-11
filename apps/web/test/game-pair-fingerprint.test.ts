import { expect, it } from "vitest";
import { gameGroupLoreFingerprint, gamePairLoreFingerprint } from "../src/lib/game/audience";

it("keys group lore by the stored original audience in a separate namespace", () => {
  const key = gameGroupLoreFingerprint("synthetic-audience-key");
  expect(key).toBe("1e3a9379ac8cc23ec5a556d1c6d287f6");
  expect(gameGroupLoreFingerprint("synthetic-audience-key")).toBe(key);
  expect(gameGroupLoreFingerprint("other-audience-key")).not.toBe(key);
  expect(gamePairLoreFingerprint(["member-a", "member-b"])).not.toBe(key);
});
