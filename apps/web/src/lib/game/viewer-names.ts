import "server-only";

import { getPrisma } from "../prisma";
import { labelTarget, openGameTexts } from "./crypto";

/**
 * The names a viewer sees in the app: their private label for someone if they
 * set one, else that person's own first name. People without a name are left out.
 * The key unwrap can call KMS, so never call this inside a database transaction.
 */
export async function readNamesForViewer(viewerId: string, memberIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return new Map();
  const prisma = getPrisma();
  const [profiles, labels] = await Promise.all([
    prisma.gameProfile.findMany({ select: { firstNameEncrypted: true, memberId: true }, where: { memberId: { in: ids } } }),
    prisma.gameContactLabel.findMany({ select: { nameEncrypted: true, subjectMemberId: true }, where: { ownerMemberId: viewerId, subjectMemberId: { in: ids } } }),
  ]);
  const plain = await openGameTexts([
    ...labels.map((label) => ({ ...labelTarget(viewerId, "name"), value: label.nameEncrypted })),
    ...profiles.map((profile) => ({ field: "first_name", memberId: profile.memberId, rowId: profile.memberId, table: "game_profile" as const, value: profile.firstNameEncrypted })),
  ]);
  const labelName = new Map(labels.map((label, index) => [label.subjectMemberId, plain[index]]));
  const ownName = new Map(profiles.map((profile, index) => [profile.memberId, plain[labels.length + index]]));
  return new Map(ids.flatMap((id) => {
    const name = labelName.get(id) || ownName.get(id);
    return name ? [[id, name] as const] : [];
  }));
}

/** A push names the person when it can; a failed read keeps the nameless wording. */
export async function readPushName(viewerId: string, memberId: string): Promise<string | null> {
  try {
    return (await readNamesForViewer(viewerId, [memberId])).get(memberId) ?? null;
  } catch {
    return null;
  }
}
