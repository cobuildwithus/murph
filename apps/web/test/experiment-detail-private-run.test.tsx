import { renderToStaticMarkup } from "react-dom/server";

import {
  BROWSER_VAULT_SNAPSHOT_SCHEMA,
  type BrowserVaultSnapshot,
} from "@murphai/query/browser";
import { describe, expect, it } from "vitest";

import { ResultsTab } from "@/src/components/experiments/experiment-detail/results-tab";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import { composeExperimentDetail } from "@/src/lib/experiments/experiment-detail";
import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";

function createSnapshot(input: {
  generatedAt: string;
  trackedExperiments: BrowserVaultSnapshot["overview"]["trackedExperiments"];
}): BrowserVaultSnapshot {
  return {
    generatedAt: input.generatedAt,
    history: {
      timeline: [],
    },
    overview: {
      metrics: [],
      recentJournals: [],
      trackedExperiments: input.trackedExperiments,
      weeklySampleSummaries: [],
    },
    schema: BROWSER_VAULT_SNAPSHOT_SCHEMA,
    signals: {
      activity: [],
      assistantSummary: {
        highlights: [],
        latestDate: null,
      },
      bodyState: [],
      recovery: [],
      sleep: [],
      sourceHealth: [],
    },
    sourceVersion: "a".repeat(64),
  };
}

describe("experiment detail private-run composition", () => {
  it("matches browser-vault tracked experiments against Health Commons protocol aliases", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      protocol: protocol!,
      snapshot: createSnapshot({
        generatedAt: "2026-04-12T08:00:00.000Z",
        trackedExperiments: [{
          id: "exp_sauna_01",
          slug: "finnish-sauna",
          startedOn: "2026-04-10",
          status: "active",
          summary: "Keeping the sauna protocol lightweight.",
          tags: ["sauna"],
          title: "Sauna protocol",
        }],
      }),
    });

    expect(privateRun).toEqual(expect.objectContaining({
      completionPercent: 14,
      day: 3,
      id: "exp_sauna_01",
      slug: "finnish-sauna",
      status: "active",
      statusLabel: "Active",
    }));
    expect(privateRun?.nextStep).toEqual(expect.objectContaining({
      title: "Keep the baseline clean",
      when: "Baseline day 3 of 7",
    }));
    expect(privateRun?.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Baseline started" }),
      expect.objectContaining({ title: "Protocol window starts", upcoming: true }),
    ]));
  });

  it("does not bind a private run on title-only collisions", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      protocol: protocol!,
      snapshot: createSnapshot({
        generatedAt: "2026-04-12T08:00:00.000Z",
        trackedExperiments: [{
          id: "exp_other_protocol",
          slug: "cold-exposure-protocol",
          startedOn: "2026-04-10",
          status: "active",
          summary: "Unrelated experiment with a similar title.",
          tags: ["cold"],
          title: protocol!.title,
        }],
      }),
    });

    expect(privateRun).toBeNull();
  });

  it("renders honest baseline progress before the protocol window starts", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const activeBaselineRun = resolveBrowserVaultExperimentRun({
      protocol: protocol!,
      snapshot: createSnapshot({
        generatedAt: "2026-04-12T08:00:00.000Z",
        trackedExperiments: [{
          id: "exp_sauna_01",
          slug: "finnish-sauna",
          startedOn: "2026-04-10",
          status: "active",
          summary: "Keeping the sauna protocol lightweight.",
          tags: ["sauna"],
          title: "Sauna protocol",
        }],
      }),
    });

    const baselineMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: activeBaselineRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(baselineMarkup).toContain("Private run linked");
    expect(baselineMarkup).toContain("Protocol · Not started");
    expect(baselineMarkup).toContain("Keep the baseline clean");
    expect(baselineMarkup).not.toContain("Active · Day 1");
  });

  it("renders honest result states without inventing personal outcomes", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const loadingMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: null })}
        privateRunError={null}
        privateRunStatus="loading"
      />,
    );

    expect(loadingMarkup).toContain("Loading your private run");
    expect(loadingMarkup).not.toContain("No personal results yet");

    const finishedRun = resolveBrowserVaultExperimentRun({
      protocol: protocol!,
      snapshot: createSnapshot({
        generatedAt: "2026-04-29T08:00:00.000Z",
        trackedExperiments: [{
          id: "exp_sauna_02",
          slug: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
          startedOn: "2026-04-01",
          status: "finished",
          summary: "Private run present; outcome export still pending.",
          tags: ["sauna"],
          title: "Murph Finnish Dry Sauna",
        }],
      }),
    });

    const finishedMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: finishedRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(finishedMarkup).toContain("No biomarker comparison exported yet");
    expect(finishedMarkup).toContain("Private run recorded");
    expect(finishedMarkup).toContain("Private run present; outcome export still pending.");
  });

  it("keeps paused runs distinct from active runs", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const pausedRun = resolveBrowserVaultExperimentRun({
      protocol: protocol!,
      snapshot: createSnapshot({
        generatedAt: "2026-04-20T08:00:00.000Z",
        trackedExperiments: [{
          id: "exp_sauna_paused",
          slug: "finnish-sauna",
          startedOn: "2026-04-10",
          status: "paused",
          summary: "Paused after the first few sauna sessions.",
          tags: ["sauna"],
          title: "Sauna protocol",
        }],
      }),
    });

    expect(pausedRun).toEqual(expect.objectContaining({
      status: "paused",
      statusLabel: "Paused",
    }));

    const pausedMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: pausedRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(pausedMarkup).toContain("Private run paused");
    expect(pausedMarkup).toContain("Paused · Day 4 of 14");
    expect(pausedMarkup).toContain("Resume the protocol");
    expect(pausedMarkup).not.toContain("Continue the protocol");
  });
});
