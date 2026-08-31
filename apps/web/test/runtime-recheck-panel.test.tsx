import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
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
  onUseDetectedCandidates: () => undefined,
  overview: OVERVIEW,
  pendingAction: null,
  result: null,
  userIdsText: "hbm_test_alpha, hbm_test_bravo\nhbm_test_manual",
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
        }, {
          errorMessage: "Request deadline reached.",
          errorName: "TimeoutError",
          status: "failed",
          userId: "hbm_test_bravo",
        }],
      },
    )).toBe("hbm_test_bravo\nhbm_test_manual");
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

    expect(markup).toContain("Signal acknowledged; removed from queue");
    expect(markup).toContain("Failed and unsent IDs remain");
    expect(markup).toContain("A recheck request is not proof of recovery.");
    expect(markup).toContain("hbm_test_manual");
  });

  test("renders the exact production panel in the ops screenshot study", () => {
    const markup = renderToStaticMarkup(createElement(RuntimeMaintenanceStudy));

    expect(markup).toContain('data-design-section="stalled-runtime-rechecks"');
    expect(markup).toContain("Runtime rechecks");
    expect(markup).toContain("Recheck result");
  });
});
