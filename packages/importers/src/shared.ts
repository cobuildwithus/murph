import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  [".csv", "text/csv"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".m4a", "audio/mp4"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".txt", "text/plain"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
]);

export type PlainObject = Record<string, unknown>;

type WithoutUndefined<T extends Record<string, unknown>> = {
  [Key in keyof T as T[Key] extends undefined ? never : Key]: Exclude<T[Key], undefined>;
};

export interface InspectedFileAsset {
  role: string;
  sourcePath: string;
  fileName: string;
  extension?: string;
  mediaType: string;
  byteSize: number;
}

export function assertPlainObject(value: unknown, label: string): PlainObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  return value as PlainObject;
}

export function normalizeRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }

  return trimmed;
}

export function normalizeOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string when provided`);
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function normalizeOptionalStringList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of strings when provided`);
  }

  return value.map((entry, index) =>
    normalizeRequiredString(entry, `${label}[${index}]`),
  );
}

export function normalizeTimestamp(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const candidate = value instanceof Date ? value : new Date(value as string | number);

  if (Number.isNaN(candidate.valueOf())) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }

  return candidate.toISOString();
}

export function normalizeNumber(value: unknown, label: string): number {
  if (value === undefined || value === null || value === "") {
    throw new TypeError(`${label} must be a number`);
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    throw new TypeError(`${label} must be a finite number`);
  }

  return numeric;
}

export function inferMediaType(fileName: string): string {
  return MEDIA_TYPES.get(extname(fileName).toLowerCase()) ?? "application/octet-stream";
}

export async function inspectFileAsset(
  filePath: unknown,
  role = "file",
): Promise<InspectedFileAsset> {
  const normalizedPath = normalizeRequiredString(filePath, `${role}Path`);
  const sourcePath = resolve(normalizedPath);

  let details;

  try {
    details = await stat(sourcePath);
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;

    if (candidate.code === "ENOENT") {
      throw new Error(`${role}Path does not point to an existing file`);
    }

    throw error;
  }

  if (!details.isFile()) {
    throw new Error(`${role}Path must point to a file`);
  }

  const fileName = basename(sourcePath);
  const extension = extname(fileName).toLowerCase();

  return stripUndefined({
    role,
    sourcePath,
    fileName,
    extension: extension.length === 0 ? undefined : extension,
    mediaType: inferMediaType(fileName),
    byteSize: details.size,
  });
}

export async function readUtf8File(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

export function stripUndefined<T extends Record<string, unknown>>(value: T): WithoutUndefined<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as WithoutUndefined<T>;
}

export function stripEmptyObject<T extends Record<string, unknown>>(value: T): T | undefined {
  return Object.keys(value).length === 0 ? undefined : value;
}
