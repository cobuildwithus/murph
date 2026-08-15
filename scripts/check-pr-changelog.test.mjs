import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isChangelogContentPath,
  readChangelogItemsById,
  validatePrChangelog,
} from "./check-pr-changelog.mjs";

const CHANGELOG_ENTRY_PATH =
  "apps/web/changelog/entries/2026-08-09/public-referral-home.json";
const LEGACY_CHANGELOG_PATH = "apps/web/src/lib/changelog.ts";
const COMPLETION_WORKFLOW = readFileSync(
  new URL("../agent-docs/operations/completion-workflow.md", import.meta.url),
  "utf8",
);

function section(...items) {
  return `
<h2>Changelog</h2>
<ul>
${items.map((item) => `<li>${item}</li>`).join("\n")}
</ul>
`;
}

function documentedChangelogExamples() {
  return [...COMPLETION_WORKFLOW.matchAll(
    /```markdown\n([\s\S]*?)\n\s*```/gu,
  )]
    .map((match) => match[1])
    .filter((example) => example.trimStart().startsWith("## Changelog"));
}

function renderDocumentedChangelogExample(markdown) {
  const [heading, ...bodyLines] = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assert.equal(heading, "## Changelog");
  const items = bodyLines.map((line) => {
    assert.match(line, /^- /u);
    return line.slice(2);
  });
  return section(...items);
}

test("completion workflow examples satisfy the changelog validator", () => {
  const examples = documentedChangelogExamples();
  assert.equal(examples.length, 2);
  const updatedExample = examples.find((example) =>
    example.includes("- Changelog: updated")
  );
  const notApplicableExample = examples.find((example) =>
    example.includes("- Changelog: not applicable")
  );
  assert.ok(updatedExample);
  assert.ok(notApplicableExample);

  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [
        "apps/web/changelog/entries/2026-08-09/stable-item-id.json",
      ],
      changelogItemsById: new Map([["stable-item-id", "2026-08-09"]]),
      prBodyHtml: renderDocumentedChangelogExample(updatedExample),
    }),
    [],
  );
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: ["scripts/check-pr-changelog.test.mjs"],
      prBodyHtml: renderDocumentedChangelogExample(notApplicableExample),
    }),
    [],
  );
});

test("accepts an updated declaration with a stable item reference", () => {
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [CHANGELOG_ENTRY_PATH, "apps/web/app/changelog/page.tsx"],
      prBodyHtml: section(
        "Changelog: updated",
        "Items: 2026-08-09 · public-referral-home",
      ),
    }),
    [],
  );
});

test("accepts an edition-metadata-only update for an existing item", () => {
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [
        "apps/web/changelog/editions/2026-08-09.json",
      ],
      prBodyHtml: section(
        "Changelog: updated",
        "Items: 2026-08-09 · public-referral-home",
      ),
    }),
    [],
  );
});

test("accepts an intentional historical correction with an existing item", () => {
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [LEGACY_CHANGELOG_PATH],
      prBodyHtml: section(
        "Changelog: updated",
        "Items: 2026-08-09 · public-referral-home",
      ),
    }),
    [],
  );
});

test("accepts a concrete not-applicable reason", () => {
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: ["scripts/check-pr-changelog.test.mjs"],
      prBodyHtml: section(
        "Changelog: not applicable",
        "Reason: Test-only guard coverage; no member-visible behavior changed.",
      ),
    }),
    [],
  );
});

test("requires the changelog section", () => {
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [],
      prBodyHtml: "<h2>Summary</h2><p>Small change.</p>",
    }),
    ["Add a `## Changelog` section to the pull request body."],
  );
});

test("requires one recognized disposition", () => {
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [],
      prBodyHtml: section("Reason: Nothing visible changed."),
    }),
    ["Add exactly one `Changelog:` bullet with `updated` or `not applicable`."],
  );
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [],
      prBodyHtml: section("Changelog: maybe later"),
    }),
    ["Set `Changelog:` to exactly `updated` or `not applicable`."],
  );
});

test("rejects duplicate sections and disposition bullets", () => {
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [],
      prBodyHtml: `${section("Changelog: updated")}${section("Changelog: not applicable")}`,
    }),
    [
      "Keep exactly one `## Changelog` section in the pull request body.",
      "A `Changelog: updated` declaration must change changelog entries, edition metadata, or the legacy registry.",
      "Add exactly one `Items:` bullet naming the edition date and stable changelog item ID.",
    ],
  );
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [],
      prBodyHtml: section(
        "Changelog: updated",
        "Changelog: not applicable",
      ),
    }),
    ["Add exactly one `Changelog:` bullet with `updated` or `not applicable`."],
  );
});

