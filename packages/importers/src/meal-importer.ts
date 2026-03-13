import { assertCanonicalWritePort } from "./core-port.js";
import type { MealImportPayload } from "./core-port.js";
import {
  assertPlainObject,
  inspectFileAsset,
  normalizeOptionalString,
  normalizeTimestamp,
  stripUndefined,
} from "./shared.js";

export interface MealImportInput {
  photoPath: string;
  audioPath?: string;
  vaultRoot?: string;
  vault?: string;
  occurredAt?: string | number | Date;
  note?: string;
  source?: string;
}

export interface ImporterExecutionOptions {
  corePort?: unknown;
}

export async function prepareMealImport(input: unknown): Promise<MealImportPayload> {
  const request = assertPlainObject(input, "meal import input");
  const photo = await inspectFileAsset(request.photoPath, "photo");

  if (!photo.sourcePath) {
    throw new TypeError("photoPath must point to a file");
  }

  const audio = request.audioPath
    ? await inspectFileAsset(request.audioPath, "audio")
    : undefined;

  return stripUndefined({
    vaultRoot: normalizeOptionalString(request.vaultRoot ?? request.vault, "vaultRoot"),
    photoPath: photo.sourcePath,
    audioPath: audio?.sourcePath,
    occurredAt: normalizeTimestamp(request.occurredAt, "occurredAt"),
    note: normalizeOptionalString(request.note, "note"),
    source: normalizeOptionalString(request.source, "source"),
  });
}

export async function importMeal<TResult = unknown>(
  input: unknown,
  { corePort }: ImporterExecutionOptions = {},
): Promise<TResult> {
  const writer = assertCanonicalWritePort(corePort, ["importMeal"]);
  const payload = await prepareMealImport(input);
  return (await writer.importMeal(payload)) as TResult;
}
