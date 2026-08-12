import "server-only";

import { deviceSyncError, isDeviceSyncError } from "@murphai/device-syncd/errors";

import { formatHostedExecutionSafeLogErrorDetails } from "../../hosted-execution/logging";
import { buildHostedDeviceSyncCallbackProof } from "../browser-callback-proof";
import { createHostedDeviceSyncPublicIngressService } from "../public-ingress-service";
import {
  isDeviceProviderApplicationError,
  isRepairableDeviceProviderApplicationStateError,
  readDeviceProviderApplicationView,
  resolveDeviceProviderApplication,
  type DeviceProviderApplicationBinding,
  type DeviceProviderApplicationView,
  type MemberOwnedDeviceProviderApplicationProvider,
  type ResolvedDeviceProviderApplication,
} from "../provider-applications";
import type {
  MemberOwnedProviderSetupAdapter,
  MemberOwnedProviderSetupBrowserRun,
} from "./adapter";
import {
  requireMemberOwnedProviderSetupRegistration,
  type MemberOwnedProviderSetupRegistration,
} from "./registry";
import { PrismaDeviceProviderSetupStore } from "./store";
import {
  readMemberOwnedProviderSetupBinding,
  toMemberOwnedProviderSetupView,
  type MemberOwnedProviderSetupAdvanceResult,
  type MemberOwnedProviderSetupConnectionDisposition,
  type MemberOwnedProviderSetupOAuthResult,
  type MemberOwnedProviderSetupRecord,
  type MemberOwnedProviderSetupStatus,
  type MemberOwnedProviderSetupView,
} from "./types";

interface ProviderSetupStore {
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
  ): ReturnType<PrismaDeviceProviderSetupStore["readConnectionDisposition"]>;
  readOwned(input: {
    memberId: string;
    provider: MemberOwnedDeviceProviderApplicationProvider;
    setupId: string;
  }): Promise<MemberOwnedProviderSetupRecord>;
  transition(
    input: Parameters<PrismaDeviceProviderSetupStore["transition"]>[0],
  ): Promise<MemberOwnedProviderSetupRecord>;
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
const PROVIDER_SETUP_WORKING_STALE_MS = 2 * 60 * 1000;
const PROVIDER_SETUP_BROWSER_RELEASE_CAS_ATTEMPTS = 3;

export class MemberOwnedProviderSetupService {
  private adapterInstance: MemberOwnedProviderSetupAdapter | null;
  private readonly createIngress: CreateIngress;
  private readonly now: () => Date;
  private readonly readApplicationView: ReadApplicationView;
  private readonly registration: MemberOwnedProviderSetupRegistration;
  private readonly resolveApplication: ResolveApplication;
  private readonly store: ProviderSetupStore;

  constructor(
    provider: MemberOwnedDeviceProviderApplicationProvider,
    input: {
      adapter?: MemberOwnedProviderSetupAdapter;
      createIngress?: CreateIngress;
      now?: () => Date;
      readApplicationView?: ReadApplicationView;
      registration?: MemberOwnedProviderSetupRegistration;
      resolveApplication?: ResolveApplication;
      store?: ProviderSetupStore;
    } = {},
  ) {
    this.registration = input.registration
      ?? requireMemberOwnedProviderSetupRegistration(provider);
    this.adapterInstance = input.adapter ?? null;
    if (this.adapterInstance) {
      assertAdapterMatchesRegistration(this.adapterInstance, this.registration);
    }
    this.createIngress = input.createIngress
      ?? createHostedDeviceSyncPublicIngressService;
    this.now = input.now ?? (() => new Date());
    this.readApplicationView = input.readApplicationView
      ?? readDeviceProviderApplicationView;
    this.resolveApplication = input.resolveApplication
      ?? resolveDeviceProviderApplication;
    this.store = input.store ?? new PrismaDeviceProviderSetupStore();
  }

  private get adapter(): MemberOwnedProviderSetupAdapter {
    if (!this.adapterInstance) {
      this.adapterInstance = this.registration.createAdapter();
      assertAdapterMatchesRegistration(this.adapterInstance, this.registration);
    }
    return this.adapterInstance;
  }

