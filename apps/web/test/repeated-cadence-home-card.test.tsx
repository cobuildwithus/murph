import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  selectBrowserVaultTrackedExperiments,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser";
import { expect, test, vi } from "vitest";

import { HomeExperimentCard } from "@/src/components/home/home-experiment-card";
import { buildExperimentLibraryCards } from "@/src/lib/experiments/library-cards";

vi.mock("next/link", () => ({
  default(props: {
    children?: ReactNode;
    className?: string;
    href: string;
  }) {
    return createElement(
      "a",
      {
        className: props.className,
        href: props.href,
      },
      props.children,
    );
  },
}));

type BrowserVaultEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

const EXPERIMENT_ID = "exp_repeated_cadence";
const EXPERIMENT_SLUG = "movement-practice";
const GENERATED_AT = "2026-04-09T02:00:00.000Z";

test("repeated daily experiments lead with today's completed target count", async () => {
  const client = await createClient();
  const [card] = buildExperimentLibraryCards({
    client,
    protocols: [],
    trackedExperiments: selectBrowserVaultTrackedExperiments(client),
  });

  expect(card?.runSummary?.dailyCadence).toEqual({
    cadence: "6x Daily",
    completed: 3,
    expected: 6,
    label: "Movement practice",
  });

  const markup = renderToStaticMarkup(createElement(HomeExperimentCard, {
    card: card!,
    variant: "default",
  }));

  expect(markup).toContain("data-home-experiment-daily-cadence");
  expect(markup).toContain('aria-valuemax="6"');
  expect(markup).toContain('aria-valuenow="3"');
  expect(markup).toContain('aria-valuetext="3 of 6 completed today"');
  expect(markup).toContain("Movement practice · 6x Daily");
  expect(markup.match(/data-home-experiment-cadence-segment/gu)).toHaveLength(6);
  expect(markup.match(/data-complete="true"/gu)).toHaveLength(3);
  expect(markup).not.toContain("Experiment progress");
  expect(markup).not.toContain("14%");
});

async function createClient(): Promise<BrowserVaultQueryClient> {
  const replica = await createBrowserVaultReplica({
    generatedAt: GENERATED_AT,
    metricPoints: [],
    sourceBundleHash: "b".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createExperimentEntity(),
        createSessionEntity(1, "2026-04-08T12:00:00.000Z"),
        createSessionEntity(2, "2026-04-08T14:00:00.000Z"),
        createSessionEntity(3, "2026-04-08T16:00:00.000Z"),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  return createBrowserVaultQueryClient({
    ...replica,
    experimentOutcomes: [],
    metricRows: replica.metricRows,
  });
}

function createExperimentEntity(): BrowserVaultEntity {
  return {
    attributes: {},
    body: "A synthetic repeated daily movement experiment.",
    date: "2026-04-08",
    entityId: EXPERIMENT_ID,
    experimentSlug: EXPERIMENT_SLUG,
    family: "experiment",
    frontmatter: {
      docType: "experiment",
      experimentId: EXPERIMENT_ID,
      hypothesis: "Frequent low-fatigue practice improves movement quality.",
      runPlan: {
        adherenceTargets: [{
          calendar: {
            kind: "daily",
            targetCountPerDay: 6,
            timeZone: "America/New_York",
          },
          evidence: {
            eventKind: "intervention_session",
            kind: "linkedEventCount",
            missing: "missed_after_grace",
          },
          grace: { hours: 2 },
          label: "Movement practice",
          phase: "intervention",
          rollup: {
            minimumUsefulCompletions: 28,
            targetCompletions: 42,
          },
          targetId: "movement-practice",
        }],
        interventionEnd: "2026-04-14",
        interventionStart: "2026-04-08",
      },
      schemaVersion: "murph.frontmatter.experiment.v1",
      slug: EXPERIMENT_SLUG,
      startedOn: "2026-04-08",
      status: "active",
      title: "Movement practice",
    },
    kind: "experiment_entry",
    links: [],
    lookupIds: [EXPERIMENT_ID, EXPERIMENT_SLUG],
    occurredAt: "2026-04-08T08:00:00.000Z",
    path: `bank/experiments/${EXPERIMENT_ID}.md`,
    primaryLookupId: EXPERIMENT_ID,
    recordClass: "bank",
    relatedIds: [],
    status: "active",
    stream: null,
    tags: ["movement"],
    title: "Movement practice",
  };
}

function createSessionEntity(index: number, occurredAt: string): BrowserVaultEntity {
  const entityId = `evt_repeated_cadence_${index}`;

  return {
    attributes: {
      experimentId: EXPERIMENT_ID,
      experimentSlug: EXPERIMENT_SLUG,
      sessionStatus: "completed",
    },
    body: null,
    date: "2026-04-08",
    entityId,
    experimentSlug: EXPERIMENT_SLUG,
    family: "event",
    frontmatter: null,
    kind: "intervention_session",
    links: [{ targetId: EXPERIMENT_ID, type: "related_to" }],
    lookupIds: [entityId],
    occurredAt,
    path: `history/events/${entityId}.md`,
    primaryLookupId: entityId,
    recordClass: "ledger",
    relatedIds: [],
    status: "completed",
    stream: null,
    tags: [],
    title: "Movement practice session",
  };
}
