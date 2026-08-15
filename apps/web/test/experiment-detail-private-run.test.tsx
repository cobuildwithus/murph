import { renderToStaticMarkup } from "react-dom/server";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  selectBrowserVaultExperimentResults,
  selectBrowserVaultTrackedExperiments,
  type BrowserVaultQueryClient,
  type BrowserVaultMetricRow,
} from "@murphai/query/browser";
import type { ExperimentOutcome } from "@murphai/contracts";
import { describe, expect, it } from "vitest";

import { ExperimentSchedule } from "@/src/components/experiments/experiment-detail/experiment-schedule";
import { ExperimentSummaryTiles } from "@/src/components/experiments/experiment-detail/experiment-summary-tiles";
import { ResultsSummary } from "@/src/components/experiments/experiment-detail/results-summary";
import { ResultsTab } from "@/src/components/experiments/experiment-detail/results-tab";
import {
  TrendChart,
  buildTrendChartPoints,
  buildWindowAverageDomain,
  formatTrendDay,
} from "@/src/components/experiments/experiment-detail/trend-chart";
import {
  resolveBrowserVaultExperimentRun,
  resolveBrowserVaultExperimentRunById,
} from "@/src/lib/browser-vault/experiment-run";
import { composeExperimentDetail } from "@/src/lib/experiments/experiment-detail";
import {
  buildExperimentLibraryCards,
  splitHomeExperimentCards,
} from "@/src/lib/experiments/library-cards";
import { buildExperimentRunCardSummary } from "@/src/lib/experiments/run-card-summary";
import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";

type BrowserVaultEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

