import { VaultCliError } from '../vault-cli-errors.js'

const ASSISTANT_FAULTS_ENV = 'HEALTHYBOB_ASSISTANT_FAULTS'
const consumedFaults = new Map<string, number>()

const RETRYABLE_ASSISTANT_FAULTS = new Set([
  'provider',
  'delivery',
  'outbox',
  'automation',
])

export function hasInjectedAssistantFault(
  fault: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveAssistantFaultMode(fault, env) !== null
}

export function consumeInjectedAssistantFault(
  fault: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const mode = resolveAssistantFaultMode(fault, env)
  if (mode === null) {
    return false
  }

  if (mode === 'always') {
    return true
  }

  const key = `${fault}:${env[ASSISTANT_FAULTS_ENV] ?? ''}`
  const count = consumedFaults.get(key) ?? 0
  if (count > 0) {
    return false
  }

  consumedFaults.set(key, count + 1)
  return true
}

export function maybeThrowInjectedAssistantFault(input: {
  code?: string
  component: string
  env?: NodeJS.ProcessEnv
  fault: string
  message?: string
}): void {
  if (!consumeInjectedAssistantFault(input.fault, input.env)) {
    return
  }

  throw new VaultCliError(
    input.code ?? 'ASSISTANT_FAULT_INJECTED',
    input.message ?? `Injected assistant fault for ${input.component}.`,
    {
      component: input.component,
      fault: input.fault,
      injected: true,
      retryable: RETRYABLE_ASSISTANT_FAULTS.has(input.fault),
    },
  )
}

function resolveAssistantFaultMode(
  fault: string,
  env: NodeJS.ProcessEnv,
): 'always' | 'once' | null {
  const raw = env[ASSISTANT_FAULTS_ENV]?.trim()
  if (!raw) {
    return null
  }

  for (const token of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
    const [tokenFault, tokenMode] = token.split(':', 2)
    if (tokenFault !== fault) {
      continue
    }

    switch (tokenMode) {
      case 'always':
        return 'always'
      case undefined:
      case '':
      case 'once':
        return 'once'
      default:
        return 'once'
    }
  }

  return null
}

export function resetInjectedAssistantFaults(): void {
  consumedFaults.clear()
}
