# Completion Workflow

Last verified: 2026-06-03

This workflow applies to repo code/docs/test/config changes after implementation is materially complete.
Use `agent-docs/operations/agent-workflow-routing.md` to classify the task, choose the commit path, and decide whether ledger or plan mechanics apply.
Use `agent-docs/operations/verification-and-runtime.md` to choose the truthful verification command set.
When the routed task class requires audit passes such as `security-privacy-review`, `coverage-write`, `frontend-review`, or `task-finish-review`, treat them as mandatory completion steps before handoff, not optional close-out checks after code, tests, or commit.
Those required audit passes are local Codex subagent passes, not `review:gpt`, not external ChatGPT autosends, and not `thread wake` workflows.
This completion workflow is standing user approval to spawn the required local Codex audit subagents for routed repo tasks. Do not skip or downgrade a required audit pass because generic agent instructions say subagents need an explicit user request; this document and `AGENTS.md` are that explicit repo-level request for the required completion passes.
Required workflow audit subagents default to high reasoning. Use xhigh reasoning instead when the change is large, complex, high-risk/cross-cutting, or spans multiple owners, architecture decisions, or trust-boundary decisions. If the current subagent tooling cannot honor the required reasoning effort, report that limitation explicitly instead of silently downgrading the pass.

## Sequence

1. Finish the functional implementation first.
   During local iteration, prefer the narrowest truthful verification loop for the task. In practice that is usually `pnpm test:diff <path ...>` for package or app work, the low-risk `pnpm typecheck` fast path for tiny repo-internal workflow/tooling changes, or `pnpm verify:acceptance` when the task already clearly needs the full lane.
2. Run a scope and shape check before polish: confirm the diff is still proportional to the task, new abstractions are immediately justified, any new persisted state is explicitly classified and versioned, and any architecture/API/trust-boundary change is documented or split into an explicit plan.
3. If the change sprawled, duplicated existing patterns, or introduced speculative structure, cut it back before continuing.
4. Decide the audit path required by the routed task class:
   - docs/process-only work normally skips audit subagents unless the user explicitly asks for them
   - really low-impact `apps/web` copy-only edits may skip audit subagents when they only change static text and do not alter layout, UI state, auth, pricing logic, schemas, runtime behavior, or security claims; use local readback and focused checks instead
   - the tiny repo-internal fast path below replaces the final-review audit subagent with an explicit local final review
   - changesets that materially touch auth/session behavior, secrets or credentials, payment/billing state, external ingress/egress, public APIs/routes, trust boundaries, or persisted/uploaded/user-facing data exposure add the dedicated `security-privacy-review` pass
   - user-facing `apps/web` UI changes add the dedicated `frontend-review` pass
   - repo code/test/config changes whose verification lane includes owner-level coverage or truthful `pnpm test:diff <path ...>` coverage require the dedicated `coverage-write` pass
   - ordinary repo code/test/config changes then run `task-finish-review`
   - add `simplify` only when the conditions below are met
5. When `simplify` applies, spawn a dedicated audit subagent, hand it `agent-docs/prompts/simplify.md` plus the audit handoff packet below, and run it before coverage or final review. Land only behavior-preserving reductions from that pass.
6. When `security-privacy-review` applies, spawn a dedicated audit subagent, hand it `agent-docs/prompts/security-privacy-review.md` plus the audit handoff packet below, and run it before coverage or final review. If `simplify` also applies, run both passes in parallel after implementation is stable enough for review. Keep this pass review-only and scope it to security plus concrete exposure risks.
7. When `frontend-review` applies, spawn a dedicated audit subagent, hand it `agent-docs/prompts/frontend-review.md` plus the audit handoff packet below, and run it after any simplify/security-privacy pass but before the final completion review. Keep it review-only and scope it to user-facing `apps/web` surfaces plus the frontend guidance in `agent-docs/FRONTEND.md`.
8. Once implementation is stable enough to produce a truthful signal, run the coverage-bearing verification command chosen from the verification doc. Prefer `pnpm test:diff <path ...>` when it already covers the touched owner truthfully; otherwise run the edited owner package/app coverage command required there.
9. When step 8 uses an owner-coverage or truthful diff-coverage lane, run the required `coverage-write` pass on `gpt-5.5` using the workflow audit reasoning default after any simplify/security-privacy pass. Hand that worker `agent-docs/prompts/coverage-write.md` plus the audit handoff packet below, and keep its write scope limited to tests or direct-proof scaffolding for already-landed behavior.
10. For user-visible, persisted-state, operational, or trust-boundary changes, capture at least one direct scenario check in addition to scripted tests and record the exact evidence.
11. Run or re-run the required checks after the implementation is stable, after any simplify updates, after any security review-driven fixes, after any required coverage pass lands, after any frontend-review-driven fixes, and after any later review-driven fixes.
12. Run the final completion review. Use the tiny repo-internal fast path below only when it applies; otherwise spawn a dedicated audit subagent and hand it `agent-docs/prompts/task-finish-review.md` plus the audit handoff packet below.
13. Treat that final review as the last audit of remaining coverage and proof gaps too. If it finds meaningful missing tests or boundary-level verification, add the smallest high-impact proof before handoff instead of creating another default coverage pass.
14. Resolve high-severity findings before final handoff and re-run affected required checks after any post-review fixes.
15. Do not automatically spawn another workflow audit subagent after the first final review. One extra final-review rerun is allowed only when the first review forced a large or high-risk follow-up diff; otherwise finish locally after the post-fix checks.
16. Close any active execution plan and use the commit path chosen by the routing doc and `AGENTS.md` before handoff. For plan-bearing work, the final scoped commit must go through `scripts/finish-task <active-plan-path> "summary" <path>...` so the matching ledger row is removed and the plan moves to `agent-docs/exec-plans/completed/`. Do not use `scripts/committer` or `git commit` as the final task commit for active-plan work; that commits code while leaving stale active-plan state behind. If overlapping dirty work blocks a safe `finish-task` commit, clear the exact ledger row, archive the plan with `scripts/close-exec-plan.sh`, and report the scoped-commit blocker before handoff.
17. Final handoff must report required-check results plus any direct scenario evidence. Green required checks remain the default completion bar; if a required check failed for a credibly unrelated pre-existing reason, handoff must name the failing command, failing target, and why the current diff did not cause it.

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

