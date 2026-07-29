import { describe, expect, it } from "vitest";

import {
  buildHostedLinqGroupLineRecoveryEffectId,
  buildHostedLinqGroupLineRecoveryMessage,
  buildHostedLinqGroupLineRecoveryRecipientSourceRef,
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

  it("keys one recovery per member, failed line, and group thread", () => {
    const first = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: "+1 (555) 010-0000",
      memberId: "member-1",
      threadId: "chat-group-1",
    });
    const second = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: "+15550100000",
      memberId: "member-1",
      threadId: "chat-group-1",
    });
    const otherLine = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: "+15550100001",
      memberId: "member-1",
      threadId: "chat-group-1",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^linq-group-line-recovery:[0-9a-f]{32}$/u);
    expect(otherLine).not.toBe(first);
  });

  it("normalizes participant contacts for source refs", () => {
    expect(buildHostedLinqGroupLineRecoveryRecipientSourceRef({
      kind: "phone",
      value: "+1 (555) 123-4567",
    })).toBe(buildHostedLinqGroupLineRecoveryRecipientSourceRef({
      kind: "phone",
      value: "+15551234567",
    }));
    expect(buildHostedLinqGroupLineRecoveryRecipientSourceRef({
      kind: "email",
      value: "Member@Example.TEST",
    })).toBe(buildHostedLinqGroupLineRecoveryRecipientSourceRef({
      kind: "email",
      value: "member@example.test",
    }));
  });
});

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
