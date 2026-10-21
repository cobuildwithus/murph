import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  searchHealthCommonsKnowledgeIndex,
  type HealthCommonsKnowledgeSearchResult,
} from "../src/knowledge-index.ts";
import {
  loadGeneratedHealthCommonsWebGoalIndex,
} from "../src/runtime.ts";

const knowledgeIndexPath = fileURLToPath(
  new URL("../generated/knowledge.sqlite", import.meta.url),
);

function search(query: string, questionContext: string): HealthCommonsKnowledgeSearchResult {
  return searchHealthCommonsKnowledgeIndex({
    databasePath: knowledgeIndexPath,
    query: `${questionContext} about ${query}`,
  });
}

describe("Health Commons full-catalog knowledge retrieval", () => {
  it("keeps real goal titles from taking ownership of evidence-backed topics", () => {
    const result = search("improve my deep sleep", "What does the evidence say");

    expect(result.topic).toEqual({
      key: "biomarker:deep-sleep-minutes",
      title: "Deep Sleep",
    });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.entityKey !== "goal_template:improve-deep-sleep"))
      .toBe(true);
    expect(result.items.every((item) => item.sources.length > 0)).toBe(true);
  });

  it("keeps colliding goals in the dedicated compact goal index", () => {
    const listedGoal = loadGeneratedHealthCommonsWebGoalIndex().goals.find(
      (goal) => goal.key === "goal_template:improve-deep-sleep",
    );
    expect(listedGoal).toMatchObject({
      goalPhrase: "improve my deep sleep",
      key: "goal_template:improve-deep-sleep",
      routeId: "improve-deep-sleep",
      startPrompt: "Hey Murph, help me improve my deep sleep.",
      title: "Improve My Deep Sleep",
    });

  });

  it("does not substitute nearby topics for unsupported queries", () => {
    expect(search("magnesium sleep safety", "sleep safety")).toMatchObject({ items: [], safety: null, topic: null });
    expect(search("unsupported quux topic", "What does the evidence say")).toMatchObject({ items: [], safety: null, topic: null });
    expect(search("vitamin k", "health evidence")).toMatchObject({ items: [], safety: null });
    expect(search("vitamin b", "health evidence")).toMatchObject({ items: [], safety: null });
    expect(search("hepatitis b", "health evidence")).toMatchObject({ items: [], safety: null });
  });

  it("does not route vitamin C through a compound collagen alias", () => {
    expect(search("vitamin c", "health evidence")).toMatchObject({ items: [], safety: null });
  });

  it("normalizes combining-mark aliases without changing their topic", () => {
    const combiningMark = search("V̇O2max", "oxygen uptake");

    expect(combiningMark.items.length).toBeGreaterThan(0);
    expect(combiningMark.items.every((item) => item.entityKey === "biomarker:estimated-vo2max"))
      .toBe(true);
    expect(combiningMark.items.every((item) => item.sources.length > 0)).toBe(true);
  });

  it("does not compose a topic from unrelated sauna citations", () => {
    expect(search("pregnancy cold medicine", "pregnancy")).toMatchObject({ items: [], safety: null });
    expect(search("cold medicine pregnancy", "pregnancy")).toMatchObject({ items: [], safety: null });
  });

  it.each([
    ["REM Sleep", "consumer sleep trackers accuracy", /33378539|37917155/u],
    ["HRV / RMSSD", "consumer wearables agreement", /40834291/u],
  ])("routes measurement findings to %s", (topic, focus, expectedSource) => {
    const result = search(topic, focus);

    expect(result.items.some((item) =>
      item.kind === "source_finding"
      && item.sources.some((source) => expectedSource.test(source.pmid ?? ""))
      && /measurement/iu.test(item.caveat ?? "")
    )).toBe(true);
  });

  it("routes directly sourced SpO2 safety to its measurement owner", () => {
    const result = search("Blood Oxygen Saturation (SpO₂)", "sleep apnea clinical testing");

    expect(result.safety).toMatchObject({
      kind: "safety",
      sources: [expect.objectContaining({ pmid: "28162150" })],
    });
  });

  it("never returns an unsourced ordinary item or an overview row", async () => {
    for (const query of ["Mean Corpuscular Hemoglobin", "Magnesium RBC"]) {
      expect(search(query, "evidence").items.every((item) => item.sources.length > 0)).toBe(true);
    }
    expect(search("Mean Corpuscular Hemoglobin", "evidence").items).toEqual([]);
    expect(search("Magnesium RBC", "evidence").items).toEqual([]);
    expect(search("Mean Corpuscular Hemoglobin", "evidence").topic).not.toBeNull();

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(knowledgeIndexPath, { readOnly: true });
    try {
      expect(database.prepare("SELECT COUNT(*) AS count FROM chunks WHERE kind = 'overview'").get())
        .toMatchObject({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM chunks
        WHERE sources_json = '[]'
      `).get()).toMatchObject({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM chunks
        WHERE kind = 'appraisal'
           OR caveat = 'This source record preserves reducer classifications but does not replace source-level full-text extraction.'
           OR text LIKE '%candidate row(s)%'
           OR text LIKE '%shard(s)%'
           OR text LIKE '%landscape group%'
      `).get()).toMatchObject({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM chunks c
        WHERE c.id LIKE 'finding:%'
          AND NOT EXISTS (
            SELECT 1 FROM topic_owners t WHERE t.entity_key = c.entity_key
          )
      `).get()).toMatchObject({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM chunks
        WHERE id LIKE 'finding:source_artifact:pmid-33170239:%'
           OR id LIKE 'finding:source_artifact:pmid-28919842:%'
      `).get()).toMatchObject({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM topic_owners child_owner
        JOIN topic_owners parent_owner
          ON parent_owner.phrase = child_owner.phrase
         AND parent_owner.owner_key = child_owner.owner_key
         AND parent_owner.entity_key = parent_owner.owner_key
        WHERE child_owner.entity_key <> child_owner.owner_key
          AND child_owner.match_priority > 0
      `).get()).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });
});
