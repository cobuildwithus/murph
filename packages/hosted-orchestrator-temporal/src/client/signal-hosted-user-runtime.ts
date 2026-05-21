import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
  type HostedRuntimeSignal,
  type HostedUserRuntimeWorkflowInput,
  type HostedUserRuntimeWorkflowOptions,
} from "../index.js";
import {
  readHostedUserRuntimeWorkflowOptions,
} from "../temporal-env.js";

export interface HostedUserRuntimeSignalWithStartOptions {
  args: [HostedUserRuntimeWorkflowInput];
  signal: typeof HOSTED_USER_RUNTIME_SIGNAL_NAME;
  signalArgs: [HostedRuntimeSignal];
  taskQueue: string;
  workflowId: string;
}

export interface HostedUserRuntimeSignalClient {
  workflow: {
    signalWithStart(
      workflowType: typeof HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      options: HostedUserRuntimeSignalWithStartOptions,
    ): Promise<unknown>;
  };
}

export interface SignalHostedUserRuntimeWorkflowInput {
  client: HostedUserRuntimeSignalClient;
  signal: HostedRuntimeSignal;
  taskQueue?: string;
  userId: string;
  workflowOptions?: HostedUserRuntimeWorkflowOptions;
  workflowId?: string;
}

export interface SignalHostedUserRuntimeWorkflowResult {
  workflowId: string;
}

export function hostedUserRuntimeWorkflowId(userId: string): string {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Hosted runtime workflow userId is required.");
  }

  return `hosted-user-runtime:${normalizedUserId}`;
}

export async function signalHostedUserRuntimeWorkflow(
  input: SignalHostedUserRuntimeWorkflowInput,
): Promise<SignalHostedUserRuntimeWorkflowResult> {
  const workflowId =
    input.workflowId ?? hostedUserRuntimeWorkflowId(input.userId);

  await input.client.workflow.signalWithStart(
    HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
    {
      args: [{
        options: input.workflowOptions ?? readHostedUserRuntimeWorkflowOptions(),
        userId: input.userId,
      }],
      signal: HOSTED_USER_RUNTIME_SIGNAL_NAME,
      signalArgs: [input.signal],
      taskQueue: input.taskQueue ?? HOSTED_USER_RUNTIME_TASK_QUEUE,
      workflowId,
    },
  );

  return { workflowId };
}
