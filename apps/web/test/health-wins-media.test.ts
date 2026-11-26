import sharp, { type Metadata } from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PUT } from "../app/api/game/v1/health/photos/[id]/route";
import { deleteHealthAttachmentsForAccount } from "../src/lib/health-wins/media";
import { getPrisma } from "../src/lib/prisma";

const mocks = vi.hoisted(() => ({
  find: vi.fn(), many: vi.fn(), create: vi.fn(), count: vi.fn(), update: vi.fn(), remove: vi.fn(),
  post: vi.fn(), reauth: vi.fn(), readAuth: vi.fn(), openKey: vi.fn(), sealKey: vi.fn(), openPhoto: vi.fn(), sealPhoto: vi.fn(),
  read: vi.fn(), put: vi.fn(), purge: vi.fn(), authority: vi.fn(), flag: vi.fn(),
}));
const db = {
  healthPostAttachment: {
    findFirst: mocks.find, findMany: mocks.many, createMany: mocks.create, count: mocks.count, updateMany: mocks.update, deleteMany: mocks.remove,
  },
  $transaction: (run: (tx: object) => Promise<unknown>) => run(db),
};
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => db }));
vi.mock("../src/lib/game/http/auth", () => ({
  requireGameMemberAuth: async () => ({ member: { id: "reader" } }), assertGameMemberAuthCurrentTx: mocks.reauth,
  assertGameMemberAuthCurrentForRead: mocks.readAuth,
}));
vi.mock("../src/lib/health-wins/flag", () => ({ assertHealthFeedEnabled: mocks.flag }));
vi.mock("../src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("../src/lib/health-wins/audience", () => ({ findVisibleHealthPost: mocks.post }));
vi.mock("../src/lib/health-wins/crypto", () => ({
  openHealthTexts: mocks.openKey, sealHealthTexts: mocks.sealKey, openHealthPhoto: mocks.openPhoto, sealHealthPhoto: mocks.sealPhoto,
}));
vi.mock("../src/lib/game/progress/media-store", () => ({
  progressMediaStore: () => ({ putProgressPic: mocks.put, readProgressPic: mocks.read }), purgeProgressMedia: mocks.purge,
}));
const photoId = "7daa778d-cc02-4190-a954-957d74950342";
const binding = { id: photoId, memberId: "poster", postId: "post", storageKeyEncrypted: "sealed-key" };
const post = { id: "post", authorMemberId: "poster", version: 1 };
const context = { params: Promise.resolve({ id: photoId }) };
const url = "https://example.test/api/game/v1/health/photos/" + photoId;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.openKey.mockImplementation(async (entries: unknown[]) => entries.map(() => "synthetic-object-key"));
  mocks.sealKey.mockResolvedValue(["sealed-key"]);
  mocks.read.mockResolvedValue({ envelope: "sealed-photo" });
  mocks.find.mockResolvedValue(binding);
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.create.mockResolvedValue({ count: 1 });
  mocks.count.mockResolvedValue(1);
  mocks.post.mockResolvedValue(post);
});

describe("health photo upload, serving and retirement", () => {
  it("registers before storage and makes the oriented, metadata-free JPEG ready to publish", async () => {
    const input = await sharp({ create: { width: 4, height: 6, channels: 3, background: "teal" } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    let metadata: Metadata | undefined;
    mocks.sealPhoto.mockImplementation(async ({ value }) => {
      metadata = await sharp(value).metadata();
      return "sealed-photo";
    });
    mocks.find.mockResolvedValue({ ...binding, memberId: "reader", postId: null });
    const response = await PUT(new Request(url, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: new Uint8Array(input) }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ attachmentId: photoId });
    expect(metadata).toMatchObject({ width: 6, height: 4 });
    expect(metadata?.exif).toBeUndefined();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ id: photoId, memberId: "reader", status: "pending", storageKeyEncrypted: "sealed-key" }],
    }));
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.put.mock.invocationCallOrder[0]!);
    expect(mocks.put.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]!);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "ready" } }));
  });

  it("returns a conflict before writing photo bytes when the member's drafts are full", async () => {
    const input = await sharp({ create: { width: 2, height: 3, channels: 3, background: "blue" } }).jpeg().toBuffer();
    mocks.count.mockResolvedValue(21);
    const response = await PUT(new Request(url, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: new Uint8Array(input) }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "HEALTH_PHOTO_LIMIT" } });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("discards a draft after consent withdrawal, with a retryable purge boundary", async () => {
    mocks.find.mockResolvedValue({ id: photoId, memberId: "reader", postId: null, storageKeyEncrypted: "sealed-key" });
    mocks.authority.mockRejectedValue(new Error("Withdrawn"));
    mocks.purge.mockRejectedValueOnce(new Error("Unavailable"));
    expect((await DELETE(new Request(url), context)).status).toBe(503);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect((await DELETE(new Request(url), context)).status).toBe(200);
    expect(mocks.purge).toHaveBeenCalledTimes(2);
    expect(mocks.authority).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("keeps a published photo tied to its post", async () => {
    mocks.find.mockResolvedValue({ ...binding, memberId: "reader" });
    expect((await DELETE(new Request(url), context)).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.purge).not.toHaveBeenCalled();
  });

  it("checks the live parent before opening any key", async () => {
    mocks.post.mockResolvedValue(null);
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(404);
    expect(mocks.openKey).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("zeros decrypted bytes when the viewer loses access during the read", async () => {
    const privateBytes = Uint8Array.of(5, 8);
    mocks.post.mockResolvedValueOnce(post).mockResolvedValueOnce(null);
    mocks.openPhoto.mockResolvedValue(privateBytes);
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(privateBytes).toEqual(Uint8Array.of(0, 0));
    expect(mocks.readAuth).toHaveBeenCalledOnce();
    expect(mocks.reauth).not.toHaveBeenCalled();
  });

  it("returns published bytes only after the parent and attachment recheck", async () => {
    mocks.openPhoto.mockResolvedValue(Uint8Array.of(2, 7));
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(2, 7));
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it("keeps ownership on failed purge and deletes its row only after a successful retry", async () => {
    const row = { id: photoId, memberId: "poster", storageKeyEncrypted: "sealed-key" };
    mocks.many.mockResolvedValue([row]);
    mocks.purge.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(deleteHealthAttachmentsForAccount(["poster"], getPrisma())).rejects.toThrow("Unavailable");
    expect(mocks.update).toHaveBeenCalledWith({ where: { memberId: "poster", id: { in: [photoId] } }, data: { status: "retired" } });
    expect(mocks.remove).not.toHaveBeenCalled();
    await deleteHealthAttachmentsForAccount(["poster"], getPrisma());
    expect(mocks.purge).toHaveBeenCalledTimes(2);
    expect(mocks.remove).toHaveBeenCalledWith({ where: { ...row, status: "retired" } });
  });
});
