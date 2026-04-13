import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveOperatorConfigPath } from '@murphai/operator-config/operator-config'
import type { SetupStepResult } from '@murphai/operator-config/setup-cli-contracts'
import { configureSetupOperatorDefaults } from '../src/setup-services/operator-defaults.ts'

describe('configureSetupOperatorDefaults', () => {
  it('keeps default-vault and assistant-defaults sequencing inside the operator-defaults seam', async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), 'murph-setup-home-'))
    const vault = path.join(homeDirectory, 'vault')
    const steps: SetupStepResult[] = []
    const notes: string[] = []

    try {
      const assistant = await configureSetupOperatorDefaults({
        assistant: {
          preset: 'openai-compatible',
          enabled: true,
          provider: 'openai-compatible',
          model: 'gpt-5.4-mini',
          baseUrl: 'https://example.test/v1',
          apiKeyEnv: 'EXAMPLE_API_KEY',
          presetId: null,
          providerName: 'Example',
          codexCommand: null,
          profile: null,
          reasoningEffort: null,
          sandbox: null,
          approvalPolicy: null,
          oss: null,
          detail: 'configured for dry-run coverage',
        },
        dryRun: true,
        homeDirectory,
        notes,
        steps,
        vault,
      })

      expect(assistant?.provider).toBe('openai-compatible')
      expect(steps.map((step) => [step.id, step.status])).toEqual([
        ['default-vault', 'planned'],
        ['assistant-defaults', 'planned'],
      ])
      expect(notes).toEqual([
        'Export EXAMPLE_API_KEY before using the saved OpenAI-compatible assistant backend.',
      ])

      await expect(stat(resolveOperatorConfigPath(homeDirectory))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await rm(homeDirectory, { recursive: true, force: true })
    }
  })
})
