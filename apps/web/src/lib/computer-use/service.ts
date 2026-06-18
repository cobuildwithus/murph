import type {
  HostedComputerActRequest,
  HostedComputerAwaitingReason,
  HostedComputerDeliveryContext,
  HostedComputerFinishOutcome,
  HostedComputerHandoffPurpose,
  HostedComputerProfileKey,
} from "@murphai/hosted-execution/computer-use";

import { readHostedPublicBaseUrl } from "../hosted-web/public-url";
import { computerUseConflictError, computerUseError, computerUseNotFoundError } from "./errors";
import {
  hostedComputerUseCrypto,
  type ComputerUseCrypto,
  type ComputerRunSecretField,
} from "./crypto";
import { createComputerHandoffToken, createComputerId, sha256Hex, shortHash } from "./ids";
import {
  isAllowedComputerLiveViewUrl,
  readConfiguredComputerLiveViewOrigins,
} from "./live-view-origin";
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
const COMPUTER_HANDOFF_CHECKPOINTING_STALE_MS = 2 * 60 * 1000;
const COMPUTER_OBSERVE_TEXT_LIMIT = 12_000;
const COMPUTER_OBSERVE_TIMEOUT_MS = 15_000;

type EnvSource = Readonly<Record<string, string | undefined>>;

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
  private readonly now: () => Date;
  private readonly store: ComputerUseStore;

  constructor(input: {
    crypto?: ComputerUseCrypto;
    env?: EnvSource;
    kernel?: ComputerKernelClient;
    now?: () => Date;
    store?: ComputerUseStore;
  } = {}) {
    this.crypto = input.crypto ?? hostedComputerUseCrypto;
    this.env = input.env ?? process.env;
    this.kernel = input.kernel ?? null;
    this.now = input.now ?? (() => new Date());
    this.store = input.store ?? new PrismaComputerUseStore();
  }

  async startRun(input: {
    goal: string;
    memberId: string;
    profileKey: HostedComputerProfileKey;
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
    goal: string;
    memberId: string;
    profileKey: HostedComputerProfileKey;
    resumeAfterMailboxItemId?: string | null;
    resumeDeliveryContext?: HostedComputerDeliveryContext | null;
    resumeRunId: string | null;
    startUrl: string | null;
  }, store: ComputerUseStore): Promise<ComputerRunHandle> {
    const now = this.now();
    const profile = await store.upsertProfile({
      kernelProfileName: buildKernelProfileName({
        env: this.env,
        memberId: input.memberId,
        profileKey: input.profileKey,
      }),
      memberId: input.memberId,
      profileKey: input.profileKey,
    });
    await this.expireStaleActiveRunsForProfile({
      memberId: input.memberId,
      now,
      profileId: profile.id,
      store,
    });
    const activeRun = await store.findActiveRunForProfile({
      memberId: input.memberId,
      now,
      profileId: profile.id,
    });

    if (input.resumeRunId) {
      return await this.resumeAwaitingRunById({
        memberId: input.memberId,
        now,
        profileId: profile.id,
        resumeAfterMailboxItemId: input.resumeAfterMailboxItemId ?? null,
        resumeDeliveryContext: input.resumeDeliveryContext ?? null,
        runId: input.resumeRunId,
        store,
      });
    }

    if (activeRun) {
      return runHandle(activeRun, true);
    }

    const runId = createComputerId("hcr");
    let browser: Awaited<ReturnType<ComputerKernelClient["createBrowser"]>> | null = null;
    try {
      const kernel = this.requireKernel();
      this.requireConfiguredLiveViewOrigins();
      await kernel.ensureProfile(profile.kernelProfileName);
      browser = await kernel.createBrowser({
        profileName: profile.kernelProfileName,
        saveChanges: true,
        startUrl: input.startUrl,
      });
      this.assertAllowedLiveViewUrl(browser.liveViewUrl);
      await store.requireMemberComputerUseAvailable({
        memberId: input.memberId,
      });
      const createResult = await store.createRun({
        expiresAt: new Date(now.getTime() + COMPUTER_RUN_TTL_MS),
        goal: input.goal,
        id: runId,
        kernelLiveViewUrlEncrypted: await this.encryptRequiredRunSecret({
          field: "kernel-live-view-url",
          memberId: input.memberId,
          runId,
          value: browser.liveViewUrl,
        }),
        kernelSessionId: browser.sessionId,
        memberId: input.memberId,
        now,
        profileId: profile.id,
        startUrl: input.startUrl,
      });
      if (!createResult.created) {
        const cleanupRun = createResult.cleanupRun;
        if (!cleanupRun) {
          const deleted = await this.deleteBrowserBestEffort(browser.sessionId);
          browser = null;
          if (!deleted) {
            throw browserCleanupFailedError();
          }
          return runHandle(createResult.run, true);
        }
        browser = null;
        if (!await this.expireRunAndDeleteBrowserBestEffort(cleanupRun, now, store)) {
          throw browserCleanupFailedError();
        }
        return runHandle(createResult.run, true);
      }
      return runHandle(createResult.run, false);
    } catch (error) {
      if (browser) {
        if (!await this.deleteBrowserBestEffort(browser.sessionId)) {
          throw browserCleanupFailedError();
        }
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
      lastTitle: state.title,
      lastUrl: state.url,
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
  }): Promise<{ result: unknown; title: string | null; url: string | null }> {
    await this.store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    const run = await this.requireRunnableRun(input);
    const result = await this.requireKernel().executePlaywright({
      code: buildComputerActCode(input),
      sessionId: requireKernelSessionId(run),
      timeoutMs: input.timeoutMs,
    });
    const state = readBrowserStateResult(result.result);
    await this.store.updateRunBrowserState({
      lastTitle: state.title,
      lastUrl: state.url,
      runId: run.id,
    });

    return {
      result: result.result,
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
    await this.store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    const now = this.now();
    const run = await this.requireFreshRun({
      memberId: input.memberId,
      runId: input.runId,
    });

    if (run.status === "awaiting_user") {
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

    if (
      input.reason === "final_confirmation" &&
      input.handoffPurpose !== "manual_browser_help"
    ) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_FINAL_CONFIRMATION_REQUIRES_HANDOFF",
        message: "Final confirmation requires a manual browser handoff.",
      });
    }

    await this.captureBrowserStateBestEffort(run);

    const handoff = input.handoffPurpose
      ? await this.createHandoff({
          memberId: input.memberId,
          purpose: input.handoffPurpose,
          runId: run.id,
          suggestedReply: input.suggestedReply,
        })
      : null;
    const message = handoff
      ? `${input.message}\n\n${handoff.handoffUrl}`
      : input.message;
    let paused: ComputerRunRecord;
    try {
      paused = await this.store.markRunAwaitingUser({
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
        await this.store.markHandoffExpired({
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
    summary: string | null;
  }): Promise<{ ok: true; runId: string; status: HostedComputerFinishOutcome }> {
    await this.store.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    const now = this.now();
    let run = await this.store.requireOwnedRun({
      memberId: input.memberId,
      runId: input.runId,
    });

    await this.closePendingHandoffForFinish(run, now);
    run = await this.store.requireOwnedRun({
      memberId: input.memberId,
      runId: input.runId,
    });
    const expectedKernelSessionId = run.kernelSessionId;

    if (run.kernelSessionId) {
      try {
        await this.requireKernel().deleteBrowser(run.kernelSessionId);
      } catch {
        throw browserCleanupFailedError();
      }
    }

    await this.store.finishRun({
      expectedKernelSessionId,
      now,
      outcome: input.outcome,
      runId: run.id,
      summary: input.summary,
    });

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
    const handoff = await this.store.requireHandoffByTokenHash({
      tokenHash: sha256Hex(input.token),
    });

    assertHandoffOwnedByMember(handoff, input.memberId);

    if (handoff.status === "completed") {
      return {
        kind: "completed",
        suggestedReply: handoff.suggestedReply,
      };
    }

    if (isFreshCheckpointingHandoff(handoff, now)) {
      return {
        kind: "completed",
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
      await this.expireRunForExpiredHandoff(expired, now);
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

    await this.store.markHandoffOpened({
      handoffId: handoff.id,
      now,
    });

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
    const handoff = await store.requireHandoffByTokenHash({
      tokenHash: sha256Hex(input.token),
    });

    assertHandoffOwnedByMember(handoff, input.memberId);

    if (handoff.status === "completed") {
      return {
        suggestedReply: handoff.suggestedReply,
      };
    }

    if (isFreshCheckpointingHandoff(handoff, now)) {
      return {
        suggestedReply: handoff.suggestedReply,
      };
    }

    if (isExpiredHandoff(handoff, now)) {
      if (handoff.status === "open" || handoff.status === "checkpointing") {
        const expired = await store.markHandoffExpired({
          expectedStatus: handoff.status,
          expectedUpdatedAt: handoff.updatedAt,
          handoffId: handoff.id,
          now,
        });
        await this.expireRunForExpiredHandoff(expired, now, store);
        return {
          suggestedReply: expired.suggestedReply,
        };
      }
      return {
        suggestedReply: handoff.suggestedReply,
      };
    }

    let openHandoff = handoff;
    if (openHandoff.status === "checkpointing") {
      if (!isStaleCheckpointingHandoff(openHandoff, now)) {
        return {
          suggestedReply: openHandoff.suggestedReply,
        };
      }
      await store.releaseHandoffClaim({
        handoffId: openHandoff.id,
      });
      openHandoff = await store.requireHandoffByTokenHash({
        tokenHash: sha256Hex(input.token),
      });
      if (openHandoff.status !== "open") {
        return {
          suggestedReply: openHandoff.suggestedReply,
        };
      }
    }

    assertOpenFreshHandoff(openHandoff, now);
    const claimed = await store.claimHandoffForCompletion({
      handoffId: openHandoff.id,
    });
    if (!claimed) {
      const latest = await store.requireHandoffByTokenHash({
        tokenHash: sha256Hex(input.token),
      });
      return {
        suggestedReply: latest.suggestedReply,
      };
    }

    try {
      const run = await store.requireOwnedRun({
        memberId: input.memberId,
        runId: claimed.runId,
      });
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
        await this.checkpointProfileAfterLoginHandoff(run, now, store);
      }
      const completed = await store.completeHandoff({
        handoffId: claimed.id,
        now,
      });

      return {
        suggestedReply: completed.suggestedReply,
      };
    } catch (error) {
      await store.releaseHandoffClaim({
        handoffId: claimed.id,
      }).catch(() => {
        // The original checkpoint failure should stay visible to the caller.
      });
      throw error;
    }
  }

  async cleanupExpiredRuns(input: {
    now?: Date;
  } = {}): Promise<ComputerExpiredRunCleanupResult> {
    const now = input.now ?? this.now();
    const staleRuns = await this.store.listStaleActiveRuns({ now });
    let expiredRuns = 0;
    for (const run of staleRuns) {
      if (await this.expireRunAndDeleteBrowserForCleanup(run, now)) {
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
    const [runs, profiles] = await Promise.all([
      this.store.listMemberRuns({ memberId: input.memberId }),
      this.store.listMemberProfiles({ memberId: input.memberId }),
    ]);
    const sessionIds = uniqueStrings(runs.map((run) => run.kernelSessionId));
    const profileNames = uniqueStrings(
      profiles.map((profile) => profile.kernelProfileName),
    );

    if (sessionIds.length === 0 && profileNames.length === 0) {
      return {
        browserSessionsDeleted: 0,
        profilesDeleted: 0,
      };
    }

    const kernel = this.requireKernel();
    for (const sessionId of sessionIds) {
      await kernel.deleteBrowser(sessionId);
    }
    for (const profileName of profileNames) {
      await kernel.deleteProfile(profileName);
    }

    return {
      browserSessionsDeleted: sessionIds.length,
      profilesDeleted: profileNames.length,
    };
  }

  private async createHandoff(input: {
    memberId: string;
    purpose: HostedComputerHandoffPurpose;
    runId: string;
    suggestedReply: string | null;
  }): Promise<{ handoffUrl: string; record: ComputerHandoffRecord }> {
    const token = createComputerHandoffToken();
    const record = await this.store.createHandoff({
      expiresAt: new Date(this.now().getTime() + COMPUTER_HANDOFF_TTL_MS),
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
  }): Promise<ComputerRunRecord> {
    const now = this.now();
    const run = await this.store.requireOwnedRun(input);

    if (run.expiresAt <= now && (run.status === "running" || run.status === "awaiting_user")) {
      const expired = await this.expireRunAndDeleteBrowserBestEffort(run, now);
      if (!expired) {
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

  private async checkpointProfileAfterLoginHandoff(
    run: ComputerRunRecord,
    now: Date,
    store: ComputerUseStore = this.store,
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
    await store.updateRunBrowserState({
      lastTitle: state.title,
      lastUrl: state.url,
      runId: run.id,
    });

    if (run.kernelSessionId) {
      await this.requireKernel().deleteBrowser(run.kernelSessionId);
      await store.clearRunBrowser({
        expectedKernelSessionId: run.kernelSessionId,
        expectedPendingHandoffId: run.pendingHandoffId,
        now,
        runId: run.id,
      });
    }
    await store.markProfileCheckpointed({
      authenticated: true,
      now,
      profileId: run.profileId,
    });

    const profile = await store.requireOwnedProfile(run.profileId);
    this.requireConfiguredLiveViewOrigins();
    const browser = await this.requireKernel().createBrowser({
      profileName: profile.kernelProfileName,
      saveChanges: true,
      startUrl: state.url ?? run.lastUrl,
    });
    try {
      this.assertAllowedLiveViewUrl(browser.liveViewUrl);
      await store.replaceRunBrowser({
        expectedPendingHandoffId: run.pendingHandoffId,
        kernelLiveViewUrlEncrypted: await this.encryptRequiredRunSecret({
          field: "kernel-live-view-url",
          memberId: run.memberId,
          runId: run.id,
          value: browser.liveViewUrl,
        }),
        kernelSessionId: browser.sessionId,
        now,
        runId: run.id,
      });
    } catch (error) {
      await this.deleteBrowserBestEffort(browser.sessionId);
      throw error;
    }
  }

  private async captureBrowserStateBestEffort(run: ComputerRunRecord): Promise<void> {
    try {
      const state = await this.readBrowserState(run);
      await this.store.updateRunBrowserState({
        lastTitle: state.title,
        lastUrl: state.url,
        runId: run.id,
      });
    } catch {
      // A user checkpoint must remain durable even if the live browser cannot be observed.
    }
  }

  private async resumeAwaitingRunById(input: {
    memberId: string;
    now: Date;
    profileId: string;
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

    if (run.profileId !== input.profileId) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_PROFILE_MISMATCH",
        message: "Computer run belongs to a different browser profile.",
      });
    }

    if (run.expiresAt <= input.now && (run.status === "running" || run.status === "awaiting_user")) {
      if (!await this.expireRunAndDeleteBrowserBestEffort(run, input.now, store)) {
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

    if (run.awaitingReason === "final_confirmation") {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_FINAL_CONFIRMATION_REQUIRES_HANDOFF",
        message: "Final confirmation runs cannot resume automated browser actions.",
      });
    }

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
            pendingHandoff.status === "revoked" ||
            !run.kernelSessionId
          ) {
            const expired = pendingHandoff.status === "expired" ||
              pendingHandoff.status === "revoked"
              ? pendingHandoff
              : await store.markHandoffExpired({
                  expectedStatus: pendingHandoff.status === "checkpointing"
                    ? "checkpointing"
                    : "open",
                  expectedUpdatedAt: pendingHandoff.updatedAt,
                  handoffId: pendingHandoff.id,
                  now: input.now,
                });
            await this.expireRunForExpiredHandoff(expired, input.now, store);
            throw computerUseConflictError({
              code: "HOSTED_COMPUTER_HANDOFF_EXPIRED",
              message: "Computer handoff expired.",
            });
          }
          if (isStaleCheckpointingHandoff(pendingHandoff, input.now)) {
            const expired = await store.markHandoffExpired({
              expectedStatus: "checkpointing",
              expectedUpdatedAt: pendingHandoff.updatedAt,
              handoffId: pendingHandoff.id,
              now: input.now,
            });
            await this.expireRunForExpiredHandoff(expired, input.now, store);
            throw computerUseConflictError({
              code: "HOSTED_COMPUTER_HANDOFF_EXPIRED",
              message: "Computer handoff expired.",
            });
          } else {
            return runHandle(run, true);
          }
        }
      } else if (!run.kernelSessionId) {
        if (!await this.expireRunAndDeleteBrowserBestEffort(run, input.now, store)) {
          throw browserCleanupFailedError();
        }
        throw computerUseConflictError({
          code: "HOSTED_COMPUTER_RUN_EXPIRED",
          message: "Computer run expired.",
        });
      }
    } else if (!run.kernelSessionId) {
      if (!await this.expireRunAndDeleteBrowserBestEffort(run, input.now, store)) {
        throw browserCleanupFailedError();
      }
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_EXPIRED",
        message: "Computer run expired.",
      });
    }

    await this.requireResumeMailboxItemAfterPause({
      memberId: input.memberId,
      pausedAt: run.pausedAt,
      resumeAfterMailboxItemId: input.resumeAfterMailboxItemId,
      resumeDeliveryContext: input.resumeDeliveryContext,
      runCheckpointContext: run.checkpointContext,
      store,
    });
    const resumed = await store.markRunRunning({
      awaitingReason: run.awaitingReason,
      now: input.now,
      runId: run.id,
    });
    return runHandle(resumed, true);
  }

  private async expireStaleActiveRunsForProfile(input: {
    memberId: string;
    now: Date;
    profileId: string;
    store?: ComputerUseStore;
  }): Promise<void> {
    const store = input.store ?? this.store;
    const staleRuns = await store.listStaleActiveRunsForProfile(input);
    for (const run of staleRuns) {
      if (!await this.expireRunAndDeleteBrowserBestEffort(run, input.now, store)) {
        throw browserCleanupFailedError();
      }
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

  private async expireRunForExpiredHandoff(
    handoff: ComputerHandoffRecord,
    now: Date,
    store: ComputerUseStore = this.store,
  ): Promise<void> {
    const run = await store.requireOwnedRun({
      memberId: handoff.memberId,
      runId: handoff.runId,
    }).catch(() => null);

    if (
      !run ||
      run.pendingHandoffId !== handoff.id ||
      run.status !== "awaiting_user"
    ) {
      return;
    }

    if (!await this.expireRunAndDeleteBrowserBestEffort(run, now, store)) {
      throw browserCleanupFailedError();
    }
  }

  private async expireRunAndDeleteBrowserBestEffort(
    run: ComputerRunRecord,
    now: Date,
    store: ComputerUseStore = this.store,
  ): Promise<boolean> {
    await this.closePendingHandoffForExpiry(run, now, store);
    if (!await this.deleteRunBrowserBestEffort(run)) {
      return false;
    }
    const expired = await store.markRunExpired({
      expectedKernelSessionId: run.kernelSessionId,
      now,
      runId: run.id,
    });
    return expired.status === "expired";
  }

  private async expireRunAndDeleteBrowserForCleanup(
    run: ComputerRunRecord,
    now: Date,
  ): Promise<boolean> {
    try {
      return await this.expireRunAndDeleteBrowserBestEffort(run, now);
    } catch (error) {
      if (isComputerHandoffCheckpointingError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async closePendingHandoffForFinish(
    run: ComputerRunRecord,
    now: Date,
    store: ComputerUseStore = this.store,
  ): Promise<void> {
    if (!run.pendingHandoffId) {
      return;
    }

    const openHandoff = await store.findOpenHandoffByRun({
      handoffId: run.pendingHandoffId,
      runId: run.id,
    });
    if (!openHandoff) {
      return;
    }

    if (
      openHandoff.status === "checkpointing"
      && !isStaleCheckpointingHandoff(openHandoff, now)
    ) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING",
        message: "Computer handoff is checkpointing.",
        retryable: true,
      });
    }

    await store.markHandoffExpired({
      expectedStatus: openHandoff.status === "checkpointing"
        ? "checkpointing"
        : "open",
      expectedUpdatedAt: openHandoff.updatedAt,
      handoffId: openHandoff.id,
      now,
    });
  }

  private async closePendingHandoffForExpiry(
    run: ComputerRunRecord,
    now: Date,
    store: ComputerUseStore = this.store,
  ): Promise<void> {
    if (!run.pendingHandoffId) {
      return;
    }

    const handoff = await store.findHandoffByRun({
      handoffId: run.pendingHandoffId,
      runId: run.id,
    });
    if (!handoff || handoff.status === "completed" || handoff.status === "expired" || handoff.status === "revoked") {
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

  private async deleteRunBrowserBestEffort(
    run: ComputerRunRecord,
  ): Promise<boolean> {
    if (!run.kernelSessionId) {
      return true;
    }

    return await this.deleteBrowserBestEffort(run.kernelSessionId);
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

  private async deleteBrowserBestEffort(sessionId: string): Promise<boolean> {
    try {
      await this.requireKernel().deleteBrowser(sessionId);
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

  private requireConfiguredLiveViewOrigins(): void {
    if (readConfiguredComputerLiveViewOrigins(this.env).length > 0) {
      return;
    }

    throw computerUseError({
      code: "HOSTED_COMPUTER_LIVE_VIEW_ORIGINS_MISSING",
      httpStatus: 503,
      message: "Computer live-view origins are not configured.",
      retryable: true,
    });
  }

  private assertAllowedLiveViewUrl(url: string): void {
    if (isAllowedComputerLiveViewUrl({ env: this.env, url })) {
      return;
    }

    throw computerUseError({
      code: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
      httpStatus: 502,
      message: "Kernel live-view URL is not allowed by hosted computer-use configuration.",
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
  const timeout = input.timeoutMs;
  const selector = input.selector ? JSON.stringify(input.selector) ?? null : null;
  const value = input.value === null ? null : JSON.stringify(input.value) ?? null;

  switch (input.action) {
    case "goto":
      if (!input.url) {
        throw computerUseError({
          code: "HOSTED_COMPUTER_ACT_URL_REQUIRED",
          httpStatus: 400,
          message: "Computer goto action requires a URL.",
        });
      }
      return withBrowserStateReturn(
        `await page.goto(${JSON.stringify(input.url)}, { waitUntil: 'domcontentloaded', timeout: ${timeout} });`,
      );
    case "click":
      return withSelectorAction(selector, `await locator.click({ timeout: ${timeout} });`);
    case "fill":
      if (value === null) {
        throw computerUseError({
          code: "HOSTED_COMPUTER_ACT_VALUE_REQUIRED",
          httpStatus: 400,
          message: "Computer fill action requires a value.",
        });
      }
      return withSelectorAction(selector, `await locator.fill(${value}, { timeout: ${timeout} });`);
    case "press":
      if (value === null) {
        throw computerUseError({
          code: "HOSTED_COMPUTER_ACT_VALUE_REQUIRED",
          httpStatus: 400,
          message: "Computer press action requires a value.",
        });
      }
      return withSelectorAction(selector, `await locator.press(${value}, { timeout: ${timeout} });`);
    case "select":
      if (value === null) {
        throw computerUseError({
          code: "HOSTED_COMPUTER_ACT_VALUE_REQUIRED",
          httpStatus: 400,
          message: "Computer select action requires a value.",
        });
      }
      return withSelectorAction(selector, `await locator.selectOption(${value}, { timeout: ${timeout} });`);
    case "check":
      return withSelectorAction(selector, `await locator.check({ timeout: ${timeout} });`);
    case "uncheck":
      return withSelectorAction(selector, `await locator.uncheck({ timeout: ${timeout} });`);
  }
}

function withSelectorAction(
  selector: string | null,
  statement: string,
): string {
  if (!selector) {
    throw computerUseError({
      code: "HOSTED_COMPUTER_ACT_SELECTOR_REQUIRED",
      httpStatus: 400,
      message: "Computer action requires a selector.",
    });
  }

  return withBrowserStateReturn([
    `const locator = page.locator(${selector}).first();`,
    statement,
  ].join("\n"));
}

function withBrowserStateReturn(statement: string): string {
  return [
    statement,
    "return { url: page.url(), title: await page.title().catch(() => null) };",
  ].join("\n");
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

function isComputerHandoffCheckpointingError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING";
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
  env: EnvSource;
  memberId: string;
  profileKey: HostedComputerProfileKey;
}): string {
  const envSegment = normalizeKernelNameSegment(
    input.env.VERCEL_ENV ?? input.env.NODE_ENV ?? "development",
  );
  const memberSegment = normalizeKernelNameSegment(input.memberId);
  const profileSegment = normalizeKernelNameSegment(input.profileKey);
  const hash = shortHash(`${envSegment}:${input.memberId}:${profileSegment}`);
  return `murph-${envSegment}-${memberSegment}-${profileSegment}-${hash}`.slice(0, 255);
}

function normalizeKernelNameSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalized.length > 0 ? normalized.slice(0, 80) : "default";
}
