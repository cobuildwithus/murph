import "server-only";

import type { PrismaClient } from "@prisma/client";

import { hostedOnboardingError } from "../../hosted-onboarding/errors";
import {
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
 * intentionally before the account suspension fence; no model or browser
 * session is started after suspension.
 */
export async function assertMemberOwnedProviderSetupsReadyForAccountDeletion(input: {
  memberId: string;
  prisma?: PrismaClient;
  readApplicationView?: ReadProviderApplicationView;
  store?: Pick<ProviderSetupDeletionStore, "listMemberSetups">;
}): Promise<void> {
  const store = input.store
    ?? new PrismaDeviceProviderSetupStore(requireDeletionPrisma(input.prisma));
  const readApplication = input.readApplicationView
    ?? ((query) => readDeviceProviderApplicationView({
      ...query,
      prisma: requireDeletionPrisma(input.prisma),
    }));
  const setups = (await store.listMemberSetups(input.memberId))
    .filter((setup) => setup.active && setup.status !== "deleted");

  const providerNames = new Map(
    listMemberOwnedProviderSetupRegistrations().map((registration) => [
      registration.coordinates.provider,
      registration.presentation.providerName,
    ]),
  );
  const providers = new Set([
    ...providerNames.keys(),
    ...setups.map((setup) => setup.provider),
  ]);

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
      || setup?.status === "capturing"
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
    ?? new PrismaDeviceProviderSetupStore(requireDeletionPrisma(input.prisma));
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

function requireDeletionPrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new TypeError("Provider setup account deletion requires Prisma unless all owners are injected.");
  }
  return prisma;
}
