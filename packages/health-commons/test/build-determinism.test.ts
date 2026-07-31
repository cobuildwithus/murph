import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HealthCommonsCatalogEntity } from "@murphai/contracts";

const buildHealthCommonsCatalogMock = vi.hoisted(() => vi.fn());
const buildHealthCommonsSourceIndexMock = vi.hoisted(() =>
  vi.fn((catalog: { catalogHash: string }) => ({
    schemaVersion: "murph.commons.source-index.v1",
    generatedFromCatalogHash: catalog.catalogHash,
    sources: [],
    identityLookup: [
      {
        identityKey: "pmid:1",
        sourceKeys: ["source_artifact:pmid-1"],
        canonicalSourceKey: "source_artifact:pmid-1",
      },
    ],
    duplicateIdentities: [],
  })),
);
const buildHealthCommonsSourceArtifactIndexMock = vi.hoisted(() =>
  vi.fn((catalog: { catalogHash: string }) => ({
    schemaVersion: "murph.commons.source-artifact-index.v1",
    generatedFromCatalogHash: catalog.catalogHash,
    artifacts: [],
    sources: [],
  })),
);

vi.mock("../src/catalog.ts", () => ({
  buildHealthCommonsCatalog: buildHealthCommonsCatalogMock,
  buildHealthCommonsSourceArtifactIndex: buildHealthCommonsSourceArtifactIndexMock,
  buildHealthCommonsSourceIndex: buildHealthCommonsSourceIndexMock,
}));

import { writeHealthCommonsGeneratedArtifacts } from "../src/build.ts";
import { buildHealthCommonsWebBiomarkerOverview } from "../src/biomarker-web-artifacts.ts";
import { buildHealthCommonsWebGeneratedArtifacts } from "../src/web-artifacts.ts";

const TEST_PAGE_REVISION_ID = `sha256:${"1".repeat(64)}`;

function createCatalog(catalogHash: string) {
  return {
    artifactManifests: [],
    catalogHash,
    changes: [],
    entities: [],
    evidenceAppraisals: [],
    redirects: [],
    schemaVersion: "murph.commons.catalog.v1" as const,
  };
}

function createProtocolEntity(input: {
  expectedSignalDescriptions?: Array<{
    biomarkerKey: string;
    description: string;
    displayValue?: string;
    expected?: string;
    protocolProminence?: "focus" | "context";
  }>;
  hidden?: boolean;
  key: string;
  slug: string;
  status?: "draft" | "field-testing" | "reviewed" | "deprecated" | "community";
  title: string;
  relations?: { target: string; type: string }[];
}) {
  return {
    schemaVersion: "murph.commons.page.v1" as const,
    entityType: "protocol_variant" as const,
    key: input.key,
    slug: input.slug,
    title: input.title,
    summary: `${input.title} summary.`,
    categories: ["recovery"],
    hidden: input.hidden,
    status: input.status,
    lineage: { relationship: "root" as const },
    attribution: { ownerType: "murph" as const },
    protocol: {
      doseSignature: `${input.title} dose`,
      steps: [`Do ${input.title}.`],
    },
    expectedSignalDescriptions: input.expectedSignalDescriptions,
    relations: input.relations,
    safety: {
      cautionLevel: "moderate" as const,
      stopIf: ["Stop condition"],
    },
    testPlans: [
      {
        planId: "test-plan",
        durationDays: 14,
        baselineDays: 7,
        interventionDays: 7,
        primaryBiomarkerKey: "biomarker:test-signal",
      },
    ],
    body: `${input.title} body.`,
    relativePath: `${input.slug}.md`,
    revision: {
      pageRevisionId: TEST_PAGE_REVISION_ID,
    },
  };
}

function createBiomarkerEntity(input: {
  key: string;
  slug: string;
  title: string;
}) {
  return {
    schemaVersion: "murph.commons.page.v1" as const,
    entityType: "biomarker" as const,
    key: input.key,
    slug: input.slug,
    title: input.title,
    summary: `${input.title} summary.`,
    status: "reviewed" as const,
    body: `${input.title} body.`,
    relativePath: `${input.slug}.md`,
    revision: {
      pageRevisionId: TEST_PAGE_REVISION_ID,
    },
  };
}

