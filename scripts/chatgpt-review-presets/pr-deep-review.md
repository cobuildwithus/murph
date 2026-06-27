Review the linked pull request for high-impact production risk and complexity collapse opportunities.

Primary goal:
Find only issues that are worth changing before merge because they are likely to cause a serious production bug, data loss or corruption, security or privacy exposure, broken user-visible behavior, or because they let us delete or collapse meaningful complexity while preserving required behavior.

Architecture priority:
Default to deletion and radical simplicity. Before accepting any new code, abstraction, dependency, service, configuration, state, or process, challenge whether it solves a real current problem. Prefer the smallest architecture with the fewest moving parts, concepts, branches, and hidden behaviors. Report complexity only when the PR introduces or preserves structure that can be removed now without losing required behavior.

Treat the PR's stated intent as the requirement, not its current runtime state. Code that the diff temporarily disables, gates, fail-closes, scrubs, or stubs while wiring is in progress is not evidence the functionality should be deleted — propose deletion only when the same intended behavior can be preserved with materially less code. If the disabled state itself blocks the PR's stated goal, report that as a Critical/High correctness finding, not as a complexity collapse.

Use the attached review artifacts to read the repository context. The required
artifacts are the guarded source snapshot ZIP (`repo.snapshot.zip`) plus the
repomix attachment (`repo.repomix.zip`, or the configured repomix artifact name)
generated for the pushed PR head.

- the full PR diff
- touched files
- enough surrounding callers, invariants, state owners, and tests to judge the change in context
- the baseline invariants doc at `docs/contracts/00-invariants.md` (and any topic-specific contract files it links, e.g. `docs/contracts/06-hosted-workspace-file-count.md`) — read this before reporting so invariant checks are grounded in the current rules, not memory

The PR URL and PR description identify the target and intent, but they are not
repo-content sources. Do not use app connectors for this preset. Treat missing,
unreadable, or stale ZIP/repomix attachments as a hard stop: do not review from
pasted context, memory, files attached out of band, a connected repository, or
the PR description alone.

Do not review the diff in isolation.

This run relies on the repo's review:gpt `app_connector="github"` config. Treat missing GitHub connector context as a hard stop: if the connected repository, PR diff, or touched files are unavailable, say so and stop; do not review from pasted context, memory, files attached out of band, or the PR description alone.

Report only:

- Critical/high bugs: incorrect logic, broken invariants, data loss or corruption, auth/privacy/security exposure, race/retry/idempotency failures, deploy/runtime breakage, or user-visible behavior that is likely to fail in a reachable production path or anything else you deem a major issue.
- High-impact edge cases: unusual but realistic states that would cause serious breakage, not incomplete polish or theoretical coverage gaps
- Complexity collapse opportunities: places where the same required behavior can be achieved with materially less code, fewer concepts, fewer branches, clearer ownership, or reuse of an existing primitive
- Fix-loop pattern as design signal: read the PR's commit history, not just the current diff. A long run of `fix:` commits clustering on a single protocol/symbol/state — each one handling a "but what if" the previous didn't anticipate — is itself a Complexity Collapse finding. The abstraction is the problem, not the implementation. Recommend the smaller primitive that the proven failure actually requires. Typical (not exhaustive) verb clusters that indicate reactive defense: preserve, scope, fence, reclaim, own, stale, gate, guard, recover.
- Invariant violations: places where the PR diff breaks, weakens, or quietly drifts from a rule in `docs/contracts/00-invariants.md` or a contract file it links. Cite the specific invariant (section heading + the exact rule) and the diff site that violates it. Surface an invariant violation even when no Critical/High bug is yet reachable — the rule itself is the contract. If the violation is also a reachable production bug, report it once under Critical/high bugs and note which invariant it breaks rather than duplicating it here.

Do not report:

- medium or low severity issues unless they are direct evidence of a larger high-impact bug or removable architecture
- style, naming, formatting, small cleanup, preference, or "could be more robust" comments
- speculative edge cases without a concrete reachable path and meaningful impact
- fixes that add more complexity than the issue justifies
- requests to handle every possible edge case

For each finding:

- cite the concrete files and symbols involved
- state the severity: Critical, High, Complexity Collapse, or Invariant Violation
- explain the exact reachable failure mode or removable complexity
- explain why it matters before merge
- give the production-faithful scenario or end-to-end path the local agent should use to reproduce or validate it
- propose the smallest safe fix, or for simplification, the smallest deletion/collapse that preserves required behavior

Stop rules:

- If you find no Critical, High, Complexity Collapse, or Invariant Violation findings, say that clearly and stop.
- Do not invent medium findings to prove the review was thorough.
- Prefer a short zero-finding review over a long list of marginal concerns.

Constraints:

- ground every finding in the actual PR diff and surrounding code, not generic best practices
- if you cannot read the PR diff or the touched files from the required ZIP/repomix attachments, say so explicitly and stop; do not review from memory, a connector, pasted context, or the PR description alone
- if you see a ChatGPT rate-limit message, do not assume the review failed immediately; a rate-limit dialog can be overlaid on top of an otherwise active chat, so inspect whether the underlying thread still has accessible PR context or a completed response before reporting context failure
- rank findings by importance: critical/high production bugs first, then complexity collapse opportunities
- do not report style, naming, or formatting nits unless they hide a real high-impact problem

Final response contract:

- return one concise plain-text review
- start the final message with a single `Checked:` line naming the review target, using the PR number from the prompt or PR URL when available and the checked commit hash when it is available from the prompt or attachments; examples: `Checked: PR #123 @ abc1234`, `Checked: PR #123`, or `Checked: commit abc1234`
- if you find nothing worth changing after a thorough pass, say so explicitly in a short summary rather than inventing low-value findings
- do all repository reading and analysis silently, then reply with exactly ONE message containing your complete ranked findings; never send a preliminary status or acknowledgment message first, because the response capture treats your first settled message as the final review
- end your final message with the exact line REVIEW_COMPLETE on its own line; the response capture tooling waits for that marker, and do not write that token anywhere else in any message
