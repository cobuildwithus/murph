import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

interface QuerySourceDetails {
  field?: string
  issue: string
  lineNumber?: number
  querySource: true
  relativePath: string
}

export function mapQuerySourceError(error: unknown): unknown {
  const details = readQuerySourceDetails(error)
  if (details === null) {
    return error
  }

  const location = details.lineNumber === undefined
    ? details.relativePath
    : `${details.relativePath}:${details.lineNumber}`

  return new VaultCliError(
    'query_source_invalid',
    `Canonical vault source ${location} could not be read.`,
    {
      retryable: false,
      issue: details.issue,
      relativePath: details.relativePath,
      ...(details.lineNumber === undefined ? {} : { lineNumber: details.lineNumber }),
    },
    {
      stage: 'query_source',
      hint: `Repair ${location}, then rerun the command. Vault validation can identify additional source issues.`,
      ...(details.field
        ? {
            fields: [{
              path: details.field,
              code: details.issue,
              message: 'This canonical source field is invalid or missing.',
              missing: details.issue === 'missing_field',
            }],
          }
        : {}),
    },
  )
}

export function wrapQueryRuntimeErrors<TRuntime extends object>(runtime: TRuntime): TRuntime {
  return new Proxy(runtime, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') {
        return value
      }

      return (...args: unknown[]) => {
        try {
          const result = Reflect.apply(value, target, args)
          return result instanceof Promise
            ? result.catch((error: unknown) => {
                throw mapQuerySourceError(error)
              })
            : result
        } catch (error) {
          throw mapQuerySourceError(error)
        }
      }
    },
  })
}

function readQuerySourceDetails(error: unknown): QuerySourceDetails | null {
  if (
    !error
    || typeof error !== 'object'
    || !('code' in error)
    || error.code !== 'QUERY_SOURCE_INVALID'
    || !('details' in error)
    || !error.details
    || typeof error.details !== 'object'
  ) {
    return null
  }

  const details = error.details
  if (
    !('querySource' in details)
    || details.querySource !== true
    || !('relativePath' in details)
    || typeof details.relativePath !== 'string'
    || !isSafeRelativePath(details.relativePath)
    || !('issue' in details)
    || typeof details.issue !== 'string'
    || !/^[a-z_]{1,64}$/u.test(details.issue)
  ) {
    return null
  }

  const lineNumber = 'lineNumber' in details
    && Number.isSafeInteger(details.lineNumber)
    && Number(details.lineNumber) > 0
      ? Number(details.lineNumber)
      : undefined
  const field = 'field' in details
    && typeof details.field === 'string'
    && /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/u.test(details.field)
      ? details.field
      : undefined

  return {
    querySource: true,
    relativePath: details.relativePath,
    issue: details.issue,
    ...(lineNumber === undefined ? {} : { lineNumber }),
    ...(field === undefined ? {} : { field }),
  }
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0
    && value.length <= 160
    && !value.startsWith('/')
    && !value.startsWith('../')
    && !value.includes('\\')
    && !/[\u0000-\u001F\u007F]/u.test(value)
}
