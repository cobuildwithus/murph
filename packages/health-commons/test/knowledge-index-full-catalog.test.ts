import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  searchHealthCommonsKnowledgeIndex,
  type HealthCommonsKnowledgeSearchResult,
} from "../src/knowledge-index.ts";

const knowledgeIndexPath = fileURLToPath(
  new URL("../generated/knowledge.sqlite", import.meta.url),
);

function search(query: string, focus: string): HealthCommonsKnowledgeSearchResult {
  return searchHealthCommonsKnowledgeIndex({
    databasePath: knowledgeIndexPath,
    focus,
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
    const result = search("Finnish Dry Sauna", "fentanyl patch");

    expect(result.items).toEqual([]);
    expect(result.safety?.text).toMatch(/opioid|fentanyl|life-threatening/iu);
    expect(result.safety?.sources.some((source) =>
      source.pmid === "32740103" || /opioid patch|fentanyl patch/iu.test(source.title)
    )).toBe(true);
  });

  it("keeps caffeine pregnancy safety separate from unrelated safety", () => {
    const result = search("Caffeine Curfew", "pregnancy");
    const text = packetText(result);

    expect(text).toMatch(/caffeine/iu);
    expect(text).toMatch(/pregnan/iu);
    expect(text).not.toMatch(/alcohol abstinence/iu);
  });

  it("returns the core dry-sauna systematic review", () => {
    const result = search("Finnish Dry Sauna", "overall evidence");

    expect(result.items.some((item) =>
      item.sources.some((source) => source.pmid === "29849692")
    )).toBe(true);
  });

  it("does not substitute nearby topics for unsupported queries", () => {
    expect(search("magnesium sleep safety", "sleep safety")).toMatchObject({ items: [], safety: null, topicResolved: false });
    expect(search("unsupported quux topic", "overall evidence")).toMatchObject({ items: [], safety: null, topicResolved: false });
    expect(search("vitamin k", "health evidence")).toMatchObject({ items: [], safety: null });
    expect(search("vitamin b", "health evidence")).toMatchObject({ items: [], safety: null });
    expect(search("hepatitis b", "health evidence")).toMatchObject({ items: [], safety: null });
  });

  it.each([
    ["Daily Vitamin D3 Supplementation", "vitamin d", /vitamin d/iu],
    ["Walking After Every Meal", "type 2 diabetes", /type 2 diabet/iu],
    ["Omega-3 Supplementation", "omega 3", /omega[- ]3|epa|dha/iu],
  ])("preserves the qualifier for %s", (query, focus, expectedTopic) => {
    const result = search(query, focus);

    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(packetText({ ...result, items: [item], safety: null })).toMatch(expectedTopic);
      expect(item.sources.length).toBeGreaterThan(0);
    }
    if (result.safety) {
      expect(`${result.focus ?? ""} ${packetText({ ...result, items: [], safety: result.safety })}`)
        .toMatch(expectedTopic);
    }
  });

  it("does not route vitamin C through a compound collagen alias", () => {
    expect(search("vitamin c", "health evidence")).toMatchObject({ items: [], safety: null });
  });

  it.each([
    ["UC-II", "joint pain", "protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides"],
    ["native type-II collagen", "joint pain", "protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides"],
    ["gelatin plus vitamin C", "joint pain", "protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides"],
    ["bone broth", "allergy", "protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides"],
    ["cold shower", "immunity", "protocol_variant:cold-water-immersion/cold-plunge"],
    ["winter swimming", "mood", "protocol_variant:cold-water-immersion/cold-plunge"],
  ])("does not substitute a child protocol for the family alias %s", (query, focus, excludedKey) => {
    const result = search(query, focus);

    expect([...result.items, ...(result.safety ? [result.safety] : [])]
      .every((item) => item.entityKey !== excludedKey)).toBe(true);
  });

  it("keeps broad canonical family retrieval and direct child retrieval", () => {
    for (const [query, focus] of [
      ["Dry Sauna", "health benefits"],
      ["Collagen Supplementation", "joint pain"],
      ["Cold Water Immersion", "mood"],
    ] as const) {
      expect(search(query, focus).items.length).toBeGreaterThan(0);
    }
    for (const [query, focus] of [
      ["Finnish Dry Sauna", "systematic review"],
      ["Caffeine Curfew", "sleep"],
      ["Cold Plunge", "cold shock"],
    ] as const) {
      expect(search(query, focus).items.length).toBeGreaterThan(0);
    }
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

  it("keeps water-fasting evidence and safety on the fasting topic", () => {
    const direct = search("Prolonged Fasting", "water fast");
    const naturalQuestionTerms = search("water fasting", "health");

    expect(packetText(direct)).toMatch(/water fast|prolonged fast/iu);
    expect(direct.items.every((item) => item.sources.length > 0)).toBe(true);
    expect(packetText(naturalQuestionTerms)).not.toMatch(/cold.water|submersion/iu);
    if (naturalQuestionTerms.safety) {
      expect(naturalQuestionTerms.safety.entityKey).toMatch(/fast/iu);
    }
  });

  it.each([
    ["recent fainting", /faint/iu],
    ["unstable cardiovascular disease", /cardiovascular|unstable/iu],
    ["fever", /fever/iu],
    ["trying to conceive", /trying to conceive|pregnan/iu],
  ])("returns the focused dry-sauna safety boundary for %s", (focus, expected) => {
    const result = search("Finnish Dry Sauna", focus);

    expect(packetText({ ...result, items: [], safety: result.safety })).toMatch(expected);
  });

  it("returns dry-sauna immunity evidence from the resolved owner", () => {
    const result = search("Finnish Dry Sauna", "immunity");

    expect(result.items.length).toBeGreaterThan(0);
    expect(packetText(result)).toMatch(/immun/iu);
  });

  it.each([
    ["Finnish Dry Sauna", /sauna|heat/iu],
    ["Caffeine Curfew", /caffeine|sleep/iu],
    ["Creatine Monohydrate", /creatine/iu],
    ["Omega-3 Supplementation", /omega|epa|dha/iu],
    ["Collagen Supplementation", /collagen/iu],
  ])("returns member-readable broad evidence for %s", (query, expected) => {
    const result = search(query, "overall evidence");
    const text = packetText(result);

    expect(result.topicResolved).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(text).toMatch(expected);
    expect(result.items.every((item) => item.kind === "claim" || item.kind === "source_finding"))
      .toBe(true);
    expect(text).not.toMatch(/landscape group|candidate row|shard\(s\)|preserving the source-specific extraction caveats/iu);
  });

  it("routes typed source findings to their related protocol", () => {
    const result = search("Daily Vitamin D3 Supplementation", "pregnancy response");

    expect(result.items.some((item) =>
      item.kind === "source_finding"
      && item.sources.some((source) => source.pmid === "21706518" || source.pmid === "27788053")
      && /adjacent_variant/iu.test(item.caveat ?? "")
    )).toBe(true);
  });

  it("omits ambiguous multi-target source findings instead of broadcasting them", () => {
    for (const [topic, focus, excludedPmid] of [
      ["Omega-3 Supplementation", "fractures infections", "33170239"],
      ["No Added Sugar Diet", "protein intake", "28919842"],
    ] as const) {
      expect(search(topic, focus).items.some((item) =>
        item.kind === "source_finding"
        && item.sources.some((source) => source.pmid === excludedPmid)
      )).toBe(false);
    }
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

  it("resolves canonical family and protocol title collisions to the family owner", () => {
    for (const [title, focus] of [
      ["Consistent Wake Time", "sleep"],
      ["Daily Step Floor", "daily steps"],
      ["High Protein Intake", "protein intake"],
      ["Hyperbaric Oxygen Therapy", "oxygen treatment"],
      ["Norwegian 4x4", "vo2max"],
    ] as const) {
      expect(search(title, focus).items.length).toBeGreaterThan(0);
    }
    expect(search("Hyperbaric Oxygen Therapy", "untreated pneumothorax").safety?.text)
      .toMatch(/untreated pneumothorax|absolute contraindication/iu);
  });

  it("does not attach page-wide efficacy citations to aggregate safety text", () => {
    expect(search("Norwegian 4x4", "fainting").safety).toBeNull();
    const coldPlunge = search("Cold Plunge", "seizure").safety;
    if (coldPlunge) {
      expect(coldPlunge.sources.length).toBeGreaterThan(0);
      expect(coldPlunge.text).not.toMatch(/\b[a-z]+(?:_[a-z]+)+\b/u);
    }
  });

  it("never returns an unsourced ordinary item or an overview row", async () => {
    for (const query of ["Finnish Dry Sauna", "Mean Corpuscular Hemoglobin", "Magnesium RBC"]) {
      expect(search(query, "evidence").items.every((item) => item.sources.length > 0)).toBe(true);
    }
    expect(search("Mean Corpuscular Hemoglobin", "evidence").items).toEqual([]);
    expect(search("Magnesium RBC", "evidence").items).toEqual([]);
    expect(search("Mean Corpuscular Hemoglobin", "evidence").topicResolved).toBe(true);

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
      for (const title of [
        "consistent wake time",
        "daily step floor",
        "high protein intake",
        "hyperbaric oxygen therapy",
        "norwegian 4x4",
      ]) {
        expect(database.prepare(`
          SELECT COUNT(DISTINCT owner_key) AS count
          FROM topic_owners
          WHERE phrase = ? AND match_priority = (
            SELECT MIN(match_priority) FROM topic_owners WHERE phrase = ?
          )
        `).get(title, title)).toMatchObject({ count: 1 });
      }
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

  it("does not return reducer bookkeeping as IT band guidance", () => {
    const result = search("IT Band Rehab", "red flags");
    const text = packetText(result);

    expect(text).not.toMatch(/candidate row|shard\(s\)|reducer classifications/iu);
    if (result.safety) {
      expect(result.safety.text).toMatch(/pain|stop|medical|clinician|diagnos|urgent|red flag/iu);
    }
  });
});
