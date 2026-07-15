# Completion Workflow

Last verified: 2026-07-14

This workflow applies to repo code/docs/test/config changes after implementation is materially complete.
Use `agent-docs/operations/agent-workflow-routing.md` to classify the task, choose the commit path, and decide whether ledger or plan mechanics apply.
Use `agent-docs/operations/verification-and-runtime.md` to choose the truthful verification command set.
When the routed task class requires local audit passes such as `prompt-review`, `coverage-write`, `frontend-review`, or `deep-review`, treat them as mandatory completion steps before handoff, not optional close-out checks after code, tests, or commit. Cross-cutting review is one mutually exclusive lane: local `deep-review` or PR-lane ReviewGPT, never both for the same completed change.
Those required local audit passes are local audit subagent passes (see the model routing in `Audit Worker Rules`), not `review:gpt`, not external ChatGPT autosends, and not `thread wake` workflows.
This completion workflow is standing user approval to spawn the required local Codex audit subagents for routed repo tasks. Do not skip or downgrade a required audit pass because generic agent instructions say subagents need an explicit user request; this document and `AGENTS.md` are that explicit repo-level request for the required completion passes.

**One cross-cutting review gate.** A separate worktree/PR lane still runs every specialist pass triggered by the change: `prompt-review`, `frontend-review`, and `coverage-write`. For ReviewGPT-eligible work, the PR-lane loop in `agent-docs/operations/pr-reviewgpt-loop.md` is the sole cross-cutting merge-readiness gate, so do not also run local `deep-review` even when the change is complex, sensitive, or the user asks for a final bug hunt. When ReviewGPT will not run and the cross-cutting trigger below applies, use local `deep-review` instead. Step 10's parent-owned local final review still runs.
Required workflow audit subagents default to high reasoning. Use xhigh reasoning instead when the change is large, complex, high-risk/cross-cutting, or spans multiple owners, architecture decisions, or trust-boundary decisions. If the current subagent tooling cannot honor the required reasoning effort, report that limitation explicitly instead of silently downgrading the pass.

Final review is not a spawned subagent pass. The parent agent runs an explicit local final review (step 10). For ReviewGPT-eligible PR-lane work, the loop in `agent-docs/operations/pr-reviewgpt-loop.md` is the required final review gate before merge-readiness (rounds fire on push, in parallel with PR CI).
Removed 2026-06-12: the `simplify` and `task-finish-review` subagent passes. June 2026 transcript mining across Codex/Claude sessions and `audit-packages/` artifacts showed `simplify` produced no accepted findings, and `task-finish-review` produced mostly low-severity polish while the specialized passes caught the real local bugs and the post-completion PR ReviewGPT loop caught what the entire local stack missed. The parent-owned scope-and-shape check (step 2) owns simplification; `/simplify` remains available on demand. Removed 2026-07-14: the standalone `security-privacy-review` pass; security-sensitive changes trigger the one cross-cutting review gate instead.

## Outcome and Completion Bar

The outcome is the requested behavior or documentation change, landed at the
smallest correct ownership boundary with truthful proof and no unresolved
accepted review finding. Completion requires the routed verification, required
specialist audits, parent final review, plan/ledger closure, and scoped commit;
PR-lane work additionally requires green CI and, when the change is eligible,
the pushed-head ReviewGPT gate.

Keep the current layer explicit: implementation, local completion, or PR/external
gate. Do not let a later layer repeat policy owned by an earlier one, and do not
silently advance when its prerequisites or authority are missing. A blocked
check or audit ends with the exact gap and best available evidence, not a claim
that the task fully completed.

## ReviewGPT Eligibility

ReviewGPT is a proportional risk gate, not a requirement for every PR. Skip it
when the meaningful diff is low-risk and limited to one or more of:

- docs or process text;
- prompt-primary changes covered by the required local `prompt-review` pass;
- tests, fixtures, or developer tooling that do not change production behavior;
- static copy or content; or
- minor frontend presentation polish such as spacing, typography, color,
  icons, imagery, or responsive containment that does not change the user
  workflow, UI state model, data flow, or authority boundary.

