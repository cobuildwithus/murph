import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  lookupHostedGroupParticipantMemberIdByHandle,
} from "@/src/lib/hosted-groups/participant-member";

const hostedMemberEmailAuthorization = {
  findMany: vi.fn(),
};
const hostedMemberIdentity = {
  findMany: vi.fn(),
};
const prisma = {
  hostedMemberEmailAuthorization,
  hostedMemberIdentity,
} as never;

describe("lookupHostedGroupParticipantMemberIdByHandle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostedMemberEmailAuthorization.findMany.mockResolvedValue([]);
    hostedMemberIdentity.findMany.mockResolvedValue([]);
  });

  it("projects a phone handle to only its unique member id", async () => {
    hostedMemberIdentity.findMany.mockResolvedValue([
      { memberId: "member_phone" },
    ]);

    await expect(lookupHostedGroupParticipantMemberIdByHandle({
      handle: "+15551112222",
      prisma,
    })).resolves.toBe("member_phone");

    expect(hostedMemberIdentity.findMany).toHaveBeenCalledWith({
      select: { memberId: true },
      where: { phoneLookupKey: { in: expect.any(Array) } },
    });
    expect(hostedMemberEmailAuthorization.findMany).not.toHaveBeenCalled();
  });

  it("requires a verified email binding", async () => {
    hostedMemberEmailAuthorization.findMany.mockResolvedValue([
      { memberId: "member_email" },
    ]);

    await expect(lookupHostedGroupParticipantMemberIdByHandle({
      handle: "person@example.com",
      prisma,
    })).resolves.toBe("member_email");

    expect(hostedMemberEmailAuthorization.findMany).toHaveBeenCalledWith({
      select: { memberId: true },
      where: {
        verifiedEmailLookupKey: { in: expect.any(Array) },
        verifiedEmailVerifiedAt: { not: null },
      },
    });
    expect(hostedMemberIdentity.findMany).not.toHaveBeenCalled();
  });

  it("fails closed when blind-index candidates match several members", async () => {
    hostedMemberIdentity.findMany.mockResolvedValue([
      { memberId: "member_a" },
      { memberId: "member_b" },
    ]);

    await expect(lookupHostedGroupParticipantMemberIdByHandle({
      handle: "+15551112222",
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS",
    });
  });
});
