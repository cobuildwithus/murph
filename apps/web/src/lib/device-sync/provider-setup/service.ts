import "server-only";

import { deviceSyncError, isDeviceSyncError } from "@murphai/device-syncd/errors";
import type {
  HostedRuntimeProviderSetupToolRequest,
} from "@murphai/hosted-execution/provider-setup";

import { ComputerUseService } from "../../computer-use/service";
import {
  MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
} from "../../computer-use/store";
import { formatHostedExecutionSafeLogErrorDetails } from "../../hosted-execution/logging";
import { buildHostedDeviceSyncCallbackProof } from "../browser-callback-proof";
import { createHostedDeviceSyncPublicIngressService } from "../public-ingress-service";
import {
  deleteDeviceProviderApplicationForSetup,
  isRepairableDeviceProviderApplicationStateError,
  readDeviceProviderApplicationView,
  resolveDeviceProviderApplication,
  saveDeviceProviderApplication,
  type DeviceProviderApplicationBinding,
  type DeviceProviderApplicationView,
  type MemberOwnedDeviceProviderApplicationProvider,
  type ResolvedDeviceProviderApplication,
} from "../provider-applications";
import {
  buildMemberOwnedProviderSetupBrowserContract,
  requireMemberOwnedProviderSetupRegistration,
  type MemberOwnedProviderSetupBrowserContract,
  type MemberOwnedProviderSetupRegistration,
} from "./registry";
import { PrismaDeviceProviderSetupStore } from "./store";
import {
  readMemberOwnedProviderSetupBinding,
  toMemberOwnedProviderSetupView,
  type MemberOwnedProviderSetupConnectionDisposition,
  type MemberOwnedProviderSetupOAuthResult,
  type MemberOwnedProviderSetupRecord,
  type MemberOwnedProviderSetupStatus,
  type MemberOwnedProviderSetupView,
} from "./types";

const PROVIDER_SETUP_BROWSER_TIMEOUT_MS = 25_000;
const PROVIDER_SETUP_CAS_ATTEMPTS = 3;

type CaptureRequest = Extract<
  HostedRuntimeProviderSetupToolRequest,
  { action: "capture" }
>;
type DeleteRequest = Extract<
  HostedRuntimeProviderSetupToolRequest,
  { action: "delete" }
>;
type ConfirmMissingRequest = Extract<
  HostedRuntimeProviderSetupToolRequest,
  { action: "confirm_missing" }
>;

interface ProviderSetupStore {
  ensureActive(input: {
    connectSourceId: string;
    connectTarget: string;
    memberId: string;
    provider: MemberOwnedDeviceProviderApplicationProvider;
    sourceProviderSlug: string | null;
  }): Promise<MemberOwnedProviderSetupRecord>;
  listMemberSetups(memberId: string): Promise<MemberOwnedProviderSetupRecord[]>;
  markConnectedForExactApplication(input: {
    applicationId: string;
    memberId: string;
    provider: MemberOwnedDeviceProviderApplicationProvider;
    revision: number;
  }): Promise<MemberOwnedProviderSetupRecord | null>;
  markDisconnected(input: {
    memberId: string;
    provider: MemberOwnedDeviceProviderApplicationProvider;
  }): Promise<MemberOwnedProviderSetupRecord | null>;
  readActive(input: {
    memberId: string;
    provider: MemberOwnedDeviceProviderApplicationProvider;
  }): Promise<MemberOwnedProviderSetupRecord | null>;
  readConnectionDisposition(
    setup: MemberOwnedProviderSetupRecord,
  ): Promise<MemberOwnedProviderSetupConnectionDisposition>;
  readOwned(input: {
    memberId: string;
    provider: MemberOwnedDeviceProviderApplicationProvider;
    setupId: string;
  }): Promise<MemberOwnedProviderSetupRecord>;
  transition(
    input: Parameters<PrismaDeviceProviderSetupStore["transition"]>[0],
  ): Promise<MemberOwnedProviderSetupRecord>;
}

interface ProviderSetupComputer {
  acquireOwnedRun(input: {
    expectedRunId: string | null;
    memberId: string;
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
    startUrl: string;
  }): Promise<{
    awaitingReason: string | null;
    reused: boolean;
    runId: string;
    status: string;
  }>;
  actOwnedRun(input: {
    code: string;
    memberId: string;
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
    runId: string;
    timeoutMs: number;
  }): Promise<{ result: unknown; title: string | null; url: string | null }>;
  captureAndSealProviderCredentialsInOwnedRun<T>(input: {
    code: string;
    consume: (credentials: { clientId: string; clientSecret: string }) => Promise<T>;
    memberId: string;
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
    runId: string;
    timeoutMs: number;
  }): Promise<{ title: string | null; url: string | null; value: T }>;
  finishOwnedRun(input: {
    memberId: string;
    outcome: "canceled" | "completed";
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
    runId: string;
  }): Promise<{ ok: true; runId: string; status: string }>;
}

