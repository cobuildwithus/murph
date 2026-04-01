import {
  createIntegratedInboxServices,
  createIntegratedVaultServices,
  drainAssistantOutbox,
  getAssistantCronJob,
  getAssistantCronJobTarget,
  getAssistantCronStatus,
  getAssistantSession,
  getAssistantStatus,
  listAssistantCronJobs,
  listAssistantCronRuns,
  listAssistantOutboxIntents,
  listAssistantSessions,
  openAssistantConversation,
  processDueAssistantCronJobs,
  readAssistantOutboxIntent,
  runAssistantAutomation,
  sendAssistantMessage,
  setAssistantCronJobTarget,
  updateAssistantSessionOptions,
  type AssistantAskResult,
  type AssistantCronJob,
  type AssistantCronTargetMutationResult,
  type AssistantCronTargetSnapshot,
  type AssistantCronProcessDueResult,
  type AssistantCronRunRecord,
  type AssistantCronStatusSnapshot,
  type AssistantMessageInput,
  type AssistantOutboxDispatchMode,
  type AssistantOutboxIntent,
  type AssistantRunResult,
  type AssistantSession,
  type AssistantStatusResult,
  type RunAssistantAutomationInput,
} from '@murphai/assistant-core'
import { createLocalGatewayService } from '@murphai/gateway-local'
import type { GatewayService } from '@murphai/gateway-core'

const ASSISTANTD_DISABLE_CLIENT_ENV = 'MURPH_ASSISTANTD_DISABLE_CLIENT'

export interface AssistantLocalAutomationRunInput {
  allowSelfAuthored?: boolean
  deliveryDispatchMode?: RunAssistantAutomationInput['deliveryDispatchMode']
  drainOutbox?: boolean
  maxPerScan?: number
  modelSpec?: RunAssistantAutomationInput['modelSpec']
  once?: boolean
  requestId?: string | null
  scanIntervalMs?: number
  sessionMaxAgeMs?: number | null
  startDaemon?: boolean
  vault?: string | null
}

export interface AssistantLocalOpenConversationResult {
  created: boolean
  session: AssistantSession
}

export interface AssistantLocalService {
  gateway: GatewayService
  drainOutbox(input?: {
    limit?: number
    now?: string | null
    vault?: string | null
  }): ReturnType<typeof drainAssistantOutbox>
  getCronJob(input: {
    job: string
    vault?: string | null
  }): Promise<AssistantCronJob>
  getCronTarget(input: {
    job: string
    vault?: string | null
  }): Promise<AssistantCronTargetSnapshot>
  getCronStatus(input?: {
    vault?: string | null
  }): Promise<AssistantCronStatusSnapshot>
  getOutboxIntent(input: {
    intentId: string
    vault?: string | null
  }): Promise<AssistantOutboxIntent | null>
  getSession(input: {
    sessionId: string
    vault?: string | null
  }): Promise<AssistantSession>
  health(): Promise<{
    generatedAt: string
    ok: true
    pid: number
    vaultBound: true
  }>
  getStatus(input?: {
    limit?: number
    sessionId?: string | null
    vault?: string | null
  }): Promise<AssistantStatusResult>
  listSessions(input?: {
    vault?: string | null
  }): Promise<AssistantSession[]>
  listCronJobs(input?: {
    vault?: string | null
  }): Promise<AssistantCronJob[]>
  listCronRuns(input: {
    job: string
    limit?: number
    vault?: string | null
  }): Promise<{
    jobId: string
    runs: AssistantCronRunRecord[]
  }>
  listOutbox(input?: {
    vault?: string | null
  }): Promise<AssistantOutboxIntent[]>
  openConversation(
    input: Omit<Parameters<typeof openAssistantConversation>[0], 'vault'> & { vault?: string | null },
  ): Promise<AssistantLocalOpenConversationResult>
  processDueCron(input?: {
    deliveryDispatchMode?: AssistantOutboxDispatchMode
    limit?: number
    vault?: string | null
  }): Promise<AssistantCronProcessDueResult>
  setCronTarget(input: {
    channel?: string | null
    deliveryTarget?: string | null
    dryRun?: boolean
    identityId?: string | null
    job: string
    participantId?: string | null
    resetContinuity?: boolean
    sourceThreadId?: string | null
    vault?: string | null
  }): Promise<AssistantCronTargetMutationResult>
  runAutomationOnce(
    input?: AssistantLocalAutomationRunInput,
  ): Promise<AssistantRunResult>
  sendMessage(
    input: Omit<AssistantMessageInput, 'vault'> & { vault?: string | null },
  ): Promise<AssistantAskResult>
  updateSessionOptions(
    input: Omit<Parameters<typeof updateAssistantSessionOptions>[0], 'vault'> & {
      vault?: string | null
    },
  ): ReturnType<typeof updateAssistantSessionOptions>
  vault: string
}

