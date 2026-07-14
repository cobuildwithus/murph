import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { lockHostedMemberSponsoredAccessRows } from "../src/lib/hosted-onboarding/shared";

describe("hosted onboarding row locks", () => {
  it("locks active sponsorship memberships and their groups in deterministic order", async () => {
    const calls: Array<[TemplateStringsArray | Prisma.Sql, ...unknown[]]> = [];
    const queryRaw: Prisma.TransactionClient["$queryRaw"] = <T = unknown>(
      query: TemplateStringsArray | Prisma.Sql,
      ...values: unknown[]
    ) => {
      calls.push([query, ...values]);
      return Promise.resolve([]) as Prisma.PrismaPromise<T>;
    };

    await lockHostedMemberSponsoredAccessRows({ $queryRaw: queryRaw }, "member_1");

    const call = calls[0];
    const strings = call?.[0];
    expect(Array.isArray(strings)).toBe(true);
    if (!Array.isArray(strings)) {
      throw new Error("Expected a parameterized Prisma SQL query.");
    }
    const sql = strings.join("?");
    expect(sql).toContain('join "hosted_account_group"');
    expect(sql).toContain('"membership"."status" = \'active\'');
    expect(sql).toContain('order by "account_group"."id", "membership"."id"');
    expect(sql).toContain('for update of "account_group", "membership"');
    expect(call?.[1]).toBe("member_1");
  });
});
