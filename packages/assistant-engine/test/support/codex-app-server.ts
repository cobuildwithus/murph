import {
  readMurphDynamicToolRequest,
  type MurphDynamicToolRequest,
} from '../../src/assistant-codex/dynamic-tools.ts'
import type {
  CodexRpcMessage,
} from '../../src/assistant-codex/app-server-rpc.ts'

const TEST_THREAD_ID = 'thread-test'
const TEST_TURN_ID = 'turn-test'
const TEST_CALL_ID = 'call-test'
const TEST_REQUEST_ID = 'request-test'

/**
 * Completes a unit-test tool payload with the request identity fields required
 * by the pinned Codex App Server protocol. Tests remain responsible for the
 * tool, namespace, and arguments they exercise.
 */
export function readTestMurphDynamicToolRequest(
  message: CodexRpcMessage,
): MurphDynamicToolRequest | null {
  const params = isRecord(message.params) ? message.params : {}
  return readMurphDynamicToolRequest({
    ...message,
    id: Object.hasOwn(message, 'id') ? message.id : TEST_REQUEST_ID,
    params: {
      callId: TEST_CALL_ID,
      threadId: TEST_THREAD_ID,
      turnId: TEST_TURN_ID,
      ...params,
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