type ReadApplicationView = (input: {
  memberId: string;
  provider: MemberOwnedDeviceProviderApplicationProvider;
}) => Promise<DeviceProviderApplicationView | null>;
type ResolveApplication = (input: {
  applicationId: string;
  expectedRevision: number;
  memberId: string;
  provider: MemberOwnedDeviceProviderApplicationProvider;
}) => Promise<ResolvedDeviceProviderApplication>;
type SaveApplication = typeof saveDeviceProviderApplication;
type DeleteApplication = typeof deleteDeviceProviderApplicationForSetup;
interface ProviderSetupIngress {
  startConnectionWithProviderApplication(
    userId: string,
    binding: DeviceProviderApplicationBinding,
    returnTo: string | null,
    options: {
      connectSourceId?: string | null;
      connectTarget?: string | null;
      sourceProviderSlug?: string | null;
    },
  ): Promise<{ authorizationUrl: string; state: string }>;
}
type CreateIngress = (request: Request) => ProviderSetupIngress;

export interface MemberOwnedProviderSetupBrowserResult {
  contract: MemberOwnedProviderSetupBrowserContract;
  run: {
    awaitingReason: string | null;
    reused: boolean;
    runId: string;
    status: string;
  };
  setup: MemberOwnedProviderSetupView;
}

export class MemberOwnedProviderSetupService {
  private readonly computer: ProviderSetupComputer;
  private readonly createIngress: CreateIngress;
  private readonly deleteApplication: DeleteApplication;
  private readonly now: () => Date;
  private readonly readApplicationView: ReadApplicationView;
  private readonly registration: MemberOwnedProviderSetupRegistration;
  private readonly resolveApplication: ResolveApplication;
  private readonly saveApplication: SaveApplication;
  private readonly store: ProviderSetupStore;

  constructor(
    provider: MemberOwnedDeviceProviderApplicationProvider,
    input: {
      computer?: ProviderSetupComputer;
      createIngress?: CreateIngress;
      deleteApplication?: DeleteApplication;
      now?: () => Date;
      readApplicationView?: ReadApplicationView;
      registration?: MemberOwnedProviderSetupRegistration;
      resolveApplication?: ResolveApplication;
      saveApplication?: SaveApplication;
      store?: ProviderSetupStore;
    } = {},
  ) {
    this.registration = input.registration
      ?? requireMemberOwnedProviderSetupRegistration(provider);
    if (this.registration.coordinates.provider !== provider) {
      throw new TypeError("Member-owned provider setup metadata does not match its provider.");
    }
    this.computer = input.computer ?? new ComputerUseService();
    this.createIngress = input.createIngress
      ?? createHostedDeviceSyncPublicIngressService;
    this.deleteApplication = input.deleteApplication
      ?? deleteDeviceProviderApplicationForSetup;
    this.now = input.now ?? (() => new Date());
    this.readApplicationView = input.readApplicationView
      ?? readDeviceProviderApplicationView;
    this.resolveApplication = input.resolveApplication
      ?? resolveDeviceProviderApplication;
    this.saveApplication = input.saveApplication ?? saveDeviceProviderApplication;
    this.store = input.store ?? new PrismaDeviceProviderSetupStore();
  }

  async read(memberId: string): Promise<MemberOwnedProviderSetupView | null> {
    const setup = await this.store.readActive({
      memberId,
      provider: this.registration.coordinates.provider,
    });
    if (!setup) {
      return null;
    }
    return this.toView(await this.reconcile(setup, true));
  }

  async ensure(memberId: string): Promise<MemberOwnedProviderSetupRecord> {
    const setup = await this.store.ensureActive({
      connectSourceId: this.registration.coordinates.connectSourceId,
      connectTarget: this.registration.coordinates.connectTarget,
      memberId,
      provider: this.registration.coordinates.provider,
      sourceProviderSlug: this.registration.coordinates.sourceProviderSlug,
    });
    return this.reconcile(setup, true);
  }

  async authorize(
    memberId: string,
    expectedSetupId?: string,
  ): Promise<MemberOwnedProviderSetupView> {
    let setup = await this.requireSetup(memberId, expectedSetupId);
    setup = await this.reconcile(setup, true);
    if (
      setup.status === "connected"
      || setup.status === "disconnect_first"
      || setup.status === "oauth_ready"
      || setup.status === "oauth_in_progress"
      || setup.status === "browser_setup"
      || setup.status === "capturing"
      || setup.status === "canceling"
      || setup.status === "deletion_pending"
    ) {
      return this.toView(setup);
    }
    if (setup.status === "deleted") {
      throw setupInactiveError();
    }
    setup = await this.transition(setup, {
      completedAt: null,
      status: "authorized",
    });
    return this.toView(setup);
  }

