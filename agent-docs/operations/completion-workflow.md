# Completion Workflow

Last verified: 2026-04-09

This workflow applies to repo code/docs/test/config changes.
Vault-only data tasks under `vault/**` skip this workflow unless the user explicitly asks for repo/process work.

## Sequence

1. Complete functional implementation first.
   During local iteration on repo code, prefer `pnpm test:diff` as the default quick loop unless the task is already on the tiny repo-internal `pnpm typecheck` fast path or clearly needs the full `pnpm verify:acceptance` lane immediately.
2. Run a scope/shape check before polish: confirm the diff is still proportional to the task, new abstractions are immediately justified, any new persisted state is explicitly classified and versioned, and any architecture/API/trust-boundary change is documented or split into an explicit plan.
3. If the change sprawled, duplicated existing patterns, or introduced speculative structure, cut it back before continuing.
4. Classify the change path before audits:
   - docs/process-only and vault-only data tasks skip audit subagents unless the user explicitly asks for them
   - tiny repo-internal workflow/tooling changes that meet the fast-path criteria below may use local final review instead of an audit subagent
   - repo code/test/config changes that verify through `pnpm test:diff <path ...>` or package/app coverage commands require the dedicated `coverage-write` pass
   - other repo code/test/config changes run `task-finish-review` by default after the coverage pass when that pass applies
   - add a `simplify` pass when the change was developed locally rather than landed from an applied patch file, the implementation diff reaches 200 or more changed lines, and it would materially benefit from an explicit behavior-preserving simplification review before final review
5. When the exceptional `simplify` condition applies, spawn a dedicated audit subagent for that pass and hand it `agent-docs/prompts/simplify.md` plus the audit handoff packet below. Expect this audit to take about 5 to 10 minutes on non-trivial diffs; do not rush it or cancel it early just because it has not answered in the first minute.
6. Apply behavior-preserving simplifications from that pass, with explicit attention to missed existing helpers, duplicated logic, and abstractions that do not earn their keep immediately.
7. When the task touches packages/apps, run the coverage-bearing verification command chosen from `agent-docs/operations/verification-and-runtime.md` once the implementation is stable enough to produce a truthful signal. Prefer `pnpm test:diff <path ...>` when it already covers the touched owner truthfully; otherwise run the edited owner package/app coverage command required by that doc.
8. When step 7 applies, spawn a dedicated `worker` subagent after any simplify pass using `gpt-5.4-mini` and hand it `agent-docs/prompts/coverage-write.md` plus the audit handoff packet below. This coverage-focused pass is required for repo code/test/config changes that rely on owner-level coverage commands or diff-aware coverage verification. Keep its write scope limited to tests or direct-proof scaffolding for the already-implemented behavior, and have it use the current coverage-command output to get the lane passing or materially closer.
9. For user-visible, persisted-state, operational, or trust-boundary changes, capture at least one direct scenario check in addition to scripted tests and record the exact evidence. Examples: built CLI command, focused manual flow, browser inspection, or a narrow end-to-end path.
10. Run or re-run the required checks after the implementation is stable, after any simplify updates, after any required coverage pass lands, and after any later review-driven fixes.
11. For normal repo code/test/config changes, spawn a dedicated audit subagent for the final completion review and hand it `agent-docs/prompts/task-finish-review.md` plus the audit handoff packet below. For the tiny repo-internal fast path below, do an explicit local final review instead.
12. Treat that final review, whether local or delegated, as the audit of remaining coverage and proof gaps too. If it finds meaningful missing tests or boundary-level verification, add the smallest high-impact proof before handoff instead of creating an additional default coverage-audit pass.
13. Resolve high-severity findings before final handoff and re-run affected required checks after any post-review fixes.
14. Do not automatically spawn another workflow audit subagent after that first final review. One extra audit rerun is allowed only when the first review forces a large or high-risk follow-up diff; otherwise finish locally after the post-fix checks.
15. If the task used an active execution plan and the task is done or abandoned, close that plan before commit or handoff. Prefer `bash scripts/finish-task <active-plan-path> "type(scope): summary" <path> [path ...]` when the task is ready to commit.
    `scripts/finish-task` is the plan-aware wrapper: it only accepts a plan that still lives under `agent-docs/exec-plans/active/`, resolves the provided file/directory inputs into exact changed file paths before any plan move, closes that plan, then calls `scripts/committer` with the completed-plan artifact plus those resolved paths.
    If the task is ledger-only, or the plan was already moved out of `active/`, use `scripts/committer` directly instead of trying to force `finish-task`.
