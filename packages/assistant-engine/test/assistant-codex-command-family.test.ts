import { describe, expect, it } from 'vitest'

import {
  resolveCodexCommandFamily,
  resolveCodexCommandAttribution,
} from '../src/assistant-codex/command-family.ts'

describe('Codex command family classification', () => {
  it.each([
    [['food', 'search-labels'], 'food.search-labels'],
    [['food', 'search-labels-batch'], 'food.search-labels-batch'],
    [['goal', 'list'], 'goal.list'],
    [['goal', 'show'], 'goal.show'],
    [['meal', 'add'], 'meal.add'],
    [['meal', 'edit'], 'meal.edit'],
    [['meal', 'nutrients'], 'meal.nutrients'],
    [['meal', 'show'], 'meal.show'],
    [['meal', 'totals'], 'meal.totals'],
    [['memory', 'show'], 'vault-cli memory show'],
  ] as const)('keeps the reviewed batch path %j as %s', (argv, expected) => {
    expect(resolveCodexCommandFamily({ argv, source: 'batch_argv' })).toBe(expected)
  })

  it('ignores batch arguments and collapses unknown paths', () => {
    expect(resolveCodexCommandFamily({
      argv: ['goal', 'list', '--query', 'private-query'],
      source: 'batch_argv',
    })).toBe('goal.list')
    expect(resolveCodexCommandFamily({
      argv: [
        '--format',
        'json',
        '--token-count',
        'meal',
        'show',
        '--private-filter',
        'private-query',
      ],
      source: 'batch_argv',
    })).toBe('meal.show')
    expect(resolveCodexCommandFamily({
      argv: ['memory', 'private-command', 'private-argument'],
      source: 'batch_argv',
    })).toBe('other')
    expect(resolveCodexCommandFamily({
      argv: ['food', 'private-command', 'private-argument'],
      source: 'batch_argv',
    })).toBe('other')
  })

  it.each([
    "rg -n 'private query' records",
    'grep private-query records',
  ])('recognizes a direct search without returning its arguments', (commandLabel) => {
    expect(resolveCodexCommandFamily({ commandLabel, source: 'display' })).toBe('search')
  })

  it.each([
    ['cat private-path', 'cat'],
    ['curl https://private.example/path?query=private', 'curl'],
    ['head -n 10 private-path', 'head'],
    ['jq private-filter private-path', 'jq'],
    ['node private-script.js', 'node'],
    ['printf private-value', 'printf'],
    ['python private-script.py', 'python'],
    ['python3 private-script.py', 'python3'],
    ['sed -n 1p private-path', 'sed'],
    ['tail -n 10 private-path', 'tail'],
    ['vault-cli memory show private-record', 'vault-cli memory show'],
    ['vault-cli batch --compact --format json', 'vault-cli batch'],
    ['vault-cli audit --format json private-query', 'vault-cli audit'],
    ['vault-cli automation --format json private-query', 'vault-cli automation'],
    ['vault-cli blood-test --format json private-query', 'vault-cli blood-test'],
    ['vault-cli event --format json private-query', 'vault-cli event'],
    ['vault-cli exercise --format json private-query', 'vault-cli exercise'],
    ['vault-cli food --format json private-query', 'vault-cli food'],
    ['vault-cli knowledge --format json private-query', 'vault-cli knowledge'],
    ['vault-cli meal --format json private-query', 'vault-cli meal'],
    ['vault-cli wearables --format json private-query', 'vault-cli wearables'],
    ['vault-cli workout --format json private-query', 'vault-cli workout'],
  ] as const)('keeps only the reviewed display family for %j', (
    commandLabel,
    expected,
  ) => {
    expect(resolveCodexCommandFamily({ commandLabel, source: 'display' })).toBe(expected)
    expect(expected).not.toContain('private')
  })

  it.each([
    null,
    'set -e',
    'for value in private; do echo "$value"; done',
    'private-head safe-looking-subcommand private-query',
    'vault-cli memory private-subcommand private-query',
    'vault-cli private-family show private-query',
    'scripts/cat private-path',
    '/usr/bin/rg private-query',
    'rg private-query | head',
    "rg 'private-query",
  ])('fails an unsafe or non-search display closed to command: %j', (commandLabel) => {
    expect(resolveCodexCommandFamily({ commandLabel, source: 'display' })).toBe('command')
  })

  it('unwraps one known shell layer only for profile attribution', () => {
    const wrapped = 'bash -lc "vault-cli memory show private-record"'
    expect(resolveCodexCommandFamily({
      allowKnownShellWrapper: true,
      commandLabel: wrapped,
      source: 'display',
    })).toBe('vault-cli memory show')
    expect(resolveCodexCommandFamily({
      commandLabel: wrapped,
      source: 'display',
    })).toBe('command')
    expect(resolveCodexCommandFamily({
      allowKnownShellWrapper: true,
      commandLabel: '/bin/zsh -lc "vault-cli memory show private-record"',
      source: 'display',
    })).toBe('vault-cli memory show')
  })

  it.each([
    'fish -lc "vault-cli memory show private-record"',
    '/private/bash -lc "vault-cli memory show private-record"',
    'bash -lc "bash -lc \'vault-cli memory show private-record\'"',
    'bash -lc "vault-cli memory show private-record',
    'bash -lc "vault-cli memory show" "private-record"',
    'bash -lc "vault-cli memory show private-record | cat private-path"',
    'bash -lc "vault-cli memory show $(private-command)"',
    'bash -lc "/tmp/vault-cli memory show private-record"',
  ])('rejects an unsafe shell-wrapper shape: %s', (commandLabel) => {
    expect(resolveCodexCommandFamily({
      allowKnownShellWrapper: true,
      commandLabel,
      source: 'display',
    })).toBe('command')
  })
})

