import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

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
      "Health Commons generated artifacts are nondeterministic: catalog.hash, protocol-index.json, protocol-run-specs.json, protocol-family-graph.json, source-index.json, source-artifact-index.json, web/routes/index.json, web/browse/experiments.json, web/browse/biomarkers.json.",
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
    await expect(readFile(path.join(generatedRoot, "web/routes/index.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.web.route-index.v1"',
    );
    await expect(readFile(path.join(generatedRoot, "web/browse/experiments.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.web.experiment-index.v1"',
    );
    await expect(readFile(path.join(generatedRoot, "web/browse/biomarkers.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.web.biomarker-index.v1"',
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
            title: "Protocol A",
          }),
          createProtocolEntity({
            key: "protocol_variant:family/b",
            slug: "protocols/other/b",
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

  it("does not generate experiment research-tab projections for hidden or deprecated protocols", () => {
    const webArtifacts = buildHealthCommonsWebGeneratedArtifacts({
      ...createCatalog("sha256:first"),
      entities: [
        createProtocolEntity({
          key: "protocol_variant:family/public",
          slug: "protocols/family/public",
          title: "Public Protocol",
        }),
        createProtocolEntity({
          hidden: true,
          key: "protocol_variant:family/hidden",
          slug: "protocols/family/hidden",
          title: "Hidden Protocol",
        }),
        createProtocolEntity({
          key: "protocol_variant:family/deprecated",
          slug: "protocols/family/deprecated",
          status: "deprecated",
          title: "Deprecated Protocol",
        }),
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
    expect(webArtifacts.routeIndex.routes.find((route) =>
      route.routeId === "hidden"
    )?.projections).toBeUndefined();
    expect(webArtifacts.routeIndex.routes.find((route) =>
      route.routeId === "deprecated"
    )?.projections).toBeUndefined();
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
