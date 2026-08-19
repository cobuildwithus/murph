# Completion Workflow

Last verified: 2026-08-19

This workflow applies to repo code/docs/test/config changes after implementation is materially complete.
Use `agent-docs/operations/agent-workflow-routing.md` to classify the task, choose the commit path, and decide whether plan mechanics apply.
Use `agent-docs/operations/verification-and-runtime.md` to choose the truthful verification command set.
Product UX, prompt, frontend, and coverage audits run together in one preliminary
`completion-specialists` ReviewGPT pass against an exact pushed PR head. That
pass applies the relevant lenses before the parent's final review. When a
separate final ReviewGPT gate also
applies, final round 1 may start concurrently with the specialist pass against
the same exact pushed candidate head.

The preliminary pass is review-only with one narrow artifact exception:
ReviewGPT may return `reviewgpt-coverage.patch` containing only tests, fixtures,
or direct-proof scaffolding for reported coverage findings. The parent treats
the artifact as untrusted intent, checks every path and hunk, applies it
deliberately, and reruns the canonical verification command. ReviewGPT never
mutates the checkout, commits, or pushes.

The fallback `deep-review` remains the only routed local audit subagent pass.
This workflow and `AGENTS.md` are standing permission to spawn that pass when
its trigger applies and the final ReviewGPT gate will not run. It defaults to
high reasoning and uses xhigh for large, complex, high-risk, multi-owner,
architecture, or trust-boundary reviews.

**One cross-cutting gate.** ReviewGPT-eligible work uses the final PR-lane loop
as the sole cross-cutting merge-readiness gate; do not also run local
`deep-review`. When the final ReviewGPT gate will not run and the cross-cutting
trigger applies, use local `deep-review` instead. After focused local proof and
the parent's candidate review, the final gate may establish its immutable
round-one baseline concurrently with the preliminary specialist pass on the
same exact pushed head. If either stage finds an accepted issue, later final
rounds verify the combined remediation delta without resetting that baseline.

Final review is not a spawned subagent pass. The parent runs an explicit local
final review after all accepted preliminary and final-gate findings are
resolved.
Removed 2026-06-12: the `simplify` and `task-finish-review` subagent passes. June 2026 transcript mining across Codex/Claude sessions and `audit-packages/` artifacts showed `simplify` produced no accepted findings, and `task-finish-review` produced mostly low-severity polish while the specialized passes caught the real local bugs and the post-completion PR ReviewGPT loop caught what the entire local stack missed. The parent-owned scope-and-shape check (step 2) owns simplification; `/simplify` remains available on demand. Removed 2026-07-14: the standalone `security-privacy-review` pass; security-sensitive changes trigger the one cross-cutting review gate instead.
Replaced 2026-07-22: the separate local `prompt-review`, `frontend-review`, and
write-capable `coverage-write` workers. Their lenses now run together in the
preliminary `completion-specialists` ReviewGPT pass; bounded coverage proof may
return as a patch artifact for parent-controlled application.
Replaced 2026-07-29: the separate local product-experience worker. Product UX
planning, walkthrough, and review rules now live in
`agent-docs/operations/product-ux.md` and run as one conditional lens in that
same preliminary exact-head ReviewGPT pass.

## Outcome and Completion Bar

The outcome is the requested behavior or documentation change, landed at the
smallest correct ownership boundary with truthful proof and no unresolved
accepted review finding. Completion requires the routed verification, the
preliminary specialist ReviewGPT pass when any lens applies, parent final
review, plan closure, and scoped commit. User-facing frontend UI work also
requires direct evidence matched to the changed claim;
PR-lane work additionally requires green CI and, when the change is eligible,
the separate final pushed-head ReviewGPT gate.

Every PR must also make one explicit changelog decision before the review
candidate is pushed. A member-visible feature or improvement, including a
meaningful reliability, recovery, performance, accessibility, copy, or UX
change, adds an isolated item under `apps/web/changelog/entries/` in the same PR
using `$write-changelog`. Internal-only work records a concrete not-applicable
reason in the PR body. Never publish private evidence, security-sensitive
implementation detail, or an outcome the shipped code does not prove.

Keep the current layer explicit: implementation, local completion, or PR/external
gate. Do not let a later layer repeat policy owned by an earlier one, and do not
silently advance when its prerequisites or authority are missing. A blocked
check or audit ends with the exact gap and best available evidence, not a claim
that the task fully completed.

