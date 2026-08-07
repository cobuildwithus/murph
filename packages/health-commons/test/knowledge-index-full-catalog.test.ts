import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  searchHealthCommonsKnowledgeIndex,
  type HealthCommonsKnowledgeSearchResult,
} from "../src/knowledge-index.ts";

const knowledgeIndexPath = fileURLToPath(
  new URL("../generated/knowledge.sqlite", import.meta.url),
);

function search(query: string): HealthCommonsKnowledgeSearchResult {
  return searchHealthCommonsKnowledgeIndex({
    databasePath: knowledgeIndexPath,
    query,
  });
}

function packetText(result: HealthCommonsKnowledgeSearchResult): string {
  return [...result.items, ...(result.safety ? [result.safety] : [])]
    .flatMap((item) => [
      item.entityTitle,
      item.text,
      item.caveat ?? "",
      ...item.sources.map((source) => source.title),
    ])
    .join(" ");
}

describe("Health Commons full-catalog knowledge retrieval", () => {
  it("returns a safety-only hard stop for sauna and fentanyl patches", () => {
    const result = search("sauna fentanyl patch");

    expect(result.items).toEqual([]);
    expect(result.safety?.text).toMatch(/opioid|fentanyl|life-threatening/iu);
    expect(result.safety?.sources.some((source) =>
      source.pmid === "32740103" || /opioid patch|fentanyl patch/iu.test(source.title)
    )).toBe(true);
  });

  it("keeps caffeine pregnancy safety separate from unrelated safety", () => {
    const result = search("caffeine pregnancy");
    const text = packetText(result);

    expect(text).toMatch(/caffeine/iu);
    expect(text).toMatch(/pregnan/iu);
    expect(text).not.toMatch(/alcohol abstinence/iu);
  });

  it("returns the core dry-sauna systematic review", () => {
    const result = search("dry sauna");

    expect(result.items.some((item) =>
      item.sources.some((source) => source.pmid === "29849692")
    )).toBe(true);
  });

  it("does not substitute nearby topics for unsupported queries", () => {
    expect(search("magnesium sleep safety")).toMatchObject({ items: [], safety: null });
    expect(search("unsupported quux topic")).toMatchObject({ items: [], safety: null });
    expect(search("vitamin k")).toMatchObject({ items: [], safety: null });
    expect(search("vitamin b")).toMatchObject({ items: [], safety: null });
    expect(search("hepatitis b")).toMatchObject({ items: [], safety: null });
  });

  it.each([
    ["vitamin c", /vitamin c/iu],
    ["vitamin d", /vitamin d/iu],
    ["type 2 diabetes", /type 2 diabet/iu],
    ["omega 3", /omega[- ]3/iu],
  ])("preserves the qualifier in %s", (query, expectedTopic) => {
    const result = search(query);

    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(`${result.query} ${packetText({ ...result, items: [item], safety: null })}`)
        .toMatch(expectedTopic);
    }
    if (result.safety) {
      expect(`${result.query} ${packetText({ ...result, items: [], safety: result.safety })}`)
        .toMatch(expectedTopic);
    }
  });

  it("does not compose a topic from unrelated sauna citations", () => {
    expect(search("pregnancy cold medicine")).toMatchObject({ items: [], safety: null });
    expect(search("cold medicine pregnancy")).toMatchObject({ items: [], safety: null });
  });

  it("keeps water-fasting evidence and safety on the fasting topic", () => {
    const direct = search("water fasting");
    const naturalQuestionTerms = search("water fasting health");

    expect(packetText(direct)).toMatch(/water fast|prolonged fast/iu);
    expect(direct.safety?.entityTitle).toMatch(/fast/iu);
    expect(packetText(naturalQuestionTerms)).not.toMatch(/cold.water|submersion/iu);
    expect(naturalQuestionTerms.safety).toBeNull();
  });
});
