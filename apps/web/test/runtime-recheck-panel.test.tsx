import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  hasUnresolvedRuntimeRecheckWitness,
  parseRuntimeRecheckUserIds,
  removeSignaledRuntimeRecheckUserIds,
  RuntimeRecheckPanel,
} from "../app/(dashboard)/ops/runtime-maintenance/runtime-recheck-panel";
import { RuntimeMaintenanceStudy } from "../app/design/runtime-maintenance-study";

type PanelProps = ComponentProps<typeof RuntimeRecheckPanel>;

const OVERVIEW: PanelProps["overview"] = {
  candidates: [{
    pendingItemCount: "13",
    stalledSince: "2026-08-31T14:15:00.000Z",
    userId: "hbm_test_alpha",
  }, {
    pendingItemCount: "8",
    stalledSince: "2026-08-31T14:20:00.000Z",
    userId: "hbm_test_bravo",
  }],
  generatedAt: "2026-08-31T15:00:00.000Z",
  limit: 100,
  scanTruncated: false,
  totalCandidateCount: 2,
};

const BASE_PROPS: PanelProps = {
  disabled: false,
  error: null,
  onInputChange: () => undefined,
  onRecheck: () => undefined,
  onRefresh: () => undefined,
  onStopTracking: () => undefined,
  onUseDetectedCandidates: () => undefined,
  onVerify: () => undefined,
  overview: OVERVIEW,
  pendingAction: null,
  result: null,
  userIdsText: "hbm_test_alpha, hbm_test_bravo\nhbm_test_manual",
  verificationError: null,
  verificationResult: null,
};

