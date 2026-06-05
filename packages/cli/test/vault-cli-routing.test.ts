import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
  classifyVaultCliInvocation,
  detectCliProgramName,
  planVaultCliInvocation,
} from '../src/vault-cli-routing.ts'

test('classifier scopes obvious lazy roots without parsing nested command args', () => {
  for (const root of [
    'assistant',
    'automation',
    'blood-test',
    'chat',
    'doctor',
    'goal',
    'list',
    'measurement',
    'memory',
    'protocol',
    'query',
    'regimen',
    'run',
    'search',
    'show',
    'status',
    'stop',
    'supplement',
    'timeline',
    'wearables',
  ] as const) {
    assert.deepEqual(classifyVaultCliInvocation([root, '--weird-command-flag']), {
      kind: 'scoped',
      root,
    })
  }
  assert.deepEqual(classifyVaultCliInvocation(['device', 'account', 'list']), {
    kind: 'scoped',
    root: 'device',
  })
  assert.deepEqual(classifyVaultCliInvocation(['device', '--weird-command-flag']), {
    kind: 'scoped',
    root: 'device',
  })
  assert.deepEqual(
    classifyVaultCliInvocation(['--format', 'json', 'experiment', 'list']),
    {
      kind: 'scoped',
      root: 'experiment',
    },
  )
})

test('classifier falls back to the full graph for ambiguous leading syntax', () => {
  assert.deepEqual(classifyVaultCliInvocation(['--unknown', 'device']), {
    kind: 'full',
    reason: 'unknown-leading-flag',
  })
  assert.deepEqual(classifyVaultCliInvocation(['--help']), {
    kind: 'full',
    reason: 'root-discovery',
  })
  assert.deepEqual(classifyVaultCliInvocation(['--help', 'device']), {
    kind: 'full',
    reason: 'root-discovery-before-root',
  })
  assert.deepEqual(classifyVaultCliInvocation(['--version', 'device']), {
    kind: 'full',
    reason: 'unknown-leading-flag',
  })
  assert.deepEqual(classifyVaultCliInvocation(['--', 'device']), {
    kind: 'full',
    reason: 'argument-terminator-before-root',
  })
  assert.deepEqual(classifyVaultCliInvocation(['completions', 'bash']), {
    kind: 'full',
    reason: 'unknown-root',
  })
  assert.deepEqual(
    classifyVaultCliInvocation(['device', 'account', 'list'], {
      env: {
        COMP_LINE: 'vault-cli device ',
      },
    }),
    {
      kind: 'full',
      reason: 'completion-environment',
    },
  )
  assert.deepEqual(
    classifyVaultCliInvocation(['device', 'account', 'list'], {
      env: {
        COMPLETE: 'zsh',
      },
    }),
    {
      kind: 'full',
      reason: 'completion-environment',
    },
  )
  assert.deepEqual(
    classifyVaultCliInvocation(['device', 'account', 'list'], {
      env: {
        _COMPLETE_INDEX: '1',
      },
    }),
    {
      kind: 'full',
      reason: 'completion-environment',
    },
  )
})

test('classifier preserves version and setup routing before command imports', () => {
  assert.deepEqual(classifyVaultCliInvocation(['--version']), {
    kind: 'full',
    reason: 'unknown-leading-flag',
  })
  assert.deepEqual(classifyVaultCliInvocation(['onboard']), {
    kind: 'setup',
  })
  assert.deepEqual(
    classifyVaultCliInvocation(['--help'], {
      programName: 'murph',
    }),
    {
      kind: 'full',
      reason: 'root-discovery',
    },
  )
  for (const flag of ['--llms-full', '--schema', '--mcp']) {
    assert.deepEqual(
      classifyVaultCliInvocation([flag], {
        programName: 'murph',
      }),
      {
        kind: 'full',
        reason: 'root-discovery',
      },
    )
  }
  assert.deepEqual(
    classifyVaultCliInvocation([], {
      programName: 'murph',
    }),
    {
      kind: 'setup',
    },
  )
  assert.deepEqual(
    classifyVaultCliInvocation(['use', './vault'], {
      programName: 'murph',
    }),
    {
      kind: 'setup',
    },
  )
})

test('planner strips only the existing --vault override before classification', () => {
  assert.deepEqual(
    planVaultCliInvocation(['--vault', './vault', 'device', 'account', 'list']),
    {
      vaultOverride: {
        argv: ['device', 'account', 'list'],
        explicit: true,
        vault: './vault',
      },
      plan: {
        kind: 'scoped',
        root: 'device',
      },
    },
  )
})

test('program-name detection keeps murph shims independent of setup imports', () => {
  assert.equal(detectCliProgramName('/usr/local/bin/murph'), 'murph')
  assert.equal(detectCliProgramName('/usr/local/bin/vault-cli'), 'vault-cli')
  assert.equal(detectCliProgramName('/tmp/shim', 'murph'), 'murph')
})
