import { reject } from "./rules";

const WORDS_MAX = 200;
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
const ZWJ = "\u200D";

/** Manual game words: preserve emoji joiners, drop other controls, trim, 1-200 chars. */
export function normalizeGameText(value: unknown, field: string): string {
  if (typeof value !== "string") reject("INVALID_REQUEST", `${field} must be a string.`);
  if (value.length > WORDS_MAX * 2) reject("INVALID_REQUEST", `${field} is too long.`);
  const cleaned = value.replace(INVISIBLE, char => char === ZWJ ? char : "").trim();
  if (!cleaned.replaceAll(ZWJ, "").trim() || cleaned.length > WORDS_MAX) {
    reject("INVALID_REQUEST", `${field} must be 1 to ${WORDS_MAX} characters.`);
  }
  return cleaned;
}
