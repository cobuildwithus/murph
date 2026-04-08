import type {
  AssistantOutboxIntent,
  AssistantSession,
  AssistantStatusResult,
  AssistantTranscriptEntry,
  AssistantTurnReceipt,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  appendAssistantTranscriptEntries,
  getAssistantSession,
  listAssistantSessions,
  listAssistantTranscriptEntries,
  resolveAssistantSession,
  restoreAssistantSessionSnapshot,
  saveAssistantSession,
  type AssistantTranscriptEntryInput,
  type ResolveAssistantSessionInput,
  type ResolvedAssistantSession,
} from './store.js'
import {
  appendAssistantTurnReceiptEvent,
  createAssistantTurnReceipt,
  finalizeAssistantTurnReceipt,
  readAssistantTurnReceipt,
  updateAssistantTurnReceipt,
} from './turns.js'
import {
  createAssistantOutboxIntent,
  deliverAssistantOutboxMessage,
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  readAssistantOutboxIntent,
  saveAssistantOutboxIntent,
  type AssistantOutboxDispatchHooks,
  type DeliverAssistantOutboxMessageResult,
  type DispatchAssistantOutboxIntentResult,
} from './outbox.js'
import {
  getAssistantStatus,
  readAssistantStatusSnapshot,
  refreshAssistantStatusSnapshot,
} from './status.js'
import {
  recordAssistantDiagnosticEvent,
  readAssistantDiagnosticsSnapshot,
} from './diagnostics.js'

type AssistantStatusInput = Exclude<Parameters<typeof getAssistantStatus>[0], string>
type RecordAssistantDiagnosticEventInput = Omit<Parameters<
  typeof recordAssistantDiagnosticEvent
>[0], 'vault'>
type CreateAssistantOutboxIntentInput = Omit<Parameters<
  typeof createAssistantOutboxIntent
>[0], 'vault'>
type DeliverAssistantOutboxMessageInput = Omit<Parameters<
  typeof deliverAssistantOutboxMessage
>[0], 'vault'>
type CreateAssistantTurnReceiptInput = Omit<Parameters<
  typeof createAssistantTurnReceipt
>[0], 'vault'>
type AppendAssistantTurnReceiptEventInput = Omit<Parameters<
  typeof appendAssistantTurnReceiptEvent
>[0], 'vault'>
type UpdateAssistantTurnReceiptInput = Omit<Parameters<
  typeof updateAssistantTurnReceipt
>[0], 'vault'>
type FinalizeAssistantTurnReceiptInput = Omit<Parameters<
  typeof finalizeAssistantTurnReceipt
>[0], 'vault'>

