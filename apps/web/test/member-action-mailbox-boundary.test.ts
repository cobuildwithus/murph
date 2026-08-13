import { beforeEach, describe, expect, it, vi } from "vitest";

const ACTION_ID = "2f1c1fdc-c7b0-4d90-b902-8e6295959243";
const preparedCrypto = {
  domain: "ingress",
  rootKeyId: "root-member-action",
  userId: "member-1",
};

const mocks = vi.hoisted(() => ({
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
            requiresExistingSet: true,
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
