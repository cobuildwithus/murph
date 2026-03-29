import {
  createIntegratedInboxCliServices,
  createIntegratedVaultCliServices,
  drainAssistantOutbox,
  getAssistantSession,
  getAssistantStatus,
  listAssistantSessions,
  openAssistantConversation,
  processDueAssistantCronJobs,
  runAssistantAutomation,
  sendAssistantMessage,
  updateAssistantSessionOptions,
  type AssistantAskResult,
  type AssistantCronProcessDueResult,
  type AssistantMessageInput,
  type AssistantOutboxDispatchMode,
  type AssistantSession,
  type AssistantStatusResult,
  type RunAssistantAutomationInput,
} from 'murph/assistant-core'

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
  drainOutbox(input?: {
    limit?: number
    now?: string | null
    vault?: string | null
  }): ReturnType<typeof drainAssistantOutbox>
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
  openConversation(
    input: Omit<Parameters<typeof openAssistantConversation>[0], 'vault'> & { vault?: string | null },
  ): Promise<AssistantLocalOpenConversationResult>
  processDueCron(input?: {
    deliveryDispatchMode?: AssistantOutboxDispatchMode
    limit?: number
    vault?: string | null
  }): Promise<AssistantCronProcessDueResult>
  runAutomationOnce(
    input?: AssistantLocalAutomationRunInput,
  ): ReturnType<typeof runAssistantAutomation>
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
  const inboxServices = createIntegratedInboxCliServices()
  const vaultServices = createIntegratedVaultCliServices()

  return {
    drainOutbox: async (input) =>
      drainAssistantOutbox({
        limit:
          typeof input?.limit === 'number' && Number.isFinite(input.limit)
            ? Math.trunc(input.limit)
            : undefined,
        now: input?.now ? new Date(input.now) : undefined,
        vault: resolveAssistantdRequestVault(input?.vault, vaultRoot),
      }),
    getSession: (input) =>
      getAssistantSession(
        resolveAssistantdRequestVault(input.vault, vaultRoot),
        input.sessionId,
      ),
    health: async () => ({
      generatedAt: new Date().toISOString(),
      ok: true,
      pid: process.pid,
      vaultBound: true,
    }),
    getStatus: (input) =>
      getAssistantStatus({
        limit:
          typeof input?.limit === 'number' && Number.isFinite(input.limit)
            ? Math.trunc(input.limit)
            : undefined,
        sessionId: input?.sessionId ?? null,
        vault: resolveAssistantdRequestVault(input?.vault, vaultRoot),
      }),
    listSessions: (input) =>
      listAssistantSessions(resolveAssistantdRequestVault(input?.vault, vaultRoot)),
    openConversation: async (input) => {
      const resolved = await openAssistantConversation({
        ...input,
        vault: resolveAssistantdRequestVault(input.vault, vaultRoot),
      })
      return {
        created: resolved.created,
        session: resolved.session,
      }
    },
    processDueCron: (input) =>
      processDueAssistantCronJobs({
        deliveryDispatchMode: input?.deliveryDispatchMode,
        limit:
          typeof input?.limit === 'number' && Number.isFinite(input.limit)
            ? Math.trunc(input.limit)
            : undefined,
        vault: resolveAssistantdRequestVault(input?.vault, vaultRoot),
      }),
    runAutomationOnce: (input) =>
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
    sendMessage: (input) =>
      sendAssistantMessage({
        ...input,
        vault: resolveAssistantdRequestVault(input.vault, vaultRoot),
      }),
    updateSessionOptions: (input) =>
      updateAssistantSessionOptions({
        ...input,
        vault: resolveAssistantdRequestVault(input.vault, vaultRoot),
      }),
    vault: vaultRoot,
  }
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
