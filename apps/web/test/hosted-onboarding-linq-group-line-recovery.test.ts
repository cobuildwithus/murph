import { describe, expect, it } from "vitest";

import {
  buildHostedLinqGroupLineRecoveryAttemptEffectId,
  buildHostedLinqGroupLineRecoveryEffectId,
  buildHostedLinqGroupLineRecoveryMessage,
  buildHostedLinqGroupLineRecoverySourceRef,
  HOSTED_LINQ_GROUP_LINE_RECOVERY_VARIANT_COUNT,
  isHostedLinqGroupLineRecoverySourceRefForSameIntent,
  parseHostedLinqGroupLineRecoverySourceRef,
  readHostedLinqGroupLineRecoveryInstructionSeed,
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

  it("keys recovery by member, failed line, group thread, and optional setup", () => {
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
    const preparedSetup = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: "+15550100000",
      memberId: "member-1",
      pendingGroupSetupId: "hpgs-1",
      threadId: "chat-group-1",
    });
    const replacementSetup = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: "+15550100000",
      memberId: "member-1",
      pendingGroupSetupId: "hpgs-2",
      threadId: "chat-group-1",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^linq-group-line-recovery:[0-9a-f]{32}$/u);
    expect(otherLine).not.toBe(first);
    expect(preparedSetup).not.toBe(first);
    expect(replacementSetup).not.toBe(preparedSetup);
  });

  it("keys source refs by recovery intent and exact source event", () => {
    const effectId = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: "+15550100000",
      memberId: "member-1",
      threadId: "chat-group-1",
    });
    const first = buildHostedLinqGroupLineRecoverySourceRef({
      effectId,
      sourceEventId: "event-1",
    });
    const replay = buildHostedLinqGroupLineRecoverySourceRef({
      effectId,
      sourceEventId: "event-1",
    });
    const retry = buildHostedLinqGroupLineRecoverySourceRef({
      effectId,
      sourceEventId: "event-2",
    });

    expect(first).toBe(replay);
    expect(first).not.toBe(retry);
    expect(first).toMatch(
      /^linq-group-line-recovery-source:[0-9a-f]{32}:[0-9a-f]{32}$/u,
    );
  });

  it("keeps attempts bounded while source refs distinguish exact events", () => {
    const effectId = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: "+15550100000",
      memberId: "member-1",
      threadId: "chat-group-1",
    });
    const firstAttempt = buildHostedLinqGroupLineRecoveryAttemptEffectId({
      attempt: 1,
      effectId,
    });
    const secondAttempt = buildHostedLinqGroupLineRecoveryAttemptEffectId({
      attempt: 2,
      effectId,
    });
    const firstSource = buildHostedLinqGroupLineRecoverySourceRef({
      effectId,
      sourceEventId: "event-1",
    });
    const secondSource = buildHostedLinqGroupLineRecoverySourceRef({
      effectId,
      sourceEventId: "event-2",
    });

    expect(firstAttempt).toBe(effectId);
    expect(secondAttempt).toBe(`${effectId}:attempt:2`);
    expect(readHostedLinqGroupLineRecoveryInstructionSeed(firstAttempt))
      .toBe(effectId);
    expect(readHostedLinqGroupLineRecoveryInstructionSeed(secondAttempt))
      .toBe(effectId);
    expect(firstSource).not.toBe(secondSource);
    expect(parseHostedLinqGroupLineRecoverySourceRef(firstSource)).toMatchObject({
      intentDigest: expect.stringMatching(/^[0-9a-f]{32}$/u),
      sourceEventDigest: expect.stringMatching(/^[0-9a-f]{32}$/u),
    });
    expect(isHostedLinqGroupLineRecoverySourceRefForSameIntent({
      candidate: firstSource,
      expected: secondSource,
    })).toBe(true);
  });
});

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
