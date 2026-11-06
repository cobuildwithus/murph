import { createHook, sleep } from "workflow";

import { buildHostedPhoneCallReconciliationHookToken } from "../../../src/lib/phone-calls/reconciliation-workflow-types";

export async function reusablePhoneHook(phoneCallId: string): Promise<string[]> {
  "use workflow";

  const hook = createHook<string>({
    token: buildHostedPhoneCallReconciliationHookToken(phoneCallId),
  });
  try {
    const first = await hook.then((signal) => signal);
    await sleep("1ms");
    const second = await hook.then((signal) => signal);
    return await recordSignals([first, second]);
  } finally {
    hook.dispose();
  }
}

async function recordSignals(signals: string[]): Promise<string[]> {
  "use step";
  return signals;
}