## Tiny Copy-Only Fast Path

Skip `security-privacy-review`, `frontend-review`, `coverage-write`, and `task-finish-review` subagents for very small `apps/web` copy-only edits when all of the following are true:

1. The diff only changes static user-facing text.
2. The change does not alter layout, styling, UI state, component structure, auth, billing/pricing logic, schemas, routes, API behavior, runtime code, or security claims.
3. Local readback plus focused checks cover the changed surface.

Use focused component/page tests, typecheck, `git diff --check`, and stale-string searches as appropriate. If the copy change touches claims about security, billing, medical outcomes, or product guarantees, leave this fast path and use the normal review workflow.

## Audit Worker Rules

- Required workflow audit subagents use high reasoning by default. Use xhigh reasoning for large or complex changes, high-risk/cross-cutting changes, or audits that span multiple owners, architecture decisions, or trust-boundary decisions.
- `coverage-write` is the default write-capable audit pass, must run on `gpt-5.5` with the workflow audit reasoning default, and should stay narrowly scoped to tests or direct-proof scaffolding.
- `security-privacy-review` is a review-only pass for changes that materially touch auth/session behavior, secrets, payments, external surfaces, trust boundaries, or persisted/uploaded/user-facing data exposure. It should read `agent-docs/SECURITY.md` and focus on security regressions, authority expansion, fail-closed behavior, leakage risks, and concrete unnecessary exposure.
- `frontend-review` is a review-only pass for user-facing `apps/web` pages, components, and design-system-facing UI. It should read `agent-docs/FRONTEND.md` and focus on design-system alignment, product context, UX quality, and unnecessary UI drift.
- Other audit passes are review-only unless the user explicitly asks for a write-capable audit worker with a widened scope.
- The default audit response contract is plain-text findings with recommended fixes, not patch attachments and not prompts for additional agents.
- Do not satisfy required audit passes with `pnpm review:gpt`, `review:gpt` presets, external ChatGPT threads, `cobuild-review-gpt`, or any `thread wake`/autosend flow. Those are separate optional tools, not the repo-required completion workflow.
- If a spawned subagent cannot itself spawn another worker, it must report that limitation back to the parent agent rather than substituting an external review workflow.
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
- Current working-tree context and explicit review boundaries.
- An explicit `review only` instruction covering no file edits, no commit helpers, and no commits.
- Instruction to read `COORDINATION_LEDGER.md`, honor any explicit exclusive/refactor notes, and otherwise work carefully on top of overlapping rows.

For the required `frontend-review` pass, also provide:

- The exact user-facing `apps/web` surfaces under review, including pages/components and any related shared UI primitives.
- An explicit instruction to read `agent-docs/FRONTEND.md` before reviewing.
- The product/user outcome the UI is meant to support so the review can judge polish against intent rather than taste alone.
- Any screenshots, local dev notes, or direct scenario evidence already gathered, or the exact gap if visual verification still needs a human/browser pass.

For the required `security-privacy-review` pass, also provide:

- The exact auth/session, secret, external surface, trust-boundary, or concrete exposure behavior under review.
- An explicit instruction to read `agent-docs/SECURITY.md` before reviewing.
- The intended authority boundary, including who or what should be able to see, mutate, or infer the affected data.
- Any exposure decisions already made, plus known tradeoffs or accepted residual exposure.
- Any direct security or concrete leakage scenario proof already gathered, or the exact gap if manual verification still needs to happen.

For the required `coverage-write` pass, also provide:

- The exact coverage-bearing command or commands required for the task plus the current pass/fail status or the most relevant failing-output summary.
- The exact write scope, limited to tests or proof scaffolding for already-landed behavior.
- An explicit instruction not to modify production code unless the parent agent separately widens that scope.
- The required model choice, `gpt-5.5` with the workflow audit reasoning default; do not silently substitute a mini model or a lower/different reasoning effort for this pass.

## Safety Rules

- Do not overwrite, discard, or revert unrelated working-tree edits in the current checkout.
- Do not create or switch git branches unless the user explicitly asks for that in the current task. Do not use branch changes as a workaround for dirty worktrees, deployment scope, or parallel work; preserve the current branch and stop/report the blocker instead.
- Do not create, switch to, or land work in separate git worktrees or helper checkouts unless the user explicitly asks for that in the current task.
- Do not use reset or checkout cleanup commands to prepare audit passes.
- If an audit suggestion conflicts with pre-existing edits, leave the file untouched and escalate in handoff notes.
- Treat green checks as necessary but not sufficient when the changed behavior has a user-visible or operational boundary; require direct proof or call out the missing proof explicitly.
