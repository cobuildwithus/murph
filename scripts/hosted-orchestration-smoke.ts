import {
  readHostedRuntimeTemporalEnvironment,
  type HostedRuntimeSignal,
} from "@murphai/hosted-orchestrator-temporal";
import {
  signalHostedUserRuntimeWorkflow,
} from "@murphai/hosted-orchestrator-temporal/client";
import {
  createHostedRuntimeTemporalClientFromEnv,
} from "@murphai/hosted-orchestrator-temporal/client/temporal-client";
import {
  parseHostedRuntimeSignal,
} from "@murphai/hosted-execution/parsers";

const DEFAULT_SMOKE_USER_ID = "user_local_smoke";

async function main(): Promise<void> {
  const environment = readHostedRuntimeTemporalEnvironment();
  const client = await createHostedRuntimeTemporalClientFromEnv();
  const userId =
    readOptionalString(process.env.HOSTED_ORCHESTRATION_SMOKE_USER_ID)
    ?? DEFAULT_SMOKE_USER_ID;
  const signal = readSmokeSignal();

  const result = await signalHostedUserRuntimeWorkflow({
    client,
    signal,
    taskQueue: environment.taskQueue,
    userId,
  });

  const redactedWorkflowId = result.workflowId.replace(userId, "<USER_ID>");
  console.info(JSON.stringify({
    namespace: environment.namespace,
    ok: true,
    signalKind: signal.kind,
    taskQueue: environment.taskQueue,
    workflowId: redactedWorkflowId,
  }));
}

function readSmokeSignal(): HostedRuntimeSignal {
  return parseHostedRuntimeSignal({
    kind: "runtime_recheck_requested",
  });
}

function readOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

main().catch((error: unknown) => {
  console.error(`hosted-orchestration smoke failed: ${readErrorMessage(error)}`);
  process.exitCode = 1;
});
