import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  assistantApprovalPolicyValues,
  assistantChatProviderValues,
  assistantCodexModelTargetSchema,
  assistantProviderSessionOptionsSchema,
} from '../src/assistant-cli-contracts.ts'
import {
  normalizeAssistantProviderConfig,
  serializeAssistantProviderSessionOptions,
} from '../src/assistant/provider-config.ts'
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

  it('serializes Vercel AI Gateway through Codex modelProvider config', () => {
    const sessionOptions = serializeAssistantProviderSessionOptions({
      provider: 'codex-cli',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
    })

    expect(assistantProviderSessionOptionsSchema.parse(sessionOptions)).toMatchObject({
      executionDriver: 'codex-app-server',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
      resumeKind: 'codex-thread',
    })
  })

  it('fails closed for removed provider config inputs', () => {
    expect(() =>
      normalizeAssistantProviderConfig({
        provider: 'unsupported-provider',
        model: 'gpt-5',
      }),
    ).toThrow(/Assistant runtime targets must use Codex App Server/u)
  })

  it('does not publish legacy provider presets', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports?: Record<string, unknown> }

    expect(
      Object.keys(packageJson.exports ?? {}).filter((key) =>
        key.includes('provider-presets'),
      ),
    ).toEqual([])
  })
})
