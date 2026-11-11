import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from "../src/assistant-skill-assets.js";

// Skills whose real text ships from the private hosted bundle. Public Murph
// carries only a short fail-closed fallback for each, marked with this sentence.
// The hosted bundle build searches for the same sentence, so it must not change here.
const MANAGED_SKILL_SLUGS = [
  "group-challenge",
  "group-challenge-scorecards",
  "group-chat",
  "group-newsletter",
  "groupchat-comedy",
  "music-generation",
] as const;

const PUBLIC_FALLBACK_MARKER =
  "This public fallback intentionally contains no managed";

async function readPublicSkill(slug: string): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, "SKILL.md"),
    "utf8",
  );
}

describe("managed hosted skill boundary", () => {
  it("marks exactly the managed skills as public fallbacks", async () => {
    const marked: string[] = [];
    for (const skill of ASSISTANT_SKILLS) {
      const normalized = (await readPublicSkill(skill.slug)).replace(/\s+/gu, " ");
      if (normalized.includes(PUBLIC_FALLBACK_MARKER)) marked.push(skill.slug);
    }

    expect(marked.sort()).toEqual([...MANAGED_SKILL_SLUGS]);
  });

  it("keeps each public fallback short and named for its slug", async () => {
    for (const slug of MANAGED_SKILL_SLUGS) {
      const raw = await readPublicSkill(slug);

      expect(raw).toContain(`name: ${slug}`);
      expect(raw.length).toBeLessThan(2_000);
    }
  });

  it("keeps public routing metadata for the private-owned challenge skills", () => {
    const challenge = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === "group-challenge",
    );

    expect(challenge?.triggerHint).toContain("group-challenge-scorecards");
  });
});
