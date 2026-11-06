export class DurableObject {
  constructor(..._args: unknown[]) {}
}

const pendingWaitUntilPromises: Promise<unknown>[] = [];

export function waitUntil(promise: Promise<unknown>): void {
  pendingWaitUntilPromises.push(promise);
}

/** Settles work registered through the module-level `waitUntil` stub. */
export async function settleWaitUntilForTest(): Promise<void> {
  await Promise.all(pendingWaitUntilPromises.splice(0));
}
