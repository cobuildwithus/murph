import "server-only";
import { Prisma } from "@prisma/client";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { readPairBoard } from "../game/board";
import { openGameTexts } from "../game/crypto";
import { assertGameMemberAuthCurrentForRead } from "../game/http/auth";
import { gameNotFound } from "../game/http/errors";
import { gameMediaUrl } from "../game/views";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { hostedLaunchConsentGrantedSql } from "../legal/consent";
import { getPrisma } from "../prisma";
import { eligibleHealthAuthorsSql, findVisibleHealthPost, healthPostAudienceSql, visibleHealthCommentOnPostSql, visibleHealthCommentSql, visibleHealthPersonSql, visibleHealthPostSql } from "./audience";
import { isHealthYouEnabled } from "./flag";
import { assertProfileAccess } from "../health-profile/access";
import { readExtendedProfile } from "../health-profile/profile";
import { openHealthTexts } from "./crypto";
import type { FrozenHealthCard } from "./card-options";
import { openHealthCursor, sealHealthCursor, type HealthPagePosition } from "./cursor";

const PAGE_SIZE = 20;
type Db = Prisma.TransactionClient;
type Auth = HostedNativeMemberAuth;
interface Identity { authorMemberId: string; firstNameEncrypted: string | null; photoKey: string | null }
interface PostRow extends Identity, HealthPagePosition {
  receiptOnly: boolean;
  version: number; captionEncrypted: string | null; cardsEncrypted: string[]; attachmentId: string | null; cheered: boolean;
}
interface CommentRow extends Identity, HealthPagePosition {
  postId: string; bodyEncrypted: string; visibility: "everyone" | "poster";
  recipientMemberId: string | null; recipientFirstNameEncrypted: string | null;
}

