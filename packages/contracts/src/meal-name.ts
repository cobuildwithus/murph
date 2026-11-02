/** Shared authoring policy. Legacy records remain readable without rewriting. */
export const MEAL_NAME_GUIDANCE =
  "Use a sentence-case dish name, 2–5 words and at most 40 characters. No meal-type prefix, place/brand (unless part of the dish), uncertainty, or photo-review wording. Put portions, places, descriptions, and uncertainty in note.";

const LEFTOVER_PREFIX = /^(?:(?:breakfast|lunch|dinner|snack)\s*:|estimated\b|photo\s+(?:shows|of)\b|retained image\b|approximately\b|(?:about|roughly|likely|probably|possibly|maybe|uncertain|confidence)\b)/iu;
// Explicit venue syntax and title-cased multiword venue prefixes. Culinary
// proper adjectives alone (Greek salad, Chicken Kiev) are not venue evidence.
const PLACE_PREFIX = /^(?:.+?['’]s\s+|(?:[\p{Lu}][\p{L}'’.-]*\s+){2,}(?=[\p{Ll}])|.+?\s+(?:cafe|café|restaurant|kitchen|grill|deli|bakery)\s+)/u;

export type MealNameViolation = "empty" | "length" | "words" | "list" | "lowercase" | "prefix" | "place";

export function mealNameViolation(value: string): MealNameViolation | null {
  const name = value.trim();
  if (!name) return "empty";
  if (name.length > 40) return "length";
  const words = name.split(/\s+/u);
  if (words.length < 2 || words.length > 5) return "words";
  if (/[,;\n\r]/u.test(name) || name.split(/\s+(?:and|&)\s+/iu).length >= 3) return "list";
  if (/^\p{Ll}/u.test(name)) return "lowercase";
  if (LEFTOVER_PREFIX.test(name)) return "prefix";
  if (PLACE_PREFIX.test(name) && !/^(?:New York strip(?: steak)?|Boston cream pie|Kung Pao chicken|General Tso[’']s chicken)$/u.test(name)) return "place";
  return null;
}

/** Keep source wording, including portions/places, without duplicate appends. */
export function preserveMealNameDetails(name: string, note: string | null | undefined): string {
  const original = name.trim();
  const current = note?.trim() ?? "";
  const normalize = (value: string) => value.toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
  if (!original || normalize(current).includes(normalize(original))) return current;
  return current ? `${current}\n${original}` : original;
}
