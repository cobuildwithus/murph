import { describe, expect, it } from "vitest";

import {
  createHealthCommonsCatalogReader,
  getGeneratedHealthCommonsCatalogReader,
  loadGeneratedHealthCommonsCatalog,
} from "@murphai/health-commons";

describe("@murphai/health-commons runtime catalog reader", () => {
  it("loads the generated catalog and resolves keys, slugs, and route ids", () => {
    const catalog = loadGeneratedHealthCommonsCatalog();
    const reader = createHealthCommonsCatalogReader(catalog);

    expect(reader.catalogHash).toBe(catalog.catalogHash);

    const finnishSauna = reader.findByKey("protocol_variant:finnish-sauna");
    expect(finnishSauna?.key).toBe(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );

    expect(
      reader.findByRouteId({
        entityType: "protocol_variant",
        routeId: "finnish-sauna",
      })?.key,
    ).toBe("protocol_variant:dry-sauna/murph-finnish-standard-3x-week");

    expect(reader.findBySlug("protocols/norwegian-4x4/norwegian-4x4")?.key).toBe(
      "protocol_variant:norwegian-4x4/norwegian-4x4",
    );

    expect(
      reader.findByRouteId({
        entityType: "protocol_variant",
        routeId: "/protocols/norwegian-4x4/norwegian-4x4/",
      })?.key,
    ).toBe("protocol_variant:norwegian-4x4/norwegian-4x4");

    const { findByRouteId } = reader;
    expect(
      findByRouteId({
        entityType: "protocol_variant",
        routeId: "norwegian-4x4",
      })?.key,
    ).toBe("protocol_variant:norwegian-4x4/norwegian-4x4");

    expect(
      reader.findByRouteId({
        entityType: "protocol_variant",
        routeId: "%E0%A4%A",
      }),
    ).toBeNull();
  });

  it("lists compact protocol variants and source artifacts deterministically", () => {
    const reader = getGeneratedHealthCommonsCatalogReader();

    const protocols = reader.listProtocolVariants({ limit: 5 });
    expect(protocols.map((protocol) => protocol.key)).toEqual([
      "protocol_variant:cold-water-immersion/cold-plunge",
      "protocol_variant:consistent-wake-time/consistent-wake-time",
      "protocol_variant:creatine-supplementation/creatine-monohydrate",
      "protocol_variant:dry-sauna/bryan-johnson-blueprint",
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    ]);
    expect(Object.keys(protocols[0] ?? {})).not.toContain("body");
    expect(protocols[4]?.protocol).toMatchObject({
      doseSignature: expect.stringContaining("3x/week"),
      runSpecRevisionId: expect.stringMatching(/^sha256:/u),
    });
    expect(protocols[4]?.routeIds).toContain("finnish-sauna");

    const saunaSources = reader.listSourceArtifacts({
      categories: ["sauna"],
      limit: 2,
    });
    expect(saunaSources).toHaveLength(2);
    expect(saunaSources.every((source) => source.entityType === "source_artifact")).toBe(true);
    expect(saunaSources.every((source) => source.categories.includes("sauna"))).toBe(true);

    expect(reader.listSourceArtifacts({ limit: 500 }).length).toBeGreaterThan(100);
  });

  it("searches by query, category, and entity type with compact results", () => {
    const reader = getGeneratedHealthCommonsCatalogReader();

    const protocolResults = reader.search({
      categories: ["passive heat"],
      entityTypes: ["protocol_variant"],
      limit: 5,
      query: "sauna",
    });

    expect(protocolResults.map((result) => result.entity.key)).toContain(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(
      protocolResults.every((result) => result.entity.entityType === "protocol_variant"),
    ).toBe(true);
    expect(protocolResults[0]?.score).toBeGreaterThanOrEqual(protocolResults.at(-1)?.score ?? 0);

    const sourceResults = reader.search({
      entityTypes: ["source_artifact"],
      limit: 1,
      query: "25705824",
    });

    expect(sourceResults[0]).toMatchObject({
      entity: {
        key: "source_artifact:pmid-25705824",
        source: {
          pmid: "25705824",
        },
      },
      matchedFields: expect.arrayContaining(["source"]),
    });
  });

  it("resolves compact relations and source context for assistant tools", () => {
    const reader = getGeneratedHealthCommonsCatalogReader();
    const protocol = reader.findByRouteId({
      entityType: "protocol_variant",
      routeId: "finnish-sauna",
    });
    expect(protocol).not.toBeNull();

    const context = reader.resolveEntityContext({
      entity: protocol?.key ?? "",
      relationLimit: 4,
      relationTypes: ["parent_family", "primary_biomarker", "secondary_biomarker"],
      sourceLimit: 5,
    });

    expect(context?.entity.key).toBe(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(context?.relations.map((entry) => entry.relation.type)).toEqual([
      "parent_family",
      "primary_biomarker",
      "secondary_biomarker",
      "secondary_biomarker",
    ]);
    expect(context?.sources).toHaveLength(5);
    expect(context?.sources.every((entry) => entry.source.entityType === "source_artifact")).toBe(true);
    expect(context?.sources[0]?.reasons[0]).toMatchObject({
      claimId: "research-base-is-broad-but-mixed",
      kind: "claim",
    });

    const sourceContext = reader.resolveEntityContext({
      entity: "source_artifact:pmid-25705824",
      sourceLimit: 1,
    });

    expect(sourceContext?.sources[0]).toMatchObject({
      reasons: [
        {
          kind: "self",
        },
      ],
      source: {
        key: "source_artifact:pmid-25705824",
      },
    });

    const hyperbaric = reader.findByKey(
      "protocol_variant:hyperbaric-oxygen-therapy/hyperbaric-oxygen-therapy",
    );
    expect(hyperbaric).not.toBeNull();
    expect(reader.resolveSources({ entity: hyperbaric?.key ?? "", limit: 500 }).length)
      .toBeGreaterThan(100);
    expect(reader.collectSourceKeys({ entity: hyperbaric }).length).toBeGreaterThan(100);
    expect(reader.collectSourceKeys({ entity: "source_artifact:pmid-25705824" })).toEqual([]);
    expect(
      reader.collectSourceKeys({
        entity: "source_artifact:pmid-25705824",
        includeSelf: true,
      }),
    ).toEqual(["source_artifact:pmid-25705824"]);
  });
});
