Run a targeted bug-finding pass for Murph.

Focus on the highest-value seams in the current codebase where a real bug would have outsized product, data-integrity, privacy, or operational impact.

Prioritize:

- canonical write paths, mutation batching, and state transitions that can corrupt or misattribute source-of-truth data
- trust boundaries between CLI, web, hosted execution, local daemons, device-sync ingress, and external/provider input
- replay, idempotency, dedupe, scheduling, queue, or retry logic that can duplicate, drop, reorder, or wedge work
- auth, session, origin, redirect, token, or capability checks that may be missing, too broad, or inconsistently enforced
- persistence seams where vault state, `.runtime` operational state, projections, caches, or hosted mirrors can drift out of sync
- package or module seams where ownership is blurry enough that invariants are enforced in one path but skipped in another
- error handling or fallback branches that can silently hide corruption, partial failure, or stale state

Favor concrete bugs, edge cases, and invariant violations over style, cleanup, or speculative refactors.

For each issue you choose to act on:

- cite the concrete files, symbols, and seam involved
- explain the exact bug or failure mode
- describe the smallest safe fix that closes the hole
- add or tighten focused proof when the bug is not already covered by tests

Constraints:

- ground the pass in the code that exists today, not generic best practices
- focus on high-severity or high-likelihood bugs before lower-value cleanup
- prefer behavior-preserving bug fixes over broad architectural rewrites unless the seam is already unsound without one
- do not spend the patch budget on naming, formatting, or docs-only cleanup unless it directly supports a bug fix

Final response contract:

- Return one downloadable `.patch` attachment containing a single unified diff for every change you chose to make in this pass.
- Any returned patch must include at least one non-Markdown repo file change under code, tests, scripts, or config. Do not satisfy this task with a docs-only patch to `agent-docs/**`, `docs/**`, `README.md`, or other `*.md` files.
- Also return a short plain-text summary that says what you changed, what bugs or failure modes those changes address, and any important residual risk you left untouched.
- Keep the summary concise and factual; do not return a long prose review or any alternate structured findings template.
- If you find no safe actionable bug fix in a high-value seam, return a short plain-text summary saying so and attach no patch.
