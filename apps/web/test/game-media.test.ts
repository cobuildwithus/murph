import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ROOT_KEY = new Uint8Array(32).fill(7);

const mocks = vi.hoisted(() => ({
  control: null as null | {
    putGameMedia: ReturnType<typeof vi.fn>;
    readGameMedia: ReturnType<typeof vi.fn>;
    statGameMedia: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: () => mocks.control,
}));

// The member's control root, unwrapped fresh each call (callers zero it).
vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  unwrapHostedDomainRootForWeb: async () => ({ envelope: { rootKeyId: "root_leo" }, rootKey: Uint8Array.from(ROOT_KEY) }),
  unwrapHostedDomainRootForWebByRootKeyId: async () => ({ rootKey: Uint8Array.from(ROOT_KEY) }),
}));

import { putGameMedia, readGameMedia, statGameMedia, isGameMediaStorageAvailable } from "@/src/lib/game/media";

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

describe("game media when deployed (sealed, kept by the Worker)", () => {
  const stored = new Map<string, string>();

  beforeEach(() => {
    stored.clear();
    vi.stubEnv("VERCEL_ENV", "production");
    mocks.control = {
      putGameMedia: vi.fn(async (input: { envelope: string; mediaId: string; userId: string }) => {
        stored.set(`${input.userId}/${input.mediaId}`, input.envelope);
      }),
      readGameMedia: vi.fn(async (input: { mediaId: string; userId: string }) => stored.get(`${input.userId}/${input.mediaId}`) ?? null),
      statGameMedia: vi.fn(async (input: { mediaId: string; userId: string }) => {
        const envelope = stored.get(`${input.userId}/${input.mediaId}`);
        return envelope === undefined ? null : { byteLength: envelope.length };
      }),
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.control = null;
  });

  it("seals the photo under the uploader's key and opens it on read", async () => {
    const key = await putGameMedia({ bytes: JPEG, contentType: "image/jpeg", prefix: PREFIX });
    const mediaId = key.slice(PREFIX.length);

    expect(mocks.control!.putGameMedia).toHaveBeenCalledWith(expect.objectContaining({ mediaId, userId: LEO }));
    const envelope = JSON.parse(stored.get(`${LEO}/${mediaId}`)!);
    expect(envelope).toMatchObject({ domain: "control", lane: "hosted-member-private-field", scope: "weekly-game" });
    expect(stored.get(`${LEO}/${mediaId}`)).not.toContain(Buffer.from(JPEG).toString("base64"));

    expect(Array.from((await readGameMedia(key))!.bytes)).toEqual(Array.from(JPEG));
    await expect(putGameMedia({ bytes: JPEG, contentType: "image/jpeg", prefix: PREFIX })).resolves.toBe(key);
    expect(mocks.control!.putGameMedia).toHaveBeenCalledTimes(1);
  });

  it("binds each sealed photo to its own key", async () => {
    const key = await putGameMedia({ bytes: JPEG, contentType: "image/jpeg", prefix: PREFIX });
    const otherKey = `${PREFIX}${"f".repeat(64)}.jpg`;
    stored.set(`${LEO}/${otherKey.slice(PREFIX.length)}`, stored.get(`${LEO}/${key.slice(PREFIX.length)}`)!);

    await expect(readGameMedia(otherKey)).rejects.toThrow();
    await expect(readGameMedia(`${PREFIX}${"0".repeat(64)}.jpg`)).resolves.toBeNull();
  });

  it("is off without the Worker's control client", () => {
    mocks.control = null;
    expect(isGameMediaStorageAvailable()).toBe(false);
  });
});
