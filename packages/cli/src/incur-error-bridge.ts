import { Errors, middleware } from 'incur'
import { isCliTimingActive, noteCliTimingFailure } from '@murphai/runtime-state/node/cli-timing'
import { projectVaultCliError } from './vault-cli-error-projection.js'

export const incurErrorBridge = middleware(async (_context, next) => {
  try {
    await next()
  } catch (error) {
    let timingError = error
    try {
      // Reuse Incur's typed projection, not error text. Config ParseErrors keep
      // their config field, which the finite timing owner does not admit.
      if (isCliTimingActive() && error instanceof Errors.ParseError) {
        timingError = Errors.toErrorEnvelope(error)
      }
    } catch { /* Optional projection; retain the original code/stage fallback. */ }
    try { noteCliTimingFailure(timingError) }
    catch { /* Diagnostics must never replace the original error. */ }
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
