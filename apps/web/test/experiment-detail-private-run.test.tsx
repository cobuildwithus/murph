import { renderToStaticMarkup } from "react-dom/server";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  selectBrowserVaultExperimentResults,
  type BrowserVaultQueryClient,
  type BrowserVaultMetricRow,
} from "@murphai/query/browser";
import { describe, expect, it } from "vitest";

import { ExperimentSchedule } from "@/src/components/experiments/experiment-detail/experiment-schedule";
import { ResultsTab } from "@/src/components/experiments/experiment-detail/results-tab";
import {
  TrendChart,
  buildTrendChartPoints,
} from "@/src/components/experiments/experiment-detail/trend-chart";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import { composeExperimentDetail } from "@/src/lib/experiments/experiment-detail";
import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";

type BrowserVaultEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

async function createClient(input: {
  additionalEntities?: BrowserVaultEntity[];
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

  if (!input.metricRows) {
    return createBrowserVaultQueryClient(replica);
  }

  return createBrowserVaultQueryClient({
    ...replica,
    metricRows: input.metricRows,
  });
}

describe("experiment detail private-run composition", () => {
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
      id: "exp_sauna_protocol_ref",
      slug: null,
      status: "active",
    }));
    expect(privateRun?.nextStep).toEqual(expect.objectContaining({
      title: "Keep the baseline clean",
      when: "Baseline day 3 of 7",
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

  it("renders honest baseline progress before the protocol window starts", async () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const activeBaselineRun = resolveBrowserVaultExperimentRun({
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

    const baselineMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: activeBaselineRun })}
        privateRunError={null}
        privateRunStatus="ready"
      />,
    );

    expect(baselineMarkup).toContain("running this experiment");
    expect(baselineMarkup).toContain("Starts day 8");
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

    expect(loadingMarkup).toContain("Loading your private run");
    expect(loadingMarkup).not.toContain("No personal results yet");

    const emptyMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: null })}
        privateRunError={null}
        privateRunStatus="empty"
      />,
    );

    expect(emptyMarkup).toContain("Run this on yourself");

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

    expect(finishedMarkup).toContain("No before-and-after comparison yet");
    expect(finishedMarkup).toContain("Private run recorded");
    expect(finishedMarkup).toContain("The run is finished, but a full before-and-after window");

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

    expect(finishedFallbackRun?.conclusions?.[0]?.items[0]?.text).toBe(
      "This run doesn't have enough measured data for a before-and-after conclusion yet.",
    );

    const staleMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: finishedRun })}
        privateRunError="The latest private refresh failed."
        privateRunStatus="error"
      />,
    );

    expect(staleMarkup).toContain("but couldn&#x27;t refresh");
    expect(staleMarkup).toContain("The latest private refresh failed.");
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
    expect(doneMarkup).toContain("No before-and-after comparison yet");
    expect(doneMarkup).toContain("Private run recorded");
    expect(doneMarkup).toContain("The run is finished, but a full before-and-after window");
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
      }),
    ]);

    const trendMarkup = renderToStaticMarkup(
      <TrendChart data={privateRun!.trends[0]!} />,
    );

    expect(trendMarkup).not.toContain("Expected");
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

    expect(pausedMarkup).toContain("Your experiment is paused");
    expect(pausedMarkup).toContain("Paused on day 4");
    expect(pausedMarkup).toContain("Resume the protocol");
    expect(pausedMarkup).not.toContain("Continue the protocol");
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
  id: string;
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
    expectedSignalDescriptions: input.expectedSignalDescriptions,
    experimentId: input.id,
    hypothesis: "Test the canonical private-run metadata path.",
    runPlan: input.runPlan,
    schemaVersion: "murph.frontmatter.experiment.v1",
    slug: input.slug,
    startedOn: input.startedOn,
    status: input.status,
    title: input.title,
  };
}

function createSessionEntity(input: {
  afterExercise?: boolean;
  confounders?: Record<string, string | number | boolean | null> | string[];
  date: string;
  experimentId: string;
  experimentSlug: string;
  note?: string;
  sessionStatus: string;
  source?: string;
  symptoms?: string[];
}): BrowserVaultEntity {
  return createEntity("event", `evt_${input.date}_${input.sessionStatus}`, {
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
    lookupIds: [`evt_${input.date}_${input.sessionStatus}`],
    occurredAt: `${input.date}T13:00:00.000Z`,
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
  return entries.map(([date, value]) =>
    metricRow({
      date,
      metricKey: "resting-heart-rate",
      unit: "bpm",
      value,
    }),
  );
}

function metricRow(input: {
  date: string;
  metricKey: string;
  unit: string;
  value: number;
}): BrowserVaultMetricRow {
  return {
    biomarkerKey: input.metricKey === "resting-heart-rate" ? "biomarker:resting-heart-rate" : null,
    confidence: "medium",
    context: {},
    date: input.date,
    grain: "day",
    id: `metric-row:${input.metricKey}:${input.date}`,
    metricKey: input.metricKey,
    observedAt: `${input.date}T00:00:00.000Z`,
    pointIds: [`metric-point:${input.metricKey}:${input.date}`],
    recordIds: [],
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