async function createClient(input: {
  additionalEntities?: BrowserVaultEntity[];
  experimentOutcomes?: ExperimentOutcome[];
  generatedAt: string;
  metricRows?: BrowserVaultMetricRow[];
  trackedExperiments: Array<{
    frontmatter?: Record<string, unknown>;
    id: string;
    slug: string | null;
    startedOn: string | null;
    status: string | null;
    summary: string | null;
    tags: string[];
    title: string;
  }>;
}): Promise<BrowserVaultQueryClient> {
  const replica = await createBrowserVaultReplica({
    metricPoints: [],
    generatedAt: input.generatedAt,
    sourceBundleHash: "a".repeat(64),
    vault: createVaultReadModel({
      entities: [
        ...input.trackedExperiments.map((entry) =>
          createEntity("experiment", entry.id, {
            body: entry.summary,
            date: entry.startedOn ?? input.generatedAt.slice(0, 10),
            experimentSlug: entry.slug,
            frontmatter: entry.frontmatter,
            lookupIds: [entry.id, ...(entry.slug ? [entry.slug] : [])],
            occurredAt: `${entry.startedOn ?? input.generatedAt.slice(0, 10)}T08:00:00.000Z`,
            status: entry.status,
            tags: entry.tags,
            title: entry.title,
          })
        ),
        ...(input.additionalEntities ?? []),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  return createBrowserVaultQueryClient({
    ...replica,
    experimentOutcomes: input.experimentOutcomes ?? [],
    metricRows: input.metricRows ?? replica.metricRows,
  });
}

describe("experiment detail private-run composition", () => {
  it("resolves a private run and saved metrics by exact id without a public protocol", async () => {
    const outcome = createSavedOutcome({
      id: "exp_private_unlisted",
      slug: "private-unlisted-run",
      title: "Private unlisted run",
    });
    const client = await createClient({
      experimentOutcomes: [outcome],
      generatedAt: "2026-04-20T08:00:00.000Z",
      trackedExperiments: [{
        frontmatter: createExperimentFrontmatter({
          analysisPlan: {
            desiredDirection: "decrease",
            primaryBiomarkerKey: "biomarker:resting-heart-rate",
          },
          commonsProtocolRef: {
            key: "protocol_variant:private/example-draft",
            pageRevisionId: `sha256:${"1".repeat(64)}`,
            runSpecRevisionId: `sha256:${"2".repeat(64)}`,
          },
          id: "exp_private_unlisted",
          outcomeRef: {
            generatedAt: outcome.generatedAt,
            outcomeId: outcome.outcomeId,
            relativePath: "bank/experiments/outcomes/private-unlisted.json",
          },
          runPlan: {
            baselineEnd: "2026-04-03",
            baselineStart: "2026-04-01",
            interventionEnd: "2026-04-06",
            interventionStart: "2026-04-04",
          },
          slug: "private-unlisted-run",
          startedOn: "2026-04-01",
          status: "completed",
          title: "Private unlisted run",
        }),
        id: "exp_private_unlisted",
        slug: "private-unlisted-run",
        startedOn: "2026-04-01",
        status: "completed",
        summary: "Private result fixture.",
        tags: [],
        title: "Private unlisted run",
      }],
    });

    const privateRun = resolveBrowserVaultExperimentRunById({
      client,
      experimentId: "exp_private_unlisted",
    });

    expect(privateRun).toEqual(expect.objectContaining({
      baselineDays: 3,
      durationDays: 6,
      id: "exp_private_unlisted",
      outcomeStatus: "available",
      status: "finished",
    }));
    expect(privateRun?.signals).toEqual([
      expect.objectContaining({
        delta: "-4 bpm",
        label: "Resting heart rate",
        value: "58",
      }),
    ]);

    const [homeCard] = buildExperimentLibraryCards({
      client,
      protocols: [],
      trackedExperiments: selectBrowserVaultTrackedExperiments(client),
    });
    expect(homeCard).toEqual(expect.objectContaining({
      href: "/experiments/runs/exp_private_unlisted",
      id: "exp_private_unlisted",
      runStatus: "finished",
    }));
    expect(homeCard?.runSummary?.metrics).toEqual([
      expect.objectContaining({
        delta: "-4 bpm",
        label: "Resting heart rate",
      }),
    ]);
  });

  it("preserves an active private run baseline without inventing a total duration", async () => {
    const client = await createClient({
      generatedAt: "2026-04-05T08:00:00.000Z",
      trackedExperiments: [{
        frontmatter: createExperimentFrontmatter({
          id: "exp_private_active",
          runPlan: {
            baselineEnd: "2026-04-03",
            baselineStart: "2026-04-01",
            interventionStart: "2026-04-04",
          },
          slug: "private-active-run",
          startedOn: "2026-04-01",
          status: "active",
          title: "Private active run",
        }),
        id: "exp_private_active",
        slug: "private-active-run",
        startedOn: "2026-04-01",
        status: "active",
        summary: null,
        tags: [],
        title: "Private active run",
      }],
    });

    const privateRun = resolveBrowserVaultExperimentRunById({
      client,
      experimentId: "exp_private_active",
    });

    expect(privateRun).toEqual(expect.objectContaining({
      baselineDays: 3,
      completionPercent: undefined,
      day: 5,
      durationDays: undefined,
      id: "exp_private_active",
      status: "active",
    }));
    expect(privateRun?.nextStep).toEqual(expect.objectContaining({
      title: "Continue the protocol",
      when: "Day 5",
    }));
    expect(privateRun?.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Day 5",
        title: "Protocol",
      }),
    ]));
  });

  it("renders progress without a false total when private duration is unknown", () => {
    const markup = renderToStaticMarkup(
      <ExperimentSummaryTiles
        experiment={{
          baselineDays: 3,
          day: 5,
          durationDays: undefined,
        }}
      />,
    );

    expect(markup).toContain("Day 5");
    expect(markup).not.toContain("Day 5 of 5");
  });

  it("matches browser-vault tracked experiments against Health Commons protocol aliases", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
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
      protocol: protocol!,
    });

    expect(privateRun).toEqual(expect.objectContaining({
      baselineDays: undefined,
      completionPercent: undefined,
      day: undefined,
      durationDays: undefined,
      id: "exp_sauna_01",
      slug: "finnish-sauna",
      status: "active",
      statusLabel: "Active",
      timingKnown: false,
    }));
    expect(privateRun?.nextStep).toEqual(expect.objectContaining({
      title: "Continue your saved plan",
      when: "Timing unavailable",
    }));
    expect(privateRun?.timeline).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Protocol window starts" }),
    ]));

    const legacyMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(legacyMarkup).toContain("Timing unavailable");
    expect(legacyMarkup).toContain("Original phase timing is incomplete");
    expect(legacyMarkup).not.toContain("Baseline day 3 of 14");
  });

  it("keeps intervention-only legacy timing neutral when the saved run started earlier", async () => {
    const client = await createClient({
      generatedAt: "2026-04-03T08:00:00.000Z",
      trackedExperiments: [{
        frontmatter: createExperimentFrontmatter({
          id: "exp_partial_legacy_timing",
          runPlan: {
            interventionEnd: "2026-04-21",
            interventionStart: "2026-04-08",
          },
          slug: "partial-legacy-timing",
          startedOn: "2026-04-01",
          status: "active",
          title: "Partial legacy timing",
        }),
        id: "exp_partial_legacy_timing",
        slug: "partial-legacy-timing",
        startedOn: "2026-04-01",
        status: "active",
        summary: null,
        tags: [],
        title: "Partial legacy timing",
      }],
    });

    const privateRun = resolveBrowserVaultExperimentRunById({
      client,
      experimentId: "exp_partial_legacy_timing",
    });

    expect(privateRun).toEqual(expect.objectContaining({
      baselineDays: undefined,
      completionPercent: undefined,
      day: undefined,
      durationDays: undefined,
      timingKnown: false,
    }));
    expect(privateRun?.nextStep).toEqual(expect.objectContaining({
      context: "This older run does not contain complete original phase dates, so Murph will not infer them from the current protocol.",
      title: "Continue your saved plan",
      when: "Timing unavailable",
    }));
    expect(privateRun?.timeline).toEqual([]);

    const partialMarkup = renderToStaticMarkup(
      <ExperimentSummaryTiles
        experiment={{
          baselineDays: 14,
          nextStep: privateRun?.nextStep,
          privateRun: privateRun ?? undefined,
        }}
      />,
    );

    expect(partialMarkup).toContain("Timing unavailable");
    expect(partialMarkup).toContain("Original phase timing is incomplete");
  });

  it.each([
    {
      label: "baseline end missing",
      partialBaselineWindow: { baselineStart: "2026-04-01" },
    },
    {
      label: "baseline start missing",
      partialBaselineWindow: { baselineEnd: "2026-04-07" },
    },
  ])("keeps a partial baseline window unknown even when the run starts with intervention ($label)", async ({
    partialBaselineWindow,
  }) => {
    const client = await createClient({
      generatedAt: "2026-04-10T08:00:00.000Z",
      trackedExperiments: [{
        frontmatter: createExperimentFrontmatter({
          id: "exp_partial_baseline_window",
          runPlan: {
            ...partialBaselineWindow,
            interventionEnd: "2026-04-21",
            interventionStart: "2026-04-08",
          },
          slug: "partial-baseline-window",
          startedOn: "2026-04-08",
          status: "active",
          title: "Partial baseline window",
        }),
        id: "exp_partial_baseline_window",
        slug: "partial-baseline-window",
        startedOn: "2026-04-08",
        status: "active",
        summary: null,
        tags: [],
        title: "Partial baseline window",
      }],
    });

    const privateRun = resolveBrowserVaultExperimentRunById({
      client,
      experimentId: "exp_partial_baseline_window",
    });

    expect(privateRun).toEqual(expect.objectContaining({
      baselineDays: undefined,
      completionPercent: undefined,
      day: undefined,
      durationDays: undefined,
      timingKnown: false,
    }));
    expect(privateRun?.nextStep).toEqual(expect.objectContaining({
      title: "Continue your saved plan",
      when: "Timing unavailable",
    }));
    expect(privateRun?.timeline).toEqual([]);
  });

  it("recognizes a fully persisted intervention-only run as a genuine zero baseline", async () => {
    const client = await createClient({
      generatedAt: "2026-04-10T08:00:00.000Z",
      trackedExperiments: [{
        frontmatter: createExperimentFrontmatter({
          id: "exp_zero_baseline",
          runPlan: {
            interventionEnd: "2026-04-21",
            interventionStart: "2026-04-08",
          },
          slug: "zero-baseline",
          startedOn: "2026-04-08",
          status: "active",
          title: "Zero-baseline run",
        }),
        id: "exp_zero_baseline",
        slug: "zero-baseline",
        startedOn: "2026-04-08",
        status: "active",
        summary: null,
        tags: [],
        title: "Zero-baseline run",
      }],
    });

    const privateRun = resolveBrowserVaultExperimentRunById({
      client,
      experimentId: "exp_zero_baseline",
    });

    expect(privateRun).toEqual(expect.objectContaining({
      baselineDays: 0,
      day: 3,
      durationDays: 14,
      timingKnown: true,
    }));
  });

  it("does not bind a private run on title-only collisions", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
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
      protocol: protocol!,
    });

    expect(privateRun).toBeNull();
  });

  it("uses the newest completed matching run when no live run exists", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-30T08:00:00.000Z",
        trackedExperiments: [
          {
            id: "exp_sauna_completed_old",
            slug: "finnish-sauna",
            startedOn: "2026-03-01",
            status: "completed",
            summary: "Older completed run.",
            tags: ["sauna"],
            title: "Older sauna run",
          },
          {
            id: "exp_sauna_completed_new",
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "finished",
            summary: "Newest completed run.",
            tags: ["sauna"],
            title: "Newest sauna run",
          },
        ],
      }),
      protocol: protocol!,
    });

    expect(privateRun).toEqual(expect.objectContaining({
      id: "exp_sauna_completed_new",
      status: "finished",
      title: "Newest sauna run",
    }));
  });

  it("uses the run time zone for active timeline reference dates near UTC boundaries", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-30T03:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            id: "exp_sauna_local_boundary",
            runPlan: {
              baselineEnd: "2026-04-29",
              baselineStart: "2026-04-29",
              interventionEnd: "2026-05-05",
              interventionStart: "2026-04-30",
              schedule: {
                kind: "dailyLocal",
                localTime: "08:00",
                timeZone: "America/Los_Angeles",
              },
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-29",
            status: "active",
            title: "Private sauna boundary run",
          }),
          id: "exp_sauna_local_boundary",
          slug: "finnish-sauna",
          startedOn: "2026-04-29",
          status: "active",
          summary: "Local-date boundary run.",
          tags: ["sauna"],
          title: "Private sauna boundary run",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun?.day).toBe(1);
    expect(privateRun?.timeline.find((event) => event.label === "Day 1")).toEqual(
      expect.objectContaining({ date: "Apr 29" }),
    );
  });

  it("matches browser-vault tracked experiments by canonical commonsProtocolRef key", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-12T08:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            id: "exp_sauna_protocol_ref",
            commonsProtocolRef: {
              key: protocol!.commons!.key,
              pageRevisionId: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
              runSpecRevisionId: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
              testPlanId: "finnish-sauna-21d",
            },
            slug: "unrelated-private-sauna-run",
            startedOn: "2026-04-10",
            status: "active",
            title: "Private sauna run",
          }),
          id: "exp_sauna_protocol_ref",
          slug: null,
          startedOn: "2026-04-10",
          status: "active",
          summary: "Canonical metadata links this run to the sauna protocol.",
          tags: ["sauna"],
          title: "Private sauna run",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun).toEqual(expect.objectContaining({
      baselineDays: undefined,
      id: "exp_sauna_protocol_ref",
      slug: null,
      status: "active",
      timingKnown: false,
    }));
    expect(privateRun?.nextStep).toEqual(expect.objectContaining({
      title: "Continue your saved plan",
      when: "Timing unavailable",
    }));
  });

  it("prefers canonical runPlan windows for baseline days and analysis availability", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-06T08:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            id: "exp_sauna_canonical_windows",
            runPlan: {
              baselineEnd: "2026-04-03",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-12",
              interventionStart: "2026-04-04",
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-10",
            status: "active",
            title: "Private sauna run",
          }),
          id: "exp_sauna_canonical_windows",
          slug: "finnish-sauna",
          startedOn: "2026-04-10",
          status: "active",
          summary: "Canonical run metadata shortens the baseline and intervention windows.",
          tags: ["sauna"],
          title: "Private sauna run",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun).toEqual(expect.objectContaining({
      analysisAvailableOn: "2026-04-12",
      completionPercent: 50,
      day: 6,
      startedOn: "2026-04-01",
      status: "active",
    }));
    expect(privateRun?.nextStep).toEqual(expect.objectContaining({
      context: "Adherence is not started (0 logged).",
      title: "Continue the protocol",
      when: "Day 6",
    }));
    expect(privateRun?.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        date: "Apr 1",
        description: "3 baseline days before the protocol window.",
        title: "Baseline started",
      }),
      expect.objectContaining({
        date: "Apr 4",
        title: "Protocol window starts",
        upcoming: false,
      }),
      expect.objectContaining({
        date: "Apr 12",
        title: "Analysis window",
        upcoming: true,
      }),
    ]));
  });

  it.each(["active", "running", "in progress"])(
    "does not keep a stale %s label after the run window ends",
    async (sourceStatus) => {
      const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

      expect(protocol).not.toBeNull();

      const id = `exp_sauna_review_due_${sourceStatus.replace(/\s+/gu, "_")}`;
      const privateRun = resolveBrowserVaultExperimentRun({
        client: await createClient({
          generatedAt: "2026-04-20T08:00:00.000Z",
          trackedExperiments: [{
            frontmatter: createExperimentFrontmatter({
              id,
              runPlan: {
                baselineEnd: "2026-04-03",
                baselineStart: "2026-04-01",
                interventionEnd: "2026-04-12",
                interventionStart: "2026-04-04",
              },
              slug: "finnish-sauna",
              startedOn: "2026-04-01",
              status: sourceStatus,
              title: "Private sauna run",
            }),
            id,
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: sourceStatus,
            summary: "Source status has not been manually closed yet.",
            tags: ["sauna"],
            title: "Private sauna run",
          }],
        }),
        protocol: protocol!,
      });

      expect(privateRun).toEqual(expect.objectContaining({
        status: "finished",
        statusLabel: "Review due",
      }));
      expect(privateRun?.nextStep).toBeUndefined();
    },
  );

  it("uses the canonical review-due projection for a private-only home card", async () => {
    const client = await createClient({
      generatedAt: "2026-04-20T08:00:00.000Z",
      metricRows: restingHeartRateRows([
        ["2026-04-01", 64],
        ["2026-04-02", 63],
        ["2026-04-03", 62],
        ["2026-04-04", 59],
        ["2026-04-05", 58],
        ["2026-04-06", 57],
      ]),
      trackedExperiments: [{
        frontmatter: createExperimentFrontmatter({
          analysisPlan: {
            desiredDirection: "decrease",
            primaryBiomarkerKey: "biomarker:resting-heart-rate",
          },
          id: "exp_private_review_due",
          runPlan: {
            baselineEnd: "2026-04-03",
            baselineStart: "2026-04-01",
            interventionEnd: "2026-04-06",
            interventionStart: "2026-04-04",
          },
          slug: "private-review-due",
          startedOn: "2026-04-01",
          status: "active",
          title: "Private review due run",
        }),
        id: "exp_private_review_due",
        slug: "private-review-due",
        startedOn: "2026-04-01",
        status: "active",
        summary: null,
        tags: [],
        title: "Private review due run",
      }],
    });
    const cards = buildExperimentLibraryCards({
      client,
      protocols: [],
      trackedExperiments: selectBrowserVaultTrackedExperiments(client),
    });
    const [card] = cards;

    expect(card).toEqual(expect.objectContaining({
      runStatus: "finished",
      statusLabel: "Review due",
    }));
    expect(card?.runSummary?.metrics).toEqual([
      expect.objectContaining({
        delta: "-5 bpm",
        label: "Resting Heart Rate",
      }),
    ]);
    expect(splitHomeExperimentCards(cards)).toEqual(expect.objectContaining({
      history: [card],
      inProgress: [],
    }));
  });

  it("renders honest baseline progress before the protocol window starts", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const activeBaselineRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-12T08:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            id: "exp_sauna_01",
            runPlan: {
              baselineEnd: "2026-04-23",
              baselineStart: "2026-04-10",
              interventionEnd: "2026-05-07",
              interventionStart: "2026-04-24",
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-10",
            status: "active",
            title: "Sauna protocol",
          }),
          id: "exp_sauna_01",
          slug: "finnish-sauna",
          startedOn: "2026-04-10",
          status: "active",
          summary: "Keeping the sauna protocol lightweight.",
          tags: ["sauna"],
          title: "Sauna protocol",
        }],
      }),
      protocol: protocol!,
    });

    expect(activeBaselineRun).toEqual(expect.objectContaining({
      baselineDays: 14,
      completionPercent: 11,
      day: 3,
      durationDays: 28,
      timingKnown: true,
    }));

    const baselineMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: activeBaselineRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(baselineMarkup).toContain("running this experiment");
    expect(baselineMarkup).toContain("Starts day 15");
    expect(baselineMarkup).toContain("Keep the baseline clean");
    expect(baselineMarkup).not.toContain("Active · Day 1");
  });

  it("renders honest result states without inventing personal outcomes", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const loadingMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: null })}
        privateRunError={null}
        privateRunStatus="loading"
      />,
    );

    expect(loadingMarkup).toContain("Loading your results");
    expect(loadingMarkup).not.toContain("No personal results yet");

    const emptyMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: null })}
        privateRunError={null}
        privateRunStatus="empty"
      />,
    );

    expect(emptyMarkup).toContain("No results for this protocol yet");

    const finishedRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-29T08:00:00.000Z",
        trackedExperiments: [{
          id: "exp_sauna_02",
          slug: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
          startedOn: "2026-04-01",
          status: "finished",
          summary: "Private run present; outcome export still pending.",
          tags: ["sauna"],
          title: "Finnish Dry Sauna",
        }],
      }),
      protocol: protocol!,
    });

    const finishedMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: finishedRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(finishedMarkup).toContain("Run complete, but there isn&#x27;t enough data for a clear comparison");
    expect(finishedMarkup).toContain("Private run recorded");
    expect(finishedMarkup).toContain("does not have a canonical saved outcome to render");

    const finishedFallbackRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-29T08:00:00.000Z",
        trackedExperiments: [{
          id: "exp_sauna_03",
          slug: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
          startedOn: "2026-04-01",
          status: "finished",
          summary: null,
          tags: ["sauna"],
          title: "Finnish Dry Sauna",
        }],
      }),
      protocol: protocol!,
    });

    expect(finishedFallbackRun?.outcomeStatus).toBe("not_expected");
    expect(finishedFallbackRun?.conclusions).toBeUndefined();

    const staleMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: finishedRun })}
        privateRunError="The latest private refresh failed."
        privateRunStatus="error"
      />,
    );

    expect(staleMarkup).toContain("Showing saved results");
    expect(staleMarkup).toContain("The latest private refresh failed.");
  });

  it("keeps the exact canonical saved outcome and charts its saved daily points", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");
    const outcome = createSavedOutcome({
      deltaAbs: null,
      id: "exp_sauna_saved_outcome",
      points: [
        {
          date: "2026-04-01",
          phase: "baseline",
          unit: "bpm",
          value: 63,
        },
        {
          date: "2026-04-02",
          phase: "baseline",
          unit: "bpm",
          value: 62,
        },
        {
          date: "2026-04-03",
          phase: "baseline",
          unit: "bpm",
          value: 61,
        },
        {
          date: "2026-04-04",
          phase: "intervention",
          unit: "bpm",
          value: 59,
        },
        {
          date: "2026-04-05",
          phase: "intervention",
          unit: "bpm",
          value: 58,
        },
        {
          date: "2026-04-06",
          phase: "intervention",
          unit: "bpm",
          value: 57,
        },
      ],
      schemaVersion: "murph.experiment-outcome.v2",
      slug: "finnish-sauna",
      status: "paused",
      title: "Original sauna run",
    });

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        experimentOutcomes: [outcome],
        generatedAt: "2027-06-20T08:00:00.000Z",
        metricRows: restingHeartRateRows([
          ["2026-03-31", 88],
          ["2026-04-01", 99],
          ["2026-04-04", 120],
          ["2026-04-08", 130],
        ]),
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            endedOn: "2026-04-07",
            id: "exp_sauna_saved_outcome",
            outcomeRef: {
              generatedAt: outcome.generatedAt,
              outcomeId: outcome.outcomeId,
              relativePath: "bank/experiments/outcomes/saved-sauna.json",
            },
            runPlan: {
              baselineEnd: "2026-04-04",
              baselineStart: "2026-04-02",
              interventionEnd: "2026-04-10",
              interventionStart: "2026-04-05",
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "completed",
            title: "Renamed sauna run",
          }),
          id: "exp_sauna_saved_outcome",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "completed",
          summary: "The browser must use the canonical outcome.",
          tags: ["sauna"],
          title: "Renamed sauna run",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun).toEqual(expect.objectContaining({
      analysisAvailableOn: "2026-04-06",
      dateRange: "Apr 1 – Apr 6",
      outcomeStatus: "available",
      status: "finished",
      statusLabel: "Finished",
      summary: outcome.conclusion.headline,
    }));
    expect(privateRun?.summaryDetail).toBe(outcome.conclusion.plainLanguage);
    expect(privateRun?.outcomeConfidence).toBe("medium");
    expect(privateRun?.signals).toEqual([]);
    expect(privateRun?.trends).toEqual([
      expect.objectContaining({
        active: [
          { day: 4, value: 59 },
          { day: 5, value: 58 },
          { day: 6, value: 57 },
        ],
        baseline: [
          { day: 1, value: 63 },
          { day: 2, value: 62 },
          { day: 3, value: 61 },
        ],
        baselineAvg: 62,
        currentValue: 58,
        history: [],
        label: "Resting heart rate",
        windowComparison: undefined,
      }),
    ]);
    expect(privateRun?.conclusions?.[0]?.title).toBe("What limits this read");
    expect(privateRun?.conclusions?.[0]?.items.map((item) => item.text)).toEqual([
      outcome.confidence.reasons[0],
      outcome.conclusion.caveats[0],
      outcome.confounders[0],
    ]);

    const markup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(markup).toContain(outcome.conclusion.headline);
    expect(markup).toContain(outcome.conclusion.plainLanguage);
    expect(markup).toContain(outcome.confidence.reasons[0]);
    expect(markup).toContain(outcome.conclusion.caveats[0]);
    expect(markup).toContain("Saved result");
    expect(markup.match(/medium confidence/gu)).toHaveLength(1);
    expect(markup).toContain('data-slot="chart"');
    expect(markup).toContain("Baseline");
    expect(markup).toContain("Active");
    expect(markup).not.toContain("History");
    expect(markup).not.toContain("Window averages");
    expect(markup).not.toContain("What the saved analysis says");

    const privateRunRouteMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun })}
        privateRunError={null}
        privateRunStatus="ready"
        showFinishedOutcomeSummary={false}
      />,
    );

    expect(privateRunRouteMarkup).not.toContain("Saved result");
    expect(privateRunRouteMarkup).not.toContain(outcome.conclusion.headline);
    expect(privateRunRouteMarkup).not.toContain(outcome.conclusion.plainLanguage);
    expect(privateRunRouteMarkup).toContain(outcome.confidence.reasons[0]);
    expect(privateRunRouteMarkup.match(/medium confidence/gu)).toHaveLength(1);

    const emptyMetricMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({
          protocol: protocol!,
          privateRun: {
            ...privateRun!,
            signals: [],
            trends: [],
          },
        })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(emptyMetricMarkup).toContain(outcome.conclusion.headline);
    expect(emptyMetricMarkup).toContain("does not include comparable metric windows to chart");
    expect(emptyMetricMarkup).not.toContain("does not have a canonical saved outcome to render");
  });

  it("stacks experiment trend cards in one column", () => {
    const trend = {
      active: [{ day: 4, value: 58 }],
      baseline: [{ day: 3, value: 62 }],
      baselineAvg: 62,
      currentValue: 58,
      currentValueLabel: "experiment average" as const,
      delta: "-4 bpm",
      history: [],
      label: "Resting heart rate",
      startDate: "2026-04-01",
      unit: "bpm",
    };
    const markup = renderToStaticMarkup(
      <ResultsSummary
        signals={[]}
        trends={[trend, { ...trend, label: "Nighttime heart rate" }]}
      />,
    );

    expect(markup).toContain("flex min-w-0 flex-col gap-4");
    expect(markup).not.toContain("md:grid-cols-2");
    expect(markup).not.toContain("xl:grid-cols-2");
    expect(markup).toContain("Daily measurements and declared window summaries, where available.");
  });

  it("renders a saved structured review without a false empty-metrics state", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");
    expect(protocol).not.toBeNull();

    const base = createSavedOutcome({
      id: "exp_structured_review",
      schemaVersion: "murph.experiment-outcome.v2",
      slug: "structured-review-run",
      title: "Movement quality review",
    });
    const outcome: ExperimentOutcome = {
      ...base,
      metricResults: [],
      structuredReview: {
        baseline: {
          kinds: ["document"],
          recordIds: ["evt_movement_baseline"],
        },
        followup: {
          kinds: ["document"],
          recordIds: ["evt_movement_followup"],
        },
        key: "biomarker:movement-quality-review",
        kind: "structured_review",
        label: "Movement quality",
        status: "ready_for_review",
      },
    };
    const privateRun = resolveBrowserVaultExperimentRunById({
      client: await createClient({
        experimentOutcomes: [outcome],
        generatedAt: "2026-04-20T08:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              primaryOutcome: {
                key: "biomarker:movement-quality-review",
                kind: "structured_review",
                label: "Movement quality",
              },
            },
            id: "exp_structured_review",
            outcomeRef: {
              generatedAt: outcome.generatedAt,
              outcomeId: outcome.outcomeId,
            },
            runPlan: {
              interventionEnd: "2026-04-06",
              interventionStart: "2026-04-01",
            },
            slug: "structured-review-run",
            startedOn: "2026-04-01",
            status: "completed",
            title: "Movement quality review",
          }),
          id: "exp_structured_review",
          slug: "structured-review-run",
          startedOn: "2026-04-01",
          status: "completed",
          summary: "Structured review fixture.",
          tags: [],
          title: "Movement quality review",
        }],
      }),
      experimentId: "exp_structured_review",
    });

    expect(privateRun).toEqual(expect.objectContaining({
      outcomeKind: "structured_review",
      outcomeStatus: "available",
      structuredReviewStatus: "ready_for_review",
      signals: [],
      trends: [],
    }));

    const markup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(markup).toContain(outcome.conclusion.headline);
    expect(markup).toContain("Evidence ready for review");
    expect(markup).not.toContain("Saved result");
    expect(markup).not.toContain("does not include comparable metric windows to chart");
    expect(markup).not.toContain("there isn&#x27;t enough data for a clear comparison");
  });

  it("keeps incomplete structured-review states recoverable in the browser UI", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");
    expect(protocol).not.toBeNull();

    const states = [
      {
        baselineRecordIds: [],
        followupRecordIds: [],
        status: "missing",
      },
      {
        baselineRecordIds: ["evt_review_baseline"],
        followupRecordIds: [],
        status: "baseline_only",
      },
      {
        baselineRecordIds: [],
        followupRecordIds: ["evt_review_followup"],
        status: "followup_only",
      },
    ] as const;

    for (const state of states) {
      const id = `exp_structured_${state.status}`;
      const base = createSavedOutcome({
        id,
        schemaVersion: "murph.experiment-outcome.v2",
        slug: `structured-${state.status}`,
        title: "Movement quality review",
      });
      const outcome: ExperimentOutcome = {
        ...base,
        conclusion: {
          caveats: ["Compare the available evidence directly."],
          headline: "The review still needs evidence.",
          plainLanguage:
            "Add the missing baseline or follow-up evidence before reviewing the result.",
        },
        metricResults: state.status === "baseline_only"
          ? base.metricResults
          : [],
        structuredReview: {
          baseline: {
            kinds: state.baselineRecordIds.length > 0 ? ["document"] : [],
            recordIds: [...state.baselineRecordIds],
          },
          followup: {
            kinds: state.followupRecordIds.length > 0 ? ["document"] : [],
            recordIds: [...state.followupRecordIds],
          },
          key: "biomarker:movement-quality-review",
          kind: "structured_review",
          label: "Movement quality",
          status: state.status,
        },
      };
      const privateRun = resolveBrowserVaultExperimentRunById({
        client: await createClient({
          experimentOutcomes: [outcome],
          generatedAt: "2026-04-20T08:00:00.000Z",
          trackedExperiments: [{
            frontmatter: createExperimentFrontmatter({
              analysisPlan: {
                primaryOutcome: {
                  key: "biomarker:movement-quality-review",
                  kind: "structured_review",
                  label: "Movement quality",
                },
              },
              id,
              outcomeRef: {
                generatedAt: outcome.generatedAt,
                outcomeId: outcome.outcomeId,
              },
              runPlan: {
                interventionEnd: "2026-04-06",
                interventionStart: "2026-04-01",
              },
              slug: `structured-${state.status}`,
              startedOn: "2026-04-01",
              status: "completed",
              title: "Movement quality review",
            }),
            id,
            slug: `structured-${state.status}`,
            startedOn: "2026-04-01",
            status: "completed",
            summary: "Structured review fixture.",
            tags: [],
            title: "Movement quality review",
          }],
        }),
        experimentId: id,
      });

      expect(privateRun?.structuredReviewStatus).toBe(state.status);
      const markup = renderToStaticMarkup(
        <ResultsTab
          experiment={composeExperimentDetail({ protocol: protocol!, privateRun })}
          privateRunError={null}
          privateRunStatus="ready"
        />,
      );

      expect(markup).toContain(outcome.conclusion.headline);
      expect(markup).toContain(outcome.conclusion.plainLanguage);
      expect(markup).not.toContain("Evidence ready for review");
      expect(markup).not.toContain("Saved result");
      expect(markup).not.toContain("does not include comparable metric windows to chart");
      if (state.status === "baseline_only") {
        expect(privateRun?.trends).toHaveLength(1);
        expect(markup).toContain('data-slot="chart"');
        expect(markup).toContain("Resting heart rate");
      }
    }
  });

  it("labels saved maximum and count comparisons with their declared reducers", async () => {
    const cases = [
      {
        baseline: 7,
        current: 9,
        expectedLabel: "maximum",
        key: "response-score",
        label: "Response score",
        statistic: "max",
        unit: "points",
      },
      {
        baseline: 3,
        current: 5,
        expectedLabel: "count",
        key: "symptom-free-days",
        label: "Symptom-free days",
        statistic: "count",
        unit: "count",
      },
    ] as const;

    for (const item of cases) {
      const id = `exp_${item.key}`;
      const base = createSavedOutcome({
        id,
        schemaVersion: "murph.experiment-outcome.v2",
        slug: item.key,
        title: item.label,
      });
      const baseMetric = base.metricResults[0]!;
      const outcome: ExperimentOutcome = {
        ...base,
        metricResults: [{
          ...baseMetric,
          baseline: {
            daysWithData: 3,
            mean: item.baseline,
            totalDays: 3,
            unit: item.unit,
          },
          baselineMean: item.baseline,
          biomarkerKey: `biomarker:${item.key}`,
          deltaAbs: item.current - item.baseline,
          deltaPct:
            Math.round(
              ((item.current - item.baseline) / Math.abs(item.baseline)) * 10_000,
            ) / 100,
          intervention: {
            daysWithData: 3,
            mean: item.current,
            totalDays: 3,
            unit: item.unit,
          },
          interventionMean: item.current,
          label: item.label,
          statistic: item.statistic,
          unit: item.unit,
        }],
      };
      const privateRun = resolveBrowserVaultExperimentRunById({
        client: await createClient({
          experimentOutcomes: [outcome],
          generatedAt: "2026-04-20T08:00:00.000Z",
          trackedExperiments: [{
            frontmatter: createExperimentFrontmatter({
              analysisPlan: {
                primaryOutcome: {
                  capture: { kind: "measurement" },
                  key: `biomarker:${item.key}`,
                  kind: "metric",
                  label: item.label,
                  statistic: item.statistic,
                },
              },
              id,
              outcomeRef: {
                generatedAt: outcome.generatedAt,
                outcomeId: outcome.outcomeId,
              },
              runPlan: {
                baselineEnd: "2026-04-03",
                baselineStart: "2026-04-01",
                interventionEnd: "2026-04-06",
                interventionStart: "2026-04-04",
              },
              slug: item.key,
              startedOn: "2026-04-01",
              status: "completed",
              title: item.label,
            }),
            id,
            slug: item.key,
            startedOn: "2026-04-01",
            status: "completed",
            summary: "Reducer result fixture.",
            tags: [],
            title: item.label,
          }],
        }),
        experimentId: id,
      });
      const trend = privateRun?.trends[0];

      expect(trend?.statistic).toBe(item.statistic);
      expect(trend?.unit).toBe(item.statistic === "count" ? "" : item.unit);
      const markup = renderToStaticMarkup(<TrendChart data={trend!} />);

      expect(markup).toContain(`Window statistic: ${item.expectedLabel}`);
      expect(markup).toContain(`Baseline ${item.expectedLabel}`);
      expect(markup).toContain(`Experiment ${item.expectedLabel}`);
      expect(markup).toContain(
        `aria-label="${item.label}: baseline ${item.expectedLabel} ${item.baseline}${item.statistic === "count" ? "" : ` ${item.unit}`}; experiment ${item.expectedLabel} ${item.current}${item.statistic === "count" ? "" : ` ${item.unit}`}."`,
      );
      expect(markup).not.toContain("Window averages");
      if (item.statistic === "count") {
        expect(markup).not.toContain("count count");
        expect(markup).not.toContain(`${item.baseline} count`);
        expect(markup).not.toContain(`${item.current} count`);
      }
    }
  });

  it("keeps daily trend dates stable outside UTC", () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = "America/New_York";

    try {
      expect(formatTrendDay("2026-05-29", 1)).toBe("May 29");
      expect(formatTrendDay("2026-05-29", 2)).toBe("May 30");
    } finally {
      process.env.TZ = previousTimeZone;
    }
  });

  it("renders done private runs as finished results", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const doneRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-29T08:00:00.000Z",
        trackedExperiments: [{
          id: "exp_sauna_done",
          slug: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
          startedOn: "2026-04-01",
          status: "done",
          summary: "Private run present; outcome export still pending.",
          tags: ["sauna"],
          title: "Finnish Dry Sauna",
        }],
      }),
      protocol: protocol!,
    });

    const doneMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: doneRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(doneRun).toEqual(expect.objectContaining({
      status: "finished",
    }));
    expect(doneMarkup).toContain("Run complete, but there isn&#x27;t enough data for a clear comparison");
    expect(doneMarkup).toContain("Private run recorded");
    expect(doneMarkup).toContain("does not have a canonical saved outcome to render");
  });

  it("maps real browser-vault biomarker trends without inventing an expected range band", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-10T12:00:00.000Z",
        metricRows: restingHeartRateRows([
          ["2026-04-01", 63],
          ["2026-04-02", 62],
          ["2026-04-03", 61],
          ["2026-04-08", 60],
          ["2026-04-09", 59],
          ["2026-04-10", 58],
        ]),
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
              secondaryBiomarkerKeys: ["biomarker:morning-blood-pressure"],
            },
            id: "exp_sauna_real_metrics",
            runPlan: {
              baselineEnd: "2026-04-03",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-14",
              interventionStart: "2026-04-08",
              minimumUsefulSessions: 4,
              schedule: {
                kind: "dailyLocal",
                localTime: "08:00",
                timeZone: "America/New_York",
              },
              targetSessions: 7,
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "active",
            title: "Private sauna run",
          }),
          id: "exp_sauna_real_metrics",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "active",
          summary: "Real browser-vault metric rows back this run.",
          tags: ["sauna"],
          title: "Private sauna run",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun?.signals).toEqual([
      expect.objectContaining({
        baseline: "62 bpm",
        delta: "-3 bpm",
        expected: "",
        label: "Resting Heart Rate",
        value: "59",
      }),
    ]);
    expect(privateRun?.trends).toEqual([
      expect.objectContaining({
        baseline: [
          { day: 1, value: 63 },
          { day: 2, value: 62 },
          { day: 3, value: 61 },
        ],
        active: [
          { day: 8, value: 60 },
          { day: 9, value: 59 },
          { day: 10, value: 58 },
        ],
        expectedRange: undefined,
        statistic: "mean",
      }),
    ]);

    const trendMarkup = renderToStaticMarkup(
      <TrendChart data={privateRun!.trends[0]!} />,
    );

    expect(trendMarkup).not.toContain("Expected");
    expect(trendMarkup).toContain("experiment average");
    expect(trendMarkup).not.toContain("latest");
    expect(trendMarkup).toContain('role="region"');
    expect(trendMarkup).toContain(
      'aria-label="Resting Heart Rate: baseline average 62 bpm; experiment average 59 bpm."',
    );
  });

  it("projects ordered comparable card metrics from production browser-vault signals", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-10T12:00:00.000Z",
        metricRows: [
          ...metricRows("resting-heart-rate", "bpm", [
            ["2026-04-01", 63],
            ["2026-04-02", 62],
            ["2026-04-03", 61],
            ["2026-04-08", 60],
            ["2026-04-09", 59],
            ["2026-04-10", 58],
          ]),
          ...metricRows("hrv-rmssd", "ms", [
            ["2026-04-01", 60],
            ["2026-04-02", 60],
            ["2026-04-03", 60],
            ["2026-04-08", 55],
            ["2026-04-09", 55],
            ["2026-04-10", 55],
          ]),
          ...metricRows("deep-sleep-minutes", "min", [
            ["2026-04-01", 90],
            ["2026-04-02", 90],
            ["2026-04-03", 90],
            ["2026-04-08", 90],
            ["2026-04-09", 90],
            ["2026-04-10", 90],
          ]),
          ...metricRows("rem-sleep-minutes", "min", [
            ["2026-04-01", 80],
            ["2026-04-02", 80],
            ["2026-04-03", 80],
            ["2026-04-08", 82],
          ]),
        ],
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
              secondaryBiomarkerKeys: [
                "biomarker:hrv-rmssd",
                "biomarker:deep-sleep-minutes",
                "biomarker:rem-sleep-minutes",
              ],
            },
            id: "exp_sauna_card_metrics",
            runPlan: {
              baselineEnd: "2026-04-03",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-10",
              interventionStart: "2026-04-08",
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "finished",
            title: "Private sauna run",
          }),
          id: "exp_sauna_card_metrics",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "finished",
          summary: "Production card-metric projection.",
          tags: ["sauna"],
          title: "Private sauna run",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun).not.toBeNull();
    expect(buildExperimentRunCardSummary(privateRun!).metrics.map((metric) => ({
      label: metric.label,
      sentiment: metric.sentiment,
    }))).toEqual([
      { label: "Resting Heart Rate", sentiment: "positive" },
      { label: "Hrv Rmssd", sentiment: "negative" },
      { label: "Deep Sleep Minutes", sentiment: "neutral" },
    ]);
    expect(privateRun?.signals.find((signal) => signal.label === "Rem Sleep Minutes")?.delta).toBe("");
  });

  it("hides deltas until the intervention window has enough days to compare", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-08T12:00:00.000Z",
        metricRows: restingHeartRateRows([
          ["2026-04-01", 63],
          ["2026-04-02", 62],
          ["2026-04-03", 61],
          ["2026-04-08", 60],
        ]),
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            id: "exp_sauna_day_one",
            runPlan: {
              baselineEnd: "2026-04-03",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-14",
              interventionStart: "2026-04-08",
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "active",
            title: "Private sauna day-one run",
          }),
          id: "exp_sauna_day_one",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "active",
          summary: "One intervention day is too little for a delta.",
          tags: ["sauna"],
          title: "Private sauna day-one run",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun?.signals).toEqual([
      expect.objectContaining({
        baseline: "62 bpm",
        delta: "",
        direction: "neutral",
        label: "Resting Heart Rate",
        value: "60",
      }),
    ]);
    expect(privateRun?.signals[0]?.sentiment).toBeUndefined();
    expect(privateRun?.trends[0]?.delta).toBe("");
    expect(privateRun?.summary).toBe("Protocol in progress");
  });

  it("bridges shown history into the first baseline point", () => {
    const hiddenHistoryPoints = buildTrendChartPoints({
      label: "Resting Heart Rate",
      unit: "bpm",
      startDate: "2026-04-01",
      history: [
        { day: -6, value: 64 },
        { day: -3, value: 63 },
      ],
      baseline: [
        { day: 1, value: 62 },
        { day: 2, value: 61 },
      ],
      active: [{ day: 8, value: 60 }],
      baselineAvg: 61.5,
      currentValue: 60,
      delta: "-1.5 bpm",
    }, false);
    const shownHistoryPoints = buildTrendChartPoints({
      label: "Resting Heart Rate",
      unit: "bpm",
      startDate: "2026-04-01",
      history: [
        { day: -6, value: 64 },
        { day: -3, value: 63 },
      ],
      baseline: [
        { day: 1, value: 62 },
        { day: 2, value: 61 },
      ],
      active: [{ day: 8, value: 60 }],
      baselineAvg: 61.5,
      currentValue: 60,
      delta: "-1.5 bpm",
    }, true);

    expect(hiddenHistoryPoints.some((point) => point.history !== undefined)).toBe(false);
    expect(shownHistoryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ day: -3, history: 63 }),
      expect.objectContaining({ day: 1, baseline: 62, history: 62 }),
    ]));
  });

  it("keeps saved window averages flat without changing the daily trend bridge", () => {
    const points = buildTrendChartPoints({
      active: [
        { day: 1, value: 58 },
        { day: 3, value: 58 },
      ],
      baseline: [
        { day: 0, value: 62 },
        { day: 1, value: 62 },
      ],
      baselineAvg: 62,
      currentValue: 58,
      delta: "-4 bpm",
      history: [],
      label: "Resting Heart Rate",
      startDate: "2026-04-01",
      unit: "bpm",
      windowComparison: {
        baselineDaysWithData: 5,
        baselineTotalDays: 7,
        interventionDaysWithData: 14,
        interventionTotalDays: 14,
      },
    }, false);

    expect(points).toEqual(expect.arrayContaining([
      expect.objectContaining({ day: 1, active: 58, baseline: 62 }),
      expect.objectContaining({ day: 3, active: 58 }),
    ]));
    expect(points).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ day: 1, active: 62 }),
    ]));

    const dailyPoints = buildTrendChartPoints({
      active: [{ day: 3, value: 58 }],
      baseline: [
        { day: 0, value: 62 },
        { day: 1, value: 62 },
      ],
      baselineAvg: 62,
      currentValue: 58,
      delta: "-4 bpm",
      history: [],
      label: "Resting Heart Rate",
      startDate: "2026-04-01",
      unit: "bpm",
    }, false);

    expect(dailyPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ day: 1, active: 62, baseline: 62 }),
      expect.objectContaining({ day: 3, active: 58 }),
    ]));
  });

  it("gives saved window averages a proportional visual domain", () => {
    const narrowDifference = buildWindowAverageDomain(94.8, 94.1);
    expect(narrowDifference[0]).toBeCloseTo(89.71);
    expect(narrowDifference[1]).toBeCloseTo(99.19);

    expect(buildWindowAverageDomain(50, 40)).toEqual([30, 60]);
    expect(buildWindowAverageDomain(0, 0)).toEqual([-0.5, 0.5]);
  });

  it("formats converted percent expected ranges with measured biomarker units", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-10T12:00:00.000Z",
        metricRows: restingHeartRateRows([
          ["2026-04-01", 62],
          ["2026-04-02", 62],
          ["2026-04-03", 62],
          ["2026-04-08", 60],
        ]),
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            expectedSignalDescriptions: [{
              biomarkerKey: "biomarker:resting-heart-rate",
              sourceKeys: ["source_artifact:range"],
              range: {
                dayOrigin: "intervention",
                startDay: 1,
                endDay: 1,
                low: -10,
                high: -5,
                scale: "percent",
                unit: "%",
              },
            }],
            id: "exp_sauna_expected_range",
            runPlan: {
              baselineEnd: "2026-04-03",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-14",
              interventionStart: "2026-04-08",
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "active",
            title: "Private sauna expected-range run",
          }),
          id: "exp_sauna_expected_range",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "active",
          summary: "Expected range has source-backed percent metadata.",
          tags: ["sauna"],
          title: "Private sauna expected-range run",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun?.signals[0]?.expected).toBe("55.8 to 58.9 bpm");
    expect(privateRun?.trends[0]?.expectedRange).toEqual([
      { day: 8, low: 55.8, high: 58.9 },
    ]);
  });

  it("renders partial and not-logged schedule cells from real browser-vault sessions", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        additionalEntities: [
          createSessionEntity({
            date: "2026-04-08",
            experimentId: "exp_sauna_schedule",
            experimentSlug: "finnish-sauna",
            sessionStatus: "completed",
          }),
          createSessionEntity({
            date: "2026-04-09",
            experimentId: "exp_sauna_schedule",
            experimentSlug: "finnish-sauna",
            sessionStatus: "partial",
          }),
          createSessionEntity({
            date: "2026-04-10",
            experimentId: "exp_sauna_schedule",
            experimentSlug: "finnish-sauna",
            sessionStatus: "skipped",
          }),
        ],
        generatedAt: "2026-04-10T12:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            id: "exp_sauna_schedule",
            runPlan: {
              baselineEnd: "2026-04-07",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-12",
              interventionStart: "2026-04-08",
              minimumUsefulSessions: 4,
              schedule: {
                kind: "dailyLocal",
                localTime: "08:00",
                timeZone: "America/New_York",
              },
              targetSessions: 5,
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "active",
            title: "Private sauna schedule run",
          }),
          id: "exp_sauna_schedule",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "active",
          summary: "Schedule cells are backed by logged intervention sessions.",
          tags: ["sauna"],
          title: "Private sauna schedule run",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun?.schedule).toBeDefined();

    const interventionKinds = privateRun?.schedule?.weeks
      .flatMap((week) => week.cells)
      .filter((cell) => cell.kind !== "baseline")
      .map((cell) => cell.kind);

    expect(interventionKinds).toEqual([
      "completed",
      "partial",
      "missed",
      "scheduled",
      "scheduled",
    ]);

    const scheduleMarkup = renderToStaticMarkup(
      <ExperimentSchedule schedule={privateRun!.schedule!} />,
    );

    expect(scheduleMarkup).toContain("Partial");
    expect(scheduleMarkup).toContain("Not logged");
    expect(scheduleMarkup).toContain("5 planned");
    expect(scheduleMarkup).not.toContain("2 done");
    expect(scheduleMarkup).not.toContain("1 missed");
  });

  it("renders repeated-session Results from occurrence counts instead of date cells", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const experimentId = "exp_repeated_results";
    const experimentSlug = "finnish-sauna";
    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        additionalEntities: [
          createSessionEntity({
            date: "2026-04-04",
            experimentId,
            experimentSlug,
            id: "evt_repeated_results_1",
            occurredAt: "2026-04-04T13:00:00.000Z",
            sessionStatus: "completed",
          }),
          createSessionEntity({
            date: "2026-04-04",
            experimentId,
            experimentSlug,
            id: "evt_repeated_results_2",
            occurredAt: "2026-04-04T15:00:00.000Z",
            sessionStatus: "completed",
          }),
          createSessionEntity({
            date: "2026-04-04",
            experimentId,
            experimentSlug,
            id: "evt_repeated_results_3",
            occurredAt: "2026-04-04T17:00:00.000Z",
            sessionStatus: "completed",
          }),
        ],
        generatedAt: "2026-04-05T12:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            id: experimentId,
            runPlan: {
              baselineEnd: "2026-04-03",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-04",
              interventionStart: "2026-04-04",
              minimumUsefulSessions: 4,
              targetSessions: 8,
              adherenceTargets: [{
                targetId: "strength-set",
                label: "Strength set",
                phase: "intervention",
                calendar: {
                  kind: "daily",
                  targetCountPerDay: 8,
                  timeZone: "America/New_York",
                },
                evidence: {
                  kind: "linkedEventCount",
                  eventKind: "intervention_session",
                  missing: "missed_after_grace",
                },
                grace: { hours: 0 },
                rollup: {
                  minimumUsefulCompletions: 4,
                  targetCompletions: 8,
                },
              }],
            },
            slug: experimentSlug,
            startedOn: "2026-04-01",
            status: "active",
            title: "Repeated Results run",
          }),
          id: experimentId,
          slug: experimentSlug,
          startedOn: "2026-04-01",
          status: "active",
          summary: "Repeated occurrences stay visible in Results.",
          tags: ["sauna"],
          title: "Repeated Results run",
        }],
      }),
      protocol: protocol!,
    });

    const interventionCells = privateRun?.schedule?.weeks
      .flatMap((week) => week.cells)
      .filter((cell) => cell.kind !== "baseline");

    expect(privateRun?.schedule?.loggedSessions).toBe(3);
    expect(interventionCells).toEqual([
      expect.objectContaining({
        detail: "3 of 8",
        occurrences: {
          assumed: 0,
          completed: 3,
          expected: 8,
          failed: 0,
          missed: 5,
          partial: 0,
          scheduled: 0,
          unknown: 0,
        },
      }),
    ]);

    const scheduleMarkup = renderToStaticMarkup(
      <ExperimentSchedule schedule={privateRun!.schedule!} />,
    );
    const summaryMarkup = renderToStaticMarkup(
      <ExperimentSummaryTiles
        experiment={{
          baselineDays: privateRun!.baselineDays ?? 0,
          day: privateRun!.day,
          durationDays: privateRun!.durationDays,
          schedule: privateRun!.schedule,
        }}
      />,
    );

    expect(scheduleMarkup).toContain("3 of 8");
    expect(scheduleMarkup).toContain("3 done");
    expect(scheduleMarkup).toContain("5 not logged");
    expect(summaryMarkup).toContain("3 of 8 done");
    expect(summaryMarkup).toContain("5 not logged");
  });

  it("renders all-assumed schedule cells as done with assumed detail copy", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-10T12:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            id: "exp_sauna_all_assumed",
            runPlan: {
              baselineEnd: "2026-04-07",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-10",
              interventionStart: "2026-04-08",
              adherenceTargets: [{
                targetId: "sauna",
                label: "Sauna",
                phase: "intervention",
                calendar: {
                  kind: "explicitDates",
                  timeZone: "America/New_York",
                  dates: [
                    { localDate: "2026-04-08", localTime: "00:00" },
                    { localDate: "2026-04-09", localTime: "00:00" },
                    { localDate: "2026-04-10", localTime: "00:00" },
                  ],
                },
                evidence: {
                  kind: "linkedEventCount",
                  eventKind: "intervention_session",
                  missing: "assumed_after_grace",
                },
                grace: { hours: 0 },
                rollup: {
                  targetCompletions: 3,
                  minimumUsefulCompletions: 2,
                },
              }],
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "active",
            title: "Private sauna assumed run",
          }),
          id: "exp_sauna_all_assumed",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "active",
          summary: "Assumed sauna cells should still count as done.",
          tags: ["sauna"],
          title: "Private sauna assumed run",
        }],
      }),
      protocol: protocol!,
    });

    const interventionKinds = privateRun?.schedule?.weeks
      .flatMap((week) => week.cells)
      .filter((cell) => cell.kind !== "baseline")
      .map((cell) => cell.kind);
    const markup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(interventionKinds).toEqual(["assumed", "assumed", "assumed"]);
    expect(markup).toContain("3 of 3 done");
    expect(markup).toContain("3 done, all assumed");
  });

  it("renders mixed confirmed and assumed schedule copy without calling all sessions logged", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        additionalEntities: [
          createSessionEntity({
            date: "2026-04-08",
            experimentId: "exp_sauna_mixed_assumed",
            experimentSlug: "finnish-sauna",
            sessionStatus: "completed",
            source: "manual",
          }),
        ],
        generatedAt: "2026-04-10T12:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            id: "exp_sauna_mixed_assumed",
            runPlan: {
              baselineEnd: "2026-04-07",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-10",
              interventionStart: "2026-04-08",
              adherenceTargets: [{
                targetId: "sauna",
                label: "Sauna",
                phase: "intervention",
                calendar: {
                  kind: "explicitDates",
                  timeZone: "America/New_York",
                  dates: [
                    { localDate: "2026-04-08", localTime: "00:00" },
                    { localDate: "2026-04-09", localTime: "00:00" },
                    { localDate: "2026-04-10", localTime: "00:00" },
                  ],
                },
                evidence: {
                  kind: "linkedEventCount",
                  eventKind: "intervention_session",
                  missing: "assumed_after_grace",
                },
                grace: { hours: 0 },
                rollup: {
                  targetCompletions: 3,
                  minimumUsefulCompletions: 2,
                },
              }],
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "active",
            title: "Private sauna mixed assumed run",
          }),
          id: "exp_sauna_mixed_assumed",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "active",
          summary: "Mixed assumed cells should expose the split.",
          tags: ["sauna"],
          title: "Private sauna mixed assumed run",
        }],
      }),
      protocol: protocol!,
    });
    const markup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(privateRun?.summaryDetail).toContain("3 done (2 assumed)");
    expect(privateRun?.summaryDetail).not.toContain("3 logged");
    expect(markup).toContain("3 of 3 done");
    expect(markup).toContain("3 done, 2 assumed");
  });

  it("keeps device-observed schedule copy on logged wording", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("norwegian-4x4");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        additionalEntities: [
          createActivitySessionEntity({
            activityType: "Running",
            date: "2026-06-01",
            id: "evt_device_schedule_run",
            source: "device",
            sportName: "Run",
          }),
        ],
        generatedAt: "2026-06-05T12:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "increase",
              primaryBiomarkerKey: "biomarker:vo2-max",
            },
            id: "exp_device_schedule_run",
            runPlan: {
              baselineEnd: "2026-05-31",
              baselineStart: "2026-05-25",
              interventionEnd: "2026-06-03",
              interventionStart: "2026-06-01",
              minimumUsefulSessions: 2,
              modality: "Run",
              schedule: {
                kind: "dailyLocal",
                localTime: "08:00",
                timeZone: "America/New_York",
              },
              targetSessions: 3,
            },
            slug: "norwegian-4x4",
            startedOn: "2026-05-25",
            status: "active",
            title: "Private running device schedule",
          }),
          id: "exp_device_schedule_run",
          slug: "norwegian-4x4",
          startedOn: "2026-05-25",
          status: "active",
          summary: "Device-observed sessions keep logged wording.",
          tags: ["running"],
          title: "Private running device schedule",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun?.summaryDetail).toContain("1 logged");
    expect(privateRun?.summaryDetail).not.toContain("1 done (");
  });

  it("does not synthesize a schedule grid for calendar-less count adherence", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("norwegian-4x4");

    expect(protocol).not.toBeNull();

    const client = await createClient({
      additionalEntities: [
        createActivitySessionEntity({
          activityType: "Running",
          date: "2026-06-01",
          id: "evt_count_run_1",
          sportName: "Run",
        }),
        createActivitySessionEntity({
          activityType: "Running",
          date: "2026-06-03",
          id: "evt_count_run_2",
          sportName: "Run",
        }),
        createActivitySessionEntity({
          activityType: "Running",
          date: "2026-06-05",
          id: "evt_count_run_3",
          sportName: "Run",
        }),
        createActivitySessionEntity({
          activityType: "Running",
          date: "2026-06-08",
          id: "evt_count_run_4",
          sportName: "Run",
        }),
      ],
      generatedAt: "2026-06-09T12:00:00.000Z",
      trackedExperiments: [{
        frontmatter: createExperimentFrontmatter({
          analysisPlan: {
            desiredDirection: "increase",
            primaryBiomarkerKey: "biomarker:vo2-max",
          },
          id: "exp_count_run_schedule",
          runPlan: {
            baselineEnd: "2026-05-31",
            baselineStart: "2026-05-25",
            interventionEnd: "2026-06-28",
            interventionStart: "2026-06-01",
            minimumUsefulSessions: 12,
            modality: "Run",
            targetSessions: 24,
          },
          slug: "norwegian-4x4",
          startedOn: "2026-05-25",
          status: "active",
          title: "Private running block",
        }),
        id: "exp_count_run_schedule",
        slug: "norwegian-4x4",
        startedOn: "2026-05-25",
        status: "active",
        summary: "Count-style running adherence should stay out of the daily grid.",
        tags: ["running"],
        title: "Private running block",
      }],
    });

    const rawResults = selectBrowserVaultExperimentResults(client, { slug: "norwegian-4x4" });
    const privateRun = resolveBrowserVaultExperimentRun({
      client,
      protocol: protocol!,
    });

    expect(rawResults?.progress?.adherence.loggedSessions).toBe(4);
    expect(privateRun?.schedule).toBeUndefined();
    expect(privateRun?.summaryDetail).toContain("4 logged");
  });

  it("does not synthesize a schedule grid for unsupported explicit adherence", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        additionalEntities: [
          createSessionEntity({
            date: "2026-04-08",
            experimentId: "exp_sauna_metric_adherence",
            experimentSlug: "finnish-sauna",
            sessionStatus: "completed",
          }),
        ],
        generatedAt: "2026-04-10T12:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            id: "exp_sauna_metric_adherence",
            runPlan: {
              baselineEnd: "2026-04-07",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-08",
              interventionStart: "2026-04-08",
              adherenceTargets: [{
                targetId: "step-floor",
                label: "Step floor",
                phase: "intervention",
                calendar: {
                  kind: "daily",
                  timeZone: "America/New_York",
                },
                evidence: {
                  kind: "metricThreshold",
                  metricKey: "steps",
                  op: ">=",
                  value: 8000,
                  missing: "unknown",
                },
                rollup: {
                  targetCompletions: 1,
                  minimumUsefulCompletions: 1,
                },
              }],
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "active",
            title: "Private sauna metric-adherence run",
          }),
          id: "exp_sauna_metric_adherence",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "active",
          summary: "Metric adherence is not yet supported in browser Results.",
          tags: ["sauna"],
          title: "Private sauna metric-adherence run",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun?.schedule).toBeUndefined();
  });

  it("renders browser-vault session confounders in private results context", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        additionalEntities: [
          createSessionEntity({
            afterExercise: true,
            confounders: {
              travel: true,
              trainingLoad: "heavy",
            },
            date: "2026-04-08",
            experimentId: "exp_sauna_context",
            experimentSlug: "finnish-sauna",
            note: "Felt lightheaded near the end.",
            sessionStatus: "completed",
            symptoms: ["lightheaded"],
          }),
        ],
        generatedAt: "2026-04-10T12:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            id: "exp_sauna_context",
            runPlan: {
              baselineEnd: "2026-04-07",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-12",
              interventionStart: "2026-04-08",
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "active",
            title: "Private sauna context run",
          }),
          id: "exp_sauna_context",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "active",
          summary: "Context is available even before outcome data is exported.",
          tags: ["sauna"],
          title: "Private sauna context run",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun?.sessionContext).toEqual([
      expect.objectContaining({
        confounders: ["After exercise", "Travel", "Training Load: heavy"],
        date: "2026-04-08",
        note: "Felt lightheaded near the end.",
        symptoms: ["lightheaded"],
      }),
    ]);

    const markup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(markup).toContain("Other factors and notes");
    expect(markup).toContain("After exercise");
    expect(markup).toContain("Training Load: heavy");
    expect(markup).toContain("Felt lightheaded near the end.");
    expect(markup).toContain("lightheaded");
  });

  it("renders experiment-context entries in private results context", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        additionalEntities: [
          createContextEntity({
            contextType: "late_caffeine",
            date: "2026-04-09",
            experimentId: "exp_sauna_context",
            experimentSlug: "finnish-sauna",
            note: "Coffee after dinner.",
            severity: "potential_confounder",
          }),
        ],
        generatedAt: "2026-04-10T12:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            id: "exp_sauna_context",
            runPlan: {
              baselineEnd: "2026-04-07",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-12",
              interventionStart: "2026-04-08",
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "active",
            title: "Private sauna context run",
          }),
          id: "exp_sauna_context",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "active",
          summary: "Context is available even before outcome data is exported.",
          tags: ["sauna"],
          title: "Private sauna context run",
        }],
      }),
      protocol: protocol!,
    });

    const markup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(markup).toContain("Context note");
    expect(markup).toContain("Late Caffeine");
    expect(markup).toContain("Coffee after dinner.");
  });

  it("preserves same-day planned target cells in the schedule UI projection", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-09T12:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            id: "exp_sauna_multi",
            runPlan: {
              baselineEnd: "2026-04-07",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-08",
              interventionStart: "2026-04-08",
              adherenceTargets: [
                {
                  targetId: "sauna-a",
                  label: "Sauna A",
                  phase: "intervention",
                  calendar: {
                    kind: "explicitDates",
                    timeZone: "America/New_York",
                    dates: [{ localDate: "2026-04-08", label: "Sauna A" }],
                  },
                  evidence: {
                    kind: "linkedEventCount",
                    eventKind: "intervention_session",
                    missing: "missed_after_grace",
                  },
                },
                {
                  targetId: "sauna-b",
                  label: "Sauna B",
                  phase: "intervention",
                  calendar: {
                    kind: "explicitDates",
                    timeZone: "America/New_York",
                    dates: [{ localDate: "2026-04-08", label: "Sauna B" }],
                  },
                  evidence: {
                    kind: "linkedEventCount",
                    eventKind: "intervention_session",
                    missing: "missed_after_grace",
                  },
                },
              ],
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "active",
            title: "Private sauna multi-target run",
          }),
          id: "exp_sauna_multi",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "active",
          summary: "Multiple planned targets can share a day.",
          tags: ["sauna"],
          title: "Private sauna multi-target run",
        }],
      }),
      protocol: protocol!,
    });

    const interventionCells = privateRun?.schedule?.weeks
      .flatMap((week) => week.cells)
      .filter((cell) => cell.kind !== "baseline");

    expect(interventionCells).toHaveLength(2);
    expect(interventionCells?.map((cell) => cell.kind)).toEqual(["scheduled", "scheduled"]);
  });

  it("starts protocol week numbering from the real intervention window", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-10T12:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            id: "exp_sauna_gap",
            runPlan: {
              baselineEnd: "2026-04-03",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-12",
              interventionStart: "2026-04-08",
              schedule: {
                kind: "dailyLocal",
                localTime: "08:00",
                timeZone: "America/New_York",
              },
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "active",
            title: "Private sauna gap run",
          }),
          id: "exp_sauna_gap",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "active",
          summary: "Run has a gap between baseline and intervention.",
          tags: ["sauna"],
          title: "Private sauna gap run",
        }],
      }),
      protocol: protocol!,
    });

    expect(privateRun?.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        date: "Apr 8",
        title: "Protocol window starts",
      }),
    ]));
    expect(privateRun?.schedule?.weeks.map((week) => week.label)).toEqual([
      "Baseline",
      "Week 1",
    ]);
  });

  it("returns no private run when the browser selector has no matching run", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const privateRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-12T08:00:00.000Z",
        trackedExperiments: [],
      }),
      protocol: protocol!,
    });

    expect(privateRun).toBeNull();
  });

  it("keeps paused runs distinct from active runs", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const pausedRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-20T08:00:00.000Z",
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            id: "exp_sauna_paused",
            runPlan: {
              baselineEnd: "2026-04-16",
              baselineStart: "2026-04-10",
              interventionEnd: "2026-04-30",
              interventionStart: "2026-04-17",
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-10",
            status: "paused",
            title: "Sauna protocol",
          }),
          id: "exp_sauna_paused",
          slug: "finnish-sauna",
          startedOn: "2026-04-10",
          status: "paused",
          summary: "Paused after the first few sauna sessions.",
          tags: ["sauna"],
          title: "Sauna protocol",
        }],
      }),
      protocol: protocol!,
    });

    expect(pausedRun).toEqual(expect.objectContaining({
      baselineDays: 7,
      day: 11,
      durationDays: 21,
      status: "paused",
      statusLabel: "Paused",
      timingKnown: true,
    }));

    const pausedMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: pausedRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(pausedMarkup).toContain("Your experiment is paused");
    expect(pausedMarkup).toContain("Day 11 of 21");
    expect(pausedMarkup).toContain("Paused on day 4");
    expect(pausedMarkup).toContain("Resume the protocol");
    expect(pausedMarkup).not.toContain("Day 11 of 14");
    expect(pausedMarkup).not.toContain("Starts day 15");
    expect(pausedMarkup).not.toContain("Continue the protocol");
  });

  it("renders stopped runs as saved but incomplete results", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const stoppedRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        generatedAt: "2026-04-20T08:00:00.000Z",
        metricRows: restingHeartRateRows([
          ["2026-04-01", 63],
          ["2026-04-02", 62],
          ["2026-04-03", 61],
          ["2026-04-08", 60],
          ["2026-04-09", 59],
          ["2026-04-10", 40],
        ]),
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            endedOn: "2026-04-09",
            id: "exp_sauna_stopped",
            runPlan: {
              baselineEnd: "2026-04-03",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-14",
              interventionStart: "2026-04-08",
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "completed",
            title: "Sauna protocol",
          }),
          id: "exp_sauna_stopped",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "completed",
          summary: "Stopped after the first sauna session.",
          tags: ["sauna"],
          title: "Sauna protocol",
        }],
      }),
      protocol: protocol!,
    });

    expect(stoppedRun).toEqual(expect.objectContaining({
      analysisAvailableOn: "2026-04-09",
      outcomeStatus: "not_expected",
      status: "stopped",
      statusLabel: "Stopped",
    }));
    expect(stoppedRun?.completionPercent).toBeLessThan(100);
    expect(stoppedRun?.signals).toEqual([
      expect.objectContaining({
        label: "Resting Heart Rate",
        value: "59.5",
      }),
    ]);
    expect(stoppedRun?.trends).toHaveLength(1);
    expect(stoppedRun?.conclusions).toBeUndefined();

    const stoppedMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: stoppedRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(stoppedMarkup).toContain("Your experiment was stopped");
    expect(stoppedMarkup).toContain(
      "Measurements below are partial context, not a completed before-and-after result",
    );
    expect(stoppedMarkup).toContain("Resting Heart Rate");
    expect(stoppedMarkup).not.toContain("Continue the protocol");
  });

  it("keeps a post-stop point measurement out of stopped Results", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");
    const outcome = createSavedOutcome({
      id: "exp_sauna_stopped_anchor",
      slug: "finnish-sauna",
      status: "paused",
      title: "Stopped anchor run",
      windows: {
        baselineEnd: "2026-04-03",
        baselineStart: "2026-04-01",
        interventionEnd: "2026-04-10",
        interventionStart: "2026-04-04",
      },
    });

    expect(protocol).not.toBeNull();

    const stoppedRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        experimentOutcomes: [outcome],
        generatedAt: "2026-04-20T08:00:00.000Z",
        metricRows: [
          metricRow({
            date: "2026-04-02",
            metricKey: "resting-heart-rate",
            recordIds: ["evt_web_stopped_anchor_baseline"],
            unit: "bpm",
            value: 63,
          }),
          metricRow({
            date: "2026-04-05",
            metricKey: "resting-heart-rate",
            recordIds: ["evt_web_stopped_anchor_followup"],
            unit: "bpm",
            value: 59,
          }),
          metricRow({
            date: "2026-04-06",
            metricKey: "resting-heart-rate",
            recordIds: ["evt_web_stopped_anchor_late"],
            unit: "bpm",
            value: 40,
          }),
        ],
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              measurementAnchors: [
                {
                  biomarkerKeys: ["biomarker:resting-heart-rate"],
                  kind: "lab_panel",
                  recordId: "evt_web_stopped_anchor_baseline",
                  role: "baseline",
                },
                {
                  biomarkerKeys: ["biomarker:resting-heart-rate"],
                  kind: "lab_panel",
                  recordId: "evt_web_stopped_anchor_followup",
                  role: "followup",
                },
                {
                  biomarkerKeys: ["biomarker:resting-heart-rate"],
                  kind: "lab_panel",
                  recordId: "evt_web_stopped_anchor_late",
                  role: "followup",
                },
              ],
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            endedOn: "2026-04-05",
            id: "exp_sauna_stopped_anchor",
            outcomeRef: {
              generatedAt: outcome.generatedAt,
              outcomeId: outcome.outcomeId,
              relativePath: "bank/experiments/outcomes/stopped-anchor.json",
            },
            runPlan: {
              baselineEnd: "2026-04-03",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-05",
              interventionStart: "2026-04-04",
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "paused",
            title: "Stopped anchor run",
          }),
          id: "exp_sauna_stopped_anchor",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "paused",
          summary: "Stopped before the later lab result.",
          tags: ["sauna"],
          title: "Stopped anchor run",
        }],
      }),
      protocol: protocol!,
    });

    expect(stoppedRun).toEqual(expect.objectContaining({
      outcomeStatus: "not_expected",
      status: "stopped",
    }));
    expect(stoppedRun?.signals).toEqual([
      expect.objectContaining({
        label: "Resting Heart Rate",
        value: "59",
      }),
    ]);
    expect(stoppedRun?.trends[0]?.active).toEqual([{ day: 5, value: 59 }]);
    expect(stoppedRun?.trends[0]?.active).not.toContainEqual({ day: 6, value: 40 });

    const stoppedMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: stoppedRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );
    expect(stoppedMarkup).toContain("Your experiment was stopped");
    expect(stoppedMarkup).toContain("Resting Heart Rate");
  });

  it("projects stopped runs from live boundaries when they diverge from a suppressed outcome", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");
    const outcome = createSavedOutcome({
      id: "exp_sauna_divergent_stop",
      slug: "finnish-sauna",
      title: "Divergent stop run",
      windows: {
        baselineEnd: "2026-04-03",
        baselineStart: "2026-04-01",
        interventionEnd: "2026-04-10",
        interventionStart: "2026-04-04",
      },
    });

    expect(protocol).not.toBeNull();

    const stoppedRun = resolveBrowserVaultExperimentRun({
      client: await createClient({
        experimentOutcomes: [outcome],
        generatedAt: "2026-04-20T08:00:00.000Z",
        metricRows: [],
        trackedExperiments: [{
          frontmatter: createExperimentFrontmatter({
            analysisPlan: {
              desiredDirection: "decrease",
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
            },
            endedOn: "2026-04-05",
            id: "exp_sauna_divergent_stop",
            outcomeRef: {
              generatedAt: outcome.generatedAt,
              outcomeId: outcome.outcomeId,
              relativePath: "bank/experiments/outcomes/divergent-stop.json",
            },
            runPlan: {
              baselineEnd: "2026-04-04",
              baselineStart: "2026-04-01",
              interventionEnd: "2026-04-05",
              interventionStart: "2026-04-05",
            },
            slug: "finnish-sauna",
            startedOn: "2026-04-01",
            status: "paused",
            title: "Divergent stop run",
          }),
          id: "exp_sauna_divergent_stop",
          slug: "finnish-sauna",
          startedOn: "2026-04-01",
          status: "paused",
          summary: "Stopped with edited live boundaries.",
          tags: ["sauna"],
          title: "Divergent stop run",
        }],
      }),
      protocol: protocol!,
    });

    expect(stoppedRun).toEqual(expect.objectContaining({
      analysisAvailableOn: "2026-04-05",
      outcomeStatus: "not_expected",
      status: "stopped",
    }));
    expect(stoppedRun?.conclusions).toBeUndefined();
    expect(stoppedRun?.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        date: "Apr 5",
        label: "Protocol",
      }),
    ]));
    expect(stoppedRun?.timeline).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        date: "Apr 4",
        label: "Protocol",
      }),
    ]));
  });
});

