import { Errors, middleware } from 'incur'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

function readOptionalBoolean(
  value: unknown,
): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readOptionalNumber(
  value: unknown,
): number | undefined {
  return typeof value === 'number' ? value : undefined
}

export const incurErrorBridge = middleware(async (_context, next) => {
  try {
    await next()
  } catch (error) {
    if (error instanceof VaultCliError) {
      throw new Errors.IncurError({
        code: error.code,
        message: error.message,
        retryable: readOptionalBoolean(error.context?.retryable),
        exitCode: readOptionalNumber(error.context?.exitCode),
      })
    }

    throw error
  }
})
