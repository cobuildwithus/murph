import { Errors, middleware } from 'incur'
import { projectVaultCliError } from '@murphai/operator-config/vault-cli-error-projection'

export const incurErrorBridge = middleware(async (_context, next) => {
  try {
    await next()
  } catch (error) {
    if (
      error instanceof Errors.IncurError ||
      error instanceof Errors.ParseError ||
      error instanceof Errors.ValidationError
    ) {
      throw error
    }

    throw new Errors.IncurError(projectVaultCliError(error))
  }
})
