import "server-only";

import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { mediaKeyOwner } from "./access";
import { openGameMedia } from "./crypto";
import { readRawBodyBuffer } from "../http";

/**
 * Game photos, content-addressed: a key is
 * `<mediaKeyPrefixFor(member)><sha256 of the bytes>.<ext>`, so uploading the
 * same file twice lands on the same key and a key can never change contents.
 * The extension carries the type.
 *
 * Deployed photos live in private Cloudflare Images. The Worker keeps only
 * an opaque provider pointer in R2 and signs short-lived delivery URLs after
 * Web authorizes the viewer. Without its control client storage is off. Anywhere
 * else they're plain files in a local directory (default `.tmp/game-media`,
 * override with `MURPH_GAME_MEDIA_DIR`), for local stacks.
 */

/** Under Vercel's request and response body limits; the phone sends about 1 MiB. */
export const GAME_MEDIA_MAX_BYTES = 4 * 1024 * 1024;

const EXTENSIONS = {
  "image/heic": "heic",
  "image/jpeg": "jpg",
} as const;

export type GameMediaContentType = keyof typeof EXTENSIONS;

const CONTENT_TYPES: readonly GameMediaContentType[] = ["image/heic", "image/jpeg"];
const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/[a-f0-9]{64}\.(?:heic|jpg)$/u;
const KEY_MAX = 256;

export function parseGameMediaContentType(header: string | null): GameMediaContentType | null {
  const value = header?.split(";")[0]?.trim().toLowerCase() ?? "";
  return CONTENT_TYPES.find((type) => type === value) ?? null;
}

export function isGameMediaKey(key: string): boolean {
  return key.length <= KEY_MAX && KEY_PATTERN.test(key);
}

/** HEIC major brands in the ISO base media "ftyp" box. */
const HEIC_BRANDS = ["heic", "heix", "mif1", "msf1"];

/** Cheap container check so a mislabeled upload is never served back under another type. */
export function matchesGameMediaContentType(bytes: Uint8Array, contentType: GameMediaContentType): boolean {
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  // HEIC: a size, "ftyp", then an image major brand (so an M4A or MP4 can't pass).
  const box = Buffer.from(bytes.subarray(4, 12)).toString("latin1");
  return box.startsWith("ftyp") && HEIC_BRANDS.includes(box.slice(4));
}

type Store =
  | { kind: "disk"; root: string }
  | { control: CloudflareHostedControlClient; kind: "hosted" };

function readStore(): Store | null {
  const deployment = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (deployment === "production" || deployment === "preview") {
    const control = readHostedExecutionControlClientIfConfigured();
    return control ? { control, kind: "hosted" } : null;
  }
  const root = path.resolve(process.env.MURPH_GAME_MEDIA_DIR?.trim() || path.join(process.cwd(), ".tmp", "game-media"));
  return { kind: "disk", root };
}

export function isGameMediaStorageAvailable(): boolean {
  return readStore() !== null;
}

/** Deployed photos go out as signed CDN URLs; local stacks serve bytes. */
export function servesSignedGameMedia(): boolean {
  return readStore()?.kind === "hosted";
}

/** Stores the bytes (once) under their content key and returns the key. */
export async function putGameMedia(input: {
  bytes: Uint8Array;
  contentType: GameMediaContentType;
  prefix: string;
}): Promise<string> {
  const hash = createHash("sha256").update(input.bytes).digest("hex");
  const key = `${input.prefix}${hash}.${EXTENSIONS[input.contentType]}`;
  const store = requireStore();
  if (store.kind === "hosted") {
    const { mediaId, owner } = hostedName(key);
    await store.control.putGameImage({ bytes: input.bytes, contentType: input.contentType, mediaId, userId: owner });
    return key;
  }
  if (await statGameMedia(key)) return key;
  const file = requireFile(store.root, key);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, input.bytes);
  await rename(temporary, file);
  return key;
}

