import { requireR2DeletionCapabilities } from "./user-runner/r2-delete.ts";
import type { R2BucketLike } from "./bundle-store.ts";
import { hostedGameMediaObjectKey, hostedGameMediaUserPrefix, requireHostedGameMediaId } from "./storage-paths.ts";

/** The hosted Images binding, narrowed to this owner's public operations. */
export interface GameImagesBinding {
  hosted: {
    upload(bytes: ArrayBuffer, options: { requireSignedURLs: true; creator: string; filename: string }): Promise<{
      id: string; requireSignedURLs: boolean;
    }>;
    image(id: string): {
      signedUrl(options: { variant: string; expiresIn: number }): Promise<string>;
      delete(): Promise<boolean>;
    };
    list(options: { creator: string; limit: number }): Promise<{
      images: Array<{ id: string; creator?: string }>; listComplete: boolean;
    }>;
  };
}

export const GAME_IMAGE_DELIVERY_SECONDS = 300;
export type GameImageVariant = "avatar" | "photo";
const VARIANTS: Record<GameImageVariant, string> = { avatar: "game-avatar", photo: "game-photo" };
const POINTER_SUFFIX = ".image.json";
type Pointer = { schema: "murph.game-image.v1"; imageId: string; byteLength: number };

/** No image bytes or capability URLs in R2: only a provider UUID and size.
 * The existing opaque owner/content path keeps upload retries idempotent.
 * Cloudflare Images is the sole durable owner of new game image bytes.
 */
export function createGameImageStore(input: { bucket: R2BucketLike; images: GameImagesBinding; userId: string }) {
  const pointerKey = async (mediaId: string) =>
    (await hostedGameMediaObjectKey({ mediaId, userId: input.userId })).replace(/\.json\.enc$/u, POINTER_SUFFIX);
  const read = async (mediaId: string): Promise<Pointer | null> => {
    const object = await input.bucket.get(await pointerKey(mediaId));
    return object ? parsePointer(JSON.parse(new TextDecoder().decode(await object.arrayBuffer()))) : null;
  };
  return {
    async stat(mediaId: string) {
      const pointer = await read(mediaId);
      return pointer ? { byteLength: pointer.byteLength } : null;
    },
    async upload(mediaId: string, bytes: Uint8Array) {
      requireHostedGameMediaId(mediaId);
      if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) throw new RangeError("Game image size is invalid.");
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
        (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (hash !== mediaId.split(".")[0]) throw new TypeError("Game image content key does not match.");
      if (await read(mediaId)) return;
      const { delete: remove } = requireR2DeletionCapabilities(input.bucket);
      const paths = await uploadPaths(input.userId);
      const receipt = `${paths.pending}${crypto.randomUUID()}.json`;
      // Register before reading the permanent deletion fence. Strongly
      // consistent R2 reads/listing let deletion drain all admitted uploads.
      await input.bucket.put(receipt, JSON.stringify({ schema: "murph.game-image-upload.v1" }));
      if (await input.bucket.get(paths.deleted)) {
        await remove(receipt);
        throw new Error("Game image owner was deleted.");
      }
      // Keep the receipt on an ambiguous provider/write failure. Never let
      // account deletion claim success while an upload may still complete.
      const uploaded = await input.images.hosted.upload(new Uint8Array(bytes).buffer, {
        creator: await gameImageCreator(input.userId), filename: `game.${mediaId.endsWith(".heic") ? "heic" : "jpg"}`,
        requireSignedURLs: true,
      });
      if (!uploaded.requireSignedURLs || !isImageId(uploaded.id)) {
        if (isImageId(uploaded.id)) {
          await input.images.hosted.image(uploaded.id).delete();
          await remove(receipt);
        }
        throw new Error("Game image privacy was not confirmed.");
      }
      const pointer: Pointer = { byteLength: bytes.length, imageId: uploaded.id, schema: "murph.game-image.v1" };
      // R2 conditional creation elects one winner for concurrent retries.
      // A lost/ambiguous response leaves an owner-tagged image that account
      // deletion also finds independently of the pointer.
      await input.bucket.put(await pointerKey(mediaId), JSON.stringify(pointer), {
        httpMetadata: { contentType: "application/json" }, onlyIf: { etagDoesNotMatch: "*" },
      });
      const winner = await read(mediaId);
      if (winner?.imageId !== uploaded.id) await input.images.hosted.image(uploaded.id).delete();
      if (!winner) throw new Error("Game image storage was not confirmed.");
      await remove(receipt);
    },
    async delivery(mediaId: string, variant: GameImageVariant) {
      const pointer = await read(mediaId);
      if (!pointer) return null;
      const url = await input.images.hosted.image(pointer.imageId).signedUrl({
        expiresIn: GAME_IMAGE_DELIVERY_SECONDS, variant: VARIANTS[variant],
      });
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== "imagedelivery.net" || parsed.port
        || parsed.username || parsed.password || !parsed.searchParams.get("sig") || !parsed.searchParams.get("exp")) {
        throw new Error("Game image delivery URL is invalid.");
      }
      return { url, expiresAt: new Date(Date.now() + GAME_IMAGE_DELIVERY_SECONDS * 1000).toISOString() };
    },
  };
}

