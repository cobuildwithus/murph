import { isGameTextRefused } from "../game/moderation";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

/** This structural bound also applies to historical sealed summaries. */
export function hasActivityNameLength(value: string): boolean {
  const length = [...value].length;
  return length >= 1 && length <= 32;
}

export function cleanActivityName(raw: string): string | null {
  if (/[\n\v\f\r\u0085\u2028\u2029]/u.test(raw)) return null;
  // Stripping controls can bring a letter and a combining mark together.
  const name = raw.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/gu, " ").trim().normalize("NFC");
  if (!hasActivityNameLength(name) || !/\p{L}/u.test(name) || /[^\p{L}\p{M}\p{N} '’&/.-]/u.test(name)) return null;
  return name;
}

export function admitActivityName(raw: string, source: "choice" | "recording"): string {
  const name = cleanActivityName(raw);
  if (name === null || (source === "recording" && raw !== name) || isGameTextRefused("task", name)) {
    throw hostedOnboardingError({
      code: "HEALTH_ACTIVITY_NAME_INVALID", httpStatus: 400, message: "This can't be used as an activity name.",
    });
  }
  return name;
}

export function activityNameWord(name: string): string {
  const [first = "", ...rest] = name;
  const suffix = rest.join("");
  return /\p{Uppercase}/u.test(suffix) ? name : first.toLowerCase() + suffix;
}

export function activityNameTitle(name: string): string {
  const [first = "", ...rest] = name;
  return first.toUpperCase() + rest.join("");
}
