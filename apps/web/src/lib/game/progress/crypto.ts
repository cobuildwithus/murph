import "server-only";

import { openHostedUserSecureBoxStrings, sealHostedUserSecureBoxStrings } from "../../hosted-crypto/secure-box";
import { createHostedOpaqueIdentifier } from "../../hosted-onboarding/contact-privacy";

export interface ProgressSealTarget {
  memberId: string;
  table: "game_progress_award" | "game_progress_measure" | "game_progress_pic" | "game_progress_task_measure";
  rowId: string;
  field: "data" | "state" | "meta" | "measure";
}
const lane = "hosted-member-private-field" as const;
const scope = "game-progress";
const aad = (target: ProgressSealTarget) => ({ purpose: scope, table: target.table, rowId: target.rowId, field: target.field });

/** The JSON is ours: authenticate it, then decode without a second schema parse. */
export async function openProgressMany<T>(entries: readonly (ProgressSealTarget & { value: string })[]): Promise<T[]> {
  const values = await openHostedUserSecureBoxStrings({ lane,
    entries: entries.map(target => ({ aad: aad(target), scope, userId: target.memberId, value: target.value })),
  });
  return values.map(value => {
    if (value === null) throw new Error("Missing sealed Progress content.");
    return JSON.parse(value) as T;
  });
}

export async function openProgress<T>(target: ProgressSealTarget, value: string): Promise<T> {
  const [opened] = await openProgressMany<T>([{ ...target, value }]);
  return opened;
}

/** Batch one owner's fields so sealing unwraps one root, outside transactions. */
export async function sealProgressMany(memberId: string, entries: readonly (Omit<ProgressSealTarget, "memberId"> & { value: object })[]): Promise<string[]> {
  return sealHostedUserSecureBoxStrings({ lane, userId: memberId,
    entries: entries.map(target => ({ aad: aad({ ...target, memberId }), scope, value: JSON.stringify(target.value) })),
  });
}

export async function sealProgress(target: ProgressSealTarget, value: object): Promise<string> {
  const [sealed] = await sealProgressMany(target.memberId, [{ ...target, value }]);
  return sealed;
}

/** Task callers supply [normalized text, check-in kind]; names never become DB keys. */
export function progressLookup(memberId: string, purpose: "award" | "measure" | "task", parts: readonly string[]): string {
  // JSON framing also prevents the opaque-id helper's already-keyed shortcut.
  return createHostedOpaqueIdentifier(`game-progress-${purpose}`, JSON.stringify([memberId, ...parts]))!;
}
