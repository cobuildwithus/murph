# Completion Workflow

Last verified: 2026-06-12

This workflow applies to repo code/docs/test/config changes after implementation is materially complete.
Use `agent-docs/operations/agent-workflow-routing.md` to classify the task, choose the commit path, and decide whether ledger or plan mechanics apply.
Use `agent-docs/operations/verification-and-runtime.md` to choose the truthful verification command set.
When the routed task class requires audit passes such as `prompt-review`, `security-privacy-review`, `coverage-write`, `frontend-review`, or `deep-review`, treat them as mandatory completion steps before handoff, not optional close-out checks after code, tests, or commit.
Those required audit passes are local audit subagent passes (see the model routing in `Audit Worker Rules`), not `review:gpt`, not external ChatGPT autosends, and not `thread wake` workflows.
This completion workflow is standing user approval to spawn the required local audit subagents for routed repo tasks. Do not skip or downgrade a required audit pass because generic agent instructions say subagents need an explicit user request; this document and `AGENTS.md` are that explicit repo-level request for the required completion passes.
Required workflow audit subagents default to high reasoning. Use xhigh reasoning instead when the change is large, complex, high-risk/cross-cutting, or spans multiple owners, architecture decisions, or trust-boundary decisions. If the current subagent tooling cannot honor the required reasoning effort, report that limitation explicitly instead of silently downgrading the pass.

Final review is not a spawned subagent pass. The parent agent runs an explicit local final review (step 11), and for PR-lane work the post-CI external loop in `agent-docs/operations/pr-deep-review-loop.md` is the required final review gate before merge-readiness.
Removed 2026-06-12: the `simplify` and `task-finish-review` subagent passes. June 2026 transcript mining across Codex/Claude sessions and `audit-packages/` artifacts showed `simplify` produced no accepted findings, and `task-finish-review` produced mostly low-severity polish while the specialized passes caught the real local bugs and the post-CI review:gpt loop caught what the entire local stack missed. The parent-owned scope-and-shape check (step 2) owns simplification; `/simplify` remains available on demand.

## Sequence

1. Finish the functional implementation first.
   During local iteration, prefer the narrowest truthful verification loop for the task. In practice that is usually `pnpm test:diff <path ...>` for package or app work, the low-risk `pnpm typecheck` fast path for tiny repo-internal workflow/tooling changes, or `pnpm verify:acceptance` when the task already clearly needs the full lane.
2. Run a scope and shape check before polish: confirm the diff is still proportional to the task, new abstractions are immediately justified, any new persisted state is explicitly classified and versioned, and any architecture/API/trust-boundary change is documented or split into an explicit plan. This check owns simplification: delete dead code, cut speculative structure, and collapse needless indirection yourself; there is no separate simplify subagent pass.
3. If the change sprawled, duplicated existing patterns, or introduced speculative structure, cut it back before continuing.
4. Decide the audit path required by the routed task class:
   - docs/process-only work normally skips audit subagents unless the user explicitly asks for them
   - really low-impact `apps/web` copy-only edits may skip audit subagents when they only change static text and do not alter layout, UI state, auth, pricing logic, schemas, runtime behavior, or security claims; use local readback and focused checks instead
   - prompt-primary changes use the prompt review path below instead of the normal completion audit stack
   - changesets that materially touch auth/session behavior, secrets or credentials, payment/billing state, external ingress/egress, public APIs/routes, trust boundaries, or persisted/uploaded/user-facing data exposure add the dedicated `security-privacy-review` pass
   - user-facing `apps/web` UI changes add the dedicated `frontend-review` pass
   - repo code/test/config changes whose verification lane includes owner-level coverage or truthful `pnpm test:diff <path ...>` coverage require the dedicated `coverage-write` pass
   - particularly complex or sensitive changes add the dedicated `deep-review` pass when the conditions below are met
