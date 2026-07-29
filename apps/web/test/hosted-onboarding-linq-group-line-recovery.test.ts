import { describe, expect, it } from "vitest";

import {
  buildHostedLinqGroupLineRecoveryMessage,
  HOSTED_LINQ_GROUP_LINE_RECOVERY_VARIANT_COUNT,
  readHostedLinqGroupLineRecoveryVariantTemplates,
} from "../src/lib/hosted-onboarding/linq-group-line-recovery";

const BACKUP_NUMBER_PLACEHOLDER = "{backupNumber}";
const BACKUP_PHONE = ["+", "1555", "010", "0042"].join("");

describe("Hosted Linq group line recovery copy", () => {
  it("keeps exactly 50 reviewed variants with the same action contract", () => {
    const variants = readHostedLinqGroupLineRecoveryVariantTemplates();

    expect(HOSTED_LINQ_GROUP_LINE_RECOVERY_VARIANT_COUNT).toBe(50);
    expect(variants).toHaveLength(50);
    expect(new Set(variants).size).toBe(50);
    for (const variant of variants) {
      expect(countOccurrences(variant, BACKUP_NUMBER_PLACEHOLDER)).toBe(1);
      expect(variant).toMatch(/\b(?:existing|same) group chat\b/u);
      expect(variant).toMatch(/\b(?:intro|introduction)\b/u);
      expect(variant).not.toMatch(/\b(?:https?:\/\/|www\.)/iu);
    }
  });

  it("renders the selected backup number once", () => {
    const message = buildHostedLinqGroupLineRecoveryMessage({
      backupPhoneNumber: BACKUP_PHONE,
      seed: "linq-group-line-recovery:test-seed",
    });

    expect(message).not.toContain(BACKUP_NUMBER_PLACEHOLDER);
    expect(countOccurrences(message, BACKUP_PHONE)).toBe(1);
    expect(message).toMatch(/\b(?:existing|same) group chat\b/u);
  });
});

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