function createEntity(
  family: BrowserVaultEntity["family"],
  entityId: string,
  overrides: Partial<BrowserVaultEntity> = {},
): BrowserVaultEntity {
  const title = overrides.title ?? entityId;
  const kind = overrides.kind ?? `${family}_entry`;
  const stream = overrides.stream ?? null;
  const lookupId = overrides.primaryLookupId ?? entityId;

  return {
    attributes: overrides.attributes ?? {},
    body: overrides.body ?? null,
    date: overrides.date ?? "2026-04-20",
    entityId,
    experimentSlug: overrides.experimentSlug ?? null,
    family,
    frontmatter: overrides.frontmatter ?? null,
    kind,
    links: overrides.links ?? [],
    lookupIds: overrides.lookupIds ?? [lookupId],
    occurredAt: overrides.occurredAt ?? "2026-04-20T00:00:00.000Z",
    path: overrides.path ?? `history/${family}/${entityId}.md`,
    primaryLookupId: lookupId,
    recordClass: overrides.recordClass ?? resolveRecordClass(family),
    relatedIds: overrides.relatedIds ?? [],
    status: overrides.status ?? null,
    stream,
    tags: overrides.tags ?? [],
    title,
  };
}

function resolveRecordClass(family: BrowserVaultEntity["family"]): BrowserVaultEntity["recordClass"] {
  switch (family) {
    case "experiment":
      return "bank";
    default:
      throw new Error(`Unsupported browser-vault test family: ${family}`);
  }
}