  async beginBrowserSetup(memberId: string): Promise<MemberOwnedProviderSetupBrowserResult> {
    let setup = await this.requireSetup(memberId);
    setup = await this.reconcile(setup, true);
    if (setup.status === "pending" || setup.status === "canceled") {
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_MEMBER_AUTHORIZATION_REQUIRED",
        httpStatus: 409,
        message: "Open /connect and choose Continue before Murph starts provider setup.",
        retryable: false,
      });
    }
    if (setup.status === "disconnect_first") {
      throw disconnectFirstError(this.registration.presentation.providerName);
    }
    if (setup.status === "oauth_ready" || setup.status === "oauth_in_progress") {
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_OAUTH_READY",
        httpStatus: 409,
        message: "The private provider application is already ready for OAuth.",
        retryable: false,
      });
    }
    if (
      setup.status === "capturing"
      || setup.status === "canceling"
      || setup.status === "deletion_pending"
      || setup.status === "deleted"
    ) {
      throw setupBusyError(setup.status);
    }

    const contract = this.browserContract(setup.memberId);
    const run = await this.computer.acquireOwnedRun({
      expectedRunId: setup.browserRunId,
      memberId: setup.memberId,
      ownerKey: setup.id,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      startUrl: contract.developerPortalUrl,
    });
    if (setup.browserRunId !== run.runId || setup.status !== "browser_setup") {
      setup = await this.transition(setup, {
        browserRunId: run.runId,
        status: "browser_setup",
      });
    }

    return {
      contract,
      run,
      setup: this.toView(setup),
    };
  }

  async captureAndSeal(
    memberId: string,
    request: CaptureRequest,
  ): Promise<MemberOwnedProviderSetupView> {
    assertDistinctRuntimeSelectors([
      request.applicationRootSelector,
      request.clientIdSelector,
      request.clientSecretSelector,
      request.ownershipMarkerSelector,
      request.revealSecretSelector,
      request.submitSelector,
    ]);
    let setup = await this.requireExactBrowserSetup(memberId, request);
    if (readMemberOwnedProviderSetupBinding(setup)) {
      const disposition = await this.store.readConnectionDisposition(setup);
      if (disposition.kind !== "none") {
        throw disconnectFirstError(this.registration.presentation.providerName);
      }
    }
    setup = await this.transition(setup, { status: "capturing" });
    const captureVersion = setup.version;
    const binding = readMemberOwnedProviderSetupBinding(setup);
    const contract = this.browserContract(memberId);

    try {
      await this.computer.captureAndSealProviderCredentialsInOwnedRun({
        code: buildBlindProviderCredentialCaptureCode({
          applicationRootSelector: request.applicationRootSelector,
          clientIdSelector: request.clientIdSelector,
          clientSecretSelector: request.clientSecretSelector,
          marker: contract.application.marker,
          ownershipMarkerSelector: request.ownershipMarkerSelector,
          revealSecretSelector: request.revealSecretSelector,
          safeLandingUrl: contract.safeLandingUrl,
          submitSelector: request.submitSelector,
        }),
        consume: async (credentials) => {
          await this.saveApplication({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            expectedRevision: binding?.revision ?? null,
            memberId,
            provider: setup.provider,
            setupCapture: {
              expectedSetupVersion: captureVersion,
              runId: request.runId,
              setupId: request.setupId,
            },
          });
          return { sealed: true } as const;
        },
        memberId,
        ownerKey: setup.id,
        ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
        runId: request.runId,
        timeoutMs: PROVIDER_SETUP_BROWSER_TIMEOUT_MS,
      });
    } catch (error) {
      await this.restoreBrowserSetupAfterCaptureFailure(setup).catch(() => undefined);
      throw error;
    }

    const saved = await this.store.readOwned({
      memberId,
      provider: setup.provider,
      setupId: setup.id,
    });
    return this.toView(await this.releaseTerminalBrowserRun(saved));
  }

  async prepareDeletion(memberId: string): Promise<MemberOwnedProviderSetupBrowserResult> {
    let setup = await this.requireSetup(memberId);
    setup = await this.reconcile(setup, true);
    const binding = readMemberOwnedProviderSetupBinding(setup);
    if (!binding) {
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_APPLICATION_NOT_FOUND",
        httpStatus: 409,
        message: "No private provider application remains to delete.",
        retryable: false,
      });
    }
    const disposition = await this.store.readConnectionDisposition(setup);
    if (disposition.kind !== "none") {
      if (setup.status !== "disconnect_first") {
        setup = await this.transition(setup, { status: "disconnect_first" });
      }
      throw disconnectFirstError(this.registration.presentation.providerName);
    }
    if (setup.status !== "deletion_pending") {
      setup = await this.transition(setup, { status: "deletion_pending" });
    }
    const contract = this.browserContract(memberId);
    const run = await this.computer.acquireOwnedRun({
      expectedRunId: setup.browserRunId,
      memberId,
      ownerKey: setup.id,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      startUrl: contract.developerPortalUrl,
    });
    if (setup.browserRunId !== run.runId) {
      setup = await this.transition(setup, {
        browserRunId: run.runId,
        status: "deletion_pending",
      });
    }
    return {
      contract,
      run,
      setup: this.toView(setup),
    };
  }

  async deleteOwnedApplication(
    memberId: string,
    request: DeleteRequest,
  ): Promise<MemberOwnedProviderSetupView> {
    assertDistinctRuntimeSelectors([
      request.applicationRootSelector,
      request.completionSelector,
      request.confirmSelector,
      request.deleteSelector,
      request.ownershipMarkerSelector,
    ]);
    const setup = await this.requireExactDeletionSetup(memberId, request);
    const contract = this.browserContract(memberId);
    const result = await this.computer.actOwnedRun({
      code: buildBlindOwnedApplicationDeleteCode({
        applicationRootSelector: request.applicationRootSelector,
        completionSelector: request.completionSelector,
        confirmSelector: request.confirmSelector,
        deleteSelector: request.deleteSelector,
        marker: contract.application.marker,
        ownershipMarkerSelector: request.ownershipMarkerSelector,
        safeLandingUrl: contract.safeLandingUrl,
      }),
      memberId,
      ownerKey: setup.id,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: request.runId,
      timeoutMs: PROVIDER_SETUP_BROWSER_TIMEOUT_MS,
    });
    requireBrowserMutationResult(result.result, "deleted");
    return this.finishApplicationDeletion(setup, request.runId);
  }

  async confirmOwnedApplicationMissing(
    memberId: string,
    request: ConfirmMissingRequest,
  ): Promise<MemberOwnedProviderSetupView> {
    const setup = await this.requireExactDeletionSetup(memberId, request);
    const contract = this.browserContract(memberId);
    const result = await this.computer.actOwnedRun({
      code: buildBlindOwnedApplicationMissingProofCode({
        applicationsRootSelector: request.applicationsRootSelector,
        marker: contract.application.marker,
        safeLandingUrl: contract.safeLandingUrl,
      }),
      memberId,
      ownerKey: setup.id,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: request.runId,
      timeoutMs: PROVIDER_SETUP_BROWSER_TIMEOUT_MS,
    });
    requireBrowserMutationResult(result.result, "missing");
    return this.finishApplicationDeletion(setup, request.runId);
  }

  async cancel(memberId: string, setupId: string): Promise<MemberOwnedProviderSetupView> {
    let setup = await this.store.readOwned({
      memberId,
      provider: this.registration.coordinates.provider,
      setupId,
    });
    if (setup.status === "canceled") {
      return this.toView(setup);
    }
    if (setup.status === "canceling") {
      return this.finishCancellation(setup);
    }
    if (readMemberOwnedProviderSetupBinding(setup)) {
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_CANCELLATION_UNSAFE",
        httpStatus: 409,
        message: `Disconnect and remove the private ${this.registration.presentation.providerName} application instead of canceling this setup.`,
        retryable: false,
      });
    }
    if (
      setup.status === "oauth_ready"
      || setup.status === "oauth_in_progress"
      || setup.status === "connected"
      || setup.status === "disconnect_first"
      || setup.status === "deletion_pending"
      || setup.status === "deleted"
    ) {
      throw setupBusyError(setup.status);
    }
    setup = await this.transition(setup, { status: "canceling" });
    return this.finishCancellation(setup);
  }

  async startOAuth(input: {
    memberId: string;
    request: Request;
    returnTo: string;
    sessionId: string;
    setupId?: string;
  }): Promise<MemberOwnedProviderSetupOAuthResult> {
    let setup = await this.requireSetup(input.memberId, input.setupId);
    setup = await this.reconcile(setup, true);
    if (setup.status === "connected") {
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_ALREADY_CONNECTED",
        httpStatus: 409,
        message: `${this.registration.presentation.providerName} is already connected.`,
        retryable: false,
      });
    }
    if (setup.status === "disconnect_first") {
      throw disconnectFirstError(this.registration.presentation.providerName);
    }
    const binding = readMemberOwnedProviderSetupBinding(setup);
    if (!binding) {
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_NOT_READY",
        httpStatus: 409,
        message: `Finish private ${this.registration.presentation.providerName} application setup before continuing.`,
        retryable: false,
      });
    }
    await this.resolveApplication({
      applicationId: binding.applicationId,
      expectedRevision: binding.revision,
      memberId: input.memberId,
      provider: binding.provider,
    });
    if (setup.status !== "oauth_in_progress") {
      setup = await this.transition(setup, { status: "oauth_in_progress" });
    }

    const coordinates = this.registration.coordinates;
    const started = await this.createIngress(input.request)
      .startConnectionWithProviderApplication(
        input.memberId,
        binding,
        input.returnTo,
        {
          connectSourceId: coordinates.connectSourceId,
          connectTarget: coordinates.connectTarget,
          sourceProviderSlug: coordinates.sourceProviderSlug,
        },
      );
    const callbackProof = buildHostedDeviceSyncCallbackProof({
      memberId: input.memberId,
      provider: binding.provider,
      sessionId: input.sessionId,
      state: started.state,
    });
    return {
      authorizationUrl: started.authorizationUrl,
      callbackProofCookie: callbackProof.cookie,
      setup: this.toView(setup),
    };
  }

  async markConnected(input: {
    applicationId: string;
    memberId: string;
    revision: number;
  }): Promise<MemberOwnedProviderSetupView | null> {
    try {
      await this.store.markConnectedForExactApplication({
        applicationId: input.applicationId,
        memberId: input.memberId,
        provider: this.registration.coordinates.provider,
        revision: input.revision,
      });
      const setup = await this.store.readActive({
        memberId: input.memberId,
        provider: this.registration.coordinates.provider,
      });
      return setup ? this.toView(await this.reconcile(setup, false)) : null;
    } catch (error) {
      logProjectionFailure(error, this.registration.coordinates.provider, "oauth-callback");
      return null;
    }
  }

  async markDisconnected(memberId: string): Promise<MemberOwnedProviderSetupView | null> {
    try {
      const setup = await this.store.markDisconnected({
        memberId,
        provider: this.registration.coordinates.provider,
      });
      return setup ? this.toView(await this.reconcile(setup, false)) : null;
    } catch (error) {
      logProjectionFailure(error, this.registration.coordinates.provider, "disconnect");
      return null;
    }
  }

  private async finishApplicationDeletion(
    setup: MemberOwnedProviderSetupRecord,
    runId: string,
  ): Promise<MemberOwnedProviderSetupView> {
    const binding = readMemberOwnedProviderSetupBinding(setup);
    if (!binding) {
      throw setupInactiveError();
    }
    await this.deleteApplication({
      applicationId: binding.applicationId,
      expectedRevision: binding.revision,
      expectedSetupVersion: setup.version,
      memberId: setup.memberId,
      provider: setup.provider,
      runId,
      setupId: setup.id,
    });
    const deleted = await this.store.readOwned({
      memberId: setup.memberId,
      provider: setup.provider,
      setupId: setup.id,
    });
    return this.toView(await this.releaseTerminalBrowserRun(deleted));
  }

  private async finishCancellation(
    setup: MemberOwnedProviderSetupRecord,
  ): Promise<MemberOwnedProviderSetupView> {
    if (setup.browserRunId) {
      await this.computer.finishOwnedRun({
        memberId: setup.memberId,
        outcome: "canceled",
        ownerKey: setup.id,
        ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
        runId: setup.browserRunId,
      });
    }
    const canceled = await this.transition(setup, {
      browserRunId: null,
      completedAt: this.now(),
      status: "canceled",
    });
    return this.toView(canceled);
  }

  private async releaseTerminalBrowserRun(
    setup: MemberOwnedProviderSetupRecord,
  ): Promise<MemberOwnedProviderSetupRecord> {
    const runId = setup.browserRunId;
    if (!runId) {
      return setup;
    }
    if (setup.status !== "oauth_ready" && setup.status !== "deleted") {
      throw setupBusyError(setup.status);
    }
    await this.computer.finishOwnedRun({
      memberId: setup.memberId,
      outcome: "completed",
      ownerKey: setup.id,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId,
    });

    let latest = setup;
    for (let attempt = 0; attempt < PROVIDER_SETUP_CAS_ATTEMPTS; attempt += 1) {
      if (latest.browserRunId === null) {
        return latest;
      }
      if (latest.browserRunId !== runId || latest.status !== setup.status) {
        throw setupBusyError(latest.status);
      }
      try {
        return await this.transition(latest, {
          browserRunId: null,
          status: latest.status,
        });
      } catch (error) {
        if (!isDeviceSyncError(error) || error.code !== "DEVICE_PROVIDER_SETUP_CONFLICT") {
          throw error;
        }
        latest = await this.store.readOwned({
          memberId: setup.memberId,
          provider: setup.provider,
          setupId: setup.id,
        });
      }
    }
    throw setupBusyError(latest.status);
  }

  private async restoreBrowserSetupAfterCaptureFailure(
    capturing: MemberOwnedProviderSetupRecord,
  ): Promise<void> {
    const latest = await this.store.readOwned({
      memberId: capturing.memberId,
      provider: capturing.provider,
      setupId: capturing.id,
    });
    if (latest.status !== "capturing") {
      return;
    }
    await this.transition(latest, { status: "browser_setup" });
  }

  private async requireExactBrowserSetup(
    memberId: string,
    request: Pick<CaptureRequest, "provider" | "runId" | "setupId">,
  ): Promise<MemberOwnedProviderSetupRecord> {
    const provider = this.registration.coordinates.provider;
    if (request.provider !== provider) {
      throw setupNotFoundError();
    }
    const setup = await this.store.readOwned({ memberId, provider, setupId: request.setupId });
    if (
      setup.status !== "browser_setup"
      || setup.browserRunId !== request.runId
    ) {
      throw setupBusyError(setup.status);
    }
    return setup;
  }

  private async requireExactDeletionSetup(
    memberId: string,
    request: Pick<DeleteRequest, "provider" | "runId" | "setupId">,
  ): Promise<MemberOwnedProviderSetupRecord> {
    const provider = this.registration.coordinates.provider;
    if (request.provider !== provider) {
      throw setupNotFoundError();
    }
    const setup = await this.store.readOwned({ memberId, provider, setupId: request.setupId });
    if (
      setup.status !== "deletion_pending"
      || setup.browserRunId !== request.runId
      || !readMemberOwnedProviderSetupBinding(setup)
    ) {
      throw setupBusyError(setup.status);
    }
    return setup;
  }

  private async requireSetup(
    memberId: string,
    expectedSetupId?: string,
  ): Promise<MemberOwnedProviderSetupRecord> {
    const setup = expectedSetupId
      ? await this.store.readOwned({
          memberId,
          provider: this.registration.coordinates.provider,
          setupId: expectedSetupId,
        })
      : await this.ensure(memberId);
    if (!setup.active || setup.status === "deleted") {
      throw setupInactiveError();
    }
    return setup;
  }

  private async reconcile(
    input: MemberOwnedProviderSetupRecord,
    persist: boolean,
  ): Promise<MemberOwnedProviderSetupRecord> {
    let setup = await this.recoverApplicationBinding(input, persist);
    if (
      persist
      && setup.browserRunId
      && (setup.status === "oauth_ready" || setup.status === "deleted")
    ) {
      setup = await this.releaseTerminalBrowserRun(setup);
    }
    if (
      setup.status === "canceling"
      || setup.status === "canceled"
      || setup.status === "capturing"
      || setup.status === "deletion_pending"
      || setup.status === "deleted"
    ) {
      return setup;
    }

    const disposition = await this.store.readConnectionDisposition(setup);
    const connectionStatus = resolveConnectionStatus(disposition);
    if (connectionStatus) {
      return this.persistDerivedStatus(setup, connectionStatus, persist);
    }

    const binding = readMemberOwnedProviderSetupBinding(setup);
    if (binding) {
      try {
        await this.resolveApplication({
          applicationId: binding.applicationId,
          expectedRevision: binding.revision,
          memberId: setup.memberId,
          provider: binding.provider,
        });
        if (
          setup.status !== "browser_setup"
          && setup.status !== "oauth_in_progress"
        ) {
          return this.persistDerivedStatus(setup, "oauth_ready", persist);
        }
      } catch (error) {
        if (!isRepairableDeviceProviderApplicationStateError(error)) {
          throw error;
        }
        if (setup.status !== "browser_setup") {
          return this.persistDerivedStatus(setup, "authorized", persist);
        }
      }
    } else if (setup.status === "connected" || setup.status === "disconnect_first") {
      return this.persistDerivedStatus(setup, "pending", persist);
    }
    return setup;
  }

  private async recoverApplicationBinding(
    setup: MemberOwnedProviderSetupRecord,
    persist: boolean,
  ): Promise<MemberOwnedProviderSetupRecord> {
    if (readMemberOwnedProviderSetupBinding(setup) || setup.status === "deleted") {
      return setup;
    }
    const application = await this.readApplicationView({
      memberId: setup.memberId,
      provider: setup.provider,
    });
    if (!application) {
      return setup;
    }
    const recovered = {
      ...setup,
      providerApplicationId: application.applicationId,
      providerApplicationRevision: application.revision,
      status: "oauth_ready" as const,
      updatedAt: this.now(),
    };
    return persist
      ? this.transition(setup, {
          providerApplicationId: application.applicationId,
          providerApplicationRevision: application.revision,
          status: "oauth_ready",
        })
      : recovered;
  }

  private persistDerivedStatus(
    setup: MemberOwnedProviderSetupRecord,
    status: "authorized" | "connected" | "disconnect_first" | "oauth_ready" | "pending",
    persist: boolean,
  ): Promise<MemberOwnedProviderSetupRecord> | MemberOwnedProviderSetupRecord {
    if (setup.status === status) {
      return setup;
    }
    if (!persist) {
      return {
        ...setup,
        completedAt: status === "connected" ? setup.completedAt ?? this.now() : null,
        status,
        updatedAt: this.now(),
      };
    }
    return this.transition(setup, {
      completedAt: status === "connected" ? setup.completedAt ?? this.now() : null,
      status,
    });
  }

  private transition(
    setup: MemberOwnedProviderSetupRecord,
    input: {
      active?: boolean;
      browserRunId?: string | null;
      completedAt?: Date | null;
      providerApplicationId?: string | null;
      providerApplicationRevision?: number | null;
      status: MemberOwnedProviderSetupStatus;
    },
  ): Promise<MemberOwnedProviderSetupRecord> {
    return this.store.transition({
      ...input,
      expectedVersion: setup.version,
      memberId: setup.memberId,
      provider: setup.provider,
      setupId: setup.id,
    });
  }

  private browserContract(memberId: string): MemberOwnedProviderSetupBrowserContract {
    return buildMemberOwnedProviderSetupBrowserContract({
      memberId,
      provider: this.registration.coordinates.provider,
      registration: this.registration,
    });
  }

  private toView(setup: MemberOwnedProviderSetupRecord): MemberOwnedProviderSetupView {
    return toMemberOwnedProviderSetupView(setup, this.registration.presentation);
  }
}