## Final ReviewGPT Eligibility

The final ReviewGPT gate is a proportional risk gate, not a requirement for
every PR. Skip it
when the meaningful diff is low-risk and limited to one or more of:

- docs or process text;
- prompt-primary changes covered by the preliminary specialist ReviewGPT pass;
- tests, fixtures, or developer tooling that do not change production behavior;
- static copy or content; or
- frontend-only `apps/web` changes whose meaningful production diff stays in
  client-rendered presentation and interaction, including component structure,
  local UI state, semantic copy, accessibility, styling, icons, imagery, or
  responsive behavior.

Frontend-only means the PR does not change a server action or route,
middleware, shared backend package, persistence or schema, authorization or
permission logic, billing, health-safety logic, external ingress or egress,
runtime or deploy behavior, production configuration, or a cross-owner
protocol. A UI may change its user workflow or local display state and still
qualify; the preliminary Product UX, frontend, and coverage lenses own
those frontend concerns.

The exemption applies only when the change does not affect auth, privacy,
security, billing, health-safety, irreversible-effect, or other trust-boundary
behavior or claims; persisted state or schemas; public APIs; runtime or deploy
boundaries; or ordering, retries, concurrency, or idempotency. It also does not
apply to broad or high-risk refactors, cross-owner changes, or any other
cross-cutting-review trigger below. When any of those conditions are present,
or the user explicitly requests the final ReviewGPT audit, run the normal PR
loop.

Every PR that enters the final ReviewGPT loop must contain exactly one
machine-readable `ReviewGPT context sensitivity: routine` or
`ReviewGPT context sensitivity: sensitive` line. Classify it as `sensitive`
when any exemption-disqualifying condition above or cross-cutting condition
below applies, even when the patch is tiny. A cosmetic change or small bug fix
is `routine` only when none of those conditions apply. The packager treats a
missing, malformed, or duplicate declaration as `undeclared` and re-sends the
full guarded snapshot rather than assuming the PR is routine.

Skipping the final ReviewGPT gate does not skip the preliminary specialist
ReviewGPT pass, a required local `deep-review`, the parent final review, scoped
verification, CI, merge-conflict proof, or the normal commit and PR
requirements.

## Product and Rendered Review Admission

Route specialist review by the dimension changed, before evaluating final
ReviewGPT eligibility. A product-owned dimension is semantic user-facing copy;
user-visible action purpose, count, or priority; required interaction steps; UI
state selection and visible feedback or progress; user-visible element or
screen existence; asynchronous continuation or wake ownership; or the
journey's timing, delivery, permission, and recovery contract.

Before implementation, user-facing work also follows
`agent-docs/operations/product-ux.md`. Classify it as a Patch, Product change,
or Feature. Plan the affected people at the matching depth. After
implementation, complete the Product UX Walkthrough before candidate review.
The Product UX lens checks that plan and walkthrough inside the existing
preliminary pass.

| Changed dimension | Product-decision owner | Rendered-implementation route |
| --- | --- | --- |
| Any product-owned dimension, including one changed through a prompt | Run the Product UX lens in the preliminary specialist ReviewGPT pass | Add the prompt lens when prompt-primary; add the frontend lens when `apps/web` presentation changes |
| Prompt-primary change with no product-owned dimension | No product-decision review | Run the preliminary prompt lens only |
| Meaning-preserving tiny static-copy correction | No product-decision review | Use the tiny copy-only fast path |
| Implementation-only presentation with no product-owned dimension | No product-decision review | Run the preliminary frontend lens |

Final ReviewGPT eligibility is independent and evaluated afterward. An
exemption never waives an applicable preliminary lens. The preliminary
frontend lens and final ReviewGPT gate never become fallback
product-decision owners.

## Sequence

1. Finish the functional implementation first.
   During local iteration, run the smallest focused test, typecheck/lint/build
   check, or direct scenario that exercises the changed behavior. For PR-bound
   work, do not run `pnpm test:diff`, `pnpm test`, `pnpm test:coverage`, or
   `pnpm verify:acceptance` merely to open or update the PR; exact-head GitHub
   Actions own the broad suite. If CI fails, reproduce its failing owner or
   scenario with the narrowest useful local command and expand only when the
   evidence requires it. Before a direct push to `main` or another shared
   default branch, reconcile the exact candidate and run
   `pnpm verify:acceptance` once for that push attempt. If the remote advances
   while it runs, do not restart full acceptance solely because the base moved;
   follow the one-rebase direct-push rule in `verification-and-runtime.md`.
