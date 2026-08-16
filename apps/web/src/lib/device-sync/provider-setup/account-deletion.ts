import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { hostedOnboardingError } from "../../hosted-onboarding/errors";
import {
  isMemberOwnedDeviceProviderApplicationProvider,
  readDeviceProviderApplicationView,
  type DeviceProviderApplicationView,
} from "../provider-applications";
import {
  listMemberOwnedProviderSetupRegistrations,
} from "./registry";
import { PrismaDeviceProviderSetupStore } from "./store";
import type { MemberOwnedProviderSetupRecord } from "./types";

interface ProviderSetupDeletionStore {
  listMemberSetups(memberId: string): Promise<MemberOwnedProviderSetupRecord[]>;
  transition(
    input: Parameters<PrismaDeviceProviderSetupStore["transition"]>[0],
  ): Promise<MemberOwnedProviderSetupRecord>;
}

type ReadProviderApplicationView = (input: {
  memberId: string;
  provider: MemberOwnedProviderSetupRecord["provider"];
}) => Promise<DeviceProviderApplicationView | null>;

/**
 * Provider dashboards need an authenticated member-driven browser. Account
 * deletion therefore starts only after every Murph-owned provider application
 * has been removed through the ordinary /connect assistant flow. This check is
 * runs while the account-deletion transaction owns the member suspension
 * lock, so no setup run or credential binding can start between proof and the
 * suspension write.
 */
export async function assertMemberOwnedProviderSetupsReadyForAccountDeletion(input: {
  memberId: string;
  prisma?: PrismaClient | Prisma.TransactionClient;
  readApplicationView?: ReadProviderApplicationView;
  store?: Pick<ProviderSetupDeletionStore, "listMemberSetups">;
}): Promise<void> {
  const store = input.store ?? null;
  const readApplication = input.readApplicationView
    ?? ((query) => readDeviceProviderApplicationView({
      ...query,
      prisma: requireDeletionPrisma(input.prisma),
    }));
  const setups = store
    ? (await store.listMemberSetups(input.memberId))
      .filter((setup) => setup.active && setup.status !== "deleted")
    : await requireDeletionPrisma(input.prisma).deviceProviderSetup.findMany({
        select: {
          active: true,
          browserRunId: true,
          id: true,
          memberId: true,
          provider: true,
          providerApplicationId: true,
          providerApplicationRevision: true,
          status: true,
        },
        where: {
          active: true,
          memberId: input.memberId,
          status: { not: "deleted" },
        },
      });

  if (input.prisma) {
    const activeOwnedRun = setups.length === 0
      ? null
      : await input.prisma.hostedComputerRun.findFirst({
          select: { id: true },
          where: {
            memberId: input.memberId,
            ownerKey: { in: setups.map((setup) => setup.id) },
            ownerPurpose: "member_owned_provider_setup",
            status: { in: ["running", "awaiting_user", "cleanup_pending"] },
          },
        });
    if (activeOwnedRun) {
      throw providerSetupCleanupRequired("provider");
    }
  }

  const providerNames = new Map(
    listMemberOwnedProviderSetupRegistrations().map((registration) => [
      registration.coordinates.provider,
      registration.presentation.providerName,
    ]),
  );
  const providers = new Set<MemberOwnedProviderSetupRecord["provider"]>();
  for (const registration of listMemberOwnedProviderSetupRegistrations()) {
    if (isMemberOwnedDeviceProviderApplicationProvider(registration.coordinates.provider)) {
      providers.add(registration.coordinates.provider);
    }
  }
  for (const setup of setups) {
    if (isMemberOwnedDeviceProviderApplicationProvider(setup.provider)) {
      providers.add(setup.provider);
    }
  }

  for (const provider of providers) {
    const setup = setups.find((candidate) => candidate.provider === provider) ?? null;
    const application = await readApplication({
      memberId: input.memberId,
      provider,
    });
    if (
      application
      || setup?.providerApplicationId
      || setup?.providerApplicationRevision
      || setup?.browserRunId
      || setup?.status === "browser_setup"
      || setup?.status === "canceling"
      || setup?.status === "deletion_pending"
    ) {
      throw providerSetupCleanupRequired(
        providerNames.get(provider) ?? "provider",
      );
    }
  }
}

/**
 * Post-suspension cleanup is deliberately local. The preflight above proves
 * that no external application or resumable browser remains; this function
 * only closes the durable setup record before the normal account row deletion.
 */
export async function deleteMemberOwnedProviderSetupExternalStateForAccountDeletion(input: {
  memberId: string;
  prisma?: PrismaClient;
  readApplicationView?: ReadProviderApplicationView;
  store?: ProviderSetupDeletionStore;
}): Promise<void> {
  const store = input.store
    ?? new PrismaDeviceProviderSetupStore(requireDeletionClient(input.prisma));
  const readApplication = input.readApplicationView
    ?? ((query) => readDeviceProviderApplicationView({
      ...query,
      prisma: requireDeletionPrisma(input.prisma),
    }));
  const setups = (await store.listMemberSetups(input.memberId))
    .filter((setup) => setup.active && setup.status !== "deleted");

  for (const setup of setups) {
    const application = await readApplication({
      memberId: setup.memberId,
      provider: setup.provider,
    });
    if (
      application
      || setup.providerApplicationId
      || setup.providerApplicationRevision
      || setup.browserRunId
    ) {
      throw hostedOnboardingError({
        code: "ACCOUNT_DELETION_PROVIDER_SETUP_PREFLIGHT_INVALIDATED",
        httpStatus: 503,
        message: "Private provider cleanup changed after account deletion began. Retry account deletion.",
        retryable: true,
      });
    }

    await store.transition({
      active: false,
      completedAt: new Date(),
      expectedVersion: setup.version,
      memberId: setup.memberId,
      provider: setup.provider,
      setupId: setup.id,
      status: "deleted",
    });
  }
}

function providerSetupCleanupRequired(providerName: string) {
  return hostedOnboardingError({
    code: "ACCOUNT_DELETION_PROVIDER_SETUP_REQUIRES_CLEANUP",
    httpStatus: 409,
    message: `Disconnect ${providerName} and ask Murph to remove its private application from /connect before deleting your account.`,
    retryable: false,
  });
}

function requireDeletionPrisma(
  prisma: PrismaClient | Prisma.TransactionClient | undefined,
): PrismaClient | Prisma.TransactionClient {
  if (!prisma) {
    throw new TypeError("Provider setup account deletion requires Prisma unless all owners are injected.");
  }
  return prisma;
}

function requireDeletionClient(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new TypeError("Provider setup account deletion requires Prisma unless all owners are injected.");
  }
  return prisma;
}