5. When the prompt review path applies, spawn one dedicated audit subagent, hand it `agent-docs/prompts/prompt-review.md` plus the audit handoff packet below, and skip `security-privacy-review`, `frontend-review`, `coverage-write`, and `deep-review` unless the non-prompt part of the diff independently meets those passes' triggers. The prompt-review pass is review-only and is the final completion audit for prompt-primary work.
6. When `security-privacy-review` applies, spawn a dedicated audit subagent, hand it `agent-docs/prompts/security-privacy-review.md` plus the audit handoff packet below, and run it before coverage and final review. Keep this pass review-only and scope it to security plus concrete exposure risks.
7. When `frontend-review` applies, spawn a dedicated audit subagent, hand it `agent-docs/prompts/frontend-review.md` plus the audit handoff packet below, and run it after any security-privacy pass but before final review. Keep it review-only and scope it to user-facing `apps/web` surfaces plus the frontend guidance in `agent-docs/FRONTEND.md`.
8. Once implementation is stable enough to produce a truthful signal, run the coverage-bearing verification command chosen from the verification doc. Prefer `pnpm test:diff <path ...>` when it already covers the touched owner truthfully; otherwise run the edited owner package/app coverage command required there.
9. When step 8 uses an owner-coverage or truthful diff-coverage lane, run the required `coverage-write` pass on Codex `gpt-5.5` (per the audit worker rules below) using the workflow audit reasoning default after any security-privacy pass. Hand that worker `agent-docs/prompts/coverage-write.md` plus the audit handoff packet below, and keep its write scope limited to tests or direct-proof scaffolding for already-landed behavior.
10. For user-visible, persisted-state, operational, or trust-boundary changes, capture at least one direct scenario check in addition to scripted tests and record the exact evidence. When `deep-review` applies, spawn it after the specialized review and coverage/proof work is stable: a dedicated review-only audit subagent handed the `murph-deep-review` workflow plus the audit handoff packet below, asked the exact question "What final bugs or edge cases could still break this change in production?"
11. Run the final review locally as the parent agent: re-read the full diff with fresh eyes, walk the changed call paths, and check for remaining coverage or proof gaps, residual risks, and handoff completeness. If it finds meaningful missing tests or boundary-level verification, add the smallest high-impact proof before handoff instead of creating another default coverage pass. Do not spawn a final-review subagent; if the change feels too large or risky to final-review locally, that is a signal it belongs on the worktree/PR lane, where the post-CI external loop reviews it.
12. Enter the review-resolution loop below for every required audit output. Completion means there are no unresolved accepted/actionable findings, not merely that the audit pass ran.
13. Run or re-run the required checks after the implementation is stable, after any review-driven fixes, and after any required coverage pass lands.
14. Close any active execution plan and use the commit path chosen by the routing doc and `AGENTS.md` before handoff. For plan-bearing work, the final scoped commit must go through `scripts/finish-task <active-plan-path> "summary" <path>...` so the matching ledger row is removed and the plan moves to `agent-docs/exec-plans/completed/`. Do not use `scripts/committer` or `git commit` as the final task commit for plan-bearing work; that commits code while leaving stale active-plan state behind. If overlapping dirty work blocks a safe `finish-task` commit, clear the exact ledger row, archive the plan with `scripts/close-exec-plan.sh`, and report the scoped-commit blocker before handoff.
15. For non-trivial PR-lane work, after PR CI is green, run the post-CI external loop in `agent-docs/operations/pr-deep-review-loop.md` to zero accepted findings before calling the PR merge-ready. It is the required final review gate for that lane and never substitutes for the local passes above.
16. Final handoff must report required-check results, direct scenario evidence, and audit findings accepted, fixed, or rejected with reasons. Green required checks remain the default completion bar; if a required check failed for a credibly unrelated pre-existing reason, handoff must name the failing command, failing target, and why the current diff did not cause it.

## Review-Resolution Loop

Audit outputs are advisory until the parent implementation agent verifies them.
For every finding from a required audit pass:

1. Read the real code path, adjacent files, and relevant tests before accepting the finding. When a finding depends on external behavior, check the dependency's docs, source, or types instead of guessing.
2. Classify the finding as accepted/actionable, rejected, or out of scope. Reject speculative risks, unrealistic edge cases, broad rewrites, and fixes that add more complexity than the bug justifies.
3. For accepted/actionable findings, fix the smallest correct surface at the right ownership boundary. If the finding reveals a bug class or repeated pattern, inspect the current task scope for sibling instances and fix the scoped bug class together when practical.
4. After any review-driven code, test, config, or docs change, rerun the focused verification that proves the changed surface.
5. Rerun the affected audit pass when the fix materially changes that pass's risk surface:
   - rerun `security-privacy-review` for accepted security/privacy fixes on auth, secrets, trust boundaries, external surfaces, or concrete exposure behavior
   - rerun `frontend-review` for meaningful UI, interaction, layout, or design-system fixes
   - rerun `coverage-write` only when the accepted finding changes the proof surface and needs write-capable coverage follow-up
   - rerun `deep-review` when an accepted deep-review finding drives a broad, cross-owner, state-machine, or sensitive-boundary fix that materially changes the pass's risk surface
   - rerun `prompt-review` when an accepted prompt-review finding materially rewrites the prompt behavior, prompt structure, tool-use policy, evidence rules, or output contract
