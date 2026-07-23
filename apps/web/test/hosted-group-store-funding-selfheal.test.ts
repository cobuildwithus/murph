import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ensureHostedGroupUsageFundingJoinLinkTx } from "@/src/lib/hosted-groups/group-store";

// The self-heal must stay minimal: it may lock rows and read/create the
// HostedGroup row, but it must never touch memberships, vault-share
// projections, join offers (on the bare-create path), or grant tables. The
// fenced tx throws on any model outside the allowlist.
function buildFencedTx(models: Record<string, unknown>) {
  const target = {
    $queryRaw: vi.fn(async () => []),
    ...models,
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) {
        return object[property as keyof typeof object];
      }
      if (typeof property === "symbol" || property === "then") {
        return undefined;
      }
      throw new Error(`Funding self-heal touched unexpected tx surface: ${String(property)}`);
    },
  });
}

describe("ensureHostedGroupUsageFundingJoinLinkTx", () => {
  it("creates only the bare group row and join code for a codeless chat", async () => {
    const create = vi.fn(async (args: { data: { joinCode: string } }) => ({
      joinCode: args.data.joinCode,
    }));
    const tx = buildFencedTx({
      hostedGroup: {
        create,
        findUnique: vi.fn(async () => null),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ ownerMemberId: "member_owner_1" })),
      },
    });

    const result = await ensureHostedGroupUsageFundingJoinLinkTx({
      containerMemberId: "member_group_runtime",
      now: new Date("2026-07-23T00:00:00.000Z"),
      tx: tx as never,
    });

    expect(result?.joinCode).toMatch(/^[A-Za-z0-9_-]{16,128}$/u);
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual([
      "id",
      "joinCode",
      "joinCodeCreatedAt",
      "kind",
      "ownerMemberId",
      "runtimeMemberId",
    ]);
    expect(data.ownerMemberId).toBe("member_owner_1");
    expect(data.runtimeMemberId).toBe("member_group_runtime");
  });

  it("reuses an existing join code without writing anything", async () => {
    const tx = buildFencedTx({
      hostedGroup: {
        findUnique: vi.fn(async () => ({
          id: "hgrp_existing_1",
          joinCode: "group_join_code_1234",
        })),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ ownerMemberId: "member_owner_1" })),
      },
    });

    await expect(ensureHostedGroupUsageFundingJoinLinkTx({
      containerMemberId: "member_group_runtime",
      now: new Date("2026-07-23T00:00:00.000Z"),
      tx: tx as never,
    })).resolves.toEqual({ joinCode: "group_join_code_1234" });
  });

  it("returns null without writes when the container does not exist", async () => {
    const tx = buildFencedTx({
      hostedGroup: {
        findUnique: vi.fn(async () => null),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => null),
      },
    });

    await expect(ensureHostedGroupUsageFundingJoinLinkTx({
      containerMemberId: "member_group_runtime",
      now: new Date("2026-07-23T00:00:00.000Z"),
      tx: tx as never,
    })).resolves.toBeNull();
  });

  it("mints through the owner join-link path for an existing codeless row", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const update = vi.fn(async (args: { data: { joinCode: string } }) => ({
      joinCode: args.data.joinCode,
    }));
    const findUnique = vi.fn(async (args: { where: { id?: string; runtimeMemberId?: string } }) => (
      args.where.runtimeMemberId
        ? { id: "hgrp_existing_1", joinCode: null }
        : { id: "hgrp_existing_1", joinCode: null, ownerMemberId: "member_owner_1" }
    ));
    const tx = buildFencedTx({
      hostedGroup: {
        findUnique,
        update,
      },
      hostedGroupJoinOffer: {
        updateMany,
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ ownerMemberId: "member_owner_1" })),
      },
    });

    const result = await ensureHostedGroupUsageFundingJoinLinkTx({
      containerMemberId: "member_group_runtime",
      now: new Date("2026-07-23T00:00:00.000Z"),
      tx: tx as never,
    });

    expect(result?.joinCode).toMatch(/^[A-Za-z0-9_-]{16,128}$/u);
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
