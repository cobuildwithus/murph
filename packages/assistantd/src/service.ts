import {
  drainAssistantOutbox,
  getAssistantCronJob,
  getAssistantCronJobTarget,
  getAssistantCronStatus,
  getAssistantSession,
  readAssistantAutomationState,
  getAssistantStatus,
  listAssistantCronJobs,
  listAssistantCronRuns,
  listAssistantOutboxIntents,
  listAssistantSessions,
  openAssistantConversation,
  processDueAssistantCronJobs,
  readAssistantOutboxIntent,
  runAssistantAutomation,
  saveAssistantAutomationState,
  sendAssistantMessage,
  setAssistantCronJobTarget,
  updateAssistantSessionOptions,
} from '@murphai/assistant-engine'
import { createIntegratedInboxServices } from '@murphai/inbox-services'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'
import type { RunAssistantAutomationInput } from '@murphai/assistant-engine/assistant-automation'
import type { AssistantOutboxDispatchMode } from '@murphai/assistant-engine/assistant-outbox'
import { createAssistantdVaultMismatchError } from './errors.js'

const ASSISTANTD_DISABLE_CLIENT_ENV = 'MURPH_ASSISTANTD_DISABLE_CLIENT'
const LOCAL_ASSISTANT_LINQ_ERROR =
  'Local assistant Linq routes are no longer supported. Hosted/shared assistant-engine Linq support remains available.'

type AssistantLocalOpenConversationInput = Omit<
  Parameters<typeof openAssistantConversation>[0],
  'vault'
> & { vault?: string | null }
type AssistantLocalOpenConversationResolved = Awaited<
  ReturnType<typeof openAssistantConversation>
>
type AssistantLocalMessageInput = Omit<Parameters<typeof sendAssistantMessage>[0], 'vault'> & {
  vault?: string | null
}
type AssistantLocalSessionOptionsInput = Omit<
  Parameters<typeof updateAssistantSessionOptions>[0],
  'vault'
> & { vault?: string | null }

export interface AssistantLocalAutomationRunInput {
  allowCanonicalWrites?: boolean
  allowSelfAuthored?: boolean
  deliveryDispatchMode?: RunAssistantAutomationInput['deliveryDispatchMode']
  drainOutbox?: boolean
  maxPerScan?: number
  once?: boolean
  requestId?: string | null
  sessionMaxAgeMs?: number | null
  startDaemon?: boolean
  vault?: string | null
}

export interface AssistantLocalOpenConversationResult {
  created: AssistantLocalOpenConversationResolved['created']
  session: AssistantLocalOpenConversationResolved['session']
}

export interface AssistantLocalService {
  drainOutbox(input?: {
    limit?: number
    now?: string | null
    vault?: string | null
  }): ReturnType<typeof drainAssistantOutbox>
  getCronJob(input: {
    job: string
    vault?: string | null
  }): ReturnType<typeof getAssistantCronJob>
  getCronTarget(input: {
    job: string
    vault?: string | null
  }): ReturnType<typeof getAssistantCronJobTarget>
  getCronStatus(input?: {
    vault?: string | null
  }): ReturnType<typeof getAssistantCronStatus>
  getOutboxIntent(input: {
    intentId: string
    vault?: string | null
  }): ReturnType<typeof readAssistantOutboxIntent>
  getSession(input: {
    sessionId: string
    vault?: string | null
  }): ReturnType<typeof getAssistantSession>
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
  }): ReturnType<typeof getAssistantStatus>
  listSessions(input?: {
    vault?: string | null
  }): ReturnType<typeof listAssistantSessions>
  listCronJobs(input?: {
    vault?: string | null
  }): ReturnType<typeof listAssistantCronJobs>
  listCronRuns(input: {
    job: string
    limit?: number
    vault?: string | null
  }): ReturnType<typeof listAssistantCronRuns>
  listOutbox(input?: {
    vault?: string | null
  }): ReturnType<typeof listAssistantOutboxIntents>
  openConversation(input: AssistantLocalOpenConversationInput): Promise<AssistantLocalOpenConversationResult>
  processDueCron(input?: {
    deliveryDispatchMode?: AssistantOutboxDispatchMode
    limit?: number
    vault?: string | null
  }): ReturnType<typeof processDueAssistantCronJobs>
  setCronTarget(input: {
    channel?: string | null
    deliveryTarget?: string | null
    dryRun?: boolean
    identityId?: string | null
    job: string
    participantId?: string | null
    resetContinuity?: boolean
    threadId?: string | null
    vault?: string | null
  }): ReturnType<typeof setAssistantCronJobTarget>
  runAutomationOnce(
    input?: AssistantLocalAutomationRunInput,
  ): ReturnType<typeof runAssistantAutomation>
  sendMessage(input: AssistantLocalMessageInput): ReturnType<typeof sendAssistantMessage>
  updateSessionOptions(input: AssistantLocalSessionOptionsInput): ReturnType<
    typeof updateAssistantSessionOptions
  >
  vault: string
}

