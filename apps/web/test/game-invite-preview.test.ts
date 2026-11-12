import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as crypto from "@/src/lib/game/crypto";

const db = vi.hoisted(() => ({
  game: { findUnique: vi.fn() },
  gameBlock: { findMany: vi.fn(async () => []) },
  gameEntry: { findMany: vi.fn(async () => []) },
  $queryRaw: vi.fn(async () => [{ now: new Date("2026-11-12T12:00:00Z") }]),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/app/_og/og-shared", () => ({
  loadMurphHeroOgAssets: async () => ({ fonts: [] }),
  OG_CONTENT_TYPE: "image/png", OG_SIZE: { width: 1200, height: 630 },
}));
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(element: ReactNode, options: ResponseInit) {
      super(renderToStaticMarkup(element), options);
    }
  },
}));

const { readInvitePreview } = await import("@/src/lib/game/service");
const { GET } = await import("@/app/api/game/v1/invites/[token]/route");
const { default: Page, generateMetadata } = await import("@/app/g/[token]/page");
const { default: Image } = await import("@/app/g/[token]/opengraph-image");
const props = { params: Promise.resolve({ token: "synthetic-invite" }) };
const request = () => new Request("https://www.withmurph.ai/api/game/v1/invites/synthetic-invite", {
  headers: { "X-Murph-Game-Multiplayer": "1" },
});
const now = new Date("2026-11-12T12:00:00Z");
const later = new Date("2026-11-13T12:00:00Z");
const earlier = new Date("2026-11-11T12:00:00Z");
const player = { memberId: "member_leo", seat: 0, leftAt: null, dayOne: null, timeZone: "UTC", joinedAt: now };
const tasks = [{ seat: 0, text: "Read a chapter" }, { seat: 1, text: "Take a walk" }];

async function invite() {
  return {
    id: "synthetic-game", status: "invited", maxPlayers: 2, createdBy: "member_leo",
    creator: { memberId: "member_leo", firstNameEncrypted: await crypto.sealGameText({ memberId: "member_leo", table: "game_profile", rowId: "member_leo", field: "first_name" }, "Leo") },
    wordsOwnerMemberId: "member_leo", createdAt: now, inviteExpiresAt: later, devClockOffsetMs: null,
    players: [player], invitees: [], events: [], chatContainerMemberId: null, lengthDays: 7, startsOn: null,
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 5 }, stakes: [] }] },
    termsWordsEncrypted: await crypto.sealGameText({ memberId: "member_leo", table: "game", rowId: "synthetic-game", field: "terms_words" }, JSON.stringify({ v: 1, versions: [{ n: 1, tasks, stakes: [] }] })),
  };
}

describe("public invite preview privacy", () => {
  beforeEach(() => {
    db.game.findUnique.mockReset();
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each([
    ["cancelled by inviter", { status: "void", events: [{ actor: "member_leo" }] }],
    ["declined", { status: "void", events: [{ actor: "member_ava" }] }],
    ["expired", { inviteExpiresAt: earlier }],
    ["at the expiry deadline", { inviteExpiresAt: now }],
    ["accepted by someone else", { status: "live" }],
    ["negotiating", { status: "negotiating" }],
    ["settled", { status: "settled" }],
    ["void", { status: "void" }],
    ["deleted inviter", { creator: null }],
    ["closed group", { status: "settled", maxPlayers: 10 }],
    ["full group", { status: "live", maxPlayers: 10, players: Array.from({ length: 10 }, (_, seat) => ({ ...player, seat })) }],
    ["unknown state", { status: "unknown" }],
  ])("makes a %s invite indistinguishable from missing without decryption", async (_label, changes) => {
    const row = { ...await invite(), ...changes };
    const decrypt = vi.spyOn(crypto, "openGameTexts");
    db.game.findUnique.mockResolvedValue(null);
    const missing = await GET(request(), props);
    const missingBody = await missing.json();
    const missingPage = renderToStaticMarkup(await Page(props));
    const missingImage = await (await Image(props)).text();
    const missingMetadata = await generateMetadata(props);

    db.game.findUnique.mockResolvedValue(row);
    expect(await readInvitePreview("synthetic-invite", true)).toBeNull();
    const closed = await GET(request(), props);
    expect(closed.status).toBe(404);
    expect(closed.status).toBe(missing.status);
    expect(await closed.json()).toEqual(missingBody);
    expect(renderToStaticMarkup(await Page(props))).toBe(missingPage);
    expect(await (await Image(props)).text()).toBe(missingImage);
    expect(await generateMetadata(props)).toEqual(missingMetadata);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("keeps open invite details on the API, page and Open Graph image", async () => {
    db.game.findUnique.mockResolvedValue(await invite());
    const response = await GET(request(), props);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, preview: { status: "open", inviterFirstName: "Leo", terms: { tasks } } });
    for (const html of [renderToStaticMarkup(await Page(props)), await (await Image(props)).text()]) {
      expect(html).toContain("Leo");
      expect(html).toContain("Read a chapter");
    }
  });

  it("keeps authenticated cancellation status without decrypting personal details", async () => {
    db.game.findUnique.mockResolvedValue({ ...await invite(), status: "void", events: [{ actor: "member_leo" }] });
    const decrypt = vi.spyOn(crypto, "openGameTexts");
    expect(await readInvitePreview("synthetic-invite", true, "member_leo")).toEqual({ status: "expired", reason: "cancelled" });
    expect(decrypt).not.toHaveBeenCalled();
  });
});
