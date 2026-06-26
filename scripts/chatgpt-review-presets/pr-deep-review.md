Review the linked pull request for high-impact production risk and complexity collapse opportunities.

Primary goal:
Find only issues that are worth changing before merge because they are likely to cause a serious production bug, data loss or corruption, security or privacy exposure, broken user-visible behavior, or because they let us delete or collapse meaningful complexity while preserving required behavior.

Architecture priority:
Default to deletion and radical simplicity. Before accepting any new code, abstraction, dependency, service, configuration, state, or process, challenge whether it solves a real current problem. Prefer the smallest architecture with the fewest moving parts, concepts, branches, and hidden behaviors. Report complexity only when the PR introduces or preserves structure that can be removed now without losing required behavior.

Treat the PR's stated intent as the requirement, not its current runtime state. Code that the diff temporarily disables, gates, fail-closes, scrubs, or stubs while wiring is in progress is not evidence the functionality should be deleted — propose deletion only when the same intended behavior can be preserved with materially less code. If the disabled state itself blocks the PR's stated goal, report that as a Critical/High correctness finding, not as a complexity collapse.

Use the connected GitHub repository to read:

- the full PR diff
- touched files
- enough surrounding callers, invariants, state owners, and tests to judge the change in context
- the baseline invariants doc at `docs/contracts/00-invariants.md` (and any topic-specific contract files it links, e.g. `docs/contracts/06-hosted-workspace-file-count.md`) — read this before reporting so invariant checks are grounded in the current rules, not memory

The repo's review:gpt `app_connector="github"` config is the source of truth for PR context. Treat missing GitHub connector context as a hard stop: if you cannot read the PR and repository through that connector, say so and stop. In that case, do not review from pasted context, memory, files attached out of band, or the PR description alone.

Do not review the diff in isolation.

Report only:

- Critical/high bugs: incorrect logic, broken invariants, data loss or corruption, auth/privacy/security exposure, race/retry/idempotency failures, deploy/runtime breakage, or user-visible behavior that is likely to fail in a reachable production path or anything else you deem a major issue.
- High-impact edge cases: unusual but realistic states that would cause serious breakage, not incomplete polish or theoretical coverage gaps
- Complexity collapse opportunities: places where the same required behavior can be achieved with materially less code, fewer concepts, fewer branches, clearer ownership, or reuse of an existing primitive
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
- if you cannot read the PR diff or the touched files through the connected repository, say so explicitly and stop; do not review from memory or from the PR description alone
- rank findings by importance: critical/high production bugs first, then complexity collapse opportunities
- do not report style, naming, or formatting nits unless they hide a real high-impact problem

Final response contract:

- return one concise plain-text review
- if you find nothing worth changing after a thorough pass, say so explicitly in a short summary rather than inventing low-value findings
- do all repository reading and analysis silently, then reply with exactly ONE message containing your complete ranked findings; never send a preliminary status or acknowledgment message first, because the response capture treats your first settled message as the final review
- end your final message with the exact line REVIEW_COMPLETE on its own line; the response capture tooling waits for that marker, and do not write that token anywhere else in any message