6. Do not rerun an audit solely for rejected findings, tiny wording changes, isolated test-only proof additions, or to obtain a cleaner final sentence.

Stop the loop when every required audit finding is either fixed/proven or consciously rejected/out of scope with a concise reason, and no unresolved accepted/actionable findings remain.

## Prompt Review Path

Use `prompt-review` as the only required completion audit when all of the following are true:

1. The meaningful behavior change is prompt text, system/developer instructions, agent workflow prompts, tool descriptions, prompt assembly guidance, or regression tests that prove prompt content.
2. Any non-prompt code changes are only mechanical support for prompt assembly, prompt export, or prompt regression proof.
3. The change does not independently alter runtime behavior, schemas, persisted state, app/package APIs, auth/session authority, external ingress/egress, deploy surfaces, billing, frontend layout/interaction, or trust boundaries outside the prompt itself.

Do not add `security-privacy-review`, `frontend-review`, `coverage-write`, or `deep-review` solely because the prompt mentions sensitive topics, user-facing behavior, tools, retrieval, or validation. The prompt-review worker owns prompt-level privacy, security, safety, evidence, validation, simplicity, clarity, and instruction-conflict concerns for prompt-primary work.

If the change is mixed and the non-prompt part independently triggers another pass, run the normal specialized audit path for that non-prompt surface. `prompt-review` is not a substitute for reviewing real runtime, UI, persisted-state, deploy, or trust-boundary changes.

## When To Add Deep Review

Add a `deep-review` pass when the change is particularly complex or sensitive enough that normal specialized passes may miss cross-cutting production bugs.

Use `deep-review` when one or more of these conditions apply:

1. The change spans multiple owners, apps, packages, or runtime boundaries and correctness depends on their interaction.
2. The change alters state machines, ordering, idempotency, retries, concurrency, migrations, persisted-state ownership, or fail-closed behavior.
3. The change touches sensitive health data, auth/session authority, secrets, billing, external ingress/egress, hosted execution, Cloudflare, Temporal, or other trust-boundary surfaces in a way that creates coupled correctness and exposure risk.
4. The implementation is a large or high-risk refactor where a first-principles bug hunt is likely to find edge cases that `security-privacy-review`, `coverage-write`, or `frontend-review` alone may not catch.
5. The user explicitly asks for deep review, a final bug hunt, or a production edge-case sweep as part of completion.

Do not use `deep-review` as a replacement for the dedicated `security-privacy-review`, `frontend-review`, or `coverage-write` passes. If none of the conditions above apply, skip it and proceed through the normal completion workflow.

## Tiny Copy-Only Fast Path

Skip `security-privacy-review`, `frontend-review`, and `coverage-write` subagents for very small `apps/web` copy-only edits when all of the following are true:

1. The diff only changes static user-facing text.
2. The change does not alter layout, styling, UI state, component structure, auth, billing/pricing logic, schemas, routes, API behavior, runtime code, or security claims.
3. Local readback plus focused checks cover the changed surface.

Use focused component/page tests, typecheck, `git diff --check`, and stale-string searches as appropriate. If the copy change touches claims about security, billing, medical outcomes, or product guarantees, leave this fast path and use the normal review workflow.

## Audit Worker Rules

