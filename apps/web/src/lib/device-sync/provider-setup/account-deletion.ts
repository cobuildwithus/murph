import "server-only";

import type { PrismaClient } from "@prisma/client";

import { ComputerUseService } from "../../computer-use/service";
import { PrismaComputerUseStore } from "../../computer-use/store";
import { hostedOnboardingError } from "../../hosted-onboarding/errors";
import type { MemberOwnedProviderSetupAdapter } from "./adapter";
import {
  requireMemberOwnedProviderSetupRegistration,
  type MemberOwnedProviderSetupRegistration,
} from "./registry";
import { PrismaDeviceProviderSetupStore } from "./store";
import type { MemberOwnedProviderSetupRecord } from "./types";

interface ProviderSetupDeletionStore {
  listMemberSetups(memberId: string): Promise<MemberOwnedProviderSetupRecord[]>;
  transition(
    input: Parameters<PrismaDeviceProviderSetupStore["transition"]>[0],
  ): Promise<MemberOwnedProviderSetupRecord>;
}

type ProviderSetupDeletionAdapter = Pick<
  MemberOwnedProviderSetupAdapter,
  "deleteOwnedApplication" | "ensureBrowserRun" | "pauseForUser"
>;

type ProviderSetupDeletionAdapterFactory = (
  registration: MemberOwnedProviderSetupRegistration,
) => ProviderSetupDeletionAdapter;

export async function deleteMemberOwnedProviderSetupExternalStateForAccountDeletion(input: {
  adapterFactory?: ProviderSetupDeletionAdapterFactory;
  memberId: string;
  prisma: PrismaClient;
  store?: ProviderSetupDeletionStore;
}): Promise<void> {
  const store = input.store ?? new PrismaDeviceProviderSetupStore(input.prisma);
  const setups = (await store.listMemberSetups(input.memberId))
    .filter((setup) => setup.active && setup.status !== "deleted");

  for (const setup of setups) {
    const registration = requireMemberOwnedProviderSetupRegistration(
      setup.provider,
    );
    const adapter = input.adapterFactory
      ? input.adapterFactory(registration)
      : registration.createAdapter({
          computer: new ComputerUseService({
            store: new PrismaComputerUseStore(input.prisma),
          }),
        });
    await deleteProviderSetup({ adapter, setup, store });
  }
}

async function deleteProviderSetup(input: {
  adapter: ProviderSetupDeletionAdapter;
  setup: MemberOwnedProviderSetupRecord;
  store: ProviderSetupDeletionStore;
}): Promise<void> {
  let deleting = input.setup.status === "deletion_pending"
    ? input.setup
    : await transitionDeletionState(input.store, input.setup, {
        lastErrorCode: null,
        status: "deletion_pending",
      });
  const run = await input.adapter.ensureBrowserRun({
    expectedRunId: deleting.browserRunId,
    memberId: deleting.memberId,
    setupId: deleting.id,
  });
  if (deleting.browserRunId !== run.runId) {
    deleting = await transitionDeletionState(input.store, deleting, {
      browserRunId: run.runId,
      lastErrorCode: null,
      status: "deletion_pending",
    });
  }
  if (run.status !== "running") {
    throw accountDeletionProviderHandoffRequired(null);
  }

  const result = await input.adapter.deleteOwnedApplication({
    memberId: deleting.memberId,
    runId: run.runId,
    setupId: deleting.id,
  });
  if (result.kind === "authentication_required") {
    const handoff = await input.adapter.pauseForUser({
      memberId: deleting.memberId,
      reason: result.reason,
      runId: run.runId,
      setupId: deleting.id,
    });
    throw accountDeletionProviderHandoffRequired(handoff.handoffUrl);
  }
  if (result.kind === "ambiguous") {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_PROVIDER_APPLICATION_AMBIGUOUS",
      httpStatus: 503,
      message: "Murph could not safely identify its private provider application. Retry account deletion after the provider page is stable.",
      retryable: true,
    });
  }

  // The exact deterministic marker is the only external deletion authority.
  // A missing app or an unrelated app is left untouched while local cleanup
  // continues from the fenced, retryable deletion state.
  await transitionDeletionState(input.store, deleting, {
    completedAt: new Date(),
    lastErrorCode: null,
    status: "deleted",
  });
}

function accountDeletionProviderHandoffRequired(
  handoffUrl: string | null,
) {
  return hostedOnboardingError({
    code: "ACCOUNT_DELETION_PROVIDER_HANDOFF_REQUIRED",
    details: {
      ...(handoffUrl ? { handoffUrl } : {}),
    },
    httpStatus: 409,
    message: "Continue the secure provider sign-in, then retry account deletion.",
    retryable: true,
  });
}

async function transitionDeletionState(
  store: ProviderSetupDeletionStore,
  setup: MemberOwnedProviderSetupRecord,
  update: {
    browserRunId?: string | null;
    completedAt?: Date | null;
    lastErrorCode?: string | null;
    status: "deleted" | "deletion_pending";
  },
): Promise<MemberOwnedProviderSetupRecord> {
  return store.transition({
    ...update,
    expectedVersion: setup.version,
    memberId: setup.memberId,
    provider: setup.provider,
    setupId: setup.id,
  });
}
