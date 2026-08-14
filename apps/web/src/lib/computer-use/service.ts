import {
  type HostedComputerActRequest,
  type HostedComputerControlActRequest,
  type HostedComputerAwaitingReason,
  type HostedComputerDeliveryContext,
  type HostedComputerFinishOutcome,
  type HostedComputerHandoffPurpose,
  type HostedComputerOsControlRequest,
  type HostedComputerReturnContactKind,
} from "@murphai/hosted-execution/computer-use";

import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { readHostedPublicBaseUrl } from "../hosted-web/public-url";
import { computerUseConflictError, computerUseError, computerUseNotFoundError } from "./errors";
import {
  hostedComputerUseCrypto,
  type ComputerUseCrypto,
  type ComputerRunSecretField,
} from "./crypto";
import { createComputerHandoffToken, createComputerId, sha256Hex, shortHash } from "./ids";
import { inspectComputerLiveViewUrl } from "./live-view-origin";
import { isAllowedKernelManagedAuthHostedUrl } from "./managed-auth-origin";
import {
  KernelComputerClient,
  type ComputerKernelClient,
  type KernelManagedAuthConnection,
} from "./kernel-client";
import {
  MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
  PrismaComputerUseStore,
  type ComputerHandoffRecord,
  type ComputerManagedLoginBrowser,
  type ComputerRunCheckpointContext,
  type ComputerRunRecord,
  type ComputerUseStore,
  type MemberOwnedProviderSetupComputerRunPurpose,
  type MemberOwnedProviderSetupRunRecord,
  type PersistedComputerHandoffPurpose,
} from "./store";
import { requestMemberOwnedProviderSetupContinuation } from "../device-sync/provider-setup/continuation";

const COMPUTER_RUN_TTL_MS = 60 * 60 * 1000;
const COMPUTER_HANDOFF_TTL_MS = 20 * 60 * 1000;
const COMPUTER_HANDOFF_CHECKPOINTING_STALE_MS = 5 * 60 * 1000;
const COMPUTER_BROWSER_PROVISIONING_STALE_MS = 2 * 60 * 1000;
const COMPUTER_DETERMINISTIC_BROWSER_ACCOUNT_DELETE_GRACE_MS = COMPUTER_RUN_TTL_MS;
const COMPUTER_CLEANUP_BATCH_SIZE = 25;
const COMPUTER_NAVIGATION_TIMEOUT_MS = 15_000;
const COMPUTER_OBSERVE_TEXT_LIMIT = 12_000;
const COMPUTER_OBSERVE_TIMEOUT_MS = 15_000;
const COMPUTER_ACT_RESULT_MARGIN_MS = 3_000;
const COMPUTER_OS_CONTROL_PREFLIGHT_TIMEOUT_MS = 5_000;
const MEMBER_OWNED_PROVIDER_SETUP_RETURN_PATH = "/connect";
type EnvSource = Readonly<Record<string, string | undefined>>;
type HostedComputerScriptActRequest = Extract<
  HostedComputerActRequest,
  { code: string }
>;
type AttachRunBrowserInput = Parameters<ComputerUseStore["attachRunBrowser"]>[0];
type ReplaceRunBrowserInput = Parameters<ComputerUseStore["replaceRunBrowser"]>[0];
type PreparedRunBrowser = {
  replaceInput: ReplaceRunBrowserInput;
};
type AmbiguousBrowserWriteReplayResult = ComputerRunRecord | "unknown" | null;
type AwaitingOpenResumeAuthority = {
  completedLoginHandoff: ComputerHandoffRecord | null;
  expectedHandoffStatus: ComputerHandoffRecord["status"] | null;
  expectedHandoffUpdatedAt: Date | null;
  expectedPausedAt: Date;
  expectedPendingHandoffId: string | null;
  expectedResumeAfterMailboxLaneSeq: bigint | null;
  expireHandoffAfterResume: ComputerHandoffRecord | null;
};

export interface ComputerRunHandle {
  awaitingReason: HostedComputerAwaitingReason | null;
  expiresAt: string;
  lastTitle: string | null;
  lastUrl: string | null;
  reused: boolean;
  runId: string;
  status: ComputerRunRecord["status"];
}

export interface ComputerPageStateResult {
  runId: string;
  status: "running";
  title: string | null;
  url: string | null;
  visibleText: string;
}

export interface ComputerOpenResult extends ComputerPageStateResult {
  expiresAt: string;
  reused: boolean;
}

export interface ComputerOsControlResult {
  action: HostedComputerOsControlRequest["action"];
  ok: true;
  runId: string;
  status: "running";
}

export interface ComputerPauseForUserResult {
  awaitingReason: HostedComputerAwaitingReason;
  handoffUrl: string | null;
  runId: string;
  status: "awaiting_user";
  suggestedReply: string | null;
}

export interface ComputerProviderCredentialCaptureResult<T> {
  title: string | null;
  url: string | null;
  value: T;
}

export interface ComputerProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ComputerExpiredRunCleanupResult {
  expiredRuns: number;
}

type ComputerRunCleanupOutcome = "cleaned" | "expired" | "failed";
type BrowserlessProvisioningRecovery = "busy" | "changed" | "recovered";

export interface ComputerAccountExternalCleanupResult {
  browserSessionsDeleted: number;
  profilesDeleted: number;
}

export type ComputerManagedLoginContinuation =
  | {
      kind: "completed";
    }
  | {
      kind: "expired";
    }
  | {
      kind: "checkpointing";
    }
  | {
      kind: "redirect";
      url: string;
    };

export interface ComputerHandoffCompletion {
  redirectTo: string | null;
  returnContactKind: HostedComputerReturnContactKind | null;
  status: ComputerHandoffRecord["status"];
  suggestedReply: string | null;
}

export type ComputerHandoffPageState =
  | {
      kind: "redirect";
      url: string;
    }
  | {
      kind: "completed";
      returnContactKind: HostedComputerReturnContactKind | null;
      suggestedReply: string | null;
    }
  | {
      kind: "expired";
      returnContactKind: HostedComputerReturnContactKind | null;
      suggestedReply: string | null;
    }
  | {
      kind: "checkpointing";
      purpose: PersistedComputerHandoffPurpose;
      returnTo?: string | null;
      returnContactKind: HostedComputerReturnContactKind | null;
      suggestedReply: string | null;
    }
  | {
      kind: "managed_login";
      suggestedReply: string | null;
    }
  | {
      handoffId: string;
      iframeAllow: string;
      interaction: "takeover";
      kind: "open";
      liveViewUrl: string;
      description: string;
      purpose: HostedComputerHandoffPurpose;
      suggestedReply: string | null;
      title: string;
    };

export class ComputerUseService {
  private readonly crypto: ComputerUseCrypto;
  private readonly env: EnvSource;
  private kernel: ComputerKernelClient | null;
  private readonly now: () => Date;
  private readonly store: ComputerUseStore;
  private readonly requestProviderSetupContinuation:
    typeof requestMemberOwnedProviderSetupContinuation;

  constructor(input: {
    crypto?: ComputerUseCrypto;
    env?: EnvSource;
    kernel?: ComputerKernelClient;
    now?: () => Date;
    requestProviderSetupContinuation?: typeof requestMemberOwnedProviderSetupContinuation;
    store?: ComputerUseStore;
  } = {}) {
    this.crypto = input.crypto ?? hostedComputerUseCrypto;
    this.env = input.env ?? process.env;
    this.kernel = input.kernel ?? null;
    this.now = input.now ?? (() => new Date());
    this.requestProviderSetupContinuation = input.requestProviderSetupContinuation
      ?? requestMemberOwnedProviderSetupContinuation;
    this.store = input.store ?? new PrismaComputerUseStore();
  }

  async startRun(input: {
    memberId: string;
    resumeAfterMailboxItemId?: string | null;
    resumeDeliveryContext?: HostedComputerDeliveryContext | null;
    startUrl: string | null;
  }): Promise<ComputerRunHandle> {
    await this.store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    return await this.startRunWithStore(input, this.store);
  }

  async acquireOwnedRun(input: {
    expectedRunId: string | null;
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    startUrl?: string | null;
  }): Promise<ComputerRunHandle> {
    await this.store.requireMemberOwnedProviderSetupRunAcquisition(input);
    let handle = await this.acquireRunWithStore({
      expectedRunId: input.expectedRunId,
      memberId: input.memberId,
      ownerKey: input.ownerKey,
      ownerPurpose: input.ownerPurpose,
      startUrl: input.startUrl ?? null,
    }, this.store);
    if (
      handle.status === "awaiting_user"
      && handle.runId === input.expectedRunId
    ) {
      const run = await this.store.requireMemberOwnedProviderSetupRun({
        memberId: input.memberId,
        ownerKey: input.ownerKey,
        ownerPurpose: input.ownerPurpose,
        runId: handle.runId,
      });
      try {
        await this.readAwaitingOpenBrowserState({
          memberId: input.memberId,
          now: this.now(),
          resumeAfterMailboxItemId: null,
          resumeDeliveryContext: null,
          run,
          store: this.store,
        });
        const resumed = await this.store.requireMemberOwnedProviderSetupRun({
          memberId: input.memberId,
          ownerKey: input.ownerKey,
          ownerPurpose: input.ownerPurpose,
          runId: handle.runId,
        });
        handle = runHandle(resumed, true);
      } catch (error) {
        if (!isComputerAwaitingUserError(error)) {
          throw error;
        }
      }
    }
    return handle;
  }

  async openRun(input: {
    memberId: string;
    resumeAfterMailboxItemId?: string | null;
    resumeDeliveryContext?: HostedComputerDeliveryContext | null;
    runId?: string | null;
    startUrl: string | null;
  }): Promise<ComputerOpenResult> {
    if (input.runId) {
      return this.openMemberOwnedProviderSetupRun({
        memberId: input.memberId,
        runId: input.runId,
      });
    }
    await this.store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    const handle = await this.acquireRunWithStore(input, this.store);
    const now = this.now();
    let run = await this.requireFreshRun({
      memberId: input.memberId,
      runId: handle.runId,
    });
    if (
      run.status === "awaiting_user" &&
      run.pendingHandoffId &&
      input.resumeAfterMailboxItemId
    ) {
      const pendingHandoff = await this.store.findHandoffByRun({
        handoffId: run.pendingHandoffId,
        runId: run.id,
      });
      if (
        pendingHandoff?.purpose === "managed_login" &&
        pendingHandoff.status !== "completed"
      ) {
        const reconciled = await this.resumeAwaitingRunById({
          memberId: input.memberId,
          now,
          resumeAfterMailboxItemId: input.resumeAfterMailboxItemId,
          resumeDeliveryContext: input.resumeDeliveryContext ?? null,
          runId: run.id,
          store: this.store,
        });
        if (reconciled.status === "awaiting_user") {
          throw computerUseConflictError({
            code: "HOSTED_COMPUTER_AWAITING_USER",
            message: "Computer run is waiting for the user.",
            retryable: true,
          });
        }
        run = await this.requireFreshRun({
          memberId: input.memberId,
          runId: run.id,
        });
      }
    }
    const pageState = run.status === "awaiting_user"
      ? await this.readAwaitingOpenBrowserState({
          memberId: input.memberId,
          now,
          resumeAfterMailboxItemId: input.resumeAfterMailboxItemId ?? null,
          resumeDeliveryContext: input.resumeDeliveryContext ?? null,
          run,
          store: this.store,
        })
      : await this.readOpenBrowserState({
          memberId: input.memberId,
          run,
          store: this.store,
        });

    return {
      ...pageState,
      expiresAt: run.expiresAt.toISOString(),
      reused: handle.reused,
    };
  }

  private async openMemberOwnedProviderSetupRun(input: {
    memberId: string;
    runId: string;
  }): Promise<ComputerOpenResult> {
    const owned = await this.requireMemberOwnedProviderSetupModelRun(input);
    const run = await this.requireRunnableRun(input);
    const state = await this.readMemberOwnedProviderSetupBrowserState(run);
    const url = sanitizeComputerDisplayUrl(state.url);
    await this.store.updateRunBrowserState({
      expectedKernelSessionId: run.kernelSessionId,
      lastTitle: state.title,
      lastUrl: url,
      runId: run.id,
    }).catch(() => {
      // The browser observation succeeded; this write is only a display cache.
    });

    return {
      expiresAt: owned.expiresAt.toISOString(),
      reused: true,
      runId: run.id,
      status: "running",
      title: state.title,
      url,
      visibleText: state.visibleText,
    };
  }

