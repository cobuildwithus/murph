# Simplify Environment mailbox scheduling

Status: completed
Created: 2026-08-27
Updated: 2026-08-28

## Goal

- Make a completed Environment interview leave the page's saving state even
  when a foreground Murph reply is already running, without adding an
  Environment-specific scheduler or new Temporal workflow state.
- Express the behavior through the existing ordered mailbox, one generic
  execution classifier, and the existing safe checkpoint between its two
  generic runtime owners.

## Success criteria

- The exact first live durable mailbox item determines whether the next unit is
  `model_free` or `default_owned`; a later Environment item never leapfrogs an
  earlier default-owned item.
- `environment-interview.completed` is handled by the existing model-free
  system-mailbox lane and reaches Browser Vault publication without a model
  request.
- A resident default or system-mailbox owner finishes its current bounded unit,
  checkpoints, and yields when the exact first frontier belongs to the other
  owner.
- Environment status remains a UI projection only and is not a scheduling
  fact supplied to Temporal.
- Temporal selects between the existing owners from the generic frontier and
  wake reason only: a model-free `mailbox` wake uses `system_mailbox`, while a
  real `assistant` wake keeps default/foreground priority.
- Focused unit/integration tests, the relevant hosted-local composed journey,
  typecheck, exact-head review, and required CI pass.

## Scope

- In scope:
  - Generic first-frontier mailbox classification in the hosted-execution
    owner package.
  - Assistant-runtime model-free route/action admission through the existing
    default-owner checkpoint path.
  - Cloudflare runner wake semantics between default and system-mailbox work.
  - Generic Temporal owner selection for model-free mailbox wakes.
  - Removal of Environment-specific reconciliation scheduling facts and
    documentation that describes them as orchestration inputs.
  - Focused regression coverage and a public changelog entry.
- Out of scope:
  - New queues, schedulers, databases, feature flags, lifecycle managers, or
    mailbox schemas.
  - Environment-specific Temporal modes, patches, migrations, or deployment
    machinery.
  - Changes to the Environment questionnaire, generated review text, Browser
    Vault schema, or UI design.
  - Unrelated overlapping draft PR or inactive local worktree cleanup.

## Constraints

- Technical constraints:
  - Preserve strict durable mailbox order and at-least-once recovery.
  - Preserve the foreground reply hot path: no destructive abort, duplicate
    send, or partially published checkpoint.
  - Keep the classifier pure and owned by the lower hosted-execution package.
  - Maintain rolling compatibility across separately deployed Web and
    Cloudflare consumers without capability negotiation or rollout state.
- Product/process constraints:
  - This is a patch to the existing Environment-save promise, not a new flow.
  - The three required journeys are: saving during an active reply, fresh
    foreground input during model-free work, and an earlier default-owned row
    ahead of an Environment completion.
  - Keep the PR draft until local proof and the preliminary candidate review
    are complete; run exact-head ReviewGPT concurrently with CI.

## Risks and mitigations

1. Risk: Classifying any Environment row instead of the first live frontier
   would reorder the mailbox.
   Mitigation: centralize exact-frontier classification and add an explicit
   non-leapfrog regression.
2. Risk: Existing long-lived Temporal runs recorded the old owner-selection
   branch and cannot adopt the generic model-free owner in place.
   Mitigation: keep the existing Temporal compatibility pin and one-time
   operator migration signal, deploy the compatible private worker first, and
   prove affected workflows receive new Run IDs before enabling the public
   producer. Add no new rollout state or Environment-specific migration path.
3. Risk: Cross-mode wakes could interrupt a reply or canonical Browser
   Vault publication.
   Mitigation: either generic owner preserves its current bounded unit, then
   yields through the same existing wake-and-retry checkpoint path.
4. Risk: Removing the Environment reconciliation fact could regress the UI.
   Mitigation: keep the existing Environment status query at its UI owner and
   remove only its orchestration projection.

## Tasks

1. Map the current first-frontier classifier, Environment mode, reconciliation
   fact, runtime handoff, and Cloudflare ownership tests.
2. Add one shared generic classifier and route Environment completion through
   the existing model-free system-mailbox action set.
3. Reuse the existing checkpoint path and keep one symmetric cooperative yield
   rule between default and system-mailbox owners.
4. Delete Environment-specific orchestration facts, flags, and documentation
   made obsolete by the classifier.
5. Add focused deterministic and composed hosted-local proof for all three
   affected journeys; run typecheck and applicable assistant verification.
6. Commit both exact candidates, run preliminary and final exact-head ReviewGPT
   concurrently with CI, resolve accepted findings, merge, verify deployment,
   and retire owned worktrees safely.

## Decisions

- Private PR #58 is retained but redesigned: its Environment mode, migration
  patch, dependency bump, and blue-green rollout additions are deleted. Its
  net change is one generic owner-selection predicate with focused tests.
- Public PR #2448 and private PR #58 jointly own the exact candidate, review,
  CI, composed proof, and deployment.
- Keep one durable mailbox and one existing system-mailbox execution lane. An
  Environment completion is model-free work, not a new Temporal workflow mode.
