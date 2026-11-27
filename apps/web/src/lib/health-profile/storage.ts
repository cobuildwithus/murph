import "server-only";
import { profileFactorLookupKeys } from "../hosted-onboarding/contact-privacy-core";
import type { FrozenHealthCard } from "../health-wins/card-options";
import { openHealthTexts } from "../health-wins/crypto";
import { getPrisma } from "../prisma";
import type { HealthProfilePin } from "@prisma/client";
import { factors } from "./factors";

type Frozen = { kind: "milestone"; card: FrozenHealthCard["spec"]; pinnedOn: string };
export type Selector = Frozen | { kind: "streak"; gameId: string } | { kind: "age" };
export const pinTarget = (memberId: string, rowId: string) => ({ memberId, rowId, table: "health_profile_pin", field: "spec" } as const);
export function readPinRows(memberId: string) {
  return getPrisma().healthProfilePin.findMany({ where: { memberId }, orderBy: { position: "asc" }, take: 3 });
}

export async function openPinRows(memberId: string, rows: HealthProfilePin[]) {
  const opened = await openHealthTexts(rows.map(row => ({ ...pinTarget(memberId, row.sourceKey), value: row.specEncrypted })));
  return rows.map((row, i) => ({ row, stored: JSON.parse(opened[i]) as Selector }));
}

export async function storedPins(memberId: string) {
  return openPinRows(memberId, await readPinRows(memberId));
}

export const workingFactor = (member: string, key: string) => factors.find(f => profileFactorLookupKeys(member, f).candidates.includes(key));
export async function readWorkingSelections(memberId: string, viewer = memberId) {
  const rows = await getPrisma().healthWorkingOn.findMany({ where: { memberId }, orderBy: { position: "asc" }, take: 3,
    select: { factor: true, since: true, cheers: { where: { memberId: viewer }, take: 1, select: { memberId: true } } } });
  return rows.flatMap(row => {
    const factor = workingFactor(memberId, row.factor);
    return factor ? [{ factor, lookup: row.factor, since: row.since, cheered: row.cheers.length > 0 }] : [];
  });
}