  private async requireMemberOwnedProviderSetupModelRun(input: {
    memberId: string;
    runId: string;
  }): Promise<MemberOwnedProviderSetupRunRecord> {
    const run = await this.store.requireOwnedRun(input);
    if (
      !run.ownerKey
      || run.ownerPurpose !== MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE
    ) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
        message: "Computer run is not an authorized provider setup run.",
        retryable: false,
      });
    }
    return this.store.requireMemberOwnedProviderSetupRun({
      memberId: input.memberId,
      ownerKey: run.ownerKey,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: input.runId,
    });
  }

  private async startRunWithStore(input: {
    memberId: string;
    resumeAfterMailboxItemId?: string | null;
    resumeDeliveryContext?: HostedComputerDeliveryContext | null;
    startUrl: string | null;
  }, store: ComputerUseStore): Promise<ComputerRunHandle> {
    const handle = await this.acquireRunWithStore(input, store);
    if (handle.status === "awaiting_user" && input.resumeAfterMailboxItemId) {
      return await this.resumeAwaitingRunById({
        memberId: input.memberId,
        now: this.now(),
        resumeAfterMailboxItemId: input.resumeAfterMailboxItemId,
        resumeDeliveryContext: input.resumeDeliveryContext ?? null,
        runId: handle.runId,
        store,
      });
    }
    return handle;
  }

  private async acquireRunWithStore(input: {
    expectedRunId?: string | null;
    memberId: string;
    ownerKey?: string | null;
    ownerPurpose?: MemberOwnedProviderSetupComputerRunPurpose | null;
    startUrl: string | null;
  }, store: ComputerUseStore): Promise<ComputerRunHandle> {
    const now = this.now();
    const startUrl = requireComputerNavigationUrl(input.startUrl);
    const owner = readComputerRunOwner(input);

    let activeRun = await store.findActiveRunForMember({
      memberId: input.memberId,
      now,
    });

    if (activeRun) {
      await assertReusableComputerRunOwner({
        activeRun,
        expectedRunId: input.expectedRunId ?? null,
        memberId: input.memberId,
        now,
        owner,
        store,
      });
      if (activeRun.status === "cleanup_pending") {
        const cleanup = await this.expireRunAndDeleteBrowserBestEffort(
          activeRun,
          now,
          store,
        );
        if (cleanup === "failed") {
          throw browserCleanupFailedError();
        }
        activeRun = await store.findActiveRunForMember({
          memberId: input.memberId,
          now,
        });
        if (!activeRun) {
          return await this.acquireRunWithStore(input, store);
        }
      }
      while (isBlockingBrowserlessProvisioningRun(activeRun)) {
        const recovery = await this.recoverStaleBrowserlessProvisioningRun({
          now,
          run: activeRun,
          store,
        });
        if (recovery === "busy") {
          throw browserProvisioningInProgressError();
        }
        activeRun = await store.findActiveRunForMember({
          memberId: input.memberId,
          now,
        });
        if (!activeRun) {
          return await this.acquireRunWithStore(input, store);
        }
      }
      return runHandle(activeRun, true);
    }

    if (input.expectedRunId && !owner) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
        message: "The browser run bound to this operation is no longer active.",
        retryable: false,
      });
    }

    const kernel = this.requireKernel();
    const kernelProfileName = this.resolveKernelProfileName({
      memberId: input.memberId,
    });

    await this.expireStaleActiveRunsForMember({
      memberId: input.memberId,
      now,
      store,
    });

    const runId = createComputerId("hcr");
    const kernelBrowserName = buildKernelBrowserName({ runId });
    let browser: Awaited<ReturnType<ComputerKernelClient["createBrowser"]>> | null = null;
    let browserDeleteName: string | null = null;
    let attachAttempt: AttachRunBrowserInput | null = null;
    let attachedSessionId: string | null = null;
    let reservedRun: ComputerRunRecord | null = null;
    try {
      const createResult = await store.createRun({
        expiresAt: new Date(now.getTime() + COMPUTER_RUN_TTL_MS),
        id: runId,
        kernelProfileName,
        memberId: input.memberId,
        now,
        ownerKey: owner?.ownerKey ?? null,
        ownerPurpose: owner?.ownerPurpose ?? null,
        startUrl: sanitizeComputerDisplayUrl(startUrl),
      });
      if (!createResult.created) {
        await assertReusableComputerRunOwner({
          activeRun: createResult.run,
          expectedRunId: input.expectedRunId ?? null,
          memberId: input.memberId,
          now,
          owner,
          store,
        });
        if (createResult.run.status === "cleanup_pending") {
          const cleanup = await this.expireRunAndDeleteBrowserBestEffort(
            createResult.run,
            now,
            store,
          );
          if (cleanup === "failed") {
            throw browserCleanupFailedError();
          }
          return await this.acquireRunWithStore(input, store);
        }
        if (isBlockingBrowserlessProvisioningRun(createResult.run)) {
          const recovery = await this.recoverStaleBrowserlessProvisioningRun({
            now,
            run: createResult.run,
            store,
          });
          if (recovery !== "busy") {
            return await this.acquireRunWithStore(input, store);
          }
          throw browserProvisioningInProgressError();
        }
        return runHandle(createResult.run, true);
      }
      reservedRun = createResult.run;
      await kernel.ensureProfile(kernelProfileName);
      const browserCreateNow = this.now();
      browserDeleteName = kernelBrowserName;
      browser = await kernel.createBrowser({
        browserName: kernelBrowserName,
        profileName: kernelProfileName,
        saveChanges: true,
        timeoutSeconds: requireRemainingKernelTimeoutSeconds(reservedRun, browserCreateNow),
      });
      this.assertAllowedLiveViewUrl(browser.liveViewUrl);
      const initialState = startUrl
        ? await this.navigateKernelBrowserToUrl({
            sessionId: browser.sessionId,
            timeoutMs: COMPUTER_NAVIGATION_TIMEOUT_MS,
            url: startUrl,
          })
        : null;
      const attachInput: AttachRunBrowserInput = {
        kernelLiveViewUrlEncrypted: await this.encryptRequiredRunSecret({
          field: "kernel-live-view-url",
          memberId: input.memberId,
          runId,
          value: browser.liveViewUrl,
        }),
        kernelSessionId: browser.sessionId,
        memberId: input.memberId,
        now: this.now(),
        runId,
      };
      attachAttempt = attachInput;
      const run = await store.attachRunBrowser(attachInput);
      attachedSessionId = browser.sessionId;
      browser = null;
      if (initialState) {
        await store.updateRunBrowserState({
          expectedKernelSessionId: run.kernelSessionId,
          lastTitle: initialState.title,
          lastUrl: sanitizeComputerDisplayUrl(initialState.url),
          runId: run.id,
        }).catch(() => {
          // The browser is attached and usable; initial display state is only a cache.
        });
      }
      return runHandle(run, false);
    } catch (error) {
      let skipCompensation = false;
      if (
        browser &&
        attachAttempt &&
        !attachedSessionId &&
        !isMemberSuspendedComputerUseError(error)
      ) {
        const attachedRun = await this.replayAmbiguousRunBrowserAttach({
          attachInput: attachAttempt,
          store,
        });
        if (attachedRun === "unknown") {
          browser = null;
          browserDeleteName = null;
          skipCompensation = true;
        } else if (attachedRun) {
          browser = null;
          return runHandle(attachedRun, false);
        }
      }
      let browserCleanupFailed = false;
      const cleanupBrowserId = browser?.sessionId ?? attachedSessionId ?? browserDeleteName;
      if (cleanupBrowserId && !await this.deleteBrowserBestEffort(cleanupBrowserId)) {
        browserCleanupFailed = true;
      }
      if (reservedRun && !skipCompensation) {
        if (browserCleanupFailed) {
          if (!attachedSessionId) {
            await store.markRunCleanupPending({
              expectedKernelSessionId: reservedRun.kernelSessionId,
              expectedRunStatus: reservedRun.status,
              expectedRunUpdatedAt: reservedRun.updatedAt,
              memberId: reservedRun.memberId,
              now,
              runId: reservedRun.id,
            }).catch(() => {
              // Preserve the provisioning failure; the reservation cleanup is compensating.
            });
          }
        } else {
          await store.finishRun({
            expectedKernelSessionId: attachedSessionId,
            expectedRunStatus: "running",
            now,
            outcome: "failed",
            runId: reservedRun.id,
          }).catch(() => {
            // Preserve the provisioning failure; the reservation cleanup is compensating.
          });
        }
      }
      if (browserCleanupFailed) {
        throw browserCleanupFailedError();
      }
      throw error;
    }
  }

  private async readOpenBrowserState(input: {
    memberId: string;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<ComputerPageStateResult> {
    const run = await this.requireRunnableRun({
      memberId: input.memberId,
      runId: input.run.id,
    });
    const state = await this.readBrowserState(run);
    await input.store.updateRunBrowserState({
      expectedKernelSessionId: run.kernelSessionId,
      lastTitle: state.title,
      lastUrl: sanitizeComputerDisplayUrl(state.url),
      runId: run.id,
    });

    return {
      runId: run.id,
      status: "running",
      title: state.title,
      url: sanitizeComputerDisplayUrl(state.url),
      visibleText: state.visibleText,
    };
  }

  async act(input: HostedComputerActRequest & {
    memberId: string;
    runId: string;
  }): Promise<{ result: unknown; title: string | null; url: string | null }> {
    const owned = await this.store.requireOwnedRun(input);
    if (
      owned.ownerKey
      && owned.ownerPurpose === MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE
    ) {
      await this.store.requireMemberOwnedProviderSetupRun({
        memberId: input.memberId,
        ownerKey: owned.ownerKey,
        ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
        runId: input.runId,
      });
      if (!("steps" in input)) {
        throw computerUseError({
          code: "HOSTED_COMPUTER_PROVIDER_SETUP_ACTION_FORBIDDEN",
          httpStatus: 400,
          message: "Provider setup accepts structured control actions only.",
          retryable: false,
        });
      }
      const run = await this.requireRunnableRun(input);
      return this.executeMemberOwnedProviderSetupBrowserAct(input, run);
    }

    if (!("code" in input)) {
      throw computerUseError({
        code: "HOSTED_COMPUTER_SCRIPT_ACTION_REQUIRED",
        httpStatus: 400,
        message: "Ordinary computer runs require a Playwright action.",
        retryable: false,
      });
    }
    await this.store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    const run = await this.requireRunnableRun(input);
    assertGenericComputerRun(run);
    return this.executeBrowserAct(input, run);
  }

  async actOwnedRun(input: HostedComputerScriptActRequest & {
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    runId: string;
  }): Promise<{ result: unknown; title: string | null; url: string | null }> {
    await this.store.requireMemberOwnedProviderSetupRun(input);
    const run = await this.requireRunnableRun(input);
    return this.executeBrowserAct(input, run);
  }

  private async executeBrowserAct(
    input: HostedComputerScriptActRequest & { runId: string },
    run: ComputerRunRecord,
  ): Promise<{ result: unknown; title: string | null; url: string | null }> {
    const kernel = this.requireKernel();
    const sessionId = requireKernelSessionId(run);
    let result: Awaited<ReturnType<ComputerKernelClient["executePlaywright"]>>;
    try {
      result = await kernel.executePlaywright({
        code: buildComputerActCode(input),
        sessionId,
        timeoutMs: input.timeoutMs + COMPUTER_ACT_RESULT_MARGIN_MS,
      });
    } catch (error) {
      throw addComputerActFailureContext(error, input);
    }
    const state = readRequiredBrowserActionStateResult(result.result);
    await this.store.updateRunBrowserState({
      expectedKernelSessionId: run.kernelSessionId,
      lastTitle: state.title,
      lastUrl: sanitizeComputerDisplayUrl(state.url),
      runId: run.id,
    }).catch(() => {
      // The browser action already completed; this write is only a display cache.
    });

    return {
      result: state.result,
      title: state.title,
      url: state.url,
    };
  }

  private async executeMemberOwnedProviderSetupBrowserAct(
    input: HostedComputerControlActRequest & { runId: string },
    run: ComputerRunRecord,
  ): Promise<{ result: unknown; title: string | null; url: string | null }> {
    const kernel = this.requireKernel();
    let execution: Awaited<ReturnType<ComputerKernelClient["executePlaywright"]>>;
    try {
      execution = await kernel.executePlaywright({
        code: buildMemberOwnedProviderSetupComputerActCode(input),
        sessionId: requireKernelSessionId(run),
        timeoutMs: input.timeoutMs + COMPUTER_ACT_RESULT_MARGIN_MS,
      });
    } catch (error) {
      throw addComputerActFailureContext(error, {
        code: "trusted-provider-setup-control-action",
        timeoutMs: input.timeoutMs,
      });
    }
    const state = readBrowserStateResult(execution.result);
    const url = sanitizeComputerDisplayUrl(state.url);
    if (!url) {
      throw computerUseError({
        code: "HOSTED_COMPUTER_ACTION_STATE_INVALID",
        httpStatus: 502,
        message: "Provider setup browser action finished with an invalid state.",
        retryable: true,
      });
    }
    await this.store.updateRunBrowserState({
      expectedKernelSessionId: run.kernelSessionId,
      lastTitle: state.title,
      lastUrl: url,
      runId: run.id,
    }).catch(() => {
      // The browser action already completed; this write is only a display cache.
    });
    return {
      result: { visibleText: state.visibleText },
      title: state.title,
      url,
    };
  }

  async captureAndSealProviderCredentials<T>(input: {
    code: string;
    consume: (credentials: ComputerProviderCredentials) => Promise<T>;
    memberId: string;
    runId: string;
    timeoutMs: number;
  }): Promise<ComputerProviderCredentialCaptureResult<T>> {
    await this.store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    const run = await this.requireRunnableRun(input);
    assertGenericComputerRun(run);
    return this.executeCredentialCapture(input, run);
  }

  async captureAndSealProviderCredentialsInOwnedRun<T>(input: {
    code: string;
    consume: (credentials: ComputerProviderCredentials) => Promise<T>;
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    runId: string;
    timeoutMs: number;
  }): Promise<ComputerProviderCredentialCaptureResult<T>> {
    await this.store.requireMemberOwnedProviderSetupRun(input);
    const run = await this.requireRunnableRun(input);
    return this.executeCredentialCapture(input, run);
  }

  private async executeCredentialCapture<T>(
    input: {
      code: string;
      consume: (credentials: ComputerProviderCredentials) => Promise<T>;
      runId: string;
      timeoutMs: number;
    },
    run: ComputerRunRecord,
  ): Promise<ComputerProviderCredentialCaptureResult<T>> {
    const kernel = this.requireKernel();
    const sessionId = requireKernelSessionId(run);
    let execution: Awaited<ReturnType<ComputerKernelClient["executePlaywright"]>>;
    try {
      execution = await kernel.executePlaywright({
        code: buildComputerProviderCredentialCaptureCode(input.code),
        sessionId,
        timeoutMs: input.timeoutMs + COMPUTER_ACT_RESULT_MARGIN_MS,
      });
    } catch (error) {
      throw addComputerActFailureContext(error, {
        code: input.code,
        timeoutMs: input.timeoutMs,
      });
    }

    let credentials: ComputerProviderCredentials | null = null;
    let sealed: {
      state: ReturnType<typeof readRequiredBrowserActionStateResult>;
      value: T;
    } | null = null;
    try {
      let state: ReturnType<typeof readRequiredBrowserActionStateResult>;
      try {
        state = readRequiredBrowserActionStateResult(execution.result);
      } catch {
        throw computerUseError({
          code: "HOSTED_COMPUTER_ACT_RESULT_INVALID",
          httpStatus: 502,
          message: "Provider application credential capture returned an invalid result.",
          retryable: true,
        });
      }
      credentials = readRequiredComputerProviderCredentials(state.result);
      sealed = {
        state,
        value: await input.consume(credentials),
      };
    } finally {
      if (credentials) {
        credentials.clientId = "";
        credentials.clientSecret = "";
      }
      scrubComputerProviderCredentialResult(execution.result);
      execution.result = null;
    }
    if (!sealed) {
      throw computerUseError({
        code: "HOSTED_COMPUTER_PROVIDER_CREDENTIAL_CAPTURE_INVALID",
        httpStatus: 502,
        message: "Provider application credentials could not be captured safely.",
        retryable: true,
      });
    }

    await this.store.updateRunBrowserState({
      expectedKernelSessionId: run.kernelSessionId,
      lastTitle: sealed.state.title,
      lastUrl: sanitizeComputerDisplayUrl(sealed.state.url),
      runId: run.id,
    }).catch(() => {
      // Credential storage is already authoritative; this is only a display cache.
    });

    return {
      title: sealed.state.title,
      url: sanitizeComputerDisplayUrl(sealed.state.url),
      value: sealed.value,
    };
  }

  async osControl(input: HostedComputerOsControlRequest & {
    memberId: string;
    runId: string;
  }): Promise<ComputerOsControlResult> {
    const { memberId, runId, ...action } = input;
    const owned = await this.store.requireOwnedRun({ memberId, runId });
    if (owned.ownerPurpose === MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_PROVIDER_SETUP_OS_CONTROL_FORBIDDEN",
        message: "Provider setup requires the credential-safe browser action surface.",
        retryable: false,
      });
    }
    await this.store.requireMemberComputerUseAvailable({
      memberId,
    });
    const run = await this.requireRunnableRun({ memberId, runId });
    assertGenericComputerRun(run);
    const kernel = this.requireKernel();
    const sessionId = requireKernelSessionId(run);
    await requireNonSensitiveComputerOsTextTarget({
      action,
      kernel,
      sessionId,
    });
    await kernel.osControl({
      action,
      sessionId,
    });

    return {
      action: action.action,
      ok: true,
      runId: run.id,
      status: "running",
    };
  }

  async pauseForUser(input: {
    handoffPurpose: HostedComputerHandoffPurpose | null;
    memberId: string;
    pauseDeliveryContext?: HostedComputerDeliveryContext | null;
    reason: HostedComputerAwaitingReason;
    runId: string;
    suggestedReply: string | null;
  }): Promise<ComputerPauseForUserResult> {
    const run = await this.store.requireOwnedRun({
      memberId: input.memberId,
      runId: input.runId,
    });
    if (
      run.ownerKey
      && run.ownerPurpose === MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE
    ) {
      if (!input.handoffPurpose) {
        throw computerUseError({
          code: "HOSTED_COMPUTER_PROVIDER_SETUP_HANDOFF_REQUIRED",
          httpStatus: 400,
          message: "Provider setup pauses require a secure browser handoff.",
          retryable: false,
        });
      }
      return await this.pauseForUserWithStore(input, this.store, {
        ownerKey: run.ownerKey,
        ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      });
    }
    return await this.pauseForUserWithStore(input, this.store);
  }

  async pauseOwnedRunForUser(input: {
    handoffPurpose: HostedComputerHandoffPurpose;
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    reason: HostedComputerAwaitingReason;
    runId: string;
    suggestedReply: string | null;
  }): Promise<ComputerPauseForUserResult> {
    return await this.pauseForUserWithStore(input, this.store, {
      ownerKey: input.ownerKey,
      ownerPurpose: input.ownerPurpose,
    });
  }

  async hasOwnedRunHandoff(input: {
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    runId: string;
  }): Promise<boolean> {
    const run = await this.requireMemberOwnedProviderSetupStatusRun(input);
    if (run.status !== "awaiting_user" || !run.pendingHandoffId) {
      return false;
    }
    const handoff = await this.store.findHandoffByRun({
      handoffId: run.pendingHandoffId,
      runId: run.id,
    });
    return Boolean(
      handoff
      && handoff.status !== "completed"
      && handoff.status !== "expired"
      && !isFreshCheckpointingHandoff(handoff, this.now())
      && isProviderSetupHandoffPurpose(handoff.purpose),
    );
  }

  async issueOwnedRunHandoff(input: {
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    runId: string;
  }): Promise<string> {
    const run = await this.requireMemberOwnedProviderSetupStatusRun(input);
    if (
      run.status !== "awaiting_user"
      || !run.pendingHandoffId
      || !run.awaitingReason
      || !run.pausedAt
    ) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_HANDOFF_INCOMPLETE",
        message: "Private provider setup is not waiting for a handoff.",
      });
    }
    const handoff = await this.store.findHandoffByRun({
      handoffId: run.pendingHandoffId,
      runId: run.id,
    });
    if (!handoff || !isProviderSetupHandoffPurpose(handoff.purpose)) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_HANDOFF_INCOMPLETE",
        message: "Private provider setup handoff is unavailable.",
      });
    }
    const issued = await this.ensureAwaitingRunHandoff({
      handoffPurpose: handoff.purpose,
      memberId: input.memberId,
      now: this.now(),
      pauseDeliveryContext: run.checkpointContext
        ? {
            conversationId: run.checkpointContext.conversationId,
            recipientKey: run.checkpointContext.recipientKey,
            returnContactKind: handoff.returnContactKind,
          }
        : null,
      run,
      store: this.store,
    });
    if (!issued?.handoffUrl) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING",
        message: "Private provider setup handoff is still being prepared.",
        retryable: true,
      });
    }
    return issued.handoffUrl;
  }

  private async requireMemberOwnedProviderSetupStatusRun(input: {
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    runId: string;
  }): Promise<MemberOwnedProviderSetupRunRecord> {
    const run = await this.store.requireOwnedRun({
      memberId: input.memberId,
      runId: input.runId,
    });
    if (
      run.ownerKey !== input.ownerKey
      || run.ownerPurpose !== input.ownerPurpose
    ) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
        message: "Computer run ownership could not be verified.",
      });
    }
    return run;
  }

  private async pauseForUserWithStore(
    input: {
      handoffPurpose: HostedComputerHandoffPurpose | null;
      memberId: string;
      pauseDeliveryContext?: HostedComputerDeliveryContext | null;
      reason: HostedComputerAwaitingReason;
      runId: string;
      suggestedReply: string | null;
    },
    store: ComputerUseStore,
    owner: ComputerRunOwner | null = null,
  ): Promise<ComputerPauseForUserResult> {
    if (owner) {
      await store.requireMemberOwnedProviderSetupRun({
        memberId: input.memberId,
        ownerKey: owner.ownerKey,
        ownerPurpose: owner.ownerPurpose,
        runId: input.runId,
      });
    } else {
      await store.requireMemberComputerUseAvailable({
        memberId: input.memberId,
      });
    }
    const now = this.now();
    const run = await this.requireFreshRun({
      memberId: input.memberId,
      runId: input.runId,
    }, store);
    if (!owner) {
      assertGenericComputerRun(run);
    }
    if (input.handoffPurpose === "managed_login" && input.reason !== "login_needed") {
      throw managedLoginRequiresLoginNeededError();
    }

    if (run.status === "awaiting_user") {
      const ensured = input.handoffPurpose
        ? await this.ensureAwaitingRunHandoff({
            handoffPurpose: input.handoffPurpose,
            memberId: input.memberId,
            now,
            pauseDeliveryContext: input.pauseDeliveryContext ?? null,
            run,
            store,
          })
        : null;
      if (ensured) {
        return ensured;
      }
      return {
        awaitingReason: run.awaitingReason ?? input.reason,
        handoffUrl: null,
        runId: run.id,
        status: "awaiting_user",
        suggestedReply: run.suggestedReply,
      };
    }

    if (run.status !== "running") {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_NOT_RUNNING",
        message: "Computer run is not running.",
      });
    }

    if (input.handoffPurpose === "managed_login") {
      await this.captureManagedLoginBrowserDomain(run, store);
    } else {
      await this.captureBrowserStateBestEffort(run, store);
    }

    const handoff = input.handoffPurpose
      ? await this.createHandoff({
          memberId: input.memberId,
          purpose: input.handoffPurpose,
          returnContactKind: input.pauseDeliveryContext?.returnContactKind ?? null,
          runExpiresAt: run.expiresAt,
          runId: run.id,
          suggestedReply: input.suggestedReply,
        }, store)
      : null;
    let paused: ComputerRunRecord;
    try {
      paused = await store.markRunAwaitingUser({
        awaitingMessage: null,
        awaitingReason: input.reason,
        checkpointContext: normalizeComputerCheckpointContext(
          input.pauseDeliveryContext ?? null,
        ),
        now,
        pendingHandoffId: handoff?.record.id ?? null,
        runId: run.id,
        suggestedReply: input.suggestedReply,
      });
    } catch (error) {
      if (handoff) {
        await store.markHandoffExpired({
          expectedStatus: "open",
          expectedUpdatedAt: handoff.record.updatedAt,
          handoffId: handoff.record.id,
          now,
        }).catch(() => {
          // Preserve the transition failure; the handoff cleanup is compensating.
        });
      }
      throw error;
    }

    return {
      awaitingReason: paused.awaitingReason ?? input.reason,
      handoffUrl: handoff?.handoffUrl ?? null,
      runId: run.id,
      status: "awaiting_user",
      suggestedReply: input.suggestedReply,
    };
  }

  async finishRun(input: {
    memberId: string;
    outcome: HostedComputerFinishOutcome;
    runId: string;
  }): Promise<{ ok: true; runId: string; status: HostedComputerFinishOutcome }> {
    return await this.finishRunWithStore(input, this.store);
  }

  async finishOwnedRun(input: {
    memberId: string;
    outcome: HostedComputerFinishOutcome;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    runId: string;
  }): Promise<{ ok: true; runId: string; status: HostedComputerFinishOutcome }> {
    return await this.finishRunWithStore(input, this.store, {
      ownerKey: input.ownerKey,
      ownerPurpose: input.ownerPurpose,
    });
  }

  private async finishRunWithStore(
    input: {
      memberId: string;
      outcome: HostedComputerFinishOutcome;
      runId: string;
    },
    store: ComputerUseStore,
    owner: ComputerRunOwner | null = null,
  ): Promise<{ ok: true; runId: string; status: HostedComputerFinishOutcome }> {
    if (owner) {
      await store.requireMemberOwnedProviderSetupRun({
        memberId: input.memberId,
        ownerKey: owner.ownerKey,
        ownerPurpose: owner.ownerPurpose,
        runId: input.runId,
      });
    } else {
      await store.requireMemberComputerUseAvailable({
        memberId: input.memberId,
      });
    }
    const now = this.now();
    let run = await store.requireOwnedRun({
      memberId: input.memberId,
      runId: input.runId,
    });
    if (!owner) {
      assertGenericComputerRun(run);
    }
    if (isFinishOutcomeStatus(run.status)) {
      await this.deleteTerminalRunBrowser(run, now, store);
      return {
        ok: true,
        runId: run.id,
        status: run.status,
      };
    }
    if (run.status === "cleanup_pending") {
      throw browserCleanupFailedError();
    }

    const runStatusBeforePreparation = run.status;
    const prepared = await this.preparePendingHandoffForFinish(
      run,
      input.outcome,
      now,
      store,
    );
    run = await store.requireOwnedRun({
      memberId: input.memberId,
      runId: input.runId,
    });
    const expectedRunStatus =
      prepared.claimedCleanup
        ? "cleanup_pending"
        : input.outcome === "completed" && !prepared.expectedCompletedHandoffId
        ? "running"
        : runStatusBeforePreparation;
    if (run.status !== expectedRunStatus) {
      throw handoffIncompleteForFinishError();
    }
    const expectedKernelSessionId = run.kernelSessionId;

    const finished = await store.finishRun({
      expectedCompletedHandoffId: prepared.expectedCompletedHandoffId,
      expectedKernelSessionId,
      expectedRunStatus,
      now,
      outcome: input.outcome,
      runId: run.id,
      terminalBrowserCleanupId: expectedKernelSessionId
        ? null
        : buildKernelBrowserName({ runId: run.id }),
    });
    if (prepared.precleanedBrowserId) {
      await store.clearTerminalRunBrowser({
        expectedKernelSessionId: prepared.precleanedBrowserId,
        now,
        runId: finished.id,
      });
    } else {
      await this.deleteTerminalRunBrowser(finished, now, store);
    }

    return {
      ok: true,
      runId: run.id,
      status: input.outcome,
    };
  }

  async readHandoffPageState(input: {
    memberId: string;
    token: string;
  }): Promise<ComputerHandoffPageState> {
    const tokenHash = sha256Hex(input.token);
    let handoff = await this.store.requireComputerHandoffAccess({
      memberId: input.memberId,
      tokenHash,
    });
    const now = this.now();

    assertHandoffOwnedByMember(handoff, input.memberId);
    const readCheckpointReturnTo = async (): Promise<string | null> =>
      handoff.purpose === "managed_login" && handoff.status === "checkpointing"
        ? this.readMemberOwnedProviderSetupReturnPath({
            handoff,
            memberId: input.memberId,
            store: this.store,
          })
        : null;
    if (handoff.status === "completed") {
      const redirectTo = await this.resumeMemberOwnedProviderSetupAfterHandoff({
        handoff,
        memberId: input.memberId,
        store: this.store,
      });
      if (redirectTo) {
        return { kind: "redirect", url: redirectTo };
      }
      return {
        kind: "completed",
        returnContactKind: handoff.returnContactKind,
        suggestedReply: handoff.suggestedReply,
      };
    }

    if (isDeferredLoginCheckpointHandoff(handoff)) {
      const returnTo = await readCheckpointReturnTo();
      return {
        kind: "checkpointing",
        purpose: handoff.purpose,
        ...(returnTo ? { returnTo } : {}),
        returnContactKind: handoff.returnContactKind,
        suggestedReply: handoff.suggestedReply,
      };
    }

    if (
      handoff.purpose === "managed_login" &&
      isExpiredHandoff(handoff, now)
    ) {
      return {
        kind: "expired",
        returnContactKind: handoff.returnContactKind,
        suggestedReply: handoff.suggestedReply,
      };
    }

    if (isFreshCheckpointingHandoff(handoff, now)) {
      const returnTo = await readCheckpointReturnTo();
      return {
        kind: "checkpointing",
        purpose: handoff.purpose,
        ...(returnTo ? { returnTo } : {}),
        returnContactKind: handoff.returnContactKind,
        suggestedReply: handoff.suggestedReply,
      };
    }

    if (isExpiredHandoff(handoff, now)) {
      const expired = handoff.status === "open" || handoff.status === "checkpointing"
        ? await this.store.markHandoffExpired({
            expectedStatus: handoff.status,
            expectedUpdatedAt: handoff.updatedAt,
            handoffId: handoff.id,
            now,
          })
        : handoff;
      return {
        kind: "expired",
        returnContactKind: expired.returnContactKind,
        suggestedReply: expired.suggestedReply,
      };
    }

    if (
      handoff.purpose === "managed_login" &&
      handoff.status === "checkpointing"
    ) {
      return {
        kind: "managed_login",
        suggestedReply: handoff.suggestedReply,
      };
    }

    handoff = await this.releaseStaleHandoffClaim({
      handoff,
      now,
      store: this.store,
      tokenHash,
    });

    if (handoff.status === "completed") {
      const redirectTo = await this.resumeMemberOwnedProviderSetupAfterHandoff({
        handoff,
        memberId: input.memberId,
        store: this.store,
      });
      if (redirectTo) {
        return { kind: "redirect", url: redirectTo };
      }
      return {
        kind: "completed",
        returnContactKind: handoff.returnContactKind,
        suggestedReply: handoff.suggestedReply,
      };
    }

    if (isFreshCheckpointingHandoff(handoff, now)) {
      const returnTo = await readCheckpointReturnTo();
      return {
        kind: "checkpointing",
        purpose: handoff.purpose,
        ...(returnTo ? { returnTo } : {}),
        returnContactKind: handoff.returnContactKind,
        suggestedReply: handoff.suggestedReply,
      };
    }

    if (isExpiredHandoff(handoff, now)) {
      const expired = handoff.status === "open" || handoff.status === "checkpointing"
        ? await this.store.markHandoffExpired({
            expectedStatus: handoff.status,
            expectedUpdatedAt: handoff.updatedAt,
            handoffId: handoff.id,
            now,
          })
        : handoff;
      return {
        kind: "expired",
        returnContactKind: expired.returnContactKind,
        suggestedReply: expired.suggestedReply,
      };
    }

    assertOpenFreshHandoff(handoff, now);
    const run = await this.store.requireOwnedRun({
      memberId: input.memberId,
      runId: handoff.runId,
    });
    if (run.status !== "awaiting_user" || run.pendingHandoffId !== handoff.id) {
      const expired = await this.store.markHandoffExpired({
        expectedStatus: "open",
        expectedUpdatedAt: handoff.updatedAt,
        handoffId: handoff.id,
        now,
      });
      return {
        kind: "expired",
        returnContactKind: expired.returnContactKind,
        suggestedReply: expired.suggestedReply,
      };
    }

    if (isRetiredStaticPreviewHandoff(handoff)) {
      const expired = await this.store.markHandoffExpired({
        expectedStatus: "open",
        expectedUpdatedAt: handoff.updatedAt,
        handoffId: handoff.id,
        now,
      });
      return {
        kind: "expired",
        returnContactKind: expired.returnContactKind,
        suggestedReply: expired.suggestedReply,
      };
    }

    if (handoff.purpose === "managed_login") {
      return {
        kind: "managed_login",
        suggestedReply: handoff.suggestedReply,
      };
    }

    const liveViewUrl = await this.crypto.decryptRunSecret({
      field: "kernel-live-view-url",
      memberId: run.memberId,
      runId: run.id,
      value: run.kernelLiveViewUrlEncrypted,
    });

    if (!liveViewUrl) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_LIVE_VIEW_MISSING",
        message: "Computer handoff is not available.",
        retryable: true,
      });
    }
    this.assertAllowedLiveViewUrl(liveViewUrl);
    const setupOwned = await this.readMemberOwnedProviderSetupRun(run, this.store);
    const prerequisite = Boolean(
      setupOwned && handoff.purpose === "manual_browser_help",
    );

    return {
      description: prerequisite
        ? "Your provider may require a developer prerequisite before Murph can create your private application. Complete that provider step, then choose Done to return to Connect."
        : "Take over to finish this step. Use the keyboard icon in the browser to type or paste.",
      handoffId: handoff.id,
      iframeAllow: "autoplay; clipboard-read; clipboard-write",
      interaction: "takeover",
      kind: "open",
      liveViewUrl,
      purpose: requireSupportedPersistedHandoffPurpose(handoff.purpose),
      suggestedReply: handoff.suggestedReply,
      title: prerequisite ? "Continue provider setup" : "Your turn",
    };
  }

  async continueManagedLoginHandoff(input: {
    memberId: string;
    token: string;
  }): Promise<ComputerManagedLoginContinuation> {
    const tokenHash = sha256Hex(input.token);
    let handoff = await this.store.requireComputerHandoffAccess({
      memberId: input.memberId,
      tokenHash,
    });
    const now = this.now();

    assertHandoffOwnedByMember(handoff, input.memberId);
    if (handoff.status === "completed") {
      const redirectTo = await this.resumeMemberOwnedProviderSetupAfterHandoff({
        handoff,
        memberId: input.memberId,
        store: this.store,
      });
      return redirectTo
        ? { kind: "redirect", url: redirectTo }
        : { kind: "completed" };
    }
    if (
      handoff.purpose === "managed_login" &&
      isExpiredHandoff(handoff, now)
    ) {
      return { kind: "expired" };
    }
    if (isFreshCheckpointingHandoff(handoff, now)) {
      return { kind: "checkpointing" };
    }
    if (isExpiredHandoff(handoff, now)) {
      if (handoff.status === "open" || handoff.status === "checkpointing") {
        await this.store.markHandoffExpired({
          expectedStatus: handoff.status,
          expectedUpdatedAt: handoff.updatedAt,
          handoffId: handoff.id,
          now,
        });
      }
      return { kind: "expired" };
    }

    if (handoff.purpose === "login" && handoff.status === "open") {
      return {
        kind: "redirect",
        url: buildComputerHandoffUrl({
          env: this.env,
          token: input.token,
        }),
      };
    }
    if (handoff.purpose !== "managed_login") {
      throw computerUseNotFoundError("Computer handoff was not found.");
    }

    const run = await this.store.requireOwnedRun({
      memberId: input.memberId,
      runId: handoff.runId,
    });
    if (
      run.status !== "awaiting_user" ||
      run.pendingHandoffId !== handoff.id ||
      run.expiresAt <= now
    ) {
      return { kind: "expired" };
    }

    let claimed: ComputerHandoffRecord | null = null;
    let staleClaimUpdatedAt: Date | null = null;
    if (handoff.status === "checkpointing") {
      staleClaimUpdatedAt = handoff.updatedAt;
      claimed = await this.store.reclaimHandoffForCompletion({
        expectedUpdatedAt: handoff.updatedAt,
        handoffId: handoff.id,
        memberId: input.memberId,
        now,
      });
      if (!claimed) {
        return { kind: "checkpointing" };
      }
      handoff = claimed;
    } else {
      assertOpenFreshHandoff(handoff, now);
    }

    const domain = requireManagedLoginDomain(run);
    const recoveredPublishedTaskBrowser = Boolean(
      staleClaimUpdatedAt &&
      run.kernelSessionId &&
      run.updatedAt > staleClaimUpdatedAt,
    );
    if (run.kernelSessionId) {
      return await this.beginManagedLoginHandoff({
        claimed,
        domain,
        handoff,
        memberId: input.memberId,
        recoveredPublishedTaskBrowser,
        run,
        store: this.store,
        token: input.token,
      });
    }

    let connection: KernelManagedAuthConnection | null;
    try {
      connection = await this.requireKernel().findManagedAuthConnection({
        domain,
        profileName: run.kernelProfileName,
      });
    } catch (error) {
      if (claimed) {
        await this.store.releaseHandoffClaim({
          expectedUpdatedAt: claimed.updatedAt,
          handoffId: claimed.id,
        }).catch(() => {});
      }
      throw error;
    }
    const currentFlow = readManagedAuthFlowForHandoff({
      connection,
      handoff,
    });

    if (currentFlow && isManagedAuthTerminalFlow(currentFlow)) {
      return await this.beginManagedLoginHandoff({
        claimed,
        domain,
        handoff,
        memberId: input.memberId,
        recoveredPublishedTaskBrowser,
        run,
        store: this.store,
        token: input.token,
      });
    }

    if (currentFlow && isManagedAuthInProgressFlow(currentFlow, now)) {
      if (claimed) {
        await this.store.releaseHandoffClaim({
          expectedUpdatedAt: claimed.updatedAt,
          handoffId: claimed.id,
        });
      }
      return {
        kind: "redirect",
        url: buildManagedLoginHostedUrl({
          env: this.env,
          hostedUrl: requireManagedAuthHostedUrl(currentFlow),
          token: input.token,
        }),
      };
    }

    return await this.beginManagedLoginHandoff({
      claimed,
      domain,
      handoff,
      memberId: input.memberId,
      recoveredPublishedTaskBrowser,
      run,
      store: this.store,
      token: input.token,
    });
  }

  private async beginManagedLoginHandoff(input: {
    claimed: ComputerHandoffRecord | null;
    domain: string;
    handoff: ComputerHandoffRecord;
    memberId: string;
    recoveredPublishedTaskBrowser: boolean;
    run: ComputerRunRecord;
    store: ComputerUseStore;
    token: string;
  }): Promise<ComputerManagedLoginContinuation> {
    const claimed = input.claimed ??
      await input.store.claimHandoffForCompletion({
        handoffId: input.handoff.id,
        memberId: input.memberId,
      });
    if (!claimed) {
      return { kind: "checkpointing" };
    }

    let fallbackRun: ComputerRunRecord | null = input.run;
    let detachAmbiguous = false;
    let launchAttempted = false;
    let providerWriterObserved = false;
    let providerWriterMutationAmbiguous = false;
    try {
      let run = await input.store.requireOwnedRun({
        memberId: input.memberId,
        runId: input.run.id,
      });
      if (
        run.status !== "awaiting_user" ||
        run.pendingHandoffId !== claimed.id
      ) {
        fallbackRun = null;
        throw managedLoginUnavailableError();
      }

      if (input.claimed && run.kernelSessionId) {
        const recoveryConnection =
          await this.requireKernel().findManagedAuthConnection({
            domain: input.domain,
            profileName: run.kernelProfileName,
          });
        const recoveryFlow = readManagedAuthFlowForHandoff({
          connection: recoveryConnection,
          handoff: claimed,
        });
        if (
          input.recoveredPublishedTaskBrowser &&
          recoveryFlow &&
          isManagedAuthSuccessfulTerminalFlow(recoveryFlow)
        ) {
          if (recoveryFlow.browserSessionId) {
            providerWriterMutationAmbiguous = true;
            await this.requireKernel().deleteBrowserByIdOrName(
              recoveryFlow.browserSessionId,
            );
            providerWriterMutationAmbiguous = false;
            providerWriterObserved = false;
          }
          return await this.completeSuccessfulManagedLoginContinuation({
            claimed,
            run,
            store: input.store,
          });
        }

        fallbackRun = null;
        detachAmbiguous = true;
        run = await this.detachRunBrowserForHandoff(
          run,
          this.now(),
          input.store,
          claimed.updatedAt,
        );
        detachAmbiguous = false;
        fallbackRun = run;
      }

      let connection = await this.requireKernel().ensureManagedAuthConnection({
        domain: input.domain,
        profileName: run.kernelProfileName,
      });
      providerWriterObserved = Boolean(connection.browserSessionId);

      let currentFlow: KernelManagedAuthConnection | null = null;
      if (input.claimed || !run.kernelSessionId) {
        connection =
          await this.requireKernel().findManagedAuthConnection({
            domain: input.domain,
            profileName: run.kernelProfileName,
          }) ?? connection;
        currentFlow = readManagedAuthFlowForHandoff({
          connection,
          handoff: claimed,
        });
      }

      if (currentFlow && isManagedAuthTerminalFlow(currentFlow)) {
        if (currentFlow.browserSessionId) {
          providerWriterMutationAmbiguous = true;
          await this.requireKernel().deleteBrowserByIdOrName(
            currentFlow.browserSessionId,
          );
          providerWriterMutationAmbiguous = false;
          providerWriterObserved = false;
        }
        if (!isManagedAuthSuccessfulTerminalFlow(currentFlow)) {
          return await this.redirectManagedLoginToLiveViewFallback({
            claimed,
            run,
            store: input.store,
            token: input.token,
          });
        }
        return await this.completeSuccessfulManagedLoginContinuation({
          claimed,
          run,
          store: input.store,
        });
      }

      if (currentFlow && isManagedAuthInProgressFlow(currentFlow, this.now())) {
        await input.store.releaseHandoffClaim({
          expectedUpdatedAt: claimed.updatedAt,
          handoffId: claimed.id,
        });
        return {
          kind: "redirect",
          url: buildManagedLoginHostedUrl({
            env: this.env,
            hostedUrl: requireManagedAuthHostedUrl(currentFlow),
            token: input.token,
          }),
        };
      }

      const hadTaskBrowser = Boolean(run.kernelSessionId);
      if (run.kernelSessionId) {
        fallbackRun = null;
        detachAmbiguous = true;
        run = await this.detachRunBrowserForHandoff(
          run,
          this.now(),
          input.store,
          claimed.updatedAt,
        );
        detachAmbiguous = false;
        fallbackRun = run;
        connection =
          await this.requireKernel().findManagedAuthConnection({
            domain: input.domain,
            profileName: run.kernelProfileName,
          }) ?? connection;
        if (connection.browserSessionId) {
          providerWriterMutationAmbiguous = true;
          await this.requireKernel().deleteBrowserByIdOrName(
            connection.browserSessionId,
          );
          providerWriterMutationAmbiguous = false;
          providerWriterObserved = false;
        }
        currentFlow = null;
      }

      if (!hadTaskBrowser && connection.browserSessionId) {
        providerWriterMutationAmbiguous = true;
        await this.requireKernel().deleteBrowserByIdOrName(
          connection.browserSessionId,
        );
        providerWriterMutationAmbiguous = false;
        providerWriterObserved = false;
      }
      launchAttempted = true;
      const hostedUrl = (
        await this.requireKernel().startManagedAuthLogin(connection.id)
      ).hostedUrl;

      await input.store.releaseHandoffClaim({
        expectedUpdatedAt: claimed.updatedAt,
        handoffId: claimed.id,
      });
      return {
        kind: "redirect",
        url: buildManagedLoginHostedUrl({
          env: this.env,
          hostedUrl,
          token: input.token,
        }),
      };
    } catch (managedLoginError) {
      if (managedLoginError instanceof ManagedLoginTerminalOutcomeUnknownError) {
        return { kind: "checkpointing" };
      }
      if (isReplyBoundaryUnavailableError(managedLoginError)) {
        throw managedLoginUnavailableError({
          cause: managedLoginError,
          stage: "live_view_fallback",
        });
      }
      let latest: KernelManagedAuthConnection | null;
      try {
        latest = await this.requireKernel().findManagedAuthConnection({
          domain: input.domain,
          profileName: input.run.kernelProfileName,
        });
      } catch {
        if (
          !detachAmbiguous &&
          !launchAttempted &&
          !providerWriterObserved &&
          !providerWriterMutationAmbiguous
        ) {
          await input.store.releaseHandoffClaim({
            expectedUpdatedAt: claimed.updatedAt,
            handoffId: claimed.id,
          }).catch(() => {});
          throw managedLoginUnavailableError({
            cause: managedLoginError,
            stage: "managed_auth_start",
          });
        }
        return { kind: "checkpointing" };
      }
      const recoveredFlow = readManagedAuthFlowForHandoff({
        connection: latest,
        handoff: claimed,
      });

      if (
        recoveredFlow &&
        isManagedAuthInProgressFlow(recoveredFlow, this.now())
      ) {
        await input.store.releaseHandoffClaim({
          expectedUpdatedAt: claimed.updatedAt,
          handoffId: claimed.id,
        }).catch(() => {});
        return {
          kind: "redirect",
          url: buildManagedLoginHostedUrl({
            env: this.env,
            hostedUrl: requireManagedAuthHostedUrl(recoveredFlow),
            token: input.token,
          }),
        };
      }

      if (latest?.browserSessionId) {
        return { kind: "checkpointing" };
      }

      if (
        detachAmbiguous ||
        launchAttempted ||
        providerWriterMutationAmbiguous
      ) {
        return { kind: "checkpointing" };
      }

      if (fallbackRun) {
        try {
          return await this.redirectManagedLoginToLiveViewFallback({
            claimed,
            run: fallbackRun,
            store: input.store,
            token: input.token,
          });
        } catch (fallbackError) {
          throw managedLoginUnavailableError({
            cause: fallbackError,
            stage: "live_view_fallback",
          });
        }
      }
      throw managedLoginUnavailableError({
        cause: managedLoginError,
        stage: "managed_auth_start",
      });
    }
  }

  private async redirectManagedLoginToLiveViewFallback(input: {
    claimed: ComputerHandoffRecord;
    run: ComputerRunRecord;
    store: ComputerUseStore;
    token: string;
  }): Promise<ComputerManagedLoginContinuation> {
    await this.convertManagedLoginToLiveViewFallback(input);
    return {
      kind: "redirect",
      url: buildComputerHandoffUrl({
        env: this.env,
        token: input.token,
      }),
    };
  }

  private async convertManagedLoginToLiveViewFallback(input: {
    claimed: ComputerHandoffRecord;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<ComputerRunRecord> {
    const prepared = input.run.kernelSessionId
      ? null
      : await this.prepareRunBrowserFromProfile(
          input.run,
          input.claimed.updatedAt,
        );
    const terminalInput = {
      browser: prepared ? managedLoginBrowserFromPrepared(prepared) : null,
      expectedHandoffUpdatedAt: input.claimed.updatedAt,
      handoffId: input.claimed.id,
      memberId: input.run.memberId,
      now: this.now(),
      runId: input.run.id,
    };
    try {
      return (
        await input.store.convertManagedLoginHandoffToLogin(terminalInput)
      ).run;
    } catch (firstError) {
      try {
        return (
          await input.store.convertManagedLoginHandoffToLogin(terminalInput)
        ).run;
      } catch (secondError) {
        if (
          isReplyBoundaryUnavailableError(firstError) &&
          isReplyBoundaryUnavailableError(secondError)
        ) {
          throw secondError;
        }
        throw new ManagedLoginTerminalOutcomeUnknownError();
      }
    }
  }

  private async completeSuccessfulManagedLoginHandoff(input: {
    claimed: ComputerHandoffRecord;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<ComputerRunRecord> {
    const prepared = input.run.kernelSessionId
      ? null
      : await this.prepareRunBrowserFromProfile(
          input.run,
          input.claimed.updatedAt,
        );
    const terminalInput = {
      browser: prepared ? managedLoginBrowserFromPrepared(prepared) : null,
      expectedHandoffUpdatedAt: input.claimed.updatedAt,
      handoffId: input.claimed.id,
      memberId: input.run.memberId,
      now: this.now(),
      runId: input.run.id,
    };
    try {
      return (await input.store.completeManagedLoginHandoff(terminalInput)).run;
    } catch {
      try {
        return (await input.store.completeManagedLoginHandoff(terminalInput)).run;
      } catch {
        throw new ManagedLoginTerminalOutcomeUnknownError();
      }
    }
  }

  private async completeSuccessfulManagedLoginContinuation(input: {
    claimed: ComputerHandoffRecord;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<ComputerManagedLoginContinuation> {
    await this.completeSuccessfulManagedLoginHandoff(input);
    const completed = await input.store.findHandoffByRun({
      handoffId: input.claimed.id,
      runId: input.run.id,
    });
    if (!completed || completed.status !== "completed") {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_HANDOFF_INCOMPLETE",
        message: "Computer handoff completion could not be confirmed.",
      });
    }
    const redirectTo = await this.resumeMemberOwnedProviderSetupAfterHandoff({
      handoff: completed,
      memberId: input.run.memberId,
      store: input.store,
    });
    return redirectTo
      ? { kind: "redirect", url: redirectTo }
      : { kind: "completed" };
  }

  private async readMemberOwnedProviderSetupRun(
    run: ComputerRunRecord,
    store: ComputerUseStore,
  ): Promise<MemberOwnedProviderSetupRunRecord | null> {
    if (!run.ownerKey && !run.ownerPurpose) {
      return null;
    }
    if (
      !run.ownerKey
      || run.ownerPurpose !== MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE
    ) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
        message: "Computer run ownership could not be verified.",
      });
    }
    return await store.requireMemberOwnedProviderSetupRun({
      memberId: run.memberId,
      ownerKey: run.ownerKey,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: run.id,
    });
  }

  private async readMemberOwnedProviderSetupReturnPath(input: {
    handoff: ComputerHandoffRecord;
    memberId: string;
    store: ComputerUseStore;
  }): Promise<string | null> {
    const candidate = await input.store.requireOwnedRun({
      memberId: input.memberId,
      runId: input.handoff.runId,
    });
    const owned = await this.readMemberOwnedProviderSetupRun(candidate, input.store);
    return owned ? MEMBER_OWNED_PROVIDER_SETUP_RETURN_PATH : null;
  }

  private async resumeMemberOwnedProviderSetupAfterHandoff(input: {
    handoff: ComputerHandoffRecord;
    memberId: string;
    store: ComputerUseStore;
  }): Promise<string | null> {
    const candidate = await input.store.requireOwnedRun({
      memberId: input.memberId,
      runId: input.handoff.runId,
    });
    const owned = await this.readMemberOwnedProviderSetupRun(
      candidate,
      input.store,
    );
    if (!owned) {
      return null;
    }
    const returnPath = MEMBER_OWNED_PROVIDER_SETUP_RETURN_PATH;
    const ownerKey = owned.ownerKey;
    if (!ownerKey) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
        message: "Computer run ownership could not be verified.",
      });
    }
    if (owned.status === "running") {
      await this.requestProviderSetupContinuation({
        handoffId: input.handoff.id,
        memberId: owned.memberId,
        runId: owned.id,
        setupId: ownerKey,
      });
      return returnPath;
    }
    if (
      input.handoff.status !== "completed"
      || owned.status !== "awaiting_user"
      || owned.pendingHandoffId !== input.handoff.id
      || owned.pausedAt === null
    ) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_NOT_RUNNING",
        message: "Private provider setup could not resume from this handoff.",
        retryable: true,
      });
    }

    try {
      await input.store.markRunRunning({
        awaitingReason: owned.awaitingReason,
        expectedHandoffStatus: "completed",
        expectedHandoffUpdatedAt: input.handoff.updatedAt,
        expectedKernelSessionId: requireKernelSessionId(owned),
        expectedPausedAt: owned.pausedAt,
        expectedPendingHandoffId: input.handoff.id,
        expectedResumeAfterMailboxLaneSeq: owned.resumeAfterMailboxLaneSeq,
        now: this.now(),
        runId: owned.id,
      });
    } catch (error) {
      const latest = await input.store.requireMemberOwnedProviderSetupRun({
        memberId: owned.memberId,
        ownerKey,
        ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
        runId: owned.id,
      });
      if (latest.status !== "running") {
        throw error;
      }
    }
    await this.requestProviderSetupContinuation({
      handoffId: input.handoff.id,
      memberId: owned.memberId,
      runId: owned.id,
      setupId: ownerKey,
    });
    return returnPath;
  }

  private async buildHandoffCompletion(
    handoff: ComputerHandoffRecord,
    memberId: string,
    store: ComputerUseStore,
  ): Promise<ComputerHandoffCompletion> {
    const redirectTo = handoff.status === "completed"
      ? await this.resumeMemberOwnedProviderSetupAfterHandoff({
          handoff,
          memberId,
          store,
        })
      : null;
    return {
      redirectTo,
      returnContactKind: redirectTo ? null : handoff.returnContactKind,
      status: handoff.status,
      suggestedReply: redirectTo ? null : handoff.suggestedReply,
    };
  }

  async completeHandoff(input: {
    memberId: string;
    token: string;
  }): Promise<ComputerHandoffCompletion> {
    const handoff = await this.store.requireComputerHandoffAccess({
      memberId: input.memberId,
      tokenHash: sha256Hex(input.token),
    });
    return await this.completeHandoffWithStore(input, this.store, handoff);
  }

  private async completeHandoffWithStore(
    input: {
      memberId: string;
      token: string;
    },
    store: ComputerUseStore,
    handoff: ComputerHandoffRecord,
  ): Promise<ComputerHandoffCompletion> {
    const now = this.now();
    const tokenHash = sha256Hex(input.token);

    assertHandoffOwnedByMember(handoff, input.memberId);

    if (handoff.status === "completed") {
      return await this.buildHandoffCompletion(handoff, input.memberId, store);
    }

    if (isDeferredLoginCheckpointHandoff(handoff)) {
      return await this.buildHandoffCompletion(handoff, input.memberId, store);
    }

    if (handoff.purpose === "managed_login") {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_MANAGED_LOGIN_REQUIRES_VERIFICATION",
        message: "Managed sign-in must be verified before completion.",
      });
    }

    const openHandoff = await this.releaseStaleHandoffClaim({
      handoff,
      now,
      store,
      tokenHash,
    });

    if (openHandoff.status === "completed") {
      return await this.buildHandoffCompletion(
        openHandoff,
        input.memberId,
        store,
      );
    }

    if (isFreshCheckpointingHandoff(openHandoff, now)) {
      return await this.buildHandoffCompletion(
        openHandoff,
        input.memberId,
        store,
      );
    }

    if (isExpiredHandoff(openHandoff, now)) {
      if (openHandoff.status === "open" || openHandoff.status === "checkpointing") {
        const expired = await store.markHandoffExpired({
          expectedStatus: openHandoff.status,
          expectedUpdatedAt: openHandoff.updatedAt,
          handoffId: openHandoff.id,
          now,
        });
        return await this.buildHandoffCompletion(expired, input.memberId, store);
      }
      return await this.buildHandoffCompletion(
        openHandoff,
        input.memberId,
        store,
      );
    }

    assertOpenFreshHandoff(openHandoff, now);
    if (openHandoff.purpose === "managed_login") {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_MANAGED_LOGIN_REQUIRES_VERIFICATION",
        message: "Managed sign-in must be verified before completion.",
      });
    }

    const claimed = await store.claimHandoffForCompletion({
      handoffId: openHandoff.id,
      memberId: input.memberId,
    });
    if (!claimed) {
      const latest = await store.requireHandoffByTokenHash({
        tokenHash,
      });
      return await this.buildHandoffCompletion(latest, input.memberId, store);
    }

    try {
      const run = await this.requireFreshRun({
        memberId: input.memberId,
        runId: claimed.runId,
      }, store);
      if (run.status !== "awaiting_user" || run.pendingHandoffId !== claimed.id) {
        const expired = await store.markHandoffExpired({
          expectedStatus: "checkpointing",
          expectedUpdatedAt: claimed.updatedAt,
          handoffId: claimed.id,
          now,
        });
        return await this.buildHandoffCompletion(expired, input.memberId, store);
      }

      const completed = await store.completeHandoff({
        expectedUpdatedAt: claimed.updatedAt,
        handoffId: claimed.id,
        now,
      });

      return await this.buildHandoffCompletion(completed, input.memberId, store);
    } catch (error) {
      await store.releaseHandoffClaim({
        handoffId: claimed.id,
        expectedUpdatedAt: claimed.updatedAt,
      }).catch(() => {
        // The original checkpoint failure should stay visible to the caller.
      });
      throw error;
    }
  }

  private async releaseStaleHandoffClaim(input: {
    handoff: ComputerHandoffRecord;
    now: Date;
    store: ComputerUseStore;
    tokenHash: string;
  }): Promise<ComputerHandoffRecord> {
    if (isDeferredLoginCheckpointHandoff(input.handoff)) {
      return input.handoff;
    }
    if (!isStaleCheckpointingHandoff(input.handoff, input.now)) {
      return input.handoff;
    }

    try {
      await input.store.releaseHandoffClaim({
        expectedUpdatedAt: input.handoff.updatedAt,
        handoffId: input.handoff.id,
      });
    } catch (error) {
      if (!isStaleRunStateConflict(error)) {
        throw error;
      }
    }

    return await input.store.requireHandoffByTokenHash({
      tokenHash: input.tokenHash,
    });
  }

  async cleanupExpiredRuns(input: {
    now?: Date;
  } = {}): Promise<ComputerExpiredRunCleanupResult> {
    const now = input.now ?? this.now();
    const staleRuns = await this.store.listStaleActiveRuns({
      limit: COMPUTER_CLEANUP_BATCH_SIZE,
      now,
    });
    let expiredRuns = 0;
    for (const run of staleRuns) {
      if (await this.expireRunAndDeleteBrowserForCleanup(run, now) === "expired") {
        expiredRuns += 1;
      }
    }

    return {
      expiredRuns,
    };
  }

  async deleteMemberExternalStateForAccountDeletion(input: {
    memberId: string;
  }): Promise<ComputerAccountExternalCleanupResult> {
    const now = this.now();
    const runs = await this.prepareMemberRunsForAccountDeletion({
      memberId: input.memberId,
      now,
    });
    const browserIds = buildKernelBrowserIdsForAccountDeletion({ now, runs });
    const profileNames = uniqueStrings([
      buildKernelProfileNameForAccountDeletion({
        env: this.env,
        memberId: input.memberId,
      }),
      ...buildKernelProfileNamesForAccountDeletion(runs),
    ]);

    if (browserIds.length === 0 && profileNames.length === 0) {
      return {
        browserSessionsDeleted: 0,
        profilesDeleted: 0,
      };
    }

    const kernel = this.requireKernel();
    for (const browserId of browserIds) {
      await kernel.deleteBrowserByIdOrName(browserId);
    }
    for (const profileName of profileNames) {
      const connections = await kernel.listManagedAuthConnections({
        profileName,
      });
      for (const connection of connections) {
        await kernel.deleteManagedAuthConnection(connection.id);
      }
      await kernel.deleteProfile(profileName);
    }

    return {
      browserSessionsDeleted: browserIds.length,
      profilesDeleted: profileNames.length,
    };
  }

  private async createHandoff(input: {
    memberId: string;
    purpose: HostedComputerHandoffPurpose;
    returnContactKind: HostedComputerReturnContactKind | null;
    runExpiresAt: Date;
    runId: string;
    suggestedReply: string | null;
  }, store: ComputerUseStore = this.store): Promise<{
    handoffUrl: string;
    record: ComputerHandoffRecord;
  }> {
    const token = createComputerHandoffToken();
    const expiresAt = new Date(Math.min(
      this.now().getTime() + COMPUTER_HANDOFF_TTL_MS,
      input.runExpiresAt.getTime(),
    ));
    const record = await store.createHandoff({
      expiresAt,
      memberId: input.memberId,
      purpose: input.purpose,
      returnContactKind: input.returnContactKind,
      runId: input.runId,
      suggestedReply: input.suggestedReply,
      tokenHash: sha256Hex(token),
    });

    return {
      handoffUrl: buildComputerHandoffUrl({ env: this.env, token }),
      record,
    };
  }

  private async rotateManagedLoginHandoffCapability(input: {
    handoff: ComputerHandoffRecord;
    now: Date;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<{
    handoffUrl: string;
    record: ComputerHandoffRecord;
  }> {
    if (input.handoff.status !== "open" && input.handoff.status !== "checkpointing") {
      throw new TypeError("Managed login capability cannot be rotated from a terminal state.");
    }
    const token = createComputerHandoffToken();
    const expiresAt = new Date(Math.min(
      input.now.getTime() + COMPUTER_HANDOFF_TTL_MS,
      input.run.expiresAt.getTime(),
    ));
    const record = await input.store.rotateManagedLoginHandoffCapability({
      expectedStatus: input.handoff.status,
      expectedTokenHash: input.handoff.tokenHash,
      expectedUpdatedAt: input.handoff.updatedAt,
      expiresAt,
      handoffId: input.handoff.id,
      memberId: input.run.memberId,
      now: input.now,
      runId: input.run.id,
      tokenHash: sha256Hex(token),
    });
    return {
      handoffUrl: buildComputerHandoffUrl({ env: this.env, token }),
      record,
    };
  }

  private async ensureAwaitingRunHandoff(input: {
    handoffPurpose: HostedComputerHandoffPurpose;
    memberId: string;
    now: Date;
    pauseDeliveryContext: HostedComputerDeliveryContext | null;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<ComputerPauseForUserResult | null> {
    if (!input.run.awaitingReason || !input.run.pausedAt) {
      return null;
    }
    const awaitingReason = input.run.awaitingReason;

    if (input.run.expiresAt <= input.now) {
      return null;
    }

    if (!doesResumeContextMatchCheckpoint({
      expected: input.run.checkpointContext,
      received: input.pauseDeliveryContext,
    })) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RESUME_CONTEXT_MISMATCH",
        message: "Computer run checkpoint must be delivered to the same conversation context.",
      });
    }

    if (!input.run.pendingHandoffId) {
      if (!input.run.kernelSessionId) {
        return null;
      }
      return await this.attachFirstAwaitingRunHandoff(input);
    }

    let existing = await input.store.findHandoffByRun({
      handoffId: input.run.pendingHandoffId,
      runId: input.run.id,
    });
    if (!existing) {
      return null;
    }
    if (existing.purpose === "managed_login") {
      if (existing.status === "completed" || existing.status === "expired") {
        return null;
      }
      if (isFreshCheckpointingHandoff(existing, input.now)) {
        return null;
      }
      const capability = await this.rotateManagedLoginHandoffCapability({
        handoff: existing,
        now: input.now,
        run: input.run,
        store: input.store,
      });
      return {
        awaitingReason,
        handoffUrl: capability.handoffUrl,
        runId: input.run.id,
        status: "awaiting_user",
        suggestedReply: input.run.suggestedReply ?? existing.suggestedReply,
      };
    }
    if (!input.run.kernelSessionId) {
      return null;
    }
    if (
      existing.status === "checkpointing" &&
      !isStaleCheckpointingHandoff(existing, input.now)
    ) {
      return null;
    }

    const run = input.run;
    // Interactive handoff links stay interactive once issued.
    const replacementPurpose =
      isRetiredStaticPreviewHandoff(existing)
        ? input.handoffPurpose
        : requireSupportedPersistedHandoffPurpose(existing.purpose);
    if (existing.status === "open" && existing.expiresAt <= input.now) {
      existing = await input.store.markHandoffExpired({
        expectedStatus: "open",
        expectedUpdatedAt: existing.updatedAt,
        handoffId: existing.id,
        now: input.now,
      });
    } else if (existing.status === "checkpointing") {
      existing = await input.store.markHandoffExpired({
        expectedStatus: "checkpointing",
        expectedUpdatedAt: existing.updatedAt,
        handoffId: existing.id,
        now: input.now,
      });
    }

    const handoff = await this.createHandoff({
      memberId: input.memberId,
      purpose: replacementPurpose,
      returnContactKind: existing.returnContactKind,
      runExpiresAt: run.expiresAt,
      runId: run.id,
      suggestedReply: existing.suggestedReply,
    }, input.store);
    try {
      const refreshed = await input.store.replaceAwaitingRunHandoff({
        expectedHandoffUpdatedAt: existing.updatedAt,
        expectedPendingHandoffId: existing.id,
        newPendingHandoffId: handoff.record.id,
        now: input.now,
        runId: run.id,
      });
      if (existing.status === "open") {
        await input.store.markHandoffExpired({
          expectedStatus: "open",
          expectedUpdatedAt: existing.updatedAt,
          handoffId: existing.id,
          now: input.now,
        }).catch(() => {
          // The refreshed handoff is now the run authority; the old link expires on use.
        });
      }

      return {
        awaitingReason: refreshed.awaitingReason ?? awaitingReason,
        handoffUrl: handoff.handoffUrl,
        runId: run.id,
        status: "awaiting_user",
        suggestedReply: refreshed.suggestedReply ?? existing.suggestedReply,
      };
    } catch (error) {
      await input.store.markHandoffExpired({
        expectedStatus: "open",
        expectedUpdatedAt: handoff.record.updatedAt,
        handoffId: handoff.record.id,
        now: input.now,
      }).catch(() => {
        // Preserve the transition failure; the new handoff cleanup is compensating.
      });
      throw error;
    }
  }

  private async attachFirstAwaitingRunHandoff(input: {
    handoffPurpose: HostedComputerHandoffPurpose;
    memberId: string;
    now: Date;
    pauseDeliveryContext: HostedComputerDeliveryContext | null;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<ComputerPauseForUserResult | null> {
    if (!input.run.awaitingReason || !input.run.pausedAt) {
      return null;
    }

    const handoff = await this.createHandoff({
      memberId: input.memberId,
      purpose: input.handoffPurpose,
      returnContactKind: input.pauseDeliveryContext?.returnContactKind ?? null,
      runExpiresAt: input.run.expiresAt,
      runId: input.run.id,
      suggestedReply: input.run.suggestedReply,
    }, input.store);
    try {
      const attached = await input.store.attachAwaitingRunHandoff({
        awaitingReason: input.run.awaitingReason,
        expectedPausedAt: input.run.pausedAt,
        newPendingHandoffId: handoff.record.id,
        now: input.now,
        runId: input.run.id,
      });

      return {
        awaitingReason: attached.awaitingReason ?? input.run.awaitingReason,
        handoffUrl: handoff.handoffUrl,
        runId: input.run.id,
        status: "awaiting_user",
        suggestedReply: attached.suggestedReply ?? input.run.suggestedReply,
      };
    } catch (error) {
      await input.store.markHandoffExpired({
        expectedStatus: "open",
        expectedUpdatedAt: handoff.record.updatedAt,
        handoffId: handoff.record.id,
        now: input.now,
      }).catch(() => {
        // Preserve the transition failure; the handoff cleanup is compensating.
      });
      throw error;
    }
  }

  private async requireRunnableRun(input: {
    memberId: string;
    runId: string;
  }): Promise<ComputerRunRecord> {
    const run = await this.requireFreshRun(input);

    if (run.status === "running") {
      return run;
    }

    if (run.status !== "awaiting_user") {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_NOT_RUNNING",
        message: "Computer run is not running.",
      });
    }

    throw computerUseConflictError({
      code: "HOSTED_COMPUTER_AWAITING_USER",
      message: "Computer run is waiting for the user.",
      retryable: true,
    });
  }

  private async readAwaitingOpenBrowserState(input: {
    memberId: string;
    now: Date;
    resumeAfterMailboxItemId: string | null;
    resumeDeliveryContext: HostedComputerDeliveryContext | null;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<ComputerPageStateResult> {
    const authority = await this.resolveAwaitingOpenResumeAuthority(input);
    if (!authority) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_AWAITING_USER",
        message: "Computer run is waiting for the user.",
        retryable: true,
      });
    }

    const loginCheckpoint = authority.completedLoginHandoff
      ? await this.checkpointProfileAfterLoginHandoff(
          input.run,
          input.now,
          input.store,
          authority.completedLoginHandoff,
        )
      : null;
    const resumableRun = loginCheckpoint?.run ?? input.run;
    const state = await this.readBrowserState(resumableRun);
    const resumed = loginCheckpoint
      ? await input.store.resumeRunAfterLoginCheckpoint({
          awaitingReason: resumableRun.awaitingReason,
          expectedHandoffUpdatedAt: loginCheckpoint.handoff.updatedAt,
          expectedKernelSessionId: requireKernelSessionId(resumableRun),
          expectedPausedAt: authority.expectedPausedAt,
          expectedResumeAfterMailboxLaneSeq:
            authority.expectedResumeAfterMailboxLaneSeq,
          handoffId: loginCheckpoint.handoff.id,
          memberId: input.memberId,
          now: input.now,
          runId: input.run.id,
        })
      : await input.store.markRunRunning({
          awaitingReason: resumableRun.awaitingReason,
          expectedHandoffStatus: authority.expectedHandoffStatus,
          expectedHandoffUpdatedAt: authority.expectedHandoffUpdatedAt,
          expectedKernelSessionId: requireKernelSessionId(resumableRun),
          expectedPausedAt: authority.expectedPausedAt,
          expectedPendingHandoffId: authority.expectedPendingHandoffId,
          expectedResumeAfterMailboxLaneSeq:
            authority.expectedResumeAfterMailboxLaneSeq,
          now: input.now,
          runId: input.run.id,
        });
    if (authority.expireHandoffAfterResume) {
      await input.store.markHandoffExpired({
        expectedStatus: authority.expireHandoffAfterResume.status === "checkpointing"
          ? "checkpointing"
          : "open",
        expectedUpdatedAt: authority.expireHandoffAfterResume.updatedAt,
        handoffId: authority.expireHandoffAfterResume.id,
        now: input.now,
      }).catch(() => {
        // The run is no longer awaiting this stale or retired handoff.
      });
    }
    const sanitizedUrl = sanitizeComputerDisplayUrl(state.url);
    await input.store.updateRunBrowserState({
      expectedKernelSessionId: resumed.kernelSessionId,
      lastTitle: state.title,
      lastUrl: sanitizedUrl,
      runId: resumed.id,
    });

    return {
      runId: resumed.id,
      status: "running",
      title: state.title,
      url: sanitizedUrl,
      visibleText: state.visibleText,
    };
  }

  private async resolveAwaitingOpenResumeAuthority(input: {
    memberId: string;
    now: Date;
    resumeAfterMailboxItemId: string | null;
    resumeDeliveryContext: HostedComputerDeliveryContext | null;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<AwaitingOpenResumeAuthority | null> {
    if (
      input.run.status !== "awaiting_user" ||
      !input.run.pausedAt
    ) {
      return null;
    }
    const pausedAt = input.run.pausedAt;
    const pendingHandoffId = input.run.pendingHandoffId;
    const validateResumeProof = async (): Promise<boolean> => {
      if (!input.resumeAfterMailboxItemId) {
        return false;
      }
      await this.requireResumeMailboxItemAfterPause({
        memberId: input.memberId,
        pausedAt,
        resumeAfterMailboxLaneSeq: input.run.resumeAfterMailboxLaneSeq,
        resumeAfterMailboxItemId: input.resumeAfterMailboxItemId,
        resumeDeliveryContext: input.resumeDeliveryContext,
        runCheckpointContext: input.run.checkpointContext,
        store: input.store,
      });
      return true;
    };

    if (!pendingHandoffId) {
      if (!input.run.kernelSessionId || !await validateResumeProof()) {
        return null;
      }
      return {
        completedLoginHandoff: null,
        expectedHandoffStatus: null,
        expectedHandoffUpdatedAt: null,
        expectedPausedAt: pausedAt,
        expectedPendingHandoffId: null,
        expectedResumeAfterMailboxLaneSeq:
          input.run.resumeAfterMailboxLaneSeq,
        expireHandoffAfterResume: null,
      };
    }

    const handoff = await input.store.findHandoffByRun({
      handoffId: pendingHandoffId,
      runId: input.run.id,
    });
    if (!handoff) {
      return null;
    }

    if (isDeferredLoginCheckpointHandoff(handoff)) {
      if (!await validateResumeProof()) {
        return null;
      }
      if (isFreshCheckpointingHandoff(handoff, input.now)) {
        throw handoffCheckpointingError();
      }
      return {
        completedLoginHandoff: handoff,
        expectedHandoffStatus: handoff.status,
        expectedHandoffUpdatedAt: handoff.updatedAt,
        expectedPausedAt: pausedAt,
        expectedPendingHandoffId: pendingHandoffId,
        expectedResumeAfterMailboxLaneSeq:
          input.run.resumeAfterMailboxLaneSeq,
        expireHandoffAfterResume: null,
      };
    }

    if (handoff.status === "completed") {
      if (
        input.run.resumeAfterMailboxLaneSeq !== null &&
        !await validateResumeProof()
      ) {
        return null;
      }
      if (!input.run.kernelSessionId) {
        return null;
      }
      return {
        completedLoginHandoff: null,
        expectedHandoffStatus: handoff.status,
        expectedHandoffUpdatedAt: handoff.updatedAt,
        expectedPausedAt: pausedAt,
        expectedPendingHandoffId: pendingHandoffId,
        expectedResumeAfterMailboxLaneSeq:
          input.run.resumeAfterMailboxLaneSeq,
        expireHandoffAfterResume: null,
      };
    }

    if (handoff.purpose === "managed_login") {
      if (isFreshCheckpointingHandoff(handoff, input.now)) {
        throw handoffCheckpointingError();
      }
      return null;
    }

    if (!input.run.kernelSessionId) {
      return null;
    }

    if (
      handoff.status === "checkpointing" &&
      !isStaleCheckpointingHandoff(handoff, input.now)
    ) {
      throw handoffCheckpointingError();
    }

    if (handoff.status === "checkpointing") {
      if (!await validateResumeProof()) {
        return null;
      }
      return {
        completedLoginHandoff: null,
        expectedHandoffStatus: handoff.status,
        expectedHandoffUpdatedAt: handoff.updatedAt,
        expectedPausedAt: pausedAt,
        expectedPendingHandoffId: pendingHandoffId,
        expectedResumeAfterMailboxLaneSeq:
          input.run.resumeAfterMailboxLaneSeq,
        expireHandoffAfterResume: handoff,
      };
    }

    if (handoff.status === "open" || handoff.status === "expired") {
      if (!await validateResumeProof()) {
        return null;
      }
      return {
        completedLoginHandoff: null,
        expectedHandoffStatus: handoff.status,
        expectedHandoffUpdatedAt: handoff.updatedAt,
        expectedPausedAt: pausedAt,
        expectedPendingHandoffId: pendingHandoffId,
        expectedResumeAfterMailboxLaneSeq:
          input.run.resumeAfterMailboxLaneSeq,
        expireHandoffAfterResume: handoff.status === "open" ? handoff : null,
      };
    }

    return null;
  }

  private async requireFreshRun(input: {
    memberId: string;
    runId: string;
  }, store: ComputerUseStore = this.store): Promise<ComputerRunRecord> {
    const now = this.now();
    const run = await store.requireOwnedRun(input);

    if (run.expiresAt <= now && (run.status === "running" || run.status === "awaiting_user")) {
      const expired = await this.expireRunAndDeleteBrowserBestEffort(run, now, store);
      if (expired === "failed") {
        throw browserCleanupFailedError();
      }
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_EXPIRED",
        message: "Computer run expired.",
      });
    }

    return run;
  }

  private async readBrowserState(run: ComputerRunRecord): Promise<{
    title: string | null;
    url: string | null;
    visibleText: string;
  }> {
    const response = await this.requireKernel().executePlaywright({
      code: [
        "const title = await page.title().catch(() => null);",
        "const url = page.url();",
        "let visibleText = '';",
        "try { visibleText = await page.locator('body').innerText({ timeout: 5000 }); } catch {}",
        `if (visibleText.length > ${COMPUTER_OBSERVE_TEXT_LIMIT}) visibleText = visibleText.slice(0, ${COMPUTER_OBSERVE_TEXT_LIMIT});`,
        "return { title, url, visibleText };",
      ].join("\n"),
      sessionId: requireKernelSessionId(run),
      timeoutMs: COMPUTER_OBSERVE_TIMEOUT_MS,
    });

    return readBrowserStateResult(response.result);
  }

  private async readMemberOwnedProviderSetupBrowserState(
    run: ComputerRunRecord,
  ): Promise<{ title: string | null; url: string | null; visibleText: string }> {
    const response = await this.requireKernel().executePlaywright({
      code: buildMemberOwnedProviderSetupObservationCode(),
      sessionId: requireKernelSessionId(run),
      timeoutMs: COMPUTER_OBSERVE_TIMEOUT_MS,
    });
    return readBrowserStateResult(response.result);
  }

  private async navigateKernelBrowserToUrl(input: {
    sessionId: string;
    timeoutMs: number;
    url: string;
  }): Promise<{
    title: string | null;
    url: string | null;
    visibleText: string;
  }> {
    const response = await this.requireKernel().executePlaywright({
      code: buildComputerNavigationCode({
        timeoutMs: input.timeoutMs,
        url: input.url,
      }),
      sessionId: input.sessionId,
      timeoutMs: input.timeoutMs,
    });

    return readBrowserStateResult(response.result);
  }

  private async checkpointProfileAfterLoginHandoff(
    run: ComputerRunRecord,
    now: Date,
    store: ComputerUseStore,
    handoff: ComputerHandoffRecord,
  ): Promise<{
    handoff: ComputerHandoffRecord;
    run: ComputerRunRecord;
  }> {
    if (!run.pausedAt) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
        message: "Computer run state changed; retry the request.",
        retryable: true,
      });
    }
    const claimed = await store.claimLoginHandoffForCheckpoint({
      expectedAwaitingReason: run.awaitingReason,
      expectedKernelSessionId: run.kernelSessionId,
      expectedPausedAt: run.pausedAt,
      expectedResumeAfterMailboxLaneSeq: run.resumeAfterMailboxLaneSeq,
      expectedStatus: handoff.status === "checkpointing"
        ? "checkpointing"
        : "completed",
      expectedUpdatedAt: handoff.updatedAt,
      handoffId: handoff.id,
      memberId: run.memberId,
      now,
      runId: run.id,
    });
    if (!claimed) {
      throw handoffCheckpointingError();
    }
    const claimedRun = await store.requireOwnedRun({
      memberId: run.memberId,
      runId: run.id,
    });
    const detached = await this.detachRunBrowserForHandoff(
      claimedRun,
      now,
      store,
      claimed.updatedAt,
    );
    return {
      handoff: claimed,
      run: await this.attachRunBrowserFromProfile(
        detached,
        store,
        claimed.updatedAt,
      ),
    };
  }

  private async detachRunBrowserForHandoff(
    run: ComputerRunRecord,
    now: Date,
    store: ComputerUseStore,
    expectedHandoffUpdatedAt?: Date,
  ): Promise<ComputerRunRecord> {
    const state = run.kernelSessionId
      ? await this.readBrowserState(run).catch(() => ({
          title: run.lastTitle,
          url: run.lastUrl,
          visibleText: "",
        }))
      : {
          title: run.lastTitle,
          url: run.lastUrl,
          visibleText: "",
        };
    const lastUrl = sanitizeComputerDisplayUrl(state.url);

    if (!run.kernelSessionId) {
      await store.updateRunBrowserState({
        expectedKernelSessionId: null,
        lastTitle: state.title,
        lastUrl,
        runId: run.id,
      });
      return {
        ...run,
        lastTitle: state.title,
        lastUrl,
      };
    }

    const oldKernelSessionId = run.kernelSessionId;
    if (!await this.deleteBrowserBestEffort(oldKernelSessionId)) {
      throw browserCleanupFailedError();
    }
    return await store.clearRunBrowser({
      expectedHandoffUpdatedAt: expectedHandoffUpdatedAt ?? null,
      expectedKernelSessionId: oldKernelSessionId,
      expectedPendingHandoffId: run.pendingHandoffId,
      lastTitle: state.title,
      lastUrl,
      now,
      runId: run.id,
    });
  }

  private async attachRunBrowserFromProfile(
    run: ComputerRunRecord,
    store: ComputerUseStore,
    expectedHandoffUpdatedAt?: Date,
  ): Promise<ComputerRunRecord> {
    const prepared = await this.prepareRunBrowserFromProfile(
      run,
      expectedHandoffUpdatedAt,
    );
    try {
      return await store.replaceRunBrowser(prepared.replaceInput);
    } catch (error) {
      if (!isMemberSuspendedComputerUseError(error)) {
        const attachedRun = await this.replayAmbiguousRunBrowserReplace({
          replaceInput: prepared.replaceInput,
          store,
        });
        if (attachedRun === "unknown") {
          throw error;
        }
        if (attachedRun) {
          return attachedRun;
        }
      }
      if (!await this.deleteBrowserBestEffort(
        prepared.replaceInput.kernelSessionId,
      )) {
        throw browserCleanupFailedError();
      }
      throw error;
    }
  }

  private async prepareRunBrowserFromProfile(
    run: ComputerRunRecord,
    expectedHandoffUpdatedAt?: Date,
  ): Promise<PreparedRunBrowser> {
    const browserName = buildKernelBrowserName({ runId: run.id });
    if (!await this.deleteBrowserBestEffort(browserName)) {
      throw browserCleanupFailedError();
    }

    let browser: Awaited<ReturnType<ComputerKernelClient["createBrowser"]>> | null = null;
    try {
      const createNow = this.now();
      browser = await this.requireKernel().createBrowser({
        browserName,
        profileName: run.kernelProfileName,
        saveChanges: true,
        timeoutSeconds: requireRemainingKernelTimeoutSeconds(run, createNow),
      });
      this.assertAllowedLiveViewUrl(browser.liveViewUrl);
      return {
        replaceInput: {
          expectedHandoffUpdatedAt: expectedHandoffUpdatedAt ?? null,
          expectedPendingHandoffId: run.pendingHandoffId,
          kernelLiveViewUrlEncrypted: await this.encryptRequiredRunSecret({
            field: "kernel-live-view-url",
            memberId: run.memberId,
            runId: run.id,
            value: browser.liveViewUrl,
          }),
          kernelSessionId: browser.sessionId,
          memberId: run.memberId,
          now: this.now(),
          runId: run.id,
        },
      };
    } catch (error) {
      const cleanupBrowserId = browser?.sessionId ?? browserName;
      if (cleanupBrowserId && !await this.deleteBrowserBestEffort(cleanupBrowserId)) {
        throw browserCleanupFailedError();
      }
      throw error;
    }
  }

  private async captureBrowserStateBestEffort(
    run: ComputerRunRecord,
    store: ComputerUseStore = this.store,
  ): Promise<void> {
    try {
      const state = await this.readBrowserState(run);
      await store.updateRunBrowserState({
        expectedKernelSessionId: run.kernelSessionId,
        lastTitle: state.title,
        lastUrl: sanitizeComputerDisplayUrl(state.url),
        runId: run.id,
      });
    } catch {
      // A user checkpoint must remain durable even if the live browser cannot be observed.
    }
  }

  private async captureManagedLoginBrowserDomain(
    run: ComputerRunRecord,
    store: ComputerUseStore,
  ): Promise<void> {
    let state: {
      title: string | null;
      url: string | null;
      visibleText: string;
    };
    try {
      state = await this.readBrowserState(run);
    } catch {
      throw managedLoginUnavailableError();
    }
    const lastUrl = sanitizeComputerDisplayUrl(state.url);
    if (!readManagedLoginDomainFromUrl(lastUrl)) {
      throw managedLoginUnavailableError();
    }
    try {
      await store.updateRunBrowserState({
        expectedKernelSessionId: run.kernelSessionId,
        lastTitle: state.title,
        lastUrl,
        runId: run.id,
      });
    } catch {
      throw managedLoginUnavailableError();
    }
  }

  private async resumeAwaitingRunById(input: {
    memberId: string;
    now: Date;
    resumeAfterMailboxItemId: string | null;
    resumeDeliveryContext: HostedComputerDeliveryContext | null;
    runId: string;
    store?: ComputerUseStore;
  }): Promise<ComputerRunHandle> {
    const store = input.store ?? this.store;
    let run = await store.requireOwnedRun({
      memberId: input.memberId,
      runId: input.runId,
    });

    if (run.expiresAt <= input.now && (run.status === "running" || run.status === "awaiting_user")) {
      if (await this.expireRunAndDeleteBrowserBestEffort(run, input.now, store) === "failed") {
        throw browserCleanupFailedError();
      }
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_EXPIRED",
        message: "Computer run expired.",
      });
    }

    if (run.status === "running") {
      return runHandle(run, true);
    }

    if (run.status !== "awaiting_user" || !run.pausedAt) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_NOT_RESUMABLE",
        message: "Computer run is not awaiting user input.",
      });
    }
    const pausedAt = run.pausedAt;
    let completedLoginHandoff: ComputerHandoffRecord | null = null;
    let retiredStaticPreviewHandoff: ComputerHandoffRecord | null = null;

    if (run.pendingHandoffId) {
      const pendingHandoff = await store.findHandoffByRun({
        handoffId: run.pendingHandoffId,
        runId: run.id,
      });
      if (
        pendingHandoff?.purpose === "managed_login" &&
        pendingHandoff.status !== "completed"
      ) {
        await this.requireResumeMailboxItemAfterPause({
          memberId: input.memberId,
          pausedAt,
          resumeAfterMailboxLaneSeq: run.resumeAfterMailboxLaneSeq,
          resumeAfterMailboxItemId: input.resumeAfterMailboxItemId,
          resumeDeliveryContext: input.resumeDeliveryContext,
          runCheckpointContext: run.checkpointContext,
          store,
        });
        const restored = await this.completeManagedLoginForResume({
          handoff: pendingHandoff,
          memberId: input.memberId,
          now: input.now,
          run,
          store,
        });
        if (!restored) {
          return runHandle(run, true);
        }
        const resumed = await store.markRunRunning({
          awaitingReason: run.awaitingReason,
          expectedKernelSessionId: requireKernelSessionId(restored),
          expectedPausedAt: pausedAt,
          expectedPendingHandoffId: run.pendingHandoffId,
          expectedResumeAfterMailboxLaneSeq:
            run.resumeAfterMailboxLaneSeq,
          now: input.now,
          runId: run.id,
        });
        return runHandle(resumed, true);
      }

      if (pendingHandoff) {
        if (isDeferredLoginCheckpointHandoff(pendingHandoff)) {
          if (isFreshCheckpointingHandoff(pendingHandoff, input.now)) {
            throw handoffCheckpointingError();
          }
          completedLoginHandoff = pendingHandoff;
        }
        if (
          pendingHandoff.status !== "completed" &&
          !isDeferredLoginCheckpointHandoff(pendingHandoff)
        ) {
          if (
            pendingHandoff.status === "checkpointing" &&
            !isStaleCheckpointingHandoff(pendingHandoff, input.now)
          ) {
            return runHandle(run, true);
          }
          if (!run.kernelSessionId) {
            if (await this.expireRunAndDeleteBrowserBestEffort(run, input.now, store) === "failed") {
              throw browserCleanupFailedError();
            }
            throw computerUseConflictError({
              code: "HOSTED_COMPUTER_RUN_EXPIRED",
              message: "Computer run expired.",
            });
          }
          if (isRetiredStaticPreviewHandoff(pendingHandoff)) {
            retiredStaticPreviewHandoff = pendingHandoff;
          } else {
            if (isExpiredHandoff(pendingHandoff, input.now)) {
              if (pendingHandoff.status !== "expired") {
                await store.markHandoffExpired({
                  expectedStatus: pendingHandoff.status === "checkpointing"
                    ? "checkpointing"
                    : "open",
                  expectedUpdatedAt: pendingHandoff.updatedAt,
                  handoffId: pendingHandoff.id,
                  now: input.now,
                });
              }
              throw computerUseConflictError({
                code: "HOSTED_COMPUTER_HANDOFF_EXPIRED",
                message: "Computer handoff expired.",
              });
            }
            if (isStaleCheckpointingHandoff(pendingHandoff, input.now)) {
              await store.markHandoffExpired({
                expectedStatus: "checkpointing",
                expectedUpdatedAt: pendingHandoff.updatedAt,
                handoffId: pendingHandoff.id,
                now: input.now,
              });
              throw computerUseConflictError({
                code: "HOSTED_COMPUTER_HANDOFF_EXPIRED",
                message: "Computer handoff expired.",
              });
            }
            return runHandle(run, true);
          }
        }
      } else if (!run.kernelSessionId) {
        if (await this.expireRunAndDeleteBrowserBestEffort(run, input.now, store) === "failed") {
          throw browserCleanupFailedError();
        }
        throw computerUseConflictError({
          code: "HOSTED_COMPUTER_RUN_EXPIRED",
          message: "Computer run expired.",
        });
      } else {
        throw computerUseConflictError({
          code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
          message: "Computer run state changed; open the browser before retrying.",
          retryable: true,
        });
      }
    } else if (!run.kernelSessionId) {
      if (await this.expireRunAndDeleteBrowserBestEffort(run, input.now, store) === "failed") {
        throw browserCleanupFailedError();
      }
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_EXPIRED",
        message: "Computer run expired.",
      });
    }

    await this.requireResumeMailboxItemAfterPause({
      memberId: input.memberId,
      pausedAt,
      resumeAfterMailboxLaneSeq: run.resumeAfterMailboxLaneSeq,
      resumeAfterMailboxItemId: input.resumeAfterMailboxItemId,
      resumeDeliveryContext: input.resumeDeliveryContext,
      runCheckpointContext: run.checkpointContext,
      store,
    });
    const loginCheckpoint = completedLoginHandoff
      ? await this.checkpointProfileAfterLoginHandoff(
        run,
        input.now,
        store,
        completedLoginHandoff,
      )
      : null;
    run = loginCheckpoint?.run ?? run;
    const resumed = loginCheckpoint
      ? await store.resumeRunAfterLoginCheckpoint({
          awaitingReason: run.awaitingReason,
          expectedHandoffUpdatedAt: loginCheckpoint.handoff.updatedAt,
          expectedKernelSessionId: requireKernelSessionId(run),
          expectedPausedAt: pausedAt,
          expectedResumeAfterMailboxLaneSeq: run.resumeAfterMailboxLaneSeq,
          handoffId: loginCheckpoint.handoff.id,
          memberId: input.memberId,
          now: input.now,
          runId: run.id,
        })
      : await store.markRunRunning({
          awaitingReason: run.awaitingReason,
          expectedHandoffUpdatedAt:
            retiredStaticPreviewHandoff?.updatedAt ?? null,
          expectedHandoffStatus:
            retiredStaticPreviewHandoff?.status ?? null,
          expectedKernelSessionId: requireKernelSessionId(run),
          expectedPausedAt: pausedAt,
          expectedPendingHandoffId: run.pendingHandoffId,
          expectedResumeAfterMailboxLaneSeq: run.resumeAfterMailboxLaneSeq,
          now: input.now,
          runId: run.id,
        });
    if (retiredStaticPreviewHandoff?.status === "open") {
      await store.markHandoffExpired({
        expectedStatus: "open",
        expectedUpdatedAt: retiredStaticPreviewHandoff.updatedAt,
        handoffId: retiredStaticPreviewHandoff.id,
        now: input.now,
      }).catch(() => {
        // The run is no longer awaiting this retired legacy link.
      });
    }
    return runHandle(resumed, true);
  }

  private async completeManagedLoginForResume(input: {
    handoff: ComputerHandoffRecord;
    memberId: string;
    now: Date;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<ComputerRunRecord | null> {
    let staleClaimUpdatedAt: Date | null = null;
    if (input.handoff.status === "checkpointing") {
      if (isFreshCheckpointingHandoff(input.handoff, input.now)) {
        return null;
      }
      staleClaimUpdatedAt = input.handoff.updatedAt;
    } else if (
      input.handoff.status !== "open" ||
      isExpiredHandoff(input.handoff, input.now)
    ) {
      return null;
    }

    const domain = requireManagedLoginDomain(input.run);
    const connection = await this.requireKernel().findManagedAuthConnection({
      domain,
      profileName: input.run.kernelProfileName,
    });
    const currentFlow = readManagedAuthFlowForHandoff({
      connection,
      handoff: input.handoff,
    });
    if (
      !currentFlow ||
      !isManagedAuthTerminalFlow(currentFlow)
    ) {
      return null;
    }

    const claimed = staleClaimUpdatedAt
      ? await input.store.reclaimHandoffForCompletion({
          expectedUpdatedAt: staleClaimUpdatedAt,
          handoffId: input.handoff.id,
          memberId: input.memberId,
          now: input.now,
        })
      : await input.store.claimHandoffForCompletion({
          handoffId: input.handoff.id,
          memberId: input.memberId,
        });
    if (!claimed) {
      return null;
    }

    let run: ComputerRunRecord;
    try {
      run = await input.store.requireOwnedRun({
        memberId: input.memberId,
        runId: input.run.id,
      });
    } catch (error) {
      await input.store.releaseHandoffClaim({
        expectedUpdatedAt: claimed.updatedAt,
        handoffId: claimed.id,
      }).catch(() => {});
      throw error;
    }
    let latestConnection: KernelManagedAuthConnection | null;
    try {
      latestConnection = await this.requireKernel().findManagedAuthConnection({
        domain,
        profileName: run.kernelProfileName,
      });
    } catch (error) {
      await input.store.releaseHandoffClaim({
        expectedUpdatedAt: claimed.updatedAt,
        handoffId: claimed.id,
      }).catch(() => {});
      throw error;
    }
    const latestFlow = readManagedAuthFlowForHandoff({
      connection: latestConnection,
      handoff: claimed,
    });
    if (
      !latestFlow ||
      !isManagedAuthTerminalFlow(latestFlow)
    ) {
      await input.store.releaseHandoffClaim({
        expectedUpdatedAt: claimed.updatedAt,
        handoffId: claimed.id,
      });
      return null;
    }

    if (
      run.kernelSessionId &&
      (!staleClaimUpdatedAt || run.updatedAt <= staleClaimUpdatedAt)
    ) {
      await input.store.releaseHandoffClaim({
        expectedUpdatedAt: claimed.updatedAt,
        handoffId: claimed.id,
      });
      return null;
    }

    if (latestFlow.browserSessionId) {
      try {
        await this.requireKernel().deleteBrowserByIdOrName(
          latestFlow.browserSessionId,
        );
      } catch {
        return null;
      }
    }
    if (!isManagedAuthSuccessfulTerminalFlow(latestFlow)) {
      try {
        await this.convertManagedLoginToLiveViewFallback({
          claimed,
          run,
          store: input.store,
        });
      } catch (error) {
        if (error instanceof ManagedLoginTerminalOutcomeUnknownError) {
          return null;
        }
        throw error;
      }
      return null;
    }
    try {
      return await this.completeSuccessfulManagedLoginHandoff({
        claimed,
        run,
        store: input.store,
      });
    } catch (error) {
      if (error instanceof ManagedLoginTerminalOutcomeUnknownError) {
        return null;
      }
      throw error;
    }
  }

  private async expireStaleActiveRunsForMember(input: {
    memberId: string;
    now: Date;
    store?: ComputerUseStore;
  }): Promise<void> {
    const store = input.store ?? this.store;
    const staleRuns = await store.listStaleActiveRunsForMember({
      ...input,
      limit: COMPUTER_CLEANUP_BATCH_SIZE,
    });
    for (const run of staleRuns) {
      if (await this.expireRunAndDeleteBrowserBestEffort(run, input.now, store) === "failed") {
        throw browserCleanupFailedError();
      }
    }
  }

  private async recoverStaleBrowserlessProvisioningRun(input: {
    now: Date;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<BrowserlessProvisioningRecovery> {
    let cleanupRun = input.run;

    if (input.run.status !== "cleanup_pending") {
      if (!isStaleBrowserlessProvisioningRun(input.run, input.now)) {
        return "busy";
      }

      try {
        cleanupRun = await input.store.markRunCleanupPending({
          expectedKernelSessionId: input.run.kernelSessionId,
          expectedRunStatus: input.run.status,
          expectedRunUpdatedAt: input.run.updatedAt,
          memberId: input.run.memberId,
          now: input.now,
          runId: input.run.id,
        });
      } catch (error) {
        if (isStaleRunStateConflict(error)) {
          return "changed";
        }
        throw error;
      }
    }

    const browserName = buildKernelBrowserName({ runId: cleanupRun.id });
    if (!await this.deleteBrowserBestEffort(browserName)) {
      throw browserCleanupFailedError();
    }

    try {
      await input.store.finishRun({
        expectedKernelSessionId: null,
        expectedRunStatus: "cleanup_pending",
        now: input.now,
        outcome: "failed",
        runId: cleanupRun.id,
      });
    } catch (error) {
      if (isStaleRunStateConflict(error)) {
        return "changed";
      }
      throw error;
    }

    return "recovered";
  }

  private resolveKernelProfileName(input: {
    memberId: string;
  }): string {
    const namespace = requireKernelProfileNamespace(this.env);
    return buildKernelProfileName({
      memberId: input.memberId,
      namespace,
    });
  }

  private async prepareMemberRunsForAccountDeletion(input: {
    memberId: string;
    now: Date;
  }): Promise<ComputerRunRecord[]> {
    const runs = await this.store.listMemberRuns({ memberId: input.memberId });

    for (const run of runs) {
      await this.requireNoFreshCheckpointingHandoff(run, input.now);
      if (
        run.status === "running" &&
        !run.kernelSessionId &&
        !isStaleBrowserlessProvisioningRun(run, input.now) &&
        run.expiresAt > input.now
      ) {
        throw browserProvisioningInProgressError();
      }
    }

    return runs;
  }

  private async requireNoFreshCheckpointingHandoff(
    run: ComputerRunRecord,
    now: Date,
  ): Promise<void> {
    if (!run.pendingHandoffId) {
      return;
    }

    const handoff = await this.store.findHandoffByRun({
      handoffId: run.pendingHandoffId,
      runId: run.id,
    });
    if (handoff && isFreshCheckpointingHandoff(handoff, now)) {
      throw handoffCheckpointingError();
    }
  }

  private async replayAmbiguousRunBrowserAttach(input: {
    attachInput: AttachRunBrowserInput;
    store: ComputerUseStore;
  }): Promise<AmbiguousBrowserWriteReplayResult> {
    try {
      return await input.store.attachRunBrowser(input.attachInput);
    } catch (error) {
      if (isStaleRunStateConflict(error) || isComputerUseNotFoundError(error)) {
        return null;
      }
      return "unknown";
    }
  }

  private async replayAmbiguousRunBrowserReplace(input: {
    replaceInput: ReplaceRunBrowserInput;
    store: ComputerUseStore;
  }): Promise<AmbiguousBrowserWriteReplayResult> {
    try {
      return await input.store.replaceRunBrowser(input.replaceInput);
    } catch (error) {
      if (isStaleRunStateConflict(error) || isComputerUseNotFoundError(error)) {
        return null;
      }
      return "unknown";
    }
  }

  private async requireResumeMailboxItemAfterPause(input: {
    memberId: string;
    pausedAt: Date;
    resumeAfterMailboxLaneSeq: bigint | null;
    resumeAfterMailboxItemId: string | null;
    resumeDeliveryContext: HostedComputerDeliveryContext | null;
    runCheckpointContext: ComputerRunCheckpointContext | null;
    store: ComputerUseStore;
  }): Promise<void> {
    if (!input.resumeAfterMailboxItemId) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RESUME_REQUIRES_USER_REPLY",
        message: "Computer run resume requires a new user reply.",
      });
    }

    if (!doesResumeContextMatchCheckpoint({
      expected: input.runCheckpointContext,
      received: input.resumeDeliveryContext,
    })) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RESUME_CONTEXT_MISMATCH",
        message: "Computer run resume must come from the same user reply context.",
      });
    }

    if (await input.store.hasConversationMailboxItemAfter({
      after: input.pausedAt,
      afterLaneSeq: input.resumeAfterMailboxLaneSeq,
      mailboxItemId: input.resumeAfterMailboxItemId,
      memberId: input.memberId,
    })) {
      return;
    }

    throw computerUseConflictError({
      code: "HOSTED_COMPUTER_RESUME_REQUIRES_USER_REPLY",
      message: "Computer run resume requires a new user reply.",
    });
  }

  private async expireRunAndDeleteBrowserBestEffort(
    run: ComputerRunRecord,
    now: Date,
    store: ComputerUseStore = this.store,
  ): Promise<ComputerRunCleanupOutcome> {
    if (isTerminalRunStatus(run.status)) {
      try {
        await this.deleteTerminalRunBrowser(run, now, store);
        return "cleaned";
      } catch {
        return "failed";
      }
    }

    const pendingHandoff = await this.findPendingHandoffForExpiry(run, store);
    if (
      pendingHandoff?.status === "checkpointing" &&
      !isStaleCheckpointingHandoff(pendingHandoff, now)
    ) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING",
        message: "Computer handoff is checkpointing.",
        retryable: true,
      });
    }

    const cleanupRun = await this.claimRunForCleanup({
      now,
      pendingHandoff,
      run,
      store,
    });
    if (!cleanupRun) {
      return "failed";
    }

    if (
      pendingHandoff?.purpose === "managed_login" &&
      !await this.deleteManagedAuthFlowBrowserBestEffort(cleanupRun)
    ) {
      throw browserCleanupFailedError();
    }

    await this.closePendingHandoffForExpiry(cleanupRun, now, store, pendingHandoff);
    const cleanupBrowserId = cleanupRun.kernelSessionId ??
      buildKernelBrowserName({ runId: cleanupRun.id });
    if (!await this.deleteBrowserBestEffort(cleanupBrowserId)) {
      return "failed";
    }
    const expireResult = await store.markRunExpired({
      expectedKernelSessionId: cleanupRun.kernelSessionId,
      now,
      runId: cleanupRun.id,
    });
    const expired = expireResult.run;
    if (!expireResult.expired) {
      if (!isTerminalRunStatus(expired.status)) {
        return "failed";
      }
      try {
        await this.finishPrecleanedTerminalRunBrowser({
          cleanupBrowserId,
          now,
          run: expired,
          store,
        });
        return "cleaned";
      } catch {
        return "failed";
      }
    }
    if (expired.status !== "expired") {
      if (!isTerminalRunStatus(expired.status)) {
        return "failed";
      }
      try {
        await this.finishPrecleanedTerminalRunBrowser({
          cleanupBrowserId,
          now,
          run: expired,
          store,
        });
        return "cleaned";
      } catch {
        return "failed";
      }
    }
    await this.finishPrecleanedTerminalRunBrowser({
      cleanupBrowserId,
      now,
      run: expired,
      store,
    });
    return "expired";
  }

  private async finishPrecleanedTerminalRunBrowser(input: {
    cleanupBrowserId: string;
    now: Date;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<void> {
    if (!input.run.kernelSessionId) {
      return;
    }
    if (input.run.kernelSessionId !== input.cleanupBrowserId) {
      await this.deleteTerminalRunBrowser(input.run, input.now, input.store);
      return;
    }
    await input.store.clearTerminalRunBrowser({
      expectedKernelSessionId: input.cleanupBrowserId,
      now: input.now,
      runId: input.run.id,
    });
  }

  private async claimRunForCleanup(input: {
    now: Date;
    pendingHandoff: ComputerHandoffRecord | null;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<ComputerRunRecord | null> {
    if (
      input.run.status === "cleanup_pending" &&
      !isStaleCleanupPendingRun(input.run, input.now)
    ) {
      return null;
    }
    try {
      return await input.store.markRunCleanupPending({
        expectedHandoffStatus: input.pendingHandoff?.status ?? null,
        expectedHandoffUpdatedAt: input.pendingHandoff?.updatedAt ?? null,
        expectedKernelSessionId: input.run.kernelSessionId,
        expectedPendingHandoffId: input.run.pendingHandoffId,
        expectedRunStatus: input.run.status,
        expectedRunUpdatedAt: input.run.updatedAt,
        memberId: input.run.memberId,
        now: input.now,
        runId: input.run.id,
      });
    } catch (error) {
      if (isStaleRunStateConflict(error)) {
        return null;
      }
      throw error;
    }
  }

  private async expireRunAndDeleteBrowserForCleanup(
    run: ComputerRunRecord,
    now: Date,
  ): Promise<ComputerRunCleanupOutcome> {
    try {
      return await this.expireRunAndDeleteBrowserBestEffort(run, now);
    } catch (error) {
      if (isComputerHandoffCheckpointingError(error)) {
        return "failed";
      }
      throw error;
    }
  }

  private async preparePendingHandoffForFinish(
    run: ComputerRunRecord,
    outcome: HostedComputerFinishOutcome,
    now: Date,
    store: ComputerUseStore = this.store,
  ): Promise<{
    claimedCleanup: boolean;
    expectedCompletedHandoffId: string | null;
    precleanedBrowserId: string | null;
  }> {
    if (!run.pendingHandoffId) {
      if (outcome === "completed" && run.status === "awaiting_user") {
        throw handoffIncompleteForFinishError();
      }
      return {
        claimedCleanup: false,
        expectedCompletedHandoffId: null,
        precleanedBrowserId: null,
      };
    }

    const handoff = await store.findHandoffByRun({
      handoffId: run.pendingHandoffId,
      runId: run.id,
    });
    if (!handoff) {
      if (outcome === "completed") {
        throw handoffIncompleteForFinishError();
      }
      return {
        claimedCleanup: false,
        expectedCompletedHandoffId: null,
        precleanedBrowserId: null,
      };
    }

    if (outcome === "completed") {
      if (handoff.status !== "completed") {
        throw handoffIncompleteForFinishError();
      }
      return {
        claimedCleanup: false,
        expectedCompletedHandoffId: handoff.id,
        precleanedBrowserId: null,
      };
    }

    if (
      handoff.status === "completed" ||
      handoff.status === "expired"
    ) {
      return {
        claimedCleanup: false,
        expectedCompletedHandoffId: null,
        precleanedBrowserId: null,
      };
    }

    if (
      handoff.status === "checkpointing"
      && !isStaleCheckpointingHandoff(handoff, now)
    ) {
      throw handoffCheckpointingError();
    }

    const claimedCleanup = handoff.purpose === "managed_login";
    let precleanedBrowserId: string | null = null;
    if (claimedCleanup) {
      const cleanupRun = await this.claimRunForCleanup({
        now,
        pendingHandoff: handoff,
        run,
        store,
      });
      if (
        !cleanupRun ||
        !await this.deleteManagedAuthFlowBrowserBestEffort(cleanupRun)
      ) {
        throw browserCleanupFailedError();
      }
      precleanedBrowserId = cleanupRun.kernelSessionId ??
        buildKernelBrowserName({ runId: cleanupRun.id });
      if (!await this.deleteBrowserBestEffort(precleanedBrowserId)) {
        throw browserCleanupFailedError();
      }
    }

    await store.markHandoffExpired({
      expectedStatus: handoff.status === "checkpointing"
        ? "checkpointing"
        : "open",
      expectedUpdatedAt: handoff.updatedAt,
      handoffId: handoff.id,
      now,
    });
    return {
      claimedCleanup,
      expectedCompletedHandoffId: null,
      precleanedBrowserId,
    };
  }

  private async closePendingHandoffForExpiry(
    run: ComputerRunRecord,
    now: Date,
    store: ComputerUseStore = this.store,
    knownHandoff: ComputerHandoffRecord | null | undefined = undefined,
  ): Promise<void> {
    const handoff = knownHandoff === undefined
      ? await this.findPendingHandoffForExpiry(run, store)
      : knownHandoff;
    if (!handoff || handoff.status === "completed" || handoff.status === "expired") {
      return;
    }

    if (
      handoff.status === "checkpointing"
      && !isStaleCheckpointingHandoff(handoff, now)
    ) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING",
        message: "Computer handoff is checkpointing.",
        retryable: true,
      });
    }

    await store.markHandoffExpired({
      expectedStatus: handoff.status === "checkpointing" ? "checkpointing" : "open",
      expectedUpdatedAt: handoff.updatedAt,
      handoffId: handoff.id,
      now,
    });
  }

  private async findPendingHandoffForExpiry(
    run: ComputerRunRecord,
    store: ComputerUseStore,
  ): Promise<ComputerHandoffRecord | null> {
    if (!run.pendingHandoffId) {
      return null;
    }

    return await store.findHandoffByRun({
      handoffId: run.pendingHandoffId,
      runId: run.id,
    });
  }

  private async deleteManagedAuthFlowBrowserBestEffort(
    run: ComputerRunRecord,
  ): Promise<boolean> {
    const domain = readManagedLoginDomain(run);
    if (!domain) {
      return true;
    }
    try {
      const connection = await this.requireKernel().findManagedAuthConnection({
        domain,
        profileName: run.kernelProfileName,
      });
      if (connection?.browserSessionId) {
        await this.requireKernel().deleteBrowserByIdOrName(
          connection.browserSessionId,
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  private async deleteTerminalRunBrowser(
    run: ComputerRunRecord,
    now: Date,
    store: ComputerUseStore = this.store,
  ): Promise<void> {
    if (!run.kernelSessionId) {
      return;
    }

    try {
      await this.requireKernel().deleteBrowserByIdOrName(run.kernelSessionId);
    } catch {
      throw browserCleanupFailedError();
    }
    await store.clearTerminalRunBrowser({
      expectedKernelSessionId: run.kernelSessionId,
      now,
      runId: run.id,
    });
  }

  private async encryptRequiredRunSecret(input: {
    field: ComputerRunSecretField;
    memberId: string;
    runId: string;
    value: string;
  }): Promise<string> {
    const encrypted = await this.crypto.encryptRunSecret(input);
    if (!encrypted) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_SECRET_ENCRYPTION_FAILED",
        message: "Computer browser secret encryption failed.",
        retryable: true,
      });
    }
    return encrypted;
  }

  private async deleteBrowserBestEffort(idOrName: string): Promise<boolean> {
    try {
      await this.requireKernel().deleteBrowserByIdOrName(idOrName);
      return true;
    } catch {
      // Cleanup is best effort after a failed start path.
      return false;
    }
  }

  private requireKernel(): ComputerKernelClient {
    this.kernel ??= new KernelComputerClient({ env: this.env });
    return this.kernel;
  }

  private assertAllowedLiveViewUrl(url: string): void {
    const inspection = inspectComputerLiveViewUrl({ url });
    if (inspection.allowed) {
      return;
    }

    throw computerUseError({
      code: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
      details: {
        liveViewHostnameAllowed: inspection.hostnameAllowed,
        liveViewParsed: inspection.parsed,
        liveViewPortAllowed: inspection.portAllowed,
        liveViewProtocolAllowed: inspection.protocolAllowed,
      },
      httpStatus: 502,
      message: "Kernel live-view URL is not allowed.",
      retryable: true,
    });
  }
}

export function createComputerUseService(): ComputerUseService {
  return new ComputerUseService();
}

type ComputerRunOwner = {
  ownerKey: string;
  ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
};

function readComputerRunOwner(input: {
  ownerKey?: string | null;
  ownerPurpose?: MemberOwnedProviderSetupComputerRunPurpose | null;
}): ComputerRunOwner | null {
  const ownerKey = input.ownerKey?.trim() || null;
  const ownerPurpose = input.ownerPurpose ?? null;
  if ((ownerKey === null) !== (ownerPurpose === null)) {
    throw new TypeError("Computer run owner purpose and key must be supplied together.");
  }
  if (ownerPurpose === null || ownerKey === null) {
    return null;
  }
  if (ownerPurpose !== MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE) {
    throw new TypeError("Computer run owner purpose is invalid.");
  }
  return { ownerKey, ownerPurpose };
}

async function assertReusableComputerRunOwner(input: {
  activeRun: ComputerRunRecord;
  expectedRunId: string | null;
  memberId: string;
  now: Date;
  owner: ComputerRunOwner | null;
  store: ComputerUseStore;
}): Promise<void> {
  if (!input.owner) {
    if (input.activeRun.ownerKey || input.activeRun.ownerPurpose) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
        message: "Another browser operation is already active for this member.",
        retryable: false,
      });
    }
    return;
  }
  const ownerMatches =
    input.activeRun.ownerKey === input.owner.ownerKey
    && input.activeRun.ownerPurpose === input.owner.ownerPurpose;
  if (!ownerMatches) {
    throw computerUseConflictError({
      code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
      message: "Another browser operation is already active for this member.",
      retryable: false,
    });
  }
  if (
    input.expectedRunId !== null
    && input.activeRun.id !== input.expectedRunId
  ) {
    await input.store.requireMemberOwnedProviderSetupRunAcquisition({
      candidateRunId: input.activeRun.id,
      expectedRunId: input.expectedRunId,
      memberId: input.memberId,
      now: input.now,
      ownerKey: input.owner.ownerKey,
      ownerPurpose: input.owner.ownerPurpose,
    });
  }
}

