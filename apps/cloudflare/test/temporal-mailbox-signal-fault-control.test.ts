import { afterEach, describe, expect, it } from "vitest";

import {
  armTemporalMailboxSignalFaultForTest,
  clearTemporalMailboxSignalFaultForTest,
  consumeTemporalMailboxSignalFaultForTest,
} from "../src/hosted-local-test/temporal-mailbox-signal-fault-control.ts";

const userId = "retell-fault-user";
const mailboxItemId = "mailbox-item-1";

afterEach(() => {
  clearTemporalMailboxSignalFaultForTest(userId);
  clearTemporalMailboxSignalFaultForTest("other-user");
});

describe("Temporal mailbox signal fault test control", () => {
  it("consumes an armed exact identity only once", async () => {
    expect(armTemporalMailboxSignalFaultForTest({
      mailboxItemId,
      userId,
    })).toEqual({
      armed: true,
      deliveredToPendingConsumer: false,
    });

    await expect(consumeTemporalMailboxSignalFaultForTest({
      mailboxItemId,
      userId,
    }, 0)).resolves.toBe(true);
    await expect(consumeTemporalMailboxSignalFaultForTest({
      mailboxItemId,
      userId,
    }, 0)).resolves.toBe(false);
  });

  it("does not let unrelated user or item probes consume the arm", async () => {
    armTemporalMailboxSignalFaultForTest({ mailboxItemId, userId });

    await expect(consumeTemporalMailboxSignalFaultForTest({
      mailboxItemId,
      userId: "other-user",
    }, 0)).resolves.toBe(false);
    await expect(consumeTemporalMailboxSignalFaultForTest({
      mailboxItemId: "other-item",
      userId,
    }, 0)).resolves.toBe(false);
    await expect(consumeTemporalMailboxSignalFaultForTest({
      mailboxItemId,
      userId,
    }, 0)).resolves.toBe(true);
  });

  it("delivers a late exact arm to one pending consumer", async () => {
    const exactConsumer = consumeTemporalMailboxSignalFaultForTest({
      mailboxItemId,
      userId,
    }, 1_000);
    const duplicateExactConsumer = consumeTemporalMailboxSignalFaultForTest({
      mailboxItemId,
      userId,
    }, 1_000);
    const unrelatedItemConsumer = consumeTemporalMailboxSignalFaultForTest({
      mailboxItemId: "other-item",
      userId,
    }, 1_000);

    expect(armTemporalMailboxSignalFaultForTest({
      mailboxItemId,
      userId,
    })).toEqual({
      armed: true,
      deliveredToPendingConsumer: true,
    });
    await expect(exactConsumer).resolves.toBe(true);
    await expect(duplicateExactConsumer).resolves.toBe(false);
    await expect(consumeTemporalMailboxSignalFaultForTest({
      mailboxItemId,
      userId,
    }, 0)).resolves.toBe(false);

    clearTemporalMailboxSignalFaultForTest(userId);
    await expect(unrelatedItemConsumer).resolves.toBe(false);
  });
});
