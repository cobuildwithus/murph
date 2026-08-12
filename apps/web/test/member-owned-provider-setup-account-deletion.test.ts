import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { deleteMemberOwnedProviderSetupExternalStateForAccountDeletion } from "@/src/lib/device-sync/provider-setup/account-deletion";
import type { MemberOwnedProviderSetupRegistration } from "@/src/lib/device-sync/provider-setup/registry";
import { PrismaDeviceProviderSetupStore } from "@/src/lib/device-sync/provider-setup/store";
import type {
  MemberOwnedProviderApplicationDeleteResult,
  MemberOwnedProviderSetupRecord,
} from "@/src/lib/device-sync/provider-setup/types";

const CREATED_AT = new Date("2026-08-11T12:00:00.000Z");
const PRISMA_NOT_USED = Object.create(null) as PrismaClient;

class MemoryDeletionStore {
  setup: MemberOwnedProviderSetupRecord = buildSetup();
  readonly statuses: string[] = [];

  async listMemberSetups(memberId: string) {
    return memberId === this.setup.memberId ? [this.setup] : [];
  }

  async transition(input: {
    browserRunId?: string | null;
    completedAt?: Date | null;
    expectedVersion: number;
    lastErrorCode?: string | null;
    memberId: string;
    provider: "strava";
    setupId: string;
    status: MemberOwnedProviderSetupRecord["status"];
  }) {
    expect(input.expectedVersion).toBe(this.setup.version);
    expect(input.memberId).toBe(this.setup.memberId);
    expect(input.provider).toBe(this.setup.provider);
    expect(input.setupId).toBe(this.setup.id);
    this.statuses.push(input.status);
    this.setup = {
      ...this.setup,
      ...(input.browserRunId === undefined ? {} : { browserRunId: input.browserRunId }),
      ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
      ...(input.lastErrorCode === undefined ? {} : { lastErrorCode: input.lastErrorCode }),
      status: input.status,
      updatedAt: new Date(this.setup.updatedAt.getTime() + 1_000),
      version: this.setup.version + 1,
    };
    return this.setup;
  }
}

function createAdapter(input: {
  awaitingReason?: "login_needed" | "other" | null;
  cancelError?: Error;
  cancelResult?: "canceled" | "completed" | "failed";
  deleteError?: Error;
  deleteResult?: MemberOwnedProviderApplicationDeleteResult;
  handoffUrl?: string | null;
  runId?: string;
  runStatus?: string;
} = {}) {
  const runId = input.runId ?? "hcr_setup_owned";
  return {
    deleteOwnedApplication: vi.fn(async () => {
      if (input.deleteError) {
        throw input.deleteError;
      }
      return input.deleteResult ?? { kind: "deleted" as const };
    }),
    ensureBrowserRun: vi.fn(async (runInput: {
      expectedRunId: string | null;
      memberId: string;
      setupId: string;
    }) => ({
      awaitingReason: input.awaitingReason ?? null,
      reused: runInput.expectedRunId === runId,
      runId,
      status: input.runStatus ?? "running",
    })),
    cancelBrowserRun: vi.fn(async () => {
      if (input.cancelError) {
        throw input.cancelError;
      }
      return input.cancelResult ?? ("canceled" as const);
    }),
    pauseForUser: vi.fn(async () => ({
      handoffUrl: input.handoffUrl === undefined
        ? "https://web.example.test/computer/handoff/synthetic-handoff"
        : input.handoffUrl,
      runId,
    })),
  };
}

function adapterFactory(adapter: ReturnType<typeof createAdapter>) {
  return vi.fn((registration: MemberOwnedProviderSetupRegistration) => {
    expect(registration.coordinates).toEqual({
      connectSourceId: "strava",
      connectTarget: "strava",
      provider: "strava",
      sourceProviderSlug: null,
    });
    return adapter;
  });
}