export function createMemberOwnedProviderSetupService(
  provider: MemberOwnedDeviceProviderApplicationProvider,
): MemberOwnedProviderSetupService {
  return new MemberOwnedProviderSetupService(provider);
}

export function buildBlindProviderCredentialCaptureCode(input: {
  applicationRootSelector: string;
  clientIdSelector: string;
  clientSecretSelector: string;
  marker: string;
  ownershipMarkerSelector: string;
  revealSecretSelector: string | null;
  safeLandingUrl: string;
  submitSelector: string | null;
}): string {
  return `
const exactVisible = async (selector, label) => {
  const locator = page.locator(selector);
  await locator.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  const count = await locator.count();
  if (count !== 1 || !await locator.isVisible().catch(() => false)) {
    throw new Error(label + " must resolve to one visible element");
  }
  return locator;
};
const root = await exactVisible(${JSON.stringify(input.applicationRootSelector)}, "application root selector");
const exactVisibleInRoot = async (selector, label) => {
  const locator = root.locator(selector);
  await locator.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  const count = await locator.count();
  if (count !== 1 || !await locator.isVisible().catch(() => false)) {
    throw new Error(label + " must resolve to one visible owned-application element");
  }
  return locator;
};
const readField = async (locator) => {
  const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
  if (tag === "input" || tag === "textarea") {
    return (await locator.inputValue()).trim();
  }
  return ((await locator.textContent()) ?? "").trim();
};
${input.submitSelector ? `await (await exactVisibleInRoot(${JSON.stringify(input.submitSelector)}, "submit selector")).click();` : ""}
const marker = await exactVisibleInRoot(${JSON.stringify(input.ownershipMarkerSelector)}, "ownership marker selector");
await marker.waitFor({ state: "visible", timeout: 15000 });
if (await readField(marker) !== ${JSON.stringify(input.marker)}) {
  throw new Error("provider application ownership marker mismatch");
}
${input.revealSecretSelector ? `await (await exactVisibleInRoot(${JSON.stringify(input.revealSecretSelector)}, "secret reveal selector")).click();` : ""}
const clientId = await readField(await exactVisibleInRoot(${JSON.stringify(input.clientIdSelector)}, "client id selector"));
const clientSecret = await readField(await exactVisibleInRoot(${JSON.stringify(input.clientSecretSelector)}, "client secret selector"));
if (!clientId || !clientSecret) {
  throw new Error("provider credentials are unavailable");
}
await page.goto(${JSON.stringify(input.safeLandingUrl)}, { waitUntil: "domcontentloaded" });
return { clientId, clientSecret };
`;
}