The exemption applies only when the change does not affect a product-critical
flow; auth, privacy, security, billing, or health-safety behavior or claims;
persisted state or schemas; public APIs; runtime or deploy boundaries; or
ordering, retries, concurrency, or idempotency. It also does not apply to broad
refactors or cross-owner changes. When any of those conditions are present, or
the user explicitly requests ReviewGPT, run the normal PR loop.

Skipping ReviewGPT does not skip applicable specialist audits, a required local
`deep-review`, the parent final review, scoped verification, CI, merge-conflict
proof, or the normal commit and PR requirements.

## Sequence

1. Finish the functional implementation first.
   During local iteration, prefer the narrowest truthful verification loop for the task. In practice that is usually `pnpm test:diff <path ...>` for package, app, or low-risk repo-internal workflow/tooling work, or `pnpm verify:acceptance` when the task already clearly needs the full lane.
   A truthful `pnpm test:diff <path ...>` already typechecks the touched owners and reverse dependents; do not run a separate root `pnpm typecheck` before it unless the verification matrix selects the full-workspace fallback.
2. Run a scope and shape check before polish: confirm the diff is still proportional to the task, new abstractions are immediately justified, any new persisted state is explicitly classified and versioned, and any architecture/API/trust-boundary change is documented or split into an explicit plan. This check owns simplification: delete dead code, cut speculative structure, and collapse needless indirection yourself; there is no separate simplify subagent pass.
3. If the change sprawled, duplicated existing patterns, or introduced speculative structure, cut it back before continuing.
4. Decide the audit path required by the routed task class:
   - docs/process-only work normally skips audit subagents unless the user explicitly asks for them
   - really low-impact `apps/web` copy-only edits may skip audit subagents when they only change static text and do not alter layout, UI state, auth, pricing logic, schemas, runtime behavior, or security claims; use local readback and focused checks instead
   - prompt-primary changes use the prompt review path below instead of the normal completion audit stack
   - user-facing `apps/web` UI changes add the dedicated `frontend-review` pass
   - repo code/test/config changes whose verification lane includes owner-level coverage or truthful `pnpm test:diff <path ...>` coverage require the dedicated `coverage-write` pass
   - when the cross-cutting conditions below apply, select exactly one gate: ReviewGPT for an eligible PR lane that will run it, otherwise local `deep-review`