describe("member-owned provider setup account deletion", () => {
  it("deletes setup-only state without acquiring a provider browser", async () => {
    const store = new MemoryDeletionStore();
    store.setup = buildSetup({
      browserRunId: "hcr_setup_owned",
      providerApplicationId: null,
      providerApplicationRevision: null,
      providerSubmissionAt: null,
      status: "pending",
    });
    const adapter = createAdapter();
    const factory = adapterFactory(adapter);

    await expect(deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
      adapterFactory: factory,
      memberId: "member_synthetic",
      prisma: PRISMA_NOT_USED,
      readApplicationView: async () => null,
      store,
    })).resolves.toBeUndefined();

    expect(factory).not.toHaveBeenCalled();
    expect(adapter.ensureBrowserRun).not.toHaveBeenCalled();
    expect(adapter.deleteOwnedApplication).not.toHaveBeenCalled();
    expect(store.statuses).toEqual(["deleted"]);
    expect(store.setup).toMatchObject({
      active: true,
      browserRunId: "hcr_setup_owned",
      providerApplicationId: null,
      providerApplicationRevision: null,
      providerSubmissionAt: null,
      status: "deleted",
    });
  });

  it("inspects a submission-fenced setup even before application binding", async () => {
    const store = new MemoryDeletionStore();
    store.setup = buildSetup({
      providerApplicationId: null,
      providerApplicationRevision: null,
      providerSubmissionAt: new Date("2026-08-11T12:01:00.000Z"),
      status: "inspection_required",
    });
    const adapter = createAdapter();
    const factory = adapterFactory(adapter);

    await deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
      adapterFactory: factory,
      memberId: "member_synthetic",
      prisma: PRISMA_NOT_USED,
      store,
    });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(adapter.ensureBrowserRun).toHaveBeenCalledWith({
      expectedRunId: null,
      memberId: "member_synthetic",
      setupId: "dps_synthetic",
    });
    expect(adapter.deleteOwnedApplication).toHaveBeenCalledWith({
      memberId: "member_synthetic",
      runId: "hcr_setup_owned",
      setupId: "dps_synthetic",
    });
    expect(store.setup.status).toBe("deleted");
  });

  it("inspects when credential sealing committed before setup binding", async () => {
    const store = new MemoryDeletionStore();
    store.setup = buildSetup({
      providerApplicationId: null,
      providerApplicationRevision: null,
      providerSubmissionAt: null,
      status: "pending",
    });
    const adapter = createAdapter();
    const factory = adapterFactory(adapter);

    await deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
      adapterFactory: factory,
      memberId: "member_synthetic",
      prisma: PRISMA_NOT_USED,
      readApplicationView: async () => ({
        applicationId: "dpa_recovered",
        createdAt: CREATED_AT.toISOString(),
        provider: "strava",
        revision: 1,
        updatedAt: CREATED_AT.toISOString(),
      }),
      store,
    });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(adapter.deleteOwnedApplication).toHaveBeenCalledTimes(1);
    expect(store.setup.status).toBe("deleted");
  });

  it.each(["deleted", "missing", "unrelated_application"] as const)(
    "finishes exact, absent, or unrelated-safe dashboard result %s",
    async (kind) => {
      const store = new MemoryDeletionStore();
      const adapter = createAdapter({ deleteResult: { kind } });
      const factory = adapterFactory(adapter);

      await expect(deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
        adapterFactory: factory,
        memberId: "member_synthetic",
        prisma: PRISMA_NOT_USED,
        store,
      })).resolves.toBeUndefined();

      expect(factory).toHaveBeenCalledTimes(1);
      expect(adapter.ensureBrowserRun).toHaveBeenCalledWith({
        expectedRunId: null,
        memberId: "member_synthetic",
        setupId: "dps_synthetic",
      });
      expect(adapter.deleteOwnedApplication).toHaveBeenCalledWith({
        memberId: "member_synthetic",
        runId: "hcr_setup_owned",
        setupId: "dps_synthetic",
      });
      expect(adapter.cancelBrowserRun).toHaveBeenCalledWith({
        memberId: "member_synthetic",
        runId: "hcr_setup_owned",
        setupId: "dps_synthetic",
      });
      expect(store.statuses[0]).toBe("deletion_pending");
      expect(store.setup.status).toBe("deleted");
      expect(store.setup.browserRunId).toBeNull();
      expect(store.setup.providerApplicationId).toBe("dpa_synthetic");
      expect(store.setup.providerApplicationRevision).toBe(2);
    },
  );

  it("reuses only the exact setup-bound run", async () => {
    const store = new MemoryDeletionStore();
    store.setup = buildSetup({ browserRunId: "hcr_setup_owned" });
    const adapter = createAdapter();

    await deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
      adapterFactory: adapterFactory(adapter),
      memberId: "member_synthetic",
      prisma: PRISMA_NOT_USED,
      store,
    });

    expect(adapter.ensureBrowserRun).toHaveBeenCalledWith({
      expectedRunId: "hcr_setup_owned",
      memberId: "member_synthetic",
      setupId: "dps_synthetic",
    });
  });

  it("rotates or returns the exact handoff when the deletion-owned run already awaits the member", async () => {
    const store = new MemoryDeletionStore();
    store.setup = buildSetup({
      browserRunId: "hcr_setup_owned",
      status: "deletion_pending",
    });
    const adapter = createAdapter({
      awaitingReason: "login_needed",
      runStatus: "awaiting_user",
    });

    await expect(deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
      adapterFactory: adapterFactory(adapter),
      memberId: "member_synthetic",
      prisma: PRISMA_NOT_USED,
      store,
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PROVIDER_HANDOFF_REQUIRED",
      details: {
        handoffUrl: "https://web.example.test/computer/handoff/synthetic-handoff",
      },
      retryable: true,
    });

    expect(adapter.pauseForUser).toHaveBeenCalledWith({
      memberId: "member_synthetic",
      reason: "signed_out",
      runId: "hcr_setup_owned",
      setupId: "dps_synthetic",
    });
    expect(adapter.deleteOwnedApplication).not.toHaveBeenCalled();
    expect(adapter.cancelBrowserRun).not.toHaveBeenCalled();
    expect(store.setup).toMatchObject({
      browserRunId: "hcr_setup_owned",
      status: "deletion_pending",
    });
  });

  it("does not emit a URL-less handoff error", async () => {
    const store = new MemoryDeletionStore();
    store.setup = buildSetup({
      browserRunId: "hcr_setup_owned",
      status: "deletion_pending",
    });
    const adapter = createAdapter({
      awaitingReason: "other",
      handoffUrl: null,
      runStatus: "awaiting_user",
    });

    await expect(deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
      adapterFactory: adapterFactory(adapter),
      memberId: "member_synthetic",
      prisma: PRISMA_NOT_USED,
      store,
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PROVIDER_BROWSER_CLEANUP_INCOMPLETE",
      retryable: true,
    });
  });

  it("preserves fenced deletion ownership and returns the exact secure handoff", async () => {
    const store = new MemoryDeletionStore();
    const adapter = createAdapter({
      deleteResult: {
        kind: "authentication_required",
        reason: "challenge",
      },
    });

    await expect(deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
      adapterFactory: adapterFactory(adapter),
      memberId: "member_synthetic",
      prisma: PRISMA_NOT_USED,
      store,
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PROVIDER_HANDOFF_REQUIRED",
      details: {
        handoffUrl: "https://web.example.test/computer/handoff/synthetic-handoff",
      },
      retryable: true,
    });

    expect(store.setup.status).toBe("deletion_pending");
    expect(store.setup.providerApplicationId).toBe("dpa_synthetic");
    expect(adapter.pauseForUser).toHaveBeenCalledWith({
      memberId: "member_synthetic",
      reason: "challenge",
      runId: "hcr_setup_owned",
      setupId: "dps_synthetic",
    });
  });

  it("does not report deletion success when the exact browser run cannot be canceled", async () => {
    const store = new MemoryDeletionStore();
    const adapter = createAdapter({ cancelResult: "completed" });

    await expect(deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
      adapterFactory: adapterFactory(adapter),
      memberId: "member_synthetic",
      prisma: PRISMA_NOT_USED,
      store,
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PROVIDER_BROWSER_CLEANUP_INCOMPLETE",
      retryable: true,
    });

    expect(adapter.deleteOwnedApplication).toHaveBeenCalledTimes(1);
    expect(adapter.cancelBrowserRun).toHaveBeenCalledTimes(1);
    expect(store.setup).toMatchObject({
      browserRunId: "hcr_setup_owned",
      completedAt: null,
      status: "deletion_pending",
    });
  });

  it("fails closed on ambiguous provider ownership", async () => {
    const store = new MemoryDeletionStore();
    const adapter = createAdapter({ deleteResult: { kind: "ambiguous" } });

    await expect(deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
      adapterFactory: adapterFactory(adapter),
      memberId: "member_synthetic",
      prisma: PRISMA_NOT_USED,
      store,
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PROVIDER_APPLICATION_AMBIGUOUS",
      retryable: true,
    });
    expect(store.setup.status).toBe("deletion_pending");
    expect(store.setup.providerApplicationId).toBe("dpa_synthetic");
  });

  it("keeps local setup and sealed application state retryable when external cleanup fails", async () => {
    const store = new MemoryDeletionStore();
    const adapter = createAdapter({
      deleteError: new Error("synthetic provider dashboard unavailable"),
    });

    await expect(deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
      adapterFactory: adapterFactory(adapter),
      memberId: "member_synthetic",
      prisma: PRISMA_NOT_USED,
      store,
    })).rejects.toThrow("synthetic provider dashboard unavailable");

    expect(store.setup).toMatchObject({
      active: true,
      browserRunId: "hcr_setup_owned",
      providerApplicationId: "dpa_synthetic",
      providerApplicationRevision: 2,
      status: "deletion_pending",
    });
  });
});

