# Completion Workflow

Last verified: 2026-09-02

This workflow applies to repo code/docs/test/config changes after implementation is materially complete.
Use `agent-docs/operations/agent-workflow-routing.md` to classify the task, choose the commit path, and decide whether plan mechanics apply.
Use `agent-docs/operations/verification-and-runtime.md` to choose the truthful verification command set.
Product UX planning, prompt inspection, rendered frontend proof, and executable
coverage are implementation and evidence responsibilities owned directly by the
parent agent. They do not require a preliminary specialist audit, ReviewGPT
pass, or local subagent.

Complex or sensitive PRs use the proportional final ReviewGPT gate as the sole
required cross-cutting review. Local `deep-review` remains available only when
the user explicitly requests it; it is not a fallback completion requirement.
The parent runs an explicit local final review after accepted final-gate findings
are resolved.
Removed 2026-06-12: the `simplify` and `task-finish-review` subagent passes. June 2026 transcript mining across Codex/Claude sessions and `audit-packages/` artifacts showed `simplify` produced no accepted findings, and `task-finish-review` produced mostly low-severity polish while the specialized passes caught the real local bugs and the post-completion PR ReviewGPT loop caught what the entire local stack missed. The parent-owned scope-and-shape check (step 2) owns simplification; `/simplify` remains available on demand. Removed 2026-07-14: the standalone `security-privacy-review` pass; security-sensitive changes trigger the one cross-cutting review gate instead.
Removed 2026-08-31: the mandatory preliminary specialist pass and its local
subagent replacement. Product UX, prompt, frontend, and coverage proof remain
parent-owned completion responsibilities; the risk-routed final ReviewGPT gate
and parent final review remain intact.

## Outcome and Completion Bar

The outcome is the requested behavior or documentation change, landed at the
smallest correct ownership boundary with truthful proof and no unresolved
accepted review finding. Completion requires the routed verification, parent
final review, plan closure, and scoped commit. User-facing frontend UI work also
requires a repository-owned, reviewer-openable representation of the production
component, consent surface, or composed section plus risk-matched design proof;
PR-lane work additionally requires green CI and, when the change is eligible,
the separate final pushed-head ReviewGPT gate.

**Product boundaries before defensive controls.** Do not turn data sensitivity,
generic least-privilege intuition, or reviewer caution into a new member-facing
restriction. Every new authorization, consent, identity, or eligibility gate
must trace to an explicit current requirement, a durable product or security
invariant, a shipped external contract, or reproduced harm. Enforce the proven
boundary and no narrower one. If ambiguity would materially change who may use
a capability or whose content they may act on, resolve that product question
before encoding a fail-closed rule. Apply the same standard when triaging review
findings; review must not ratchet the product into an unrequested restriction.

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
- prompt-primary changes whose scope stays inside prompt text, assembly, and
  focused prompt regression proof;
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
qualify; Product UX planning, rendered evidence, accessibility proof, and
focused frontend checks remain parent-owned requirements.

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

Skipping the final ReviewGPT gate does not skip the parent final review, scoped
verification, CI, merge-conflict proof, or the normal commit and PR requirements.

## Product and Rendered Evidence

Classify the changed dimension before evaluating final ReviewGPT eligibility. A
product-owned dimension is semantic user-facing copy;
user-visible action purpose, count, or priority; required interaction steps; UI
state selection and visible feedback or progress; user-visible element or
screen existence; asynchronous continuation or wake ownership; or the
journey's timing, delivery, permission, and recovery contract.

Before implementation, user-facing work also follows
`agent-docs/operations/product-ux.md`. Classify it as a Patch, Product change,
or Feature. Plan the affected people at the matching depth. After
implementation, complete the Product UX Walkthrough before candidate review.
The parent verifies that plan and walkthrough during candidate and final review.

| Changed dimension | Product-decision owner | Required evidence |
| --- | --- | --- |
| Any product-owned dimension, including one changed through a prompt | Product UX plan, walkthrough, and parent review | Direct journey proof; add rendered proof when `apps/web` presentation changes |
| Prompt-primary change with no product-owned dimension | Parent prompt review | Focused prompt regression proof and assembled-prompt inspection |
| Meaning-preserving tiny static-copy correction | Parent readback | Use the tiny copy-only fast path |
| Implementation-only presentation with no product-owned dimension | Parent frontend review | Rendered, responsive, and accessibility evidence proportionate to the change |

