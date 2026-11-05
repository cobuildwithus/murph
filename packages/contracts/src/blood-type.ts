/**
 * Blood type (ABO group plus Rh factor) is a blood-test result. This module owns
 * its one canonical result identity and the parser shared by every reader and
 * writer, so a blood type saved under any common label reads back the same way.
 */

export const BLOOD_TYPE_RESULT_SLUG = "blood-type" as const;
export const BLOOD_TYPE_RESULT_ANALYTE = "Blood type (ABO/Rh)" as const;

export const BLOOD_TYPE_ABO_GROUPS = ["A", "B", "AB", "O"] as const;
export const BLOOD_TYPE_RH_FACTORS = ["positive", "negative"] as const;

export type BloodTypeAboGroup = (typeof BLOOD_TYPE_ABO_GROUPS)[number];
export type BloodTypeRhFactor = (typeof BLOOD_TYPE_RH_FACTORS)[number];

export interface BloodType {
  abo: BloodTypeAboGroup;
  rh: BloodTypeRhFactor;
  /** Compact form such as "AB+" or "O-". */
  value: string;
}

const BLOOD_TYPE_PATTERN =
  /^(?:(?:blood\s*(?:type|group)|abo(?:\s*(?:\/|and|&)?\s*rh)?(?:\s*(?:type|group))?)\s*[:=]?\s*)?(ab|a|b|o|0)\s*(?:\(\s*)?(?:rh\s*)?(\+|-|−|–|pos(?:itive)?|neg(?:ative)?)\s*\)?$/iu;

/**
 * Parses a written blood type such as "AB+", "ab pos", "O Negative", "O−" or
 * "Blood type: B positive". Returns null when the text is not a complete ABO
 * group with an Rh factor.
 */
export function parseBloodType(text: string): BloodType | null {
  const match = BLOOD_TYPE_PATTERN.exec(text.trim().replace(/\s+/gu, " "));
  if (!match) {
    return null;
  }

  const group = match[1]!.toUpperCase();
  const abo = (group === "0" ? "O" : group) as BloodTypeAboGroup;
  const rh: BloodTypeRhFactor = /^(?:\+|pos)/iu.test(match[2]!) ? "positive" : "negative";
  return { abo, rh, value: `${abo}${rh === "positive" ? "+" : "-"}` };
}

const BLOOD_TYPE_LABEL_PATTERN =
  /^(?:blood[\s_-]*(?:type|group)|abo(?:[\s_/&-]*(?:and[\s_-]*)?rh)?(?:[\s_-]*(?:type|group|typing))?)(?:[\s_-]*\(abo\/rh\))?$/iu;

/**
 * True for result labels that name a combined blood type, including the
 * canonical slug and common lab wording ("ABO Group", "ABO/Rh", "Blood type").
 */
export function isBloodTypeResultLabel(label: string): boolean {
  const trimmed = label.trim();
  return trimmed === BLOOD_TYPE_RESULT_SLUG || BLOOD_TYPE_LABEL_PATTERN.test(trimmed);
}

const ABO_GROUP_ONLY_PATTERN = /^(ab|a|b|o|0)$/iu;
const RH_FACTOR_ONLY_PATTERN = /^(?:rh\s*)?(\+|-|−|–|pos(?:itive)?|neg(?:ative)?)$/iu;
const ABO_GROUP_LABEL_PATTERN = /^abo(?:[\s_-]*(?:group|type|typing))?$/iu;
const RH_FACTOR_LABEL_PATTERN = /^rh(?:[\s_-]*\(?d\)?)?(?:[\s_-]*(?:type|factor|typing))?$/iu;

/**
 * Combines a lab panel's separate ABO group row ("ABO Group: AB") and Rh row
 * ("Rh Type: Positive") into one blood type. Returns null unless both rows are
 * present and complete.
 */
export function combineBloodTypeRows(
  rows: ReadonlyArray<{ label: string; text: string }>,
): BloodType | null {
  const group = rows.find((row) =>
    ABO_GROUP_LABEL_PATTERN.test(row.label.trim()) && ABO_GROUP_ONLY_PATTERN.test(row.text.trim())
  );
  const factor = rows.find((row) =>
    RH_FACTOR_LABEL_PATTERN.test(row.label.trim()) && RH_FACTOR_ONLY_PATTERN.test(row.text.trim())
  );
  return group && factor ? parseBloodType(`${group.text.trim()} ${factor.text.trim().replace(/^rh\s*/iu, "")}`) : null;
}
