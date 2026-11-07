import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
const m = vi.hoisted(() => ({ active: vi.fn() }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({ hasHostedRuntimeActiveAccess: m.active }));
import { readSharedCompanionContact } from "@/src/lib/hosted-groups/shared-companion-presence";

const grant = { id: "share-synthetic", grantorMemberId: "member-synthetic", projectionScope: { projectionKind: "steps-days.v0" as const } };
function fixture() {
  const connections = vi.fn().mockResolvedValue([{ userId: grant.grantorMemberId }]);
  const shares = vi.fn().mockResolvedValue([{ grantorMemberId: grant.grantorMemberId, grantor: { companionLastContactAt: new Date("2026-10-01T12:00:00.000Z") } }]);
  const transaction = vi.fn(async (run) => run({ deviceConnection: { findMany: connections }, hostedVaultShare: { findMany: shares } }));
  // Deliberately limited fake of the public Prisma boundary.
  const prisma = { $transaction: transaction } as Pick<PrismaClient, "$transaction"> as PrismaClient;
  return { connections, shares, transaction, input: { prisma, runtimeMemberId: "group-synthetic", grants: [grant] } };
}
describe("shared companion contact privacy", () => {
  beforeEach(() => { vi.resetAllMocks(); m.active.mockResolvedValue(true); });
  it("requires the exact live grant, group membership, health access and an active Apple Health connection", async () => {
    const f = fixture();
    expect(await readSharedCompanionContact(f.input)).toEqual(new Map([[grant.grantorMemberId, "2026-10-01T12:00:00.000Z"]]));
    expect(f.connections).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      select: { userId: true }, take: 201, where: {
        userId: { in: [grant.grantorMemberId] }, status: "active",
        sources: { some: { sourceProviderSlug: "apple_health_kit", status: "connected" } },
      },
    }));
    expect(f.shares).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      select: { grantorMemberId: true, grantor: { select: { companionLastContactAt: true } } }, take: 201,
      where: expect.objectContaining({ id: { in: [grant.id] }, status: "granted", destinationMemberId: "group-synthetic",
        grantor: expect.objectContaining({ AND: expect.any(Array), hostedGroupMemberships: { some: { group: { runtimeMemberId: "group-synthetic" } } } }),
      }),
    }));
    f.shares.mockResolvedValue([]);
    expect(await readSharedCompanionContact(f.input)).toEqual(new Map());
  });
  it("does not read app presence for unshared, identity-only or nutrition-only requests", async () => {
    const f = fixture();
    for (const projectionKind of ["profile-name.v0", "group-email.v0", "protein-days.v0"] as const) {
      expect(await readSharedCompanionContact({ ...f.input, grants: [{ ...grant, projectionScope: { projectionKind } }] })).toEqual(new Map());
    }
    expect(await readSharedCompanionContact({ ...f.input, grants: [] })).toEqual(new Map());
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it("bounds roster work and suppresses inactive group reads", async () => {
    const f = fixture();
    m.active.mockResolvedValue(false);
    expect(await readSharedCompanionContact(f.input)).toEqual(new Map());
    expect(f.connections).not.toHaveBeenCalled();
    m.active.mockResolvedValue(true);
    f.connections.mockResolvedValue(Array.from({ length: 201 }, (_, i) => ({ userId: `member-${i}` })));
    expect(await readSharedCompanionContact(f.input)).toEqual(new Map());
    expect(f.shares).not.toHaveBeenCalled();
  });
});
