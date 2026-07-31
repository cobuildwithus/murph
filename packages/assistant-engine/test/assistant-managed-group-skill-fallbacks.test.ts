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
        "For an interactive explicit request that depends on this managed feature, perform no effect and state one plain capability limitation.",
      );
      expect(normalized).toContain(PUBLIC_FALLBACK_MARKER);
      expect(normalized).toContain(
        "For an unattended or scheduled occurrence, perform no effect and return the resident delivery skip outcome without user-facing text; do not mutate the preserved automation.",
      );
      expect(normalized).toContain(
        "Silence otherwise remains available only when the resident conversational-floor rules independently make the beat human-owned or unaddressed.",
      );
      expect(raw).not.toContain("cobuildwithus/");
      expect(raw).not.toContain("trusted hosted build");
      expect(raw).not.toContain("materializ");
      expect(raw.length).toBeLessThan(2_000);
    }
  });

  it("keeps the exact managed group fallback set registered at stable slugs", () => {
    expect([...MANAGED_GROUP_SKILL_SLUGS].sort()).toEqual([
      "group-challenge",
      "group-challenge-scorecards",
      "group-chat",
      "group-newsletter",
      "groupchat-comedy",
    ]);

    const registeredSlugs = new Set(
      ASSISTANT_SKILLS.map((skill) => skill.slug),
    );
    for (const slug of MANAGED_GROUP_SKILL_SLUGS) {
      expect(registeredSlugs.has(slug), slug).toBe(true);
    }
  });

  it("keeps public routing metadata for the private-owned challenge skills", () => {
    const challenge = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === "group-challenge",
    );
    const scorecards = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === "group-challenge-scorecards",
    );
    const comedy = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === "groupchat-comedy",
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
    expect(comedy?.triggerHint).toContain(
      "protected-register handling inside the group",
    );
    expect(comedy?.triggerHint).not.toContain("private care");
  });

  it("fails closed when the managed challenge policy is absent", async () => {
    const raw = await readFile(
      path.join(resolveAssistantSkillsRoot(), "group-challenge", "SKILL.md"),
      "utf8",
    );
    const normalized = raw.replace(/\s+/gu, " ");

    expect(normalized).toContain(
      "Do not create, score, settle, or announce a challenge in this build.",
    );
    expect(normalized).toContain(
      "perform no effect and state one plain capability limitation",
    );
    expect(normalized).toContain(
      "return the resident delivery skip outcome without user-facing text",
    );
    expect(normalized).toContain("do not mutate the preserved automation");
    expect(normalized).not.toContain(
      "unless the public runtime contracts and current evidence support it",
    );
  });
});