describe('finite command attribution explanations', () => {
  it.each([
    [null, 'missing_command', undefined], ['', 'missing_command', undefined],
    [`vault-cli ${'x'.repeat(4096)}`, 'oversized_command', undefined],
    ['vault-cli exercise list | head', 'shell_syntax', undefined],
    ['vault-cli exercise list && false', 'shell_syntax', undefined],
    ['vault-cli exercise show "unterminated', 'shell_syntax', undefined],
    ['vault-cli exercise show "$(SYNTHETIC_SECRET_TOKEN)"', 'shell_syntax', undefined],
    ['SYNTHETIC_SECRET_TOKEN exercise list', 'unrecognized_executable', undefined],
    ['/SYNTHETIC_PRIVATE_PATH/vault-cli exercise list', 'unrecognized_executable', undefined],
    ['vault-cli SYNTHETIC_HEALTH_HISTORY', 'unrecognized_cli_path', undefined],
    ['vault-cli --format json exercise list', 'unrecognized_cli_path', undefined],
    ['vault-cli --config "exercise list" food search-labels oats', 'unrecognized_cli_path', undefined],
    ['vault-cli "exercise" list', 'unrecognized_cli_path', undefined],
    ['vault-cli exercise list --query "SYNTHETIC_HEALTH_HISTORY | literal"', 'recognized', 'exercise list'],
    ["bash -lc 'vault-cli food search-labels \"SYNTHETIC_SECRET_TOKEN\"'", 'recognized', 'food search-labels'],
    ['vault-cli workout exercise add SYNTHETIC_HEALTH_HISTORY', 'recognized', 'workout exercise add'],
    ['vault-cli knowledge index rebuild', 'recognized', 'knowledge index rebuild'],
    ['bash -lc "rg SYNTHETIC_HEALTH_HISTORY"', 'recognized', undefined],
    ['vault-cli memory forget SYNTHETIC_HEALTH_HISTORY', 'recognized', 'memory forget'],
    ['vault-cli batch --command \'["exercise","list"]\'', 'recognized', 'batch'],
  ] as const)('explains attribution without copying %j', (commandLabel, reason, command) => {
    const result = resolveCodexCommandAttribution({ commandLabel })
    expect(result.commandAttribution).toBe(reason)
    expect(result.vaultCliCommand).toBe(command)
    expect(result.vaultCli).toBe(command !== undefined || reason === 'unrecognized_cli_path')
    for (const sentinel of ['SYNTHETIC_SECRET_TOKEN', 'SYNTHETIC_HEALTH_HISTORY', 'SYNTHETIC_PRIVATE_PATH']) {
      expect(JSON.stringify(result)).not.toContain(sentinel)
    }
  })

  it('retains the exact lexical bound and does not parse an option value as a command', () => {
    const prefix = 'vault-cli exercise list --query '
    const commandLabel = prefix + 'x'.repeat(4096 - prefix.length)
    expect(resolveCodexCommandAttribution({ commandLabel }).vaultCliCommand).toBe('exercise list')
    expect(resolveCodexCommandAttribution({ commandLabel: commandLabel + 'x' }).commandAttribution).toBe('oversized_command')
  })
})