export function createAssistantLocalService(vaultRoot: string): AssistantLocalService {
  ensureAssistantDaemonClientDisabled()

  const inboxServices = createIntegratedInboxServices()
  const vaultServices = createIntegratedVaultServices()
  const gateway = createLocalGatewayService(vaultRoot)

  return {
    gateway,
    drainOutbox: async (input) =>
      runAssistantdLocalCall(() =>
        drainAssistantOutbox({
          limit:
            typeof input?.limit === 'number' && Number.isFinite(input.limit)
              ? Math.trunc(input.limit)
              : undefined,
          now: input?.now ? new Date(input.now) : undefined,
          vault: resolveAssistantdRequestVault(input?.vault, vaultRoot),
        }),
      ),
    getCronJob: (input) =>
      runAssistantdLocalCall(() =>
        getAssistantCronJob(
          resolveAssistantdRequestVault(input.vault, vaultRoot),
          input.job,
        ),
      ),
    getCronTarget: (input) =>
      runAssistantdLocalCall(() =>
        getAssistantCronJobTarget(
          resolveAssistantdRequestVault(input.vault, vaultRoot),
          input.job,
        ),
      ),
    getCronStatus: (input) =>
      runAssistantdLocalCall(() =>
        getAssistantCronStatus(resolveAssistantdRequestVault(input?.vault, vaultRoot)),
      ),
    getOutboxIntent: (input) =>
      runAssistantdLocalCall(() =>
        readAssistantOutboxIntent(
          resolveAssistantdRequestVault(input.vault, vaultRoot),
          input.intentId,
        ),
      ),
    getSession: (input) =>
      runAssistantdLocalCall(() =>
        getAssistantSession(
          resolveAssistantdRequestVault(input.vault, vaultRoot),
          input.sessionId,
        ),
      ),
    health: async () => ({
      generatedAt: new Date().toISOString(),
      ok: true,
      pid: process.pid,
      vaultBound: true,
    }),
    getStatus: (input) =>
      runAssistantdLocalCall(() =>
        getAssistantStatus({
          limit:
            typeof input?.limit === 'number' && Number.isFinite(input.limit)
              ? Math.trunc(input.limit)
              : undefined,
          sessionId: input?.sessionId ?? null,
          vault: resolveAssistantdRequestVault(input?.vault, vaultRoot),
        }),
      ),
    listSessions: (input) =>
      runAssistantdLocalCall(() =>
        listAssistantSessions(resolveAssistantdRequestVault(input?.vault, vaultRoot)),
      ),
    listCronJobs: (input) =>
      runAssistantdLocalCall(() =>
        listAssistantCronJobs(resolveAssistantdRequestVault(input?.vault, vaultRoot)),
      ),
    listCronRuns: (input) =>
      runAssistantdLocalCall(() =>
        listAssistantCronRuns({
          job: input.job,
          limit:
            typeof input.limit === 'number' && Number.isFinite(input.limit)
              ? Math.trunc(input.limit)
              : undefined,
          vault: resolveAssistantdRequestVault(input.vault, vaultRoot),
        }),
      ),
    listOutbox: (input) =>
      runAssistantdLocalCall(() =>
        listAssistantOutboxIntents(resolveAssistantdRequestVault(input?.vault, vaultRoot)),
      ),
    openConversation: async (input) =>
      runAssistantdLocalCall(async () => {
        const resolved = await openAssistantConversation({
          ...input,
          vault: resolveAssistantdRequestVault(input.vault, vaultRoot),
        })
        return {
          created: resolved.created,
          session: resolved.session,
        }
      }),
    processDueCron: (input) =>
      runAssistantdLocalCall(() =>
        processDueAssistantCronJobs({
          deliveryDispatchMode: input?.deliveryDispatchMode,
          limit:
            typeof input?.limit === 'number' && Number.isFinite(input.limit)
              ? Math.trunc(input.limit)
              : undefined,
          vault: resolveAssistantdRequestVault(input?.vault, vaultRoot),
        }),
      ),
    setCronTarget: (input) =>
      runAssistantdLocalCall(() =>
        setAssistantCronJobTarget({
          channel: input.channel ?? undefined,
          deliveryTarget: input.deliveryTarget ?? undefined,
          dryRun: input.dryRun,
          identityId: input.identityId ?? undefined,
          job: input.job,
          participantId: input.participantId ?? undefined,
          resetContinuity: input.resetContinuity,
          sourceThreadId: input.sourceThreadId ?? undefined,
          vault: resolveAssistantdRequestVault(input.vault, vaultRoot),
        }),
      ),
    runAutomationOnce: (input) =>
      runAssistantdLocalCall(() =>
        runAssistantAutomation({
          allowSelfAuthored: input?.allowSelfAuthored,
          deliveryDispatchMode: input?.deliveryDispatchMode,
          drainOutbox: input?.drainOutbox,
          inboxServices,
          maxPerScan: input?.maxPerScan,
          modelSpec: input?.modelSpec,
          once: input?.once ?? true,
          requestId: input?.requestId ?? null,
          scanIntervalMs: input?.scanIntervalMs,
          sessionMaxAgeMs: input?.sessionMaxAgeMs ?? null,
          startDaemon: input?.startDaemon ?? false,
          vault: resolveAssistantdRequestVault(input?.vault, vaultRoot),
          vaultServices,
        }),
      ),
    sendMessage: (input) =>
      runAssistantdLocalCall(() =>
        sendAssistantMessage({
          ...input,
          vault: resolveAssistantdRequestVault(input.vault, vaultRoot),
        }),
      ),
    updateSessionOptions: (input) =>
      runAssistantdLocalCall(() =>
        updateAssistantSessionOptions({
          ...input,
          vault: resolveAssistantdRequestVault(input.vault, vaultRoot),
        }),
      ),
    vault: vaultRoot,
  }
}

function ensureAssistantDaemonClientDisabled(): void {
  process.env[ASSISTANTD_DISABLE_CLIENT_ENV] = '1'
}

function runAssistantdLocalCall<T>(action: () => Promise<T>): Promise<T>
function runAssistantdLocalCall<T>(action: () => T): T
function runAssistantdLocalCall<T>(action: () => Promise<T> | T): Promise<T> | T {
  ensureAssistantDaemonClientDisabled()
  return action()
}

function resolveAssistantdRequestVault(
  requestedVault: string | null | undefined,
  configuredVault: string,
): string {
  if (!requestedVault) {
    return configuredVault
  }
  if (requestedVault !== configuredVault) {
    throw new Error(
      `assistantd is bound to ${configuredVault}, but the request targeted ${requestedVault}.`,
    )
  }
  return configuredVault
}
