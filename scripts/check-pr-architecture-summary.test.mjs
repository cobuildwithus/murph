import assert from "node:assert/strict";
import test from "node:test";

import {
  validatePrArchitectureSummary,
} from "./check-pr-architecture-summary.mjs";

const COMPLETE_SECTION = `
<h2>Architecture and reuse</h2>
<ul>
<li>Existing systems reused: The existing managed automation scheduler owns the lifecycle.</li>
<li>New logic: The check-in selects one explicit model and reasoning level.</li>
<li>New abstractions: No new abstraction; the seed uses its existing target override.</li>
<li>Complexity intentionally avoided: No new scheduler, queue, or persisted state.</li>
</ul>
`;

test("accepts four concrete architecture and reuse bullets", () => {
  assert.deepEqual(validatePrArchitectureSummary(COMPLETE_SECTION), []);
});

test("requires the architecture and reuse section", () => {
  assert.deepEqual(
    validatePrArchitectureSummary("<h2>Summary</h2><p>Small change.</p>"),
    ["Add a `## Architecture and reuse` section to the pull request body."],
  );
});

test("requires every labeled bullet inside the section", () => {
  assert.deepEqual(
    validatePrArchitectureSummary(`
<h2>Architecture and reuse</h2>
<ul>
<li>Existing systems reused: Existing test infrastructure.</li>
</ul>
<h2>Notes</h2>
<ul>
<li>New logic: This must not be borrowed from another section.</li>
</ul>
`),
    [
      "Add the `New logic:` bullet.",
      "Add the `New abstractions:` bullet.",
      "Add the `Complexity intentionally avoided:` bullet.",
    ],
  );
});

test("rejects empty placeholders but permits an explained absence", () => {
  const result = validatePrArchitectureSummary(`
<h2>Architecture and reuse</h2>
<ul>
<li>Existing systems reused:</li>
<li>New logic: TBD</li>
<li>New abstractions: None.</li>
<li>Complexity intentionally avoided: No new service because the existing owner is sufficient.</li>
</ul>
`);

  assert.deepEqual(result, [
    "Complete the `Existing systems reused:` bullet with a concrete sentence; when the answer is none, explain why.",
    "Complete the `New logic:` bullet with a concrete sentence; when the answer is none, explain why.",
    "Complete the `New abstractions:` bullet with a concrete sentence; when the answer is none, explain why.",
  ]);
  assert.deepEqual(
    validatePrArchitectureSummary(
      COMPLETE_SECTION.replace(
        "No new abstraction; the seed uses its existing target override.",
        "None; the change stays inside the existing seed contract.",
      ),
    ),
    [],
  );
});

test("rejects bare placeholders with punctuation-only suffixes", () => {
  for (const placeholder of ["None;", "None —", "N/A:", "TBD…", "Todo;"]) {
    const result = validatePrArchitectureSummary(
      COMPLETE_SECTION.replace(
        "No new abstraction; the seed uses its existing target override.",
        placeholder,
      ),
    );

    assert.deepEqual(result, [
      "Complete the `New abstractions:` bullet with a concrete sentence; when the answer is none, explain why.",
    ]);
  }
});
