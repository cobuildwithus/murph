import { cleanupGameFixtures } from "./support/game-fixture-cleanup";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PUT as profile } from "../app/api/game/v1/me/profile/route";
import { POST as create } from "../app/api/game/v1/games/route";
import { POST as accept } from "../app/api/game/v1/invites/[token]/accept/route";
import { POST as settle } from "../app/api/game/v1/dev/games/[id]/settle/route";
import { GET as recipient } from "../app/api/game/v1/games/[id]/message-recipient/route";
import { hostedAuthAdapter } from "../src/lib/better-auth/adapter";
import { serializeHostedNativeSessionToken } from "../src/lib/better-auth/transport";
import type { GameView } from "../src/lib/game/contract";
import { getPrisma } from "../src/lib/prisma";

// Each member's verified number, by member id; a member missing here has none.
// The decrypt is stubbed; the identity row (verified, encrypted) is real.
const phones = vi.hoisted(() => new Map<string, string>());
vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-onboarding/hosted-member-identity-store")>(),
  readHostedMemberIdentity: async ({ memberId }: { memberId: string }) => phones.has(memberId)
    ? { phoneNumber: phones.get(memberId), phoneNumberVerifiedAt: new Date() }
    : { phoneNumber: "+15555550199", phoneNumberVerifiedAt: null },
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname)
    || url.search || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) {
    throw new Error("The Message recipient proof requires an isolated loopback test database.");
  }
}
const memberIds: string[] = [];
const request = (token: string, body?: unknown, method = "POST") => new Request("http://localhost/api/game/v1", {
  method, headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(token)}`, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function game(response: Promise<Response>): Promise<GameView> {
  const result = await response;
  const body = await result.json();
  expect(result.status, JSON.stringify(body)).toBe(200);
  return body.game;
}
async function member(firstName: string, phone?: string) {
  const id = `game-recipient-${randomUUID()}`;
  const token = randomUUID().replaceAll("-", "");
  memberIds.push(id);
  await getPrisma().hostedMember.create({ data: { id } });
  if (phone) {
    phones.set(id, phone);
    await getPrisma().hostedMemberIdentity.create({
      data: { memberId: id, phoneNumberEncrypted: "synthetic-sealed-phone", phoneNumberVerifiedAt: new Date() },
    });
  }
  const adapter = hostedAuthAdapter(getPrisma())({});
  const dates = { createdAt: new Date(), updatedAt: new Date() };
  await adapter.create({ model: "user", forceAllowId: true,
    data: { id, email: `${id}@example.test`, emailVerified: true, name: "", ...dates } });
  await adapter.create({ model: "session", forceAllowId: true, data: {
    id: `session-${id}`, userId: id, token, expiresAt: new Date(Date.now() + 3_600_000), ...dates,
  } });
  expect((await profile(request(token, { firstName, timeZone: "UTC" }, "PUT"))).status).toBe(200);
  return { id, token };
}
async function messageRecipient(token: string, id: string) {
  const response = await recipient(request(token, undefined, "GET"), { params: Promise.resolve({ id }) });
  const body = await response.json();
  return response.status === 200 ? body.phone : `${response.status} ${body.error.code}`;
}
async function liveGame(challenger: string, invitee: string) {
  const id = randomUUID();
  const created = await game(create(request(challenger, { gameId: id, inviteeFirstName: "Ava", terms: {
    startsOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    schedule: { count: 3 }, stakes: [{ kind: "prize", item: "Choose a book" }],
    tasks: [{ seat: 0, text: "Move" }, { seat: 1, text: "Move" }],
  } })));
  const before = await messageRecipient(challenger, id);
  const joined = await game(accept(request(invitee, { termsVersion: 1, timeZone: "UTC" }), {
    params: Promise.resolve({ token: created.inviteToken! }),
  }));
  expect(joined.status).toBe("live");
  return { id, before };
}

describe.skipIf(!enabled)("Message on a live pair game texts the other player", () => {
  beforeAll(() => {
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 9).toString("base64url"));
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "http://localhost:3237");
  });
  afterAll(async () => {
    await getPrisma().gameBlock.deleteMany({ where: { blockerMemberId: { in: memberIds } } });
    await cleanupGameFixtures(getPrisma(), memberIds);
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: memberIds } } });
    vi.unstubAllEnvs();
  });

  it("gives each player the other's verified number once both are in, and nobody else", async () => {
    const leo = await member("Leo", "+15555550101"), ava = await member("Ava", "+15555550102");
    const { id, before } = await liveGame(leo.token, ava.token);
    // Still an invite: no one has shaken on it yet.
    expect(before).toBeNull();
    expect(await messageRecipient(leo.token, id)).toBe("+15555550102");
    expect(await messageRecipient(ava.token, id)).toBe("+15555550101");
    const sam = await member("Sam", "+15555550103");
    expect(await messageRecipient(sam.token, id)).toBe("404 GAME_NOT_FOUND");
    // Over: the card that texts is gone.
    await game(settle(request(leo.token), { params: Promise.resolve({ id }) }));
    expect(await messageRecipient(leo.token, id)).toBeNull();
  }, 30_000);

  it("is an exchange: no one to text unless both players have a verified number", async () => {
    const leo = await member("Leo", "+15555550111"), ava = await member("Ava");
    const { id } = await liveGame(leo.token, ava.token);
    expect(await messageRecipient(leo.token, id)).toBeNull();
    expect(await messageRecipient(ava.token, id)).toBeNull();
  }, 30_000);

  it("has no one to text across a block either way, or for a suspended player", async () => {
    const leo = await member("Leo", "+15555550121"), ava = await member("Ava", "+15555550122");
    const { id } = await liveGame(leo.token, ava.token);
    expect(await messageRecipient(ava.token, id)).toBe("+15555550121");

    // A block row is enough, even before the block has called the game off.
    await getPrisma().gameBlock.create({ data: { blockerMemberId: leo.id, blockedMemberId: ava.id } });
    expect(await messageRecipient(ava.token, id)).toBeNull();
    expect(await messageRecipient(leo.token, id)).toBeNull();
    await getPrisma().gameBlock.deleteMany({ where: { blockerMemberId: leo.id } });
    expect(await messageRecipient(ava.token, id)).toBe("+15555550121");

    await getPrisma().hostedMember.update({ where: { id: leo.id }, data: { suspendedAt: new Date() } });
    expect(await messageRecipient(ava.token, id)).toBeNull();
  }, 30_000);
});