export interface AssistantRuntimeStateService {
  diagnostics: {
    readSnapshot: () => ReturnType<typeof readAssistantDiagnosticsSnapshot>
    recordEvent: (input: RecordAssistantDiagnosticEventInput) => ReturnType<typeof recordAssistantDiagnosticEvent>
  }
  outbox: {
    createIntent: (input: CreateAssistantOutboxIntentInput) => ReturnType<typeof createAssistantOutboxIntent>
    deliverMessage: (input: DeliverAssistantOutboxMessageInput) => Promise<DeliverAssistantOutboxMessageResult>
    dispatchIntent: (input: {
      dependencies?: Parameters<typeof dispatchAssistantOutboxIntent>[0]['dependencies']
      dispatchHooks?: AssistantOutboxDispatchHooks
      force?: boolean
      intentId: string
      now?: Date
    }) => Promise<DispatchAssistantOutboxIntentResult>
    listIntents: () => Promise<AssistantOutboxIntent[]>
    readIntent: (intentId: string) => Promise<AssistantOutboxIntent | null>
    saveIntent: (intent: AssistantOutboxIntent) => Promise<AssistantOutboxIntent>
  }
  sessions: {
    get: (sessionId: string) => Promise<AssistantSession>
    list: () => Promise<AssistantSession[]>
    resolve: (input: Omit<ResolveAssistantSessionInput, 'vault'>) => Promise<ResolvedAssistantSession>
    restoreSnapshot: (input: {
      session: AssistantSession
      transcriptEntries?: readonly AssistantTranscriptEntryInput[] | null
    }) => Promise<AssistantSession>
    save: (session: AssistantSession) => Promise<AssistantSession>
  }
  status: {
    get: (input?: Omit<AssistantStatusInput, 'vault'>) => Promise<AssistantStatusResult>
    readSnapshot: () => ReturnType<typeof readAssistantStatusSnapshot>
    refreshSnapshot: () => ReturnType<typeof refreshAssistantStatusSnapshot>
  }
  transcripts: {
    append: (sessionId: string, entries: readonly AssistantTranscriptEntryInput[]) => Promise<AssistantTranscriptEntry[]>
    list: (sessionId: string) => Promise<AssistantTranscriptEntry[]>
  }
  turns: {
    appendEvent: (input: AppendAssistantTurnReceiptEventInput) => ReturnType<typeof appendAssistantTurnReceiptEvent>
    createReceipt: (input: CreateAssistantTurnReceiptInput) => ReturnType<typeof createAssistantTurnReceipt>
    finalizeReceipt: (input: FinalizeAssistantTurnReceiptInput) => ReturnType<typeof finalizeAssistantTurnReceipt>
    readReceipt: (turnId: string) => Promise<AssistantTurnReceipt | null>
    updateReceipt: (input: UpdateAssistantTurnReceiptInput) => ReturnType<typeof updateAssistantTurnReceipt>
  }
}

export function createAssistantRuntimeStateService(vault: string): AssistantRuntimeStateService {
  return {
    diagnostics: {
      readSnapshot: () => readAssistantDiagnosticsSnapshot(vault),
      recordEvent: (input) => recordAssistantDiagnosticEvent({ ...input, vault }),
    },
    outbox: {
      createIntent: (input) => createAssistantOutboxIntent({ ...input, vault }),
      deliverMessage: (input) => deliverAssistantOutboxMessage({ ...input, vault }),
      dispatchIntent: (input) =>
        dispatchAssistantOutboxIntent({
          ...input,
          vault,
        }),
      listIntents: () => listAssistantOutboxIntents(vault),
      readIntent: (intentId) => readAssistantOutboxIntent(vault, intentId),
      saveIntent: (intent) => saveAssistantOutboxIntent(vault, intent),
    },
    sessions: {
      get: (sessionId) => getAssistantSession(vault, sessionId),
      list: () => listAssistantSessions(vault),
      resolve: (input) =>
        resolveAssistantSession({
          ...input,
          vault,
        }),
      restoreSnapshot: (input) =>
        restoreAssistantSessionSnapshot({
          ...input,
          vault,
        }),
      save: (session) => saveAssistantSession(vault, session),
    },
    status: {
      get: (input) =>
        getAssistantStatus({
          ...(input ?? {}),
          vault,
        }),
      readSnapshot: () => readAssistantStatusSnapshot(vault),
      refreshSnapshot: () => refreshAssistantStatusSnapshot(vault),
    },
    transcripts: {
      append: (sessionId, entries) => appendAssistantTranscriptEntries(vault, sessionId, entries),
      list: (sessionId) => listAssistantTranscriptEntries(vault, sessionId),
    },
    turns: {
      appendEvent: (input) => appendAssistantTurnReceiptEvent({ ...input, vault }),
      createReceipt: (input) => createAssistantTurnReceipt({ ...input, vault }),
      finalizeReceipt: (input) => finalizeAssistantTurnReceipt({ ...input, vault }),
      readReceipt: (turnId) => readAssistantTurnReceipt(vault, turnId),
      updateReceipt: (input) => updateAssistantTurnReceipt({ ...input, vault }),
    },
  }
}