describe("member-owned provider setup store bounds", () => {
  it("loads only active setups in stable provider order", async () => {
    const findMany = vi.fn(async (input: object) => {
      void input;
      return [buildSetup()];
    });
    const store = new PrismaDeviceProviderSetupStore(createPrismaStoreStub({
      deviceProviderSetup: { findMany },
    }));

    await expect(store.listMemberSetups("member_synthetic")).resolves.toHaveLength(1);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
      where: {
        active: true,
        memberId: "member_synthetic",
      },
    }));
  });

  it.each(["active", "reauthorization_required"] as const)(
    "reads an exact %s connection with its application binding",
    async (status) => {
      const findMany = vi.fn(async (input: object) => {
        void input;
        return [{
          id: "dc_synthetic",
          providerApplicationId: "dpa_synthetic",
          providerApplicationRevision: 2,
          status,
        }];
      });
      const store = new PrismaDeviceProviderSetupStore(createPrismaStoreStub({
        deviceConnection: { findMany },
      }));

      await expect(store.readConnectionDisposition(buildSetup())).resolves.toEqual({
        binding: {
          applicationId: "dpa_synthetic",
          provider: "strava",
          revision: 2,
        },
        connectionId: "dc_synthetic",
        kind: "exact",
        status,
      });

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: { connectedAt: "desc" },
        select: {
          id: true,
          providerApplicationId: true,
          providerApplicationRevision: true,
          status: true,
        },
        take: 2,
        where: {
          provider: "strava",
          status: { not: "disconnected" },
          userId: "member_synthetic",
        },
      }));
    },
  );

  it.each([
    {
      connections: [
        {
          id: "dc_exact",
          providerApplicationId: "dpa_synthetic",
          providerApplicationRevision: 2,
          status: "active",
        },
        {
          id: "dc_foreign",
          providerApplicationId: "dpa_foreign",
          providerApplicationRevision: 1,
          status: "active",
        },
      ],
      name: "multiple non-disconnected rows",
    },
    {
      connections: [{
        id: "dc_foreign",
        providerApplicationId: "dpa_foreign",
        providerApplicationRevision: 2,
        status: "reauthorization_required",
      }],
      name: "a foreign application binding",
    },
    {
      connections: [{
        id: "dc_mismatched_revision",
        providerApplicationId: "dpa_synthetic",
        providerApplicationRevision: 3,
        status: "active",
      }],
      name: "a mismatched application revision",
    },
  ])("treats $name as a connection conflict", async ({ connections }) => {
    const findMany = vi.fn(async (input: object) => {
      void input;
      return connections;
    });
    const store = new PrismaDeviceProviderSetupStore(createPrismaStoreStub({
      deviceConnection: { findMany },
    }));

    await expect(store.readConnectionDisposition(buildSetup())).resolves.toEqual({
      connectionId: connections[0]?.id,
      kind: "conflict",
    });
  });
});

function createPrismaStoreStub(
  delegates: Readonly<Record<string, object>>,
): PrismaClient {
  const prisma = Object.create(null) as PrismaClient;
  for (const [name, delegate] of Object.entries(delegates)) {
    Object.defineProperty(prisma, name, {
      configurable: true,
      value: delegate,
    });
  }
  return prisma;
}

function buildSetup(
  overrides: Partial<MemberOwnedProviderSetupRecord> = {},
): MemberOwnedProviderSetupRecord {
  return {
    active: true,
    browserRunId: null,
    completedAt: null,
    connectSourceId: "strava",
    connectTarget: "strava",
    createdAt: CREATED_AT,
    id: "dps_synthetic",
    lastErrorCode: null,
    memberId: "member_synthetic",
    provider: "strava",
    providerApplicationId: "dpa_synthetic",
    providerApplicationRevision: 2,
    providerSubmissionAt: null,
    sourceProviderSlug: null,
    status: "connected",
    updatedAt: CREATED_AT,
    version: 1,
    ...overrides,
  };
}
