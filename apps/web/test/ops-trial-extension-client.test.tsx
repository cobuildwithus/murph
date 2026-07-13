import { act, createElement, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("lucide-react", () => ({
  AlertCircleIcon: () => createElement("svg"),
  CalendarPlusIcon: () => createElement("svg"),
  SearchIcon: () => createElement("svg"),
}));

vi.mock("@/src/components/ui/alert", () => ({
  Alert: ({ variant, ...props }: ComponentProps<"div"> & { variant?: string }) => {
    void variant;
    return createElement("div", { role: "alert", ...props });
  },
  AlertDescription: (props: ComponentProps<"div">) => createElement("div", props),
}));

vi.mock("@/src/components/ui/badge", () => ({
  Badge: ({ variant, ...props }: ComponentProps<"span"> & { variant?: string }) => {
    void variant;
    return createElement("span", props);
  },
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: ({
    size,
    variant,
    ...props
  }: ComponentProps<"button"> & { size?: string; variant?: string }) => {
    void size;
    void variant;
    return createElement("button", props);
  },
}));

vi.mock("@/src/components/ui/input", () => ({
  Input: ({ onChange, ...props }: ComponentProps<"input">) =>
    createElement("input", { ...props, onInput: onChange }),
}));

vi.mock("@/src/components/ui/label", () => ({
  Label: (props: ComponentProps<"label">) => createElement("label", props),
}));

import { TrialExtensionClient } from "../app/(dashboard)/ops/trials/trial-extension-client";
import {
  HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
  type HostedPulseTrialExtensionSummary,
} from "../src/lib/hosted-ops/pulse-trial-extension";
import { renderClientComponent } from "./render-client-component";

const fetchMock = vi.fn<typeof fetch>();
const CANDIDATE_SNAPSHOT_DIGEST = `pulse-candidates-v4.${"a".repeat(43)}`;
const CANDIDATE_PREVIEW_TOKEN = `pulse-target-v3.${"b".repeat(43)}`;
const CONTINUATION_TOKEN =
  `pulse-cursor-v3.v1.${"a".repeat(16)}.${"b".repeat(8)}.${"c".repeat(22)}`;
const TRIAL_EXTENSION_FAILURE_TYPES = [
  "db_update_failed",
  "member_lock_busy",
  "preview_state_changed",
  "provider_recovery_failed",
  "provider_recovery_lookup_failed",
  "route_runway_exhausted",
  "stripe_retrieve_failed",
  "stripe_update_failed",
  "stripe_update_result_invalid",
] as const satisfies ReadonlyArray<keyof HostedPulseTrialExtensionSummary["failures"]>;
let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  vi.unstubAllGlobals();
});