2. Run a scope and shape check before polish: confirm the diff is still proportional to the task, new abstractions are immediately justified, any new persisted state is explicitly classified and versioned, and any architecture/API/trust-boundary change is documented or split into an explicit plan. This check owns simplification: delete dead code, cut speculative structure, and collapse needless indirection yourself; there is no separate simplify subagent pass.
   During this check, invoke `$write-changelog` and classify the change. Add a
   same-PR changelog item for every member-visible outcome, or record the
   concrete internal-only reason that makes the changelog not applicable. Keep
   related fixes under one user outcome while preserving every contributing
   source PR. For priority-5 or interaction-heavy changes, add a responsive
   explanatory visual when the behavior can be shown truthfully. Route
   capability, authentication semantics, health-data ownership, consent scope,
   reward ownership, and connection status remain facts of their existing
   production owners: reuse or mechanically check those owners instead of
   restating their state in changelog fixtures. Delete a visual when accurate
   prose is simpler than creating a parallel authority. For asynchronous,
   scheduled, or detached claims, trace the exact invocation scope, channel,
   audience, current-input requirement, final destination, and retry or
   reconciliation behavior. Do not
   infer scheduled or cross-channel availability from a tool's ordinary
   private-conversation availability, and do not depict completion unless the
   production authorization and delivery owners prove that exact path. A
   simpler choice inside one consent scope must not be described as merging
   independently selectable permissions; name those scopes explicitly when
   production still lets a member approve them separately. For feedback and
   support summaries, distinguish silent best-effort capture from visible
   acknowledgement, and distinguish raw-field exclusion or deterministic
   pattern scrubbing from semantic removal of all private or health meaning.
3. If the change sprawled, duplicated existing patterns, or introduced speculative structure, cut it back before continuing.
4. Decide the audit path required by the routed task class:
   - docs/process-only work normally skips completion audits unless the user explicitly asks for them
   - meaning-preserving `apps/web` typo, punctuation, grammar, or equivalent localization corrections may use the tiny copy-only fast path
   - prompt-primary changes activate the prompt lens in the preliminary specialist ReviewGPT pass; when the prompt also changes a product-owned dimension, activate the Product UX lens too
   - user-facing `apps/web` UI changes outside the copy-only fast path activate
     the frontend lens and require enough redacted rendered evidence to judge
     each material visual, state, interaction, and responsive claim
   - the coverage lens applies when the diff changes executable behavior or changes the tests, fixtures, configuration, or direct-proof scaffolding that establishes its proof; this does not depend on running a local coverage umbrella command
   - any product-owned dimension activates the Product UX lens, especially for asynchronous, proactive, cross-actor, permission, latency, ordering, delivery, or recovery flows
   - when the cross-cutting conditions apply, select exactly one final gate: final ReviewGPT when eligible, otherwise local `deep-review`
5. Once implementation is stable, run the focused local proof selected from the
   verification doc. Record the exact commands and outcomes. For PR-bound work,
   broad coverage remains pending until exact-head CI completes; for a direct
   shared-default push, run `pnpm verify:acceptance`.
6. For user-visible, persisted-state, operational, or trust-boundary changes,
   complete the Product UX Walkthrough with direct evidence in addition to
   scripted tests. Match the evidence to each affected person's changed claim.
   Inspect every material changed state and each viewport where the result can
   differ. Check phone and desktop when responsive behavior can change; do not
   add a second viewport only to meet a quota. Use the real page for journey
   proof. Use `/screenshots` only when a difficult or reusable presentation
   state needs stable synthetic data. Prefer an attached in-app Browser when
   available, then use the
   repository-installed Playwright runtime when no tab is attached or the
   connection is unusable. Report a browser-proof blocker only when the
   material visual claim cannot be judged after the applicable fallback. For
   user-facing `apps/web` work, package only the selected redacted rendered
   evidence that helps a reviewer judge the changed claim.
