import assert from "node:assert/strict";
import test from "node:test";

import {
  validatePrArchitectureSummary,
} from "./check-pr-architecture-summary.mjs";

const COMPLETE_SECTION = `
<h2>Architecture and reuse</h2>
<ul>
<li>Existing systems reused: The existing pull-request evidence workflow owns validation.</li>
<li>New logic: The validator requires four concrete disclosure fields.</li>
<li>New abstractions: None; the shared rendered-Markdown parser remains sufficient.</li>
<li>Complexity intentionally avoided: No second workflow or Markdown parser was added.</li>
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

test("rejects placeholders but permits an explained absence", () => {
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
  assert.deepEqual(validatePrArchitectureSummary(COMPLETE_SECTION), []);
});
