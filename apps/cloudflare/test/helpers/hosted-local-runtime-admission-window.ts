import type { HostedRuntimeEnsureProcessingResponse } from "@murphai/hosted-execution/orchestration-control";

interface RuntimeAdmissionObservation {
  acceptedAt: string;
  workspaceAttemptId: string;
}

export async function countHostedLocalRuntimeAdmissionWindow(input: {
  acceptedWake: Pick<
    Extract<HostedRuntimeEnsureProcessingResponse, { kind: "runtime_processing_accepted" }>,
    "action" | "runtimeAttemptId"
  >;
  beforeAt: string;
  buildFailureMessage: (lines: string[]) => Promise<string>;
  notBefore: Date;
  readStdout: () => string;
  timeoutMs: number;
  wakeAcceptedAt: Date;
  windowMs: number;
}): Promise<number> {
  const deadline = Date.now() + input.timeoutMs;
  // An existing owner's old start cannot substitute for observing this wake.
  let windowStartedAtMs = input.acceptedWake.action === "started"
      || input.acceptedWake.action === "replaced"
    ? null
    : input.wakeAcceptedAt.getTime();
  const observedAdmissions = new Map<string, RuntimeAdmissionObservation>();

  while (Date.now() < deadline) {
    for (const line of input.readStdout().split(/\r?\n/u)) {
      const admission = readRuntimeAdmission(line, input.notBefore);
      if (admission && !observedAdmissions.has(admission.workspaceAttemptId)) {
        observedAdmissions.set(admission.workspaceAttemptId, admission);
      }
    }
    if (windowStartedAtMs === null) {
      const initialAdmission = observedAdmissions.get(
        input.acceptedWake.runtimeAttemptId,
      );
      if (initialAdmission) {
        windowStartedAtMs = Date.parse(initialAdmission.acceptedAt);
      }
    }
    if (windowStartedAtMs !== null) {
      const windowEndMs = windowStartedAtMs + input.windowMs;
      const reminderDueAtMs = Date.parse(input.beforeAt);
      if (!Number.isFinite(reminderDueAtMs) || reminderDueAtMs < windowEndMs) {
        throw new Error(
          "The reminder deadline does not leave one full runtime admission window.",
        );
      }
      if (Date.now() >= windowEndMs) {
        // The response and fresh-start log name the same write-fence attempt.
        // A coalesced wake has that owner even without a new start log.
        const owners = new Set([input.acceptedWake.runtimeAttemptId]);
        for (const admission of observedAdmissions.values()) {
          const acceptedAtMs = Date.parse(admission.acceptedAt);
          if (acceptedAtMs >= windowStartedAtMs && acceptedAtMs < windowEndMs) {
            owners.add(admission.workspaceAttemptId);
          }
        }
        return owners.size;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(await input.buildFailureMessage([
    "Timed out observing the first runtime admission window.",
    `initial owner start observed: ${observedAdmissions.has(input.acceptedWake.runtimeAttemptId)}`,
    `observed fresh owner count: ${observedAdmissions.size}`,
  ]));
}

function readRuntimeAdmission(
  line: string,
  notBefore: Date,
): RuntimeAdmissionObservation | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.trim());
  } catch {
    return null;
  }
  if (
    !isRecord(parsed)
    || parsed.component !== "hosted.runner"
    || parsed.phase !== "runtime.starting"
    || typeof parsed.time !== "string"
    || !Number.isFinite(Date.parse(parsed.time))
    || Date.parse(parsed.time) < notBefore.getTime()
    || !isRecord(parsed.details)
    || typeof parsed.details.orchestrationAttemptId !== "string"
    || typeof parsed.details.runtimeProcessingAction !== "string"
    || typeof parsed.details.workspaceAttemptId !== "string"
  ) {
    return null;
  }
  return {
    acceptedAt: parsed.time,
    workspaceAttemptId: parsed.details.workspaceAttemptId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
