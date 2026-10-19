import "server-only";

import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { mediaKeyOwner } from "./access";
import { openGameMedia, sealGameMedia } from "./crypto";

/**
 * Game photos, content-addressed: a key is
 * `<mediaKeyPrefixFor(member)><sha256 of the bytes>.<ext>`, so uploading the
 * same file twice lands on the same key and a key can never change contents.
 * The extension carries the type.
 *
 * Deployed (Vercel production and preview), photos are sealed here under the
 * uploader's key and kept by the Cloudflare Worker in R2; that store is the
 * only option there, and without its control client storage is off. Anywhere
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

/** Stores the bytes (once) under their content key and returns the key. */
export async function putGameMedia(input: {
  bytes: Uint8Array;
  contentType: GameMediaContentType;
  prefix: string;
}): Promise<string> {
  const hash = createHash("sha256").update(input.bytes).digest("hex");
  const key = `${input.prefix}${hash}.${EXTENSIONS[input.contentType]}`;
  if (await statGameMedia(key)) return key;
  const store = requireStore();
  if (store.kind === "hosted") {
    const { mediaId, owner } = hostedName(key);
    const envelope = await sealGameMedia({ bytes: input.bytes, key, ownerMemberId: owner });
    await store.control.putGameMedia({ envelope, mediaId, userId: owner });
    return key;
  }
  const file = requireFile(store.root, key);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, input.bytes);
  await rename(temporary, file);
  return key;
}

/** Whether a key is stored; `byteLength` is what the store holds (sealed size when hosted). */
export async function statGameMedia(key: string): Promise<{ byteLength: number; contentType: GameMediaContentType } | null> {
  const store = requireStore();
  const contentType = contentTypeOf(key);
  if (store.kind === "hosted") {
    const { mediaId, owner } = hostedName(key);
    const stored = await store.control.statGameMedia({ mediaId, userId: owner });
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
    const { mediaId, owner } = hostedName(key);
    const envelope = await store.control.readGameMedia({ mediaId, userId: owner });
    return envelope === null ? null : { bytes: await openGameMedia({ envelope, key, ownerMemberId: owner }), contentType };
  }
  try {
    return { bytes: await readFile(requireFile(store.root, key)), contentType };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
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