describe("RuntimeRecheckPanel", () => {
  test("parses comma and newline input, trims whitespace, and deduplicates IDs", () => {
    const tooLongUserId = `hbm_${"a".repeat(125)}`;
    expect(parseRuntimeRecheckUserIds(
      ` hbm_one, hbm_two\nhbm_one\nmember_three\n${tooLongUserId} `,
    )).toEqual({
      invalidEntries: ["member_three", tooLongUserId],
      userIds: ["hbm_one", "hbm_two"],
    });
  });

  test("keeps reusable member-ID controls separate from legacy-stall discovery", () => {
    const markup = renderToStaticMarkup(
      createElement(RuntimeRecheckPanel, BASE_PROPS),
    );

    expect(markup).toContain("Runtime rechecks");
    expect(markup).toContain("3 unique member IDs queued");
    expect(markup).toContain("Recheck next 3");
    expect(markup).toContain("Use detected candidates");
    expect(markup).toContain("Detected legacy device-sync stalls");
    expect(markup).toContain("hbm_test_manual");
  });

  test("removes only acknowledged IDs after a partial batch result", () => {
    expect(removeSignaledRuntimeRecheckUserIds(
      "hbm_test_alpha\nhbm_test_bravo\nhbm_test_manual",
      {
        generatedAt: "2026-08-31T15:01:00.000Z",
        requestedCount: 3,
        results: [{
          status: "signaled",
          userId: "hbm_test_alpha",
          witness: recoveryWitness("hbm_test_alpha"),
        }, {
          errorMessage: "Request deadline reached.",
          errorName: "TimeoutError",
          status: "failed",
          userId: "hbm_test_bravo",
        }],
      },
    )).toBe("hbm_test_bravo\nhbm_test_manual");
  });

  test("holds one signaled batch until every member has a matching Recovered row", () => {
    const result: NonNullable<PanelProps["result"]> = {
      generatedAt: "2026-08-31T15:01:00.000Z",
      requestedCount: 3,
      results: [{
        status: "signaled",
        userId: "hbm_test_alpha",
        witness: recoveryWitness("hbm_test_alpha"),
      }, {
        status: "signaled",
        userId: "hbm_test_bravo",
        witness: recoveryWitness("hbm_test_bravo"),
      }, {
        errorMessage: "Request deadline reached.",
        errorName: "TimeoutError",
        status: "failed",
        userId: "hbm_test_charlie",
      }],
    };

    expect(hasUnresolvedRuntimeRecheckWitness(result, null)).toBe(true);
    for (const status of [
      "requested",
      "checkpoint_advanced",
      "progressing",
      "unknown",
    ] as const) {
      expect(hasUnresolvedRuntimeRecheckWitness(result, {
        generatedAt: "2026-08-31T15:06:00.000Z",
        results: [{
          explanation: "Recovered.",
          status: "recovered",
          userId: "hbm_test_alpha",
        }, {
          explanation: "Not yet recovered.",
          status,
          userId: "hbm_test_bravo",
        }],
      })).toBe(true);
    }
    expect(hasUnresolvedRuntimeRecheckWitness(result, {
      generatedAt: "2026-08-31T15:06:00.000Z",
      results: ["hbm_test_alpha", "hbm_test_bravo"].map((userId) => ({
        explanation: "Recovered.",
        status: "recovered" as const,
        userId,
      })),
    })).toBe(false);
    expect(hasUnresolvedRuntimeRecheckWitness({
      generatedAt: "2026-08-31T15:07:00.000Z",
      requestedCount: 1,
      results: [{
        errorMessage: "Request deadline reached.",
        errorName: "TimeoutError",
        status: "failed",
        userId: "hbm_test_charlie",
      }],
    }, null)).toBe(false);
  });

  test("communicates pending and ambiguous request states without dropping queued IDs", () => {
    const pendingMarkup = renderToStaticMarkup(
      createElement(RuntimeRecheckPanel, {
        ...BASE_PROPS,
        disabled: true,
        pendingAction: "recheck",
      }),
    );
    const errorMarkup = renderToStaticMarkup(
      createElement(RuntimeRecheckPanel, {
        ...BASE_PROPS,
        error: {
          kind: "request",
          message: "Request deadline reached.",
        },
      }),
    );

    expect(pendingMarkup).toContain('aria-busy="true"');
    expect(pendingMarkup).toContain("Requesting 3 runtime rechecks.");
    expect(errorMarkup).toContain("Recheck status is unknown.");
    expect(errorMarkup).toContain("member IDs remain queued");
  });

  test("labels partial results and preserves the non-recovery boundary", () => {
    const markup = renderToStaticMarkup(
      createElement(RuntimeRecheckPanel, {
        ...BASE_PROPS,
        result: {
          generatedAt: "2026-08-31T15:01:00.000Z",
          requestedCount: 2,
          results: [{
            status: "signaled",
            userId: "hbm_test_alpha",
            witness: recoveryWitness("hbm_test_alpha"),
          }, {
            errorMessage: "Request deadline reached.",
            errorName: "TimeoutError",
            status: "failed",
            userId: "hbm_test_bravo",
          }],
        },
        userIdsText: "hbm_test_bravo\nhbm_test_manual",
      }),
    );

    expect(markup).toContain("Signal accepted; captured head 6 through fixed target 13");
    expect(markup).toContain("Another batch is paused until every signaled member is verified as Recovered");
    expect(markup).toContain("Stop tracking this batch and continue");
    expect(buttonOpeningTag(markup, "Recheck next 2")).toContain(' disabled=""');
    expect(markup).toContain("Failed and unsent IDs remain queued");
    expect(markup).toContain("Requested means only that the signal was accepted.");
    expect(markup).toContain("hbm_test_manual");
  });

  test("renders the exact production panel in the ops screenshot study", () => {
    const markup = renderToStaticMarkup(createElement(RuntimeMaintenanceStudy));

    expect(markup).toContain('data-design-section="stalled-runtime-rechecks"');
    expect(markup).toContain("Runtime rechecks");
    expect(markup).toContain("Recheck result");
    expect(markup).toContain("Progressing");
    expect(markup).toContain("Stop tracking this batch and continue");
  });

  test("renders all canonical verification states with bounded recovery wording", () => {
    const statuses = [
      ["requested", "Requested", "request was accepted"],
      ["checkpoint_advanced", "Checkpoint advanced", "captured head remains live"],
      ["progressing", "Progressing", "fixed request-time imported target"],
      ["recovered", "Recovered", "does not prove global health or idleness"],
      ["unknown", "Unknown", "cannot safely verify"],
    ] as const;

    for (const [status, label, explanation] of statuses) {
      const markup = renderToStaticMarkup(createElement(RuntimeRecheckPanel, {
        ...BASE_PROPS,
        result: {
          generatedAt: "2026-08-31T15:01:00.000Z",
          requestedCount: 1,
          results: [{
            status: "signaled",
            userId: "hbm_test_alpha",
            witness: recoveryWitness("hbm_test_alpha"),
          }],
        },
        verificationResult: {
          generatedAt: "2026-08-31T15:06:00.000Z",
          results: [{
            explanation: verificationExplanation(status),
            status,
            userId: "hbm_test_alpha",
          }],
        },
      }));

      expect(markup).toContain(label);
      expect(markup).toContain(explanation);
      expect(markup).toContain("Verify progress");
      expect(markup.includes("Stop tracking this batch and continue")).toBe(
        status !== "recovered",
      );
      expect(buttonOpeningTag(markup, "Recheck next 3").includes(' disabled=""')).toBe(
        status !== "recovered",
      );
      expect(markup.match(/lucide-circle-check/gu)?.length ?? 0).toBe(
        status === "recovered" ? 1 : 0,
      );
    }
  });

  test("treats a missing verification row as Unknown instead of Requested", () => {
    const markup = renderToStaticMarkup(createElement(RuntimeRecheckPanel, {
      ...BASE_PROPS,
      result: {
        generatedAt: "2026-08-31T15:01:00.000Z",
        requestedCount: 1,
        results: [{
          status: "signaled",
          userId: "hbm_test_alpha",
          witness: recoveryWitness("hbm_test_alpha"),
        }],
      },
      verificationResult: {
        generatedAt: "2026-08-31T15:06:00.000Z",
        results: [{
          explanation: "A different captured witness could not be verified.",
          status: "unknown",
          userId: "hbm_test_bravo",
        }],
      },
    }));

    expect(markup).toContain(">Unknown</span>");
    expect(markup).toContain(
      "Verification returned no matching result for this captured witness.",
    );
    expect(markup).not.toContain(">Requested</span>");
  });

  test("renders request and verification times in polite live result regions", () => {
    const markup = renderToStaticMarkup(createElement(RuntimeRecheckPanel, {
      ...BASE_PROPS,
      result: {
        generatedAt: "2026-08-31T15:01:00.000Z",
        requestedCount: 1,
        results: [{
          status: "signaled",
          userId: "hbm_test_alpha",
          witness: recoveryWitness("hbm_test_alpha"),
        }],
      },
      verificationResult: {
        generatedAt: "2026-08-31T15:06:00.000Z",
        results: [{
          explanation: verificationExplanation("progressing"),
          status: "progressing",
          userId: "hbm_test_alpha",
        }],
      },
    }));

    expect(markup).toContain("Requested Aug 31, 03:01 PM UTC");
    expect(markup).toContain("Verified Aug 31, 03:06 PM UTC");
    expect(markup).toContain('<p aria-live="polite"');
    expect(markup).toContain('<div aria-live="polite" class="divide-y');
  });

  test("labels an in-flight manual verification", () => {
    const markup = renderToStaticMarkup(createElement(RuntimeRecheckPanel, {
      ...BASE_PROPS,
      pendingAction: "verify",
      result: {
        generatedAt: "2026-08-31T15:01:00.000Z",
        requestedCount: 1,
        results: [{
          status: "signaled",
          userId: "hbm_test_alpha",
          witness: recoveryWitness("hbm_test_alpha"),
        }],
      },
    }));

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Verifying...");
  });

  test("retains the captured result when verification fails", () => {
    const markup = renderToStaticMarkup(createElement(RuntimeRecheckPanel, {
      ...BASE_PROPS,
      result: {
        generatedAt: "2026-08-31T15:01:00.000Z",
        requestedCount: 1,
        results: [{
          status: "signaled",
          userId: "hbm_test_alpha",
          witness: recoveryWitness("hbm_test_alpha"),
        }],
      },
      verificationError: "Verification request failed.",
    }));

    expect(markup).toContain("Verification request failed.");
    expect(markup).toContain("captured baselines and prior results are retained");
    expect(markup).toContain("hbm_test_alpha");
    expect(markup).toContain("Verify progress");
    expect(markup).toContain("Stop tracking this batch and continue");
    expect(buttonOpeningTag(markup, "Recheck next 3")).toContain(' disabled=""');
  });

  test("does not gate the next batch when every prior result failed", () => {
    const markup = renderToStaticMarkup(createElement(RuntimeRecheckPanel, {
      ...BASE_PROPS,
      result: {
        generatedAt: "2026-08-31T15:01:00.000Z",
        requestedCount: 1,
        results: [{
          errorMessage: "Request deadline reached.",
          errorName: "TimeoutError",
          status: "failed",
          userId: "hbm_test_alpha",
        }],
      },
    }));

    expect(markup).not.toContain("Stop tracking this batch and continue");
    expect(markup).not.toContain("Another batch is paused");
    expect(buttonOpeningTag(markup, "Recheck next 3")).not.toContain(' disabled=""');
  });
});

