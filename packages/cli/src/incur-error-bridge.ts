import { Errors, middleware } from 'incur'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export const incurErrorBridge = middleware(async (_context, next) => {
  try {
    await next()
  } catch (error) {
    if (error instanceof VaultCliError) {
      const retryable =
        typeof error.context?.retryable === 'boolean'
          ? error.context.retryable
          : undefined
      const exitCode =
        typeof error.context?.exitCode === 'number'
          ? error.context.exitCode
          : undefined

      throw new Errors.IncurError({
        code: error.code,
        message: error.message,
        retryable,
        exitCode,
      })
    }

    throw error
  }
})
