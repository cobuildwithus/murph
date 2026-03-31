import { Errors } from 'incur'

export type VaultCliErrorDetails = Record<string, unknown> | undefined

export class VaultCliError extends Errors.IncurError {
  readonly code: string
  readonly context: VaultCliErrorDetails
  override readonly message: string

  constructor(code: string, message: string, details?: VaultCliErrorDetails) {
    super({ code, message })
    this.code = code
    this.name = 'VaultCliError'
    this.message = message
    this.context = details
  }
}