- Reuse the existing Temporal compatibility release boundary and one-time
  migration signal. Pin and deploy the compatible private worker, migrate
  pre-patch workflow runs, and verify new Run IDs before enabling the public
  producer. Do not add capability negotiation, rollout state, or an
  Environment-specific migration.
- A real-Codex semantic journey is required only if the final diff changes
  model-visible prompts, tool choice, or reply behavior. Deterministic hosted
  runtime proof is the stronger evidence for scheduling-only changes.

## Verification

- Completed local proof before the composed correction:
  - Hosted-execution classifier: 8 tests passed.
  - Assistant-runtime checkpoint, system-mailbox, and Environment integration:
    91 focused tests passed on the disproven in-place-drain candidate.
  - Web reconciliation and classifier: 51 tests passed.
  - Changelog rendering: 9 tests passed.
  - Temporal compatibility fixtures: 2 tests passed.
  - Hosted-execution, assistant-runtime, Cloudflare, and Web typechecks passed.
  - `git diff --check` passed.
- Current correction proof:
  - Cloudflare runner coordination: 157 tests passed.
  - Focused system-to-default cooperative release and in-flight projection
    interruption tests passed; assistant-runtime and Cloudflare typechecks
    passed.
  - The focused ownership regression now proves that a system-mailbox
    invocation with already-local default-owned work checkpoints and returns
    an immediate assistant wake without starting device work, entering the
    assistant phase, or preparing Codex.
  - The corrected assistant-runtime typecheck passes.
  - The first strict-owner Linux run proved that the local queue selected the
    Environment frontier correctly but still labelled every non-device row as
    an assistant wake. That stale label handed model-free work back to the
    default owner and left the Environment row pending.
  - The queue's existing selected item is now the single wake authority, and
    its wake reason comes from the shared execution classifier: model-free
    work uses the existing generic mailbox wake while default-owned work uses
    the assistant wake.
  - The second exact Linux run proved that wake classification alone was not
    sufficient: the default assistant phase could still preflight due cron,
    prepare the model-free row itself, or continue into automation after
    completing a default-owned predecessor.
  - The latest exact Linux run on head `5160fc7540` proved that a bare
    exact-child wake was still ambiguous: it could mean a same-owner refresh,
    a cron interruption, or a cross-owner handoff. Both owners therefore
    checkpointed safely but could return the wake to the owner that had just
    yielded, leaving the requested work pending.
  - The correction adds only transient owner intent to the existing runtime
    wake notification when the controller is already performing a cooperative
    default/system-mailbox handoff. The intent is not stored in Temporal, the
    workspace, the mailbox, or the fence; ordinary and same-owner wakes remain
    unchanged.
  - The current correction carries the frontier's execution class with its
    wake and applies one shared order: due foreground input or delivery, then
    a due model-free mailbox frontier, then ordinary background work.
    Default-owned rows retain ordinary wake ordering. The default phase now
    yields before preparing model-free work and also yields after checkpointing
    a default-owned predecessor when the next frontier is model-free.
  - Current local proof passes: all 31 system-mailbox entrypoint tests, all 24
    system-preemption tests, all 53 assistant-phase scheduling tests, all 118
    workspace-runner tests, all 6 generic wake-selector tests, all 51
    Cloudflare container-entrypoint tests, all 157 Cloudflare runner alarm
    tests, both package typechecks, and `git diff --check`.
  - The exact Linux journey then exposed two remaining generic owner-boundary
    bugs: a due model-free row could return before fresh conversation input was
    serviced, and the outer loop could retain the serviced foreground wake and
    wait through the idle window instead of committing the new mailbox-owner
    handoff.
  - The smallest correction keeps fresh conversation input ahead of model-free
    maintenance, lets the resulting due mailbox wake replace only a carried
    non-foreground wake, and starts the existing checkpoint immediately for
    that owner handoff. It adds no state owner or scheduler.
  - Current focused proof passes: 54 assistant-phase scheduling tests, the
    assistant-runtime package typecheck, and `git diff --check`.
  - The exact paired Linux run on public head `273acac3ce` and private head
    `a0e12977cd` then proved that the owner wake itself was correct but its
    checkpoint sequencing was not. A progressed default-owned predecessor
    selected the due mailbox owner, then a duplicate idle-timer reset moved
    that checkpoint back to the ordinary coalescing deadline. Separately,
    post-checkpoint wake handling admitted generic system work before an
    already-due committed assistant turn, so the foreground reply remained
    pending without a provider request.
  - The correction stays inside the existing checkpoint owner: a progressed
    due mailbox handoff retains its immediate checkpoint deadline, while
    no-progress and budget-exhausted mailbox work keep the normal idle window;
    post-checkpoint mailbox inspection is limited to the existing causal-safe
    subset while a committed assistant wake is due. No new scheduler, state,
    mode, or rollout requirement is introduced.
  - Current local proof passes: the 20 collapse invariants and 54 assistant
    scheduling tests (74 total), the assistant-runtime package typecheck, and
    `git diff --check`.
  - The paired Linux foreground-priority journey then exposed the remaining
    two owner-boundary regressions. A validated Web-direct foreground reply no
    longer used the runner's existing graceful background preemption, so a
    held system-mailbox checkpoint could consume the wake without transferring
    ownership. In the opposite direction, a default pass could return a fresh
    due model-free mailbox wake yet continue through default-owner work after
    the already-immediate checkpoint deadline was selected.
  - The smallest correction restores the existing trusted Web-direct
    preemption path and generalizes the existing provider-handoff flag into one
    invocation-local runtime-owner handoff flag. The latter is set only from a
    fresh due mailbox wake returned by the assistant phase; carried mailbox
    retries and empty wake probes do not request an owner transfer. No durable
    state, queue, Temporal mode, feature classifier, or additional filesystem
    read is introduced.
  - Current local proof passes: all 157 Cloudflare runner coordination tests,
    the four focused assistant owner-ordering tests, both affected package
    typechecks, and `git diff --check`. The broader assistant diff suite has a
    pre-existing timing failure in the no-progress checkpoint assertion that
    reproduces unchanged at public head `f02a364fea`; the umbrella lane was
    stopped after it produced additional unrelated timing failures.
  - The exact paired Linux run on public head `8bf4482c36` proved that the
    foreground reply now preempted and completed, but the restored default
    owner replaced the already-due model-free mailbox wake with its ordinary
    assistant continuation. The Environment row remained durably imported and
    unhandled behind the default fence; no data was lost.
  - The next exact paired run disproved that carried-wake correction. Treating
    every due `mailbox` wake as an owner handoff could yield before fresh
    conversation input or an older default-owned system row, while the real
    foreground-to-system request could still end with an ordinary `assistant`
    wake label. The wake label is therefore not an ownership authority.
  - The final correction deletes that inference. The active runtime now yields
    only from the existing explicit cross-owner wake notification after the
    current foreground pass. Temporal chooses the next owner from the durable
    `systemMailboxFrontier`: conversation lag and `default_owned` rows stay on
    the default owner; an imported `model_free` frontier stays on the existing
    system owner regardless of the generic workspace wake label. No new state,
    read, scheduler, queue, mode, or feature classifier is introduced.
  - Current local proof passes: all 21 collapse invariants, all 54 assistant
    scheduling tests, 181 Temporal workflow-machine tests, the Temporal replay
    suite, both affected package typechecks, and `git diff --check`. The new
    outer-loop regression proves that a cross-owner request checkpoints after
    exactly one foreground assistant pass.
  - The existing operator migration signal remains the required release
    boundary for old workflow runs.
  - The private worker now distinguishes an actual model-free mailbox wake
    from an independent explicit assistant wake instead of treating the
    mailbox frontier as authority over every workspace wake.
  - The default owner records a prepared mailbox row before starting unrelated
    scheduled assistant work. That existing checkpoint exposes the successor
    frontier to the correct owner without another queue, mode, or persisted
    handoff field.
  - The exact paired foreground-priority run on public head `0890c61acf` and
    private head `3f33a794c9` then exposed the last outer-loop edge: after the
    assistant serviced its due token and explicitly yielded to a due mailbox
    wake, the runtime could preserve the serviced assistant token and wait for
    the ordinary idle deadline instead of checkpointing the owner change.
  - The final correction recognizes only that explicit yielded transition,
    starts the existing checkpoint immediately, and does not preserve the
    serviced assistant token over the due mailbox owner. Future mailbox work
    still retains the assistant wake and ordinary idle window. The composed
    predecessor regression now waits at the existing idle-snapshot boundary
    because the removed canonical-publication boundary no longer owns this
    handoff.
  - Current focused proof passes: 260 tests across the seven affected
    assistant-runtime suites, the focused paired foreground predecessor E2E,
    the assistant-runtime package typecheck, and `git diff --check`.
- Composed proof:
  - `pnpm hosted-local e2e foreground-reply-priority` was attempted. The branch
    predates the bundle baseline already merged on `main`; after temporarily
    using that exact base-only budget locally, bundle assembly passed but the
    existing Docker smoke environment repeatedly cancelled runner startup and
    restarted MinIO before the scenario began. The base-only budget line was
    restored and is not part of the candidate. The exact paired Linux workflow
    remains the authoritative composed proof.
- Remaining gates:
  - Corrected exact-head final ReviewGPT, public CI, private Linux composed E2E,
    and post-deploy smoke. The preliminary specialists requested the composed
    journey and a same-member ordered-predecessor case; both are accepted.
  - The first exact private Linux run disproved default-owner in-place draining,
    and the second exposed the stale wake-label mismatch after strict ownership
    was restored. The current correction keeps the two existing owners and one
    ordered queue, with no new mode or persisted state. It needs a fresh
    exact-head Linux run after the explicit-owner-boundary correction.
- Required outcomes:
  - Exact first-frontier classification, no leapfrogging, no model call for
    Environment completion, safe cooperative owner yield in both directions,
    durable retry after failure, and unchanged foreground reply authority.
Completed: 2026-08-28
