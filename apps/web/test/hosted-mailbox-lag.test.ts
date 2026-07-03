import {
  describe,
  expect,
  it,
} from "vitest";

import {
  computeHostedMailboxLaneLag,
} from "@/src/lib/hosted-mailbox/lag";

describe("hosted mailbox lag", () => {
  it("does not treat diagnostic import log keys as checkpoint progress", () => {
    expect(computeHostedMailboxLaneLag({
      highWater: {
        lane: "conversation",
        maxSeq: "12",
      },
      redactedStatusJson: {
        conversationSeqEnd: "12",
      },
    })).toEqual({
      importedSeq: "0",
      lag: "12",
      lane: "conversation",
      maxSeq: "12",
    });
  });

  it("nets consumed sequence into work-owed lag without rewriting importedSeq", () => {
    expect(computeHostedMailboxLaneLag({
      consumedSeq: "10",
      highWater: {
        lane: "conversation",
        maxSeq: "12",
      },
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "4",
      },
    })).toEqual({
      importedSeq: "4",
      lag: "2",
      lane: "conversation",
      maxSeq: "12",
    });
  });
});