function createExperimentFrontmatter(input: {
  analysisPlan?: Record<string, unknown>;
  endedOn?: string;
  id: string;
  outcomeRef?: Record<string, unknown>;
  slug: string;
  startedOn: string;
  status: string;
  title: string;
  commonsProtocolRef?: Record<string, unknown>;
  expectedSignalDescriptions?: unknown[];
  runPlan?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    docType: "experiment",
    analysisPlan: input.analysisPlan,
    commonsProtocolRef: input.commonsProtocolRef,
    effectiveProtocolSnapshot: input.commonsProtocolRef
      ? {
          effectiveSpecHash: `sha256:${"4".repeat(64)}`,
          doseSignature: "3x/week dry sauna, 15-20 min",
          modality: "dry_sauna",
          frequency: {
            sessionsPerWeek: 3,
          },
          durationMinutes: {
            min: 15,
            max: 20,
          },
          targetSessions: 6,
          minimumUsefulSessions: 4,
        }
      : undefined,
    endedOn: input.endedOn,
    expectedSignalDescriptions: input.expectedSignalDescriptions,
    experimentId: input.id,
    hypothesis: "Test the canonical private-run metadata path.",
    outcomeRef: input.outcomeRef,
    runPlan: input.runPlan,
    schemaVersion: "murph.frontmatter.experiment.v1",
    slug: input.slug,
    startedOn: input.startedOn,
    status: input.status,
    title: input.title,
  };
}