  async read(memberId: string): Promise<MemberOwnedProviderSetupView | null> {
    const setup = await this.store.readActive({
      memberId,
      provider: this.registration.coordinates.provider,
    });
    if (!setup) {
      return null;
    }
    if (setup.status === "canceling") {
      return this.toView(setup);
    }
    const resumable = await this.recoverInterruptedWorking(setup);
    const recovered = await this.recoverStoredApplicationBinding(resumable);
    const reconciled = await this.reconcileConnectionTruth(recovered, "read");
    return this.toView(reconciled);
  }

  async ensure(memberId: string): Promise<MemberOwnedProviderSetupRecord> {
    const setup = await this.store.ensureActive({
      connectSourceId: this.registration.coordinates.connectSourceId,
      connectTarget: this.registration.coordinates.connectTarget,
      memberId,
      provider: this.registration.coordinates.provider,
      sourceProviderSlug: this.registration.coordinates.sourceProviderSlug,
    });
    if (setup.status === "canceling") {
      return setup;
    }
    const resumable = await this.recoverInterruptedWorking(setup);
    const recovered = await this.recoverStoredApplicationBinding(resumable);
    return this.reconcileConnectionTruth(recovered, "ensure");
  }

  async advance(
    memberId: string,
    expectedSetupId?: string,
  ): Promise<MemberOwnedProviderSetupAdvanceResult> {
    let setup = await this.requireSetup(memberId, expectedSetupId);

    try {
      setup = await this.recoverStoredApplicationBinding(setup);
      setup = await this.reconcileConnectionTruth(setup, "advance");
      if (setup.status === "connected" || setup.status === "disconnect_first") {
        return { setup: this.toView(setup) };
      }

      const binding = readMemberOwnedProviderSetupBinding(setup);
      const applicationState = await this.inspectStoredApplication(binding, setup);
      const disposition = await this.store.readConnectionDisposition(setup);
      if (applicationState === "repair_required" && disposition.kind !== "none") {
        setup = await this.transition(setup, {
          lastErrorCode: "DEVICE_PROVIDER_APPLICATION_CONNECTION_CONFLICT",
          status: "disconnect_first",
        });
        return { setup: this.toView(setup) };
      }
      const connectionStatus = resolveConnectionTruthStatus(disposition);
      if (connectionStatus) {
        setup = await this.persistConnectionDerivedStatus(
          setup,
          connectionStatus,
          "advance",
        );
        return { setup: this.toView(setup) };
      }

      if (applicationState === "valid") {
        if (setup.status !== "oauth_ready" && setup.status !== "oauth_in_progress") {
          setup = await this.transition(setup, {
            lastErrorCode: null,
            status: "oauth_ready",
          });
        }
        return { setup: this.toView(setup) };
      }
      if (applicationState === "repair_required" && setup.status !== "repair_required") {
        setup = await this.transition(setup, {
          lastErrorCode: "DEVICE_PROVIDER_APPLICATION_INVALID",
          status: "repair_required",
        });
      }

      const bound = await this.ensureBoundBrowserRun(setup);
      setup = bound.setup;
      if (bound.runStatus !== "running") {
        return await this.continuePausedBrowserRun(setup, bound)
          ?? { setup: this.toView(setup) };
      }

      return await this.inspectAndContinue({
        memberId,
        runId: bound.runId,
        setup,
      });
    } catch (error) {
      if (isReplacementBlockedError(error)) {
        const latest = await this.requireLatestAvailableSetup(memberId);
        const blocked = await this.transition(latest, {
          lastErrorCode: "DEVICE_PROVIDER_APPLICATION_CONNECTION_CONFLICT",
          status: "disconnect_first",
        });
        return { setup: this.toView(blocked) };
      }
      if (isRetryableProviderSetupInfrastructureError(error)) {
        const latest = await this.requireLatestAvailableSetup(memberId);
        if (
          latest.status === "waiting_for_user"
          || latest.status === "provider_prerequisite"
        ) {
          if (!latest.browserRunId) {
            return { setup: this.toView(latest) };
          }
          const run = await this.adapter.ensureBrowserRun({
            expectedRunId: latest.browserRunId,
            memberId: latest.memberId,
            setupId: latest.id,
          });
          return run.status === "running"
            ? { setup: this.toView(latest) }
            : await this.continuePausedBrowserRun(latest, {
                awaitingReason: run.awaitingReason,
                runId: run.runId,
              }) ?? { setup: this.toView(latest) };
        }
        const failed = await this.transition(latest, {
          lastErrorCode: readSafeProviderSetupErrorCode(error),
          status: "retryable_failure",
        });
        return { setup: this.toView(failed) };
      }
      throw error;
    }
  }

