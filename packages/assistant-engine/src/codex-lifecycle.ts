export type StopWarmCodexAppServerImplementation = (
  reason?: string,
) => Promise<void>

let stopWarmCodexAppServerImplementation:
  | StopWarmCodexAppServerImplementation
  | undefined

export function registerStopWarmCodexAppServer(
  implementation: StopWarmCodexAppServerImplementation,
): void {
  stopWarmCodexAppServerImplementation = implementation
}

export async function stopWarmCodexAppServer(
  reason = 'external-stop',
): Promise<void> {
  await stopWarmCodexAppServerImplementation?.(reason)
}