7. Commit and push a review candidate from the task worktree, open or update the PR, and keep any active plan open. For plan-bearing work this is an intermediate scoped commit, not the final task commit; `scripts/finish-task` still owns plan closure later. Ensure the PR body contains the outcome, Product UX result, direct evidence, changelog decision, and any risk details required below.
8. Prepare exactly one preliminary `completion-specialists` ReviewGPT pass against that pushed head using `agent-docs/operations/pr-reviewgpt-loop.md` § Preliminary Specialist Pass. This pass applies every relevant Product UX, prompt, frontend, and coverage lens together and does not establish or advance the final ReviewGPT round baseline. A tooling/evidence `INVALID` result is corrected and retried as the same pass; a substantive result is one specialist pass, not four audits.
9. When the final ReviewGPT gate is selected, establish its immutable round-one baseline on the same exact pushed candidate head and launch the preliminary pass and final round 1 concurrently. When the final gate does not apply, launch the preliminary pass by itself. The candidate must already have focused local proof and a parent candidate review, but preliminary findings, plan closure, and the parent's final review do not need to finish before both ReviewGPT jobs start. Run both jobs concurrently with CI and keep their outputs and state separate.
10. Triage every finding from both ReviewGPT stages locally. Download a returned `reviewgpt-coverage.patch` only from the exact owned specialist thread, inspect its full contents and paths, prove it touches only tests/fixtures/direct-proof scaffolding, run `git apply --check`, then apply it deliberately if accepted. Never pipe a downloaded artifact directly into `git apply`. Implement accepted findings in the parent, rerun focused proof, commit, and push one combined corrected candidate. When accepted Product UX remediation materially changes a product-owned dimension, the parent must reapply `agent-docs/operations/product-ux.md` § Review Ownership to that corrected pushed head and updated direct journey evidence, then record the refreshed product purpose verdict. This is a bounded parent revalidation, not another subagent or ReviewGPT invocation. Do not rerun the preliminary pass after a substantive result; use the final gate's next substantive round to verify all behavior-bearing remediation, including specialist-driven fixes. The final-gate packager chooses a fresh full audit for a sensitive, undeclared, or large current PR and a same-thread correction delta only for an explicitly routine PR below both size cutoffs.
11. Enter the review-resolution loop below. Completion means there are no unresolved accepted/actionable findings, not merely that both jobs ran. The applicable specialist result must be `SPECIALIST_OUTCOME: PASS` or have every accepted finding resolved, and the final gate must reach `ROUND_OUTCOME: PASS` with zero accepted findings.
12. Rerun the focused local checks affected by remediation, then push so required CI evaluates the exact new PR head. If CI fails, diagnose from the narrowest reproducer outward. For a direct shared-default push, rerun `pnpm verify:acceptance` against the final reconciled candidate.
13. Run the final review locally as the parent agent after findings from both ReviewGPT stages are resolved: re-read the full diff with fresh eyes, walk changed call paths, inspect any applied coverage patch in context, and check for remaining proof gaps, residual risks, and handoff completeness. Do not spawn a final-review subagent. If that review causes a behavior-bearing change, push it and run the required next final-gate round.
14. Close any active execution plan and create the final scoped commit through the path chosen by the routing doc and `AGENTS.md`; push the resulting head. Include every public-safe Frog entry created or modified during the task in that same scoped commit; do not finish with a task-owned entry untracked, unstaged, or omitted. For plan-bearing work, use `scripts/finish-task <active-plan-path> "summary" <path>...` so the plan is archived. If overlapping dirty work blocks safe closure, preserve the Frog entry, archive the plan with `scripts/close-exec-plan.sh` and report the scoped-commit blocker.
15. For PR-lane work, fetch the latest `main` or configured base and run `git merge-tree --write-tree HEAD origin/<base>` before final handoff. Green required CI on the PR-authored head plus a clean current-base merge-tree is sufficient preparation; do not merge or rebase only to chase a base that can move again while CI runs. If the merge-tree reports conflicts during preparation, update the branch normally, resolve and inspect them, rerun affected proof and required CI, and push. At an authorized merge boundary, wait only for routed review gates and required GitHub checks. If strict up-to-date checks block the merge, prefer the repository merge queue; otherwise perform at most one normal base update for the unchanged reviewed patch, inspect conflicts, run affected proof, and let required CI gate that head. If the base advances again after it is green, never perform a second base update or restart CI: rerun the merge-tree and use an already-authorized non-refresh merge path when clean, or report `moving-base race` and stop with the PR and worktree active. Do not start repeated base-refresh/CI loops during preparation. Follow the ReviewGPT loop's exact terminal, base-update, and patch-change rules.
16. An open PR remains active, so preserve its task worktree. If the current turn includes confirmed PR merge or closure, run `scripts/retire-worktree <path>` from another checkout before final handoff. The command is the mandatory task-worktree retirement gate defined in `agent-docs/operations/agent-workflow-routing.md`; preserve and report the checkout when it fails closed.
17. Final handoff must report required-check results, direct scenario evidence,
    the preliminary specialist lens verdicts, Product UX purpose
    verdict when that lens applies, patch-artifact disposition, and all audit
    findings accepted, fixed, or rejected with reasons. Green required checks remain the
    default completion bar; if a required check failed for a credibly unrelated
    pre-existing reason, name the command, failing target, and why the current
    diff did not cause it.
    If the completed task could break or degrade production when deployed components are temporarily out of sync, include a final-response section labeled `DEPLOYMENT CONCERNS:` with the recommended safe deployment order, required tandem deploy or compatibility window, expected skew behavior, and post-deploy checks. For Cloudflare hosted execution changes, explicitly consider both web/Worker skew and Worker/container skew: a new Worker version can receive traffic while active warm `RunnerContainer` processes still run the previous runner bundle, process env, or provider-credential shape during gradual rollout.