5. When the prompt review path applies, spawn one dedicated audit subagent, hand it `agent-docs/prompts/prompt-review.md` plus the audit handoff packet below, and skip `frontend-review`, `coverage-write`, and cross-cutting review unless the non-prompt part of the diff independently meets those passes' triggers. The prompt-review pass is review-only and is the final completion audit for prompt-primary work.
6. When `frontend-review` applies, spawn a dedicated audit subagent, hand it `agent-docs/prompts/frontend-review.md` plus the audit handoff packet below, and run it before final review. Keep it review-only and scope it to user-facing `apps/web` surfaces plus the frontend guidance in `agent-docs/FRONTEND.md`.
7. Once implementation is stable enough to produce a truthful signal, run the coverage-bearing verification command chosen from the verification doc. Prefer `pnpm test:diff <path ...>` when it already covers the touched owner truthfully; otherwise run the edited owner package/app coverage command required there.
8. When step 7 uses an owner-coverage or truthful diff-coverage lane, run the required `coverage-write` pass using the audit worker routing below. Hand that worker `agent-docs/prompts/coverage-write.md` plus the audit handoff packet below, and keep its write scope limited to tests or direct-proof scaffolding for already-landed behavior.
9. For user-visible, persisted-state, operational, or trust-boundary changes, capture at least one direct scenario check in addition to scripted tests and record the exact evidence. After specialized review and coverage/proof work is stable, select exactly one required cross-cutting gate: ReviewGPT on an eligible PR lane that will use it, otherwise local `deep-review` when the trigger below applies. Never run both for the same completed change. Run a selected local `deep-review` now; a selected ReviewGPT gate runs after push in step 14.
10. Run the final review locally as the parent agent: re-read the full diff with fresh eyes, walk the changed call paths, and check for remaining coverage or proof gaps, residual risks, and handoff completeness. If it finds meaningful missing tests or boundary-level verification, add the smallest high-impact proof before handoff instead of creating another default coverage pass. Do not spawn a final-review subagent; if the change feels too large or risky to final-review locally, that is a signal it belongs on the worktree/PR lane, where the external loop reviews it.
11. Enter the review-resolution loop below for every required audit output. Completion means there are no unresolved accepted/actionable findings, not merely that the audit pass ran.
12. Run or re-run the required checks after the implementation is stable, after any review-driven fixes, and after any required coverage pass lands.
13. Close any active execution plan and use the commit path chosen by the routing doc and `AGENTS.md` before handoff. For plan-bearing work, the final scoped commit must go through `scripts/finish-task <active-plan-path> "summary" <path>...` so the matching ledger row is removed and the plan moves to `agent-docs/exec-plans/completed/`. Do not use `scripts/committer` or `git commit` as the final task commit for plan-bearing work; that commits code while leaving stale active-plan state behind. If overlapping dirty work blocks a safe `finish-task` commit, clear the exact ledger row, archive the plan with `scripts/close-exec-plan.sh`, and report the scoped-commit blocker before handoff.
14. When ReviewGPT is the selected cross-cutting gate, follow `agent-docs/operations/pr-reviewgpt-loop.md` until the exact patch returns `ROUND_OUTCOME: PASS` with zero accepted findings before calling the PR merge-ready. A required anomaly retrospective may justify continuing, shrinking, splitting, redesigning, or abandoning the patch, but it does not substitute for a later `PASS`. An accepted round-five finding may be fixed normally; the five-round cap blocks an automatic sixth review, not remediation. Before requesting or starting a sixth substantive round, pause after the fix and make every other required completion audit, verification check, and PR CI job green, record the cap retrospective, and obtain explicit continuation. Use `ReviewGPT Eligibility` above for the proportional low-risk exemption. The loop doc owns pushed-head proof, browser-lane selection, model/response validation, CI concurrency, rerun rules, and the base-update-only exception. This gate does not replace the specialist passes required above, and it must not be combined with local `deep-review`.
15. For PR-lane work, the task is not complete until the PR branch has no merge conflicts with `main` or its configured base branch. Before final handoff, fetch the latest `main`/base branch and prove the PR head can merge cleanly, or update the branch by a normal merge/rebase, resolve any conflicts, rerun the required checks for the touched surfaces, and push the resolved head. Follow the ReviewGPT loop's base-update and patch-change rerun rules.
16. An open PR remains active, so preserve its task worktree. If the current turn includes confirmed PR merge or closure, apply the task-worktree retirement gate in `agent-docs/operations/agent-workflow-routing.md` before final handoff; preserve and report the checkout when any retirement gate fails.
17. Final handoff must report required-check results, direct scenario evidence, and audit findings accepted, fixed, or rejected with reasons. Green required checks remain the default completion bar; if a required check failed for a credibly unrelated pre-existing reason, handoff must name the failing command, failing target, and why the current diff did not cause it.
    If the completed task could break or degrade production when deployed components are temporarily out of sync, include a final-response section labeled `DEPLOYMENT CONCERNS:` with the recommended safe deployment order, required tandem deploy or compatibility window, expected skew behavior, and post-deploy checks. For Cloudflare hosted execution changes, explicitly consider both web/Worker skew and Worker/container skew: a new Worker version can receive traffic while active warm `RunnerContainer` processes still run the previous runner bundle, process env, or provider-credential shape during gradual rollout.

## PR Description

When opening or updating a PR for worktree/PR-lane work, the PR body must state the PR's intent so reviewers (human and the ReviewGPT loop) judge the diff against the requirement, not against its current runtime state. Keep it tight — a few short sections, not a wall of text.

