import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveAssistantSkillsRoot } from "../src/assistant-skill-assets.js";

const MANAGED_GROUP_SKILL_SLUGS = [
  "group-chat",
  "group-challenge",
  "group-challenge-scorecards",
  "group-newsletter",
  "groupchat-comedy",
] as const;

const PUBLIC_FALLBACK_MARKER =
  "This public fallback intentionally contains no managed";

describe("managed hosted group skill boundary", () => {
  it("keeps only bounded fail-closed fallbacks in public Murph", async () => {
    for (const slug of MANAGED_GROUP_SKILL_SLUGS) {
      const raw = await readFile(
        path.join(resolveAssistantSkillsRoot(), slug, "SKILL.md"),
        "utf8",
      );
      const normalized = raw.replace(/\s+/gu, " ");

      expect(raw).toContain(`name: ${slug}`);
      expect(normalized).toContain(
        "private `cobuildwithus/murph-cloud` repository",
      );
      expect(normalized).toContain(PUBLIC_FALLBACK_MARKER);
      expect(raw.length).toBeLessThan(2_000);
    }
  });

  it("uses exactly the intended managed group skill set", () => {
    expect([...MANAGED_GROUP_SKILL_SLUGS].sort()).toEqual([
      "group-challenge",
      "group-challenge-scorecards",
      "group-chat",
      "group-newsletter",
      "groupchat-comedy",
    ]);
  });
});
