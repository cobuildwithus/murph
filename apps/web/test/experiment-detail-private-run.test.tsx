import { renderToStaticMarkup } from "react-dom/server";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser";
import { describe, expect, it } from "vitest";

import { ResultsTab } from "@/src/components/experiments/experiment-detail/results-tab";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import { composeExperimentDetail } from "@/src/lib/experiments/experiment-detail";
import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";

type BrowserVaultEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

async function createClient(input: {
  generatedAt: string;
  trackedExperiments: Array<{
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
    generatedAt: input.generatedAt,
    sourceBundleHash: "a".repeat(64),
    vault: createVaultReadModel({
      entities: input.trackedExperiments.map((entry) =>
        createEntity("experiment", entry.id, {
          body: entry.summary,
          date: entry.startedOn ?? input.generatedAt.slice(0, 10),
          experimentSlug: entry.slug,
          lookupIds: [entry.id, ...(entry.slug ? [entry.slug] : [])],
          occurredAt: `${entry.startedOn ?? input.generatedAt.slice(0, 10)}T08:00:00.000Z`,
          status: entry.status,
          tags: entry.tags,
          title: entry.title,
        })
      ),
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  return createBrowserVaultQueryClient(replica);
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

    expect(baselineMarkup).toContain("Private run linked");
    expect(baselineMarkup).toContain("Protocol · Not started");
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

    expect(emptyMarkup).toContain("No private run yet");

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

    expect(finishedMarkup).toContain("No biomarker comparison exported yet");
    expect(finishedMarkup).toContain("Private run recorded");
    expect(finishedMarkup).toContain("Private run present; outcome export still pending.");

    const staleMarkup = renderToStaticMarkup(
      <ResultsTab
        experiment={composeExperimentDetail({ protocol: protocol!, privateRun: finishedRun })}
        privateRunError="The latest private refresh failed."
        privateRunStatus="error"
      />,
    );

    expect(staleMarkup).toContain("Private run loaded, refresh unavailable");
    expect(staleMarkup).toContain("The latest private refresh failed.");
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

    expect(pausedMarkup).toContain("Private run paused");
    expect(pausedMarkup).toContain("Paused · Day 4 of 14");
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