Final ReviewGPT eligibility is independent and evaluated afterward. An exemption
never waives the parent-owned Product UX, prompt, frontend, or proof obligations.
The final ReviewGPT gate never becomes a fallback product-decision owner.

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
   Run `pnpm complexity:diff` during this check for every PR. Inspect each
   changed-file hotspot it reports above the threshold and decide whether a
   smaller behavior-preserving shape is justified. A passing ratchet means the
   PR did not increase complexity debt or concentrate complexity; it does not
   prove that an existing hotspot is already well-shaped. Simplify when the
   current task can do so proportionally, otherwise record the concrete reason
   in the PR's `Complexity impact` section. Do not split cohesive policy owners,
   add generic machinery, or change behavior merely to lower the metric.
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
4. Decide the evidence and final-gate path required by the routed task class:
   - docs/process-only work normally skips external review unless the user explicitly asks for it
   - meaning-preserving `apps/web` typo, punctuation, grammar, or equivalent localization corrections may use the tiny copy-only fast path
   - prompt-primary changes require assembled-prompt inspection and focused regression proof; when the prompt also changes a product-owned dimension, complete the Product UX plan and walkthrough too
   - user-facing `apps/web` UI changes outside the copy-only fast path require enough redacted rendered evidence to judge each material visual, state, interaction, and responsive claim
   - tests, fixtures, or direct-proof infrastructure that are a primary PR outcome require parent review of whether the proof establishes the material behavior at a stable boundary
   - for behavior composed across multiple owners, map the complete production path and prefer one stable composed or end-to-end proof of the invariant; seam-level unit tests may localize failures but do not replace proof that the owners work together
   - any product-owned dimension requires Product UX planning and walkthrough, especially for asynchronous, proactive, cross-actor, permission, latency, ordering, delivery, or recovery flows
   - when the cross-cutting conditions apply, run the final ReviewGPT gate unless the user explicitly opts out
5. Once implementation is stable, run the focused local proof selected from the
   verification doc. Record the exact commands and outcomes. For PR-bound work,
   broad coverage remains pending until exact-head CI completes; for a direct
   shared-default push, run `pnpm verify:acceptance`.
   When the diff can change how Murph interprets a turn, selects or calls a
   tool, decides to stay quiet, or writes a user-visible reply, apply
   `$verify-murph-assistant`: add a production-derived real-Codex journey for
   the changed behavior, run that focused journey after deterministic boundary
   proof, inspect every actual reply, and record its effect result plus
   `Ready`/`Hold` UX verdict. This live proof is required even when the ordinary
   deterministic suite is already green.