function assertGenericComputerRun(run: ComputerRunRecord): void {
  if (!run.ownerKey && !run.ownerPurpose) {
    return;
  }
  throw computerUseConflictError({
    code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
    message: "Computer run is owned by another operation.",
    retryable: false,
  });
}

function isComputerAwaitingUserError(error: unknown): boolean {
  return error !== null
    && typeof error === "object"
    && Reflect.get(error, "code") === "HOSTED_COMPUTER_AWAITING_USER";
}

function runHandle(run: ComputerRunRecord, reused: boolean): ComputerRunHandle {
  return {
    awaitingReason: run.awaitingReason,
    expiresAt: run.expiresAt.toISOString(),
    lastTitle: run.lastTitle,
    lastUrl: run.lastUrl,
    reused,
    runId: run.id,
    status: run.status,
  };
}

function isFinishOutcomeStatus(
  status: ComputerRunRecord["status"],
): status is HostedComputerFinishOutcome {
  return status === "completed" || status === "failed" || status === "canceled";
}

function isTerminalRunStatus(
  status: ComputerRunRecord["status"],
): status is HostedComputerFinishOutcome | "expired" {
  return isFinishOutcomeStatus(status) || status === "expired";
}

function readManagedLoginDomain(run: ComputerRunRecord): string | null {
  return readManagedLoginDomainFromUrl(run.lastUrl);
}

function readManagedLoginDomainFromUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname
      ? url.hostname.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function requireManagedLoginDomain(run: ComputerRunRecord): string {
  const domain = readManagedLoginDomain(run);
  if (!domain) {
    throw managedLoginUnavailableError();
  }
  return domain;
}

function readManagedAuthFlowForHandoff(input: {
  connection: KernelManagedAuthConnection | null;
  handoff: ComputerHandoffRecord;
}): KernelManagedAuthConnection | null {
  const { connection, handoff } = input;
  if (
    !connection?.flowStatus ||
    !connection.flowExpiresAt ||
    connection.flowExpiresAt <= handoff.createdAt
  ) {
    return null;
  }
  return connection;
}

function isManagedAuthInProgressFlow(
  connection: KernelManagedAuthConnection,
  now: Date,
): boolean {
  return connection.flowStatus === "IN_PROGRESS" &&
    Boolean(connection.hostedUrl) &&
    Boolean(connection.flowExpiresAt && connection.flowExpiresAt > now);
}

function isManagedAuthTerminalFlow(
  connection: KernelManagedAuthConnection,
): boolean {
  return connection.flowStatus === "SUCCESS" ||
    connection.flowStatus === "FAILED" ||
    connection.flowStatus === "EXPIRED" ||
    connection.flowStatus === "CANCELED";
}