function cursorWhere(cursor: HealthPagePosition | undefined, position: Prisma.Sql) {
  return cursor ? Prisma.sql`AND ${position} < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : Prisma.empty;
}

function finishRead<T>(auth: Auth, read: (tx: Db) => Promise<T>) {
  return getPrisma().$transaction(async tx => {
    await assertGameMemberAuthCurrentForRead(auth, tx);
    return read(tx);
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function together<const T extends readonly unknown[]>(tasks: T) {
  try {
    return await Promise.all(tasks);
  } catch (error) {
    await Promise.allSettled(tasks);
    throw error;
  }
}

async function names(rows: readonly Identity[]) {
  const unique = [...new Map(rows.map(row => [row.authorMemberId, row])).values()];
  const opened = await openGameTexts(unique.map(row => ({ memberId: row.authorMemberId, table: "game_profile",
    rowId: row.authorMemberId, field: "first_name", value: row.firstNameEncrypted })));
  return new Map(unique.map((row, index) => [row.authorMemberId, {
    firstName: opened[index], avatarUrl: row.photoKey ? gameMediaUrl(row.photoKey) : null,
  }]));
}

interface PostFilter { author?: string; postId?: string; cursor?: HealthPagePosition }

// A withdrawn author still needs an ID to delete a post. Its content stays sealed.
function ownerReceiptOnlySql(viewer: string) {
  return Prisma.sql`(p.author_member_id = ${viewer} AND NOT (${hostedLaunchConsentGrantedSql(Prisma.sql`${viewer}::text`)}))`;
}

export function healthPostPageSql(viewerId: string, filter: PostFilter) {
  const seek = cursorWhere(filter.cursor, Prisma.sql`(p.created_at, p.id)`);
  const limit = PAGE_SIZE + 1;
  // Seek each eligible author by index. An empty feed never walks other people's post histories.
  // deleted_at is always NULL here; naming that index column keeps the suffix ordered in PostgreSQL.
  const page = filter.postId || filter.author ? Prisma.sql`
    SELECT p.id, p.created_at FROM health_post p WHERE ${visibleHealthPostSql(viewerId, "includeOwnerReceipt")}
      ${filter.author ? Prisma.sql`AND p.author_member_id = ${filter.author}` : Prisma.empty}
      ${filter.postId ? Prisma.sql`AND p.id = ${filter.postId}::uuid` : Prisma.empty} ${seek}
    ORDER BY p.deleted_at, p.created_at DESC, p.id DESC LIMIT ${limit}` : Prisma.sql`
    SELECT recent.* FROM (${eligibleHealthAuthorsSql(viewerId)}) authors
    CROSS JOIN LATERAL (
      SELECT p.id, p.created_at FROM health_post p WHERE p.author_member_id = authors.member_id AND p.deleted_at IS NULL
        AND ${healthPostAudienceSql(viewerId)} ${seek}
      ORDER BY p.deleted_at, p.created_at DESC, p.id DESC LIMIT ${limit}
    ) recent ORDER BY recent.created_at DESC, recent.id DESC LIMIT ${limit}`;
  return Prisma.sql`WITH page AS MATERIALIZED (${page})
    SELECT p.id, p.author_member_id AS "authorMemberId", p.created_at AS "createdAt", p.version, ${ownerReceiptOnlySql(viewerId)} AS "receiptOnly",
      p.caption_encrypted AS "captionEncrypted", p.cards_encrypted AS "cardsEncrypted",
      profile.first_name_encrypted AS "firstNameEncrypted", profile.photo_key AS "photoKey",
      photo.id AS "attachmentId",
      EXISTS (SELECT 1 FROM health_post_cheer cheer WHERE cheer.post_id = p.id AND cheer.member_id = ${viewerId}) AS cheered
    FROM page picked JOIN health_post p ON p.id = picked.id
    LEFT JOIN game_profile profile ON profile.member_id = p.author_member_id
    LEFT JOIN health_post_attachment photo ON photo.post_id = p.id AND photo.status = 'published'
    ORDER BY p.created_at DESC, p.id DESC`;
}

async function preparePosts(db: Db, viewer: string, filter: PostFilter) {
  const fetched = await db.$queryRaw<PostRow[]>(healthPostPageSql(viewer, filter));
  const rows = fetched.slice(0, PAGE_SIZE);
  const readable = rows.filter(row => !row.receiptOnly);
  const fields = readable.flatMap(row => {
    const target = { memberId: row.authorMemberId, table: "health_post", rowId: row.id } as const;
    const entries = row.cardsEncrypted.map((value, index) => ({ ...target, field: `card:${index}`, value }));
    if (row.captionEncrypted !== null) entries.unshift({ ...target, field: "caption", value: row.captionEncrypted });
    return entries;
  });
  const [identities, content, nextCursor] = await together([names(readable), openHealthTexts(fields),
    sealHealthCursor(viewer, filter.author ? `profile:${filter.author}` : "feed", fetched.length > PAGE_SIZE ? rows.at(-1) : undefined),
  ]);
  let index = 0;
  const posts = rows.map(row => {
    const receipt = { id: row.id, createdAt: row.createdAt.toISOString(), version: row.version };
    if (row.receiptOnly) return { receipt };
    return { receipt, post: {
      ...receipt, authorMemberId: row.authorMemberId, ...identities.get(row.authorMemberId)!,
      attachmentId: row.attachmentId, cheered: row.cheered,
      caption: row.captionEncrypted === null ? null : content[index++],
      cards: row.cardsEncrypted.map(() => JSON.parse(content[index++]) as FrozenHealthCard),
    } };
  });
  return { posts, nextCursor };
}

/** Reject edits, deletion, revoked consent and changed relationships after all slow work. */
async function finishPosts(db: Db, viewer: string, page: Awaited<ReturnType<typeof preparePosts>>) {
  if (!page.posts.length) return { posts: [], nextCursor: null };
  const ids = page.posts.map(({ receipt }) => Prisma.sql`${receipt.id}::uuid`);
  const rows = await db.$queryRaw<Array<Pick<PostRow, "id" | "version" | "receiptOnly">>>`
    SELECT p.id, p.version, ${ownerReceiptOnlySql(viewer)} AS "receiptOnly" FROM health_post p
    WHERE p.id IN (${Prisma.join(ids)}) AND ${visibleHealthPostSql(viewer, "includeOwnerReceipt")}`;
  const current = new Map(rows.map(row => [row.id, row]));
  const posts = page.posts.flatMap(({ receipt, post }) => {
    const row = current.get(receipt.id);
    if (row?.version !== receipt.version) return [];
    return [row.receiptOnly ? receipt : post ?? receipt];
  });
  return { posts, nextCursor: page.nextCursor };
}

export async function readHealthFeed(auth: Auth, cursor?: string | null) {
  const db = getPrisma(), viewer = auth.member.id;
  const page = await preparePosts(db, viewer, { cursor: await openHealthCursor(viewer, "feed", cursor) });
  return finishRead(auth, tx => finishPosts(tx, viewer, page));
}

export async function readHealthPost(auth: Auth, postId: string) {
  const db = getPrisma(), viewer = auth.member.id;
  const page = await preparePosts(db, viewer, { postId });
  const { posts } = await finishRead(auth, tx => finishPosts(tx, viewer, page));
  if (!posts[0]) throw gameNotFound();
  return { post: posts[0] };
}

export async function readVisibleFrozenCard(viewer: string, postId: string, cardId: string, signal: AbortSignal) {
  const [post] = await getPrisma().$queryRaw<Pick<PostRow, "authorMemberId" | "cardsEncrypted" | "version">[]>`
    SELECT p.author_member_id AS "authorMemberId", p.cards_encrypted AS "cardsEncrypted", p.version
    FROM health_post p WHERE p.id = ${postId}::uuid AND ${visibleHealthPostSql(viewer)}`;
  if (!post) throw gameNotFound();
  const fields = post.cardsEncrypted.map((value, index) => ({
    memberId: post.authorMemberId, table: "health_post" as const, rowId: postId, field: `card:${index}`, value,
  }));
  const opened = await openHealthTexts(fields, signal);
  const card = opened.map(value => JSON.parse(value) as FrozenHealthCard).find(card => card.id === cardId);
  if (!card) throw gameNotFound();
  return { spec: card.spec, version: post.version, authorMemberId: post.authorMemberId };
}

export function assertVisibleFrozenCardCurrent(auth: Auth, postId: string, version: number) {
  return finishRead(auth, async tx => {
    const viewer = auth.member.id;
    await assertBrowserVaultMemberAuthority({ memberId: viewer, prisma: tx });
    if ((await findVisibleHealthPost(tx, viewer, postId))?.version !== version) throw gameNotFound();
  });
}

function recipientFirstNameSql(viewerId: string) {
  // A poster still owns the reply after losing access to the recipient's profile.
  return Prisma.sql`CASE WHEN c.recipient_member_id IS NOT NULL THEN (
    SELECT recipient.first_name_encrypted FROM game_profile recipient
    WHERE recipient.member_id = c.recipient_member_id AND ${visibleHealthPersonSql(viewerId, Prisma.sql`recipient.member_id`)}
  ) END`;
}

export function healthCommentPageSql(viewerId: string, postId: string, posterId: string, position?: HealthPagePosition) {
  return Prisma.sql`SELECT c.id, c.post_id AS "postId", c.author_member_id AS "authorMemberId",
      c.created_at AS "createdAt", c.body_encrypted AS "bodyEncrypted", c.visibility,
      c.recipient_member_id AS "recipientMemberId", ${recipientFirstNameSql(viewerId)} AS "recipientFirstNameEncrypted",
      profile.first_name_encrypted AS "firstNameEncrypted", profile.photo_key AS "photoKey"
    FROM health_post_comment c
    LEFT JOIN game_profile profile ON profile.member_id = c.author_member_id
    WHERE c.post_id = ${postId}::uuid AND ${visibleHealthCommentOnPostSql(viewerId, Prisma.sql`${posterId}::text`)}
      ${cursorWhere(position, Prisma.sql`(c.created_at, c.id)`)}
    ORDER BY c.deleted_at, c.created_at DESC, c.id DESC LIMIT ${PAGE_SIZE + 1}`;
}

export async function readHealthComments(auth: Auth, postId: string, cursor?: string | null) {
  const db = getPrisma(), viewer = auth.member.id;
  const parent = await findVisibleHealthPost(db, viewer, postId);
  if (!parent) throw gameNotFound();
  const collection = `comments:${postId}`;
  const position = await openHealthCursor(viewer, collection, cursor);
  const fetched = await db.$queryRaw<CommentRow[]>(healthCommentPageSql(viewer, postId, parent.authorMemberId, position));
  const rows = fetched.slice(0, PAGE_SIZE);
  const recipients = rows.flatMap(row => row.recipientMemberId && row.recipientFirstNameEncrypted !== null ? [{
    authorMemberId: row.recipientMemberId, firstNameEncrypted: row.recipientFirstNameEncrypted, photoKey: null,
  }] : []);
  // Prefer the full author profile when a recipient also wrote a comment on this page.
  const [identities, content, nextCursor] = await together([names([...recipients, ...rows]), openHealthTexts(rows.map(row => ({
    memberId: row.authorMemberId, table: "health_post_comment", rowId: row.id, field: "body", value: row.bodyEncrypted,
  }))), sealHealthCursor(viewer, collection, fetched.length > PAGE_SIZE ? rows.at(-1) : undefined)]);
  const [post, current] = await finishRead(auth, tx => Promise.all([
    findVisibleHealthPost(tx, viewer, postId),
    rows.length ? tx.$queryRaw<Array<Pick<CommentRow, "id" | "recipientFirstNameEncrypted">>>`
      SELECT c.id, ${recipientFirstNameSql(viewer)} AS "recipientFirstNameEncrypted"
      FROM health_post_comment c JOIN health_post p ON p.id = c.post_id
      WHERE c.id IN (${Prisma.join(rows.map(row => Prisma.sql`${row.id}::uuid`))}) AND ${visibleHealthCommentSql(viewer)}` : [],
  ]));
  if (!post) throw gameNotFound();
  const visible = new Map(current.map(row => [row.id, row]));
  const comments = rows.flatMap((row, index) => {
    const checked = visible.get(row.id);
    if (!checked) return [];
    const recipientFirstName = row.recipientMemberId && checked.recipientFirstNameEncrypted !== null
      && checked.recipientFirstNameEncrypted === row.recipientFirstNameEncrypted
      ? identities.get(row.recipientMemberId)!.firstName : null;
    return [{
      id: row.id, postId, authorMemberId: row.authorMemberId, ...identities.get(row.authorMemberId)!,
      createdAt: row.createdAt.toISOString(), visibility: row.visibility, body: content[index],
      recipientMemberId: row.recipientMemberId, recipientFirstName,
    }];
  });
  return { comments, nextCursor };
}

async function profileIdentity(db: Db, viewer: string, memberId: string) {
  const rows = await db.$queryRaw<Identity[]>`SELECT person.id AS "authorMemberId",
      profile.first_name_encrypted AS "firstNameEncrypted", profile.photo_key AS "photoKey"
    FROM hosted_member person LEFT JOIN game_profile profile ON profile.member_id = person.id
    WHERE person.id = ${memberId} AND ${visibleHealthPersonSql(viewer, Prisma.sql`person.id`, "includeOwnerReceipt")}`;
  if (!rows[0]) throw gameNotFound();
  return rows[0];
}

async function profileNumbers(viewer: string, memberId: string) {
  if (viewer === memberId) return null;
  try {
    const board = await readPairBoard(viewer, memberId);
    return board?.people.find(person => person.memberId === memberId)?.numbers ?? null;
  } catch {
    // Shared numbers are optional. The profile performs its own final access check.
    return null;
  }
}

export async function readHealthProfile(auth: Auth, memberId: string, cursor?: string | null, signal = AbortSignal.timeout(15000)) {
  const db = getPrisma(), viewer = auth.member.id;
  const identity = await profileIdentity(db, viewer, memberId);
  const position = await openHealthCursor(viewer, `profile:${memberId}`, cursor);
  const [opened, prepared] = await together([names([identity]), preparePosts(db, viewer, { author: memberId, cursor: position })]);
  const [allowed] = isHealthYouEnabled(viewer) ? await db.$queryRaw<{ allowed: boolean }[]>`
    SELECT (${visibleHealthPersonSql(viewer, Prisma.sql`${memberId}::text`)}) AS allowed` : [];
  const extended = allowed?.allowed ? await readExtendedProfile(auth, memberId, signal) : null;
  const numbers = extended ? extended.numbers : await profileNumbers(viewer, memberId);
  const [page] = await finishRead(auth, tx => Promise.all([finishPosts(tx, viewer, prepared),
    extended ? assertProfileAccess(tx, auth, memberId) : profileIdentity(tx, viewer, memberId)]));
  return { memberId, ...opened.get(memberId)!, numbers, ...page, ...extended?.extras };
}
