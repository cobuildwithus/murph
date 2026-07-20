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
          preset: 'codex',
          enabled: true,
          provider: 'codex-cli',
          model: 'gpt-5.6-terra',
          modelProvider: 'vercel-ai-gateway',
          codexCommand: 'codex',
          codexHome: null,
          profile: null,
          reasoningEffort: 'medium',
          sandbox: 'danger-full-access',
          approvalPolicy: 'never',
          oss: false,
          detail: 'configured for dry-run coverage',
        },
        dryRun: true,
        homeDirectory,
        notes,
        steps,
        vault,
      })

      expect(assistant?.provider).toBe('codex-cli')
      expect(steps.map((step) => [step.id, step.status])).toEqual([
        ['default-vault', 'planned'],
        ['assistant-defaults', 'planned'],
      ])
      expect(notes).toEqual([])

      await expect(stat(resolveOperatorConfigPath(homeDirectory))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await rm(homeDirectory, { recursive: true, force: true })
    }
  })
})
