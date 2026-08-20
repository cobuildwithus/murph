# Simplify record-scoped workout tracking

Status: active
Created: 2026-08-13
Updated: 2026-08-20

## Goal

Make live workout logging tolerant of ordinary conversation gaps: retain an
exact member-set repetition prescription on the workout itself, close a finite
workout when its final planned set is logged, and let a new workout start even
when an older record was never explicitly closed.

## Root cause and invariant

- Conversation replay is bounded, so a prompt-only repetition rule eventually
  loses the member's establishing message.
- A repository-wide active-workout singleton coupled one stale record to every
  later workout start and mutation.
- The canonical workout record, not assistant runtime focus or transcript
  retention, owns workout identity, prescribed repetitions, completed sets,
  and observed end time.

## Product UX plan

Classification: Product change.

### Outcome

A member can log an ordinary finite workout with short replies and move on to
the next workout without bookkeeping questions caused by transcript limits or
an older unfinished record.

### Entry and promise

The member starts or resumes a workout in a private conversation. Murph uses
the exact workout returned by that interaction, applies an exact repetitions-
per-set statement to later terse completions for that exercise, and treats the
final planned completion as the observed session end. A later extra set can be
appended only to an exactly named workout.

### Affected people

- A member with a long workout conversation whose original repetition message
  has fallen outside bounded replay still gets the established repetitions on
  the intended set.
- A member completing the last set of an explicitly finite workout sees the
  session complete immediately and can start the next workout.
- A member with an older unfinished or targetless workout can start another
  workout without Murph inventing an end time or modifying the older record.
- A member intentionally adding an extra set can append it to the exact
  completed workout; ambiguous or missing identity remains a narrow refusal.

### Proof and recovery

Exercise the canonical start, prescription, set-log, auto-close, next-start,
retry, correction, and exact-extra-set paths. Verify the persisted record and
assistant-visible result. Old unfinished records remain readable and editable
by exact id; they no longer block unrelated work.

### Done when

- No global active or focused workout selector remains in the mutation path.
- Every mutating CLI command requires an exact workout id.
- A finite plan closes atomically with its final newly completed set.
- Exact retries and corrections do not move the observed end boundary.
- Starting another workout never depends on closing a prior workout.
- Product walkthrough, focused proof, ReviewGPT gates, exact-head CI, merge,
  deploy, and bounded post-deploy verification are green.

## Architecture decision

- Persist optional `memberRepsPerSet` on the exact workout exercise. Only an
  exact member statement can set or change it; never derive it from a target,
  prior workout, reminder, or assistant suggestion.
- Persist `setPlanIsFinite` only where existing structure cannot distinguish an
  explicit set count from an open-ended targetless exercise. Do not add focus
  state, a lifecycle manager, reconciliation, or a compatibility service.
- Target mutations by exact workout id or the existing opaque card binding.
  Use per-workout locking; delete the global workout lock and singleton lookup.
- Logging the final pending set of an entirely finite workout writes the actual
  result and accepted completion timestamp as `endedAt` in the same canonical
  mutation. A later exact extra set advances that observed boundary.
- Keep old records valid through optional fields. Legacy saved-routine workouts
  retain finite semantics; new targetless exercises explicitly remain open-
  ended.

## Deployment and rollback

The hosted assistant, CLI surface, contracts, and vault use cases ship in the
same runner bundle. Existing records need no migration, but the preceding
runner's strict workout parser rejects the two new optional fields. Deploy the
Worker and runner with `container_rollout=immediate` and prove the exact new
runner fingerprint before accepting workout traffic. Before the first new-field
write, the preceding bundle is a safe rollback; afterward, the compatible
runner is the rollback floor for affected workspaces and recovery is a forward
fix rather than a rollback below that floor. Web has no ordering dependency.

## Work

1. Inspect and simplify the generated patch against current main.
2. Add or repair focused coverage for record-scoped targeting and every
   affected Product UX path.
3. Run focused owner tests, typechecks, direct journey proof, and inspect the
   final provider-visible prompt/tool surface.
4. Commit and push one candidate, open the PR, and run required ReviewGPT gates
   concurrently with exact-head CI.
5. Resolve only verified findings with the smallest owner-level correction.
6. Close this plan, merge, deploy through the documented hosted path, verify
   bounded production signals, and retire the worktree.

## Product walkthrough

Result: Ready.

- Started an eight-set workout while a different older workout remained open;
  the new start succeeded and the older record stayed untouched.
- Stored one exact nine-repetition exercise prescription, then logged all eight
  sets through fresh CLI instances with no provider-thread state. Every terse
  completion inherited nine reps from the exact canonical exercise.
- The set-eight write atomically stored its actual and an observed `endedAt`;
  no finish-time question or second closure command was needed.
- Started and completed the next finite workout while the oldest record still
  remained open. Exact retry and correction paths kept the established end
  boundary stable, while a clearly appended ninth set advanced it once.
- Verified that targetless sessions remain open for optional additional sets,
  exact card actions revalidate under a per-workout lock, and stale cards do not
  retarget to another same-shaped workout.
- With an older and newer open workout, verified that Training displays the
  newer record, puts its exact id in the existing continuation link, and waits
  for that record rather than treating an update to the older workout as the
  requested result.
- The configured private real-model journey represents the member's input as
  exactly `Set 8 done.` while durable reply-card context supplies the opaque
  workout id. Its assertions require one final completed workout card, empty
  companion text, canonical nine-repetition actuals, atomic `endedAt`, and a
  new completed workout while the unrelated older record remains open.

## Round 2 anomaly retrospective

