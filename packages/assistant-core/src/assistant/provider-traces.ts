export interface AssistantProviderTraceUpdate {
  kind: 'assistant' | 'error' | 'status' | 'thinking'
  mode?: 'append' | 'replace'
  streamKey?: string | null
  text: string
}

export interface AssistantProviderTraceEvent {
  providerSessionId: string | null
  rawEvent: unknown
  updates: readonly AssistantProviderTraceUpdate[]
}
