import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";

export function scheduleDashboardReplicaRefreshAfterResponse(input: {
  sourceStateHash: string | null;
  userId: string;
}): void {
  void scheduleDashboardReplicaRefreshBestEffort(input);
}

export async function scheduleDashboardReplicaRefreshBestEffort(input: {
  sourceStateHash: string | null;
  userId: string;
}): Promise<void> {
  try {
    if (!input.sourceStateHash) {
      return;
    }

    const client = readHostedExecutionControlClientIfConfigured();
    if (!client) {
      return;
    }

    await client.scheduleBrowserVaultRefresh({
      sourceStateHash: input.sourceStateHash,
      userId: input.userId,
    });
  } catch {
    // Dashboard freshness is a best-effort derived read-model refresh.
  }
}