function normalizeAssistantChannel(channel?: string | null): string | null {
  if (typeof channel !== 'string') {
    return null
  }
  const normalized = channel.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function throwLocalAssistantLinqUnsupported(): never {
  throw Object.assign(new Error(LOCAL_ASSISTANT_LINQ_ERROR), {
    code: 'invalid_option' as const,
  })
}

async function assertLocalAssistantLinqRouteAllowed(input: {
  channel?: string | null
  conversation?: { channel?: string | null } | null
  sessionId?: string | null
  vault: string
}): Promise<void> {
  if (
    normalizeAssistantChannel(input.channel) === 'linq' ||
    normalizeAssistantChannel(input.conversation?.channel) === 'linq'
  ) {
    throwLocalAssistantLinqUnsupported()
  }

  if (!input.sessionId) {
    return
  }

  const session = await getAssistantSession(input.vault, input.sessionId)
  if (normalizeAssistantChannel(session.binding.channel) === 'linq') {
    throwLocalAssistantLinqUnsupported()
  }
}

async function dropLegacyLocalLinqAutoReplyState(vault: string): Promise<void> {
  const state = await readAssistantAutomationState(vault)
  const nextAutoReply = state.autoReply.filter((entry) => entry.channel !== 'linq')

  if (nextAutoReply.length === state.autoReply.length) {
    return
  }

  await saveAssistantAutomationState(vault, {
    ...state,
    autoReply: nextAutoReply,
    updatedAt: new Date().toISOString(),
  })
}

export function createAssistantLocalService(vaultRoot: string): AssistantLocalService {
  ensureAssistantDaemonClientDisabled()

  const inboxServices = createIntegratedInboxServices()

  return {
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
        const vault = resolveAssistantdRequestVault(input.vault, vaultRoot)
        await assertLocalAssistantLinqRouteAllowed({
          channel: input.channel,
          conversation: input.conversation,
          sessionId: input.sessionId,
          vault,
        })
        const resolved = await openAssistantConversation({
          ...input,
          vault,
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
      runAssistantdLocalCall(() => {
        if (normalizeAssistantChannel(input.channel) === 'linq') {
          throwLocalAssistantLinqUnsupported()
        }
        return setAssistantCronJobTarget({
          channel: input.channel ?? undefined,
          deliveryTarget: input.deliveryTarget ?? undefined,
          dryRun: input.dryRun,
          identityId: input.identityId ?? undefined,
          job: input.job,
          participantId: input.participantId ?? undefined,
          resetContinuity: input.resetContinuity,
          threadId: input.threadId ?? undefined,
          vault: resolveAssistantdRequestVault(input.vault, vaultRoot),
        })
      }),
    runAutomationOnce: (input) =>
      runAssistantdLocalCall(async () => {
        const vault = resolveAssistantdRequestVault(input?.vault, vaultRoot)
        const allowCanonicalWrites = input?.allowCanonicalWrites === true
        await dropLegacyLocalLinqAutoReplyState(vault)
        return runAssistantAutomation({
          applyCanonicalWrites: allowCanonicalWrites,
          allowSelfAuthored: input?.allowSelfAuthored,
          deliveryDispatchMode: input?.deliveryDispatchMode,
          drainOutbox: input?.drainOutbox,
          inboxServices,
          maxPerScan: input?.maxPerScan,
          once: input?.once ?? true,
          requestId: input?.requestId ?? null,
          sessionMaxAgeMs: input?.sessionMaxAgeMs ?? null,
          startDaemon:
            input?.startDaemon ??
            ((input?.once ?? true) ? false : true),
          vault,
          vaultServices: allowCanonicalWrites
            ? createIntegratedVaultServices()
            : null,
        })
      }),
    sendMessage: (input) =>
      runAssistantdLocalCall(async () => {
        const vault = resolveAssistantdRequestVault(input.vault, vaultRoot)
        const messageInput: AssistantLocalMessageInput = {
          ...input,
          operatorAuthority: input.operatorAuthority ?? 'direct-operator',
        }
        await assertLocalAssistantLinqRouteAllowed({
          channel: messageInput.channel,
          conversation: messageInput.conversation,
          sessionId: messageInput.sessionId,
          vault,
        })
        return sendAssistantMessage({
          ...messageInput,
          vault,
        })
      }),
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
    throw createAssistantdVaultMismatchError({
      configuredVault,
      requestedVault,
    })
  }
  return configuredVault
}
