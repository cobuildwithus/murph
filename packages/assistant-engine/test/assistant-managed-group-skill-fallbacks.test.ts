import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from "../src/assistant-skill-assets.js";

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

  it("keeps public routing metadata for the private-owned challenge skills", () => {
    const challenge = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === "group-challenge",
    );
    const scorecards = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === "group-challenge-scorecards",
    );

    expect(challenge?.triggerHint).toContain(
      "social-first formation grounded in the current room",
    );
    expect(challenge?.triggerHint).toContain(
      "A vague challenge request is not exercise programming.",
    );
    expect(challenge?.triggerHint).toContain("group-challenge-scorecards");
    expect(scorecards?.triggerHint).toContain("teams");
    expect(scorecards?.triggerHint).toContain("shared or participant target");
    expect(scorecards?.triggerHint).toContain("multiple metrics");
    expect(scorecards?.triggerHint).toContain("weighted additive points");
    expect(scorecards?.triggerHint).toContain("up-to-five-component");
    expect(scorecards?.triggerHint).toContain(
      "group-challenge still owns formation, buy-in, consent, durable state, scheduling, diagnostics, and close-out",
    );
  });
});
