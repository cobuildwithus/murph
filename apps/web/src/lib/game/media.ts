import "server-only";

import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Game photos, videos and voice memos. Keys are `<mediaKeyPrefixFor(member)><hash>.<ext>`
 * and derive from the upload's Idempotency-Key and role, so a retried upload
 * lands on the same key.
 *
 * Storage is a local directory (default `.tmp/game-media`, override with
 * `MURPH_GAME_MEDIA_DIR`) and is off on Vercel deployments: the meal-photo R2
 * staging call is JPEG-only and runner-read, so deployed storage needs its own
 * Worker call before the game leaves local testing.
 */

export const GAME_MEDIA_MAX_BYTES = 8 * 1024 * 1024;

const EXTENSIONS = {
  "audio/m4a": "m4a",
  "image/heic": "heic",
  "image/jpeg": "jpg",
  "video/mp4": "mp4",
} as const;

export type GameMediaContentType = keyof typeof EXTENSIONS;

const CONTENT_TYPES: readonly GameMediaContentType[] = ["audio/m4a", "image/heic", "image/jpeg", "video/mp4"];

export interface GameMediaObject {
  byteLength: number;
  contentType: GameMediaContentType;
  sha256: string;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/[a-f0-9]{32}\.(?:m4a|heic|jpg|mp4)$/u;
const KEY_MAX = 256;

export function parseGameMediaContentType(header: string | null): GameMediaContentType | null {
  const value = header?.split(";")[0]?.trim().toLowerCase() ?? "";
  return CONTENT_TYPES.find((type) => type === value) ?? null;
}

export function gameMediaKey(input: {
  contentType: GameMediaContentType;
  idempotencyKey: string;
  prefix: string;
  role: string;
}): string {
  const hash = createHash("sha256").update(`${input.role}\n${input.idempotencyKey}`).digest("hex").slice(0, 32);
  return `${input.prefix}${hash}.${EXTENSIONS[input.contentType]}`;
}

export function isGameMediaKey(key: string): boolean {
  return key.length <= KEY_MAX && KEY_PATTERN.test(key);
}

/** Cheap container check so a mislabeled upload is never served back under another type. */
export function matchesGameMediaContentType(bytes: Uint8Array, contentType: GameMediaContentType): boolean {
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  // HEIC, MP4 and M4A are all ISO base media files: a size, then "ftyp".
  return Buffer.from(bytes.subarray(4, 8)).toString("latin1") === "ftyp";
}

export function isGameMediaStorageAvailable(): boolean {
  return readStorageRoot() !== null;
}

export async function putGameMedia(input: {
  bytes: Uint8Array;
  contentType: GameMediaContentType;
  key: string;
}): Promise<"created" | "duplicate" | "conflict"> {
  const file = requireFile(input.key);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await statGameMedia(input.key);
  if (existing) return existing.sha256 === sha256 && existing.contentType === input.contentType ? "duplicate" : "conflict";
  const object: GameMediaObject = { byteLength: input.bytes.byteLength, contentType: input.contentType, sha256 };
  await mkdir(path.dirname(file), { recursive: true });
  // Bytes first, metadata last: a key exists once its metadata does.
  await writeAtomically(file, input.bytes);
  await writeAtomically(`${file}.json`, Buffer.from(JSON.stringify(object)));
  return "created";
}

export async function statGameMedia(key: string): Promise<GameMediaObject | null> {
  const file = requireFile(key);
  try {
    return parseObject(JSON.parse(await readFile(`${file}.json`, "utf8")));
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function readGameMedia(key: string): Promise<{ bytes: Buffer; object: GameMediaObject } | null> {
  const object = await statGameMedia(key);
  if (!object) return null;
  return { bytes: await readFile(requireFile(key)), object };
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

async function writeAtomically(file: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
}

function parseObject(value: unknown): GameMediaObject {
  if (typeof value !== "object" || value === null) throw new Error("Game media metadata is invalid.");
  const contentType = parseGameMediaContentType("contentType" in value && typeof value.contentType === "string" ? value.contentType : null);
  const byteLength = "byteLength" in value ? value.byteLength : null;
  const sha256 = "sha256" in value ? value.sha256 : null;
  if (!contentType || typeof byteLength !== "number" || typeof sha256 !== "string") throw new Error("Game media metadata is invalid.");
  return { byteLength, contentType, sha256 };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
