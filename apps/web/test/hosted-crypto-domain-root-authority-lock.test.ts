import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  lockAndReadActiveHostedDomainRootKeyIdTx,
} from "@/src/lib/hosted-crypto/domain-root-store";

describe("lockAndReadActiveHostedDomainRootKeyIdTx", () => {
  it("takes the provisioning authority lock before reading active root metadata", async () => {
    const calls: string[] = [];
    const txStub = {
      $executeRaw: vi.fn(async () => {
        calls.push("lock");
        return 1;
      }),
      $queryRaw: vi.fn(async () => {
        calls.push("read");
        return [{ rootKeyId: "root_ingress_active" }];
      }),
    };
    // Prisma's tagged-template methods are generic. Keep the assertion at the
    // exact two-method boundary accepted by the production helper.
    const tx = txStub as Pick<
      Prisma.TransactionClient,
      "$executeRaw" | "$queryRaw"
    >;

    await expect(lockAndReadActiveHostedDomainRootKeyIdTx({
      domain: "ingress",
      tx,
      userId: "member_group_123",
    })).resolves.toBe("root_ingress_active");

    expect(calls).toEqual(["lock", "read"]);
    expect(txStub.$executeRaw).toHaveBeenCalledTimes(1);
    expect(txStub.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