16. Final handoff must report required-check results plus any direct scenario evidence; green required checks remain the default completion bar.
17. If a required check fails for a credibly unrelated pre-existing reason, commit your exact touched files and hand off with the failing command, failing target, and why your diff did not cause it. If you cannot defend that separation, treat the failure as blocking.

## When To Add Simplify

The default repo audit path is `coverage-write` when the verification lane already includes owner-level coverage, followed by the required `task-finish-review` pass.
Add a `simplify` pass before final review only when all of the following are true:

1. The implementation diff is 200 or more changed lines so a dedicated cut-back pass is likely to remove real maintenance cost.
2. The diff was developed locally or grew organically in-tree rather than arriving from an applied patch file or other bounded external patch landing.
3. The simplify reviewer can plausibly suggest behavior-preserving reductions instead of reopening core product or architecture decisions.
4. The extra review time is justified by the size and shape of the change.

If those conditions are not met, skip `simplify` and proceed directly to `task-finish-review`.

## Tiny Repo-Internal Fast Path

Use local final review instead of a mandatory final-review audit subagent only when all of the following are true:

1. The implementation diff is under roughly 120 changed lines.
2. The touched files stay within repo-internal docs/process/verification tooling such as `agent-docs/**`, `docs/**`, `scripts/**`, `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, `vitest.config.ts`, or root `tsconfig*.json`.
3. The change does not touch package/app runtime logic, product behavior, persisted-state logic, auth/trust boundaries, or deploy surfaces.
4. The verification path is the low-risk fast path from `agent-docs/operations/verification-and-runtime.md`, centered on `pnpm typecheck` plus direct touched-file checks.

This fast path only replaces `task-finish-review`. It does not skip `coverage-write` when the task's verification lane already includes a package/app coverage command.

If any of those conditions fail, use the normal audit path.

## Required Audit Delegation

- The default audit path for repo code/test/config changes is a mandatory `coverage-write` pass whenever the verification lane already includes owner-level coverage, plus `task-finish-review`.
- The only standing exception is the tiny repo-internal fast path above, which uses explicit local final review instead of a spawned final-review audit subagent. It does not skip `coverage-write` when that pass applies.
- `simplify` is an exceptional extra pass for locally developed non-patch changes at 200 or more changed lines, not the repo default.
- Use explicitly spawned subagents for every required audit pass.
- Treat `coverage-write` as the default write-capable audit worker, with a narrow pre-declared scope limited to tests or direct-proof scaffolding.
- Treat other audit subagents as review-only unless the user explicitly asks for another audit worker that can patch code; when that happens, keep the worker's write scope narrow and pre-declared.
- The default audit response contract is plain-text findings with recommended fixes, not patch attachments and not prompts for additional agents.
- Review-mode audit subagents must not edit files, run `scripts/committer`, run `scripts/finish-task`, invoke `git commit`, or otherwise create commits.
- Prefer a fresh non-forked review handoff packet over inheriting the full implementation thread. Only widen context when a specific review question cannot be answered from the narrowed packet.
- The final completion review owns remaining coverage/proof-gap review after any required `coverage-write` pass; the coverage pass does not replace final review.
- Treat the main implementation agent as the integrator of audit findings, not the auditor of record.
- Within this repo, required audit passes are standing-authorized by repo policy. `AGENTS.md` plus this workflow count as standing permission to spawn the required audit subagent passes once the user has asked for repo work that reaches this workflow, so do not stop only to ask for a second explicit "use subagents" instruction.
- When the current environment supports spawned agents, run those required audit passes directly as part of task completion instead of treating them as optional follow-up delegation.
- Use a fresh subagent per pass unless the user explicitly instructs otherwise.
- Start `coverage-write` after simplify (if any) and before the final completion review so that later review sees the post-coverage state.
- After the first final-review pass, do not spawn another workflow audit subagent by default. One extra rerun is the maximum, and only when the first pass produced a large or high-risk repair diff that materially changed the review surface.
- When waiting on these audit subagents, prefer a patient wait window over repeated short polling. A realistic default is 5 to 10 minutes for each pass on medium or large diffs.
- Do not cancel or close an audit subagent early just because it has been running for under 10 minutes unless you have concrete evidence that it is stuck or operating on the wrong scope.
- Close audit subagents promptly after they return, time out, or are judged stuck so they cannot continue operating in the background.
- If subagent tooling is unavailable in the current environment, stop and escalate instead of silently downgrading a required audit pass to local review.

## Coordination Ledger (Repo Code Only)

- Before repo coding work, add an active row to `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Treat the row as an active-work notice by default, not a hard lock.
- Overlap is allowed when agents stay within their declared scope, read the current file state first, and preserve adjacent edits.
- Mark a row as exclusive in `Notes` only when overlap is unsafe, such as a broad refactor or a delicate cross-cutting rewrite.
- Update the row if file scope, symbol intent, or exclusivity expectations change.
- Remove the row immediately when the task is complete or abandoned.
- Vault-only data tasks do not use the coordination ledger.

