/**
 * Public assistant runtime helpers for UI progress, traces, diagnostics, and
 * runtime-state inspection. Codex turn execution stays on internal Codex
 * surfaces instead of a provider plugin registry.
 *
 * Public progress/trace types intentionally omit raw provider events. Internal
 * runtime code that needs raw Codex diagnostics imports provider-progress or
 * provider-traces directly.
 */

export * from './assistant/conversation-persistence.js'
export * from './assistant/provider-failure-diagnostics.js'

export interface AssistantProviderTraceUpdate {
  kind: 'assistant' | 'error' | 'status' | 'thinking'
  mode?: 'append' | 'replace' | 'remove'
  streamKey?: string | null
  text: string
}

export interface AssistantProviderTraceEvent {
  codexThreadId: string | null
  updates: readonly AssistantProviderTraceUpdate[]
}

export interface AssistantProviderProgressEvent {
  id: string | null
  kind:
    | 'command'
    | 'file'
    | 'message'
    | 'plan'
    | 'reasoning'
    | 'search'
    | 'status'
    | 'tool'
  label?: string | null
  safeLabel?: string | null
  safeText?: string | null
  state: 'completed' | 'running'
  text: string
}