Required:

- **Why this PR exists.** The user need or product need being solved, in one or two sentences.
- **User goal / user-visible behavior.** What the user can do or experience once this PR ships, stated as the outcome the diff is meant to reach. State this even when the diff temporarily disables, gates, fail-closes, scrubs, or stubs that behavior while wiring is in progress — the goal is the requirement, the disabled state is in-progress wiring.
- **User experience (when applicable).** Outline the end-to-end UX created or
  changed by the PR: where the user enters, the main interaction and feedback
  states, failure or recovery behavior, and what the user experiences next. If
  the PR has no user-facing effect, say so instead of inventing a UX narrative.
- **Invariants the PR must preserve.** The smallest set of correctness/security/exposure/operational invariants reviewers should hold the diff against.
- **Non-obvious affected surfaces.** List every production behavior, shared
  subsystem, workflow, state owner, or deploy/runtime surface changed even
  though it is not an obvious part of the PR's purpose. For each one, explain
  why the change is necessary and name the regression proof. If none exist,
  write `None`. Do not hide a cross-cutting behavior change inside the ordinary
  file summary.
- **Change-shape breakdown.** Added and deleted lines from the base-to-head diff,
  classified as source, tests/fixtures, docs, config/tooling, and
  generated/other. State the classification rule, note binary files, and keep
  generated code separate from authored source. Use a five-row
  `Category | Added | Deleted` table plus a total. This is reviewer orientation
  and a scope-anomaly signal, not a quality target or an automatic merge or
  architecture verdict; moves and generated churn may distort raw counts.

Optional when relevant: the rollout plan or follow-up PR that flips the gate, and any deliberately deferred work.

Also required when relevant:

- **Deployment skew / compatibility.** If the PR changes both sides of a deploy boundary, or changes an assumption shared by web, Cloudflare Worker code, runner container code, runner bundle contents, provider egress credentials, runtime env, or persisted runtime state, state what happens while deployed pieces disagree. For Cloudflare hosted execution, do not assume a Worker deploy instantly replaces every active runner container or child process. Call out whether gradual container rollout can leave warm containers on the old bundle/env/credential shape, whether the change is backward compatible during that window, whether `container_rollout=immediate` is required, and which smoke/log checks prove convergence.
  Include the expected rollout duration, evidenced current member/event volume,
  maximum realistically exposed operations, reversibility, and available
  monitoring or bounded manual repair. Use current scale rather than hypothetical
  future scale so a rare reversible rollout miss is not used to justify replay,
  migration, reconciliation, or persistent compatibility machinery.

This block is the load-bearing input for the PR-lane ReviewGPT loop and any human reviewer; without it, the reviewer may misread a deliberately-disabled wiring state as evidence the functionality should be deleted, or rank a Critical correctness gap as a complexity-collapse opportunity.

## Review-Resolution Loop

Audit outputs are advisory until the parent implementation agent verifies them.
For every finding from a required audit pass:

1. Read the real code path, adjacent files, and relevant tests before accepting the finding. When a finding depends on external behavior, check the dependency's docs, source, or types instead of guessing.
2. Classify the finding as accepted/actionable, rejected, or out of scope. Reject speculative risks, unrealistic edge cases, broad rewrites, and fixes that add more complexity than the bug justifies.
   For deploy-skew or legacy-compatibility findings, require evidence that the
   incompatible state can actually exist outside the current branch before
   accepting a compatibility fix: an already-deployed producer or consumer, a
   rollback window with old code still able to observe new state, existing
   production rows in the legacy shape, or external clients already sending that
   shape. If there is no shipped feature, no affected persisted data, and no real
   rollback/skew window, reject the finding or document the deployment note
   instead of adding repair paths, shims, migrations, queues, or reconciliation
   code.
