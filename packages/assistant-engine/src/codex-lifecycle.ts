export type StopWarmCodexAppServerImplementation = (
  reason?: string,
) => Promise<void>

export type CancelPendingWarmCodexPreinitializationImplementation =
  () => Promise<void>

export interface WaitForWarmCodexBackgroundWorkInput {
  signal?: AbortSignal | null
}

export type WaitForWarmCodexBackgroundWorkImplementation = (
  input?: WaitForWarmCodexBackgroundWorkInput,
) => Promise<void>

let stopWarmCodexAppServerImplementation:
  | StopWarmCodexAppServerImplementation
  | undefined
let cancelPendingWarmCodexPreinitializationImplementation:
  | CancelPendingWarmCodexPreinitializationImplementation
  | undefined
let waitForWarmCodexBackgroundWorkImplementation:
  | WaitForWarmCodexBackgroundWorkImplementation
  | undefined

export function registerCancelPendingWarmCodexPreinitialization(
  implementation: CancelPendingWarmCodexPreinitializationImplementation,
): void {
  cancelPendingWarmCodexPreinitializationImplementation = implementation
}

export function registerStopWarmCodexAppServer(
  implementation: StopWarmCodexAppServerImplementation,
): void {
  stopWarmCodexAppServerImplementation = implementation
}

export function registerWaitForWarmCodexBackgroundWork(
  implementation: WaitForWarmCodexBackgroundWorkImplementation,
): void {
  waitForWarmCodexBackgroundWorkImplementation = implementation
}

export async function cancelPendingWarmCodexPreinitialization(): Promise<void> {
  await cancelPendingWarmCodexPreinitializationImplementation?.()
}

export async function stopWarmCodexAppServer(
  reason = 'external-stop',
): Promise<void> {
  await stopWarmCodexAppServerImplementation?.(reason)
}

export async function waitForWarmCodexBackgroundWork(
  input: WaitForWarmCodexBackgroundWorkInput = {},
): Promise<void> {
  await waitForWarmCodexBackgroundWorkImplementation?.(input)
}
