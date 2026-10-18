import "server-only";

import { openHostedUserSecureBoxStrings, sealHostedUserSecureBoxString } from "../hosted-crypto/secure-box";

/**
 * Game words (names, tasks, stakes, labels, captions, workout data) are
 * sealed under one member's key and bound to where they're stored. Seal
 * before a transaction starts; the key unwrap can call KMS.
 */
export interface GameSealTarget {
  /** Whose key: the profile owner, the game's creator, the poster, the label owner. */
  memberId: string;
  table: "game" | "game_contact_label" | "game_entry" | "game_profile";
  /** Labels bind to their owner, so an invite's label can move to its row as-is. */
  rowId: string;
  field: string;
}

const LANE = "hosted-member-private-field" as const;
const SCOPE = "weekly-game";

function aad(target: GameSealTarget) {
  return { field: target.field, purpose: SCOPE, rowId: target.rowId, table: target.table };
}

export async function sealGameText(target: GameSealTarget, value: string | null | undefined): Promise<string | null> {
  return sealHostedUserSecureBoxString({ aad: aad(target), lane: LANE, scope: SCOPE, userId: target.memberId, value });
}

export async function openGameTexts(
  entries: ReadonlyArray<GameSealTarget & { value: string | null | undefined }>,
): Promise<Array<string | null>> {
  if (entries.length === 0) return [];
  return openHostedUserSecureBoxStrings({
    entries: entries.map((entry) => ({ aad: aad(entry), scope: SCOPE, userId: entry.memberId, value: entry.value })),
    lane: LANE,
  });
}

export function labelTarget(ownerMemberId: string, field: "name" | "relationship"): GameSealTarget {
  return { field, memberId: ownerMemberId, rowId: ownerMemberId, table: "game_contact_label" };
}