function isManagedAuthSuccessfulTerminalFlow(
  connection: KernelManagedAuthConnection,
): boolean {
  return connection.flowStatus === "SUCCESS" &&
    connection.status === "AUTHENTICATED";
}

function requireManagedAuthHostedUrl(
  connection: KernelManagedAuthConnection,
): string {
  if (!connection.hostedUrl) {
    throw managedLoginUnavailableError();
  }
  return connection.hostedUrl;
}

function managedLoginBrowserFromPrepared(
  prepared: PreparedRunBrowser,
): ComputerManagedLoginBrowser {
  return {
    kernelLiveViewUrlEncrypted:
      prepared.replaceInput.kernelLiveViewUrlEncrypted,
    kernelSessionId: prepared.replaceInput.kernelSessionId,
  };
}

function buildComputerHandoffUrl(input: {
  env: EnvSource;
  token: string;
}): string {
  return new URL(
    `/computer/handoff/${encodeURIComponent(input.token)}`,
    `${requireHostedPublicBaseUrl(input.env)}/`,
  ).toString();
}

function buildManagedLoginHostedUrl(input: {
  env: EnvSource;
  hostedUrl: string;
  token: string;
}): string {
  const hostedUrl = new URL(input.hostedUrl);
  if (!isAllowedKernelManagedAuthHostedUrl({ url: hostedUrl })) {
    throw managedLoginUnavailableError();
  }
  const callbackUrl = new URL(
    `/api/computer/handoff/${encodeURIComponent(input.token)}/managed-login`,
    `${requireHostedPublicBaseUrl(input.env)}/`,
  ).toString();
  hostedUrl.searchParams.set("success_url", callbackUrl);
  hostedUrl.searchParams.set("error_url", callbackUrl);
  return hostedUrl.toString();
}

