import "server-only";
import {
  openHostedUserSecureBoxBytes,
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxBytes,
  sealHostedUserSecureBoxStrings,
} from "../hosted-crypto/secure-box";

const scope = "health-post";
const lane = "hosted-member-private-field";

export interface HealthSealTarget {
  memberId: string;
  table: "health_you_cache" | "health_profile_pin" | "health_activity" | "health_post" | "health_post_comment" | "health_post_attachment" | "health_win_set";
  rowId: string;
  field: string;
}

function aad({ table, rowId, field }: HealthSealTarget) {
  return { purpose: scope, table, rowId, field };
}

type HealthTextEntry = HealthSealTarget & { value: string };

/** One write belongs to one author. Unwrap the root once, before acquiring a database lock. */
export async function sealHealthTexts(entries: readonly HealthTextEntry[], signal?: AbortSignal): Promise<string[]> {
  if (!entries.length) return [];
  const memberId = entries[0].memberId;
  if (entries.some(entry => entry.memberId !== memberId)) throw new Error("Mixed health content owners in one write.");
  return sealHostedUserSecureBoxStrings({
    lane, userId: memberId, signal,
    entries: entries.map(entry => ({ aad: aad(entry), scope, value: entry.value })),
  });
}

/** Feed pages may span several authors. The secure-box batch opener groups the key unwraps. */
export async function openHealthTexts(entries: readonly HealthTextEntry[], signal?: AbortSignal): Promise<string[]> {
  if (!entries.length) return [];
  const values = await openHostedUserSecureBoxStrings({
    lane, signal,
    entries: entries.map(entry => ({ aad: aad(entry), scope, userId: entry.memberId, value: entry.value })),
  });
  return values.map(value => {
    if (value === null) throw new Error("Missing sealed health content.");
    return value;
  });
}

function photoBinding(memberId: string, id: string) {
  return { lane, scope, userId: memberId, aad: aad({ memberId, table: "health_post_attachment", rowId: id, field: "bytes" }) } as const;
}

export function sealHealthPhoto({ memberId, id, value }: { memberId: string; id: string; value: Uint8Array }) {
  return sealHostedUserSecureBoxBytes({ ...photoBinding(memberId, id), value });
}

export function openHealthPhoto({ memberId, id, value }: { memberId: string; id: string; value: string }) {
  return openHostedUserSecureBoxBytes({ ...photoBinding(memberId, id), value });
}
