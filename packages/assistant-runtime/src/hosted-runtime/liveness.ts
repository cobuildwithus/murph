export const RUNTIME_LIVENESS_DEFAULT_INTERVAL_MS = 5_000;
export const RUNTIME_LIVENESS_TOUCH_TIMEOUT_MAX_MS = 2_000;

export type RuntimeLivenessRejectionReason =
  | "malformed_request"
  | "no_active_invocation"
  | "stale_attempt"
  | "stale_generation"
  | "unauthorized"
  | "wrong_user";

export type RuntimeLivenessInstruction =
  | { kind: "continue" }
  | { kind: "yield"; nextWakeAt?: string | null; status: "scheduled" };

export type RuntimeLivenessTouchResult =
  | {
      instruction: RuntimeLivenessInstruction;
      ok: true;
    }
  | {
      ok: false;
      reason: RuntimeLivenessRejectionReason;
    };

export interface RuntimeLivenessPort {
  touch(input: {
    requestId: string;
    signal?: AbortSignal | null;
  }): Promise<RuntimeLivenessTouchResult>;
}
