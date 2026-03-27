import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { normalizeStrictIsoTimestamp } from "@healthybob/contracts";
import { z } from "zod";

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

function parseValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new TypeError(result.error.issues[0]?.message ?? "Invalid value");
  }

  return result.data;
}

export function requiredTrimmedStringSchema(label: string): z.ZodType<string> {
  return z
    .string({ error: `${label} must be a string` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, {
      error: `${label} must be a non-empty string`,
    });
}

export function optionalTrimmedStringSchema(
  label: string,
): z.ZodType<string | undefined> {
  return z
    .custom<string | undefined | null>(
      (value): value is string | undefined | null =>
        value === undefined || value === null || typeof value === "string",
      { error: `${label} must be a string when provided` },
    )
    .transform((value) => {
      if (typeof value !== "string") {
        return undefined;
      }

      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    });
}

export const vaultRootAliasSchemaFields = {
  vaultRoot: optionalTrimmedStringSchema("vaultRoot"),
  vault: optionalTrimmedStringSchema("vault"),
} satisfies z.ZodRawShape;

export function resolveVaultRootAlias<T>(value: {
  vaultRoot?: T;
  vault?: T;
}): T | undefined {
  return value.vaultRoot ?? value.vault;
}

export function optionalStringListSchema(label: string): z.ZodType<string[]> {
  return z
    .custom<readonly string[] | undefined | null>(
      (value): value is readonly string[] | undefined | null =>
        value === undefined ||
        value === null ||
        (Array.isArray(value) &&
          value.every(
            (entry) => typeof entry === "string" && entry.trim().length > 0,
          )),
      { error: `${label} must be an array of strings when provided` },
    )
    .transform((value) =>
      value === undefined || value === null
        ? []
        : value.map((entry) => entry.trim()),
    );
}

export function optionalTimestampSchema(
  label: string,
): z.ZodType<string | undefined> {
  return z
    .custom<string | number | Date | undefined | null>(
      (value): value is string | number | Date | undefined | null => {
        if (value === undefined || value === null) {
          return true;
        }

        if (
          typeof value !== "string" &&
          typeof value !== "number" &&
          !(value instanceof Date)
        ) {
          return false;
        }

        return normalizeStrictIsoTimestamp(value) !== null;
      },
      { error: `${label} must be a valid timestamp` },
    )
    .transform((value) => {
      if (value === undefined || value === null) {
        return undefined;
      }

      const normalized = normalizeStrictIsoTimestamp(value);

      if (!normalized) {
        throw new TypeError(`${label} must be a valid timestamp`);
      }

      return normalized;
    });
}

export function parseInputObject<T>(
  value: unknown,
  label: string,
  schema: z.ZodType<T>,
): T {
  const object = assertPlainObject(value, label);
  return parseValue(schema, object);
}

export function assertPlainObject(value: unknown, label: string): PlainObject {
  return parseValue(
    z.custom<PlainObject>(
      (candidate): candidate is PlainObject =>
        Boolean(candidate) &&
        typeof candidate === "object" &&
        !Array.isArray(candidate),
      { error: `${label} must be an object` },
    ),
    value,
  );
}

export function normalizeRequiredString(value: unknown, label: string): string {
  return parseValue(requiredTrimmedStringSchema(label), value);
}

export function normalizeOptionalString(value: unknown, label: string): string | undefined {
  return parseValue(optionalTrimmedStringSchema(label), value);
}

export function normalizeOptionalStringList(value: unknown, label: string): string[] {
  return parseValue(optionalStringListSchema(label), value);
}

export function normalizeTimestamp(value: unknown, label: string): string | undefined {
  return parseValue(optionalTimestampSchema(label), value);
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