test("requires an updated declaration to change the registry and name items", () => {
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: ["apps/web/app/changelog/page.tsx"],
      prBodyHtml: section("Changelog: updated", "Items: TBD"),
    }),
    [
      "A `Changelog: updated` declaration must change changelog entries, edition metadata, or the legacy registry.",
      "Complete `Items:` with semicolon-separated edition date and stable item ID references, for example `2026-08-09 · stable-item-id`.",
    ],
  );
});

test("validates every declared item against the authoritative registry", () => {
  const changelogItemsById = readChangelogItemsById();
  const validateItems = (items) =>
    validatePrChangelog({
      changedPaths: [CHANGELOG_ENTRY_PATH],
      changelogItemsById,
      prBodyHtml: section("Changelog: updated", `Items: ${items}`),
    });

  assert.deepEqual(
    validateItems(
      "2026-08-09 · public-referral-home; 2026-08-08 · custom-experiment-deep-links",
    ),
    [],
  );
  assert.deepEqual(
    validateItems("2026-08-09 · made-up-item"),
    [
      "`Items:` references the unknown changelog item `2026-08-09 · made-up-item`.",
    ],
  );
  assert.deepEqual(
    validateItems("2026-08-08 · public-referral-home"),
    [
      "Changelog item `public-referral-home` belongs to edition `2026-08-09`, not `2026-08-08`.",
    ],
  );
  assert.deepEqual(
    validateItems(
      "2026-08-09 · public-referral-home; 2099-12-31 · made-up-item",
    ),
    [
      "`Items:` references the unknown changelog item `2099-12-31 · made-up-item`.",
    ],
  );
  assert.deepEqual(
    validateItems("2026-08-09 · public-referral-home; malformed-extra-entry"),
    [
      "Complete `Items:` with semicolon-separated edition date and stable item ID references, for example `2026-08-09 · stable-item-id`.",
    ],
  );
});

test("rejects placeholder not-applicable reasons and registry mismatches", () => {
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [CHANGELOG_ENTRY_PATH],
      prBodyHtml: section("Changelog: not applicable", "Reason: N/A"),
    }),
    [
      "A PR that changes changelog entries, edition metadata, or the legacy registry cannot declare `Changelog: not applicable`.",
      "Complete `Reason:` with a concrete explanation of why the changelog is not applicable.",
    ],
  );
});

test("rejects not-applicable declarations for historical corrections", () => {
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [LEGACY_CHANGELOG_PATH],
      prBodyHtml: section(
        "Changelog: not applicable",
        "Reason: This adjusts archived public changelog copy only.",
      ),
    }),
    [
      "A PR that changes changelog entries, edition metadata, or the legacy registry cannot declare `Changelog: not applicable`.",
    ],
  );
});

test("rejects disposition-specific leftover template bullets", () => {
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [CHANGELOG_ENTRY_PATH],
      prBodyHtml: section(
        "Changelog: updated",
        "Items: 2026-08-09 · public-referral-home",
        "Reason: No member-visible behavior changed.",
      ),
    }),
    ["Remove the `Reason:` bullet when `Changelog: updated` is selected."],
  );
  assert.deepEqual(
    validatePrChangelog({
      changedPaths: [],
      prBodyHtml: section(
        "Changelog: not applicable",
        "Items: 2026-08-09 · public-referral-home",
        "Reason: Test-only coverage; no member-visible behavior changed.",
      ),
    }),
    [
      "Remove the `Items:` bullet when `Changelog: not applicable` is selected.",
    ],
  );
});

test("recognizes current and exceptional legacy changelog ownership paths", () => {
  assert.equal(isChangelogContentPath(CHANGELOG_ENTRY_PATH), true);
  assert.equal(
    isChangelogContentPath("apps/web/changelog/editions/2026-08-09.json"),
    true,
  );
  assert.equal(isChangelogContentPath(LEGACY_CHANGELOG_PATH), true);
  assert.equal(isChangelogContentPath("apps/web/src/lib/changelog-card.ts"), false);
  assert.equal(isChangelogContentPath("apps/web/test/changelog.test.ts"), false);
});