function managedLoginUnavailableError(input?: {
  cause: unknown;
  stage: "live_view_fallback" | "managed_auth_start";
}): Error {
  return computerUseError({
    code: "HOSTED_COMPUTER_MANAGED_LOGIN_UNAVAILABLE",
    details: input ? buildManagedLoginFailureDetails(input) : undefined,
    httpStatus: 409,
    message: "Managed sign-in is temporarily unavailable.",
    retryable: true,
  });
}

class ManagedLoginTerminalOutcomeUnknownError extends Error {
  constructor() {
    super("Managed login terminal outcome is unknown.");
    this.name = "ManagedLoginTerminalOutcomeUnknownError";
  }
}

function isReplyBoundaryUnavailableError(error: unknown): boolean {
  return isHostedOnboardingError(error) &&
    error.code === "HOSTED_COMPUTER_REPLY_BOUNDARY_UNAVAILABLE";
}

function buildManagedLoginFailureDetails(input: {
  cause: unknown;
  stage: "live_view_fallback" | "managed_auth_start";
}): Record<string, boolean | string> {
  const domainError = isHostedOnboardingError(input.cause)
    ? input.cause
    : null;
  return {
    managedLoginCauseCode: domainError?.code.startsWith("HOSTED_COMPUTER_")
      ? domainError.code
      : "HOSTED_COMPUTER_UNEXPECTED_FAILURE",
    managedLoginStage: input.stage,
    ...readLiveViewValidationFailureDetails(domainError?.details ?? {}),
  };
}

