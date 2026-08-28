---
description: Executable-proof lens for the unified local completion specialist
action: preliminary specialist proof review
---

Use this review-only lens inside the one preliminary local specialist subagent
when either:

- tests, fixtures, or direct-proof infrastructure are a primary PR outcome; or
- the changed behavior makes a material proof claim that ordinary focused
  owner tests cannot establish at a stable boundary.

Do not activate this lens merely because executable behavior, tests, fixtures,
configuration, or proof scaffolding changed. The final ReviewGPT gate, when it
applies, owns ordinary correctness and test adequacy.

Outcome:
Determine whether the candidate implementation has truthful executable proof at
the highest stable boundary. Report only missing proof that could conceal a
broken changed outcome or hard invariant.

Success criteria:

- Existing tests, fixtures, and direct scenario proof are inspected before a
  gap is reported.
- Every finding names a material changed behavior or owner-boundary invariant
  that currently lacks stable executable proof.
- The smallest useful test boundary is identified without widening production
  behavior or creating speculative scaffolding.
- Existing sufficient proof is a valid zero-finding result.

Mode:

- Review the complete candidate patch and its existing proof; do not mutate the
  checkout, create artifacts, create commits, push, or claim that suggested
  changes landed.
- Follow `agent-docs/prompts/completion-specialist-review.md` for the unified
  specialist evidence, finding, output, and stop contract.

Review priorities:

- Prefer proof at the highest stable behavior boundary available.
- For a feature composed across owners, first map the complete production path
  from accepted input through every material transformation, retry, accounting,
  authorization, and external-effect boundary. Prefer one stable composed or
  end-to-end test of the feature invariant; seam-level unit tests complement
  that proof but do not substitute for it.
- Prefer focused assertions over broad fixture churn or snapshot-heavy tests.
- Reuse existing helpers, fixtures, and test patterns before proposing new
  scaffolding.
- Inspect success, failure, ordering, retry, authority, and boundary cases only
  when they are material to the changed outcome or hard invariant.
- Treat coverage output as a locator, not the objective. A percentage or
  uncovered line is not a finding.
- Require production-faithful direct scenario evidence when mocks cannot prove
  the changed model, provider, rendered, concurrency, persistence, device, or
  equivalent runtime boundary.

Finding constraints:

- Report only `high` or `medium` findings. Omit low-severity branch-completeness
  and test-polish suggestions.
- Do not duplicate ordinary correctness or test-adequacy findings owned by the
  final ReviewGPT gate.
- Do not request duplicate proof at a lower boundary.
- Do not propose production refactors, cleanup, API changes, new abstractions,
  or generalized test frameworks to make proof easier to write.
- Do not weaken assertions, skip tests, replace semantic assertions with broad
  snapshots, or add placeholders.
- If proof is blocked by a production bug or an out-of-scope owner, report the
  exact blocker without proposing a correction that crosses the boundary.

Output:

- Return findings through the unified specialist subagent response, ordered by
  severity.
- For each finding name the missing behavior proof, current evidence, stable
  test boundary, smallest correction, and exact verification command.
- State explicitly when current proof is sufficient.

Stop rule:
Stop when every material proof claim in scope has an evidence-backed
disposition. Zero findings is valid; do not churn tests to make the review look
productive.
