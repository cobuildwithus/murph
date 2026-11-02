import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
  classifyVaultCliInvocation,
  planVaultCliInvocation,
} from '../src/vault-cli-routing.ts'

test('classifier scopes obvious lazy roots without parsing nested command args', () => {
  for (const root of [
    'allergy',
    'assistant',
    'assertion',
    'automation',
    'blood-test',
    'capture',
    'clinical-note',
    'condition',
    'doctor',
    'diagnostic-test',
    'encounter',
    'event',
    'food',
    'goal',
    'list',
    'journal',
    'knowledge',
    'meal',
    'measurement',
    'memory',
    'protocol',
    'query',
    'regimen',
    'route',
    'run',
    'search',
    'show',
    'status',
    'stop',
    'social-history',
    'supplement',
    'timeline',
    'vitals',
    'wearables',
    'workout',
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

test('classifier keeps MCP invocations on the full command tree regardless of flag position', () => {
  for (const argv of [
    ['--mcp', 'condition'],
    ['condition', '--mcp'],
    ['condition', '--', '--mcp'],
  ]) {
    assert.deepEqual(classifyVaultCliInvocation(argv), {
      kind: 'full',
      reason: 'mcp-invocation',
    })
  }

  assert.deepEqual(
    classifyVaultCliInvocation(['condition', '--config', '--mcp']),
    {
      kind: 'scoped',
      root: 'condition',
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
  assert.deepEqual(
    planVaultCliInvocation(['--vault', './vault', '--version']),
    {
      vaultOverride: {
        argv: ['--version'],
        explicit: true,
        vault: './vault',
      },
      plan: {
        kind: 'full',
        reason: 'version-with-vault-override',
      },
    },
  )
})



test('classifier preserves version and treats retired setup routes as unknown commands', () => {
  assert.deepEqual(classifyVaultCliInvocation(['--version']), { kind: 'version' })
  assert.deepEqual(classifyVaultCliInvocation([]), { kind: 'full', reason: 'missing-root' })
  for (const root of ['onboard', 'use', 'model']) {
    assert.deepEqual(classifyVaultCliInvocation([root]), { kind: 'full', reason: 'unknown-root' })
  }
})
