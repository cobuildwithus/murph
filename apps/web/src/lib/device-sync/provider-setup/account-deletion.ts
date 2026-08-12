import "server-only";

import type { PrismaClient } from "@prisma/client";

import { ComputerUseService } from "../../computer-use/service";
import { PrismaComputerUseStore } from "../../computer-use/store";
import { hostedOnboardingError } from "../../hosted-onboarding/errors";
import {
  readDeviceProviderApplicationView,
  type DeviceProviderApplicationView,
} from "../provider-applications";
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
  "cancelBrowserRun" | "deleteOwnedApplication" | "ensureBrowserRun" | "pauseForUser"
>;

type ProviderSetupDeletionAdapterFactory = (
  registration: MemberOwnedProviderSetupRegistration,
) => ProviderSetupDeletionAdapter;

type ReadProviderApplicationView = (input: {
  memberId: string;
  provider: MemberOwnedProviderSetupRecord["provider"];
}) => Promise<DeviceProviderApplicationView | null>;

export async function deleteMemberOwnedProviderSetupExternalStateForAccountDeletion(input: {
  adapterFactory?: ProviderSetupDeletionAdapterFactory;
  memberId: string;
  prisma: PrismaClient;
  readApplicationView?: ReadProviderApplicationView;
  store?: ProviderSetupDeletionStore;
}): Promise<void> {
  const store = input.store ?? new PrismaDeviceProviderSetupStore(input.prisma);
  const setups = (await store.listMemberSetups(input.memberId))
    .filter((setup) => setup.active && setup.status !== "deleted");

  for (const setup of setups) {
    const needsAbsenceProof = setup.providerApplicationId === null
      && setup.providerApplicationRevision === null
      && setup.providerSubmissionAt === null
      && (setup.status === "pending" || setup.status === "canceled");
    const application = needsAbsenceProof
      ? await (input.readApplicationView
          ?? ((query) => readDeviceProviderApplicationView({
            ...query,
            prisma: input.prisma,
          }))
        )({
          memberId: setup.memberId,
          provider: setup.provider,
        })
      : null;
    // Only pre-work or durably canceled setup states can prove that no
    // provider application exists without inspecting the provider dashboard.
    if (
      application === null
      && needsAbsenceProof
    ) {
      await transitionDeletionState(store, setup, {
        completedAt: new Date(),
        lastErrorCode: null,
        status: "deleted",
      });
      continue;
    }

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
  if (run.status === "awaiting_user") {
    const handoff = await input.adapter.pauseForUser({
      memberId: deleting.memberId,
      reason: run.awaitingReason === "login_needed" ? "signed_out" : "challenge",
      runId: run.runId,
      setupId: deleting.id,
    });
    throw accountDeletionProviderHandoffRequired(handoff.handoffUrl);
  }
  if (run.status !== "running") {
    throw accountDeletionProviderBrowserCleanupIncomplete();
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

  const runStatus = await input.adapter.cancelBrowserRun({
    memberId: deleting.memberId,
    runId: run.runId,
    setupId: deleting.id,
  });
  if (runStatus !== "canceled") {
    throw accountDeletionProviderBrowserCleanupIncomplete();
  }

  // The exact deterministic marker is the only external deletion authority.
  // A missing app or an unrelated app is left untouched while local cleanup
  // continues from the fenced, retryable deletion state.
  await transitionDeletionState(input.store, deleting, {
    browserRunId: null,
    completedAt: new Date(),
    lastErrorCode: null,
    status: "deleted",
  });
}

function accountDeletionProviderBrowserCleanupIncomplete() {
  return hostedOnboardingError({
    code: "ACCOUNT_DELETION_PROVIDER_BROWSER_CLEANUP_INCOMPLETE",
    httpStatus: 503,
    message: "Murph could not finish the private provider cleanup browser safely. Retry account deletion.",
    retryable: true,
  });
}

function accountDeletionProviderHandoffRequired(
  handoffUrl: string | null,
) {
  if (!handoffUrl) {
    return accountDeletionProviderBrowserCleanupIncomplete();
  }
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
