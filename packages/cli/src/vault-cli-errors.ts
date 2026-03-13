import { Errors } from 'incur'

export type VaultCliErrorDetails = Record<string, unknown> | undefined

export class VaultCliError extends Errors.IncurError {
  readonly context: VaultCliErrorDetails

  constructor(code: string, message: string, details?: VaultCliErrorDetails) {
    super({ code, message })
    this.name = 'VaultCliError'
    this.context = details
  }
}
