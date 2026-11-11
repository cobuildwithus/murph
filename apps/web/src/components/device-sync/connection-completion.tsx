import "server-only";

import { DeviceSyncCompletionDialog } from "./device-sync-completion-dialog";
import { resolveConnectedAppCompletionDialogModel } from "@/src/lib/connected-apps/connect-completion";
import { resolveDeviceSyncCompletionDialogModel } from "@/src/lib/device-sync/connect-completion";
import type { HostedMemberCoreState } from "@/src/lib/hosted-onboarding/hosted-member-store";

/** Connection callbacks remain account flows even after the dashboard retires. */
export async function renderConnectionCompletion(input: {
  member: HostedMemberCoreState | null;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const model = await resolveDeviceSyncCompletionDialogModel(input)
    ?? await resolveConnectedAppCompletionDialogModel(input);
  return model ? <DeviceSyncCompletionDialog model={model} /> : null;
}
