import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_CODEX_USAGE_LIMIT_ERROR_CODE,
  buildCodexConnectionFailureMessage,
  buildCodexFailure,
  buildCodexInterruptedError,
  buildCodexProcessExitError,
  buildCodexStdinFailureFallback,
  buildCodexTurnFailedError,
  extractCodexThreadIdFromMessage,
  extractCodexThreadIdFromResult,
  extractCodexTurnErrorMessage,
  extractCodexTurnIdFromMessage,
  extractCodexTurnIdFromResult,
  extractCodexTurnStatus,
  isFailedCodexTurnStatus,
  readNodeErrorCode,
} from '../src/assistant-codex/failures.ts'

describe('assistant Codex failure helpers', () => {
  function expectNoRecoveredThreadResumeClaim(message: string): void {
    expect(message).not.toMatch(/preserved.*Codex thread/iu)
    expect(message).not.toMatch(/recovered.*Codex thread/iu)
    expect(message).not.toMatch(/resume it/iu)
  }

  it('extracts canonical turn fields and rejects compatibility aliases', () => {
    expect(
      extractCodexThreadIdFromResult({
        thread: {
          id: ' thread-result ',
        },
      }),
    ).toBe('thread-result')
    expect(extractCodexThreadIdFromResult({
      threadId: 'thread-flat-alias',
    })).toBeNull()
    expect(
      extractCodexTurnIdFromResult({
        turn: {
          id: ' turn-result ',
        },
      }),
    ).toBe('turn-result')
    expect(extractCodexTurnIdFromResult({
      turnId: 'turn-flat-alias',
    })).toBeNull()
    expect(
      extractCodexTurnIdFromMessage({
        method: 'turn/completed',
        params: {
          turn: {
            id: ' turn-nested ',
          },
        },
      }),
    ).toBe('turn-nested')
    expect(
      extractCodexTurnIdFromMessage({
        method: 'thread/tokenUsage/updated',
        params: {
          turnId: ' turn-flat-canonical ',
        },
      }),
    ).toBe('turn-flat-canonical')
    expect(
      extractCodexTurnStatus({
        method: 'turn/completed',
        params: {
          turn: {
            id: 'turn-with-params-status',
            status: 'failed',
          },
        },
      }),
    ).toBe('failed')
    expect(extractCodexTurnStatus({
      method: 'turn/completed',
      params: { status: 'failed' },
    })).toBeNull()

    expect(
      extractCodexTurnErrorMessage({
        method: 'turn/completed',
        params: {
          turn: {
            error: {
              message: '  nested turn error  ',
            },
          },
        },
      }),
    ).toBe('nested turn error')
    expect(
      extractCodexTurnErrorMessage({
        method: 'error',
        params: {
          error: {
            message: '  params error object  ',
          },
        },
      }),
    ).toBe('params error object')
    expect(extractCodexTurnErrorMessage({
      method: 'turn/completed',
      params: { turn: { error: 'turn error string alias' } },
    })).toBeNull()
    expect(extractCodexTurnErrorMessage({
      method: 'turn/completed',
      params: { error: { message: 'params error alias' } },
    })).toBeNull()
    expect(extractCodexTurnErrorMessage({ params: null })).toBeNull()

    expect(isFailedCodexTurnStatus(null)).toBe(false)
  })

  it('extracts canonical notification thread fields and rejects legacy envelopes', () => {
    expect(
      extractCodexThreadIdFromMessage({
        method: 'turn/completed',
        params: {
          thread: {
            id: 'thread-nested-loses',
          },
          threadId: ' thread-flat-wins ',
        },
      }),
    ).toBe('thread-flat-wins')

    expect(
      extractCodexThreadIdFromMessage({
        method: 'thread/started',
        params: {
          thread: {
            id: ' thread-nested ',
          },
        },
      }),
    ).toBe('thread-nested')
    expect(
      extractCodexThreadIdFromMessage({
        method: 'turn/completed',
        params: {
          thread_id: 'thread-params-snake',
        },
      }),
    ).toBeNull()

    expect(
      extractCodexThreadIdFromMessage({
        method: 'turn/completed',
        data: {
          threadId: 'thread-data-camel',
        },
        params: {},
      }),
    ).toBeNull()
    expect(
      extractCodexThreadIdFromMessage({
        method: 'turn/completed',
        params: {},
        thread: {
          id: 'thread-top-nested',
        },
      }),
    ).toBeNull()
    expect(
      extractCodexThreadIdFromMessage({
        method: 'turn/completed',
        params: {},
        threadId: 'thread-top-camel',
      }),
    ).toBeNull()

    // Absent or blank ids never produce a thread id, so thread routing can
    // never misclassify a thread-id-less parent event as a subagent event.
    expect(extractCodexThreadIdFromMessage({
      method: 'turn/completed',
      params: {},
    })).toBeNull()
    expect(
      extractCodexThreadIdFromMessage({
        method: 'turn/completed',
        params: {
          threadId: '   ',
        },
      }),
    ).toBeNull()
    expect(
      extractCodexThreadIdFromMessage({
        method: 'turn/completed',
        params: {
          turnId: 'turn-without-thread',
        },
      }),
    ).toBeNull()
  })

  it('builds typed turn-failure and interruption errors', () => {
    expect(
      buildCodexTurnFailedError({
        errorInfo: null,
        fallback: '  model returned an invalid terminal event  ',
        providerActionCount: 2,
        codexThreadId: 'thread-1',
        status: 'failed',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexErrorInfoPresent: false,
        codexFailureDetailPresent: true,
        codexFailureStage: 'turn_failed',
        providerActionCount: 2,
        codexThreadIdPresent: true,
        retryable: false,
      },
      message:
        'Codex app-server turn failed. status failed. model returned an invalid terminal event',
    })

    expect(
      buildCodexTurnFailedError({
        errorInfo: null,
        fallback: null,
        providerActionCount: 0,
        codexThreadId: null,
        status: 'interrupted',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_INTERRUPTED',
      context: {
        codexFailureStage: 'interrupted',
        interrupted: true,
        codexThreadIdPresent: false,
        retryable: false,
      },
      message: 'Codex app-server was interrupted.',
    })
  })

  it('classifies usage-limit failures from structured codexErrorInfo, not message text', () => {
    // Message text deliberately matches none of the historical usage-limit
    // phrases: classification must come from the protocol enum, so provider
    // rewording can no longer break it (June 2026 quota incident).
    expect(
      buildCodexTurnFailedError({
        errorInfo: {
          httpStatusCode: null,
          kind: 'usageLimitExceeded',
        },
        fallback: 'You have reached your monthly cap.',
        providerActionCount: 0,
        codexThreadId: 'thread-usage-limit',
        status: 'failed',
      }),
    ).toMatchObject({
      code: ASSISTANT_CODEX_USAGE_LIMIT_ERROR_CODE,
      context: {
        codexErrorInfo: 'usageLimitExceeded',
        codexErrorInfoPresent: true,
        codexFailureDetailPresent: true,
        codexFailureStage: 'turn_failed',
        codexTurnStatus: 'failed',
        providerActionCount: 0,
        codexThreadIdPresent: true,
        providerUsageLimit: true,
        retryable: false,
      },
      message:
        'Codex app-server turn failed. status failed. You have reached your monthly cap.',
    })

    // Quota-sounding text WITHOUT structured info no longer classifies as a
    // usage limit: text matching is gone from the turn-failed path.
    expect(
      buildCodexTurnFailedError({
        errorInfo: null,
        fallback: 'Quota exceeded. Check your plan and billing details.',
        providerActionCount: 0,
        codexThreadId: 'thread-usage-limit-text-only',
        status: 'failed',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexErrorInfoPresent: false,
      },
    })

    expect(
      buildCodexFailure({
        code: 1,
        errorInfo: {
          httpStatusCode: null,
          kind: 'usageLimitExceeded',
        },
        fallback: 'Top up to continue.',
        providerActionCount: 1,
        codexThreadId: 'thread-process-exit',
        signal: null,
        stderr: '',
      }),
    ).toMatchObject({
      code: ASSISTANT_CODEX_USAGE_LIMIT_ERROR_CODE,
      context: {
        codexErrorInfo: 'usageLimitExceeded',
        codexErrorInfoPresent: true,
        codexExitCode: 1,
        codexFailureStage: 'process_exit',
        providerActionCount: 1,
        codexThreadIdPresent: true,
        providerUsageLimit: true,
        retryable: false,
      },
      message: 'Codex app-server failed. exit code 1. Top up to continue.',
    })
  })

  it('classifies connection loss from structured codexErrorInfo when present', () => {
    expect(
      buildCodexTurnFailedError({
        errorInfo: null,
        fallback:
          'stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses)',
        providerActionCount: 0,
        codexThreadId: 'thread-turn-connection-text',
        status: 'failed',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_CONNECTION_LOST',
      context: {
        codexErrorInfoPresent: false,
        codexFailureStage: 'connection_lost',
        codexTurnStatus: 'failed',
        connectionLost: true,
        providerActionCount: 0,
        recoverableConnectionLoss: true,
        retryable: true,
      },
      message:
        'Codex app-server lost its connection while waiting for the model. stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses) Codex thread id was captured for diagnostics only. Restore connectivity, then retry the request.',
    })

    expect(
      buildCodexTurnFailedError({
        errorInfo: {
          httpStatusCode: null,
          kind: 'responseStreamDisconnected',
        },
        fallback: 'an entirely novel provider transport message',
        providerActionCount: 0,
        codexThreadId: 'thread-turn-structured-connection',
        status: 'failed',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_CONNECTION_LOST',
      context: {
        codexErrorInfo: 'responseStreamDisconnected',
        codexErrorInfoPresent: true,
        connectionLost: true,
        recoverableConnectionLoss: true,
        retryable: true,
      },
    })

    // Structured non-connection errors remain terminal even if the text looks
    // like a transport failure.
    expect(
      buildCodexTurnFailedError({
        errorInfo: {
          httpStatusCode: null,
          kind: 'internalServerError',
        },
        fallback: 'stream disconnected before completion: connection reset',
        providerActionCount: 0,
        codexThreadId: 'thread-turn-structured-non-connection',
        status: 'failed',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexErrorInfo: 'internalServerError',
        codexFailureStage: 'turn_failed',
        connectionLost: false,
        retryable: false,
      },
    })

    expect(
      buildCodexFailure({
        code: null,
        errorInfo: {
          httpStatusCode: 502,
          kind: 'httpConnectionFailed',
        },
        fallback: 'an entirely novel provider transport message',
        providerActionCount: 1,
        codexThreadId: 'thread-structured-connection',
        signal: null,
        stderr: '',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_CONNECTION_LOST',
      context: {
        codexErrorHttpStatusCode: 502,
        codexErrorInfo: 'httpConnectionFailed',
        codexErrorInfoPresent: true,
        recoverableConnectionLoss: true,
        retryable: true,
      },
    })

    // When structured info names a non-connection failure, connection-loss
    // sounding text must not override it.
    expect(
      buildCodexFailure({
        code: null,
        errorInfo: {
          httpStatusCode: null,
          kind: 'internalServerError',
        },
        fallback: 'stream disconnected before completion: connection reset',
        providerActionCount: 1,
        codexThreadId: 'thread-structured-non-connection',
        signal: null,
        stderr: '',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexErrorInfo: 'internalServerError',
        connectionLost: false,
        retryable: false,
      },
    })
  })

  it('combines stdin write fallback details without duplicating identical messages', () => {
    expect(
      buildCodexStdinFailureFallback({
        error: {
          message: '  write EPIPE  ',
        },
        lastEventError: null,
        stderr: '',
      }),
    ).toBe('write EPIPE')

    expect(
      buildCodexStdinFailureFallback({
        error: new Error('same failure'),
        lastEventError: 'same failure',
        stderr: '',
      }),
    ).toBe('same failure')

    expect(
      buildCodexStdinFailureFallback({
        error: new Error('stream closed'),
        lastEventError: null,
        stderr: 'one\ntwo\nthree\nfour',
      }),
    ).toBe('two three four stream closed')

    expect(
      buildCodexStdinFailureFallback({
        error: {
          message: ' ',
        },
        lastEventError: 'last event detail',
        stderr: '',
      }),
    ).toBe('last event detail')
  })

  it('builds process, connection, and node-error failure details for edge branches', () => {
    expect(
      buildCodexProcessExitError({
        abortOwnsTermination: false,
        code: null,
        errorInfo: null,
        fallback: null,
        providerActionCount: 1,
        codexThreadId: 'thread-sigint',
        signal: 'SIGINT',
        stderr: '',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexFailureStage: 'process_exit',
        providerActionCount: 1,
        codexThreadIdPresent: true,
      },
      message: expect.stringContaining('signal SIGINT.'),
    })

    // Abort wins over structured error info: an interrupted turn stays
    // INTERRUPTED even when a usage-limit error arrived before the abort.
    expect(
      buildCodexProcessExitError({
        abortOwnsTermination: true,
        code: null,
        errorInfo: {
          httpStatusCode: null,
          kind: 'usageLimitExceeded',
        },
        fallback: 'You have reached your monthly cap.',
        providerActionCount: 1,
        codexThreadId: 'thread-abort-over-error-info',
        signal: null,
        stderr: '',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_INTERRUPTED',
      context: {
        interrupted: true,
        retryable: false,
      },
    })

    expect(
      buildCodexInterruptedError({
        providerActionCount: 0,
        codexThreadId: 'thread-interrupted-diagnostics',
        signal: 'SIGTERM',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_INTERRUPTED',
      message:
        'Codex app-server was interrupted. signal SIGTERM. Codex thread id was captured for diagnostics only. Retry the request when ready.',
    })
    expectNoRecoveredThreadResumeClaim(
      buildCodexInterruptedError({
        providerActionCount: 0,
        codexThreadId: 'thread-interrupted-diagnostics',
        signal: 'SIGTERM',
      }).message,
    )

    expect(
      buildCodexConnectionFailureMessage({
        code: null,
        fallback: null,
        codexThreadId: 'thread-connection-diagnostics',
        signal: 'SIGTERM',
        stderr: '',
      }),
    ).toBe(
      'Codex app-server lost its connection while waiting for the model. signal SIGTERM. Codex thread id was captured for diagnostics only. Restore connectivity, then retry the request.',
    )
    expectNoRecoveredThreadResumeClaim(
      buildCodexConnectionFailureMessage({
        code: null,
        fallback: null,
        codexThreadId: 'thread-connection-diagnostics',
        signal: 'SIGTERM',
        stderr: '',
      }),
    )

    expect(
      buildCodexFailure({
        code: null,
        errorInfo: null,
        fallback: null,
        providerActionCount: 3,
        codexThreadId: 'thread-terminal',
        signal: 'SIGTERM',
        stderr: '',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        connectionLost: false,
        codexFailureDetailPresent: false,
        codexFailureStage: 'process_exit',
        codexExitSignal: 'SIGTERM',
        codexSignalPresent: true,
        codexStderrPresent: false,
        providerActionCount: 3,
        codexThreadIdPresent: true,
        retryable: false,
      },
      message: 'Codex app-server failed. signal SIGTERM.',
    })

    expect(
      buildCodexProcessExitError({
        abortOwnsTermination: false,
        code: null,
        errorInfo: null,
        diagnostics: {
          abortRequested: false,
          jsonEventCount: 3,
          lifecycleStage: 'turn_running',
          liveTurnOpen: true,
          pendingRpcCount: 1,
          pendingRpcMethod: 'turn/start',
          processGroupPresent: true,
          processLifetimeMs: 2_041,
          providerRequestStarted: true,
          shutdownRequested: false,
          stderrBytes: 128,
          terminationSignalSent: null,
        },
        fallback: null,
        providerActionCount: 0,
        codexThreadId: 'thread-sigkill-diagnostics',
        signal: 'SIGKILL',
        stderr: '',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexAbortRequested: false,
        codexExitSignal: 'SIGKILL',
        codexFailureStage: 'process_exit',
        codexJsonEventCount: 3,
        codexLifecycleStage: 'turn_running',
        codexLiveTurnOpen: true,
        codexPendingRpcCount: 1,
        codexPendingRpcMethod: 'turn/start',
        codexProcessGroupPresent: true,
        codexProcessLifetimeMs: 2041,
        codexProviderRequestStarted: true,
        codexShutdownRequested: false,
        codexSignalPresent: true,
        codexStderrBytes: 128,
        providerActionCount: 0,
      },
      message: 'Codex app-server failed. signal SIGKILL.',
    })

    const interruptedWithDiagnostics = buildCodexProcessExitError({
      abortOwnsTermination: true,
      code: null,
      errorInfo: null,
      diagnostics: {
        abortRequested: true,
        jsonEventCount: Number.POSITIVE_INFINITY,
        lifecycleStage: 'turn running with details',
        pendingRpcCount: -1,
        pendingRpcMethod: 'turn start with details',
        processLifetimeMs: 3.5,
        shutdownRequested: true,
        stderrBytes: 0,
        terminationSignalSent: 'SIGTERM',
      },
      fallback: null,
      providerActionCount: 0,
      codexThreadId: null,
      signal: 'SIGTERM',
      stderr: '',
    })
    expect(interruptedWithDiagnostics).toMatchObject({
      code: 'ASSISTANT_CODEX_INTERRUPTED',
      context: {
        codexAbortRequested: true,
        codexDiagnosticsPresent: true,
        codexExitSignal: 'SIGTERM',
        codexFailureStage: 'interrupted',
        codexShutdownRequested: true,
        codexStderrBytes: 0,
        codexTerminationSignalSent: 'SIGTERM',
        interrupted: true,
      },
      message: 'Codex app-server was interrupted. signal SIGTERM.',
    })
    expect(interruptedWithDiagnostics.context).not.toHaveProperty(
      'codexJsonEventCount',
    )
    expect(interruptedWithDiagnostics.context).not.toHaveProperty(
      'codexLifecycleStage',
    )
    expect(interruptedWithDiagnostics.context).not.toHaveProperty(
      'codexPendingRpcCount',
    )
    expect(interruptedWithDiagnostics.context).not.toHaveProperty(
      'codexPendingRpcMethod',
    )
    expect(interruptedWithDiagnostics.context).not.toHaveProperty(
      'codexProcessLifetimeMs',
    )

    // No structured info ever arrived (true process-crash path): stderr/text
    // sniffing still classifies the connection loss.
    const connectionLoss = buildCodexFailure({
      code: 1,
      errorInfo: null,
      fallback: 'connection closed before response.completed',
      providerActionCount: 1,
      codexThreadId: 'thread-stream-diagnostics',
      signal: null,
      stderr: '',
    })
    expect(connectionLoss).toMatchObject({
      code: 'ASSISTANT_CODEX_CONNECTION_LOST',
      context: {
        codexThreadIdPresent: true,
        recoverableConnectionLoss: true,
        retryable: true,
      },
      message:
        'Codex app-server lost its connection while waiting for the model. exit code 1. connection closed before response.completed Codex thread id was captured for diagnostics only. Restore connectivity, then retry the request.',
    })
    expect(JSON.stringify(connectionLoss.context)).not.toContain(
      'thread-stream-diagnostics',
    )
    expectNoRecoveredThreadResumeClaim(connectionLoss.message)

    expect(readNodeErrorCode(null)).toBeNull()
    expect(readNodeErrorCode({ code: ' ERR_STREAM_DESTROYED ' })).toBe(
      'ERR_STREAM_DESTROYED',
    )
  })
})