Decision: shrink the ambiguous generic replacement mechanism before another
review round. The first-reviewed patch had 682 authored-source lines of churn
(+472/-210); the round-two head had 736 (+524/-212). Review remediation added
52 source lines and removed 2, far below the size-growth trigger. The
retrospective is required because the same omission-restoration mechanism that
exposed `set-reps --clear` can transfer exercise-owned facts across an
order-only semantic replacement.

- Retained owners: canonical workout exercises own `memberRepsPerSet` and
  `setPlanIsFinite`; targeted live-workout commands own ordinary mutations; the
  generic workout editor owns only deliberate full-structure edits that retain
  every saved exercise and set.
- Prior correction: the exact nested clear path correctly bypassed generic
  replacement normalization for a targeted field deletion, but did not resolve
  the generic matcher's separate identity ambiguity.
- Identity rule: an unchanged exercise is proven by the same stable
  `sourceExerciseId`, by the same group plus exact normalized name, or by one
  unique exact normalized name when no stable source id exists. Presentation
  order is never identity. A label rename requires the stable source id; a
  source-id change is not implicit continuity; and a different name plus
  different source id is a semantic replacement.
- Scope decision: remove order-only matching and narrow the Assistant promise
  from arbitrary full routine replacement to identity-preserving reorder,
  additions, and field edits. The generic editor rejects removal or semantic
  replacement of an existing exercise instead of inventing continuity. No new
  command mode, state, owner, compatibility path, or operation-specific bypass
  is added.
- Landed proof: a stable-source-id reorder plus label cleanup retains the
  fixed-repetition and finite-plan facts on the same exercise, while an
  order-colliding different exercise is rejected and cannot inherit either
  fact. Ambiguous duplicate-name reorders are rejected without mutation. All
  targeted live-workout replacements now pass through one exact-record
  validation owner and persist that validated snapshot directly; the prior
  set-removal-only branch and the generic editor's order fallback are deleted.

## Verification

- ReviewGPT's preliminary findings are resolved at their existing owners. One
  turn now completes all requested workout mutations before attaching exactly
  one final card, including a just-finished finite workout. Successful
  `set-reps --clear` coverage exposed and fixed the generic editor restoring a
  deleted nested value; the clear now uses its existing exact nested patch
  surface. The configured private real-model journey supplies identity through
  durable reply-card context around a member-authored `Set 8 done.`, then
  requires one completed card, no companion prose or clarification, canonical
  repetitions, atomic closure, and an unblocked next workout.
- Final ReviewGPT round one found that the existing Training continuation CTA
  displayed the newest open workout but sent a singleton-shaped generic
  message. The current link rewrites the existing contact option with that
  selected session's exact id. Focused Web proof covers SMS, Telegram, direct
  email, parameter-based webmail, wrapped-mailto webmail, two simultaneous open
  workouts, exact handoff polling, and the rendered CTA href without adding
  focus state or another selector.
- Final ReviewGPT round two found that the generic structural editor still used
  presentation order as an exercise-identity fallback. That could transfer the
  newly durable repetition and finite-plan facts to a different exercise. The
  editor now accepts only unique stable-source-id or canonical-name continuity,
  rejects ambiguous or semantic replacements, and always protects saved sets.
  Targeted live mutations no longer re-enter that generic matcher: their one
  exact-record owner validates and persists the complete snapshot for every
  mutation, replacing the special set-removal path with one simpler boundary.
- Round-two correction verification passes: 78 real/in-memory live-workout
  assertions, 8 tracked-workout skill assertions, 13 CLI workout assertions,
  and the Vault Usecases, Assistant Engine, and CLI package typechecks.
- Focused contracts, operator-config, Assistant Engine, assistant-runtime,
  vault-usecase, and CLI suites pass: 152 behavioral assertions across the
  directly changed paths, plus all 324 contract tests and generated-schema
  verification.
- Focused correction checks pass: 37 tracked-workout prompt/card assertions, 5
  exact-workout CLI journeys, 36 real-vault workout-usecase assertions, and 43
  Training/contact rendering and selection assertions. The opt-in real-model
  file loads with 6 local checks passing and 74 credential-gated checks
  skipped, and the Assistant Engine typecheck includes its configured workout
  journey.
- All affected package typechecks pass. Prepared CLI runtime generation and
  exact package-shape verification pass after regenerating the Incur CLI
  schema, generated TypeScript surface, and skill hash from the built entrypoint.
- Complete first-provider request capture used the pinned real Codex App Server,
  local scripted Responses provider, `gpt-5.6-terra`, low reasoning, production
  code mode, identical synthetic direct/group turns with response cards
  available, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. After normalizing private
  paths and provider-generated UUIDs, direct input changes from 29,446 tokens /
  136,321 bytes to 29,458 / 136,387 (+12 tokens, +0.0408%; +66 bytes,
  +0.0484%); group changes from 25,946 / 120,827 to 25,958 / 120,893 (+12
  tokens, +0.0463%; +66 bytes, +0.0546%). The final correction was measured by
  replacing the prior captured tool object with the exact final serialized
  object and tokenizing both complete objects at their unchanged request
  boundary; it adds 11 tokens and 57 bytes over the prior reviewed head. The
  complete first-request delta remains confined to exact-workout and final-card
  eligibility phrases in the existing response-card tool description. The
  larger tracked-workout instruction rewrite remains deferred skill content and
  is not part of the initial request.
- The opt-in paid real-model journey compiles, but no supported provider
  credential is present locally. The protected production deployment's required
  live-model smoke remains the external model/auth proof.