describe("TrialExtensionClient", () => {
  test("disables changing inputs while requests are pending and applies the previewed target", async () => {
    const previewRequest = createDeferred<Response>();
    const applyRequest = createDeferred<Response>();
    fetchMock
      .mockReturnValueOnce(previewRequest.promise)
      .mockReturnValueOnce(applyRequest.promise);

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const focusMock = vi.fn();
    Object.defineProperty(rendered.window.HTMLElement.prototype, "focus", {
      configurable: true,
      value: focusMock,
    });
    const memberSection = getSection(rendered.container, 1);
    const memberInput = getInput(memberSection, 0);

    await changeInput(rendered.window, memberInput, "  member_one  ");
    expect(memberInput.value).toBe("  member_one  ");
    expect(getButton(memberSection, "Preview").disabled).toBe(false);
    await clickButton(rendered.window, getButton(memberSection, "Preview"));

    expect(memberInput.disabled).toBe(true);
    expect(getButton(memberSection, "Previewing...").disabled).toBe(true);
    expect(readRequestBody(0)).toEqual({
      memberId: "member_one",
      mode: "dry-run",
    });

    // A disabled control cannot change through normal interaction. Force the
    // state transition to prove a late preview still owns its captured target.
    memberInput.disabled = false;
    await changeInput(rendered.window, memberInput, "member_two");

    await act(async () => {
      previewRequest.resolve(jsonResponse(buildSummary("dry-run", { wouldExtend: 1 })));
      await previewRequest.promise;
    });

    const confirmationInput = getInput(memberSection, 1);
    await changeInput(
      rendered.window,
      confirmationInput,
      HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    );
    await clickButton(rendered.window, getButton(memberSection, "Apply batch"));

    expect(readRequestBody(1)).toEqual({
      campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
      candidatePreviewTokens: [CANDIDATE_PREVIEW_TOKEN],
      candidateSnapshotDigest: CANDIDATE_SNAPSHOT_DIGEST,
      memberId: "member_one",
      mode: "apply",
    });
    expect(memberInput.disabled).toBe(true);
    expect(confirmationInput.disabled).toBe(true);

    await act(async () => {
      applyRequest.resolve(jsonResponse(buildSummary("apply")));
      await applyRequest.promise;
    });

    const appliedStatus = memberSection.querySelector('[role="status"]');
    expect(appliedStatus?.textContent).toContain("Applied");
    expect(focusMock).toHaveBeenCalledTimes(2);
  });

  test("changing a member after preview removes the confirmation and apply action", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(buildSummary("dry-run", { wouldExtend: 1 })),
    );

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const memberSection = getSection(rendered.container, 1);
    const memberInput = getInput(memberSection, 0);

    await changeInput(rendered.window, memberInput, "member_one");
    await clickButton(rendered.window, getButton(memberSection, "Preview"));
    expect(getButton(memberSection, "Apply batch")).toBeDefined();

    await changeInput(rendered.window, memberInput, "member_two");

    expect(findButton(memberSection, "Apply batch")).toBeUndefined();
    expect(memberSection.querySelectorAll("input")).toHaveLength(1);
    expect(memberSection.textContent).not.toContain("Run key");
  });

  test("a failed preview refresh cannot leave a stale apply action", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", { wouldExtend: 1 })))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: "Preview could not be refreshed." } },
          409,
        ),
      );

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const memberSection = getSection(rendered.container, 1);

    await changeInput(rendered.window, getInput(memberSection, 0), "member_one");
    await clickButton(rendered.window, getButton(memberSection, "Preview"));
    await changeInput(
      rendered.window,
      getInput(memberSection, 1),
      HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    );
    expect(getButton(memberSection, "Apply batch")).toBeDefined();

    await clickButton(rendered.window, getButton(memberSection, "Preview"));

    expect(memberSection.textContent).toContain("Preview could not be refreshed.");
    expect(findButton(memberSection, "Apply batch")).toBeUndefined();
    expect(memberSection.querySelectorAll("input")).toHaveLength(1);
  });

  test("an unverifiable preview cannot expose an apply action", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(buildSummary("dry-run", {
        candidateSnapshotDigest: null,
        wouldExtend: 1,
      })),
    );

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const allSection = getSection(rendered.container, 0);

    await clickButton(rendered.window, getButton(allSection, "Preview"));

    expect(allSection.textContent).toContain("Preview could not be verified");
    expect(findButton(allSection, "Apply batch")).toBeUndefined();
    expect(allSection.textContent).not.toContain("Type pulse-beta-extension");
  });

  test("an incomplete provider preview cannot expose an apply action", async () => {
    const incompletePreview = buildSummary("dry-run", { wouldExtend: 1 });
    incompletePreview.failures.stripe_retrieve_failed = 1;
    incompletePreview.candidatePreviewTokens = [""];
    fetchMock.mockResolvedValueOnce(jsonResponse(incompletePreview));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const allSection = getSection(rendered.container, 0);

    await clickButton(rendered.window, getButton(allSection, "Preview"));

    expect(allSection.textContent).toContain("Preview incomplete");
    expect(allSection.textContent).toContain("stripe_retrieve_failed: 1");
    expect(allSection.textContent).toContain("Apply is unavailable");
    expect(findButton(allSection, "Apply batch")).toBeUndefined();
  });

  test.each(TRIAL_EXTENSION_FAILURE_TYPES)(
    "a page with %s cannot navigate through its continuation",
    async (failureType) => {
      const failedPage = buildSummary("dry-run", {
        hasMoreCandidates: true,
        nextContinuationToken: CONTINUATION_TOKEN,
      });
      failedPage.failures[failureType] = 1;
      fetchMock.mockResolvedValueOnce(jsonResponse(failedPage));

      const rendered = await renderClientComponent(createElement(TrialExtensionClient));
      cleanupRender = rendered.cleanup;
      const allSection = getSection(rendered.container, 0);

      await clickButton(rendered.window, getButton(allSection, "Preview"));

      expect(getButton(allSection, "Preview next batch").disabled).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  test("a failed member page asks for a retry instead of impossible navigation", async () => {
    const failedPage = buildSummary("dry-run", {
      candidatePreviewTokens: [],
      candidates: 0,
      hasMoreCandidates: true,
      nextContinuationToken: CONTINUATION_TOKEN,
    });
    failedPage.failures.provider_recovery_lookup_failed = 1;
    fetchMock.mockResolvedValueOnce(jsonResponse(failedPage));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const memberSection = getSection(rendered.container, 1);
    await changeInput(rendered.window, getInput(memberSection, 0), "member_target");

    await clickButton(rendered.window, getButton(memberSection, "Preview"));

    expect(memberSection.textContent).toContain(
      "Retry this batch before continuing the member search.",
    );
    expect(memberSection.textContent).not.toContain(
      "Preview the next batch to continue the member search",
    );
    expect(getButton(memberSection, "Preview next batch").disabled).toBe(true);
  });

  test("navigates bounded all-member batches with opaque continuation", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
        hasMoreCandidates: true,
        nextContinuationToken: CONTINUATION_TOKEN,
      })))
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run")))
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
        hasMoreCandidates: true,
        nextContinuationToken: CONTINUATION_TOKEN,
      })));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const focusMock = vi.fn();
    Object.defineProperty(rendered.window.HTMLElement.prototype, "focus", {
      configurable: true,
      value: focusMock,
    });
    const allSection = getSection(rendered.container, 0);

    await clickButton(rendered.window, getButton(allSection, "Preview"));
    expect(allSection.textContent).toContain("Batch 1 · more batches");
    expect(focusMock).toHaveBeenCalledTimes(1);
    await clickButton(rendered.window, getButton(allSection, "Preview next batch"));

    expect(readRequestBody(1)).toEqual({
      continuationToken: CONTINUATION_TOKEN,
      mode: "dry-run",
    });
    expect(allSection.textContent).toContain("Batch 2 · final batch");
    expect(focusMock).toHaveBeenCalledTimes(2);
    await clickButton(rendered.window, getButton(allSection, "Previous batch"));

    expect(readRequestBody(2)).toEqual({ mode: "dry-run" });
    expect(allSection.textContent).toContain("Batch 1 · more batches");
    expect(focusMock).toHaveBeenCalledTimes(3);
  });

  test("continues member-scoped Preview through an empty provider batch", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
        candidatePreviewTokens: [],
        candidates: 0,
        hasMoreCandidates: true,
        nextContinuationToken: CONTINUATION_TOKEN,
      })))
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
        wouldExtend: 1,
      })));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const memberSection = getSection(rendered.container, 1);
    await changeInput(rendered.window, getInput(memberSection, 0), "member_target");

    await clickButton(rendered.window, getButton(memberSection, "Preview"));
    expect(memberSection.textContent).toContain("Batch 1 · more batches");
    expect(memberSection.textContent).toContain(
      "Preview the next batch to continue the member search",
    );
    await clickButton(rendered.window, getButton(memberSection, "Preview next batch"));

    expect(readRequestBody(1)).toEqual({
      continuationToken: CONTINUATION_TOKEN,
      memberId: "member_target",
      mode: "dry-run",
    });
    expect(memberSection.textContent).toContain("Batch 2 · final batch");
    expect(memberSection.textContent).toContain("Would get 7 days1");
  });

  test("keeps a non-actionable member batch non-terminal while more pages remain", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
      hasMoreCandidates: true,
      nextContinuationToken: CONTINUATION_TOKEN,
    })));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const memberSection = getSection(rendered.container, 1);
    await changeInput(rendered.window, getInput(memberSection, 0), "member_target");

    await clickButton(rendered.window, getButton(memberSection, "Preview"));

    expect(memberSection.textContent).toContain(
      "Nothing to change in this batch. Preview the next batch to continue the member search.",
    );
    expect(memberSection.textContent).not.toContain("Nothing to change right now.");
  });

  test("describes a later empty member batch as no additional match", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
        hasMoreCandidates: true,
        nextContinuationToken: CONTINUATION_TOKEN,
        wouldExtend: 1,
      })))
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
        candidatePreviewTokens: [],
        candidates: 0,
      })));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const memberSection = getSection(rendered.container, 1);
    await changeInput(rendered.window, getInput(memberSection, 0), "member_target");
    await clickButton(rendered.window, getButton(memberSection, "Preview"));
    await clickButton(rendered.window, getButton(memberSection, "Preview next batch"));

    expect(memberSection.textContent).toContain(
      "Member search complete. No additional eligible campaign trial was found.",
    );
    expect(memberSection.textContent).not.toContain(
      "No eligible campaign trial found for that member id.",
    );
  });

  test("restarts a later batch at Batch 1 without replaying its continuation", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
        hasMoreCandidates: true,
        nextContinuationToken: CONTINUATION_TOKEN,
      })))
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run")))
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
        hasMoreCandidates: true,
        nextContinuationToken: CONTINUATION_TOKEN,
      })));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const allSection = getSection(rendered.container, 0);

    await clickButton(rendered.window, getButton(allSection, "Preview"));
    await clickButton(rendered.window, getButton(allSection, "Preview next batch"));
    expect(allSection.textContent).toContain("Batch 2 · final batch");
    await clickButton(rendered.window, getButton(allSection, "Restart at Batch 1"));

    expect(readRequestBody(2)).toEqual({ mode: "dry-run" });
    expect(allSection.textContent).toContain("Batch 1 · more batches");
  });

  test("an invalid continuation resets the next Preview to Batch 1", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
        hasMoreCandidates: true,
        nextContinuationToken: CONTINUATION_TOKEN,
      })))
      .mockResolvedValueOnce(jsonResponse({
        error: {
          code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_CONTINUATION_INVALID",
          message: "Trial extension continuation is invalid. Restart at Batch 1.",
        },
      }, 400))
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run")));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const allSection = getSection(rendered.container, 0);

    await clickButton(rendered.window, getButton(allSection, "Preview"));
    await clickButton(rendered.window, getButton(allSection, "Preview next batch"));
    expect(allSection.textContent).toContain("Batch 1 is ready to Preview.");
    await clickButton(rendered.window, getButton(allSection, "Preview"));

    expect(readRequestBody(2)).toEqual({ mode: "dry-run" });
    expect(allSection.textContent).toContain("Batch 1 · final batch");
  });

  test("an apply failure retains the matching preview and confirmation for retry", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", { wouldExtend: 1 })))
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Apply failed safely." } }, 500),
      );

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const memberSection = getSection(rendered.container, 1);

    await changeInput(rendered.window, getInput(memberSection, 0), "member_one");
    await clickButton(rendered.window, getButton(memberSection, "Preview"));
    const confirmationInput = getInput(memberSection, 1);
    await changeInput(
      rendered.window,
      confirmationInput,
      HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    );
    await clickButton(rendered.window, getButton(memberSection, "Apply batch"));

    expect(memberSection.textContent).toContain("Apply failed safely.");
    expect(getButton(memberSection, "Apply batch")).toBeDefined();
    expect(confirmationInput.value).toBe(HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN);
  });

  test("a stale apply response clears the obsolete preview", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", { wouldExtend: 1 })))
      .mockResolvedValueOnce(
        jsonResponse({
          error: {
            code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_PREVIEW_STALE",
            message: "Eligible trials changed since Preview. Preview again before applying.",
          },
        }, 409),
      );

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const allSection = getSection(rendered.container, 0);

    await clickButton(rendered.window, getButton(allSection, "Preview"));
    await changeInput(
      rendered.window,
      getInput(allSection, 0),
      HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    );
    await clickButton(rendered.window, getButton(allSection, "Apply batch"));

    expect(allSection.textContent).toContain("Eligible trials changed since Preview");
    expect(findButton(allSection, "Apply batch")).toBeUndefined();
    expect(allSection.querySelectorAll("input")).toHaveLength(0);
  });

  test("an invalid continuation during Apply resets the next Preview to Batch 1", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
        hasMoreCandidates: true,
        nextContinuationToken: CONTINUATION_TOKEN,
      })))
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", { wouldExtend: 1 })))
      .mockResolvedValueOnce(jsonResponse({
        error: {
          code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_CONTINUATION_INVALID",
          message: "Trial extension continuation is invalid. Restart at Batch 1.",
        },
      }, 400))
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run")));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const allSection = getSection(rendered.container, 0);

    await clickButton(rendered.window, getButton(allSection, "Preview"));
    await clickButton(rendered.window, getButton(allSection, "Preview next batch"));
    await changeInput(
      rendered.window,
      getInput(allSection, 0),
      HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    );
    await clickButton(rendered.window, getButton(allSection, "Apply batch"));

    expect(allSection.textContent).toContain("Batch 1 is ready to Preview.");
    expect(findButton(allSection, "Apply batch")).toBeUndefined();
    await clickButton(rendered.window, getButton(allSection, "Preview"));
    expect(readRequestBody(3)).toEqual({ mode: "dry-run" });
  });

  test("a partial apply result stays confirmed and available for an idempotent retry", async () => {
    const partialApply = buildSummary("apply");
    partialApply.failures.stripe_update_failed = 1;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", { wouldExtend: 1 })))
      .mockResolvedValueOnce(jsonResponse(partialApply));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const memberSection = getSection(rendered.container, 1);

    await changeInput(rendered.window, getInput(memberSection, 0), "member_one");
    await clickButton(rendered.window, getButton(memberSection, "Preview"));
    const confirmationInput = getInput(memberSection, 1);
    await changeInput(
      rendered.window,
      confirmationInput,
      HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    );
    await clickButton(rendered.window, getButton(memberSection, "Apply batch"));

    expect(memberSection.textContent).toContain("Needs retry");
    expect(memberSection.textContent).toContain("stripe_update_failed: 1");
    expect(getButton(memberSection, "Apply batch")).toBeDefined();
    expect(confirmationInput.value).toBe(HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN);
  });

  test("a partial apply that reconciles local state requires a new preview", async () => {
    const partialApply = buildSummary("apply", { localWindowsReconciled: 1 });
    partialApply.failures.stripe_update_failed = 1;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", { wouldExtend: 2 })))
      .mockResolvedValueOnce(jsonResponse(partialApply));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const allSection = getSection(rendered.container, 0);

    await clickButton(rendered.window, getButton(allSection, "Preview"));
    await changeInput(
      rendered.window,
      getInput(allSection, 0),
      HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    );
    await clickButton(rendered.window, getButton(allSection, "Apply batch"));

    expect(allSection.textContent).toContain("Needs retry");
    expect(findButton(allSection, "Apply batch")).toBeUndefined();
    expect(allSection.querySelectorAll("input")).toHaveLength(0);
  });

  test("a partial apply with changed local eligibility requires a new preview", async () => {
    const partialApply = buildSummary("apply");
    partialApply.failures.stripe_update_failed = 1;
    partialApply.skipped.local_candidate_changed = 1;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", { wouldExtend: 2 })))
      .mockResolvedValueOnce(jsonResponse(partialApply));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const allSection = getSection(rendered.container, 0);

    await clickButton(rendered.window, getButton(allSection, "Preview"));
    await changeInput(
      rendered.window,
      getInput(allSection, 0),
      HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    );
    await clickButton(rendered.window, getButton(allSection, "Apply batch"));

    expect(allSection.textContent).toContain("Needs retry");
    expect(allSection.textContent).toContain("local_candidate_changed (1)");
    expect(findButton(allSection, "Apply batch")).toBeUndefined();
    expect(allSection.querySelectorAll("input")).toHaveLength(0);
  });

  test("a targeted provider-only trial is recovered and extended in one Apply", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
        wouldRecoverProviderTrial: 1,
        wouldExtend: 1,
      })))
      .mockResolvedValueOnce(jsonResponse(buildSummary("apply", {
        providerTrialsRecovered: 1,
        stripeTrialsExtended: 1,
      })));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const memberSection = getSection(rendered.container, 1);

    expect(memberSection.textContent).toContain("one Apply");
    await changeInput(rendered.window, getInput(memberSection, 0), "member_one");
    await clickButton(rendered.window, getButton(memberSection, "Preview"));
    expect(memberSection.textContent).toContain("Would recover trial");
    await changeInput(
      rendered.window,
      getInput(memberSection, 1),
      HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    );
    await clickButton(rendered.window, getButton(memberSection, "Apply batch"));

    expect(memberSection.textContent).toContain("Provider trials recovered");
    expect(memberSection.textContent).toContain("Got 7 days");
    expect(memberSection.textContent).not.toContain("Preview this member again");
    expect(findButton(memberSection, "Apply batch")).toBeUndefined();
    expect(memberSection.querySelectorAll("input")).toHaveLength(1);
  });

  test("provider-only cleanup explains that current billing was preserved", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(buildSummary("dry-run", {
        wouldCleanupProviderTrial: 1,
      })))
      .mockResolvedValueOnce(jsonResponse(buildSummary("apply", {
        providerTrialsCleanedUp: 1,
      })));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const memberSection = getSection(rendered.container, 1);

    await changeInput(rendered.window, getInput(memberSection, 0), "member_one");
    await clickButton(rendered.window, getButton(memberSection, "Preview"));
    expect(memberSection.textContent).toContain("Would clean up trial");
    await changeInput(
      rendered.window,
      getInput(memberSection, 1),
      HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    );
    await clickButton(rendered.window, getButton(memberSection, "Apply batch"));

    expect(memberSection.textContent).toContain("Provider trials cleaned up");
    expect(memberSection.textContent).toContain(
      "Obsolete provider trial cleaned up. Current billing was left unchanged.",
    );
  });

  test("renders an ended provider trial as a stable no-action skip", async () => {
    const summary = buildSummary("dry-run");
    summary.skipped.provider_trial_ended = 1;
    fetchMock.mockResolvedValueOnce(jsonResponse(summary));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const allSection = getSection(rendered.container, 0);

    await clickButton(rendered.window, getButton(allSection, "Preview"));

    expect(allSection.textContent).toContain(
      "Provider trial already ended — no action needed (1)",
    );
    expect(allSection.textContent).not.toContain("provider_trial_ended");
  });

  test("the all-member preview omits memberId and explains bounded batches", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(buildSummary("dry-run")));

    const rendered = await renderClientComponent(createElement(TrialExtensionClient));
    cleanupRender = rendered.cleanup;
    const allSection = getSection(rendered.container, 0);

    expect(allSection.textContent).toContain("ordered batches of up to four");
    expect(allSection.textContent).toContain(
      "restart at Batch 1 and Preview every batch again",
    );
    await clickButton(rendered.window, getButton(allSection, "Preview"));

    expect(readRequestBody(0)).toEqual({ mode: "dry-run" });
    expect(rendered.container.textContent).toContain(
      "already extended trials are not extended again",
    );
    expect(rendered.container.textContent).not.toContain("Already done today");
  });
});

