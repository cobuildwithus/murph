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
      // The parser-set reason is a private own data property; copy only that
      // descriptor value, and only for the native arguments kind (config
      // rejections share the projected code), onto this timing-only object.
      // The owner admits it for its gated command/code and fixed literals.
      if (isCliTimingActive() && error instanceof Errors.ParseError) {
        const kind = Object.getOwnPropertyDescriptor(error, 'kind')
        const reason = kind && 'value' in kind && kind.value === 'arguments'
          ? Object.getOwnPropertyDescriptor(error, 'reason') : undefined
        timingError = {
          ...Errors.toErrorEnvelope(error),
          ...(reason && 'value' in reason ? { cliTimingRejection: reason.value } : {}),
        }
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