/** Whether a key is stored; `byteLength` is what the store holds (original upload size when hosted). */
export async function statGameMedia(key: string): Promise<{ byteLength: number; contentType: GameMediaContentType } | null> {
  const store = requireStore();
  const contentType = contentTypeOf(key);
  if (store.kind === "hosted") {
    const { mediaId, owner } = hostedName(key);
    const stored = await store.control.statGameImage({ mediaId, userId: owner })
      ?? await recoverLegacyGameMedia(store.control, key);
    return stored ? { byteLength: stored.byteLength, contentType } : null;
  }
  try {
    return { byteLength: (await stat(requireFile(store.root, key))).size, contentType };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function readGameMedia(key: string): Promise<{ bytes: Uint8Array; contentType: GameMediaContentType } | null> {
  const store = requireStore();
  const contentType = contentTypeOf(key);
  if (store.kind === "hosted") {
    const delivery = await hostedDelivery(store.control, key, "photo");
    if (!delivery) return null;
    assertImageDeliveryURL(delivery.url);
    try {
      // Compatibility for released clients which request image bytes. New
      // clients fetch the signed URL directly with no Murph credentials.
      const response = await fetch(delivery.url, { redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { accept: "image/jpeg" }, cache: "no-store" });
      if (!response.ok) throw new Error("Image unavailable.");
      const type = parseGameMediaContentType(response.headers.get("content-type"));
      if (!type) throw new Error("Image type is invalid.");
      return { bytes: await readRawBodyBuffer(response, { limitBytes: GAME_MEDIA_MAX_BYTES }), contentType: type };
    } catch { throw new Error("Game image download failed."); }
  }
  try {
    return { bytes: await readFile(requireFile(store.root, key)), contentType };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

/** Null on local stacks; callers then serve local bytes. This function
 * never grants access: the route must authorize the viewer first. */
export async function gameMediaDelivery(key: string, variant: "avatar" | "photo") {
  const store = requireStore();
  if (store.kind === "disk") return null;
  return hostedDelivery(store.control, key, variant);
}

async function hostedDelivery(control: CloudflareHostedControlClient, key: string, variant: "avatar" | "photo") {
  const { mediaId, owner } = hostedName(key);
  const request = { mediaId, userId: owner, variant };
  let delivery = await control.gameImageDelivery(request);
  if (!delivery && await recoverLegacyGameMedia(control, key)) {
    delivery = await control.gameImageDelivery(request);
  }
  if (delivery) assertImageDeliveryURL(delivery.url);
  return delivery;
}

/** Only Web has the legacy member key. Reuse the original AAD and the Worker's
 * content-hash validation, conditional pointer write and account-deletion fence.
 * Keep the encrypted original; a failed repair can be retried on the next read.
 */
async function recoverLegacyGameMedia(control: CloudflareHostedControlClient, key: string) {
  const { mediaId, owner } = hostedName(key);
  try {
    const envelope = await control.readGameMedia({ mediaId, userId: owner });
    if (envelope === null) return null;
    const bytes = await openGameMedia({ envelope, key, ownerMemberId: owner });
    try {
      await control.putGameImage({ bytes, contentType: contentTypeOf(key), mediaId, userId: owner });
      return { byteLength: bytes.byteLength };
    } finally {
      bytes.fill(0);
    }
  } catch {
    throw new Error("Game image recovery failed.");
  }
}

function assertImageDeliveryURL(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Game image delivery URL is invalid."); }
  if (url.protocol !== "https:" || url.hostname !== "imagedelivery.net" || url.port || url.username || url.password
    || !url.searchParams.get("sig") || !url.searchParams.get("exp")) throw new Error("Game image delivery URL is invalid.");
}

function requireStore(): Store {
  const store = readStore();
  if (!store) throw new Error("Game media storage is not configured.");
  return store;
}

/** A hosted photo lives under its uploader, named by its last key segment. */
function hostedName(key: string): { mediaId: string; owner: string } {
  const owner = isGameMediaKey(key) ? mediaKeyOwner(key) : null;
  if (!owner) throw new TypeError("Game media key is invalid.");
  return { mediaId: key.slice(key.lastIndexOf("/") + 1), owner };
}

function contentTypeOf(key: string): GameMediaContentType {
  const extension = key.slice(key.lastIndexOf(".") + 1);
  const type = CONTENT_TYPES.find((candidate) => EXTENSIONS[candidate] === extension);
  if (!type) throw new TypeError("Game media key is invalid.");
  return type;
}

function requireFile(root: string, key: string): string {
  if (!isGameMediaKey(key)) throw new TypeError("Game media key is invalid.");
  const file = path.resolve(root, key);
  if (!file.startsWith(`${root}${path.sep}`)) throw new TypeError("Game media key is invalid.");
  return file;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
