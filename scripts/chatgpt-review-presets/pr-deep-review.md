Please review the pull request linked below for any bugs or edge cases. Run a deep review of it; be incredibly thorough.

Our utmost priority for this codebase is clean, simple, long-term maintainable and composable architecture with minimal complexity; judge every architectural finding against that bar.

Use the connected GitHub repository to read the full PR diff, the files it touches, and enough of the surrounding code to judge each change in context. Do not review the diff in isolation when a finding depends on callers, invariants, or state owned elsewhere.

Look for:

- real bugs: incorrect logic, broken invariants, unhandled failure modes, race conditions, replay/idempotency holes, data loss or corruption
- edge cases the change mishandles: empty/missing data, concurrency, retries, partial failure, boundary values, unusual but reachable states
- architectural problems introduced or worsened by the PR: unnecessary abstractions, blurred ownership seams, duplicated patterns, speculative generality, hidden behaviors
- simplifications: places where the same behavior is achievable with less code, fewer concepts, fewer branches, or by reusing an existing seam

For each finding:

- cite the concrete files and symbols involved
- explain the exact bug, edge case, or architectural problem and why it matters
- for bugs and edge cases, propose the smallest safe fix that closes the hole; for simplifications, the proposed change must not add more complexity than it removes

Constraints:

- ground every finding in the actual PR diff and surrounding code, not generic best practices
- if you cannot read the PR diff or the touched files via the connected repository, say so explicitly and stop; do not review from memory or from the PR description alone
- rank findings by importance: real bugs and data-integrity issues first, then complexity-reducing simplifications
- do not report style, naming, or formatting nits unless they hide a real problem

Final response contract:

- return a concise plain-text review with findings ranked as above; no patches or diffs
- if you find nothing worth changing after a thorough pass, say so explicitly in a short summary rather than inventing low-value findings
