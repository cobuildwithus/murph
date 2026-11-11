import { describe, expect, it } from 'vitest'

import {
  assistantApprovalPolicyValues,
  assistantChatProviderValues,
  assistantCodexModelTargetSchema,
  assistantProviderSessionOptionsSchema,
} from '../src/assistant-cli-contracts.ts'
import {
  assistantExecutionDriverValues,
  assistantResumeKindValues,
} from '../src/assistant/target-runtime.ts'

describe('operator config Codex-only hard-cut contracts', () => {
  it('keeps Codex as the only active assistant runtime provider value', () => {
    expect(assistantChatProviderValues).toEqual(['codex-cli'])
    expect(assistantExecutionDriverValues).toEqual(['codex-app-server'])
    expect(assistantResumeKindValues).toEqual(['codex-thread'])
  })

  it('keeps assistant approval policy permanently noninteractive', () => {
    expect(assistantApprovalPolicyValues).toEqual(['never'])
    expect(
      assistantCodexModelTargetSchema.parse({
        adapter: 'codex-cli',
        approvalPolicy: 'never',
      }),
    ).toMatchObject({
      approvalPolicy: 'never',
    })
    expect(() =>
      assistantCodexModelTargetSchema.parse({
        adapter: 'codex-cli',
        approvalPolicy: 'on-request',
      }),
    ).toThrow()
    expect(() =>
      assistantProviderSessionOptionsSchema.parse({
        continuityFingerprint: 'codex:policy',
        executionDriver: 'codex-app-server',
        model: null,
        oss: false,
        profile: null,
        provider: 'codex-cli',
        reasoningEffort: 'medium',
        resumeKind: 'codex-thread',
        sandbox: 'danger-full-access',
        approvalPolicy: 'untrusted',
      }),
    ).toThrow()
  })

})
