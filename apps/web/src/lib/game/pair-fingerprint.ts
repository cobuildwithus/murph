import "server-only";
import { createHash } from "node:crypto";

export function gamePairLoreFingerprint(memberIds: readonly string[]): string {
  if (memberIds.length !== 2 || new Set(memberIds).size !== 2) {
    throw new TypeError("Game lore requires one exact player pair.");
  }
  return createHash("sha256")
    .update("murph-game-lore-v1\0")
    .update([...memberIds].sort().join("\0"))
    .digest("hex")
    .slice(0, 32);
}
