export interface AssistantProviderTraceUpdate {
  kind: 'assistant' | 'error' | 'status' | 'thinking'
  mode?: 'append' | 'replace' | 'remove'
  streamKey?: string | null
  text: string
}

export interface AssistantProviderTraceEvent {
  codexThreadId: string | null
  rawEvent: unknown
  updates: readonly AssistantProviderTraceUpdate[]
}
