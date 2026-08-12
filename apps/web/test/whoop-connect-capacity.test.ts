import { describe, expect, it, vi } from "vitest";

import {
  assertHostedWhoopConnectCapacityAvailable,
} from "@/src/lib/device-sync/whoop-connect-capacity";

function buildPrisma(input: {
  existing?: boolean;
  members?: Array<{ userId: string }>;
}) {
  return {
    $queryRaw: vi.fn(async () => input.members ?? []),
    deviceConnection: {
      findFirst: vi.fn(async () => input.existing ? { id: "connection_existing" } : null),
    },
  };
}

describe("WHOOP connect capacity", () => {
  it("allows an existing member without reading the shared capacity graph", async () => {
    const prisma = buildPrisma({ existing: true });

    await expect(assertHostedWhoopConnectCapacityAvailable({
      memberId: "member_existing",
      prisma: prisma as never,
      target: { provider: "whoop" } as never,
    })).resolves.toBeUndefined();

    expect(prisma.deviceConnection.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "member_existing" }),
    }));
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("caps each provider branch before combining the two-member result", async () => {
    const prisma = buildPrisma({ members: [{ userId: "member_one" }] });

    await expect(assertHostedWhoopConnectCapacityAvailable({
      memberId: "member_new",
      prisma: prisma as never,
      target: { provider: "whoop" } as never,
    })).resolves.toBeUndefined();

    const query = (prisma.$queryRaw.mock.calls as unknown[][])[0]?.[0] as {
      strings?: readonly string[];
      values?: readonly unknown[];
    } | undefined;
    const sql = query?.strings?.join("?") ?? "";
    expect(sql).toContain("FROM device_connection AS connection");
    expect(sql).toContain("FROM device_connection_source AS source");
    expect(sql).toContain("JOIN device_connection AS connection");
    expect(sql).toContain("source.source_provider_slug = 'whoop_v2'");
    expect(sql.match(/LIMIT \?/gu)).toHaveLength(3);
    expect(query?.values).toEqual([2, 2, 2]);
  });

  it("rejects a new member once two distinct members occupy capacity", async () => {
    const prisma = buildPrisma({
      members: [{ userId: "member_one" }, { userId: "member_two" }],
    });

    await expect(assertHostedWhoopConnectCapacityAvailable({
      memberId: "member_new",
      prisma: prisma as never,
      target: { provider: "junction", sourceProviderSlug: "whoop_v2" } as never,
    })).rejects.toMatchObject({
      code: "WHOOP_DIRECT_CONNECT_CAP_REACHED",
    });
  });

  it("does not query capacity for another provider", async () => {
    const prisma = buildPrisma({});

    await expect(assertHostedWhoopConnectCapacityAvailable({
      memberId: "member_other",
      prisma: prisma as never,
      target: { provider: "oura" } as never,
    })).resolves.toBeUndefined();

    expect(prisma.deviceConnection.findFirst).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