function readLiveViewValidationFailureDetails(
  details: Record<string, unknown>,
): Record<string, boolean> {
  const output: Record<string, boolean> = {};
  for (const key of [
    "liveViewHostnameAllowed",
    "liveViewParsed",
    "liveViewPortAllowed",
    "liveViewProtocolAllowed",
  ] as const) {
    if (typeof details[key] === "boolean") {
      output[key] = details[key];
    }
  }
  return output;
}

function managedLoginRequiresLoginNeededError(): Error {
  return computerUseConflictError({
    code: "HOSTED_COMPUTER_MANAGED_LOGIN_REQUIRES_LOGIN_NEEDED",
    message: "Managed sign-in is only available for login checkpoints.",
    retryable: true,
  });
}

function requireKernelSessionId(run: ComputerRunRecord): string {
  if (!run.kernelSessionId) {
    throw computerUseConflictError({
      code: "HOSTED_COMPUTER_BROWSER_MISSING",
      message: "Computer browser session is not available.",
      retryable: true,
    });
  }

  return run.kernelSessionId;
}

function browserCleanupFailedError(): Error {
  return computerUseConflictError({
    code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    message: "Kernel browser cleanup failed.",
    retryable: true,
  });
}

function browserProvisioningInProgressError(): Error {
  return computerUseConflictError({
    code: "HOSTED_COMPUTER_BROWSER_PROVISIONING",
    message: "Computer browser is still starting.",
    retryable: true,
  });
}

function handoffCheckpointingError(): Error {
  return computerUseConflictError({
    code: "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING",
    message: "Computer handoff is checkpointing.",
    retryable: true,
  });
}

function runExpiredError(): Error {
  return computerUseConflictError({
    code: "HOSTED_COMPUTER_RUN_EXPIRED",
    message: "Computer run expired.",
    retryable: true,
  });
}

function requireRemainingKernelTimeoutSeconds(run: ComputerRunRecord, now: Date): number {
  const remainingSeconds = Math.ceil((run.expiresAt.getTime() - now.getTime()) / 1000);
  if (remainingSeconds <= 0) {
    throw runExpiredError();
  }

  return remainingSeconds;
}

function handoffIncompleteForFinishError(): Error {
  return computerUseConflictError({
    code: "HOSTED_COMPUTER_HANDOFF_NOT_COMPLETED",
    message: "Computer handoff must be completed before finishing the run.",
    retryable: true,
  });
}

function normalizeComputerCheckpointContext(
  context: HostedComputerDeliveryContext | null,
): ComputerRunCheckpointContext | null {
  if (!context?.conversationId && !context?.recipientKey) {
    return null;
  }

  return {
    conversationId: context.conversationId ?? null,
    recipientKey: context.recipientKey ?? null,
  };
}

function doesResumeContextMatchCheckpoint(input: {
  expected: ComputerRunCheckpointContext | null;
  received: HostedComputerDeliveryContext | null;
}): boolean {
  if (!input.expected) {
    return true;
  }
  const received = normalizeComputerCheckpointContext(input.received);
  if (!received) {
    return false;
  }

  return doesResumeContextPartMatchCheckpoint({
    expected: input.expected.conversationId,
    received: received.conversationId,
    receivedReturnContactKind: input.received?.returnContactKind ?? null,
  }) && doesResumeContextPartMatchCheckpoint({
    expected: input.expected.recipientKey,
    received: received.recipientKey,
    receivedReturnContactKind: input.received?.returnContactKind ?? null,
  });
}

function doesResumeContextPartMatchCheckpoint(input: {
  expected: string | null;
  received: string | null;
  receivedReturnContactKind: HostedComputerReturnContactKind | null;
}): boolean {
  if (!input.expected) {
    return true;
  }
  if (input.expected === input.received) {
    return true;
  }
  if (!input.received || !input.receivedReturnContactKind) {
    return false;
  }

  const scoped = readScopedComputerCheckpointPart(input.received);
  if (scoped?.value === input.expected &&
    resolveComputerCheckpointScopedReturnContactKind(scoped.channel) ===
      input.receivedReturnContactKind
  ) {
    return true;
  }

  const expectedScoped = readScopedComputerCheckpointPart(input.expected);
  return expectedScoped?.value === input.received &&
    resolveComputerCheckpointScopedReturnContactKind(expectedScoped.channel) ===
      input.receivedReturnContactKind;
}

function readScopedComputerCheckpointPart(value: string): {
  channel: string;
  value: string;
} | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      return null;
    }
    const channel = normalizeComputerCheckpointChannel(parsed[0]);
    const rawValue = normalizeComputerCheckpointValue(parsed[1]);
    return channel && rawValue ? { channel, value: rawValue } : null;
  } catch {
    return null;
  }
}

function resolveComputerCheckpointScopedReturnContactKind(
  channel: string,
): HostedComputerReturnContactKind | null {
  switch (channel) {
    case "linq":
      return "text";
    case "telegram":
      return "telegram";
    case "email":
      return "email";
    default:
      return null;
  }
}

function normalizeComputerCheckpointChannel(value: unknown): string | null {
  const normalized = normalizeComputerCheckpointValue(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeComputerCheckpointValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function buildMemberOwnedProviderSetupComputerActCode(
  input: HostedComputerControlActRequest,
): string {
  return `
const __murphSteps = ${JSON.stringify(input.steps)};
const __murphCredentialHint = /(?:client\\s*(?:id|secret)|consumer\\s*(?:key|secret)|api\\s*(?:key|secret|token)|oauth\\s*(?:key|secret|token)|access\\s*token|refresh\\s*token|private\\s*key|password|credential|bearer\\s*token)/iu;
const __murphOwnershipMarker = /^Murph Private Sync [a-f0-9]{12}$/u;
const __murphCommitHint = /(?:^|\\b)(?:create|register|save|submit)(?:\\b|$)/iu;
const __murphDestructiveHint = /(?:^|\\b)(?:delete|remove|revoke|reset|rotate|destroy|disconnect)(?:\\b|$)/iu;
const __murphBlockedRequest = async (route) => {
  const method = route.request().method().toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    await route.continue();
    return;
  }
  await route.abort("blockedbyclient");
};
const __murphLocate = (target) => {
  switch (target.kind) {
    case "label":
      return page.getByLabel(target.value, { exact: target.exact });
    case "role":
      return page.getByRole(target.role, {
        exact: target.exact,
        ...(target.name === null ? {} : { name: target.name }),
      });
    case "selector":
      return page.locator(target.value);
    case "text":
      return page.getByText(target.value, { exact: target.exact });
    default:
      throw new Error("MURPH_PROVIDER_SETUP_TARGET_INVALID");
  }
};
const __murphOneVisible = async (target) => {
  const locator = __murphLocate(target);
  await locator.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  const visible = [];
  for (let index = 0; index < await locator.count(); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) visible.push(candidate);
  }
  if (visible.length !== 1) {
    throw new Error("MURPH_PROVIDER_SETUP_TARGET_AMBIGUOUS");
  }
  return visible[0];
};
const __murphTargetMetadata = async (locator) => await locator.evaluate((element) => {
  const input = element instanceof HTMLInputElement ? element : null;
  const labels = input?.labels ? Array.from(input.labels).map((label) => label.textContent || "") : [];
  return {
    hints: [
      element.getAttribute("aria-label"),
      element.getAttribute("autocomplete"),
      element.getAttribute("id"),
      element.getAttribute("name"),
      element.getAttribute("placeholder"),
      element.getAttribute("title"),
      ...labels,
      element.textContent,
    ].filter(Boolean).join(" "),
    inForm: Boolean(element.closest("form")),
    role: element.getAttribute("role") || "",
    tagName: element.tagName.toLowerCase(),
    type: input?.type || (element instanceof HTMLButtonElement ? element.type : ""),
  };
});
await page.route("**/*", __murphBlockedRequest);
try {
  for (const step of __murphSteps) {
    switch (step.action) {
      case "goto": {
        const current = new URL(page.url());
        const requested = new URL(step.url, current);
        if (requested.protocol !== "https:" || requested.origin !== current.origin) {
          throw new Error("MURPH_PROVIDER_SETUP_NAVIGATION_FORBIDDEN");
        }
        await page.goto(requested.toString(), { waitUntil: "domcontentloaded" });
        break;
      }
      case "click": {
        const target = await __murphOneVisible(step.target);
        const metadata = await __murphTargetMetadata(target);
        const isSubmit = metadata.type === "submit"
          || metadata.type === "image"
          || (metadata.tagName === "button" && metadata.inForm && !metadata.type);
        if (
          isSubmit
          || __murphCredentialHint.test(metadata.hints)
          || __murphDestructiveHint.test(metadata.hints)
          || (metadata.tagName !== "a" && __murphCommitHint.test(metadata.hints))
        ) {
          throw new Error("MURPH_PROVIDER_SETUP_COMMIT_REQUIRES_TRUSTED_TOOL");
        }
        await target.click();
        break;
      }
      case "fill": {
        const target = await __murphOneVisible(step.target);
        const metadata = await __murphTargetMetadata(target);
        if (metadata.type === "password" || __murphCredentialHint.test(metadata.hints)) {
          throw new Error("MURPH_PROVIDER_SETUP_CREDENTIAL_FIELD_FORBIDDEN");
        }
        if (__murphOwnershipMarker.test(step.value.trim())) {
          throw new Error("MURPH_PROVIDER_SETUP_OWNERSHIP_MARKER_FORBIDDEN");
        }
        await target.fill(step.value);
        break;
      }
      case "select": {
        const target = await __murphOneVisible(step.target);
        await target.selectOption(
          step.option.kind === "label"
            ? { label: step.option.value }
            : { value: step.option.value },
        );
        break;
      }
      case "set_checked": {
        const target = await __murphOneVisible(step.target);
        await target.setChecked(step.checked);
        break;
      }
      case "wait": {
        const target = __murphLocate(step.target);
        if (step.state === "visible") {
          await __murphOneVisible(step.target);
        } else {
          const count = await target.count();
          if (count !== 1) throw new Error("MURPH_PROVIDER_SETUP_TARGET_AMBIGUOUS");
          await target.first().waitFor({ state: "hidden" });
        }
        break;
      }
      default:
        throw new Error("MURPH_PROVIDER_SETUP_ACTION_INVALID");
    }
  }
${buildMemberOwnedProviderSetupObservationCode()}
} finally {
  await page.unroute("**/*", __murphBlockedRequest).catch(() => undefined);
}
`.trim();
}

function buildMemberOwnedProviderSetupObservationCode(): string {
  return `
const __murphSafeState = await page.evaluate(() => {
  const credentialHint = /(?:client\\s*(?:id|secret)|consumer\\s*(?:key|secret)|api\\s*(?:key|secret|token)|oauth\\s*(?:key|secret|token)|access\\s*token|refresh\\s*token|private\\s*key|password|credential|bearer\\s*token)/iu;
  const opaqueToken = /(?=[A-Za-z0-9_-]{8,})(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\\d)[A-Za-z0-9_-]{8,}/gu;
  const sanitize = (value) => {
    const collapsed = String(value || "").replace(/\\s+/gu, " ").trim();
    if (!collapsed) return "";
    if (credentialHint.test(collapsed)) return "[credential hidden]";
    return collapsed
      .replace(/\\b\\d{4,}\\b/gu, "[opaque]")
      .replace(opaqueToken, "[opaque]")
      .slice(0, 180);
  };
  const safeUrl = new URL("/", window.location.origin).toString();
  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden"
      && style.display !== "none"
      && rect.width > 0
      && rect.height > 0;
  };
  const readName = (element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelled = labelledBy
      ? labelledBy.split(/\\s+/u).map((id) => document.getElementById(id)?.textContent || "").join(" ")
      : "";
    const inputLabels = element instanceof HTMLInputElement && element.labels
      ? Array.from(element.labels).map((label) => label.textContent || "").join(" ")
      : "";
    const placeholder = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.placeholder
      : "";
    return sanitize(
      element.getAttribute("aria-label")
      || labelled
      || inputLabels
      || placeholder
      || element.getAttribute("title")
      || element.textContent
      || "",
    );
  };
  const readRole = (element) => {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    if (element instanceof HTMLAnchorElement) return "link";
    if (element instanceof HTMLButtonElement) return "button";
    if (element instanceof HTMLSelectElement) return "combobox";
    if (element instanceof HTMLTextAreaElement) return "textbox";
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox") return "checkbox";
      if (element.type === "radio") return "radio";
      if (element.type === "submit" || element.type === "button") return "button";
      return "textbox";
    }
    return element.tagName.toLowerCase();
  };
  const candidates = Array.from(document.querySelectorAll([
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "textarea",
    "select",
    "iframe",
    "[role=alert]",
    "[role=status]",
    "h1",
    "h2",
    "h3",
  ].join(",")));
  const controls = [];
  for (const element of candidates) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
    const role = readRole(element);
    const name = readName(element);
    const optionNames = element instanceof HTMLSelectElement
      ? Array.from(element.options).slice(0, 30).map((option) => sanitize(option.textContent || option.label))
      : [];
    const destination = element instanceof HTMLAnchorElement
      ? (() => {
          const target = new URL(element.href);
          return target.origin === window.location.origin
            ? sanitize(decodeURIComponent(target.pathname))
            : "[external]";
        })()
      : "";
    controls.push([role, name || "[unnamed]", optionNames.filter(Boolean), destination]);
    if (controls.length >= 160) break;
  }
  return {
    title: null,
    url: safeUrl,
    visibleText: controls.map(([role, name, options, destination]) => {
      const base = role + ' "' + name + '"' + (destination ? " -> " + destination : "");
      return options.length > 0 ? base + " options: " + options.join(" | ") : base;
    }).join("\\n").slice(0, ${COMPUTER_OBSERVE_TEXT_LIMIT}),
  };
});
return __murphSafeState;
`.trim();
}

function buildComputerActCode(input: HostedComputerScriptActRequest): string {
  return [
    "const __murphUserResult = await (async () => {",
    input.code,
    "\n})();",
    "const __murphUrl = page.url();",
    "const __murphTitle = await page.title().catch(() => null);",
    "return {",
    "  result: typeof __murphUserResult === 'undefined' ? null : __murphUserResult,",
    "  title: __murphTitle,",
    "  url: __murphUrl,",
    "};",
  ].join("\n");
}

function buildComputerProviderCredentialCaptureCode(code: string): string {
  return [
    "const __murphProviderCredentials = await (async () => {",
    code,
    "\n})();",
    "const __murphUrl = page.url();",
    "const __murphTitle = await page.title().catch(() => null);",
    "return {",
    "  result: __murphProviderCredentials,",
    "  title: __murphTitle,",
    "  url: __murphUrl,",
    "};",
  ].join("\n");
}

function readRequiredComputerProviderCredentials(
  value: unknown,
): ComputerProviderCredentials {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw computerUseError({
      code: "HOSTED_COMPUTER_PROVIDER_CREDENTIAL_CAPTURE_INVALID",
      httpStatus: 502,
      message: "Provider application credentials could not be captured safely.",
      retryable: true,
    });
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length === 1
    && record.kind === "pre_submit_failed"
  ) {
    throw computerUseError({
      code: "HOSTED_COMPUTER_PROVIDER_CREDENTIAL_CAPTURE_PRE_SUBMIT_FAILED",
      httpStatus: 502,
      message: "Provider application submission was not attempted.",
      retryable: true,
    });
  }
  if (
    Object.keys(record).length === 1
    && record.kind === "no_application"
  ) {
    throw computerUseError({
      code: "HOSTED_COMPUTER_PROVIDER_CREDENTIAL_CAPTURE_NO_APPLICATION",
      httpStatus: 409,
      message: "Provider application recovery proved that no application exists.",
      retryable: true,
    });
  }
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "clientId" || keys[1] !== "clientSecret") {
    throw computerUseError({
      code: "HOSTED_COMPUTER_PROVIDER_CREDENTIAL_CAPTURE_INVALID",
      httpStatus: 502,
      message: "Provider application credentials could not be captured safely.",
      retryable: true,
    });
  }
  return {
    clientId: requireComputerProviderCredentialString(record.clientId, 512),
    clientSecret: requireComputerProviderCredentialString(record.clientSecret, 4096),
  };
}

