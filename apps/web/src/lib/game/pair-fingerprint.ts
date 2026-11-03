import "server-only";
import { createHash } from "node:crypto";
import { isGameMemberSet } from "./roster";

export function gamePairLoreFingerprint(memberIds: readonly string[]): string {
  if (!isGameMemberSet(memberIds)) {
    throw new TypeError("Game lore requires 2 to 10 distinct players.");
  }
  return createHash("sha256")
    .update("murph-game-lore-v1\0")
    .update([...memberIds].sort().join("\0"))
    .digest("hex")
    .slice(0, 32);
}
