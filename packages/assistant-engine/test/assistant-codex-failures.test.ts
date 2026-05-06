import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_CODEX_USAGE_LIMIT_ERROR_CODE,
  buildCodexConnectionFailureMessage,
  buildCodexFailure,
  buildCodexInterruptedError,
  buildCodexProcessExitError,
  buildCodexStdinFailureFallback,
  buildCodexTurnFailedError,
  extractCodexThreadIdFromResult,
  extractCodexTurnErrorMessage,
  extractCodexTurnIdFromMessage,
  extractCodexTurnIdFromResult,
  extractCodexTurnStatus,
  isFailedCodexTurnStatus,
  readNodeErrorCode,
} from '../src/assistant-codex/failures.ts'

describe('assistant Codex failure helpers', () => {
  it('extracts turn identifiers, statuses, and error messages from fallback shapes', () => {
    expect(
      extractCodexThreadIdFromResult({
        thread: {
          id: '  ',
        },
        threadId: ' thread-fallback ',
      }),
    ).toBe('thread-fallback')
    expect(
      extractCodexTurnIdFromResult({
        turn: {
          id: '',
        },
        turnId: ' turn-fallback ',
      }),
    ).toBe('turn-fallback')
    expect(
      extractCodexTurnIdFromMessage({
        params: {
          turn: {
            id: ' ',
          },
          turnId: ' turn-message-fallback ',
        },
      }),
    ).toBe('turn-message-fallback')
    expect(
      extractCodexTurnStatus({
        params: {
          turn: {
            id: 'turn-with-params-status',
          },
          status: 'FAILED',
        },
      }),
    ).toBe('FAILED')

    expect(
      extractCodexTurnErrorMessage({
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
        params: {
          turn: {
            error: '  turn error string  ',
          },
        },
      }),
    ).toBe('turn error string')
    expect(
      extractCodexTurnErrorMessage({
        params: {
          error: {
            message: '  params error object  ',
          },
        },
      }),
    ).toBe('params error object')
    expect(
      extractCodexTurnErrorMessage({
        params: {
          error: '  params error string  ',
        },
      }),
    ).toBe('params error string')
    expect(extractCodexTurnErrorMessage({ params: null })).toBeNull()

    expect(isFailedCodexTurnStatus(null)).toBe(false)
  })

  it('builds typed turn-failure and interruption errors', () => {
    expect(
      buildCodexTurnFailedError({
        fallback: '  model returned an invalid terminal event  ',
        providerActionCount: 2,
        providerSessionId: 'thread-1',
        status: 'failed',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexFailureDetailPresent: true,
        codexFailureStage: 'turn_failed',
        providerActionCount: 2,
        providerSessionId: 'thread-1',
        retryable: false,
      },
      message:
        'Codex app-server turn failed. status failed. model returned an invalid terminal event',
    })

    expect(
      buildCodexTurnFailedError({
        fallback: null,
        providerActionCount: 0,
        providerSessionId: null,
        status: 'interrupted',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_INTERRUPTED',
      context: {
        codexFailureStage: 'interrupted',
        interrupted: true,
        providerSessionId: null,
        retryable: false,
      },
      message: 'Codex app-server was interrupted.',
    })
  })

  it('builds specific usage-limit errors for quota and credit exhaustion', () => {
    expect(
      buildCodexTurnFailedError({
        fallback: 'Quota exceeded. Check your plan and billing details.',
        providerActionCount: 0,
        providerSessionId: 'thread-usage-limit',
        status: 'failed',
      }),
    ).toMatchObject({
      code: ASSISTANT_CODEX_USAGE_LIMIT_ERROR_CODE,
      context: {
        codexFailureDetailPresent: true,
        codexFailureStage: 'turn_failed',
        codexTurnStatus: 'failed',
        providerActionCount: 0,
        providerSessionId: 'thread-usage-limit',
        providerUsageLimit: true,
        retryable: false,
      },
      message:
        'Codex app-server turn failed. status failed. Quota exceeded. Check your plan and billing details.',
    })

    expect(
      buildCodexFailure({
        code: 1,
        fallback: 'Purchase more credits before retrying.',
        providerActionCount: 1,
        providerSessionId: 'thread-process-exit',
        signal: null,
        stderr: '',
      }),
    ).toMatchObject({
      code: ASSISTANT_CODEX_USAGE_LIMIT_ERROR_CODE,
      context: {
        codexExitCode: 1,
        codexFailureStage: 'process_exit',
        providerActionCount: 1,
        providerSessionId: null,
        providerUsageLimit: true,
        retryable: false,
      },
      message: 'Codex app-server failed. exit code 1. Purchase more credits before retrying.',
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
        abortRequested: false,
        code: null,
        fallback: null,
        providerActionCount: 1,
        providerSessionId: 'thread-sigint',
        signal: 'SIGINT',
        stderr: '',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_INTERRUPTED',
      context: {
        providerActionCount: 1,
        providerSessionId: 'thread-sigint',
      },
      message: expect.stringContaining('signal SIGINT.'),
    })

    expect(
      buildCodexInterruptedError({
        providerActionCount: 0,
        providerSessionId: null,
        signal: 'SIGTERM',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_INTERRUPTED',
      message: 'Codex app-server was interrupted. signal SIGTERM.',
    })

    expect(
      buildCodexConnectionFailureMessage({
        code: null,
        fallback: null,
        providerSessionId: null,
        signal: 'SIGTERM',
        stderr: '',
      }),
    ).toBe(
      'Codex app-server lost its connection while waiting for the model. signal SIGTERM. Restore connectivity, then retry the request.',
    )

    expect(
      buildCodexFailure({
        code: null,
        fallback: null,
        providerActionCount: 3,
        providerSessionId: 'thread-terminal',
        signal: 'SIGTERM',
        stderr: '',
      }),
    ).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        connectionLost: false,
        codexFailureDetailPresent: false,
        codexFailureStage: 'process_exit',
        codexSignalPresent: true,
        codexStderrPresent: false,
        providerActionCount: 3,
        providerSessionId: null,
        retryable: false,
      },
      message: 'Codex app-server failed. signal SIGTERM.',
    })

    expect(readNodeErrorCode(null)).toBeNull()
    expect(readNodeErrorCode({ code: ' ERR_STREAM_DESTROYED ' })).toBe(
      'ERR_STREAM_DESTROYED',
    )
  })
})
