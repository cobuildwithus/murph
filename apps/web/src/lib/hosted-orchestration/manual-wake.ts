import {
  formatHostedExecutionSafeLogError,
} from "../hosted-execution/logging";
import {
  signalHostedManualRunRuntime,
} from "./signal-runtime";

export interface HostedRuntimeManualWakeBestEffortResult {
  accepted: boolean;
  configured: boolean;
  errorCode: string | null;
  signalAccepted: boolean | null;
  usageGateDenied: false;
  workflowIdPresent: boolean | null;
}

export async function signalHostedRuntimeManualWakeBestEffort(input: {
  userId: string;
}): Promise<void> {
  await signalHostedRuntimeManualWakeBestEffortResult(input);
}

export async function signalHostedRuntimeManualWakeBestEffortResult(input: {
  timeoutMs?: number;
  userId: string;
}): Promise<HostedRuntimeManualWakeBestEffortResult> {
  void input.timeoutMs;

  try {
    const signal = await signalHostedManualRunRuntime({
      userId: input.userId,
    });

    return {
      accepted: true,
      configured: true,
      errorCode: null,
      signalAccepted: signal.signalAccepted,
      usageGateDenied: false,
      workflowIdPresent: Boolean(signal.workflowId),
    };
  } catch (error) {
    if (isHostedRuntimeTemporalNotConfiguredError(error)) {
      return {
        accepted: false,
        configured: false,
        errorCode: null,
        signalAccepted: null,
        usageGateDenied: false,
        workflowIdPresent: null,
      };
    }

    console.error(
      "Hosted runtime manual wake signal failed.",
      formatHostedExecutionSafeLogError(error),
    );
    return {
      accepted: false,
      configured: true,
      errorCode: error instanceof Error && error.name ? error.name : "UnknownError",
      signalAccepted: null,
      usageGateDenied: false,
      workflowIdPresent: null,
    };
  }
}

function isHostedRuntimeTemporalNotConfiguredError(error: unknown): boolean {
  return error instanceof Error &&
    error.message === "Hosted runtime Temporal client is not configured.";
}