- The `security-privacy-review` and `coverage-write` passes run on Codex `gpt-5.5` through the local Codex CLI (non-interactive `codex exec` with stdin closed, e.g. `</dev/null`; with an open non-TTY stdin it waits for piped input and hangs), regardless of the parent agent's model, to keep audit cost on the Codex subscription instead of per-token parent-model spend. When the `MURPH_AUDIT_CODEX_HOME` environment variable is set, pass it as `CODEX_HOME` so operators can point audits at a specific local Codex home; otherwise let the Codex CLI use its normal home resolution (existing `CODEX_HOME` or `~/.codex`). If the Codex CLI or that auth is unavailable in the current environment, report the limitation and run the pass on the parent agent's current model instead of skipping it.
- The remaining required passes (`prompt-review`, `frontend-review`, `deep-review`) run on whatever model the parent agent is currently running on (e.g., a Fable parent spawns Fable audit subagents); do not route them to a different model family.
- All required audit subagents use high reasoning by default. Use xhigh reasoning for large or complex changes, high-risk/cross-cutting changes, or audits that span multiple owners, architecture decisions, or trust-boundary decisions.
- `prompt-review` is a review-only pass for prompt-primary changes and must read the current OpenAI prompt guidance at `https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5.5` every time before reviewing. It focuses on prompt simplicity, current prompt guidance, prompt-level evidence/validation rules, unclear instructions, conflicting or paradoxical requirements, and unnecessary instruction bloat.
- `coverage-write` is the default write-capable audit pass, must run on Codex `gpt-5.5` with the workflow audit reasoning default, and should stay narrowly scoped to tests or direct-proof scaffolding.
- `security-privacy-review` is a review-only pass for changes that materially touch auth/session behavior, secrets, payments, external surfaces, trust boundaries, or persisted/uploaded/user-facing data exposure. It should read `agent-docs/SECURITY.md` and focus on security regressions, authority expansion, fail-closed behavior, leakage risks, and concrete unnecessary exposure.
- `frontend-review` is a review-only pass for user-facing `apps/web` pages, components, and design-system-facing UI. It should read `agent-docs/FRONTEND.md` and focus on design-system alignment, product context, UX quality, and unnecessary UI drift.
- `deep-review` is a review-only pass for cross-cutting, complex, or sensitive changes. It should use `murph-deep-review`, load `feynman-auditor`, follow modified files plus directly affected call paths, and focus on final bugs or edge cases that could still break the change in production.
- Other audit passes are review-only unless the user explicitly asks for a write-capable audit worker with a widened scope.
- The default audit response contract is plain-text findings with recommended fixes, not patch attachments and not prompts for additional agents.
- Do not satisfy required audit passes with `pnpm review:gpt`, `review:gpt` presets, external ChatGPT threads, `cobuild-review-gpt`, or any `thread wake`/autosend flow. Those run in a different stage: the post-CI external review loop for non-trivial PR-lane work is `agent-docs/operations/pr-deep-review-loop.md`; it runs after this workflow completes and PR CI is green, never instead of it.
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
- The required model choice, Codex `gpt-5.5` with the workflow audit reasoning default; do not silently substitute a mini model, a different model family, or a lower/different reasoning effort for this pass.

For the required `prompt-review` pass, also provide:

- The exact prompt surfaces under review, including files, exported prompt builders, tool descriptions, or tests that prove prompt content.
- Why the change qualifies as prompt-primary and which normal audit passes are being skipped under this path.
- The intended prompt behavior and any product, safety, evidence, retrieval, tool-use, validation, or output-contract invariants the prompt must preserve.
- An explicit instruction to read `agent-docs/prompts/prompt-review.md` and the current OpenAI prompt guidance before reviewing.

For the required `deep-review` pass, also provide:

- The exact files, packages, commits, or call paths in scope.
- The condition from `When To Add Deep Review` that made the pass required.
- Any state-machine, ordering, idempotency, retry, owner-boundary, persisted-state, or sensitive-boundary assumptions the implementation relies on.
- An explicit instruction to use `murph-deep-review`, load `feynman-auditor`, keep the pass review-only, and answer: "What final bugs or edge cases could still break this change in production?"
- Any direct scenario proof already gathered, or the exact gap if production-risk proof remains incomplete.

## Safety Rules

- Do not overwrite, discard, or revert unrelated working-tree edits in the current checkout.
- Do not create or switch git branches unless the user explicitly asks for that in the current task. Do not use branch changes as a workaround for dirty worktrees, deployment scope, or parallel work; preserve the current branch and stop/report the blocker instead.
- Do not create, switch to, or land work in separate git worktrees or helper checkouts unless the user explicitly asks for that in the current task.
- Do not use reset or checkout cleanup commands to prepare audit passes.
- If an audit suggestion conflicts with pre-existing edits, leave the file untouched and escalate in handoff notes.
- Treat green checks as necessary but not sufficient when the changed behavior has a user-visible or operational boundary; require direct proof or call out the missing proof explicitly.
