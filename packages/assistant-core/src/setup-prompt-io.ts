export function prepareSetupPromptInput(input: NodeJS.ReadableStream): void {
  const interactiveInput = input as NodeJS.ReadStream & {
    isRaw?: boolean
    ref?: () => void
    setRawMode?: (mode: boolean) => void
  }

  if (interactiveInput.isTTY && typeof interactiveInput.setRawMode === 'function') {
    interactiveInput.setRawMode(false)
  }

  if (typeof interactiveInput.ref === 'function') {
    interactiveInput.ref()
  }

  if (typeof interactiveInput.resume === 'function') {
    interactiveInput.resume()
  }
}