function createSavedOutcome(input: {
  deltaAbs?: number | null;
  id: string;
  points?: ExperimentOutcome["metricResults"][number]["points"];
  schemaVersion?: ExperimentOutcome["schemaVersion"];
  slug: string;
  status?: ExperimentOutcome["experiment"]["status"];
  title?: string;
  windows?: ExperimentOutcome["windows"];
}): ExperimentOutcome {
  return {
    adherenceSummary: {
      completedSessions: 3,
      minimumUsefulSessions: 2,
      status: "met_target",
      targetSessions: 3,
    },
    asOf: "2026-04-06",
    commonsProtocolRef: null,
    conclusion: {
      caveats: ["Travel overlapped the final session."],
      headline: "The exact saved headline",
      plainLanguage: "This is the exact saved plain-language conclusion.",
    },
    confidence: {
      level: "medium",
      reasons: ["The saved analysis accounted for travel."],
    },
    confounders: ["Travel"],
    effectiveProtocolSnapshot: null,
    experiment: {
      id: input.id,
      slug: input.slug,
      status: input.status ?? "completed",
      title: input.title ?? "Saved sauna run",
    },
    generatedAt: "2026-04-07T12:00:00.000Z",
    metricResults: [{
      baseline: {
        daysWithData: 3,
        mean: 62,
        totalDays: 3,
        unit: "bpm",
      },
      baselineDayCount: 3,
      baselineMean: 62,
      biomarkerKey: "biomarker:resting-heart-rate",
      completeness: "good",
      deltaAbs: input.deltaAbs === undefined ? -4 : input.deltaAbs,
      deltaPct: input.deltaAbs === null ? null : -6.45,
      expectedDirection: "decrease",
      intervention: {
        daysWithData: 3,
        mean: 58,
        totalDays: 3,
        unit: "bpm",
      },
      interventionDayCount: 3,
      interventionMean: 58,
      label: "Resting heart rate",
      movedAsExpected: true,
      ...(input.points === undefined ? {} : { points: input.points }),
      unit: "bpm",
    }],
    outcomeId: `outcome_${input.id}`,
    protocolRef: null,
    schemaVersion: input.schemaVersion ?? "murph.experiment-outcome.v1",
    windows: input.windows ?? {
      baselineEnd: "2026-04-03",
      baselineStart: "2026-04-01",
      interventionEnd: "2026-04-06",
      interventionStart: "2026-04-04",
    },
  };
}