function buildSummary(
  mode: HostedPulseTrialExtensionSummary["mode"],
  overrides: Partial<HostedPulseTrialExtensionSummary> = {},
): HostedPulseTrialExtensionSummary {
  return {
    alreadyExtended: 0,
    campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    candidatePreviewTokens: mode === "dry-run" ? [CANDIDATE_PREVIEW_TOKEN] : null,
    candidateSnapshotDigest: mode === "dry-run" ? CANDIDATE_SNAPSHOT_DIGEST : null,
    candidates: 1,
    extensionDays: 7,
    failures: {
      db_update_failed: 0,
      member_lock_busy: 0,
      preview_state_changed: 0,
      provider_recovery_failed: 0,
      provider_recovery_lookup_failed: 0,
      route_runway_exhausted: 0,
      stripe_retrieve_failed: 0,
      stripe_update_failed: 0,
      stripe_update_result_invalid: 0,
    },
    hasMoreCandidates: false,
    localWindowsReconciled: 0,
    mode,
    nextContinuationToken: null,
    providerTrialsCleanedUp: 0,
    providerTrialsRecovered: 0,
    skipped: {
      local_candidate_changed: 0,
      local_trial_window_invalid: 0,
      missing_stripe_refs: 0,
      outside_campaign_cohort: 0,
      provider_recovery_not_found: 0,
      provider_trial_ended: 0,
      stripe_billing_plan_mismatch: 0,
      stripe_campaign_marker_conflict: 0,
      stripe_checkout_offer_mismatch: 0,
      stripe_customer_mismatch: 0,
      stripe_price_mismatch: 0,
      stripe_subscription_canceling: 0,
      stripe_subscription_id_mismatch: 0,
      stripe_subscription_not_trialing: 0,
      stripe_trial_end_invalid: 0,
    },
    stripeTrialsExtended: 0,
    wouldExtend: 0,
    wouldCleanupProviderTrial: 0,
    wouldRecoverProviderTrial: 0,
    wouldReconcile: 0,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function getSection(container: HTMLElement, index: number): HTMLElement {
  const section = container.querySelectorAll("section").item(index);
  if (!section) {
    throw new Error(`Missing trial extension section ${index}.`);
  }
  return section;
}

function getInput(section: HTMLElement, index: number): HTMLInputElement {
  const input = section.querySelectorAll("input").item(index);
  if (!input) {
    throw new Error(`Missing trial extension input ${index}.`);
  }
  return input;
}

function getButton(section: HTMLElement, label: string): HTMLButtonElement {
  const button = findButton(section, label);
  if (!button) {
    throw new Error(`Missing trial extension button ${label}.`);
  }
  return button;
}

function findButton(
  section: HTMLElement,
  label: string,
): HTMLButtonElement | undefined {
  return Array.from(section.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label,
  );
}

async function changeInput(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

async function clickButton(
  window: Window & typeof globalThis,
  button: HTMLButtonElement,
): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function readRequestBody(callIndex: number): unknown {
  const call = fetchMock.mock.calls[callIndex];
  const body = call?.[1]?.body;
  if (typeof body !== "string") {
    throw new Error(`Missing JSON body for request ${callIndex}.`);
  }
  const parsed: unknown = JSON.parse(body);
  return parsed;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      if (!resolvePromise) {
        throw new Error("Deferred promise resolver is unavailable.");
      }
      resolvePromise(value);
    },
  };
}