6. For user-visible, persisted-state, operational, or trust-boundary changes,
   complete the Product UX Walkthrough with direct evidence in addition to
   scripted tests. Match the evidence to each affected person's changed claim.
   Every user-facing hosted Web UI change must have a repository-owned,
   reviewer-openable representation: its real production component on
   `/design?tab=components`, consent surface on `/design?tab=consent`, or
   composed page section or flow under `/screenshots/<category>`. Add or update
   a catalog/study state only when no existing route and anchor render the
   changed state.
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

   For the Playwright fallback, prefer an existing design-proof capture spec.
   If none covers the state, use the established `apps/web/e2e/pr-*-design-proof.spec.ts`
   pattern for one task-scoped spec: run through `apps/web/playwright.config.ts`
   so its smoke environment owns the dev server, open the anchored `/design` or
   `/screenshots` state, block non-loopback requests, wait for fonts and two
   animation frames, assert the production surface, and capture that surface
   rather than a long full page. In a secondary worktree, choose a task-unique
   port and Next dist suffix. For example:

   ```bash
   VIEWPORT_OVERFLOW_PORT=<unique-port> \
   NEXT_DIST_DIR_SUFFIX=<task-slug>-proof \
   DESIGN_PROOF_OUTPUT_DIR=../../.artifacts/review-gpt/<task-slug> \
     pnpm --dir apps/web exec playwright test \
       e2e/<capture-spec>.spec.ts --config playwright.config.ts --project chromium
   ```

   Inspect each selected image at native resolution, keep it ignored and
   redacted under `.artifacts/review-gpt/`, and remove a one-off capture spec
   after proof unless it adds durable regression value.

   Before any image or video leaves the machine, inspect each screenshot at
   native resolution and replay each video, including its audio. Prefer
   synthetic fixtures, then crop or redact all private or identifying material:
   names, handles, email addresses, phone numbers, member or provider
   identifiers, real faces or identifying avatars, health or conversation
   content, secrets and tokens, sensitive URLs or query strings, local usernames
   or home-directory paths, notifications, and unrelated browser or system
   chrome. Strip embedded location or device metadata, use a flattened export
   rather than editable redaction overlays, and keep file names, alt text, and
   surrounding prose identifier-free. Treat GitHub attachments as public, durable
   third-party artifacts: never upload an unsafe original with the intention to
   edit or delete it later. If redaction would remove the proof or privacy is
   uncertain, do not upload the media; record the evidence blocker and use
   another proof surface.

   Publish only the selected privacy-safe media with GitHub CLI 2.99.0 or newer.
   Use the repeatable `--attach` flag on `gh pr create`, `gh pr edit`, or
   `gh pr comment`; append `#<alt text>` to an image path, while video paths do
   not accept alt text. When the body already references the same local path,
   `gh` replaces that reference with the uploaded URL; otherwise it appends the
   attachment. For example:

   ```bash
   gh pr comment <pr-number> \
     --body 'Responsive design proof' \
     --attach './.artifacts/review-gpt/<task-slug>/desktop.png#Desktop changed state' \
     --attach './.artifacts/review-gpt/<task-slug>/phone.png#Phone changed state'
   ```

   Reopen the rendered PR or comment after upload. Confirm the intended media
   and image alt text appear, no private material is visible, and no local path
   remains. A nonzero command can still mean some attachments were published;
   inspect the rendered result before retrying and retry only missing media.
   See GitHub's
   [media attachment announcement](https://github.blog/changelog/2026-09-01-github-cli-media-in-issues-pull-requests-and-comments/)
   for the supported command surface.
7. Commit and push the review candidate from the task worktree, open or update
   the PR, and keep any active plan open. For plan-bearing work this is
   an intermediate scoped commit, not the final task commit;
   `scripts/committer` requires every changed file to be listed explicitly and
   rejects directory targets. Directory expansion belongs only to
   `scripts/finish-task`, which still owns plan closure and the final task
   commit later. Ensure the PR body contains the outcome, Product UX result,
   direct evidence, non-obvious surfaces, architecture and reuse, complexity
   impact, hot reply path impact, provider-input impact, deployment and
   changelog decisions, the change-shape breakdown, and applicable design proof
   required below.
8. When the final ReviewGPT gate is selected, establish its immutable round-one
   baseline on the exact pushed candidate head. The candidate must already have
   focused local proof and a parent candidate review. Run final ReviewGPT
   concurrently with CI.
9. Triage every finding from the final ReviewGPT gate locally. Report the model
    result and the parent's evidence-backed accept/reject judgment for every
    finding; rejected findings require no fix or reviewer withdrawal, and the
    user may override that judgment. Complete
    `agent-docs/operations/pr-reviewgpt-loop.md` § Finding Disposition Boundary
    for every final `FINDINGS` result. A final
    `ROUND_OUTCOME: FINDINGS` still pauses all candidate mutation until the user
    resumes unless that section's
    behavior-preserving `Complexity Collapse` or `Non-Production Remediation`
    exception applies. A validated final `ROUND_OUTCOME: PASS` proceeds without
    a user-resume pause. Implement accepted findings in the parent, rerun focused
    proof, commit, and push one combined corrected candidate. When accepted
    Product UX remediation materially changes a product-owned dimension, the
    parent must reapply `agent-docs/operations/product-ux.md` § Review Ownership
    to the corrected candidate and updated direct journey evidence, then record
    the refreshed product purpose verdict. This is bounded parent revalidation.
    Use the parent final review plus the final gate's next substantive round when
    applicable.
10. Enter the review-resolution loop below. Completion means there are no
    unresolved accepted/actionable findings and every required final-stage
    disposition boundary and pause is complete. The final gate is resolved by
    `ROUND_OUTCOME: PASS` or
    `ROUND_OUTCOME: FINDINGS` with zero accepted findings.
11. Rerun the focused local checks affected by remediation, then push so required CI evaluates the exact new PR head. If CI fails, diagnose from the narrowest reproducer outward. For a direct shared-default push, rerun `pnpm verify:acceptance` against the final reconciled candidate.
12. Run the final review locally as the parent agent after final-gate findings are resolved: re-read the full diff with fresh eyes, walk changed call paths, and check for remaining proof gaps, residual risks, and handoff completeness. Do not spawn a final-review subagent. If that review causes a behavior-bearing change, push it and run the required next final-gate round.
13. Close any active execution plan and create the final scoped commit through the path chosen by the routing doc and `AGENTS.md`; push the resulting head. Include every public-safe Frog entry created or modified during the task in that same scoped commit; do not finish with a task-owned entry untracked, unstaged, or omitted. For plan-bearing work, use `scripts/finish-task <active-plan-path> "summary" <path>...` so the plan is archived. If overlapping dirty work blocks safe closure, preserve the Frog entry, archive the plan with `scripts/close-exec-plan.sh` and report the scoped-commit blocker.
14. For PR-lane work, fetch the latest `main` or configured base and run `git merge-tree --write-tree HEAD origin/<base>` before final handoff. Green required CI on the PR-authored head plus a clean current-base merge-tree is sufficient preparation; do not merge or rebase only to chase a base that can move again while CI runs. If the merge-tree reports conflicts during preparation, update the branch normally, resolve and inspect them, rerun affected proof and required CI, and push. At an authorized merge boundary, wait only for routed review gates and required GitHub checks. If strict up-to-date checks block the merge, prefer the repository merge queue; otherwise perform at most one normal base update for the unchanged reviewed patch, inspect conflicts, run affected proof, and let required CI gate that head. If the base advances again after it is green, never perform a second base update or restart CI: rerun the merge-tree and use an already-authorized non-refresh merge path when clean, or report `moving-base race` and stop with the PR and worktree active. Do not start repeated base-refresh/CI loops during preparation. Follow the ReviewGPT loop's exact terminal, base-update, and patch-change rules.
15. An open PR remains active, so preserve its task worktree. If the current turn includes confirmed PR merge or closure, run `scripts/retire-worktree <path>` from another checkout before final handoff. The command is the mandatory task-worktree retirement gate defined in `agent-docs/operations/agent-workflow-routing.md`; preserve and report the checkout when it fails closed.
16. Final handoff must report required-check results, direct scenario evidence,
    the Product UX purpose verdict when it applies, and all review findings accepted, fixed, or
    rejected with reasons. Green required checks remain the
    default completion bar; if a required check failed for a credibly unrelated
    pre-existing reason, name the command, failing target, and why the current
    diff did not cause it.
    For every completed feature or bug fix, the final message to the developer
    or user must also include a concise `How to verify` section for testing the
    landed change. Name any prerequisite or environment, give the shortest
    concrete action sequence, and state the observable expected result. For a
    feature, cover its shortest end-to-end path. For a bug fix, start from the
    original reproduction when practical and name the behavior that proves the
    regression is gone. Automated check names may supplement these instructions
    but do not replace them. If practical human verification is unavailable,
    say why and point to the closest direct proof.
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
  add proof. Every uploaded image or video must pass the privacy review and use
  the GitHub CLI attachment procedure in sequence step 6. There is no screenshot
  quota.
- **Non-obvious affected surfaces.** Name every production behavior, shared
  subsystem, workflow, state owner, or deploy/runtime surface changed even
  though it is not obvious from the PR's purpose. State why each change is
  necessary and name its regression proof. Write `None` when there are none.
- **Architecture and reuse.** Complete four concrete bullets labeled `Existing
  systems reused`, `New logic`, `New abstractions`, and `Complexity
  intentionally avoided`. Describe the final diff. When an answer is none,
  explain which existing contract is sufficient instead of using a bare
  placeholder. The pull-request evidence guard validates this section on every
  PR.
- **Complexity impact.** Run `pnpm complexity:diff` against the PR base and
  complete three concrete bullets labeled `Guard`, `Hotspots`, and `Agent
  judgment`. `Guard` records the passing command, or a concrete not-applicable
  reason only when no authored JavaScript or TypeScript changed. `Hotspots`
  names changed-file functions above 20 and their disposition, or explains that
  none remain. `Agent judgment` states whether further behavior-preserving
  simplification is justified. The guard ratchets per-file debt above 20 and
  per-function maximum complexity; unchanged legacy debt does not fail an
  unrelated PR. Required CI compares GitHub's exact synthetic merge candidate
  with that merge commit's first parent, so an event-payload base race cannot
  widen or invalidate the comparison. The pull-request evidence guard validates
  this section. Automated PR-body owners must supply the same fields; a
  metadata-only producer such as the Frog reconciliation footer uses concrete
  not-applicable values instead of bypassing the universal evidence check.
- **Hot reply path impact.** State whether the PR changes the `Foreground Reply
  Critical Path` defined in `docs/contracts/00-invariants.md`: durable
  acceptance of a current conversation message through provider start and
  durable reply handoff. If not, write `Not applicable` with a reason. If it
  does, list every database, network/provider, and other awaited operation
  added or moved onto the path. Include maximum call counts, serial/parallel
  ordering, timeout/retry/fallback behavior, expected or measured latency, and
  before/after proof.
- **Murph initial provider input impact.** For representative individual and
  group turns, report the complete first provider-visible request assembled by
  Murph and Codex at base and head. Use identical fixtures and the target model
  tokenizer. Report absolute and delta tokens, signed percentage change,
  absolute UTF-8 bytes, and byte delta. Attribute the change across assembled
  instructions, tool/schema/generated guidance, and other provider-visible
  input. Name the measurement method and exclusions. If no provider-input
  surface changed, write `Not applicable` for both runtimes with the reason;
  do not claim a measured zero from authored prompt text alone.
- **Design proof.** Required for every user-facing hosted Web UI change. An
  existing `page.tsx` or `layout.tsx` route is exempt only when the checker
  proves that its sole runtime change is an unreferenced static object-literal
  `metadata` export with no viewport or theme metadata. Link a
  repository-owned, reviewer-openable absolute URL with a fragment to the
  production component on `/design?tab=components`, consent surface on
  `/design?tab=consent`, or composed page section/flow under
  `/screenshots/<category>`. Refresh an expired or inaccessible preview; use a
  production link only when it already renders the changed state. The only
  content-only exception is an authored changelog diff under
  `apps/web/changelog/entries/**` plus optional
  `apps/web/changelog/editions/**`: follow the review-proof route in
  `apps/web/changelog/README.md` and do not create or refresh a branch preview
  solely for design proof. Any changelog renderer, component, style, visual, or
  interaction change still needs the normal current-branch representation. Add
  or update the catalog/study state only when no existing route and anchor
  render the changed state. In a
  dedicated `## Design proof` section, include that
  `Design page:` link, `Evidence:` matched to the changed visual, state,
  interaction, and responsive risks, and `Coverage:` naming the states and
  viewports checked. A reasoned walkthrough is valid when an image adds no
  proof; there is no screenshot quota. The pull-request evidence guard validates
  only the rendered fields and supported absolute-link shape; the parent review
  owns repository origin, reachability, currentness, and whether the linked
  representation covers the changed state.
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
  evidence guard validates this section. For a shared protocol between
  independently deployed components, identify the producer and consumer, use a
  consumer-first safe order, and name direct proof for every supported
  mixed-version pair. Current-head producer/consumer proof alone is
  insufficient.
- **Changelog.** Add exactly one `## Changelog` section with
  `Changelog: updated` and its item IDs, or `Changelog: not applicable` with a
  concrete reason. The changelog guard validates this section.

Complete this launch preflight before starting PR gates:

1. Write the complete PR body first. Confirm it contains the required
   non-obvious-surface, architecture, hot reply path, provider-input,
   change-shape, changelog, and deployment sections, plus design proof for an
   applicable frontend diff. Include a concrete reason whenever a disposition
   is `not applicable`.
2. When final ReviewGPT applies, resolve the candidate with
   `git rev-parse HEAD`—never `git rev-parse --short HEAD`—prove that full
   40-character SHA equals the pushed PR head, and add the exact line
   `ReviewGPT first-reviewed head: <full-sha>` to the body.
3. Re-read the rendered PR body and confirm the architecture, path/input
   impacts, changelog, deployment, Product UX, evidence, design proof, and
   ReviewGPT metadata required for this task are present before launching
   ReviewGPT. An incomplete body is a launch blocker, not a finding to repair
   after a review has started.
4. Start the final ReviewGPT gate concurrently with CI when it applies,
   immediately after this preflight. Do not wait for CI to finish. Later
   PR-body-only edits retrigger Pull Request Evidence but do not change the
   reviewed commit baseline.

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
- maximum-cardinality database fanout and concurrency;
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

Review outputs are advisory until the parent implementation agent verifies them.
For every final-gate or explicitly requested review finding:

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
3. Complete `agent-docs/operations/pr-reviewgpt-loop.md` § Finding Disposition
   Boundary for every final `FINDINGS` result: end the active task turn before any
   mutation and continue only after
   the user resumes, unless the result qualifies for the behavior-preserving
   `Complexity Collapse` or `Non-Production Remediation` exception. A validated
   final `ROUND_OUTCOME: PASS` proceeds without this pause.
   A rejected finding is terminal and does not require model agreement.
4. For accepted/actionable findings, fix the smallest correct surface at the right ownership boundary. If repeated findings cluster around one mechanism, pause tactical patching and simplify the mechanism, split or abandon the PR, or explicitly reject the collapse finding.
5. After any review-driven code, test, config, or docs change, rerun the focused verification that proves the changed surface.
6. Rerun the final gate when the fix materially changes its risk surface:
   - when accepted Product UX remediation materially changes a product-owned dimension, push the corrected candidate and have the parent reapply `agent-docs/operations/product-ux.md` § Review Ownership to that head and updated direct journey evidence, recording a refreshed product purpose verdict; this is required corrected-head revalidation, not a local subagent or another ReviewGPT run
   - rerun the selected final ReviewGPT gate when an accepted correctness or security finding drives a broad, cross-owner, state-machine, trust-boundary, or concrete exposure fix that materially changes its risk surface
7. Do not rerun an audit solely for rejected findings, tiny wording changes, isolated test-only proof additions, or to obtain a cleaner final sentence.

Stop the loop when every review finding is either fixed/proven or consciously
rejected/out of scope with a concise reason, and no unresolved
accepted/actionable findings remain.

## When To Run Cross-Cutting Review

Require the final ReviewGPT gate when the change is complex or sensitive enough
to benefit from an independent cross-cutting review.

Require the cross-cutting gate when one or more of these conditions apply:

1. The change spans multiple owners, apps, packages, or runtime boundaries and correctness depends on their interaction.
2. The change alters state machines, ordering, idempotency, retries, concurrency, migrations, persisted-state ownership, or fail-closed behavior.
3. The change materially touches sensitive health data, auth/session authority, secrets, billing, external ingress/egress, public APIs/routes, hosted execution, Cloudflare, Temporal, persisted/uploaded/user-facing data exposure, or another trust-boundary surface.
4. The implementation is a large or high-risk refactor where a first-principles bug hunt is likely to find edge cases that focused owner proof may not catch.
5. The user explicitly asks for final ReviewGPT, a final bug hunt, or a production edge-case sweep as part of completion.

If the user explicitly opts out of the final gate, record that disposition and
continue with parent review and direct proof; do not substitute a mandatory local
subagent. An explicit request for local `deep-review` may still add that
review-only pass, but it is user-requested work rather than a completion gate. If
none of the conditions above apply, skip cross-cutting review.

## Tiny Copy-Only Fast Path

Use the lightweight proof route for very small `apps/web` copy-only edits when
all of the following are true:

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
this fast path and requires the ordinary Product UX plan and walkthrough. If the copy change
touches claims about security, billing, medical outcomes, or product
guarantees, use the normal review workflow.

## Safety Rules

- Do not overwrite, discard, or revert unrelated working-tree edits in the current checkout.
- Follow the task-class worktree and commit route in
  `agent-docs/operations/agent-workflow-routing.md`.
- Do not use reset or checkout cleanup commands to prepare review candidates.
- If a review suggestion conflicts with pre-existing edits, leave the file
  untouched and escalate in handoff notes.
- Treat green checks as necessary but not sufficient when the changed behavior has a user-visible or operational boundary; require direct proof or call out the missing proof explicitly.
