import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  healthCommonsCatalogSchema,
  type HealthCommonsCatalog,
} from "@murphai/contracts";
import healthCommonsCatalogJson from "@murphai/health-commons/generated/catalog.json";

import {
  createHealthCommonsCatalogReader,
} from "@/src/lib/health-commons/catalog";
import {
  listHealthCommonsExperimentRouteParams,
  listHealthCommonsExperimentProtocols,
  resolveHealthCommonsExperimentProtocol,
} from "@/src/lib/health-commons/experiment-detail";

const SUPPLEMENT_PROTOCOL_FIXTURES = [
  {
    key: "protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides",
    routeId: "hydrolyzed-collagen-peptides",
  },
  {
    key: "protocol_variant:creatine-supplementation/creatine-monohydrate",
    routeId: "creatine-monohydrate",
  },
  {
    key: "protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation",
    routeId: "oral-epa-dha-supplementation",
  },
  {
    key: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol",
    routeId: "psyllium-husk-for-cholesterol",
  },
  {
    key: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol",
    routeId: "red-yeast-rice-for-cholesterol",
  },
  {
    key: "protocol_variant:vitamin-d-supplementation/daily-vitamin-d3-supplementation",
    routeId: "daily-vitamin-d3-supplementation",
  },
] as const;

describe("Health Commons experiment protocol metadata", () => {
  it("keeps public experiment resolution on generated route bundles, not the monolithic catalog import", () => {
    const source = readFileSync(
      new URL("../src/lib/health-commons/experiment-detail.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("generated/catalog.json");
    expect(source).not.toContain("./catalog");

    const routeParams = listHealthCommonsExperimentRouteParams();
    expect(routeParams).toContainEqual({ experimentId: "finnish-sauna" });

    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");
    expect(protocol?.commons?.routeId).toBe("finnish-sauna");
    expect(protocol?.studies.length).toBeGreaterThan(0);
  });

  it("uses the generated browse index directly for the public experiment library list", () => {
    const source = readFileSync(
      new URL("../src/lib/health-commons/experiment-detail.ts", import.meta.url),
      "utf8",
    );
    const listStart = source.indexOf("export function listHealthCommonsExperimentProtocols(");
    const resolveStart = source.indexOf("export function resolveHealthCommonsExperimentProtocol(");
    const listBlock = source.slice(listStart, resolveStart);

    expect(listBlock).toContain("getGeneratedHealthCommonsWebExperimentIndex()");
    expect(listBlock).not.toContain("loadGeneratedHealthCommonsWebRouteBundle");

    const protocols = listHealthCommonsExperimentProtocols();
    const protocolIds = protocols.map((protocol) => protocol.id);

    expect(protocolIds).toContain("finnish-sauna");
    expect(protocolIds).toContain("bryan-johnson-blueprint");
    expect(protocolIds).not.toContain("creatine-monohydrate");
    expect(protocolIds).not.toContain("daily-vitamin-d3-supplementation");
  });

  it("uses the simplified protocol title", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();
    expect(protocol?.title).toBe("Bryan Johnson Sauna");
  });

  it("uses the dedicated Bryan Johnson sauna artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-bryan-johnson-sauna.jpg");
  });

  it("uses the dedicated Finnish sauna artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-finnish-sauna.jpeg");
  });

  it("uses the dedicated Norwegian 4x4 artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("norwegian-4x4");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-norwegian-4x4.jpeg");
  });

  it("uses the dedicated red-light glasses artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("red-light-glasses-before-bed");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-red-light-glasses-before-bed.jpeg");
  });

  it("uses the dedicated caffeine curfew artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("caffeine-curfew-dose-reset");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-caffeine-curfew.jpeg");
  });

  it("omits protocols hidden by Health Commons frontmatter from the public experiments library", () => {
    const catalog = createFixtureCatalog();

    for (const supplementProtocol of SUPPLEMENT_PROTOCOL_FIXTURES) {
      const protocolIndex = catalog.entities.findIndex(
        (entity) => entity.key === supplementProtocol.key,
      );
      const protocol = catalog.entities[protocolIndex];

      expect(protocol?.entityType).toBe("protocol_variant");
      if (!protocol || protocol.entityType !== "protocol_variant") {
        return;
      }

      catalog.entities[protocolIndex] = {
        ...protocol,
        hidden: true,
      };
    }

    const protocols = listHealthCommonsExperimentProtocols(
      createHealthCommonsCatalogReader(catalog),
    );
    const protocolIds = protocols.map((entry) => entry.id);

    for (const supplementProtocol of SUPPLEMENT_PROTOCOL_FIXTURES) {
      expect(protocolIds).not.toContain(supplementProtocol.routeId);
    }
    expect(protocolIds).toContain("bryan-johnson-blueprint");
    expect(
      resolveHealthCommonsExperimentProtocol(
        "hydrolyzed-collagen-peptides",
        createHealthCommonsCatalogReader(catalog),
      ),
    ).toBeNull();
  });

  it("does not resolve hidden generated protocols by direct route id", () => {
    expect(resolveHealthCommonsExperimentProtocol("hydrolyzed-collagen-peptides")).toBeNull();
  });

  it("prefers page-owned cold plunge artwork when the protocol declares media", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("cold-plunge");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/cold-plunge-tub.jpeg");
  });

  it("uses cold plunge signal descriptions from the protocol page", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("cold-plunge");

    expect(protocol).not.toBeNull();
    expect(
      protocol?.expectedSignals.find((signal) => signal.label === "Self-Reported Mood")?.description,
    ).toBe(
      "Use the same 0–10 or 1–5 scale before the session and again 30–180 minutes after. Acute mood is the most defensible first-run target, but it remains short-horizon and source-limited. Source basis: source_artifact:doi-10.1002-lim2.53, source_artifact:doi-10.1002-lim2.70044, source_artifact:doi-10.1002-lim2.70048, source_artifact:pmid-37866096.",
    );
    expect(
      protocol?.expectedSignals.find((signal) => signal.label === "HRV / RMSSD")?.description,
    ).toBe(
      "Track HRV as recovery/autonomic context only; acute cold and post-exercise CWI can shift autonomic signals, but HRV is not a direct wellness benefit verdict. Source basis: source_artifact:pmid-39918163, source_artifact:pmid-25437181.",
    );
    expect(
      protocol?.expectedSignals.find((signal) => signal.label === "Resting Heart Rate")?.description,
    ).toBe(
      "Track resting heart rate for recovery strain and context. Direct repeated-CWI cardiovascular findings are small and unclear, so avoid calling a change a benefit without the full context. Source basis: source_artifact:pmid-37711459, source_artifact:pmid-8891513.",
    );
  });

});

function createFixtureCatalog(): HealthCommonsCatalog {
  return structuredClone(healthCommonsCatalogSchema.parse(healthCommonsCatalogJson));
}
