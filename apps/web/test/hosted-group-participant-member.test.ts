import { Buffer } from "node:buffer";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  lookupHostedGroupParticipantMemberIdByHandle,
  lookupHostedGroupParticipantMemberIdsByHandles,
} from "@/src/lib/hosted-groups/participant-member";
import {
  createHostedLinqParticipantContactLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";

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

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lookupHostedGroupParticipantMemberIdsByHandles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostedMemberEmailAuthorization.findMany.mockResolvedValue([]);
    hostedMemberIdentity.findMany.mockResolvedValue([]);
  });

  it("projects a phone handle to only its unique member id", async () => {
    const [phoneLookupKey] = createHostedLinqParticipantContactLookupKeyReadCandidates({
      kind: "phone",
      value: "+15551112222",
    });
    hostedMemberIdentity.findMany.mockResolvedValue([
      { memberId: "member_phone", phoneLookupKey },
    ]);

    await expect(lookupHostedGroupParticipantMemberIdByHandle({
      handle: "+15551112222",
      prisma,
    })).resolves.toBe("member_phone");

    expect(hostedMemberIdentity.findMany).toHaveBeenCalledWith({
      select: {
        memberId: true,
        phoneLookupKey: true,
      },
      where: { phoneLookupKey: { in: expect.any(Array) } },
    });
    expect(hostedMemberEmailAuthorization.findMany).not.toHaveBeenCalled();
  });

  it("requires a verified email binding", async () => {
    const [verifiedEmailLookupKey] =
      createHostedLinqParticipantContactLookupKeyReadCandidates({
        kind: "email",
        value: "person@example.com",
      });
    hostedMemberEmailAuthorization.findMany.mockResolvedValue([
      { memberId: "member_email", verifiedEmailLookupKey },
    ]);

    await expect(lookupHostedGroupParticipantMemberIdByHandle({
      handle: "person@example.com",
      prisma,
    })).resolves.toBe("member_email");

    expect(hostedMemberEmailAuthorization.findMany).toHaveBeenCalledWith({
      select: {
        memberId: true,
        verifiedEmailLookupKey: true,
      },
      where: {
        verifiedEmailLookupKey: { in: expect.any(Array) },
        verifiedEmailVerifiedAt: { not: null },
      },
    });
    expect(hostedMemberIdentity.findMany).not.toHaveBeenCalled();
  });

  it("maps a maximum mixed roster with one narrow query per handle kind", async () => {
    const phoneHandles = Array.from(
      { length: 16 },
      (_, index) => `+1555111${index.toString().padStart(4, "0")}`,
    );
    const emailHandles = Array.from(
      { length: 16 },
      (_, index) => `person-${index}@example.com`,
    );
    const phoneRecords = phoneHandles.map((handle, index) => ({
      memberId: `member_phone_${index}`,
      phoneLookupKey:
        createHostedLinqParticipantContactLookupKeyReadCandidates({
          kind: "phone",
          value: handle,
        })[0],
    }));
    const emailRecords = emailHandles.map((handle, index) => ({
      memberId: `member_email_${index}`,
      verifiedEmailLookupKey:
        createHostedLinqParticipantContactLookupKeyReadCandidates({
          kind: "email",
          value: handle,
        })[0],
    }));
    const phoneRead = createDeferred<typeof phoneRecords>();
    const emailRead = createDeferred<typeof emailRecords>();
    let activeReads = 0;
    let peakReads = 0;
    const trackRead = async <T>(deferred: Deferred<T>): Promise<T> => {
      activeReads += 1;
      peakReads = Math.max(peakReads, activeReads);
      try {
        return await deferred.promise;
      } finally {
        activeReads -= 1;
      }
    };
    hostedMemberIdentity.findMany.mockImplementationOnce(
      () => trackRead(phoneRead),
    );
    hostedMemberEmailAuthorization.findMany.mockImplementationOnce(
      () => trackRead(emailRead),
    );

    const lookup = lookupHostedGroupParticipantMemberIdsByHandles({
      handles: [...phoneHandles, ...emailHandles],
      prisma,
    });

    expect(activeReads).toBe(2);
    expect(peakReads).toBe(2);
    phoneRead.resolve(phoneRecords);
    emailRead.resolve(emailRecords);
    const memberIdsByHandle = await lookup;
    expect(activeReads).toBe(0);
    expect(peakReads).toBe(2);

    expect(hostedMemberIdentity.findMany).toHaveBeenCalledTimes(1);
    expect(hostedMemberEmailAuthorization.findMany).toHaveBeenCalledTimes(1);
    expect(hostedMemberIdentity.findMany).toHaveBeenCalledWith({
      select: {
        memberId: true,
        phoneLookupKey: true,
      },
      where: {
        phoneLookupKey: {
          in: expect.arrayContaining(phoneRecords.map((record) => record.phoneLookupKey)),
        },
      },
    });
    expect(hostedMemberEmailAuthorization.findMany).toHaveBeenCalledWith({
      select: {
        memberId: true,
        verifiedEmailLookupKey: true,
      },
      where: {
        verifiedEmailLookupKey: {
          in: expect.arrayContaining(
            emailRecords.map((record) => record.verifiedEmailLookupKey),
          ),
        },
        verifiedEmailVerifiedAt: { not: null },
      },
    });
    expect(JSON.stringify(hostedMemberIdentity.findMany.mock.calls)).not.toContain(
      "phoneNumberEncrypted",
    );
    expect(JSON.stringify(hostedMemberEmailAuthorization.findMany.mock.calls)).not.toContain(
      "verifiedEmailAddressEncrypted",
    );
    for (const [index, handle] of phoneHandles.entries()) {
      expect(memberIdsByHandle.get(handle)).toBe(`member_phone_${index}`);
    }
    for (const [index, handle] of emailHandles.entries()) {
      expect(memberIdsByHandle.get(handle)).toBe(`member_email_${index}`);
    }
  });

  it("preserves phone ambiguity across privacy-key read versions", async () => {
    vi.stubEnv(
      "HOSTED_CONTACT_PRIVACY_KEYS",
      `v1:${Buffer.alloc(32, 1).toString("base64")},v2:${Buffer.alloc(32, 2).toString("base64")}`,
    );
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
    const lookupKeys = createHostedLinqParticipantContactLookupKeyReadCandidates({
      kind: "phone",
      value: "+15551112222",
    });
    expect(lookupKeys).toHaveLength(2);
    hostedMemberIdentity.findMany.mockResolvedValue([
      { memberId: "member_current", phoneLookupKey: lookupKeys[0] },
      { memberId: "member_legacy", phoneLookupKey: lookupKeys[1] },
    ]);

    await expect(lookupHostedGroupParticipantMemberIdsByHandles({
      handles: ["+15551112222", "person@example.com"],
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: 2,
        matchedBy: "phoneNumber",
      },
    });

    expect(hostedMemberIdentity.findMany).toHaveBeenCalledTimes(1);
    expect(hostedMemberEmailAuthorization.findMany).toHaveBeenCalledTimes(1);
  });

  it("preserves verified-email ambiguity across privacy-key read versions", async () => {
    vi.stubEnv(
      "HOSTED_CONTACT_PRIVACY_KEYS",
      `v1:${Buffer.alloc(32, 1).toString("base64")},v2:${Buffer.alloc(32, 2).toString("base64")}`,
    );
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
    const lookupKeys = createHostedLinqParticipantContactLookupKeyReadCandidates({
      kind: "email",
      value: "person@example.com",
    });
    expect(lookupKeys).toHaveLength(2);
    hostedMemberEmailAuthorization.findMany.mockResolvedValue([
      { memberId: "member_current", verifiedEmailLookupKey: lookupKeys[0] },
      { memberId: "member_legacy", verifiedEmailLookupKey: lookupKeys[1] },
    ]);

    await expect(lookupHostedGroupParticipantMemberIdsByHandles({
      handles: ["person@example.com", "+15551112222"],
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_VERIFIED_EMAIL_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: 2,
        matchedBy: "verifiedEmail",
      },
    });

    expect(hostedMemberIdentity.findMany).toHaveBeenCalledTimes(1);
    expect(hostedMemberEmailAuthorization.findMany).toHaveBeenCalledTimes(1);
  });
});