function isImageId(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value);
}

function parsePointer(value: unknown): Pointer {
  if (typeof value !== "object" || value === null || !("schema" in value) || value.schema !== "murph.game-image.v1"
    || !("imageId" in value) || typeof value.imageId !== "string" || !isImageId(value.imageId)
    || !("byteLength" in value) || typeof value.byteLength !== "number" || !Number.isSafeInteger(value.byteLength)
    || value.byteLength <= 0 || value.byteLength > 4 * 1024 * 1024) throw new TypeError("Game image index is invalid.");
  return { schema: value.schema, imageId: value.imageId, byteLength: value.byteLength };
}

/** Reuse the opaque storage namespace; never send a member identifier to Images. */
async function gameImageCreator(userId: string): Promise<string> {
  return (await hostedGameMediaUserPrefix({ userId })).replaceAll("/", "_");
}

async function uploadPaths(userId: string) {
  const creator = await gameImageCreator(userId);
  // Separate from the deleted data prefix: this minimal opaque guard must
  // survive deletion so a request delayed before admission cannot recreate data.
  return { deleted: `game-image-deletions/${creator}.json`, pending: `game-image-uploads/${creator}/` };
}

/** Runs after existing account deactivation and runtime drain, before R2/state
 * deletion. Includes failed-upload orphans, not just referenced images.
 * Bounded batches fail retryably; successful earlier deletions remain gone.
 */
export async function deleteGameImagesForUser(images: GameImagesBinding | undefined, userId: string, bucket: R2BucketLike): Promise<void> {
  if (!images) throw new Error("Game image deletion binding is unavailable.");
  const { list } = requireR2DeletionCapabilities(bucket);
  const paths = await uploadPaths(userId);
  await bucket.put(paths.deleted, JSON.stringify({ schema: "murph.game-image-deletion.v1" }));
  const pending = await list({ prefix: paths.pending, limit: 1 });
  if (pending.objects.length || pending.truncated) throw new Error("Game image uploads have not drained.");
  const creator = await gameImageCreator(userId);
  for (let batch = 0; batch < 10; batch += 1) {
    const page = await images.hosted.list({ creator, limit: 100 });
    if (page.images.some((image) => image.creator !== creator || !isImageId(image.id))) {
      throw new Error("Game image deletion ownership is invalid.");
    }
    // Reread the first page after deletion, avoiding a cursor over a changing set.
    for (let offset = 0; offset < page.images.length; offset += 5) {
      await Promise.all(page.images.slice(offset, offset + 5).map((image) => images.hosted.image(image.id).delete()));
    }
    if (page.images.length === 0 && page.listComplete) return;
  }
  throw new Error("Game image deletion requires another bounded pass.");
}