function buttonOpeningTag(markup: string, label: string): string {
  const labelIndex = markup.indexOf(label);
  const buttonStart = markup.lastIndexOf("<button", labelIndex);
  const buttonEnd = markup.indexOf(">", buttonStart);
  expect(labelIndex).toBeGreaterThanOrEqual(0);
  expect(buttonStart).toBeGreaterThanOrEqual(0);
  expect(buttonEnd).toBeGreaterThan(buttonStart);
  return markup.slice(buttonStart, buttonEnd + 1);
}

function recoveryWitness(userId: string) {
  return {
    allocatedSystemHighWater: "18",
    canonicalSystemConsumed: "5",
    checkpointedAt: "2026-08-31T14:00:00.000Z",
    importedSystemSequence: "13",
    integrity: "synthetic_test_witness_not_a_live_request_123",
    observedAt: "2026-08-31T15:01:00.000Z",
    capturedHeadSequence: "6",
    userId,
    workspaceVersion: "24",
  };
}

function verificationExplanation(status: string): string {
  switch (status) {
    case "requested":
      return "The request was accepted, but canonical consumption and the checkpoint timestamp have not advanced.";
    case "checkpoint_advanced":
      return "A newer workspace version and checkpoint exist, but the captured head remains live and unconsumed.";
    case "progressing":
      return "Canonical consumption reached the captured head but remains below the fixed request-time imported target.";
    case "recovered":
      return "Canonical consumption reached the fixed captured prefix with a newer checkpoint. This does not prove global health or idleness.";
    default:
      return "The current canonical facts cannot safely verify this request-time witness.";
  }
}