## PR Description

Keep the PR body short. It is still review input, so it must state the intended
outcome instead of describing only the current implementation.

Every PR includes:

- **Why and outcome.** State the need and the result in one or two short
  paragraphs.
- **Product UX.** For a user-facing change, name the effort level and record the
  `Ready` or `Hold` walkthrough result. Summarize the affected people, material
  exclusions, and any difference from the approved plan. For internal work,
  state why Product UX does not apply.
- **Evidence.** List the direct journey proof and focused checks. For frontend
  work, state the changed states and viewports. Link screenshots only when they
  add proof. There is no screenshot quota and no required catalog link.
- **Change-shape breakdown.** Report added and deleted lines from the
  base-to-head diff, classified as source, tests/fixtures, docs,
  config/tooling, and generated/other. State the classification rule, note
  binary files, and keep generated code separate from authored source. Use a
  five-row `Category | Added | Deleted` table plus a total. This is reviewer
  orientation and a scope-anomaly signal, not a quality target or an automatic
  merge or architecture verdict; moves and generated churn can distort raw
  counts.
- **Deployment concerns.** Add exactly one `## Deployment concerns` section.
  Select `Deployment: applicable` and complete the deployment contract when the
  change crosses a deploy boundary; otherwise select
  `Deployment: not applicable` with a concrete reason. The pull-request
  evidence guard validates this section.
- **Changelog.** Add exactly one `## Changelog` section with
  `Changelog: updated` and its item IDs, or `Changelog: not applicable` with a
  concrete reason. The changelog guard validates this section.

Complete this launch preflight before starting PR gates:

1. Write the complete PR body first. Confirm it contains exactly one
   `## Changelog` section and exactly one `## Deployment concerns` section,
   including a concrete reason when either disposition is `not applicable`.
2. When final ReviewGPT applies, resolve the candidate with
   `git rev-parse HEAD`—never `git rev-parse --short HEAD`—prove that full
   40-character SHA equals the pushed PR head, and add the exact line
   `ReviewGPT first-reviewed head: <full-sha>` to the body.
3. Re-read the rendered PR body and confirm the changelog, deployment, Product
   UX, evidence, and ReviewGPT metadata required for this task are present
   before launching ReviewGPT. An incomplete body is a launch blocker, not a
   finding to repair after a review has started.
4. Start applicable ReviewGPT passes concurrently with CI immediately after
   this preflight. Do not wait for CI to finish. Later PR-body-only edits
   retrigger Pull Request Evidence but do not change the reviewed commit
   baseline.

Use this form when the changelog changed:

```markdown
## Changelog
- Changelog: updated
- Items: 2026-08-09 · stable-item-id
```

Use this form when members cannot see the change:

```markdown
## Changelog
- Changelog: not applicable
- Reason: Internal workflow and review tooling only.
```

Use this form when the change crosses a deploy boundary:

```markdown
## Deployment concerns
- Deployment: applicable
- Supported skew: Old and new readers accept both deployed record shapes.
- Safe order: Deploy the backward-compatible reader before the new writer.
- Rollback floor: Rollback stays safe until the new writer publishes state.
- Expected exposure: At most one rollout window can observe mixed versions.
- Reversibility: Disable the writer before reverting the compatible reader.
- Convergence proof: Smoke confirms every instance reports the new version.
- Post-deploy checks: Verify the version and inspect bounded error aggregates.
```

Use this form when deployment concerns do not apply:

```markdown
## Deployment concerns
- Deployment: not applicable
- Reason: Internal review tooling does not change a runtime deploy boundary.
```

Add a **Risks** section only when the changed path needs it. Include the
smallest useful details for the applicable risk:

- correctness, security, privacy, consent, billing, health-safety, or exposure
  invariants;
- non-obvious owners, affected surfaces, architecture choices, or new
  abstractions;
- hot reply path calls and timing;
- maximum-cardinality database fanout and concurrency;
- complete provider-visible input measurements;
- deliberately deferred work.

When one of these paths changes, include its real proof rather than a generic
sentence:

- For the foreground reply critical path, list each added or moved database,
  network, provider, and awaited call. Include maximum counts, ordering,
  timeout, retry, fallback, latency, and before/after proof.
- For a database-touching collection path, report the composed
  maximum-cardinality query count, peak pooled connections, concurrent
  transactions, external or crypto work, and boundary revalidation proof.
- For a provider-input surface, render the complete first provider-visible
  request for representative individual and group turns at base and head. Use
  identical fixtures and the target model tokenizer. Report absolute and delta
  tokens and UTF-8 bytes, and attribute the change across instructions,
  tool/schema/generated guidance, and other provider-visible fields. Do not
  claim a measured zero from authored prompt text alone.

For an applicable deploy boundary, the dedicated `## Deployment concerns`
section must state the supported skew, safe order, rollback floor, expected
exposure, reversibility, convergence proof, and post-deploy checks. Use
evidenced current scale, not hypothetical future scale.

Before the final ReviewGPT gate starts, add exactly one machine-readable
`ReviewGPT context sensitivity: routine` or
`ReviewGPT context sensitivity: sensitive` line with a short reason. A missing
or malformed line stays fail-safe: the packager treats the PR as undeclared and
sends a full guarded snapshot. PRs that do not enter that gate do not need the
line.

The applicable invariant and review docs own the required content for each
risk and deploy boundary. Do not paste empty risk sections, the full work plan,
or a repeated list of review lenses into every PR.

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
5. Rerun an affected local or final-gate pass when the fix materially changes its risk surface:
   - when accepted Product UX remediation materially changes a product-owned dimension, push the corrected candidate and have the parent reapply `agent-docs/operations/product-ux.md` § Review Ownership to that head and updated direct journey evidence, recording a refreshed product purpose verdict; this is required corrected-head revalidation, not a local subagent or another ReviewGPT run
   - rerun the already selected cross-cutting gate when an accepted correctness or security finding drives a broad, cross-owner, state-machine, trust-boundary, or concrete exposure fix that materially changes its risk surface; never add or switch to the other cross-cutting gate
   - do not rerun the preliminary specialist ReviewGPT pass for substantive findings or its returned coverage patch; it is intentionally one combined pass, and the parent final review plus any applicable final ReviewGPT full-patch gate review the resulting correction
   - retry the preliminary specialist pass only when it returned `SPECIALIST_OUTCOME: INVALID` because its exact-head, source, attachment, or rendered evidence was unusable
6. Do not rerun an audit solely for rejected findings, tiny wording changes, isolated test-only proof additions, or to obtain a cleaner final sentence.

Stop the loop when every required audit finding is either fixed/proven or consciously rejected/out of scope with a concise reason, and no unresolved accepted/actionable findings remain.

## Preliminary Specialist Applicability

The preliminary `completion-specialists` ReviewGPT pass applies at least one
of four lenses. Product-owned work activates the Product UX lens under
`Product and Rendered Review Admission`. Prompt-primary work activates the
prompt lens when all of the following are true:

1. The meaningful behavior change is prompt text, system/developer instructions, agent workflow prompts, tool descriptions, prompt assembly guidance, or regression tests that prove prompt content.
2. Any non-prompt code changes are only mechanical support for prompt assembly, prompt export, or prompt regression proof.
3. The change does not independently alter runtime behavior, schemas, persisted state, app/package APIs, auth/session authority, external ingress/egress, deploy surfaces, billing, frontend layout/interaction, or trust boundaries outside the prompt itself.

Prompt-primary classification never suppresses `Product and Rendered Review
Admission`: a prompt that changes a product-owned dimension also activates the
Product UX lens in the same preliminary pass. Merely mentioning
sensitive topics, user-facing behavior, tools, retrieval, or validation does
not activate the Product UX, frontend, or coverage lenses or the final
cross-cutting gate. The preliminary prompt lens owns prompt-level privacy,
security, safety, evidence, validation, simplicity, clarity, and
instruction-conflict concerns.

If the change is mixed, activate every preliminary lens and final gate whose
trigger independently applies. The prompt lens is not a substitute for
reviewing real runtime, UI, persisted-state, deploy, or trust-boundary changes.

## When To Run Cross-Cutting Review

Require one cross-cutting review when the change is complex or sensitive
enough that the preliminary specialist pass may miss production bugs. Use the
final ReviewGPT gate when eligible; otherwise use local `deep-review`. These
routes are mutually exclusive for the same completed change.

Require the cross-cutting gate when one or more of these conditions apply:

1. The change spans multiple owners, apps, packages, or runtime boundaries and correctness depends on their interaction.
2. The change alters state machines, ordering, idempotency, retries, concurrency, migrations, persisted-state ownership, or fail-closed behavior.
3. The change materially touches sensitive health data, auth/session authority, secrets, billing, external ingress/egress, public APIs/routes, hosted execution, Cloudflare, Temporal, persisted/uploaded/user-facing data exposure, or another trust-boundary surface.
4. The implementation is a large or high-risk refactor where a first-principles bug hunt is likely to find edge cases that the preliminary coverage or frontend lens may not catch.
5. The user explicitly asks for deep review, a final bug hunt, or a production edge-case sweep as part of completion.

If the final ReviewGPT gate is selected, an explicit request for deep review or
a final bug hunt is satisfied by that gate and does not add local
`deep-review`. If the final gate is opted out or unavailable and a condition
above applies, use local `deep-review` instead and report the route change. Do
not use either cross-cutting route as a replacement for the preliminary
specialist pass. If none of the conditions above apply, skip the later
cross-cutting review.

## Tiny Copy-Only Fast Path

Skip the preliminary specialist ReviewGPT pass for very small `apps/web`
copy-only edits when all of the following are true:

1. The diff only changes static user-facing text.
2. The correction preserves meaning and is limited to a typo, punctuation,
   grammar, or equivalent localization fix. It does not add, remove, or change
   instructions, action framing, hierarchy, explanatory content, onboarding,
   permission or confirmation language, state copy, or a product promise.
3. The change does not alter layout, styling, UI state, component structure,
   auth, billing/pricing logic, schemas, routes, API behavior, runtime code, or
   security claims.
4. Local readback plus focused checks cover the changed surface.

Use focused component/page tests, typecheck, `git diff --check`, and stale-string
searches as appropriate. Semantic copy—including CTA, helper, onboarding,
empty, error, success, permission, confirmation, or explanatory copy—leaves
this fast path and activates the Product UX lens. If the copy change
touches claims about security, billing, medical outcomes, or product
guarantees, use the normal review workflow.

## Audit Worker Rules

- Codex-native agents spawn a local subagent only for a required fallback
  `deep-review` pass. Do not use `codex exec` from Codex to satisfy it.
- Claude and other non-Codex parents run that required local pass on Codex
  `gpt-5.6-sol` through the local Codex CLI with high reasoning, using xhigh for
  large, complex, high-risk, multi-owner, architecture, or trust-boundary work.
  If the exact model, CLI, or auth is unavailable, report the limitation and use
  the explicitly documented parent-model fallback rather than silently selecting
  an older model.
