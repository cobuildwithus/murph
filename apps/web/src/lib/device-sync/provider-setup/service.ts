import "server-only";

import { deviceSyncError, isDeviceSyncError } from "@murphai/device-syncd/errors";
import type { HostedRuntimeProviderSetupToolRequest } from "@murphai/hosted-execution/provider-setup";

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
  requireResolvedDeviceProviderApplicationClientId,
  resolveDeviceProviderApplication,
  saveDeviceProviderApplication,
  type DeviceProviderApplicationBinding,
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
  assertMemberOwnedProviderSetupContinuationAllowed,
  requestMemberOwnedProviderSetupContinuation,
} from "./continuation";
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
interface ProviderSetupStore {
  beginDeletion(
    expected: MemberOwnedProviderSetupRecord,
  ): Promise<{
    kind: "connection_conflict" | "ready";
    setup: MemberOwnedProviderSetupRecord;
  }>;
  ensureActive(input: {
    connectSourceId: string;
    connectTarget: string;
    memberId: string;
    provider: MemberOwnedDeviceProviderApplicationProvider;
    sourceProviderSlug: string | null;
  }): Promise<MemberOwnedProviderSetupRecord>;
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
    admitRun: (runId: string) => Promise<void>;
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
  hasOwnedRunHandoff(input: {
    memberId: string;
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
    runId: string;
  }): Promise<boolean>;
  issueOwnedRunHandoff(input: {
    memberId: string;
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
    runId: string;
  }): Promise<string>;
  reconcileOwnedBrowserProvisioningRun(input: {
    memberId: string;
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
    runId: string;
  }): Promise<"bound" | "cleanup_pending" | "settled">;
}

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
  private readonly registration: MemberOwnedProviderSetupRegistration;
  private readonly resolveApplication: ResolveApplication;
  private readonly saveApplication: SaveApplication;
  private readonly store: ProviderSetupStore;
  private readonly assertContinuationAllowed:
    typeof assertMemberOwnedProviderSetupContinuationAllowed;
  private readonly requestContinuation: typeof requestMemberOwnedProviderSetupContinuation;

  constructor(
    provider: MemberOwnedDeviceProviderApplicationProvider,
    input: {
      computer?: ProviderSetupComputer;
      createIngress?: CreateIngress;
      deleteApplication?: DeleteApplication;
      now?: () => Date;
      registration?: MemberOwnedProviderSetupRegistration;
      assertContinuationAllowed?: typeof assertMemberOwnedProviderSetupContinuationAllowed;
      requestContinuation?: typeof requestMemberOwnedProviderSetupContinuation;
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
    this.resolveApplication = input.resolveApplication
      ?? resolveDeviceProviderApplication;
    this.assertContinuationAllowed = input.assertContinuationAllowed
      ?? assertMemberOwnedProviderSetupContinuationAllowed;
    this.requestContinuation = input.requestContinuation
      ?? requestMemberOwnedProviderSetupContinuation;
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
    const reconciled = await this.reconcile(setup, true);
    return this.toView(reconciled, await this.hasHandoff(reconciled));
  }

  async validateContinuation(input: {
    expectedSetupId: string;
    expectedSetupVersion: number;
    memberId: string;
  }): Promise<boolean> {
    const setup = await this.store.readActive({
      memberId: input.memberId,
      provider: this.registration.coordinates.provider,
    });
    if (!setup || setup.id !== input.expectedSetupId) {
      return false;
    }
    if (setup.status === "authorized") {
      return setup.version === input.expectedSetupVersion;
    }
    return setup.version >= input.expectedSetupVersion
      && setup.status === "browser_setup";
  }

  async reconcileConsentWithdrawal(
    memberId: string,
  ): Promise<MemberOwnedProviderSetupView | null> {
    const setup = await this.store.readActive({
      memberId,
      provider: this.registration.coordinates.provider,
    });
    if (!setup) {
      return null;
    }
    if (
      setup.status === "authorized"
      || setup.status === "browser_setup"
      || setup.status === "canceling"
    ) {
      return await this.cancel(memberId, setup.id);
    }
    if (
      setup.status === "connected"
      || setup.status === "disconnect_first"
      || setup.status === "oauth_in_progress"
    ) {
      return await this.markDisconnected(memberId);
    }
    return this.toView(setup);
  }

  async issueHandoff(
    memberId: string,
    expectedSetupId: string,
  ): Promise<string> {
    const setup = await this.requireSetup(memberId, expectedSetupId);
    if (!setup.browserRunId) {
      throw setupBusyError(setup.status);
    }
    return await this.computer.issueOwnedRunHandoff({
      memberId,
      ownerKey: setup.id,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: setup.browserRunId,
    });
  }

  async ensure(memberId: string): Promise<MemberOwnedProviderSetupRecord> {
    const input = {
      connectSourceId: this.registration.coordinates.connectSourceId,
      connectTarget: this.registration.coordinates.connectTarget,
      memberId,
      provider: this.registration.coordinates.provider,
      sourceProviderSlug: this.registration.coordinates.sourceProviderSlug,
    };
    const setup = await this.reconcile(
      await this.store.ensureActive(input),
      true,
    );
    return setup.active ? setup : this.store.ensureActive(input);
  }

  async authorize(
    memberId: string,
    expectedSetupId?: string,
  ): Promise<MemberOwnedProviderSetupView> {
    let setup = await this.requireSetup(memberId, expectedSetupId);
    setup = await this.reconcile(setup, true);
    if (
      setup.status === "authorized"
      || setup.status === "connected"
      || setup.status === "disconnect_first"
      || setup.status === "oauth_ready"
      || setup.status === "oauth_in_progress"
      || setup.status === "browser_setup"
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

  async authorizeAndContinue(
    memberId: string,
    expectedSetupId?: string,
  ): Promise<MemberOwnedProviderSetupView> {
    let setup = await this.requireSetup(memberId, expectedSetupId);
    setup = await this.reconcile(setup, true);
    let continuationAdmissionProven = false;
    const retryableStatus = setup.status === "pending" || setup.status === "canceled"
      ? {
          completedAt: setup.completedAt,
          status: setup.status,
        }
      : null;
    if (setup.status === "pending" || setup.status === "canceled") {
      await this.assertContinuationAllowed(memberId);
      continuationAdmissionProven = true;
      setup = await this.transition(setup, {
        completedAt: null,
        status: "authorized",
      });
    }
    if (
      setup.status === "authorized"
      || setup.status === "browser_setup"
    ) {
      if (!continuationAdmissionProven) {
        await this.assertContinuationAllowed(memberId);
      }
      try {
        await this.requestContinuation({
          handoffId: null,
          memberId,
          provider: setup.provider,
          runId: null,
          setupId: setup.id,
          setupVersion: setup.version,
        });
      } catch (error) {
        if (retryableStatus) {
          const latest = await this.store.readOwned({
            memberId,
            provider: setup.provider,
            setupId: setup.id,
          });
          if (
            latest.status === "authorized"
            && latest.version === setup.version
          ) {
            await this.transition(latest, retryableStatus);
          }
        }
        throw error;
      }
    }
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
      setup.status === "canceling"
      || setup.status === "deletion_pending"
      || setup.status === "deleted"
    ) {
      throw setupBusyError(setup.status);
    }

    const contract = this.browserContract();
    const acquired = await this.acquireBrowserRun(
      setup,
      "browser_setup",
      contract.developerPortalUrl,
    );
    setup = acquired.setup;

    return {
      contract,
      run: acquired.run,
      setup: this.toView(setup),
    };
  }

  async captureAndSeal(
    memberId: string,
    request: CaptureRequest,
  ): Promise<MemberOwnedProviderSetupView> {
    const setup = await this.requireExactBrowserSetup(memberId, request);
    if (readMemberOwnedProviderSetupBinding(setup)) {
      const disposition = await this.store.readConnectionDisposition(setup);
      if (disposition.kind !== "none") {
        throw disconnectFirstError(this.registration.presentation.providerName);
      }
    }
    const captureVersion = setup.version;
    const binding = readMemberOwnedProviderSetupBinding(setup);
    const authority = this.registration.browser.trustedAuthority;

    await this.computer.captureAndSealProviderCredentialsInOwnedRun({
      code: buildBlindProviderCredentialCaptureCode({
        clientIdSelector: authority.clientIdSelector,
        clientSecretSelector: authority.clientSecretSelector,
        credentialsPageUrl: authority.credentialsPageUrl,
        revealSecretSelector: authority.revealSecretSelector,
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
    const deletion = await this.store.beginDeletion(setup);
    setup = deletion.setup;
    if (deletion.kind === "connection_conflict") {
      throw disconnectFirstError(this.registration.presentation.providerName);
    }
    const contract = this.browserContract();
    const acquired = await this.acquireBrowserRun(
      setup,
      "deletion_pending",
      contract.credentialsPageUrl,
    );
    setup = acquired.setup;
    return {
      contract,
      run: acquired.run,
      setup: this.toView(setup),
    };
  }

  async deleteOwnedApplication(
    memberId: string,
    request: DeleteRequest,
  ): Promise<MemberOwnedProviderSetupView> {
    assertDistinctRuntimeSelectors([
      request.confirmSelector,
      request.deleteSelector,
    ]);
    const setup = await this.requireExactDeletionSetup(memberId, request);
    const disposition = await this.store.readConnectionDisposition(setup);
    if (disposition.kind !== "none") {
      await this.transition(setup, { status: "disconnect_first" });
      throw disconnectFirstError(this.registration.presentation.providerName);
    }
    const binding = readMemberOwnedProviderSetupBinding(setup);
    if (!binding) {
      throw new TypeError("Private provider setup application binding is missing.");
    }
    const application = await this.resolveApplication({
      applicationId: binding.applicationId,
      expectedRevision: binding.revision,
      memberId,
      provider: binding.provider,
    });
    const authority = this.registration.browser.trustedAuthority;
    const result = await this.computer.actOwnedRun({
      code: buildBlindOwnedApplicationDeleteCode({
        clientIdSelector: authority.clientIdSelector,
        confirmSelector: request.confirmSelector,
        credentialsPageUrl: authority.credentialsPageUrl,
        deleteSelector: request.deleteSelector,
        expectedClientId:
          requireResolvedDeviceProviderApplicationClientId(application),
      }),
      memberId,
      ownerKey: setup.id,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: request.runId,
      timeoutMs: PROVIDER_SETUP_BROWSER_TIMEOUT_MS,
    });
    requireBrowserMutationResult(result.result);
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
      return this.toView(await this.settleCancellation(setup));
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
    return this.toView(await this.settleCancellation(setup));
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
    if (setup.status !== "oauth_ready" && setup.status !== "oauth_in_progress") {
      throw setupBusyError(setup.status);
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

  private async settleCancellation(
    setup: MemberOwnedProviderSetupRecord,
  ): Promise<MemberOwnedProviderSetupRecord> {
    if (setup.browserRunId) {
      const finished = await this.computer.finishOwnedRun({
        memberId: setup.memberId,
        outcome: "canceled",
        ownerKey: setup.id,
        ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
        runId: setup.browserRunId,
      });
      if (finished.status === "cleanup_pending") {
        return setup;
      }
    }
    return this.transition(setup, {
      browserRunId: null,
      completedAt: this.now(),
      status: "canceled",
    });
  }

  private async releaseTerminalBrowserRun(
    setup: MemberOwnedProviderSetupRecord,
  ): Promise<MemberOwnedProviderSetupRecord> {
    const runId = setup.browserRunId;
    if (setup.status !== "oauth_ready" && setup.status !== "deleted") {
      throw setupBusyError(setup.status);
    }
    if (runId) {
      await this.computer.finishOwnedRun({
        memberId: setup.memberId,
        outcome: "completed",
        ownerKey: setup.id,
        ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
        runId,
      });
    }

    let latest = setup;
    for (let attempt = 0; attempt < PROVIDER_SETUP_CAS_ATTEMPTS; attempt += 1) {
      if (
        latest.browserRunId === null
        && (latest.status !== "deleted" || !latest.active)
      ) {
        return latest;
      }
      if (
        (latest.browserRunId !== null && latest.browserRunId !== runId)
        || latest.status !== setup.status
      ) {
        throw setupBusyError(latest.status);
      }
      try {
        return await this.transition(latest, {
          ...(latest.status === "deleted" ? { active: false } : {}),
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
    let setup = input;
    if (
      persist
      && (
        setup.status === "deleted"
        || (setup.status === "oauth_ready" && setup.browserRunId !== null)
      )
    ) {
      setup = await this.releaseTerminalBrowserRun(setup);
    }
    if (persist && setup.status === "canceling") {
      setup = await this.settleCancellation(setup);
    }
    if (
      setup.status === "canceling"
      || setup.status === "canceled"
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

  private async acquireBrowserRun(
    input: MemberOwnedProviderSetupRecord,
    status: "browser_setup" | "deletion_pending",
    startUrl: string,
  ): Promise<{
    run: Awaited<ReturnType<ProviderSetupComputer["acquireOwnedRun"]>>;
    setup: MemberOwnedProviderSetupRecord;
  }> {
    let setup = input;
    const run = await this.computer.acquireOwnedRun({
      admitRun: async (runId) => {
        setup = await this.transition(setup, { browserRunId: runId, status });
      },
      expectedRunId: setup.browserRunId,
      memberId: setup.memberId,
      ownerKey: setup.id,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      startUrl,
    });
    if (setup.browserRunId !== run.runId) {
      throw setupBusyError(setup.status);
    }
    return { run, setup };
  }

  private browserContract(): MemberOwnedProviderSetupBrowserContract {
    return buildMemberOwnedProviderSetupBrowserContract({
      provider: this.registration.coordinates.provider,
      registration: this.registration,
    });
  }

  private async hasHandoff(setup: MemberOwnedProviderSetupRecord): Promise<boolean> {
    return setup.browserRunId
      ? await this.computer.hasOwnedRunHandoff({
          memberId: setup.memberId,
          ownerKey: setup.id,
          ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
          runId: setup.browserRunId,
        })
      : false;
  }

  private toView(
    setup: MemberOwnedProviderSetupRecord,
    handoffAvailable = false,
  ): MemberOwnedProviderSetupView {
    return toMemberOwnedProviderSetupView(setup, this.registration.presentation, {
      handoffAvailable,
    });
  }
}

export function createMemberOwnedProviderSetupService(
  provider: MemberOwnedDeviceProviderApplicationProvider,
): MemberOwnedProviderSetupService {
  return new MemberOwnedProviderSetupService(provider);
}

export function buildBlindProviderCredentialCaptureCode(input: {
  clientIdSelector: string;
  clientSecretSelector: string;
  credentialsPageUrl: string;
  revealSecretSelector: string | null;
}): string {
  return `
const credentialsPageUrl = new URL(${JSON.stringify(input.credentialsPageUrl)});
const gotoCredentialsPage = async () => {
  const response = await page.goto(credentialsPageUrl.toString(), { waitUntil: "load" });
  if (response && !response.ok()) {
    throw new Error("provider credentials page did not load cleanly");
  }
  await page.waitForLoadState("networkidle", { timeout: 15000 });
  const loadedUrl = new URL(page.url());
  if (
    loadedUrl.origin !== credentialsPageUrl.origin
    || loadedUrl.pathname !== credentialsPageUrl.pathname
  ) {
    throw new Error("provider credentials page is unavailable");
  }
};
const readField = async (locator) => {
  const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
  if (tag === "input" || tag === "textarea") {
    return (await locator.inputValue()).trim();
  }
  return ((await locator.textContent()) ?? "").trim();
};
const exactVisible = async (selector, label) => {
  const locator = page.locator(selector);
  await locator.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  if (await locator.count() !== 1 || !await locator.isVisible().catch(() => false)) {
    throw new Error(label + " must resolve to exactly one visible element");
  }
  return locator;
};
const scrubCredentialsPage = async () => {
  await page.evaluate(() => {
    document.documentElement?.replaceChildren();
  }).catch(() => undefined);
  try {
    await page.goto("about:blank", { waitUntil: "load" });
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
};
await gotoCredentialsPage();
let capturedCredentials;
try {
  ${input.revealSecretSelector ? `await (await exactVisible(${JSON.stringify(input.revealSecretSelector)}, "secret reveal selector")).click();` : ""}
  const clientId = await readField(
    await exactVisible(${JSON.stringify(input.clientIdSelector)}, "client ID selector"),
  );
  const clientSecret = await readField(
    await exactVisible(${JSON.stringify(input.clientSecretSelector)}, "client secret selector"),
  );
  if (!clientId || !clientSecret) {
    throw new Error("provider credentials are unavailable");
  }
  capturedCredentials = { clientId, clientSecret };
} finally {
  await scrubCredentialsPage();
}
return capturedCredentials;
`;
}

export function buildBlindOwnedApplicationDeleteCode(input: {
  clientIdSelector: string;
  confirmSelector: string | null;
  credentialsPageUrl: string;
  deleteSelector: string;
  expectedClientId: string;
}): string {
  return `
const credentialsPageUrl = new URL(${JSON.stringify(input.credentialsPageUrl)});
const gotoCredentialsPage = async () => {
  const response = await page.goto(credentialsPageUrl.toString(), { waitUntil: "load" });
  if (response && !response.ok()) {
    throw new Error("provider credentials page did not load cleanly");
  }
  await page.waitForLoadState("networkidle", { timeout: 15000 });
  const loadedUrl = new URL(page.url());
  if (
    loadedUrl.origin !== credentialsPageUrl.origin
    || loadedUrl.pathname !== credentialsPageUrl.pathname
  ) {
    throw new Error("provider credentials page is unavailable");
  }
};
const readField = async (locator) => {
  const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
  if (tag === "input" || tag === "textarea") {
    return (await locator.inputValue()).trim();
  }
  return ((await locator.textContent()) ?? "").trim();
};
const exactVisible = async (selector, label) => {
  const locator = page.locator(selector);
  await locator.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  if (await locator.count() !== 1 || !await locator.isVisible().catch(() => false)) {
    throw new Error(label + " must resolve to exactly one visible element");
  }
  return locator;
};
const readCurrentClientId = async () => {
  const locator = page.locator(${JSON.stringify(input.clientIdSelector)});
  const count = await locator.count();
  if (count === 0) {
    return null;
  }
  if (count !== 1 || !await locator.isVisible().catch(() => false)) {
    throw new Error("client ID selector must resolve to exactly one visible element");
  }
  const value = await readField(locator);
  if (!value) {
    throw new Error("provider client ID is unavailable");
  }
  return value;
};
await gotoCredentialsPage();
const initialClientId = await readCurrentClientId();
if (initialClientId === null) {
  return { kind: "already_deleted" };
}
if (initialClientId !== ${JSON.stringify(input.expectedClientId)}) {
  throw new Error("provider application client ID does not match deletion authority");
}
await (await exactVisible(${JSON.stringify(input.deleteSelector)}, "delete selector")).click();
${input.confirmSelector ? `await (await exactVisible(${JSON.stringify(input.confirmSelector)}, "delete confirmation selector")).click();` : ""}
await gotoCredentialsPage();
const finalClientId = await readCurrentClientId();
if (finalClientId === null) {
  return { kind: "deleted" };
}
if (finalClientId !== ${JSON.stringify(input.expectedClientId)}) {
  throw new Error("provider application client ID changed during deletion");
}
throw new Error("provider application deletion was not confirmed");
`;
}

function requireBrowserMutationResult(
  value: unknown,
): void {
  const kind = value && typeof value === "object" && !Array.isArray(value)
    ? Reflect.get(value, "kind")
    : null;
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 1
    || (kind !== "already_deleted" && kind !== "deleted")
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
