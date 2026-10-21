import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameView } from "../src/lib/game/contract";
import type { RuleEntry, RuleState } from "../src/lib/game/rules";
import { buildGameView } from "../src/lib/game/views";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeMediaRead: vi.fn(),
  devAdvanceDays: vi.fn(),
  devSettleNow: vi.fn(),
  devStartNow: vi.fn(),
  getPrisma: vi.fn(),
  isGameEnabledFor: vi.fn(),
  mediaKeyPrefixFor: vi.fn(),
  readGame: vi.fn(),
  readHome: vi.fn(),
  readInvitePreview: vi.fn(),
  requireHostedMemberAuthFromBearerToken: vi.fn(),
  runGameCommand: vi.fn(),
}));

vi.mock("@/src/lib/game/service", () => ({
  authorizeMediaRead: mocks.authorizeMediaRead,
  devAdvanceDays: mocks.devAdvanceDays,
  devSettleNow: mocks.devSettleNow,
  devStartNow: mocks.devStartNow,
  isGameEnabledFor: mocks.isGameEnabledFor,
  mediaKeyPrefixFor: mocks.mediaKeyPrefixFor,
  readGame: mocks.readGame,
  readHome: mocks.readHome,
  readInvitePreview: mocks.readInvitePreview,
  runGameCommand: mocks.runGameCommand,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireHostedMemberAuthFromBearerToken: mocks.requireHostedMemberAuthFromBearerToken,
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

type Routes = {
  accept: typeof import("../app/api/game/v1/invites/[token]/accept/route");
  advanceDay: typeof import("../app/api/game/v1/dev/games/[id]/advance-day/route");
  create: typeof import("../app/api/game/v1/games/route");
  entries: typeof import("../app/api/game/v1/games/[id]/entries/route");
  entry: typeof import("../app/api/game/v1/games/[id]/entries/[entryId]/route");
  game: typeof import("../app/api/game/v1/games/[id]/route");
  home: typeof import("../app/api/game/v1/home/route");
  invite: typeof import("../app/api/game/v1/invites/[token]/route");
  media: typeof import("../app/api/game/v1/media/[...key]/route");
  profile: typeof import("../app/api/game/v1/me/profile/route");
  redeem: typeof import("../app/api/game/v1/tickets/[id]/redeem/route");
  settle: typeof import("../app/api/game/v1/dev/games/[id]/settle/route");
  startNow: typeof import("../app/api/game/v1/dev/games/[id]/start-now/route");
  upload: typeof import("../app/api/game/v1/media/route");
};

let routes: Routes;
let mediaDir: string;

const LEO = "hbm_leo";
const AVA = "hbm_ava";
const GAME_ID = "game_1";
const BASE = "http://localhost/api/game/v1";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const VIEW: GameView = {
  days: [],
  id: GAME_ID,
  inviteExpiresAt: null,
  inviteToken: null,
  lengthDays: 7,
  players: [],
  result: null,
  retakeAvailable: true,
  round: 1,
  startedAt: null,
  startsOn: null,
  status: "live",
  terms: { fromDay: 0, n: 1, schedule: { count: 5 }, stakes: [], tasks: [{ seat: 0, text: "100 pushups" }] },
  tickets: [],
};

let signedInAs = LEO;

describe("weekly game routes", () => {
  beforeAll(async () => {
    routes = {
      accept: await import("../app/api/game/v1/invites/[token]/accept/route"),
      advanceDay: await import("../app/api/game/v1/dev/games/[id]/advance-day/route"),
      create: await import("../app/api/game/v1/games/route"),
      entries: await import("../app/api/game/v1/games/[id]/entries/route"),
      entry: await import("../app/api/game/v1/games/[id]/entries/[entryId]/route"),
      game: await import("../app/api/game/v1/games/[id]/route"),
      home: await import("../app/api/game/v1/home/route"),
      invite: await import("../app/api/game/v1/invites/[token]/route"),
      media: await import("../app/api/game/v1/media/[...key]/route"),
      profile: await import("../app/api/game/v1/me/profile/route"),
      redeem: await import("../app/api/game/v1/tickets/[id]/redeem/route"),
      settle: await import("../app/api/game/v1/dev/games/[id]/settle/route"),
      startNow: await import("../app/api/game/v1/dev/games/[id]/start-now/route"),
      upload: await import("../app/api/game/v1/media/route"),
    };
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mediaDir = await mkdtemp(path.join(process.env.MURPH_VITEST_TEMP_ROOT ?? tmpdir(), "game-media-"));
    vi.stubEnv("MURPH_GAME_MEDIA_DIR", mediaDir);
    vi.stubEnv("VERCEL_ENV", "development");
    signedInAs = LEO;
    mocks.getPrisma.mockReturnValue({});
    mocks.requireHostedMemberAuthFromBearerToken.mockImplementation(async () => ({ member: { id: signedInAs } }));
    mocks.isGameEnabledFor.mockResolvedValue(true);
    mocks.mediaKeyPrefixFor.mockImplementation((memberId: string) => `game/${memberId}/`);
    mocks.readGame.mockResolvedValue(VIEW);
    mocks.runGameCommand.mockResolvedValue({ game: VIEW, ok: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(mediaDir, { force: true, recursive: true });
  });

  describe("auth", () => {
    it("returns the definitive profile for photo-only updates under the authenticated account", async () => {
    const profile = { memberId: LEO, firstName: "Leo", timeZone: "UTC", avatarUrl: null };
    mocks.runGameCommand.mockResolvedValue({ ok: true, game: null, profile });
    const response = await routes.profile.PUT(writeRequest("PUT", "/me/profile", { photoKey: null, memberId: AVA }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, profile });
    expect(mocks.runGameCommand).toHaveBeenCalledWith({ actorMemberId: LEO, command: { type: "setProfile", photoKey: null, memberId: AVA } });
  });

  it("requires a signed-in session and never reaches the game", async () => {
      mocks.requireHostedMemberAuthFromBearerToken.mockRejectedValue(
        hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in to continue." }),
      );

      const responses = await Promise.all([
        routes.home.GET(new Request(`${BASE}/home`)),
        routes.redeem.POST(writeRequest("POST", "/tickets/t_1/redeem"), params({ id: "t_1" })),
        routes.game.GET(new Request(`${BASE}/games/${GAME_ID}`), params({ id: GAME_ID })),
        routes.media.GET(new Request(`${BASE}/media/x`), params({ key: ["game", LEO, "x.jpg"] })),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
          error: { code: "UNAUTHENTICATED", message: "Sign in to continue.", retryable: false },
        });
      }
      expect(mocks.readHome).not.toHaveBeenCalled();
      expect(mocks.runGameCommand).not.toHaveBeenCalled();
      expect(mocks.readGame).not.toHaveBeenCalled();
      expect(mocks.authorizeMediaRead).not.toHaveBeenCalled();
    });

    it("uses the plain signed-in check, not the paid-member check", async () => {
      mocks.readHome.mockResolvedValue({ games: [], me: { memberId: LEO }, wallet: { held: [], owed: [], redeemed: [] } });

      const response = await routes.home.GET(new Request(`${BASE}/home`));

      expect(response.status).toBe(200);
      expect(mocks.requireHostedMemberAuthFromBearerToken).toHaveBeenCalledTimes(1);
    });
  });

  describe("flag", () => {
    it("hides every signed-in route as 404 when the game is off for the member", async () => {
      mocks.isGameEnabledFor.mockResolvedValue(false);

      const responses = await Promise.all([
        routes.home.GET(new Request(`${BASE}/home`)),
        routes.redeem.POST(writeRequest("POST", "/tickets/t_1/redeem"), params({ id: "t_1" })),
        routes.game.GET(new Request(`${BASE}/games/${GAME_ID}`), params({ id: GAME_ID })),
        routes.upload.POST(uploadRequest()),
        routes.media.GET(new Request(`${BASE}/media/x`), params({ key: ["x"] })),
        routes.startNow.POST(new Request(`${BASE}/dev/games/${GAME_ID}/start-now`, { method: "POST" }), params({ id: GAME_ID })),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(404);
        expect((await response.json()).error.code).toBe("GAME_DISABLED");
      }
      expect(mocks.isGameEnabledFor).toHaveBeenCalledWith(LEO);
      expect(mocks.readHome).not.toHaveBeenCalled();
      expect(mocks.runGameCommand).not.toHaveBeenCalled();
      expect(mocks.devStartNow).not.toHaveBeenCalled();
    });
  });

  describe("write routes", () => {
    it.each([
      ["PUT /me/profile", () => routes.profile.PUT(writeRequest("PUT", "/me/profile", { firstName: "Leo", timeZone: "UTC" })),
        { firstName: "Leo", timeZone: "UTC", type: "setProfile" }],
      ["POST /games", () => routes.create.POST(writeRequest("POST", "/games", { gameId: GAME_ID, inviteeFirstName: "Ava" })),
        { gameId: GAME_ID, inviteeFirstName: "Ava", type: "createGame" }],
      ["POST /invites/:token/accept", () => routes.accept.POST(
        writeRequest("POST", "/invites/tok_1/accept", { termsVersion: 2, timeZone: "Australia/Sydney" }),
        params({ token: "tok_1" }),
      ), { termsVersion: 2, timeZone: "Australia/Sydney", token: "tok_1", type: "join" }],
      ["POST /games/:id/entries", () => routes.entries.POST(
        writeRequest("POST", `/games/${GAME_ID}/entries`, { entryId: "entry_1", kind: "photo", mediaKeys: [] }),
        params({ id: GAME_ID }),
      ), { entryId: "entry_1", gameId: GAME_ID, kind: "photo", mediaKeys: [], type: "post" }],
      ["DELETE /games/:id/entries/:entryId", () => routes.entry.DELETE(
        writeRequest("DELETE", `/games/${GAME_ID}/entries/entry_1`),
        params({ entryId: "entry_1", id: GAME_ID }),
      ), { entryId: "entry_1", gameId: GAME_ID, type: "withdraw" }],
      ["POST /tickets/:id/redeem", () => routes.redeem.POST(writeRequest("POST", "/tickets/t_1/redeem"), params({ id: "t_1" })),
        { ticketId: "t_1", type: "redeem" }],
    ])("%s becomes one command for the signed-in member", async (_route, call, command) => {
      const response = await call();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ game: VIEW, ok: true });
      expect(mocks.runGameCommand).toHaveBeenCalledWith({ actorMemberId: LEO, command });
    });

    it("lets the path's ids win over the body's", async () => {
      await routes.accept.POST(
        writeRequest("POST", "/invites/tok_1/accept", { termsVersion: 1, timeZone: "UTC", token: "tok_other", type: "redeem" }),
        params({ token: "tok_1" }),
      );

      expect(mocks.runGameCommand.mock.calls[0][0].command).toMatchObject({ token: "tok_1", type: "join" });
    });

    it("caps the body at 64 KB", async () => {
      const response = await routes.profile.PUT(writeRequest("PUT", "/me/profile", {
        firstName: "Leo",
        padding: "x".repeat(70 * 1024),
        timeZone: "America/New_York",
      }));

      expect(response.status).toBe(413);
      expect(mocks.runGameCommand).not.toHaveBeenCalled();
    });

    it("renders service rejections in the error envelope", async () => {
      mocks.runGameCommand.mockResolvedValue({
        error: { code: "ALREADY_IN_A_GAME", message: "You and Ava already have a game going." },
        ok: false,
        status: 409,
      });

      const response = await routes.redeem.POST(writeRequest("POST", "/tickets/t_1/redeem"), params({ id: "t_1" }));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: "ALREADY_IN_A_GAME", message: "You and Ava already have a game going.", retryable: false },
      });
    });
  });

  describe("viewer scoping", () => {
    it("reads views only for the signed-in member, whatever the request says", async () => {
      mocks.readHome.mockResolvedValue({ games: [VIEW], me: { memberId: LEO }, wallet: { held: [], owed: [], redeemed: [] } });

      const home = await routes.home.GET(new Request(`${BASE}/home?memberId=${AVA}`, { headers: { "x-member-id": AVA } }));
      const game = await routes.game.GET(new Request(`${BASE}/games/${GAME_ID}?memberId=${AVA}`), params({ id: GAME_ID }));

      expect(mocks.readHome).toHaveBeenCalledWith(LEO);
      expect(mocks.readGame).toHaveBeenCalledWith(GAME_ID, LEO);
      expect(await home.json()).toEqual({ games: [VIEW], me: { memberId: LEO }, ok: true, wallet: { held: [], owed: [], redeemed: [] } });
      expect(await game.json()).toEqual({ game: VIEW, ok: true });
    });

    it("keeps another player's entry out of the response until the viewer posts that day", async () => {
      const leoKey = `game/${LEO}/${"c".repeat(32)}.jpg`;
      const leoPhoto = entry({ id: "entry_leo", kind: "photo", mediaKeys: [leoKey], memberId: LEO });
      const avaPhoto = entry({ id: "entry_ava", kind: "photo", mediaKeys: [`game/${AVA}/${"d".repeat(32)}.jpg`], memberId: AVA });
      signedInAs = AVA;

      mocks.readGame.mockResolvedValueOnce(viewFor(AVA, [leoPhoto]));
      const before = await routes.game.GET(new Request(`${BASE}/games/${GAME_ID}`), params({ id: GAME_ID }));
      const beforeText = await before.text();
      const beforeBody = JSON.parse(beforeText);

      expect(beforeBody.game.days[0].others).toEqual([{ entry: null, seat: 0, status: "locked" }]);
      for (const secret of ["entry_leo", leoKey, encodeURIComponent(leoKey)]) {
        expect(beforeText).not.toContain(secret);
      }

      mocks.readGame.mockResolvedValueOnce(viewFor(AVA, [leoPhoto, avaPhoto]));
      const after = await (await routes.game.GET(new Request(`${BASE}/games/${GAME_ID}`), params({ id: GAME_ID }))).json();

      expect(after.game.days[0].others[0]).toEqual({
        entry: {
          entryId: "entry_leo",
          kind: "photo",
          mediaUrls: [`/api/game/v1/media/${encodeURIComponent(leoKey)}`],
          text: "caption of entry_leo",
        },
        seat: 0,
        status: "posted",
      });
    });

    it("never shows another player's excuse, even after the viewer posts", async () => {
      const excuseKey = `game/${LEO}/${"e".repeat(32)}.m4a`;
      const excuse = entry({ attempt: 0, id: "entry_leo_excuse", kind: "excuse", mediaKeys: [excuseKey], memberId: LEO });
      const avaPhoto = entry({ id: "entry_ava", kind: "photo", mediaKeys: [`game/${AVA}/${"d".repeat(32)}.jpg`], memberId: AVA });
      signedInAs = AVA;
      mocks.readGame.mockResolvedValueOnce(viewFor(AVA, [excuse, avaPhoto]));

      const text = await (await routes.game.GET(new Request(`${BASE}/games/${GAME_ID}`), params({ id: GAME_ID }))).text();

      for (const secret of ["entry_leo_excuse", excuseKey, encodeURIComponent(excuseKey)]) {
        expect(text).not.toContain(secret);
      }
    });

    it("answers 404 for a game the member can't see", async () => {
      mocks.readGame.mockResolvedValue(null);

      const response = await routes.game.GET(new Request(`${BASE}/games/${GAME_ID}`), params({ id: GAME_ID }));

      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("GAME_NOT_FOUND");
    });
  });

  describe("media", () => {
    it("keys an upload by its bytes under the member's prefix, so a retry returns the same key", async () => {
      const first = await routes.upload.POST(uploadRequest());
      const retry = await routes.upload.POST(uploadRequest());
      const other = await routes.upload.POST(uploadRequest({ body: Buffer.concat([JPEG, Buffer.from([0x00])]) }));
      const { mediaKey } = await first.json();

      expect(first.status).toBe(200);
      expect(mediaKey).toMatch(new RegExp(`^game/${LEO}/[a-f0-9]{64}\\.jpg$`, "u"));
      expect((await retry.json()).mediaKey).toBe(mediaKey);
      expect((await other.json()).mediaKey).not.toBe(mediaKey);
    });

    it.each([
      ["an unsupported type", { "content-type": "image/png" }],
      ["bytes that aren't the declared type", { "content-type": "image/heic" }],
      ["audio", { "content-type": "audio/m4a" }],
      ["video", { "content-type": "video/mp4" }],
    ])("rejects %s", async (_label, headers) => {
      const response = await routes.upload.POST(uploadRequest({ headers }));

      expect(response.status).toBe(400);
    });

    it("takes HEIC only with an image brand, so an M4A can't pass as a photo", async () => {
      const iso = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`, "latin1"), Buffer.alloc(12)]);

      const heic = await routes.upload.POST(uploadRequest({ body: iso("heic"), headers: { "content-type": "image/heic" } }));
      const audioAsPhoto = await routes.upload.POST(uploadRequest({ body: iso("M4A "), headers: { "content-type": "image/heic" } }));
      const photoAsAudio = await routes.upload.POST(uploadRequest({ body: iso("mif1"), headers: { "content-type": "audio/m4a" } }));

      expect(heic.status).toBe(200);
      expect((await heic.json()).mediaKey).toMatch(/\.heic$/u);
      expect(audioAsPhoto.status).toBe(400);
      expect(photoAsAudio.status).toBe(400);
    });

    it("caps uploads at 4 MiB", async () => {
      const response = await routes.upload.POST(uploadRequest({ headers: { "content-length": String(4 * 1024 * 1024 + 1) } }));

      expect(response.status).toBe(413);
    });

    it("serves bytes only when the service authorizes this viewer", async () => {
      const key = await uploadAs(LEO);
      signedInAs = AVA;
      mocks.authorizeMediaRead.mockResolvedValue(false);

      const locked = await routes.media.GET(mediaRequest(key), params({ key: key.split("/") }));

      expect(locked.status).toBe(404);
      expect((await locked.json()).error.code).toBe("MEDIA_MISSING");
      expect(mocks.authorizeMediaRead).toHaveBeenCalledWith(AVA, key);

      mocks.authorizeMediaRead.mockResolvedValue(true);
      const unlocked = await routes.media.GET(mediaRequest(key), params({ key: [encodeURIComponent(key)] }));

      expect(unlocked.status).toBe(200);
      expect(unlocked.headers.get("content-type")).toBe("image/jpeg");
      expect(unlocked.headers.get("cache-control")).toBe("private, no-store");
      expect(Buffer.from(await unlocked.arrayBuffer())).toEqual(JPEG);
    });

    it("is unavailable on Vercel deployments until deployed storage exists", async () => {
      vi.stubEnv("VERCEL_ENV", "preview");

      const response = await routes.upload.POST(uploadRequest());

      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("GAME_MEDIA_UNAVAILABLE");
    });
  });

  describe("dev routes", () => {
    it("are 404 in production before auth or flags are consulted", async () => {
      vi.stubEnv("VERCEL_ENV", "production");

      const responses = await Promise.all([
        routes.startNow.POST(devRequest("start-now"), params({ id: GAME_ID })),
        routes.advanceDay.POST(devRequest("advance-day", { days: 1 }), params({ id: GAME_ID })),
        routes.settle.POST(devRequest("settle"), params({ id: GAME_ID })),
      ]);

      for (const response of responses) expect(response.status).toBe(404);
      expect(mocks.requireHostedMemberAuthFromBearerToken).not.toHaveBeenCalled();
      expect(mocks.devStartNow).not.toHaveBeenCalled();
      expect(mocks.devAdvanceDays).not.toHaveBeenCalled();
      expect(mocks.devSettleNow).not.toHaveBeenCalled();
    });

    it("move time for the signed-in member outside production", async () => {
      mocks.devAdvanceDays.mockResolvedValue(VIEW);

      const response = await routes.advanceDay.POST(devRequest("advance-day", { days: 3 }), params({ id: GAME_ID }));
      const invalid = await routes.advanceDay.POST(devRequest("advance-day", { days: 0 }), params({ id: GAME_ID }));

      expect(response.status).toBe(200);
      expect(mocks.devAdvanceDays).toHaveBeenCalledWith(GAME_ID, LEO, 3);
      expect(invalid.status).toBe(400);
    });
  });

  describe("invite preview", () => {
    it("serves the invite preview without sign-in", async () => {
      mocks.readInvitePreview.mockResolvedValueOnce(null);
      const missing = await routes.invite.GET(new Request(`${BASE}/invites/tok_1`), params({ token: "tok_1" }));
      expect(missing.status).toBe(404);
      expect((await missing.json()).error.code).toBe("INVITE_NOT_FOUND");

      mocks.readInvitePreview.mockResolvedValueOnce({ inviterFirstName: "Leo", status: "open" });
      const found = await routes.invite.GET(new Request(`${BASE}/invites/tok_1`), params({ token: "tok_1" }));
      expect(found.status).toBe(200);
      expect((await found.json()).preview.inviterFirstName).toBe("Leo");
      expect(mocks.requireHostedMemberAuthFromBearerToken).not.toHaveBeenCalled();
    });
  });
});

// Leo (New York) and Ava (Sydney) are both on day 0 at NOW.
const NOW = new Date("2026-10-16T18:00:00.000Z");

function entry(input: Partial<RuleEntry> & Pick<RuleEntry, "id" | "kind" | "mediaKeys" | "memberId">): RuleEntry {
  return { attempt: 1, dayIndex: 0, withdrawnAt: null, ...input };
}

// The real view builder; the caller hands it every entry's words, as a buggy
// loader would, so the test proves the builder itself withholds them.
function viewFor(viewerId: string, entries: RuleEntry[]): GameView {
  const state: RuleState = {
    entries,
    game: {
      createdBy: LEO,
      id: GAME_ID,
      inviteExpiresAt: null,
      lengthDays: 7,
      seats: 2,
      startsOn: null,
      status: "live",
      terms: { v: 1, versions: [{ fromDay: 0, n: 1, schedule: { count: 7 }, stakes: [{ key: "s1", kind: "winner_gets" }] }] },
    },
    players: [
      { dayOne: "2026-10-16", memberId: LEO, seat: 0, timeZone: "America/New_York" },
      { dayOne: "2026-10-17", memberId: AVA, seat: 1, timeZone: "Australia/Sydney" },
    ],
  };
  return buildGameView({
    avatarKeys: new Map(),
    entryWords: new Map(entries.map((item) => [item.id, { text: `caption of ${item.id}` }])),
    inviteExpiresAt: null,
    inviteToken: null,
    invitee: null,
    names: new Map([[LEO, "Leo"], [AVA, "Ava"]]),
    now: NOW,
    relationships: new Map(),
    result: null,
    round: 1,
    startedAt: new Date("2026-10-16T12:00:00.000Z"),
    state,
    tickets: [],
    viewerId,
    words: { v: 1, versions: [{ n: 1, stakes: [{ item: "Breakfast in bed", key: "s1" }], tasks: [{ seat: 0, text: "100 pushups" }] }] },
  });
}

function params<T>(value: T) {
  return { params: Promise.resolve(value) };
}

function writeRequest(method: string, path: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request(`${BASE}${path}`, {
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { authorization: "Bearer token", "content-type": "application/json", ...headers },
    method,
  });
}

function uploadRequest(input: { body?: Buffer; headers?: Record<string, string> } = {}) {
  return new Request(`${BASE}/media`, {
    body: new Uint8Array(input.body ?? JPEG),
    headers: { authorization: "Bearer token", "content-type": "image/jpeg", ...input.headers },
    method: "POST",
  });
}

async function uploadAs(memberId: string): Promise<string> {
  const previous = signedInAs;
  signedInAs = memberId;
  const response = await routes.upload.POST(uploadRequest());
  signedInAs = previous;
  return (await response.json()).mediaKey;
}

function mediaRequest(key: string) {
  return new Request(`${BASE}/media/${encodeURIComponent(key)}`, { headers: { authorization: "Bearer token" } });
}

function devRequest(action: string, body?: Record<string, unknown>) {
  return new Request(`${BASE}/dev/games/${GAME_ID}/${action}`, {
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    method: "POST",
  });
}
