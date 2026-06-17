import {
  describeHostedExecutionSafeLogErrorCode,
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import {
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import {
  signalHostedManualRunRuntime,
} from "./signal-runtime";

export interface HostedRuntimeManualWakeBestEffortResult {
  accepted: boolean;
  configured: boolean;
  errorCode: string | null;
  signalAccepted: boolean | null;
  usageGateDenied: boolean;
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
  try {
    const signalPromise = signalHostedManualRunRuntime({
      userId: input.userId,
    });
    const signal = await withManualWakeTimeout(signalPromise, input.timeoutMs);

    return {
      accepted: true,
      configured: true,
      errorCode: null,
      signalAccepted: signal.signalAccepted,
      usageGateDenied: false,
      workflowIdPresent: Boolean(signal.workflowId),
    };
  } catch (error) {
    const usageGateResult = readManualWakeUsageGateResult(error);
    if (usageGateResult) {
      return usageGateResult;
    }

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

    const errorCode = describeHostedExecutionSafeLogErrorCode(error);

    console.error("Hosted runtime manual wake signal failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, { code: errorCode }),
    });
    return {
      accepted: false,
      configured: true,
      errorCode,
      signalAccepted: null,
      usageGateDenied: false,
      workflowIdPresent: null,
    };
  }
}

function readManualWakeUsageGateResult(
  error: unknown,
): HostedRuntimeManualWakeBestEffortResult | null {
  if (!isHostedOnboardingError(error)) {
    return null;
  }

  if (error.code === "HOSTED_RUNTIME_MANUAL_WAKE_AI_USAGE_DENIED") {
    return {
      accepted: false,
      configured: true,
      errorCode: null,
      signalAccepted: null,
      usageGateDenied: true,
      workflowIdPresent: null,
    };
  }

  if (error.code === "HOSTED_RUNTIME_MANUAL_WAKE_AI_USAGE_GATE_UNAVAILABLE") {
    return {
      accepted: false,
      configured: true,
      errorCode: error.code,
      signalAccepted: null,
      usageGateDenied: false,
      workflowIdPresent: null,
    };
  }

  return null;
}

function isHostedRuntimeTemporalNotConfiguredError(error: unknown): boolean {
  return error instanceof Error &&
    error.message === "Hosted runtime Temporal client is not configured.";
}

async function withManualWakeTimeout<T>(
  signalPromise: Promise<T>,
  timeoutMs: number | undefined,
): Promise<T> {
  const normalizedTimeoutMs = normalizeManualWakeTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === null) {
    return await signalPromise;
  }

  signalPromise.catch(() => undefined);

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      signalPromise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(createManualWakeTimeoutError(normalizedTimeoutMs));
        }, normalizedTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

function normalizeManualWakeTimeoutMs(timeoutMs: number | undefined): number | null {
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return null;
  }

  return Math.ceil(timeoutMs);
}

function createManualWakeTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Hosted runtime manual wake timed out after ${timeoutMs}ms.`);
  error.name = "TimeoutError";
  return error;
}
