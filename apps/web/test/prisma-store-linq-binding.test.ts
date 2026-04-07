import { describe, expect, it, vi } from "vitest";

import {
  createHostedPhoneLookupKey,
  readHostedPhoneHint,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { PrismaLinqControlPlaneStore } from "@/src/lib/linq/prisma-store";

type MutableBindingRecord = {
  createdAt: Date;
  id: string;
  label: string | null;
  recipientPhone: string;
  recipientPhoneMask: string | null;
  updatedAt: Date;
  userId: string;
};

describe("PrismaLinqControlPlaneStore hosted Linq bindings", () => {
  it("lists stored canonical bindings for a user", async () => {
    const store = new PrismaLinqControlPlaneStore({
      prisma: {
        linqRecipientBinding: {
          findMany: vi.fn().mockResolvedValue([
            createBindingRecord({
              id: "linqb_alpha",
              label: "Alpha",
              recipientPhone: "+15551230001",
              userId: "user-123",
            }),
            createBindingRecord({
              id: "linqb_beta",
              label: "Beta",
              recipientPhone: "+15551230002",
              userId: "user-123",
            }),
          ]),
        },
      } as never,
    });

    await expect(store.listBindingsForUser("user-123")).resolves.toEqual([
      expect.objectContaining({
        id: "linqb_alpha",
        label: "Alpha",
        recipientPhone: readHostedPhoneHint("+15551230001"),
        userId: "user-123",
      }),
      expect.objectContaining({
        id: "linqb_beta",
        label: "Beta",
        recipientPhone: readHostedPhoneHint("+15551230002"),
        userId: "user-123",
      }),
    ]);
  });

  it("looks up a binding by the canonical recipient phone", async () => {
    const findFirst = vi.fn().mockResolvedValue(
      createBindingRecord({
        id: "linqb_found",
        label: "Primary",
        recipientPhone: "+15557654321",
        userId: "user-123",
      }),
    );
    const store = new PrismaLinqControlPlaneStore({
      prisma: {
        linqRecipientBinding: {
          findFirst,
        },
      } as never,
    });

    await expect(store.getBindingByRecipientPhone("+1 (555) 765-4321")).resolves.toEqual(
      expect.objectContaining({
        id: "linqb_found",
        label: "Primary",
        recipientPhone: readHostedPhoneHint("+15557654321"),
        userId: "user-123",
      }),
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        recipientPhone: {
          in: [createHostedPhoneLookupKey("+15557654321")],
        },
      },
    });
  });

  it("updates the existing canonical row for the same user", async () => {
    const existing = createBindingRecord({
      id: "linqb_existing",
      recipientPhone: "+15557654321",
      userId: "user-123",
    });
    const update = vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      expect(where).toEqual({ id: "linqb_existing" });
      existing.label = (data.label as string | null | undefined) ?? null;
      existing.recipientPhone = data.recipientPhone as string;
      existing.updatedAt = new Date("2026-03-28T12:05:00.000Z");
      return cloneBindingRecord(existing);
    });

    const store = new PrismaLinqControlPlaneStore({
      prisma: {
        linqRecipientBinding: {
          findFirst: vi.fn().mockResolvedValue(cloneBindingRecord(existing)),
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
        id: "linqb_existing",
      },
      data: {
        label: "Primary",
        recipientPhone: createHostedPhoneLookupKey("+15557654321"),
        recipientPhoneMask: readHostedPhoneHint("+15557654321"),
      },
    });
    expect(binding.recipientPhone).toBe(readHostedPhoneHint("+15557654321"));
  });

  it("rejects canonical phone conflicts across different users", async () => {
    const store = new PrismaLinqControlPlaneStore({
      prisma: {
        linqRecipientBinding: {
          findFirst: vi.fn().mockResolvedValue(
            createBindingRecord({
              id: "linqb_conflict",
              recipientPhone: "+15557654321",
              userId: "user-999",
            }),
          ),
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

  it("retries a create race against the same user by updating the canonical row", async () => {
    const existing = createBindingRecord({
      id: "linqb_race",
      recipientPhone: "+15557654321",
      userId: "user-123",
    });
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(cloneBindingRecord(existing));
    const create = vi.fn().mockRejectedValue({ code: "P2002" });
    const update = vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      expect(where).toEqual({ id: "linqb_race" });
      existing.label = (data.label as string | null | undefined) ?? null;
      existing.recipientPhone = data.recipientPhone as string;
      existing.updatedAt = new Date("2026-03-28T12:05:00.000Z");
      return cloneBindingRecord(existing);
    });

    const store = new PrismaLinqControlPlaneStore({
      prisma: {
        linqRecipientBinding: {
          create,
          findFirst,
          update,
        },
      } as never,
    });

    await expect(store.upsertBinding({
      userId: "user-123",
      recipientPhone: "+1 (555) 765-4321",
      label: "Primary",
    })).resolves.toEqual(expect.objectContaining({
      id: "linqb_race",
      label: "Primary",
      recipientPhone: readHostedPhoneHint("+15557654321"),
      userId: "user-123",
    }));

    expect(create).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        recipientPhone: {
          in: [createHostedPhoneLookupKey("+15557654321")],
        },
      },
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        recipientPhone: {
          in: [createHostedPhoneLookupKey("+15557654321")],
        },
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: {
        id: "linqb_race",
      },
      data: {
        label: "Primary",
        recipientPhone: createHostedPhoneLookupKey("+15557654321"),
        recipientPhoneMask: readHostedPhoneHint("+15557654321"),
      },
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
    recipientPhoneMask: readHostedPhoneHint(input.recipientPhone),
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
