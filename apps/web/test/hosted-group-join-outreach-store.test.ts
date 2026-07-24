import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enqueueHostedGroupJoinOutreachTx } from "@/src/lib/hosted-groups/group-join-outreach-store";

const TEST_CONTACT_PRIVACY_KEY =
  "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";

let restoreEnvironment: (() => void) | null = null;

describe("hosted group join outreach store", () => {
  beforeEach(() => {
    restoreEnvironment = configureContactPrivacyKeyring();
  });

  afterEach(() => {
    restoreEnvironment?.();
    restoreEnvironment = null;
  });

  it("collapses duplicate reactions onto the offer-participant durable row", async () => {
    type OutreachRow = {
      groupId: string;
      id: string;
      nextAttemptAt: Date;
      offerId: string;
      participantPhoneEncrypted: string;
      participantPhoneLookupKey: string;
      requestedAt: Date;
    };
    let row: OutreachRow | null = null;
    const createMany = vi.fn(async (input: {
      data: OutreachRow[];
      skipDuplicates: boolean;
    }) => {
      if (row) {
        return { count: 0 };
      }
      row = input.data[0] ?? null;
      return { count: row ? 1 : 0 };
    });
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      hostedGroupJoinOutreach: {
        createMany,
        findFirst: vi.fn(async () => row ? { id: row.id } : null),
      },
    };
    const requestedAt = new Date("2026-07-24T16:00:00.000Z");

    const first = await enqueueHostedGroupJoinOutreachTx({
      groupId: "hgrp_opaque",
      offerId: "hgrpjo_opaque",
      participantPhoneNumber: "+15551234567",
      requestedAt,
      tx: tx as never,
    });
    const second = await enqueueHostedGroupJoinOutreachTx({
      groupId: "hgrp_opaque",
      offerId: "hgrpjo_opaque",
      participantPhoneNumber: "+15551234567",
      requestedAt: new Date("2026-07-24T16:01:00.000Z"),
      tx: tx as never,
    });

    expect(first).toEqual({
      kind: "enqueued",
      outreachId: expect.stringMatching(/^hgrpjoa_/u),
    });
    expect(second).toEqual({
      kind: "already_recorded",
      outreachId: first.outreachId,
    });
    expect(createMany).toHaveBeenCalledTimes(1);
    const created = createMany.mock.calls[0]?.[0] as {
      data: OutreachRow[];
    } | undefined;
    expect(created?.data[0]?.participantPhoneEncrypted)
      .not.toContain("+15551234567");
  });
});

function configureContactPrivacyKeyring(): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousVersion =
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  process.env.HOSTED_CONTACT_PRIVACY_KEYS =
    `v1:${TEST_CONTACT_PRIVACY_KEY}`;
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnv("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnv(
      "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
      previousVersion,
    );
    clearHostedOnboardingEnvCache();
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
