import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  APPLICABLE_FIELDS,
  validatePrDeploymentConcerns,
} from "./check-pr-deployment-concerns.mjs";

const COMPLETION_WORKFLOW = readFileSync(
  new URL("../agent-docs/operations/completion-workflow.md", import.meta.url),
  "utf8",
);

function section(...items) {
  return `
<h2>Deployment concerns</h2>
<ul>
${items.map((item) => `<li>${item}</li>`).join("\n")}
</ul>
`;
}

function applicableItems() {
  return [
    "Deployment: applicable",
    "Supported skew: The old and new readers accept both deployed record shapes.",
    "Safe order: Deploy the backward-compatible reader before the new writer.",
    "Rollback floor: Rollback remains safe until the new writer publishes state.",
    "Expected exposure: At most one rollout window can observe mixed versions.",
    "Reversibility: Disable the writer before reverting the compatible reader.",
    "Convergence proof: The smoke check confirms every instance reports the new version.",
    "Post-deploy checks: Verify the new version and inspect bounded error aggregates.",
  ];
}

function documentedDeploymentExamples() {
  return [...COMPLETION_WORKFLOW.matchAll(
    /```markdown\n([\s\S]*?)\n\s*```/gu,
  )]
    .map((match) => match[1])
    .filter((example) =>
      example.trimStart().startsWith("## Deployment concerns")
    );
}

function renderDocumentedDeploymentExample(markdown) {
  const [heading, ...bodyLines] = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assert.equal(heading, "## Deployment concerns");
  const items = bodyLines.map((line) => {
    assert.match(line, /^- /u);
    return line.slice(2);
  });
  return section(...items);
}

test("completion workflow examples satisfy the deployment validator", () => {
  const examples = documentedDeploymentExamples();
  assert.equal(examples.length, 2);
  for (const example of examples) {
    assert.deepEqual(
      validatePrDeploymentConcerns({
        prBodyHtml: renderDocumentedDeploymentExample(example),
      }),
      [],
    );
  }
});

test("accepts a complete applicable deployment contract", () => {
  assert.deepEqual(
    validatePrDeploymentConcerns({
      prBodyHtml: section(...applicableItems()),
    }),
    [],
  );
});

test("accepts a concrete not-applicable reason", () => {
  assert.deepEqual(
    validatePrDeploymentConcerns({
      prBodyHtml: section(
        "Deployment: not applicable",
        "Reason: Test-only PR body validation does not change a deploy boundary.",
      ),
    }),
    [],
  );
});

test("requires exactly one deployment section", () => {
  assert.deepEqual(
    validatePrDeploymentConcerns({
      prBodyHtml: "<h2>Summary</h2><p>Small change.</p>",
    }),
    ["Add a `## Deployment concerns` section to the pull request body."],
  );
  assert.deepEqual(
    validatePrDeploymentConcerns({
      prBodyHtml: `${section(...applicableItems())}${section(
        "Deployment: not applicable",
        "Reason: This duplicate section must not be accepted by the guard.",
      )}`,
    })[0],
    "Keep exactly one `## Deployment concerns` section in the pull request body.",
  );
});

test("requires one recognized deployment disposition", () => {
  assert.deepEqual(
    validatePrDeploymentConcerns({ prBodyHtml: section("Reason: No deploy.") }),
    [
      "Add exactly one `Deployment:` bullet with `applicable` or `not applicable`.",
    ],
  );
  assert.deepEqual(
    validatePrDeploymentConcerns({
      prBodyHtml: section("Deployment: maybe later"),
    }),
    ["Set `Deployment:` to exactly `applicable` or `not applicable`."],
  );
});

test("requires every applicable deployment field to be concrete", () => {
  const result = validatePrDeploymentConcerns({
    prBodyHtml: section(
      "Deployment: applicable",
      ...APPLICABLE_FIELDS.slice(0, -1).map((field) => `${field}: TBD`),
      "Reason: This belongs only on the not-applicable disposition.",
    ),
  });

  assert.equal(result.length, APPLICABLE_FIELDS.length + 1);
  assert.ok(result.includes("Add exactly one `Post-deploy checks:` bullet."));
  assert.ok(
    result.includes(
      "Complete `Safe order:` with concrete deployment details.",
    ),
  );
  assert.ok(
    result.includes(
      "Remove the `Reason:` bullet when `Deployment: applicable` is selected.",
    ),
  );
});

test("not-applicable rejects applicable fields and placeholder reasons", () => {
  assert.deepEqual(
    validatePrDeploymentConcerns({
      prBodyHtml: section(
        "Deployment: not applicable",
        "Safe order: Deploy the reader before the writer.",
        "Reason: N/A",
      ),
    }),
    [
      "Remove the `Safe order:` bullet when `Deployment: not applicable` is selected.",
      "Complete `Reason:` with a concrete explanation of why deployment concerns do not apply.",
    ],
  );
});
