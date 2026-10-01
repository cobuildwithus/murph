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
        relations: [{
          type: "parent_family",
          target: "experiment_family:dry-sauna",
        }],
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
        aliases: ["shared heat"],
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
        }, {
          claimId: "cardiovascular-safety",
          type: "safety",
          text: "Get guidance for unstable cardiovascular disease and stop for faintness.",
          strength: "moderate",
          sourceKeys: ["source_artifact:pmid-29849692"],
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
        query: "Does dry sauna improve cardiovascular health?",
      });

      expect(result.topic).toEqual({
        key: "experiment_family:dry-sauna",
        title: "Dry Sauna",
      });
      expect(result.items).toHaveLength(1);
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
        query: "Does dry sauna improve immunity?",
      }).items).toEqual([]);
      expect(searchHealthCommonsKnowledgeIndex({
        databasePath: firstPath,
        query: "Is dry sauna safe for spermatogenesis?",
      }).safety).toMatchObject({
        caveat: "Evidence use: safety.",
        kind: "safety",
        sources: [expect.objectContaining({ pmid: "29849692" })],
      });
      const broad = searchHealthCommonsKnowledgeIndex({
        databasePath: firstPath,
        query: "What does the evidence say about dry sauna?",
      });
      expect(broad.topic).not.toBeNull();
      expect(broad.items).toEqual([
        expect.objectContaining({ kind: "claim", entityKey: "experiment_family:dry-sauna" }),
      ]);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("rejects empty search terms before opening broad content", () => {
    expect(() => searchHealthCommonsKnowledgeIndex({
      databasePath: "unused.sqlite",
      query: " - ",
    })).toThrow("at least one searchable term");
    expect(() => searchHealthCommonsKnowledgeIndex({
      databasePath: "unused.sqlite",
      query: "x".repeat(501),
    })).toThrow("at most 500 characters");
  });

  it("rejects an index with an unsupported schema version", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "health-commons-schema-"));
    const databasePath = path.join(temporaryRoot, "knowledge.sqlite");
    try {
      writeHealthCommonsKnowledgeIndex(databasePath, testCatalog());
      const { DatabaseSync } = await import("node:sqlite");
      const database = new DatabaseSync(databasePath);
      try {
        database.exec("PRAGMA user_version = 3");
      } finally {
        database.close();
      }

      expect(() => searchHealthCommonsKnowledgeIndex({
        databasePath,
        query: "What does the evidence say about dry sauna?",
      })).toThrow("Unsupported Health Commons knowledge index version 3");
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("uses question terms without admitting a nearby topic", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "health-commons-focus-"));
    const databasePath = path.join(temporaryRoot, "knowledge.sqlite");
    try {
      writeHealthCommonsKnowledgeIndex(databasePath, testCatalog());
      expect(searchHealthCommonsKnowledgeIndex({
        databasePath,
        query: "Does dry sauna improve an absent unrelated outcome?",
      })).toMatchObject({ items: [], topic: { key: "experiment_family:dry-sauna" } });
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("returns nothing when one exact alias has two direct owners", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "health-commons-ambiguous-"));
    const databasePath = path.join(temporaryRoot, "knowledge.sqlite");
    const catalog = testCatalog();
    const drySauna = catalog.entities.find((entity) =>
      entity.key === "experiment_family:dry-sauna"
    );
    if (!drySauna) {
      throw new Error("Expected the dry-sauna test entity.");
    }
    catalog.entities.push({
      ...drySauna,
      aliases: ["shared heat"],
      key: "experiment_family:ambiguous-heat",
      slug: "families/ambiguous-heat",
      title: "Ambiguous Heat",
    });

    try {
      writeHealthCommonsKnowledgeIndex(databasePath, catalog);
      expect(searchHealthCommonsKnowledgeIndex({
        databasePath,
        query: "What are the benefits of shared heat?",
      }))
        .toMatchObject({
          candidates: expect.arrayContaining([
            { key: "experiment_family:ambiguous-heat", title: "Ambiguous Heat" },
            { key: "experiment_family:dry-sauna", title: "Dry Sauna" },
          ]),
          items: [],
          safety: null,
          topic: null,
        });
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("keeps goal templates out of evidence topic ownership and knowledge chunks", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "health-commons-goal-collision-"));
    const databasePath = path.join(temporaryRoot, "knowledge.sqlite");
    const catalog = testCatalog();
    const drySauna = catalog.entities.find((entity) =>
      entity.key === "experiment_family:dry-sauna"
    );
    if (!drySauna) {
      throw new Error("Expected the dry-sauna test entity.");
    }
    drySauna.aliases = [...(drySauna.aliases ?? []), "improve my deep sleep"];
    catalog.entities.push({
      schemaVersion: "murph.commons.page.v1",
      entityType: "goal_template",
      key: "goal_template:improve-deep-sleep",
      slug: "improve-deep-sleep",
      title: "Improve My Deep Sleep",
      summary: "A goal guide whose title overlaps an evidence-backed topic alias.",
      status: "field-testing",
      quality: "usable",
      goal: {
        category: "sleep",
        outcomeKind: "biomarker",
        goalPhrase: "improve my deep sleep",
        successSignals: [{
          id: "deep-sleep-trend",
          kind: "biomarker",
          label: "Improve a same-device deep-sleep trend",
        }],
        evidenceSourceKeys: ["source_artifact:pmid-29849692"],
        workflow: {
          kind: "habit_plan",
          ownerSkillIds: ["sleep-improvement"],
        },
        startPrompt: "Hey Murph, help me improve my deep sleep.",
        indexable: true,
      },
      claims: [{
        claimId: "goal-prose-must-not-be-indexed",
        type: "association_not_causation",
        text: "This goal-only prose must not become a Health Commons knowledge chunk.",
        strength: "moderate",
        sourceKeys: ["source_artifact:pmid-29849692"],
      }],
      safety: { cautionLevel: "moderate" },
      body: "Goal guide prose belongs to the dedicated Goal list and show surfaces.",
      relativePath: "goals/sleep/improve-deep-sleep.md",
      revision,
    });

    try {
      writeHealthCommonsKnowledgeIndex(databasePath, catalog);

      const result = searchHealthCommonsKnowledgeIndex({
        databasePath,
        query: "What does the evidence say about improve my deep sleep?",
      });
      expect(result.topic).toEqual({
        key: "experiment_family:dry-sauna",
        title: "Dry Sauna",
      });
      expect(result.items).toEqual([
        expect.objectContaining({ entityKey: "experiment_family:dry-sauna" }),
      ]);

      const { DatabaseSync } = await import("node:sqlite");
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        expect(database.prepare(
          "SELECT count(*) AS count FROM topic_owners WHERE owner_key = ? OR entity_key = ?",
        ).get("goal_template:improve-deep-sleep", "goal_template:improve-deep-sleep")?.count).toBe(0);
        expect(database.prepare(
          "SELECT count(*) AS count FROM chunks WHERE entity_key = ?",
        ).get("goal_template:improve-deep-sleep")?.count).toBe(0);
      } finally {
        database.close();
      }
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});