## Narrow Patch Landings

- For user-supplied patches or externally prepared diffs, default to a ledger-first workflow.
- A dedicated execution plan is optional when the landing stays bounded, low-design, and single-turn.
- Open a plan before continuing if the patch requires architecture decisions, broad manual merge work, cross-cutting refactors, or is likely to spill across turns.
- Treat the supplied patch as behavioral intent, not as authority to overwrite live files blindly; read the current tree first, preserve adjacent edits, and port only the intended delta.

## Vault-Only Data Tasks

- Limit writes to `vault/**` plus the canonical audit or runtime artifacts produced by the invoked mutation path.
- Do not edit repo docs, execution plans, or package source just to satisfy a vault logging request.
- Do not run repo-wide verification commands by default.
- Capture direct proof by reading back the touched records and audit or ledger entries.

## Audit Handoff Packet

For each required audit subagent, provide:

- What changed and why (behavior-level summary).
- Why the chosen implementation fits the existing system, especially when it introduces or extends abstractions.
- Invariants/assumptions that must still hold.
- Links to active execution plans (when present).
- Verification evidence already run (commands + outcomes).
- Any direct scenario proof already run, or the gap if it still needs human verification.
- Current worktree context and explicit review boundaries.
- An explicit `review only` instruction covering no file edits, no commit helpers, and no commits.
- Instruction to read `COORDINATION_LEDGER.md`, honor any explicit exclusive/refactor notes, and otherwise work carefully on top of overlapping rows.

For the required `coverage-write` pass, also provide:

- The exact coverage-bearing command(s) required for the task plus the current pass/fail status or the most relevant failing output summary.
- The exact write scope, limited to tests or proof scaffolding for already-landed behavior.
- An explicit instruction not to modify production code unless the parent agent separately widens that scope.
- The intended model choice, `gpt-5.4-mini`, so the coverage pass stays cheap and narrow.

## Safety Rules

- Do not overwrite, discard, or revert unrelated worktree edits.
- Do not use reset/checkout cleanup commands to prepare audit passes.
- If an audit suggestion conflicts with pre-existing edits, leave the file untouched and escalate in handoff notes.
- Treat "green checks" as necessary but not sufficient when the changed behavior has a user-visible or operational boundary; require direct proof or call out the missing proof explicitly.
