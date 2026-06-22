import { lookup as lookupDns } from "node:dns/promises";

import {
  isHostedComputerIpLiteral,
  isHostedComputerNavigationUrl,
  isHostedComputerPublicIpAddress,
  type HostedComputerActRequest,
  type HostedComputerAwaitingReason,
  type HostedComputerDeliveryContext,
  type HostedComputerFinishOutcome,
  type HostedComputerHandoffPurpose,
} from "@murphai/hosted-execution/computer-use";

import { readHostedPublicBaseUrl } from "../hosted-web/public-url";
import { computerUseConflictError, computerUseError, computerUseNotFoundError } from "./errors";
import {
  hostedComputerUseCrypto,
  type ComputerUseCrypto,
  type ComputerRunSecretField,
} from "./crypto";
import { createComputerHandoffToken, createComputerId, sha256Hex, shortHash } from "./ids";
import { isAllowedComputerLiveViewUrl } from "./live-view-origin";
import {
  KernelComputerClient,
  type ComputerKernelClient,
} from "./kernel-client";
import {
  PrismaComputerUseStore,
  type ComputerHandoffRecord,
  type ComputerRunCheckpointContext,
  type ComputerRunRecord,
  type ComputerUseStore,
} from "./store";

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
type EnvSource = Readonly<Record<string, string | undefined>>;
type NavigationDnsLookup = (hostname: string) => Promise<readonly { address: string }[]>;
type AttachRunBrowserInput = Parameters<ComputerUseStore["attachRunBrowser"]>[0];
type ReplaceRunBrowserInput = Parameters<ComputerUseStore["replaceRunBrowser"]>[0];
type AmbiguousBrowserWriteReplayResult = ComputerRunRecord | "unknown" | null;

export interface ComputerRunHandle {
  awaitingReason: HostedComputerAwaitingReason | null;
  expiresAt: string;
  lastTitle: string | null;
  lastUrl: string | null;
  reused: boolean;
  runId: string;
  status: ComputerRunRecord["status"];
}

export interface ComputerObserveResult {
  runId: string;
  status: "running";
  title: string | null;
  url: string | null;
  visibleText: string;
}

export interface ComputerPauseForUserResult {
  awaitingReason: HostedComputerAwaitingReason;
  handoffUrl: string | null;
  message: string;
  runId: string;
  status: "awaiting_user";
  suggestedReply: string | null;
}

export interface ComputerExpiredRunCleanupResult {
  expiredRuns: number;
}

type ComputerRunCleanupOutcome = "cleaned" | "expired" | "failed";
type BrowserlessProvisioningRecovery = "busy" | "changed" | "recovered";
type HostedComputerActLocator = NonNullable<Extract<HostedComputerActRequest, {
  locator?: unknown;
}>["locator"]>;

export interface ComputerAccountExternalCleanupResult {
  browserSessionsDeleted: number;
  profilesDeleted: number;
}

export type ComputerHandoffPageState =
  | {
      kind: "completed";
      suggestedReply: string | null;
    }
  | {
      kind: "expired";
      suggestedReply: string | null;
    }
  | {
      kind: "checkpointing";
      suggestedReply: string | null;
    }
  | {
      handoffId: string;
      iframeAllow: string;
      kind: "open";
      liveViewUrl: string;
      purpose: HostedComputerHandoffPurpose;
      suggestedReply: string | null;
    };

export class ComputerUseService {
  private readonly crypto: ComputerUseCrypto;
  private readonly env: EnvSource;
  private kernel: ComputerKernelClient | null;
  private readonly navigationDnsLookup: NavigationDnsLookup;
  private readonly now: () => Date;
  private readonly store: ComputerUseStore;

  constructor(input: {
    crypto?: ComputerUseCrypto;
    env?: EnvSource;
    kernel?: ComputerKernelClient;
    navigationDnsLookup?: NavigationDnsLookup;
    now?: () => Date;
    store?: ComputerUseStore;
  } = {}) {
    this.crypto = input.crypto ?? hostedComputerUseCrypto;
    this.env = input.env ?? process.env;
    this.kernel = input.kernel ?? null;
    this.navigationDnsLookup = input.navigationDnsLookup ?? defaultNavigationDnsLookup;
    this.now = input.now ?? (() => new Date());
    this.store = input.store ?? new PrismaComputerUseStore();
  }

  async startRun(input: {
    memberId: string;
    resumeAfterMailboxItemId?: string | null;
    resumeDeliveryContext?: HostedComputerDeliveryContext | null;
    resumeRunId: string | null;
    startUrl: string | null;
  }): Promise<ComputerRunHandle> {
    await this.store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    return await this.startRunWithStore(input, this.store);
  }

