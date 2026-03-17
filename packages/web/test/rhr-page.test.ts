import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

vi.mock("../src/lib/rhr", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/rhr")>(
    "../src/lib/rhr",
  );

  return {
    ...actual,
    loadRestingHeartRatePageFromEnv: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test("RestingHeartRatePage renders the ready state", async () => {
  const { default: RestingHeartRatePage } = await import(
    "../app/biomarkers/resting-heart-rate/page"
  );
  const { loadRestingHeartRatePageFromEnv } = await import("../src/lib/rhr");
  const mockedLoader = vi.mocked(loadRestingHeartRatePageFromEnv);

  mockedLoader.mockResolvedValue({
    page: {
      activeExperiments: [
        {
          hypothesis: "Zone 2 should move lowest nighttime RHR within a month.",
          protocol: {
            entityType: "protocol_variant",
            slug: "attia-zone2-4x45m",
            subtitle: "Zone 2",
            title: "Zone 2 · 4 x 45 min",
            url: null,
          },
          slug: "zone2-rhr-reset",
          startedOn: "2026-03-14",
          status: "active",
          title: "Zone 2 RHR Reset",
        },
      ],
      activeGoals: [
        {
          id: "goal_rhr_01",
          measurementContextLabel: "Lowest nighttime wearable RHR",
          status: "active",
          target: "below 40 bpm",
          title: "Reach sub-40 lowest nighttime RHR",
        },
      ],
      baselineInsights: [],
      body: "RHR body",
      defaultMeasurementContext: {
        label: "Lowest nighttime wearable RHR",
        slug: "nighttime-lowest-wearable",
        summary: "Sleep-derived wearable measurement.",
        unit: "bpm",
      },
      domainLinks: [
        {
          entityType: "domain",
          slug: "cardiovascular-health",
          subtitle: null,
          title: "Cardiovascular Health",
          url: null,
        },
      ],
      goalTemplateLinks: [],
      guardrails: [],
      healthspanEvidence: [],
      heroStats: [
        {
          context: "general adult clinical range",
          label: "Adult awake resting range",
          sourceLinks: [],
          value: "60-100 bpm",
        },
      ],
      introParagraphs: ["Resting heart rate is a useful biomarker."],
      measurementContexts: [
        {
          label: "Lowest nighttime wearable RHR",
          slug: "nighttime-lowest-wearable",
          summary: "Sleep-derived wearable measurement.",
          unit: "bpm",
        },
      ],
      mechanisms: [],
      mission: {
        entityType: "mission",
        slug: "100-healthy-years",
        subtitle: null,
        title: "100 Healthy Years",
        url: null,
      },
      personalStats: {
        baseline28: 56.9,
        baseline7: 56.9,
        baseline56: 56.9,
        defaultMeasurementContext: "nighttime-lowest-wearable",
        deltaFrom28: -1.9,
        latestOccurredAt: "2026-03-13T06:50:00Z",
        latestValue: 55,
        samples: [
          {
            date: "2026-03-13",
            occurredAt: "2026-03-13T06:50:00Z",
            value: 55,
          },
        ],
      },
      protocols: [
        {
          contraindications: [],
          effect: {
            confidence: 0.84,
            evidenceLevel: "high",
            expectedDirection: "down",
            latency: "14-42 days",
            role: "primary",
            sourceMode: "clinical-study",
          },
          family: {
            entityType: "experiment_family",
            slug: "zone-2",
            subtitle: null,
            title: "Zone 2",
            url: null,
          },
          instructions: ["Train four times per week."],
          sourceLinks: [],
          sourcePeople: [],
          slug: "attia-zone2-4x45m",
          summary: "A high-repeatability aerobic base protocol.",
          title: "Zone 2 · 4 x 45 min",
        },
      ],
      referenceSets: [],
      relatedBiomarkerLinks: [],
      signalInsights: [],
      sourceLinks: [],
      status: "draft-v0.1",
      summary: "A behavior-sensitive biomarker.",
      title: "Resting Heart Rate",
    },
    status: "ready",
  });

  const markup = renderToStaticMarkup(await RestingHeartRatePage());

  assert.match(markup, /Resting Heart Rate/);
  assert.match(markup, /Zone 2 · 4 x 45 min/);
  assert.match(markup, /Reach sub-40 lowest nighttime RHR/);
  assert.match(markup, /55/);
});

test("RestingHeartRatePage renders the setup state", async () => {
  const { default: RestingHeartRatePage } = await import(
    "../app/biomarkers/resting-heart-rate/page"
  );
  const { loadRestingHeartRatePageFromEnv } = await import("../src/lib/rhr");
  const mockedLoader = vi.mocked(loadRestingHeartRatePageFromEnv);

  mockedLoader.mockResolvedValue({
    envVar: "HEALTHYBOB_VAULT",
    exampleVaultPath: "../../fixtures/demo-web-vault",
    status: "missing-config",
    suggestedCommand: "HEALTHYBOB_VAULT=../../fixtures/demo-web-vault pnpm dev",
  });

  const markup = renderToStaticMarkup(await RestingHeartRatePage());

  assert.match(markup, /No vault is configured yet/);
  assert.match(markup, /HEALTHYBOB_VAULT/);
});
