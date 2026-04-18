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
- do not spend time on naming, formatting, or docs-only cleanup unless it directly supports a bug fix

Final response contract:

- Return a concise plain-text review with the highest-value bug findings from this pass.
- For each finding, cite the concrete files, symbols, and seam involved, explain the exact failure mode, and recommend the smallest safe fix plus any needed proof.
- Prefer findings that would land as non-Markdown repo changes under code, tests, scripts, or config. Do not spend the pass on docs-only recommendations unless they clearly support a concrete bug fix.
- Keep the response concise and factual; do not return a long prose review, a patch, or a diff.
- If you find no safe actionable bug fix in a high-value seam, return a short plain-text summary saying so.
