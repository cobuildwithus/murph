import assert from 'node:assert/strict'
import { test } from 'vitest'

import { collectVaultCliDescriptorRootCommandNames } from '../src/vault-cli-command-manifest.ts'
import { classifyVaultCliInvocation } from '../src/vault-cli-routing.ts'
import { runRawCli } from './cli-test-helpers.js'

const scopedRoots = collectVaultCliDescriptorRootCommandNames().filter(
  (root) => classifyVaultCliInvocation([root]).kind === 'scoped',
)

test.each(scopedRoots)('built scoped %s command loads its real command family', async (root) => {
  const help = await runRawCli([root, '--help'], {
    env: { MURPH_CLI_TEST_PERSISTENT_HARNESS: '0' },
  })
  assert.match(help, new RegExp(`Usage: vault-cli ${root}(?: |\\n|$)`, 'u'))
  assert.doesNotMatch(help, /(?:Unknown command|Command not found)/u)
}, 120_000)

const intentionallyFullOnlyRootCommandReasons = {
  audit: 'Audit commands are operator/maintenance oriented and can keep full discovery.',
  document: 'Document import/show/list is not part of the optimized onboarding path.',
  export: 'Export is an occasional full-vault operator path.',
  family: 'Generic health CRUD root not currently a measured hot path.',
  genetics: 'Generic health CRUD root not currently a measured hot path.',
  intake: 'Intake helper commands are not currently a frequent agent path.',
  intervention: 'Intervention helper commands are not currently a frequent agent path.',
  model: 'Model commands are runtime/model-card operator diagnostics.',
  provider: 'Provider registry commands are not currently a frequent agent path.',
  recipe: 'Recipe commands are not currently part of the optimized onboarding path.',
  samples: 'Samples commands cover explicit raw/debug sample paths.',
  'scheduled-log': 'Scheduled-log commands are older operational helpers.',
} as const satisfies Record<string, string>

test('lazy route table accounts for every full manifest root command', async () => {
  const { collectVaultCliDescriptorRootCommandNames } = await import(
    '../src/vault-cli-command-manifest.ts'
  )
  const manifestRootCommands = collectVaultCliDescriptorRootCommandNames()
  const intentionallyFullOnlyRootCommands = new Set(
    Object.keys(intentionallyFullOnlyRootCommandReasons),
  )
  const staleFullOnlyEntries = [...intentionallyFullOnlyRootCommands].filter(
    (root) => !manifestRootCommands.includes(root),
  )
  assert.deepEqual(staleFullOnlyEntries, [])

  const unaccountedRootCommands: string[] = []
  for (const root of manifestRootCommands) {
    const plan = classifyVaultCliInvocation([root])
    if (plan.kind === 'scoped') {
      continue
    }

    if (intentionallyFullOnlyRootCommands.has(root)) {
      continue
    }

    unaccountedRootCommands.push(
      plan.kind === 'full' ? `${root}:${plan.reason}` : root,
    )
  }

  assert.deepEqual(unaccountedRootCommands, [])

  for (const root of ['assistant', 'run', 'status', 'doctor', 'stop'] as const) {
    assert.deepEqual(classifyVaultCliInvocation([root]), {
      kind: 'scoped',
      root,
    })
  }
}, 120_000)
