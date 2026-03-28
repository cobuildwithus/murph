import { describe, expect, it, vi } from "vitest";

import { PrismaLinqControlPlaneStore } from "@/src/lib/linq/prisma-store";

type MutableBindingRecord = {
  createdAt: Date;
  id: string;
  label: string | null;
  recipientPhone: string;
  updatedAt: Date;
  userId: string;
};

describe("PrismaLinqControlPlaneStore hosted Linq bindings", () => {
  it("canonicalizes legacy recipient-phone formatting for the same user", async () => {
    const records = [
      createBindingRecord({
        id: "linqb_legacy",
        recipientPhone: "15557654321",
        userId: "user-123",
      }),
    ];
    const findMany = vi.fn().mockResolvedValue(records.map(cloneBindingRecord));
    const update = vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const current = records.find((record) => record.id === where.id)!;
      current.recipientPhone = data.recipientPhone as string;
      current.label = (data.label as string | null | undefined) ?? null;
      current.updatedAt = new Date("2026-03-28T12:05:00.000Z");
      return cloneBindingRecord(current);
    });

    const store = new PrismaLinqControlPlaneStore({
      prisma: {
        linqRecipientBinding: {
          create: vi.fn(),
          findMany,
          update,
        },
      } as never,
    });

    const binding = await store.upsertBinding({
      userId: "user-123",
      recipientPhone: "+1 (555) 765-4321",
      label: "Primary",
    });

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "linqb_legacy",
      },
      data: {
        label: "Primary",
        recipientPhone: "+15557654321",
      },
    });
    expect(binding.recipientPhone).toBe("+15557654321");
  });

  it("rejects canonical phone conflicts across different users", async () => {
    const store = new PrismaLinqControlPlaneStore({
      prisma: {
        linqRecipientBinding: {
          findMany: vi.fn().mockResolvedValue([
            createBindingRecord({
              id: "linqb_conflict",
              recipientPhone: "15557654321",
              userId: "user-999",
            }),
          ]),
        },
      } as never,
    });

    await expect(store.upsertBinding({
      userId: "user-123",
      recipientPhone: "+15557654321",
      label: null,
    })).rejects.toMatchObject({
      code: "LINQ_BINDING_OWNERSHIP_CONFLICT",
      httpStatus: 409,
    });
  });
});

function createBindingRecord(input: {
  id: string;
  label?: string | null;
  recipientPhone: string;
  userId: string;
}): MutableBindingRecord {
  return {
    createdAt: new Date("2026-03-28T12:00:00.000Z"),
    id: input.id,
    label: input.label ?? null,
    recipientPhone: input.recipientPhone,
    updatedAt: new Date("2026-03-28T12:00:00.000Z"),
    userId: input.userId,
  };
}

function cloneBindingRecord(record: MutableBindingRecord): MutableBindingRecord {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}
