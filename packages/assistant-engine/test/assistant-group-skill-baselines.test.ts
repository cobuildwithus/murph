import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
} from "@murphai/hosted-execution/vault-share";

import {
  resolveAssistantSkillsRoot,
} from "../src/assistant-skill-assets.js";

const BASELINE_MARKER = "murph-public-group-skill-baseline:v1";
const GROUP_SKILL_SLUGS = [
  "group-challenge",
  "group-challenge-scorecards",
  "group-chat",
  "group-newsletter",
  "groupchat-comedy",
] as const;

async function readSkill(slug: (typeof GROUP_SKILL_SLUGS)[number]) {
  return await readFile(
    path.join(resolveAssistantSkillsRoot(), slug, "SKILL.md"),
    "utf8",
  );
}

describe("public group skill contract baselines", () => {
  it("keeps the exact five hosted group paths as explicit public baselines", async () => {
    for (const slug of GROUP_SKILL_SLUGS) {
      const raw = await readSkill(slug);
      expect(raw).toContain(BASELINE_MARKER);
      expect(raw).toMatch(new RegExp(`^name: ${slug}$`, "mu"));
      expect(raw).toContain("Murph Cloud");
    }
  });

  it("keeps group identity, consent, and shared-data authority public", async () => {
    const raw = await readSkill("group-chat");

    expect(raw).toContain("presentation hints only");
    expect(raw).toContain("exact current group-scoped `participantId`");
    expect(raw).toContain("exact visible accepted-message `message_ref`");
    expect(raw).toContain('murph.group action="read_current"');
    expect(raw).toContain('murph.group action="read_shared"');
    expect(raw).toContain("grants nothing");
    expect(raw).toContain("its cause is unverified");
    expect(raw).toContain('provisional: say "so far"');
    expect(raw).toContain("may revoke only their own eligible share");
    expect(raw).toContain("Do not remove another member");
  });

  it("keeps every selectable challenge projection and selector shape public", async () => {
    const raw = await readSkill("group-challenge");

    for (const projectionKind of HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS) {
      expect(raw).toContain(`\`${projectionKind}\``);
    }
    expect(raw).toContain(`"projectionKind": "${HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND}"`);
    expect(raw).toContain('"selector": { "activityKind": "running" }');
    expect(raw).toContain("Missing, omitted, partial, pending, and provisional data are unscored");
    expect(raw).toContain("exact group-scoped `participantId`");
  });

  it("keeps challenge diagnostic ordering and settlement safety public", async () => {
    const raw = await readSkill("group-challenge");

    expect(raw).toContain("Read the scoring scope first");
    expect(raw).toContain("before any later diagnostic read");
    expect(raw).toContain("a second read may request only `device-sync-status.v0`");
    expect(raw).toContain("one evidence-bound `offer_access`");
    expect(raw).toContain("grants nothing until the member accepts");
    expect(raw).toContain("A settled date present with an empty workout list is an observed zero");
    expect(raw).toContain("A date absent from a projection is unobserved");
    expect(raw).toContain("persist the final result before announcing it");
  });

  it("keeps arithmetic, comedy safety, and newsletter delivery boundaries public", async () => {
    const [scorecards, comedy, newsletter] = await Promise.all([
      readSkill("group-challenge-scorecards"),
      readSkill("groupchat-comedy"),
      readSkill("group-newsletter"),
    ]);

    expect(scorecards).toContain("at most five components");
    expect(scorecards).toContain("Missing, omitted, partial, pending, and provisional data are unscored");
    expect(scorecards).toContain("exact group-scoped `participantId`");
    expect(scorecards).toContain("Persist the component results");
    expect(scorecards).toContain("Never settle");
    expect(comedy).toContain("Protected material");
    expect(comedy).toContain("Concrete-risk boundary");
    expect(comedy).toContain("This skill cannot reopen a human-owned turn");
    expect(comedy).toContain("Do not infer hidden motives");
    expect(newsletter).toContain('action="prepare"');
    expect(newsletter).toContain('action="send" once');
    expect(newsletter).toContain('{"kind":"skip","privateSummary":"..."}');
    expect(newsletter).toContain("do not retry `send` in the same turn");
    expect(newsletter).toContain("Never mention who lacks email");
    expect(newsletter).toContain("currently eligible recipients");
  });
});
