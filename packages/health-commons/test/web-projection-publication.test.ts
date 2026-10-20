import { beforeAll, describe, expect, it } from "vitest";
import type { HealthCommonsCatalog } from "@murphai/contracts";
import { loadGeneratedHealthCommonsWebRouteBundle } from "../src/runtime.ts";
import { buildHealthCommonsWebGeneratedArtifacts } from "../src/web-artifacts.ts";

let catalog: HealthCommonsCatalog;
beforeAll(() => {
  const bundles = [
    loadGeneratedHealthCommonsWebRouteBundle({ entityType: "protocol_variant", routeId: "norwegian-4x4" }),
    loadGeneratedHealthCommonsWebRouteBundle({ entityType: "protocol_variant", routeId: "bryan-johnson-blueprint" }),
  ].filter((bundle) => bundle !== null);
  if (bundles.length !== 2) throw new Error("Expected published route bundles.");
  catalog = {
    schemaVersion: "murph.commons.catalog.v1",
    catalogHash: bundles[0]!.catalogHash,
    entities: [...new Map(bundles.flatMap((bundle) => Object.values(bundle.entitiesByKey)).map((entity) => [entity.key, entity])).values()],
    redirects: [], changes: [], artifactManifests: [], evidenceAppraisals: [],
  };
});

describe("generated Web projection publication", () => {
  it("excludes draft and hidden protocols from public routes", () => {
    const fixture = structuredClone(catalog);
    const protocol = fixture.entities.find((entity) => entity.entityType === "protocol_variant" && entity.title === "Norwegian 4x4");
    if (!protocol) throw new Error("Expected Norwegian 4x4 content.");
    for (const status of ["draft", "hidden"] as const) {
      protocol.status = status === "draft" ? "draft" : "reviewed";
      protocol.hidden = status === "hidden";
      const artifacts = buildHealthCommonsWebGeneratedArtifacts(fixture);
      expect(artifacts.experimentIndex.experiments.map((entry) => entry.key)).not.toContain(protocol.key);
    }
  });

  it("rejects protocol-relative expert images in generated protocol projections", () => {
    const fixture = structuredClone(catalog);
    const person = fixture.entities.find((entity) => entity.key === "source_person:bryan-johnson");
    if (!person) throw new Error("Expected the protocol source person.");
    Object.assign(person, { profileImageUrl: "//cdn.example.test/avatar.jpg" });
    const artifacts = buildHealthCommonsWebGeneratedArtifacts(fixture);
    const protocol = artifacts.projectionArtifacts.get("tabs/experiments/bryan-johnson-blueprint/protocol.json");
    if (!protocol || !("experts" in protocol)) throw new Error("Expected the protocol projection.");
    const expert = protocol.experts.find((entry) => entry.name === "Bryan Johnson");
    expect(expert).toBeDefined();
    expect(expert?.profileImageUrl).toBeUndefined();
  });
});
