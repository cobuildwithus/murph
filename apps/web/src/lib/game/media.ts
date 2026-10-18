import "server-only";

import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Game photos, content-addressed: a key is
 * `<mediaKeyPrefixFor(member)><sha256 of the bytes>.<ext>`, so uploading the
 * same file twice lands on the same key and a key can never change contents.
 * The extension carries the type.
 *
 * Storage is a local directory (default `.tmp/game-media`, override with
 * `MURPH_GAME_MEDIA_DIR`) and is off on Vercel deployments: the meal-photo R2
 * staging call is JPEG-only and runner-read, so deployed storage needs its own
 * Worker call before the game leaves local testing.
 */

export const GAME_MEDIA_MAX_BYTES = 8 * 1024 * 1024;

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

export function isGameMediaStorageAvailable(): boolean {
  return readStorageRoot() !== null;
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
  const file = requireFile(key);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, input.bytes);
  await rename(temporary, file);
  return key;
}

export async function statGameMedia(key: string): Promise<{ byteLength: number; contentType: GameMediaContentType } | null> {
  try {
    const file = await stat(requireFile(key));
    return { byteLength: file.size, contentType: contentTypeOf(key) };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function readGameMedia(key: string): Promise<{ bytes: Buffer; contentType: GameMediaContentType } | null> {
  try {
    return { bytes: await readFile(requireFile(key)), contentType: contentTypeOf(key) };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

function contentTypeOf(key: string): GameMediaContentType {
  const extension = key.slice(key.lastIndexOf(".") + 1);
  const type = CONTENT_TYPES.find((candidate) => EXTENSIONS[candidate] === extension);
  if (!type) throw new TypeError("Game media key is invalid.");
  return type;
}

function readStorageRoot(): string | null {
  const deployment = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (deployment === "production" || deployment === "preview") return null;
  return path.resolve(process.env.MURPH_GAME_MEDIA_DIR?.trim() || path.join(process.cwd(), ".tmp", "game-media"));
}

function requireFile(key: string): string {
  const root = readStorageRoot();
  if (!root) throw new Error("Game media storage is not configured.");
  if (!isGameMediaKey(key)) throw new TypeError("Game media key is invalid.");
  const file = path.resolve(root, key);
  if (!file.startsWith(`${root}${path.sep}`)) throw new TypeError("Game media key is invalid.");
  return file;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