function requireComputerProviderCredentialString(
  value: unknown,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw computerUseError({
      code: "HOSTED_COMPUTER_PROVIDER_CREDENTIAL_CAPTURE_INVALID",
      httpStatus: 502,
      message: "Provider application credentials could not be captured safely.",
      retryable: true,
    });
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw computerUseError({
      code: "HOSTED_COMPUTER_PROVIDER_CREDENTIAL_CAPTURE_INVALID",
      httpStatus: 502,
      message: "Provider application credentials could not be captured safely.",
      retryable: true,
    });
  }
  return normalized;
}

function scrubComputerProviderCredentialResult(value: unknown): void {
  const seen = new Set<object>();
  const scrub = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    for (const key of Object.getOwnPropertyNames(candidate)) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (!descriptor || !("value" in descriptor)) {
        continue;
      }
      if (key === "clientId" || key === "clientSecret") {
        Reflect.set(candidate, key, "");
        continue;
      }
      scrub(descriptor.value);
    }
  };
  scrub(value);
}

function addComputerActFailureContext(
  error: unknown,
  input: { code: string; timeoutMs: number },
): unknown {
  const domainError = readComputerUseDomainError(error);
  if (
    !domainError ||
    domainError.code !== "HOSTED_COMPUTER_EVAL_FAILED"
  ) {
    return error;
  }

  return computerUseError({
    code: domainError.code,
    details: {
      ...domainError.details,
      codeHash: shortHash(input.code),
      timeoutMs: input.timeoutMs,
    },
    httpStatus: domainError.httpStatus,
    message: domainError.message,
    retryable: domainError.retryable,
  });
}

function readComputerUseDomainError(error: unknown): {
  code: string;
  details: Record<string, unknown>;
  httpStatus: number;
  message: string;
  retryable: boolean;
} | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const record = error as Record<string, unknown>;
  if (
    typeof record.code !== "string" ||
    typeof record.httpStatus !== "number" ||
    typeof record.message !== "string"
  ) {
    return null;
  }

  return {
    code: record.code,
    details: readComputerUseErrorDetails(record.details),
    httpStatus: record.httpStatus,
    message: record.message,
    retryable: record.retryable === true,
  };
}

function readComputerUseErrorDetails(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function requireNonSensitiveComputerOsTextTarget(input: {
  action: HostedComputerOsControlRequest;
  kernel: ComputerKernelClient;
  sessionId: string;
}): Promise<void> {
  if (input.action.action !== "typeText") {
    return;
  }

  const result = await input.kernel.executePlaywright({
    code: buildComputerActiveElementSensitiveInputProbeCode(),
    sessionId: input.sessionId,
    timeoutMs: COMPUTER_OS_CONTROL_PREFLIGHT_TIMEOUT_MS,
  });
  const preflight = readComputerSensitiveInputPreflightResult(result.result);
  if (!preflight.sensitive) {
    return;
  }

  throw computerUseError({
    code: "HOSTED_COMPUTER_SENSITIVE_INPUT_REQUIRES_HANDOFF",
    httpStatus: 400,
    message: "Computer input targets a sensitive field. Pause for user handoff instead.",
  });
}

function buildComputerActiveElementSensitiveInputProbeCode(): string {
  return `
const target = page.locator(':focus');
await target.waitFor({ state: 'attached', timeout: 1000 }).catch(() => {});
const targetIsInspectable = await target.count().then((count) => count === 1).catch(() => false);
if (!targetIsInspectable) return { sensitive: true, reason: "focused_target_uninspectable" };
const attr = async (name) => String(await target.getAttribute(name, { timeout: 1000 }).catch(() => "") || "").toLowerCase();
const type = await attr("type");
const inputMode = await attr("inputmode");
const maxLengthRaw = await attr("maxlength");
const maxLength = maxLengthRaw ? Number(maxLengthRaw) : -1;
const autocompleteTokens = (await attr("autocomplete")).split(/\\s+/u).filter(Boolean);
const tagName = String(await target.evaluate((element) => element.tagName).catch(() => "") || "").toLowerCase();
const isContentEditable = await target.evaluate((element) => element instanceof HTMLElement && element.isContentEditable).catch(() => false);
const editableInputTypes = new Set(["", "text", "search", "email", "tel", "url", "number", "date", "datetime-local", "month", "password", "time", "week"]);
const isEditableTextTarget =
  tagName === "textarea" ||
  isContentEditable === true ||
  (tagName === "input" && editableInputTypes.has(type));
if (!isEditableTextTarget) return { sensitive: true, reason: "focused_target_not_editable" };
if (type === "password") return { sensitive: true, reason: "password_type" };
if (autocompleteTokens.some((token) =>
  token === "current-password" ||
  token === "new-password" ||
  token === "one-time-code" ||
  token.startsWith("cc-")
)) {
  return { sensitive: true, reason: "sensitive_autocomplete" };
}
const hints = [
  type,
  inputMode,
  await attr("name"),
  await attr("id"),
  await attr("aria-label"),
  await attr("aria-description"),
  await attr("aria-describedby"),
  await attr("aria-labelledby"),
  await attr("placeholder"),
  await attr("title"),
  await attr("data-testid"),
  await attr("data-test"),
  await attr("data-qa"),
].join(" ");
const sensitivePatterns = [
  /\\b(?:password|passcode|passphrase)\\b/u,
  /\\b(?:one[-_\\s]?time|otp|2fa|mfa|two[-_\\s]?factor|authenticator)(?:[-_\\s]*(?:code|passcode|token))?\\b/u,
  /\\b(?:verification|authentication|security)[-_\\s]*(?:code|passcode|token)\\b|\\b(?:verification|authentication|security)(?:code|passcode|token)\\b/u,
  /\\b(?:cvc|cvv|cvn|cid)\\b/u,
  /\\b(?:card[-_\\s]*(?:number|no|holder)|credit[-_\\s]*card|debit[-_\\s]*card|name[-_\\s]*on[-_\\s]*card|expiry|expiration[-_\\s]*(?:date)?|exp[-_\\s]*date|cc[-_\\s]*(?:number|csc|exp|name))\\b/u,
  /\\b(?:bank[-_\\s]*(?:routing|account|acct)|(?:checking|savings)[-_\\s]*(?:account|acct)(?:[-_\\s]*(?:#|number|no)|number|no)?|(?:account|acct)(?:[-_\\s]*(?:#|number|no)|number|no)|routing(?:[-_\\s]*(?:#|number|no)|number|no)?|ach|iban|swift|bic)(?=\\b|[^\\w]|$)/u,
  /\\b(?:(?:api|access|refresh|auth|bearer)[-_\\s]*(?:key|token|secret)|private[-_\\s]*key|client[-_\\s]*secret|token|secret)\\b/u,
  /\\b(?:pin|ssn|social[-_\\s]*security)\\b/u,
];
if (sensitivePatterns.some((pattern) => pattern.test(hints))) return { sensitive: true, reason: "sensitive_hint" };
const shortCodeField =
  /\\bcode\\b/u.test(hints) &&
  (
    inputMode === "numeric" ||
    inputMode === "decimal" ||
    inputMode === "tel" ||
    type === "number" ||
    type === "tel" ||
    (Number.isFinite(maxLength) && maxLength > 0 && maxLength <= 8)
  );
return { sensitive: shortCodeField, reason: shortCodeField ? "short_code" : undefined };
`.trim();
}

function requireComputerNavigationUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function buildComputerNavigationCode(input: {
  timeoutMs: number;
  url: string;
}): string {
  return [
    `await page.goto(${JSON.stringify(input.url)}, { waitUntil: 'domcontentloaded', timeout: ${input.timeoutMs} });`,
    "const finalUrl = page.url();",
    "const title = await page.title().catch(() => null);",
    "let visibleText = '';",
    "try { visibleText = await page.locator('body').innerText({ timeout: 5000 }); } catch {}",
    `if (visibleText.length > ${COMPUTER_OBSERVE_TEXT_LIMIT}) visibleText = visibleText.slice(0, ${COMPUTER_OBSERVE_TEXT_LIMIT});`,
    "return { url: finalUrl, title, visibleText };",
  ].join("\n");
}

function sanitizeComputerDisplayUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function readOptionalBrowserStateResult(value: unknown): {
  title: string | null;
  url: string | null;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url : null;
  const title = typeof record.title === "string" ? record.title : null;

  return url || title ? { title, url } : null;
}

function readBrowserStateResult(value: unknown): {
  title: string | null;
  url: string | null;
  visibleText: string;
} {
  const partial = readOptionalBrowserStateResult(value);
  const visibleText = readVisibleText(value);

  return {
    title: partial?.title ?? null,
    url: partial?.url ?? null,
    visibleText,
  };
}

function readRequiredBrowserActionStateResult(value: unknown): {
  result: unknown;
  title: string | null;
  url: string | null;
} {
  const state = readOptionalBrowserStateResult(value);
  if (
    !state?.url ||
    !sanitizeComputerDisplayUrl(state.url)
  ) {
    throw computerUseError({
      code: "HOSTED_COMPUTER_ACTION_STATE_INVALID",
      httpStatus: 502,
      message: "Computer action finished with an invalid browser state result.",
      retryable: true,
    });
  }

  return {
    result: value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).result ?? null
      : null,
    title: state.title,
    url: state.url,
  };
}

function readComputerSensitiveInputPreflightResult(value: unknown): {
  sensitive: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidSensitiveInputPreflightResultError();
  }
  const record = value as Record<string, unknown>;
  if (typeof record.sensitive !== "boolean") {
    throw invalidSensitiveInputPreflightResultError();
  }
  return { sensitive: record.sensitive === true };
}

function invalidSensitiveInputPreflightResultError(): Error {
  return computerUseError({
    code: "HOSTED_COMPUTER_SENSITIVE_INPUT_PREFLIGHT_INVALID",
    httpStatus: 502,
    message: "Computer sensitive-input preflight returned an invalid result.",
    retryable: true,
  });
}

function readVisibleText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const record = value as Record<string, unknown>;
  return typeof record.visibleText === "string"
    ? record.visibleText.slice(0, COMPUTER_OBSERVE_TEXT_LIMIT)
    : "";
}

function assertHandoffOwnedByMember(
  handoff: ComputerHandoffRecord,
  memberId: string,
): void {
  if (handoff.memberId !== memberId) {
    throw computerUseNotFoundError("Computer handoff was not found.");
  }
}

function assertOpenFreshHandoff(
  handoff: ComputerHandoffRecord,
  now: Date,
): void {
  if (handoff.status !== "open") {
    throw computerUseConflictError({
      code: "HOSTED_COMPUTER_HANDOFF_CLOSED",
      message: "Computer handoff is no longer open.",
    });
  }

  if (handoff.expiresAt <= now) {
    throw computerUseConflictError({
      code: "HOSTED_COMPUTER_HANDOFF_EXPIRED",
      message: "Computer handoff expired.",
    });
  }
}

function isExpiredHandoff(
  handoff: ComputerHandoffRecord,
  now: Date,
): boolean {
  return handoff.status === "expired" || handoff.expiresAt <= now;
}

function isDeferredLoginCheckpointHandoff(
  handoff: ComputerHandoffRecord,
): boolean {
  return handoff.purpose === "login" &&
    handoff.completedAt !== null &&
    (handoff.status === "completed" || handoff.status === "checkpointing");
}

function isRetiredStaticPreviewHandoff(
  handoff: { purpose: PersistedComputerHandoffPurpose },
): handoff is { purpose: "screen_inspection" } {
  return handoff.purpose === "screen_inspection";
}

function isProviderSetupHandoffPurpose(
  purpose: PersistedComputerHandoffPurpose,
): purpose is HostedComputerHandoffPurpose {
  return purpose === "login"
    || purpose === "managed_login"
    || purpose === "manual_browser_help";
}

function requireSupportedPersistedHandoffPurpose(
  purpose: PersistedComputerHandoffPurpose,
): HostedComputerHandoffPurpose {
  if (purpose === "screen_inspection") {
    throw new TypeError("Retired static-preview handoff purpose is unsupported here.");
  }
  return purpose;
}

function isStaleCheckpointingHandoff(
  handoff: ComputerHandoffRecord,
  now: Date,
): boolean {
  return handoff.status === "checkpointing" &&
    handoff.updatedAt.getTime() <= now.getTime() - COMPUTER_HANDOFF_CHECKPOINTING_STALE_MS;
}

function isFreshCheckpointingHandoff(
  handoff: ComputerHandoffRecord,
  now: Date,
): boolean {
  return handoff.status === "checkpointing" &&
    !isStaleCheckpointingHandoff(handoff, now);
}

function isStaleBrowserlessProvisioningRun(
  run: ComputerRunRecord,
  now: Date,
): boolean {
  return run.status === "running" &&
    !run.kernelSessionId &&
    run.updatedAt.getTime() <= now.getTime() - COMPUTER_BROWSER_PROVISIONING_STALE_MS;
}

function isBlockingBrowserlessProvisioningRun(
  run: ComputerRunRecord,
): boolean {
  return run.status === "running" && !run.kernelSessionId;
}

function isStaleCleanupPendingRun(
  run: ComputerRunRecord,
  now: Date,
): boolean {
  return run.status === "cleanup_pending" &&
    run.updatedAt.getTime() <= now.getTime() - COMPUTER_BROWSER_PROVISIONING_STALE_MS;
}

function isComputerHandoffCheckpointingError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING";
}

function isStaleRunStateConflict(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "HOSTED_COMPUTER_RUN_STATE_CHANGED";
}

function isComputerUseNotFoundError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "HOSTED_COMPUTER_NOT_FOUND";
}

function isMemberSuspendedComputerUseError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "HOSTED_COMPUTER_MEMBER_SUSPENDED";
}

function requireHostedPublicBaseUrl(env: EnvSource): string {
  const baseUrl = readHostedPublicBaseUrl(env);

  if (!baseUrl) {
    throw computerUseError({
      code: "HOSTED_COMPUTER_PUBLIC_BASE_URL_MISSING",
      httpStatus: 503,
      message: "Computer handoff links are not configured.",
      retryable: true,
    });
  }

  return baseUrl;
}

function buildKernelProfileName(input: {
  memberId: string;
  namespace: string;
}): string {
  const namespaceSegment = normalizeKernelNameSegment(input.namespace);
  const hash = shortHash(`${input.namespace}:${input.memberId}`);
  return `murph-${namespaceSegment}-${hash}`.slice(0, 255);
}

function buildKernelProfileNamesForAccountDeletion(
  runs: readonly ComputerRunRecord[],
): string[] {
  return uniqueStrings(runs.map((run) => run.kernelProfileName));
}

function buildKernelProfileNameForAccountDeletion(input: {
  env: EnvSource;
  memberId: string;
}): string | null {
  const namespace = input.env.HOSTED_COMPUTER_PROFILE_NAMESPACE?.trim()
    ?? process.env.HOSTED_COMPUTER_PROFILE_NAMESPACE?.trim();
  return namespace
    ? buildKernelProfileName({
        memberId: input.memberId,
        namespace,
      })
    : null;
}

function requireKernelProfileNamespace(env: EnvSource): string {
  const namespace = env.HOSTED_COMPUTER_PROFILE_NAMESPACE?.trim()
    ?? process.env.HOSTED_COMPUTER_PROFILE_NAMESPACE?.trim();
  if (namespace) {
    return namespace;
  }

  throw computerUseError({
    code: "HOSTED_COMPUTER_PROFILE_NAMESPACE_MISSING",
    httpStatus: 503,
    message: "Hosted computer profile namespace is not configured.",
    retryable: false,
  });
}

function buildKernelBrowserName(input: {
  runId: string;
}): string {
  const runSegment = normalizeKernelNameSegment(input.runId);
  return `murph-browser-${runSegment}-${shortHash(input.runId)}`.slice(0, 255);
}

function buildKernelBrowserIdsForAccountDeletion(input: {
  now: Date;
  runs: readonly ComputerRunRecord[];
}): string[] {
  return uniqueStrings([
    ...input.runs.map((run) => run.kernelSessionId),
    ...input.runs
      .filter((run) => shouldDeleteDeterministicBrowserName(run, input.now))
      .map((run) => buildKernelBrowserName({ runId: run.id })),
  ]);
}

function shouldDeleteDeterministicBrowserName(
  run: ComputerRunRecord,
  now: Date,
): boolean {
  if (run.kernelSessionId) {
    return false;
  }
  return run.expiresAt.getTime() >= now.getTime() - COMPUTER_DETERMINISTIC_BROWSER_ACCOUNT_DELETE_GRACE_MS;
}

function normalizeKernelNameSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalized.length > 0 ? normalized.slice(0, 80) : "default";
}
