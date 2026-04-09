# Completion Workflow

Last verified: 2026-04-09

This workflow applies to repo code/docs/test/config changes after implementation is materially complete.
Use `agent-docs/operations/agent-workflow-routing.md` to classify the task, choose the commit path, and decide whether ledger or plan mechanics apply.
Use `agent-docs/operations/verification-and-runtime.md` to choose the truthful verification command set.

## Sequence

1. Finish the functional implementation first.
   During local iteration, prefer the narrowest truthful verification loop for the task. In practice that is usually `pnpm test:diff <path ...>` for package or app work, the low-risk `pnpm typecheck` fast path for tiny repo-internal workflow/tooling changes, or `pnpm verify:acceptance` when the task already clearly needs the full lane.
2. Run a scope and shape check before polish: confirm the diff is still proportional to the task, new abstractions are immediately justified, any new persisted state is explicitly classified and versioned, and any architecture/API/trust-boundary change is documented or split into an explicit plan.
3. If the change sprawled, duplicated existing patterns, or introduced speculative structure, cut it back before continuing.
4. Decide the audit path:
   - docs/process-only work normally skips audit subagents unless the user explicitly asks for them
   - the tiny repo-internal fast path below replaces the final-review audit subagent with an explicit local final review
   - repo code/test/config changes whose verification lane includes owner-level coverage or truthful `pnpm test:diff <path ...>` coverage require the dedicated `coverage-write` pass
   - ordinary repo code/test/config changes then run `task-finish-review`
   - add `simplify` only when the conditions below are met
5. When `simplify` applies, spawn a dedicated audit subagent, hand it `agent-docs/prompts/simplify.md` plus the audit handoff packet below, and run it before coverage or final review. Land only behavior-preserving reductions from that pass.
6. Once implementation is stable enough to produce a truthful signal, run the coverage-bearing verification command chosen from the verification doc. Prefer `pnpm test:diff <path ...>` when it already covers the touched owner truthfully; otherwise run the edited owner package/app coverage command required there.
7. When step 6 uses an owner-coverage or truthful diff-coverage lane, run the required `coverage-write` pass on `gpt-5.4-mini` after any simplify pass. Hand that worker `agent-docs/prompts/coverage-write.md` plus the audit handoff packet below, and keep its write scope limited to tests or direct-proof scaffolding for already-landed behavior.
8. For user-visible, persisted-state, operational, or trust-boundary changes, capture at least one direct scenario check in addition to scripted tests and record the exact evidence.
9. Run or re-run the required checks after the implementation is stable, after any simplify updates, after any required coverage pass lands, and after any later review-driven fixes.
10. Run the final completion review. Use the tiny repo-internal fast path below only when it applies; otherwise spawn a dedicated audit subagent and hand it `agent-docs/prompts/task-finish-review.md` plus the audit handoff packet below.
11. Treat that final review as the last audit of remaining coverage and proof gaps too. If it finds meaningful missing tests or boundary-level verification, add the smallest high-impact proof before handoff instead of creating another default coverage pass.
12. Resolve high-severity findings before final handoff and re-run affected required checks after any post-review fixes.
13. Do not automatically spawn another workflow audit subagent after the first final review. One extra final-review rerun is allowed only when the first review forced a large or high-risk follow-up diff; otherwise finish locally after the post-fix checks.
14. Close any active execution plan and use the commit path chosen by the routing doc and `AGENTS.md` before handoff.
15. Final handoff must report required-check results plus any direct scenario evidence. Green required checks remain the default completion bar; if a required check failed for a credibly unrelated pre-existing reason, handoff must name the failing command, failing target, and why the current diff did not cause it.

## When To Add Simplify

Add a `simplify` pass before final review only when all of the following are true:

1. The implementation diff is 200 or more changed lines so a dedicated cut-back pass is likely to remove real maintenance cost.
2. The diff was developed locally or grew organically in-tree rather than arriving from an applied patch file or other bounded external patch landing.
3. The simplify reviewer can plausibly suggest behavior-preserving reductions instead of reopening core product or architecture decisions.
4. The extra review time is justified by the size and shape of the change.

If those conditions are not met, skip `simplify` and proceed directly to the normal coverage and final-review path.

## Tiny Repo-Internal Fast Path

Use explicit local final review instead of a spawned `task-finish-review` audit subagent only when the task meets the low-risk repo-internal workflow/tooling criteria from `agent-docs/operations/verification-and-runtime.md` and the implementation diff stays under roughly 120 changed lines.

This fast path only replaces the final-review audit subagent.
It does not skip `coverage-write` when the task's verification lane already includes package or app coverage.

## Audit Worker Rules

- `coverage-write` is the default write-capable audit pass, must run on `gpt-5.4-mini`, and should stay narrowly scoped to tests or direct-proof scaffolding.
- Other audit passes are review-only unless the user explicitly asks for a write-capable audit worker with a widened scope.
- The default audit response contract is plain-text findings with recommended fixes, not patch attachments and not prompts for additional agents.
- Review-mode audit subagents must not edit files, run `scripts/committer`, run `scripts/finish-task`, invoke `git commit`, or otherwise create commits.
- Prefer a fresh non-forked handoff packet over inheriting the full implementation thread. Widen context only when a specific review question cannot be answered from the narrowed packet.
- Use a fresh subagent per required pass unless the user explicitly instructs otherwise.
- When waiting on audit subagents, prefer a patient wait window over repeated short polling. A realistic default is 5 to 10 minutes for medium or large diffs.
- Do not cancel or close an audit subagent early just because it has been running for under 10 minutes unless there is concrete evidence that it is stuck or operating on the wrong scope.
- Close audit subagents promptly after they return, time out, or are judged stuck.
- If subagent tooling is unavailable in the current environment, stop and escalate instead of silently downgrading a required audit pass to local review.

## Audit Handoff Packet

For each required audit subagent, provide:

- What changed and why at the behavior level.
- Why the chosen implementation fits the existing system, especially when it introduces or extends abstractions.
- Invariants or assumptions that must still hold.
- Links to active execution plans when present.
- Verification evidence already run, including commands and outcomes.
- Any direct scenario proof already run, or the exact gap if it still needs human verification.
- Current worktree context and explicit review boundaries.
- An explicit `review only` instruction covering no file edits, no commit helpers, and no commits.
- Instruction to read `COORDINATION_LEDGER.md`, honor any explicit exclusive/refactor notes, and otherwise work carefully on top of overlapping rows.

For the required `coverage-write` pass, also provide:

- The exact coverage-bearing command or commands required for the task plus the current pass/fail status or the most relevant failing-output summary.
- The exact write scope, limited to tests or proof scaffolding for already-landed behavior.
- An explicit instruction not to modify production code unless the parent agent separately widens that scope.
- The required model choice, `gpt-5.4-mini`; do not silently substitute regular `gpt-5.4` for this pass.

## Safety Rules

- Do not overwrite, discard, or revert unrelated worktree edits.
- Do not use reset or checkout cleanup commands to prepare audit passes.
- If an audit suggestion conflicts with pre-existing edits, leave the file untouched and escalate in handoff notes.
- Treat green checks as necessary but not sufficient when the changed behavior has a user-visible or operational boundary; require direct proof or call out the missing proof explicitly.
