import { Errors, middleware } from 'incur'
import { projectVaultCliError } from './vault-cli-error-projection.js'

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

    const projected = projectVaultCliError(error)
    throw new Errors.IncurError(projected)
  }
})
