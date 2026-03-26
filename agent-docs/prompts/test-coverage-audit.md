---
description: Post-simplify test-coverage audit that adds the highest-impact missing tests
action: targeted test audit + implementation
---

You are performing a post-simplify test-coverage pass for completed changes.

Goal:
Find meaningful coverage gaps introduced by the change set, then implement the highest-impact tests to close those gaps.

Preflight (required):
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before review/edits.
- Honor any explicit exclusive/refactor notes from the ledger; otherwise work carefully on top of active rows without reverting adjacent edits.

Audit for:
- missing coverage on modified behavior and directly affected call paths
- edge cases and failure-mode handling gaps
- invariant gaps around trust boundaries, validation, state consistency, and user-visible behavior
- brittle assertions that miss important guarantees
- proof gaps where all verification stays inside helpers, mocks, or snapshots and never exercises the highest stable behavior boundary available

Execution requirements:
- Use full diff/context and inspect both modified production files and nearby tests.
- Prioritize impact: implement the smallest test set that materially reduces regression risk.
- Prefer at least one assertion path through the highest stable public boundary available for the change; use helper-level tests to complement that boundary, not replace it.
- Do not change production behavior in this pass unless explicitly instructed.
- If the repo still has no real test harness for the touched code, report that gap explicitly instead of inventing fake tests.
- If meaningful proof still requires a manual or higher-level scenario outside the harness, call that out explicitly instead of pretending the automated suite is sufficient.
- After implementing tests, run the narrowest relevant verification command first (or `pnpm test` when scope is broad), then report outcomes.

Output requirements:
- Summarize implemented tests and why each is high impact.
- Include exact verification commands run and pass/fail outcomes.
- List remaining recommended tests (if any) ordered by priority (`high`, `medium`, `low`).
- List any remaining direct-scenario verification gaps if automated coverage cannot prove the changed behavior end to end.
- Include `Open questions / assumptions` only when required.


Parallel-agent output:
- Please return your final response as a set of copy/paste-ready prompts for parallel agents rather than as a normal prose review.
- Create one prompt per distinct issue or tightly related issue cluster.
- In each prompt, describe the issue in detail, explain why it matters, point to the relevant files, symbols, or tests, and include your best guess at a concrete fix.
- Make each prompt self-contained and specific enough that we can hand it directly to an agent with minimal extra context.
- If you find no actionable issues, say so explicitly instead of inventing prompts.
