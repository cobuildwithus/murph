import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ExperimentProtocol } from "@/src/types/experiments";

const mocks = vi.hoisted(() => ({
  experimentDetailClient: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("../app/(dashboard)/experiments/[experimentId]/experiment-detail-client", () => ({
  ExperimentDetailClient({
    protocol,
  }: {
    protocol: ExperimentProtocol;
  }) {
    mocks.experimentDetailClient({ protocol });
    return createElement("div", { "data-experiment-id": protocol.id }, protocol.title);
  },
}));

import ExperimentDetailPage from "../app/(dashboard)/experiments/[experimentId]/page";

describe("ExperimentDetailPage onboarding projection", () => {
  it("projects red-light onboarding details into the client protocol", async () => {
    const element = await ExperimentDetailPage({
      params: Promise.resolve({
        experimentId: "red-light-glasses-before-bed",
      }),
    });
    renderToStaticMarkup(element);

    expect(mocks.experimentDetailClient).toHaveBeenCalledTimes(1);
    const clientExperiment = mocks.experimentDetailClient.mock.calls.at(-1)?.[0]
      ?.protocol as ExperimentProtocol;

    expect(clientExperiment.experimentOnboarding).toEqual(expect.objectContaining({
      assistantPolicy: expect.objectContaining({
        askBeforeCreatingAutomations: true,
        missedLogFollowup: "opt_in_only",
        missedLogFollowupCopy:
          "Did you end up wearing the glasses before bed last night? Totally fine either way; I just want the experiment record to be accurate.",
      }),
      planDefaults: expect.objectContaining({
        baselineDays: 7,
        interventionDays: 14,
        testPlanId: "sol-wiredness-21d",
      }),
      startIntent: expect.objectContaining({
        intentSummary: "Explore Red Light Glasses Before Bed",
      }),
    }));
  });
});
