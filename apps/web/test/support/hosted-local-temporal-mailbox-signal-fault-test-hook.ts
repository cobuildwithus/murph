import {
  WorkflowClient,
  type Workflow,
  type WorkflowHandleWithSignaledRunId,
  type WorkflowSignalWithStartOptions,
  type WithWorkflowArgs,
} from "@temporalio/client";

const HOSTED_RUNTIME_SIGNAL_NAME = "runtimeSignal";
const HOSTED_RUNTIME_WORKFLOW_TYPE = "hostedUserRuntimeWorkflow";
const HOSTED_RUNTIME_SYSTEM_MAILBOX_LANE = "system";
const CONTROL_REQUEST_TIMEOUT_MS = 35_000;

interface HostedLocalTemporalMailboxSignalFaultConfig {
  controlBaseUrl: URL;
  expectedUserId: string;
}

interface HostedLocalTemporalMailboxSignalIdentity {
  mailboxItemId: string;
  userId: string;
}

interface HostedLocalTemporalMailboxSignalFaultConsumeResponse {
  consume: boolean;
}

type WorkflowClientSignalPrototype = Pick<WorkflowClient, "signalWithStart">;

const installedPrototypes = new WeakSet<WorkflowClientSignalPrototype>();

export function installHostedLocalTemporalMailboxSignalFault(
  environment: NodeJS.ProcessEnv = process.env,
  clientPrototype: WorkflowClientSignalPrototype = WorkflowClient.prototype,
): void {
  if (installedPrototypes.has(clientPrototype)) {
    return;
  }

  const config = readHostedLocalTemporalMailboxSignalFaultConfig(environment);
  const originalSignalWithStart = clientPrototype.signalWithStart;

  async function patchedSignalWithStart<
    WorkflowFn extends Workflow,
    SignalArgs extends unknown[] = [],
  >(
    this: WorkflowClient,
    workflowTypeOrFunc: string | WorkflowFn,
    options: WithWorkflowArgs<
      WorkflowFn,
      WorkflowSignalWithStartOptions<SignalArgs>
    >,
  ): Promise<WorkflowHandleWithSignaledRunId<WorkflowFn>> {
    const identity = readHostedLocalTemporalMailboxSignalIdentity(
      workflowTypeOrFunc,
      options,
    );
    if (
      identity?.userId === config.expectedUserId
      && await consumeHostedLocalTemporalMailboxSignalFault(config, identity)
    ) {
      throw new Error("Hosted-local Temporal mailbox signal fault injection.");
    }

    return await originalSignalWithStart.call(
      this,
      workflowTypeOrFunc,
      options,
    );
  }

  Object.defineProperty(clientPrototype, "signalWithStart", {
    configurable: true,
    value: patchedSignalWithStart,
    writable: true,
  });
  installedPrototypes.add(clientPrototype);
}

function readHostedLocalTemporalMailboxSignalFaultConfig(
  source: Readonly<NodeJS.ProcessEnv>,
): HostedLocalTemporalMailboxSignalFaultConfig {
  const profile = source.MURPH_HOSTED_LOCAL_PROFILE?.trim();
  if (
    (profile !== "e2e:stub" && profile !== "e2e:live")
    || source.MURPH_HOSTED_LOCAL_TEST_ROUTES !== "1"
  ) {
    throw new Error(
      "The Temporal mailbox signal fault hook requires the hosted-local E2E test-control profile.",
    );
  }

  const expectedUserId = source
    .MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID
    ?.trim();
  if (!expectedUserId) {
    throw new Error(
      "MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID is required.",
    );
  }

  const workerPort = readLoopbackPort(source.MURPH_DEV_WORKER_PORT);
  return {
    controlBaseUrl: new URL(`http://127.0.0.1:${workerPort}`),
    expectedUserId,
  };
}

function readLoopbackPort(value: string | undefined): number {
  const normalized = value?.trim() ?? "";
  if (!/^\d+$/u.test(normalized)) {
    throw new Error("MURPH_DEV_WORKER_PORT must be a loopback TCP port.");
  }
  const port = Number(normalized);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MURPH_DEV_WORKER_PORT must be a loopback TCP port.");
  }
  return port;
}

function readHostedLocalTemporalMailboxSignalIdentity(
  workflowTypeOrFunc: unknown,
  options: unknown,
): HostedLocalTemporalMailboxSignalIdentity | null {
  if (
    workflowTypeOrFunc !== HOSTED_RUNTIME_WORKFLOW_TYPE
    || !isRecord(options)
    || options.signal !== HOSTED_RUNTIME_SIGNAL_NAME
    || !Array.isArray(options.args)
    || !Array.isArray(options.signalArgs)
  ) {
    return null;
  }

  const workflowInput = options.args[0];
  const signal = options.signalArgs[0];
  if (
    !isRecord(workflowInput)
    || typeof workflowInput.userId !== "string"
    || !isRecord(signal)
    || signal.kind !== "mailbox_appended"
    || signal.lane !== HOSTED_RUNTIME_SYSTEM_MAILBOX_LANE
    || typeof signal.mailboxItemId !== "string"
  ) {
    return null;
  }

  const userId = workflowInput.userId.trim();
  const mailboxItemId = signal.mailboxItemId.trim();
  if (
    !userId
    || !mailboxItemId
    || options.workflowId !== `hosted-user-runtime:${userId}`
  ) {
    return null;
  }

  return {
    mailboxItemId,
    userId,
  };
}

async function consumeHostedLocalTemporalMailboxSignalFault(
  config: HostedLocalTemporalMailboxSignalFaultConfig,
  identity: HostedLocalTemporalMailboxSignalIdentity,
): Promise<boolean> {
  const controlUrl = new URL(
    `/__test/users/${encodeURIComponent(identity.userId)}`
      + "/temporal-mailbox-signal-fault/consume",
    config.controlBaseUrl,
  );
  const response = await fetch(controlUrl, {
    body: JSON.stringify({ mailboxItemId: identity.mailboxItemId }),
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-hosted-execution-user-id": identity.userId,
    },
    method: "POST",
    signal: AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Temporal mailbox signal fault control failed with HTTP ${response.status}.`,
    );
  }

  const body: unknown = await response.json();
  if (!isHostedLocalTemporalMailboxSignalFaultConsumeResponse(body)) {
    throw new TypeError(
      "Temporal mailbox signal fault control returned an invalid response.",
    );
  }
  return body.consume;
}

function isHostedLocalTemporalMailboxSignalFaultConsumeResponse(
  value: unknown,
): value is HostedLocalTemporalMailboxSignalFaultConsumeResponse {
  return isRecord(value) && typeof value.consume === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