export function buildBlindOwnedApplicationDeleteCode(input: {
  applicationRootSelector: string;
  completionSelector: string | null;
  confirmSelector: string | null;
  deleteSelector: string;
  marker: string;
  ownershipMarkerSelector: string;
  safeLandingUrl: string;
}): string {
  return `
const exactVisible = async (selector, label) => {
  const locator = page.locator(selector);
  await locator.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  const count = await locator.count();
  if (count !== 1 || !await locator.isVisible().catch(() => false)) {
    throw new Error(label + " must resolve to one visible element");
  }
  return locator;
};
const readField = async (locator) => {
  const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
  if (tag === "input" || tag === "textarea") {
    return (await locator.inputValue()).trim();
  }
  return ((await locator.textContent()) ?? "").trim();
};
const root = await exactVisible(${JSON.stringify(input.applicationRootSelector)}, "application root selector");
const exactVisibleInRoot = async (selector, label) => {
  const locator = root.locator(selector);
  await locator.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  const count = await locator.count();
  if (count !== 1 || !await locator.isVisible().catch(() => false)) {
    throw new Error(label + " must resolve to one visible owned-application element");
  }
  return locator;
};
const marker = await exactVisibleInRoot(${JSON.stringify(input.ownershipMarkerSelector)}, "ownership marker selector");
const markerText = await readField(marker);
if (markerText !== ${JSON.stringify(input.marker)}) {
  throw new Error("provider application ownership marker mismatch");
}
await (await exactVisibleInRoot(${JSON.stringify(input.deleteSelector)}, "delete selector")).click();
${input.confirmSelector ? `await (await exactVisible(${JSON.stringify(input.confirmSelector)}, "delete confirmation selector")).click();` : ""}
${input.completionSelector
    ? `await (await exactVisible(${JSON.stringify(input.completionSelector)}, "deletion completion selector")).waitFor({ state: "visible", timeout: 15000 });`
    : `await marker.waitFor({ state: "detached", timeout: 15000 });`}
await page.goto(${JSON.stringify(input.safeLandingUrl)}, { waitUntil: "domcontentloaded" });
return { kind: "deleted" };
`;
}

