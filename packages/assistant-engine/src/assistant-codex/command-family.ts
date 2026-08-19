import type {
  AssistantTurnProfileCommandFamily,
} from '@murphai/hosted-execution/assistant-usage'
import {
  resolveVaultCliCommandPath,
} from '@murphai/operator-config/command-helpers'

const COMMAND_CLASSIFICATION_SCAN_LIMIT = 4096
const DIRECT_SEARCH_COMMAND_PATTERN = /^(?:grep|rg)(?:\s|$)/u
const UNQUOTED_SHELL_CONTROL_PATTERN = /[\r\n;&|<>`$(){}]/u
const KNOWN_SHELL_WRAPPER_PREFIX_PATTERN =
  /^\s*(?:(?:\/bin|\/usr\/bin)\/)?(?:bash|zsh|dash)\s+-[a-z]*c[a-z]*\s+/u

const BATCH_COMMAND_FAMILIES = new Map<string, CodexCommandFamily>([
  ['food search-labels', 'food.search-labels'],
  ['food search-labels-batch', 'food.search-labels-batch'],
  ['goal list', 'goal.list'],
  ['goal show', 'goal.show'],
  ['meal add', 'meal.add'],
  ['meal edit', 'meal.edit'],
  ['meal nutrients', 'meal.nutrients'],
  ['meal show', 'meal.show'],
  ['meal totals', 'meal.totals'],
  ['memory show', 'vault-cli memory show'],
])

const DIRECT_EXECUTABLE_FAMILIES = new Map<string, CodexCommandFamily>([
  ['cat', 'cat'],
  ['curl', 'curl'],
  ['head', 'head'],
  ['jq', 'jq'],
  ['node', 'node'],
  ['printf', 'printf'],
  ['python', 'python'],
  ['python3', 'python3'],
  ['sed', 'sed'],
  ['tail', 'tail'],
])

const VAULT_CLI_TOP_LEVEL_FAMILIES = new Map<string, CodexCommandFamily>([
  ['audit', 'vault-cli audit'],
  ['automation', 'vault-cli automation'],
  ['blood-test', 'vault-cli blood-test'],
  ['event', 'vault-cli event'],
  ['exercise', 'vault-cli exercise'],
  ['food', 'vault-cli food'],
  ['knowledge', 'vault-cli knowledge'],
  ['meal', 'vault-cli meal'],
  ['wearables', 'vault-cli wearables'],
  ['workout', 'vault-cli workout'],
])

export type CodexCommandFamily = AssistantTurnProfileCommandFamily

export type CodexCommandFamilyInput =
  | {
      argv: readonly string[]
      source: 'batch_argv'
    }
  | {
      allowKnownShellWrapper?: boolean
      commandLabel: string | null
      source: 'display'
    }

/**
 * Return only a finite server-owned command family. Command text and argv are
 * inspected transiently and never returned. Display commands fail closed to
 * `command`; structured batch children fail closed to `other`.
 */
export function resolveCodexCommandFamily(
  input: CodexCommandFamilyInput,
): CodexCommandFamily {
  if (input.source === 'batch_argv') {
    const [head, subcommand] = resolveVaultCliCommandPath(input.argv)
    if (!head || !subcommand) {
      return 'other'
    }
    return BATCH_COMMAND_FAMILIES.get(`${head} ${subcommand}`) ?? 'other'
  }

  if (input.commandLabel === null) {
    return 'command'
  }
  const outerCommand = input.commandLabel.trim()
  if (hasExecutableShellControl(outerCommand)) {
    return 'command'
  }
  const command = input.allowKnownShellWrapper
    ? unwrapKnownShellWrapper(outerCommand) ?? outerCommand
    : outerCommand
  if (hasExecutableShellControl(command)) {
    return 'command'
  }
  if (DIRECT_SEARCH_COMMAND_PATTERN.test(command)) {
    return 'search'
  }

  const tokens = command.split(/\s+/u)
  const directFamily = DIRECT_EXECUTABLE_FAMILIES.get(tokens[0] ?? '')
  if (directFamily) {
    return directFamily
  }
  if (tokens[0] !== 'vault-cli') {
    return 'command'
  }

  if (tokens[1] === 'batch') {
    return 'vault-cli batch'
  }

  const commandPath = `${tokens[1] ?? ''} ${tokens[2] ?? ''}`.trim()
  const exactFamily = BATCH_COMMAND_FAMILIES.get(commandPath)
  if (exactFamily) {
    return exactFamily
  }
  return VAULT_CLI_TOP_LEVEL_FAMILIES.get(tokens[1] ?? '') ?? 'command'
}

// Codex shlex-joins a known shell's single script argument. Unwrap exactly one
// layer only when the complete remainder is one safely bounded script region.
// Any other shape returns null and the caller classifies the outer shell.
function unwrapKnownShellWrapper(command: string): string | null {
  const wrapper = KNOWN_SHELL_WRAPPER_PREFIX_PATTERN.exec(command)
  if (!wrapper) {
    return null
  }
  const script = command.slice(wrapper[0].length)
  const quote = script[0]
  if (quote !== '"' && quote !== "'") {
    return script.length > 0 && !/\s/u.test(script) ? script : null
  }
  if (script.length < 2 || !script.endsWith(quote)) {
    return null
  }
  const inner = script.slice(1, -1)
  if (quote === "'") {
    return decodePosixSingleQuotedShellWord(inner)
  }
  return hasUnescapedQuote(inner, quote) ? null : inner
}

// `shlex.join` represents a literal apostrophe inside one single-quoted argv
// word as the exact `\'`-escaped splice `'<backslash>''`. Accept only that
// canonical transition so multiple free-form quote regions still fail closed.
function decodePosixSingleQuotedShellWord(inner: string): string | null {
  let decoded = ''
  for (let index = 0; index < inner.length;) {
    if (inner[index] !== "'") {
      decoded += inner[index]
      index += 1
      continue
    }
    if (inner.slice(index, index + 4) !== "'\\''") {
      return null
    }
    decoded += "'"
    index += 4
  }
  return decoded
}

function hasUnescapedQuote(inner: string, quote: string): boolean {
  let backslashes = 0
  for (const character of inner) {
    if (character === '\\') {
      backslashes += 1
      continue
    }
    if (character === quote && backslashes % 2 === 0) {
      return true
    }
    backslashes = 0
  }
  return false
}

/**
 * Codex serializes command argv with shell quoting for display. Keep this scan
 * transient and bounded: quoted or escaped regex syntax is argument data,
 * while unquoted control syntax means the display is not provably one direct
 * invocation.
 */
function hasExecutableShellControl(command: string): boolean {
  if (command.length > COMMAND_CLASSIFICATION_SCAN_LIMIT) {
    return true
  }

  let quote: 'double' | 'single' | null = null
  let escaped = false
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? ''
    if (character === '\r' || character === '\n') {
      return true
    }
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quote !== 'single') {
      escaped = true
      continue
    }
    if (quote === 'single') {
      if (character === "'") {
        quote = null
      }
      continue
    }
    if (quote === 'double') {
      if (character === '"') {
        quote = null
        continue
      }
      if (
        character === '`'
        || (character === '$' && command[index + 1] === '(')
      ) {
        return true
      }
      continue
    }
    if (character === "'") {
      quote = 'single'
      continue
    }
    if (character === '"') {
      quote = 'double'
      continue
    }
    if (UNQUOTED_SHELL_CONTROL_PATTERN.test(character)) {
      return true
    }
  }

  return escaped || quote !== null
}
