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
  type AssistantMessageInput,
  type AssistantSession,
  type AssistantStatusResult,
  type AssistantCronProcessDueResult,
  type RunAssistantAutomationInput,
} from 'murph'

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

export interface AssistantLocalService {
  drainOutbox(input?: { now?: string | null }): ReturnType<typeof drainAssistantOutbox>
  getSession(sessionId: string): Promise<AssistantSession>
  health(): Promise<{
    generatedAt: string
    ok: true
    pid: number
    vaultBound: true
  }>
  getStatus(): Promise<AssistantStatusResult>
  listSessions(): Promise<AssistantSession[]>
  openConversation(
    input: Omit<Parameters<typeof openAssistantConversation>[0], 'vault'> & { vault?: string | null },
  ): ReturnType<typeof openAssistantConversation>
  processDueCron(input?: {
    now?: string | null
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
        now: input?.now ? new Date(input.now) : undefined,
        vault: vaultRoot,
      }),
    getSession: (sessionId) => getAssistantSession(vaultRoot, sessionId),
    health: async () => ({
      generatedAt: new Date().toISOString(),
      ok: true,
      pid: process.pid,
      vaultBound: true,
    }),
    getStatus: () => getAssistantStatus(vaultRoot),
    listSessions: () => listAssistantSessions(vaultRoot),
    openConversation: (input) =>
      openAssistantConversation({
        ...input,
        vault: resolveAssistantdRequestVault(input.vault, vaultRoot),
      }),
    processDueCron: (input) =>
      processDueAssistantCronJobs({
        vault: vaultRoot,
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