export function buildBlindOwnedApplicationMissingProofCode(input: {
  applicationsRootSelector: string;
  marker: string;
  safeLandingUrl: string;
}): string {
  return `
const root = page.locator(${JSON.stringify(input.applicationsRootSelector)});
if (await root.count() !== 1 || !await root.isVisible().catch(() => false)) {
  throw new Error("applications root selector must resolve to one visible element");
}
const markerPresent = await root.evaluate((element, expectedMarker) => {
  const values = [element.textContent || ""];
  for (const field of element.querySelectorAll("input, textarea")) {
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      values.push(field.value);
    }
  }
  return values.some((value) => value.trim() === expectedMarker);
}, ${JSON.stringify(input.marker)});
if (markerPresent) {
  throw new Error("owned provider application is still present");
}
await page.goto(${JSON.stringify(input.safeLandingUrl)}, { waitUntil: "domcontentloaded" });
return { kind: "missing" };
`;
}

function requireBrowserMutationResult(
  value: unknown,
  expectedKind: "deleted" | "missing",
): void {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 1
    || Reflect.get(value, "kind") !== expectedKind
  ) {
    throw deviceSyncError({
      code: "DEVICE_PROVIDER_SETUP_BROWSER_RESULT_INVALID",
      httpStatus: 502,
      message: "Provider browser cleanup returned an invalid non-secret result.",
      retryable: true,
    });
  }
}

