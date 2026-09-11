import { beforeAll, describe, expect, it } from "vitest";
import type { HealthCommonsCatalog } from "@murphai/contracts";
import { loadGeneratedHealthCommonsWebRouteBundle } from "../src/runtime.ts";
import { buildHealthCommonsWebGeneratedArtifacts } from "../src/web-artifacts.ts";

let catalog: HealthCommonsCatalog;
beforeAll(() => {
  const bundles = [
    loadGeneratedHealthCommonsWebRouteBundle({ entityType: "protocol_variant", routeId: "norwegian-4x4" }),
    loadGeneratedHealthCommonsWebRouteBundle({ entityType: "protocol_variant", routeId: "bryan-johnson-blueprint" }),
    loadGeneratedHealthCommonsWebRouteBundle({ entityType: "biomarker", routeId: "resting-heart-rate" }),
    loadGeneratedHealthCommonsWebRouteBundle({ entityType: "biomarker", routeId: "estimated-vo2max" }),
  ].filter((bundle) => bundle !== null);
  if (bundles.length !== 4) throw new Error("Expected published route bundles.");
  catalog = {
    schemaVersion: "murph.commons.catalog.v1",
    catalogHash: bundles[0]!.catalogHash,
    entities: [...new Map(bundles.flatMap((bundle) => Object.values(bundle.entitiesByKey)).map((entity) => [entity.key, entity])).values()],
    redirects: [], changes: [], artifactManifests: [], evidenceAppraisals: [],
  };
});

describe("generated Web projection publication", () => {
  it("excludes draft and hidden protocols from public routes and biomarker rankings", () => {
    const fixture = structuredClone(catalog);
    const protocol = fixture.entities.find((entity) => entity.entityType === "protocol_variant" && entity.title === "Norwegian 4x4");
    if (!protocol) throw new Error("Expected Norwegian 4x4 content.");
    for (const status of ["draft", "hidden"] as const) {
      protocol.status = status === "draft" ? "draft" : "reviewed";
      protocol.hidden = status === "hidden";
      const artifacts = buildHealthCommonsWebGeneratedArtifacts(fixture);
      expect(artifacts.experimentIndex.experiments.map((entry) => entry.key)).not.toContain(protocol.key);
      const overview = artifacts.projectionArtifacts.get("pages/biomarkers/estimated-vo2max/overview.json");
      if (!overview || !("protocolRankings" in overview)) throw new Error("Expected VO2 max overview.");
      expect(overview.protocolRankings.map((entry) => entry.title)).not.toContain("Norwegian 4x4");
    }
  });

  it("publishes complete biomarkers without private bindings and excludes incomplete or hidden pages", () => {
    const fixture = structuredClone(catalog);
    const biomarker = fixture.entities.find((entity) => entity.key === "biomarker:resting-heart-rate");
    if (!biomarker?.biomarker) throw new Error("Expected RHR content.");
    biomarker.biomarker.privateMetricBindings = [];
    let artifacts = buildHealthCommonsWebGeneratedArtifacts(fixture);
    const shell = artifacts.projectionArtifacts.get("pages/biomarkers/resting-heart-rate/overview.json");
    if (!shell || !("privateMetricBindings" in shell)) throw new Error("Expected RHR shell.");
    expect(shell.privateMetricBindings).toEqual([]);
    const explainerCards = biomarker.biomarker.explainerCards;
    biomarker.biomarker.explainerCards = undefined;
    artifacts = buildHealthCommonsWebGeneratedArtifacts(fixture);
    expect(artifacts.projectionArtifacts.has("shell/biomarkers/resting-heart-rate.json")).toBe(false);
    biomarker.biomarker.explainerCards = explainerCards;
    biomarker.hidden = true;
    artifacts = buildHealthCommonsWebGeneratedArtifacts(fixture);
    expect(artifacts.projectionArtifacts.has("shell/biomarkers/resting-heart-rate.json")).toBe(false);
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