3. For accepted/actionable findings, fix the smallest correct surface at the right ownership boundary. If repeated findings cluster around one mechanism, pause tactical patching and simplify the mechanism, split or abandon the PR, or explicitly reject the collapse finding.
4. After any review-driven code, test, config, or docs change, rerun the focused verification that proves the changed surface.
5. Rerun the affected audit pass when the fix materially changes that pass's risk surface:
   - rerun `frontend-review` for meaningful UI, interaction, layout, or design-system fixes
   - rerun `coverage-write` only when the accepted finding changes the proof surface and needs write-capable coverage follow-up
   - rerun the already selected cross-cutting gate when an accepted correctness or security finding drives a broad, cross-owner, state-machine, trust-boundary, or concrete exposure fix that materially changes its risk surface; never add or switch to the other cross-cutting gate
   - rerun `prompt-review` when an accepted prompt-review finding materially rewrites the prompt behavior, prompt structure, tool-use policy, evidence rules, or output contract
6. Do not rerun an audit solely for rejected findings, tiny wording changes, isolated test-only proof additions, or to obtain a cleaner final sentence.

Stop the loop when every required audit finding is either fixed/proven or consciously rejected/out of scope with a concise reason, and no unresolved accepted/actionable findings remain.

## Prompt Review Path

Use `prompt-review` as the only required completion audit when all of the following are true:

1. The meaningful behavior change is prompt text, system/developer instructions, agent workflow prompts, tool descriptions, prompt assembly guidance, or regression tests that prove prompt content.
2. Any non-prompt code changes are only mechanical support for prompt assembly, prompt export, or prompt regression proof.
3. The change does not independently alter runtime behavior, schemas, persisted state, app/package APIs, auth/session authority, external ingress/egress, deploy surfaces, billing, frontend layout/interaction, or trust boundaries outside the prompt itself.

Do not add `frontend-review`, `coverage-write`, or cross-cutting review solely because the prompt mentions sensitive topics, user-facing behavior, tools, retrieval, or validation. The prompt-review worker owns prompt-level privacy, security, safety, evidence, validation, simplicity, clarity, and instruction-conflict concerns for prompt-primary work.

If the change is mixed and the non-prompt part independently triggers another pass, run the normal specialized audit path for that non-prompt surface. `prompt-review` is not a substitute for reviewing real runtime, UI, persisted-state, deploy, or trust-boundary changes.

## When To Run Cross-Cutting Review

Require one cross-cutting review when the change is complex or sensitive enough that the specialist passes may miss production bugs. Use ReviewGPT when an eligible PR lane will run it; otherwise use local `deep-review`. These routes are mutually exclusive for the same completed change.

Require the cross-cutting gate when one or more of these conditions apply:

1. The change spans multiple owners, apps, packages, or runtime boundaries and correctness depends on their interaction.
2. The change alters state machines, ordering, idempotency, retries, concurrency, migrations, persisted-state ownership, or fail-closed behavior.
3. The change materially touches sensitive health data, auth/session authority, secrets, billing, external ingress/egress, public APIs/routes, hosted execution, Cloudflare, Temporal, persisted/uploaded/user-facing data exposure, or another trust-boundary surface.
4. The implementation is a large or high-risk refactor where a first-principles bug hunt is likely to find edge cases that `coverage-write` or `frontend-review` alone may not catch.
5. The user explicitly asks for deep review, a final bug hunt, or a production edge-case sweep as part of completion.

If ReviewGPT is selected, an explicit request for deep review or a final bug hunt is satisfied by that PR gate and does not add a local `deep-review`. If ReviewGPT is opted out or unavailable and a condition above applies, use local `deep-review` instead and report the route change. Do not use either cross-cutting gate as a replacement for `frontend-review` or `coverage-write`. If none of the conditions above apply, skip cross-cutting review and proceed through the normal completion workflow.

## Tiny Copy-Only Fast Path

Skip `frontend-review` and `coverage-write` subagents for very small `apps/web` copy-only edits when all of the following are true:

1. The diff only changes static user-facing text.
2. The change does not alter layout, styling, UI state, component structure, auth, billing/pricing logic, schemas, routes, API behavior, runtime code, or security claims.
3. Local readback plus focused checks cover the changed surface.

