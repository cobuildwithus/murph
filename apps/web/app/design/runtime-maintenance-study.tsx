"use client";

import type { ComponentProps } from "react";

import { RuntimeRecheckPanel } from "../(dashboard)/ops/runtime-maintenance/runtime-recheck-panel";

type RuntimeRecheckPanelProps = ComponentProps<
  typeof RuntimeRecheckPanel
>;

const DESIGN_STALLED_RECHECK_OVERVIEW: RuntimeRecheckPanelProps["overview"] = {
  candidates: [{
    pendingItemCount: "13",
    stalledSince: "2026-08-31T14:15:00.000Z",
    userId: "hbm_demo_alpha",
  }, {
    pendingItemCount: "8",
    stalledSince: "2026-08-31T14:22:00.000Z",
    userId: "hbm_demo_bravo",
  }, {
    pendingItemCount: "3",
    stalledSince: "2026-08-31T14:31:00.000Z",
    userId: "hbm_demo_charlie",
  }],
  generatedAt: "2026-08-31T15:00:00.000Z",
  limit: 100,
  scanTruncated: false,
  totalCandidateCount: 5,
};

const DESIGN_STALLED_RECHECK_RESULT: NonNullable<
  RuntimeRecheckPanelProps["result"]
> = {
  generatedAt: "2026-08-31T15:01:00.000Z",
  requestedCount: 2,
  results: [{
    status: "signaled",
    userId: "hbm_demo_alpha",
    witness: {
      allocatedSystemHighWater: "18",
      canonicalSystemConsumed: "5",
      checkpointedAt: "2026-08-31T14:00:00.000Z",
      importedSystemSequence: "13",
      integrity: "synthetic_design_witness_not_a_live_request_1",
      observedAt: "2026-08-31T15:01:00.000Z",
      capturedHeadSequence: "6",
      userId: "hbm_demo_alpha",
      workspaceVersion: "24",
    },
  }, {
    errorMessage: "The runtime did not acknowledge the signal before the request deadline.",
    errorName: "TimeoutError",
    status: "failed",
    userId: "hbm_demo_bravo",
  }],
};

const DESIGN_STALLED_RECHECK_VERIFICATION: NonNullable<
  RuntimeRecheckPanelProps["verificationResult"]
> = {
  generatedAt: "2026-08-31T15:06:00.000Z",
  results: [{
    explanation: "Canonical consumption reached the captured head but remains below the fixed request-time imported target.",
    status: "progressing",
    userId: "hbm_demo_alpha",
  }],
};

export function RuntimeMaintenanceStudy() {
  return (
    <div
      className="scroll-mt-24"
      data-design-section="stalled-runtime-rechecks"
      inert
    >
      <RuntimeRecheckPanel
        disabled={false}
        error={null}
        onInputChange={() => undefined}
        onRecheck={() => undefined}
        onRefresh={() => undefined}
        onStopTracking={() => undefined}
        onUseDetectedCandidates={() => undefined}
        onVerify={() => undefined}
        overview={DESIGN_STALLED_RECHECK_OVERVIEW}
        pendingAction={null}
        result={DESIGN_STALLED_RECHECK_RESULT}
        userIdsText={"hbm_demo_bravo\nhbm_demo_charlie\nhbm_demo_manual"}
        verificationError={null}
        verificationResult={DESIGN_STALLED_RECHECK_VERIFICATION}
      />
    </div>
  );
}