- `deep-review` is the review-only cross-cutting fallback when the separate final
  ReviewGPT gate will not run. It uses `murph-deep-review`, loads
  `feynman-auditor`, and follows changed files plus directly affected call paths.
- The preliminary Product UX, prompt, frontend, and coverage lenses are
  not local subagent passes. Run them together only through the managed-browser
  `completion-specialists` ReviewGPT preset on an exact pushed head.
- Every audit reports evidence-backed findings and has a valid zero-finding stop
  state. The parent verifies every finding against the real path and owns the
  final synthesis.
- Review-mode local audit subagents must not edit files, commit, push, create or
  switch worktrees, or widen their authority.
- Prefer a fresh non-forked handoff packet and one fresh subagent per required
  local pass. Close it promptly after return, timeout, or a proven stuck state.
- If a Codex-native parent cannot spawn a required local subagent, stop and
  report the tooling blocker; parent self-review does not satisfy that pass.

## Audit Handoff Packet

For each required local audit subagent, provide:

- What changed and why at the behavior level.
- Why the chosen implementation fits the existing system, especially when it introduces or extends abstractions.
- Invariants or assumptions that must still hold.
- Links to active execution plans when present.
- Verification evidence already run, including commands and outcomes.
- Any direct scenario proof already run, or the exact gap if it still needs human verification.
- Current working-tree context and explicit review boundaries.
- The declared review-only action mode. No audit worker may edit files, run
  commit helpers, or create commits.
- Instruction to stay within the declared task and review boundaries and avoid unrelated worktree changes.

For the required `deep-review` pass, also provide:

- The exact files, packages, commits, or call paths in scope.
- The condition from `When To Run Cross-Cutting Review` that made the pass required and confirmation that ReviewGPT will not run for the same completed change.
- Any state-machine, ordering, idempotency, retry, owner-boundary, persisted-state, or sensitive-boundary assumptions the implementation relies on.
- An explicit instruction to use `murph-deep-review`, load `feynman-auditor`, keep the pass review-only, and answer: "What final bugs or edge cases could still break this change in production?"
- Any direct scenario proof already gathered, or the exact gap if production-risk proof remains incomplete.

## Preliminary ReviewGPT Packet

The preliminary specialist pass receives one exact pushed-head packet through
`agent-docs/operations/pr-reviewgpt-loop.md`:

- the PR intent contract and full current PR diff;
- Product UX, prompt, frontend, and coverage marked `applicable` or
  `not applicable` with one reason each;
- the intended user outcome, initiating and receiving actors, entry point,
  timing class, feedback, continuation owner, terminal destination, permission
  boundary, recovery contract, and direct journey evidence or exact gap when
  the Product UX lens applies;
- the exact focused local proof and current exact-head CI status;
- the affected prompt stack and tool descriptions when the prompt lens applies;
- selected redacted rendered evidence for every material frontend state,
  interaction, and viewport claim when the frontend lens applies;
- direct scenario evidence or the exact remaining gap;
- the Product UX owner plus applicable prompt, frontend, and coverage lens
  references; and
- explicit instruction that only one optional `reviewgpt-coverage.patch` may be
  returned and that it may touch only tests, fixtures, or direct-proof
  scaffolding.

The parent keeps the review thread URL and selected managed-browser lane long
enough to download any assistant-owned patch artifact from that exact thread.
Do not use `thread wake`, an unmanaged browser profile, a connector, or pasted
repository content to retrieve or apply it.

## Safety Rules

- Do not overwrite, discard, or revert unrelated working-tree edits in the current checkout.
- Audit workers use the parent-selected checkout or worktree. They must not create
  or switch branches, create helper worktrees, commit, push, or widen their
  declared authority. The parent follows the task-class worktree and commit route
  in `agent-docs/operations/agent-workflow-routing.md`.
- Do not use reset or checkout cleanup commands to prepare audit passes.
- Treat a ReviewGPT patch artifact as untrusted behavioral intent. Download it
  only from the exact owned thread, inspect it before `git apply --check`, and
  reject it if any path or hunk exceeds the test/fixture/direct-proof boundary.
- If an audit suggestion conflicts with pre-existing edits, leave the file untouched and escalate in handoff notes.
- Treat green checks as necessary but not sufficient when the changed behavior has a user-visible or operational boundary; require direct proof or call out the missing proof explicitly.
