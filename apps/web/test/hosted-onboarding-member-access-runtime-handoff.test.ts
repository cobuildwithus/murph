import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

import {
  appendHostedAccessRestorationRuntimeHandoffTx,
  buildHostedAccessRestorationRuntimeEventId,
} from "@/src/lib/hosted-onboarding/member-access-runtime-handoff";

describe("access-restoration runtime handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: {
        dedupeKey: "runtime-control:access-restored:mailbox-event",
        id: "mailbox_access_restored",
        userId: "member_123",
      },
    });
  });

  it("commits a deterministic maintenance item through the owning transaction", async () => {
    const tx = {} as never;
    const source = {
      memberId: "member_123",
      sourceEventId: "family-invite:invite_123",
      sourceType: "hosted.family.sponsorship",
    };

    await expect(appendHostedAccessRestorationRuntimeHandoffTx({
      ...source,
      tx,
    })).resolves.toEqual({
      hostedExecutionEventId: "runtime-control:access-restored:mailbox-event",
      hostedExecutionMailboxItemId: "mailbox_access_restored",
      memberId: "member_123",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: {
        eventId: buildHostedAccessRestorationRuntimeEventId(source),
        kind: "runtime.maintenance-requested",
        occurredAt: "1970-01-01T00:00:00.000Z",
        userId: "member_123",
      },
      tx,
    });
    expect(buildHostedAccessRestorationRuntimeEventId(source)).toMatch(
      /^runtime-control:access-restored:[a-f0-9]{32}$/u,
    );
    expect(buildHostedAccessRestorationRuntimeEventId(source)).not.toBe(
      buildHostedAccessRestorationRuntimeEventId({
        ...source,
        sourceEventId: "family-invite:invite_456",
      }),
    );
  });
});