  async cancel(
    memberId: string,
    expectedSetupId: string,
  ): Promise<MemberOwnedProviderSetupView> {
    let setup = await this.store.readOwned({
      memberId,
      provider: this.registration.coordinates.provider,
      setupId: expectedSetupId,
    });
    assertSetupCancelableOrCanceling(setup);
    if (setup.status !== "canceling") {
      setup = await this.recoverStoredApplicationBinding(setup);
      const disposition = await this.store.readConnectionDisposition(setup);
      const binding = readMemberOwnedProviderSetupBinding(setup);
      if (
        setup.status !== "provider_prerequisite"
        || !setup.browserRunId
        || setup.providerSubmissionAt !== null
        || binding !== null
        || disposition.kind !== "none"
      ) {
        throw unsafeProviderSetupCancellationError(
          this.registration.presentation.providerName,
        );
      }
      setup = await this.transition(setup, {
        lastErrorCode: null,
        status: "canceling",
      });
    }

    if (
      !setup.browserRunId
      || setup.providerSubmissionAt !== null
      || readMemberOwnedProviderSetupBinding(setup) !== null
    ) {
      throw unsafeProviderSetupCancellationError(
        this.registration.presentation.providerName,
      );
    }

    const runStatus = await this.adapter.cancelBrowserRun({
      memberId,
      runId: setup.browserRunId,
      setupId: setup.id,
    });
    if (runStatus !== "canceled") {
      throw unsafeProviderSetupCancellationError(
        this.registration.presentation.providerName,
      );
    }
    setup = await this.transition(setup, {
      browserRunId: null,
      completedAt: null,
      lastErrorCode: null,
      providerApplicationId: null,
      providerApplicationRevision: null,
      providerSubmissionAt: null,
      status: "canceled",
    });
    return this.toView(setup);
  }

