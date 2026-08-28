# Simplify Environment mailbox scheduling

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Make a completed Environment interview leave the page's saving state even
  when a foreground Murph reply is already running, without adding an
  Environment-specific scheduler or changing Temporal workflow behavior.
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
- Temporal and the private worker repository require no functional change.
- Focused unit/integration tests, the relevant hosted-local composed journey,
  typecheck, exact-head review, and required CI pass.

## Scope

- In scope:
  - Generic first-frontier mailbox classification in the hosted-execution
    owner package.
  - Assistant-runtime model-free route/action admission through the existing
    default-owner checkpoint path.
  - Cloudflare runner wake semantics between default and system-mailbox work.
  - Removal of Environment-specific reconciliation scheduling facts and
    documentation that describes them as orchestration inputs.
  - Focused regression coverage and a public changelog entry.
- Out of scope:
  - New queues, schedulers, databases, feature flags, lifecycle managers, or
    mailbox schemas.
  - Temporal workflow/patch changes or deployment machinery.
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
2. Risk: Cross-deploy skew could send the generic mode to an older Cloudflare
   runtime.
   Mitigation: deploy the accepting consumer before the producer and avoid new
   negotiation state. Production provenance proves the removed private
   Environment mode never deployed and has no rollback-eligible caller or
   persisted fence.
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
6. Commit, open the draft PR, run preliminary and final exact-head ReviewGPT
   concurrently with CI, resolve accepted findings, merge, verify deployment,
   then close the obsolete private PR and retire owned worktrees safely.

## Decisions

- The private Temporal candidate was never deployable from its pull-request
  head: the production worker workflow accepts only the exact verified `main`
  tip, and that SHA has neither a deployment record nor a worker-deploy run.
  Temporal therefore remains unchanged.
- Public replacement PR #2448 owns the exact candidate, review, CI, deployment,
  and closure of the superseded private PR.
- Keep one durable mailbox and one existing system-mailbox execution lane. An
  Environment completion is model-free work, not a new Temporal workflow mode.
- Require no special deploy order or rollout mode. Mixed versions leave the row
  on the old default path or durably pending until a compatible runner arrives;
  do not add capability negotiation or rollout state.
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
    the assistant wake. The focused Environment, approval handoff, and ordered
    frontier tests pass (3 tests), the complete mailbox-state suite passes (29
    tests), and assistant-runtime typecheck passes.
- Composed proof:
  - `pnpm hosted-local e2e foreground-reply-priority` was attempted, but the
    runner's fixed macOS total-byte ceiling stopped bundle assembly before the
    scenario started. The current Linux CI owner compares the exact base and
    candidate; repository friction is recorded separately.
- Remaining gates:
  - Corrected exact-head final ReviewGPT, public CI, private Linux composed E2E,
    and post-deploy smoke. The preliminary specialists requested the composed
    journey and a same-member ordered-predecessor case; both are accepted.
  - The first exact private Linux run disproved default-owner in-place draining,
    and the second exposed the stale wake-label mismatch after strict ownership
    was restored. The current correction keeps the two existing owners and one
    ordered queue, with no new mode or persisted state. It still needs a fresh
    exact-head Linux run.
- Required outcomes:
  - Exact first-frontier classification, no leapfrogging, no model call for
    Environment completion, safe cooperative owner yield in both directions,
    durable retry after failure, and unchanged foreground reply authority.