  private async startRunWithStore(input: {
    memberId: string;
    resumeAfterMailboxItemId?: string | null;
    resumeDeliveryContext?: HostedComputerDeliveryContext | null;
    resumeRunId: string | null;
    startUrl: string | null;
  }, store: ComputerUseStore): Promise<ComputerRunHandle> {
    const now = this.now();
    const startUrl = await this.requirePublicNavigationUrl(input.startUrl);

    if (input.resumeRunId) {
      return await this.resumeAwaitingRunById({
        memberId: input.memberId,
        now,
        resumeAfterMailboxItemId: input.resumeAfterMailboxItemId ?? null,
        resumeDeliveryContext: input.resumeDeliveryContext ?? null,
        runId: input.resumeRunId,
        store,
      });
    }

    let activeRun = await store.findActiveRunForMember({
      memberId: input.memberId,
      now,
    });

    if (activeRun) {
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
          return await this.startRunWithStore(input, store);
        }
      }
      return runHandle(activeRun, true);
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
        startUrl: sanitizeComputerDisplayUrl(startUrl),
      });
      if (!createResult.created) {
        if (isBlockingBrowserlessProvisioningRun(createResult.run)) {
          const recovery = await this.recoverStaleBrowserlessProvisioningRun({
            now,
            run: createResult.run,
            store,
          });
          if (recovery !== "busy") {
            return await this.startRunWithStore(input, store);
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
      await this.installPublicNavigationGuard(browser.sessionId);
      this.assertAllowedLiveViewUrl(browser.liveViewUrl);
      const initialState = startUrl
        ? await this.navigateKernelBrowserToPublicUrl({
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

  async observe(input: {
    memberId: string;
    runId: string;
  }): Promise<ComputerObserveResult> {
    await this.store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    const run = await this.requireRunnableRun(input);
    const state = await this.readBrowserState(run);
    await this.store.updateRunBrowserState({
      expectedKernelSessionId: run.kernelSessionId,
      lastTitle: state.title,
      lastUrl: sanitizeComputerDisplayUrl(state.url),
      runId: run.id,
    });

    return {
      runId: run.id,
      status: "running",
      title: state.title,
      url: state.url,
      visibleText: state.visibleText,
    };
  }

  async act(input: HostedComputerActRequest & {
    memberId: string;
    runId: string;
  }): Promise<{ title: string | null; url: string | null }> {
    await this.store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    const run = await this.requireRunnableRun(input);
    if (input.action === "goto") {
      await this.requirePublicNavigationUrl(input.url);
    }
    const kernel = this.requireKernel();
    const actionDeadline = createComputerActDeadline(input, this.now);
    const sessionId = requireKernelSessionId(run);
    await requireNonSensitiveComputerInputTarget({
      action: input,
      deadline: actionDeadline,
      kernel,
      sessionId,
    });
    const actionKernelTimeoutMs = readComputerActRemainingTimeoutMs(actionDeadline);
    const actionForExecution = limitComputerActRequestTimeout(
      input,
      readComputerActExecutionTimeoutMs(input, actionKernelTimeoutMs),
    );
    const result = await kernel.executePlaywright({
      code: buildComputerActCode(actionForExecution),
      sessionId,
      timeoutMs: actionKernelTimeoutMs,
    });
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
      title: state.title,
      url: state.url,
    };
  }

  async pauseForUser(input: {
    handoffPurpose: HostedComputerHandoffPurpose | null;
    memberId: string;
    message: string;
    pauseDeliveryContext?: HostedComputerDeliveryContext | null;
    reason: HostedComputerAwaitingReason;
    runId: string;
    suggestedReply: string | null;
  }): Promise<ComputerPauseForUserResult> {
    return await this.pauseForUserWithStore(input, this.store);
  }

  private async pauseForUserWithStore(
    input: {
      handoffPurpose: HostedComputerHandoffPurpose | null;
      memberId: string;
      message: string;
      pauseDeliveryContext?: HostedComputerDeliveryContext | null;
      reason: HostedComputerAwaitingReason;
      runId: string;
      suggestedReply: string | null;
    },
    store: ComputerUseStore,
  ): Promise<ComputerPauseForUserResult> {
    await store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    const now = this.now();
    const run = await this.requireFreshRun({
      memberId: input.memberId,
      runId: input.runId,
    }, store);

    if (run.status === "awaiting_user") {
      const refreshed = input.handoffPurpose
        ? await this.refreshAwaitingRunHandoff({
            memberId: input.memberId,
            now,
            pauseDeliveryContext: input.pauseDeliveryContext ?? null,
            run,
            store,
          })
        : null;
      if (refreshed) {
        return refreshed;
      }
      return {
        awaitingReason: run.awaitingReason ?? input.reason,
        handoffUrl: null,
        message: run.awaitingMessage ?? input.message,
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

    await this.captureBrowserStateBestEffort(run);

    const handoff = input.handoffPurpose
      ? await this.createHandoff({
          memberId: input.memberId,
          purpose: input.handoffPurpose,
          runExpiresAt: run.expiresAt,
          runId: run.id,
          suggestedReply: input.suggestedReply,
        }, store)
      : null;
    const message = handoff
      ? `${input.message}\n\n${handoff.handoffUrl}`
      : input.message;
    let paused: ComputerRunRecord;
    try {
      paused = await store.markRunAwaitingUser({
        awaitingMessage: input.message,
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
      message,
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

  private async finishRunWithStore(
    input: {
      memberId: string;
      outcome: HostedComputerFinishOutcome;
      runId: string;
    },
    store: ComputerUseStore,
  ): Promise<{ ok: true; runId: string; status: HostedComputerFinishOutcome }> {
    await store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    const now = this.now();
    let run = await store.requireOwnedRun({
      memberId: input.memberId,
      runId: input.runId,
    });
    if (isFinishOutcomeStatus(run.status)) {
      await this.deleteTerminalRunBrowser(run, now, store);
      return {
        ok: true,
        runId: run.id,
        status: run.status,
      };
    }

    const expectedCompletedHandoffId = await this.preparePendingHandoffForFinish(
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
      input.outcome === "completed" && !expectedCompletedHandoffId
        ? "running"
        : null;
    if (expectedRunStatus && run.status !== expectedRunStatus) {
      throw handoffIncompleteForFinishError();
    }
    const expectedKernelSessionId = run.kernelSessionId;

    const finished = await store.finishRun({
      expectedCompletedHandoffId,
      expectedKernelSessionId,
      expectedRunStatus,
      now,
      outcome: input.outcome,
      runId: run.id,
      terminalBrowserCleanupId: expectedKernelSessionId
        ? null
        : buildKernelBrowserName({ runId: run.id }),
    });
    await this.deleteTerminalRunBrowser(finished, now, store);

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
    await this.store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    const now = this.now();
    const tokenHash = sha256Hex(input.token);
    let handoff = await this.store.requireHandoffByTokenHash({
      tokenHash,
    });

    assertHandoffOwnedByMember(handoff, input.memberId);
    handoff = await this.releaseStaleHandoffClaim({
      handoff,
      now,
      store: this.store,
      tokenHash,
    });

    if (handoff.status === "completed") {
      return {
        kind: "completed",
        suggestedReply: handoff.suggestedReply,
      };
    }

    if (isFreshCheckpointingHandoff(handoff, now)) {
      return {
        kind: "checkpointing",
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
        suggestedReply: expired.suggestedReply,
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

    return {
      handoffId: handoff.id,
      iframeAllow: "autoplay; clipboard-read; clipboard-write",
      kind: "open",
      liveViewUrl,
      purpose: handoff.purpose,
      suggestedReply: handoff.suggestedReply,
    };
  }

  async completeHandoff(input: {
    memberId: string;
    token: string;
  }): Promise<{ suggestedReply: string | null }> {
    await this.store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    return await this.completeHandoffWithStore(input, this.store);
  }

  private async completeHandoffWithStore(input: {
    memberId: string;
    token: string;
  }, store: ComputerUseStore): Promise<{ suggestedReply: string | null }> {
    const now = this.now();
    const tokenHash = sha256Hex(input.token);
    const handoff = await store.requireHandoffByTokenHash({
      tokenHash,
    });

    assertHandoffOwnedByMember(handoff, input.memberId);

    const openHandoff = await this.releaseStaleHandoffClaim({
      handoff,
      now,
      store,
      tokenHash,
    });

    if (openHandoff.status === "completed") {
      return {
        suggestedReply: openHandoff.suggestedReply,
      };
    }

    if (isFreshCheckpointingHandoff(openHandoff, now)) {
      return {
        suggestedReply: openHandoff.suggestedReply,
      };
    }

    if (isExpiredHandoff(openHandoff, now)) {
      if (openHandoff.status === "open" || openHandoff.status === "checkpointing") {
        const expired = await store.markHandoffExpired({
          expectedStatus: openHandoff.status,
          expectedUpdatedAt: openHandoff.updatedAt,
          handoffId: openHandoff.id,
          now,
        });
        return {
          suggestedReply: expired.suggestedReply,
        };
      }
      return {
        suggestedReply: openHandoff.suggestedReply,
      };
    }

    assertOpenFreshHandoff(openHandoff, now);
    const claimed = await store.claimHandoffForCompletion({
      handoffId: openHandoff.id,
      memberId: input.memberId,
    });
    if (!claimed) {
      const latest = await store.requireHandoffByTokenHash({
        tokenHash,
      });
      return {
        suggestedReply: latest.suggestedReply,
      };
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
        return {
          suggestedReply: expired.suggestedReply,
        };
      }

      if (claimed.purpose === "login") {
        await this.checkpointProfileAfterLoginHandoff(
          run,
          now,
          store,
          claimed.updatedAt,
        );
      }
      const completed = await store.completeHandoff({
        expectedUpdatedAt: claimed.updatedAt,
        handoffId: claimed.id,
        now,
      });

      return {
        suggestedReply: completed.suggestedReply,
      };
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
    const profileNames = buildKernelProfileNamesForAccountDeletion(runs);

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
      runId: input.runId,
      suggestedReply: input.suggestedReply,
      tokenHash: sha256Hex(token),
    });

    return {
      handoffUrl: new URL(
        `/computer/handoff/${encodeURIComponent(token)}`,
        `${requireHostedPublicBaseUrl(this.env)}/`,
      ).toString(),
      record,
    };
  }

  private async refreshAwaitingRunHandoff(input: {
    memberId: string;
    now: Date;
    pauseDeliveryContext: HostedComputerDeliveryContext | null;
    run: ComputerRunRecord;
    store: ComputerUseStore;
  }): Promise<ComputerPauseForUserResult | null> {
    if (
      !input.run.pendingHandoffId ||
      !input.run.awaitingMessage ||
      !input.run.awaitingReason
    ) {
      return null;
    }

    if (!input.run.kernelSessionId || input.run.expiresAt <= input.now) {
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

    let existing = await input.store.findHandoffByRun({
      handoffId: input.run.pendingHandoffId,
      runId: input.run.id,
    });
    if (!existing) {
      return null;
    }
    if (
      existing.status === "checkpointing" &&
      !isStaleCheckpointingHandoff(existing, input.now)
    ) {
      return null;
    }

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
      purpose: existing.purpose,
      runExpiresAt: input.run.expiresAt,
      runId: input.run.id,
      suggestedReply: existing.suggestedReply,
    }, input.store);
    try {
      const refreshed = await input.store.replaceAwaitingRunHandoff({
        expectedHandoffUpdatedAt: existing.updatedAt,
        expectedPendingHandoffId: existing.id,
        newPendingHandoffId: handoff.record.id,
        now: input.now,
        runId: input.run.id,
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
        awaitingReason: refreshed.awaitingReason ?? input.run.awaitingReason,
        handoffUrl: handoff.handoffUrl,
        message: `${refreshed.awaitingMessage ?? input.run.awaitingMessage}\n\n${handoff.handoffUrl}`,
        runId: input.run.id,
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

  private async navigateKernelBrowserToPublicUrl(input: {
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

  private async installPublicNavigationGuard(sessionId: string): Promise<void> {
    await this.requireKernel().executePlaywright({
      code: [
        buildPlaywrightPublicNavigationGuardCode(),
        "return true;",
      ].join("\n"),
      sessionId,
      timeoutMs: COMPUTER_NAVIGATION_TIMEOUT_MS,
    });
  }

  private async requirePublicNavigationUrl(
    value: string | null | undefined,
  ): Promise<string | null> {
    const url = requireComputerNavigationUrl(value);
    if (!url) {
      return null;
    }

    const hostname = new URL(url).hostname;
    if (isHostedComputerIpLiteral(hostname)) {
      return url;
    }

    let records: readonly { address: string }[];
    try {
      records = await this.navigationDnsLookup(hostname);
    } catch {
      throw computerUseError({
        code: "HOSTED_COMPUTER_NAVIGATION_URL_NOT_ALLOWED",
        httpStatus: 400,
        message: "Computer navigation hostname could not be verified as public.",
      });
    }

    if (
      records.length === 0 ||
      records.some((record) => !isHostedComputerPublicIpAddress(record.address))
    ) {
      throw computerUseError({
        code: "HOSTED_COMPUTER_NAVIGATION_URL_NOT_ALLOWED",
        httpStatus: 400,
        message: "Computer navigation hostname must resolve only to public addresses.",
      });
    }

    return url;
  }

  private async checkpointProfileAfterLoginHandoff(
    run: ComputerRunRecord,
    now: Date,
    store: ComputerUseStore = this.store,
    expectedHandoffUpdatedAt?: Date,
  ): Promise<void> {
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
    if (run.kernelSessionId) {
      const oldKernelSessionId = run.kernelSessionId;
      if (!await this.deleteBrowserBestEffort(oldKernelSessionId)) {
        throw browserCleanupFailedError();
      }
      await store.clearRunBrowser({
        expectedHandoffUpdatedAt: expectedHandoffUpdatedAt ?? null,
        expectedKernelSessionId: oldKernelSessionId,
        expectedPendingHandoffId: run.pendingHandoffId,
        lastTitle: state.title,
        lastUrl: sanitizeComputerDisplayUrl(state.url),
        now,
        runId: run.id,
      });
    } else {
      await store.updateRunBrowserState({
        expectedKernelSessionId: run.kernelSessionId,
        lastTitle: state.title,
        lastUrl: sanitizeComputerDisplayUrl(state.url),
        runId: run.id,
      });
    }
    const browserName = buildKernelBrowserName({ runId: run.id });
    if (!run.kernelSessionId && !await this.deleteBrowserBestEffort(browserName)) {
      throw browserCleanupFailedError();
    }
    let browser: Awaited<ReturnType<ComputerKernelClient["createBrowser"]>> | null = null;
    let browserDeleteName: string | null = null;
    let replaceAttempt: ReplaceRunBrowserInput | null = null;
    try {
      const createNow = this.now();
      const timeoutSeconds = requireRemainingKernelTimeoutSeconds(run, createNow);
      browserDeleteName = browserName;
      browser = await this.requireKernel().createBrowser({
        browserName,
        profileName: run.kernelProfileName,
        saveChanges: true,
        timeoutSeconds,
      });
      await this.installPublicNavigationGuard(browser.sessionId);
      this.assertAllowedLiveViewUrl(browser.liveViewUrl);
      const replaceInput: ReplaceRunBrowserInput = {
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
      };
      replaceAttempt = replaceInput;
      await store.replaceRunBrowser(replaceInput);
      browser = null;
    } catch (error) {
      if (browser && replaceAttempt && !isMemberSuspendedComputerUseError(error)) {
        const attachedRun = await this.replayAmbiguousRunBrowserReplace({
          replaceInput: replaceAttempt,
          store,
        });
        if (attachedRun === "unknown") {
          browser = null;
          browserDeleteName = null;
        } else if (attachedRun) {
          browser = null;
          return;
        }
      }
      let cleanupFailed = false;
      const cleanupBrowserId = browser?.sessionId ?? browserDeleteName;
      if (cleanupBrowserId && !await this.deleteBrowserBestEffort(cleanupBrowserId)) {
        cleanupFailed = true;
      }
      if (cleanupFailed) {
        throw browserCleanupFailedError();
      }
      throw error;
    }
  }

  private async captureBrowserStateBestEffort(run: ComputerRunRecord): Promise<void> {
    try {
      const state = await this.readBrowserState(run);
      await this.store.updateRunBrowserState({
        expectedKernelSessionId: run.kernelSessionId,
        lastTitle: state.title,
        lastUrl: sanitizeComputerDisplayUrl(state.url),
        runId: run.id,
      });
    } catch {
      // A user checkpoint must remain durable even if the live browser cannot be observed.
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
    const run = await store.requireOwnedRun({
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

    if (run.pendingHandoffId) {
      const pendingHandoff = await store.findHandoffByRun({
        handoffId: run.pendingHandoffId,
        runId: run.id,
      });
      if (pendingHandoff) {
        if (pendingHandoff.status !== "completed") {
          if (
            pendingHandoff.status === "checkpointing" &&
            !isStaleCheckpointingHandoff(pendingHandoff, input.now)
          ) {
            return runHandle(run, true);
          }
          if (
            isExpiredHandoff(pendingHandoff, input.now) ||
            !run.kernelSessionId
          ) {
            if (!run.kernelSessionId) {
              if (await this.expireRunAndDeleteBrowserBestEffort(run, input.now, store) === "failed") {
                throw browserCleanupFailedError();
              }
              throw computerUseConflictError({
                code: "HOSTED_COMPUTER_RUN_EXPIRED",
                message: "Computer run expired.",
              });
            }
            if (
              pendingHandoff.status !== "expired"
            ) {
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
          } else {
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
          message: "Computer run state changed; observe the run before retrying.",
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
      resumeAfterMailboxItemId: input.resumeAfterMailboxItemId,
      resumeDeliveryContext: input.resumeDeliveryContext,
      runCheckpointContext: run.checkpointContext,
      store,
    });
    const resumed = await store.markRunRunning({
      awaitingReason: run.awaitingReason,
      expectedPausedAt: pausedAt,
      expectedPendingHandoffId: run.pendingHandoffId,
      now: input.now,
      runId: run.id,
    });
    return runHandle(resumed, true);
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

    let cleanupRun = run;
    if (!run.kernelSessionId && run.status !== "cleanup_pending") {
      try {
        cleanupRun = await store.markRunCleanupPending({
          expectedHandoffStatus: pendingHandoff?.status ?? null,
          expectedHandoffUpdatedAt: pendingHandoff?.updatedAt ?? null,
          expectedPendingHandoffId: run.pendingHandoffId,
          expectedRunStatus: run.status,
          now,
          runId: run.id,
        });
      } catch (error) {
        if (isStaleRunStateConflict(error)) {
          return "failed";
        }
        throw error;
      }
    }

    await this.closePendingHandoffForExpiry(cleanupRun, now, store, pendingHandoff);
    if (
      !cleanupRun.kernelSessionId &&
      !await this.deleteBrowserBestEffort(buildKernelBrowserName({ runId: cleanupRun.id }))
    ) {
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
        await this.deleteTerminalRunBrowser(expired, now, store);
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
        await this.deleteTerminalRunBrowser(expired, now, store);
        return "cleaned";
      } catch {
        return "failed";
      }
    }
    if (!await this.deleteRunBrowserBestEffort(expired)) {
      return "failed";
    }
    if (expired.kernelSessionId) {
      await store.clearTerminalRunBrowser({
        expectedKernelSessionId: expired.kernelSessionId,
        now,
        runId: expired.id,
      });
    }
    return "expired";
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
  ): Promise<string | null> {
    if (!run.pendingHandoffId) {
      if (outcome === "completed" && run.status === "awaiting_user") {
        throw handoffIncompleteForFinishError();
      }
      return null;
    }

    const handoff = await store.findHandoffByRun({
      handoffId: run.pendingHandoffId,
      runId: run.id,
    });
    if (!handoff) {
      if (outcome === "completed") {
        throw handoffIncompleteForFinishError();
      }
      return null;
    }

    if (outcome === "completed") {
      if (handoff.status !== "completed") {
        throw handoffIncompleteForFinishError();
      }
      return handoff.id;
    }

    if (
      handoff.status === "completed" ||
      handoff.status === "expired"
    ) {
      return null;
    }

    if (
      handoff.status === "checkpointing"
      && !isStaleCheckpointingHandoff(handoff, now)
    ) {
      throw handoffCheckpointingError();
    }

    await store.markHandoffExpired({
      expectedStatus: handoff.status === "checkpointing"
        ? "checkpointing"
        : "open",
      expectedUpdatedAt: handoff.updatedAt,
      handoffId: handoff.id,
      now,
    });
    return null;
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

  private async deleteRunBrowserBestEffort(
    run: ComputerRunRecord,
  ): Promise<boolean> {
    if (!run.kernelSessionId) {
      return true;
    }

    return await this.deleteBrowserBestEffort(run.kernelSessionId);
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
    if (isAllowedComputerLiveViewUrl({ url })) {
      return;
    }

    throw computerUseError({
      code: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
      httpStatus: 502,
      message: "Kernel live-view URL is not allowed.",
      retryable: true,
    });
  }
}

export function createComputerUseService(): ComputerUseService {
  return new ComputerUseService();
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

  return (!input.expected.conversationId ||
      input.expected.conversationId === received.conversationId) &&
    (!input.expected.recipientKey ||
      input.expected.recipientKey === received.recipientKey);
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function buildComputerActCode(input: HostedComputerActRequest): string {
  return [
    ...buildComputerActActionCode(input),
    buildComputerActionStateReturnCode(),
  ].join("\n");
}

async function requireNonSensitiveComputerInputTarget(input: {
  action: HostedComputerActRequest;
  deadline: ComputerActDeadline;
  kernel: ComputerKernelClient;
  sessionId: string;
}): Promise<void> {
  if (
    input.action.action !== "fill" &&
    input.action.action !== "type" &&
    input.action.action !== "select"
  ) {
    return;
  }

  const requestTimeoutMs = readComputerActRemainingTimeoutMs(input.deadline);
  const locatorTimeoutMs = Math.min(
    input.action.timeoutMs,
    readComputerActActionTimeoutMs(requestTimeoutMs),
  );
  const result = await input.kernel.executePlaywright({
    code: buildComputerSensitiveInputProbeCode(input.action.locator, locatorTimeoutMs),
    sessionId: input.sessionId,
    timeoutMs: requestTimeoutMs,
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

type ComputerActDeadline = {
  deadlineMs: number;
  nowMs: () => number;
};

function createComputerActDeadline(
  input: HostedComputerActRequest,
  now: () => Date,
): ComputerActDeadline {
  return {
    deadlineMs: now().getTime() + computerActExecutionTimeoutMs(input),
    nowMs: () => now().getTime(),
  };
}

function readComputerActRemainingTimeoutMs(deadline: ComputerActDeadline): number {
  const remainingMs = Math.floor(deadline.deadlineMs - deadline.nowMs());
  if (remainingMs <= 0) {
    throw computerUseError({
      code: "HOSTED_COMPUTER_ACTION_TIMEOUT",
      httpStatus: 504,
      message: "Computer action timed out before it could complete.",
      retryable: true,
    });
  }

  return remainingMs;
}

function readComputerActActionTimeoutMs(kernelTimeoutMs: number): number {
  const actionTimeoutMs = kernelTimeoutMs - COMPUTER_ACT_RESULT_MARGIN_MS;
  if (actionTimeoutMs <= 0) {
    throw computerUseError({
      code: "HOSTED_COMPUTER_ACTION_TIMEOUT",
      httpStatus: 504,
      message: "Computer action timed out before it could complete.",
      retryable: true,
    });
  }

  return actionTimeoutMs;
}

function readComputerActExecutionTimeoutMs(
  input: HostedComputerActRequest,
  kernelTimeoutMs: number,
): number {
  if (input.action === "wait") {
    return Math.max(0, kernelTimeoutMs - COMPUTER_ACT_RESULT_MARGIN_MS);
  }

  return readComputerActActionTimeoutMs(kernelTimeoutMs);
}

function limitComputerActRequestTimeout(
  input: HostedComputerActRequest,
  timeoutMs: number,
): HostedComputerActRequest {
  switch (input.action) {
    case "wait":
      return {
        ...input,
        ms: Math.min(input.ms, timeoutMs),
      };
    case "goto":
    case "click":
    case "fill":
    case "type":
    case "select":
    case "check":
    case "uncheck":
    case "press":
    case "scroll":
    case "waitFor":
      return {
        ...input,
        timeoutMs: Math.min(input.timeoutMs, timeoutMs),
      };
  }
}

function computerActExecutionTimeoutMs(input: HostedComputerActRequest): number {
  const actionTimeoutMs = input.action === "wait" ? input.ms : input.timeoutMs;
  return actionTimeoutMs + COMPUTER_ACT_RESULT_MARGIN_MS;
}

function requireComputerNavigationUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isHostedComputerNavigationUrl(value)) {
    throw computerUseError({
      code: "HOSTED_COMPUTER_NAVIGATION_URL_NOT_ALLOWED",
      httpStatus: 400,
      message: "Computer navigation URLs must use public http or https hosts.",
    });
  }
  return value;
}

function buildComputerNavigationCode(input: {
  timeoutMs: number;
  url: string;
}): string {
  return [
    buildPlaywrightPublicNavigationGuardCode(),
    `await page.goto(${JSON.stringify(input.url)}, { waitUntil: 'domcontentloaded', timeout: ${input.timeoutMs} });`,
    "const finalUrl = page.url();",
    "if (!(await isMurphPublicNavigationUrl(finalUrl))) {",
    "  await page.goto('about:blank').catch(() => {});",
    "  throw new Error('Unsafe computer navigation target.');",
    "}",
    "const title = await page.title().catch(() => null);",
    "let visibleText = '';",
    "try { visibleText = await page.locator('body').innerText({ timeout: 5000 }); } catch {}",
    `if (visibleText.length > ${COMPUTER_OBSERVE_TEXT_LIMIT}) visibleText = visibleText.slice(0, ${COMPUTER_OBSERVE_TEXT_LIMIT});`,
    "return { url: finalUrl, title, visibleText };",
  ].join("\n");
}

function buildComputerActActionCode(action: HostedComputerActRequest): string[] {
  switch (action.action) {
    case "goto":
      return buildComputerGotoActionCode(action.url, action.timeoutMs);
    case "click":
      return [
        `await ${buildComputerLocatorExpression(action.locator)}.click({ timeout: ${action.timeoutMs} });`,
      ];
    case "fill":
      return [
        `await ${buildComputerLocatorExpression(action.locator)}.fill(${JSON.stringify(action.value)}, { timeout: ${action.timeoutMs} });`,
      ];
    case "type":
      return [
        `await ${buildComputerLocatorExpression(action.locator)}.pressSequentially(${JSON.stringify(action.text)}, { delay: ${action.delayMs}, timeout: ${action.timeoutMs} });`,
      ];
    case "select":
      return [
        `await ${buildComputerLocatorExpression(action.locator)}.selectOption(${JSON.stringify(action.value)}, { timeout: ${action.timeoutMs} });`,
      ];
    case "check":
      return [
        `await ${buildComputerLocatorExpression(action.locator)}.check({ timeout: ${action.timeoutMs} });`,
      ];
    case "uncheck":
      return [
        `await ${buildComputerLocatorExpression(action.locator)}.uncheck({ timeout: ${action.timeoutMs} });`,
      ];
    case "press": {
      if (action.locator) {
        return [
          `await ${buildComputerLocatorExpression(action.locator)}.press(${JSON.stringify(action.key)}, { timeout: ${action.timeoutMs} });`,
        ];
      }
      return [
        `await page.keyboard.press(${JSON.stringify(action.key)});`,
      ];
    }
    case "scroll": {
      const lines: string[] = [];
      if (action.locator) {
        lines.push(
          `await ${buildComputerLocatorExpression(action.locator)}.scrollIntoViewIfNeeded({ timeout: ${action.timeoutMs} });`,
        );
      }
      lines.push(`await page.mouse.wheel(${action.deltaX}, ${action.deltaY});`);
      return lines;
    }
    case "wait":
      return [`await page.waitForTimeout(${action.ms});`];
    case "waitFor":
      return [
        `await ${buildComputerLocatorExpression(action.locator)}.waitFor({ state: ${JSON.stringify(action.state)}, timeout: ${action.timeoutMs} });`,
      ];
  }
}

function buildComputerGotoActionCode(url: string, timeoutMs: number): string[] {
  return [
    `await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: ${timeoutMs} });`,
  ];
}

function buildComputerSensitiveInputProbeCode(
  locator: HostedComputerActLocator,
  timeoutMs: number,
): string {
  const locatorHints = readComputerLocatorSensitiveHints(locator);
  return [
    `const target = ${buildComputerLocatorExpression(locator)};`,
    `await target.waitFor({ state: 'attached', timeout: ${timeoutMs} });`,
    `const locatorHints = ${JSON.stringify(locatorHints)}.map((value) => String(value || "").toLowerCase());`,
    `const attr = async (name) => String(await target.getAttribute(name, { timeout: 1000 }).catch(() => "") || "").toLowerCase();`,
    `const type = await attr("type");`,
    `const inputMode = await attr("inputmode");`,
    `const maxLengthRaw = await attr("maxlength");`,
    `const maxLength = maxLengthRaw ? Number(maxLengthRaw) : -1;`,
    `const autocompleteTokens = (await attr("autocomplete")).split(/\\s+/u).filter(Boolean);`,
    `if (type === "password") return { sensitive: true, reason: "password_type" };
  const lower = (value) => String(value || "").toLowerCase();
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
    ...locatorHints.map(lower),
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
  if (sensitivePatterns.some((pattern) => pattern.test(hints))) {
    return { sensitive: true, reason: "sensitive_hint" };
  }
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
`,
  ].join("\n");
}

function readComputerLocatorSensitiveHints(locator: HostedComputerActLocator): string[] {
  switch (locator.by) {
    case "role":
      return uniqueStrings([locator.role, locator.name]);
    case "testId":
      return uniqueStrings([locator.testId]);
    case "altText":
    case "label":
    case "placeholder":
    case "text":
    case "title":
      return uniqueStrings([locator.text]);
  }
}

function buildComputerLocatorExpression(locator: HostedComputerActLocator): string {
  switch (locator.by) {
    case "role":
      return `page.getByRole(${JSON.stringify(locator.role)}, ${JSON.stringify({
        ...(locator.name ? { name: locator.name } : {}),
        exact: locator.exact,
      })})`;
    case "label":
      return buildComputerTextLocatorExpression("getByLabel", locator.text, locator.exact);
    case "placeholder":
      return buildComputerTextLocatorExpression("getByPlaceholder", locator.text, locator.exact);
    case "text":
      return buildComputerTextLocatorExpression("getByText", locator.text, locator.exact);
    case "altText":
      return buildComputerTextLocatorExpression("getByAltText", locator.text, locator.exact);
    case "title":
      return buildComputerTextLocatorExpression("getByTitle", locator.text, locator.exact);
    case "testId":
      return `page.getByTestId(${JSON.stringify(locator.testId)})`;
  }
}

function buildComputerTextLocatorExpression(
  method: "getByAltText" | "getByLabel" | "getByPlaceholder" | "getByText" | "getByTitle",
  text: string,
  exact: boolean,
): string {
  return `page.${method}(${JSON.stringify(text)}, ${JSON.stringify({ exact })})`;
}

function buildComputerActionStateReturnCode(): string {
  return [
    "const title = await page.title().catch(() => null);",
    "const url = page.url();",
    "return { url, title };",
  ].join("\n");
}

function buildPlaywrightPublicNavigationGuardCode(): string {
  return `
const normalizeMurphNavigationHostname = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/^\\[/u, "")
  .replace(/\\]$/u, "")
  .replace(/\\.$/u, "");
const readMurphNavigationIpv4 = (value) => {
  const parts = String(value).split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => /^\\d{1,3}$/u.test(part) ? Number(part) : NaN);
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? octets
    : null;
};
const isMurphPublicIpv4 = ([a, b]) =>
  !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0));
const isMurphPublicIpv6 = (value) => {
  const normalized = String(value).toLowerCase();
  return !(normalized.startsWith("::") ||
    normalized.startsWith("64:ff9b:") ||
    normalized.startsWith("100:") ||
    normalized.startsWith("2001:0:") ||
    normalized.startsWith("2001:2:") ||
    normalized.startsWith("2002:") ||
    normalized.startsWith("fc") || normalized.startsWith("fd") ||
    /^fe[89ab][0-9a-f]?:/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")) &&
    /^[0-9a-f:.]+$/u.test(normalized);
};
const readMurphMappedIpv4 = (hostname) =>
  hostname.match(/(?:::ffff:|:)(\\d{1,3}(?:\\.\\d{1,3}){3})$/iu)?.[1] ?? null;
const isMurphIpLiteral = (hostname) =>
  Boolean(readMurphNavigationIpv4(hostname) || readMurphMappedIpv4(hostname)) ||
  hostname.includes(":");
const isMurphPublicIpAddress = (value) => {
  const hostname = normalizeMurphNavigationHostname(value);
  const ipv4 = readMurphNavigationIpv4(readMurphMappedIpv4(hostname) || hostname);
  if (ipv4) return isMurphPublicIpv4(ipv4);
  return hostname.includes(":") && isMurphPublicIpv6(hostname);
};
const isMurphPublicNavigationHostStatic = (value) => {
  const hostname = normalizeMurphNavigationHostname(value);
  if (!hostname) return false;
  if (isMurphIpLiteral(hostname)) return isMurphPublicIpAddress(hostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
  return hostname.includes(".");
};
let murphDnsLookup = null;
try {
  murphDnsLookup = (await import("node:dns/promises")).lookup;
} catch {}
const doesMurphHostnameResolvePublicly = async (hostname) => {
  if (!murphDnsLookup) return false;
  const records = await murphDnsLookup(hostname, { all: true, verbatim: true }).catch(() => null);
  return Array.isArray(records) && records.length > 0 &&
    records.every((record) => record && isMurphPublicIpAddress(record.address));
};
const isMurphPublicNavigationUrl = async (value) => {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") ||
      !isMurphPublicNavigationHostStatic(url.hostname)) {
      return false;
    }
    const hostname = normalizeMurphNavigationHostname(url.hostname);
    return isMurphIpLiteral(hostname) || await doesMurphHostnameResolvePublicly(hostname);
  } catch {
    return false;
  }
};
await page.context().unroute("**/*").catch(() => {});
await page.context().route("**/*", async (route) => {
  if (!(await isMurphPublicNavigationUrl(route.request().url()))) {
    await route.abort("blockedbyclient").catch(() => {});
    return;
  }
  await route.continue().catch(() => {});
});
`.trim();
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
  title: string | null;
  url: string | null;
} {
  const state = readOptionalBrowserStateResult(value);
  if (!state?.url || !sanitizeComputerDisplayUrl(state.url)) {
    throw computerUseError({
      code: "HOSTED_COMPUTER_ACTION_STATE_INVALID",
      httpStatus: 502,
      message: "Computer action finished with an invalid browser state result.",
      retryable: true,
    });
  }

  return state;
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
  return run.status === "cleanup_pending" ||
    (run.status === "running" && !run.kernelSessionId);
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

async function defaultNavigationDnsLookup(
  hostname: string,
): Promise<readonly { address: string }[]> {
  return await lookupDns(hostname, {
    all: true,
    verbatim: true,
  });
}

function normalizeKernelNameSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalized.length > 0 ? normalized.slice(0, 80) : "default";
}