Use focused component/page tests, typecheck, `git diff --check`, and stale-string searches as appropriate. If the copy change touches claims about security, billing, medical outcomes, or product guarantees, leave this fast path and use the normal review workflow.

## Audit Worker Rules

- Codex-native agents run all required completion audit passes as spawned local subagents. Do not use `codex exec` from Codex to satisfy these passes.
- Claude (and other non-Codex) parent agents run every required local completion audit pass (`prompt-review`, `coverage-write`, `frontend-review`, `deep-review`) on Codex `gpt-5.6-sol` through the local Codex CLI. Use non-interactive `codex exec -m gpt-5.6-sol -c 'model_reasoning_effort="high"'` with stdin closed (for example, `</dev/null`); use `xhigh` only under the complexity rule below. An operator alias is acceptable only when it selects the same model and effort. When `MURPH_AUDIT_CODEX_HOME` is set, pass it as `CODEX_HOME`; otherwise use normal Codex home resolution. Do not run a required pass on the non-Codex parent's model or another model family while the Codex CLI is available. A rejected or unavailable explicit model is a routing failure: do not rerun without `-m` and inherit a profile default. If the exact model, CLI, or CLI auth is unavailable, report that limitation and run the pass on the parent's current model instead of skipping it or silently using an older Codex model.
- All required audit subagents use high reasoning by default. Use xhigh reasoning for large or complex changes, high-risk/cross-cutting changes, or audits that span multiple owners, architecture decisions, or trust-boundary decisions.
- `prompt-review` is a review-only pass for prompt-primary changes. Every run must read the current GPT-5.6 prompting guide at `https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6.md`. Read the latest-model and GPT-5.6 Sol migration guides too only when the change concerns model selection, API migration, reasoning effort, or optional model features. It inspects the affected assembled prompt stack and tool descriptions for deletion opportunities, clear outcomes/success/evidence/stop rules, stable-versus-dynamic placement, action scope, current model assumptions, conflicts, and unnecessary scaffolding.
- `coverage-write` is the default write-capable audit pass, follows the model routing above, and stays narrowly scoped to truthful tests or direct-proof scaffolding for the changed behavior. A passing coverage number alone is not the completion bar, and existing sufficient proof is a valid no-edit result.
- `frontend-review` is a review-only pass for user-facing `apps/web` pages, components, and design-system-facing UI. It reads `agent-docs/FRONTEND.md`, preserves established tokens/components/patterns, and renders the changed experience at relevant desktop/mobile viewports and touched states when visual behavior changed. If rendered inspection is unavailable, it records the verification gap instead of guessing from source.
- `deep-review` is the review-only cross-cutting gate when ReviewGPT will not run. It should use `murph-deep-review`, load `feynman-auditor`, follow modified files plus directly affected call paths, and focus on final bugs or edge cases that could still break the change in production.
- Other audit passes are review-only unless the user explicitly asks for a write-capable audit worker with a widened scope.
- The default audit response contract is plain-text findings with recommended fixes, not patch attachments and not prompts for additional agents.
- Every audit reports only evidence-backed findings and has an explicit valid zero-finding stop state. The parent reconciles overlaps or conflicts across passes, validates each finding against the real path, and owns the final synthesis.
- Do not satisfy `prompt-review`, `coverage-write`, or `frontend-review` with `pnpm review:gpt`, ReviewGPT presets, external ChatGPT threads, or managed-browser/`thread wake`/autosend flows. ReviewGPT and local `deep-review` are mutually exclusive cross-cutting gates. Prompt-primary PRs use `prompt-review` and do not run ReviewGPT unless non-prompt scope independently requires the loop; eligible PRs must still reach zero accepted findings before merge.
- If a spawned subagent cannot itself spawn another worker, it must report that limitation back to the parent agent rather than substituting an external review workflow.
- Review-mode audit subagents must not edit files, run `scripts/committer`, run `scripts/finish-task`, invoke `git commit`, or otherwise create commits.
- Prefer a fresh non-forked handoff packet over inheriting the full implementation thread. Widen context only when a specific review question cannot be answered from the narrowed packet.
- Use a fresh subagent per required pass unless the user explicitly instructs otherwise.
- Close audit subagents promptly after they return, time out, or are judged stuck.
- If a Codex-native parent cannot spawn the required audit subagent, stop and
  report the tooling blocker; parent self-review does not satisfy the independent
  pass. For a non-Codex parent whose local Codex CLI route is unavailable, use
  only the explicitly reported parent-model fallback defined above. Never
  silently inherit an older or unverified model.

