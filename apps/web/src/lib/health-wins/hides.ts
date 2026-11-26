import "server-only";
import { Prisma } from "@prisma/client";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { GAME_BLOCK_LIMIT } from "../game/blocks";
import { openGameTexts } from "../game/crypto";
import { assertGameMemberAuthCurrentForRead, assertGameMemberAuthCurrentTx } from "../game/http/auth";
import { invalidGameRequest } from "../game/http/errors";
import { gameMediaUrl } from "../game/views";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS, lockHostedMemberRow } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import { hiddenHealthIdentitySql } from "./audience";

interface HiddenPerson {
  memberId: string;
  firstNameEncrypted: string | null;
  photoKey: string | null;
}

function hiddenPeople(db: Prisma.TransactionClient, viewerId: string) {
  return db.$queryRaw<HiddenPerson[]>`SELECT hidden.hidden_member_id AS "memberId",
      profile.first_name_encrypted AS "firstNameEncrypted", profile.photo_key AS "photoKey"
    FROM health_feed_hide hidden
    LEFT JOIN game_profile profile ON profile.member_id = hidden.hidden_member_id
      AND ${hiddenHealthIdentitySql(viewerId, Prisma.sql`hidden.hidden_member_id`)}
    WHERE hidden.member_id = ${viewerId}
    ORDER BY hidden.created_at DESC, hidden.hidden_member_id ASC LIMIT ${GAME_BLOCK_LIMIT}`;
}

export async function readHealthHides(auth: HostedNativeMemberAuth) {
  const db = getPrisma(), viewerId = auth.member.id;
  const rows = await hiddenPeople(db, viewerId);
  const names = await openGameTexts(rows.map(row => ({
    memberId: row.memberId, table: "game_profile", rowId: row.memberId,
    field: "first_name", value: row.firstNameEncrypted,
  })));
  const opened = new Map(rows.map((row, index) => [row.memberId, { ...row, firstName: names[index] }]));
  await assertGameMemberAuthCurrentForRead(auth, db);
  // An unhide or loss of profile access during decryption takes effect before returning the list.
  const current = rows.length ? await hiddenPeople(db, viewerId) : [];
  return { people: current.map(row => {
    const prior = opened.get(row.memberId);
    return {
      memberId: row.memberId,
      firstName: prior && prior.firstNameEncrypted === row.firstNameEncrypted ? prior.firstName : null,
      avatarUrl: row.photoKey ? gameMediaUrl(row.photoKey) : null,
    };
  }) };
}

export async function setHealthHide(auth: HostedNativeMemberAuth, hiddenMemberId: string, hidden: boolean) {
  const memberId = auth.member.id;
  if (memberId === hiddenMemberId) throw invalidGameRequest("Choose another person.");
  return getPrisma().$transaction(async tx => {
    // Serialize this owner's quota while allowing another member to hide them concurrently.
    await lockHostedMemberRow(tx, memberId, { noKeyUpdate: true });
    await assertGameMemberAuthCurrentTx(auth, tx);
    const where = { memberId, hiddenMemberId };
    if (!hidden) {
      await tx.healthFeedHide.deleteMany({ where });
    } else if (!await tx.healthFeedHide.findUnique({ where: { memberId_hiddenMemberId: where }, select: { memberId: true } })) {
      if (await tx.healthFeedHide.count({ where: { memberId } }) >= GAME_BLOCK_LIMIT) {
        throw hostedOnboardingError({ code: "HEALTH_HIDE_LIMIT", httpStatus: 409, message: "Your hide list is full." });
      }
      // An inaccessible or unknown target produces the same response and never enters the list.
      await tx.$executeRaw`INSERT INTO health_feed_hide (member_id, hidden_member_id)
        SELECT ${memberId}, target.id FROM hosted_member target WHERE target.id = ${hiddenMemberId}
          AND ${hiddenHealthIdentitySql(memberId, Prisma.sql`target.id`)}
        ON CONFLICT DO NOTHING`;
    }
    return { hidden };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}