function assertDistinctRuntimeSelectors(
  selectors: readonly (string | null)[],
): void {
  const present = selectors.filter((selector): selector is string => selector !== null);
  if (new Set(present).size === present.length) {
    return;
  }
  throw deviceSyncError({
    code: "DEVICE_PROVIDER_SETUP_SELECTOR_CONFLICT",
    httpStatus: 400,
    message: "Provider setup controls must use distinct live-page selectors.",
    retryable: false,
  });
}

function resolveConnectionStatus(
  disposition: MemberOwnedProviderSetupConnectionDisposition,
): "connected" | "disconnect_first" | "oauth_ready" | null {
  switch (disposition.kind) {
    case "none":
      return null;
    case "conflict":
      return "disconnect_first";
    case "exact":
      return disposition.status === "active" ? "connected" : "oauth_ready";
  }
}

function setupInactiveError() {
  return deviceSyncError({
    code: "DEVICE_PROVIDER_SETUP_INACTIVE",
    httpStatus: 410,
    message: "This private provider setup is no longer active.",
    retryable: false,
  });
}

function setupNotFoundError() {
  return deviceSyncError({
    code: "DEVICE_PROVIDER_SETUP_NOT_FOUND",
    httpStatus: 404,
    message: "Private provider setup was not found for the current member.",
    retryable: false,
  });
}

function setupBusyError(status: string) {
  return deviceSyncError({
    code: "DEVICE_PROVIDER_SETUP_STATE_CONFLICT",
    details: { status },
    httpStatus: 409,
    message: "Private provider setup changed. Read its current state before continuing.",
    retryable: false,
  });
}

function disconnectFirstError(providerName: string) {
  return deviceSyncError({
    code: "DEVICE_PROVIDER_SETUP_DISCONNECT_FIRST",
    httpStatus: 409,
    message: `Disconnect ${providerName} first before changing its private application.`,
    retryable: false,
  });
}

function logProjectionFailure(
  error: unknown,
  provider: MemberOwnedDeviceProviderApplicationProvider,
  operation: string,
): void {
  console.warn("Member-owned provider setup projection update failed.", {
    ...formatHostedExecutionSafeLogErrorDetails(error, {
      code: "DEVICE_PROVIDER_SETUP_PROJECTION_UPDATE_FAILED",
    }),
    operation,
    provider,
  });
}
