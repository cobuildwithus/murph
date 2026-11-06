import { readCodexNonEmptyString, readCodexRecord, type CodexRpcMessage } from './app-server-protocol.js'
import { withCodexRpcTimeout } from './app-server-rpc.js'

export interface CodexRealtimeInput {
  inputId: string
  text: string
}

export interface CodexRealtimeClosure {
  providerConfirmed: boolean
  providerSessionId: string | null
  seconds: number | null
}

export interface CodexRealtimeOptions {
  sessionId: string
  sdp: string
  prompt: string
  voice?: string
  signal?: AbortSignal
  /** Accept through the durable input owner before starting ordinary work. */
  onInput(input: CodexRealtimeInput): void
  /** Trusted cumulative seconds from native provider notifications, never browser reports. */
  onUsage?(seconds: number): void
}

export interface CodexRealtimeSession {
  sdp: string
  closed: Promise<CodexRealtimeClosure>
  speak(text: string): Promise<void>
  close(): Promise<CodexRealtimeClosure>
}

export function isCodexRealtimeNotification(message: CodexRpcMessage): boolean {
  return typeof message.method === 'string'
    && message.method.startsWith('thread/realtime/')
    && !Object.hasOwn(message, 'id')
}

/** A notification binding on the existing process, with no backing-turn ownership. */
export class CodexRealtimeBinding {
  readonly closed: Promise<CodexRealtimeClosure>
  private resolveClosed!: (closure: CodexRealtimeClosure) => void
  private readonly answer: Promise<string>
  private resolveAnswer!: (sdp: string) => void
  private rejectAnswer!: (error: Error) => void
  private closing: Promise<CodexRealtimeClosure> | null = null
  private state: 'open' | 'closing' | 'closed' = 'open'
  private readonly onAbort = () => { void this.close() }
  private receipt: CodexRealtimeClosure = {
    providerConfirmed: false, providerSessionId: null, seconds: null,
  }

  constructor(
    readonly threadId: string,
    private readonly options: CodexRealtimeOptions,
    private readonly request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  ) {
    this.closed = new Promise((resolve) => { this.resolveClosed = resolve })
    this.answer = new Promise((resolve, reject) => {
      this.resolveAnswer = resolve
      this.rejectAnswer = reject
    })
    // A process can exit before start() reaches its SDP await.
    void this.answer.catch(() => {})
    options.signal?.addEventListener('abort', this.onAbort, { once: true })
  }

  async start(): Promise<CodexRealtimeSession> {
    if (this.options.signal?.aborted || this.state !== 'open') {
      this.finish()
      throw new Error('Native voice was canceled before startup.')
    }
    const response = readCodexRecord(await this.request('thread/realtime/start', {
      threadId: this.threadId,
      realtimeSessionId: this.options.sessionId,
      version: 'v3',
      clientManagedInputs: true,
      clientManagedHandoffs: true,
      includeStartupContext: false,
      flushTranscriptTailOnSessionEnd: false,
      outputModality: 'audio',
      prompt: this.options.prompt,
      ...(this.options.voice ? { voice: this.options.voice } : {}),
      transport: { type: 'webrtc', sdp: this.options.sdp },
    }))
    if (response?.clientManagedInputs !== true) {
      throw new Error('Native voice requires the patched host-managed input protocol.')
    }
    const sdp = await withCodexRpcTimeout(this.answer, 30_000, 'voice SDP')
    if (this.state !== 'open') throw new Error('Native voice closed during startup.')
    return {
      sdp,
      closed: this.closed,
      speak: async (text) => {
        if (this.state !== 'open') throw new Error('Native voice is closed.')
        await this.request('thread/realtime/appendSpeech', { threadId: this.threadId, text })
      },
      close: () => this.close(),
    }
  }

  handle(message: CodexRpcMessage): boolean {
    const params = readCodexRecord(message.params)
    if (!isCodexRealtimeNotification(message) || params?.threadId !== this.threadId) return false

    if (message.method === 'thread/realtime/sdp' && typeof params.sdp === 'string') {
      this.resolveAnswer(params.sdp)
    } else if (message.method === 'thread/realtime/itemAdded') {
      this.handleItem(readCodexRecord(params.item))
    } else if (message.method === 'thread/realtime/closed') {
      this.finish()
    } else if (message.method === 'thread/realtime/error') {
      // Provider error text can contain private context. Keep it out of host errors.
      this.rejectAnswer(new Error('Native voice transport failed.'))
      void this.close()
    }
    return true
  }

  processClosed(): void {
    this.finish()
  }

  close(): Promise<CodexRealtimeClosure> {
    if (this.state === 'open') this.state = 'closing'
    this.closing ??= this.stop()
    return this.closing
  }

  private async stop(): Promise<CodexRealtimeClosure> {
    if (this.state !== 'closed') {
      try {
        await this.request('thread/realtime/stop', { threadId: this.threadId })
        await withCodexRpcTimeout(this.closed, 10_000, 'voice closure')
      } catch {
        // A timeout or process loss never becomes a confirmed provider receipt.
        this.finish()
      }
    }
    try {
      await this.request('thread/unsubscribe', { threadId: this.threadId })
    } catch {
      // A lost process already releases its in-memory media thread.
    }
    return await this.closed
  }

  private handleItem(item: Record<string, unknown> | null): void {
    if (!item || this.state === 'closed') return
    if (item.type === 'input.requested') {
      if (this.state !== 'open' || item.realtimeSessionId !== this.options.sessionId) return
      const inputId = readCodexNonEmptyString(item.inputId)
      const text = readCodexNonEmptyString(item.text)
      if (!inputId || !text) {
        void this.close()
        return
      }
      try {
        this.options.onInput({ inputId, text })
      } catch {
        void this.close()
      }
    } else if (item.type === 'session.usage.updated' || item.type === 'session.closed') {
      const providerSessionId = readCodexNonEmptyString(readCodexRecord(item.session)?.id)
      const seconds = readCodexRecord(item.usage)?.seconds
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
        void this.close()
        return
      }
      try {
        this.options.onUsage?.(seconds)
      } catch {
        void this.close()
      }
      if (item.type === 'session.closed' && providerSessionId) {
        this.receipt = { providerConfirmed: true, providerSessionId, seconds }
        this.state = 'closing'
      }
    }
  }

  private finish(): void {
    if (this.state === 'closed') return
    this.state = 'closed'
    this.options.signal?.removeEventListener('abort', this.onAbort)
    this.rejectAnswer(new Error('Native voice closed before its connection answer.'))
    this.resolveClosed(this.receipt)
  }
}