## Audit Handoff Packet

For each required audit subagent, provide:

- What changed and why at the behavior level.
- Why the chosen implementation fits the existing system, especially when it introduces or extends abstractions.
- Invariants or assumptions that must still hold.
- Links to active execution plans when present.
- Verification evidence already run, including commands and outcomes.
- Any direct scenario proof already run, or the exact gap if it still needs human verification.
- Current working-tree context and explicit review boundaries.
- The declared action mode: review-mode audits may not edit files;
  `coverage-write` may edit only its pre-declared test/proof scope. No audit
  worker may run commit helpers or create commits.
- Instruction to read `COORDINATION_LEDGER.md`, honor any explicit exclusive/refactor notes, and otherwise work carefully on top of overlapping rows.

For the required `frontend-review` pass, also provide:

- The exact user-facing `apps/web` surfaces under review, including pages/components and any related shared UI primitives.
- An explicit instruction to read `agent-docs/FRONTEND.md` before reviewing.
- The product/user outcome the UI is meant to support so the review can judge polish against intent rather than taste alone.
- Any screenshots, local dev notes, or direct scenario evidence already gathered, or the exact gap if visual verification still needs a human/browser pass.

For the required `coverage-write` pass, also provide:

- The exact coverage-bearing command or commands required for the task plus the current pass/fail status or the most relevant failing-output summary.
- The exact write scope, limited to tests or proof scaffolding for already-landed behavior.
- An explicit instruction not to modify production code unless the parent agent separately widens that scope.
- The required routing/model choice from the audit worker rules above; do not silently substitute a mini model, a different model family, or a lower/different reasoning effort for this pass.

For the required `prompt-review` pass, also provide:

- The exact prompt surfaces under review, including files, exported prompt builders, tool descriptions, or tests that prove prompt content.
- Why the change qualifies as prompt-primary and which normal audit passes are being skipped under this path.
- The intended prompt behavior and any product, safety, evidence, retrieval, tool-use, validation, or output-contract invariants the prompt must preserve.
- An explicit instruction to read `agent-docs/prompts/prompt-review.md` and the current OpenAI prompt guidance before reviewing.

For the required `deep-review` pass, also provide:

- The exact files, packages, commits, or call paths in scope.
- The condition from `When To Run Cross-Cutting Review` that made the pass required and confirmation that ReviewGPT will not run for the same completed change.
- Any state-machine, ordering, idempotency, retry, owner-boundary, persisted-state, or sensitive-boundary assumptions the implementation relies on.
- An explicit instruction to use `murph-deep-review`, load `feynman-auditor`, keep the pass review-only, and answer: "What final bugs or edge cases could still break this change in production?"
- Any direct scenario proof already gathered, or the exact gap if production-risk proof remains incomplete.

## Safety Rules

- Do not overwrite, discard, or revert unrelated working-tree edits in the current checkout.
- Audit workers use the parent-selected checkout or worktree. They must not create
  or switch branches, create helper worktrees, commit, push, or widen their
  declared authority. The parent follows the task-class worktree and commit route
  in `agent-docs/operations/agent-workflow-routing.md`.
- Do not use reset or checkout cleanup commands to prepare audit passes.
- If an audit suggestion conflicts with pre-existing edits, leave the file untouched and escalate in handoff notes.
- Treat green checks as necessary but not sufficient when the changed behavior has a user-visible or operational boundary; require direct proof or call out the missing proof explicitly.
