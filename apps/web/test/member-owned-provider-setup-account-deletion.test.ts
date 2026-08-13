import { describe, expect, it, vi } from "vitest";

import {
  assertMemberOwnedProviderSetupsReadyForAccountDeletion,
  deleteMemberOwnedProviderSetupExternalStateForAccountDeletion,
} from "@/src/lib/device-sync/provider-setup/account-deletion";
import { PrismaDeviceProviderSetupStore } from "@/src/lib/device-sync/provider-setup/store";
import type { MemberOwnedProviderSetupRecord } from "@/src/lib/device-sync/provider-setup/types";

const NOW = new Date("2026-08-11T12:00:00.000Z");

const BLOCKED_SETUP_CASES: ReadonlyArray<readonly [
  string,
  Partial<MemberOwnedProviderSetupRecord>,
]> = [
  ["sealed application", {
    providerApplicationId: "dpa_synthetic",
    providerApplicationRevision: 2,
  }],
  ["owned browser", { browserRunId: "hcr_synthetic", status: "browser_setup" }],
  ["capture fence", { status: "capturing" }],
  ["cancellation fence", { status: "canceling" }],
  ["deletion fence", { status: "deletion_pending" }],
];
type TransitionInput = Parameters<PrismaDeviceProviderSetupStore["transition"]>[0];

class MemoryDeletionStore {
  setup = buildSetup();
  readonly transition = vi.fn(async (input: TransitionInput) => {
    expect(input.expectedVersion).toBe(this.setup.version);
    this.setup = {
      ...this.setup,
      active: input.active ?? this.setup.active,
      completedAt: input.completedAt === undefined
        ? this.setup.completedAt
        : input.completedAt,
      status: input.status,
      updatedAt: NOW,
      version: this.setup.version + 1,
    };
    return this.setup;
  });

  async listMemberSetups(): Promise<MemberOwnedProviderSetupRecord[]> {
    return [this.setup];
  }
}

describe("member-owned provider setup account deletion", () => {
  it("allows suspension only after provider application and resumable browser state are gone", async () => {
    const store = new MemoryDeletionStore();
    const readApplicationView = vi.fn(async () => null);

    await expect(assertMemberOwnedProviderSetupsReadyForAccountDeletion({
      memberId: store.setup.memberId,
      readApplicationView,
      store,
    })).resolves.toBeUndefined();

    expect(readApplicationView).toHaveBeenCalledWith({
      memberId: store.setup.memberId,
      provider: "strava",
    });
  });

  it.each(BLOCKED_SETUP_CASES)(
    "blocks account deletion while %s remains",
    async (_label, patch) => {
      const store = new MemoryDeletionStore();
      store.setup = buildSetup(patch);

      await expect(assertMemberOwnedProviderSetupsReadyForAccountDeletion({
        memberId: store.setup.memberId,
        readApplicationView: async () => null,
        store,
      })).rejects.toMatchObject({
        code: "ACCOUNT_DELETION_PROVIDER_SETUP_REQUIRES_CLEANUP",
        httpStatus: 409,
      });
    },
  );

  it("closes only the local durable row after suspension", async () => {
    const store = new MemoryDeletionStore();
    const readApplicationView = vi.fn(async () => null);

    await deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
      memberId: store.setup.memberId,
      readApplicationView,
      store,
    });

    expect(store.transition).toHaveBeenCalledWith({
      active: false,
      completedAt: expect.any(Date),
      expectedVersion: 1,
      memberId: store.setup.memberId,
      provider: "strava",
      setupId: store.setup.id,
      status: "deleted",
    });
    expect(store.setup).toMatchObject({ active: false, status: "deleted" });
  });

  it("fails closed if the preflight becomes stale before local cleanup", async () => {
    const store = new MemoryDeletionStore();

    await expect(deleteMemberOwnedProviderSetupExternalStateForAccountDeletion({
      memberId: store.setup.memberId,
      readApplicationView: async () => ({
        applicationId: "dpa_late",
        createdAt: NOW.toISOString(),
        provider: "strava",
        revision: 1,
        updatedAt: NOW.toISOString(),
      }),
      store,
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PROVIDER_SETUP_PREFLIGHT_INVALIDATED",
      httpStatus: 503,
      retryable: true,
    });

    expect(store.transition).not.toHaveBeenCalled();
    expect(store.setup.active).toBe(true);
  });
});

function buildSetup(
  overrides: Partial<MemberOwnedProviderSetupRecord> = {},
): MemberOwnedProviderSetupRecord {
  return {
    active: true,
    browserRunId: null,
    completedAt: null,
    connectSourceId: "strava",
    connectTarget: "strava",
    createdAt: NOW,
    id: "dps_synthetic",
    memberId: "member_synthetic",
    provider: "strava",
    providerApplicationId: null,
    providerApplicationRevision: null,
    sourceProviderSlug: null,
    status: "authorized",
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}
