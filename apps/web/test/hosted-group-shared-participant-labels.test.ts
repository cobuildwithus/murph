import type { PrismaClient } from "@prisma/client";
import type { HostedRuntimeGroupSharedMember } from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(), contacts: vi.fn(), phones: vi.fn(),
}));
vi.mock("@/src/lib/hosted-address-book/projection", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-address-book/projection")>(),
  isHostedAddressBookAdvisoryEnabled: mocks.enabled,
  readHostedOwnerAddressBookAdvisoryNames: mocks.contacts,
}));
vi.mock("@/src/lib/hosted-onboarding/member-private-codecs", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-onboarding/member-private-codecs")>(),
  readHostedMemberIdentityPhoneNumberBatch: mocks.phones,
}));
import { labelHostedGroupSharedMembers } from "@/src/lib/hosted-groups/shared-participant-labels";
import { createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { parseHostedRuntimeGroupToolResponse } from "@murphai/hosted-execution/parsers";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";

const phone = "+12125550123";
function member(id: string, displayName: string | null = null): HostedRuntimeGroupSharedMember {
  return { memberId: `member_${id}`, participantId: `participant_${id}`, displayName,
    currentTurnHandles: [], projections: [{
      projectionScope: { projectionKind: "steps-days.v0" }, projectionScopeKey: "steps-days.v0",
      grantStatus: "granted", dataStatus: "available",
      records: [{ recordKey: "2026-09-20", occurredAt: "2026-09-20T00:00:00.000Z",
        data: { date: "2026-09-20", metricKey: "steps", value: 1234, unit: "count" } }],
    }] };
}
function setup(rows = [member("a")]) {
  const findMany = vi.fn().mockResolvedValue([{ id: "participant_a", memberId: "member_a",
    member: { identity: { phoneLookupKey: createHostedPhoneLookupKey(phone),
      phoneNumberEncrypted: "synthetic-phone-ciphertext", phoneNumberVerifiedAt: new Date() } } }]);
  // This test implements the only Prisma method consumed by the overlay.
  const client: object = { hostedGroupMember: { findMany } };
  const prisma = client as PrismaClient;
  return { findMany, input: { members: rows, prisma, runtimeMemberId: "runtime_example" } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(false);
  mocks.contacts.mockResolvedValue({ names: new Map([[phone, "Cedar"]]) });
  mocks.phones.mockResolvedValue([phone]);
});

describe("host-supplied shared participant labels", () => {
  it("decrypts a phone batch with each member's original field binding", async () => {
    const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/member-private-codecs")>(
      "@/src/lib/hosted-onboarding/member-private-codecs",
    );
    const decrypt = vi.fn((entry: { userId: string }) => entry.userId === "member_a" ? phone : "+12125550456");
    const encrypt = vi.fn(() => { throw new Error("This read must not encrypt."); });
    setHostedSecureBoxStringTestCodecForTests({ decrypt, encrypt });
    try {
      expect(await actual.readHostedMemberIdentityPhoneNumberBatch([
        { memberId: "member_a", phoneNumberEncrypted: "synthetic-a" },
        { memberId: "member_b", phoneNumberEncrypted: "synthetic-b" },
      ])).toEqual([phone, "+12125550456"]);
      expect(decrypt).toHaveBeenCalledTimes(2);
      for (const [index, id] of ["member_a", "member_b"].entries()) {
        expect(decrypt).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
          userId: id, scope: "hosted-member-private-field:hosted-member-identity.phone-number",
          aad: expect.objectContaining({ rowId: id, field: "hosted-member-identity.phone-number" }),
        }));
      }
      expect(encrypt).not.toHaveBeenCalled();
    } finally {
      setHostedSecureBoxStringTestCodecForTests(null);
    }
  });

  it("keeps missing-name labels stable across order, subsets, new members and inbound handles", async () => {
    const { input, findMany } = setup([member("a"), member("b")]);
    const original = await labelHostedGroupSharedMembers(input);
    const reordered = await labelHostedGroupSharedMembers({ ...input,
      members: [member("c"), { ...member("b"), currentTurnHandles: [phone] }, member("a")] });
    const targeted = await labelHostedGroupSharedMembers({ ...input, members: [member("b")] });
    // These public synthetic vectors keep labels stable across releases, not
    // merely across two calls to whatever implementation happens to be current.
    expect(original.map(({ displayName }) => displayName)).toEqual([
      "Participant FE225EF08E25", "Participant DBAB49ABE0CD",
    ]);
    expect(original[1]?.displayName).not.toBe(original[0]?.displayName);
    expect(reordered[1]?.displayName).toBe(original[1]?.displayName);
    expect(reordered[2]?.displayName).toBe(original[0]?.displayName);
    expect(targeted[0]?.displayName).toBe(original[1]?.displayName);
    expect(original.map(({ projections }) => projections)).toEqual(input.members.map(({ projections }) => projections));
    expect(JSON.stringify(original)).not.toContain(phone);
    expect(findMany).not.toHaveBeenCalled();
    const otherGroup = await labelHostedGroupSharedMembers({ ...input, runtimeMemberId: "runtime_other" });
    expect(otherGroup[0]?.displayName).not.toBe(original[0]?.displayName);
  });

  it("disambiguates case-equivalent names and labels imitating a generated label", async () => {
    const { input } = setup([member("a", "River"), member("b", "river")]);
    const result = await labelHostedGroupSharedMembers(input);
    expect(result[0]?.displayName).toMatch(/^River \([A-F0-9]{12}\)$/u);
    expect(result[1]?.displayName).toMatch(/^river \([A-F0-9]{12}\)$/u);
    const fallback = await labelHostedGroupSharedMembers({ ...input, members: [member("a")] });
    const imitated = await labelHostedGroupSharedMembers({ ...input,
      members: [member("a"), member("b", fallback[0]!.displayName)] });
    expect(new Set(imitated.map(({ displayName }) => displayName)).size).toBe(2);
    const cascading = await labelHostedGroupSharedMembers({ ...input, members: [
      member("a", "River"), member("b", "river"),
      member("c", result[0]!.displayName), member("d", fallback[0]!.displayName),
    ] });
    expect(new Set(cascading.map(({ displayName }) => displayName)).size).toBe(4);
    expect(cascading.every(({ projections }) => projections[0]?.dataStatus === "available")).toBe(true);
    expect(() => parseHostedRuntimeGroupToolResponse({ action: "read_shared",
      result: { status: "ok", requestedProjectionScopeKeys: ["steps-days.v0"], members: result } })).not.toThrow();
  });

  it("uses the authorized owner contact only for a reportable member without a profile", async () => {
    mocks.enabled.mockReturnValue(true);
    const { input, findMany } = setup([member("a"), member("b", "Rowan")]);
    const result = await labelHostedGroupSharedMembers(input);
    expect(result[0]?.displayName).toBe("Cedar (unverified owner contact)");
    expect(result[1]?.displayName).toBe("Rowan");
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["participant_a"] },
        group: { runtimeMemberId: "runtime_example" }, joinedAt: { not: null },
        member: { AND: expect.arrayContaining([{ suspendedAt: null }]) } }),
      take: 16,
    }));
    expect(mocks.phones).toHaveBeenCalledOnce();
    expect(mocks.contacts).toHaveBeenCalledWith({ containerMemberId: "runtime_example",
      phoneHandles: [phone], prisma: input.prisma });
    expect(JSON.stringify(result)).not.toContain(phone);
    expect(JSON.stringify(result)).not.toContain("synthetic-phone-ciphertext");
  });

  it("does no contact work for named or non-reportable members", async () => {
    mocks.enabled.mockReturnValue(true);
    const { input, findMany } = setup([member("a", "Rowan"),
      { ...member("b"), projections: [] }]);
    await labelHostedGroupSharedMembers(input);
    expect(findMany).not.toHaveBeenCalled();
    expect(mocks.phones).not.toHaveBeenCalled();
  });

  it.each(["revoked-or-unsafe", "crypto-failure", "contact-failure", "wrong-phone", "unverified", "left-group", "changed-membership"])(
    "retains data and a stable label after %s", async (failure) => {
      mocks.enabled.mockReturnValue(true);
      const { input, findMany } = setup();
      if (failure === "revoked-or-unsafe") mocks.contacts.mockResolvedValue({ names: new Map() });
      if (failure === "crypto-failure") mocks.phones.mockRejectedValue(new Error("Synthetic crypto failure"));
      if (failure === "contact-failure") mocks.contacts.mockRejectedValue(new Error("Synthetic contact failure"));
      if (failure === "wrong-phone") mocks.phones.mockResolvedValue(["+12125550456"]);
      if (failure === "unverified") findMany.mockResolvedValue([{ id: "participant_a", memberId: "member_a",
        member: { identity: { phoneLookupKey: createHostedPhoneLookupKey(phone),
          phoneNumberEncrypted: "synthetic-phone-ciphertext", phoneNumberVerifiedAt: null } } }]);
      if (failure === "left-group") findMany.mockResolvedValue([]);
      if (failure === "changed-membership") findMany.mockResolvedValue([{ id: "participant_a", memberId: "member_other",
        member: { identity: { phoneLookupKey: createHostedPhoneLookupKey(phone),
          phoneNumberEncrypted: "synthetic-phone-ciphertext", phoneNumberVerifiedAt: new Date() } } }]);
      const result = await labelHostedGroupSharedMembers(input);
      expect(result[0]?.displayName).toMatch(/^Participant [A-F0-9]{12}$/u);
      expect(result[0]?.projections).toEqual(input.members[0]?.projections);
      expect(result[0]?.currentTurnHandles).toEqual([]);
    });

  it("preserves a maximum roster while bounding optional contact work", async () => {
    mocks.enabled.mockReturnValue(true);
    const rows = Array.from({ length: 200 }, (_, index) => member(String(index)));
    const { input, findMany } = setup(rows);
    findMany.mockResolvedValue([]);
    const result = await labelHostedGroupSharedMembers(input);
    expect(result).toHaveLength(200);
    expect(new Set(result.map(({ displayName }) => displayName)).size).toBe(200);
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 16 }));
    expect(mocks.phones).not.toHaveBeenCalled();
    expect(mocks.contacts).not.toHaveBeenCalled();
  });

  it("does not resolve ambiguous verified phone matches", async () => {
    mocks.enabled.mockReturnValue(true);
    const { input, findMany } = setup([member("a"), member("b")]);
    findMany.mockResolvedValue(["a", "b"].map((id) => ({
      id: `participant_${id}`, memberId: `member_${id}`,
      member: { identity: { phoneLookupKey: createHostedPhoneLookupKey(phone),
        phoneNumberEncrypted: "synthetic-phone-ciphertext", phoneNumberVerifiedAt: new Date() } },
    })));
    mocks.phones.mockResolvedValue([phone, phone]);
    const result = await labelHostedGroupSharedMembers(input);
    expect(result.every(({ displayName }) => /^Participant [A-F0-9]{12}$/u.test(displayName ?? ""))).toBe(true);
    expect(mocks.contacts).not.toHaveBeenCalled();
  });
});