  async startOAuth(input: {
    memberId: string;
    request: Request;
    returnTo: string;
    sessionId: string;
    setupId?: string;
  }): Promise<MemberOwnedProviderSetupOAuthResult> {
    let setup = await this.requireSetup(input.memberId, input.setupId);
    setup = await this.recoverStoredApplicationBinding(setup);
    setup = await this.reconcileConnectionTruth(setup, "oauth-start");
    if (setup.status === "connected") {
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_ALREADY_CONNECTED",
        httpStatus: 409,
        message: `${this.registration.presentation.providerName} is already connected.`,
        retryable: false,
      });
    }
    if (setup.status === "disconnect_first") {
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_DISCONNECT_FIRST",
        httpStatus: 409,
        message: `Disconnect the current ${this.registration.presentation.providerName} connection before continuing.`,
        retryable: false,
      });
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

    try {
      await this.resolveApplication({
        applicationId: binding.applicationId,
        expectedRevision: binding.revision,
        memberId: input.memberId,
        provider: binding.provider,
      });
    } catch (error) {
      if (!isRepairableDeviceProviderApplicationStateError(error)) {
        throw error;
      }
      await this.transition(setup, {
        lastErrorCode: error.code,
        status: "repair_required",
      });
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_REPAIR_REQUIRED",
        httpStatus: 409,
        message: `Murph needs to repair the private ${this.registration.presentation.providerName} application first.`,
        retryable: false,
      });
    }

    if (setup.status !== "oauth_in_progress") {
      setup = await this.transition(setup, {
        lastErrorCode: null,
        status: "oauth_in_progress",
      });
    }

    // The durable projection changes before a usable state can be issued. If
    // ingress returns ambiguously, retrying creates another exact-bound,
    // single-use state while the prior one remains safe to expire or consume.
    const started = await this.createIngress(input.request)
      .startConnectionWithProviderApplication(
        input.memberId,
        binding,
        input.returnTo,
        {
          connectSourceId: this.adapter.connectSourceId,
          connectTarget: this.adapter.connectTarget,
          sourceProviderSlug: this.adapter.sourceProviderSlug,
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
        provider: this.adapter.provider,
        revision: input.revision,
      });
    } catch (error) {
      logProjectionFailure(error, this.adapter.provider, "oauth-callback");
    }
    try {
      const setup = await this.store.readActive({
        memberId: input.memberId,
        provider: this.adapter.provider,
      });
      if (!setup) {
        return null;
      }
      const reconciled = await this.reconcileConnectionTruth(
        setup,
        "oauth-callback",
        false,
      );
      return this.toView(reconciled);
    } catch (error) {
      logProjectionFailure(error, this.adapter.provider, "oauth-callback-read");
      return null;
    }
  }

  async markDisconnected(
    memberId: string,
  ): Promise<MemberOwnedProviderSetupView | null> {
    try {
      await this.store.markDisconnected({
        memberId,
        provider: this.adapter.provider,
      });
    } catch (error) {
      logProjectionFailure(error, this.adapter.provider, "disconnect");
    }
    try {
      const setup = await this.store.readActive({
        memberId,
        provider: this.adapter.provider,
      });
      if (!setup) {
        return null;
      }
      const reconciled = await this.reconcileConnectionTruth(
        setup,
        "disconnect",
        false,
      );
      return this.toView(reconciled);
    } catch (error) {
      logProjectionFailure(error, this.adapter.provider, "disconnect-read");
      return null;
    }
  }

  private async ensureBoundBrowserRun(
    setup: MemberOwnedProviderSetupRecord,
  ): Promise<{
    awaitingReason: MemberOwnedProviderSetupBrowserRun["awaitingReason"];
    runId: string;
    runStatus: string;
    setup: MemberOwnedProviderSetupRecord;
  }> {
    const run = await this.adapter.ensureBrowserRun({
      expectedRunId: setup.browserRunId,
      memberId: setup.memberId,
      setupId: setup.id,
    });
    let bound = setup;
    if (setup.browserRunId !== run.runId) {
      bound = await this.transition(setup, {
        browserRunId: run.runId,
        lastErrorCode: null,
        status: run.status === "running" ? "working" : setup.status,
      });
    } else if (run.status === "running" && setup.status !== "working") {
      bound = await this.transition(setup, {
        lastErrorCode: null,
        status: "working",
      });
    }
    return {
      awaitingReason: run.awaitingReason,
      runId: run.runId,
      runStatus: run.status,
      setup: bound,
    };
  }

  private async continuePausedBrowserRun(
    setup: MemberOwnedProviderSetupRecord,
    run: {
      awaitingReason: MemberOwnedProviderSetupBrowserRun["awaitingReason"];
      runId: string;
    },
  ): Promise<MemberOwnedProviderSetupAdvanceResult | null> {
    if (
      setup.status !== "waiting_for_user"
      && setup.status !== "provider_prerequisite"
    ) {
      return null;
    }
    const handoff = await this.adapter.pauseForUser({
      memberId: setup.memberId,
      reason: setup.status === "provider_prerequisite"
        ? "prerequisite"
        : run.awaitingReason === "login_needed"
        ? "signed_out"
        : "challenge",
      runId: run.runId,
      setupId: setup.id,
    });
    return {
      ...(handoff.handoffUrl ? { handoffUrl: handoff.handoffUrl } : {}),
      setup: this.toView(setup),
    };
  }

  private async inspectAndContinue(input: {
    memberId: string;
    runId: string;
    setup: MemberOwnedProviderSetupRecord;
  }): Promise<MemberOwnedProviderSetupAdvanceResult> {
    let setup = input.setup;
    let inspection = await this.adapter.inspectDashboard({
      memberId: input.memberId,
      runId: input.runId,
      setupId: setup.id,
    });

    const paused = await this.pauseForInspectionRequirement(
      inspection,
      input.runId,
      setup,
    );
    if (paused) {
      return paused;
    }
    if (inspection.kind === "ambiguous") {
      setup = await this.transition(setup, {
        lastErrorCode: "PROVIDER_SETUP_AMBIGUOUS_SUBMISSION",
        status: "inspection_required",
      });
      return { setup: this.toView(setup) };
    }
    if (inspection.kind === "unrelated_application") {
      setup = await this.transition(setup, {
        lastErrorCode: "PROVIDER_SETUP_PROVIDER_CONFLICT",
        status: "provider_conflict",
      });
      return { setup: this.toView(setup) };
    }

    if (inspection.kind === "missing") {
      if (setup.providerSubmissionAt !== null) {
        setup = await this.transition(setup, {
          lastErrorCode: "PROVIDER_SETUP_INSPECTION_REQUIRED",
          providerSubmissionAt: null,
          status: "inspection_required",
        });
        return { setup: this.toView(setup) };
      }
      setup = await this.transition(setup, {
        lastErrorCode: "PROVIDER_SETUP_INSPECTION_REQUIRED",
        providerSubmissionAt: this.now(),
        status: "inspection_required",
      });
      const created = await this.adapter.createOwnedApplication({
        memberId: input.memberId,
        runId: input.runId,
        setupId: setup.id,
      });
      if (created.kind === "known_unsent") {
        if (created.reason === "prerequisite") {
          setup = await this.transition(setup, {
            lastErrorCode: "PROVIDER_SETUP_PROVIDER_PREREQUISITE",
            providerSubmissionAt: null,
            status: "provider_prerequisite",
          });
          const handoff = await this.adapter.pauseForUser({
            memberId: input.memberId,
            reason: "prerequisite",
            runId: input.runId,
            setupId: setup.id,
          });
          return {
            ...(handoff.handoffUrl ? { handoffUrl: handoff.handoffUrl } : {}),
            setup: this.toView(setup),
          };
        }
        setup = await this.transition(setup, {
          lastErrorCode: "PROVIDER_SETUP_DASHBOARD_UNAVAILABLE",
          providerSubmissionAt: null,
          status: "retryable_failure",
        });
        return { setup: this.toView(setup) };
      }
      if (created.kind === "ambiguous") {
        setup = await this.transition(setup, {
          lastErrorCode: "PROVIDER_SETUP_AMBIGUOUS_SUBMISSION",
          status: "inspection_required",
        });
        return { setup: this.toView(setup) };
      }

      inspection = await this.adapter.inspectDashboard({
        memberId: input.memberId,
        runId: input.runId,
        setupId: setup.id,
      });
      const postCreatePause = await this.pauseForInspectionRequirement(
        inspection,
        input.runId,
        setup,
      );
      if (postCreatePause) {
        return postCreatePause;
      }
      if (inspection.kind === "unrelated_application") {
        setup = await this.transition(setup, {
          lastErrorCode: "PROVIDER_SETUP_PROVIDER_CONFLICT",
          status: "provider_conflict",
        });
        return { setup: this.toView(setup) };
      }
      if (inspection.kind !== "owned_application") {
        setup = await this.transition(setup, {
          lastErrorCode: inspection.kind === "ambiguous"
            ? "PROVIDER_SETUP_AMBIGUOUS_SUBMISSION"
            : "PROVIDER_SETUP_INSPECTION_REQUIRED",
          status: "inspection_required",
        });
        return { setup: this.toView(setup) };
      }
    }

    const existingBinding = readMemberOwnedProviderSetupBinding(setup);
    const application = await this.adapter.captureAndSealOwnedApplication({
      expectedRevision: existingBinding?.revision ?? null,
      memberId: input.memberId,
      runId: input.runId,
      setupId: setup.id,
    });
    setup = await this.transition(setup, {
      lastErrorCode: null,
      providerApplicationId: application.applicationId,
      providerApplicationRevision: application.revision,
      providerSubmissionAt: null,
      status: "oauth_ready",
    });
    setup = await this.releaseBoundBrowserRunAfterApplicationBinding(setup);
    return { setup: this.toView(setup) };
  }

  private async pauseForInspectionRequirement(
    inspection: Awaited<ReturnType<MemberOwnedProviderSetupAdapter["inspectDashboard"]>>,
    runId: string,
    setup: MemberOwnedProviderSetupRecord,
  ): Promise<MemberOwnedProviderSetupAdvanceResult | null> {
    if (inspection.kind === "authentication_required") {
      const waiting = await this.transition(setup, {
        lastErrorCode: null,
        status: "waiting_for_user",
      });
      const handoff = await this.adapter.pauseForUser({
        memberId: setup.memberId,
        reason: inspection.reason,
        runId,
        setupId: setup.id,
      });
      return {
        ...(handoff.handoffUrl ? { handoffUrl: handoff.handoffUrl } : {}),
        setup: this.toView(waiting),
      };
    }
    if (inspection.kind === "prerequisite_required") {
      const waiting = await this.transition(setup, {
        lastErrorCode: "PROVIDER_SETUP_PROVIDER_PREREQUISITE",
        status: "provider_prerequisite",
      });
      const handoff = await this.adapter.pauseForUser({
        memberId: setup.memberId,
        reason: "prerequisite",
        runId,
        setupId: setup.id,
      });
      return {
        ...(handoff.handoffUrl ? { handoffUrl: handoff.handoffUrl } : {}),
        setup: this.toView(waiting),
      };
    }
    return null;
  }

  private async requireSetup(
    memberId: string,
    expectedSetupId?: string,
  ): Promise<MemberOwnedProviderSetupRecord> {
    const setup = expectedSetupId
      ? await this.store.readOwned({
          memberId,
          provider: this.adapter.provider,
          setupId: expectedSetupId,
        })
      : await this.ensure(memberId);
    const resumable = await this.recoverInterruptedWorking(setup);
    assertSetupAvailable(resumable);
    if (resumable.status === "working") {
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_ALREADY_IN_PROGRESS",
        httpStatus: 409,
        message: "Private provider setup is already in progress.",
        retryable: true,
      });
    }
    return resumable;
  }

  private async requireLatestAvailableSetup(
    memberId: string,
  ): Promise<MemberOwnedProviderSetupRecord> {
    const latest = await this.store.readActive({
      memberId,
      provider: this.adapter.provider,
    });
    if (!latest) {
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_INACTIVE",
        httpStatus: 410,
        message: "This private provider setup is no longer active.",
        retryable: false,
      });
    }
    assertSetupAvailable(latest);
    return latest;
  }

  private async recoverStoredApplicationBinding(
    setup: MemberOwnedProviderSetupRecord,
  ): Promise<MemberOwnedProviderSetupRecord> {
    if (
      !setup.active
      || setup.status === "canceling"
      || setup.status === "deletion_pending"
      || setup.status === "deleted"
    ) {
      return setup;
    }
    const binding = readMemberOwnedProviderSetupBinding(setup);
    const application = await this.readApplicationView({
      memberId: setup.memberId,
      provider: setup.provider,
    });
    if (!application) {
      return setup;
    }
    if (
      binding?.applicationId === application.applicationId
      && binding.revision === application.revision
    ) {
      return this.releaseBoundBrowserRunAfterApplicationBinding(setup);
    }
    if (
      binding
      && (
        binding.applicationId !== application.applicationId
        || application.revision < binding.revision
      )
    ) {
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_REPAIR_REQUIRED",
        httpStatus: 409,
        message: "Private provider application state does not match this setup.",
        retryable: false,
      });
    }
    const recovered = await this.transition(setup, {
      providerApplicationId: application.applicationId,
      providerApplicationRevision: application.revision,
      status: setup.status,
    });
    return this.releaseBoundBrowserRunAfterApplicationBinding(recovered);
  }

  private async releaseBoundBrowserRunAfterApplicationBinding(
    setup: MemberOwnedProviderSetupRecord,
  ): Promise<MemberOwnedProviderSetupRecord> {
    const runId = setup.browserRunId;
    if (!runId) {
      return setup;
    }
    const binding = readMemberOwnedProviderSetupBinding(setup);
    if (!binding) {
      throw providerSetupBrowserCleanupIncompleteError();
    }

    const runStatus = await this.adapter.finishBrowserRun({
      memberId: setup.memberId,
      runId,
      setupId: setup.id,
    });
    if (runStatus !== "completed") {
      throw providerSetupBrowserCleanupIncompleteError();
    }

    let current = setup;
    for (let attempt = 0; attempt < PROVIDER_SETUP_BROWSER_RELEASE_CAS_ATTEMPTS; attempt += 1) {
      assertSetupAvailable(current);
      if (current.browserRunId === null) {
        return current;
      }
      const currentBinding = readMemberOwnedProviderSetupBinding(current);
      if (
        current.browserRunId !== runId
        || currentBinding?.applicationId !== binding.applicationId
        || currentBinding.revision !== binding.revision
      ) {
        throw providerSetupBrowserCleanupIncompleteError();
      }
      try {
        return await this.transition(current, {
          browserRunId: null,
          status: current.status,
        });
      } catch (error) {
        if (!isDeviceSyncError(error) || error.code !== "DEVICE_PROVIDER_SETUP_CONFLICT") {
          throw error;
        }
        current = await this.store.readOwned({
          memberId: setup.memberId,
          provider: setup.provider,
          setupId: setup.id,
        });
      }
    }
    throw providerSetupBrowserCleanupIncompleteError();
  }

  private async recoverInterruptedWorking(
    setup: MemberOwnedProviderSetupRecord,
  ): Promise<MemberOwnedProviderSetupRecord> {
    if (
      setup.status !== "working"
      || this.now().getTime() - setup.updatedAt.getTime()
        < PROVIDER_SETUP_WORKING_STALE_MS
    ) {
      return setup;
    }
    try {
      return await this.transition(setup, {
        lastErrorCode: "PROVIDER_SETUP_DASHBOARD_UNAVAILABLE",
        status: "retryable_failure",
      });
    } catch (error) {
      const latest = await this.store.readActive({
        memberId: setup.memberId,
        provider: setup.provider,
      });
      if (latest && latest.version !== setup.version) {
        return latest;
      }
      throw error;
    }
  }

  private async inspectStoredApplication(
    binding: DeviceProviderApplicationBinding | null,
    setup: MemberOwnedProviderSetupRecord,
  ): Promise<"missing" | "repair_required" | "valid"> {
    if (!binding) {
      return "missing";
    }
    try {
      await this.resolveApplication({
        applicationId: binding.applicationId,
        expectedRevision: binding.revision,
        memberId: setup.memberId,
        provider: binding.provider,
      });
      return "valid";
    } catch (error) {
      if (isRepairableDeviceProviderApplicationStateError(error)) {
        return "repair_required";
      }
      throw error;
    }
  }

  private async reconcileConnectionTruth(
    setup: MemberOwnedProviderSetupRecord,
    operation: string,
    persist = true,
  ): Promise<MemberOwnedProviderSetupRecord> {
    if (
      setup.status === "deletion_pending"
      || setup.status === "deleted"
      || !setup.active
    ) {
      return setup;
    }
    const disposition = await this.store.readConnectionDisposition(setup);
    const connectionStatus = resolveConnectionTruthStatus(disposition);
    if (connectionStatus) {
      return persist
        ? this.persistConnectionDerivedStatus(setup, connectionStatus, operation)
        : deriveConnectionStatus(setup, connectionStatus, this.now());
    }
    if (setup.status === "connected" || setup.status === "disconnect_first") {
      const desired = readMemberOwnedProviderSetupBinding(setup)
        ? "oauth_ready"
        : "pending";
      return persist
        ? this.persistConnectionDerivedStatus(setup, desired, operation)
        : deriveConnectionStatus(setup, desired, this.now());
    }
    return setup;
  }

  private async persistConnectionDerivedStatus(
    setup: MemberOwnedProviderSetupRecord,
    status: "connected" | "disconnect_first" | "oauth_ready" | "pending",
    operation: string,
  ): Promise<MemberOwnedProviderSetupRecord> {
    if (setup.status === status) {
      return setup;
    }
    try {
      return await this.transition(setup, {
        completedAt: status === "connected"
          ? setup.completedAt ?? this.now()
          : null,
        lastErrorCode: status === "disconnect_first"
          ? "DEVICE_PROVIDER_APPLICATION_CONNECTION_CONFLICT"
          : null,
        status,
      });
    } catch (error) {
      logProjectionFailure(error, setup.provider, operation);
      return deriveConnectionStatus(setup, status, this.now());
    }
  }

  private transition(
    setup: MemberOwnedProviderSetupRecord,
    input: {
      active?: boolean;
      browserRunId?: string | null;
      completedAt?: Date | null;
      lastErrorCode?: string | null;
      providerApplicationId?: string | null;
      providerApplicationRevision?: number | null;
      providerSubmissionAt?: Date | null;
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

  private toView(setup: MemberOwnedProviderSetupRecord) {
    return toMemberOwnedProviderSetupView(
      setup,
      this.registration.presentation,
    );
  }
}

function assertSetupAvailable(setup: MemberOwnedProviderSetupRecord): void {
  if (!setup.active || setup.status === "deleted") {
    throw deviceSyncError({
      code: "DEVICE_PROVIDER_SETUP_INACTIVE",
      httpStatus: 410,
      message: "This private provider setup is no longer active.",
      retryable: false,
    });
  }
  if (setup.status === "deletion_pending") {
    throw deviceSyncError({
      code: "DEVICE_PROVIDER_SETUP_DELETION_IN_PROGRESS",
      httpStatus: 409,
      message: "Private provider cleanup is already in progress.",
      retryable: false,
    });
  }
  if (setup.status === "canceling") {
    throw deviceSyncError({
      code: "DEVICE_PROVIDER_SETUP_CANCELLATION_IN_PROGRESS",
      httpStatus: 409,
      message: "Private provider setup cancellation is already in progress.",
      retryable: false,
    });
  }
}

function assertSetupCancelableOrCanceling(
  setup: MemberOwnedProviderSetupRecord,
): void {
  if (!setup.active || setup.status === "deleted") {
    throw deviceSyncError({
      code: "DEVICE_PROVIDER_SETUP_INACTIVE",
      httpStatus: 410,
      message: "This private provider setup is no longer active.",
      retryable: false,
    });
  }
  if (setup.status === "deletion_pending") {
    throw deviceSyncError({
      code: "DEVICE_PROVIDER_SETUP_DELETION_IN_PROGRESS",
      httpStatus: 409,
      message: "Private provider cleanup is already in progress.",
      retryable: false,
    });
  }
}

export function createMemberOwnedProviderSetupService(
  provider: MemberOwnedDeviceProviderApplicationProvider,
): MemberOwnedProviderSetupService {
  return new MemberOwnedProviderSetupService(provider);
}

function assertAdapterMatchesRegistration(
  adapter: MemberOwnedProviderSetupAdapter,
  registration: MemberOwnedProviderSetupRegistration,
): void {
  const coordinates = registration.coordinates;
  if (
    adapter.provider !== coordinates.provider
    || adapter.connectSourceId !== coordinates.connectSourceId
    || adapter.connectTarget !== coordinates.connectTarget
    || adapter.sourceProviderSlug !== coordinates.sourceProviderSlug
  ) {
    throw new TypeError(
      "Member-owned provider setup adapter does not match its registry entry.",
    );
  }
}

function deriveConnectionStatus(
  setup: MemberOwnedProviderSetupRecord,
  status: "connected" | "disconnect_first" | "oauth_ready" | "pending",
  now: Date,
): MemberOwnedProviderSetupRecord {
  return {
    ...setup,
    completedAt: status === "connected" ? setup.completedAt ?? now : null,
    lastErrorCode: status === "disconnect_first"
      ? "DEVICE_PROVIDER_APPLICATION_CONNECTION_CONFLICT"
      : null,
    status,
    updatedAt: now,
  };
}

function resolveConnectionTruthStatus(
  disposition: MemberOwnedProviderSetupConnectionDisposition,
): "connected" | "disconnect_first" | "oauth_ready" | null {
  switch (disposition.kind) {
    case "none":
      return null;
    case "conflict":
      return "disconnect_first";
    case "exact":
      switch (disposition.status) {
        case "active":
          return "connected";
        case "reauthorization_required":
          return "oauth_ready";
      }
  }
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

function isReplacementBlockedError(error: unknown): boolean {
  return isDeviceProviderApplicationError(error)
    && error.code === "DEVICE_PROVIDER_APPLICATION_CONNECTION_CONFLICT";
}

function isRetryableProviderSetupInfrastructureError(error: unknown): boolean {
  return isDeviceSyncError(error)
    && (
      error.code.startsWith("HOSTED_COMPUTER_")
      || error.code.startsWith("PROVIDER_SETUP_")
    );
}

function readSafeProviderSetupErrorCode(error: unknown): string {
  if (isDeviceSyncError(error)) {
    return error.code;
  }
  return "PROVIDER_SETUP_DASHBOARD_UNAVAILABLE";
}

function providerSetupBrowserCleanupIncompleteError() {
  return deviceSyncError({
    code: "PROVIDER_SETUP_BROWSER_CLEANUP_INCOMPLETE",
    httpStatus: 503,
    message: "Private provider setup saved the application, but browser cleanup is incomplete. Retry setup to finish cleanup safely.",
    retryable: true,
  });
}

function unsafeProviderSetupCancellationError(providerName: string) {
  return deviceSyncError({
    code: "DEVICE_PROVIDER_SETUP_CANCELLATION_UNSAFE",
    httpStatus: 409,
    message: `Murph could not prove that no ${providerName} application was submitted. Setup was not canceled.`,
    retryable: false,
  });
}