function createSessionEntity(input: {
  afterExercise?: boolean;
  confounders?: Record<string, string | number | boolean | null> | string[];
  date: string;
  experimentId: string;
  experimentSlug: string;
  id?: string;
  note?: string;
  occurredAt?: string;
  sessionStatus: string;
  source?: string;
  symptoms?: string[];
}): BrowserVaultEntity {
  const id = input.id ?? `evt_${input.date}_${input.sessionStatus}`;
  return createEntity("event", id, {
    attributes: {
      afterExercise: input.afterExercise,
      confounders: input.confounders,
      experimentId: input.experimentId,
      experimentSlug: input.experimentSlug,
      note: input.note,
      sessionStatus: input.sessionStatus,
      ...(input.source === undefined ? {} : { source: input.source }),
      symptoms: input.symptoms,
    },
    date: input.date,
    experimentSlug: input.experimentSlug,
    kind: "intervention_session",
    links: [{ targetId: input.experimentId, type: "related_to" }],
    lookupIds: [id],
    occurredAt: input.occurredAt ?? `${input.date}T13:00:00.000Z`,
    recordClass: "ledger",
    title: "Sauna session",
  });
}

function createActivitySessionEntity(input: {
  activityType: string;
  date: string;
  id: string;
  source?: string;
  sportName?: string;
}): BrowserVaultEntity {
  return createEntity("event", input.id, {
    attributes: {
      activityType: input.activityType,
      ...(input.source === undefined ? {} : { source: input.source }),
      ...(input.sportName === undefined ? {} : { sportName: input.sportName }),
    },
    date: input.date,
    kind: "activity_session",
    lookupIds: [input.id],
    occurredAt: `${input.date}T12:00:00.000Z`,
    recordClass: "ledger",
    title: input.activityType,
  });
}

