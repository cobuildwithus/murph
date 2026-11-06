import { beforeEach, describe, expect, it, vi } from "vitest";

const ACTION_ID = "2f1c1fdc-c7b0-4d90-b902-8e6295959243";
const preparedCrypto = {
  domain: "ingress",
  rootKeyId: "root-member-action",
  userId: "member-1",
};

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  current: vi.fn(),
  authority: vi.fn(),
  appendHostedMailboxEnvelopeWithPreparedCryptoTx: vi.fn(),
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  events: [] as string[],
  lockHostedMemberRow: vi.fn(),
  lockHostedMemberSponsoredAccessRows: vi.fn(),
  runWithPreparedHostedMailboxItemAppendCrypto: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("../src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeWithPreparedCryptoTx:
    mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
  readHostedMailboxWakeByDedupeKey: vi.fn(),
  runWithPreparedHostedMailboxItemAppendCrypto:
    mocks.runWithPreparedHostedMailboxItemAppendCrypto,
}));
vi.mock("../src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: mocks.assertActiveHostedMemberAccessAllowed,
}));
vi.mock("../src/lib/legal/consent", () => ({
  assertHostedHistoricalLaunchConsentGranted:
    mocks.assertHostedHistoricalLaunchConsentGranted,
}));
vi.mock("../src/lib/hosted-onboarding/shared", () => ({
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: {
    maxWait: 5_000,
    timeout: 10_000,
  },
  lockHostedMemberRow: mocks.lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows:
    mocks.lockHostedMemberSponsoredAccessRows,
}));
vi.mock("../src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("../src/lib/prisma", () => ({ getPrisma: () => prisma }));
vi.mock("../src/lib/hosted-onboarding/request-auth", () => ({ requireActiveHostedMemberAuthFromBearerToken: mocks.auth }));
vi.mock("../src/lib/better-auth/native-auth", () => ({ assertHostedNativeMemberAuthCurrentTx: mocks.current }));
vi.mock("../src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
import { POST } from "../app/api/device-sync/companion/measurements/route";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

import { recordMemberActionOutcome } from "../src/lib/member-actions/outcome";
import { submitMemberAction } from "../src/lib/member-actions/submit";

const transactionClient = { marker: "transaction" };
const prisma = {
  $transaction: vi.fn(async (
    run: (tx: typeof transactionClient) => Promise<unknown>,
  ) => {
    mocks.events.push("transaction-start");
    const result = await run(transactionClient);
    mocks.events.push("transaction-commit");
    return result;
  }),
};

describe("member-action mailbox crypto boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.runWithPreparedHostedMailboxItemAppendCrypto.mockImplementation(
      async (input: {
        append: (prepared: typeof preparedCrypto) => Promise<unknown>;
      }) => {
        mocks.events.push("crypto-prepared");
        return input.append(preparedCrypto);
      },
    );
    mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx.mockImplementation(
      async () => {
        mocks.events.push("mailbox-appended");
        return {
          dedupeConflict: false,
          duplicate: false,
          inserted: true,
          item: {
            id: "mailbox-member-action",
            lane: "system",
            laneSeq: 7n,
          },
        };
      },
    );
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member-1",
    });
  });

  it.each(["session", "consent"])("rechecks companion %s after initial read and before the locked append", async authority => {
    let revoked = false;
    mocks.auth.mockResolvedValue({ member: { id: "member-1" } });
    const deny = () => { throw hostedOnboardingError({ code: "AUTH_REVOKED", httpStatus: 403, message: "Access changed." }); };
    mocks.current.mockImplementation(async () => {
      mocks.events.push("session-current");
      if (revoked && authority === "session") deny();
    });
    mocks.authority.mockImplementation(async () => {
      mocks.events.push("browser-authority");
      if (revoked && authority === "consent") deny();
    });
    mocks.runWithPreparedHostedMailboxItemAppendCrypto.mockImplementationOnce(async input => {
      revoked = true;
      return input.append(preparedCrypto);
    });
    mocks.lockHostedMemberRow.mockImplementationOnce(async () => { mocks.events.push("member-locked"); });
    mocks.lockHostedMemberSponsoredAccessRows.mockImplementationOnce(async () => { mocks.events.push("access-locked"); });
    const response = await POST(new Request("https://app.example.test/api/device-sync/companion/measurements", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId: ACTION_ID, requestedAt: "2026-11-01T12:00:00Z", metric: "estimated-vo2-max", value: 42.5 }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.events).toEqual([
      "browser-authority", "transaction-start", "member-locked", "access-locked", "session-current",
      ...authority === "consent" ? ["browser-authority"] : [],
    ]);
    expect(mocks.current).toHaveBeenCalledWith({ member: { id: "member-1" } }, transactionClient);
    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    mocks.current.mockReset();
    mocks.authority.mockReset();
  });

  it("keeps durable acceptance when post-commit signaling fails", async () => {
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(new Error("synthetic signal failure"));
    const current = vi.fn(async () => { mocks.events.push("session-current"); });
    await expect(submitMemberAction({
      memberId: "member-1", prisma: prisma as never, assertCurrentAuthorityTx: current,
      request: { schemaVersion: 1, actionId: ACTION_ID, requestedAt: "2026-11-01T12:00:00Z", action: { kind: "meal.delete", version: 1, mealId: "meal_fixture" } },
    })).resolves.toMatchObject({ accepted: true });
    expect(current).toHaveBeenCalledWith(transactionClient);
    expect(mocks.events.indexOf("session-current")).toBeLessThan(mocks.events.indexOf("mailbox-appended"));
    expect(mocks.events).toContain("transaction-commit");
  });

  it("does not append after admission authority is revoked", async () => {
    await expect(submitMemberAction({
      memberId: "member-1", prisma: prisma as never,
      assertCurrentAuthorityTx: async () => { throw new Error("synthetic revoked session"); },
      request: { schemaVersion: 1, actionId: ACTION_ID, requestedAt: "2026-11-01T12:00:00Z", action: { kind: "meal.delete", version: 1, mealId: "meal_fixture" } },
    })).rejects.toThrow("revoked session");
    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("prepares request crypto before the access-fenced admission transaction", async () => {
    await expect(submitMemberAction({
      memberId: "member-1",
      prisma: prisma as never,
      request: {
        action: {
          expectedWorkout: {
            actionBinding: "a".repeat(64),
            exercises: [{ name: "Leg Press", sets: [{ logged: false }] }],
          },
          kind: "workout.live.apply",
          mutations: [{
            exerciseName: "Leg Press",
            exercisePosition: 1,
            expectedResult: null,
            kind: "set.put",
            result: {
              kind: "weight_reps",
              reps: 8,
              weight: 225,
              weightUnit: "lb",
            },
            setPosition: 1,
          }],
          version: 1,
        },
        actionId: ACTION_ID,
        requestedAt: "2026-08-12T15:00:00.000Z",
        schemaVersion: 1,
      },
    })).resolves.toMatchObject({ accepted: true });

    expect(mocks.runWithPreparedHostedMailboxItemAppendCrypto).toHaveBeenCalledWith({
      append: expect.any(Function),
      prisma,
      userId: "member-1",
    });
    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: `member.action.requested:${ACTION_ID}`,
        kind: "member.action.requested",
      }),
      prepared: preparedCrypto,
      tx: transactionClient,
    });
    expect(mocks.events).toEqual([
      "crypto-prepared",
      "transaction-start",
      "mailbox-appended",
      "transaction-commit",
    ]);
  });

  it("prepares terminal-outcome crypto before opening its mailbox transaction", async () => {
    await expect(recordMemberActionOutcome({
      memberId: "member-1",
      outcome: {
        actionId: ACTION_ID,
        completedAt: "2026-08-12T15:00:01.000Z",
        reason: null,
        schemaVersion: 1,
        status: "applied",
      },
      prisma: prisma as never,
    })).resolves.toMatchObject({ recorded: true });

    expect(mocks.runWithPreparedHostedMailboxItemAppendCrypto).toHaveBeenCalledWith({
      append: expect.any(Function),
      prisma,
      userId: "member-1",
    });
    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: `member.action.completed:${ACTION_ID}`,
        kind: "member.action.completed",
      }),
      prepared: preparedCrypto,
      tx: transactionClient,
    });
    expect(mocks.events).toEqual([
      "crypto-prepared",
      "transaction-start",
      "mailbox-appended",
      "transaction-commit",
    ]);
  });
});
