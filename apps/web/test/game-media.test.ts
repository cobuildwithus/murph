import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(async () => false),
  control: null as null | {
    putGameImage: ReturnType<typeof vi.fn>;
    gameImageDelivery: ReturnType<typeof vi.fn>;
    statGameImage: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: () => mocks.control,
}));

vi.mock("@/src/lib/game/service", () => ({
  authorizeMediaRead: mocks.authorize,
  mediaKeyPrefixFor: (memberId: string) => `game/${memberId}/`,
}));
import { serveGameMedia } from "@/src/lib/game/http/media-routes";

import { putGameMedia, readGameMedia, statGameMedia, gameMediaDelivery, isGameMediaStorageAvailable } from "@/src/lib/game/media";

const LEO = "hbm_leo";
const PREFIX = `game/${LEO}/`;
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

describe("game media on a local stack (disk)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(process.env.MURPH_VITEST_TEMP_ROOT ?? tmpdir(), "game-media-"));
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("MURPH_GAME_MEDIA_DIR", dir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { force: true, recursive: true });
  });

  it("stores a photo once under its content key and reads it back", async () => {
    const key = await putGameMedia({ bytes: JPEG, contentType: "image/jpeg", prefix: PREFIX });

    expect(key).toMatch(/^game\/hbm_leo\/[a-f0-9]{64}\.jpg$/u);
    await expect(putGameMedia({ bytes: JPEG, contentType: "image/jpeg", prefix: PREFIX })).resolves.toBe(key);
    await expect(statGameMedia(key)).resolves.toEqual({ byteLength: JPEG.byteLength, contentType: "image/jpeg" });
    expect(Array.from((await readGameMedia(key))!.bytes)).toEqual(Array.from(JPEG));
    await expect(readGameMedia(`${PREFIX}${"0".repeat(64)}.jpg`)).resolves.toBeNull();
  });
});

describe("game media when deployed (private Cloudflare Images)", () => {
  const stored = new Map<string, number>();
  const delivery = { url: "https://imagedelivery.net/account/image/gamephoto?exp=9999999999&sig=synthetic", expiresAt: "2030-01-01T00:00:00Z" };
  beforeEach(() => {
    stored.clear();
    vi.stubEnv("VERCEL_ENV", "production");
    mocks.control = {
      putGameImage: vi.fn(async (input: { bytes: Uint8Array; mediaId: string; userId: string }) => {
        stored.set(`${input.userId}/${input.mediaId}`, input.bytes.length);
      }),
      gameImageDelivery: vi.fn(async (input: { mediaId: string; userId: string }) =>
        stored.has(`${input.userId}/${input.mediaId}`) ? delivery : null),
      statGameImage: vi.fn(async (input: { mediaId: string; userId: string }) => {
        const byteLength = stored.get(`${input.userId}/${input.mediaId}`);
        return byteLength === undefined ? null : { byteLength };
      }),
    };
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); mocks.control = null; });

  it("uploads idempotently through the owner-bound Worker and returns a transient delivery capability", async () => {
    const key = await putGameMedia({ bytes: JPEG, contentType: "image/jpeg", prefix: PREFIX });
    await expect(putGameMedia({ bytes: JPEG, contentType: "image/jpeg", prefix: PREFIX })).resolves.toBe(key);
    expect(mocks.control!.putGameImage).toHaveBeenCalledTimes(2);
    expect(mocks.control!.putGameImage).toHaveBeenLastCalledWith({ bytes: JPEG, contentType: "image/jpeg", mediaId: key.slice(PREFIX.length), userId: LEO });
    expect(mocks.control!.statGameImage).not.toHaveBeenCalled();
    await expect(gameMediaDelivery(key, "avatar")).resolves.toEqual(delivery);
    expect(mocks.control!.gameImageDelivery).toHaveBeenCalledWith({ mediaId: key.slice(PREFIX.length), userId: LEO, variant: "avatar" });
  });

  it("serves old clients through a credential-free, bounded CDN fetch", async () => {
    const key = await putGameMedia({ bytes: JPEG, contentType: "image/jpeg", prefix: PREFIX });
    const fetcher = vi.fn(async () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(Array.from((await readGameMedia(key))!.bytes)).toEqual(Array.from(JPEG));
    expect(fetcher).toHaveBeenCalledWith(delivery.url, expect.objectContaining({ redirect: "error", headers: { accept: "image/jpeg" }, cache: "no-store" }));
    await expect(readGameMedia(`${PREFIX}${"0".repeat(64)}.jpg`)).resolves.toBeNull();
  });

  it("does not fetch an arbitrary delivery origin or expose provider URLs in errors", async () => {
    mocks.control!.gameImageDelivery.mockResolvedValue({ ...delivery, url: "https://other.example.test/image?sig=private" });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(readGameMedia(`${PREFIX}${"a".repeat(64)}.jpg`)).rejects.toThrow("Game image delivery URL is invalid.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("authorizes the viewer before minting any signed capability, with no shared caching", async () => {
    const key = await putGameMedia({ bytes: JPEG, contentType: "image/jpeg", prefix: PREFIX });
    mocks.authorize.mockResolvedValue(false);
    await expect(serveGameMedia({ key, memberId: "hbm_ava", delivery: true })).rejects.toMatchObject({ httpStatus: 404 });
    expect(mocks.control!.gameImageDelivery).not.toHaveBeenCalled();
    mocks.authorize.mockResolvedValue(true);
    const response = await serveGameMedia({ key, memberId: "hbm_ava", delivery: true, variant: "avatar" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.json()).toEqual(delivery);
    expect(mocks.authorize).toHaveBeenLastCalledWith("hbm_ava", key);
  });

  it("is off without the Worker's control client", () => {
    mocks.control = null;
    expect(isGameMediaStorageAvailable()).toBe(false);
  });
});
