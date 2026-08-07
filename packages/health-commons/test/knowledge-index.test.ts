import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { HealthCommonsCatalog } from "@murphai/contracts";
import {
  searchHealthCommonsKnowledgeIndex,
  writeHealthCommonsKnowledgeIndex,
} from "../src/knowledge-index.ts";

const revision = { pageRevisionId: `sha256:${"1".repeat(64)}` };

function testCatalog(): HealthCommonsCatalog {
  return {
    schemaVersion: "murph.commons.catalog.v1",
    catalogHash: `sha256:${"2".repeat(64)}`,
    redirects: [],
    changes: [],
    artifactManifests: [],
    evidenceAppraisals: [{
      schemaVersion: "murph.commons.evidence-appraisal.v1",
      key: "evidence_appraisal:sauna-review",
      sourceKey: "source_artifact:pmid-29849692",
      targetKey: "experiment_family:dry-sauna",
      targetKind: "experiment_family",
      groupId: "sauna-evidence",
      stance: "mixed",
      scope: "general_guideline",
      result: "mixed",
      headline: "Dry-sauna evidence is physiologically plausible but mostly observational.",
      implication: "Use modest claims and keep long-term associations separate from causality.",
      caveat: "The review includes heterogeneous designs.",
    }],
    entities: [
      {
        schemaVersion: "murph.commons.page.v1",
        entityType: "source_artifact",
        key: "source_artifact:pmid-29849692",
        slug: "sources/dry-sauna/pmid-29849692",
        title: "Clinical effects of regular dry sauna bathing",
        summary: "A systematic review of regular dry-sauna research.",
        status: "reviewed",
        quality: "usable",
        categories: ["dry-sauna", "cardiovascular"],
        source: {
          kind: "review",
          title: "Clinical Effects of Regular Dry Sauna Bathing: A Systematic Review",
          year: 2018,
          pmid: "29849692",
          url: "https://pubmed.ncbi.nlm.nih.gov/29849692/",
        },
        researchEvidence: {
          designKind: "systematic_review",
          participantCount: 10,
          participantCountKind: "reported",
        },
        sourceFindings: [{
          findingId: "finding:sauna-fertility",
          findingKind: "safety",
          summary: "One small study found reversible disruption of spermatogenesis.",
          evidenceUse: ["safety"],
        }],
        body: "Dry sauna cardiovascular fertility evidence.",
        relativePath: "sources/dry-sauna/pmid-29849692.md",
        revision,
      },
      {
        schemaVersion: "murph.commons.page.v1",
        entityType: "experiment_family",
        key: "experiment_family:dry-sauna",
        slug: "families/dry-sauna",
        title: "Dry Sauna",
        summary: "Traditional high-temperature dry-sauna exposure.",
        status: "reviewed",
        quality: "usable",
        categories: ["dry-sauna", "cardiovascular", "recovery"],
        claims: [{
          claimId: "association-boundary",
          type: "association_not_causation",
          text: "Frequent sauna use is associated with lower cardiovascular mortality.",
          strength: "moderate",
          sourceKeys: ["source_artifact:pmid-29849692"],
          caveats: ["Observational associations do not prove causality."],
        }],
        safety: {
          cautionLevel: "moderate",
          avoidOrGetClinicianGuidance: ["Get guidance for unstable cardiovascular disease."],
          stopIf: ["Stop for chest pain, faintness, or severe shortness of breath."],
        },
        body: "Dry sauna heat cardiovascular recovery fertility.",
        relativePath: "families/dry-sauna.md",
        revision,
      },
    ],
  };
}

describe("Health Commons knowledge SQLite projection", () => {
  it("is deterministic and returns a bounded source-backed sauna packet", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "health-commons-knowledge-"));
    const firstPath = path.join(temporaryRoot, "first.sqlite");
    const secondPath = path.join(temporaryRoot, "second.sqlite");
    try {
      writeHealthCommonsKnowledgeIndex(firstPath, testCatalog());
      writeHealthCommonsKnowledgeIndex(secondPath, testCatalog());

      await expect(readFile(firstPath)).resolves.toEqual(await readFile(secondPath));
      const result = searchHealthCommonsKnowledgeIndex({
        databasePath: firstPath,
        limit: 2,
        query: "dry sauna",
      });

      expect(result.items).toHaveLength(2);
      expect(result.items).toContainEqual(expect.objectContaining({
        entityKey: "experiment_family:dry-sauna",
        sources: expect.arrayContaining([expect.objectContaining({
          pmid: "29849692",
          designKind: "systematic_review",
        })]),
      }));
      expect(result.safety).toMatchObject({
        entityKey: "experiment_family:dry-sauna",
        kind: "safety",
        strength: "moderate",
      });
      expect(searchHealthCommonsKnowledgeIndex({
        databasePath: firstPath,
        query: "sauna immunity",
      }).items).toEqual([]);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("rejects empty search terms before opening broad content", () => {
    expect(() => searchHealthCommonsKnowledgeIndex({
      databasePath: "unused.sqlite",
      query: " - ",
    })).toThrow("at least one searchable term");
  });
});