function createContextEntity(input: {
  contextType: string;
  date: string;
  experimentId: string;
  experimentSlug: string;
  note?: string;
  severity: string;
}): BrowserVaultEntity {
  return createEntity("event", `evt_context_${input.date}`, {
    attributes: {
      contextType: input.contextType,
      experimentId: input.experimentId,
      experimentSlug: input.experimentSlug,
      note: input.note,
      severity: input.severity,
    },
    date: input.date,
    experimentSlug: input.experimentSlug,
    kind: "experiment_context",
    links: [{ targetId: input.experimentId, type: "related_to" }],
    lookupIds: [`evt_context_${input.date}`],
    occurredAt: `${input.date}T13:00:00.000Z`,
    recordClass: "ledger",
    title: "Experiment context",
  });
}

function restingHeartRateRows(entries: readonly (readonly [string, number])[]): BrowserVaultMetricRow[] {
  return metricRows("resting-heart-rate", "bpm", entries);
}

function metricRows(
  metricKey: string,
  unit: string,
  entries: readonly (readonly [string, number])[],
): BrowserVaultMetricRow[] {
  return entries.map(([date, value]) =>
    metricRow({
      date,
      metricKey,
      unit,
      value,
    }),
  );
}

function metricRow(input: {
  date: string;
  metricKey: string;
  recordIds?: string[];
  unit: string;
  value: number;
}): BrowserVaultMetricRow {
  const biomarkerKeyByMetricKey: Readonly<Record<string, string>> = {
    "deep-sleep-minutes": "biomarker:deep-sleep-minutes",
    "hrv-rmssd": "biomarker:hrv-rmssd",
    "rem-sleep-minutes": "biomarker:rem-sleep-minutes",
    "resting-heart-rate": "biomarker:resting-heart-rate",
  };

  return {
    biomarkerKey: biomarkerKeyByMetricKey[input.metricKey] ?? null,
    confidence: "medium",
    context: {},
    date: input.date,
    grain: "day",
    id: `metric-row:${input.metricKey}:${input.date}`,
    metricKey: input.metricKey,
    observedAt: `${input.date}T00:00:00.000Z`,
    pointIds: [`metric-point:${input.metricKey}:${input.date}`],
    recordIds: input.recordIds ?? [],
    rowSchema: "murph.browser-vault.metric-row.v1",
    sourceFamily: "derived",
    sourceKind: "wearable-summary",
    sourceLabel: "Wearable summary",
    statistic: "value",
    unit: input.unit,
    value: input.value,
    valueLabel: String(input.value),
  };
}