describe("@murphai/health-commons build determinism", () => {
  beforeEach(() => {
    buildHealthCommonsCatalogMock.mockReset();
    buildHealthCommonsSourceArtifactIndexMock.mockClear();
    buildHealthCommonsSourceIndexMock.mockClear();
  });

  it("rejects check mode when two successive builds diverge", async () => {
    buildHealthCommonsCatalogMock
      .mockResolvedValueOnce(createCatalog("sha256:first"))
      .mockResolvedValueOnce(createCatalog("sha256:second"));

    await expect(
      writeHealthCommonsGeneratedArtifacts({
        check: true,
        contentRoot: "health-commons-content",
        generatedRoot: "health-commons-generated",
      }),
    ).rejects.toThrow(
      "Health Commons generated artifacts are nondeterministic: catalog.hash, protocol-index.json, protocol-run-specs.json, protocol-family-graph.json, biomarker-desired-directions.json, source-index.json, source-artifact-index.json, web/routes/index.json, web/browse/experiments.json, web/browse/biomarkers.json.",
    );

    expect(buildHealthCommonsCatalogMock).toHaveBeenCalledTimes(2);
  });

  it("writes generated source lookup artifacts", async () => {
    const generatedRoot = await pathFromTempDir("health-commons-generated-");
    buildHealthCommonsCatalogMock.mockResolvedValueOnce(createCatalog("sha256:first"));

    await writeHealthCommonsGeneratedArtifacts({
      check: false,
      contentRoot: "health-commons-content",
      generatedRoot,
    });

    await expect(readFile(path.join(generatedRoot, "source-index.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.source-index.v1"',
    );
    await expect(readFile(path.join(generatedRoot, "source-identities.ndjson"), "utf8")).resolves.toContain(
      '"identityKey":"pmid:1"',
    );
    await expect(readFile(path.join(generatedRoot, "source-artifact-index.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.source-artifact-index.v1"',
    );
    await expect(readFile(path.join(generatedRoot, "protocol-index.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.protocol-index.v1"',
    );
    await expect(readFile(path.join(generatedRoot, "protocol-run-specs.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.protocol-run-specs.v1"',
    );
    await expect(readFile(path.join(generatedRoot, "protocol-family-graph.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.protocol-family-graph.v1"',
    );
    await expect(
      readFile(
        path.join(generatedRoot, "biomarker-desired-directions.json"),
        "utf8",
      ),
    ).resolves.toContain(
      '"schemaVersion": "murph.commons.biomarker-desired-directions.v1"',
    );
    await expect(readFile(path.join(generatedRoot, "web/routes/index.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.web.route-index.v1"',
    );
    await expect(readFile(path.join(generatedRoot, "web/browse/experiments.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.web.experiment-index.v1"',
    );
    await expect(readFile(path.join(generatedRoot, "web/browse/biomarkers.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.web.biomarker-index.v3"',
    );
    expect(buildHealthCommonsSourceIndexMock).toHaveBeenCalledTimes(1);
    expect(buildHealthCommonsSourceArtifactIndexMock).toHaveBeenCalledTimes(1);
  });

  it("replaces stale generated files with the exact current file set", async () => {
    const generatedRoot = await pathFromTempDir("health-commons-generated-");
    buildHealthCommonsCatalogMock.mockResolvedValueOnce(createCatalog("sha256:first"));

    try {
      await mkdir(path.join(generatedRoot, "web", "stale"), { recursive: true });
      await writeFile(path.join(generatedRoot, "obsolete.json"), "{}\n", "utf8");
      await writeFile(path.join(generatedRoot, "web", "stale", "old.json"), "{}\n", "utf8");

      await writeHealthCommonsGeneratedArtifacts({
        check: false,
        contentRoot: "health-commons-content",
        generatedRoot,
      });

      await expect(readFile(path.join(generatedRoot, "protocol-index.json"), "utf8")).resolves.toContain(
        '"catalogHash": "sha256:first"',
      );
      await expect(readFile(path.join(generatedRoot, "catalog.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(path.join(generatedRoot, "obsolete.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(path.join(generatedRoot, "web", "stale", "old.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(generatedRoot, { recursive: true, force: true });
    }
  });

  it("rejects check mode when generated files are stale", async () => {
    const generatedRoot = await pathFromTempDir("health-commons-generated-");
    buildHealthCommonsCatalogMock
      .mockResolvedValueOnce(createCatalog("sha256:first"))
      .mockResolvedValueOnce(createCatalog("sha256:first"));

    try {
      await mkdir(generatedRoot, { recursive: true });
      await writeFile(path.join(generatedRoot, "protocol-index.json"), "{}\n", "utf8");
      await writeFile(path.join(generatedRoot, "catalog.json"), "{}\n", "utf8");
      await writeFile(path.join(generatedRoot, "obsolete.json"), "{}\n", "utf8");

      await expect(
        writeHealthCommonsGeneratedArtifacts({
          check: true,
          contentRoot: "health-commons-content",
          generatedRoot,
        }),
      ).rejects.toThrow("Health Commons generated artifacts are out of date");
    } finally {
      await rm(generatedRoot, { recursive: true, force: true });
    }
  });

  it("rejects duplicate generated web route ids before writing route indexes", () => {
    expect(() =>
      buildHealthCommonsWebGeneratedArtifacts({
        ...createCatalog("sha256:first"),
        entities: [
          createProtocolEntity({
            key: "protocol_variant:family/a",
            slug: "protocols/family/a",
            status: "field-testing",
            title: "Protocol A",
          }),
          createProtocolEntity({
            key: "protocol_variant:family/b",
            slug: "protocols/other/b",
            status: "field-testing",
            title: "Protocol B",
          }),
        ],
        redirects: [
          {
            from: "protocol_variant:legacy/shared",
            to: "protocol_variant:family/a",
          },
          {
            from: "protocol_variant:other/shared",
            to: "protocol_variant:family/b",
          },
        ],
      }),
    ).toThrow("Duplicate Health Commons web route id generated for protocol_variant:shared");
  });

  it("publishes web artifacts only for explicitly public protocols", () => {
    const webArtifacts = buildHealthCommonsWebGeneratedArtifacts({
      ...createCatalog("sha256:first"),
      entities: [
        createProtocolEntity({
          key: "protocol_variant:family/public",
          slug: "protocols/family/public",
          status: "field-testing",
          title: "Public Protocol",
        }),
        createProtocolEntity({
          key: "protocol_variant:family/statusless",
          slug: "protocols/family/statusless",
          title: "Statusless Protocol",
        }),
        createProtocolEntity({
          key: "protocol_variant:family/draft",
          slug: "protocols/family/draft",
          status: "draft",
          title: "Draft Protocol",
        }),
        createProtocolEntity({
          hidden: true,
          key: "protocol_variant:family/hidden",
          slug: "protocols/family/hidden",
          status: "reviewed",
          title: "Hidden Protocol",
        }),
        createProtocolEntity({
          key: "protocol_variant:family/deprecated",
          slug: "protocols/family/deprecated",
          status: "deprecated",
          title: "Deprecated Protocol",
        }),
      ],
      redirects: [
        {
          from: "protocol_variant:legacy/statusless-alias",
          to: "protocol_variant:family/statusless",
        },
        {
          from: "protocol_variant:legacy/draft-alias",
          to: "protocol_variant:family/draft",
        },
        {
          from: "protocol_variant:legacy/hidden-alias",
          to: "protocol_variant:family/hidden",
        },
        {
          from: "protocol_variant:legacy/deprecated-alias",
          to: "protocol_variant:family/deprecated",
        },
      ],
    });

    expect([...webArtifacts.projectionArtifacts.keys()].sort()).toEqual([
      "shell/experiments/public.json",
      "tabs/experiments/public/protocol.json",
      "tabs/experiments/public/research.json",
      "tabs/experiments/public/results-public.json",
    ]);
    expect(webArtifacts.routeIndex.routes.find((route) =>
      route.routeId === "public"
    )?.projections).toEqual({
      "experiment.protocol": "tabs/experiments/public/protocol.json",
      "experiment.research": "tabs/experiments/public/research.json",
      "experiment.results-public": "tabs/experiments/public/results-public.json",
      "experiment.shell": "shell/experiments/public.json",
    });
    expect(webArtifacts.routeIndex.routes.map((route) => route.routeId)).toEqual([
      "public",
    ]);
    expect([...webArtifacts.routeBundles.keys()]).toEqual([
      "bundles/protocol_variant/public.json",
    ]);
    expect(webArtifacts.experimentIndex.experiments.map((entry) => entry.routeId)).toEqual([
      "public",
    ]);
  });

  it("does not let a statusless protocol publish or enter a biomarker route bundle", () => {
    const statuslessProtocolKey = "protocol_variant:family/statusless";
    const biomarker = {
      ...createBiomarkerEntity({
        key: "biomarker:test-signal",
        slug: "biomarkers/test-signal",
        title: "Test Signal",
      }),
      biomarker: {
        explainerCards: [
          { title: "Why people care", body: "Test context." },
          { title: "How to measure it", body: "Test measurement." },
          { title: "What moves it", body: "Test confounders." },
        ],
        measurement: {
          bestContext: "Use a consistent test context.",
          howToMeasure: ["Measure consistently."],
        },
      },
      communityOutcomeSummary: {
        placeholder: "Community outcomes are not yet available.",
        state: "coming_soon",
      },
      relations: [{
        target: statuslessProtocolKey,
        type: "related_protocol",
      }],
    } satisfies HealthCommonsCatalogEntity;
    const statuslessProtocol = createProtocolEntity({
      expectedSignalDescriptions: [{
        biomarkerKey: biomarker.key,
        description: "Test signal.",
        protocolProminence: "focus",
      }],
      key: statuslessProtocolKey,
      relations: [{
        target: biomarker.key,
        type: "primary_biomarker",
      }],
      slug: "protocols/family/statusless",
      title: "Statusless Protocol",
    });
    const webArtifacts = buildHealthCommonsWebGeneratedArtifacts({
      ...createCatalog("sha256:first"),
      entities: [biomarker, statuslessProtocol],
    });
    const biomarkerBundle = webArtifacts.routeBundles.get(
      "bundles/biomarker/test-signal.json",
    );

    expect(webArtifacts.biomarkerIndex.biomarkers).toEqual([
      expect.objectContaining({
        key: biomarker.key,
        published: false,
      }),
    ]);
    expect(webArtifacts.routeIndex.routes[0]).not.toHaveProperty("projections");
    expect([...webArtifacts.projectionArtifacts.keys()]).toEqual([]);
    expect(Object.keys(biomarkerBundle?.entitiesByKey ?? {})).toEqual([
      biomarker.key,
    ]);
    expect(biomarkerBundle?.reverseEdges).toEqual([]);
  });

  it("excludes statusless protocols from biomarker rankings", () => {
    const biomarker = createBiomarkerEntity({
      key: "biomarker:test-signal",
      slug: "biomarkers/test-signal",
      title: "Test Signal",
    });
    const protocol = (key: string, status?: "field-testing") => createProtocolEntity({
      expectedSignalDescriptions: [{
        biomarkerKey: biomarker.key,
        description: "Test signal.",
        protocolProminence: "focus",
      }],
      key: `protocol_variant:family/${key}`,
      slug: `protocols/family/${key}`,
      status,
      title: `${key} Protocol`,
    });
    const protocols = [protocol("public", "field-testing"), protocol("statusless")];
    const overview = buildHealthCommonsWebBiomarkerOverview({
      biomarker,
      catalogHash: "sha256:first",
      entitiesByKey: new Map<string, HealthCommonsCatalogEntity>([
        [biomarker.key, biomarker],
        ...protocols.map((entry): [string, HealthCommonsCatalogEntity] => [
          entry.key,
          entry,
        ]),
      ]),
      routeAliases: [],
      routeId: "test-signal",
      routeIdByEntityKey: new Map(protocols.map((entry) => [entry.key, entry.slug])),
    });

    expect(overview.protocolRankings.map((ranking) => ranking.key)).toEqual([
      "protocol_variant:family/public",
    ]);
  });

  it("keeps protocol signal data for revision-qualified biomarker references", () => {
    const webArtifacts = buildHealthCommonsWebGeneratedArtifacts({
      ...createCatalog("sha256:first"),
      entities: [
        createBiomarkerEntity({
          key: "biomarker:test-signal",
          slug: "biomarkers/test-signal",
          title: "Test Signal",
        }),
        createProtocolEntity({
          expectedSignalDescriptions: [
            {
              biomarkerKey: `biomarker:test-signal@${TEST_PAGE_REVISION_ID}`,
              description: "Protocol-authored soreness signal.",
              displayValue: "Lower next-day soreness",
              expected: "down",
              protocolProminence: "focus",
            },
          ],
          key: "protocol_variant:family/public",
          slug: "protocols/family/public",
          status: "field-testing",
          title: "Public Protocol",
        }),
      ],
    });
    const protocolTab = webArtifacts.projectionArtifacts.get("tabs/experiments/public/protocol.json");

    expect(protocolTab && "expectedSignals" in protocolTab ? protocolTab.expectedSignals[0] : null).toMatchObject({
      biomarkerRouteId: "test-signal",
      displayValue: "Lower next-day soreness",
      expected: "Could trend lower",
      protocolProminence: "focus",
    });
  });
});

async function pathFromTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
