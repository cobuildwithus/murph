export interface SetupWizardCompletionController<TResult> {
  completeExit(): void
  fail(error: unknown): void
  submit(result: TResult): void
  waitForResult(): Promise<TResult>
}

export function wrapSetupWizardIndex(
  currentIndex: number,
  length: number,
  delta: number,
): number {
  if (length <= 0) {
    return 0
  }

  return (currentIndex + delta + length) % length
}

export function createSetupWizardCompletionController<TResult>(input?: {
  unexpectedExitMessage?: string
}): SetupWizardCompletionController<TResult> {
  let settled = false
  let exited = false
  let submittedResult: TResult | null = null
  let resolvePromise!: (value: TResult) => void
  let rejectPromise!: (reason: unknown) => void
  const promise = new Promise<TResult>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  const maybeResolve = () => {
    if (settled || !exited || submittedResult === null) {
      return
    }

    settled = true
    resolvePromise(submittedResult)
  }

  return {
    completeExit() {
      if (settled) {
        return
      }

      exited = true
      if (submittedResult === null) {
        settled = true
        rejectPromise(
          new Error(
            input?.unexpectedExitMessage ?? 'Murph setup wizard exited unexpectedly.',
          ),
        )
        return
      }

      maybeResolve()
    },

    fail(error) {
      if (settled) {
        return
      }

      settled = true
      rejectPromise(error)
    },

    submit(result) {
      if (settled) {
        return
      }

      submittedResult = result
      maybeResolve()
    },

    async waitForResult() {
      return await promise
    },
  }
}
