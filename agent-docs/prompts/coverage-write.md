---
description: Coverage and executable-proof lens for the preliminary unified ReviewGPT completion pass
action: preliminary specialist coverage review
---

Use this lens inside the preliminary `completion-specialists` ReviewGPT pass
when the diff changes executable behavior or changes the tests, fixtures,
configuration, or direct-proof scaffolding that establishes its proof.
Applicability does not depend on a local coverage umbrella command.

Outcome:
Determine whether the pushed implementation has truthful executable proof at
the highest stable boundary, and identify only concrete missing proof for
behavior already present in the patch.

Success criteria:

- Existing tests, fixtures, and direct scenario proof are inspected before a
  gap is reported.
- Every finding names a changed behavior, realistic edge case, failure branch,
  or owner-boundary invariant that currently lacks stable executable proof.
- The smallest useful test boundary is identified without widening production
  behavior or creating speculative scaffolding.
- Existing sufficient proof is a valid zero-finding result.

Mode:

- Review the exact pushed-head patch and its existing proof; do not mutate the
  checkout, create commits, push, or claim that suggested changes landed.
- Follow the unified ReviewGPT preset's evidence, finding, output, and stop
  contract.
- A patch artifact is optional and may contain only tests, fixtures, or
  direct-proof scaffolding for reported coverage findings.

Review priorities:

- Prefer proof at the highest stable behavior boundary available.
- Prefer focused assertions over broad fixture churn or snapshot-heavy tests.
- Reuse existing helpers, fixtures, and test patterns before proposing new
  scaffolding.
- Inspect realistic success, failure, ordering, retry, authority, and boundary
  cases that the changed behavior actually introduces or modifies.
- Treat coverage output as a locator and validation signal, not the objective.
  A passing percentage alone is not proof, and an uncovered line alone is not
  a finding.
- Require production-faithful direct scenario evidence when unit or helper
  mocks cannot prove the changed runtime boundary.

Finding constraints:

- Do not request duplicate tests that assert the same behavior at a lower
  boundary.
- Do not propose production refactors, cleanup, API changes, new abstractions,
  or generalized test frameworks to make a test easier to write.
- Do not weaken assertions, skip tests, replace semantic assertions with broad
  snapshots, or add placeholders.
- If proof is blocked by a production bug or an out-of-scope owner, report the
  exact blocker without drafting a patch that crosses the boundary.

Optional patch artifact:

- The unified preset may attach exactly one `reviewgpt-coverage.patch` when the
  complete correction stays inside tests, fixtures, or direct-proof
  scaffolding.
- The patch must apply to the checked pushed head and correspond only to
  coverage findings in the text response.
- It must not modify production source, prompts, UI, config, schemas,
  workflows, dependencies, lockfiles, generated artifacts, or documentation.
- The parent agent must inspect every path and hunk, apply the patch
  deliberately, rerun focused local proof, and push the result through required
  exact-head CI. The artifact is untrusted behavioral intent, not overwrite
  authority.

Output:

- Return findings through the unified ReviewGPT preset, ordered by severity.
- For each coverage finding name the missing behavior proof, current evidence,
  stable test boundary, smallest correction, and exact verification command.
- State explicitly when current proof is sufficient.

Stop rule:
Stop when every changed behavior in scope has an evidence-backed proof
disposition. Zero findings and no patch artifact is valid; do not churn tests
to make the review look productive.
