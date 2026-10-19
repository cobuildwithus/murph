import { beforeAll, describe, expect, it } from "vitest";
import type { HealthCommonsCatalog } from "@murphai/contracts";
import { loadGeneratedHealthCommonsWebRouteBundle } from "../src/runtime.ts";
import { buildHealthCommonsWebGeneratedArtifacts } from "../src/web-artifacts.ts";

let catalog: HealthCommonsCatalog;
beforeAll(() => {
  const bundle = loadGeneratedHealthCommonsWebRouteBundle({ entityType: "biomarker", routeId: "resting-heart-rate" });
  if (!bundle) throw new Error("Expected the resting heart rate route bundle.");
  const biomarker = bundle.entitiesByKey["biomarker:resting-heart-rate"];
  if (!biomarker) throw new Error("Expected RHR content.");
  catalog = {
    schemaVersion: "murph.commons.catalog.v1",
    catalogHash: bundle.catalogHash,
    entities: Object.values(bundle.entitiesByKey),
    redirects: [], changes: [], artifactManifests: [], evidenceAppraisals: [],
  };
});

describe("generated Web projection publication", () => {
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
});
